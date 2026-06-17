// @ts-check
//
// src/cli/dashboard/adopt.js — Phase 56 Plan 01 (DETECT-02).
//
// Orquestador puro never-throws de la invocación `kodo adopt …` — la pieza load-bearing de
// la mitad consumidora de Phase 56: encapsula la única llamada al binario kodo que la TUI
// hace por la tecla `a` del operador. Es testeable con `exec` fake sin tocar
// `node:child_process`. Clon estructural de `open.js`/`focus.js`; las divergencias se
// enumeran abajo.
//
// Decisión D-06 / Pattern espejo — never-throws {ok}:
//   Cualquier modo de fallo (ENOENT, exit code ≠ 0, exec sync-throw, error desconocido)
//   colapsa al discriminante:
//       { ok: true }                                                  — adopt ejecutado
//       { ok: false, code: 'ENOENT',         detail: string }         — kodo/node no encontrado
//       { ok: false, code: 'NON_ZERO_EXIT',  detail: number }         — exit code ≠ 0 (1/2 kodo adopt)
//       { ok: false, code: 'SPAWN_ERROR',    detail: string }         — cualquier otro fallo de exec
//   Jamás una excepción que llegue al caller en App.js (D-07). Patrón heredado de
//   `focus.js` (Phase 37) / `open.js` (Phase 48) / `client.js#fetchStatus` (Phase 35 D-07).
//
// Divergencias load-bearing respecto a `runOpen` (PATTERNS.md §adopt.js):
//   1. SIN allowlist BAD_PROTOCOL. Eso es específico de open.js (la URL viene de datos del
//      provider). Aquí los 4 valores de argv vienen de datos confiables del host (validados
//      por normalizeSurface, cmux.js:46-67) + el reverse-lookup contra loadProjects() (mapa
//      del operador). El discriminante AdoptResult reusa EXACTAMENTE el union de FocusResult
//      (ENOENT | NON_ZERO_EXIT | SPAWN_ERROR), sin BAD_PROTOCOL.
//   2. argv es un array LITERAL de 8 elementos (no un único positional):
//        ['adopt', '--workspace', workspaceRef, '--cwd', cwd, '--session-id', sessionId,
//         '--project', projectId]
//      (T-56-01: cada valor va precedido de su `--flag` explícita, así que un valor que
//      empiece por `-` se consume como argumento del flag previo, no como flag nueva).
//   3. RESOLUCIÓN DEL BINARIO diverge de runOpen/runFocus (que llaman execFile(binary, args)
//      con `binary` un ejecutable directo). `bin/kodo` es un script `#!/usr/bin/env node`
//      (Pitfall 4), así que el binario es `process.execPath` (node) y `kodoBin` es el PRIMER
//      argv — espejo de polling.js:283-294. Cero PATH lookup (T-56-02, mitigación EoP). El
//      caller resuelve `execPath` (= process.execPath) y `kodoBin` (= absoluto a bin/kodo).
//   4. Mantiene `exec` SIN default (leak guard ESTRUCTURAL); mantiene `timeoutMs = 5_000`.
//
// ⚠ Exit-code semantics: `kodo adopt` devuelve 0/1/2 (0 ok / 1 config / 2 transient POST).
//   `typeof err.code === 'number'` → NON_ZERO_EXIT con `detail` = el código literal (1 ó 2).
//   El footer muestra `adopt failed (code N)`; el dashboard NO reinterpreta la semántica.
//
// Color-isolation (Phase 34 D-12 / D-08 Phase 56, invariante cross-milestone): este módulo
// importa SOLO de `node:*` (tipos) o internos puros. CERO `picocolors`, CERO
// `src/cli/format.js`. El walker `test/format-isolation.test.js` lo verifica automáticamente
// (escanea `src/cli/dashboard/**`). El mapeo de `code` → mensaje UX vive en App.js.
//
// Scope (YAGNI): solo `runAdopt`. El mapeo a footer vive en App.js (Plan 02).

/**
 * Resultado discriminado de `runAdopt` (D-06). Reusa EXACTAMENTE el union de `FocusResult`
 * (sin BAD_PROTOCOL — esa es divergencia de open.js).
 *
 * @typedef {{ ok: true }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail: any }} AdoptResult
 */

/**
 * Invoca `kodo adopt …` vía el `exec` inyectado (callback-style, shape de
 * `node:child_process.execFile`). NEVER-THROWS: colapsa todo modo de fallo al discriminante
 * `{ok:false, code, detail}` (D-06, never-throws contract Phase 35 D-07).
 *
 * El binario es `execPath` (= process.execPath, node) y `kodoBin` es el primer elemento del
 * argv — `bin/kodo` es un script `#!/usr/bin/env node`, NO un ejecutable nativo (Pitfall 4).
 * Esto diverge de runOpen/runFocus, que llaman `execFile(binary, args)` con binary directo.
 *
 * @param {object} args
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} args.exec
 *   execFile-shaped inyectable. NO default — leak guard ESTRUCTURAL: omitir este arg produce
 *   TypeError en lugar de fallback al `execFile` real.
 * @param {string} args.execPath — el ejecutable node (= `process.execPath`). Binario de exec.
 * @param {string} args.kodoBin — path absoluto a `bin/kodo` (resuelto por el caller, espejo de
 *   polling.js:resolveKodoBin). Primer elemento del argv.
 * @param {string} args.workspaceRef — `workspace_ref` de la surface descubierta.
 * @param {string} args.cwd — cwd de la surface (validado string por normalizeSurface).
 * @param {string} args.sessionId — identidad de la surface (== resume_binding.checkpoint_id).
 * @param {string} args.projectId — projectId resuelto por el reverse-lookup (D-05).
 * @param {number} [args.timeoutMs=5000] — D-06: 5s; un adopt colgado no debe enmascarar la UI.
 * @returns {Promise<AdoptResult>}
 */
export function runAdopt({ exec, execPath, kodoBin, workspaceRef, cwd, sessionId, projectId, timeoutMs = 5_000 }) {
  // Leak guard ESTRUCTURAL: omitir `exec` produce TypeError visible (NO se degrada al
  // discriminado SPAWN_ERROR). Va ANTES del new Promise para que el TypeError propague
  // sincronamente, no quede atrapado en el try/catch del never-throws contract de abajo.
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runAdopt: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      // argv LITERAL de 8 elementos tras `kodoBin` (T-56-01). El binario es execPath (node);
      // kodoBin es argv[0] — bin/kodo es un script de shebang, NO ejecutable nativo (Pitfall 4).
      const argv = [
        kodoBin,
        'adopt',
        '--workspace',
        workspaceRef,
        '--cwd',
        cwd,
        '--session-id',
        sessionId,
        '--project',
        projectId,
      ];
      exec(execPath, argv, { timeout: timeoutMs }, (err, _stdout, _stderr) => {
        if (!err) {
          resolve({ ok: true });
          return;
        }
        if (err.code === 'ENOENT') {
          resolve({ ok: false, code: 'ENOENT', detail: err.message ?? 'ENOENT' });
          return;
        }
        if (typeof err.code === 'number') {
          // kodo adopt: 1 config / 2 transient POST. detail = el exit code literal.
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
