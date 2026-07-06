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
          // Atomic replace (D-08): tmp+rename so a concurrent reader never sees
          // a half-written lock.
          const tmp = `${lockPath}.steal.${process.pid}.${randomUUID()}`;
          writeFileSync(tmp, content);
          renameSync(tmp, lockPath);
          return { token };
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
