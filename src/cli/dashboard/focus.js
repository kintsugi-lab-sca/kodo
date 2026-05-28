// @ts-check
//
// src/cli/dashboard/focus.js — Phase 37 Plan 01 (TUI-13 + TUI-14).
//
// Orquestador puro de la invocación `cmux select-workspace --workspace <ref>`. Es la
// pieza load-bearing de Phase 37: encapsula la única llamada al binario cmux que la TUI
// hace por Enter del operador. Es testeable con `exec` fake sin tocar `node:child_process`.
//
// Decisión D-01 / Pattern espejo — never-throws {ok}:
//   Cualquier modo de fallo (ENOENT, exit code ≠ 0, exec sync-throw, error desconocido)
//   colapsa al discriminante:
//       { ok: true }                                                  — focus ejecutado
//       { ok: false, code: 'ENOENT',         detail: string }         — cmux no en PATH
//       { ok: false, code: 'NON_ZERO_EXIT',  detail: number }         — exit code ≠ 0
//       { ok: false, code: 'SPAWN_ERROR',    detail: string }         — cualquier otro
//   Jamás una excepción que llegue al caller en App.js. Patrón heredado de Phase 35 D-07
//   (`src/cli/dashboard/client.js#fetchStatus`).
//
// Divergencias load-bearing respecto a `src/cmux/client.js#run` (PATTERNS.md §focus.js):
//   1. `binary` viene por argumento, no por `getCmuxBinary()` interno (DI por testabilidad).
//   2. `exec` inyectado en lugar de `execFile` importado eager (D-01/D-03; leak guard
//      ESTRUCTURAL — sin default, jamás se toca el `execFile` real desde tests).
//   3. Args LITERAL FIJOS: `[FOCUS_VERB, FOCUS_FLAG, ref]` — no `[...args]` genérico (D-07).
//   4. NEVER-THROWS — `reject(...)` reemplazado por `resolve({ok:false, code, detail})`.
//   5. Timeout corto 5_000ms (no 15_000) — la RPC al socket Unix de cmux es ~50ms; timeout
//      corto evita enmascarar un cmux colgado (D-07).
//
// Divergencia respecto a `src/cli/dashboard/client.js#fetchStatus` (secondary analog):
//   `client.js` usa `{ok:false, error: string}` (string libre); este módulo usa
//   `{ok:false, code: literal-union, detail}` (code tipado para mapeo 1:1 a los 3 mensajes
//   canónicos del UX en App.js — Phase 34 D-04 pattern de mensajes literal-estables).
//
// Verbo cmux exacto (D-07 + research §C-01):
//   `cmux select-workspace --workspace <ref>` es fire-and-forget al socket Unix de cmux
//   (~50ms). NO toma el TTY. NO usa `spawn` con `stdio:'inherit'`. cmux es una app GUI de
//   macOS controlada por socket; el verbo cambia el workspace activo en la GUI y termina.
//   stdout/stderr se IGNORAN (no hay nada útil que parsear).
//
// Color-isolation (Phase 34 D-12 invariante cross-milestone): este módulo importa SOLO de
// `node:*` (tipos) o módulos internos puros. CERO `picocolors`, CERO `src/cli/format.js`.
// El walker `test/format-isolation.test.js:208-219` lo verifica automáticamente porque
// escanea `src/cli/dashboard/**`.
//
// Scope (YAGNI): solo `runFocus` + las dos constantes de args. El mapeo de `code` →
// mensaje UX (`[!] cmux not found in PATH …` etc.) vive en App.js (Plan 02) porque es
// presentación.

/**
 * Cabeza de los args de `cmux select-workspace --workspace <ref>` (D-07). Exportada como
 * constantes separadas para que los tests asseren ordering literal sin duplicar strings
 * (Phase 34 D-04 NON_TTY_MSG pattern). El consumidor construye el array completo:
 * `[FOCUS_VERB, FOCUS_FLAG, ref]`.
 */
export const FOCUS_VERB = 'select-workspace';
export const FOCUS_FLAG = '--workspace';

/**
 * Resultado discriminado de `runFocus` (D-01).
 *
 * @typedef {{ ok: true }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail: any }} FocusResult
 */

/**
 * Invoca `cmux select-workspace --workspace <ref>` vía el `exec` inyectado (callback-style,
 * shape de `node:child_process.execFile`). NEVER-THROWS: colapsa todo modo de fallo al
 * discriminante `{ok:false, code, detail}` (D-01, never-throws contract Phase 35 D-07).
 *
 * @param {object} args
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} args.exec
 *   execFile-shaped inyectable (D-01/D-03). NO default — leak guard ESTRUCTURAL: omitir
 *   este arg produce TypeError en lugar de fallback al `execFile` real.
 * @param {string} args.ref — workspace_ref literal del SessionRecord (p.ej. 'workspace:5').
 * @param {string} args.binary — path al binario cmux (resuelto por el caller vía
 *   `loadConfig().cmux.binary`).
 * @param {number} [args.timeoutMs=5000] — D-07: 5s; la RPC al socket cmux es ~50ms, el
 *   timeout corto evita enmascarar un cmux colgado.
 * @returns {Promise<FocusResult>}
 */
export function runFocus({ exec, ref, binary, timeoutMs = 5_000 }) {
  // Leak guard ESTRUCTURAL: omitir `exec` produce TypeError visible (NO se degrada al
  // discriminado SPAWN_ERROR). Esto demuestra contractualmente que sin inyección, jamás
  // se toca el `execFile` real. Va ANTES del new Promise para que el TypeError propague
  // sincronamente, no quede atrapado en el try/catch del never-throws contract de abajo.
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runFocus: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      exec(binary, [FOCUS_VERB, FOCUS_FLAG, ref], { timeout: timeoutMs }, (err, _stdout, _stderr) => {
        if (!err) {
          resolve({ ok: true });
          return;
        }
        if (err.code === 'ENOENT') {
          resolve({ ok: false, code: 'ENOENT', detail: err.message ?? 'ENOENT' });
          return;
        }
        if (typeof err.code === 'number') {
          resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: err.code });
          return;
        }
        // Cualquier otra forma de err (sin code, code string no-ENOENT, etc.).
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      // exec lanzó SÍNCRONAMENTE — never-throws contract: NUNCA rechazamos la promise.
      resolve({
        ok: false,
        code: 'SPAWN_ERROR',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
