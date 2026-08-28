// @ts-check
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isPidAlive } from '../gsd/lock.js';

/**
 * Reusable advisory-lock primitive (Phase 70, D-01).
 *
 * Generalizes the lockfile + `isPidAlive` + TTL + steal pattern of
 * `src/gsd/lock.js` into a small, path-agnostic module consumed by
 * `withStateLock` (Plan 02), `polling start` (Plan 04, D-12) and the non-GSD
 * dedup (Plan 04, D-13). Locks are advisory files created with `O_EXCL`
 * (`flag:'wx'`) so two processes never both create the same lock; a stale lock
 * (dead owner PID or TTL exceeded) is stolen atomically via tmp+rename (D-08);
 * retry exhaustion is a fail-safe (`{ok:false}` + warn), never a throw and
 * never an indefinite block (D-03).
 *
 * Liveness is REUSED from `src/gsd/lock.js` by import — never reimplemented.
 *
 * Lock content shape: `{ pid: number, acquired_at: number, token: string }`.
 * The `token` (a per-acquire randomUUID) makes `releaseLock` ownership-checked.
 *
 * @typedef {{ pid: number, acquired_at: number, token: string }} LockContent
 * @typedef {{ retries?: number, backoffMs?: number, ttlMs?: number, logger?: { warn?: (event: string, meta?: object) => void } }} LockOpts
 */

const DEFAULT_RETRIES = 8;
const DEFAULT_BACKOFF_MS = 20;
const DEFAULT_TTL_MS = 10_000;

/**
 * Sleep synchronously for `ms` without spinning the CPU. Uses `Atomics.wait`
 * on a throwaway shared buffer so the retry loop stays fully synchronous —
 * matching the synchronous state mutators the lock coordinates.
 *
 * @param {number} ms
 */
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Attempt to acquire the advisory lock at `lockPath`.
 *
 * Returns `{ token }` on success (the caller passes `token` back to
 * `releaseLock`), or `null` if the lock is held by a live owner within TTL and
 * the retries are exhausted.
 *
 * @param {string} lockPath
 * @param {LockOpts} [opts]
 * @returns {{ token: string } | null}
 */
export function acquireLock(lockPath, opts = {}) {
  const {
    retries = DEFAULT_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    ttlMs = DEFAULT_TTL_MS,
  } = opts;

  const token = randomUUID();
  /** @type {LockContent} */
  const mine = { pid: process.pid, acquired_at: Date.now(), token };
  const content = JSON.stringify(mine);

  mkdirSync(dirname(lockPath), { recursive: true });

  for (let i = 0; i <= retries; i++) {
    try {
      // O_EXCL: fails with EEXIST if the lock already exists.
      writeFileSync(lockPath, content, { flag: 'wx' });
      return { token };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;

      // Lock exists — steal ONLY if the owner is provably stale (dead PID or
      // TTL exceeded). A corrupt/partial read (e.g. the winner created the file
      // but has not written its bytes yet) is NOT treated as stealable: we fall
      // through to backoff+retry so the create race can never yield two winners.
      try {
        const held = /** @type {LockContent} */ (
          JSON.parse(readFileSync(lockPath, 'utf-8'))
        );
        const stale =
          !isPidAlive(held.pid) || Date.now() - held.acquired_at > ttlMs;
        if (stale) {
          // Compare-and-swap steal (CR-01, D-08): the previous tmp+rename over
          // `lockPath` replaced unconditionally (last-writer-wins), so two
          // processes observing the SAME stale lock could both steal and both
          // return a token — degrading state.json coordination back to
          // unsynchronized. Instead, move the CURRENT lock aside: `renameSync`
          // of a given inode succeeds only ONCE, so exactly one concurrent
          // stealer wins the move; the losers get ENOENT and fall through to
          // backoff+retry rather than overwriting a fresh winner.
          const aside = `${lockPath}.steal.${process.pid}.${randomUUID()}`;
          let won = false;
          try {
            renameSync(lockPath, aside);
            won = true;
          } catch (re) {
            if (/** @type {NodeJS.ErrnoException} */ (re).code !== 'ENOENT') throw re;
            // Lost the move — someone else took the stale lock; re-contend.
          }
          if (won) {
            // ABA guard: if we moved aside a now-fresh live lock (a winner
            // created between our read and our rename), restore it and retry
            // instead of stealing a live owner.
            let asideContent = null;
            try {
              asideContent = /** @type {LockContent} */ (
                JSON.parse(readFileSync(aside, 'utf-8'))
              );
            } catch {
              /* corrupt/partial → treat as stale */
            }
            const asideStale =
              !asideContent ||
              !isPidAlive(asideContent.pid) ||
              Date.now() - asideContent.acquired_at > ttlMs;
            if (asideStale) {
              try {
                // O_EXCL-create ours; if another process filled the empty
                // window first we lose with EEXIST and re-contend.
                writeFileSync(lockPath, content, { flag: 'wx' });
                try {
                  unlinkSync(aside);
                } catch {
                  /* best-effort */
                }
                return { token };
              } catch (ce) {
                try {
                  unlinkSync(aside);
                } catch {
                  /* best-effort */
                }
                if (/** @type {NodeJS.ErrnoException} */ (ce).code !== 'EEXIST') throw ce;
                // Lost the create race — fall through to backoff+retry.
              }
            } else {
              // Restore the fresh live lock we moved aside, then retry.
              try {
                renameSync(aside, lockPath);
              } catch {
                try {
                  unlinkSync(aside);
                } catch {
                  /* best-effort */
                }
              }
            }
          }
        }
      } catch {
        // Unparseable/partial lock — retry (do not steal in this turn).
      }

      if (i < retries) sleepSync(backoffMs);
    }
  }

  return null;
}

/**
 * Release the lock at `lockPath` if and only if it is owned by `token`.
 *
 * Idempotent and never throws: missing lock → no-op; lock owned by another
 * token → no-op (left untouched); corrupt lock → removed (treated as stale).
 *
 * @param {string} lockPath
 * @param {string} token
 * @returns {void}
 */
export function releaseLock(lockPath, token) {
  try {
    const held = /** @type {LockContent} */ (
      JSON.parse(readFileSync(lockPath, 'utf-8'))
    );
    if (held.token === token) unlinkSync(lockPath);
    // Otherwise: another owner — leave it alone.
  } catch (e) {
    // Missing file → nothing to release. Corrupt JSON → clean it up so it does
    // not block future acquires. Any other error → swallow (never throws).
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return;
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone / racing release — no-op */
    }
  }
}

/**
 * Renueva el `acquired_at` del lock en `lockPath` SI Y SOLO SI lo posee `token`
 * (KODO-48).
 *
 * El TTL de `acquireLock` mide «cuánto lleva puesto el lock», no «cuánto lleva el
 * dueño sin dar señales de vida». Para una sección crítica cuya duración no está
 * acotada por construcción —un `launchWorkItem` con round-trips de provider y de
 * cmux— eso convierte al TTL en una bomba: pasado el plazo, el lock queda
 * TTL-stale MIENTRAS su dueño sigue trabajando, y el siguiente contendiente lo
 * roba legítimamente. `renewLock` es la otra mitad: mueve el reloj hacia delante
 * para que «vivo y trabajando» y «fresco» vuelvan a ser lo mismo.
 *
 * Escritura ATÓMICA (tmp + rename), mismo idiom que el steal de `acquireLock`: un
 * `writeFileSync` en dos tiempos dejaría una ventana de lectura parcial, y aunque
 * el camino de acquire trata el JSON ilegible como «reintenta, no robes» (seguro),
 * no hay razón para producir esa ventana.
 *
 * Never-throws y ownership-checked. `false` significa «ya no es tuyo» y el llamante
 * debe DEJAR de renovar: lock ausente (ENOENT — ya liberado, o apartado por un
 * stealer), token ajeno (nos lo robaron y otro proceso es el dueño legítimo), o
 * contenido corrupto. Nunca reescribe un lock que no sea nuestro.
 *
 * Trade-off conocido: entre el read de verificación y el rename hay una ventana
 * TOCTOU de microsegundos, la MISMA forma que ya tiene la rama de steal (leer →
 * decidir stale → renombrar). No la cerramos aquí porque cerrarla exigiría un
 * segundo nivel de CAS sobre una ventana que solo se abre si el lock nos lo roban
 * justo en ese instante — y en ese caso el efecto es un `acquired_at` refrescado
 * con el token del nuevo dueño intacto, no un doble dueño.
 *
 * @param {string} lockPath
 * @param {string} token - el token devuelto por `acquireLock`.
 * @returns {boolean} `true` si se renovó; `false` si el lock ya no nos pertenece.
 */
export function renewLock(lockPath, token) {
  try {
    const held = /** @type {LockContent} */ (
      JSON.parse(readFileSync(lockPath, 'utf-8'))
    );
    if (held.token !== token) return false;

    const tmp = `${lockPath}.renew.${process.pid}.${randomUUID()}`;
    const next = JSON.stringify({
      pid: held.pid,
      acquired_at: Date.now(),
      token,
    });
    try {
      writeFileSync(tmp, next);
      renameSync(tmp, lockPath);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {
        /* best-effort */
      }
      throw e;
    }
    return true;
  } catch {
    // Lock ausente, ilegible o de otro dueño → no es nuestro, no renovamos.
    return false;
  }
}

/**
 * Late de `renewLock` mientras dura una sección crítica larga (KODO-48).
 *
 * Devuelve un `stop()` idempotente que el llamante DEBE invocar en su `finally`.
 * El timer va `unref`-ado: un heartbeat jamás mantiene vivo un proceso que ya
 * terminó su trabajo.
 *
 * `maxHoldMs` es el contrapeso del heartbeat. Sin él, un dueño colgado PERO con
 * event loop sano renovaría para siempre y el recurso quedaría bloqueado sin
 * recuperación posible: el heartbeat habría cambiado «robo prematuro» por «lock
 * inmortal». Con él, el latido cesa pasado ese techo y el TTL vuelve a hacer su
 * trabajo, así que el peor caso queda acotado en `maxHoldMs + ttlMs`.
 *
 * Un `renewLock` en `false` (nos robaron el lock, o ya se liberó) también para el
 * latido: seguir escribiendo sobre un lock ajeno no es tarea de esta función.
 *
 * @param {string} lockPath
 * @param {string} token
 * @param {{ intervalMs: number, maxHoldMs: number }} opts
 * @returns {() => void} `stop()` — idempotente, never-throws.
 */
export function startLockHeartbeat(lockPath, token, opts) {
  const { intervalMs, maxHoldMs } = opts;
  const startedAt = Date.now();

  const timer = setInterval(() => {
    if (Date.now() - startedAt >= maxHoldMs) {
      clearInterval(timer);
      return;
    }
    if (!renewLock(lockPath, token)) clearInterval(timer);
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();

  return () => {
    try {
      clearInterval(timer);
    } catch {
      /* never-throws */
    }
  };
}

/**
 * Run `fn` while holding the advisory lock at `lockPath`.
 *
 * On success returns `{ ok:true, value: fn() }` and releases in `finally`.
 * On acquire failure (retries exhausted) returns the fail-safe
 * `{ ok:false, reason:'lock-timeout' }` and emits a warn — never throws, never
 * blocks indefinitely (D-03).
 *
 * @template T
 * @param {string} lockPath
 * @param {() => T} fn
 * @param {LockOpts} [opts]
 * @returns {{ ok: true, value: T } | { ok: false, reason: 'lock-timeout' }}
 */
export function withFileLock(lockPath, fn, opts = {}) {
  const got = acquireLock(lockPath, opts);
  if (!got) {
    const warn = opts.logger?.warn;
    if (typeof warn === 'function') {
      warn('lock.timeout', { lockPath });
    } else {
      console.warn(`[kodo:lock] lock.timeout ${lockPath}`);
    }
    return { ok: false, reason: 'lock-timeout' };
  }
  try {
    return { ok: true, value: fn() };
  } finally {
    releaseLock(lockPath, got.token);
  }
}
