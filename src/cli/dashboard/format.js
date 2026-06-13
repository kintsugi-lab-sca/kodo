// @ts-check
//
// src/cli/dashboard/format.js — Phase 36 Plan 01 (TUI-07 + TUI-10; D-03/D-08/D-09).
//
// Capa de presentación PURA (React-free, ink-free) del dashboard: mapea un `Session`
// enriquecido (+ alive/elapsed_min del server, ver src/server.js GET /status) a las celdas
// de la tabla viva y decide el color semántico. Es testeable sin ink (test/dashboard-format).
//
// Decisiones implementadas:
//   - D-03 (mapeo NO 1:1 con SessionRecord): NO existe campo `repo` → deriveRepo desde
//     project_name | basename(project_path). `phase/mode` = phase_id + gsd_mode (ambos
//     GSD-only). `age` = formatAge(elapsed_min) — el server ya computó elapsed_min, no se
//     recomputa cliente-side.
//   - D-08 (paleta LOCKED): statusColor devuelve NOMBRES de color ink (strings planos) o el
//     sentinel { dim:true } para done. JAMÁS ANSI: ink convierte el nombre a ANSI internamente
//     vía su propio chalk — NO picocolors (color-isolation, D-12 Phase 34). El red está
//     reservado SOLO al zombie (statusColor sobre running+!alive); el error usa magenta para
//     no confundirse con un proceso muerto.
//   - La celda `status` muestra el OUTCOME auto-reportado (outcomeCell: error/done/review), en
//     blanco para los valores de lifecycle, que son del eje `state` (fix divergencia state/status).
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. test/format-isolation.test.js lo verifica vía walker automático.

import { basename } from 'node:path';

/**
 * @typedef {import('../../session/state.js').Session} Session
 * @typedef {Session & { alive?: boolean, elapsed_min?: number, provider_state?: string|null, provider_state_reason?: null|'unsupported'|'fetch-failed' }} EnrichedSession
 */

/**
 * Deriva el nombre de repo a mostrar. NO existe campo `repo` en SessionRecord (D-03):
 * preferir `project_name`, si no `basename(project_path)`, si no el placeholder `—`.
 *
 * @param {Partial<EnrichedSession>} session
 * @returns {string} nombre de repo o '—'.
 */
export function deriveRepo(session) {
  if (session.project_name) return session.project_name;
  if (session.project_path) {
    const base = basename(session.project_path);
    if (base) return base;
  }
  return '—';
}

/**
 * Humaniza la edad (en minutos) a formato compacto (D-03). El server ya computa `elapsed_min`
 * en GET /status, así que se prefiere ese campo a recomputar desde started_at.
 *   5 → '5m'; 63 → '1h3m'; 120 → '2h'. null/undefined/negativo → '—'.
 *
 * @param {number|null|undefined} elapsedMin
 * @returns {string}
 */
export function formatAge(elapsedMin) {
  if (elapsedMin == null || elapsedMin < 0) return '—';
  if (elapsedMin < 60) return `${elapsedMin}m`;
  const h = Math.floor(elapsedMin / 60);
  const m = elapsedMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** Placeholder de la columna phase/mode para sesiones sin metadata GSD (yolo/plain). */
export const NO_GSD_LABEL = 'No GSD';

/**
 * Une `phase_id` + `gsd_mode` con '/' (D-03). Ambos son GSD-only (opcionales):
 *   {phase_id:'36',gsd_mode:'full'} → '36/full'; solo phase_id → '36'.
 *   Sin NINGUNO (ni phase_id ni gsd_mode) → `NO_GSD_LABEL` ('No GSD'): la sesión no se
 *   despachó como GSD (p. ej. label `kodo:yolo`). Más explícito que el `—` genérico, y se
 *   renderiza atenuado (SessionTable) para no competir con valores reales tipo '42/full'.
 *
 * @param {Partial<EnrichedSession>} session
 * @returns {string}
 */
export function phaseMode(session) {
  const parts = [session.phase_id, session.gsd_mode].filter(Boolean);
  return parts.length === 0 ? NO_GSD_LABEL : parts.join('/');
}

/**
 * Decisión de color semántico (D-08). Devuelve un objeto plano con un NOMBRE de color ink
 * (`'green'|'red'|'cyan'|'magenta'|'yellow'`) o el sentinel `{ dim:true }` para done — NUNCA
 * ANSI. ink (App, Plan 02) lo pasa a `<Text color>` y produce el ANSI internamente.
 *
 * El switch v2 (`status`) tiene PRECEDENCIA: si matchea una rama v2 se devuelve su color sin
 * mirar el estado v3. Solo cuando NINGUNA rama v2 matchea (status v2 `null`, típico de sesiones
 * v3 idle/needs-input) se deriva del estado v3 (`state`) reusando la paleta YA LOCKED de
 * `STATE_BADGES` — exactamente como `stateBadge` (D-06). Sin literales de color nuevos: el color
 * se LEE de STATE_BADGES (idle=yellow, needs-input=cyan, dead=red), no se duplica.
 *
 *   running + !alive (ZOMBIE) → { color:'red' }   (el único uso de red v2 en la fase)
 *   running + alive           → { color:'green' }
 *   review                    → { color:'cyan' }
 *   error                     → { color:'magenta' } (distinto del red del zombie)
 *   done                      → { dim:true }
 *   (sin rama v2) + state v3   → { color: STATE_BADGES[state].color }  (TUI-10, 39.1-03)
 *   otro                      → {}
 *
 * Función pura sin I/O → byte-determinismo `--json`/NO_COLOR preservado.
 *
 * @param {string} status estado v2 (puede ser null/'' en sesiones v3)
 * @param {boolean} [alive]
 * @param {string} [state] estado v3 del lifecycle (idle|needs-input|dead|running|…), opcional
 * @returns {{ color?: string, dim?: boolean }}
 */
export function statusColor(status, alive, state) {
  if (status === 'running' && !alive) return { color: 'red' };
  if (status === 'running') return { color: 'green' };
  if (status === 'review') return { color: 'cyan' };
  if (status === 'error') return { color: 'magenta' };
  if (status === 'done') return { dim: true };
  if (STATE_BADGES[state ?? '']) return { color: STATE_BADGES[state ?? ''].color };
  return {};
}

/**
 * Celda `status` = OUTCOME auto-reportado por el agente (fix divergencia state/status,
 * follow-up de Phase 43). Tras el fix de `provider_state`, el dashboard tiene tres ejes:
 * `state` = lifecycle observado por reconcileTick (running/idle/needs-input/dead), `task` =
 * estado de la tarea en el provider (Plane/GitHub), y `status` = lo que el agente reportó
 * de su trabajo. Esta celda muestra SOLO los outcomes que los otros dos ejes no poseen —
 * `error`, `done`, `review` — y devuelve '' para los valores de lifecycle (running/idle/…),
 * que pertenecen a la columna `state`. Así la columna nunca contradice a `state`: una celda
 * en blanco significa "sesión en vuelo". El color lo aporta statusColor (error=magenta,
 * review=cyan, done=dim); sobre '' es invisible.
 *
 * @param {string} [status]
 * @returns {string}
 */
export function outcomeCell(status) {
  return status === 'error' || status === 'done' || status === 'review' ? status : '';
}

/**
 * Phase 38 D-06: badges por estado del lifecycle (literal-stable). Cada entrada
 * mapea un `state` v3 a su glyph + color ink (string name, NO ANSI/picocolors) +
 * label textual. `closed` NO está aquí (vive en history, no se renderiza — D-04);
 * `review`/`error`/estados legacy tampoco (los cubre statusColor + outcomeCell).
 * Byte-stable: cambiar un glyph o color rompe test/dashboard-table.test.js loud.
 *
 * @type {Readonly<Record<string, { glyph: string, color: string, label: string }>>}
 */
export const STATE_BADGES = Object.freeze({
  running: { glyph: '▶', color: 'green', label: 'running' },
  idle: { glyph: '⏸', color: 'yellow', label: 'idle' },
  'needs-input': { glyph: '🔔', color: 'cyan', label: 'needs-input' },
  dead: { glyph: '✗', color: 'red', label: 'dead' },
});

/**
 * Badge del estado v3 (D-06). Mirror del patrón statusColor: lookup en
 * STATE_BADGES con fallback `{}` para estados sin badge (`closed`, `review`,
 * legacy, undefined) — la celda queda vacía sin romper el render.
 *
 * @param {string} [state]
 * @returns {{ glyph?: string, color?: string, label?: string }}
 */
export function stateBadge(state) {
  return STATE_BADGES[state ?? ''] ?? {};
}

/**
 * Compone el string compacto de contadores del header (D-11). Solo estados con
 * count ≥ 1, separados por ` · `. Orden: running → zombie (Phase 36) → review →
 * error → done (legacy) → idle → needs-input → dead (Phase 38 D-06, al final
 * para no alterar el orden pre-existente). Movido aquí desde SessionTable.js
 * (Phase 38): es presentación pura, testeable sin ink.
 *
 * @param {{ running?: number, zombie?: number, review?: number, error?: number, done?: number, idle?: number, 'needs-input'?: number, dead?: number }} counts
 * @returns {string}
 */
export function countsLabel(counts) {
  const parts = [];
  if (counts.running > 0) parts.push(`${counts.running} running`);
  if (counts.zombie > 0) parts.push(`${counts.zombie} zombie`);
  if (counts.review > 0) parts.push(`${counts.review} review`);
  if (counts.error > 0) parts.push(`${counts.error} error`);
  if (counts.done > 0) parts.push(`${counts.done} done`);
  if (counts.idle > 0) parts.push(`${counts.idle} idle`);
  if (counts['needs-input'] > 0) parts.push(`${counts['needs-input']} needs-input`);
  if (counts.dead > 0) parts.push(`${counts.dead} dead`);
  return parts.join(' · ');
}

/**
 * Phase 43 (PSTATE-05; D-04/D-05/D-08): deriva la celda `task` del estado de la tarea en su
 * sistema de gestión (Plane/GitHub) — el EJE PROVIDER, distinto del eje proceso local (`status`).
 * Lee SOLO `provider_state` + `provider_state_reason`, los campos que Phase 40 enriquece en
 * `GET /status` (carril read-only; este módulo no los computa ni escribe).
 *
 * Los tres reason-states (Phase 40 D-05) son distinguibles SIN color (D-04, NO_COLOR-safe):
 *   - reason 'unsupported' (permanente, el provider no expone estado) → `{ text: '—', dim: true }`
 *   - reason 'fetch-failed' (transitorio, falló ahora, reintentará)   → `{ text: '?', dim: true }`
 *   - reason null/ausente → el VALOR CRUDO verbatim `{ text: provider_state, dim: false }`.
 *     Fallback seguro `{ text: '—', dim: false }` si `provider_state` es null/undefined (sin dim,
 *     para no confundirse con el `—` dim de unsupported — la ausencia se trata como sin-dato, no crashea).
 *
 * IMPORTANTE (specifics CONTEXT.md): `provider_state === 'unknown'` con `reason: null` es un
 * OK-VALUE verbatim (se muestra `unknown` tal cual), DISTINTO de null+unsupported/fetch-failed.
 * 'unknown' es un valor crudo real del normalizador, no un glyph degradado.
 *
 * Verbatim total (D-08, criterio 4): NUNCA se transforma el string — cero guiones-a-espacios,
 * cero tabla de mapeo. Un estado renombrado por el provider se muestra solo, sin tocar código.
 *
 * El `dim` es un bool plano (D-05): SessionTable lo mapea a `dimColor` de ink. Cero color propio
 * para el valor ok (NO una segunda paleta semántica — el color queda reservado al eje local).
 * Color-isolation intacta: el dim sale de ink, cero ANSI (ver test/format-isolation.test.js).
 *
 * @param {Partial<EnrichedSession>} session
 * @returns {{ text: string, dim: boolean }}
 */
export function taskCell(session) {
  const reason = session.provider_state_reason;
  if (reason === 'unsupported') return { text: '—', dim: true };
  if (reason === 'fetch-failed') return { text: '?', dim: true };
  // reason null/ausente → ok: valor crudo verbatim (incluido 'unknown'); fallback '—' sin dim.
  const raw = session.provider_state;
  return { text: raw == null ? '—' : raw, dim: false };
}

/**
 * Deriva la celda de la columna `prog` (Phase 50, PROG-03) desde el objeto `session.progress`
 * enriquecido CLIENT-SIDE en App.js (mold readPlan; NUNCA un campo del payload de /status — D-08).
 * Espejo EXACTO de la forma de taskCell: devuelve `{ text, dim }` PLANO, CERO color propio
 * (color-isolation D-12; el `dim` lo mapea ink a `dimColor`, cubierto por test/format-isolation).
 *
 * Los 4 estados LOCKED (UI-SPEC / D-07 / D-09):
 *   - sin progreso (progress ausente o status 'no-progress', ENOENT) → `{ text:'—', dim:true }`
 *     (espejo de taskCell 'unsupported'→'—').
 *   - fallo transiente (status 'error') → `{ text:'?', dim:true }` (espejo de taskCell
 *     'fetch-failed'→'?'). El keep-last-good lo gestiona App.js (enrich), NO progCell.
 *   - en progreso (status 'ok', !completed) → `{ text:'N/M', dim:false }` (p.ej. '1/3').
 *   - completado (status 'ok', completed) → `{ text:'N/M✓', dim:false }` (p.ej. '3/3✓').
 *
 * @param {Partial<EnrichedSession> & { progress?: { status: string, n?: number, m?: number, completed?: boolean } }} session
 * @returns {{ text: string, dim: boolean }}
 */
export function progCell(session) {
  const p = session.progress;
  if (!p || p.status === 'no-progress') return { text: '—', dim: true }; // estado #3 (sin progreso)
  if (p.status === 'error') return { text: '?', dim: true }; // estado #4 (fallo transiente; keep-last-good en App.js)
  const suffix = p.completed ? '✓' : ''; // estados #1/#2 (en progreso / completado)
  return { text: `${p.n}/${p.m}${suffix}`, dim: false };
}

/**
 * Proyecta una sesión enriquecida a las celdas de columna de la tabla (D-03). La celda
 * `status` usa `outcomeCell`: solo el outcome auto-reportado (error/done/review), en blanco
 * para los valores de lifecycle (que son del eje `state`), evitando la divergencia state/status.
 * La celda `task` (Phase 43) es el eje provider derivado por `taskCell` con la forma `{ text, dim }`.
 *
 * @param {Partial<EnrichedSession>} session
 * @returns {{ task_ref: string, repo: string, phasemode: string, status: string, task: { text: string, dim: boolean }, prog: { text: string, dim: boolean }, age: string }}
 */
export function rowCells(session) {
  return {
    task_ref: session.task_ref ?? '—',
    repo: deriveRepo(session),
    phasemode: phaseMode(session),
    status: outcomeCell(session.status ?? ''),
    task: taskCell(session),
    prog: progCell(session), // Phase 50 (PROG-03): celda progreso vivo, ENTRE task y age (D-06)
    age: formatAge(session.elapsed_min),
  };
}
