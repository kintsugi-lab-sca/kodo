// @ts-check
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

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
 * @typedef {{ acquired: true } | { acquired: false, holder: LockContent }} AcquireResult
 */

const LOCK_FILE = '.planning/.kodo.lock';
const DEFAULT_TTL_HOURS = 4;

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
 * @returns {AcquireResult}
 */
export function acquireGsdLock(projectPath, sessionInfo) {
  const lockPath = lockPathFor(projectPath);

  // Case 1: lock file absent — create + acquire.
  if (!existsSync(lockPath)) {
    writeLockFile(lockPath, sessionInfo);
    return { acquired: true };
  }

  // Read existing lock — corrupt files are treated as stale (Case 5).
  let existing;
  try {
    existing = /** @type {LockContent} */ (JSON.parse(readFileSync(lockPath, 'utf-8')));
  } catch {
    return stealLock(lockPath, sessionInfo, 'corrupt lock file');
  }

  // Case 2: holder PID is dead — steal silently.
  if (!isPidAlive(existing.pid)) {
    return stealLock(lockPath, sessionInfo, `PID ${existing.pid} dead`);
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
    return stealLock(lockPath, sessionInfo, 'TTL expired');
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
  /** @type {LockContent} */
  const content = {
    session_id: sessionInfo.session_id,
    task_id: sessionInfo.task_id,
    task_ref: sessionInfo.task_ref,
    pid: process.pid,
    acquired_at: new Date().toISOString(),
    ttl_hours: DEFAULT_TTL_HOURS,
  };
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(content, null, 2) + '\n');
}

/**
 * Overwrite an existing (stale/corrupt) lock with new ownership.
 *
 * Logs the steal reason to stderr at debug volume (existing TTL warnings
 * are emitted by the caller before this helper runs).
 *
 * @param {string} lockPath
 * @param {SessionInfo} sessionInfo
 * @param {string} reason
 * @returns {{ acquired: true }}
 */
function stealLock(lockPath, sessionInfo, reason) {
  console.error(`[kodo:lock] Lock stolen: ${reason}`);
  writeLockFile(lockPath, sessionInfo);
  return { acquired: true };
}

export { LOCK_FILE, DEFAULT_TTL_HOURS };
