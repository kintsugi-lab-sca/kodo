// @ts-check
//
// src/cli/polling-logfile.js — Phase 28 D-13..D-16 logfile lifecycle utility.
//
// Plan 28-03 Task 1. Provee 3 primitivas pure FS-I/O para el daemon de polling:
//
//   - resolveLogfilePath(opts?) → string : path al logfile del DÍA del arranque
//     (D-14). Filename `polling-YYYY-MM-DD.log` con fecha LOCAL al momento de
//     la llamada. NO roll mid-process — si el daemon corre varios días se queda
//     en el archivo del día de inicio (trade-off explícito por simplicidad).
//   - ensureLogsDir() → void : mkdir -p `~/.kodo/logs/` con mode 0o700 (D-16).
//     Idempotente — segunda llamada no throw.
//   - sweepRetention(opts?) → void : borra `polling-*.log` con `mtime > 7 días`
//     (D-15 cleanup pasivo al arrancar). Fail-open per archivo: un fail de
//     unlink no detiene el sweep del resto. Fail-open ante dir ausente.
//
// El path se computa lazy via `homedir()` en cada llamada (Pitfall #11 —
// HOME-isolated tests sin tocar el cache ESM): tests que setean
// `process.env.HOME = tmpdir` antes de invocar las primitivas obtienen el path
// resuelto al tmpdir. En producción, `homedir()` es estable por sesión, así que
// el overhead es despreciable.
//
// Color isolation invariant (D-20 / Pattern A v0.5): este módulo NUNCA escribe
// a stdout/stderr — solo I/O sobre el filesystem. El caller (CLI handler en
// src/cli/polling.js) hace el rendering via createFormatter.
//
// LOG-12 vigilante isolation invariant: cero imports de `../logger.js` y cero
// imports de `picocolors`. `kodo check` no debe cargar este módulo
// transitivamente (verificado por `test/check-isolation.test.js` si emerge).
//
// Separation of concerns vs polling-daemon.js:
//   - polling-daemon.js: PID file lifecycle (atomic write + chmod 0o600 +
//     read fail-open).
//   - polling-logfile.js (este): path resolver del día + ensure dir + retention
//     sweep. NO abre el fd — eso lo hace el CALLER (`src/cli/polling.js`) via
//     `openSync(path, 'a', 0o600)` para mantener el ownership del fd en el
//     branch daemon donde se pasa al spawn detached.

import {
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Retención default (D-15): 7 días. */
const DEFAULT_RETENTION_DAYS = 7;

/** Milisegundos en 1 día. */
const MS_PER_DAY = 86_400_000;

/**
 * Resuelve el path canonical del logfile del daemon para el día actual.
 *
 * Filename `polling-YYYY-MM-DD.log` (D-14 LOCKED) — fecha LOCAL al momento de
 * la llamada via `new Date().getFullYear()/getMonth()/getDate()`. Lazy: recomputa
 * en cada llamada para que los tests HOME-isolated funcionen sin ESM cache bust.
 *
 * NO roll mid-process: si el daemon corre varios días, todas las llamadas
 * subsecuentes durante esa misma sesión de proceso devuelven el path del día
 * de arranque (porque el caller solo invoca esta función una vez al spawn).
 * Trade-off explícito (D-14): el operador puede `kodo polling stop && start`
 * para rotar manualmente.
 *
 * @param {{ now?: () => Date }} [opts] — clock injection para tests
 * @returns {string}
 */
export function resolveLogfilePath(opts = {}) {
  const now = opts.now ? opts.now() : new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return join(homedir(), '.kodo', 'logs', `polling-${y}-${m}-${d}.log`);
}

/**
 * Crea `~/.kodo/logs/` con mode 0o700 si no existe (D-16). Idempotente.
 *
 * El mode 0o700 restringe lectura/escritura al owner — defensa en profundidad
 * vs. T-28-10 (symlink attack) y T-28-12 (information disclosure via stack
 * traces en logfile). El logfile en sí se abrirá con mode 0o600 por el caller
 * via `openSync(path, 'a', 0o600)`.
 *
 * @returns {void}
 */
export function ensureLogsDir() {
  mkdirSync(join(homedir(), '.kodo', 'logs'), { recursive: true, mode: 0o700 });
}

/**
 * Borra archivos `polling-*.log` en `~/.kodo/logs/` con `mtime > retentionDays`
 * (D-15 cleanup pasivo al arrancar el daemon).
 *
 * Fail-open per archivo: un `statSync`/`unlinkSync` que throws (e.g. permisos,
 * race con el OS, archivo ya borrado) no detiene el sweep del resto. Fail-open
 * ante directorio ausente: si `~/.kodo/logs/` no existe, return clean sin throw
 * y sin crear el directorio.
 *
 * Filtro estricto: solo archivos que matchean simultáneamente:
 *   - `name.startsWith('polling-')` Y
 *   - `name.endsWith('.log')`
 *
 * Esto excluye `polling-state.json`, `random.log`, y cualquier otro archivo
 * adyacente. Mitiga T-28-11 (TOCTOU + path traversal).
 *
 * El logfile activo (del día de arranque) tiene `mtime` reciente — no cae en
 * el cutoff aunque el daemon lleve días corriendo (T-28-15 clock skew
 * mitigation: usamos mtime, no parse del filename).
 *
 * @param {{ now?: () => Date, retentionDays?: number }} [opts] — clock + override para tests
 * @returns {void}
 */
export function sweepRetention(opts = {}) {
  const dir = join(homedir(), '.kodo', 'logs');
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const nowMs = opts.now ? opts.now().getTime() : Date.now();
  const cutoffMs = nowMs - retentionDays * MS_PER_DAY;

  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // D-15 fail-open: dir ausente → return clean sin crear nada.
    return;
  }

  for (const name of entries) {
    // Filtro estricto: solo polling-*.log. Excluye polling-state.json,
    // random.log, etc.
    if (!name.startsWith('polling-') || !name.endsWith('.log')) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoffMs) unlinkSync(full);
    } catch {
      // Fail-open per archivo: race con OS, permisos, ya borrado, etc.
      // El siguiente archivo del loop continúa.
    }
  }
}
