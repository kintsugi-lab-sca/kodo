---
phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
reviewed: 2026-07-06T12:47:57Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - src/session/state-lock.js
  - src/gsd/lock.js
  - src/session/state.js
  - src/session/reconcile.js
  - src/session/manager.js
  - src/daemon/run.js
  - src/daemon/lifecycle.js
  - src/config.js
  - src/triggers/dispatcher.js
  - src/gsd/doctor.js
findings:
  blocker: 1
  warning: 3
  info: 5
  total: 9
status: clean
resolution:
  fixed: [CR-01, WR-01, WR-02, WR-03, IN-01]
  deferred: [IN-02, IN-03, IN-04, IN-05]
  fixed_at: 2026-07-06T13:05:00Z
---

# Phase 70: Code Review Report

**Reviewed:** 2026-07-06T12:47:57Z
**Depth:** deep
**Files Reviewed:** 10
**Status:** resolved

## Resolution (2026-07-06)

- **CR-01 (fixed):** stale-lock steal made atomic via compare-and-swap
  (move-aside rename + ABA guard + O_EXCL create) in `src/gsd/lock.js` and the
  `src/session/state-lock.js` mirror. Real 2/5-process dead-holder steal race
  tests added (`test/gsd-lock-race.test.js`,
  `test/state/state-lock-concurrency.test.js`) asserting exactly one acquire.
- **WR-01 (fixed):** `addSession`/`removeSession`/`updateSession` now return the
  `{ok}` lock result and gate success telemetry on it; `markSessionStatus`
  returns `{ok:false, reason:'lock-timeout'}` and `launchWorkItem` aborts before
  `cmux.send` on a dropped write.
- **WR-02 (fixed):** dedup lock TTL raised to `120_000` ms (retries:0 kept) so an
  in-flight `launchWorkItem` is never TTL-stolen into a double-launch.
- **WR-03 (fixed):** `stopDaemon` no longer removes the PID file or reports
  `stopped:true` when SIGKILL was skipped (unverifiable/mismatch-but-alive);
  returns `{ok:false, stillAlive:true}` and the stop CLI surfaces it + exits
  non-zero.
- **IN-01 (fixed):** subsumed by the CR-01 rewrite — the state-lock steal path no
  longer writes a leakable `.steal.*` tmp; the moved-aside file is cleaned or
  restored in every branch.
- **IN-02 / IN-03 / IN-04 / IN-05 (deferred):** intentionally out of scope for
  this fix pass. IN-02 is a documented design choice (synchronous mutators);
  IN-03's precondition is largely removed by CR-01 and an mtime-gated change is
  speculative; IN-04 is pre-Phase-70 (Phase 38) migration code with a one-time
  idempotent window; IN-05 would widen the cross-process concurrency surface
  (new lock on the relaunch lane) beyond this pass. Each is a candidate for a
  follow-up.

## Summary

Phase 70 hardens the concurrency/process-lifecycle surface: an advisory-lock
primitive (`state-lock.js`), an atomic-create GSD lock (`gsd/lock.js`),
`withStateLock` around the three state mutators, a snapshot-outside/apply-inside
reconcile refactor, an `alive`-aware `max_parallel` gate, PID-ownership teardown,
anti-PID-reuse before SIGKILL, atomic config migration, and a per-`task_id`
cross-process dispatch dedup lock.

Most of the phase's stated goals are correctly implemented and I verified the
hardest invariants directly: the reconcile loop does **not** hold the state lock
across `host.listWorkspaces()`/`pgrep` (Pitfall 1 respected — the `runLocked`
callback is synchronous and the I/O runs before it); `reconcileTick` remains the
**sole writer** of `alive` (`isSchedulable` and `doctor.js` only read it); the
pre-bind PID write in `run.js` is intact (66-07 not regressed); teardown deletes
`kodo.pid` only when `payload.pid === selfPid`; `processStartMatches` forces
`LC_ALL=C` and SIGKILLs **only** on a confirmed `verifiable && match`; and the
non-GSD dedup lock never touches `acquireGsdLock` (WT-03 intact). Config
migration and PID writes are atomic (tmp+rename).

However, the central mutual-exclusion primitive has an untested hole in its
**stale-lock steal path**, and the state mutators discard the lock's fail-safe
result. The tests deliberately keep lock winners alive (`--hold`), so the
concurrent-steal branch is never exercised. Details below.

## Blockers

### CR-01: Stale-lock steal is not atomic — two concurrent stealers both "acquire" (GSD lane: two sessions on one repo)

**File:** `src/gsd/lock.js:237-258` (`stealLock`); mirrored in `src/session/state-lock.js:91-103` (steal branch of `acquireLock`)

**Issue:** The create path was correctly made atomic with `flag:'wx'` (O_EXCL), and the comment claims this "closes the TOCTOU that let two processes both create and win." But the **steal** path is a plain `writeFileSync(tmp); renameSync(tmp, lockPath)` with no atomic guard — `renameSync` replaces unconditionally (last-writer-wins). When the existing lock is provably stale (dead PID, or TTL exceeded), two processes that hit `EEXIST` concurrently will **both** read the same stale lock, **both** decide `steal`, and **both** rename their own content over `lockPath`, each returning `{ acquired: true }` / `{ token }`.

Concrete failure scenario (GSD lane): a GSD session crashes and leaves `.planning/.kodo.lock` with a now-dead PID. Two webhooks for two different tasks on the same repo arrive in the same tick. Both call `acquireGsdLock` → both `EEXIST` → both see `isPidAlive(deadPid) === false` → both `stealLock` → both `acquired:true`. Two GSD agents now run on the same repository simultaneously (concurrent `git`/worktree operations) — the exact per-repo mutual exclusion the lock exists to guarantee. The dead-PID case makes the lock **immediately** stealable (no TTL wait), so the window is not throttled by the 4h TTL.

For `state-lock.js` the same double-steal degrades state.json coordination back to unsynchronized last-write-wins during the stale window (see WR-01 for the compounding effect).

The gating is correct (steal only when dead-PID OR TTL), but the *atomicity of the steal itself* under concurrency is missing. The test helper (`test/helpers/lock-race-child.mjs:36,229`) explicitly keeps winners alive to avoid this branch, so it is uncovered.

**Fix:** Make the steal a compare-and-swap: only replace the lock if it is *still* the same stale bytes we inspected. E.g. re-create under `O_EXCL` after removing the stale file, and treat a losing `EEXIST` as "someone else won — re-read and reject":
```js
function stealLock(lockPath, sessionInfo, reason) {
  console.error(`[kodo:lock] Lock stolen: ${reason}`);
  // Atomic hand-off: remove the stale lock, then O_EXCL-create ours. If a
  // concurrent stealer already re-created it, our create loses with EEXIST and
  // we re-read + reject instead of blindly overwriting a fresh winner.
  try { unlinkSync(lockPath); } catch { /* already gone — someone raced us */ }
  try {
    writeFileSync(lockPath, serializeLockContent(sessionInfo), { flag: 'wx' });
    return { acquired: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const holder = JSON.parse(readFileSync(lockPath, 'utf-8'));
    return { acquired: false, holder };
  }
}
```
Apply the same O_EXCL-recreate pattern to `state-lock.js` `acquireLock`'s steal branch (fall through to backoff/retry on a losing `EEXIST` instead of `return { token }`).

## Warnings

### WR-01: State mutators discard the lock's `{ok:false}` fail-safe — writes silently dropped while telemetry reports success

**File:** `src/session/state.js:330-338` (`addSession`), `344-358` (`removeSession`), `371-385` (`updateSession`); consumer `src/session/manager.js:405-454` (`markSessionStatus`)

**Issue:** `withStateLock`/`runUnderStateLock` return `{ ok:false, reason:'lock-timeout' }` on acquire exhaustion — the whole point of the fail-safe is that callers can react. But every mutator ignores the return value:

- `addSession` calls `withStateLock(...)` then `logger.info('state.session.added', ...)` **unconditionally**. On a lock-timeout the session is **not persisted**, yet the log claims it was and no error propagates. In `launchWorkItem` (`manager.js:294`) this means the session record is missing but `cmux.send` still fires (`manager.js:297`) → an orphaned running Claude session with no state entry, undercounting the `max_parallel` gate and enabling duplicate launches.
- `removeSession` likewise logs `state.session.removed` unconditionally even when nothing was persisted.
- `updateSession`/`markSessionStatus` drop the update silently on timeout; `markSessionStatus` still returns `{ ok:true, from, to }`, so callers believe the status transition succeeded.

Lock-timeout is reachable under real cross-process contention on `state.json.lock` (default `retries:8 × backoffMs:20 ≈ 160ms` budget).

**Fix:** Return/propagate the lock result and gate the telemetry on it. Minimal:
```js
export function addSession(taskId, session, logger = noopLogger) {
  const r = withStateLock((state) => { state.sessions[taskId] = session; });
  if (!r.ok) { logger.warn('state.session.add_failed', { task_id: taskId, reason: r.reason }); return r; }
  logger.info('state.session.added', { task_id: taskId, status: session.status });
  return r;
}
```
At minimum, do not emit `*.added`/`*.removed` success events when `r.ok === false`, and let `launchWorkItem` surface the failure before `cmux.send`.

### WR-02: Non-GSD dedup lock TTL (10s default) is shorter than the operation it guards — a duplicate can steal-on-TTL and double-launch

**File:** `src/triggers/dispatcher.js:449-457` (acquire) and `493-501` (release); TTL default at `src/session/state-lock.js:36`

**Issue:** The per-`task_id` dedup lock is acquired with `acquireLockFn(dispatchLockPath, { retries: 0 })` — no `ttlMs` override, so it inherits `DEFAULT_TTL_MS = 10_000`. The lock is then held across `await launchWorkItemFn(...)` (dispatcher:479) and only released in the `finally`. `launchWorkItem` performs several network + cmux round-trips (`provider.init`, `getTask`, `updateTaskState`, `newWorkspace`, `setColor`, `send`, `notify`, `listWorkspaces`) and can plausibly exceed 10s on a slow provider/host.

Because `retries:0` still runs one iteration, a second process arriving after 10s hits `EEXIST`, evaluates `Date.now() - acquired_at > 10000` on the still-live holder → `stale = true` → **steals** the dedup lock and launches a duplicate session for the same `task_id`. The dedup guarantee silently evaporates for any launch slower than the TTL.

**Fix:** Give the dedup lock a TTL that comfortably exceeds the worst-case `launchWorkItem` duration (and ideally refresh it), e.g.:
```js
const held = acquireLockFn(dispatchLockPath, { retries: 0, ttlMs: 120_000 });
```
Pick a value bounded by, but larger than, the launch timeout so a genuinely-crashed holder is still eventually reclaimable.

### WR-03: `stopDaemon` reports `stopped:true` and removes the PID file even when it did not kill the process

**File:** `src/daemon/lifecycle.js:269-284`

**Issue:** When the process is still alive after the 5s SIGTERM wait and the anti-PID-reuse check returns `!verifiable` (e.g. `ps` unavailable/NaN) or `verifiable && !match`, the code correctly **skips** SIGKILL and warns — good, no innocent is killed. But it then unconditionally falls through to `removePid(name)` and returns `{ ok:true, stopped:true, pid }`. In the `!verifiable` case where the daemon is in fact still our live daemon (only `ps` is missing), this deletes the PID file out from under a running daemon and reports success. A subsequent `kodo up` / `statusDaemon` sees no PID file → reports `idle` and can spawn a **second** daemon, defeating single-owner.

`ps` is essentially always present on macOS/Linux, so the practical exposure is low, but the "removed PID + stopped:true" outcome is inconsistent with "we did not actually stop it."

**Fix:** Only `removePid` + `stopped:true` when the process is confirmed gone. On the unverifiable-but-still-alive branch, leave the PID file and report a distinct outcome:
```js
if (isAlive(payload.pid)) {
  const chk = processStartMatches(payload.pid, payload.started_at, { _exec: deps._exec });
  if (chk.verifiable && chk.match) {
    try { kill(payload.pid, 'SIGKILL'); } catch {}
    removePid(name);
    return { ok: true, stopped: true, pid: payload.pid };
  }
  warn(chk.verifiable ? 'daemon.sigkill.aborted' : 'daemon.sigkill.unverifiable', { pid: payload.pid });
  return { ok: false, stillAlive: true, pid: payload.pid }; // do NOT remove the PID file
}
removePid(name);
return { ok: true, stopped: true, pid: payload.pid };
```

## Info

### IN-01: `state-lock.js` steal path leaks the `.steal.*` tmp file on write/rename error

**File:** `src/session/state-lock.js:96-103`

**Issue:** In `acquireLock`'s steal branch, if `writeFileSync(tmp, ...)` or `renameSync(tmp, lockPath)` throws, control lands in the inner `catch {}` ("Unparseable/partial lock — retry") and the tmp file is never removed. `gsd/lock.js` `stealLock` correctly cleans up its tmp on error (`lock.js:249-256`); `state-lock.js` does not, so repeated failures accumulate `*.steal.*` residue next to the lock. **Fix:** wrap the steal write/rename in a `try/catch` that `unlinkSync(tmp)` best-effort before falling through.

### IN-02: `sleepSync` blocks the Node event loop during lock backoff

**File:** `src/session/state-lock.js:45-48`, used at `105`

**Issue:** `Atomics.wait` on the main thread halts the entire single-threaded event loop for the backoff duration (up to `retries × backoffMs ≈ 160ms` for the state lock under contention). Inside the server process this stalls webhook handling and `/health` responses while a mutator waits. It is a deliberate design choice (synchronous mutators), and performance is out of v1 scope, but the whole-loop stall is a robustness footgun worth documenting. **Fix (optional):** cap the total synchronous backoff budget, or note the constraint so no long-TTL/high-retry lock is ever run on the server's main thread.

### IN-03: `releaseLock` deletes any corrupt/partial lock, including another owner's mid-write lock

**File:** `src/session/state-lock.js:122-139`

**Issue:** On a `JSON.parse` failure the corrupt branch `unlinkSync(lockPath)` regardless of ownership. Combined with CR-01's double-ownership window, a non-owner's `releaseLock` racing a legitimate winner's create (the `wx` create writes bytes after O_CREAT, so a reader can observe a 0-byte file) would delete the winner's fresh lock. Fixing CR-01 largely removes the double-ownership precondition; independently, consider not unlinking on unparseable content unless the file is also stale by mtime.

### IN-04: `migrateStateIfNeeded` writes `state.json` non-atomically and outside the state lock

**File:** `src/session/state.js:214-252` (invoked by `loadState` at `256`)

**Issue:** The v2→v3 migration persists via a direct `writeFileSync(STATE_PATH, ...)` (not the tmp+rename `saveState`), and `loadState` is called from un-locked read paths (`getSession`, `listSessions`, `findSession`, `listHistory`). Two processes first-loading a v2 file could both migrate and both write `state.json` non-atomically → a torn/racy write. This predates Phase 70 (from Phase 38) and the window is one-time (idempotent once v3), but it is inconsistent with the phase's atomicity goal now that `saveState` (WR-02 of Phase 69) and config migration were made atomic. **Fix:** route the migration write through the tmp+rename helper, and ideally perform migration under `runUnderStateLock`.

### IN-05: Cross-process dedup lock is absent on the stale-relaunch path

**File:** `src/triggers/dispatcher.js:389-432`

**Issue:** The per-`task_id` file lock (step 5) guards only the fresh-launch lane. The stale-session relaunch lane (`if (existing)`) relies solely on the in-process `inFlight` set (`dispatcher.js:390`), so two *separate* processes both detecting the same stale session could both relaunch it. Narrower than the primary lane (requires a matching stale session record in both), but it is a gap in the cross-process dedup coverage the phase set out to close. **Fix:** acquire the same `dispatch-${task.id}.lock` (retries:0) around the relaunch branch, releasing it in that branch's `finally`.

---

_Reviewed: 2026-07-06T12:47:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
