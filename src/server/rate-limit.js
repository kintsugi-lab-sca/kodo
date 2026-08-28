// @ts-check
//
// src/server/rate-limit.js — KODO-45 (hardening HTTP).
//
// Token-bucket puro por clave (la clave que usa el server es la IP remota),
// extraído a su propio módulo igual que auth.js / dismiss.js / provider-state.js:
// la decisión es aritmética pura + un reloj inyectable, así que se testea offline
// sin abrir un socket ni esperar en tiempo real.
//
// El motivo de existir: `/webhook` es una ruta ABIERTA (isOpenRoute — conserva su
// propia verificación HMAC en vez del bearer). Un atacante que consiga un HMAC
// válido —o simplemente que inunde con firmas inválidas— hace que el daemon compute
// un SHA-256 sobre cada body antes de rechazarlo. Sin límite, ese coste de CPU lo
// paga el proceso que además corre el reconcile loop y sirve el TUI.
//
// Módulo PURO: cero I/O, cero imports. Nunca lanza.

/** Ráfaga tolerada por IP antes de empezar a responder 429. */
export const WEBHOOK_RATE_CAPACITY = 30;

/** Reposición sostenida, en tokens por segundo (1 req/s de media por IP). */
export const WEBHOOK_RATE_REFILL_PER_SEC = 1;

/**
 * Techo de IPs con bucket vivo a la vez. Sin este techo el propio limiter sería el
 * vector de memoria que intenta cerrar: un flood con IP de origen variada crea una
 * entrada por IP y el Map crece sin fin.
 */
export const MAX_TRACKED_KEYS = 1024;

/**
 * Crea un limitador token-bucket por clave.
 *
 * Cada clave arranca con `capacity` tokens y recupera `refillPerSec` por segundo
 * (fraccionado — no hay ticks). Cada `check()` consume un token; sin token entero
 * disponible la petición se rechaza y se devuelve cuántos segundos faltan para el
 * siguiente. El estado vive en el closure: una instancia por servidor, viva
 * mientras viva el proceso.
 *
 * Acotado en memoria (`maxKeys`): al ir a crear una clave nueva con el Map lleno se
 * barren primero los buckets ya recuperados por completo (una IP con el bucket
 * lleno es indistinguible de una IP nunca vista, así que olvidarla no regala
 * cuota). Si tras el barrido siguen todos a medias — un flood distribuido real — se
 * vacía el Map entero: se prefiere perder los contadores (fail-open, cada IP vuelve
 * a tener su ráfaga) a crecer sin límite, porque un OOM tumba el daemon y el 429 no.
 *
 * @param {object} [opts]
 * @param {number} [opts.capacity] - tokens del bucket lleno (ráfaga máxima).
 * @param {number} [opts.refillPerSec] - tokens repuestos por segundo.
 * @param {() => number} [opts.now] - reloj en ms (DI para tests: default Date.now).
 * @param {number} [opts.maxKeys] - techo de claves rastreadas a la vez.
 * @returns {{ check: (key: string) => { allowed: boolean, retryAfterSec: number }, size: () => number }}
 */
export function createRateLimiter({
  capacity = WEBHOOK_RATE_CAPACITY,
  refillPerSec = WEBHOOK_RATE_REFILL_PER_SEC,
  now = Date.now,
  maxKeys = MAX_TRACKED_KEYS,
} = {}) {
  /** @type {Map<string, { tokens: number, last: number }>} */
  const buckets = new Map();

  /** Tokens acumulados desde `last` hasta `ts`, saturados a `capacity`. */
  const refilled = (bucket, ts) => {
    const elapsedMs = Math.max(0, ts - bucket.last);
    return Math.min(capacity, bucket.tokens + (elapsedMs / 1000) * refillPerSec);
  };

  /** Olvida los buckets ya recuperados; si no basta, resetea (ver doc del factory). */
  const sweep = (ts) => {
    for (const [key, bucket] of buckets) {
      if (refilled(bucket, ts) >= capacity) buckets.delete(key);
    }
    if (buckets.size >= maxKeys) buckets.clear();
  };

  return {
    check(key) {
      const ts = now();
      let bucket = buckets.get(key);
      if (bucket) {
        bucket.tokens = refilled(bucket, ts);
      } else {
        if (buckets.size >= maxKeys) sweep(ts);
        bucket = { tokens: capacity, last: ts };
        buckets.set(key, bucket);
      }
      bucket.last = ts;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfterSec: 0 };
      }
      // `Retry-After` es un entero de segundos y 0 significaría "ya" — mínimo 1.
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec)) };
    },
    size() {
      return buckets.size;
    },
  };
}
