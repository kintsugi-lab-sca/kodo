// @ts-check
//
// src/cli/dashboard/open.js — Phase 48 Plan 02 (OPEN-01/02/03).
//
// Orquestador puro never-throws de la invocación `open <url>` — la pieza load-bearing de
// la mitad consumidora de Phase 48: encapsula la única llamada al binario `open` que la TUI
// hace por la tecla `o` del operador. Es testeable con `exec` fake sin tocar
// `node:child_process`. Clon estructural de `focus.js`; las divergencias se enumeran abajo.
//
// Decisión D-01 / Pattern espejo — never-throws {ok}:
//   Cualquier modo de fallo (allowlist rechazada, ENOENT, exit code ≠ 0, exec sync-throw,
//   error desconocido, `new URL()` que lance) colapsa al discriminante:
//       { ok: true }                                                  — open lanzado
//       { ok: false, code: 'ENOENT',         detail: string }         — `open` no en PATH
//       { ok: false, code: 'NON_ZERO_EXIT',  detail: number }         — exit code ≠ 0
//       { ok: false, code: 'SPAWN_ERROR',    detail: string }         — cualquier otro fallo de exec
//       { ok: false, code: 'BAD_PROTOCOL',   detail: string }         — protocolo no http(s) / URL inválida
//   Jamás una excepción que llegue al caller en App.js (OPEN-02). Patrón heredado de
//   `focus.js` (Phase 37) y `client.js#fetchStatus` (Phase 35 D-07).
//
// Divergencias load-bearing respecto a `focus.js` (PATTERNS.md §open.js):
//   1. SIN verbo/flag: `open` toma SOLO la URL como un único positional. No existe
//      OPEN_VERB/OPEN_FLAG (a diferencia de FOCUS_VERB/FOCUS_FLAG).
//   2. `binary` DEFAULTA al lanzador de URLs de la PLATAFORMA — `open` en macOS, `xdg-open`
//      fuera (KODO-56; hasta entonces el default era el literal 'open' y la tecla `o` daba
//      ENOENT en Linux). focus.js no tiene default de binary. El param `exec` mantiene el
//      leak guard ESTRUCTURAL (sin default): omitirlo produce TypeError, jamás se toca el
//      `execFile` real desde tests.
//   3. Args LITERALES `[url]` — un único positional (OPEN-03 mitigación de flag-injection:
//      execFile lo pasa como UN elemento argv, los metacaracteres de shell son inertes porque
//      ningún shell los parsea).
//   4. El discriminante OpenResult clona el union de FocusResult
//      (ENOENT | NON_ZERO_EXIT | SPAWN_ERROR) y AÑADE 'BAD_PROTOCOL'.
//   5. NET-NEW (sin análogo en focus.js): allowlist de protocolo http(s) que corre ANTES de
//      exec. focus.js pasa un `workspace_ref` confiable; aquí la URL viene de datos del
//      provider (Plane/GitHub) — *mayormente* confiable pero no garantizado. El guard
//      `new URL(url)` (dentro de try) + `protocol === 'http:'|'https:'` rechaza `file://`,
//      `javascript:`, basura con dash inicial (`-a Calculator` — una URL http(s) real nunca
//      empieza por `-`, mata la flag-injection de `open`) y strings vacíos/no parseables →
//      BAD_PROTOCOL, exec NUNCA invocado (Pitfall 4). Un parse que lance colapsa también a
//      BAD_PROTOCOL: never-throws.
//
// Color-isolation (Phase 34 D-12, invariante cross-milestone): este módulo importa SOLO de
// node builtins (URL es global) o internos puros — CERO helper de color del CLI, CERO lib de
// ANSI. `platform-defaults.js` (KODO-56) es una hoja pura de 0 imports: entra en esa segunda
// categoría. El walker de test/format-isolation lo verifica automáticamente (globa
// `src/cli/dashboard/**`). El mapeo de `code` → mensaje UX vive en App.js (presentación).
//
// Scope (YAGNI): solo `runOpen`. Sin constantes de args (no hay verbo). El mapeo a footer
// vive en App.js.

import { platformDefaults } from '../../platform-defaults.js';

/**
 * Resultado discriminado de `runOpen` (D-01). Clona el union de `FocusResult` y añade
 * `BAD_PROTOCOL` (allowlist http(s) — sin análogo en focus.js).
 *
 * @typedef {{ ok: true }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR' | 'BAD_PROTOCOL', detail: any }} OpenResult
 */

/**
 * Lanza `open <url>` vía el `exec` inyectado (callback-style, shape de
 * `node:child_process.execFile`). NEVER-THROWS: colapsa todo modo de fallo al discriminante
 * `{ok:false, code, detail}` (D-01). El protocolo se valida ANTES de exec (allowlist http(s),
 * OPEN-03 / Pitfall 4); una URL no http(s) o no parseable resuelve `BAD_PROTOCOL` sin invocar
 * exec jamás.
 *
 * @param {object} args
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} args.exec
 *   execFile-shaped inyectable. NO default — leak guard ESTRUCTURAL: omitir este arg produce
 *   TypeError en lugar de fallback al `execFile` real.
 * @param {string} args.url — URL de la tarea (`row.task_url`, persistida al lanzar la sesión).
 * @param {string} [args.binary] — binario lanzador. Sin valor explícito se resuelve POR
 *   PLATAFORMA (KODO-56): `open` en macOS, `xdg-open` fuera. Divergencia con focus.js, que no
 *   tiene default de binary. Un `binary` explícito gana siempre (lo usan los tests).
 * @param {string} [args.platform=process.platform] — plataforma con la que resolver el default
 *   de `binary`. Parámetro para testear ambas ramas sin monkey-patchear el global (mismo patrón
 *   que `deps._platform` en cli/up.js). Ignorado si `binary` viene explícito.
 * @param {number} [args.timeoutMs=5000] — D-07: 5s; un `open` colgado no debe enmascarar la UI.
 * @returns {Promise<OpenResult>}
 */
export function runOpen({ exec, url, binary, platform, timeoutMs = 5_000 }) {
  // Leak guard ESTRUCTURAL: omitir `exec` produce TypeError visible (NO se degrada al
  // discriminado SPAWN_ERROR). Va ANTES del new Promise para que el TypeError propague
  // sincronamente. `binary` SÍ tiene default (resuelto por plataforma, abajo); `exec` NO — la
  // inyección es contractual.
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runOpen: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  // KODO-56: el default de `binary` no puede ser un default de parámetro — depende de otro
  // parámetro (`platform`). Se resuelve aquí, antes del new Promise, y solo si el caller no
  // pasó binario: `index.js:310` llama `runOpen({ exec, url })` sin él, así que esta línea es
  // la que decide qué se ejecuta en producción.
  const launcher = binary || platformDefaults(platform).openBinary;
  return new Promise((resolve) => {
    // Allowlist de protocolo http(s) ANTES de exec (OPEN-03 / Pitfall 4). `new URL(url)` puede
    // LANZAR ante una URL no parseable (string vacío, 'not a url', '-a Calculator'); el try lo
    // captura y colapsa a BAD_PROTOCOL (never-throws). Solo `http:`/`https:` (URL.protocol
    // incluye el `:` final) pasan; todo lo demás → BAD_PROTOCOL, exec NUNCA invocado.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, code: 'BAD_PROTOCOL', detail: url });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      resolve({ ok: false, code: 'BAD_PROTOCOL', detail: url });
      return;
    }

    try {
      // Args LITERALES `[url]` — un único positional (OPEN-03). execFile lo pasa como UN
      // elemento argv → los metacaracteres de shell son inertes (ningún shell los parsea).
      exec(launcher, [url], { timeout: timeoutMs }, (err, _stdout, _stderr) => {
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
