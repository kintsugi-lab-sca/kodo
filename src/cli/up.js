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
