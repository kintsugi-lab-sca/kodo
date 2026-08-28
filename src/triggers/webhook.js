// @ts-check
import { dispatchTrigger } from './dispatcher.js';
import { webhookReceived, webhookRejected, webhookDispatchRetry } from '../logger-events.js';

/**
 * @typedef {{
 *   dispatchTriggerFn?: (event: import('../interface.js').TriggerEvent, opts?: object) => Promise<any>,
 *   logger?: import('../logger.js').Logger,
 *   providerName?: string,
 *   dispatchGraceMs?: number,
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

// ─── KODO-34: clasificación transitorio/permanente del fallo de dispatch ──────
//
// El 200 incondicional de antes convertía CUALQUIER fallo de dispatch en pérdida
// definitiva del evento: Plane no reintenta un 200, así que un Plane 503 o una red
// caída dejaban la tarea en In Progress sin sesión y sin explicación. Devolver 503
// hace que el provider reintente la entrega.
//
// POSTURA DEFAULT-CLOSED: solo se marca `transient` lo que se RECONOCE como
// reintentable. Todo lo demás (incluido lo desconocido) es `permanent` → 200. El
// caso que esta postura protege es el que ya diagnosticó KODO-10: "No configured
// project ... UNKNOWN" falla idéntico en cada reintento, así que un 503 ahí solo
// produciría una tormenta de reintentos que nunca converge.

/** Techo del `error` de `webhook.dispatch.retry` — mismo contrato que dispatchError. */
const RETRY_ERROR_MAX_CHARS = 200;

/**
 * Códigos de red de Node/undici que SIEMPRE merecen reintento: la petición no llegó,
 * o murió en vuelo, por una causa que no depende del contenido del evento.
 *
 * `ENOTFOUND` queda FUERA a propósito: un DNS que no resuelve suele ser un `base_url`
 * mal configurado, que falla igual en cada reintento (permanente, por default-closed).
 * `EAI_AGAIN` sí entra — es literalmente "temporary failure in name resolution".
 */
const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** `AbortSignal.timeout(10_000)` de PlaneClient.request aborta con uno de estos dos. */
const TRANSIENT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);

/**
 * Fallos de red de undici que llegan como `TypeError: fetch failed` SIN `cause.code`
 * utilizable. Alternancia de literales — lineal, sin backtracking (anti-ReDoS).
 */
const TRANSIENT_MESSAGE_RE = /fetch failed|socket hang up|network (?:error|timeout)/i;

/**
 * Status HTTP extraído del mensaje del provider. `PlaneClient.request` lanza
 * `Plane API ${status}: ${path} — ${text}` (client.js:76); el patrón `<algo> API <ddd>`
 * cubre por construcción a cualquier adapter futuro que siga la misma convención.
 */
const API_STATUS_RE = /\bAPI (\d{3})\b/;

/**
 * @param {number} status
 * @returns {boolean} true si el status invita a reintentar.
 */
function isTransientStatus(status) {
  // 5xx: el servidor falló, no la petición. 408/425/429: el servidor pide explícitamente
  // que se reintente. Todo 4xx restante es un problema del evento o de la config —
  // reintentarlo no cambia nada.
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

/**
 * Status HTTP de un eslabón de la cadena de errores, o null si no expone ninguno.
 * @param {any} err
 * @returns {number|null}
 */
function statusOf(err) {
  for (const key of ['status', 'statusCode']) {
    const value = err[key];
    if (typeof value === 'number' && value >= 100 && value <= 599) return value;
  }
  if (typeof err.message === 'string') {
    const match = err.message.match(API_STATUS_RE);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Clasifica un fallo de dispatch como transitorio (merece reintento del provider) o
 * permanente (reintentarlo solo genera ruido). PURA, never-throws.
 *
 * Recorre la cadena `err.cause` porque el fallo de red real viaja ANIDADO: `fetch`
 * lanza `TypeError: fetch failed` y el `ECONNREFUSED` vive en `err.cause.code`. La
 * profundidad está acotada a 5 — una cadena cíclica de causes (o patológicamente
 * larga) no puede colgar la respuesta HTTP.
 *
 * @param {unknown} err
 * @returns {'transient'|'permanent'}
 */
export function classifyDispatchError(err) {
  let current = /** @type {any} */ (err);
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    // El try envuelve TAMBIÉN el avance a `.cause`: cualquier propiedad de la cadena
    // puede ser un getter que lance, y un throw aquí escaparía hasta server.js y
    // convertiría la respuesta del webhook en un 400 espurio.
    try {
      const code = typeof current.code === 'string' ? current.code.toUpperCase() : '';
      if (TRANSIENT_NET_CODES.has(code)) return 'transient';

      if (typeof current.name === 'string' && TRANSIENT_ERROR_NAMES.has(current.name)) {
        return 'transient';
      }

      const status = statusOf(current);
      if (status !== null && isTransientStatus(status)) return 'transient';

      // El match por mensaje va DESPUÉS del status: `Plane API 404: ... fetch failed`
      // (un 404 cuyo body arrastra la frase) debe seguir siendo permanente, y el status
      // explícito es la señal más fuerte. Por eso solo se consulta si no hubo status.
      if (status === null && typeof current.message === 'string' && TRANSIENT_MESSAGE_RE.test(current.message)) {
        return 'transient';
      }

      current = current.cause;
    } catch {
      // never-throws — default-closed: si la cadena no se puede inspeccionar, permanente.
      return 'permanent';
    }
  }
  return 'permanent';
}

/**
 * Ventana de gracia por defecto (ms) que el webhook espera al dispatch antes de
 * contestar. Ver la nota de diseño en `handleWebhookRequest`, paso 4.
 */
const DEFAULT_DISPATCH_GRACE_MS = 2_000;

/**
 * Timer cancelable para la carrera del paso 4. Se cancela SIEMPRE (finally) para no
 * dejar un handle vivo que mantenga el event loop despierto tras la respuesta.
 *
 * @param {number} ms
 * @returns {{ promise: Promise<null>, cancel: () => void }}
 */
function graceWindow(ms) {
  /** @type {any} */
  let handle = null;
  const promise = new Promise((resolve) => {
    handle = setTimeout(() => resolve(null), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
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

  // 4. Dispatch con VENTANA DE GRACIA (KODO-34).
  //
  // Antes era fire-and-forget puro: se respondía 200 sin mirar el resultado, y un
  // fallo transitorio perdía el evento para siempre. Ahora se espera al dispatch un
  // tiempo ACOTADO y corto, y solo un rechazo transitorio dentro de esa ventana
  // convierte la respuesta en 503.
  //
  // Por qué una ventana y no un `await` completo (el tradeoff): el dispatch feliz
  // incluye el launch de la sesión (round-trips al provider + creación del workspace
  // cmux), que tarda segundos. Awaitearlo entero haría que el cliente de webhooks de
  // Plane agotara SU timeout en el camino feliz — y un timeout del cliente se
  // contabiliza igual que un fallo, así que provocaría reintentos justo en los
  // dispatches que sí funcionan. La ventana corta captura lo que importa: el paso 1
  // del dispatcher es `provider.getTask()`, que es exactamente donde muere la red, y
  // los fallos transitorios se manifiestan ahí (rechazo inmediato en ECONNREFUSED /
  // 5xx). Si el dispatch sigue vivo al vencer la ventana, se responde 200 y sigue
  // corriendo en background con el mismo contrato de siempre.
  //
  // `settled` NUNCA rechaza: absorbe el error en su propio handler (que es donde vive
  // el log accionable de KODO-10) y lo devuelve como valor. Eso mantiene el rejection
  // manejado también cuando gana el timer y el fallo llega tarde — sin él, un dispatch
  // que muere pasada la ventana sería un unhandled rejection capaz de tumbar el daemon.
  const settled = dispatchFn(triggerEvent).then(
    () => null,
    (err) => {
      // KODO-10: mensaje accionable. El fallo típico "No configured project ... UNKNOWN" ocurre
      // cuando el webhook llega de un proyecto ausente de config.providers.<provider>.projects
      // (mapeado en projects.json pero no dispatch-enabled). Incluimos el taskRef para saber QUÉ
      // webhook murió y dirigimos a `kodo doctor` (cruce config.json↔projects.json).
      const hint = /No configured project/i.test(err?.message || '')
        ? ` — el proyecto del webhook no está en config.providers.<provider>.projects; ejecuta "kodo doctor" para ver la desalineación config.json↔projects.json`
        : '';
      console.error(`[kodo] Dispatch error (${triggerEvent.taskRef}): ${err?.message}${hint}`);
      // KODO-28: el dispatcher ya emite `dispatch.error` en su propio wrapper, así
      // que aquí NO se re-emite — hacerlo duplicaría cada fallo en el NDJSON.
      return err;
    },
  );

  const graceMs = Number.isFinite(deps.dispatchGraceMs)
    ? Number(deps.dispatchGraceMs)
    : DEFAULT_DISPATCH_GRACE_MS;

  /** El error con el que rechazó el dispatch DENTRO de la ventana, o null. */
  let dispatchErr = null;
  if (graceMs > 0) {
    // `graceMs: 0` es la vía de escape al comportamiento fire-and-forget puro.
    const window = graceWindow(graceMs);
    try {
      dispatchErr = await Promise.race([settled, window.promise]);
    } finally {
      window.cancel();
    }
  }

  if (dispatchErr && classifyDispatchError(dispatchErr) === 'transient') {
    if (log) {
      try {
        webhookDispatchRetry(log, {
          provider: triggerEvent.provider,
          task_ref: triggerEvent.taskRef,
          error: String(/** @type {any} */ (dispatchErr)?.message ?? dispatchErr).slice(0, RETRY_ERROR_MAX_CHARS),
        });
      } catch {
        // never-throws — el audit no altera la respuesta.
      }
    }
    // 503: el provider debe REINTENTAR la entrega. El reintento vuelve a entrar por
    // este mismo handler y no puede duplicar sesión — el dispatcher dedupe por
    // task_id in-process (`inFlight`), cross-proceso (`dispatch-<task_id>.lock`) y
    // contra el estado persistido (session-already-active). El cuerpo no filtra el
    // err.message (NET-04: el detalle solo al log).
    return { status: 503, body: { ok: false, error: 'dispatch failed, retry later' } };
  }

  return { status: 200, body: { ok: true } };
}
