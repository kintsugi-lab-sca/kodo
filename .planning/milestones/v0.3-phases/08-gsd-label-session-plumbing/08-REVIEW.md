---
phase: 08-gsd-label-session-plumbing
reviewed: 2026-04-20T07:01:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/gsd/lock.js
  - src/hooks/session-start.js
  - src/hooks/stop.js
  - src/session/manager.js
  - src/session/state.js
  - src/triggers/dispatcher.js
  - test/dispatcher.test.js
  - test/gsd-concurrency.test.js
  - test/gsd-context.test.js
  - test/gsd-lock.test.js
  - test/manager.test.js
  - test/stop.test.js
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-04-20T07:01:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 8 (`gsd-label-session-plumbing`) introduces:

1. `src/gsd/lock.js` — per-repo lock module with PID liveness, TTL, and idempotent release.
2. Lock guard wired into `src/triggers/dispatcher.js` behind a `kodo:gsd` label check.
3. Lock release in `src/hooks/stop.js` keyed by `session.session_id`.
4. GSD-flavored context injection in `src/hooks/session-start.js` (`buildGsdContext`).
5. `gsd?: boolean` and `phase_id?: string` fields plumbed through `Session` typedef and `buildSessionFromTask`.

The lock module itself is well-designed: clear TTL semantics, conservative `EPERM` handling in `isPidAlive`, symlink-resolved path via `realpathSync`, and an idempotent release that verifies session ownership before deleting. Tests are mostly real-FS integration tests with proper `tmpdir` isolation — no flaky timing.

However, there is **one critical contract bug** that defeats the entire idempotent-release design: the dispatcher acquires the lock under a synthetic `pending-${task.id}` session_id, but `stop.js` releases with the real `randomUUID()` session_id from the launched session. These will never match, so `releaseGsdLock` always falls into the "another session owns it" branch and silently no-ops. The lock will only be cleared by the 4-hour TTL or a subsequent re-dispatch on a dead PID — meaning every successful GSD session leaves a live lock behind for up to 4 hours, blocking new GSD work on the same repo.

A second meaningful issue: there is a TOCTOU race window between the dispatcher's lock acquisition and `launchWorkItem`'s creation of the real session record. If `launchWorkItem` throws after the lock is acquired, the lock is never released by anyone (no session in state means no `stop` event, no release path) and only the TTL recovers.

The remaining findings are smaller robustness/quality items.

## Critical Issues

### CR-01: Lock release is dead code — pending-${task.id} ≠ real session_id

**Files:**
- `src/triggers/dispatcher.js:111-115`
- `src/hooks/stop.js:103-110`
- `src/session/manager.js:177` (real `randomUUID()` source)

**Issue:**
`acquireGsdLock` is invoked in `dispatcher.js` with a synthetic ownership identifier:

```js
// src/triggers/dispatcher.js:111
const lockResult = acquireGsdLockFn(projectPath, {
  session_id: `pending-${task.id}`,
  task_id: task.id,
  task_ref: task.ref,
});
```

The lock file is therefore stamped with `session_id: "pending-<task.id>"`. Meanwhile `launchWorkItem` (called immediately after) generates a fresh `randomUUID()` and persists it as `session.session_id`:

```js
// src/session/manager.js:177
const sessionId = randomUUID();
// ...
addSession(task.id, session); // session.session_id = <uuid>
```

When the Stop hook later runs `releaseGsdLock(session.project_path, session.session_id)`, the comparison in `releaseGsdLock` (`existing.session_id === sessionId`) compares `"pending-<task.id>"` to a UUID and never matches. The function then falls through to the "another session owns it — leave it alone" branch (`src/gsd/lock.js:167-170`) and the lock file is **never deleted on the happy path**.

Net effect:
- Every successful GSD session leaks its lock until the 4-hour TTL expires or the PID dies.
- Subsequent GSD dispatches against the same repo return `gsd_locked` for hours, even after the originating session is closed cleanly.
- The integration test `test/gsd-concurrency.test.js` "after lock release, second task can acquire" hides this because it deliberately calls `releaseGsdLock(repoDir, \`pending-${task1.id}\`)` (line 136) — i.e. the test releases with the synthetic ID it knows the dispatcher used, not with the value the production stop hook would use. The test passes; production breaks.

**Fix:**

Two viable options. Option A (preferred — single ownership identity from acquisition to release):

1. Generate the `session_id` (UUID) in the dispatcher *before* acquiring the lock, then thread it through to `launchWorkItem`. Acquire with the real UUID, persist with the real UUID, release with the real UUID.

```js
// src/triggers/dispatcher.js
import { randomUUID } from 'node:crypto';

// inside the GSD branch:
const sessionId = randomUUID();
const lockResult = acquireGsdLockFn(projectPath, {
  session_id: sessionId,
  task_id: task.id,
  task_ref: task.ref,
});
if (!lockResult.acquired) {
  return { action: 'gsd_locked', holder: lockResult.holder };
}
// pass sessionId to launchWorkItem so it persists the same value
const session = await launchWorkItemFn(event.taskRef, { ...launchOpts, sessionId });
```

`launchWorkItem` would accept an optional `opts.sessionId` and use it instead of generating its own.

Option B (compatibility-preserving): after `launchWorkItem` returns, rewrite the lock file with the real session_id (effectively a self-steal). Riskier because it requires either re-acquire-and-overwrite logic that ignores ownership, or a dedicated "rekey" helper. Option A is cleaner and keeps the lock contract honest.

A regression test must assert the round-trip: dispatcher acquires → stop hook releases → next dispatch on the same repo succeeds, with no manual `releaseGsdLock` call between them.

## Warnings

### WR-01: Lock leaks if launchWorkItem throws after lock acquisition

**File:** `src/triggers/dispatcher.js:102-164`

**Issue:**
Once `acquireGsdLockFn` returns `{ acquired: true }`, the lock file is on disk. Steps that follow (cmux workspace creation, provider state transition, `cmux.send`, `addSession`) can throw — `launchWorkItem` does not have a `try/finally` that releases the lock on failure. If any of those fails, the function rejects without ever creating a session record, so the Stop hook will never fire either (no session → no `findSession` match → no `releaseGsdLock` call). The lock then survives until the 4h TTL.

This is amplified by CR-01 (since release is broken anyway), but it remains a real bug even after CR-01 is fixed.

**Fix:**
Wrap the launch path in `try/catch` and release the lock on error:

```js
if (kodoConfig.flags.includes('gsd') && projectPath) {
  // ... acquire as in CR-01 fix ...
}
inFlight.add(task.id);
try {
  const session = await launchWorkItemFn(event.taskRef, launchOpts);
  return { action: 'launched', session };
} catch (err) {
  if (kodoConfig.flags.includes('gsd') && projectPath) {
    try { releaseGsdLockFn(projectPath, sessionId); } catch {}
  }
  throw err;
} finally {
  inFlight.delete(task.id);
}
```

Add `releaseGsdLockFn` to `DispatchDeps` to keep the DI symmetry.

### WR-02: TOCTOU between lock acquire and session.json — Stop hook may not find the session

**Files:**
- `src/triggers/dispatcher.js:111-120` (acquire)
- `src/session/manager.js:184-194` (`addSession` runs only after the workspace is created and Claude is sent the command)

**Issue:**
There is a window of seconds between `acquireGsdLock` and `addSession` (cmux workspace creation, `cmux.send` of the `claude` command, etc.). If the user closes Claude during that window — or `launchWorkItem` throws after `cmux.send` but before `addSession` — the lock is set but no session record exists. The Stop hook in that case logs `[kodo:stop] No matching session found` (`src/hooks/stop.js:47`) and exits without releasing.

**Fix:**
Same `try/catch` in WR-01 covers the throw case. For the "user closes immediately" case, the only durable answer is to combine: (a) write a tentative session record before `cmux.send` so the Stop hook can find it, or (b) accept that the TTL is the correctness floor and document it. Either is acceptable, but the current code does neither and leans on a release path that does not work (CR-01).

### WR-03: `lockPathFor` calls `realpathSync` on a path that may not exist

**File:** `src/gsd/lock.js:179-181`

**Issue:**
`lockPathFor` invokes `realpathSync(projectPath)` unconditionally. POSIX `realpath(3)` requires every component of the path to exist. If `projectPath` does not exist (misconfigured `projects.json`, repo cloned to a different location, typo in label), `realpathSync` throws `ENOENT`, propagating out of `acquireGsdLock`/`releaseGsdLock`/`readLock`.

In `dispatcher.js` the lock guard is reached after `resolveProjectPath`, which only checks the projects map, not the filesystem — so a stale mapping crashes the dispatcher mid-guard rather than logging a friendly error. Likewise `releaseGsdLock` in `stop.js` would throw on a deleted repo dir. The current `try/catch` in `stop.js:107` swallows it, but it is still noise.

**Fix:**
Catch `ENOENT` in `lockPathFor` and fall back to the unresolved path (acceptable because the caller is also unresolved), or short-circuit acquire/release to a no-op when the project directory does not exist:

```js
function lockPathFor(projectPath) {
  try {
    return join(realpathSync(projectPath), LOCK_FILE);
  } catch (e) {
    if (e.code === 'ENOENT') return join(projectPath, LOCK_FILE);
    throw e;
  }
}
```

Add a test covering "projectPath does not exist" for both `acquireGsdLock` and `releaseGsdLock`.

### WR-04: Lock write is not atomic (partial-write window after crash)

**File:** `src/gsd/lock.js:191-203` (`writeLockFile`)

**Issue:**
`writeFileSync(lockPath, JSON.stringify(...) + '\n')` is not atomic — a power loss or `kill -9` between `open` and the final write can leave a truncated/empty file on disk. The next `acquireGsdLock` call would `JSON.parse` and fall into the corrupt-file branch, which steals silently. That is the right recovery, but a concurrent reader (`readLock` from a third party) could observe a partial file and return `null`.

The current design is documented as a single-writer-per-repo lock, so this is not a correctness break, only a robustness concern.

**Fix:**
Write to a sibling tempfile and `renameSync` into place:

```js
function writeLockFile(lockPath, sessionInfo) {
  const content = { /* ... */ };
  mkdirSync(dirname(lockPath), { recursive: true });
  const tmp = `${lockPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(content, null, 2) + '\n');
  renameSync(tmp, lockPath); // atomic on POSIX
}
```

### WR-05: `acquired_at` parsed without validating format — Date.parse leniency

**File:** `src/gsd/lock.js:126-129`

**Issue:**
`new Date(existing.acquired_at).getTime()` accepts an enormous range of inputs (including obviously wrong ones). The follow-up `Number.isFinite(acquiredAt)` only catches `NaN` from total parse failure. A malformed but parseable timestamp (e.g. an old format `"2026/04/20"`, or `"yesterday"` ignored by some Node versions) could yield a date in 1970 and trigger an immediate "TTL expired" steal — which happens to be the safe side here, but the contract is undocumented.

**Fix:**
Either (a) document explicitly that any non-ISO acquired_at is treated as expired, or (b) tighten the check by validating against ISO-8601:

```js
const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
if (!isoRe.test(existing.acquired_at)) {
  return stealLock(lockPath, sessionInfo, 'invalid acquired_at');
}
```

### WR-06: `Session.status` typedef does not include `'interrupted'` but `markSessionStatus` accepts it

**Files:**
- `src/session/state.js:20` (typedef declares `'running'|'done'|'error'|'review'`)
- `src/session/manager.js:261` (`markSessionStatus` JSDoc accepts `'running'|'done'|'error'|'review'|'interrupted'`)

**Issue:**
The `Session.status` typedef enumerates four values, but `markSessionStatus` advertises a fifth (`'interrupted'`). Any consumer that narrows by the typedef will reject `'interrupted'` even though it can be persisted by the manager. Same drift exists for the `State.history` array — the State typedef does not declare `history` at all, but `removeSession` writes to it (`src/session/state.js:105-110`) and `listHistory` reads it (line 119-121). TypeScript-aware tooling will silently widen `state` to `any` once these properties appear.

**Fix:**
Add the missing values to the typedef and declare `history` on `State`:

```js
/**
 * @typedef {{
 *   ...
 *   status: 'running'|'done'|'error'|'review'|'interrupted',
 *   ...
 * }} Session
 *
 * @typedef {{
 *   schema_version: number,
 *   sessions: Record<string, Session>,
 *   history?: Array<Session & { ended_at: string }>,
 * }} State
 */
```

## Info

### IN-01: Dead import in session-start.js

**File:** `src/hooks/session-start.js:8`

**Issue:**
`import { fileURLToPath } from 'node:url';` is imported but never used (the `import.meta.url === \`file://${process.argv[1]}\`` check on line 206 uses raw string interpolation, not `fileURLToPath`). `stop.js` does the same imports and uses them; `session-start.js` does not.

**Fix:**
Remove the unused import, or make the entry-point check consistent with `stop.js` (`fileURLToPath(import.meta.url) === process.argv[1]`), which is also more robust against URL-encoded paths.

### IN-02: Two consecutive `await import('../logger.js')` in session-start.js — duplicate work

**File:** `src/hooks/session-start.js:151-189`

**Issue:**
The hook dynamically imports `../logger.js` twice in the same hot path (once for `session.start`, once for the GSD-specific event when `session.gsd` is true). Each `import()` is cached by the loader so the cost is small, but the duplicated `createLogger(...).child(...)` boilerplate (~8 lines x 2) is also duplicated and harder to keep consistent. Both blocks already share the same configuration.

**Fix:**
Extract a single `try` block:

```js
try {
  const { createLogger } = await import('../logger.js');
  const events = await import('../logger-events.js');
  const log = createLogger({
    sessionId: session.session_id,
    minLevel: process.env.KODO_LOG_LEVEL || 'info',
  }).child({ component: 'hook', task_id: session.task_id });

  events.sessionStart(log, { /* ... */ });

  if (session.gsd) {
    if (session.phase_id) {
      events.gsdPhaseResolved(log, { phase_id: session.phase_id, match_heading: session.summary });
    } else {
      events.gsdBootstrap(log, { project_path: session.project_path });
    }
  }
} catch { /* silent */ }
```

### IN-03: Empty catch blocks lack `// silent on purpose` markers in two spots

**Files:**
- `src/hooks/stop.js:80` (`try { ... cmux.notify ... } catch {}`)
- `src/hooks/stop.js:125` (`try { ... orchestrator notify ... } catch {}`)

**Issue:**
The other silent-failure catches in this file have an explicit `// silent — never crash Claude Code` comment. These two do not, which makes them look like accidentally-swallowed errors rather than deliberate best-effort calls.

**Fix:**
Add the same comment for consistency. Cheap and improves greppability.

### IN-04: `STDIN_TIMEOUT` is duplicated across both hook files

**Files:**
- `src/hooks/session-start.js:12`
- `src/hooks/stop.js:22`

**Issue:**
Both files declare `const STDIN_TIMEOUT = 3000;` and reimplement `readStdin` identically. Drift here would be silent (one hook eventually waits longer than the other).

**Fix:**
Extract to `src/hooks/_stdin.js` (or similar) and import. Not urgent but low-risk.

### IN-05: `removeSession` typedef accepts a logger but `stop.js` does not pass one

**Files:**
- `src/session/state.js:101` (`removeSession(taskId, logger = noopLogger)`)
- `src/hooks/stop.js:112` (`removeSession(id);` — no logger)

**Issue:**
The structured-logging story added `logger` parameters to `addSession`/`removeSession`/`updateSession` so that state mutations can be observed. `stop.js` already constructs a child logger six lines earlier (line 88) but does not pass it to `removeSession`. Net: state.session.removed events are dropped on the floor for the Stop hook, defeating the LOG-12 plumbing for the most important transition.

**Fix:**
Pass the logger:

```js
removeSession(id, log);
```

Move the `log` declaration out of the inner `try` so it is in scope (or accept a no-op when the logger init failed).

---

_Reviewed: 2026-04-20T07:01:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
