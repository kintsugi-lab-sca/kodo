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
  DERIVE_PROGRESS,
  ADOPT_DERIVED_CONFIRM,
  ADOPT_DERIVED_CONFIRM_FALLBACK,
  CONFIG_OVERLAY_TITLE,
  API_KEY_LABEL,
  API_KEY_CONFIGURED,
  API_KEY_UNSET,
  API_KEY_NO_RAWMODE,
  SETUP_OVERLAY_TITLE,
  SETUP_INTRO,
  SETUP_STEP_PROVIDER,
  SETUP_STEP_BASE_URL,
  SETUP_STEP_WORKSPACE,
  SETUP_STEP_APIKEY,
  SETUP_PROVIDER_LABEL,
  SETUP_PROVIDER_HINT,
  SETUP_BASE_URL_LABEL,
  SETUP_WORKSPACE_LABEL,
  SETUP_COMPLETE_RESTART,
  SETUP_WEBHOOK_NOTE,
  SETUP_NO_RAWMODE,
  SETUP_PROVIDERS,
  PROJECTS_OVERLAY_TITLE,
  PROJECTS_LOADING,
  PROJECTS_UNMAPPED,
  PROJECTS_LOAD_FAILED,
  PROJECTS_MODULES_TITLE,
} from './App.js';
import { getEditableFields, getByPath } from '../../config-validate.js';
// Phase 64 Plan 02 (D-06): lee el estado de mapeo de cada fila (forma dual). getProjectPath es puro
// y never-throws (Plan 01) → '' si la entrada no está mapeada → la fila pinta PROJECTS_UNMAPPED.
// Phase 64 Plan 03 (PROJ-04): getModuleMap lee el estado de mapeo de cada MÓDULO (forma dual).
import { getProjectPath, getModuleMap } from '../../projects-shape.js';

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
 * @param {boolean} [props.unauthorized] - Phase 69 D-08: estado 401. Cuando true, el banner
 *   "no autorizado" (yellow) se pinta PRIMERO, con precedencia sobre live/stale/waiting.
 * @param {string} [props.unauthorizedMessage] - Phase 69 D-08: literal-estable UNAUTHORIZED_MESSAGE.
 * @returns {import('react').ReactElement}
 */
function LiveIndicator({ connected, lastGoodCount, lastGoodAt, lastAttemptAt, unauthorized, unauthorizedMessage }) {
  // Phase 69 Plan 03 (NET-02, D-08): el banner 401 gana a TODAS las ramas de degradación genérica
  // (live/stale/waiting). Un `code:'unauthorized'` es una condición específica y accionable (token
  // ausente/revocado), no un drop transitorio — se pinta PRIMERO, en amarillo (UI-SPEC §Color: acotado
  // a {yellow, red}), y NUNCA deja el frame vacío (never blank screen). Color SOLO vía nombre ink en
  // <Text> (color-isolation D-12; cero picocolors/ANSI).
  if (unauthorized) {
    return h(Text, { color: 'yellow' }, unauthorizedMessage);
  }
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
 * Trunca un string a `max` chars con ellipsis de UN solo carácter `…` (Phase 62 D-08, ORCH-02).
 * Puro y never-throws sobre input falsy. El `…` (NO `...`) mantiene el footer compacto y respeta
 * el copywriting de UI-SPEC (§Copywriting: ellipsis de un char). Colapsa whitespace interno (saltos
 * de línea de la descripción derivada) a un espacio para que el footer no salte de varias líneas.
 *
 * @param {string} s
 * @param {number} max - longitud máxima ANTES del ellipsis.
 * @returns {string}
 */
function truncateEllipsis(s, max) {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

/**
 * Render del picker de adopt (Phase 56, DETECT-02 / D-03/Pitfall 3). Diverge de renderOverlay
 * (lectura con scroll): lista las surfaces ADOPTABLES con un CURSOR SELECCIONABLE (gutter `› ` +
 * bold sobre la fila del cursor — mismo patrón fzf/vim que la tabla). Cada fila muestra
 * `<title> · <…últimos 2 folders del cwd> · <sessionId corto> · <kind>` (D-03 + 56-06: el
 * título auto-derivado de cmux hace la fila intuitiva; el cwd se acorta a los 2 últimos
 * segmentos para no saturar). El título se omite cuando la surface no lo trae. Color SOLO
 * de nombres ink (color-isolation D-12).
 *
 * @param {Array<{ workspaceRef: string, cwd: string, sessionId: string, kind: string, title?: string }>} adoptable
 * @param {number} cursor - índice seleccionado [0, len-1].
 * @returns {import('react').ReactElement}
 */
function renderAdoptPicker(adoptable, cursor) {
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, 'adopt session'),
  );
  // Últimos 2 segmentos del cwd (p. ej. /Users/alex/dev/klab/kodo → klab/kodo). Puro.
  const lastTwo = (cwd) => (cwd ?? '').split('/').filter(Boolean).slice(-2).join('/');
  const rows = adoptable.map((s, i) => {
    const selected = i === cursor;
    const shortId = (s.sessionId ?? '').slice(0, 8);
    // Título auto-derivado de cmux (56-06), cap a 50 chars; omitido si la surface no lo trae.
    const rawTitle = typeof s.title === 'string' ? s.title.trim() : '';
    const title = rawTitle.length > 50 ? `${rawTitle.slice(0, 49)}…` : rawTitle;
    const titlePrefix = title ? `${title} · ` : '';
    const text = `${titlePrefix}${lastTwo(s.cwd)} · ${shortId} · ${s.kind}`;
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
 * Render del overlay del EDITOR de config (Phase 63 Plan 02, UX-01/02 / D-01/D-03/D-11/D-12). Molde
 * de renderAdoptPicker (lista con cursor seleccionable, gutter `› ` + bold sobre la fila activa).
 * Lista los 11 campos de `getEditableFields(snapshot)` con su valor actual (read-only); el campo en
 * `fieldCursor` se resalta. En `mode==='config-edit'` la fila activa renderiza el text-input con el
 * carácter bajo el cursor invertido (`<Text inverse>` — color-isolation intacta, NO picocolors;
 * Pitfall 5: el inverse se serializa como ANSI, los tests asseren por contenido). El footer pinta el
 * error de validación/escritura (configEditError, rojo — derivado del estado dedicado, Pitfall 2) o,
 * tras un guardado, el aviso de reinicio transitorio (focusError/footerColor — PERSIST-03/D-10).
 *
 * PERSIST-04 (D-11): la lista viene SOLO de getEditableFields (restringida por construcción) — ningún
 * api_key_env/base_url/workspace_slug se itera ni se renderiza. Los secretos jamás entran al overlay.
 *
 * @param {any} snapshot - clon congelado del config en edición.
 * @param {number} fieldCursor - índice del campo seleccionado [0, fields.length-1].
 * @param {'config'|'config-edit'} mode
 * @param {string} buffer - text-input controlado (solo relevante en config-edit).
 * @param {number} cursor - posición del cursor en el buffer.
 * @param {string|null} configEditError - error de validación/escritura (rojo) o null.
 * @param {string|null} focusError - aviso transitorio post-guardado (PERSIST-03) o null.
 * @param {string} footerColor - color del aviso transitorio (yellow tras guardar).
 * @param {boolean} mask - Phase 67 D-05: enmascara el text-input del renglón de API key (`•` por char).
 * @param {boolean} apiKeyConfigured - Phase 67 D-09: presencia de la API key (indicador, NUNCA el valor).
 * @param {boolean} rawModeSupported - Phase 67 D-07/Pitfall 16: si false, el renglón de API key degrada.
 * @returns {import('react').ReactElement}
 */
function renderConfigOverlay(snapshot, fieldCursor, mode, buffer, cursor, configEditError, focusError, footerColor, mask = false, apiKeyConfigured = false, rawModeSupported = true) {
  const fields = getEditableFields(snapshot);
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, CONFIG_OVERLAY_TITLE),
  );

  const rows = fields.map((field, i) => {
    const selected = i === fieldCursor;
    const isEditing = selected && mode === 'config-edit';
    // Valor: read-only salvo en la fila que se está editando, donde se pinta el text-input con cursor.
    let valueEl;
    if (isEditing) {
      // Cursor por `inverse` (Pattern 1 RESEARCH). Si cursor===buffer.length, bloque (espacio) al final.
      const left = buffer.slice(0, cursor);
      const under = buffer[cursor] ?? ' ';
      const right = buffer.slice(cursor + 1);
      valueEl = h(Text, null, left, h(Text, { inverse: true }, under), right);
    } else {
      valueEl = h(Text, { bold: selected }, String(getByPath(snapshot, field.path) ?? ''));
    }
    return h(
      Box,
      { key: field.path, flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      h(Box, { width: 24 }, h(Text, { bold: selected }, `${field.label}:`)),
      valueEl,
    );
  });

  // Phase 67 Plan 02 (SETUP-03/04, D-05/D-06/D-07/D-09): renglón DEDICADO de la API key, APPEND tras
  // los 11 campos de getEditableFields (índice = fields.length). Deliberadamente FUERA de
  // getEditableFields → el secreto NUNCA entra a config.json ni a la lista editable (PERSIST-04). Tres
  // pinturas del valor, en precedencia:
  //   (1) non-TTY (rawModeSupported === false, Pitfall 16): mensaje de degradación (dim), never-edita.
  //   (2) editando (isEditing): text-input con el VALOR DERIVADO a `•` cuando mask (el buffer real vive
  //       en App; aquí solo se pinta la máscara — el valor jamás se renderiza raw, Pitfall 11). El
  //       cursor `inverse` opera sobre la máscara (1 code-unit/char → posición 1:1 con el buffer ASCII).
  //   (3) read-only: indicador de PRESENCIA [configurado]/[sin configurar] (D-09) — jamás el valor.
  const apiSelected = fieldCursor === fields.length;
  const apiEditing = apiSelected && mode === 'config-edit';
  let apiValueEl;
  if (!rawModeSupported) {
    apiValueEl = h(Text, { dimColor: true }, API_KEY_NO_RAWMODE);
  } else if (apiEditing) {
    const display = mask ? '•'.repeat(buffer.length) : buffer;
    const left = display.slice(0, cursor);
    const under = display[cursor] ?? ' ';
    const right = display.slice(cursor + 1);
    apiValueEl = h(Text, null, left, h(Text, { inverse: true }, under), right);
  } else {
    apiValueEl = apiKeyConfigured
      ? h(Text, { bold: apiSelected }, API_KEY_CONFIGURED)
      : h(Text, { dimColor: true }, API_KEY_UNSET);
  }
  const apiKeyRow = h(
    Box,
    { key: '__api_key__', flexDirection: 'row' },
    h(Box, { width: 2 }, h(Text, { bold: apiSelected }, apiSelected ? '› ' : '  ')),
    h(Box, { width: 24 }, h(Text, { bold: apiSelected }, `${API_KEY_LABEL}:`)),
    apiValueEl,
  );
  const body = h(Box, { flexDirection: 'column' }, ...rows, apiKeyRow);

  // Footer: error de validación/escritura (rojo, configEditError dedicado) gana; si no, el aviso
  // transitorio de reinicio (focusError/footerColor) tras un guardado con éxito (PERSIST-03/D-10).
  let statusLine = null;
  if (configEditError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, configEditError));
  } else if (focusError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: footerColor }, focusError));
  }
  const hint = h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { dimColor: true },
      mode === 'config-edit'
        ? '←→ move · ⌫ borrar · Enter guardar · Esc cancelar'
        : '↑↓ move · Enter editar · Esc cerrar',
    ),
  );
  return h(Box, { flexDirection: 'column' }, header, body, statusLine, hint);
}

/**
 * Render del MODO SETUP (Phase 68 Plan 02, SETUP-01/02, D-04/D-05/D-06/D-08/D-13). Molde EXACTO de
 * renderConfigOverlay: gutter `Box width:2` (`› `/`  `), label `Box width:24`, título cyan/bold,
 * cabecera de paso dim, cursor `inverse`, y para el paso apikey la máscara `'•'.repeat(buffer.length)`
 * (el VALOR jamás se renderiza raw — Pitfall 11/T-68-04). Degradación non-TTY: si !rawModeSupported
 * pinta SOLO SETUP_NO_RAWMODE (dim, never-throws, D-13). NO introduce colores/anchos nuevos.
 *
 * @param {'provider'|'base_url'|'workspace_slug'|'apikey'|'complete'} setupStep - paso activo del wizard.
 * @param {number} providerCursor - cursor del selector de provider (índice sobre SETUP_PROVIDERS).
 * @param {string} buffer - text-input controlado de los pasos base_url/workspace_slug/apikey.
 * @param {number} cursor - posición del cursor dentro del buffer.
 * @param {string|null} configEditError - error de validación/escritura (rojo, estado dedicado).
 * @param {string|null} focusError - aviso transitorio (p.ej. SETUP_GITHUB_REDIRECT — yellow).
 * @param {string} footerColor - color del aviso transitorio.
 * @param {boolean} rawModeSupported - si false, degrada a SETUP_NO_RAWMODE (D-13, never-throws).
 * @returns {import('react').ReactElement}
 */
function renderSetupOverlay(setupStep, providerCursor, buffer, cursor, configEditError, focusError, footerColor, rawModeSupported = true) {
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, SETUP_OVERLAY_TITLE),
  );

  // Degradación non-TTY (D-13/Pitfall 16): never-throws, remite a `kodo config`. Precede a todo.
  if (!rawModeSupported) {
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Text, { dimColor: true }, SETUP_NO_RAWMODE),
    );
  }

  // Paso terminal 'complete' (D-08/D-12): aviso de reinicio honesto + nota del webhook secret.
  if (setupStep === 'complete') {
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Text, { color: 'yellow' }, SETUP_COMPLETE_RESTART),
      h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, SETUP_WEBHOOK_NOTE)),
    );
  }

  // Cabecera de paso (dim) + intro (solo en el paso provider, first-run).
  const stepHeader =
    setupStep === 'provider' ? SETUP_STEP_PROVIDER
      : setupStep === 'base_url' ? SETUP_STEP_BASE_URL
        : setupStep === 'workspace_slug' ? SETUP_STEP_WORKSPACE
          : SETUP_STEP_APIKEY;

  /** @type {import('react').ReactElement} */
  let body;
  if (setupStep === 'provider') {
    // Selector de provider (D-05): lista con gutter `› ` + bold en la opción seleccionada (clamp sin wrap).
    const rows = SETUP_PROVIDERS.map((name, i) => {
      const selected = i === providerCursor;
      return h(
        Box,
        { key: name, flexDirection: 'row' },
        h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
        h(Text, { bold: selected }, name),
      );
    });
    body = h(
      Box,
      { flexDirection: 'column' },
      h(Text, null, SETUP_INTRO),
      h(Box, { marginTop: 1 }, h(Text, { bold: true }, SETUP_PROVIDER_LABEL)),
      ...rows,
      h(Text, { dimColor: true }, SETUP_PROVIDER_HINT),
    );
  } else {
    // Pasos base_url/workspace_slug/apikey: fila label (width 24) + text-input con cursor `inverse`.
    // El paso apikey SIEMPRE enmascara el valor (`•`.repeat) — el secreto jamás se renderiza raw.
    const label =
      setupStep === 'base_url' ? SETUP_BASE_URL_LABEL
        : setupStep === 'workspace_slug' ? SETUP_WORKSPACE_LABEL
          : API_KEY_LABEL;
    const display = setupStep === 'apikey' ? '•'.repeat(buffer.length) : buffer;
    const left = display.slice(0, cursor);
    const under = display[cursor] ?? ' ';
    const right = display.slice(cursor + 1);
    body = h(
      Box,
      { flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: true }, '› ')),
      h(Box, { width: 24 }, h(Text, { bold: true }, `${label}:`)),
      h(Text, null, left, h(Text, { inverse: true }, under), right),
    );
  }

  // Footer: error de validación/escritura (rojo, configEditError dedicado) gana; si no, el aviso
  // transitorio (focusError/footerColor — p.ej. SETUP_GITHUB_REDIRECT yellow, D-06).
  let statusLine = null;
  if (configEditError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, configEditError));
  } else if (focusError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: footerColor }, focusError));
  }
  const hint = h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { dimColor: true },
      setupStep === 'provider'
        ? '↑↓ elegir · Enter confirmar · Esc salir'
        : '←→ move · ⌫ borrar · Enter confirmar · Esc salir',
    ),
  );
  return h(Box, { flexDirection: 'column' }, header, h(Box, { flexDirection: 'column' }, h(Text, { dimColor: true }, stepHeader), body), statusLine, hint);
}

/**
 * Render del estado transitorio `projects-loading` (Phase 64 Plan 02, D-01): cabecera + el texto de
 * carga mientras listProjectsFn está en vuelo. El poll /status sigue por debajo (snapshot congelado).
 *
 * @returns {import('react').ReactElement}
 */
function renderProjectsLoading() {
  return h(
    Box,
    { flexDirection: 'column' },
    h(Box, { marginBottom: 1 }, h(Text, { color: 'cyan', bold: true }, PROJECTS_OVERLAY_TITLE)),
    h(Text, { dimColor: true }, PROJECTS_LOADING),
  );
}

/**
 * Render del estado de degradación `projects-error` (Phase 64 Plan 02, PROJ-05/D-07): panel rojo con
 * PROJECTS_LOAD_FAILED(reason) + la pista de teclas (r reintentar · Esc salir, embebida en la copy).
 * Never-throws: el panel ink permanece montado; projects.json NO se toca (carril de LECTURA).
 *
 * @param {string|null} projectsError - mensaje del fallo de fetch (red/timeout/HTTP).
 * @returns {import('react').ReactElement}
 */
function renderProjectsError(projectsError) {
  return h(
    Box,
    { flexDirection: 'column' },
    h(Box, { marginBottom: 1 }, h(Text, { color: 'cyan', bold: true }, PROJECTS_OVERLAY_TITLE)),
    h(Text, { color: 'red' }, PROJECTS_LOAD_FAILED(projectsError ?? 'error desconocido')),
  );
}

/**
 * Render del overlay del EDITOR de proyectos (Phase 64 Plan 02, PROJ-01/02 / D-01/D-03). Molde de
 * renderConfigOverlay/renderAdoptPicker: lista navegable con cursor (gutter `› ` + bold sobre la fila
 * activa). Cada fila muestra `identifier — name` + su estado de mapeo derivado de getProjectPath
 * (la ruta local mapeada, o PROJECTS_UNMAPPED). En `mode==='projects-edit'` la fila activa renderiza
 * el text-input de la ruta con el carácter bajo el cursor invertido (`<Text inverse>` — color-isolation
 * intacta, NO picocolors; Pitfall 6: el inverse se serializa como ANSI, los tests asseren por contenido).
 *
 * PERSIST-04 (T-64-09): el overlay solo itera snapshot.remote (proyectos del provider) + rutas locales —
 * ningún api_key_env/base_url/workspace_slug entra al snapshot ni se renderiza (por construcción).
 *
 * @param {{ remote: Array<{ id: string, identifier: string, name: string }>, map: Record<string, any> }} snapshot
 * @param {number} fieldCursor - índice del proyecto seleccionado [0, remote.length-1].
 * @param {'projects'|'projects-edit'} mode
 * @param {string} buffer - text-input controlado de la ruta (solo relevante en projects-edit).
 * @param {number} cursor - posición del cursor en el buffer.
 * @param {string|null} projectsEditError - error de validación de ruta (rojo) o null.
 * @param {string|null} focusError - aviso transitorio post-guardado/quitar (PROJECTS_SAVED_RESTART /
 *   PROJECTS_REMOVED) o null.
 * @param {string} footerColor - color del aviso transitorio (yellow tras guardar/quitar).
 * @returns {import('react').ReactElement}
 */
function renderProjectsOverlay(snapshot, fieldCursor, mode, buffer, cursor, projectsEditError, focusError, footerColor) {
  const items = snapshot?.remote ?? [];
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, PROJECTS_OVERLAY_TITLE),
  );

  const rows = items.map((item, i) => {
    const selected = i === fieldCursor;
    const isEditing = selected && mode === 'projects-edit';
    // Valor: el estado de mapeo (read-only) salvo en la fila que se edita, donde se pinta el text-input.
    let valueEl;
    if (isEditing) {
      // Cursor por `inverse` (molde renderConfigOverlay). Si cursor===buffer.length, bloque al final.
      const left = buffer.slice(0, cursor);
      const under = buffer[cursor] ?? ' ';
      const right = buffer.slice(cursor + 1);
      valueEl = h(Text, null, left, h(Text, { inverse: true }, under), right);
    } else {
      const path = getProjectPath(snapshot.map[item.id]);
      valueEl = path
        ? h(Text, { bold: selected }, path)
        : h(Text, { dimColor: true }, PROJECTS_UNMAPPED);
    }
    return h(
      Box,
      { key: item.id, flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      h(Box, { width: 24 }, h(Text, { bold: selected }, `${item.identifier} — ${item.name}`)),
      valueEl,
    );
  });
  const body = h(Box, { flexDirection: 'column' }, ...rows);

  // Footer: el error de validación de ruta (rojo, projectsEditError dedicado) gana; si no, el aviso
  // transitorio (focusError/footerColor) tras un guardado/quitar con éxito (PERSIST-03/D-06).
  let statusLine = null;
  if (projectsEditError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, projectsEditError));
  } else if (focusError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: footerColor }, focusError));
  }
  const hint = h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { dimColor: true },
      mode === 'projects-edit'
        ? '←→ move · ⌫ borrar · Enter guardar · Esc cancelar'
        : '↑↓ move · Enter editar · x quitar · Esc cerrar',
    ),
  );
  return h(Box, { flexDirection: 'column' }, header, body, statusLine, hint);
}

/**
 * Render del estado transitorio `projects-modules-loading` (Phase 64 Plan 03, PROJ-04): cabecera del
 * sub-overlay de módulos + el texto de carga mientras listModulesFn (2º hop) está en vuelo.
 *
 * @returns {import('react').ReactElement}
 */
function renderModulesLoading() {
  return h(
    Box,
    { flexDirection: 'column' },
    h(Box, { marginBottom: 1 }, h(Text, { color: 'cyan', bold: true }, PROJECTS_MODULES_TITLE)),
    h(Text, { dimColor: true }, PROJECTS_LOADING),
  );
}

/**
 * Render del sub-overlay del editor de MÓDULOS (Phase 64 Plan 03, PROJ-04/D-05). Molde de
 * renderProjectsOverlay: lista navegable con cursor (gutter `› ` + bold sobre la fila activa). Cada
 * fila muestra `mod.name` + su estado de mapeo derivado de getModuleMap(snapshot.map[activeProjectId])
 * (la ruta local mapeada, o PROJECTS_UNMAPPED). En `mode==='projects-modules-edit'` la fila activa
 * renderiza el text-input de la ruta con el carácter bajo el cursor invertido (`<Text inverse>` —
 * color-isolation intacta, NO picocolors; Pitfall 6: el inverse se serializa como ANSI, los tests
 * asseren por contenido).
 *
 * El sub-overlay solo itera snapshot.modules (módulos del provider) + rutas locales — ningún secreto
 * entra al snapshot ni se renderiza (por construcción).
 *
 * @param {{ map: Record<string, any>, modules?: Array<{ id: string, name: string }>, activeProjectId?: string }} snapshot
 * @param {number} fieldCursor - índice del módulo seleccionado [0, modules.length-1].
 * @param {'projects-modules'|'projects-modules-edit'} mode
 * @param {string} buffer - text-input controlado de la ruta (solo relevante en projects-modules-edit).
 * @param {number} cursor - posición del cursor en el buffer.
 * @param {string|null} projectsEditError - error de validación de ruta (rojo) o null.
 * @param {string|null} focusError - aviso transitorio post-guardado (PROJECTS_SAVED_RESTART) o null.
 * @param {string} footerColor - color del aviso transitorio (yellow tras guardar).
 * @returns {import('react').ReactElement}
 */
function renderModulesOverlay(snapshot, fieldCursor, mode, buffer, cursor, projectsEditError, focusError, footerColor) {
  const modules = snapshot?.modules ?? [];
  const moduleMap = getModuleMap(snapshot?.map?.[snapshot?.activeProjectId]);
  const header = h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: 'cyan', bold: true }, PROJECTS_MODULES_TITLE),
  );

  const rows = modules.map((mod, i) => {
    const selected = i === fieldCursor;
    const isEditing = selected && mode === 'projects-modules-edit';
    // Valor: el estado de mapeo (read-only) salvo en la fila que se edita, donde se pinta el text-input.
    let valueEl;
    if (isEditing) {
      // Cursor por `inverse` (molde renderProjectsOverlay). Si cursor===buffer.length, bloque al final.
      const left = buffer.slice(0, cursor);
      const under = buffer[cursor] ?? ' ';
      const right = buffer.slice(cursor + 1);
      valueEl = h(Text, null, left, h(Text, { inverse: true }, under), right);
    } else {
      const path = moduleMap[mod.name];
      valueEl = path
        ? h(Text, { bold: selected }, path)
        : h(Text, { dimColor: true }, PROJECTS_UNMAPPED);
    }
    return h(
      Box,
      { key: mod.id ?? mod.name ?? `mod-${i}`, flexDirection: 'row' },
      h(Box, { width: 2 }, h(Text, { bold: selected }, selected ? '› ' : '  ')),
      h(Box, { width: 24 }, h(Text, { bold: selected }, mod.name)),
      valueEl,
    );
  });
  const body = h(Box, { flexDirection: 'column' }, ...rows);

  // Footer: el error de validación de ruta (rojo, projectsEditError dedicado) gana; si no, el aviso
  // transitorio (focusError/footerColor) tras un guardado con éxito (PROJECTS_SAVED_RESTART).
  let statusLine = null;
  if (projectsEditError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, projectsEditError));
  } else if (focusError != null) {
    statusLine = h(Box, { marginTop: 1 }, h(Text, { color: footerColor }, focusError));
  }
  const hint = h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { dimColor: true },
      mode === 'projects-modules-edit'
        ? '←→ move · ⌫ borrar · Enter guardar · Esc cancelar'
        : '↑↓ move · Enter editar · Esc volver',
    ),
  );
  return h(Box, { flexDirection: 'column' }, header, body, statusLine, hint);
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
 * @param {'list'|'filter'|'overlay'|'confirm'|'deriving'} [props.mode] - modo de interacción. En
 *   `filter` se muestra la línea de filtro modal al pie; en `confirm` (Phase 42) el armed prompt
 *   persistente; en `deriving` (Phase 62) el spinner DERIVE_PROGRESS mientras onDerive corre.
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
 * @param {string|null} [props.armedSurfaceTitle] - Phase 62 D-08: título DERIVADO por onDerive del
 *   adopt armado. Si != null, el confirm muestra la propuesta (`título: …`) y usa la copy
 *   ADOPT_DERIVED_CONFIRM; si null (fail-open T4), usa ADOPT_DERIVED_CONFIRM_FALLBACK (degradado).
 * @param {string|null} [props.armedSurfaceDescription] - Phase 62 D-08: descripción DERIVADA por
 *   onDerive. Render `desc: …` (dimColor) bajo el título cuando está presente.
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
  unauthorized = false,
  unauthorizedMessage = '',
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
  armedSurfaceTitle = null,
  armedSurfaceDescription = null,
  adoptCursor = 0,
  overlayKind = null,
  scrollOffset = 0,
  overlaySnapshot = null,
  configSnapshot = null,
  fieldCursor = 0,
  buffer = '',
  cursor = 0,
  configEditError = null,
  mask = false,
  apiKeyConfigured = false,
  rawModeSupported = true,
  setupStep = 'provider',
  providerCursor = 0,
  projectsSnapshot = null,
  projectsError = null,
  projectsEditError = null,
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
  // Phase 63 Plan 02 (UX-01/D-01/D-03): early-return del editor de config (lista navegable +
  // text-input), espejo del overlay de lectura. Ocupa el área de la tabla mientras está abierto.
  if ((mode === 'config' || mode === 'config-edit') && configSnapshot) {
    return renderConfigOverlay(configSnapshot, fieldCursor, mode, buffer, cursor, configEditError, focusError, footerColor, mask, apiKeyConfigured, rawModeSupported);
  }
  // Phase 68 Plan 02 (SETUP-01/02, D-04/D-13): early-return del MODO SETUP (wizard lineal de first-run),
  // espejo del overlay de config. Ocupa el área de la tabla mientras el guiado está abierto. La
  // degradación non-TTY vive DENTRO de renderSetupOverlay (D-13 — el guard de index.js queda intacto).
  if (mode === 'setup') {
    return renderSetupOverlay(setupStep, providerCursor, buffer, cursor, configEditError, focusError, footerColor, rawModeSupported);
  }
  // Phase 64 Plan 02 (D-01/D-02/D-07): early-returns del editor de PROYECTOS (carril async), espejo
  // del overlay de config. Ocupan el área de la tabla mientras el editor está abierto. El orden cubre
  // los cuatro modos: loading/error son transitorios (sin snapshot necesario); projects/projects-edit
  // requieren el snapshot congelado.
  if (mode === 'projects-loading') {
    return renderProjectsLoading();
  }
  if (mode === 'projects-error') {
    return renderProjectsError(projectsError);
  }
  if ((mode === 'projects' || mode === 'projects-edit') && projectsSnapshot) {
    return renderProjectsOverlay(projectsSnapshot, fieldCursor, mode, buffer, cursor, projectsEditError, focusError, footerColor);
  }
  // Phase 64 Plan 03 (PROJ-04/D-05): early-returns del sub-editor de MÓDULOS (2º hop). loading es
  // transitorio (sin snapshot); projects-modules/-edit requieren la lista de módulos congelada.
  if (mode === 'projects-modules-loading') {
    return renderModulesLoading();
  }
  if ((mode === 'projects-modules' || mode === 'projects-modules-edit') && projectsSnapshot?.modules) {
    return renderModulesOverlay(projectsSnapshot, fieldCursor, mode, buffer, cursor, projectsEditError, focusError, footerColor);
  }
  const indicator = h(LiveIndicator, { connected, lastGoodCount, lastGoodAt, lastAttemptAt, unauthorized, unauthorizedMessage });
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

  // Phase 62 D-08 (ORCH-02): derivingLine es el spinner NEUTRAL del estado transitorio `deriving`
  // (onDerive en vuelo). Mismo molde `<Box marginTop=1>` que filterLine/errorLine. dimColor (NO
  // cyan — el cyan queda reservado al prompt armado/actionable; el spinner es informativo, UI-SPEC
  // §Color). Precede a TODO en la cadena de precedencia (el operador está esperando la propuesta).
  const derivingLine =
    mode === 'deriving'
      ? h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, DERIVE_PROGRESS))
      : null;

  // Phase 42 D-02/D-12 (DISMISS-02): confirmLine es el armed prompt PERSISTENTE (no transitorio):
  // se deriva de `mode==='confirm'` (NO de focusError) para que el clear-on-any-input no lo consuma
  // (RESEARCH Pitfall 4). Misma forma `<Box marginTop=1>` que filterLine/errorLine. Color cyan
  // (armed/actionable, UI-SPEC §Color) via nombre de ink — color-isolation intacta. Precede a
  // errorLine/filterLine mientras está armado.
  // Phase 56 Pitfall 2 (DETECT-02): el confirm tiene DOS consumidores. Se rutea el copy por cuál
  // armed-id está set: armedSessionId != null → adopt (ref = workspaceRef); si no → DISMISS_CONFIRM.
  // Phase 62 D-08 (ORCH-02): cuando el confirm es de ADOPT, se muestra la PROPUESTA derivada:
  //   - con título derivado (armedSurfaceTitle != null): líneas multi-render
  //       `título: <title truncado…>` (bold) + `desc: <description truncada…>` (dimColor) +
  //       ADOPT_DERIVED_CONFIRM(ref) (cyan).
  //   - sin título derivado (fail-open T4): SOLO ADOPT_DERIVED_CONFIRM_FALLBACK(ref) (cyan), sin
  //     líneas título:/desc:. NO error rojo (es degradado, no fallo).
  // Truncado con `…` (un char). El `…` mantiene el footer en 1-2 líneas (no desborda la TUI).
  const adoptConfirmContent = () => {
    const ref = armedSurfaceRef ?? '';
    if (armedSurfaceTitle != null) {
      const title = truncateEllipsis(armedSurfaceTitle, 60);
      const desc =
        armedSurfaceDescription != null ? truncateEllipsis(armedSurfaceDescription, 120) : null;
      return [
        h(Text, { key: 'title', bold: true }, `título: ${title}`),
        desc != null ? h(Text, { key: 'desc', dimColor: true }, `desc: ${desc}`) : null,
        h(Text, { key: 'prompt', color: 'cyan' }, ADOPT_DERIVED_CONFIRM(ref)),
      ].filter(Boolean);
    }
    // Fail-open T4: confirm degradado, sin líneas título:/desc:.
    return [h(Text, { key: 'prompt', color: 'cyan' }, ADOPT_DERIVED_CONFIRM_FALLBACK(ref))];
  };
  const confirmLine =
    mode === 'confirm'
      ? armedSessionId != null
        ? h(Box, { marginTop: 1, flexDirection: 'column' }, ...adoptConfirmContent())
        : h(Box, { marginTop: 1 }, h(Text, { color: 'cyan' }, DISMISS_CONFIRM(armedTaskRef ?? '')))
      : null;

  // (2) Precedencia de estados vacíos (D-12, Pitfall 5):
  //   - waiting/stale (never had good O degradado) gana SIEMPRE → solo el indicador, sin tabla.
  //   - connected + 0 filas + query activa → `no sessions match` (Plan 03).
  //   - connected + 0 filas sin query      → `no active sessions`.
  // La línea de filtro se anexa al pie en TODAS las ramas (el operador ve su query aunque oculte todo).
  if (!connected && lastGoodAt == null) {
    return h(Box, { flexDirection: 'column' }, header, (derivingLine ?? confirmLine ?? errorLine ?? filterLine));
  }
  if (rows.length === 0) {
    const emptyCopy = hasQuery ? 'no sessions match' : 'no active sessions';
    return h(
      Box,
      { flexDirection: 'column' },
      header,
      h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, emptyCopy)),
      (derivingLine ?? confirmLine ?? errorLine ?? filterLine),
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
    (derivingLine ?? confirmLine ?? errorLine ?? filterLine),
  );
}
