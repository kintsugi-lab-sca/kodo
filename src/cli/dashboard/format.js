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
//     reservado SOLO al zombie; el error usa magenta para no confundirse con un proceso muerto.
//   - D-09 (NO_COLOR / accesibilidad): statusLabel añade la marca textual `(zombie)` al caso
//     running+!alive, de modo que el zombie sea distinguible sin color.
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. test/format-isolation.test.js lo verifica vía walker automático.

import { basename } from 'node:path';

/**
 * @typedef {import('../../session/state.js').Session} Session
 * @typedef {Session & { alive?: boolean, elapsed_min?: number }} EnrichedSession
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

/**
 * Une `phase_id` + `gsd_mode` con '/' (D-03). Ambos son GSD-only (opcionales):
 *   {phase_id:'36',gsd_mode:'full'} → '36/full'; solo phase_id → '36'; ninguno → '—'.
 *
 * @param {Partial<EnrichedSession>} session
 * @returns {string}
 */
export function phaseMode(session) {
  const parts = [session.phase_id, session.gsd_mode].filter(Boolean);
  return parts.length === 0 ? '—' : parts.join('/');
}

/**
 * Decisión de color semántico (D-08). Devuelve un objeto plano con un NOMBRE de color ink
 * (`'green'|'red'|'cyan'|'magenta'`) o el sentinel `{ dim:true }` para done — NUNCA ANSI.
 * ink (App, Plan 02) lo pasa a `<Text color>` y produce el ANSI internamente.
 *
 *   running + !alive (ZOMBIE) → { color:'red' }   (el único uso de red en la fase)
 *   running + alive           → { color:'green' }
 *   review                    → { color:'cyan' }
 *   error                     → { color:'magenta' } (distinto del red del zombie)
 *   done                      → { dim:true }
 *   otro                      → {}
 *
 * @param {string} status
 * @param {boolean} [alive]
 * @returns {{ color?: string, dim?: boolean }}
 */
export function statusColor(status, alive) {
  if (status === 'running' && !alive) return { color: 'red' };
  if (status === 'running') return { color: 'green' };
  if (status === 'review') return { color: 'cyan' };
  if (status === 'error') return { color: 'magenta' };
  if (status === 'done') return { dim: true };
  return {};
}

/**
 * Marca textual del estado (D-09, redundancia NO_COLOR). El zombie (running+!alive) lleva el
 * sufijo `(zombie)` para ser distinguible sin color; el resto devuelve el status tal cual.
 *
 * @param {string} status
 * @param {boolean} [alive]
 * @returns {string}
 */
export function statusLabel(status, alive) {
  return status === 'running' && !alive ? 'running (zombie)' : status;
}

/**
 * Phase 38 D-06: badges por estado del lifecycle (literal-stable). Cada entrada
 * mapea un `state` v3 a su glyph + color ink (string name, NO ANSI/picocolors) +
 * label textual. `closed` NO está aquí (vive en history, no se renderiza — D-04);
 * `review`/`error`/estados legacy tampoco (los cubre statusColor/statusLabel).
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
 * Proyecta una sesión enriquecida a las celdas de columna de la tabla (D-03). La celda
 * `status` usa `statusLabel` para que un zombie muestre `(zombie)` aun sin color.
 *
 * @param {Partial<EnrichedSession>} session
 * @returns {{ task_ref: string, repo: string, phasemode: string, status: string, age: string }}
 */
export function rowCells(session) {
  return {
    task_ref: session.task_ref ?? '—',
    repo: deriveRepo(session),
    phasemode: phaseMode(session),
    status: statusLabel(session.status ?? '', session.alive),
    age: formatAge(session.elapsed_min),
  };
}
