// @ts-check
//
// src/cli/dashboard/select.js — Phase 36 Plan 01 (TUI-08/09/11/12; D-04/D-05/D-06/D-14/D-16).
//
// Capa de derive PURA (React-free, ink-free) del cursor/orden/contadores/filtro de la tabla
// viva. Es la base que el render (Plan 02) y la navegación/filtro consumen. Las DOS invariantes
// load-bearing de la fase viven aquí como funciones puras testeables sin host React:
//   - TUI-08: la selección se rastrea por `task_id` (NO por índice) y sobrevive al rebuild del
//     array de /status en cada poll (src/server.js reconstruye `sessions` con .map cada tick —
//     un índice carecería de sentido entre polls, esa es la clase ROMAN-132 trasladada a la UI).
//   - TUI-12: al aplicar/limpiar el filtro el cursor sigue a la misma sesión si permanece visible.
//
// Decisiones implementadas:
//   - D-04: sortSessions ordena una COPIA DESC por started_at, con tiebreak lexicográfico por
//     task_id, de modo que dos timestamps iguales NUNCA intercambien posición entre polls.
//   - D-05/D-06/D-16: resolveSelection busca por identidad; si la fila desaparece, clampa al
//     mismo índice posicional previo en [0, len-1]; lista vacía → { index:-1, taskId:null }.
//   - D-14 / Security V5 (T-36-01): parseFilter separa r:/s: del texto global; applyFilter hace
//     AND vía String.includes — JAMÁS `new RegExp` (anti-ReDoS / anti-inyección de regex desde
//     la query tecleada por el operador).
//   - D-11: countByStatus cuenta el zombie (running && !alive) APARTE de running.
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. test/format-isolation.test.js lo verifica vía walker automático.

/**
 * @typedef {import('./format.js').EnrichedSession} EnrichedSession
 */

/**
 * Ordena una COPIA de la lista DESC por `started_at` (newest primero), con desempate
 * lexicográfico por `task_id` (D-04, UI-SPEC sort=DESC). Nunca muta la entrada — el resultado
 * de usePoll no debe alterarse. El tiebreak explícito hace el orden determinista aunque el
 * server emita el array en un orden distinto cada poll (no se confía solo en la estabilidad
 * del sort de V8).
 *
 * @param {Array<Partial<EnrichedSession>>} rows
 * @returns {Array<Partial<EnrichedSession>>} copia ordenada.
 */
export function sortSessions(rows) {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.started_at ?? 0).getTime();
    const tb = new Date(b.started_at ?? 0).getTime();
    if (ta !== tb) return tb - ta; // DESC: newest primero
    const ka = a.task_id ?? '';
    const kb = b.task_id ?? '';
    return ka < kb ? -1 : ka > kb ? 1 : 0; // tiebreak determinista
  });
}

/**
 * Resuelve la selección visible por IDENTIDAD (D-05/D-06/D-16). Sobre la lista ya
 * ordenada+filtrada:
 *   - lista vacía → { index:-1, taskId:null } (nunca un id colgante).
 *   - `selectedTaskId` presente → { index, taskId: selectedTaskId } (sigue a la sesión aunque
 *     el orden cambie — TUI-08).
 *   - `selectedTaskId` ausente (la fila desapareció) → clampa `prevIndex` a [0, len-1] y devuelve
 *     el `task_id` de esa posición (vecino más cercano, D-06). Jamás un id ausente.
 *
 * @param {Array<Partial<EnrichedSession>>} rows — ya ordenada+filtrada.
 * @param {string|null} selectedTaskId
 * @param {number} [prevIndex=0] — último índice visible conocido (fallback de clamp).
 * @returns {{ index: number, taskId: string|null }}
 */
export function resolveSelection(rows, selectedTaskId, prevIndex = 0) {
  if (rows.length === 0) return { index: -1, taskId: null };
  const idx = rows.findIndex((r) => r.task_id === selectedTaskId);
  if (idx !== -1) return { index: idx, taskId: selectedTaskId };
  const clamped = Math.max(0, Math.min(prevIndex, rows.length - 1));
  return { index: clamped, taskId: rows[clamped].task_id ?? null };
}

/**
 * Parsea una query de filtro (D-14). Separa los prefijos `r:` (repo) y `s:` (status) del texto
 * global; los valores de prefijo y el texto se bajan a minúsculas (match case-insensitive).
 *   'r:kodo s:running build' → { repo:'kodo', status:'running', text:'build' }
 *   ''                       → { repo:null, status:null, text:'' }
 *
 * @param {string} query
 * @returns {{ repo: string|null, status: string|null, text: string }}
 */
export function parseFilter(query) {
  /** @type {{ repo: string|null, status: string|null, text: string }} */
  const out = { repo: null, status: null, text: '' };
  const words = (query ?? '').trim().split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const rest = [];
  for (const w of words) {
    // Prefijo case-insensitive: 'r:'/'R:' y 's:'/'S:' se reconocen igual; el VALOR se baja
    // a minúsculas para el match case-insensitive (D-14).
    const lower = w.toLowerCase();
    if (lower.startsWith('r:')) out.repo = w.slice(2).toLowerCase();
    else if (lower.startsWith('s:')) out.status = w.slice(2).toLowerCase();
    else rest.push(w);
  }
  out.text = rest.join(' ').toLowerCase();
  return out;
}

/**
 * Filtra las filas haciendo AND de los criterios activos (D-14). El match es por SUBSTRING vía
 * `String.includes` — JAMÁS `new RegExp` (anti-ReDoS / anti-inyección, Security V5 / T-36-01).
 *   - repo: deriveRepo(r) (lowercased) incluye parsed.repo.
 *   - status: r.status (lowercased) === parsed.status (match exacto).
 *   - text: substring global sobre task_ref/repo/phase_id/gsd_mode/summary (lowercased).
 *
 * @param {Array<Partial<EnrichedSession>>} rows
 * @param {{ repo: string|null, status: string|null, text: string }} parsed
 * @param {(s: Partial<EnrichedSession>) => string} deriveRepo — DI puro (de format.js).
 * @returns {Array<Partial<EnrichedSession>>}
 */
export function applyFilter(rows, parsed, deriveRepo) {
  return rows.filter((r) => {
    if (parsed.repo && !deriveRepo(r).toLowerCase().includes(parsed.repo)) return false;
    if (parsed.status && (r.status ?? '').toLowerCase() !== parsed.status) return false;
    if (parsed.text) {
      const hay = `${r.task_ref ?? ''} ${deriveRepo(r)} ${r.phase_id ?? ''} ${r.gsd_mode ?? ''} ${r.summary ?? ''}`.toLowerCase();
      if (!hay.includes(parsed.text)) return false;
    }
    return true;
  });
}

/**
 * Cuenta sesiones por estado para el header (D-11). El zombie (`running` && `alive === false`)
 * se cuenta APARTE de running — el operador lo ve en el resumen, no solo en la fila.
 *
 * @param {Array<Partial<EnrichedSession>>} rows
 * @returns {{ running: number, review: number, done: number, error: number, zombie: number }}
 */
export function countByStatus(rows) {
  const c = { running: 0, review: 0, done: 0, error: 0, zombie: 0 };
  for (const r of rows) {
    if (r.status === 'running' && r.alive === false) c.zombie++;
    else if (Object.prototype.hasOwnProperty.call(c, r.status ?? '')) c[/** @type {string} */ (r.status)]++;
  }
  return c;
}
