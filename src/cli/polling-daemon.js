// @ts-check
//
// src/cli/polling-daemon.js — PID file lifecycle utility for `kodo polling` daemon.
//
// Plan 26-02 / CFG-03 / D-15. Provee tres primitivas pure FS-I/O:
//
//   - writePidFile(payload) — atomic tmp+rename con chmod 0o600 PRE-rename
//     (Security V14 — restrictive permissions for token-adjacent metadata).
//   - readPidFile() → payload|null — fail-open con defensive shape check
//     (Security: PID injection mitigation T-26-02).
//   - removePidFile() — idempotente; no throw si el archivo no existe.
//   - getPidPath() — lazy resolver del path; permite tests HOME-isolated sin
//     recompilar src/config.js (Pitfall #11).
//   - PID_PATH (deprecated alias) — getter property que delega a getPidPath()
//     para soporte de uso legacy `mod.PID_PATH` en herramientas externas.
//
// El path se computa lazy via `homedir()` en cada llamada (Pitfall #11): tests
// que setean `process.env.HOME = tmpdir` antes de invocar las primitivas
// obtienen el path resuelto al tmpdir sin tener que tocar el cache ESM de
// `src/config.js`. En producción, `homedir()` es estable por sesión, así que el
// overhead es despreciable.
//
// Color isolation invariant (D-20 / Pattern A): este módulo NUNCA escribe a
// stdout/stderr — solo I/O sobre el filesystem. El caller (CLI handler en
// src/cli/polling.js) hace el rendering via createFormatter.
//
// Atomic write pattern verbatim del precedente src/triggers/polling.js:149-154
// (saveStateCache). El paso `chmod 0o600` ocurre PRE-rename para que cualquier
// concurrent read post-rename observe los permisos restrictivos inmediatos.

import {
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Computa el path canonical del PID file de forma lazy.
 *
 * D-04: `name` es un parámetro TRAILING opcional (default `'polling'`) que
 * generaliza la primitiva de forma aditiva — cada caller existente que invoca
 * `getPidPath()` sin args sigue resolviendo a `~/.kodo/polling.pid` byte-idéntico.
 * El daemon kodo (Plan 03) pasa `'kodo'` → `~/.kodo/kodo.pid`, distinto del legacy
 * `server.pid` (self-PID del server) y del standalone `polling.pid`.
 *
 * El path resultante es `join(homedir(), '.kodo', `${name}.pid`)`
 * — donde `join(homedir(), '.kodo')` === `KODO_DIR` per `src/config.js:6`.
 *
 * @param {string} [name='polling'] — basename del PID file sin extensión.
 * @returns {string}
 */
export function getPidPath(name = 'polling') {
  return join(homedir(), '.kodo', `${name}.pid`);
}

/**
 * @typedef {{ pid: number, started_at: string, repos?: string[], kind?: string }} PidFilePayload
 *
 * D-15 LOCKED: el shape canonical del PID file. `repos` (cuando presente) es
 * siempre array de strings human-readable "owner/repo" (NO objects {owner, repo})
 * para soportar `kodo polling status --json` byte-deterministic sin transformaciones.
 *
 * D-04: el daemon kodo (Plan 03) escribe un payload `{pid, started_at, kind:'daemon'}`
 * SIN `repos` — ambos campos son opcionales en el typedef porque el shape-check
 * defensivo de readPidFile solo exige `pid:number` + `started_at:string`, así que el
 * payload daemon reutiliza la misma primitiva sin flexibilizar la guarda de seguridad.
 */

/**
 * Escribe el PID file de forma atómica con permisos 0o600.
 *
 * Steps:
 *   1. mkdirSync recursive del parent dir (idempotente; no error si existe).
 *   2. writeFileSync al path `.tmp` (escritura completa antes de rename).
 *   3. chmodSync(tmp, 0o600) — PRE-rename para que el archivo final herede
 *      los permisos restrictivos inmediatamente (Security V14).
 *   4. renameSync(tmp, pidPath) — POSIX-atomic en el mismo filesystem.
 *
 * D-04: `name` es un parámetro TRAILING opcional (default `'polling'`). `payload`
 * queda PRIMERO precisamente para preservar el único caller existente en
 * `src/cli/polling.js:374` y el test single-arg en `test/cli/polling-daemon.test.js`
 * — ambos pasan un objeto como único positional y reciben `name='polling'`.
 *
 * @param {PidFilePayload} payload
 * @param {string} [name='polling'] — basename del PID file (delega a getPidPath).
 * @returns {void}
 */
export function writePidFile(payload, name = 'polling') {
  const pidPath = getPidPath(name);
  mkdirSync(dirname(pidPath), { recursive: true });
  const tmp = pidPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  chmodSync(tmp, 0o600);
  renameSync(tmp, pidPath);
}

/**
 * Lee y parsea el PID file. Fail-open ante cualquier error (mirror loadStateCache
 * de Phase 25 — corrupted file no debe romper el daemon CLI).
 *
 * Defensive shape check (Security V14 / T-26-02 PID injection mitigation):
 *   - Si `pid` no es number → null.
 *   - Si `started_at` no es string → null.
 *
 * D-04: `name` es un parámetro opcional (default `'polling'`). El shape-check se
 * mantiene VERBATIM (pid:number + started_at:string) — un payload daemon
 * `{pid, started_at, kind:'daemon'}` (sin `repos`) ya lo pasa, que es exactamente
 * por qué el daemon kodo reutiliza este módulo sin relajar la guarda.
 *
 * @param {string} [name='polling'] — basename del PID file (delega a getPidPath).
 * @returns {PidFilePayload | null}
 */
export function readPidFile(name = 'polling') {
  const pidPath = getPidPath(name);
  if (!existsSync(pidPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pidPath, 'utf-8'));
    if (typeof parsed?.pid !== 'number' || typeof parsed?.started_at !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Borra el PID file de forma idempotente. NO throw si el archivo no existe
 * (e.g. SIGINT recibido dos veces, o stop tras crash que ya limpió).
 *
 * D-04: `name` es un parámetro opcional (default `'polling'`) — el cleanup del
 * daemon kodo pasa `'kodo'`; los callers existentes sin args borran polling.pid.
 *
 * @param {string} [name='polling'] — basename del PID file (delega a getPidPath).
 * @returns {void}
 */
export function removePidFile(name = 'polling') {
  try {
    unlinkSync(getPidPath(name));
  } catch {
    // may not exist — idempotente per D-09 stop cleanup contract
  }
}

/**
 * Alias legacy `PID_PATH` — devuelve el path lazy via getter. Soporta uso
 * `existsSync(mod.PID_PATH)` y `writeFileSync(mod.PID_PATH, ...)` porque
 * Node.js fs APIs aceptan PathLike y coercionan via Symbol.toPrimitive en
 * algunos cases. Para máxima compat, usar `getPidPath()` directamente.
 *
 * @deprecated Use getPidPath() — devuelve el path lazy en cada llamada.
 */
export const PID_PATH = {
  /** @returns {string} */
  toString() { return getPidPath(); },
  /** @returns {string} */
  valueOf() { return getPidPath(); },
  /** @returns {string} */
  [Symbol.toPrimitive]() { return getPidPath(); },
};
