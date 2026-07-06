// @ts-check
//
// src/daemon/lifecycle.js — Plan 65-03 Task 1 (D-02).
//
// Plumbing GENÉRICO name-parametrizado para arrancar/parar/consultar un daemon
// detached: `startDaemon(name, argv, deps)`, `stopDaemon(name, deps)`,
// `statusDaemon(name, deps)`. Templado LÍNEA A LÍNEA sobre el daemon maduro de
// polling (src/cli/polling.js) — NO sobre el patrón naïve de server.js (Pitfall 1):
//   - startDaemon: Windows refuse-with-guidance FIRST (polling.js:236-240),
//     pre-flight readPidFile(name)+isPidAlive (polling.js:259-268), detached spawn
//     `process.execPath + KODO_BIN absoluto + argv array form` + child.unref()
//     (polling.js:283-303), bounded wait polling readPidFile(name)+isPidAlive
//     (polling.js:315-323).
//   - stopDaemon: SIGTERM → 5s isPidAlive loop → SIGKILL fallback → removePidFile(name);
//     ESRCH → stale cleanup success (polling.js:492-519).
//   - statusDaemon: readPidFile(name)+isPidAlive → running|idle.
//
// Consumidor REAL: Phase 66 (`kodo up`/`stop`/`status`). Por eso `argv` es un
// PARÁMETRO — `kodo up` pasará `['daemon','run']`; NO se hardcodea aquí para que
// lifecycle.js quede genérico (D-02). Se entrega ahora como plumbing estable.
//
// Convención repo never-throws / fail-open: los handlers devuelven un objeto
// resultado discriminado en lugar de lanzar; los efectos (spawn/kill) se envuelven
// defensivamente. TODAS las dependencias de proceso/FS/reloj son inyectables vía
// `deps` (`_spawn`/`_kill`/`_isPidAlive`/`_readPidFile`/`_removePidFile`/`_now`/
// `_sleep`/`_platform`/`_kodoBin`/`_execPath`) para tests DI sin procesos reales.
//
// Seguridad (T-65-10, EOP): el spawn detached usa `process.execPath` + un KODO_BIN
// ABSOLUTO + argv en forma array (sin shell, sin PATH lookup) — heredado verbatim de
// polling.js:283-303.

import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { isPidAlive } from '../gsd/lock.js';
import { acquireLock, releaseLock } from '../session/state-lock.js';
import { readPidFile, removePidFile } from '../cli/polling-daemon.js';

/**
 * Resuelve el path absoluto al binario `bin/kodo` desde `src/daemon/lifecycle.js`.
 *
 * Usado en el detached spawn para garantizar T-65-10 (EOP: cero PATH lookup;
 * `process.execPath` + KODO_BIN absoluto + argv array form).
 *
 * @returns {string}
 */
function resolveKodoBin() {
  // src/daemon/lifecycle.js → ../../bin/kodo
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'kodo');
}

/**
 * @typedef {{
 *   _spawn?: typeof import('node:child_process').spawn,
 *   _kill?: (pid: number, sig: string | number) => void,
 *   _isPidAlive?: (pid: number) => boolean,
 *   _readPidFile?: (name?: string) => any,
 *   _removePidFile?: (name?: string) => void,
 *   _now?: () => number,
 *   _sleep?: (ms: number) => Promise<any>,
 *   _platform?: string,
 *   _kodoBin?: string,
 *   _execPath?: string,
 *   _logFd?: any,
 *   _waitMs?: number,
 *   _exec?: (...args: any[]) => any,
 *   _warn?: (event: string, meta?: Record<string, any>) => void,
 *   _acquireLock?: (lockPath: string, opts?: object) => ({ token: string } | null),
 *   _releaseLock?: (lockPath: string, token: string) => void,
 *   _startLockPath?: string,
 *   _lockOpts?: { retries?: number, backoffMs?: number, ttlMs?: number },
 * }} LifecycleDeps
 */

/**
 * ¿El arranque REAL del proceso `pid` (vía `ps -o lstart=`) coincide con el
 * `started_at` que el PID file dice haber escrito? — anti-reciclado de PID (D-11).
 *
 * Defensa contra el reciclado de PID entre el SIGTERM y el SIGKILL fallback de
 * `stopDaemon`: si el kernel reasignó ese `pid` a un proceso ajeno tras la muerte
 * del daemon, matarlo sería matar a un inocente. Comparamos el arranque real del
 * proceso con el `started_at` que el payload afirma; si no cuadran (± tolerancia),
 * el pid fue reciclado.
 *
 * Pitfall 4 (locale): `ps -o lstart=` imprime la fecha en el formato del locale
 * activo (p.ej. es_ES). Forzamos `LC_ALL=C` para estabilizar el parseo entre
 * entornos. `lstart` tiene resolución de 1s y `started_at` se escribe ~ms tras el
 * exec del proceso → una tolerancia de ~8s absorbe ese skew.
 *
 * Degradación segura (D-11): si `ps` está ausente, sale ≠0, o el output no parsea
 * (NaN), devolvemos `{ verifiable:false }` — el caller NO mata por defecto. never-throws.
 *
 * @param {number} pid
 * @param {string} payloadStartedAtISO - el `started_at` del PID payload.
 * @param {{ toleranceMs?: number, _exec?: (...a: any[]) => any }} [opts]
 * @returns {{ verifiable: boolean, match?: boolean }}
 */
export function processStartMatches(pid, payloadStartedAtISO, { toleranceMs = 8000, _exec } = {}) {
  const exec = _exec || execFileSync;
  let real;
  try {
    // LC_ALL=C estabiliza el formato locale-dependiente (Pitfall 4).
    const out = String(
      exec('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
      }),
    ).trim();
    real = Date.parse(out); // ej. "Mon Jul  6 12:59:44 2026" (con LC_ALL=C)
  } catch {
    return { verifiable: false }; // ps ausente/exit≠0 → degradar seguro (no matar)
  }
  const claimed = Date.parse(payloadStartedAtISO);
  if (!Number.isFinite(real) || !Number.isFinite(claimed)) return { verifiable: false };
  return { verifiable: true, match: Math.abs(real - claimed) <= toleranceMs };
}

/**
 * Arranca un daemon detached name-parametrizado.
 *
 * Orden (mirror polling.js runPollingStartCli):
 *   1. Windows refuse-with-guidance FIRST — sin detached spawn (polling.js:236-240).
 *   2. O_EXCL start-lock (Phase 70, CONC-06/D-12): adquiere `~/.kodo/{name}.start.lock`
 *      vía la primitiva Plan-01 (state-lock.js) ANTES del pre-flight+spawn. Si otro
 *      arranque ya lo tiene, devuelve `{ ok:true, alreadyStarting:true }` sin spawnear
 *      — cierra el TOCTOU check-then-spawn (dos starts que ambos ven "no vivo" y ambos
 *      spawnean → dos daemons). El lock es stealable si un starter previo murió a mitad
 *      (steal-if-dead de la primitiva) y se libera SIEMPRE en el finally.
 *   3. Pre-flight: readPidFile(name) vivo → already-running (no spawn); stale (file
 *      presente, proceso muerto) → removePidFile(name) y procede (polling.js:259-268).
 *   4. Detached spawn `execPath + [KODO_BIN, ...argv]` + child.unref() (polling.js:283-303).
 *   5. Bounded wait: poll readPidFile(name)+isPidAlive hasta `waitMs` (polling.js:315-323).
 *
 * @param {string} name — basename del PID file (p.ej. 'kodo' → ~/.kodo/kodo.pid).
 * @param {string[]} argv — args del hijo tras KODO_BIN (Phase 66 pasa ['daemon','run']).
 * @param {LifecycleDeps} [deps]
 * @returns {Promise<{ ok: boolean, alreadyRunning?: boolean, alreadyStarting?: boolean,
 *   started?: boolean, timedOut?: boolean, unsupported?: boolean, pid?: number,
 *   message?: string }>}
 */
export async function startDaemon(name, argv, deps = {}) {
  const spawnFn = deps._spawn || spawn;
  const isAlive = deps._isPidAlive || isPidAlive;
  const readPid = deps._readPidFile || readPidFile;
  const removePid = deps._removePidFile || removePidFile;
  const platform = deps._platform || process.platform;
  const execPath = deps._execPath || process.execPath;
  const kodoBin = deps._kodoBin || resolveKodoBin();
  const now = deps._now || Date.now;
  const sleepFn = deps._sleep || sleep;
  const waitMs = deps._waitMs ?? 2000;
  // stdio del hijo: 'ignore' por defecto (genérico); un consumidor (Phase 66) puede
  // inyectar un fd de logfile via `_logFd` para capturar stdout/stderr crudo.
  const outFd = deps._logFd ?? 'ignore';

  // Start-lock (CONC-06/D-12): reusa la primitiva Plan-01 (NO nueva lógica de lock).
  // Path derivado del name, junto a los PID files (`~/.kodo/{name}.start.lock`); el
  // homedir() se resuelve lazy para que los tests HOME-isolated apunten al sandbox.
  const acquireLockFn = deps._acquireLock || acquireLock;
  const releaseLockFn = deps._releaseLock || releaseLock;
  const startLockPath = deps._startLockPath || join(homedir(), '.kodo', `${name}.start.lock`);
  // Retry corto: si el ganador aún está en su sección crítica (spawn+bounded wait),
  // el perdedor reintenta unos ms; si el ganador ya liberó, el perdedor adquiere y el
  // pre-flight de abajo ve el daemon vivo → alreadyRunning. Ambos caminos → un daemon.
  const lockOpts = deps._lockOpts || { retries: 5, backoffMs: 20 };

  // 1) Windows refuse-with-guidance FIRST (W-2 / polling.js:236-240): sin detached spawn.
  if (platform === 'win32') {
    return {
      ok: false,
      unsupported: true,
      message: 'Windows daemon unsupported. Use the foreground command instead.',
    };
  }

  // 2) O_EXCL start-lock (CONC-06/D-12): un solo arranque cruza; el perdedor sale limpio.
  const held = acquireLockFn(startLockPath, lockOpts);
  if (!held) {
    // Otro `polling start` tiene el start-lock → NO spawnear un segundo daemon.
    return { ok: true, alreadyStarting: true };
  }

  try {
    // 3) Pre-flight (Pitfall #3): check en el padre ANTES del spawn — ahora bajo el lock.
    const existing = readPid(name);
    if (existing && isAlive(existing.pid)) {
      return { ok: true, alreadyRunning: true, pid: existing.pid };
    }
    if (existing) {
      // stale PID file (file presente pero proceso muerto) — limpia y procede.
      removePid(name);
    }

    // 4) Detached spawn con argv absoluto (T-65-10 EOP: cero PATH lookup, argv array form).
    const child = spawnFn(
      execPath,
      [kodoBin, ...argv],
      {
        detached: true,
        // stdio[1]=stdout, stdio[2]=stderr → mismo destino preserva interleaving.
        stdio: ['ignore', outFd, outFd],
        env: process.env,
      },
    );
    child.unref(); // Pitfall #2 crítico — sin esto el padre cuelga.

    // 5) Bounded wait (polling.js:315-323): poll PID file + isPidAlive hasta el deadline.
    // do-while: SIEMPRE hace ≥1 lectura (el hijo puede haber escrito el PID de inmediato)
    // antes de rendirse por deadline — cubre el caso happy-path de spawn instantáneo.
    const deadline = now() + waitMs;
    do {
      const payload = readPid(name);
      if (payload && isAlive(payload.pid)) {
        return { ok: true, started: true, pid: payload.pid };
      }
      if (now() >= deadline) break;
      await sleepFn(50);
    } while (true);
    return {
      ok: false,
      timedOut: true,
      message: `daemon '${name}' failed to write PID file within ${waitMs}ms`,
    };
  } finally {
    // Libera el start-lock SIEMPRE (éxito, already-running, timeout o throw).
    releaseLockFn(startLockPath, held.token);
  }
}

/**
 * Para un daemon name-parametrizado (mirror runPollingStopCli, polling.js:492-519).
 *
 * Sin PID file → not-running. Si hay PID: SIGTERM, poll isPidAlive hasta 5s, SIGKILL
 * si sigue vivo, removePidFile(name). ESRCH (proceso ya muerto) → stale cleanup success.
 *
 * @param {string} name
 * @param {LifecycleDeps} [deps]
 * @returns {Promise<{ ok: boolean, stopped?: boolean, stale?: boolean,
 *   notRunning?: boolean, pid?: number }>}
 */
export async function stopDaemon(name, deps = {}) {
  const kill = deps._kill || process.kill;
  const isAlive = deps._isPidAlive || isPidAlive;
  const readPid = deps._readPidFile || readPidFile;
  const removePid = deps._removePidFile || removePidFile;
  const now = deps._now || Date.now;
  const sleepFn = deps._sleep || sleep;
  const warn = deps._warn || ((event, meta) => {
    // Degradación VISIBLE (D-11): el warn debe verse para explicar por qué a veces
    // `kodo stop` deja un proceso que ya recibió SIGTERM. NDJSON a stderr, never-throws.
    try { process.stderr.write(JSON.stringify({ level: 'warn', event, ...(meta || {}) }) + '\n'); } catch {}
  });

  const payload = readPid(name);
  if (!payload) {
    return { ok: true, notRunning: true };
  }

  try {
    kill(payload.pid, 'SIGTERM');
    // 5s wait, luego SIGKILL fallback (D-12 / polling.js:504-510).
    const deadline = now() + 5000;
    while (now() < deadline && isAlive(payload.pid)) {
      await sleepFn(100);
    }
    if (isAlive(payload.pid)) {
      // Anti-reciclado de PID antes del SIGKILL (D-11): verifica que el arranque
      // real del proceso coincide con el started_at del payload. Si el pid fue
      // reciclado (mismatch) o no es verificable (ps ausente/NaN) → NO matar
      // (degradación segura, warn visible). Solo mata con arranque CONFIRMADO nuestro.
      const chk = processStartMatches(payload.pid, payload.started_at, { _exec: deps._exec });
      if (chk.verifiable && chk.match) {
        try { kill(payload.pid, 'SIGKILL'); } catch { /* race: murió entre checks */ }
        removePid(name);
        return { ok: true, stopped: true, pid: payload.pid };
      }
      // WR-03: SIGKILL saltado — el proceso puede seguir siendo NUESTRO daemon vivo
      // (mismatch = pid dudosamente reciclado; !verifiable = ps ausente/NaN). NO
      // borrar el PID file NI reportar stopped:true: hacerlo huérfana un daemon vivo
      // y deja que un `kodo up`/`statusDaemon` posterior vea 'idle' y arranque un
      // SEGUNDO daemon (rompe single-owner). Dejar el PID file intacto y reportar
      // un outcome distinto (stillAlive) para no mentir sobre haberlo parado.
      if (chk.verifiable) {
        warn('daemon.sigkill.aborted', { pid: payload.pid, reason: 'pid-reuse-suspected' });
      } else {
        warn('daemon.sigkill.unverifiable', { pid: payload.pid });
      }
      return { ok: false, stillAlive: true, pid: payload.pid };
    }
    removePid(name);
    return { ok: true, stopped: true, pid: payload.pid };
  } catch (e) {
    // ESRCH = proceso ya estaba muerto → stale cleanup, success (polling.js:514-518).
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ESRCH') {
      removePid(name);
      return { ok: true, stale: true };
    }
    throw e;
  }
}

/**
 * Consulta el estado de un daemon name-parametrizado.
 *
 * PID file + isPidAlive → running (con pid). Missing o stale → idle (pid null).
 *
 * @param {string} name
 * @param {LifecycleDeps} [deps]
 * @returns {{ status: 'running' | 'idle', pid: number | null }}
 */
export function statusDaemon(name, deps = {}) {
  const isAlive = deps._isPidAlive || isPidAlive;
  const readPid = deps._readPidFile || readPidFile;

  const payload = readPid(name);
  const alive = payload != null && isAlive(payload.pid);
  return alive
    ? { status: 'running', pid: payload.pid }
    : { status: 'idle', pid: null };
}
