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
// KODO-18: `config-validate.js` es PURO (0 imports, 0 side-effects) — importarlo
// estáticamente NO rompe el invariante de este módulo ni crea ciclo con config.js.
import { HOST_NAMES } from '../config-validate.js';

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
    // `setStatus` (KODO-18) sigue el mismo criterio: es el verbo host-agnóstico que
    // `session/manager.js` usa para reflejar el estado de la sesión (color en cmux,
    // columna del tablero en orca).
    _legacy: { rename: async () => {}, setStatus: async () => {} },
  };
}

/**
 * Los hosts de RUNTIME elegibles desde `~/.kodo/config.json` → `host` (KODO-18).
 * `'null'` NO entra: es mock-only para el contract test, nunca una elección del operador.
 *
 * Se RE-EXPORTA desde `src/config-validate.js` en vez de duplicarse: allí vive el
 * validador `hostName` que `loadConfig` aplica al arrancar, y ese módulo es puro (0
 * imports) — importarlo aquí no rompe el invariante «cero side-effects al cargar» de
 * este archivo ni crea ciclo (config-validate NO importa a nadie).
 * @type {readonly string[]}
 */
export { HOST_NAMES };

/**
 * Hosts que YA materializan un checkout git aislado por sesión (KODO-18).
 *
 * cmux abre una tab sobre el `cwd` que le pases y el aislamiento lo pone kodo con
 * `claude --worktree <sessionId>` (→ `.bg-shell/<sessionId>`). Orca, en cambio, crea
 * su propio worktree en `~/orca/workspaces/<repo>/<slug>` al crear el workspace: pedir
 * ADEMÁS `claude --worktree` anidaría un segundo worktree y, peor, dejaría el
 * `worktree_path` de `state.json` apuntando a un path que nadie ha creado (cleanup
 * fantasma en session-end).
 *
 * KODO-31: `bb` entra por la misma puerta — `thread spawn --new-environment worktree`
 * materializa el checkout antes de que el agente arranque.
 *
 * `session/manager.js` consulta este set para decidir si emite el flag.
 * @type {ReadonlySet<string>}
 */
export const HOSTS_WITH_OWN_WORKTREE = Object.freeze(new Set(['orca', 'bb']));

/**
 * ¿El host activo aporta ya su propio aislamiento por worktree? PURA.
 * @param {string} name
 * @returns {boolean}
 */
export function hostIsolatesWorktree(name) {
  return HOSTS_WITH_OWN_WORKTREE.has(name);
}

/**
 * Hosts que ENTREGAN el prompt al crear el workspace, en vez de recibirlo después por el
 * carril de keystrokes (KODO-31).
 *
 * cmux y orca abren un TERMINAL: kodo crea la tab y luego teclea `claude --model … "$(cat
 * <promptfile>)"` con `_legacy.send`. BB no es un terminal — arranca Claude Code por el
 * Agent SDK— y su `thread spawn` exige `--prompt` como opción OBLIGATORIA, así que el
 * prompt tiene que estar listo ANTES de crear el workspace y no hay nada que teclear
 * después.
 *
 * `session/manager.js` consulta este set para dos cosas: pasar `prompt`/`model`/
 * `permissionMode` en las opciones de `newWorkspace`, y OMITIR el `send` posterior — que
 * en BB entregaría el texto literal `claude --model …` como si fuera un mensaje del
 * humano.
 *
 * Set SEPARADO de `HOSTS_WITH_OWN_WORKTREE` aunque hoy `bb` esté en los dos: son dos
 * capacidades independientes (orca aísla por worktree y SÍ usa keystrokes), y fusionarlas
 * ataría dos decisiones que no tienen por qué ir juntas en el siguiente host.
 * @type {ReadonlySet<string>}
 */
export const HOSTS_DELIVERING_PROMPT = Object.freeze(new Set(['bb']));

/**
 * ¿El host entrega el prompt al crear el workspace (en vez de tecleárselo después)? PURA.
 * @param {string} name
 * @returns {boolean}
 */
export function hostDeliversPrompt(name) {
  return HOSTS_DELIVERING_PROMPT.has(name);
}

/**
 * Resuelve el nombre del host ACTIVO desde `~/.kodo/config.json` → `host` (KODO-18).
 *
 * Punto único de lectura: los call sites (`server.js`, `session/manager.js`,
 * `session/health.js`, `cli/adopt.js`, `cli/dashboard/index.js`) pasaron de
 * `getHost('cmux')` literal a `getHost(resolveHostName())`.
 *
 * FAIL-SAFE a `'cmux'`: un config ausente, ilegible o con un `host` desconocido cae al
 * comportamiento previo a KODO-18 en vez de romper el arranque del daemon. `loadConfig`
 * ya valida y hace fallback del campo (config-validate `hostName`), así que esta guarda
 * es la segunda capa, no la única.
 *
 * `loadConfig` se importa LAZY (createRequire) para preservar el invariante de este
 * módulo: cero side-effects al cargar.
 *
 * @returns {string} `'cmux'` | `'orca'` | `'bb'`
 */
export function resolveHostName() {
  try {
    const { loadConfig } = require('../config.js');
    const name = loadConfig()?.host;
    return HOST_NAMES.includes(name) ? name : 'cmux';
  } catch {
    return 'cmux';
  }
}

/**
 * Factory de WorkspaceHost.
 * @param {string} name - 'cmux' | 'orca' | 'bb' | 'null'.
 * @param {Object} [opts] - DI opcional (exec, run, binary, logger). Usado por tests
 *   y por el wiring del dashboard. Para 'cmux', si se omite binary se resuelve
 *   desde loadConfig().cmux.binary (lo hace createCmuxHost); para 'orca', desde
 *   loadConfig().orca.binary (createOrcaHost).
 * @returns {Object} host con los 4 métodos de HOST_METHODS.
 * @throws {Error} si name no es reconocido.
 */
export function getHost(name, opts = {}) {
  if (name === 'null') return createNullHost();
  if (name === 'cmux') {
    const { createCmuxHost } = require('./cmux.js');
    return createCmuxHost(opts);
  }
  if (name === 'orca') {
    const { createOrcaHost } = require('./orca.js');
    return createOrcaHost(opts);
  }
  if (name === 'bb') {
    const { createBbHost } = require('./bb.js');
    return createBbHost(opts);
  }
  throw new Error(`Unknown host: ${name}`);
}
