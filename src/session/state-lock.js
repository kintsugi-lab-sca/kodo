// @ts-check
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isPidAlive,
  acquireStealGuard,
  guardIsStale,
  breakStaleGuard,
  STEAL_GUARD_STALE_MS,
} from '../gsd/lock.js';

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
 * @typedef {{ retries?: number, backoffMs?: number, ttlMs?: number, logger?: { warn?: (event: string, meta?: object) => void }, _inStealCriticalSectionFn?: () => void }} LockOpts
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
 * Identidad observable del lock: bytes crudos + inodo (KODO-48 follow-up).
 *
 * Es la unidad de comparación del compare-and-swap. Bytes E inodo, no uno solo:
 * comparar solo el inodo queda ciego a la reutilización de inodos tras
 * `unlink`+create —justo la secuencia de un robo ajeno—, y comparar solo los
 * bytes queda ciego a un fichero distinto con contenido idéntico. La hora de
 * modificación se deja FUERA a propósito: es redundante frente a la comparación
 * de bytes y un `touch` provocaría abortos espurios. Mismo criterio que
 * `readLockIdentity` en `src/gsd/lock.js`.
 *
 * @param {string} lockPath
 * @returns {{ raw: Buffer|null, ino: number|null, missing: boolean }}
 */
function readLockIdentity(lockPath) {
  let raw = null;
  let missing = false;
  try {
    raw = readFileSync(lockPath);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') missing = true;
    // Presente pero ilegible → raw null con missing false: es un estado
    // observable y comparable por inodo, no un "no se puede comprobar".
  }
  let ino = null;
  try {
    ino = statSync(lockPath).ino;
  } catch {
    /* desaparecido entre el read y el stat — lo dice `missing`/`raw` */
  }
  return { raw, ino, missing };
}

/**
 * ¿Cambió la identidad del lock entre `base` y `fresh`? Conservador por diseño:
 * si no se puede comparar, la respuesta es «sí cambió» y el llamante NO publica.
 *
 * @param {{ raw: Buffer|null, ino: number|null, missing: boolean }} base
 * @param {{ raw: Buffer|null, ino: number|null, missing: boolean }} fresh
 * @returns {boolean}
 */
function identityChanged(base, fresh) {
  if (base.missing !== fresh.missing) return true;
  if (base.raw === null || fresh.raw === null) {
    // Ilegible en ambos extremos con el MISMO inodo → la identidad no cambió.
    return !(
      base.raw === null &&
      fresh.raw === null &&
      base.ino !== null &&
      fresh.ino !== null &&
      fresh.ino === base.ino
    );
  }
  if (!fresh.raw.equals(base.raw)) return true;
  return base.ino !== null && fresh.ino !== null && fresh.ino !== base.ino;
}

/**
 * ¿Es robable el contenido `held` de un lock? Idéntico criterio que antes: dueño
 * muerto o TTL vencido. Un contenido ilegible NO es robable por sí mismo — puede
 * ser un escritor a medias.
 *
 * @param {LockContent|null} held
 * @param {number} ttlMs
 * @returns {boolean}
 */
function contentIsStale(held, ttlMs) {
  if (!held || !Number.isFinite(held.pid)) return false;
  return !isPidAlive(held.pid) || Date.now() - held.acquired_at > ttlMs;
}

/**
 * Parseo defensivo del cuerpo del lock. `null` si falta o es ilegible.
 *
 * @param {Buffer|null} raw
 * @returns {LockContent|null}
 */
function parseLockContent(raw) {
  if (raw === null) return null;
  try {
    return /** @type {LockContent} */ (JSON.parse(raw.toString('utf-8')));
  } catch {
    return null;
  }
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
      //
      // KODO-48 (regresión detectada al integrar): el CAS anterior —mover el lock
      // A UN LADO con `renameSync(lockPath, aside)` y recrearlo después con
      // `wx`— serializaba a los stealers pero dejaba `lockPath` INEXISTENTE entre
      // el rename y el create. Esa ventana es la que producía DOS ganadores: un
      // contendiente rezagado hacía su `wx`-create en el hueco y se llevaba un
      // token, y la rama de restauración ABA (`renameSync(aside, lockPath)`,
      // incondicional) volvía a pisar ese lock legítimo. Medido con un reproductor
      // dirigido: ~8% de las rondas de 5 hijos sobre un lock de PID muerto — y
      // reproducible IGUAL sobre main sin el heartbeat, así que la ventana es
      // anterior a él, no suya.
      //
      // El arreglo es el idiom que el carril GSD ya maduró en `src/gsd/lock.js`
      // (Phase 82/86) y que aquí se REUSA por import en vez de reimplementarse,
      // mismo criterio que `isPidAlive`:
      //   1. un steal-guard publicado con `linkSync` (atómico en CONTENIDO)
      //      serializa a los stealers;
      //   2. dentro de la sección crítica, la sustitución es EN SITIO —
      //      `renameSync(tmp, lockPath)` intercambia el inodo— así que `lockPath`
      //      NUNCA desaparece y no hay hueco donde colarse;
      //   3. el rename no es incondicional: va precedido de un compare-and-swap
      //      de identidad (bytes + inodo) contra el baseline leído al entrar.
      // La única creación sigue siendo `O_EXCL`, y solo en la rama en la que el
      // dueño liberó el lock a mitad del robo.
      const guardPath = `${lockPath}.steal-guard`;
      try {
        const held = parseLockContent(readLockIdentity(lockPath).raw);
        if (contentIsStale(held, ttlMs)) {
          if (!acquireStealGuard(guardPath)) {
            // Guard ocupado. Romperlo SOLO si está huérfano (dueño muerto o
            // envejecido); jamás uno vivo y en ventana — su dueño puede estar
            // justo en mitad del rename.
            if (guardIsStale(guardPath, STEAL_GUARD_STALE_MS)) breakStaleGuard(guardPath);
            // Sin guard no se roba en este turno: backoff + retry (o `null` si el
            // presupuesto de reintentos era 0, que es lo que debe ver un
            // contendiente perdedor).
          } else {
            try {
              // Seam de inyección para tests de concurrencia (molde literal de
              // `_afterCriticalReadFn` en `src/gsd/lock.js`): superficie de test,
              // NO una feature. Por defecto no existe. Permite APARCAR a un stealer
              // dentro de su sección crítica y comprobar de forma DETERMINISTA la
              // invariante que la versión anterior rompía —que el lock nunca
              // desaparece y que nadie más se lleva un token mientras tanto—, en vez
              // de confiarla a una carrera que solo se manifiesta ~8% de las veces.
              if (typeof opts._inStealCriticalSectionFn === 'function') {
                opts._inStealCriticalSectionFn();
              }

              // Baseline DENTRO del guard: la decisión de robar se re-toma con
              // datos frescos, no con los de antes de contender por el guard.
              const base = readLockIdentity(lockPath);

              if (base.missing) {
                // El dueño liberó a mitad del robo → respetar a un creador fresco
                // vía O_EXCL en vez de pisarlo.
                try {
                  writeFileSync(lockPath, content, { flag: 'wx' });
                  return { token };
                } catch (ce) {
                  if (/** @type {NodeJS.ErrnoException} */ (ce).code !== 'EEXIST') throw ce;
                  // Alguien se adelantó → re-contender.
                }
              } else if (contentIsStale(parseLockContent(base.raw), ttlMs)) {
                // ORDEN INAMOVIBLE (heredado de gsd/lock.js): escribir el tmp →
                // sonda FRESCA → comparar → renombrar. Comparar antes de escribir
                // dejaría el coste de la escritura fuera de la ventana vigilada.
                const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
                try {
                  writeFileSync(tmp, content);
                  const fresh = readLockIdentity(lockPath);
                  if (!identityChanged(base, fresh)) {
                    renameSync(tmp, lockPath);
                    return { token };
                  }
                  try {
                    unlinkSync(tmp);
                  } catch {
                    /* best-effort */
                  }
                  // La identidad cambió bajo nuestros pies → no publicamos nada y
                  // re-contendemos con el bucle de reintentos existente.
                } catch (err) {
                  try {
                    unlinkSync(tmp);
                  } catch {
                    /* best-effort */
                  }
                  throw err;
                }
              }
            } finally {
              try {
                unlinkSync(guardPath);
              } catch {
                /* best-effort */
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
 * El rename NO es incondicional: va precedido del MISMO compare-and-swap de
 * identidad (bytes + inodo) que la rama de steal. Un `renameSync` a ciegas sería
 * el pecado que CR-01 cerró, ahora en versión heartbeat: si entre nuestro read de
 * verificación y el rename otro proceso roba el lock legítimamente, el latido
 * publicaría NUESTRO token encima del dueño nuevo y habría dos dueños creyéndose
 * únicos. Con el CAS, ese caso se detecta y devuelve `false`, que es justo la
 * señal de «deja de renovar».
 *
 * @param {string} lockPath
 * @param {string} token - el token devuelto por `acquireLock`.
 * @returns {boolean} `true` si se renovó; `false` si el lock ya no nos pertenece.
 */
export function renewLock(lockPath, token) {
  try {
    const base = readLockIdentity(lockPath);
    const held = parseLockContent(base.raw);
    if (!held || held.token !== token) return false;

    const tmp = `${lockPath}.renew.${process.pid}.${randomUUID()}`;
    const next = JSON.stringify({
      pid: held.pid,
      acquired_at: Date.now(),
      token,
    });
    try {
      writeFileSync(tmp, next);
      // Sonda fresca DESPUÉS de escribir el tmp: el coste de la escritura queda
      // dentro de la ventana vigilada, no fuera.
      if (identityChanged(base, readLockIdentity(lockPath))) {
        try {
          unlinkSync(tmp);
        } catch {
          /* best-effort */
        }
        return false;
      }
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
