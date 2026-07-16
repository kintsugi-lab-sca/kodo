// src/host/cmux.js
// CmuxHost — implementación del contrato WorkspaceHost (D-08) sobre cmux.
// Reusa runFocus (Phase 37) para selectWorkspace SIN duplicar lógica, y deriva
// needs_input de `cmux rpc notification.list` (RESEARCH §Q2).
//
// ÚNICO punto de la base de código (fuera de src/cmux/) autorizado a hablar con
// el binario cmux directamente (SC#5 — walker test/host/cmux-isolation.test.js).
//
// NO importa src/logger.js (LOG-12): el logger se inyecta vía opts.logger.
import { execFile, execFileSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { runFocus } from '../cli/dashboard/focus.js';

const TIMEOUT_MS = 5000;

/**
 * Ejecuta un comando cmux y retorna stdout (string). Síncrono por simplicidad
 * (latencia ~50ms medida, RESEARCH §S5) — envuelto en async para el contrato.
 * @param {Function} execSync - execFileSync inyectable.
 * @param {string} binary
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function makeRun(execSync, binary) {
  return async (args) =>
    execSync(binary, args, {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      // stderr CAPTURADO (pipe), NUNCA heredado (66-06). Node documenta que
      // execFileSync HEREDA stderr al padre por defecto: bajo brew services/launchd
      // (headless, sin sesión GUI de cmux) el binario cmux imprime "Failed to write
      // to socket (Broken pipe, errno 32)" a SU stderr cada tick del reconcile loop,
      // y al heredarse se filtraba directo al kodo.log del daemon. Con este stdio el
      // stderr del child queda en err.stderr (que el fail-open never-throws TRAGA en
      // silencio, sin re-loguearlo) y jamás toca el stdout/stderr del daemon.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * Normaliza la salida cruda de `cmux surface resume show --json` a AgentSurface, o
 * `null` si la surface NO es una sesión-agente adoptable (filtro D-05 fila-a-fila).
 * Puro, sin I/O — testeable sin DI. Mapeo de campos D-02.
 *
 * Devuelve `null` (omitir) si:
 *   - raw ausente o `cleared` truthy (la binding fue limpiada — cualquier truthy, WR-02).
 *   - sin `resume_binding` (la surface no tiene checkpoint).
 *   - `source !== 'agent-hook'` (no la creó el hook de Claude Code; p. ej. tmux/environment).
 *   - cualquiera de los 4 campos del contrato `AgentSurface` (`workspace_ref`, `cwd`,
 *     `checkpoint_id`, `kind`) no es string (shape inesperado / tampering — T-55-01, WR-01).
 *
 * NO filtra por `kind == 'claude'` — eso lo decide el CONSUMER (Phase 56, D-05).
 *
 * @param {Object} raw - salida de `surface resume show --json` para UNA surface.
 * @returns {import('./interface.js').AgentSurface | null}
 */
function normalizeSurface(raw) {
  if (!raw || raw.cleared) return null; // D-05/WR-02: cualquier truthy = limpiada
  const b = raw.resume_binding;
  if (!b) return null; // D-05: sin resume_binding (incluye resume_binding:null)
  if (b.source !== 'agent-hook') return null; // D-05: source≠agent-hook
  // T-55-01/WR-01: los 4 campos del typedef AgentSurface deben ser strings; un
  // shape malformado (kind:null, workspace_ref ausente) NO debe fluir al consumer.
  if (
    typeof raw.workspace_ref !== 'string' ||
    typeof b.cwd !== 'string' ||
    typeof b.checkpoint_id !== 'string' ||
    typeof b.kind !== 'string'
  ) {
    return null;
  }
  return {
    workspaceRef: raw.workspace_ref, // D-02
    cwd: b.cwd, // D-02
    sessionId: b.checkpoint_id, // D-02 (== session_id de Claude Code, §P0)
    kind: b.kind, // D-02 (NO se filtra por kind aquí — D-05)
  };
}

/**
 * Extrae los `surface_ref` vivos del árbol de `cmux tree --all --json` (paso-1 de
 * la enumeración). Defensivo ante claves ausentes: devuelve `[]` si el shape no
 * encaja (never-throws — T-55-01). Dedup por ref para no consultar dos veces.
 * @param {Object} treeJson - salida parseada de `tree --all --json`.
 * @returns {string[]} refs de surface únicos.
 */
function extractSurfaceRefs(treeJson) {
  const refs = new Set();
  const windows = Array.isArray(treeJson?.windows) ? treeJson.windows : [];
  for (const win of windows) {
    const workspaces = Array.isArray(win?.workspaces) ? win.workspaces : [];
    for (const ws of workspaces) {
      const panes = Array.isArray(ws?.panes) ? ws.panes : [];
      for (const pane of panes) {
        const surfaceRefs = Array.isArray(pane?.surface_refs) ? pane.surface_refs : [];
        for (const ref of surfaceRefs) {
          if (typeof ref === 'string') refs.add(ref);
        }
        // Fallback: algunos shapes traen panes[].surfaces[].ref en vez de surface_refs.
        const surfaces = Array.isArray(pane?.surfaces) ? pane.surfaces : [];
        for (const s of surfaces) {
          if (typeof s?.ref === 'string') refs.add(s.ref);
        }
      }
    }
  }
  return [...refs];
}

/**
 * Construye un mapa `workspace_ref → custom_title` a partir de la salida cruda de
 * `cmux workspace list --json` (Phase 56-06). Solo entra una entrada cuando cmux
 * marca el título como custom (`has_custom_title === true`) Y `custom_title` es un
 * string NO vacío — un workspace SIN título custom NO debe heredar el fallback
 * basename(cwd) del core a través de un título vacío/auto.
 *
 * Puro y defensivo (never-throws): un shape inesperado (workspaces ausente, ref
 * no-string) simplemente no aporta entradas. El caller (listAgentSurfaces) lo
 * envuelve además en try/catch para FAIL-OPEN total (sin título si la fetch falla).
 *
 * @param {Object} listJson - salida parseada de `workspace list --json`.
 * @returns {Map<string, string>} ref → custom_title (solo títulos custom no vacíos).
 */
function buildTitleMap(listJson) {
  const map = new Map();
  const workspaces = Array.isArray(listJson?.workspaces) ? listJson.workspaces : [];
  for (const ws of workspaces) {
    const ref = ws?.ref;
    const customTitle = ws?.custom_title;
    if (
      typeof ref === 'string' &&
      ws?.has_custom_title === true &&
      typeof customTitle === 'string' &&
      customTitle.length > 0
    ) {
      map.set(ref, customTitle);
    }
  }
  return map;
}

/**
 * Factory de CmuxHost.
 * @param {Object} [opts]
 * @param {Function} [opts.exec] - execFile inyectable (callback style) para selectWorkspace.
 * @param {Function} [opts.run] - función async (args) => stdout para list/notification (test DI).
 * @param {Function} [opts.execSync] - execFileSync inyectable (alternativa a run).
 * @param {string}   [opts.binary] - path al binario cmux; default loadConfig().cmux.binary.
 * @param {Object}   [opts.logger] - logger inyectado (opcional). NO se importa (LOG-12).
 * @returns {Object} WorkspaceHost (4 métodos) + _legacy (lifecycle Cmux-specific).
 */
export function createCmuxHost(opts = {}) {
  const binary = opts.binary || loadConfig().cmux?.binary || 'cmux';
  const exec = opts.exec || execFile;
  const run = opts.run || makeRun(opts.execSync || execFileSync, binary);
  const logger = opts.logger;

  // Caché 1-tick: listWorkspaces puebla lastSnapshot; isAlive/needsInput leen de
  // aquí sin nueva I/O al socket cmux (D-08).
  const lastSnapshot = new Map(); // ref -> WorkspaceInfo

  /**
   * Lista los workspaces normalizados a WorkspaceInfo. never-throws.
   *
   * needs_input se deriva de notification.list con subtitle === 'Waiting' y
   * is_read === false (RESEARCH §Q2). ASSUMPTION R-7: si cmux cambia este literal
   * en versiones futuras, este host requiere actualización — el test contract con
   * fixture JSON real lo detectará.
   *
   * Known limitation (RESEARCH §P-4): cmux workspace list sin --window retorna
   * solo los workspaces del window activo del caller. Multi-window no soportado.
   *
   * @returns {Promise<import('./interface.js').WorkspaceInfo[]>}
   */
  async function listWorkspaces() {
    const started = Date.now();
    let wsRaw;
    let notifRaw;
    try {
      [wsRaw, notifRaw] = await Promise.all([
        run(['workspace', 'list', '--json']),
        run(['rpc', 'notification.list']),
      ]);
    } catch (err) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: err?.code || 'EXEC_ERROR',
        detail: String(err?.message || '').trim(),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    let workspaces;
    let notifications;
    try {
      workspaces = JSON.parse(wsRaw).workspaces || [];
      notifications = JSON.parse(notifRaw).notifications || [];
    } catch (err) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: 'PARSE_ERROR',
        detail: String(err?.message || '').trim(),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    const result = workspaces.map((w) => {
      const ref = w.ref;
      const needs_input = notifications.some(
        (n) => n.workspace_ref === ref && !n.is_read && n.subtitle === 'Waiting',
      );
      return {
        workspace_ref: ref,
        alive: true, // presencia en workspace list = tab viva
        needs_input,
        last_activity: w.latest_submitted_at ?? null,
        // Identidad del workspace (kodo fija el título con el task_ref). reconcile la usa para
        // detectar refs reciclados: cmux reusa `workspace:N` al cerrar/crear tabs, así que la
        // presencia del ref NO garantiza que siga siendo el workspace de la misma sesión.
        title: typeof w.title === 'string' ? w.title : undefined,
      };
    });

    lastSnapshot.clear();
    for (const info of result) lastSnapshot.set(info.workspace_ref, info);
    // LOG-hygiene: éxito rutinario por-llamada → debug (mismo criterio que el loop de
    // reconcile). El fallo (host.list_workspaces.fail) sigue en warn.
    logger?.debug?.('host.list_workspaces.ok', {
      count: result.length,
      duration_ms: Date.now() - started,
    });
    return result;
  }

  /**
   * Focus (attach) a un workspace. Delega DIRECTO a runFocus (Phase 37) — el
   * shape {ok, code?, detail?} se re-exporta sin transformar (never-throws).
   * @param {string} ref
   * @returns {Promise<{ok:true}|{ok:false,code:string,detail:string}>}
   */
  async function selectWorkspace(ref) {
    return runFocus({ exec, ref, binary });
  }

  /** Lee del snapshot cacheado (1-tick). never-throws. @returns {Promise<boolean>} */
  async function isAlive(ref) {
    return lastSnapshot.get(ref)?.alive ?? false;
  }

  /** Lee del snapshot cacheado (1-tick). never-throws. @returns {Promise<boolean>} */
  async function needsInput(ref) {
    return lastSnapshot.get(ref)?.needs_input ?? false;
  }

  /**
   * Descubre las sesiones-agente ad-hoc de cmux y las devuelve como datos
   * host-agnósticos AgentSurface[]. DETECT-01.
   *
   * OPTIONAL (NOT in HOST_METHODS — FROZEN at 4). Detected at the call site via
   * `typeof host.listAgentSurfaces === 'function'` (espejo 1:1 de getTaskState/
   * createTask). El consumer (Phase 56) hace el set-difference contra state.json,
   * keyeado por sessionId/cwd (D-06). adopt.js/reconcile.js NO llaman esto.
   *
   * Enumeración de DOS pasos (no existe `surface resume list` en cmux 0.64.16):
   *   1. `tree --all --json --id-format both` → refs de surfaces vivas.
   *   2. fan-out `surface resume show --json --surface <ref>` por cada ref.
   *
   * never-throws (D-05). Fallo del paso-1 (tree exec/parse) → `[]`. Un `resume
   * show` individual que falla (not_found / parse) → se OMITE esa surface
   * (try/catch DENTRO del bucle, fila-a-fila — Pitfall 3), el resto del array
   * sobrevive. cleared/sin binding/source≠agent-hook → omitidos vía normalizeSurface.
   *
   * @returns {Promise<import('./interface.js').AgentSurface[]>}
   */
  async function listAgentSurfaces() {
    const started = Date.now();
    let treeRaw;
    try {
      treeRaw = await run(['tree', '--all', '--json', '--id-format', 'both']);
    } catch (err) {
      logger?.warn?.('host.list_agent_surfaces.fail', {
        code: err?.code || 'EXEC_ERROR',
        detail: String(err?.message || '').trim(),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    let surfaceRefs;
    try {
      surfaceRefs = extractSurfaceRefs(JSON.parse(treeRaw));
    } catch (err) {
      logger?.warn?.('host.list_agent_surfaces.fail', {
        code: 'PARSE_ERROR',
        detail: String(err?.message || '').trim(),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    const out = [];
    for (const ref of surfaceRefs) {
      let raw;
      try {
        // try/catch DENTRO del bucle: un fallo individual omite la surface, no
        // rompe el array (D-05 fila-a-fila, Pitfall 3). NUNCA `return` aquí.
        raw = JSON.parse(await run(['surface', 'resume', 'show', '--json', '--surface', ref]));
      } catch {
        continue; // not_found / exec error / parse → omitir esta surface
      }
      const surface = normalizeSurface(raw); // null si cleared/sin binding/source≠agent-hook
      if (surface) out.push(surface);
    }

    // Phase 56-06: enriquece cada AgentSurface con el título auto-derivado de cmux
    // (`workspace list --json`.custom_title) joineando por workspaceRef. FAIL-OPEN
    // ESTRICTO: si la fetch o el parse del workspace-list falla, las surfaces se
    // devuelven SIN título (el contrato never-throws de discovery NO se rompe — el
    // título es una nicety; adopt cae al basename(cwd) del core). El join vive dentro
    // del MISMO snapshot de enumeración (el reciclaje de workspace_ref es un concern
    // cross-time, no dentro de una sola llamada). Reusa el `run` DI / el mismo comando
    // que listWorkspaces. Mantiene la extracción cmux-specific confinada a este módulo.
    if (out.length > 0) {
      try {
        const titleMap = buildTitleMap(JSON.parse(await run(['workspace', 'list', '--json'])));
        for (const surface of out) {
          const title = titleMap.get(surface.workspaceRef);
          if (title) surface.title = title;
        }
      } catch (err) {
        logger?.warn?.('host.list_agent_surfaces.title_fetch_fail', {
          code: err?.code || 'EXEC_OR_PARSE_ERROR',
          detail: String(err?.message || '').trim(),
        });
        // fail-open: surfaces sin título.
      }
    }

    logger?.info?.('host.list_agent_surfaces.ok', {
      count: out.length,
      duration_ms: Date.now() - started,
    });
    return out;
  }

  // _legacy: métodos Cmux-specific de lifecycle/management que NO son parte del
  // contrato D-03 (observation-only) pero que manager.js/health.js necesitan.
  // Prefijo `_` marca scope interno: transición temporal hasta que un futuro
  // contract los absorba o queden out-of-scope con NullHost stubs (Plan 38-01
  // deviation permitida, CONTEXT.md D-09). Mantiene cmux/client.js confinado a
  // este módulo (SC#5 walker).
  //
  // Cada método es un passthrough FIEL de la firma de src/cmux/client.js: re-
  // exporta opts/return sin transformar para preservar el comportamiento exacto
  // de los callers (la migración semántica al contrato D-03 la hacen 38-02/03/04).
  // El cliente se carga lazy vía import() — confinado a este archivo (SC#5).
  const _legacy = {
    /** @param {{ name: string, cwd?: string, command?: string }} opts @returns {Promise<string>} */
    async newWorkspace(opts) {
      return (await import('../cmux/client.js')).newWorkspace(opts);
    },
    /** @param {{ workspace: string, color: string }} opts */
    async setColor(opts) {
      return (await import('../cmux/client.js')).setColor(opts);
    },
    /** @param {{ workspace: string, title: string }} opts */
    async rename(opts) {
      return (await import('../cmux/client.js')).rename(opts);
    },
    /** @param {{ workspace: string, text: string }} opts */
    async send(opts) {
      return (await import('../cmux/client.js')).send(opts);
    },
    /** @param {{ title: string, body?: string, workspace?: string }} opts */
    async notify(opts) {
      return (await import('../cmux/client.js')).notify(opts);
    },
    /** @param {{ workspace: string, lines?: number }} opts @returns {Promise<string>} */
    async readScreen(opts) {
      return (await import('../cmux/client.js')).readScreen(opts);
    },
    /** @returns {Promise<string>} raw stdout de `cmux workspace list` (texto, sin --json) */
    async listWorkspaces() {
      return (await import('../cmux/client.js')).listWorkspaces();
    },
    /** @returns {Promise<string>} JSON crudo de `cmux workspace-group list --json` (D-06) */
    async listWorkspaceGroups() {
      return (await import('../cmux/client.js')).listWorkspaceGroups();
    },
  };

  return { listWorkspaces, selectWorkspace, isAlive, needsInput, listAgentSurfaces, _legacy };
}
