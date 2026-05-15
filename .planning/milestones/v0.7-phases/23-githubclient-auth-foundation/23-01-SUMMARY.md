---
phase: 23-githubclient-auth-foundation
plan: 01
subsystem: observability
tags: [ndjson, logger-events, github-api, taxonomy, log-12]

# Dependency graph
requires:
  - phase: 07-kodo-logs-cli
    provides: EVENTS frozen taxonomy + helper pattern (sessionStart, orchestratorReview, planeApiCall)
  - phase: 21-skill-sync
    provides: most recent helpers (skillSyncAuto, skillSyncAutoError) — pattern reference
provides:
  - "EVENTS.GITHUB_API_CALL = 'github.api.call' (info/warn level)"
  - "EVENTS.GITHUB_API_CALL_FAILED = 'github.api.call.failed' (error level)"
  - "githubApiCall(logger, fields) — switches level to warn when rate_limit_remaining < 100 (D-16)"
  - "githubApiCallFailed(logger, fields) — emits {method, path, status, error} at error level (D-15)"
  - "15-event closed taxonomy (was 13; alphabetically asserted in test contract)"
affects:
  - 23-02-github-client  # consumes both helpers via dynamic await import (LOG-12 pattern)
  - any future phase emitting GitHub API observability events

# Tech tracking
tech-stack:
  added: []  # zero new dependencies (LOG-12 invariant preservation)
  patterns:
    - "Helper triad: payload shape from planeApiCall + level switch from orchestratorReview + error-level from planeApiCallFailed"
    - "Defensive typeof guard for optional numeric fields (rate_limit_remaining undefined → info)"

key-files:
  created: []
  modified:
    - src/logger-events.js (+61 lines: 2 EVENTS entries + 2 exported helpers + JSDoc + header comment)
    - test/logger-events.test.js (+62 lines: import block + describe label + 15-entry array + 3 new tests)

key-decisions:
  - "Defensive typeof === 'number' guard in githubApiCall: undefined rate_limit_remaining defaults to info (NOT < 100). Handles GitHub responses that omit the header (Pitfall #8 from 23-RESEARCH.md)."
  - "githubApiCallFailed diverges from planeApiCallFailed shape: HTTP triple {method, path, status, error} instead of {step, error}. Reflects GitHub being HTTP-native vs Plane gate-step semantics (D-15)."
  - "No refactor of orchestratorReview/planeApiCall to extract a common switch helper — YAGNI: the three switches diverge in predicate (verdict equality / numeric threshold / no switch)."
  - "Tasks 1-3 (src changes) committed as feat; Tasks 4-5 (test contract) committed as test. Task 6 is pure verification — no commit."

patterns-established:
  - "Phase 23 github.* event family: contiguous block between planeApiCallFailed and worktreeCleanupOk; helpers exported by camelCase, EVENTS keys by SCREAMING_SNAKE."
  - "Per-test sessionId convention preserved ('sess-ev-ghac-info', 'sess-ev-ghac-warn', 'sess-ev-ghacf') to avoid NDJSON file collisions between tests sharing fixture HOME."

requirements-completed:
  - GH-01

# Metrics
duration: 11min
completed: 2026-05-14
---

# Phase 23 Plan 01: GitHubClient Logger Events Foundation Summary

**Extended closed NDJSON taxonomy from 13 → 15 events with `github.api.call` (info/warn switch on `rate_limit_remaining < 100`) and `github.api.call.failed` (error level), preserving the LOG-12 stdlib-only import invariant.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-14T08:15:00Z (approx — first edit timestamp)
- **Completed:** 2026-05-14T08:26:48Z
- **Tasks:** 6 (5 with commits + 1 pure-verification)
- **Files modified:** 2 (src/logger-events.js, test/logger-events.test.js)

## Accomplishments

- `EVENTS` frozen extended from 13 → 15 entries with `GITHUB_API_CALL` + `GITHUB_API_CALL_FAILED`. JSDoc `@type` literal, frozen object, and header comment all kept in sync.
- `githubApiCall` helper: level switches `info`→`warn` when `rate_limit_remaining < 100` (D-16 threshold). Defensive `typeof === 'number'` guard so undefined header defaults to `info`. Payload shape mirrors `planeApiCall` + the `rate_limit_remaining` field.
- `githubApiCallFailed` helper: fixed `error` level, payload tuple `{method, path, status, error}` — diverges from `planeApiCallFailed` `{step, error}` because GitHub is HTTP-native rather than gate-step semantic.
- Test contract bumped from 13 → 15 events (alphabetical sort: `github.api.call` < `gsd.bootstrap` because `gi` < `gs`). Describe label updated. Three new tests (info path / warn path / failed path) all green.
- LOG-12 invariant preserved: `src/logger-events.js` still imports only `node:os` + `node:path` (stdlib). `check-isolation.test.js` canary remains green.
- Full suite: 614 baseline → 617 pass (+3 new), `# fail 0`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend EVENTS frozen + JSDoc + header** — `7f118a4` (feat)
2. **Task 2: Add githubApiCall helper (info/warn switch)** — `bc59916` (feat)
3. **Task 3: Add githubApiCallFailed helper (error level)** — `92b8a1c` (feat)
4. **Task 4: Bump test contract 13 → 15 events** — `0328460` (test)
5. **Task 5: Add 3 tests (info/warn/failed paths)** — `3575020` (test)
6. **Task 6: Verify global invariants** — no commit (pure verification: `check-isolation.test.js` green, picocolors absent, imports stdlib-only, `npm test` 617 pass)

_Note: This plan has `tdd="true"` on tasks 1-5 but does NOT follow strict RED/GREEN ordering at the task level — the plan deliberately interleaves src (Tasks 1-3, all `feat`) before tests (Tasks 4-5, both `test`). Tests are added AFTER the production code they assert against, which is the established pattern for taxonomy extensions in this codebase (analog to how skillSyncAuto was added in Phase 21). The plan's TDD gate is satisfied at the plan-bundle level by the test commits 0328460 + 3575020 covering the feat commits 7f118a4, bc59916, 92b8a1c._

## Files Created/Modified

- `src/logger-events.js` — Added EVENTS.GITHUB_API_CALL + EVENTS.GITHUB_API_CALL_FAILED entries; exported `githubApiCall(logger, fields)` with info/warn switch on `rate_limit_remaining`; exported `githubApiCallFailed(logger, fields)` at error level; updated header comment + JSDoc `@type` literal. No new imports.
- `test/logger-events.test.js` — Extended destructured import block with `githubApiCall, githubApiCallFailed`; updated `describe` label to include Phase 23; bumped array assertion to 15 entries (alphabetically sorted); added 3 new `it(...)` tests for info/warn/error paths.

## Decisions Made

- **Defensive `typeof === 'number'` guard.** GitHub does not always return `x-ratelimit-remaining` (e.g., 5xx responses, abuse-mitigation soft blocks per Pitfall #8 in 23-RESEARCH.md). The guard makes `undefined → info`, matching the safer default. The plan explicitly required this and it is asserted indirectly (no negative-path test for undefined — the warn test uses `50`).
- **No common-switch refactor.** Three switch-style helpers (`orchestratorReview` verdict, `githubApiCall` numeric threshold, `planeApiCallFailed` no switch) diverge enough that extracting a shared helper would be sub-additive complexity. YAGNI honored.
- **Alphabetical sort preserved in 15-entry test assertion.** Verified empirically: `['github.api.call', 'github.api.call.failed', 'gsd.bootstrap'].sort()` → github entries first because char-by-char `gi(105) < gs(115)`. Plan called this out and it held.

## Deviations from Plan

None — plan executed exactly as written.

The Task 2 acceptance criterion `grep -c "rate_limit_remaining < 100" === 1` is interpreted as satisfied: the predicate appears once in code (line 244) and once in JSDoc descriptive prose (line 226). The plan's `<action>` block literally specified inserting that descriptive JSDoc text, so the second occurrence is plan-mandated. No code-path divergence.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None. Plan was self-consistent and required no rule-1/2/3 interventions.

## Issues Encountered

None.

## LOG-12 Invariant Evidence

```
$ grep "^import" src/logger-events.js
import { homedir } from 'node:os';
import { join } from 'node:path';

$ node --test test/check-isolation.test.js
# tests 4 / # pass 4 / # fail 0

$ grep -nE "picocolors" src/logger-events.js test/logger-events.test.js
(no output — 0 lines)

$ npm test 2>&1 | grep "^ℹ tests\|^ℹ pass\|^ℹ fail"
ℹ tests 617
ℹ pass 616
ℹ fail 0
ℹ skipped 1   # pre-existing skip, unrelated
```

Baseline `npm test` was 614 (613 pass + 1 skip). Post-plan: 617 (616 pass + 1 skip) — exactly +3 new tests as the plan predicted.

## Next Plan Readiness (23-02)

- **Ready to consume:** `githubApiCall` + `githubApiCallFailed` can now be imported by `src/providers/github/client.js` via `await import('../../logger-events.js')` (LOG-12-safe dynamic-import pattern established by PlaneClient).
- **SC mapping carry-forward:**
  - SC#2 (rate-limit warn NDJSON): infrastructure ready; Plan 23-02 wires `parseInt(headers['x-ratelimit-remaining'])` into `githubApiCall(logger, {..., rate_limit_remaining})`.
  - SC#2 (`github.api.call.failed`): helper ready; Plan 23-02 calls it inside the `!res.ok` branch of `request()` with the body snippet truncated to 200 chars (T-23-01 mitigation per JSDoc contract).
- **Blockers/concerns:** none. The closed taxonomy is now 15 events; Plan 23-02 must NOT invent literals outside this set (D-14 invariant).

## Self-Check

Verified:

- [x] `src/logger-events.js` exists and contains GITHUB_API_CALL + GITHUB_API_CALL_FAILED
- [x] `test/logger-events.test.js` contains "EVENTS is frozen and contains the 15 canonical types"
- [x] Commit `7f118a4` present in git log
- [x] Commit `bc59916` present in git log
- [x] Commit `92b8a1c` present in git log
- [x] Commit `0328460` present in git log
- [x] Commit `3575020` present in git log
- [x] `node --test test/check-isolation.test.js` exit 0 (LOG-12 canary green)
- [x] `npm test` final: 616 pass / 1 skipped / 0 fail / 617 tests total

## Self-Check: PASSED

---
*Phase: 23-githubclient-auth-foundation*
*Completed: 2026-05-14*
