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
//   (4) filas de datos: gutter `› ` de selección (redundancia NO_COLOR), celdas en `<Box width>`
//       fijos, color semántico SOLO en la celda `status` (D-08), marca `(zombie)` no truncada.
//
// Color-isolation (D-12 Phase 34): TODO el color sale de props de <Text> de ink (color name string
// de statusColor, dimColor, inverse, bold). CERO picocolors, CERO import de src/cli/format.js.
// Markup via React.createElement plano (sin JSX, sin build step) — patrón Phase 34/35.

import { Box, Text } from 'ink';
import { createElement as h } from 'react';
import { rowCells, statusColor } from './format.js';

// Anchos de columna fijos (UI-SPEC §Anchos de columna, líneas 51-58). `status` NO se trunca:
// la marca `(zombie)` (16 chars) es load-bearing para accesibilidad (D-09) y debe sobrevivir.
const COLS = { gutter: 2, task_ref: 10, repo: 18, phasemode: 11, status: 18, age: 7 };

/**
 * Una celda de ancho fijo. El color/dim aplica solo donde se pasa (la celda `status`); el resto
 * va sin atributo salvo `inverse` para la fila seleccionada. `wrap='truncate-end'` produce el
 * ellipsis nativo `…` de ink cuando el valor desborda el ancho.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {string} opts.text
 * @param {string} [opts.color] - nombre de color ink (string), nunca ANSI.
 * @param {boolean} [opts.dim]
 * @param {boolean} [opts.inverse]
 * @param {boolean} [opts.truncate]
 * @returns {import('react').ReactElement}
 */
function cell({ width, text, color, dim, inverse, truncate }) {
  return h(
    Box,
    { width },
    h(
      Text,
      { color, dimColor: dim, inverse, wrap: truncate ? 'truncate-end' : undefined },
      text,
    ),
  );
}

/**
 * Compone el string compacto de contadores del header (D-11): solo estados con count ≥ 1,
 * separados por ` · `, con el zombie contado aparte de running.
 *
 * @param {{ running: number, review: number, done: number, error: number, zombie: number }} counts
 * @returns {string}
 */
function countsLabel(counts) {
  const parts = [];
  if (counts.running > 0) parts.push(`${counts.running} running`);
  if (counts.zombie > 0) parts.push(`${counts.zombie} zombie`);
  if (counts.review > 0) parts.push(`${counts.review} review`);
  if (counts.error > 0) parts.push(`${counts.error} error`);
  if (counts.done > 0) parts.push(`${counts.done} done`);
  return parts.join(' · ');
}

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
}) {
  const indicator = h(LiveIndicator, { connected, lastGoodCount, lastGoodAt, lastAttemptAt });
  const label = countsLabel(counts);

  // Header: indicador live (D-10) + contadores (D-11, omitidos si todos en cero / lista vacía).
  const header = h(
    Box,
    { flexDirection: 'row' },
    indicator,
    label ? h(Text, null, `   ${label}`) : null,
  );

  // (2) Precedencia de estados vacíos (D-12, Pitfall 5):
  //   - waiting/stale (never had good O degradado) gana SIEMPRE → solo el indicador, sin tabla.
  //   - connected + 0 filas + query activa → `no sessions match` (Plan 03).
  //   - connected + 0 filas sin query      → `no active sessions`.
  if (!connected && lastGoodAt == null) {
    return h(Box, { flexDirection: 'column' }, header);
  }
  if (rows.length === 0) {
    const emptyCopy = hasQuery ? 'no sessions match' : 'no active sessions';
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, emptyCopy)),
    );
  }

  // (3) Cabecera de columnas (dimColor) con los anchos fijos.
  const columnHeader = h(
    Box,
    { flexDirection: 'row' },
    h(Box, { width: COLS.gutter }, h(Text, { dimColor: true }, '  ')),
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
    const sc = statusColor(session.status ?? '', session.alive);
    return h(
      Box,
      { key: session.task_id ?? `row-${i}`, flexDirection: 'row' },
      // Gutter: `› ` cuando seleccionada, 2 espacios si no (redundancia NO_COLOR del highlight).
      h(Box, { width: COLS.gutter }, h(Text, { inverse: selected }, selected ? '› ' : '  ')),
      cell({ width: COLS.task_ref, text: cells.task_ref, inverse: selected, truncate: true }),
      cell({ width: COLS.repo, text: cells.repo, inverse: selected, truncate: true }),
      cell({ width: COLS.phasemode, text: cells.phasemode, inverse: selected, truncate: true }),
      // status: color semántico (D-08) + inverse si seleccionada; NO truncar (el `(zombie)` debe
      // sobrevivir, D-09). ink compone inverse SOBRE el color → la marca sigue legible.
      cell({ width: COLS.status, text: cells.status, color: sc.color, dim: sc.dim, inverse: selected, truncate: false }),
      cell({ width: COLS.age, text: cells.age, inverse: selected, truncate: false }),
    );
  });

  return h(
    Box,
    { flexDirection: 'column' },
    header,
    h(Box, { marginTop: 1, flexDirection: 'column' }, columnHeader, ...dataRows),
  );
}
