// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
// LOG-12: import only the zero-import noop logger, NEVER logger.js. The noop
// is explicitly whitelisted in test/check-isolation.test.js.
import { noopLogger } from '../logger-noop.js';

const STATE_PATH = join(KODO_DIR, 'state.json');

/**
 * @typedef {{
 *   workspace_ref: string,
 *   session_id: string,
 *   task_id: string,           // UUID del task en el provider activo
 *   task_ref: string,          // Referencia humana: "KL-42", "#42"
 *   provider: string,          // "plane", "github", etc.
 *   project_id: string,
 *   summary: string,
 *   status: 'running'|'done'|'error'|'review',
 *   started_at: string,
 *   project_path: string,
 *   task_url?: string,         // Optional URL to the task in the provider UI
 *   project_name?: string,     // Optional human-friendly project name
 *   gsd?: boolean,             // Phase 8: GSD mode flag (D-10). Falsy/missing == non-GSD.
 *   gsd_mode?: 'full'|'quick', // GSD execution mode. 'full' = plan→execute→verify chain (kodo:gsd label). 'quick' = single /gsd-quick command (kodo:gsd-quick label). Only set when gsd === true.
 *   phase_id?: string,         // Phase 9 (D-11): resolved phase identifier. Populated by dispatcher when match succeeds.
 *   brief?: string,            // Phase 9 (D-09, pattern-mapper #4): bootstrap brief rendered by buildBriefFromTask. Persisted so hook SessionStart can read it via findSession(). Only set when resolver returns action='bootstrap'.
 *   worktree_path?: string,    // Phase 18 (D-03c, aditivo opcional — mismo patrón que gsd_mode Phase 11 D-08). Path determinístico derivado del session-id (`<projectPath>/.bg-shell/<sessionId>`) computado por computeWorktreePath. Sesiones legacy v0.5 sin este campo se leen como undefined; consumers downstream deben tolerar falsy. NO bump de schema_version.
 * }} Session
 *
 * @typedef {{ schema_version: number, sessions: Record<string, Session> }} State
 */

/**
 * Migra un state object del schema v1 al v2.
 * Función pura — no hace I/O.
 *
 * @param {object} rawState
 * @returns {State}
 */
export function migrateState(rawState) {
  if (rawState.schema_version === 2) return rawState;
  return {
    schema_version: 2,
    sessions: {},
  };
}

/**
 * Compute the deterministic worktree path for a session.
 *
 * Phase 18 (D-01, D-02, D-03 — Claude's Discretion factor-into-helper).
 * Pure function: NO realpathSync, NO mkdirSync, NO existsSync — solo `path.join`.
 * Determinístico por (projectPath, sessionId): mismo input → mismo output.
 *
 * Convención: `<projectPath>/.bg-shell/<sessionId>` (CONTEXT.md §domain).
 * `.bg-shell/` es la convención claude para worktrees de sesión (ver
 * `claude --help`). El directorio NO se crea aquí — eso lo hace
 * `claude --worktree <sessionId>` durante el spawn (Plan 02).
 *
 * Phase 19 consumirá este helper para `git worktree remove <worktreePath>`
 * en el stop hook (WT-04). Mantener la firma estable.
 *
 * @param {string} projectPath - Repo principal (no symlinked-resolved aquí; ver D-04).
 * @param {string} sessionId - UUID de la sesión (mismo que `Session.session_id`).
 * @returns {string} Path absoluto sin trailing slash.
 */
export function computeWorktreePath(projectPath, sessionId) {
  return join(projectPath, '.bg-shell', sessionId);
}

/**
 * Lee el state.json del disco; si es schema v1, crea backup y migra.
 * @private
 */
function migrateStateIfNeeded() {
  if (!existsSync(STATE_PATH)) return;
  let raw;
  try {
    raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return;
  }
  if (raw.schema_version === 2) return;
  writeFileSync(STATE_PATH + '.bak', JSON.stringify(raw, null, 2) + '\n');
  const newState = migrateState(raw);
  writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2) + '\n');
  console.log('[kodo] State migrado a schema_version 2 (backup: state.json.bak)');
}

/** @returns {State} */
export function loadState() {
  migrateStateIfNeeded();
  if (!existsSync(STATE_PATH)) return { schema_version: 2, sessions: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { schema_version: 2, sessions: {} };
  }
}

/** @param {State} state */
export function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

/**
 * @param {string} taskId
 * @param {Session} session
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 */
export function addSession(taskId, session, logger = noopLogger) {
  const state = loadState();
  state.sessions[taskId] = session;
  saveState(state);
  logger.info('state.session.added', {
    task_id: taskId,
    status: session.status,
  });
}

/**
 * @param {string} taskId
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 */
export function removeSession(taskId, logger = noopLogger) {
  const state = loadState();
  const removed = state.sessions[taskId];
  if (removed) {
    if (!Array.isArray(state.history)) state.history = [];
    state.history.unshift({
      ...removed,
      ended_at: new Date().toISOString(),
    });
    state.history = state.history.slice(0, 50);
  }
  delete state.sessions[taskId];
  saveState(state);
  logger.info('state.session.removed', { task_id: taskId });
}

/** @returns {Array<Session & { ended_at: string }>} */
export function listHistory() {
  const state = loadState();
  return Array.isArray(state.history) ? state.history : [];
}

/**
 * @param {string} taskId
 * @param {Partial<Session>} updates
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 */
export function updateSession(taskId, updates, logger = noopLogger) {
  const state = loadState();
  if (state.sessions[taskId]) {
    Object.assign(state.sessions[taskId], updates);
    saveState(state);
    logger.info('state.session.updated', {
      task_id: taskId,
      keys: Object.keys(updates),
    });
  }
}

/** @param {string} taskId */
export function getSession(taskId) {
  return loadState().sessions[taskId] || null;
}

/** @returns {Session[]} */
export function listSessions() {
  return Object.values(loadState().sessions);
}

/**
 * Find session by workspace ref or project path
 * @param {{ cwd?: string, workspaceRef?: string }} query
 */
export function findSession(query) {
  const sessions = loadState().sessions;
  // Prefer exact session_id match (unique, no ambiguity)
  if (query.sessionId) {
    for (const [id, session] of Object.entries(sessions)) {
      if (session.session_id === query.sessionId) return { id, session };
    }
  }
  // Fall back to workspace ref or cwd
  for (const [id, session] of Object.entries(sessions)) {
    if (query.workspaceRef && session.workspace_ref === query.workspaceRef) return { id, session };
    if (query.cwd && session.project_path === query.cwd) return { id, session };
  }
  return null;
}

export { STATE_PATH };
