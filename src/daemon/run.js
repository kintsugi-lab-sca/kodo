// @ts-check
//
// src/daemon/run.js — Plan 65-03 Task 2 (D-01 / D-05 / D-06).
//
// `runDaemon()` es el ÚNICO funnel foreground del daemon kodo: compone
// `startServer({managed:true})` + un `startPolling` CONDICIONAL en UN solo proceso
// con UN solo PID file (~/.kodo/kodo.pid), y bloquea para siempre. Es el proceso que
// tanto `kodo up` (detached, Phase 66) como launchd / `brew services` (directo,
// Phase 66) invocarán — hacer bien el single-owner teardown y el polling condicional
// AQUÍ es lo que evita que `brew services` haga doble fork o entre en crash-loop.
//
// Invariantes clave:
//   - D-01: startPolling es un timer IN-PROCESS (NO un child process); el daemon es
//     UN proceso que sirve webhooks (server) y opcionalmente hace polling (timer).
//   - D-05: run.js es el ÚNICO dueño de SIGTERM/SIGINT y el ÚNICO que llama a
//     process.exit — bajo managed, server.js NO instala handlers (Plan 02 gate 4),
//     así que no hay doble teardown / carrera. Los handlers se registran PRIMERO
//     (antes de cualquier await) sobre vars mutables externas, así una señal temprana
//     es segura.
//   - D-06: polling arranca SOLO cuando providerUsesPolling(config) — github (pull);
//     plane usa webhook ingress (push), el server ya lo cubre.
//
// Pitfall 4: un throw de startServer bajo managed (misconfig KODO_SETUP_REQUIRED /
// provider.init) debe ser una SUPERFICIE LIMPIA logueada + teardown, NO un uncaught
// crash. El setup-mode real se difiere a Phase 68.
//
// never-throws / fail-open + DI: TODO efecto (config/server/polling/pid/proceso/log/
// block) es inyectable vía `deps` para que el test conduzca compose + teardown en
// proceso con fakes, sin abrir puertos, spawnear ni bloquear de verdad.

import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { startServer } from '../server.js';
import { writePidFile, removePidFile } from '../cli/polling-daemon.js';
import { providerUsesPolling } from './provider-uses-polling.js';

/**
 * @typedef {{
 *   _loadConfig?: () => any,
 *   _startServer?: (opts: any) => Promise<{ server: any, stopReconcile: () => void }> | { server: any, stopReconcile: () => void },
 *   _startPolling?: (opts: any) => { stop: () => void },
 *   _providerUsesPolling?: (config: any) => boolean,
 *   _provider?: any,
 *   _writePidFile?: (payload: any, name?: string) => void,
 *   _removePidFile?: (name?: string) => void,
 *   _createLogger?: (opts: any) => any,
 *   _process?: { on: (sig: string, fn: (...a: any[]) => void) => void, exit: (code?: number) => void },
 *   _block?: () => Promise<any>,
 *   _log?: (msg: string) => void,
 * }} RunDaemonDeps
 */

/**
 * Arranca el daemon kodo compuesto (server + polling condicional) en foreground y
 * bloquea. Único dueño del teardown y del exit (D-05).
 *
 * @param {RunDaemonDeps} [deps]
 * @returns {Promise<{ ok: boolean } | void>}
 */
export async function runDaemon(deps = {}) {
  const loadConfigFn = deps._loadConfig || loadConfig;
  const startServerFn = deps._startServer || startServer;
  const providerUsesPollingFn = deps._providerUsesPolling || providerUsesPolling;
  const writePidFileFn = deps._writePidFile || writePidFile;
  const removePidFileFn = deps._removePidFile || removePidFile;
  const proc = deps._process || process;
  const blockFn = deps._block || (() => new Promise(() => {}));
  const log = deps._log || ((msg) => process.stderr.write(msg + '\n'));

  // Vars mutables EXTERNAS: los handlers de señal se registran antes del await sobre
  // startServer, así que capturan estas refs y ven el server/polling en cuanto se
  // asignen (una señal temprana no pierde el teardown).
  /** @type {any} */
  let server = null;
  /** @type {(() => void) | null} */
  let stopReconcile = null;
  /** @type {{ stop: () => void } | null} */
  let polling = null;
  let tornDown = false;

  // Teardown único (D-05): idempotente vía `tornDown` para que una segunda señal
  // (SIGINT tras SIGTERM) NO dispare doble stop/close/exit. Cada paso defensivo.
  /** @param {number} code */
  const teardown = (code) => {
    if (tornDown) return;
    tornDown = true;
    try { polling?.stop(); } catch { /* idempotente */ }
    try { stopReconcile?.(); } catch { /* idempotente */ }
    try { server?.close(); } catch { /* idempotente */ }
    try { removePidFileFn('kodo'); } catch { /* idempotente */ }
    proc.exit(code);
  };
  const cleanup = () => teardown(0);

  // Handlers PRIMERO (antes de cualquier await) — D-05 single-owner, early-signal safe.
  proc.on('SIGTERM', cleanup);
  proc.on('SIGINT', cleanup);

  const config = loadConfigFn();

  // Compose managed start. Pitfall 4: un throw (misconfig / provider.init) es una
  // superficie limpia logueada + teardown, NO un uncaught crash. run.js es el único
  // dueño del exit también en el fail path (teardown(1)).
  try {
    ({ server, stopReconcile } = await startServerFn({ managed: true }));
  } catch (e) {
    const msg = e && /** @type {Error} */ (e).message ? /** @type {Error} */ (e).message : String(e);
    log(`[kodo] daemon start failed: ${msg}`);
    teardown(1);
    return { ok: false };
  }

  // Polling CONDICIONAL (D-06): solo cuando el provider es pull-based (github).
  // startPolling es un timer IN-PROCESS (D-01) — NO spawnea un child.
  if (providerUsesPollingFn(config)) {
    let startPollingFn = deps._startPolling;
    if (!startPollingFn) {
      // Lazy import (mirror polling.js:352-353): el parent no paga el coste de
      // Phase 25 si el provider no hace polling.
      const mod = await import('../triggers/polling.js');
      startPollingFn = mod.startPolling;
    }
    let provider = deps._provider;
    if (!provider) {
      const { initRegistry, getProvider } = await import('../providers/registry.js');
      await initRegistry();
      provider = getProvider(config.provider);
    }
    const logger = (deps._createLogger || createLogger)({ sessionId: 'daemon', minLevel: 'info' });
    polling = startPollingFn({
      provider,
      repos: config?.providers?.github?.repos || [],
      intervalSec: config?.providers?.github?.poll_interval || 60,
      logger,
    });
  }

  // UN solo PID file para el UN proceso compuesto (Plan 01 signature: payload primero,
  // name trailing). kind:'daemon' distingue de los payloads polling con repos.
  writePidFileFn(
    { pid: proc.pid ?? process.pid, started_at: new Date().toISOString(), kind: 'daemon' },
    'kodo',
  );

  // Bloquea para siempre — el proceso ES el daemon (foreground supervisable, UP-04:
  // sin spawn/unref; server + timer viven aquí). El teardown drena vía las señales.
  await blockFn();
  return { ok: true };
}
