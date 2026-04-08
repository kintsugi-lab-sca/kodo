// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';

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
 * @param {string} planeId
 * @param {Session} session
 */
export function addSession(planeId, session) {
  const state = loadState();
  state.sessions[planeId] = session;
  saveState(state);
}

/** @param {string} planeId */
export function removeSession(planeId) {
  const state = loadState();
  delete state.sessions[planeId];
  saveState(state);
}

/**
 * @param {string} planeId
 * @param {Partial<Session>} updates
 */
export function updateSession(planeId, updates) {
  const state = loadState();
  if (state.sessions[planeId]) {
    Object.assign(state.sessions[planeId], updates);
    saveState(state);
  }
}

/** @param {string} planeId */
export function getSession(planeId) {
  return loadState().sessions[planeId] || null;
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
  for (const [id, session] of Object.entries(sessions)) {
    if (query.cwd && session.project_path === query.cwd) return { id, session };
    if (query.workspaceRef && session.workspace_ref === query.workspaceRef) return { id, session };
  }
  return null;
}

export { STATE_PATH };
