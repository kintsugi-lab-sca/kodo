---
phase: 82-fix-de-la-carrera-de-steallock
reviewed: 2026-07-25T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/gsd/lock.js
  - test/gsd-lock-guard.test.js
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 82: Code Review Report

**Reviewed:** 2026-07-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Phase 82 rewrites `stealLock` in `src/gsd/lock.js` to close a double-acquisition
race, using an `O_EXCL`/`linkSync`-published steal-guard to serialize stealers and
an atomic `renameSync(tmp → lockPath)` to replace a stale lock without ever leaving
`lockPath` briefly-empty. The guard machinery, the "never break a live in-window
guard" rule, and the unparseable-guard-by-mtime defence are sound and well tested by
the six new cases in `test/gsd-lock-guard.test.js`.

However, the fix carries an **asymmetry that reopens the exact double-acquire the
phase set out to close**: the PRESENT-lock branch clobbers unconditionally with
`renameSync`, while the ABSENT-lock branch correctly uses `O_EXCL` + EEXIST re-check.
Because a fresh `acquireGsdLock` Case-1 creator does **not** take the steal-guard, a
live holder that releases mid-steal can be replaced by a fresh legitimate holder that
the stealer then overwrites — two processes believe they own the lock. Details in
CR-01. A misleading operational log (WR-01) and a guard-age edge case (WR-02) round
out the substantive findings.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `renameSync` replacement clobbers a fresh live holder created in the write→rename window (double-acquire reopened)

**File:** `src/gsd/lock.js:453-471`
**Issue:**
Inside the guarded critical section, the branch for a *present* stale/corrupt lock
unconditionally replaces it:

```js
if (existsSync(lockPath)) {
  const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(tmp, serializeLockContent(sessionInfo));
    renameSync(tmp, lockPath);   // <-- unconditional clobber
  } ...
  return { acquired: true };
}
```

The steal-guard serializes *stealers*, but a fresh `acquireGsdLock` Case-1 creator
(line 124-126) takes the O_EXCL path and **never touches the guard**. The comment at
line 456-457 ("No fresh Case-1 creator can race here — its O_EXCL create fails EEXIST
while any bytes are present") only holds while the stale bytes stay present. For an
alive holder (Case 3 TTL-expired, or Case 5 corrupt-but-written-by-a-live-process)
the following interleaving is reachable:

1. Stealer S wins the guard; reads lock at line 448 → still the stale holder A → not rejected.
2. `existsSync(lockPath)` → true (line 453).
3. Holder A (alive, TTL expired but still running) finishes and calls
   `releaseGsdLock` → unlinks `lockPath`.
4. Fresh process B runs `acquireGsdLock` Case-1 → `O_EXCL` create succeeds → B holds a
   fresh live lock and returns `{ acquired: true }`.
5. S executes `writeFileSync(tmp)` then `renameSync(tmp, lockPath)` → **overwrites B's
   live lock** and returns `{ acquired: true }`.

Both S and B now believe they hold the lock — the precise double-acquisition this
phase exists to prevent. The window (step 2 → step 5) spans a real filesystem write
(`writeFileSync(tmp)`), so it is milliseconds-wide, not a single syscall, and is
reachable under the load the phase's own stress harness simulates. The asymmetry is
telling: the ABSENT branch (line 475-483) defends against exactly this by using
`O_EXCL` and re-reading on EEXIST, but the PRESENT branch does not re-validate before
the destructive rename.

Note this is invisible to the N=5 race harness and the new guard tests because they
seed a *dead-PID* stale lock (`DEAD_PID`, `writeStaleDeadLock`); a dead holder never
reaches step 3, so the clobber window never opens in the tests. The regression only
manifests with a live holder that releases mid-steal.

**Fix:**
Re-validate immediately before the rename and reject/re-contend if a fresh live
holder appeared, rather than clobbering blind. Minimal mitigation:

```js
if (existsSync(lockPath)) {
  const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(tmp, serializeLockContent(sessionInfo));
    // Re-check under the guard, as close to the rename as possible: a live holder
    // may have been released + re-created by a non-guarded Case-1 creator.
    const recheck = readLockContent(lockPath);
    if (recheck && !isStaleLock(recheck)) {
      unlinkSync(tmp);
      return { acquired: false, holder: recheck };
    }
    renameSync(tmp, lockPath);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throw err;
  }
  return { acquired: true };
}
```

This narrows the window drastically but does not fully eliminate the TOCTOU (a live
holder could still appear between `readLockContent` and `renameSync`, since POSIX
`rename` cannot be made conditional). The root cause is that fresh Case-1 creators
bypass the guard; the fully robust fix is to route the Case-1 create through the same
guard (so *all* writers to `lockPath` are serialized), or to treat any observed
transition to a live holder as a hard reject. At minimum, document the residual
window and add a race-harness variant that seeds a **live** holder which releases
mid-steal, so this path is actually exercised.

## Warnings

### WR-01: `stealLock` logs "Lock stolen" before it is known whether the lock is stolen

**File:** `src/gsd/lock.js:425`
**Issue:**
`stealLock` unconditionally emits `console.error(\`[kodo:lock] Lock stolen: ${reason}\`)`
as its very first statement, before any guard contention or replacement. But
`stealLock` frequently returns `{ acquired: false, holder }` (line 441, 451, 481, 498,
505) — i.e. it did *not* steal. The new tests demonstrate this directly: cases (b) and
(e) both drive `stealLock` and assert `result.acquired === false`, yet the process
still prints `[kodo:lock] Lock stolen: ...`. Operators reading logs will see false
"stolen" events, undermining the log's diagnostic value for a concurrency feature
whose whole point is auditing contention. For the TTL path this is also a *duplicate*
message alongside the accurate one already logged at line 150-153.

**Fix:**
Move the log to the success paths only, so it reports what actually happened:

```js
function stealLock(lockPath, sessionInfo, reason) {
  mkdirSync(dirname(lockPath), { recursive: true });
  // ... on each `return { acquired: true }`:
  //   console.error(`[kodo:lock] Lock stolen: ${reason}`);
  //   return { acquired: true };
}
```

Or log the reject outcome distinctly (e.g. `[kodo:lock] Steal rejected: live holder`)
so success and rejection are not conflated.

### WR-02: Parseable guard with a live PID but non-finite `ts` is never breakable by age

**File:** `src/gsd/lock.js:345-348`
**Issue:**
```js
if (guard && Number.isFinite(guard.pid)) {
  if (!isPidAlive(guard.pid)) return true;
  return Number.isFinite(guard.ts) && Date.now() - guard.ts > thresholdMs;
}
```
If a guard parses with a finite `pid` but a missing/non-finite `ts`, the age check
short-circuits to `false`, so the guard is only ever breakable via the dead-PID
criterion. If that PID was recycled onto a live-but-unrelated process, the guard
becomes un-breakable indefinitely and permanently blocks all future steals — the very
"recycled PID" backstop the `STEAL_GUARD_STALE_MS` age bound was introduced to cover
(comment at line 60-65). Well-behaved writers always set `ts` (line 306), so this
requires a truncated/hand-seeded guard, but it is a silent permanent-stall failure
mode with no recovery short of manual deletion.

**Fix:**
Treat a parseable guard with a non-finite `ts` the same as an unparseable guard —
fall through to the mtime-based age check instead of returning `false`:

```js
if (guard && Number.isFinite(guard.pid)) {
  if (!isPidAlive(guard.pid)) return true;
  if (Number.isFinite(guard.ts)) return Date.now() - guard.ts > thresholdMs;
  // ts missing/garbage → fall through to file-age (mtime) backstop below.
}
```

## Info

### IN-01: Parsed lock/guard JSON is not validated as an object

**File:** `src/gsd/lock.js:103, 135, 246, 275`
**Issue:**
`readLock`, `readLockContent`, `readGuard`, and the inline parse at line 135 accept
any JSON that parses, including primitives (`JSON.parse('123')` → `123`,
`JSON.parse('null')` → `null`). Downstream, `existing.pid` becomes `undefined`,
`isPidAlive(undefined)` calls `process.kill(undefined, 0)` which throws a `TypeError`
(not an `ErrnoException`), and `e.code !== 'ESRCH'` evaluates truthy → the holder is
treated as "alive" and the caller is rejected against a garbage holder. No crash, but
a lock file containing a stray JSON primitive is neither stolen nor cleaned. This is
pre-existing behavior, not introduced by this phase.

**Fix:**
After parsing, verify shape before trusting it, e.g.
`const v = JSON.parse(...); return (v && typeof v === 'object') ? v : null;` in the
`readLockContent`/`readGuard` helpers.

### IN-02: Guard-reject test case (e) does not assert the returned holder shape

**File:** `test/gsd-lock-guard.test.js:203-215`
**Issue:**
Case (e) asserts `result.acquired === false` and inspects on-disk state, but never
asserts on `result.holder`. Given CR-01 concerns the correctness of the returned
`holder` under contention, an assertion that `result.holder.session_id === 'crashed'`
(the seeded stale owner) would tighten the contract the tests pin down. Low priority —
the on-disk assertions already cover most of the observable state.

**Fix:**
Add `assert.equal(result.holder.session_id, 'crashed');` alongside the existing
assertions in case (e), mirroring the on-disk `lock.session_id` check.

---

_Reviewed: 2026-07-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
