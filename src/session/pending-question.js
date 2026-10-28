// @ts-check
//
// src/session/pending-question.js — KODO-108: la pregunta que la sesión le deja al humano.
//
// Hasta aquí kodo solo sabía el booleano `needs_input` que expone el host: el humano veía
// «needs input» en el dashboard pero tenía que abrir el workspace para saber QUÉ se le
// pregunta. `kodo ask "<pregunta>"` lo persiste en la sesión como `pending_question`, y el
// dashboard y el sidebar lo pintan.
//
// CICLO DE VIDA. Lo escribe `kodo ask` (src/cli/ask.js) y lo borra el hook
// `UserPromptSubmit` (src/hooks/user-prompt.js): el humano responde en el chat → la sesión
// vuelve a trabajar → la pregunta ya no está pendiente. NO lo borra el hook Stop: Stop
// dispara al final del MISMO turno en que la sesión ejecutó `kodo ask`, así que limpiar ahí
// la borraría al instante. Tampoco el reconcile: su `running` significa «proceso vivo», que
// es verdad tanto trabajando como esperando, y no distingue una cosa de la otra.
//
// Las dos escrituras van bajo `withStateLock` y son never-throws: una pregunta perdida es
// cosmética, una sesión rota no.

import { withStateLock } from './state.js';
import { stripControlChars } from '../cli/sanitize.js';

/**
 * Tope de lo que se PERSISTE. El render trunca mucho antes; esto solo impide que un `ask`
 * desbocado engorde `state.json`, que se reescribe entero en cada mutación.
 */
export const QUESTION_MAX = 500;

/** Lo que cabe de la pregunta en la descripción del sidebar. */
const SIDEBAR_QUESTION_MAX = 80;

/** Lo que cabe del título en la descripción del sidebar — el mismo 60 de `launchWorkItem`. */
const SIDEBAR_TITLE_MAX = 60;

/**
 * @typedef {{ text: string, at: string }} PendingQuestion
 */

/**
 * Normaliza la pregunta a UNA línea saneada y acotada, o `''` si no queda nada.
 * Una línea porque los dos consumidores (fila del dashboard, descripción del sidebar) son
 * de una línea: un `\n` embebido partiría la fila en dos.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeQuestion(text) {
  if (typeof text !== 'string') return '';
  return truncate(stripControlChars(text).replace(/\s+/g, ' ').trim(), QUESTION_MAX);
}

/**
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

/**
 * Descripción del workspace en el sidebar, con o sin pregunta. PURA.
 *
 * Sin pregunta reproduce EXACTAMENTE la marca que escribe `launchWorkItem`
 * (session/manager.js, «⬢ <ref> · <título>»): es lo que se restaura al limpiar, y una
 * forma distinta dejaría el sidebar distinto de como estaba antes del `ask`.
 *
 * @param {{ task_ref?: string, summary?: string }} session
 * @param {string|null} [question]
 * @returns {string}
 */
export function sidebarDescription(session, question) {
  const ref = stripControlChars(session.task_ref ?? '');
  if (question) return `⬢ ${ref} · ❓ ${truncate(question, SIDEBAR_QUESTION_MAX)}`;
  return `⬢ ${ref} · ${truncate(stripControlChars(session.summary ?? ''), SIDEBAR_TITLE_MAX)}`;
}

/**
 * Persiste la pregunta en la sesión `taskId`. Una pregunta nueva PISA la anterior: la
 * pendiente es siempre la última que se hizo.
 *
 * @param {string} taskId
 * @param {string} text — ya normalizada (`normalizeQuestion`).
 * @param {{ now?: () => Date, withStateLockFn?: typeof withStateLock }} [opts]
 * @returns {{ ok: true, value: PendingQuestion } | { ok: false, reason: string }}
 */
export function setPendingQuestion(taskId, text, opts = {}) {
  const lock = opts.withStateLockFn || withStateLock;
  const value = { text, at: (opts.now ? opts.now() : new Date()).toISOString() };
  let found = false;
  try {
    const r = lock((state) => {
      const s = state.sessions?.[taskId];
      if (!s) return;
      s.pending_question = value;
      found = true;
    });
    if (!r.ok) return { ok: false, reason: r.reason };
  } catch (err) {
    return { ok: false, reason: String(/** @type {Error} */ (err)?.message || err) };
  }
  return found ? { ok: true, value } : { ok: false, reason: 'session-gone' };
}

/**
 * Borra la pregunta pendiente de la sesión `taskId`.
 *
 * `withStateLock` reescribe `state.json` aunque el mutador no cambie nada, así que el filtro
 * barato va en el CALLER: el hook que llama a esto corre en CADA prompt y solo debe llegar
 * aquí cuando su lectura sin lock ya vio una pregunta. Dentro del lock se vuelve a mirar,
 * por si otra escritura la quitó entretanto.
 *
 * @param {string} taskId
 * @param {{ withStateLockFn?: typeof withStateLock }} [opts]
 * @returns {{ ok: true, cleared: boolean } | { ok: false, reason: string }}
 */
export function clearPendingQuestion(taskId, opts = {}) {
  const lock = opts.withStateLockFn || withStateLock;
  let cleared = false;
  try {
    const r = lock((state) => {
      const s = state.sessions?.[taskId];
      if (!s || !s.pending_question) return;
      delete s.pending_question;
      cleared = true;
    });
    if (!r.ok) return { ok: false, reason: r.reason };
  } catch (err) {
    return { ok: false, reason: String(/** @type {Error} */ (err)?.message || err) };
  }
  return { ok: true, cleared };
}
