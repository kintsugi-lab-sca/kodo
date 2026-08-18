// @ts-check
//
// src/cli/capture.js — Action handler de `kodo capture` (Phase 83 Plan 02).
//
// Responsabilidades (83-CONTEXT §D-13, D-15, D-16, D-17; contratos 4, 6 y 7):
//   1. Gate: texto vacío tras el saneo → exit 2 + stderr canónico y CERO escritura (contrato 4).
//   2. Derivar la identidad de la captura: id corto, fecha local, tag del cwd y origen.
//   3. Delegar en `appendCapture` — la lógica vive en `src/inbox/store.js` (SoSoT). Este fichero
//      es un THIN handler: argv → resolver → delegar → renderizar.
//   4. Exit codes: 0 (ok, incluido el fail-open) — 1 (error de filesystem) — 2 (texto vacío).
//
// Invariante de retorno (D-07 del repo, precedente `skill-sync.js:44-49`): este handler NUNCA
// invoca el helper de salida del runtime — RETORNA el código. El registro de commander en
// `src/cli.js` es quien hace el exit con ese valor.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de color
// directamente — solo `createFormatter`. Blindado por `test/format-isolation.test.js`.
//
// Invariante del seam (CAPT-04 / D-09): el enrutado de una captura es competencia exclusiva del
// skill de enrutado y el seam es DOCUMENTAL. Este fichero no importa el módulo de procesos hijo
// de Node y no ejecuta ningún proceso externo. Blindado por el gate source-hygiene de
// `test/inbox-cli.test.js`.
//
// NOTA: este handler NO invoca la comprobación de configuración de proveedor. El inbox es
// filesystem local (`~/.kodo/inbox.md`) y no toca ningún provider — mismo precedente que
// `skill sync`, `gsd doctor` y `sidebar doctor` (ver `src/cli.js`).

import { loadProjects } from '../config.js';
import {
  MAX_TEXT_LEN,
  appendCapture,
  defaultInboxPaths,
  deriveTag,
  encodeLine,
  newCaptureId,
  todayLocal,
} from '../inbox/store.js';
import { createFormatter } from './format.js';
import { stripForKeystroke } from './sanitize.js';

/**
 * Opciones de invocación (lo que commander normaliza desde argv).
 *
 * D-17: NO existe ninguna opción `--project` de override — el tag-proyecto se deriva
 * EXCLUSIVAMENTE del cwd (D-15). La superficie no se amplía.
 *
 * @typedef {{ text?: string, origin?: string }} RunCaptureCliOpts
 */

/**
 * Dependencias inyectables. Todas OPCIONALES con su default resuelto en el cuerpo.
 *
 * La DI de `idFn` y `clockFn` es lo que hace este handler testeable sin reloj real ni entropía:
 * con ambos fijados, la línea producida es byte-determinista.
 *
 * @typedef {{
 *   appendFn?: typeof appendCapture,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   cwdFn?: () => string,
 *   projectsFn?: () => Record<string, unknown>,
 *   idFn?: () => string,
 *   clockFn?: () => string,
 *   pathsFn?: () => { inboxPath: string, lockPath: string },
 * }} RunCaptureCliDeps
 */

/** Mensaje canónico del gate de texto vacío (contrato 4). */
const EMPTY_TEXT_MSG = 'Error: capture text is empty after sanitization\n';

/** Vocabulario del campo origen (D-16). El default es `cli`; Phase 84 shellea con `skill`. */
const DEFAULT_ORIGIN = 'cli';

/**
 * Captura una idea al inbox.
 *
 * @param {RunCaptureCliOpts} opts
 * @param {RunCaptureCliDeps} [deps]
 * @returns {number} exit code (D-13): 0 ok · 1 error de filesystem · 2 texto vacío tras el saneo.
 */
export function runCaptureCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const appendFn = deps.appendFn || appendCapture;
  const cwdFn = deps.cwdFn || (() => process.cwd());
  const projectsFn = deps.projectsFn || loadProjects;
  const idFn = deps.idFn || newCaptureId;
  const clockFn = deps.clockFn || todayLocal;
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  // 1. Saneo + gate (contrato 4, Pitfall 8). `stripForKeystroke` coacciona con `String(s)`, así
  //    que un `text` ausente produciría la cadena literal `undefined`: se normaliza ANTES.
  //    `trim()` cubre también U+2028/U+2029, que son LineTerminator para el motor.
  const rawText = typeof opts.text === 'string' ? opts.text : '';
  const text = stripForKeystroke(rawText).trim();
  if (text === '') {
    err(EMPTY_TEXT_MSG);
    return 2;
  }

  // 2. Cota de longitud: `encodeLine` recorta; aquí solo se AVISA. La idea nunca se pierde por
  //    ser larga, así que el exit code no cambia (Pitfall 1).
  if (text.length > MAX_TEXT_LEN) {
    err(`[kodo:inbox] texto recortado a ${MAX_TEXT_LEN} caracteres\n`);
  }

  // 3. Identidad de la captura. El tag sale del cwd por nearest-ancestor y cae a basename(cwd)
  //    tanto sin match como ante un match ambiguo (D-15, Pitfall 3 — resuelto en `deriveTag`).
  const tag = deriveTag(cwdFn(), projectsFn());
  const date = clockFn();
  const id = idFn();
  const rawOrigin = typeof opts.origin === 'string' ? opts.origin.trim() : '';
  const origin = rawOrigin === '' ? DEFAULT_ORIGIN : rawOrigin;

  // 4. Una captura NACE abierta y sin cierre: `estado`/`dest` son competencia de `route`/`discard`.
  const line = encodeLine({ id, text, tag, date, origin, open: true, estado: null, dest: null }) + '\n';

  // 5. Los paths se resuelven en el CALL-SITE del handler (contrato 7): el store nunca los conoce
  //    por su cuenta, y así el carril unit puede inyectarlos sin tocar HOME (Pitfall 5).
  //    El seam de salida de error viaja CON los paths (WR-08): el aviso del fail-open es la única
  //    señal que el operador recibe cuando su captura se escribió sin coordinación, y desde que el
  //    Plan 83-04 devolvió el presupuesto de reintentos al default de la primitiva esa rama vuelve
  //    a ser alcanzable en producción — así que tiene que salir por el mismo canal inyectable que
  //    el resto de la salida de error del handler, no escribiendo directo al stream del proceso.
  const { inboxPath, lockPath } = pathsFn();
  /** @type {{ ok: true, coordinated: boolean } | { ok: false, reason: string }} */
  let result;
  try {
    result = appendFn(line, { inboxPath, lockPath, warnFn: err });
  } catch (e) {
    err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
    return 1;
  }

  // 6. Mapeo a exit code. `coordinated:false` es la rama de FAIL-OPEN (D-03): la captura SÍ se
  //    escribió, así que el código es 0 — y el handler NO añade ningún mensaje, porque el warn
  //    accionable ya lo emitió `appendCapture` (contrato 6: exactamente UN warn).
  if (!result.ok) {
    err('Error: filesystem error: no se pudo escribir el inbox\n');
    return 1;
  }

  const fmt = formatterFn();
  write(`${fmt.ok(`Capturado ${id}`)} ${fmt.dim(`— kodo inbox route ${id}`)}\n`);
  return 0;
}
