// @ts-check
import { randomUUID } from 'node:crypto';
import { getProvider } from '../providers/registry.js';
import { loadConfig, loadProjects } from '../config.js';
import { parseKodoLabels } from '../labels.js';
import { listSessions, removeSession } from '../session/state.js';
import { launchWorkItem, resolveProjectPath } from '../session/manager.js';
import { acquireGsdLock, releaseGsdLock } from '../gsd/lock.js';
import * as cmux from '../cmux/client.js';
import { resolvePhase } from '../gsd/resolver.js';
import { buildBriefFromTask, isBriefEmpty } from '../gsd/brief.js';

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
 * @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned'|'gsd_locked'|'resolver_failed', session?: object, holder?: object, code?: string, detail?: string }>}
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
  if (kodoConfig.flags.includes('gsd')) {
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
  if (kodoConfig.flags.includes('gsd') && gsdProjectPath) {
    resolverVerdict = resolvePhaseFn({ projectPath: gsdProjectPath, task });
    switch (resolverVerdict.action) {
      case 'phase':
        gsdPhaseId = resolverVerdict.phase_id;
        break;
      case 'bootstrap':
        gsdBrief = buildBriefFromTask(task);
        break;
      case 'error':
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
          log.warn('gsd.phase.resolved', {
            event: 'gsd.phase.resolved',
            matched: false,
            error_code: resolverVerdict.code,
            detail: resolverVerdict.detail,
            task_ref: task.ref,
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
      const { gsdPhaseResolved } = await import('../logger-events.js');
      const log = createLogger({
        sessionId: gsdSessionId,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'dispatcher', task_id: task.id });
      if (resolverVerdict.action === 'phase') {
        gsdPhaseResolved(log, {
          phase_id: resolverVerdict.phase_id,
          match_heading: resolverVerdict.match_heading,
        });
      } else if (resolverVerdict.action === 'bootstrap') {
        // Include brief_empty flag per D-12 for operator visibility.
        log.info('gsd.bootstrap', {
          event: 'gsd.bootstrap',
          project_path: gsdProjectPath,
          brief_empty: isBriefEmpty(task),
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
        // Thread GSD sessionId so launchWorkItem uses the UUID stamped in the
        // lock file (fix CR-01). Omitted for non-GSD paths.
        ...(gsdSessionId ? { sessionId: gsdSessionId } : {}),
        // Phase 9: thread phase_id (match) or brief (bootstrap) so Session
        // record persists them for the hook SessionStart to render.
        ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
        ...(gsdBrief ? { brief: gsdBrief } : {}),
      };
      const session = await launchWorkItemFn(event.taskRef, launchOpts);
      return { action: 'stale_relaunch', session };
    } catch (err) {
      // WR-01: if launch throws after the GSD lock was acquired, release it
      // so the repo does not stay locked until TTL. No session was ever
      // persisted (addSession runs last), so the stop hook cannot recover.
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
      // Thread GSD sessionId so launchWorkItem uses the UUID stamped in the
      // lock file (fix CR-01). Omitted for non-GSD paths.
      ...(gsdSessionId ? { sessionId: gsdSessionId } : {}),
      // Phase 9: thread phase_id (match) or brief (bootstrap) so Session
      // record persists them for the hook SessionStart to render.
      ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
      ...(gsdBrief ? { brief: gsdBrief } : {}),
    };
    const session = await launchWorkItemFn(event.taskRef, launchOpts);
    return { action: 'launched', session };
  } catch (err) {
    // WR-01: if launch throws after the GSD lock was acquired, release it so
    // the repo does not stay locked until TTL. The Stop hook cannot recover
    // here because no session record was ever persisted (addSession runs last).
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
