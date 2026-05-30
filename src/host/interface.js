// src/host/interface.js
// Contrato WorkspaceHost — Phase 38 SC#1 (TUI-17), D-01/D-02/D-03.
// Eje ortogonal a TaskProvider (src/interface.js): observa el ciclo de vida de
// los workspaces del host (cmux hoy, orca/… mañana) SIN acoplar el dashboard ni
// la sesión a un host concreto.
//
// Módulo PURO: cero side-effects al cargar. NO importa src/logger.js (LOG-12
// walker) — el logger se inyecta por el caller vía opts. El impl cmux se carga
// vía createRequire (lazy) para no traer child_process salvo que se use.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} workspace_ref - Ref canónico host-specific (e.g. "workspace:N"). D-03.
 * @property {boolean} alive - true si la tab del host está viva (presencia en listWorkspaces).
 * @property {boolean} needs_input - true si el host expone badge "Needs input" / equivalente.
 * @property {string|null} last_activity - ISO 8601 del último activity, o null si el host no lo expone.
 */

/**
 * Los 4 métodos que todo WorkspaceHost debe implementar (D-03).
 *   listWorkspaces() => Promise<WorkspaceInfo[]>
 *   selectWorkspace(ref) => Promise<{ok, code?, detail?}>  (fire-and-forget, never-throws)
 *   isAlive(ref) => Promise<boolean>
 *   needsInput(ref) => Promise<boolean>
 * @type {readonly string[]}
 */
export const HOST_METHODS = Object.freeze([
  'listWorkspaces',
  'selectWorkspace',
  'isAlive',
  'needsInput',
]);

/**
 * Valida que un objeto implementa los 4 métodos del contrato WorkspaceHost.
 * @param {Object} host
 * @throws {Error} si falta algún método.
 */
export function validateHost(host) {
  for (const method of HOST_METHODS) {
    if (typeof host[method] !== 'function') {
      throw new Error(`WorkspaceHost no implementa el método '${method}'`);
    }
  }
}

/**
 * NullHost — mock-only para tests y contract matrix (D-10).
 * NO es un host de runtime; vive aquí solo para alimentar el contract test sin
 * depender de cmux real.
 * @returns {Object} host con los 4 métodos retornando valores neutros.
 */
function createNullHost() {
  return {
    listWorkspaces: async () => [],
    selectWorkspace: async () => ({ ok: true }),
    isAlive: async () => false,
    needsInput: async () => false,
  };
}

/**
 * Factory de WorkspaceHost.
 * @param {string} name - 'cmux' | 'null'.
 * @param {Object} [opts] - DI opcional (exec, run, binary, logger). Usado por tests
 *   y por el wiring del dashboard. Para 'cmux', si se omite binary se resuelve
 *   desde loadConfig().cmux.binary (lo hace createCmuxHost).
 * @returns {Object} host con los 4 métodos de HOST_METHODS.
 * @throws {Error} si name no es reconocido.
 */
export function getHost(name, opts = {}) {
  if (name === 'null') return createNullHost();
  if (name === 'cmux') {
    const { createCmuxHost } = require('./cmux.js');
    return createCmuxHost(opts);
  }
  throw new Error(`Unknown host: ${name}`);
}
