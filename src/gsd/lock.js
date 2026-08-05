// @ts-check
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  linkSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Per-repo GSD lock module.
 *
 * Implements D-05 (lock path), D-06 (lock content), D-07 (acquisition semantics)
 * and D-09 (idempotent release) from Phase 8 CONTEXT.md.
 *
 * The lock file lives at `<projectPath>/.planning/.kodo.lock` (resolved through
 * `realpathSync` to avoid symlink-based path divergence on macOS, Pitfall 3).
 *
 * Acquisition cases (D-07):
 *  1. Lock file absent           -> create + acquire.
 *  2. Lock holder PID is dead    -> steal silently.
 *  3. Lock holder PID alive but TTL exceeded -> steal + warn to stderr.
 *  4. Lock holder PID alive + TTL OK -> reject with `{ acquired: false, holder }`.
 *  5. Lock file is corrupt JSON  -> treat as stale and steal.
 *
 * Release (D-09) is idempotent: if the lock file is missing or owned by a
 * different session, it is left untouched.
 */

/**
 * @typedef {{
 *   session_id: string,
 *   task_id: string,
 *   task_ref: string,
 *   pid: number,
 *   acquired_at: string,
 *   ttl_hours: number,
 * }} LockContent
 *
 * @typedef {{
 *   session_id: string,
 *   task_id: string,
 *   task_ref: string,
 * }} SessionInfo
 *
 * @typedef {{ acquired: true }
 *          | { acquired: false, holder: LockContent, reason?: string }} AcquireResult
 *   `reason` is OPTIONAL and ADDITIVE (D-08): it discriminates WHY the acquire was
 *   rejected without changing the shape any existing consumer reads. Its only value
 *   today is `'lock-replaced-mid-steal'` (D-09) — no reason taxonomy is invented here.
 *   The sole consumer of the rejected variant, `src/triggers/dispatcher.js:202`, reads
 *   `.holder` only, so it needs no change.
 */

const LOCK_FILE = '.planning/.kodo.lock';
const DEFAULT_TTL_HOURS = 4;
// Bounded re-contention budget for the guarded steal (CR-01). Each iteration is
// a full guard-acquire attempt; a pathological churn can never spin forever.
const MAX_STEAL_ATTEMPTS = 8;
// Age threshold past which an orphaned steal-guard is breakable (D-05). Orders
// of magnitude larger than the ~1ms critical section (read+write+rename), so a
// live stealer inside the guard is never broken by age (A2). Dead-PID is the
// primary, always-safe break criterion; this age bound is the backstop for a
// guard whose owner PID was recycled onto a live-but-unrelated process.
const STEAL_GUARD_STALE_MS = 5_000;

/**
 * Check whether `pid` is alive on the current host.
 *
 * Uses `process.kill(pid, 0)` (POSIX-portable; signal 0 sends nothing but
 * triggers permission and existence checks). The kernel reports `ESRCH`
 * when no process owns that PID — that is the only case in which we
 * conclude the process is dead. Any other error (notably `EPERM`) means
 * the PID exists but we lack permission to signal it, in which case we
 * conservatively treat it as alive.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code !== 'ESRCH';
  }
}

/**
 * Read and parse the lock file at `<projectPath>/.planning/.kodo.lock`.
 * Returns `null` if the file is absent, unreadable or contains invalid JSON.
 *
 * `projectPath` is resolved via `realpathSync` so that symlinked paths
 * (macOS `/tmp` -> `/private/tmp`) collapse to the same lock location.
 *
 * @param {string} projectPath
 * @returns {LockContent | null}
 */
export function readLock(projectPath) {
  const lockPath = lockPathFor(projectPath);
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Attempt to acquire the GSD lock for `projectPath`.
 *
 * @param {string} projectPath - Absolute path to the target repository.
 * @param {SessionInfo} sessionInfo - Identity of the session requesting the lock.
 * @param {{ _afterCriticalReadFn?: () => void }} [deps] - Optional dependency seam,
 *   propagated to `stealLock`. `_afterCriticalReadFn` is the CONCURRENCY-TEST
 *   INJECTION SEAM (D-10/D-11), NOT a feature: it widens the baseline-read →
 *   rename window deterministically without test code in production. It is invoked
 *   INSIDE the guarded critical section, right after the baseline identity read,
 *   and ONLY on the FIRST attempt — if it fired on every turn the test's hold would
 *   be multiplied by `MAX_STEAL_ATTEMPTS` and each turn would hold the steal-guard
 *   closer to `STEAL_GUARD_STALE_MS`, so the scenario would stop converging.
 *   Default no-op; NO production call site passes it. Precedent: `_afterReadFn` in
 *   `src/inbox/store.js:698-703`.
 * @returns {AcquireResult}
 */
export function acquireGsdLock(projectPath, sessionInfo, deps = {}) {
  const lockPath = lockPathFor(projectPath);

  // Case 1: atomic create + acquire (CONC-02, D-07). `writeLockFile` now uses
  // `{flag:'wx'}` (O_EXCL), so two processes that both see the lock absent can
  // no longer both create it — exactly one wins the create, the loser gets
  // EEXIST and falls through to the read-existing path below (Cases 2-5), where
  // the winner's live PID + fresh TTL yields a clean `{ acquired:false }`.
  try {
    writeLockFile(lockPath, sessionInfo);
    return { acquired: true };
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    // EEXIST → the lock already exists; fall through to the read-existing logic.
  }

  // Read existing lock — corrupt files are treated as stale (Case 5).
  let existing;
  try {
    existing = /** @type {LockContent} */ (JSON.parse(readFileSync(lockPath, 'utf-8')));
  } catch {
    return stealLock(lockPath, sessionInfo, 'corrupt lock file', deps);
  }

  // Case 2: holder PID is dead — steal silently.
  if (!isPidAlive(existing.pid)) {
    return stealLock(lockPath, sessionInfo, `PID ${existing.pid} dead`, deps);
  }

  // Case 3: PID alive but TTL expired — steal + warn.
  const acquiredAt = new Date(existing.acquired_at).getTime();
  const ttlHours = existing.ttl_hours || DEFAULT_TTL_HOURS;
  const ttlMs = ttlHours * 3600_000;
  if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt > ttlMs) {
    console.error(
      `[kodo:lock] Stealing expired lock from ${existing.task_ref} ` +
        `(acquired ${existing.acquired_at}, TTL ${ttlHours}h exceeded)`,
    );
    return stealLock(lockPath, sessionInfo, 'TTL expired', deps);
  }

  // Case 4: PID alive, TTL OK — reject.
  return { acquired: false, holder: existing };
}

/**
 * Release the GSD lock for `projectPath` if it is owned by `sessionId`.
 *
 * Idempotent (D-09):
 *  - Missing lock file              -> no-op.
 *  - Lock owned by another session  -> no-op (left untouched).
 *  - Lock owned by `sessionId`      -> deleted.
 *  - Corrupt lock file              -> deleted (treated as stale).
 *
 * @param {string} projectPath
 * @param {string} sessionId
 * @returns {void}
 */
export function releaseGsdLock(projectPath, sessionId) {
  const lockPath = lockPathFor(projectPath);
  if (!existsSync(lockPath)) return;

  let existing;
  try {
    existing = /** @type {LockContent} */ (JSON.parse(readFileSync(lockPath, 'utf-8')));
  } catch {
    // Corrupt lock — clean it up so it does not block future acquires.
    unlinkSync(lockPath);
    return;
  }

  if (existing.session_id === sessionId) {
    unlinkSync(lockPath);
  }
  // Otherwise: another session owns the lock — leave it alone.
}

/**
 * Build the absolute lock path for `projectPath`, resolving symlinks.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function lockPathFor(projectPath) {
  return join(realpathSync(projectPath), LOCK_FILE);
}

/**
 * Write a new lock file at `lockPath`, creating the parent directory if
 * needed (Pitfall 4: `.planning/` may not exist in repos without GSD yet).
 *
 * @param {string} lockPath
 * @param {SessionInfo} sessionInfo
 * @returns {void}
 */
function writeLockFile(lockPath, sessionInfo) {
  mkdirSync(dirname(lockPath), { recursive: true });
  // O_EXCL create (CONC-02, D-07): fails with EEXIST if the lock already
  // exists, closing the TOCTOU that let two processes both "create" and win.
  writeFileSync(lockPath, serializeLockContent(sessionInfo), { flag: 'wx' });
}

/**
 * Build the serialized lock-file body for `sessionInfo`.
 *
 * @param {SessionInfo} sessionInfo
 * @returns {string}
 */
function serializeLockContent(sessionInfo) {
  /** @type {LockContent} */
  const content = {
    session_id: sessionInfo.session_id,
    task_id: sessionInfo.task_id,
    task_ref: sessionInfo.task_ref,
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    ttl_hours: DEFAULT_TTL_HOURS,
  };
  return JSON.stringify(content, null, 2) + '\n';
}

/**
 * Read + parse the lock at a raw filesystem path. Returns `null` if the file is
 * absent or contains invalid JSON.
 *
 * @param {string} path
 * @returns {LockContent | null}
 */
function readLockContent(path) {
  try {
    return /** @type {LockContent} */ (JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * Read the IDENTITY of the lock at `path` in a SINGLE pass: raw bytes, parsed
 * content and inode. Additive neighbour of `readLockContent`, which is kept intact
 * for every other call site.
 *
 * **Orden crítico, heredado del precedente** (`src/inbox/store.js:662-665`): los
 * bytes salen de **la lectura**, jamás de un `statSync` tomado por separado. Un
 * cambio que aterrice entre el `readFileSync` y ese stat entraría en el baseline y
 * dejaría el guard **ciego justo ante el caso que debe detectar**. El `ino` se toma
 * **inmediatamente después** de la lectura y degrada a `null` si el stat falla
 * (molde de `src/inbox/store.js:740-744`): sin componente de inodo, la comparación
 * de bytes sigue vigente.
 *
 * `raw` es un `Buffer` — `readFileSync` **sin encoding** a propósito: leer con
 * `'utf-8'` colapsaría bytes inválidos a U+FFFD y dos contenidos distintos
 * compararían iguales. `content` es el parse, o `null` si el JSON es corrupto, al
 * mismo nivel de validación que `readLockContent`: un lock corrupto sigue siendo
 * robable.
 *
 * @param {string} path
 * @returns {{ raw: Buffer | null, content: LockContent | null, ino: number | null }}
 */
function readLockIdentity(path) {
  /** @type {Buffer} */
  let raw;
  try {
    raw = readFileSync(path);
  } catch {
    return { raw: null, content: null, ino: null };
  }

  /** @type {number | null} */
  let ino = null;
  try {
    ino = statSync(path).ino;
  } catch {
    ino = null; // sin componente de inodo; el de bytes sigue vigente
  }

  /** @type {LockContent | null} */
  let content = null;
  try {
    content = /** @type {LockContent} */ (JSON.parse(raw.toString('utf-8')));
  } catch {
    content = null; // corrupto → robable, como en `readLockContent`
  }

  return { raw, content, ino };
}

/**
 * Is `lock` stealable (holder PID dead, or TTL exceeded)? Mirrors the gating in
 * `acquireGsdLock` (Cases 2-3) and `doctor.decideLock`.
 *
 * @param {LockContent} lock
 * @returns {boolean}
 */
function isStaleLock(lock) {
  if (!isPidAlive(lock.pid)) return true;
  const acquiredAt = new Date(lock.acquired_at).getTime();
  const ttlHours = lock.ttl_hours || DEFAULT_TTL_HOURS;
  return Number.isFinite(acquiredAt) && Date.now() - acquiredAt > ttlHours * 3600_000;
}

/**
 * Read + parse the steal-guard at `guardPath`. Returns `null` if absent or
 * unparseable (a corrupt/partial guard is treated as breakable).
 *
 * @param {string} guardPath
 * @returns {{ pid: number, ts: number } | null}
 */
function readGuard(guardPath) {
  try {
    return JSON.parse(readFileSync(guardPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Try to become the steal-guard owner by publishing the guard ATOMICALLY IN
 * CONTENT (D-01 applied to the guard itself). Ownership is conferred ONLY by the
 * successful publish — never by breaking a stale guard.
 *
 * A plain `writeFileSync(guardPath, json, {flag:'wx'})` is exclusive on CREATE
 * but not atomic on CONTENT: `O_EXCL` opens an empty file, then the bytes are
 * written. A concurrent stealer that reads `guardPath` in that gap sees an empty
 * (unparseable) guard, concludes it is stale, breaks a LIVE guard, and re-enters
 * the critical section → two stealers rename at once. This moved the briefly-empty
 * window from the LOCK file to the GUARD file.
 *
 * The fix: write the full guard body to a unique tmp, then `linkSync(tmp,
 * guardPath)` — `link(2)` is atomic and fails with `EEXIST` if the guard exists,
 * so the guard becomes visible already carrying complete content. The tmp is
 * unlinked best-effort on every path (win or lose).
 *
 * Returns `true` on win, `false` on `EEXIST` (loser); any other error is rethrown.
 *
 * @param {string} guardPath
 * @returns {boolean}
 */
function acquireStealGuard(guardPath) {
  const tmp = `${guardPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    try {
      linkSync(tmp, guardPath);
      return true;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      return false;
    }
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Is the steal-guard at `guardPath` breakable? Reads the guard defensively:
 *
 *  - Parseable guard: break if the owner PID is dead (primary, always-safe) or
 *    the recorded `ts` aged past `thresholdMs`.
 *  - Present but UNPARSEABLE guard: do NOT break merely because it failed to
 *    parse — a writer mid-publish (or any transient partial content) would be
 *    broken, reintroducing the double-acquire. Break only when the FILE age
 *    (mtime) exceeds `thresholdMs` — the sole criterion for persistent garbage
 *    from a rare crash. (With the atomic `linkSync` publish an empty/partial
 *    guard is no longer observable from a well-behaved writer; this is defence in
 *    depth for corruption.)
 *  - Absent guard: trivially breakable (nothing to break; the caller re-contends).
 *
 * Never break a live, in-window guard — its owner may be mid-rename (Pitfall 1).
 *
 * @param {string} guardPath
 * @param {number} thresholdMs
 * @returns {boolean}
 */
function guardIsStale(guardPath, thresholdMs) {
  const guard = readGuard(guardPath);
  if (guard && Number.isFinite(guard.pid)) {
    if (!isPidAlive(guard.pid)) return true;
    return Number.isFinite(guard.ts) && Date.now() - guard.ts > thresholdMs;
  }
  // Absent or unparseable → decide by file age (mtime); never by parse failure.
  let mtimeMs;
  try {
    mtimeMs = statSync(guardPath).mtimeMs;
  } catch {
    return true; // vanished between our EEXIST and here → treat as gone
  }
  return Date.now() - mtimeMs > thresholdMs;
}

/**
 * Best-effort removal of a stale guard so a fresh `O_EXCL`-create can proceed.
 * Breaking does NOT confer ownership; it only clears the orphaned guard.
 *
 * @param {string} guardPath
 * @returns {void}
 */
function breakStaleGuard(guardPath) {
  try {
    unlinkSync(guardPath);
  } catch {
    /* best-effort — another contender may have broken it first */
  }
}

/**
 * Synchronous bounded backoff (best-effort) between re-contention attempts.
 *
 * @param {number} ms
 * @returns {void}
 */
function sleepShort(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable — skip the backoff */
  }
}

/**
 * Replace an existing (stale/corrupt) lock with new ownership so that at most
 * ONE of N concurrent stealers wins (CR-01), closing the double-acquire race by
 * construction (D-01/D-02).
 *
 * Ownership of the LOCK is conferred SOLELY by `renameSync(tmp → lockPath)` (or
 * an `O_EXCL` create over an absent path); ownership of the GUARD solely by an
 * `O_EXCL` create of `${lockPath}.steal-guard`. That separation is the pivot:
 *
 *  1. Acquire the steal-guard by publishing it ATOMICALLY IN CONTENT
 *     (`linkSync(tmp → guardPath)`, exclusive like `O_EXCL` but never observable
 *     empty — D-01 applied to the guard). A guard whose owner PID is dead, or
 *     which aged past `STEAL_GUARD_STALE_MS`, is breakable (D-05) — breaking it
 *     clears the orphan but confers no ownership; the winner is still whoever
 *     next wins the atomic publish. A live+in-window guard is never broken
 *     (Pitfall 1), and an unparseable guard is broken by file age only, never by
 *     parse failure alone.
 *  2. Inside the guarded critical section (serialized across stealers), re-read
 *     `lockPath`: a fresh live holder → reject; a present stale/corrupt holder →
 *     atomic in-place replacement via a uniquely-named `tmp` + `renameSync(tmp →
 *     lockPath)`, so `lockPath` is NEVER briefly-empty (D-01); an ABSENT holder
 *     → respect a fresh creator via `O_EXCL` create rather than clobbering it
 *     (Pitfall 2), since a fresh `acquireGsdLock` Case-1 create bypasses the
 *     guard.
 *  3. Release the guard in a `finally` (happy + error paths).
 *
 * The bounded budget (`MAX_STEAL_ATTEMPTS`) caps re-contention; on exhaustion it
 * rejects against the current holder or makes a final atomic `O_EXCL` acquire —
 * never by renaming the live lock away, never by creating over a path left
 * deliberately empty.
 *
 * @param {string} lockPath
 * @param {SessionInfo} sessionInfo
 * @param {string} reason
 * @param {{ _afterCriticalReadFn?: () => void }} [deps] - See the `acquireGsdLock`
 *   JSDoc: `_afterCriticalReadFn` is a concurrency-test injection seam, default
 *   no-op, fired on the FIRST attempt only.
 * @returns {AcquireResult}
 */
function stealLock(lockPath, sessionInfo, reason, deps = {}) {
  console.error(`[kodo:lock] Lock stolen: ${reason}`);
  mkdirSync(dirname(lockPath), { recursive: true });
  const guardPath = `${lockPath}.steal-guard`;

  for (let attempt = 0; attempt < MAX_STEAL_ATTEMPTS; attempt++) {
    // Contend for the steal-guard. Ownership comes ONLY from the O_EXCL create.
    if (!acquireStealGuard(guardPath)) {
      // Guard busy. Break it only if orphaned (dead owner / aged out); never
      // break a live, in-window guard (Pitfall 1).
      if (guardIsStale(guardPath, STEAL_GUARD_STALE_MS)) {
        breakStaleGuard(guardPath);
        continue; // re-contend for a fresh atomic publish
      }
      // A live stealer holds the guard. If the lock already has a live holder,
      // reject; otherwise back off briefly and re-contend.
      const holder = readLockContent(lockPath);
      if (holder && !isStaleLock(holder)) return { acquired: false, holder };
      sleepShort(2 * (attempt + 1));
      continue;
    }

    // ── Critical section, serialized by the guard ──
    try {
      // Baseline identity of the lock (bytes + inode), read ONCE. The freshness
      // gate below reads its `content`; the compare-and-swap in the PRESENT branch
      // compares its `raw`/`ino` against a fresh probe taken just before the rename.
      const base = readLockIdentity(lockPath);

      // Concurrency-test injection seam (D-10/D-11): default no-op, FIRST attempt
      // only. See the `acquireGsdLock` JSDoc — this is test surface, not a feature.
      if (attempt === 0 && typeof deps._afterCriticalReadFn === 'function') {
        deps._afterCriticalReadFn();
      }

      const current = base.content;

      // A fresh live holder appeared between the caller's read and here → reject.
      if (current && !isStaleLock(current)) return { acquired: false, holder: current };

      if (existsSync(lockPath)) {
        // Present (stale or corrupt) → atomic in-place replacement. `lockPath` is
        // never briefly-empty: rename swaps the inode atomically (POSIX).
        //
        // The rename is NOT unconditional (CR-01, second order). The steal-guard
        // serializes STEALERS, not creators: the live-but-stale holder can call
        // `releaseGsdLock` right here, and a fresh `acquireGsdLock` Case-1 creator
        // — which bypasses the guard by design — lands its O_EXCL create in the gap
        // the unlink just opened. Renaming blindly over that path clobbers a
        // legitimate owner, and both processes believe they hold the lock. That is
        // exactly what the compare-and-swap below detects: the lock identity is
        // re-probed FRESH (raw bytes + inode) against the baseline read at the top
        // of this critical section, immediately before the rename.
        //
        // ORDEN INAMOVIBLE, heredado de `src/inbox/store.js:787-789`: escribir el
        // tmp → sonda FRESCA → comparar → renombrar. Comparar ANTES de escribir el
        // tmp dejaría fuera de la ventana vigilada el propio coste de la escritura.
        const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
        try {
          writeFileSync(tmp, serializeLockContent(sessionInfo));

          const fresh = readLockIdentity(lockPath);
          // Bytes AND inode: comparing only the inode would go blind to inode reuse
          // after `unlink` + create, which is the very sequence of steps 3-4 above.
          // Modification TIME stays OUT of the identity comparison on purpose
          // (D-04): it is redundant against a full byte compare, and a bare `touch`
          // would produce spurious aborts. Do not "complete" this later.
          const changed =
            fresh.raw === null || base.raw === null
              ? true // conservador: si no se puede comprobar, NO se publica
              : !fresh.raw.equals(base.raw) ||
                (base.ino !== null && fresh.ino !== null && fresh.ino !== base.ino);

          if (!changed) {
            renameSync(tmp, lockPath);
            return { acquired: true };
          }

          try {
            unlinkSync(tmp);
          } catch {
            /* best-effort — sin residuo de tmp perdido */
          }

          if (fresh.content && !isStaleLock(fresh.content)) {
            // A live, fresh holder owns the path now: the legitimate Case-1 creator
            // keeps the lock and this late stealer withdraws cleanly, without
            // spending more budget. Only `task_ref` is interpolated — never the raw
            // lock body, which is hand-editable and would be a control-char vector
            // towards the terminal.
            console.error(
              `[kodo:lock] Steal aborted: lock replaced mid-steal by a live holder ` +
                `(${fresh.content.task_ref})`,
            );
            return {
              acquired: false,
              holder: fresh.content,
              reason: 'lock-replaced-mid-steal',
            };
          }

          // Unparseable, stale, or the probe failed → release the guard through the
          // `finally` below and re-contend: the loop already resolves all three
          // states the path can be in (fresh live creator / absent / stale
          // reappeared). Consumes ONE attempt of the EXISTING budget.
          continue;
        } catch (err) {
          try {
            unlinkSync(tmp);
          } catch {
            /* best-effort */
          }
          throw err;
        }
      }

      // Absent (holder released mid-steal) → respect a fresh creator via O_EXCL
      // rather than clobbering it (Pitfall 2).
      try {
        writeFileSync(lockPath, serializeLockContent(sessionInfo), { flag: 'wx' });
        return { acquired: true };
      } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
        const holder = readLockContent(lockPath);
        if (holder && !isStaleLock(holder)) return { acquired: false, holder };
        // A stale/corrupt lock reappeared → fall through to re-contend.
      }
    } finally {
      try {
        unlinkSync(guardPath);
      } catch {
        /* best-effort */
      }
    }
  }

  // Bounded budget exhausted (pathological churn). Never reopen the window:
  // reject against the current holder, or make a final atomic O_EXCL acquire if
  // the lock is legitimately absent. Never rename the live lock away; never
  // create over a path left deliberately empty.
  const holder = readLockContent(lockPath);
  if (holder) return { acquired: false, holder };
  try {
    writeFileSync(lockPath, serializeLockContent(sessionInfo), { flag: 'wx' });
    return { acquired: true };
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    const raced = readLockContent(lockPath);
    if (raced) return { acquired: false, holder: raced };
    throw e; // present-but-unparseable at the very end — surface, never clobber
  }
}

export { LOCK_FILE, DEFAULT_TTL_HOURS };
