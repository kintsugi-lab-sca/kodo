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

/** @returns {State} */
export function loadState() {
  if (!existsSync(STATE_PATH)) return { sessions: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { sessions: {} };
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
