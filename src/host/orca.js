// src/host/orca.js
// OrcaHost — implementación del contrato WorkspaceHost (D-03) sobre Orca (KODO-18).
//
// Hermano exacto de src/host/cmux.js: mismos 4 métodos del contrato, mismo bloque
// `_legacy` de lifecycle, mismo criterio never-throws + caché 1-tick. ÚNICO punto de
// la base de código (fuera de src/orca/) autorizado a hablar con el binario orca.
//
// NO importa src/logger.js (LOG-12): el logger se inyecta vía opts.logger.
//
// Diferencias materiales frente al host cmux — TODAS verificadas en vivo contra
// orca 1.4.184, no inferidas de la documentación:
//
//   · IDENTIDAD ESTABLE. El ref es `<repoId>::<absPath>` y Orca NO lo recicla. Toda la
//     defensa de Phase 43 contra el reciclaje de `workspace:N` es innecesaria aquí,
//     pero `title` se sigue exponiendo porque `reconcile` lo consume genéricamente.
//
//   · AISLAMIENTO PROPIO. `worktree create` materializa un checkout git en
//     `~/orca/workspaces/<repo>/<slug>`. Por eso `session/manager.js` OMITE
//     `claude --worktree` cuando el host activo es orca (ver `hostIsolatesWorktree`):
//     anidar un segundo worktree desalinearía `worktree_path` en state.json y dejaría
//     un cleanup fantasma en session-end.
//
//   · SIN ADOPCIÓN. `listAgentSurfaces` NO se implementa a propósito. cmux expone
//     `surface resume show` → `resume_binding.checkpoint_id`, que ES el session_id de
//     Claude Code y hace posible adoptar una sesión ad-hoc. Orca no publica ese id en
//     su CLI, así que no hay forma honesta de reconstruir la identidad de la sesión.
//     El método es OPCIONAL y se detecta por `typeof` en los call sites → el
//     descubrimiento de adopción degrada a `[]` sin romper nada.
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../config.js';

const TIMEOUT_MS = 20_000;

/**
 * Estados de agente que kodo interpreta como «la sesión espera al humano». Se comparan
 * ya normalizados (lowercase, `_`→`-`).
 *
 * ASSUMPTION (espejo de la R-7 del host cmux): estos literales son el vocabulario que
 * Orca publica en `worktree ps`.`agents[].state` cuando los hooks de agente están
 * activos (`orca agent hooks on`). Si Orca los renombra, este host necesita
 * actualización — el test de contrato con fixture real lo detectará.
 */
const WAITING_STATES = new Set(['waiting', 'needs-input', 'awaiting-input', 'blocked', 'idle-waiting']);

/**
 * Ejecuta un comando orca y retorna stdout. Síncrono por simetría con el host cmux
 * (mismo patrón de caché 1-tick), envuelto en async para el contrato.
 * @param {Function} execSync - execFileSync inyectable.
 * @param {string} binary
 * @returns {(args: string[]) => Promise<string>}
 */
function makeRun(execSync, binary) {
  return async (args) =>
    execSync(binary, args, {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      // stderr CAPTURADO (pipe), NUNCA heredado — misma razón que en host/cmux.js
      // (66-06): bajo brew services/launchd el binario escupe ruido a stderr cada
      // tick del reconcile loop y al heredarse se filtraría al kodo.log del daemon.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * ¿Está viva la tab del workspace? PURA.
 *
 * En cmux la mera presencia en `workspace list` implica tab viva. En Orca NO: un
 * worktree persiste en el listado aunque no tenga ningún terminal abierto (es una
 * tarjeta del tablero, no una tab). La liveness real la dan `status` y el recuento de
 * terminales vivos, así que se derivan explícitamente.
 *
 * @param {any} w - fila de `worktree ps`.`worktrees[]`.
 * @returns {boolean}
 */
export function deriveAlive(w) {
  if (w?.isArchived === true) return false;
  if (typeof w?.status === 'string') return w.status === 'active';
  return Number(w?.liveTerminalCount) > 0;
}

/**
 * ¿Espera esta sesión input del humano? PURA.
 *
 * CONSERVADOR A PROPÓSITO: solo se mira `agents[].state`. Se descartó `unread` como
 * proxy porque en Orca marca «hay salida que no has visto», no «el agente está
 * bloqueado»: usarlo pondría en `needs-input` a casi toda sesión en marcha y llenaría
 * el dashboard de falsos positivos. Sin hooks de agente (`orca agent hooks off`)
 * `agents[]` viene vacío → `false` (kodo pierde el matiz, no inventa uno).
 *
 * @param {any} w - fila de `worktree ps`.`worktrees[]`.
 * @returns {boolean}
 */
export function deriveNeedsInput(w) {
  const agents = Array.isArray(w?.agents) ? w.agents : [];
  return agents.some((a) => {
    const raw = a?.state ?? a?.status;
    if (typeof raw !== 'string') return false;
    return WAITING_STATES.has(raw.toLowerCase().replace(/_/g, '-'));
  });
}

/**
 * Normaliza el timestamp de actividad de Orca (epoch en MILISEGUNDOS) a ISO 8601,
 * que es lo que declara el typedef `WorkspaceInfo.last_activity`. PURA.
 *
 * `lastOutputAt` (última escritura del pty) es más preciso que `lastActivityAt`
 * (último toque de metadatos), así que gana cuando existe. Un valor no-numérico,
 * negativo o no finito → `null` en vez de un `Invalid Date` propagado al dashboard.
 *
 * @param {any} w
 * @returns {string|null}
 */
export function deriveLastActivity(w) {
  for (const raw of [w?.lastOutputAt, w?.lastActivityAt]) {
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) {
      const iso = new Date(ms).toISOString();
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * Normaliza la salida ya parseada de `worktree ps --json` a `WorkspaceInfo[]`. PURA y
 * defensiva (never-throws): filas falsy o sin `worktreeId` string se OMITEN — mismo
 * patrón fila-a-fila que `normalizeSurface`/`buildTitleMap` del host cmux.
 *
 * @param {any} psResult - `result` de `worktree ps --json`.
 * @returns {import('./interface.js').WorkspaceInfo[]}
 */
export function normalizeWorkspaces(psResult) {
  const worktrees = Array.isArray(psResult?.worktrees) ? psResult.worktrees : [];
  const out = [];
  for (const w of worktrees) {
    if (!w || typeof w.worktreeId !== 'string') continue;
    out.push({
      workspace_ref: w.worktreeId,
      alive: deriveAlive(w),
      needs_input: deriveNeedsInput(w),
      last_activity: deriveLastActivity(w),
      title: typeof w.displayName === 'string' ? w.displayName : undefined,
    });
  }
  return out;
}

/**
 * Factory de OrcaHost.
 * @param {Object} [opts]
 * @param {Function} [opts.run] - función async (args) => stdout (DI de tests).
 * @param {Function} [opts.execSync] - execFileSync inyectable (alternativa a run).
 * @param {string}   [opts.binary] - path al binario orca; default loadConfig().orca.binary.
 * @param {Object}   [opts.logger] - logger inyectado (opcional). NO se importa (LOG-12).
 * @returns {Object} WorkspaceHost (4 métodos) + _legacy (lifecycle Orca-specific).
 */
export function createOrcaHost(opts = {}) {
  const binary = opts.binary || loadConfig().orca?.binary || 'orca';
  const run = opts.run || makeRun(opts.execSync || execFileSync, binary);
  const logger = opts.logger;

  // Caché 1-tick, idéntica al host cmux: listWorkspaces la puebla; isAlive/needsInput
  // leen de aquí sin volver a hablar con el runtime de Orca.
  const lastSnapshot = new Map(); // ref -> WorkspaceInfo

  /**
   * Lista los workspaces normalizados a WorkspaceInfo. never-throws.
   *
   * UNA sola llamada al runtime (`worktree ps --json`), frente a las dos de cmux
   * (`workspace list` + `rpc notification.list`): Orca ya entrega liveness, actividad
   * y estado de agente en la misma vista.
   *
   * @returns {Promise<import('./interface.js').WorkspaceInfo[]>}
   */
  async function listWorkspaces() {
    const started = Date.now();
    let raw;
    try {
      raw = await run(['worktree', 'ps', '--json']);
    } catch (err) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: err?.code || 'EXEC_ERROR',
        detail: String(err?.message || '').trim(),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    let result;
    try {
      const env = JSON.parse(raw);
      // El sobre de orca lleva `ok`; un `ok:false` (runtime caído) NO es una lista vacía
      // legítima — se trata como fallo para no borrar el snapshot con datos falsos.
      if (!env || env.ok !== true) {
        logger?.warn?.('host.list_workspaces.fail', {
          code: env?.error?.code || 'NOT_OK',
          detail: String(env?.error?.message || '').slice(0, 200),
          duration_ms: Date.now() - started,
        });
        return [];
      }
      result = env.result;
    } catch (err) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: 'PARSE_ERROR',
        detail: String(err?.message || '').trim(),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    const out = normalizeWorkspaces(result);
    lastSnapshot.clear();
    for (const info of out) lastSnapshot.set(info.workspace_ref, info);
    logger?.debug?.('host.list_workspaces.ok', { count: out.length, duration_ms: Date.now() - started });
    return out;
  }

  /**
   * Trae el foco de la app Orca al workspace. never-throws: devuelve el MISMO shape
   * `{ok:true} | {ok:false, code, detail}` que `runFocus` del host cmux, para que el
   * dashboard no distinga hosts.
   *
   * Orca enfoca por TERMINAL, no por worktree, así que se resuelve antes su handle
   * (`terminal list` → `terminal switch`).
   *
   * @param {string} ref
   * @returns {Promise<{ok:true}|{ok:false,code:string,detail:string}>}
   */
  async function selectWorkspace(ref) {
    try {
      const { focusWorkspace } = await import('../orca/client.js');
      await focusWorkspace({ workspace: ref });
      return { ok: true };
    } catch (err) {
      return { ok: false, code: err?.code || 'ORCA_FOCUS_FAILED', detail: String(err?.message || '').slice(0, 200) };
    }
  }

  /** Lee del snapshot cacheado (1-tick). never-throws. @returns {Promise<boolean>} */
  async function isAlive(ref) {
    return lastSnapshot.get(ref)?.alive ?? false;
  }

  /** Lee del snapshot cacheado (1-tick). never-throws. @returns {Promise<boolean>} */
  async function needsInput(ref) {
    return lastSnapshot.get(ref)?.needs_input ?? false;
  }

  // _legacy: passthroughs FIELES a src/orca/client.js, espejo 1:1 del bloque homónimo
  // del host cmux. Firmas idénticas a las de cmux salvo donde el capability gap lo
  // impide (setColor / listWorkspaceGroups), documentado en cada método. El cliente se
  // carga lazy vía import() — confinado a este archivo.
  const _legacy = {
    /** @param {{ name: string, cwd?: string, command?: string, group?: string }} opts @returns {Promise<string>} */
    async newWorkspace(opts) {
      return (await import('../orca/client.js')).newWorkspace(opts);
    },
    /**
     * NO-OP. Orca no tiene color por workspace; el canal equivalente es la columna del
     * tablero → usa `setStatus`. Se conserva el método para que un caller que aún
     * hable en «colores» (server.js branding, orchestrator/launch.js) degrade en vez
     * de romper con "is not a function".
     * @param {{ workspace: string, color: string }} _opts
     */
    async setColor(_opts) {
      return null;
    },
    /**
     * Refleja el estado semántico de la sesión en la tarjeta de Orca (`worktree set
     * --workspace-status`). Es el equivalente REAL de `setColor` de cmux.
     * @param {{ workspace: string, status: 'running'|'done'|'error'|'review' }} opts
     */
    async setStatus(opts) {
      return (await import('../orca/client.js')).setStatus(opts);
    },
    /** @param {{ workspace: string, description: string }} opts */
    async setDescription(opts) {
      return (await import('../orca/client.js')).setDescription(opts);
    },
    /** @param {{ workspace: string, title: string }} opts */
    async rename(opts) {
      return (await import('../orca/client.js')).rename(opts);
    },
    /** @param {{ workspace: string, text: string }} opts */
    async send(opts) {
      return (await import('../orca/client.js')).send(opts);
    },
    /**
     * NO-OP (Orca no expone notificaciones de SO en su CLI). Resuelve en vacío para no
     * obligar al launch path a ramificar por host.
     * @param {{ title: string, body?: string, workspace?: string }} opts
     */
    async notify(opts) {
      return (await import('../orca/client.js')).notify(opts);
    },
    /** @param {{ workspace: string, lines?: number }} opts @returns {Promise<string>} */
    async readScreen(opts) {
      return (await import('../orca/client.js')).readScreen(opts);
    },
    /** @returns {Promise<string>} texto `<ref>  <título>` (espejo de `cmux workspace list`) */
    async listWorkspaces() {
      return (await import('../orca/client.js')).listWorkspaces();
    },
    /**
     * Vista cross-window para la revalidación de identidad del orquestador (KODO-18),
     * en el mismo shape que `cmux tree --all --json`. En Orca se SINTETIZA desde
     * `worktree ps` — ver `buildTreeFromPs`.
     * @returns {Promise<string>} JSON serializado
     */
    async listTree() {
      return (await import('../orca/client.js')).listTree();
    },
    /** @returns {Promise<string>} `'{"groups":[]}'` — Orca no tiene grupos (no-op fail-open) */
    async listWorkspaceGroups() {
      return (await import('../orca/client.js')).listWorkspaceGroups();
    },
  };

  return { listWorkspaces, selectWorkspace, isAlive, needsInput, _legacy };
}
