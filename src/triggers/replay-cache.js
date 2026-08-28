// @ts-check
//
// src/triggers/replay-cache.js — caché de idempotencia anti-replay del webhook (KODO-46).
//
// EL AGUJERO QUE CIERRA: `provider.verifySignature()` (providers/plane/provider.js) es
// timing-safe, pero el HMAC de Plane se computa SOLO sobre el body — no hay timestamp ni
// nonce en la firma. Plane tampoco expone header temporal alguno: sus tres headers son
// `X-Plane-Signature`, `X-Plane-Event` y `X-Plane-Delivery`. Consecuencia: quien capture
// UN webhook válido (proxy intermedio, log de un balanceador, tcpdump en la red del
// daemon) puede reenviarlo tal cual, indefinidamente, y cada reenvío pasa el HMAC.
//
// POR QUÉ EL HASH DEL BODY Y NO `(task_ref, action)`:
// el HMAC ata la firma al body EXACTO, así que un replay solo puede ser byte-idéntico —
// cualquier body distinto exigiría una firma que el atacante no puede forjar. El hash del
// body es por tanto la clave criptográficamente ajustada al vector real. `(task_ref,
// action)` sería MÁS agresivo de lo necesario: colapsaría eventos legítimos DISTINTOS
// dentro de la ventana (In Progress → Done → In Progress es una secuencia real, y los
// tres webhooks comparten task_ref y `issue.updated`), y eso es pérdida de eventos, no
// protección. `task_ref` y `action` se siguen registrando — pero en el LOG, no en la clave.
//
// ALCANCE HONESTO (lo que esta caché NO hace):
//   - Es IN-PROCESS. El webhook lo sirve un único daemon (`kodo up` → src/server.js), así
//     que basta hoy; con varios daemons tras un balanceador cada uno tendría su ventana.
//     La segunda línea sigue siendo el dispatcher, que dedupe por task_id in-process
//     (`inFlight`), cross-proceso (`dispatch-<task_id>.lock`) y contra el estado persistido.
//   - Es una VENTANA, no un registro perpetuo. Un replay pasada la TTL vuelve a pasar el
//     HMAC. Cerrar eso del todo exige un nonce persistente por entrega, que Plane no da.
//     La TTL corta cubre el caso práctico (reenvío automatizado en ráfaga) sin que la
//     caché crezca sin techo.
//
// ESTRUCTURA: `Map` de clave → expiración. La TTL es constante, así que el orden de
// inserción del Map ES el orden de expiración: purgar es recorrer desde el frente hasta
// el primer no-expirado, y el cap desaloja también por el frente (el más viejo). Sin
// timers — la purga es lazy, dentro de `claim`, para no dejar un handle vivo que mantenga
// despierto el event loop del daemon.

import { createHash } from 'node:crypto';

/**
 * Ventana por defecto (ms) durante la cual un body ya procesado se considera replay.
 *
 * 5 min: cubre con holgura la ráfaga de un reenvío automatizado y la vida de un reintento
 * del provider, sin retener claves de horas. Configurable por si un despliegue quiere
 * apretarla o aflojarla.
 */
export const DEFAULT_REPLAY_TTL_MS = 5 * 60 * 1000;

/**
 * Techo de claves vivas. Cada entrada es un hash hex (64 chars) + un number, así que 1000
 * entradas son decenas de KB — irrelevante frente a la garantía de que un pico de webhooks
 * no puede hacer crecer la memoria del daemon sin límite.
 */
export const DEFAULT_REPLAY_MAX_ENTRIES = 1000;

/**
 * Clave de idempotencia de un body crudo. PURA.
 *
 * SHA-256 hex: el body es atacante-controlado solo en el sentido de que puede REPETIR uno
 * ya firmado, así que lo único que se le pide al hash es no colisionar entre bodies
 * distintos. Se hashea (y no se guarda el body) porque la caché no debe retener payload:
 * misma postura que el resto del carril, donde lo único persistido es `bytes`.
 *
 * @param {string} rawBody
 * @returns {string}
 */
export function keyForBody(rawBody) {
  return createHash('sha256').update(rawBody ?? '', 'utf8').digest('hex');
}

/**
 * Veredicto de `claim`. `ageMs` solo viaja en el caso duplicado — es cuánto hace que se
 * registró el body original, lo que sitúa el reenvío dentro de la ventana en el log sin
 * exponer nada del payload.
 *
 * @typedef {{ fresh: true } | { fresh: false, ageMs: number }} ClaimResult
 */

/**
 * @typedef {{
 *   claim: (key: string) => ClaimResult,
 *   revoke: (key: string) => void,
 *   size: () => number,
 * }} ReplayCache
 */

/**
 * Caché de idempotencia con ventana temporal.
 *
 * @param {{ ttlMs?: number, maxEntries?: number, now?: () => number }} [opts]
 * @returns {ReplayCache}
 */
export function createReplayCache(opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) ? Number(opts.ttlMs) : DEFAULT_REPLAY_TTL_MS;
  const maxEntries = Number.isFinite(opts.maxEntries)
    ? Number(opts.maxEntries)
    : DEFAULT_REPLAY_MAX_ENTRIES;
  const now = opts.now || Date.now;

  /** @type {Map<string, number>} clave → instante (ms) en que deja de contar como replay. */
  const seen = new Map();

  /**
   * Descarta las entradas ya vencidas. Recorre desde el frente y CORTA en el primer
   * no-vencido: con TTL constante, todo lo que sigue es más nuevo.
   * @param {number} t
   */
  function purge(t) {
    for (const [key, expiresAt] of seen) {
      if (expiresAt > t) break;
      seen.delete(key);
    }
  }

  return {
    /**
     * Reclama la clave para esta entrega.
     *
     * @param {string} key
     * @returns {ClaimResult} `{ fresh: true }` si la clave es NUEVA (queda registrada y el
     *   caller debe procesar el evento); `{ fresh: false, ageMs }` si ya se vio dentro de
     *   la ventana — es un replay. Un hit NO refresca la expiración: la ventana se mide
     *   desde el evento GENUINO, y refrescarla dejaría que una ráfaga de replays la
     *   extendiera indefinidamente.
     */
    claim(key) {
      // `ttlMs <= 0` desactiva la protección por completo (vía de escape simétrica a la
      // de `dispatchGraceMs: 0` en webhook.js): nada se registra, nada se rechaza.
      if (ttlMs <= 0) return { fresh: true };

      const t = now();
      purge(t);

      const expiresAt = seen.get(key);
      if (expiresAt !== undefined && expiresAt > t) {
        return { fresh: false, ageMs: ttlMs - (expiresAt - t) };
      }

      // Reinserta SIEMPRE tras borrar: una clave vencida que vuelve debe ir al FINAL del
      // Map, o el orden de inserción dejaría de coincidir con el de expiración y `purge`
      // cortaría antes de tiempo, reteniendo entradas muertas.
      seen.delete(key);
      seen.set(key, t + ttlMs);

      // Cap por si la purga no liberó nada (todas vivas): desaloja las más antiguas.
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next();
        if (oldest.done) break;
        seen.delete(oldest.value);
      }
      return { fresh: true };
    },

    /**
     * Suelta una clave reclamada.
     *
     * Existe por KODO-34: cuando el webhook contesta 503 para que el provider REINTENTE la
     * entrega, ese reintento trae el MISMO body — y sin revocar, la caché lo tomaría por
     * replay y se tragaría el evento, revirtiendo justo lo que KODO-34 arregló. Neto: solo
     * una entrega efectivamente procesada (200) deja marca.
     *
     * @param {string} key
     */
    revoke(key) {
      seen.delete(key);
    },

    size() {
      return seen.size;
    },
  };
}

/**
 * Caché del proceso. El handler del webhook es una función por petición y el estado
 * anti-replay tiene que sobrevivir ENTRE peticiones, así que vive aquí, memoizada, con el
 * mismo patrón que `cachedLogger` en webhook.js. Los tests inyectan la suya vía deps.
 *
 * `KODO_WEBHOOK_REPLAY_TTL_MS` permite apretar o aflojar la ventana en despliegue —
 * incluido `0`, que desactiva la protección.
 *
 * @type {ReplayCache|null}
 */
let processCache = null;

/**
 * Descarta la caché del proceso. SOLO para tests: un fichero de test entrega muchos
 * webhooks en el mismo proceso y la caché los vería como replays entre casos. En runtime
 * nadie la llama — el daemon quiere precisamente que la ventana sobreviva a las peticiones.
 */
export function resetReplayCache() {
  processCache = null;
}

/**
 * @returns {ReplayCache} la caché del proceso, creándola en el primer uso.
 */
export function getReplayCache() {
  if (!processCache) {
    const raw = Number(process.env.KODO_WEBHOOK_REPLAY_TTL_MS);
    processCache = createReplayCache({
      ttlMs: Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_REPLAY_TTL_MS,
    });
  }
  return processCache;
}
