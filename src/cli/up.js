// @ts-check
//
// src/cli/up.js — Plan 66-01 (UP-01/02/03, DIST-03).
//
// Orquestador de `kodo up` + sus dos primitivas nuevas, TODO DI-testeado sin
// procesos ni brew reales. Phase 66 es ~90% COMPOSICIÓN sobre la fundación
// enviada en Phase 65 (src/daemon/lifecycle.js + src/daemon/run.js): este módulo
// NO reimplementa spawn/PID/kill — los compone detrás de seams `_dep`.
//
// Modelo LOCKED (D-01/D-02/D-06):
//   `kodo up` = ensure-daemon (detached, idempotente) → health-wait (never-throws,
//   bounded) → attach dashboard (visor HTTP puro) → return DEJANDO EL DAEMON VIVO.
//   El aislamiento del process group lo da `detached:true` en startDaemon
//   (lifecycle.js:125): cerrar el visor NO puede tumbar el daemon (UP-02). Por eso
//   runUp NO registra ningún signal handler que apunte al daemon.
//
// Invariantes del milestone: CERO dependencias npm nuevas (solo built-ins node: +
// código ya enviado), never-throws / fail-open, DI vía seams `_dep`, guard Windows.

import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Sonda de puerto-en-uso vía node:net (UP-03). NEVER-THROWS / never-hang.
 *
 * Señal SECUNDARIA de idempotencia de `kodo up` (la PID-alive de statusDaemon es
 * la primaria): protege contra colisionar con un `kodo start` legacy que ya escuche
 * el puerto (Pitfall 3). Distingue:
 *   - connect ok               → true  (ocupado)
 *   - error ECONNREFUSED       → false (libre)
 *   - cualquier otro error     → true  (conservador: algo hay)
 *   - timeout (never responde) → false (never-hang, trátalo como libre)
 *
 * Cero deps npm: ~10 líneas de net.connect eliminan detect-port/get-port
 * (Don't Hand-Roll invertido — la dep es más cara que el built-in aquí).
 *
 * @param {number} port — puerto a sondear.
 * @param {string} [host] — host destino (default 127.0.0.1).
 * @param {number} [timeoutMs] — corte never-hang (default 500).
 * @param {{ _net?: typeof import('node:net') }} [deps] — seam DI (default `net`).
 * @returns {Promise<boolean>} true=ocupado, false=libre.
 */
export function probePortInUse(port, host = '127.0.0.1', timeoutMs = 500, deps = {}) {
  const netMod = deps._net || net;
  return new Promise((resolve) => {
    let settled = false;
    /** @type {any} */
    let sock;
    /** @type {any} */
    let timer;
    // done: idempotente (un solo resolve), destruye el socket en TODAS las ramas.
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { sock?.destroy(); } catch { /* idempotente */ }
      resolve(result);
    };

    // Timer independiente del socket → garantiza never-hang aunque el peer nunca
    // emita connect ni error (rama timeout = puerto libre por convención). NO se
    // hace unref(): queremos que el reloj mantenga vivo el loop hasta resolver.
    timer = setTimeout(() => done(false), timeoutMs);

    try {
      sock = netMod.connect({ port, host });
    } catch {
      // connect síncrono lanzó → conservador: algo hay (ocupado).
      done(true);
      return;
    }
    sock.on('connect', () => done(true));
    sock.on('error', (/** @type {NodeJS.ErrnoException} */ err) => {
      // ECONNREFUSED = nadie escucha = libre; cualquier otro code = conservador true.
      done(err && err.code === 'ECONNREFUSED' ? false : true);
    });
  });
}

/**
 * Readiness gate never-throws sobre `GET {baseUrl}/health` (UP-01).
 *
 * Espeja el never-throws de `fetchStatus` (client.js:49-60): sondea en bucle hasta
 * que /health responde 200 (→ true) o se agota `timeoutMs` (→ false). Un daemon que
 * no responde a tiempo es un `false`, NO una excepción (fail-open: runUp abrirá el
 * dashboard igual con un aviso). ECONNREFUSED durante el boot se traga y reintenta.
 *
 * Bounded por deadline (`_now() >= start + timeoutMs`) → nunca cuelga aunque /health
 * falle siempre. Clock/sleep inyectables para tests sin esperas reales.
 *
 * @param {string} baseUrl — base del server kodo (p.ej. 'http://localhost:9090').
 * @param {{ timeoutMs?: number, intervalMs?: number }} [opts]
 * @param {{ _fetch?: typeof globalThis.fetch, _now?: () => number, _sleep?: (ms: number) => Promise<any> }} [deps]
 * @returns {Promise<boolean>} true=respondió 200 a tiempo, false=timeout/no-200.
 */
export async function waitForHealth(baseUrl, { timeoutMs = 10000, intervalMs = 200 } = {}, deps = {}) {
  const fetchFn = deps._fetch || globalThis.fetch;
  const now = deps._now || Date.now;
  const sleepFn = deps._sleep || sleep;

  const deadline = now() + timeoutMs;
  // do-while: SIEMPRE hace ≥1 intento antes de rendirse por deadline.
  do {
    try {
      const res = await fetchFn(`${baseUrl}/health`);
      if (res.ok) return true;
    } catch {
      // ECONNREFUSED / abort durante el boot → traga y reintenta (never-throws).
    }
    if (now() >= deadline) break;
    await sleepFn(intervalMs);
  } while (true);
  return false;
}

/**
 * Orquestador de `kodo up` (UP-01/02/03, DIST-03).
 *
 * Compone (NO reimplementa) las piezas de Phase 65 detrás de seams DI. Flujo LOCKED
 * (D-01/D-02/D-06):
 *   (1) Guard Windows PRIMERO (D-06/DIST-03): win32 → foreground (runDaemon), sin
 *       detach, sin attach separado, sin crashear. NO llama startDaemon en win32.
 *   (2) ensure-daemon (idempotencia D-02): statusDaemon (PID-alive PRIMARIO) +
 *       probePort (SECUNDARIO). Solo si NO corre Y el puerto está libre → startDaemon
 *       detached. Si ya corre o el puerto está ocupado → ATTACH directo (cero spawn,
 *       evita EADDRINUSE / Pitfall 3). startDaemon ok:false → aviso a stderr + return
 *       (never-throws, sin process.exit).
 *   (3) health-wait: waitForHealth bounded/never-throws. false → aviso + CONTINÚA
 *       (fail-open).
 *   (4) attach: runDashboard({url}) — visor HTTP puro; owns nothing.
 *   (5) return. CRÍTICO (UP-02/D-01): runUp NO registra NINGÚN process.on(SIGINT|
 *       SIGTERM) hacia el daemon. El aislamiento del process group lo da detached:true
 *       en startDaemon (lifecycle.js:125); registrar handlers aquí mataría el daemon al
 *       cerrar el dashboard y violaría el modelo persistente LOCKED.
 *
 * @param {{
 *   _platform?: string,
 *   _statusDaemon?: (name: string, deps?: any) => { status: string, pid: number | null },
 *   _startDaemon?: (name: string, argv: string[], deps?: any) => Promise<any>,
 *   _probePort?: (port: number, host?: string, timeoutMs?: number, deps?: any) => Promise<boolean>,
 *   _waitForHealth?: (baseUrl: string, opts?: any, deps?: any) => Promise<boolean>,
 *   _runDashboard?: (deps?: any) => Promise<any>,
 *   _runDaemon?: (deps?: any) => Promise<any>,
 *   _loadConfig?: () => any,
 *   _resolveBaseUrl?: (args: any) => string,
 *   _process?: { on: (sig: string, fn: (...a: any[]) => void) => any },
 *   _stderr?: { write: (s: string) => any },
 * }} [deps]
 * @returns {Promise<void | any>}
 */
export async function runUp(deps = {}) {
  const platform = deps._platform || process.platform;
  const stderr = deps._stderr || process.stderr;

  // (1) Guard Windows PRIMERO (D-06/DIST-03): foreground, sin detach ni attach.
  // Se resuelve antes de tocar config/red para no depender de nada en win32.
  if (platform === 'win32') {
    let runDaemonFn = deps._runDaemon;
    if (!runDaemonFn) runDaemonFn = (await import('../daemon/run.js')).runDaemon;
    stderr.write(
      'kodo up: Windows no soporta el daemon detached; corriendo en foreground ' +
      '(Ctrl-C para salir).\n',
    );
    return runDaemonFn();
  }

  // Resolución de seams (lazy imports en los defaults → arranque del CLI ligero,
  // no carga ink/lifecycle salvo que se ejecute realmente).
  let loadConfigFn = deps._loadConfig;
  if (!loadConfigFn) loadConfigFn = (await import('../config.js')).loadConfig;

  let resolveBaseUrlFn = deps._resolveBaseUrl;
  if (!resolveBaseUrlFn) resolveBaseUrlFn = (await import('./dashboard/index.js')).resolveBaseUrl;

  const statusDaemonFn = deps._statusDaemon
    || (await import('../daemon/lifecycle.js')).statusDaemon;
  const startDaemonFn = deps._startDaemon
    || (await import('../daemon/lifecycle.js')).startDaemon;
  const probePortFn = deps._probePort || probePortInUse;
  const waitForHealthFn = deps._waitForHealth || waitForHealth;
  const runDashboardFn = deps._runDashboard
    || (await import('./dashboard/index.js')).runDashboard;
  const needsSetupFn = deps._needsSetup || (await import('../config.js')).needsSetup;

  // (0) Config/baseUrl. port desde config.server?.port ?? 9090 (optional chaining por
  // un config v1 migrado sin `server`); baseUrl reusa el default config-driven del
  // dashboard (resolveBaseUrl → DEFAULT_CONFIG.server.port=9090).
  const cfg = loadConfigFn();
  const port = cfg?.server?.port ?? 9090;
  const baseUrl = resolveBaseUrlFn({ loadConfig: loadConfigFn });

  // (1.5) first-run pre-spawn (D-02): config incompleta → abre el dashboard en modo
  // setup SIN arrancar el daemon. Arrancarlo aquí sería contraproducente: en first-run
  // el daemon muere con teardown(1) por KODO_SETUP_REQUIRED (run.js:152-166), dejando el
  // visor enganchado a un server muerto. El helper compartido `needsSetup` (D-01) decide;
  // se evalúa ANTES del ensure-daemon. Never-throws / sin process.exit como el resto.
  if (needsSetupFn()) {
    await runDashboardFn({ url: baseUrl, setup: true });
    return;
  }

  // (2) ensure-daemon (idempotencia D-02): PID-alive PRIMARIO + probePort SECUNDARIO.
  const status = statusDaemonFn('kodo');
  const portBusy = await probePortFn(port);
  if (status.status !== 'running' && !portBusy) {
    // Daemon frío: arranca detached (['daemon','run'] → runDaemon foreground en el hijo).
    const res = await startDaemonFn('kodo', ['daemon', 'run']);
    if (res && res.ok === false) {
      // never-throws / sin process.exit: avisa y retorna.
      stderr.write(`kodo up: ${res.message ?? 'no se pudo arrancar el daemon'}\n`);
      return;
    }
  }
  // Si el daemon YA corre (status running) o el puerto está ocupado → ATTACH directo
  // (cero spawn, evita EADDRINUSE / Pitfall 3).

  // (3) health-wait: bounded/never-throws; false → fail-open (abre el dashboard igual).
  const healthy = await waitForHealthFn(baseUrl);
  if (!healthy) {
    stderr.write(
      'kodo up: el daemon no respondió a /health a tiempo; abriendo el dashboard igual.\n',
    );
  }

  // (4) attach: visor HTTP puro; owns nothing.
  await runDashboardFn({ url: baseUrl });

  // (5) return. UP-02/D-01: NO se registra ningún signal handler hacia el daemon —
  // detached:true (lifecycle.js:125) ya aísla su process group; cerrar el visor NO
  // debe tumbar el daemon (modelo persistente LOCKED).
}
