// @ts-check
//
// src/cli/dashboard/inbox-actions.js — KODO-76.
//
// Shell never-throws de las tres acciones que la pantalla del inbox ejecuta sobre una captura:
// `kodo inbox promote`, `kodo inbox discard` y `kodo inbox retag`.
//
// Clon estructural de `adopt.js` / `open.js` / `focus.js` — mismas propiedades y por las mismas
// razones. Las divergencias:
//
//   1. TRES verbos, un solo runner. Los tres son `kodo inbox <verbo> <id> [args]` con el mismo
//      contrato de exit codes y el mismo `--json` final, así que darles un runner cada uno sería
//      tres copias del mismo bloque de exec con el argv cambiado.
//   2. El binario es `process.execPath` (node) con `kodoBin` como primer argv, NO un ejecutable
//      directo: `bin/kodo` es un script `#!/usr/bin/env node` (Pitfall 4 de Phase 56). Cero
//      lookup por PATH.
//   3. `exec` SIN default (leak guard ESTRUCTURAL): omitirlo produce un TypeError visible en vez
//      de degradar silenciosamente al `execFile` real dentro de un test.
//
// ## Por qué la pantalla shellea el CLI en vez de llamar al núcleo
//
// Porque la alternativa es meter el proveedor —y con él la red, la config y el paquete de
// color— en el grafo del TUI. La promoción vive en `src/inbox/promote.js` y el TUI la alcanza por
// donde ya alcanza `adopt`: un proceso hijo con argv literal. Además así hay UN solo camino a
// la promoción, con un solo juego de exit codes, y la pantalla no puede divergir del CLI.
//
// Color-isolation (Phase 34 D-12): este módulo importa SOLO tipos. El mapeo de `code` → copy
// vive en `InboxScreen.js`.

/**
 * Resultado discriminado, espejo del union de `AdoptResult`.
 *
 * @typedef {{ ok: true, stdout: string }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail: any, stderr?: string }
 * } InboxActionResult
 */

/**
 * Invoca `kodo inbox <verb> …` vía el `exec` inyectado. NEVER-THROWS.
 *
 * @param {object} args
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} args.exec
 *   execFile-shaped. SIN default — leak guard estructural.
 * @param {string} args.execPath Ejecutable node (= `process.execPath`).
 * @param {string} args.kodoBin Path absoluto a `bin/kodo`. Primer elemento del argv.
 * @param {'promote' | 'discard' | 'retag'} args.verb
 * @param {string} args.id Id corto de la captura.
 * @param {string} [args.project] Solo `promote`: proyecto de destino → `--project <ref>`.
 * @param {string} [args.tag] Solo `retag`: nuevo tag, POSICIONAL (`kodo inbox retag <id> <tag>`).
 * @param {number} [args.timeoutMs=20000] `promote` hace un POST a la red: 20 s, no los 5 s de
 *   adopt. Un adopt colgado tapa la UI; una promoción abortada a los 5 s por una red lenta
 *   dejaría al operador sin saber si la tarea se creó, que es peor que esperar.
 * @returns {Promise<InboxActionResult>}
 */
export function runInboxAction({ exec, execPath, kodoBin, verb, id, project, tag, timeoutMs = 20_000 }) {
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runInboxAction: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      // argv LITERAL. Cada valor va precedido de su flag explícita, o es un posicional en una
      // posición fija: un id o un tag que empiece por `-` se consume como valor, nunca como flag.
      // execFile sin shell → los metacaracteres son inertes sin comillas.
      const argv = [kodoBin, 'inbox', verb, id];
      if (verb === 'retag' && typeof tag === 'string') argv.push(tag);
      if (verb === 'promote') {
        if (typeof project === 'string' && project !== '') argv.push('--project', project);
        // `--json` al final: la rama JSON del handler emite el discriminante sin color, así que
        // el caller puede leer la ref creada en vez de adivinarla.
        argv.push('--json');
      }

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
          // El stderr acompaña al código porque los mensajes del CLI son accionables (llevan el
          // comando exacto de recuperación); tirarlos dejaría al operador con un número.
          resolve({
            ok: false,
            code: 'NON_ZERO_EXIT',
            detail: err.code,
            stderr: String(stderr ?? '').trim(),
          });
          return;
        }
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      // exec lanzó SÍNCRONAMENTE — never-throws: NUNCA se rechaza la promise.
      resolve({
        ok: false,
        code: 'SPAWN_ERROR',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Extrae la ref de la tarea creada del stdout `--json` de `kodo inbox promote`.
 *
 * DEFENSIVO por contrato: un stdout que no parsea, o que no lleva `ref`, devuelve `''` y la copy
 * del footer degrada a un mensaje sin ref. Un fallo de parseo jamás puede tumbar el árbol de ink.
 *
 * @param {string} stdout
 * @returns {string}
 */
export function parsePromotedRef(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed.ref === 'string' ? parsed.ref : '';
  } catch {
    return '';
  }
}
