// @ts-check
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { getProvider } from '../providers/registry.js';
import { loadConfig, loadProjects } from '../config.js';
import { parseKodoLabels, getGsdMode } from '../labels.js';
import { listSessions, removeSession, computeWorktreePath } from '../session/state.js';
import { launchWorkItem, resolveProjectPath } from '../session/manager.js';
import { acquireGsdLock, releaseGsdLock } from '../gsd/lock.js';
import * as cmux from '../cmux/client.js';
import { resolvePhase } from '../gsd/resolver.js';
import { buildBriefFromTask, isBriefEmpty } from '../gsd/brief.js';
import { EVENTS } from '../logger-events.js';

/** In-flight dispatch locks keyed by task_id (prevents duplicate sessions from concurrent webhooks) */
const inFlight = new Set();

/**
 * @typedef {{
 *   getProviderFn?: (name?: string) => import('../interface.js').TaskProvider,
 *   launchWorkItemFn?: (ref: string, opts: object) => Promise<any>,
 *   listSessionsFn?: () => any[],
 *   listWorkspacesFn?: () => Promise<string>,
 *   removeSessionFn?: (id: string) => void,
 *   acquireGsdLockFn?: (projectPath: string, sessionInfo: {session_id: string, task_id: string, task_ref: string}) => {acquired: boolean, holder?: object},
 *   releaseGsdLockFn?: (projectPath: string, sessionId: string) => void,
 *   resolveProjectPathFn?: (task: import('../interface.js').TaskItem, projects: Record<string, any>) => string,
 *   resolvePhaseFn?: (params: { projectPath: string, task: object }) => import('../gsd/resolver.js').ResolveResult,
 *   existsSyncFn?: (path: string) => boolean,
 * }} DispatchDeps
 */

/**
 * Central dispatch function for all trigger sources.
 * Provider-agnostic: accepts a TriggerEvent and decides whether to launch,
 * ignore, or detect stale sessions.
 *
 * @param {import('../interface.js').TriggerEvent} event
 * @param {{ model?: string|null, flags?: string[], force?: boolean }} [opts]
 * @param {DispatchDeps} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned'|'gsd_locked'|'resolver_failed'|'worktree_collision', session?: object, holder?: object, code?: string, detail?: string }>}
 */
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  const getProviderFn = deps.getProviderFn || ((name) => getProvider(name || event.provider));
  const launchWorkItemFn = deps.launchWorkItemFn || launchWorkItem;
  const listSessionsFn = deps.listSessionsFn || listSessions;
  const listWorkspacesFn = deps.listWorkspacesFn || (() => cmux.listWorkspaces());
  const removeSessionFn = deps.removeSessionFn || removeSession;
  const acquireGsdLockFn = deps.acquireGsdLockFn || acquireGsdLock;
  const releaseGsdLockFn = deps.releaseGsdLockFn || releaseGsdLock;
  const resolveProjectPathFn = deps.resolveProjectPathFn || ((task) => resolveProjectPath(task, loadProjects()));
  const resolvePhaseFn = deps.resolvePhaseFn || resolvePhase;
  // Phase 18 D-05: parametrizable for test hygiene (precedente: la mayoría
  // de IO en dispatch ya está parametrizado vía DispatchDeps).
  const existsSyncFn = deps.existsSyncFn || existsSync;

  // 1. Resolve task via provider
  const provider = getProviderFn(event.provider);
  console.log(`[kodo:dispatch] Resolving taskRef: ${event.taskRef}`);
  const task = await provider.getTask(event.taskRef);
  console.log(`[kodo:dispatch] Task: ${task.ref} — labels: [${task.labels.join(', ')}]`);

  // 2. Check kodo labels (skip if force=true)
  if (!opts.force) {
    const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
    console.log(`[kodo:dispatch] isKodo: ${kodoConfig.isKodo}, model: ${kodoConfig.model}`);
    if (!kodoConfig.isKodo) {
      console.log(`[kodo:dispatch] Ignored — no kodo label`);
      return { action: 'ignored' };
    }
  }

  // Parse labels for model/flags regardless of force (needed for launch opts)
  const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));

  // GSD execution mode (full|quick|null). 'kodo:gsd-quick' takes precedence
  // over 'kodo:gsd' if both labels are present (more specific intent).
  // Both modes share lock + bootstrap paths; only the prompt and phase
  // resolution semantics diverge.
  const gsdMode = getGsdMode(kodoConfig.flags);

  // 2b. Handle terminal states — clean up session if task moved to Done/Cancelled
  if (task.state) {
    const config = loadConfig();
    const providerStates = config.providers?.[event.provider]?.states || {};
    const terminalStates = [providerStates.done, 'Cancelled'].filter(Boolean);
    if (terminalStates.some((s) => s.toLowerCase() === task.state.toLowerCase())) {
      const existing = listSessionsFn().find((s) => s.task_id === task.id);
      if (existing) {
        removeSessionFn(task.id);
        console.log(`[kodo:dispatch] Cleaned session for ${task.ref} — moved to "${task.state}"`);
        return { action: 'cleaned' };
      }
      console.log(`[kodo:dispatch] Ignored — state "${task.state}" is terminal`);
      return { action: 'ignored' };
    }

    // Ignore inactive states (skip if force=true)
    // Default: Backlog + configured review state (human turn, no re-dispatch)
    if (!opts.force) {
      const defaultIgnore = ['Backlog'];
      if (providerStates.review) defaultIgnore.push(providerStates.review);
      const ignoreStates = providerStates.ignore || defaultIgnore;
      if (ignoreStates.some((s) => s.toLowerCase() === task.state.toLowerCase())) {
        console.log(`[kodo:dispatch] Ignored — state "${task.state}" is inactive`);
        return { action: 'ignored' };
      }
    }
  }

  // 3. In-flight guard — prevents duplicate dispatches for the same task
  //    when webhooks arrive in rapid succession (state.json is written
  //    only after launchWorkItem finishes, which can take seconds).
  if (inFlight.has(task.id)) {
    console.log(`[kodo:dispatch] Ignored — ${task.ref} already dispatching`);
    return { action: 'already_active' };
  }

  // 3b. GSD repo lock guard — per D-08, only for GSD-flagged tasks.
  // Generate the sessionId BEFORE acquiring the lock (fix CR-01: acquire,
  // persist, and release must share the same ownership identity). Thread it
  // through to launchWorkItemFn via opts.sessionId so buildSessionFromTask
  // persists the same value that the stop hook will later use to release.
  let gsdSessionId = null;
  let gsdProjectPath = null;
  if (gsdMode) {
    try {
      gsdProjectPath = resolveProjectPathFn(task);
    } catch {
      // Cannot resolve path — skip lock guard (launch will fail later with same error)
      gsdProjectPath = null;
    }
    if (gsdProjectPath) {
      gsdSessionId = randomUUID();
      const lockResult = acquireGsdLockFn(gsdProjectPath, {
        session_id: gsdSessionId,
        task_id: task.id,
        task_ref: task.ref,
      });
      if (!lockResult.acquired) {
        console.log(`[kodo:dispatch] gsd_locked — ${task.ref} blocked by lock on ${gsdProjectPath}`);
        return { action: 'gsd_locked', holder: lockResult.holder };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 18 D-05, D-05b, D-06b: fail-fast worktree_collision canonical
  // error. Single source of truth para el path: computeWorktreePath de
  // session/state.js (Plan 01). Patrón paralelo a gsd_locked (Phase 8
  // D-19) y resolver_failed (Phase 9 D-13): action explícito + return
  // early ANTES de invocar launchWorkItem.
  //
  // Para sesiones GSD: gsdSessionId ya está generado tras lock acquire.
  // Para sesiones no-GSD (D-06b): generamos sessionId aquí early-bird
  // para poder check colisión PRE-launch. Threaded a launchWorkItem via
  // opts.sessionId (mismo mecanismo que GSD por CR-01 fix).
  //
  // INVARIANTE WT-03: el lock per-repo (Phase 8 GSD-10) sigue siendo
  // sobre projectPath, JAMÁS sobre worktreePath. acquireGsdLockFn arriba
  // NO se modifica.
  //
  // Si resolveProjectPathFn throws (config humano roto) el path no se
  // computa y se omite el check — graceful, heredado v0.5: launchWorkItem
  // fallará luego con su propio error.
  // ─────────────────────────────────────────────────────────────────────
  let dispatchSessionId = gsdSessionId;
  let dispatchProjectPath = gsdProjectPath;
  if (!gsdMode) {
    try {
      dispatchProjectPath = resolveProjectPathFn(task);
    } catch {
      dispatchProjectPath = null;
    }
    if (dispatchProjectPath) dispatchSessionId = randomUUID();
  }
  if (dispatchSessionId && dispatchProjectPath) {
    const worktreePath = computeWorktreePath(dispatchProjectPath, dispatchSessionId);
    if (existsSyncFn(worktreePath)) {
      // Release lock if GSD acquired one (no leak — Phase 8 D-09 idempotent)
      if (gsdSessionId && gsdProjectPath) {
        try {
          releaseGsdLockFn(gsdProjectPath, gsdSessionId);
        } catch {
          // silent — release is idempotent (Phase 8 D-09)
        }
      }
      console.log(`[kodo:dispatch] worktree_collision — ${task.ref} blocked by existing worktree at ${worktreePath}`);
      return { action: 'worktree_collision', code: 'worktree_exists', detail: worktreePath };
    }
  }

  // 3c. GSD phase resolution (Phase 9, D-03). Runs AFTER lock acquisition and
  // BEFORE the session-already-active guard so that stale relaunches also
  // receive phase_id + brief threaded (pattern-mapper refinement #2 — if this
  // moved below the already-active check, relaunches of stale sessions would
  // miss the resolver output).
  //
  // Fail-closed (D-13): error verdicts release the lock and return early.
  let gsdPhaseId = null;
  let gsdBrief = null;
  let resolverVerdict = null;
  if (gsdMode && gsdProjectPath) {
    resolverVerdict = resolvePhaseFn({ projectPath: gsdProjectPath, task });
    switch (resolverVerdict.action) {
      case 'phase':
        // Quick mode is phase-agnostic: a phase match is incidental, the
        // session runs `/gsd-quick` regardless. Discard the matched phase_id.
        if (gsdMode === 'full') {
          gsdPhaseId = resolverVerdict.phase_id;
        }
        break;
      case 'bootstrap':
        // Both modes bootstrap identically (user decision: same `/gsd-new-project` path).
        gsdBrief = buildBriefFromTask(task);
        break;
      case 'error':
        // Quick mode tolerates 'no-match' — `/gsd-quick` is meant for one-off
        // tasks not necessarily tied to a ROADMAP phase. roadmap-missing and
        // multi-match are still data-quality errors that fail closed.
        if (gsdMode === 'quick' && resolverVerdict.code === 'no-match') {
          // D-06: quick + no-match is tolerated, not silent. Emit info-level
          // gsd.phase.resolved {matched:false, code:'no-match', tolerated:true,
          // mode:'quick'} for forensic reconstruction by `kodo logs --session-of`.
          // Dispatcher remains the single source of gsd.phase.resolved (D-14
          // Phase 9 invariant preserved). Field name `code` (not `error_code`)
          // distinguishes this tolerated condition from the fail-closed warn
          // emit below which uses `error_code`.
          try {
            const { createLogger } = await import('../logger.js');
            const log = createLogger({
              sessionId: gsdSessionId || 'dispatch',
              minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
            }).child({ component: 'dispatcher', task_id: task.id });
            log.info(EVENTS.GSD_PHASE_RESOLVED, {
              event: EVENTS.GSD_PHASE_RESOLVED,
              matched: false,
              code: 'no-match',
              tolerated: true,
              mode: 'quick',
              task_ref: task.ref,
            });
          } catch {
            // silent — never block dispatch on logger failure (mirror existing
            // forensic warn pattern below)
          }
          break;
        }
        // D-13: fail-closed. Release lock, emit forensic event, return early.
        if (gsdSessionId && gsdProjectPath) {
          try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {
            // silent — lock.js release is idempotent
          }
        }
        // D-14: emit gsd.phase.resolved with matched:false for forensic logging.
        try {
          const { createLogger } = await import('../logger.js');
          const log = createLogger({
            sessionId: gsdSessionId || 'dispatch',
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'dispatcher', task_id: task.id });
          log.warn(EVENTS.GSD_PHASE_RESOLVED, {
            event: EVENTS.GSD_PHASE_RESOLVED,
            matched: false,
            error_code: resolverVerdict.code,
            detail: resolverVerdict.detail,
            task_ref: task.ref,
            mode: gsdMode,  // D-07 schema homogeneity: warn fail-closed also distinguishes mode
          });
        } catch {
          // silent — never block the return on logger failure
        }
        console.log(`[kodo:dispatch] resolver_failed — ${task.ref}: ${resolverVerdict.code}${resolverVerdict.detail ? ' (' + resolverVerdict.detail + ')' : ''}`);
        return {
          action: 'resolver_failed',
          code: resolverVerdict.code,
          detail: resolverVerdict.detail,
        };
    }
    // D-14: emit matched-true gsd.phase.resolved (phase branch) or gsd.bootstrap (bootstrap branch).
    try {
      const { createLogger } = await import('../logger.js');
      const { gsdPhaseResolved, gsdBootstrap } = await import('../logger-events.js');
      const log = createLogger({
        sessionId: gsdSessionId,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'dispatcher', task_id: task.id });
      if (resolverVerdict.action === 'phase') {
        // D-05: mode in payload — emit phase_id + match_heading even in quick
        // mode (forensic: operator can see "resolver matched phase X but session
        // is phase-agnostic"). Session record itself drops phase_id when quick
        // (see the case 'phase' handler above).
        gsdPhaseResolved(log, {
          phase_id: resolverVerdict.phase_id,
          match_heading: resolverVerdict.match_heading,
          mode: gsdMode,  // 'full' | 'quick' — never null inside if(gsdMode && ...)
        });
      } else if (resolverVerdict.action === 'bootstrap') {
        // D-07: mode in payload — homogeneous schema for kodo logs filtering.
        // D-14 (Phase 9 invariant) + Phase 11 lift: emit via the typed helper
        // gsdBootstrap (closed taxonomy) instead of the literal log.info — the
        // helper already exists in src/logger-events.js and accepts brief_empty.
        gsdBootstrap(log, {
          project_path: gsdProjectPath,
          brief_empty: isBriefEmpty(task),
          mode: gsdMode,  // 'full' | 'quick'
        });
      }
    } catch {
      // silent — never crash dispatch on logger failure
    }
  }

  // 4. Session-already-active guard (checks persisted state)
  const active = listSessionsFn();
  const existing = active.find((s) => s.task_id === task.id);

  if (existing) {
    try {
      const workspaces = await listWorkspacesFn();
      if (workspaces.includes(existing.workspace_ref)) {
        return { action: 'already_active' };
      }
      // Workspace gone - clean up stale session
      removeSessionFn(task.id);
    } catch {
      removeSessionFn(task.id);
    }

    // Relaunch after stale cleanup
    inFlight.add(task.id);
    try {
      const launchOpts = {
        model: opts.model ?? kodoConfig.model,
        flags: [...(opts.flags || []), ...kodoConfig.flags],
        // Phase 18 CR-01 fix: thread `dispatchSessionId` (NOT `gsdSessionId`)
        // — for GSD: dispatchSessionId === gsdSessionId by construction
        // (línea 167). Para non-GSD: dispatchSessionId fue el UUID que pasó
        // por el collision-check (líneas 175-179). Si pasáramos gsdSessionId
        // aquí, sería `null` en non-GSD y launchWorkItem generaría un UUID
        // fresh sin validar colisión — rompería el contrato D-05.
        // Misma idiom que el path "Launch" (línea 377).
        ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
        // Phase 18 WR-01 fix: thread projectPath ya resuelto para evitar
        // double-resolution y cerrar la ventana de inconsistencia con el
        // path validado por collision-check.
        ...(dispatchProjectPath ? { projectPath: dispatchProjectPath } : {}),
        // Phase 9: thread phase_id (match) or brief (bootstrap) so Session
        // record persists them for the hook SessionStart to render.
        ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
        ...(gsdBrief ? { brief: gsdBrief } : {}),
      };
      const session = await launchWorkItemFn(event.taskRef, launchOpts);
      return { action: 'stale_relaunch', session };
    } catch (err) {
      // WR-01: if launch throws after the GSD lock was acquired, release it
      // so the repo does not stay locked until TTL. Phase 18 D-03 inverted
      // the ordering in launchWorkItem to `addSession → cmux.send`: si el
      // throw ocurre ANTES de addSession (provider/cmux.newWorkspace) no hay
      // SessionRecord y la sesión no arranca; si ocurre DESPUÉS de addSession
      // pero ANTES de cmux.send, queda un SessionRecord 'running' huérfano
      // (mismo modo que crashes post-spawn — el stop hook lo limpia en el
      // siguiente ciclo). En ambos casos, liberar el lock aquí es correcto.
      if (gsdSessionId && gsdProjectPath) {
        try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {
          // silent — best effort, never mask the original error
        }
      }
      throw err;
    } finally {
      inFlight.delete(task.id);
    }
  }

  // 5. Launch
  inFlight.add(task.id);
  try {
    const launchOpts = {
      model: opts.model ?? kodoConfig.model,
      flags: [...(opts.flags || []), ...kodoConfig.flags],
      // Phase 18: thread dispatchSessionId (puede ser GSD generado pre-lock
      // o no-GSD generado en collision-check block arriba). launchWorkItem
      // consume vía `opts.sessionId || randomUUID()` — si está presente lo
      // usa verbatim. Garantiza que la UUID del worktree path == sessionId
      // del lock file (CR-01 + WT-01/WT-03 invariants).
      ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
      // Phase 18 WR-01 fix: thread projectPath ya resuelto para evitar
      // double-resolution y cerrar la ventana de inconsistencia con el
      // path validado por collision-check.
      ...(dispatchProjectPath ? { projectPath: dispatchProjectPath } : {}),
      // Phase 9: thread phase_id (match) or brief (bootstrap) so Session
      // record persists them for the hook SessionStart to render.
      ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
      ...(gsdBrief ? { brief: gsdBrief } : {}),
    };
    const session = await launchWorkItemFn(event.taskRef, launchOpts);
    return { action: 'launched', session };
  } catch (err) {
    // WR-01: if launch throws after the GSD lock was acquired, release it so
    // the repo does not stay locked until TTL. Phase 18 D-03 reordered
    // launchWorkItem to `addSession → cmux.send`: en el peor caso queda un
    // SessionRecord 'running' huérfano si cmux.send falla — el stop hook lo
    // limpia. El lock release sigue siendo idempotente y seguro aquí.
    if (gsdSessionId && gsdProjectPath) {
      try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {
        // silent — best effort, never mask the original error
      }
    }
    throw err;
  } finally {
    inFlight.delete(task.id);
  }
}
