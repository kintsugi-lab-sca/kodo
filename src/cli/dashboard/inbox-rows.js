// @ts-check
//
// src/cli/dashboard/inbox-rows.js — KODO-76.
//
// Leaf never-throws que lee `~/.kodo/inbox.md` y devuelve las capturas ya proyectadas a lo que la
// pantalla del inbox pinta: titular, cuerpo, proyecto, fecha, origen, estado.
//
// ## Por qué SÍ importa `src/inbox/store.js` (y `inbox-count.js` sigue sin poder)
//
// La prohibición documentada en `inbox-count.js` es SUYA, no del directorio: ese módulo «solo
// tiene que contar líneas» y arrastrar `withFileLock` + `resolveProjectId` a un contador sería
// desproporcionado. Aquí no: esta pantalla lista, marca y reasigna capturas, así que el store ES
// su dependencia natural, y reimplementar el parser para evitarlo produciría el segundo parser
// del formato — exactamente el drift que aquel módulo neutraliza con un test anti-drift.
//
// La invariante que SÍ es del directorio (color-isolation, Phase 34 D-12) se respeta: `store.js`
// no alcanza `picocolors` por ningún camino desde la Phase 87, y el walker de
// `test/format-isolation.test.js` lo mide sobre la clausura de cada fichero de `dashboard/**`.
//
// ## Cadencia
//
// NO se invoca por render. La pantalla congela un SNAPSHOT al abrirse (molde de los overlays de
// Phase 39): el fichero se lee una vez por apertura y una vez por acción que lo modifique. Un
// `readFileSync` en el cuerpo del render, como el del contador, es barato porque devuelve un
// número; devolver un array de objetos en cada pulsación de tecla no lo es.

import { deriveHeadline } from '../../inbox/headline.js';
import { defaultInboxPaths, listCaptures } from '../../inbox/store.js';
import { stripControlChars } from '../sanitize.js';

/**
 * @typedef {{
 *   id: string,
 *   headline: string,
 *   text: string,
 *   tag: string,
 *   date: string,
 *   origin: string,
 *   open: boolean,
 *   estado: string | null,
 *   dest: string | null,
 * }} InboxRow
 */

/**
 * Lee el inbox y proyecta sus capturas a filas de pantalla.
 *
 * Todo campo que viene del FICHERO pasa por `stripControlChars` aquí, en el borde: el inbox es
 * human-editable por diseño y una línea pegada a mano con OSC-52 se ejecutaría en el terminal del
 * operador al pintarla. Sanearlo en la lectura —y no en cada punto de pintado— es lo que hace que
 * no se pueda olvidar en uno de ellos. El id y la fecha no lo necesitan: el parser los restringe
 * a alfabetos sin controles.
 *
 * Never-throws → `[]`. Un inbox ausente es el estado inicial normal, no un error.
 *
 * @param {{ all?: boolean, listFn?: typeof listCaptures, pathsFn?: () => { inboxPath: string } }} [deps]
 *   `all` incluye las cerradas (la traza); por defecto solo las abiertas.
 * @returns {InboxRow[]}
 */
export function readInboxRows(deps = {}) {
  try {
    const listFn = deps.listFn || listCaptures;
    const pathsFn = deps.pathsFn || defaultInboxPaths;
    const { inboxPath } = pathsFn();
    const { captures } = listFn({ inboxPath });
    const rows = deps.all === true ? captures : captures.filter((c) => c.open === true);
    return rows.map((c) => {
      const text = stripControlChars(c.text);
      return {
        id: c.id,
        headline: deriveHeadline(text),
        text,
        tag: stripControlChars(c.tag),
        date: c.date,
        origin: stripControlChars(c.origin),
        open: c.open,
        estado: c.estado,
        dest: c.dest === null ? null : stripControlChars(c.dest),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Envuelve un texto de una sola línea a un ancho dado, sin partir palabras salvo que una sola
 * palabra no quepa (una URL larga, un stack trace).
 *
 * Existe porque el panel de detalle NO puede delegar el envoltorio en ink: necesita saber CUÁNTAS
 * líneas ocupa el texto para decidir cuántas filas de la lista caben encima, y eso solo se sabe
 * habiéndolas contado.
 *
 * @param {string} text
 * @param {number} width Columnas disponibles. ≤ 0 → se devuelve el texto sin envolver.
 * @returns {string[]} Al menos un elemento (cadena vacía si no hay texto).
 */
export function wrapText(text, width) {
  const s = typeof text === 'string' ? text : '';
  if (!Number.isInteger(width) || width <= 0) return [s];
  /** @type {string[]} */
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ' ' + word;
    } else {
      out.push(line);
      line = word;
    }
    // Palabra más larga que el ancho: se trocea duro, porque respetar el límite de palabra
    // desbordaría la columna y el desbordamiento rompe el layout entero, no solo esa línea.
    while (line.length > width) {
      out.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  out.push(line);
  return out;
}
