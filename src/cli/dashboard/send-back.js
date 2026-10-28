// @ts-check
//
// src/cli/dashboard/send-back.js — KODO-109.
//
// Shell never-throws de `kodo send-back <ref> --text <feedback> --json`, la acción `b` del
// dashboard. Clon estructural de `inbox-actions.js` y por las mismas razones: el TUI no importa el
// provider ni la config, y hay UN solo camino a la devolución (el del CLI), con un solo juego de
// exit codes.
//
// `exec` SIN default (leak guard estructural): omitirlo produce un TypeError visible en vez de
// degradar silenciosamente al `execFile` real dentro de un test.
//
// Color-isolation (Phase 34 D-12): este módulo no importa nada.

/**
 * @typedef {{ ok: true, stdout: string }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail: any, stderr?: string }
 * } SendBackActionResult
 */

/**
 * @param {object} args
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} args.exec
 * @param {string} args.execPath Ejecutable node (= `process.execPath`).
 * @param {string} args.kodoBin Path absoluto a `bin/kodo`. Primer elemento del argv.
 * @param {string} args.ref task_ref de la fila.
 * @param {string} args.text Feedback tecleado por el operador.
 * @param {number} [args.timeoutMs=20000] Tres llamadas de red (getTask, comentario, move).
 * @returns {Promise<SendBackActionResult>}
 */
export function runSendBack({ exec, execPath, kodoBin, ref, text, timeoutMs = 20_000 }) {
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runSendBack: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      // argv LITERAL: el feedback va como valor de `--text`, así que uno que empiece por `-` se
      // consume como valor y nunca como flag. execFile sin shell → metacaracteres inertes.
      const argv = [kodoBin, 'send-back', ref, '--text', text, '--json'];
      exec(execPath, argv, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (!err) {
          resolve({ ok: true, stdout: String(stdout ?? '') });
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
      resolve({ ok: false, code: 'SPAWN_ERROR', detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
