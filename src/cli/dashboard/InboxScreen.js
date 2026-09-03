// @ts-check
//
// src/cli/dashboard/InboxScreen.js — KODO-76.
//
// Pantalla dedicada del inbox de capturas: render + máquina de teclas + copy literal-estable.
// Molde de `AdoptPicker.js` (handlers que reciben un `ctx` con estado y setters) y de
// `renderAdoptPicker` (lista con cursor seleccionable, color solo por nombres de ink).
//
// ## Por qué una pantalla y no una sección
//
// Hasta aquí el inbox existía en el dashboard como un número amarillo en el header. Un número
// comunica PRESIÓN («hay 12 cosas sin triar») y nada más: no dice qué son, no deja actuar y, por
// tanto, no baja. Meter las capturas como una sección de la tabla de sesiones tampoco servía —
// son otra entidad, con otras columnas y otros verbos, y compartir el cursor con las sesiones
// habría hecho ambigua cada tecla. El número se queda donde está, ahora como puerta: dice cuántas
// hay y `i` abre dónde se triscan.
//
// ## Layout: lista arriba, DETALLE abajo
//
// La lista pinta el TITULAR; el panel de abajo, el texto íntegro de la captura bajo el cursor.
// Esa división es la respuesta directa a que «los titulares no se entienden»: el titular no tiene
// que contarlo todo si moverse una fila enseña el resto. El panel tiene una altura fija en
// líneas, así que el layout no salta al moverse entre una captura de una línea y una de doce.
//
// Color-isolation (Phase 34 D-12): todo el color sale de props de `<Text>` de ink. Cero
// picocolors, cero ANSI inline.

import { Box, Text } from 'ink';
import { createElement as h } from 'react';
import { deriveHeadline } from '../../inbox/headline.js';
import { listProjectRefs, resolveProjectRef } from '../../inbox/project-ref.js';
import { runInboxAction, parsePromotedRef } from './inbox-actions.js';
import { readInboxRows, wrapText } from './inbox-rows.js';

// ── Copy literal-estable ──────────────────────────────────────────────────────────────────
// La copy LITERAL es el contrato (los tests la importan y aseveran igualdad, molde ADOPT_*).
// Español, como las cadenas de Phase 62 en adelante.

export const INBOX_EMPTY = 'no hay capturas abiertas — captura una con: kodo capture "una idea"';
/** @param {string} id */
export const INBOX_PROMOTE_CONFIRM = (id) => `promover ${id} a tarea? pulsa p de nuevo · Esc cancela`;
/** @param {string} id */
export const INBOX_DISCARD_CONFIRM = (id) => `descartar ${id}? pulsa x de nuevo · Esc cancela`;
export const INBOX_PROMOTE_PROGRESS = 'creando la tarea…';
/** @param {string} ref */
export const INBOX_PROMOTE_OK = (ref) => (ref === '' ? 'tarea creada' : `tarea creada: ${ref}`);
/** @param {string} id */
export const INBOX_DISCARD_OK = (id) => `${id} descartada`;
/** @param {string} tag */
export const INBOX_RETAG_OK = (tag) => `proyecto reasignado a ${tag}`;
export const INBOX_NO_PROJECTS = '[!] no hay proyectos configurados — añádelos con m projects';
export const INBOX_ERR_ENOENT = '[!] kodo no encontrado — pulsa una tecla';
/** @param {string} detail */
export const inboxErrFailed = (detail) =>
  `[!] ${detail === '' ? 'la acción ha fallado' : detail} — pulsa una tecla`;

/** Altura fija del panel de detalle, en líneas de texto (sin contar su cabecera). */
export const DETAIL_LINES = 6;

/**
 * Abre la pantalla del inbox (tecla `i` en mode:'list').
 *
 * Congela un SNAPSHOT al abrir, igual que los overlays de lectura de Phase 39: el poll de
 * `/status` sigue corriendo por debajo y el fichero no se relee en cada render. Se recarga
 * explícitamente tras cada acción que lo modifique.
 *
 * Se abre SIEMPRE, también con el inbox vacío. Un `i` que a veces abre y a veces deja un mensaje
 * en el footer obliga al operador a recordar el estado antes de pulsar; y la pantalla vacía tiene
 * algo que decir (cómo capturar).
 *
 * @param {any} ctx
 */
export function openInboxScreen(ctx) {
  const rows = (ctx.readInboxRowsFn ?? readInboxRows)({ all: false });
  ctx.setInboxSnapshot({ rows, all: false });
  ctx.setInboxCursor(0);
  ctx.setInboxArmed(null);
  ctx.setMode('inbox');
}

/**
 * Recarga el snapshot conservando la posición del operador.
 *
 * El cursor se reancla por ID, no por índice: tras promover o descartar, la fila desaparece de la
 * lista y todos los índices por debajo se desplazan. Conservar el índice dejaría el cursor sobre
 * una captura distinta de la que el operador estaba mirando — la forma más fácil de descartar la
 * equivocada. Si la captura anclada ya no está (el caso normal tras una acción), el índice se
 * clampa a la lista nueva, que deja el cursor sobre la SIGUIENTE captura.
 *
 * @param {any} ctx
 * @param {string} anchorId Id sobre el que estaba el cursor antes de la acción.
 */
export function reloadInboxSnapshot(ctx, anchorId) {
  const all = ctx.inboxSnapshot?.all === true;
  const prevIndex = ctx.inboxCursor;
  const rows = (ctx.readInboxRowsFn ?? readInboxRows)({ all });
  const found = rows.findIndex((/** @type {any} */ r) => r.id === anchorId);
  const next = found >= 0 ? found : Math.min(prevIndex, Math.max(0, rows.length - 1));
  ctx.setInboxSnapshot({ rows, all });
  ctx.setInboxCursor(rows.length === 0 ? 0 : next);
}

/**
 * Máquina de teclas de `mode:'inbox'`.
 *
 * Teclas: ↑↓ mover · `p` promover (double-confirm) · `x` descartar (double-confirm) ·
 * `t` reasignar proyecto · `a` alternar abiertas/todas · Esc/`q` cerrar.
 *
 * El double-confirm es el mismo patrón que el dismiss de una sesión y el adopt de una surface, y
 * por la misma razón: `p` crea algo en un tablero compartido y `x` cierra una captura para
 * siempre (CAPT-03 prohíbe borrarla, pero reabrirla exige editar el markdown a mano). El armado
 * se guarda POR ID, no por índice, para que no pueda aplicarse a otra fila si la lista cambia
 * bajo el armado.
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export async function handleInboxInput(input, key, ctx) {
  const rows = ctx.inboxSnapshot?.rows ?? [];
  const row = rows[ctx.inboxCursor];

  // Esc: cancela el armado si lo hay; si no, cierra la pantalla. Un solo Esc no puede hacer las
  // dos cosas — cancelar y cerrar de golpe dejaría al operador sin saber si canceló o descartó.
  if (key.escape) {
    if (ctx.inboxArmed) {
      ctx.setInboxArmed(null);
      ctx.setInboxMessage(null);
      return;
    }
    closeInboxScreen(ctx);
    return;
  }

  if (key.upArrow) {
    ctx.setInboxArmed(null); // moverse DESARMA: el armado es de una fila concreta
    ctx.setInboxMessage(null);
    ctx.setInboxCursor((/** @type {number} */ i) => Math.max(0, i - 1));
    return;
  }
  if (key.downArrow) {
    ctx.setInboxArmed(null);
    ctx.setInboxMessage(null);
    ctx.setInboxCursor((/** @type {number} */ i) => Math.min(rows.length - 1, i + 1));
    return;
  }

  if (input === 'q') {
    closeInboxScreen(ctx);
    return;
  }

  // `a`: alterna abiertas ↔ todas. Reancla el cursor por id igual que la recarga post-acción.
  if (input === 'a') {
    const anchorId = row?.id ?? '';
    const all = ctx.inboxSnapshot?.all !== true;
    const next = (ctx.readInboxRowsFn ?? readInboxRows)({ all });
    const found = next.findIndex((/** @type {any} */ r) => r.id === anchorId);
    ctx.setInboxSnapshot({ rows: next, all });
    ctx.setInboxCursor(found >= 0 ? found : 0);
    ctx.setInboxArmed(null);
    ctx.setInboxMessage(null);
    return;
  }

  if (!row) return; // lista vacía: solo navegación y cierre

  // `t`: picker de proyecto para REASIGNAR. Sub-modo propio (no un text-input) porque el destino
  // válido es un conjunto cerrado y conocido — teclear un tag libre reintroduce justo el problema
  // que el retag existe para arreglar.
  if (input === 't') {
    openProjectPicker(ctx, 'retag');
    return;
  }

  // `x`: descarte con double-confirm.
  if (input === 'x') {
    if (ctx.inboxArmed?.action === 'discard' && ctx.inboxArmed.id === row.id) {
      await applyInboxAction(ctx, { verb: 'discard', row });
      return;
    }
    ctx.setInboxArmed({ action: 'discard', id: row.id });
    ctx.setInboxMessage({ text: INBOX_DISCARD_CONFIRM(row.id), color: 'cyan' });
    return;
  }

  // `p`: promoción con double-confirm. El proyecto de destino se resuelve ANTES de armar: si el
  // tag de la captura no mapea a ningún proyecto configurado, se abre el picker en vez de armar
  // una acción que fallaría en el shell. Fallar ANTES del confirm, no después.
  if (input === 'p') {
    if (ctx.inboxArmed?.action === 'promote' && ctx.inboxArmed.id === row.id) {
      await applyInboxAction(ctx, { verb: 'promote', row, project: ctx.inboxArmed.project });
      return;
    }
    const resolved = resolveProjectRef(row.tag, ctx.projects);
    if ('error' in resolved) {
      openProjectPicker(ctx, 'promote');
      return;
    }
    ctx.setInboxArmed({ action: 'promote', id: row.id, project: resolved.projectId });
    ctx.setInboxMessage({ text: INBOX_PROMOTE_CONFIRM(row.id), color: 'cyan' });
    return;
  }
}

/**
 * Máquina de teclas del sub-modo `mode:'inbox-project'` (picker de proyecto).
 *
 * Enter aplica: `retag` reasigna y vuelve a la lista; `promote` ARMA el confirm con el proyecto
 * elegido, sin promover — elegir el destino no es confirmar la creación.
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export async function handleInboxProjectInput(input, key, ctx) {
  const refs = ctx.inboxSnapshot?.projectRefs ?? [];
  if (key.escape || input === 'q') {
    ctx.setMode('inbox');
    ctx.setInboxMessage(null);
    return;
  }
  if (key.upArrow) {
    ctx.setInboxCursor((/** @type {number} */ i) => Math.max(0, i - 1));
    return;
  }
  if (key.downArrow) {
    ctx.setInboxCursor((/** @type {number} */ i) => Math.min(refs.length - 1, i + 1));
    return;
  }
  if (!key.return) return;

  const target = refs[ctx.inboxCursor];
  const row = ctx.inboxSnapshot?.pendingRow;
  if (!target || !row) {
    ctx.setMode('inbox');
    return;
  }

  if (ctx.inboxSnapshot?.pendingAction === 'retag') {
    await applyInboxAction(ctx, { verb: 'retag', row, tag: target.tag || target.projectId });
    return;
  }

  // promote: volver a la lista con el confirm ARMADO sobre el proyecto elegido.
  restoreInboxList(ctx, row.id);
  ctx.setInboxArmed({ action: 'promote', id: row.id, project: target.projectId });
  ctx.setInboxMessage({ text: INBOX_PROMOTE_CONFIRM(row.id), color: 'cyan' });
}

/**
 * Ejecuta una acción sobre la captura del cursor y refleja el desenlace en el footer.
 *
 * `promote` pinta un progreso propio antes del await: es la única acción con red y puede tardar
 * segundos, y sin señal el operador vuelve a pulsar `p` creyendo que no se registró.
 *
 * @param {any} ctx
 * @param {{ verb: 'promote'|'discard'|'retag', row: any, project?: string, tag?: string }} args
 */
async function applyInboxAction(ctx, { verb, row, project, tag }) {
  ctx.setInboxArmed(null);
  if (verb === 'promote') {
    ctx.setInboxMessage({ text: INBOX_PROMOTE_PROGRESS, color: 'cyan' });
  }

  const result = await ctx.onInboxAction?.({ verb, id: row.id, project, tag });

  // La lista se recarga SIEMPRE, también al fallar: un `promote` que falló al cerrar la captura
  // (MARK_FAILED) sí creó la tarea, y un snapshot obsoleto la enseñaría como si nada hubiera
  // pasado. El fichero es la autoridad, no lo que la acción devolvió.
  restoreInboxList(ctx, row.id);
  reloadInboxSnapshot(ctx, row.id);

  if (result?.ok === true) {
    const text =
      verb === 'promote'
        ? INBOX_PROMOTE_OK(parsePromotedRef(result.stdout))
        : verb === 'discard'
          ? INBOX_DISCARD_OK(row.id)
          : INBOX_RETAG_OK(String(tag ?? ''));
    ctx.setInboxMessage({ text, color: 'green' });
    return;
  }

  if (result?.code === 'ENOENT') {
    ctx.setInboxMessage({ text: INBOX_ERR_ENOENT, color: 'red' });
    return;
  }
  // El stderr del CLI ya trae el mensaje accionable (con el comando de recuperación cuando lo
  // hay). Se pinta su PRIMERA línea: el footer es una línea, y la primera es la que dice qué pasó.
  const stderr = String(result?.stderr ?? '').split('\n')[0].replace(/^Error:\s*/, '');
  ctx.setInboxMessage({ text: inboxErrFailed(stderr), color: 'red' });
}

/**
 * Abre el picker de proyecto sobre el sub-modo `inbox-project`, guardando en el snapshot qué fila
 * y qué acción lo abrieron. El cursor arranca sobre el proyecto que la captura ya tiene, si
 * mapea: reasignar suele ser mover a un vecino, no elegir a ciegas.
 *
 * @param {any} ctx
 * @param {'retag' | 'promote'} action
 */
function openProjectPicker(ctx, action) {
  const rows = ctx.inboxSnapshot?.rows ?? [];
  const row = rows[ctx.inboxCursor];
  const projectRefs = listProjectRefs(ctx.projects);
  if (projectRefs.length === 0) {
    ctx.setInboxMessage({ text: INBOX_NO_PROJECTS, color: 'red' });
    return;
  }
  const at = projectRefs.findIndex((p) => p.tag.toLowerCase() === String(row?.tag ?? '').toLowerCase());
  ctx.setInboxSnapshot({
    ...ctx.inboxSnapshot,
    projectRefs,
    pendingRow: row,
    pendingAction: action,
    listCursor: ctx.inboxCursor, // para volver a la fila exacta al cancelar
  });
  ctx.setInboxCursor(at >= 0 ? at : 0);
  ctx.setInboxArmed(null);
  ctx.setInboxMessage(null);
  ctx.setMode('inbox-project');
}

/**
 * Vuelve del picker a la lista, restaurando el cursor de la lista (que el picker reutiliza).
 *
 * @param {any} ctx
 * @param {string} anchorId
 */
function restoreInboxList(ctx, anchorId) {
  const rows = ctx.inboxSnapshot?.rows ?? [];
  const found = rows.findIndex((/** @type {any} */ r) => r.id === anchorId);
  ctx.setInboxCursor(found >= 0 ? found : (ctx.inboxSnapshot?.listCursor ?? 0));
  ctx.setMode('inbox');
}

/**
 * Cierra la pantalla y devuelve el foco a la lista de sesiones.
 *
 * @param {any} ctx
 */
function closeInboxScreen(ctx) {
  ctx.setInboxSnapshot(null);
  ctx.setInboxArmed(null);
  ctx.setInboxMessage(null);
  ctx.setMode('list');
}

/**
 * Runner de acciones cableado al shell de `kodo inbox …`. Vive aquí, y no en `index.js`, porque
 * es la traducción de UN verbo de esta pantalla a UN argv — mismo criterio por el que
 * `runAdopt` se cablea junto al handler que lo usa.
 *
 * @param {{ exec: any, execPath: string, kodoBin: string }} wiring
 * @returns {(args: { verb: any, id: string, project?: string, tag?: string }) => Promise<any>}
 */
export function makeInboxActionRunner({ exec, execPath, kodoBin }) {
  return ({ verb, id, project, tag }) =>
    runInboxAction({ exec, execPath, kodoBin, verb, id, project, tag });
}

// ── Render ────────────────────────────────────────────────────────────────────────────────

/**
 * Ancho útil por defecto, en columnas, cuando el caller no pasa uno. Es el mismo caso que cubre
 * `tableWidth: null` en la tabla de sesiones: fuera de un TTY (tests, pipes) no hay ancho real que
 * medir, y un número conservador da un layout legible en cualquier terminal de 80 columnas.
 */
const DEFAULT_WIDTH = 76;

/** Columnas reservadas a la metadata (proyecto · fecha · origen [· estado]). */
const META_WIDTH = 34;

/** Columnas del nombre de proyecto en el picker, antes de su ruta. */
const PICKER_NAME_WIDTH = 22;

/**
 * Render de la pantalla del inbox: lista con cursor + panel de detalle de altura fija.
 *
 * ## El layout es de COLUMNAS FIJAS, y eso es load-bearing
 *
 * La primera versión dejaba fluir titular y metadata en la misma línea. Sobre las capturas reales
 * el resultado era ilegible: la metadata quedaba pegada al final de cada titular, a una sangría
 * distinta en cada fila, y las filas largas envolvían perdiendo el gutter del cursor. Con anchos
 * fijos el proyecto y la fecha caen SIEMPRE en la misma columna, que es lo que permite escanear la
 * lista de arriba abajo en vez de leerla fila a fila.
 *
 * El titular se deriva AQUÍ, al ancho realmente disponible, y no se reusa el `headline` que trae
 * la fila: ese está derivado al ancho por defecto y en un terminal estrecho lo truncaría ink a
 * mitad de palabra, justo el corte que `deriveHeadline` existe para evitar.
 *
 * @param {any} snapshot Snapshot congelado (`{rows, all}`).
 * @param {number} cursor Índice seleccionado.
 * @param {{text: string, color: string}|null} message Confirm armado, progreso o desenlace.
 * @param {number|null} [width] Ancho útil en columnas (`tableWidth`); null fuera de un TTY.
 * @returns {import('react').ReactElement}
 */
export function renderInboxScreen(snapshot, cursor, message, width = null) {
  const rows = snapshot?.rows ?? [];
  const all = snapshot?.all === true;
  const total = Number.isInteger(width) && /** @type {number} */ (width) > 40 ? /** @type {number} */ (width) : DEFAULT_WIDTH;
  const headWidth = Math.max(20, total - META_WIDTH - 2);

  const header = h(
    Box,
    { flexDirection: 'row', marginBottom: 1 },
    h(Text, { color: 'yellow', bold: true }, 'inbox'),
    h(Text, { dimColor: true }, `   ${rows.length} ${all ? 'capturas (todas)' : 'sin enrutar'}`),
  );

  if (rows.length === 0) {
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Text, { dimColor: true }, INBOX_EMPTY),
      renderFooter(message, 'a todas · Esc close'),
    );
  }

  const list = rows.map((/** @type {any} */ r, /** @type {number} */ i) => {
    const selected = i === cursor;
    // El estado solo se pinta en la vista `--all`: en la de abiertas sería la misma palabra en
    // todas las filas, que es ruido con forma de columna.
    const estado = all ? ` · ${r.open ? 'abierta' : (r.estado ?? 'cerrada')}` : '';
    // `headWidth - 2` y no `headWidth`: la caja mide lo segundo, así que restar dos columnas es
    // lo que garantiza aire entre el titular más largo y la metadata. Sin ellas la elipsis queda
    // pegada al proyecto y las dos columnas se leen como una sola palabra.
    const headline = deriveHeadline(r.text || r.headline || '', { max: headWidth - 2 });
    return h(
      Box,
      { key: r.id, flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      // `wrap: 'truncate-end'` es el cinturón: `deriveHeadline` ya respeta el ancho, pero un
      // titular con caracteres de doble ancho lo desbordaría, y una fila que envuelve rompe la
      // alineación de TODAS las de abajo, no solo la suya.
      h(Box, { width: headWidth }, h(Text, { bold: selected, wrap: 'truncate-end' }, headline)),
      h(
        Box,
        { width: META_WIDTH },
        h(Text, { dimColor: true, wrap: 'truncate-end' }, `${r.tag} · ${r.date} · ${r.origin}${estado}`),
      ),
    );
  });

  return h(
    Box,
    { flexDirection: 'column' },
    header,
    h(Box, { flexDirection: 'column' }, ...list),
    renderDetail(rows[cursor], total),
    renderFooter(message, '↑↓ move · p a tarea · t proyecto · x descartar · a todas · Esc close'),
  );
}

/**
 * Panel de detalle: el texto ÍNTEGRO de la captura, envuelto a `DETAIL_LINES` líneas.
 *
 * La altura es FIJA para que la lista de arriba no se mueva al cambiar de fila. Un texto más
 * largo se corta con `…` en la última línea: el detalle es para leer la captura de un vistazo, y
 * quien necesite los 1000 chars enteros tiene `kodo inbox --full`.
 *
 * El envoltorio es NUESTRO y no de ink porque la altura fija exige contar las líneas antes de
 * pintarlas: dejar envolver a ink daría un panel de altura variable, que es justo lo que hace que
 * la lista salte al mover el cursor.
 *
 * @param {any} row
 * @param {number} width
 * @returns {import('react').ReactElement}
 */
function renderDetail(row, width) {
  const lines = wrapText(row?.text ?? '', width);
  const shown = lines.slice(0, DETAIL_LINES);
  if (lines.length > DETAIL_LINES && shown.length > 0) {
    shown[shown.length - 1] = shown[shown.length - 1] + ' …';
  }
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Text, { dimColor: true }, `${row?.id ?? ''} · detalle`),
    ...shown.map((/** @type {string} */ l, /** @type {number} */ i) =>
      h(Text, { key: `d-${i}` }, l),
    ),
  );
}

/**
 * Render del picker de proyecto (`mode:'inbox-project'`). Molde exacto de `renderAdoptPicker`.
 *
 * @param {any} snapshot
 * @param {number} cursor
 * @param {{text: string, color: string}|null} message
 * @returns {import('react').ReactElement}
 */
export function renderInboxProjectPicker(snapshot, cursor, message) {
  const refs = snapshot?.projectRefs ?? [];
  const verb = snapshot?.pendingAction === 'promote' ? 'crear la tarea en' : 'reasignar a';
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, `${verb}…`),
  );
  const list = refs.map((/** @type {any} */ p, /** @type {number} */ i) => {
    const selected = i === cursor;
    return h(
      Box,
      { key: p.projectId, flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      // Sin tag derivable (un id de proveedor sin ruta en el mapa) se pinta el id: elegible
      // igualmente, porque ocultarlo convertiría un mapa mal configurado en un proyecto invisible.
      // Ancho fijo por la misma razón que en la lista: la ruta es la desambiguación entre dos
      // proyectos del mismo nombre, y solo sirve si cae siempre en la misma columna.
      h(Box, { width: PICKER_NAME_WIDTH }, h(Text, { bold: selected, wrap: 'truncate-end' }, p.tag || p.projectId)),
      p.path ? h(Text, { dimColor: true, wrap: 'truncate-end' }, p.path) : null,
    );
  });
  return h(
    Box,
    { flexDirection: 'column' },
    header,
    h(Box, { flexDirection: 'column' }, ...list),
    renderFooter(message, '↑↓ move · Enter elegir · Esc cancela'),
  );
}

/**
 * Footer de las dos pantallas: mensaje transitorio (si lo hay) sobre la línea de hints. Espejo
 * del footer de la tabla — el mensaje NO reemplaza a los hints, se pone encima: quitarlos
 * dejaría al operador con un aviso y sin las teclas para responder a él.
 *
 * @param {{ text: string, color: string }|null} message
 * @param {string} hints
 * @returns {import('react').ReactElement}
 */
function renderFooter(message, hints) {
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    message?.text ? h(Text, { color: message.color || 'cyan' }, message.text) : null,
    h(Text, { dimColor: true }, hints),
  );
}
