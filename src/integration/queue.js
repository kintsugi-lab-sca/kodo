// @ts-check
//
// src/integration/queue.js — KODO-26: el store de la cola de integración.
//
// El problema que resuelve: cada sesión termina pidiendo algo distinto (ff, merge, PR,
// revisar el diff) y hoy eso viaja SOLO en el nudge efímero del hook Stop. Si el operador no
// actúa en ese momento, «qué necesita esta rama» se pierde y acaba repasando sesión por
// sesión de memoria. La cola persiste esa pregunta al lado del resto del estado, para que el
// orquestador la lea en bloque en cada ronda.
//
// CLAVE ADITIVA `state.integration_queue` (array), mismo idiom que `tasks` (Phase 74 D-05) y
// `orchestrator` (KODO-16): sin bump de `schema_version`, y todo lector usa el guard
// defensivo `Array.isArray(state.integration_queue) ? … : []` — un state.json previo a esta
// fase se lee como cola vacía.
//
// INVARIANTES:
//   - TODA escritura pasa por `withStateLock` (invariante cross-milestone de STATE.md:171).
//     Este módulo NUNCA hace `saveState` por su cuenta ni escribe state.json a mano.
//   - Una entrada NUNCA se borra al resolverse: `--ff`, `--merge`, `--pr` y `--drop` la
//     TRANSICIONAN (`status` + `action` + `outcome` + `sha`). Mismo patrón que el inbox
//     (CAPT-03): la traza permanente ES el feature.
//   - Una entrada es de UN repo: la rama vive en `project_path`. Nada cross-repo — la
//     identidad de una entrada es el par (project_path, branch), no la task_ref sola.
//   - Este módulo NO llama a git y NO importa `logger.js` (recibe el logger por parámetro,
//     default el noop, igual que el resto de mutadores de `state.js`).

import { noopLogger } from '../logger-noop.js';
import { loadState, withStateLock } from '../session/state.js';

/**
 * Una entrada de la cola de integración.
 *
 * Las 17 claves están SIEMPRE presentes y en ESTE orden, con `null` donde no aplica. No es
 * cosmético: `kodo integrate --json` serializa la entrada tal cual, y el byte-determinismo del
 * `--json` es invariante del repo (DX-06). Una clave que aparece «solo cuando hay valor»
 * rompería la comparación byte a byte del contrato.
 *
 * @typedef {{
 *   task_ref: string,              // Referencia humana de la tarea ("KODO-26"). Selector primario del CLI.
 *   task_id: string|null,          // UUID de la tarea en el provider, cuando la sesión lo traía.
 *   project_path: string,          // Repo donde vive la rama. La entrada es de UN repo — nada cross-repo.
 *   branch: string,                // Rama con el trabajo sin integrar.
 *   base_branch: string|null,      // Rama base resuelta (origin/HEAD → main → master), o null si no se pudo resolver.
 *   commits_ahead: number|null,    // Commits que solo viven en `branch` (conteo de KODO-21). null = no verificable.
 *   base_ok: boolean|null,         // ¿`branch` contiene la base entera? null = no verificable. Solo `true` habilita ff.
 *   files_changed: number|null,    // Ficheros tocados respecto de la base. null = diff no inspeccionable.
 *   lines_changed: number|null,    // insertions + deletions. null = diff no inspeccionable.
 *   suggested: 'ff'|'merge'|'pr'|'review',  // Sugerencia de `suggestTier`. NO es una decisión.
 *   status: 'pending'|'done'|'dropped',     // 'pending' hasta que `kodo integrate` la resuelve.
 *   created_at: string,            // ISO 8601 del cierre de sesión que la encoló.
 *   updated_at: string,            // ISO 8601 de la última reescritura (re-captura de la misma rama).
 *   action: 'ff'|'merge'|'pr'|'drop'|null,  // Qué ejecutó el operador. null mientras está pending.
 *   sha: string|null,              // SHA resultante del merge. null en --pr, en --drop y en los fallos.
 *   outcome: string|null,          // Resultado corto y greppable ('merged', 'prepared', 'dropped', 'precondition-failed'…).
 *   resolved_at: string|null,      // ISO 8601 de la resolución. null mientras está pending.
 * }} IntegrationEntry
 */

/**
 * Techo de entradas RESUELTAS que se conservan en state.json (FIFO, se evictan las más
 * antiguas). Las `pending` NO cuentan y NUNCA se evictan: la cola pendiente es el trabajo, y
 * perder trabajo por presión de tamaño sería justo el fallo que esta fase evita.
 *
 * Por qué existe el techo, si «una entrada nunca se borra»: la traza PERMANENTE de cada acción
 * es el evento NDJSON `integrate.action` en `~/.kodo/logs/` (registro determinista de lo que se
 * ejecutó, append-only). El bloque de state.json es la ventana reciente que el dashboard y el
 * orquestador leen en cada tick — un array sin cota lo haría crecer sin límite y encarecería
 * cada lectura del TUI. Mismo razonamiento y mismo número que el cap de `history`
 * (`state.js:365`).
 */
export const RESOLVED_CAP = 50;

/**
 * Identidad de una entrada: el par (project_path, branch). NO la task_ref — una misma tarea
 * puede tocar dos repos en dos sesiones, y dos tareas distintas no comparten rama.
 *
 * El separador es `\u0000` (NUL): el ÚNICO byte que no puede aparecer ni en un path POSIX ni
 * en un nombre de rama de git, así que la concatenación es inyectiva. Un espacio no serviría —
 * los paths de macOS lo llevan a menudo (`~/Library/Application Support/…`).
 *
 * @param {{ project_path?: string, branch?: string }} e
 * @returns {string}
 */
function entryKey(e) {
  return `${e.project_path ?? ''}\u0000${e.branch ?? ''}`;
}

/**
 * Lectura defensiva del bloque de cola de un state ya cargado.
 * @param {any} state
 * @returns {IntegrationEntry[]}
 */
function queueOf(state) {
  return Array.isArray(state?.integration_queue) ? state.integration_queue : [];
}

/**
 * Construye una entrada COMPLETA (17 claves, orden fijo) desde el input de captura.
 * Pura — no toca disco ni reloj salvo por el `now` inyectado.
 *
 * @param {{
 *   task_ref: string, task_id?: string|null, project_path: string, branch: string,
 *   base_branch?: string|null, commits_ahead?: number|null, base_ok?: boolean|null,
 *   files_changed?: number|null, lines_changed?: number|null,
 *   suggested: 'ff'|'merge'|'pr'|'review',
 * }} input
 * @param {string} ts ISO 8601
 * @returns {IntegrationEntry}
 */
function buildEntry(input, ts) {
  return {
    task_ref: input.task_ref,
    task_id: input.task_id ?? null,
    project_path: input.project_path,
    branch: input.branch,
    base_branch: input.base_branch ?? null,
    commits_ahead: input.commits_ahead ?? null,
    base_ok: input.base_ok ?? null,
    files_changed: input.files_changed ?? null,
    lines_changed: input.lines_changed ?? null,
    suggested: input.suggested,
    status: 'pending',
    created_at: ts,
    updated_at: ts,
    action: null,
    sha: null,
    outcome: null,
    resolved_at: null,
  };
}

/**
 * Encola (o REFRESCA) la necesidad de integración de una rama.
 *
 * Dedupe por identidad (project_path, branch) contra las entradas `pending`: la segunda sesión
 * que cierra sobre la MISMA rama no crea una fila nueva — actualiza la que ya había con el
 * conteo, la base y la sugerencia frescos, conservando `created_at` (la antigüedad de la
 * espera, que es justo lo que el operador quiere ver) y refrescando `updated_at`.
 *
 * Una entrada YA RESUELTA no bloquea el re-encolado: si la rama vuelve a acumular commits tras
 * un merge, eso es una necesidad NUEVA y merece su propia fila (la resuelta se queda como
 * traza).
 *
 * @param {{
 *   task_ref: string, task_id?: string|null, project_path: string, branch: string,
 *   base_branch?: string|null, commits_ahead?: number|null, base_ok?: boolean|null,
 *   files_changed?: number|null, lines_changed?: number|null,
 *   suggested: 'ff'|'merge'|'pr'|'review',
 * }} input
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: { entry: IntegrationEntry, deduped: boolean } } | { ok: false, reason: 'lock-timeout' }}
 */
export function enqueueIntegration(input, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {IntegrationEntry|undefined} */
  let persisted;
  let deduped = false;

  const r = withStateLock((state) => {
    // Guard defensivo de la clave aditiva — espejo de `if (!state.tasks) state.tasks = {}`
    // (state.js:459). Un state.json anterior a KODO-26 no la trae.
    if (!Array.isArray(/** @type {any} */ (state).integration_queue)) {
      /** @type {any} */ (state).integration_queue = [];
    }
    const queue = /** @type {IntegrationEntry[]} */ (/** @type {any} */ (state).integration_queue);
    const key = entryKey(input);
    const prev = queue.find((e) => e.status === 'pending' && entryKey(e) === key);

    if (prev) {
      deduped = true;
      // Refresco IN PLACE. `created_at` se conserva a propósito: la edad de la entrada mide
      // cuánto lleva esta rama esperando integración, no cuándo cerró la última sesión.
      prev.task_ref = input.task_ref;
      prev.task_id = input.task_id ?? prev.task_id ?? null;
      prev.base_branch = input.base_branch ?? null;
      prev.commits_ahead = input.commits_ahead ?? null;
      prev.base_ok = input.base_ok ?? null;
      prev.files_changed = input.files_changed ?? null;
      prev.lines_changed = input.lines_changed ?? null;
      prev.suggested = input.suggested;
      prev.updated_at = ts;
      persisted = prev;
    } else {
      persisted = buildEntry(input, ts);
      queue.push(persisted);
    }

    pruneResolved(queue);
  });

  if (!r.ok) {
    logger.warn('integration.queue.enqueue_failed', { task_ref: input.task_ref, reason: r.reason });
    return r;
  }
  logger.info('integration.queue.enqueued', {
    task_ref: input.task_ref,
    branch: input.branch,
    suggested: input.suggested,
    deduped,
  });
  return { ok: true, value: { entry: /** @type {IntegrationEntry} */ (persisted), deduped } };
}

/**
 * Evicta las entradas resueltas más antiguas por encima de `RESOLVED_CAP`. MUTA el array en
 * sitio (corre dentro del mutador del lock). Las `pending` se preservan siempre, sea cual sea
 * su antigüedad.
 *
 * @param {IntegrationEntry[]} queue
 */
function pruneResolved(queue) {
  const resolved = queue.filter((e) => e.status !== 'pending');
  if (resolved.length <= RESOLVED_CAP) return;
  // El array está en orden de inserción, así que las primeras resueltas son las más antiguas.
  const drop = new Set(resolved.slice(0, resolved.length - RESOLVED_CAP));
  for (let i = queue.length - 1; i >= 0; i--) {
    if (drop.has(queue[i])) queue.splice(i, 1);
  }
}

/**
 * Marca una entrada como resuelta. NO la borra (traza).
 *
 * El selector es el mismo que expone el CLI: `task_ref` exacta o, en su defecto, nombre de
 * rama exacto — para poder resolver una rama cuya tarea no se recuerda. Solo matchea entradas
 * `pending`; una entrada ya resuelta devuelve `not-found` (idempotencia hacia el operador: la
 * segunda ejecución no re-escribe una traza cerrada).
 *
 * @param {string} ref task_ref o nombre de rama.
 * @param {{
 *   action: 'ff'|'merge'|'pr'|'drop',
 *   status?: 'done'|'dropped',
 *   sha?: string|null,
 *   outcome: string,
 * }} patch
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: IntegrationEntry } | { ok: false, reason: 'lock-timeout'|'not-found' }}
 */
export function resolveIntegration(ref, patch, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {IntegrationEntry|undefined} */
  let persisted;
  let found = false;

  const r = withStateLock((state) => {
    const queue = queueOf(state);
    const hit = queue.find((e) => e.status === 'pending' && (e.task_ref === ref || e.branch === ref));
    if (!hit) return;
    found = true;
    hit.status = patch.status ?? (patch.action === 'drop' ? 'dropped' : 'done');
    hit.action = patch.action;
    hit.sha = patch.sha ?? null;
    hit.outcome = patch.outcome;
    hit.resolved_at = ts;
    hit.updated_at = ts;
    persisted = hit;
    // La poda va en LOS DOS escritores, y sobre todo en este: resolver es lo único que CREA
    // entradas resueltas. Podar solo al encolar dejaba el array una entrada por encima del cap
    // hasta el siguiente cierre de sesión — cota que se cumple «casi siempre» no es una cota.
    pruneResolved(queue);
  });

  if (!r.ok) {
    logger.warn('integration.queue.resolve_failed', { ref, reason: r.reason });
    return r;
  }
  if (!found) return { ok: false, reason: 'not-found' };
  logger.info('integration.queue.resolved', {
    ref,
    action: patch.action,
    outcome: patch.outcome,
  });
  return { ok: true, value: /** @type {IntegrationEntry} */ (persisted) };
}

/**
 * Lista la cola. Lectura pura — nunca escribe.
 *
 * @param {{ all?: boolean }} [opts] `all: true` incluye las resueltas (traza). Default: solo `pending`.
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {IntegrationEntry[]} En orden de inserción (la más antigua primero).
 */
export function listIntegrationQueue(opts = {}, deps = {}) {
  const load = deps.loadStateFn || loadState;
  let queue;
  try {
    queue = queueOf(load());
  } catch {
    return []; // never-throws: una cola ilegible es indistinguible de una cola vacía.
  }
  return opts.all === true ? queue.slice() : queue.filter((e) => e.status === 'pending');
}

/**
 * Busca UNA entrada pendiente por task_ref o por nombre de rama (mismo selector que
 * `resolveIntegration`). Lectura pura — el CLI la usa para saber sobre qué repo y qué rama va a
 * operar ANTES de tocar git.
 *
 * @param {string} ref
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {IntegrationEntry|null}
 */
export function findPendingIntegration(ref, deps = {}) {
  const pending = listIntegrationQueue({}, deps);
  return pending.find((e) => e.task_ref === ref) || pending.find((e) => e.branch === ref) || null;
}
