// @ts-check
//
// src/cli/dashboard/SessionTable.js — Phase 36 Plan 02 (TUI-07/09/10/11; D-01/D-03/D-08/D-09/D-10/D-11/D-12).
//
// Componente PRESENTACIONAL de la tabla viva (dumb: recibe la lista YA ordenada+filtrada +
// el índice seleccionado YA derivado; no toca estado ni deriva nada salvo el formato de celda).
// Render order del contrato (UI-SPEC §Layout):
//   (1) header: indicador live reusado de Phase 35 (D-10, las TRES ramas live/stale/waiting) +
//       contadores por estado (D-11, zombie aparte, counts en cero omitidos).
//   (2) precedencia de estados vacíos (D-12, Pitfall 5): waiting/stale gana siempre → connected+0
//       sesiones → `no active sessions` → (Plan 03) `no sessions match` con query no vacía.
//   (3) fila de cabecera de columnas (dimColor) con los anchos fijos.
//   (4) filas de datos: gutter `› ` de selección + texto en `bold` para la fila activa (UAT-pulido
//       post-Phase 36: el `inverse` por celda creaba bloques fragmentados con look 80s; bold + gutter
//       es el patrón de fzf/vim, mantiene color-isolation y degrada limpio bajo NO_COLOR — el gutter
//       sigue siendo la pista posicional). Celdas en `<Box width>` fijos, color semántico SOLO en
//       la celda `status` (D-08), marca `(zombie)` no truncada.
//
// Color-isolation (D-12 Phase 34): TODO el color sale de props de <Text> de ink (color name string
// de statusColor, dimColor, bold). CERO picocolors, CERO import de src/cli/format.js.
// Markup via React.createElement plano (sin JSX, sin build step) — patrón Phase 34/35.

import { Box, Text } from 'ink';
import { createElement as h } from 'react';
import { rowCells, statusColor, stateBadge, countsLabel } from './format.js';
import {
  OVERLAY_COMMENTS_EMPTY,
  OVERLAY_COMMENTS_NOT_FOUND,
  OVERLAY_COMMENTS_ERROR,
  OVERLAY_COMMENTS_UNSUPPORTED,
  OVERLAY_LOGS_EMPTY,
  OVERLAY_LOGS_ERROR,
  OVERLAY_LOGS_LABEL,
  OVERLAY_VIEWPORT,
} from './App.js';

// Anchos de columna fijos (UI-SPEC §Anchos de columna, líneas 51-58). `status` NO se trunca:
// la marca `(zombie)` (16 chars) es load-bearing para accesibilidad (D-09) y debe sobrevivir.
// Phase 38 D-06: columna `state` (16) para el badge del lifecycle. width 16 (no 14):
// el emoji `🔔` de `needs-input` renderiza 2 celdas en terminal pero ink lo mide como 1,
// así que `🔔 needs-input` (13 medido / 14 visual) llenaba justo width 14 y se pegaba a
// task_ref. width 16 deja padding visible tras el badge más ancho.
const COLS = { gutter: 2, state: 16, task_ref: 10, repo: 18, phasemode: 11, status: 18, age: 7 };

/**
 * Una celda de ancho fijo. El color/dim aplica solo donde se pasa (la celda `status`); el resto
 * va sin atributo salvo `bold` para la fila seleccionada. `wrap='truncate-end'` produce el
 * ellipsis nativo `…` de ink cuando el valor desborda el ancho.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {string} opts.text
 * @param {string} [opts.color] - nombre de color ink (string), nunca ANSI.
 * @param {boolean} [opts.dim]
 * @param {boolean} [opts.bold] - fila seleccionada (UAT-pulido post-Phase 36).
 * @param {boolean} [opts.truncate]
 * @returns {import('react').ReactElement}
 */
function cell({ width, text, color, dim, bold, truncate }) {
  return h(
    Box,
    { width },
    h(
      Text,
      { color, dimColor: dim, bold, wrap: truncate ? 'truncate-end' : undefined },
      text,
    ),
  );
}

// countsLabel (D-11) se movió a format.js (Phase 38) — presentación pura,
// testeable sin ink. Se importa arriba junto a rowCells/statusColor/stateBadge.

/**
 * Indicador de conexión del header (D-10) — PORT EXACTO de las tres ramas de App.js Phase 35.
 * No se reinventa: live (`● live`) / stale (`⚠ server caído … retrying…`) / waiting.
 *
 * @param {object} props
 * @param {boolean} props.connected
 * @param {number|null} props.lastGoodCount
 * @param {number|null} props.lastGoodAt
 * @param {number|null} props.lastAttemptAt
 * @returns {import('react').ReactElement}
 */
function LiveIndicator({ connected, lastGoodCount, lastGoodAt, lastAttemptAt }) {
  if (connected) {
    return h(Text, { color: 'green' }, '● live');
  }
  if (lastGoodAt != null) {
    const ageSec = Math.round(((lastAttemptAt ?? lastGoodAt) - lastGoodAt) / 1000);
    return h(
      Text,
      { color: 'yellow' },
      `⚠ server caído  ${lastGoodCount} sessions (last update ${ageSec}s ago, retrying…)`,
    );
  }
  return h(Text, { dimColor: true }, 'waiting for server');
}

/**
 * Render full-screen de un overlay congelado (Phase 39, TUI-15/TUI-16). Estructura:
 *   HEADER  — `comments · <taskRef>` (cyan bold) | `logs · <taskRef>` (bold) + la ETIQUETA HONESTA
 *             OVERLAY_LOGS_LABEL en línea propia (yellow, D-04/SC#3 — load-bearing, no cosmética).
 *   BODY    — según snapshot.status: 'ok' sliceа `lines` por scrollOffset contra OVERLAY_VIEWPORT
 *             (un `<Text>` por línea); 'empty'/'not-found'/'error' → una sola línea de copy dim/red.
 *   FOOTER  — hint `↑↓ scroll · Esc close` (dimColor).
 * Color SOLO de nombres ink (cyan/yellow/red/dimColor) — color-isolation D-12 (cero picocolors/ANSI).
 *
 * @param {{ kind: 'comments'|'logs', taskRef: string, status: string, lines: string[] }} snap
 * @param {number} scrollOffset
 * @param {'comments'|'logs'|null} kind
 * @returns {import('react').ReactElement}
 */
function renderOverlay(snap, scrollOffset, kind) {
  const isLogs = (kind ?? snap.kind) === 'logs';

  // HEADER: título + (solo logs) etiqueta honesta del buffer compartido (D-04/SC#3).
  const titleText = `${isLogs ? 'logs' : 'comments'} · ${snap.taskRef}`;
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: isLogs ? undefined : 'cyan', bold: true }, titleText),
    isLogs ? h(Text, { color: 'yellow' }, OVERLAY_LOGS_LABEL) : null,
  );

  // BODY: según el status del snapshot congelado.
  let body;
  if (snap.status === 'ok') {
    const start = Math.max(0, scrollOffset);
    const visible = snap.lines.slice(start, start + OVERLAY_VIEWPORT);
    body = h(
      Box,
      { flexDirection: 'column' },
      ...visible.map((line, i) => h(Text, { key: `ov-${start + i}` }, line)),
    );
  } else {
    let copy;
    let color;
    if (snap.status === 'not-found') {
      copy = OVERLAY_COMMENTS_NOT_FOUND;
      color = 'red';
    } else if (snap.status === 'unsupported') {
      // D-08: el provider no soporta comentarios. NO es un error (no rojo) — estado informativo,
      // se pinta con dimColor como el caso vacío pero con copy DISTINTO (legible bajo NO_COLOR).
      copy = OVERLAY_COMMENTS_UNSUPPORTED;
    } else if (snap.status === 'error') {
      copy = isLogs ? OVERLAY_LOGS_ERROR : OVERLAY_COMMENTS_ERROR;
      color = 'red';
    } else {
      // 'empty'
      copy = isLogs ? OVERLAY_LOGS_EMPTY : OVERLAY_COMMENTS_EMPTY;
    }
    body = h(Text, { color, dimColor: color ? undefined : true }, copy);
  }

  // FOOTER: hint de interacción del sub-modo de scroll (D-06).
  const footer = h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, '↑↓ scroll · Esc close'));

  return h(Box, { flexDirection: 'column' }, header, body, footer);
}

/**
 * Tabla viva del dashboard (presentacional). Recibe la lista YA ordenada+filtrada, el índice
 * seleccionado YA derivado, los contadores y el connection state reusado.
 *
 * @param {object} props
 * @param {Array<Partial<import('./format.js').EnrichedSession>>} props.rows - YA ordenadas+filtradas.
 * @param {number} props.selectedIndex - índice derivado de resolveSelection (-1 si vacío).
 * @param {{ running: number, review: number, done: number, error: number, zombie: number }} props.counts
 * @param {boolean} props.connected
 * @param {number|null} props.lastGoodCount
 * @param {number|null} props.lastGoodAt
 * @param {number|null} props.lastAttemptAt
 * @param {boolean} [props.hasQuery] - hay una query de filtro activa (Plan 03). Distingue los dos
 *   estados vacíos: `no sessions match` (hay query) vs `no active sessions` (lista realmente vacía).
 * @param {'list'|'filter'} [props.mode] - modo de interacción (Plan 03). En `filter` se muestra la
 *   línea de filtro modal al pie de la tabla (D-13).
 * @param {string} [props.query] - texto del filtro EN VIVO (Plan 03), renderizado en la línea modal.
 * @param {string|null} [props.focusError] - Phase 37 D-04: si != null, sustituye el footer
 *   (filterLine y/o footer normal en App.js) por el mensaje rojo del error en la línea modal.
 *   Color SOLO vía `<Text color="red">` (color-isolation D-12 Phase 34, cero picocolors).
 *   Precedencia: errorLine gana a filterLine — el error es modal hasta el clear-on-any-input.
 * @param {'comments'|'logs'|null} [props.overlayKind] - Phase 39: overlay abierto (c/l) o null.
 * @param {number} [props.scrollOffset] - Phase 39 D-06: primera línea visible del body del overlay.
 * @param {{ kind: 'comments'|'logs', taskRef: string, status: string, lines: string[] }|null} [props.overlaySnapshot]
 *   Phase 39 D-05: contenido CONGELADO del overlay (no salta bajo el poll). status discrimina la copy.
 * @returns {import('react').ReactElement}
 */
export default function SessionTable({
  rows,
  selectedIndex,
  counts,
  connected,
  lastGoodCount,
  lastGoodAt,
  lastAttemptAt,
  hasQuery = false,
  mode = 'list',
  query = '',
  focusError = null,
  overlayKind = null,
  scrollOffset = 0,
  overlaySnapshot = null,
}) {
  // (0) Phase 39 (TUI-15/TUI-16 — D-01/D-04/D-05): OVERLAY full-screen. Early-return ANTES de la
  // tabla: cuando hay un overlay abierto ocupa el área de la tabla (D-01). Mantiene SessionTable
  // como único punto de render. Color SOLO vía `<Text color>` de ink (D-12, cero picocolors/ANSI).
  if (mode === 'overlay' && overlaySnapshot) {
    return renderOverlay(overlaySnapshot, scrollOffset, overlayKind);
  }
  const indicator = h(LiveIndicator, { connected, lastGoodCount, lastGoodAt, lastAttemptAt });
  const label = countsLabel(counts);

  // Header: indicador live (D-10) + contadores (D-11, omitidos si todos en cero / lista vacía).
  const header = h(
    Box,
    { flexDirection: 'row' },
    indicator,
    label ? h(Text, null, `   ${label}`) : null,
  );

  // Línea de filtro modal (D-13, UI-SPEC:191): prompt `/ <query>▏` al pie, SOLO cuando mode==='filter'.
  // El cursor `▏` es el marcador inequívoco de que el input de filtro tiene el foco (lo distingue del
  // `/ filter` del footer de hints). `null` cuando no estamos en modo filtro.
  const filterLine =
    mode === 'filter'
      ? h(Box, { marginTop: 1 }, h(Text, null, `/ ${query}▏`))
      : null;

  // Phase 37 D-04: errorLine es el render condicional del footer-error rojo. Espejo EXACTO
  // del patrón filterLine arriba — misma forma `<Box marginTop=1><Text …>…</Text></Box>`,
  // mismo nivel de granularidad. Color del rojo via `<Text color="red">` de ink
  // (color-isolation D-12 Phase 34: cero picocolors, cero ANSI inline). El walker
  // test/format-isolation.test.js cubre este archivo automáticamente.
  const footerError = focusError;
  const errorLine =
    footerError != null
      ? h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, footerError))
      : null;

  // (2) Precedencia de estados vacíos (D-12, Pitfall 5):
  //   - waiting/stale (never had good O degradado) gana SIEMPRE → solo el indicador, sin tabla.
  //   - connected + 0 filas + query activa → `no sessions match` (Plan 03).
  //   - connected + 0 filas sin query      → `no active sessions`.
  // La línea de filtro se anexa al pie en TODAS las ramas (el operador ve su query aunque oculte todo).
  if (!connected && lastGoodAt == null) {
    return h(Box, { flexDirection: 'column' }, header, (errorLine ?? filterLine));
  }
  if (rows.length === 0) {
    const emptyCopy = hasQuery ? 'no sessions match' : 'no active sessions';
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, emptyCopy)),
      (errorLine ?? filterLine),
    );
  }

  // (3) Cabecera de columnas (dimColor) con los anchos fijos.
  const columnHeader = h(
    Box,
    { flexDirection: 'row' },
    h(Box, { width: COLS.gutter }, h(Text, { dimColor: true }, '  ')),
    h(Box, { width: COLS.state }, h(Text, { dimColor: true }, 'state')),
    h(Box, { width: COLS.task_ref }, h(Text, { dimColor: true }, 'task_ref')),
    h(Box, { width: COLS.repo }, h(Text, { dimColor: true }, 'repo')),
    h(Box, { width: COLS.phasemode }, h(Text, { dimColor: true }, 'phase/mode')),
    h(Box, { width: COLS.status }, h(Text, { dimColor: true }, 'status')),
    h(Box, { width: COLS.age }, h(Text, { dimColor: true }, 'age')),
  );

  // (4) Filas de datos. React key = task_id (NUNCA índice — Pitfall 7).
  const dataRows = rows.map((session, i) => {
    const selected = i === selectedIndex;
    const cells = rowCells(session);
    const sc = statusColor(session.status ?? '', session.alive, session.state);
    return h(
      Box,
      { key: session.task_id ?? `row-${i}`, flexDirection: 'row' },
      // Gutter: `› ` cuando seleccionada (también en bold), 2 espacios si no. El glifo `›` es la
      // pista posicional inequívoca (sobrevive NO_COLOR sin bold); el bold sobre el row añade peso
      // sin crear bloques inversos (patrón fzf/vim — decisión UAT-pulido post-Phase 36).
      h(Box, { width: COLS.gutter }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      // Phase 38 D-06: badge del estado v3 entre gutter y task_ref. Fallback a
      // session.status (legacy v2 sin migrar). Si no hay badge (closed/review/
      // vacío) la celda queda vacía sin romper el render. Color SOLO del badge
      // (string name ink, NO picocolors). truncate:false — `🔔 needs-input` cabe.
      (() => {
        const badge = stateBadge(session.state ?? session.status ?? '');
        const text = (badge.glyph || badge.label) ? `${badge.glyph ?? ''} ${badge.label ?? ''}`.trim() : '';
        return cell({ width: COLS.state, text, color: badge.color, bold: selected, truncate: false });
      })(),
      cell({ width: COLS.task_ref, text: cells.task_ref, bold: selected, truncate: true }),
      cell({ width: COLS.repo, text: cells.repo, bold: selected, truncate: true }),
      cell({ width: COLS.phasemode, text: cells.phasemode, bold: selected, truncate: true }),
      // status: color semántico (D-08) + bold si seleccionada; NO truncar (el `(zombie)` debe
      // sobrevivir, D-09). ink compone bold sobre color sin alterar el matiz → la marca queda
      // legible y enfatizada en la fila activa.
      cell({ width: COLS.status, text: cells.status, color: sc.color, dim: sc.dim, bold: selected, truncate: false }),
      cell({ width: COLS.age, text: cells.age, bold: selected, truncate: false }),
    );
  });

  return h(
    Box,
    { flexDirection: 'column' },
    header,
    h(Box, { marginTop: 1, flexDirection: 'column' }, columnHeader, ...dataRows),
    (errorLine ?? filterLine),
  );
}
