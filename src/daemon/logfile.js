// @ts-check
//
// src/daemon/logfile.js — KODO-28: red de seguridad para stdout/stderr del daemon.
//
// El daemon detached de `startDaemon` (lifecycle.js) nacía con
// `stdio: ['ignore','ignore','ignore']` porque nadie inyectaba `_logFd` fuera de
// los tests. Consecuencia real observada: el último `~/.kodo/logs/daemon-stdout.log`
// era del 2026-07-09 (último arranque por la vía legacy) mientras `state.json`
// acumulaba 30 sesiones de agosto — un crash del daemon no dejaba ni una línea.
//
// Este módulo provee el fd por defecto: `~/.kodo/logs/daemon.log`, append-only,
// mode 0o600, con rotación por tamaño. Es la ÚLTIMA red — captura lo que el logger
// estructurado no puede: stack traces de un throw no capturado, SIGSEGV, OOM, y
// cualquier escritura fuera del event loop. El audit de negocio (webhook.*,
// dispatch.*) vive en el NDJSON de logger.js, no aquí.
//
// Diseño templado sobre el daemon maduro de polling (src/cli/polling.js:243-275 +
// src/cli/polling-logfile.js) — mismo `openSync(path,'a',0o600)` sobre un
// `~/.kodo/logs/` con mode 0o700 (D-16), y `ensureLogsDir` se REUSA de allí en vez
// de duplicar el mkdir. Divergencia deliberada respecto a polling: polling rota
// por DÍA (`polling-YYYY-MM-DD.log` + sweep de 7 días) porque su volumen es un tick
// periódico predecible; el daemon rota por TAMAÑO porque su volumen depende del
// tráfico de webhooks y de si está crasheando en bucle — un bucle de crash llena
// un fichero diario sin techo.
//
// never-throws en todo el módulo: un fallo de FS aquí NUNCA debe impedir que el
// daemon arranque. `openDaemonLog` degrada a `null` y el caller cae a 'ignore'
// (exactamente el comportamiento previo a KODO-28, así que la degradación no
// puede ser peor que el statu quo).

import { closeSync, openSync, renameSync, statSync } from 'node:fs';
// KODO-43: raíz `~/.kodo` desde `src/paths.js` (hoja de solo builtins, sin I/O). `kodoPath` es
// lazy — resuelve `homedir()` en la llamada, preservando el Pitfall #11 documentado abajo.
import { kodoPath } from '../paths.js';

import { ensureLogsDir } from '../cli/polling-logfile.js';

/**
 * Techo de tamaño antes de rotar (5 MiB). A ~200 bytes/línea son ~26k líneas —
 * holgado para el tráfico normal de webhooks y suficiente para reconstruir un
 * bucle de crash sin llenar el disco.
 */
export const DAEMON_LOG_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Path del logfile de stdout/stderr crudo del daemon.
 *
 * Lazy sobre `homedir()` en cada llamada (Pitfall #11 de polling-logfile.js): los
 * tests HOME-isolated setean `process.env.HOME` antes de invocar y obtienen el path
 * del sandbox sin bustear el cache ESM.
 *
 * @returns {string}
 */
export function resolveDaemonLogPath() {
  return kodoPath('logs', 'daemon.log');
}

/**
 * Rota `daemon.log` → `daemon.log.1` si supera `maxBytes`. Una sola generación:
 * el `.1` previo se sobrescribe (`renameSync` es atómico y reemplaza el destino).
 *
 * Se conserva UNA generación a propósito: el valor forense está en el arranque y
 * el crash más recientes, no en el histórico. Para histórico está el NDJSON.
 *
 * never-throws / fail-open: si el fichero no existe (ENOENT en el statSync del
 * primer arranque) o el rename falla (permisos, FS de solo lectura), se sigue
 * adelante y se abre el fichero tal cual esté — perder la rotación es preferible
 * a perder el log.
 *
 * @param {{ path?: string, maxBytes?: number }} [opts]
 * @returns {boolean} true si rotó; false si no hizo falta o falló (fail-open)
 */
export function rotateIfLarge(opts = {}) {
  const path = opts.path || resolveDaemonLogPath();
  const maxBytes = opts.maxBytes ?? DAEMON_LOG_MAX_BYTES;
  try {
    const st = statSync(path);
    if (st.size < maxBytes) return false;
    renameSync(path, `${path}.1`);
    return true;
  } catch {
    // ENOENT en el primer arranque, o cualquier fallo de FS: fail-open.
    return false;
  }
}

/**
 * Abre el logfile del daemon en modo append y devuelve su fd, listo para pasarlo
 * como `stdio[1]`/`stdio[2]` de un spawn detached.
 *
 * Secuencia (mirror polling.js:243-275): ensureLogsDir (0o700) → rotateIfLarge →
 * `openSync(path,'a',0o600)`.
 *
 * El OWNERSHIP del fd es del caller: tras el spawn, el kernel ya duplicó el fd al
 * hijo, así que el padre debe cerrar el suyo (`closeDaemonLog`) para no filtrarlo.
 *
 * never-throws: devuelve `null` ante cualquier fallo. El caller degrada a 'ignore'.
 *
 * @param {{ path?: string, maxBytes?: number }} [opts]
 * @returns {number | null} fd, o null si no se pudo abrir
 */
export function openDaemonLog(opts = {}) {
  const path = opts.path || resolveDaemonLogPath();
  try {
    ensureLogsDir();
    rotateIfLarge({ path, maxBytes: opts.maxBytes });
    return openSync(path, 'a', 0o600);
  } catch {
    return null;
  }
}

/**
 * Cierra un fd devuelto por `openDaemonLog`. Idempotente frente a `null`/EBADF.
 * never-throws — cerrar es best-effort; un EBADF no debe tumbar el arranque.
 *
 * @param {number | null | undefined} fd
 * @returns {void}
 */
export function closeDaemonLog(fd) {
  if (typeof fd !== 'number') return;
  try {
    closeSync(fd);
  } catch {
    // best-effort: doble cierre o fd ya inválido.
  }
}
