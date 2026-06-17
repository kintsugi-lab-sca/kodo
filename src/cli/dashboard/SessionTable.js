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
import { rowCells, statusColor, stateBadge, countsLabel, NO_GSD_LABEL } from './format.js';
import {
  OVERLAY_COMMENTS_EMPTY,
  OVERLAY_COMMENTS_NOT_FOUND,
  OVERLAY_COMMENTS_ERROR,
  OVERLAY_COMMENTS_UNSUPPORTED,
  OVERLAY_LOGS_EMPTY,
  OVERLAY_LOGS_ERROR,
  OVERLAY_LOGS_LABEL,
  OVERLAY_PLAN_NO_PHASE,
  OVERLAY_PLAN_NO_PLAN,
  OVERLAY_PLAN_NO_LIGHT,
  OVERLAY_PLAN_ERROR,
  OVERLAY_VIEWPORT,
  DISMISS_CONFIRM,
  ADOPT_CONFIRM,
} from './App.js';

// Anchos de columna fijos (UI-SPEC §Anchos de columna, líneas 51-58). `status` NO se trunca:
// la marca `(zombie)` (16 chars) es load-bearing para accesibilidad (D-09) y debe sobrevivir.
// Phase 38 D-06: columna `state` (16) para el badge del lifecycle. width 16 (no 14):
// el emoji `🔔` de `needs-input` renderiza 2 celdas en terminal pero ink lo mide como 1,
// así que `🔔 needs-input` (13 medido / 14 visual) llenaba justo width 14 y se pegaba a
// task_ref. width 16 deja padding visible tras el badge más ancho.
// Phase 43 D-01/D-02 (PSTATE-05): columna dedicada `task` (eje provider) ENTRE `status` y `age`.
// width 12 (Claude's Discretion, CONTEXT.md D-08/specifics): cabe `in_progress` (11 chars);
// `truncate-end` nativo de ink es la red de seguridad si el provider emite un string más largo
// (T-43-03 DoS-guard: un provider_state de 10k chars se trunca a la columna, no desborda la tabla).
// Phase 44 D-09 (TUI-19): `state` 16→18 para que la marca per-fila del zombie (~18 celdas) no
// se trunque — el badge base `▶ running` (~9) más el sufijo del zombie (9) llena justo 18 (Pitfall 3).
// Phase 50 D-06 (PROG-03): columna condicional `prog` (progreso vivo N/M) ENTRE `status` y `task`
// → orden `status → prog → task → age`. width 7: aloja `N/M✓` en el peor caso de dobles dígitos
// (`12/15✓` = 6 chars) con padding visible; reserva el sufijo `✓` (D-07). `truncate-end` nativo de
// ink es la red de seguridad anti-DoS (T-50-cell-dos: un n/m absurdo se trunca, no desborda).
const COLS = { gutter: 2, state: 18, task_ref: 10, repo: 18, phasemode: 11, status: 18, prog: 7, task: 12, age: 7 };

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
 * @param {{ kind: 'comments'|'logs'|'plan', taskRef: string, status: string, lines: string[] }} snap
 * @param {number} scrollOffset
 * @param {'comments'|'logs'|'plan'|null} kind
 * @returns {import('react').ReactElement}
 */
function renderOverlay(snap, scrollOffset, kind) {
  const effKind = kind ?? snap.kind;
  const isLogs = effKind === 'logs';
  const isPlan = effKind === 'plan';

  // HEADER: título + (solo logs) etiqueta honesta del buffer compartido (D-04/SC#3).
  // Phase 44: el overlay de plan (`plan · <taskRef>`) reusa el título cyan bold de comments.
  const label = isLogs ? 'logs' : isPlan ? 'plan' : 'comments';
  const titleText = `${label} · ${snap.taskRef}`;
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
    if (snap.status === 'no-phase') {
      // Phase 44 D-07: la fila no es GSD / no se resolvió fase. Informativo (dim, no rojo).
      copy = OVERLAY_PLAN_NO_PHASE;
    } else if (snap.status === 'no-plan') {
      // Phase 44 D-07: fase resuelta pero sin ningún PLAN.md. Informativo (dim) y DISTINTO de no-phase.
      copy = OVERLAY_PLAN_NO_PLAN;
    } else if (snap.status === 'no-light-plan') {
      // Phase 46 D-04: sesión quick/non-GSD cuyo artefacto de plan ligero aún no existe (ENOENT).
      // Informativo (dim, SIN color → cae a dimColor:true en la línea 174), NO rojo: es normal,
      // no un fallo. Solo lo produce el fallback de plan (readLightPlan), por eso es seguro en el
      // switch compartido plan/logs/comments (ningún otro overlay emite este status).
      copy = OVERLAY_PLAN_NO_LIGHT;
    } else if (snap.status === 'not-found') {
      copy = OVERLAY_COMMENTS_NOT_FOUND;
      color = 'red';
    } else if (snap.status === 'unsupported') {
      // D-08: el provider no soporta comentarios. NO es un error (no rojo) — estado informativo,
      // se pinta con dimColor como el caso vacío pero con copy DISTINTO (legible bajo NO_COLOR).
      copy = OVERLAY_COMMENTS_UNSUPPORTED;
    } else if (snap.status === 'error') {
      // Phase 44 D-07: el copy de error es DISTINTO por overlay (plan vs logs vs comments). Rojo (fallo real).
      copy = isPlan ? OVERLAY_PLAN_ERROR : isLogs ? OVERLAY_LOGS_ERROR : OVERLAY_COMMENTS_ERROR;
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
 * Render del picker de adopt (Phase 56, DETECT-02 / D-03/Pitfall 3). Diverge de renderOverlay
 * (lectura con scroll): lista las surfaces ADOPTABLES con un CURSOR SELECCIONABLE (gutter `› ` +
 * bold sobre la fila del cursor — mismo patrón fzf/vim que la tabla). Cada fila muestra
 * `cwd · <sessionId corto> · <kind>` (D-03). Color SOLO de nombres ink (color-isolation D-12).
 *
 * @param {Array<{ workspaceRef: string, cwd: string, sessionId: string, kind: string }>} adoptable
 * @param {number} cursor - índice seleccionado [0, len-1].
 * @returns {import('react').ReactElement}
 */
function renderAdoptPicker(adoptable, cursor) {
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, 'adopt session'),
  );
  const rows = adoptable.map((s, i) => {
    const selected = i === cursor;
    const shortId = (s.sessionId ?? '').slice(0, 8);
    const text = `${s.cwd} · ${shortId} · ${s.kind}`;
    return h(
      Box,
      { key: s.sessionId ?? `adopt-${i}`, flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      h(Text, { bold: selected }, text),
    );
  });
  const body = h(Box, { flexDirection: 'column' }, ...rows);
  const footer = h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, '↑↓ move · a adopt · Esc close'));
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
 * @param {boolean} [props.anyGsd] - Phase 44 D-08 (TUI-18): flag ESTRUCTURAL de presencia GSD,
 *   derivado en App.js sobre el set SIN filtrar (`deriveAnyGsd(sorted)`). Cuando es `false` la
 *   columna `phase/mode` (cabecera + toda celda de datos) NO se emite y su ancho se recupera vía
 *   flex (ink desplaza los hermanos a la izquierda; sin aritmética de anchos). Reaparece sola
 *   cuando entra una sesión GSD. Default `true` (retro-compat: renderiza la columna como antes).
 * @param {boolean} [props.anyProgress] - Phase 50 D-06 (PROG-03): flag ESTRUCTURAL de presencia de
 *   progreso vivo, derivado en App.js sobre el set SIN filtrar (`deriveAnyProgress(enriched)`).
 *   Cuando es `false` la columna `prog` (cabecera + toda celda) NO se emite y su ancho se recupera
 *   vía flex (sin aritmética de anchos). Reaparece sola cuando una sesión reporta progreso. Default
 *   `false` (retro-compat: oculta la columna si no se pasa, espejo invertido de anyGsd).
 * @param {'list'|'filter'|'overlay'|'confirm'} [props.mode] - modo de interacción. En `filter` se
 *   muestra la línea de filtro modal al pie; en `confirm` (Phase 42) el armed prompt persistente.
 * @param {string} [props.query] - texto del filtro EN VIVO (Plan 03), renderizado en la línea modal.
 * @param {string|null} [props.focusError] - Phase 37 D-04: si != null, sustituye el footer
 *   (filterLine y/o footer normal en App.js) por el mensaje del error/resultado en la línea modal.
 *   Color SOLO vía `<Text color>` (color-isolation D-12 Phase 34, cero picocolors).
 *   Precedencia: errorLine gana a filterLine — el error es modal hasta el clear-on-any-input.
 * @param {string} [props.footerColor] - Phase 42 D-09: color del footer transitorio. El dismiss
 *   distingue éxito (green) / parcial .dirty o warnings (yellow) / error (red), DERIVADO de
 *   actions[] (no de un color lookup). Default 'red' (retro-compat con el focusError de Phase 37).
 * @param {string|null} [props.armedTaskRef] - Phase 42 D-02: task_ref del confirm armado, para el
 *   copy persistente DISMISS_CONFIRM cuando mode==='confirm'.
 * @param {string|null} [props.armedSessionId] - Phase 56 Pitfall 2: si != null, el confirm armado es
 *   de ADOPT (rutea el copy a ADOPT_CONFIRM); si null, es de dismiss (DISMISS_CONFIRM).
 * @param {string|null} [props.armedSurfaceRef] - Phase 56 D-04: workspaceRef de la surface del adopt
 *   armado, para el copy persistente ADOPT_CONFIRM.
 * @param {number} [props.adoptCursor] - Phase 56 D-03/Pitfall 3: índice del cursor seleccionable del
 *   picker de adopt (overlaySnapshot.kind==='adopt').
 * @param {'comments'|'logs'|'plan'|'adopt'|null} [props.overlayKind] - Phase 39: overlay abierto (c/l), Phase 44: 'plan' (p), Phase 56: 'adopt' (a), o null.
 * @param {number} [props.scrollOffset] - Phase 39 D-06: primera línea visible del body del overlay.
 * @param {{ kind: 'comments'|'logs'|'plan', taskRef: string, status: string, lines: string[] }|null} [props.overlaySnapshot]
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
  anyGsd = true,
  anyProgress = false,
  mode = 'list',
  query = '',
  focusError = null,
  footerColor = 'red',
  armedTaskRef = null,
  armedSessionId = null,
  armedSurfaceRef = null,
  adoptCursor = 0,
  overlayKind = null,
  scrollOffset = 0,
  overlaySnapshot = null,
}) {
  // (0) Phase 39 (TUI-15/TUI-16 — D-01/D-04/D-05): OVERLAY full-screen. Early-return ANTES de la
  // tabla: cuando hay un overlay abierto ocupa el área de la tabla (D-01). Mantiene SessionTable
  // como único punto de render. Color SOLO vía `<Text color>` de ink (D-12, cero picocolors/ANSI).
  if (mode === 'overlay' && overlaySnapshot) {
    // Phase 56 D-03/Pitfall 3: el picker de adopt diverge del overlay de lectura (cursor
    // seleccionable, no scroll). Se enruta por kind ANTES de renderOverlay.
    if (overlaySnapshot.kind === 'adopt') {
      return renderAdoptPicker(overlaySnapshot.adoptable ?? [], adoptCursor);
    }
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

  // Phase 37 D-04 + Phase 42 D-09: errorLine es el render condicional del footer transitorio.
  // Espejo EXACTO del patrón filterLine arriba — misma forma `<Box marginTop=1><Text …>…</Text></Box>`,
  // mismo nivel de granularidad. Phase 37 era siempre rojo; Phase 42 generaliza el color via
  // `footerColor` (green/yellow/red derivado de actions[], D-09) — el matiz NO es un color lookup.
  // Color SOLO via nombre de ink `<Text color>` (color-isolation D-12 Phase 34: cero picocolors,
  // cero ANSI inline). El walker test/format-isolation.test.js cubre este archivo automáticamente.
  const footerError = focusError;
  const errorLine =
    footerError != null
      ? h(Box, { marginTop: 1 }, h(Text, { color: footerColor }, footerError))
      : null;

  // Phase 42 D-02/D-12 (DISMISS-02): confirmLine es el armed prompt PERSISTENTE (no transitorio):
  // se deriva de `mode==='confirm'` (NO de focusError) para que el clear-on-any-input no lo consuma
  // (RESEARCH Pitfall 4). Misma forma `<Box marginTop=1>` que filterLine/errorLine. Color cyan
  // (armed/actionable, UI-SPEC §Color) via nombre de ink — color-isolation intacta. Precede a
  // errorLine/filterLine mientras está armado.
  // Phase 56 Pitfall 2 (DETECT-02): el confirm tiene DOS consumidores. Se rutea el copy por cuál
  // armed-id está set: armedSessionId != null → ADOPT_CONFIRM (adopt, ref = workspaceRef de la
  // surface); si no → DISMISS_CONFIRM (dismiss, ref = task_ref). Mismo color cyan (armed/actionable).
  const confirmLine =
    mode === 'confirm'
      ? h(
          Box,
          { marginTop: 1 },
          h(
            Text,
            { color: 'cyan' },
            armedSessionId != null
              ? ADOPT_CONFIRM(armedSurfaceRef ?? '')
              : DISMISS_CONFIRM(armedTaskRef ?? ''),
          ),
        )
      : null;

  // (2) Precedencia de estados vacíos (D-12, Pitfall 5):
  //   - waiting/stale (never had good O degradado) gana SIEMPRE → solo el indicador, sin tabla.
  //   - connected + 0 filas + query activa → `no sessions match` (Plan 03).
  //   - connected + 0 filas sin query      → `no active sessions`.
  // La línea de filtro se anexa al pie en TODAS las ramas (el operador ve su query aunque oculte todo).
  if (!connected && lastGoodAt == null) {
    return h(Box, { flexDirection: 'column' }, header, (confirmLine ?? errorLine ?? filterLine));
  }
  if (rows.length === 0) {
    const emptyCopy = hasQuery ? 'no sessions match' : 'no active sessions';
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, emptyCopy)),
      (confirmLine ?? errorLine ?? filterLine),
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
    // Phase 44 D-08 (TUI-18): la cabecera `phase/mode` solo se emite si ALGUNA sesión es GSD.
    // Cuando `anyGsd === false` se omite el elemento (no se renderiza un Box vacío) → ink recupera
    // sus 11 celdas vía flex desplazando los hermanos a la izquierda (sin aritmética de anchos).
    ...(anyGsd ? [h(Box, { width: COLS.phasemode }, h(Text, { dimColor: true }, 'phase/mode'))] : []),
    h(Box, { width: COLS.status }, h(Text, { dimColor: true }, 'status')),
    // Phase 50 D-06 (PROG-03): cabecera `prog` condicional ENTRE `status` y `task`. Solo se emite si
    // ALGUNA sesión reporta progreso (anyProgress); si no, se omite y ink recupera el ancho vía flex.
    ...(anyProgress ? [h(Box, { width: COLS.prog }, h(Text, { dimColor: true }, 'prog'))] : []),
    // Phase 43 D-03: cabecera de la columna provider entre `status` y `age`, label literal `task`.
    h(Box, { width: COLS.task }, h(Text, { dimColor: true }, 'task')),
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
        let text = (badge.glyph || badge.label) ? `${badge.glyph ?? ''} ${badge.label ?? ''}`.trim() : '';
        // Phase 44 D-09 (TUI-19): marca per-fila del zombie, ADITIVA (no reemplaza el contador del
        // header). Zombie = running (eje v3 `state` o legacy `status`) con el proceso muerto
        // (`alive === false`). El color rojo se LEE del `sc` ya calculado (statusColor devuelve
        // {color:'red'} para running+!alive) — CERO color nuevo, CERO segunda paleta. truncate:false
        // (COLS.state se ensanchó a 18 para que el badge con el sufijo no se trunque, Pitfall 3).
        const isZombie =
          (session.status === 'running' || session.state === 'running') && session.alive === false;
        let color = badge.color;
        if (isZombie) {
          text = text ? `${text} (zombie)` : '(zombie)';
          color = sc.color;
        }
        return cell({ width: COLS.state, text, color, bold: selected, truncate: false });
      })(),
      cell({ width: COLS.task_ref, text: cells.task_ref, bold: selected, truncate: true }),
      cell({ width: COLS.repo, text: cells.repo, bold: selected, truncate: true }),
      // phase/mode: 'No GSD' (placeholder de sesión no-GSD) va atenuado para no competir
      // con valores reales tipo '42/full'. Phase 44 D-08 (TUI-18): la celda solo se emite si
      // ALGUNA sesión es GSD (anyGsd); si no, se omite y ink recupera el ancho vía flex.
      ...(anyGsd
        ? [cell({ width: COLS.phasemode, text: cells.phasemode, dim: cells.phasemode === NO_GSD_LABEL, bold: selected, truncate: true })]
        : []),
      // status: OUTCOME auto-reportado (outcomeCell → error/done/review; blanco en lifecycle).
      // Color semántico (D-08, statusColor sobre session.status) + bold si seleccionada. NO
      // truncar: los valores son cortos (≤6 chars) y caben de sobra en COLS.status.
      cell({ width: COLS.status, text: cells.status, color: sc.color, dim: sc.dim, bold: selected, truncate: false }),
      // Phase 50 D-06/D-07 (PROG-03): celda `prog` condicional ENTRE status y task. Valor en texto
      // plano SIN color propio (color-isolation D-12; el `dim` de cells.prog marca los degradados
      // '—'/'?' vía dimColor de ink). truncate:true → ellipsis nativo `…` = anti-DoS (T-50-cell-dos:
      // un n/m absurdo se trunca a la columna, no desborda la tabla). Se omite si !anyProgress.
      ...(anyProgress
        ? [cell({ width: COLS.prog, text: cells.prog.text, dim: cells.prog.dim, bold: selected, truncate: true })]
        : []),
      // Phase 43 D-04/D-05/D-08: columna provider entre status y age. El valor ok va en texto plano
      // SIN color propio (D-05: cero segunda paleta — el red queda reservado al zombie del eje local);
      // el `dim` de cells.task marca los degradados '—'/'?' vía dimColor de ink. truncate:true →
      // ellipsis nativo `…` si el provider_state desborda los 12 chars (D-08 red de seguridad).
      cell({ width: COLS.task, text: cells.task.text, dim: cells.task.dim, bold: selected, truncate: true }),
      cell({ width: COLS.age, text: cells.age, bold: selected, truncate: false }),
    );
  });

  return h(
    Box,
    { flexDirection: 'column' },
    header,
    h(Box, { marginTop: 1, flexDirection: 'column' }, columnHeader, ...dataRows),
    (confirmLine ?? errorLine ?? filterLine),
  );
}
