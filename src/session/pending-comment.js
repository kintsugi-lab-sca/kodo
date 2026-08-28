// @ts-check
//
// src/session/pending-comment.js — KODO-36: el marcador de comentario pendiente.
//
// El problema que resuelve: el paso 7 de `runReviewBackstop` (hooks/session-end.js) postea
// el comentario de cierre automático con un try/catch fail-open — un blip de red o un 503
// de Plane dejan SOLO un `log.warn` en el NDJSON. La tarea SÍ transiciona a «In review»
// (paso 6, que corre antes), así que el humano se encuentra una tarea en revisión sin una
// sola línea de contexto: ni el NEXT, ni la ruta del handoff, ni el aviso de que ese
// resumen no lo escribió el agente. El orphan sweep ya tenía reintento (`orphan_attempt_at`);
// el backstop de cierre no tenía ninguno. Este módulo se lo da.
//
// ── POR QUÉ UNA CLAVE TOP-LEVEL Y NO LA FILA DE LA SESIÓN ────────────────────────
// El marcador tiene que SOBREVIVIR al cierre que lo produjo, y el cierre es destructivo:
//   - `state.sessions[taskId]` NO vale: `performTerminalCleanup` llama `removeSession` unas
//     líneas más abajo en el MISMO hook, que archiva la fila a `history` (FIFO 50) y la
//     borra de `sessions`. El marcador moriría con la sesión que lo escribió.
//   - `state.tasks[taskId]` (el handoff) TAMPOCO: `upsertTaskHandoff` reconstruye la entrada
//     campo a campo (`{plan_path, next, updated_at}`) en vez de mergear, así que el
//     siguiente cierre de esa tarea borraría cualquier clave extra que hubiéramos colado.
//
// → CLAVE ADITIVA `state.pending_comments` (record por task_id), mismo idiom que
// `integration_queue` (KODO-26), `tasks` (Phase 74 D-05) y `orchestrator` (KODO-16): sin
// bump de `schema_version`, y todo lector usa el guard defensivo — un state.json previo a
// esta fase se lee como «cero pendientes».
//
// Record y no array: la identidad natural es el task_id (una tarea, un comentario de cierre
// pendiente). Dos cierres de la MISMA tarea con el provider caído dentro de la misma ventana
// de reintento requerirían dos sesiones seguidas de la misma tarea fallando en red en menos
// de 10 min; en ese caso el segundo marcador (el más reciente, el que refleja el último
// trabajo) pisa al primero. El array daría dos comentarios donde el humano espera uno.
//
// INVARIANTES:
//   - TODA escritura pasa por `withStateLock` (invariante cross-milestone de STATE.md:171).
//     Este módulo NUNCA hace `saveState` por su cuenta.
//   - Este módulo NO importa `logger.js` (recibe el logger por parámetro, default el noop,
//     igual que el resto de mutadores de `state.js`). LOG-12.
//   - El TEXTO del comentario nunca se loguea: es contenido derivado del LLM (el NEXT viaja
//     dentro). La telemetría lleva solo {task_id, attempts} (precedente T-71-18).

import { noopLogger } from '../logger-noop.js';
import { withStateLock } from './state.js';

/**
 * Un comentario de cierre que no se pudo postear y espera reintento.
 *
 * Lleva el TaskItem completo (`task_id`/`project_id`/`task_url`/`task_ref`) porque quien lo
 * reintenta —el barrido, en el proceso server— ya no tiene la sesión: se la llevó el
 * cleanup terminal del cierre. El shape combinado `{id, projectId, url, ref}` que consumen
 * los providers se reconstruye desde estos cuatro campos, igual que hacen `runReviewBackstop`
 * y `runOrphanSweep`.
 *
 * @typedef {{
 *   task_id: string,          // UUID de la tarea en el provider. Clave del record.
 *   project_id: string|null,  // UUID del proyecto (Plane). null cuando el provider no lo usa (GitHub).
 *   task_url: string|null,    // URL de la tarea en la UI del provider, si la sesión la traía.
 *   task_ref: string|null,    // Referencia humana ("KODO-36"). Solo para logs y diagnóstico.
 *   session_id: string|null,  // Sesión cuyo cierre produjo el comentario. Traza, no identidad.
 *   text: string,             // El comentario TAL CUAL debe postearse (ya construido por buildBackstopComment).
 *   created_at: string,       // ISO 8601 del cierre que falló.
 *   attempts: number,         // Reintentos CONSUMIDOS por el barrido. El fallo del cierre NO cuenta (es el que crea el marcador).
 *   attempt_at: string|null,  // ISO 8601 del último reintento fallido. null = nunca reintentado → el barrido lo coge en su próximo tick.
 * }} PendingComment
 */

/**
 * Techo de reintentos del barrido antes de abandonar. Con la ventana de reintento del sweep
 * (10 min) son ~100 minutos de insistencia: de sobra para un blip de red o un reinicio de
 * Plane. Sin techo, una tarea BORRADA en el provider (400/404 permanente) dejaría al server
 * llamando al provider cada 10 minutos para siempre.
 */
export const PENDING_COMMENT_MAX_ATTEMPTS = 10;

/**
 * Lee los marcadores pendientes de un state YA CARGADO. PURA — no hace I/O, para que el
 * barrido reutilice el `loadState` que ya hizo en su tick.
 *
 * Guard defensivo sobre la clave aditiva: un state.json previo a KODO-36 (o editado a mano)
 * se lee como lista vacía, nunca como error.
 *
 * @param {any} state
 * @returns {PendingComment[]}
 */
export function listPendingComments(state) {
  const map = state && state.pending_comments;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.values(map).filter(
    (e) => e && typeof e === 'object' && typeof e.task_id === 'string' && typeof e.text === 'string',
  );
}

/**
 * Persiste (o repone) el marcador de una tarea. Lo llama el backstop de cierre cuando su
 * `addComment` falla.
 *
 * Sobrescribe el marcador previo de la MISMA tarea entero, incluidos `attempts`/`attempt_at`:
 * un cierre nuevo es un comentario nuevo, y arrastrar los intentos del anterior lo abandonaría
 * antes de tiempo.
 *
 * @param {{ task_id: string, project_id?: string|null, task_url?: string|null, task_ref?: string|null, session_id?: string|null, text: string, created_at?: string }} entry
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @returns {{ ok: true, value: PendingComment } | { ok: false, reason: 'lock-timeout'|'invalid' }}
 */
export function markPendingComment(entry, logger = noopLogger) {
  // Guard de entrada: sin task_id no hay clave, y sin texto no hay nada que postear. Un
  // marcador inválido es peor que ninguno — el barrido lo reintentaría en vano cada ciclo.
  // `reason:'invalid'` y no 'lock-timeout': el llamante no debe leer «el disco estaba
  // ocupado» donde lo que pasó es que no había nada válido que guardar.
  if (
    !entry ||
    typeof entry.task_id !== 'string' ||
    !entry.task_id ||
    typeof entry.text !== 'string' ||
    !entry.text
  ) {
    logger.warn('state.pending_comment.mark_failed', { reason: 'invalid' });
    return { ok: false, reason: 'invalid' };
  }
  /** @type {PendingComment} */
  const persisted = {
    task_id: entry.task_id,
    project_id: entry.project_id ?? null,
    task_url: entry.task_url ?? null,
    task_ref: entry.task_ref ?? null,
    session_id: entry.session_id ?? null,
    text: entry.text,
    created_at: entry.created_at ?? new Date().toISOString(),
    attempts: 0,
    attempt_at: null,
  };
  const r = withStateLock((state) => {
    // Defensive guard del campo aditivo — espejo de `if (!state.tasks) state.tasks = {}`
    // en upsertTaskHandoff.
    if (!state.pending_comments || typeof state.pending_comments !== 'object') {
      state.pending_comments = {};
    }
    state.pending_comments[persisted.task_id] = persisted;
  });
  if (!r.ok) {
    // WR-01 (patrón addSession): en lock-timeout NADA se persistió — no lo damos por bueno.
    // Es el peor caso de esta fase (el comentario se pierde de verdad), así que la traza va
    // en warn con el motivo.
    logger.warn('state.pending_comment.mark_failed', { task_id: persisted.task_id, reason: r.reason });
    return r;
  }
  logger.info('state.pending_comment.marked', { task_id: persisted.task_id });
  return { ok: true, value: persisted };
}

/**
 * Aplaza un marcador tras un reintento fallido: sella `attempt_at` (el barrido no lo volverá
 * a tocar hasta pasada su ventana) e incrementa `attempts`.
 *
 * @param {string} taskId
 * @param {number} at - timestamp ms del intento (inyectado por el barrido).
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @returns {{ ok: true, value: { attempts: number } } | { ok: false, reason: 'lock-timeout' }}
 */
export function deferPendingComment(taskId, at, logger = noopLogger) {
  let attempts = 0;
  const r = withStateLock((state) => {
    const map = state.pending_comments;
    if (!map || typeof map !== 'object') return;
    const entry = map[taskId];
    if (!entry) return;
    attempts = (typeof entry.attempts === 'number' ? entry.attempts : 0) + 1;
    entry.attempts = attempts;
    entry.attempt_at = new Date(at).toISOString();
  });
  if (!r.ok) {
    logger.warn('state.pending_comment.defer_failed', { task_id: taskId, reason: r.reason });
    return r;
  }
  return { ok: true, value: { attempts } };
}

/**
 * Borra el marcador de una tarea. Dos llamantes, con intenciones opuestas:
 *   - el barrido tras POSTEAR con éxito (el ciclo se cerró: es la resolución feliz);
 *   - el barrido al agotar `PENDING_COMMENT_MAX_ATTEMPTS` (abandono; el llamante emite el
 *     warn ruidoso — aquí no se distingue, el borrado es el mismo).
 *
 * Idempotente: borrar un marcador inexistente es un no-op con `ok:true`.
 *
 * @param {string} taskId
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @returns {{ ok: true, value: void } | { ok: false, reason: 'lock-timeout' }}
 */
export function clearPendingComment(taskId, logger = noopLogger) {
  const r = withStateLock((state) => {
    if (state.pending_comments && typeof state.pending_comments === 'object') {
      delete state.pending_comments[taskId];
    }
  });
  if (!r.ok) {
    // En lock-timeout el marcador SIGUE en disco: el siguiente tick lo reintentará y el
    // humano verá el comentario dos veces. Duplicar es el fallo aceptable de esta fase
    // (perder la señal es el bug que cierra), pero queda la traza de por qué pasó.
    logger.warn('state.pending_comment.clear_failed', { task_id: taskId, reason: r.reason });
    return r;
  }
  logger.info('state.pending_comment.cleared', { task_id: taskId });
  return r;
}
