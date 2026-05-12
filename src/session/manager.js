// @ts-check
import { randomUUID } from 'node:crypto';
import { loadConfig, loadProjects } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseKodoLabels, getGsdMode } from '../labels.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';
import { addSession, listSessions, updateSession, computeWorktreePath } from './state.js';
import { stateTransition } from '../logger-events.js';

/**
 * Build the session record saved to state from a resolved TaskItem.
 * Pure function — no I/O.
 *
 * @param {{
 *   task: import('../interface.js').TaskItem,
 *   providerName: string,
 *   projectPath: string,
 *   workspaceRef: string,
 *   sessionId: string,
 *   flags?: string[],
 *   phaseId?: string,      // Phase 9 D-03: resolved phase id threaded from dispatcher (action === 'phase').
 *   brief?: string,        // Phase 9 D-09: bootstrap brief (only set when resolver returned 'bootstrap').
 *   worktreePath?: string, // Phase 18 D-03: deterministic worktree path computed by computeWorktreePath
 *                          //               (single source of truth in src/session/state.js). Persisted
 *                          //               PRE-spawn so kodo logs / consumers can resolve the path
 *                          //               immediately. Aditivo opcional (D-03c) — mismo idiom que
 *                          //               phaseId/brief/gsdMode.
 * }} params
 * @returns {import('./state.js').Session}
 */
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, flags, phaseId, brief, worktreePath }) {
  // Phase 11 (D-03): GSD execution mode derived locally from flags. Single source
  // of truth: `flags`. The signature does NOT grow — gsdMode is a local derivation,
  // mirroring the dispatcher pattern at src/triggers/dispatcher.js:74.
  const gsdMode = getGsdMode(flags);
  return {
    workspace_ref: workspaceRef,
    session_id: sessionId,
    task_id: task.id,
    task_ref: task.ref,
    provider: providerName,
    project_id: task.projectId,
    summary: task.title,
    status: /** @type {const} */ ('running'),
    started_at: new Date().toISOString(),
    project_path: projectPath,
    task_url: task.url,
    project_name: task.projectName,
    // Phase 11 (D-03/D-04): GSD mode derived locally from flags via getGsdMode.
    // When set, gsd_mode is ALWAYS persisted alongside gsd:true (no missing-mode
    // shape post-v0.4). Legacy sessions with gsd:true and no gsd_mode are read
    // as 'full' by getSessionMode (D-08). 'kodo:gsd-quick' wins over 'kodo:gsd'
    // (precedence centralized in getGsdMode — single point of change for new modes).
    ...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {}),
    // Phase 9: phase_id and brief threaded from dispatcher after resolvePhase().
    // Both optional — only present on GSD sessions where the resolver produced
    // `action: 'phase'` (phaseId) or `action: 'bootstrap'` (brief). Never both.
    ...(phaseId ? { phase_id: phaseId } : {}),
    ...(brief ? { brief } : {}),
    // Phase 18 (D-03c): aditivo opcional. Falsy/undefined → campo omitido del shape
    // (consumers downstream toleran falsy — legacy v0.5 sessions sin este campo
    // se siguen leyendo). Mismo idiom que gsd_mode (Phase 11 D-08), phase_id y brief.
    ...(worktreePath ? { worktree_path: worktreePath } : {}),
  };
}

/**
 * Resolve the local project path for a task.
 * Supports both flat strings and module-aware objects in projects map.
 * Pure function — accepts the projects map as argument.
 *
 * @param {import('../interface.js').TaskItem} task
 * @param {Record<string, string | {default?: string, modules?: Record<string, string>}>} projects
 * @returns {string}
 */
export function resolveProjectPath(task, projects) {
  const entry = projects[task.projectId];
  if (!entry) {
    throw new Error(
      `No local path mapped for project "${task.projectName || task.projectId}" (${task.projectId}). ` +
      `Run: kodo config --map-project`,
    );
  }

  // Flat string — legacy format, no module support
  if (typeof entry === 'string') return entry;

  // Object format — check module mapping first
  const moduleName = deriveModuleName(task);
  if (moduleName && entry.modules?.[moduleName]) {
    return entry.modules[moduleName];
  }

  // Fall back to default path
  if (entry.default) return entry.default;

  throw new Error(
    `No path for module "${moduleName || '(none)'}" in project "${task.projectName || task.projectId}". ` +
    `Run: kodo config to map modules.`,
  );
}

/**
 * Derive the module name from a TaskItem's groups array.
 * Pure function.
 *
 * @param {import('../interface.js').TaskItem} task
 * @returns {string|null}
 */
export function deriveModuleName(task) {
  return task.groups && task.groups.length > 0 ? task.groups[0] : null;
}

/**
 * Resolve a human ref into the launch context: task, project path, module,
 * labels, and derived model/flags. Does not touch cmux or state — returns
 * everything the caller needs to launch a session.
 *
 * @param {{
 *   provider: Pick<import('../interface.js').TaskProvider, 'init' | 'getTask'>,
 *   identifier: string,
 *   projects: Record<string, string>,
 * }} params
 */
export async function resolveTaskAndLaunchContext({ provider, identifier, projects }) {
  await provider.init();
  const task = await provider.getTask(identifier);

  const projectPath = resolveProjectPath(task, projects);
  const moduleName = deriveModuleName(task);

  // parseKodoLabels expects objects with .name — wrap string labels
  const { model, flags } = parseKodoLabels(task.labels.map((name) => ({ name })));

  return {
    task,
    projectPath,
    moduleName,
    description: task.description,
    model,
    flags,
  };
}

/**
 * Launch a Claude Code session for a provider-backed task.
 *
 * @param {string} identifier e.g. "KL-42"
 * @param {{
 *   model?: string|null,
 *   flags?: string[],
 *   sessionId?: string,
 *   phase_id?: string,  // Phase 9: threaded from dispatcher when resolver returned 'phase'.
 *   brief?: string,     // Phase 9: threaded from dispatcher when resolver returned 'bootstrap'.
 * }} [opts]
 *   If `opts.sessionId` is provided (e.g. from the GSD dispatcher which acquires
 *   the repo lock before calling), it is used verbatim as the session_id. Otherwise
 *   a fresh randomUUID() is generated (backwards-compatible for non-GSD paths).
 *   `phase_id` and `brief` are persisted on the Session record for the hook
 *   SessionStart to consume via findSession().
 */
export async function launchWorkItem(identifier, opts = {}) {
  const config = loadConfig();

  await initRegistry();
  const provider = getProvider(config.provider);

  // Check max parallel sessions
  const active = listSessions().filter((s) => s.status === 'running');
  if (active.length >= config.claude.max_parallel) {
    throw new Error(
      `Max parallel sessions (${config.claude.max_parallel}) reached. ` +
      `Active: ${active.map((s) => s.task_ref).join(', ')}`,
    );
  }

  // Resolve task + launch context via provider
  const projects = loadProjects();
  const {
    task,
    projectPath,
    moduleName,
    description,
    model: labelModel,
    flags: labelFlags,
  } = await resolveTaskAndLaunchContext({ provider, identifier, projects });

  // Create cmux workspace
  // Move task to "In Progress" in the provider
  try {
    const providerStates = config.providers?.[config.provider]?.states;
    if (providerStates?.trigger && task.state !== providerStates.trigger) {
      await provider.updateTaskState(task, providerStates.trigger);
      console.log(`[kodo] ${task.ref} → ${providerStates.trigger}`);
    }
  } catch (err) {
    console.error(`[kodo] Error moving to In Progress: ${err.message}`);
  }

  const prefix = moduleName ? `${task.ref} [${moduleName}]` : task.ref;
  const workspaceName = `${prefix}: ${truncate(task.title, 40)}`;
  const workspaceRef = await cmux.newWorkspace({
    name: workspaceName,
    cwd: projectPath,
  });

  // Set color to "running"
  await cmux.setColor({ workspace: workspaceRef, color: colorForStatus('running') });

  // Build Claude command — prefer opts overrides, fall back to label parsing.
  // CR-01 fix: accept opts.sessionId so the GSD dispatcher can thread the same
  // UUID it stamped into the lock file — acquire, persist and release share
  // identity. Non-GSD paths (no sessionId in opts) keep the pre-existing behavior.
  const sessionId = opts.sessionId || randomUUID();
  const modelOverride = opts.model ?? labelModel;
  const combinedFlags = Array.from(new Set([...(opts.flags || []), ...labelFlags]));
  // Phase 18 (D-01, D-02, D-03): compute deterministic worktree path PRE-spawn.
  // Single source of truth: computeWorktreePath de session/state.js (Plan 01).
  // El path NO se crea aquí — `claude --worktree <sessionId>` lo materializa al
  // arrancar la sesión del lado de claude. Plan 03 valida la unicidad del path
  // (D-05 fail-fast canonical error en el dispatcher, fuera de launchWorkItem).
  const worktreePath = computeWorktreePath(projectPath, sessionId);
  const claudeCmd = buildClaudeCommand(config, sessionId, task, description, modelOverride, combinedFlags, moduleName);

  // Track session in state with generic task fields
  const session = buildSessionFromTask({
    task,
    providerName: config.provider,
    projectPath,
    workspaceRef,
    sessionId,
    flags: combinedFlags,
    // Phase 9: resolver outputs threaded by dispatcher via opts. Conditional
    // spread in buildSessionFromTask omits the fields when undefined — keeps
    // Session records clean for non-GSD paths.
    phaseId: opts.phase_id,
    brief: opts.brief,
    // Phase 18 (D-03): persist el path ANTES de cmux.send. Conditional spread
    // dentro de buildSessionFromTask preserva compat para call sites sin path.
    worktreePath,
  });

  // Phase 18 (D-03 PRE-spawn ordering): persist BEFORE cmux.send so consumers
  // (kodo logs --session-of, stop hook recovery, future readers) see the
  // worktree_path immediately. Si addSession falla, cmux.send NO se llama
  // (la sesión NO arranca) — orden refuerza la garantía de trace previa.
  // Si cmux.send falla tras este addSession, el dispatcher WR-01 ya libera el
  // lock GSD; el SessionRecord queda en estado 'running' hasta el siguiente
  // ciclo de housekeeping (mismo comportamiento que tenemos hoy con session
  // records huérfanos por crashes — no es nueva superficie).
  addSession(task.id, session);

  // Send Claude command to workspace
  await cmux.send({ workspace: workspaceRef, text: claudeCmd });

  // Notify
  await cmux.notify({
    title: `kodo: ${task.ref}`,
    body: `Lanzada sesión para: ${task.title}`,
    workspace: workspaceRef,
  });

  // Notify orchestrator if running
  try {
    const workspaces = await cmux.listWorkspaces();
    const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
    if (orchMatch) {
      await cmux.send({
        workspace: orchMatch[1],
        text: `Nueva sesión lanzada: ${task.ref} (${task.title}) en ${workspaceRef}. Path: ${projectPath}\\n`,
      });
    }
  } catch {}

  return session;
}

/**
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {string} sessionId
 * @param {import('../interface.js').TaskItem} task
 * @param {string} description
 * @param {string|null|undefined} modelOverride
 * @param {string[]} [kodoFlags]
 * @param {string|null} [moduleName]
 */
export function buildClaudeCommand(config, sessionId, task, description, modelOverride, kodoFlags = [], moduleName = null) {
  const model = modelOverride || config.claude.default_model;
  const moduleCtx = moduleName ? ` Módulo: ${moduleName}.` : '';
  const prompt = `Trabaja en: ${task.title}.${moduleCtx} ${description ? 'Descripción: ' + description : ''}`.trim();

  // Las sesiones GSD (full y quick) corren slash commands autónomos; pedir
  // confirmación por tool call rompe la automatización. Cualquier modo GSD
  // implica skip-permissions, igual que kodo:yolo explícito. Un solo punto
  // de cambio: añadir un nuevo modo a getGsdMode() basta (D-01/D-02 Phase 11).
  const skipPerms = kodoFlags.includes('yolo') || getGsdMode(kodoFlags) !== null;
  const cliFlags = skipPerms ? '--dangerously-skip-permissions' : '';

  // Phase 18 (D-01, D-06b): `--worktree <sessionId>` se emite SIEMPRE — para TODAS
  // las sesiones de launchWorkItem (full + quick + no-GSD). El sessionId va como
  // arg POSICIONAL explícito (NO `--worktree=...`, NO bare `--worktree`) para
  // garantizar el path determinístico `<projectPath>/.bg-shell/<sessionId>`.
  //
  // Orden de flags (contractual, golden-bytes QUICK-07):
  //   --model X --session-id Y --worktree Y [--dangerously-skip-permissions] '<prompt>'
  //
  // Las tags `[GSD quick]`/`[GSD phase N]`/`[GSD bootstrap]` viven en el PROMPT
  // (último arg, escapado entre comillas) — añadir `--worktree` en el header NO
  // muta los offsets relativos de las tags. Phase 20 (HOOK-01) operará sobre
  // buildSessionContext/buildGsdContext, no sobre el header del cmd.
  return `claude --model ${model} --session-id ${sessionId} --worktree ${sessionId} ${cliFlags} '${escapeShell(prompt)}'`.replace(/\s+/g, ' ').trim();
}

/** @param {string} str */
function escapeShell(str) {
  return str.replace(/'/g, "'\\''");
}

/**
 * @param {string} str
 * @param {number} max
 */
function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Update a session's status and emit a typed state.transition event when a
 * logger is provided. Retrocompatible: callers that do not pass a logger
 * behave identically to a direct updateSession() call.
 *
 * @param {string} taskId
 * @param {'running'|'done'|'error'|'review'|'interrupted'} nextStatus
 * @param {string} reason
 * @param {import('../logger.js').Logger} [logger]
 */
export function markSessionStatus(taskId, nextStatus, reason, logger) {
  const current = listSessions().find((s) => s.task_id === taskId || s.task_ref === taskId);
  const fromStatus = current?.status || 'unknown';
  updateSession(taskId, { status: nextStatus });
  if (logger) {
    const log = logger.child({ component: 'session', task_id: taskId });
    stateTransition(log, { from: fromStatus, to: nextStatus, reason });
  }
}
