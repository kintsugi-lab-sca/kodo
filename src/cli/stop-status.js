// @ts-check
//
// src/cli/stop-status.js — Plan 66-02 (UP-05, D-04).
//
// Handlers testeables de `kodo stop` y `kodo status` extraídos a un módulo propio
// para que el wiring en cli.js (Plan 66-03) sea glue trivial. cli.js ejecuta
// `program.parse()` al import y NO es unit-testable; estas funciones sí — todas sus
// dependencias de daemon/FS/stdout van detrás de seams `_dep` inyectables (DI).
//
// Modelo DAEMON-FIRST (D-04 LOCKED): Phase 66 unifica stop/status sobre la fundación
// de Phase 65 (src/daemon/lifecycle.js) SIN reimplementar spawn/PID/kill. `kodo stop`
// tumba el daemon 'kodo'; `kodo status` reporta el estado del daemon 'kodo'.
//
// CAMBIO DE COMPORTAMIENTO DOCUMENTADO (D-04 LOCKED): `kodo status` ahora reporta el
// estado del DAEMON (running/idle), NO la vista legacy `listSessions`. El detalle de
// sesiones vive en el dashboard + `GET /status`; el CLI status es un booleano de vida
// del servicio, scriptable via `--json`.
//
// Invariantes del milestone: CERO dependencias npm nuevas (solo built-ins node: +
// código ya enviado), never-throws / fail-open, guard implícito (el legacy `kodo
// start`/`polling` NO se toca — este módulo no importa cli.js ni server.js salvo el
// FALLBACK lazy documentado en runStopUnified).

import { stopDaemon, statusDaemon } from '../daemon/lifecycle.js';
import { createFormatter } from './format.js';

/**
 * Handler unificado de `kodo stop` — DAEMON-FIRST con fallback legacy (UP-05, D-04).
 *
 * Flujo:
 *   1. `stopDaemon('kodo')` (lifecycle.js:163): SIGTERM → 5s isPidAlive loop → SIGKILL
 *      → removePidFile. Resultado discriminado:
 *        - `{stopped:true}` → el daemon quedó tumbado. Mensaje coloreado + return 0.
 *        - `{stale:true}`   → PID file huérfano limpiado (proceso ya muerto). return 0.
 *        - `{notRunning:true}` → NO hay daemon 'kodo' → cae al FALLBACK legacy.
 *   2. FALLBACK legacy (ÚNICO punto de fallback del milestone): si no había daemon,
 *      invoca `stopServer()` (server.js:693, usa server.pid) para no regresionar el
 *      back-compat de `kodo start`→`kodo stop`. `polling start/stop/status` standalone
 *      NO se tocan (quedan intactos). Se importa lazy porque server.js es pesado
 *      (http/cmux/reconcile) y no queremos arrastrarlo salvo que se use el fallback.
 *
 * never-throws (convención repo): el fallback se envuelve defensivamente — un
 * `stopServer` que lance NO propaga como crash del handler.
 *
 * @param {{}} [opts] — sin opciones por ahora; presente por paridad de firma con status.
 * @param {{
 *   _stopDaemon?: (name: string, deps?: any) => Promise<any>,
 *   _stopServer?: () => any,
 *   _write?: (s: string) => any,
 *   _err?: (s: string) => any,
 *   _fmt?: import('./format.js').Formatter,
 * }} [deps]
 * @returns {Promise<number>} exit code (0 = éxito; stop es best-effort/never-fail).
 */
export async function runStopUnified(opts = {}, deps = {}) {
  const stopDaemonFn = deps._stopDaemon || stopDaemon;
  const write = deps._write || ((s) => process.stdout.write(s));
  const err = deps._err || ((s) => process.stderr.write(s));
  // Formatter TTY-aware; useColor se resuelve eager contra process.stdout (D-04 format).
  const fmt = deps._fmt || createFormatter(process.stdout);

  const res = await stopDaemonFn('kodo');

  // Daemon tumbado (stopped) o PID stale limpiado (stale) → éxito, sin fallback.
  if (res && (res.stopped || res.stale)) {
    const pidSuffix = res.pid != null ? ` pid: ${res.pid}` : '';
    write(`${fmt.ok('stopped')}${pidSuffix}\n`);
    return 0;
  }

  // res.notRunning → NO hay daemon 'kodo'. FALLBACK legacy a server.pid (back-compat
  // de `kodo start`). Único punto de fallback del milestone; envuelto never-throws.
  try {
    let stopServerFn = deps._stopServer;
    if (!stopServerFn) stopServerFn = (await import('../server.js')).stopServer;
    stopServerFn();
  } catch (e) {
    // never-throws / fail-open: el fallback nunca crashea el handler; avisa y sigue.
    err(`kodo stop: fallo en el fallback legacy: ${e && e.message ? e.message : e}\n`);
  }
  return 0;
}
