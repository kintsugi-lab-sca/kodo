---
phase: 52-createtask-contrato-anti-recursi-n
plan: 01
subsystem: dispatch
tags: [anti-recursion, labels, dispatcher, kodo-adopted, source-hygiene, tdd]

# Dependency graph
requires:
  - phase: 29-gsd-provider-reporting
    provides: "isGsdChild / KODO_LABEL_GSD_CHILD anti-recursion cut + REPORT-05 source-hygiene pattern mirrored here"
provides:
  - "KODO_LABEL_ADOPTED const ('kodo:adopted') + isAdopted(labels) helper in src/labels.js"
  - "isAdopted(task.labels) early cut in dispatcher.js returning {action:'ignored', code:'adopted'} before lock/resolver/launch, surviving --force"
  - "Truth-table, dispatcher behavior, ordering hygiene and no-inline-literal tests for the adopted marker"
affects: [52-02, 52-03, 53-adopt-session]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Anti-recursion early cut mirroring isGsdChild (label-marker guard before --force gate)"
    - "Single-source-of-truth label literal + helper with no-inline-literal source-hygiene"

key-files:
  created: []
  modified:
    - src/labels.js
    - src/triggers/dispatcher.js
    - test/labels.test.js
    - test/labels-hygiene.test.js
    - test/dispatcher.test.js

key-decisions:
  - "code:'adopted' chosen as the dispatcher ignore code (parallel to 'gsd_child')"
  - "isAdopted cut inserted as step 1c, immediately after isGsdChild (1b), before the force-skip block"

patterns-established:
  - "Anti-recursion marker guard: const + tolerant helper in labels.js, early cut in dispatcher before --force"
  - "Comment hygiene for static ordering tests: avoid the literal `if (!opts.force)` phrase in comments so `source.search(/if\\s*\\(!opts\\.force\\)/)` matches only the real block"

requirements-completed: [BIDIR-06]

# Metrics
duration: 4min
completed: 2026-06-16
---

# Phase 52 Plan 01: Anti-recursión (BIDIR-06) Summary

**`KODO_LABEL_ADOPTED` + `isAdopted` helper in labels.js plus a load-bearing `isAdopted(task.labels)` early cut in the dispatcher that drops `kodo:adopted` tasks with `{action:'ignored', code:'adopted'}` before lock/resolver/launch, surviving `--force`.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-16T08:40:43Z
- **Completed:** 2026-06-16T08:44:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 5

## Accomplishments
- `KODO_LABEL_ADOPTED = 'kodo:adopted'` + `isAdopted(labels)` helper in `src/labels.js` — byte-identical body to `isGsdChild` (tolerant of `string[]` and `{name}[]`, case-insensitive), `parseKodoLabels` left untouched (Pitfall 1).
- `isAdopted(task.labels)` early cut in `src/triggers/dispatcher.js` inserted as step `1c` — after the `isGsdChild` cut, before the force-skip block — returning `{action:'ignored', code:'adopted'}` so an adopted task is never re-dispatched, even under `--force`.
- Full test coverage: truth-table, dispatcher behavior (cut fires before lock/resolver/launch, survives `--force`, control `kodo:gsd` still reaches resolver), source-hygiene (no inline `'kodo:adopted'` outside `labels.js`, import assert, `filterIdx < forceIdx` ordering).

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 RED: failing isAdopted truth-table + hygiene tests** - `b8d57db` (test)
2. **Task 1 GREEN: KODO_LABEL_ADOPTED + isAdopted helper** - `c4d1cc7` (feat)
3. **Task 2 RED: failing isAdopted dispatcher cut + ordering tests** - `0521f80` (test)
4. **Task 2 GREEN: isAdopted anti-recursion cut in dispatcher** - `3929ff3` (feat)

_No REFACTOR commits: the helper body is byte-identical to `isGsdChild` and needed no cleanup._

## Files Created/Modified
- `src/labels.js` - Added `KODO_LABEL_ADOPTED` const + `isAdopted` helper (mirror of gsd-child block); `parseKodoLabels` unchanged.
- `src/triggers/dispatcher.js` - Extended import with `isAdopted`; inserted the `isAdopted` early cut (step 1c) before the force-skip block.
- `test/labels.test.js` - Extended import; added `BIDIR-06 — isAdopted + KODO_LABEL_ADOPTED` truth-table.
- `test/labels-hygiene.test.js` - Added `BIDIR-06` no-inline-literal + export asserts for the adopted marker.
- `test/dispatcher.test.js` - Added `BIDIR-06 — kodo:adopted anti-recursion filter` behavior block + `BIDIR-06 — dispatcher.js adopted source hygiene` block.

## Decisions Made
- `code: 'adopted'` for the dispatcher ignore result (Claude's discretion per CONTEXT.md, parallel to `'gsd_child'`).
- Inserted the cut as a labeled step `1c` immediately after `isGsdChild` (1b), keeping the two anti-recursion guards adjacent and both ahead of the `if (!opts.force)` gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded the dispatcher cut comment to avoid breaking the static ordering test**
- **Found during:** Task 2 GREEN (initial implementation)
- **Issue:** My JSDoc comment for the new cut contained the literal phrase `` `if (!opts.force)` ``. The ordering hygiene test computes `forceIdx = source.search(/if\s*\(!opts\.force\)/)` and asserts `filterIdx < forceIdx`. The regex matched the phrase inside my comment (which sits *above* the `isAdopted(task.labels)` call) instead of the real block, making `forceIdx` (4798) precede `filterIdx` (4830) and failing the test.
- **Fix:** Replaced the comment phrasing with "the force-skip block below" so the regex matches only the actual `if (!opts.force)` statement. The cut's physical placement was always correct (before the real force block); only the comment confused the static check.
- **Files modified:** src/triggers/dispatcher.js
- **Verification:** `node --test test/dispatcher.test.js` → 52/52 pass.
- **Committed in:** `3929ff3` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cosmetic comment fix to satisfy a correct static test. No behavior change, no scope creep.

## Issues Encountered
None beyond the deviation above. RED phases failed as expected; GREEN phases passed after implementation.

## Verification
- `node --test test/labels.test.js test/labels-hygiene.test.js test/dispatcher.test.js` → 100/100 pass.
- `npm test` (full suite) → 1333 pass, 0 fail, 1 skipped (pre-existing).
- `parseKodoLabels` diff: untouched (confirmed by no edit to `:12-38`).

## Known Stubs
None.

## Threat Flags
None. The change is a pure additive anti-recursion guard mirroring an existing precedent; no new network endpoints, auth paths, or schema changes introduced.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `isAdopted` guard is ready for Plans 02/03, which apply the `kodo:adopted` marker via `createTask` and MUST import `KODO_LABEL_ADOPTED` (not inline the literal — enforced by the hygiene test that scans all of `src/`).
- The dispatcher now suppresses adopted tasks even under `--force`; Phase 53 (`adoptSession`) can rely on this invariant.

## TDD Gate Compliance
Both tasks followed RED → GREEN: `test(...)` commit precedes `feat(...)` commit for each task (`b8d57db`→`c4d1cc7`, `0521f80`→`3929ff3`). No REFACTOR needed (helper body byte-identical to `isGsdChild`).

## Self-Check: PASSED
- `52-01-SUMMARY.md` exists ✓
- Commits `b8d57db`, `c4d1cc7`, `0521f80`, `3929ff3` exist ✓

---
*Phase: 52-createtask-contrato-anti-recursi-n*
*Completed: 2026-06-16*
