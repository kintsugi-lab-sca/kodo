// @ts-check
//
// src/cli/inbox.js — Action handlers de `kodo inbox` y de sus subcomandos (Phase 83 Plan 02).
//
// Responsabilidades (83-CONTEXT §D-09..D-14, D-18; contrato 3):
//   1. `runInboxListCli` — listado de capturas: abiertas por defecto, todas con `--all`.
//      Render human coloreado via `createFormatter`, o una línea de JSON con `--json`.
//   2. `runInboxMarkCli` — cierre de una captura (`enrutada` / `descartada`) delegando en
//      `markCapture`; mapea sus cuatro `reason` a los exit codes de D-13.
//   3. Exit codes: listado 0 SIEMPRE (never-throws, D-18) — marcado 0 ok · 1 lock-timeout o
//      error de filesystem · 2 id inexistente o captura ya cerrada.
//
// EL SEAM DE ENRUTADO ES DOCUMENTAL (D-09 / CAPT-04). kodo NO decide, NO valida y NO ejecuta el
// destino de una captura. El flujo del operador es de TRES pasos manuales y desacoplados:
//
//     1. `kodo inbox`                    → ver las capturas abiertas y copiar el id corto
//     2. (fuera de kodo) el operador o el LLM en sesión enruta la idea a donde toque
//     3. `kodo inbox route <id> --dest <ref>` → dejar el trace pointer de vuelta en el inbox
//
// Cero acoplamiento y cero drift: este fichero no importa el módulo de procesos hijo de Node, no
// ejecuta ningún proceso externo y no importa ninguna ruta del skill de enrutado. Blindado por el
// gate source-hygiene de `test/inbox-cli.test.js`, anclado al patrón de IMPORT.
//
// Invariante de retorno (D-07 del repo, precedente `skill-sync.js:44-49`): estos handlers NUNCA
// invocan el helper de salida del runtime — RETORNAN el código. El registro de commander en
// `src/cli.js` es quien hace el exit.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de color
// directamente — solo `createFormatter`. Blindado por `test/format-isolation.test.js`.
//
// NOTA: no invoca la comprobación de configuración de proveedor. El inbox es filesystem local
// (`~/.kodo/inbox.md`) y no toca ningún provider — mismo precedente que `skill sync`,
// `gsd doctor` y `sidebar doctor` (ver `src/cli.js`).

import { defaultInboxPaths, listCaptures, markCapture } from '../inbox/store.js';
import { createFormatter, stripControlChars } from './format.js';

/**
 * Opciones del listado.
 *
 * D-14: NO existen `--project` ni `--open` ni ningún otro filtro. CAPT-F1 («filtrar el inbox»)
 * está DIFERIDO a v2 — «solo cuando el inbox tenga volumen real». La superficie no se adelanta.
 *
 * @typedef {{ all?: boolean, json?: boolean }} RunInboxListCliOpts
 */

/**
 * @typedef {{
 *   listFn?: typeof listCaptures,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   pathsFn?: () => { inboxPath: string, lockPath: string },
 * }} RunInboxListCliDeps
 */

/**
 * @typedef {{
 *   markFn?: typeof markCapture,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   pathsFn?: () => { inboxPath: string, lockPath: string },
 * }} RunInboxMarkCliDeps
 */

/**
 * Lista las capturas del inbox.
 *
 * @param {RunInboxListCliOpts} opts
 * @param {RunInboxListCliDeps} [deps]
 * @returns {number} SIEMPRE 0 (D-18: el listado nunca es una condición de error).
 */
export function runInboxListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const listFn = deps.listFn || listCaptures;
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  try {
    // 1. Los paths se resuelven en el CALL-SITE (contrato 7). `listCaptures` es un leaf
    //    never-throws: un fichero ausente es el estado inicial normal, no un error.
    const { inboxPath } = pathsFn();
    const { captures, unparsed } = listFn({ inboxPath });

    // 2. Filtrado. El checkbox es la AUTORIDAD de abierta/cerrada (D-05).
    const rows = opts.all === true ? captures : captures.filter((c) => c.open === true);
    const openCount = captures.filter((c) => c.open === true).length;

    // 3. Rama `--json` PRIMERO, antes de instanciar el formatter: así el carril máquina no puede
    //    contaminarse con ANSI por construcción, no solo por convención (DX-06 byte-determinismo).
    //    El texto va VERBATIM: es el carril de scripting y `JSON.stringify` ya escapa todo byte
    //    de control C0 a `\uXXXX`, dejándolo inerte. El saneo agresivo vive en el render human,
    //    que es el que llega al terminal del operador (T-83-09).
    if (opts.json === true) {
      /** @type {{ open: number, unparsed: number, captures: Record<string, unknown>[] }} */
      const payload = {
        open: openCount,
        unparsed,
        captures: rows.map((c) => {
          /** @type {Record<string, unknown>} */
          const o = {
            id: c.id,
            text: c.text,
            tag: c.tag,
            date: c.date,
            origin: c.origin,
            open: c.open,
          };
          // Claves opcionales añadidas condicionalmente y en orden FIJO (molde `skill-sync.js:92`).
          if (opts.all === true) {
            o.estado = c.estado;
            o.dest = c.dest;
          }
          return o;
        }),
      };
      write(JSON.stringify(payload) + '\n');
      return 0;
    }

    renderHuman(rows, { all: opts.all === true, unparsed, total: captures.length }, write, formatterFn());
    return 0;
  } catch (e) {
    // Cinturón de seguridad de D-18: ni siquiera un fallo del render puede convertir un listado
    // en un exit distinto de 0. El operador ve el aviso, pero el comando no «falla».
    err(`[kodo:inbox] no se pudo renderizar el listado: ${/** @type {Error} */ (e).message}\n`);
    return 0;
  }
}

/**
 * Etiqueta de estado de una captura para el modo `--all`.
 *
 * Contrato 2: una línea hand-editada a `- [x]` SIN sufijo llega con `estado: null`. El checkbox
 * manda, así que se muestra como cerrada con cierre DESCONOCIDO — nunca como abierta.
 *
 * @private
 * @param {import('../inbox/store.js').Capture} c
 * @returns {string}
 */
function estadoLabel(c) {
  if (c.open === true) return 'abierta';
  if (c.estado === 'enrutada') {
    const dest = c.dest === null ? '' : stripControlChars(c.dest).trim();
    return dest === '' ? 'enrutada' : `enrutada → ${dest}`;
  }
  if (c.estado === 'descartada') return 'descartada';
  return 'cerrada (desconocido)';
}

/**
 * Render TTY (human-readable). NO se invoca para `--json` — la rama se separa antes para
 * garantizar bytes deterministas.
 *
 * SANEO DEL CARRIL DE RENDER (Pitfall 6 / T-83-09): el texto, el tag y el destino se pasan por
 * `stripControlChars` ANTES de pintarlos. El saneo del carril de ESCRITURA no basta, porque
 * `~/.kodo/inbox.md` es human-editable POR DISEÑO: una línea con OSC-52 pegada a mano se
 * ejecutaría en el terminal del operador (escritura a su portapapeles) al hacer `kodo inbox`.
 * El id y la fecha no lo necesitan — el parser los restringe a `[0-9a-z]+` y a `\d{4}-\d{2}-\d{2}`.
 *
 * Las filas NO se numeran a propósito: el handle que el operador copia para `route`/`discard` es
 * el ID CORTO, y numerar induciría a usar el número de fila como handle (que no es estable entre
 * invocaciones, porque el filtro por defecto cambia con cada cierre).
 *
 * @private
 * @param {import('../inbox/store.js').Capture[]} rows
 * @param {{ all: boolean, unparsed: number, total: number }} meta
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 */
function renderHuman(rows, meta, write, fmt) {
  if (rows.length === 0) {
    if (meta.total === 0) {
      write(`${fmt.dim('El inbox está vacío.')} Captura una idea con: kodo capture "una idea"\n`);
    } else {
      write(
        `${fmt.dim('No hay capturas abiertas.')} Usa ${fmt.cyan('kodo inbox --all')} para ver la traza.\n`,
      );
    }
  } else {
    const table = rows.map((c) => {
      const cells = [
        fmt.cyan(c.id),
        stripControlChars(c.text),
        fmt.dim(stripControlChars(c.tag)),
        fmt.dim(c.date),
      ];
      if (meta.all) cells.push(fmt.gray(estadoLabel(c)));
      return cells;
    });
    write(fmt.formatTable(table) + '\n');
  }

  if (meta.unparsed > 0) {
    const n = meta.unparsed;
    write(
      `${fmt.yellow(`${n} línea${n === 1 ? '' : 's'} no parseable${n === 1 ? '' : 's'}`)} ` +
        `omitida${n === 1 ? '' : 's'} del listado y conservada${n === 1 ? '' : 's'} en el fichero\n`,
    );
  }
}

/**
 * Cierra una captura por id: `enrutada` (con trace pointer opcional) o `descartada`.
 *
 * @param {string} id
 * @param {'enrutada' | 'descartada'} estado
 * @param {{ dest?: string }} opts — `dest` es el TRACE POINTER: una string LIBRE y OPACA.
 *   Se pasa TAL CUAL al store, que la sanea y la recorta a su cota. Este handler NO comprueba
 *   que el destino exista, NO lo resuelve contra el filesystem y NO interpreta su forma: el «a
 *   dónde va» es competencia exclusiva del skill de enrutado (D-11 / CAPT-04). Sin `dest` el
 *   marcado se aplica igual y devuelve 0 — el best-effort literal de CAPT-06 (D-10).
 * @param {RunInboxMarkCliDeps} [deps]
 * @returns {number} exit code (D-13): 0 ok · 1 lock-timeout o fs · 2 not-found o already-closed.
 */
export function runInboxMarkCli(id, estado, opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const markFn = deps.markFn || markCapture;
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  // El id llega de argv y se pinta en los mensajes: se sanea para el render (nunca para el
  // matcheo, que va verbatim contra la línea). No se compone ningún path a partir de él —
  // los paths salen de `pathsFn()`, del home y de dos basenames fijos (T-83-10).
  const safeId = stripControlChars(id);

  const { inboxPath, lockPath } = pathsFn();

  /** @type {{ ok: true, capture: any } | { ok: false, reason: string }} */
  let result;
  try {
    result = markFn(id, estado, { dest: opts.dest ?? null, inboxPath, lockPath });
  } catch (e) {
    err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
    return 1;
  }

  if (result.ok) {
    const fmt = formatterFn();
    write(`${fmt.ok(`Captura ${safeId} ${estadoLabel(result.capture)}`)}\n`);
    return 0;
  }

  // Mapeo de los cuatro `reason` del store (D-13 + contrato 3). `lock-timeout` NO hace fail-open:
  // un marcado sin coordinación reintroduce el lost-update que D-01 cierra, así que se reporta
  // como fallo reintentable y el fichero queda intacto.
  switch (result.reason) {
    case 'not-found':
      err(`Error: capture ${safeId} not found\n`);
      return 2;
    case 'already-closed':
      err(`Error: capture ${safeId} is already closed\n`);
      return 2;
    case 'lock-timeout':
      err(
        `Error: lock-timeout — el marcado de ${safeId} NO se ha aplicado; reinténtalo en unos segundos\n`,
      );
      return 1;
    default:
      err(`Error: filesystem error: no se pudo marcar la captura ${safeId}\n`);
      return 1;
  }
}
