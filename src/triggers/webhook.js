// @ts-check
import { dispatchTrigger } from './dispatcher.js';
import { webhookReceived, webhookRejected } from '../logger-events.js';

/**
 * @typedef {{
 *   dispatchTriggerFn?: (event: import('../interface.js').TriggerEvent, opts?: object) => Promise<any>,
 *   logger?: import('../logger.js').Logger,
 *   providerName?: string,
 * }} WebhookDeps
 */

/**
 * Logger del carril webhook, memoizado por proceso (KODO-28).
 *
 * Sink: `~/.kodo/logs/webhook.ndjson` — id sintético `webhook`, mismo patrón que
 * los carriles sin sesión que ya existen (`reconcile` en server.js:260, `dispatch`
 * en dispatcher.js, `integrate` en cli/integrate.js). Un webhook llega ANTES de
 * que exista sesión alguna, así que no hay session_id real al que colgarlo.
 *
 * El import es DINÁMICO a propósito: `src/logger.js` es el módulo prohibido en el
 * grafo de `kodo check` (invariante LOG-12, verificada por
 * test/check-isolation.test.js), y webhook.js cuelga del árbol del dispatcher.
 * Un import estático metería el sink NDJSON en el grafo del vigilante.
 *
 * @type {any}
 */
let cachedLogger = null;

/**
 * @returns {Promise<any>} el logger del carril, o null si no se pudo construir.
 */
async function getWebhookLogger() {
  if (cachedLogger) return cachedLogger;
  try {
    const { createLogger } = await import('../logger.js');
    cachedLogger = createLogger({
      sessionId: 'webhook',
      minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
    }).child({ component: 'webhook' });
    return cachedLogger;
  } catch {
    // never-throws: el audit es best-effort, jamás bloquea la respuesta HTTP.
    return null;
  }
}

/**
 * Pure webhook handler -- receives data, returns data. No HTTP req/res.
 *
 * Delegates all provider-specific work to the TaskProvider adapter:
 * - Signature verification via provider.verifySignature()
 * - Event parsing via provider.parseTriggerEvent()
 *
 * KODO-28: cada rama emite su evento estructurado (`webhook.received` /
 * `webhook.rejected`) al NDJSON. Ese es el audit — no el `console.log` de
 * server.js, que solo alimenta el ring buffer in-memory de `/logs` y muere con
 * el proceso. Los emits van envueltos en try/catch: un fallo del logger NUNCA
 * puede cambiar el status ni el body de la respuesta.
 *
 * @param {string} rawBody - Raw HTTP body string
 * @param {object} headers - HTTP headers object
 * @param {import('../interface.js').TaskProvider} provider - Active provider adapter
 * @param {WebhookDeps} [deps] - Injectable dependencies for testing
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleWebhookRequest(rawBody, headers, provider, deps = {}) {
  const dispatchFn = deps.dispatchTriggerFn || dispatchTrigger;
  const log = deps.logger !== undefined ? deps.logger : await getWebhookLogger();

  // `bytes` es la longitud del body crudo — nunca el body. Es lo único del payload
  // que se persiste (correlaciona con el 413 de readBody / NET-03).
  const bytes = Buffer.byteLength(rawBody || '', 'utf8');
  // El nombre del provider ACTIVO. Los adapters NO lo exponen (`createPlaneProvider`
  // devuelve solo los métodos de TaskProvider), y en las ramas de rechazo pre-parse
  // tampoco hay payload del que sacarlo — así que lo inyecta el caller, que sí lo
  // tiene a mano (`config.provider` en server.js). Sin inyección: 'unknown', nunca
  // un throw. En la rama aceptada gana `triggerEvent.provider`, que es autoritativo.
  const providerName = deps.providerName || 'unknown';

  /**
   * @param {'signature'|'parse'|'payload'} reason
   */
  const reject = (reason) => {
    if (!log) return;
    try {
      webhookRejected(log, { provider: providerName, reason, bytes });
    } catch {
      // never-throws — el audit no altera la respuesta.
    }
  };

  // 1. Verify signature via provider adapter
  if (!provider.verifySignature(rawBody, headers)) {
    reject('signature');
    return { status: 401, body: { error: 'Invalid signature' } };
  }

  // 2. Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    reject('parse');
    return { status: 400, body: { error: 'Invalid JSON' } };
  }

  // 3. Parse trigger event via provider adapter
  const triggerEvent = provider.parseTriggerEvent(payload);
  if (!triggerEvent) {
    // JSON válido pero no es un evento despachable. Se emite igual: el punto ciego
    // que cierra KODO-28 es no poder distinguir "llegó y se descartó" de "no llegó".
    reject('payload');
    return { status: 200, body: { ok: true, ignored: true } };
  }

  if (log) {
    try {
      webhookReceived(log, {
        provider: triggerEvent.provider,
        action: triggerEvent.action,
        task_ref: triggerEvent.taskRef,
        bytes,
      });
    } catch {
      // never-throws.
    }
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
    // KODO-28: el dispatcher ya emite `dispatch.error` en su propio wrapper, así
    // que aquí NO se re-emite — hacerlo duplicaría cada fallo en el NDJSON. Este
    // catch existe solo para que el rejection no quede sin manejar (el dispatch es
    // fire-and-forget) y para dejar la pista accionable de KODO-10 en `/logs`.
  });

  return { status: 200, body: { ok: true } };
}
