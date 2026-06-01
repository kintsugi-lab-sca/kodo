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
 *   state?: 'running'|'idle'|'needs-input'|'dead'|'closed'|'review'|'error',  // Phase 38 D-04/D-11: ciclo de vida explícito. Aditivo opcional (poblado por migrateStateV2toV3); sesiones v2 sin migrar se leen undefined.
 *   needs_input?: boolean,     // Phase 38 D-04/D-11: true cuando el host expone "Needs input". Dimensión independiente de state.
 *   process_alive?: boolean,   // Phase 38 D-04/D-11: el proceso Claude sigue vivo. Derivado de status en la migración.
 *   tab_alive?: boolean,       // Phase 38 D-04/D-11: la tab del workspace host sigue viva. Default false en migrate puro; lo puebla la reconciliación (Plan 04).
 *   last_seen_alive?: string|null,  // Phase 38 D-04/D-11: ISO 8601 del último tick donde tab_alive fue true, o null. Default null en migrate puro.
 *   alive?: boolean,           // Phase 38 D-11: booleano agregado de compat (= state ∈ {running, idle, needs-input}). Poblado por migrateStateV2toV3; consumers que ya lo leen siguen funcionando.
 *   dead_since?: string,       // Phase 38 D-07: ISO 8601 del tick donde la session transicionó a 'dead'. Lo fija reconcileTick; se usa para sellar a 'closed' tras 30 días.
 * }} Session
 *
 * @typedef {{
 *   schema_version: number,
 *   sessions: Record<string, Session>,
 *   history?: Array<Session & { ended_at: string }>  // Phase 30 (D-09 cleanup): aditivo opcional. Mantenido por removeSession (FIFO 50-slot cap). Legacy state.json files sin history se leen como ausente — callers usan `Array.isArray(state.history) ? state.history : []` defensive guard.
 * }} State
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
 * Mapea el `status` legacy v2 al `state` del ciclo de vida v3 (D-04).
 *   'running'     → 'running'
 *   'done'        → 'idle'   (compat shim D-04 último párrafo — el stop hook ya
 *                             no significa "muerta", sino "esperando humano")
 *   'error'       → 'dead'
 *   'interrupted' → 'dead'
 *   'review'      → 'review' (ortogonal a Phase 38, preservado — D-12)
 * Cualquier otro valor (defensivo) cae a 'idle'.
 * @param {string} status
 * @returns {'running'|'idle'|'needs-input'|'dead'|'closed'|'review'|'error'}
 */
function statusToStateV3(status) {
  switch (status) {
    case 'running': return 'running';
    case 'done': return 'idle';
    case 'error': return 'dead';
    case 'interrupted': return 'dead';
    case 'review': return 'review';
    default: return 'idle';
  }
}

/**
 * Migra un state object del schema v2 al v3. Función PURA — no hace I/O.
 *
 * Phase 38 (D-04/D-05/D-11). A diferencia de la v1→v2 (que hace un destructive
 * `sessions: {}`), la v2→v3 PRESERVA sessions y history, derivando los 5 campos
 * nuevos del ciclo de vida de forma aditiva (D-11):
 *   - `state`          ← statusToStateV3(status)
 *   - `process_alive`  ← (status === 'running')
 *   - `tab_alive`      ← false (default; el rescate cross-host vive en la
 *                        reconciliación de Plan 04, NO en migrate puro —
 *                        RESEARCH §S1 punto 2)
 *   - `needs_input`    ← false (default)
 *   - `last_seen_alive`← null (default)
 *   - `alive`          ← state ∈ {running, idle, needs-input} (compat con
 *                        consumers que ya leen el booleano agregado)
 *
 * history se preserva SIN modificar — el rescate desde history a sessions
 * requiere el host de Plan 01 + el reconciliador de Plan 04.
 *
 * Idempotente: si `rawState.schema_version === 3` retorna el mismo objeto
 * referencialmente (D-05 — F6 test).
 *
 * @param {object} rawState - state v2 (o v3 ya migrado).
 * @returns {State}
 */
export function migrateStateV2toV3(rawState) {
  if (rawState.schema_version === 3) return rawState;

  /** @type {Record<string, Session>} */
  const newSessions = {};
  for (const [taskId, session] of Object.entries(rawState.sessions || {})) {
    const state = statusToStateV3(/** @type {any} */ (session).status);
    newSessions[taskId] = {
      .../** @type {Session} */ (session),
      state,
      process_alive: /** @type {any} */ (session).status === 'running',
      tab_alive: false,
      needs_input: false,
      last_seen_alive: null,
      alive: state === 'running' || state === 'idle' || state === 'needs-input',
    };
  }

  return {
    schema_version: 3,
    sessions: newSessions,
    history: Array.isArray(rawState.history) ? rawState.history : [],
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
 * Lee el state.json del disco; si es schema < 3, crea backup timestamped y migra
 * encadenando v1→v2→v3 (Phase 38 D-05). Idempotente: si ya es v3, retorna sin
 * tocar disco (no crea backup redundante).
 *
 * @param {import('../logger.js').Logger} [logger] - opcional; si se provee se
 *   emite `state.migration.v2_to_v3` (D-13). NO se importa logger.js aquí
 *   (LOG-12 walker) — el caller lo inyecta. Sin logger, console.log fallback.
 * @private
 */
function migrateStateIfNeeded(logger) {
  if (!existsSync(STATE_PATH)) return;
  let raw;
  try {
    raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return;
  }
  // Idempotencia: ya en v3 → nada que migrar, ningún backup (D-05 + R-1).
  if (raw.schema_version === 3) return;

  // Backup ANTES de migrar (D-05 + R-1). Timestamp sortable YYYYMMDDTHHMMSS.
  const ts = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15);
  writeFileSync(STATE_PATH + '.bak.' + ts, JSON.stringify(raw, null, 2) + '\n');

  // Encadenar: v1 (sin schema_version) → v2 → v3. v2 → v3 directo.
  const v2 = raw.schema_version === 2 ? raw : migrateState(raw);
  const fromCount = Object.keys(v2.sessions || {}).length;
  const newState = migrateStateV2toV3(v2);
  writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2) + '\n');

  // Logger event (D-13). rescued/sealed son 0 en Plan 02 (rescate vive en Plan 04).
  if (logger) {
    // import dinámico evitaría LOG-12; pero el helper vive en logger-events.js
    // que el caller ya conoce. Aquí solo invocamos si nos pasaron un logger ya
    // construido. El helper se importa lazy para no acoplar state.js a él.
    import('../logger-events.js')
      .then((m) => m.stateMigrationV3(logger, {
        from_count: fromCount,
        to_sessions: Object.keys(newState.sessions).length,
        to_history: (newState.history || []).length,
        rescued: 0,
        sealed: 0,
      }))
      .catch(() => {});
  } else {
    console.log('[kodo] State migrado a schema_version 3 (backup: state.json.bak.' + ts + ')');
  }
}

/** @returns {State} */
export function loadState() {
  migrateStateIfNeeded();
  if (!existsSync(STATE_PATH)) return { schema_version: 2, sessions: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { schema_version: 3, sessions: {}, history: [] };
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
 * Find session by sessionId, workspace ref, or project path. Scans BOTH
 * `state.sessions` (active) AND `state.history` (terminated, FIFO 50-slot
 * cap maintained by removeSession).
 *
 * Returns a tagged discriminated union with `source: 'sessions' | 'history'`
 * (Phase 30 D-01). Legacy callers that only read `r.session` keep working
 * — `source` is additive.
 *
 * Priority (D-02): when an entry appears in both buckets (degenerate window
 * between removeSession's `unshift` and `delete state.sessions[taskId]`),
 * `sessions` wins. SC#3 ROADMAP lockea this invariant.
 *
 * For history entries (D-03), `id = session.task_id` is synthesized from the
 * record itself because `state.history` is an array with no real keys.
 *
 * The 3 lookup keys (`sessionId`, `workspaceRef`, `cwd`) operate identically
 * over history entries (D-04) — removeSession preserves the original shape
 * via `{...removed, ended_at: ISO}`.
 *
 * Closes CR-01 Phase 19 deferred. Driver: ROMAN-132 (2026-05-15) confirmed
 * state.json desync — `state.sessions = {}` while session lived in
 * `state.history`. `kodo gsd verify <session-id>` and `kodo logs
 * --session-of <task-id>` must work for archived sessions.
 *
 * @param {{ sessionId?: string, cwd?: string, workspaceRef?: string }} query
 * @returns {{ id: string, session: Session, source: 'sessions' | 'history' } | null}
 */
export function findSession(query) {
  const state = loadState();
  const sessions = state.sessions;
  // D-04 defensive Array.isArray guard — legacy state.json files have no
  // `history` field (same pattern as listHistory line 146).
  const history = Array.isArray(state.history) ? state.history : [];

  // D-02 priority sessions: scan active sessions FIRST. Any match here
  // wins over history (degenerate window during removeSession).
  if (query.sessionId) {
    for (const [id, session] of Object.entries(sessions)) {
      if (session.session_id === query.sessionId) {
        return { id, session, source: 'sessions' };
      }
    }
  }
  for (const [id, session] of Object.entries(sessions)) {
    if (query.workspaceRef && session.workspace_ref === query.workspaceRef) {
      return { id, session, source: 'sessions' };
    }
    if (query.cwd && session.project_path === query.cwd) {
      return { id, session, source: 'sessions' };
    }
  }

  // D-03 history scan: id sintetizado desde session.task_id (history es
  // array sin key real). Mismas 3 lookup keys que sessions (D-04 — shape
  // preservado por removeSession).
  if (query.sessionId) {
    for (const session of history) {
      if (session.session_id === query.sessionId) {
        return { id: session.task_id, session, source: 'history' };
      }
    }
  }
  for (const session of history) {
    if (query.workspaceRef && session.workspace_ref === query.workspaceRef) {
      return { id: session.task_id, session, source: 'history' };
    }
    if (query.cwd && session.project_path === query.cwd) {
      return { id: session.task_id, session, source: 'history' };
    }
  }

  return null;
}

export { STATE_PATH };
