// @ts-check
import { dispatchTrigger } from './dispatcher.js';

/**
 * @typedef {{
 *   dispatchTriggerFn?: (event: import('../interface.js').TriggerEvent, opts?: object) => Promise<any>,
 * }} WebhookDeps
 */

/**
 * Pure webhook handler -- receives data, returns data. No HTTP req/res.
 *
 * Delegates all provider-specific work to the TaskProvider adapter:
 * - Signature verification via provider.verifySignature()
 * - Event parsing via provider.parseTriggerEvent()
 *
 * @param {string} rawBody - Raw HTTP body string
 * @param {object} headers - HTTP headers object
 * @param {import('../interface.js').TaskProvider} provider - Active provider adapter
 * @param {WebhookDeps} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleWebhookRequest(rawBody, headers, provider, deps = {}) {
  const dispatchFn = deps.dispatchTriggerFn || dispatchTrigger;

  // 1. Verify signature via provider adapter
  if (!provider.verifySignature(rawBody, headers)) {
    return { status: 401, body: { error: 'Invalid signature' } };
  }

  // 2. Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }

  // 3. Parse trigger event via provider adapter
  const triggerEvent = provider.parseTriggerEvent(payload);
  if (!triggerEvent) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  // 4. Fire-and-forget dispatch -- do NOT await (webhooks must respond fast)
  dispatchFn(triggerEvent).catch((err) => {
    // KODO-10: mensaje accionable. El fallo típico "No configured project ... UNKNOWN" ocurre
    // cuando el webhook llega de un proyecto ausente de config.providers.<provider>.projects
    // (mapeado en projects.json pero no dispatch-enabled). Incluimos el taskRef para saber QUÉ
    // webhook murió y dirigimos a `kodo doctor` (cruce config.json↔projects.json).
    const hint = /No configured project/i.test(err?.message || '')
      ? ` — el proyecto del webhook no está en config.providers.<provider>.projects; ejecuta "kodo doctor" para ver la desalineación config.json↔projects.json`
      : '';
    console.error(`[kodo] Dispatch error (${triggerEvent.taskRef}): ${err.message}${hint}`);
  });

  return { status: 200, body: { ok: true } };
}
