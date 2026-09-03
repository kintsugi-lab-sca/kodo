// @ts-check
//
// src/inbox/headline.js — KODO-76.
//
// Deriva un TITULAR legible del texto de una captura. Leaf PURO: sin I/O, sin estado, sin color,
// sin dependencias (ni siquiera de `node:*`). Puede importarlo tanto el TUI (color-isolation,
// Phase 34 D-12) como el CLI y el promotor.
//
// ## Por qué existe
//
// `kodo capture` persiste el texto VERBATIM hasta `MAX_TEXT_LEN` (1000 chars) y el operador
// captura párrafos de diagnóstico enteros — en el inbox real de hoy hay capturas de 700+ chars.
// Cualquier superficie que enseñe una LISTA (el dashboard, `kodo inbox`) tiene que elegir qué
// trozo de esos 700 chars pinta, y hasta KODO-76 la respuesta era «los primeros N, cortados por
// donde caiga». Eso es lo que hacía que los titulares no se entendieran: el corte caía a mitad de
// palabra y, peor, a mitad de la ORACIÓN DE CONTEXTO, antes de llegar a lo que la captura decía.
//
// ## La heurística, y por qué esta
//
// Una captura del operador tiene, en la práctica, forma de `<tesis>: <desarrollo>` o
// `<tesis>. <desarrollo>`. La tesis es el titular. Medido sobre las 14 capturas reales del inbox
// del operador el 3-sep-2026: 9 tienen un `: ` dentro de la ventana útil y las 5 restantes no
// tienen ningún separador fuerte temprano (son una sola oración larga), que es exactamente el
// caso del recorte por longitud.
//
// El corte por separador NO lleva elipsis: es una unidad sintáctica completa, no un texto
// truncado. El corte por longitud SÍ la lleva (`…`, UN carácter — nunca `...`), porque ahí sí se
// está escondiendo texto. Esa distinción es la señal que le dice al operador si el detalle tiene
// algo más que leer.
//
// NO sanea. El texto ya salió saneado del writer (`sanitizeText`, una sola línea, sin controles)
// y los consumidores que proyectan al terminal vuelven a pasar por `stripControlChars` en su
// propio carril. Meter saneo aquí duplicaría la responsabilidad sin cerrar ningún hueco.

/** Ancho por defecto del titular, en caracteres. Cabe en la lista del dashboard sin envolver. */
export const HEADLINE_MAX = 72;

/**
 * Longitud mínima de un titular cortado por separador. Por debajo de esto el separador se IGNORA
 * y se busca el siguiente: `Bug daemon: provider.state.fetch.failed…` tiene su `: ` en el índice
 * 10, y «Bug daemon» no es un titular — es una etiqueta. El recorte por longitud informa más.
 */
const MIN_HEADLINE = 16;

/** Separadores fuertes, en orden de preferencia. Ambos exigen el espacio que los sigue. */
const BREAKS = [': ', '. '];

/**
 * Deriva el titular de una captura.
 *
 * 1. Primer separador fuerte (`: ` o `. `) cuyo corte caiga en `[MIN_HEADLINE, max]` → titular
 *    exacto, SIN elipsis.
 * 2. Texto que ya cabe en `max` → tal cual, SIN elipsis.
 * 3. Resto → recorte al último límite de palabra antes de `max`, MÁS `…`. Si no hay ningún
 *    espacio donde cortar (un token único larguísimo, p. ej. una URL), se corta duro en `max`:
 *    respetar el límite de palabra no puede desbordar la columna.
 *
 * Never-throws: cualquier entrada que no sea string colapsa a `''`.
 *
 * @param {unknown} text Texto de la captura (`Capture.text`).
 * @param {{ max?: number }} [opts] `max` = ancho del titular; default `HEADLINE_MAX`. Un `max`
 *   que no sea un entero positivo cae al default (defensa contra un ancho de terminal absurdo).
 * @returns {string} El titular. Cadena vacía si no hay texto.
 */
export function deriveHeadline(text, opts = {}) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (s === '') return '';

  const max =
    Number.isInteger(opts.max) && /** @type {number} */ (opts.max) > 0
      ? /** @type {number} */ (opts.max)
      : HEADLINE_MAX;

  // 1. Separador fuerte dentro de la ventana útil. Se busca el corte MÁS TEMPRANO que sea
  //    aceptable, no el más temprano a secas: un `: ` en el índice 3 no descalifica a un `. ` en
  //    el 40. Por eso el barrido es sobre TODAS las ocurrencias de ambos separadores.
  let best = -1;
  for (const brk of BREAKS) {
    let from = 0;
    for (;;) {
      const at = s.indexOf(brk, from);
      if (at === -1 || at > max) break;
      if (at >= MIN_HEADLINE) {
        if (best === -1 || at < best) best = at;
        break; // la primera aceptable de ESTE separador ya es la mejor candidata suya
      }
      from = at + brk.length;
    }
  }
  if (best !== -1) return s.slice(0, best).trimEnd();

  // 2. Ya cabe: verbatim, sin elipsis. El operador ve el texto ENTERO y sabe que no hay más.
  if (s.length <= max) return s;

  // 3. Recorte por longitud. El presupuesto es `max` INCLUIDA la elipsis (es un carácter que se
  //    pinta y ocupa columna), de ahí el `max - 1`.
  const budget = max - 1;
  const head = s.slice(0, budget);
  const lastSpace = head.lastIndexOf(' ');
  // Respetar el límite de palabra es lo normal, pero deja de serlo cuando desperdicia más de la
  // MITAD de la columna. Medido sobre las capturas reales: «Bug daemon: provider.state.fetch.failed
  // con project_id vacio…» a 40 columnas tiene su último espacio en el índice 11, así que el corte
  // por palabra daba «Bug daemon:…» — un titular que no dice nada, con 28 columnas en blanco al
  // lado. En ese caso el corte duro informa más, y la elipsis ya avisa de que hay más texto.
  const cut = lastSpace > budget / 2 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

/**
 * ¿El titular esconde texto? Es decir: ¿tiene el detalle algo que la lista no enseña?
 *
 * Lo decide comparando el titular con el texto completo TRIMEADO — no mirando si acaba en `…`,
 * porque un corte por separador tampoco lleva elipsis y sí esconde el desarrollo entero.
 *
 * @param {unknown} text
 * @param {{ max?: number }} [opts]
 * @returns {boolean}
 */
export function hasMore(text, opts = {}) {
  const s = typeof text === 'string' ? text.trim() : '';
  return s !== '' && deriveHeadline(s, opts) !== s;
}
