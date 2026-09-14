// @ts-check
//
// src/cli/dashboard/orchestrate.js — KODO-89.
//
// Shell never-throws de `kodo orchestrate`, el lanzamiento que la tecla `O` dispara cuando no hay
// orquestador que enfocar (ref null, o ref persistido muerto → focus con exit ≠ 0).
//
// Clon estructural de `inbox-actions.js` / `adopt.js` — mismas propiedades por las mismas razones:
// `process.execPath` + `kodoBin` como argv[0] (bin/kodo es un script de shebang), argv literal, y
// `exec` SIN default (leak guard estructural).
//
// ## Por qué shellea el CLI en vez de importar `launchOrchestrator`
//
//   1. UNA sola ruta de lanzamiento. `kodo orchestrate` es exactamente lo que el operador teclearía
//      en esta terminal: mismo cwd (el hijo lo hereda, y `launchOrchestrator` abre el workspace en
//      `process.cwd()`), mismos gates de KODO-16/18 (revalida el registro por UUID, limpia el
//      muerto con evidencia positiva, renueva `orchestrator.json`).
//   2. `launchOrchestrator` escribe con `console.log`. Dentro del proceso de ink esas líneas se
//      pintarían encima del frame en el alternate screen; en un hijo quedan capturadas.
//
// No devuelve el ref: el caller lo re-resuelve con POST /orchestrator, que lee el mismo
// `orchestrator.json` que el launch acaba de renovar. Así no hay que parsear el stdout del CLI.

/**
 * @typedef {{ ok: true }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail: any, stderr?: string }
 * } OrchestrateResult
 */

/**
 * Invoca `kodo orchestrate` vía el `exec` inyectado. NEVER-THROWS.
 *
 * @param {object} args
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} args.exec
 *   execFile-shaped. SIN default — leak guard estructural.
 * @param {string} args.execPath Ejecutable node (= `process.execPath`).
 * @param {string} args.kodoBin Path absoluto a `bin/kodo`. Primer elemento del argv.
 * @param {number} [args.timeoutMs=60000] El launch crea el workspace, lo colorea, resuelve su UUID
 *   y teclea el comando `claude`: varios round-trips a cmux. 60 s cubre un cmux lento sin dejar
 *   la tecla colgada para siempre.
 * @returns {Promise<OrchestrateResult>}
 */
export function runOrchestrate({ exec, execPath, kodoBin, timeoutMs = 60_000 }) {
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runOrchestrate: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      exec(execPath, [kodoBin, 'orchestrate'], { timeout: timeoutMs }, (err, _stdout, stderr) => {
        if (!err) {
          resolve({ ok: true });
          return;
        }
        if (err.code === 'ENOENT') {
          resolve({ ok: false, code: 'ENOENT', detail: err.message ?? 'ENOENT' });
          return;
        }
        if (typeof err.code === 'number') {
          resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: err.code, stderr: String(stderr ?? '').trim() });
          return;
        }
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      // exec lanzó SÍNCRONAMENTE — never-throws: NUNCA se rechaza la promise.
      resolve({ ok: false, code: 'SPAWN_ERROR', detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
