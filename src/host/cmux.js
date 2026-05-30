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
    execSync(binary, args, { encoding: 'utf-8', timeout: TIMEOUT_MS });
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
   * Known limitation (RESEARCH §P-4): cmux list-workspaces sin --window retorna
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
        run(['list-workspaces', '--json']),
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
        alive: true, // presencia en list-workspaces = tab viva
        needs_input,
        last_activity: w.latest_submitted_at ?? null,
      };
    });

    lastSnapshot.clear();
    for (const info of result) lastSnapshot.set(info.workspace_ref, info);
    logger?.info?.('host.list_workspaces.ok', {
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

  // _legacy: métodos Cmux-specific de lifecycle/management que NO son parte del
  // contrato D-03 (observation-only) pero que manager.js necesita. Prefijo `_`
  // marca scope interno: transición temporal hasta que un futuro contract los
  // absorba o queden out-of-scope con NullHost stubs. (Plan 38-01 deviation
  // permitida.) Mantiene cmux/client.js confinado a este módulo (SC#5).
  function makeLegacy() {
    // require lazy del cliente cmux — confinado a este archivo (SC#5 walker).
    // eslint-disable-next-line global-require
    return import('../cmux/client.js');
  }

  const _legacy = {
    async newWorkspace(title) {
      const cmux = await makeLegacy();
      return cmux.newWorkspace(title);
    },
    async setColor(ref, color) {
      const cmux = await makeLegacy();
      return cmux.setColor(ref, color);
    },
    async send(ref, message) {
      const cmux = await makeLegacy();
      return cmux.send(ref, message);
    },
    async notify(ref, title, body) {
      const cmux = await makeLegacy();
      return cmux.notify(ref, title, body);
    },
  };

  return { listWorkspaces, selectWorkspace, isAlive, needsInput, _legacy };
}
