# Deferred Items — Phase 03 Consumer Rewiring

Items discovered during execution that are **out of scope** for the current plan.

## Deferred during 03-02 execution (2026-04-10)

### Pre-existing 03-01 RED test failures

**File:** `test/check.test.js` (and possibly `test/session-start.test.js`)

**Failure:** `SyntaxError: The requested module '../src/check.js' does not provide an export named 'checkPendingTasks'`

**Context:** Plan 03-01 has a committed RED test (`test(03-01): add failing tests for check.js TaskProvider rewiring`) but the GREEN implementation was never applied — plan 03-01 has no SUMMARY and was skipped to execute 03-02 first.

**Scope:** This is not caused by 03-02 changes (stop.js / manager.js). It belongs to plan 03-01 and must be resolved when that plan is executed.

**Action:** Will be fixed when plan 03-01 is executed (implementing `checkPendingTasks` in `src/check.js`).
