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
 * @property {string} [title] - Título del workspace tal cual lo expone el host (kodo lo fija con el
 *   task_ref, p. ej. "ROMAN-170 [FVF]: …"). Opcional: usado por reconcile para verificar la IDENTIDAD
 *   del match cuando el host recicla los `workspace_ref` (cmux reusa `workspace:N`). Ausente en
 *   adapters legacy/no-op → reconcile mantiene el comportamiento previo (presencia = match).
 */

/**
 * @typedef {Object} AgentSurface
 * Shape host-agnóstico de una sesión-agente ad-hoc descubierta vía el método OPCIONAL
 * typeof-detected `listAgentSurfaces()` (DETECT-01, FUERA de HOST_METHODS — congelado en 4).
 * camelCase consciente (D-02): alineado EXACTAMENTE con la firma de entrada de adoptSession
 * ({ workspaceRef, cwd, sessionId, ... }, src/adopt.js) para encajar SIN transformación.
 * Divergencia deliberada del WorkspaceInfo snake_case (aquel es observación de lifecycle;
 * éste es input de adopción).
 * @property {string} workspaceRef - Ref del workspace del surface (host-specific, ← workspace_ref).
 *   NO usar como identidad estable: cmux recicla `workspace:N` (defensa Phase 43); el dedup
 *   downstream (Phase 56, D-06) se keyea por sessionId/cwd.
 * @property {string} cwd - cwd de la sesión-agente (← resume_binding.cwd).
 * @property {string} sessionId - Identidad estable (← resume_binding.checkpoint_id == session_id
 *   de Claude Code, CMUX-CAPABILITIES.md §P0).
 * @property {string} kind - Tipo de agente (← resume_binding.kind; el CONSUMER filtra por kind,
 *   NO listAgentSurfaces — D-05).
 * @property {string} [title] - Título auto-derivado por cmux del workspace de la surface (←
 *   `workspace list --json`.custom_title cuando has_custom_title===true). Phase 56-06: la TUI lo
 *   pasa a `kodo adopt --title` para que la sesión adoptada herede el nombre legible del workspace
 *   en vez del fallback basename(cwd) del core. OPCIONAL/aditivo: ausente cuando el workspace no
 *   tiene custom_title (fail-open) → adopt cae al basename, comportamiento previo. NO cambia
 *   HOST_METHODS (congelado en 4) ni los 4 campos existentes del shape.
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
    // _legacy.rename no-op (Phase 59): un host non-cmux/null degrada fail-open al
    // renombrar para liveness. El CLI también protege con `typeof host?._legacy?.rename
    // === 'function'`; este no-op documenta la rama de degradación explícitamente.
    _legacy: { rename: async () => {} },
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
