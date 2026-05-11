---
phase: 17-phase-7-uat-automation
plan: 03
subsystem: testing
tags: [uat, integration-test, session-of, resolver, exit-codes, spawnsync, ndjson, home-isolation]

# Dependency graph
requires:
  - phase: v0.3 Phase 7
    provides: "kodo logs --session-of resolver (two-step state.json → head-line scan) with deterministic exit codes (LOG-11)"
  - phase: v0.5 Phase 16
    provides: "CR-02 mkdtempSync + HOME override + dynamic-import-of-state.js pattern (test/stop-state-transition.test.js)"
provides:
  - "Programmatic E2E coverage of UAT-03 SC#3 (4 D-12 scenarios) replacing the human UAT in 07-HUMAN-UAT.md test #3"
  - "Reusable spawnSync(bin/kodo, --session-of) helper pattern with HOME-isolated tmpdir for child processes"
  - "Documented exit-code contract for the four resolver outcomes (D-13: discovered from current CLI behaviour, not redesigned)"
affects: [phase-17-04, phase-17-05, future-uat-automation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "spawnSync(bin/kodo, ['logs', '--session-of', taskId], { env: { ...process.env, HOME: tmpHome }, timeout: 5000 }) — synchronous request/response E2E pattern, no streaming overhead"
    - "Per-test fixture isolation via afterEach reset of state.json + rmSync logs/ — multiple scenarios share a single mkdtempSync without cross-pollution"

key-files:
  created:
    - test/session-of-resolver.test.js
  modified: []

key-decisions:
  - "D-13 closure: missing-log scenario confirmed exit code 1 with stderr 'No log file at <sessionId>.ndjson' from src/logs/reader.js:113-116 (existsSync guard + process.exit(1)). No CLI redesign required."
  - "spawnSync over spawn: 4 scenarios are request/response with 5s timeout cap; sync is simpler and equally deterministic."
  - "Body line seeded as event=log.line, msg='body-<sessionId>' to provide a regex-stable substring in stdout that survives formatLine non-TTY branch (src/logger.js:101-113)."

patterns-established:
  - "Subprocess UAT pattern: dynamic import of src/session/state.js POST-HOME so addSession() in the runner writes to <tmpHome>/.kodo/state.json (which the spawned bin/kodo also reads via HOME override). Both processes share the tmpdir via the same env var — no shared module cache needed."
  - "Negative-assertion guard for D-14 (multi-match out of scope): each test seeds at most one log file with a given task_id; the file makes the contract explicit so a future multi-match implementer reading the test cannot accidentally regress."

requirements-completed: [UAT-03]

# Metrics
duration: ~6min
completed: 2026-05-10
---

# Phase 17 Plan 03: UAT-03 --session-of E2E Automation Summary

**Integration test that spawns `bin/kodo logs --session-of <task-id>` against a HOME-isolated tmpdir + synthetic `state.json` and `logs/*.ndjson`, asserting the four D-12 exit-code scenarios for the LOG-11 two-step resolver.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-10T15:57Z
- **Completed:** 2026-05-10T16:03:25Z
- **Tasks:** 1
- **Files created:** 1
- **Files modified:** 0

## Accomplishments
- UAT-03 SC#3 closed programmatically: 4 `it()` blocks cover step-1 hit, step-2 hit, not-found, and state-points-to-missing-log scenarios (D-12).
- D-13 exit-code contract confirmed from the current CLI (not redesigned):
  - step-1 hit / step-2 hit → exit 0 + stdout contains seeded log body line.
  - not-found → exit 1 + stderr `No session found for task <task-id>` (`src/logs/reader.js:54`).
  - state-points-to-missing-log → exit 1 + stderr `No log file at <path>` referencing `<sessionId>.ndjson` (`src/logs/reader.js:113-116`).
- Test passes deterministically across 3 consecutive isolated runs and the full suite (510 pass + 1 skip pre-existente, +4 tests added on top of the Phase 16 baseline of 506 pass + 1 skip).

## Task Commits

Each task was committed atomically:

1. **Task 1: Crear test/session-of-resolver.test.js con 4 escenarios E2E (D-12)** — `a787d8e` (test)

## Files Created/Modified
- `test/session-of-resolver.test.js` (created) — 4 `it()` integration tests covering D-12; uses `mkdtempSync('kodo-uat-session-of-')` + `process.env.HOME = tmpHome` + dynamic `await import('../src/session/state.js')` (CR-02 pattern); spawnSync with 5s timeout (T-17-03-03); afterEach resets state.json to `{schema_version:2, sessions:{}}` and `rmSync` logs/ (T-17-03-02).

## Decisions Made

D-decisions covered by this plan (consolidated from 17-CONTEXT.md):

| ID | Decision | Where it lives in the test |
|----|----------|----------------------------|
| D-01 | Subprocess real spawneando `bin/kodo`; no import directo del resolver | `runSessionOf()` helper line 62; comment block lines 14-17 |
| D-02 | mkdtempSync + HOME override + dynamic import de state.js POST-HOME | `before` block lines 105-115 |
| D-12 | 4 escenarios: step-1 hit, step-2 hit, not-found, missing-log | 4 `it()` blocks |
| D-13 | Exit codes observados, NO rediseñados | Test 4 asserts `result.status === 1` + stderr `No log file at` (reader.js:113-116 contract) |
| D-14 | Multi-match (D-21 LOG-11) FUERA de scope | Per-test single seedLogFile call; explicit comment block line 286-291 |

### Exit codes observados por escenario (D-13)

| Scenario | Exit | stdout signature | stderr signature |
|----------|------|------------------|------------------|
| step-1 hit (state.json maps task_id → sid; log file present) | 0 | regex `/body-uat03-step1/` | empty |
| step-2 hit (state empty; head-line scan matches event=session.start + task_id) | 0 | regex `body-uat03-step2-<pid>` | empty |
| not-found (state empty + no log head-line match) | 1 | empty | `No session found for task kodo-uat03-doesnotexist` (reader.js:54) |
| state-points-to-missing-log (state.json maps task_id → sid but `<sid>.ndjson` absent) | 1 | empty | `No log file at <tmpHome>/.kodo/logs/<sid>.ndjson` (reader.js:113-116) |

D-13 divergencia: **ninguna**. El comportamiento del CLI es determinista en los 4 escenarios y los asserts capturan exactamente lo que `runLogs()` emite hoy. No emergió non-determinismo y no hubo necesidad de escalar.

## Deviations from Plan

None — plan executed exactly as written.

The PLAN's Test 4 acceptance criterion was conservative on purpose (`status !== 0` plus a `1 || 2` range) to absorb potential drift from D-13 discovery. The actual run confirmed exit `1` plus a specific stderr signature (`No log file at`), so the test was tightened to the canonical message and `<sid>.ndjson` substring rather than a generic `length > 0` check. This is a strengthening of the asserts within the plan's stated tolerance, not a redesign — D-13 is honoured by reading the contract straight from `src/logs/reader.js:113-116` rather than renegotiating it.

## Issues Encountered

None. Test passed first time and held through 3 determinism runs + full suite.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 04 (UAT-01: `kodo logs --follow` E2E) and Plan 05 (07-HUMAN-UAT.md retirement + MILESTONES.md update) inherit the same `mkdtempSync('kodo-uat-…')` + `HOME: tmpHome` subprocess pattern established here.
- The `body-<sessionId>` seeding trick (formatLine non-TTY branch produces `${time} ${LEVEL} ${msg}`) gives Plan 04 a stable regex anchor for `--follow` streaming asserts as well.
- No blockers introduced for downstream plans in Wave 1 or Wave 2.

## Self-Check: PASSED

- File `test/session-of-resolver.test.js` exists.
- Commit `a787d8e` is reachable via `git log --oneline`.
- 4 `it()` blocks present (lines 139, 186, 220, 239).
- `node --test test/session-of-resolver.test.js` exits 0 across 3 consecutive runs.
- Full suite `node --test` exits 0 (510 pass + 1 skip pre-existente; baseline was 506 + 1 skip; delta = +4 tests, zero regressions).
- No new untracked files after commit.

---
*Phase: 17-phase-7-uat-automation*
*Completed: 2026-05-10*
