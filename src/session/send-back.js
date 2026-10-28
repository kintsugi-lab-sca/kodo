// @ts-check
//
// src/session/send-back.js — KODO-109. Devolver una tarea que está en revisión.
//
// Hasta aquí devolver una tarea era comentar en el provider y moverla a mano, y la sesión que se
// relanzaba no veía ese comentario: el contexto de arranque solo lleva el plan y el handoff. Este
// módulo hace las tres cosas como una sola acción —comentar, persistir el feedback en
// `state.tasks[task_id].send_back` y mover la tarea al estado lanzable— para que la siguiente
// sesión lo reciba sin ir a buscarlo (ver `takeTaskSendBack` en el hook SessionStart).
//
// ── EL ORDEN ES LA MITAD DEL FEATURE: comentar → persistir → mover ─────────────────────────────
// Mover es lo que relanza: el webhook del cambio de estado llega al dispatcher, que puede abrir la
// nueva sesión en segundos. Si el feedback se persistiera DESPUÉS del move, esa sesión podría
// arrancar antes y no recibir nada. Por eso se persiste antes, y si el move falla se deshace el
// persist: nunca queda un feedback huérfano sin la tarea movida.
//
// El comentario va PRIMERO porque es la traza humana de la devolución; si falla no se ha tocado
// nada. Si falla el move, el comentario ya está publicado y no se puede retirar — el resultado lo
// dice (`MOVE_FAILED`) para que el operador reintente sabiendo que el texto ya consta.
//
// NEVER-THROWS: todo desenlace es un discriminado `{ ok, code, detail }`.

/** Prefijo literal del comentario, el que el humano reconoce en el hilo de la tarea. */
export const SEND_BACK_PREFIX = 'Devuelto:';

/**
 * @typedef {{ ok: true, value: { task_id: string, ref: string, state: string, at: string } }
 *   | { ok: false, code: 'INVALID_INPUT'|'FETCH_FAILED'|'NOT_IN_REVIEW'|'NO_TRIGGER_STATE'|'COMMENT_FAILED'|'PERSIST_FAILED'|'MOVE_FAILED', detail: string }
 * } SendBackResult
 */

/**
 * Escapa el texto del humano para meterlo en HTML crudo. El provider de Plane deja pasar tal cual
 * un cuerpo que empieza por etiqueta (`toCommentHtml`), así que el escape es responsabilidad de
 * quien compone el HTML.
 * @param {string} s
 */
function escapeHtml(s) {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

/**
 * Cuerpo del comentario. Plane renderiza `comment_html` tal cual, así que va en HTML crudo; el
 * resto de providers (GitHub) recibe Markdown literal — mismo corte que `session/context.js`.
 *
 * @param {string} text
 * @param {string} providerName
 * @returns {string}
 */
export function buildSendBackComment(text, providerName) {
  if (providerName !== 'plane') return `**${SEND_BACK_PREFIX}** ${text}`;
  return `<p><strong>${SEND_BACK_PREFIX}</strong> ${escapeHtml(text).split('\n').join('<br>')}</p>`;
}

/**
 * Devuelve una tarea en revisión: comenta, persiste el feedback y la mueve al estado lanzable.
 *
 * @param {{ ref: string, text: string }} input
 * @param {{
 *   provider: any,
 *   config: { provider: string, providers: Record<string, any> },
 *   setSendBackFn: (taskId: string, sendBack: { text: string, at: string } | null) => { ok: boolean },
 *   now?: () => Date,
 * }} deps
 * @returns {Promise<SendBackResult>}
 */
export async function sendBackTask({ ref, text }, { provider, config, setSendBackFn, now = () => new Date() }) {
  const cleanRef = typeof ref === 'string' ? ref.trim() : '';
  const cleanText = typeof text === 'string' ? text.trim() : '';
  if (!cleanRef || !cleanText) {
    return { ok: false, code: 'INVALID_INPUT', detail: !cleanRef ? 'missing ref' : 'missing feedback text' };
  }

  const providerName = config.provider;
  const states = (config.providers && config.providers[providerName] && config.providers[providerName].states) || {};
  const reviewState = typeof states.review === 'string' ? states.review : '';
  const triggerState = typeof states.trigger === 'string' ? states.trigger.trim() : '';
  if (!triggerState) {
    return { ok: false, code: 'NO_TRIGGER_STATE', detail: `providers.${providerName}.states.trigger is not set` };
  }

  let task;
  try {
    task = await provider.getTask(cleanRef);
  } catch (e) {
    return { ok: false, code: 'FETCH_FAILED', detail: String(/** @type {any} */ (e)?.message || e) };
  }

  // El guard AUTORITATIVO de «está en revisión»: el del dashboard es UX sobre un snapshot que
  // puede tener segundos. Devolver una tarea que no está en revisión la sacaría de donde esté.
  const current = typeof task?.state === 'string' ? task.state : '';
  if (!reviewState || current.toLowerCase() !== reviewState.toLowerCase()) {
    return { ok: false, code: 'NOT_IN_REVIEW', detail: `${cleanRef} is in "${current || 'unknown'}", not "${reviewState}"` };
  }

  try {
    await provider.addComment(task, buildSendBackComment(cleanText, providerName));
  } catch (e) {
    return { ok: false, code: 'COMMENT_FAILED', detail: String(/** @type {any} */ (e)?.message || e) };
  }

  const at = now().toISOString();
  const persisted = setSendBackFn(task.id, { text: cleanText, at });
  if (!persisted || !persisted.ok) {
    return { ok: false, code: 'PERSIST_FAILED', detail: 'state.json lock timeout — comment posted, task not moved' };
  }

  try {
    await provider.updateTaskState(task, triggerState);
  } catch (e) {
    // Rollback: sin la tarea movida, ninguna sesión va a consumir el feedback, y la que se lance
    // más adelante por otro motivo lo recibiría fuera de contexto.
    const undone = setSendBackFn(task.id, null);
    const suffix = undone && undone.ok ? '' : ' (and the pending feedback could not be cleared)';
    return { ok: false, code: 'MOVE_FAILED', detail: `${String(/** @type {any} */ (e)?.message || e)}${suffix}` };
  }

  return { ok: true, value: { task_id: task.id, ref: task.ref ?? cleanRef, state: triggerState, at } };
}
