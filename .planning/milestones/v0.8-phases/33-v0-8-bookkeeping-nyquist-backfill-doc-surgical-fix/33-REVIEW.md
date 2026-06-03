---
phase: 33-v0-8-bookkeeping-nyquist-backfill-doc-surgical-fix
reviewed: 2026-05-25T07:40:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/gsd/verify.js
  - src/hooks/stop.js
  - test/gsd-verify-integration.test.js
  - test/stop.test.js
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: issues_found
---

# Phase 33: Code Review Report

**Reviewed:** 2026-05-25T07:40:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Adversarial review of the Phase 33-03 surgical robustness fix. The diff (base `308cd42..HEAD`) is exactly as scoped: the two callsites of `markSessionStatus` (`verify.js` finalize pass branch, `stop.js` runStopHook cleanup) now capture the discriminated-union return `{ok, reason}` and emit `log.warn('markSessionStatus.skipped', {reason, session_id})` when `!result?.ok`, each inside its pre-existing try/catch. `markSessionStatus` itself (`src/session/manager.js`) is unmodified.

I verified the load-bearing dependency that the entire fix hinges on: `markSessionStatus` (manager.js:366-397) returns `{ok: true, from, to}` on success and `{ok: false, reason: 'missing-task-id'}` on a falsy `taskId`, and the falsy path early-returns at line 383 **before** any `updateSession`/`writeFileSync` — so it is genuinely non-throwing in that branch, validating the comment claim "el warn no dispara el catch." The optional chaining (`result?.ok`, `result?.reason`) correctly defends against mocks returning `undefined`. The production logger (`src/logger.js`) exposes `warn`.

All 35 tests across the two files pass. The new tests force `ok:false` via `task_id: ''` (real falsy-guard short-circuit, no state.json write) and assert the `markSessionStatus.skipped` warn payload; the no-regression `ok:true` tests confirm the happy path is unchanged. Test isolation is sound (stop.test.js overrides HOME to a tmpdir and registers a real session).

No BLOCKER or WARNING-level defects found. The two findings below are low-severity readability/robustness observations only — they do not affect correctness and do not gate shipping.

## Info

### IN-01: Variable shadowing — `result` reused for two semantically distinct values in `runStopHook`

**File:** `src/hooks/stop.js:132` and `src/hooks/stop.js:202`
**Issue:** `runStopHook` declares `let result = findSessionFn(...)` at line 132 (the session-lookup result, destructured into `{ id, session }` at line 156). The Phase 33-03 change introduces a second `const result = markSessionStatus(...)` at line 202, block-scoped to the `try {}` (lines 195-208). There is no functional bug — the outer `result` is fully consumed by line 156 and never read after the inner block — but the same identifier name carrying two unrelated meanings inside one function is a readability hazard that invites future misreads (e.g. someone moving the warn block upward and silently capturing the wrong `result`).
**Fix:** Rename the inner binding to disambiguate, e.g.:
```js
const markResult = markSessionStatus(session.task_id, 'done', 'session-stop', log, session.session_id);
if (!markResult?.ok) {
  log.warn('markSessionStatus.skipped', {
    reason: markResult?.reason,
    session_id: session.session_id,
  });
}
```
(verify.js does not have this collision — its `result` is the only binding by that name in `finalize`, so the rename is optional there for symmetry only.)

### IN-02: `markSessionStatus.skipped` warn duplicates the warn already emitted inside `markSessionStatus`

**File:** `src/gsd/verify.js:276-279` and `src/hooks/stop.js:204-207`
**Issue:** On the `ok:false` (missing-task-id) path, `markSessionStatus` already emits its own observable warn `'markSessionStatus: missing task_id'` with `{session_id, status, reason}` (manager.js:377-381) when a logger is passed — and both callsites do pass `log`. The new callsite-level `'markSessionStatus.skipped'` warn therefore produces a **second** warn for the same event, with overlapping fields (`reason` here is the union discriminator `'missing-task-id'`, whereas the inner warn's `reason` is the caller-supplied `'gate-passed'`/`'session-stop'` — same key, different meaning across the two log lines). This is harmless (both are fail-open observability) but means each skip now logs twice with a `reason` field that means different things in each line, which can confuse log-grep/alerting.
**Fix:** Optional. Either accept the redundancy (it is intentional per the plan's "observable warn + continue" symmetry goal), or rename the callsite field to avoid the `reason` key collision against the inner warn, e.g. `{ skipped_reason: result?.reason, session_id: ... }`. No action required for correctness.

---

_Reviewed: 2026-05-25T07:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
