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
import { writePidFile, removePidFile, readPidFile } from '../cli/polling-daemon.js';
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
 *   _readPidFile?: (name?: string) => any,
 *   _createLogger?: (opts: any) => any,
 *   _process?: { on: (sig: string, fn: (...a: any[]) => void) => void, exit: (code?: number) => void },
 *   _stdout?: { on: (ev: string, fn: (...a: any[]) => void) => any },
 *   _stderr?: { on: (ev: string, fn: (...a: any[]) => void) => any },
 *   _block?: () => Promise<any>,
 *   _log?: (msg: string) => void,
 * }} RunDaemonDeps
 */

/**
 * Instala un guard 'error' EPIPE-safe en un stream (stdout/stderr), idempotente.
 *
 * Gap-closure Phase 66: bajo launchd / `brew services`, stdout/stderr están conectados
 * a un PIPE; cuando el pipe se rompe Node EMITE un 'error' en el stream. Sin handler,
 * ese error es unhandled → crash/loop. Aquí lo TRAGAMOS en silencio (nunca reescribir
 * en el fallo, eso recursa). Idempotente vía tag para no acumular listeners cuando
 * runDaemon corre muchas veces en el mismo proceso (p. ej. la suite de tests con el
 * process real) y evitar el MaxListenersExceededWarning.
 *
 * @param {{ on: (ev: string, fn: (...a: any[]) => void) => any } & Record<string, any>} stream
 */
function installStreamEpipeGuard(stream) {
  if (!stream || stream.__kodo_epipe_guard) return;
  try { stream.__kodo_epipe_guard = true; } catch { /* stream inmutable: seguimos igual */ }
  // Swallow silencioso: NO loguear ni reescribir — el pipe roto es la causa del flood.
  stream.on('error', () => { /* EPIPE u otro write error: tragado a propósito */ });
}

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
  const readPidFileFn = deps._readPidFile || readPidFile;
  const proc = deps._process || process;
  const stdout = deps._stdout || process.stdout;
  const stderr = deps._stderr || process.stderr;
  const blockFn = deps._block || (() => new Promise(() => {}));
  const log = deps._log || ((msg) => process.stderr.write(msg + '\n'));

  // PID de ESTE proceso — es el mismo valor que se escribe en el payload abajo
  // (`proc.pid ?? process.pid`). El teardown solo borra ~/.kodo/kodo.pid si el
  // payload en disco tiene ESTE pid (D-09 ownership): un proceso NO dueño del PID
  // file (p.ej. un arranque nuevo pisando a un daemon vivo distinto) NO lo toca.
  const selfPid = proc.pid ?? process.pid;

  // PRIMERO de todo (antes de componer server/polling): guards EPIPE en stdout/stderr.
  // Bajo launchd / `brew services` el pipe puede romperse y emitir 'error'; sin handler
  // Node lo trata como unhandled y el patch de console reescribe en el pipe roto → flood
  // infinito ("Broken pipe, errno 32"). Scoped al entrypoint del daemon (run.js), NO al
  // module load global, para no tocar la semántica del legacy `kodo start` (UP-06).
  installStreamEpipeGuard(stdout);
  installStreamEpipeGuard(stderr);

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
    // D-09 ownership: borra kodo.pid SOLO si el payload en disco es NUESTRO
    // (payload.pid === selfPid). Así un proceso que no es el dueño del PID file
    // (audit A5: un arranque nuevo pisando a un daemon vivo distinto) nunca borra
    // el PID de otro daemon. En el daemon normal el payload.pid ES selfPid (lo
    // escribió él mismo), así que el happy-path no cambia. never-throws.
    try {
      const payload = readPidFileFn('kodo');
      if (payload && payload.pid === selfPid) removePidFileFn('kodo');
    } catch { /* idempotente */ }
    proc.exit(code);
  };
  const cleanup = () => teardown(0);

  // Handlers PRIMERO (antes de cualquier await) — D-05 single-owner, early-signal safe.
  proc.on('SIGTERM', cleanup);
  proc.on('SIGINT', cleanup);

  const config = loadConfigFn();

  // PID = liveness del PROCESO, no "server ready" (gap-closure 66-07). Se escribe
  // AQUÍ — antes del `await startServer` — porque el daemon YA está vivo en cuanto
  // arranca este proceso; server-ready es otra cosa (lo cubre `waitForHealth` de
  // `kodo up` contra /health). Escribirlo después del await metía la latencia de red
  // de provider.init dentro del bounded-wait de startDaemon (lifecycle.js, ~2000ms):
  // en cold-spawn el kodo.pid no llegaba a tiempo y `kodo up` reportaba "failed to
  // write PID file within 2000ms" aunque el daemon SÍ arrancaba. Con el pid temprano
  // el pid-wait resuelve en <100ms sea cual sea la latencia de provider.init.
  // UN solo PID file para el UN proceso compuesto (Plan 01 signature: payload primero,
  // name trailing). kind:'daemon' distingue de los payloads polling con repos.
  //
  // D-10 REVISED (Phase 70 / Pitfall 3) — NO MOVER A POST-BIND: la escritura pre-bind
  // es DELIBERADA (gap-closure 66-07). Moverla post-bind REGRESARÍA ese fix ya lanzado
  // (cold-spawn `kodo up` PID-wait timeout). El invariante "no dejar un kodo.pid
  // MINTIENDO si el bind falla" (audit A5) NO lo garantiza el orden de la escritura,
  // sino el `teardown(1)` del fail-path de abajo: si `startServer` lanza, teardown
  // borra el PID (ownership D-09) → un boot fallido nunca deja un kodo.pid stale. El
  // endurecimiento real de A5 vive en la guarda de ownership del teardown (D-09) y en
  // la verificación de started_at antes del SIGKILL (D-11, lifecycle.js), NO en post-bind.
  writePidFileFn(
    { pid: proc.pid ?? process.pid, started_at: new Date().toISOString(), kind: 'daemon' },
    'kodo',
  );

  // Compose managed start. Pitfall 4: un throw (misconfig / provider.init) es una
  // superficie limpia logueada + teardown, NO un uncaught crash. run.js es el único
  // dueño del exit también en el fail path (teardown(1)). Como el pid ya está escrito,
  // teardown() lo borra (removePidFile) → un boot fallido NUNCA deja un kodo.pid stale
  // apuntando a un proceso que sale (gap-closure 66-07).
  try {
    ({ server, stopReconcile } = await startServerFn({ managed: true }));
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException & { message?: string }} */ (e);
    if (err && err.code === 'KODO_SETUP_REQUIRED') {
      // No-config: mensaje DISTINTO y accionable (no lo conflacionamos con un error
      // de boot real). El setup-mode real se difiere a Phase 68.
      log('[kodo] daemon: falta configuración — corre `kodo config` para configurar el proveedor.');
    } else {
      const msg = err && err.message ? err.message : String(e);
      log(`[kodo] daemon start failed: ${msg}`);
    }
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

  // (El kodo.pid ya se escribió arriba, antes del await de startServer — gap-closure
  // 66-07. Aquí el server/polling ya están compuestos y listos.)

  // Bloquea para siempre — el proceso ES el daemon (foreground supervisable, UP-04:
  // sin spawn/unref; server + timer viven aquí). El teardown drena vía las señales.
  await blockFn();
  return { ok: true };
}
