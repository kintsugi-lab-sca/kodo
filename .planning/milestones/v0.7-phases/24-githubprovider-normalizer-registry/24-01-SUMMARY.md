---
phase: 24-githubprovider-normalizer-registry
plan: 01
subsystem: provider-abstraction
tags: [github, normalizer, taskitem, pure-function, jsdoc, ts-check]

# Dependency graph
requires:
  - phase: 23-githubclient-auth-foundation
    provides: test/fixtures/github/issue.json (base shape forked into 5 incremental fixtures)
  - phase: 02-provider-abstraction
    provides: src/interface.js (TaskItem typedef, VALID_PRIORITIES, TASK_PROVIDER_METHODS)
provides:
  - src/providers/github/normalize.js with normalizeIssue + extractPriority (pure transform)
  - 5 incremental GitHub Issue fixtures forked from issue.json
  - test/providers/github/normalize.test.js (23 tests, ≥90% branch coverage)
affects: [24-02-provider, 24-03-registry, 25-polling, 27-cross-provider-contract]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure normalizer mirror: GitHub normalizer parallels src/providers/plane/normalize.js structurally"
    - "ESM JSON imports: `import x from './fixture.json' with { type: 'json' }`"
    - "Defensive label .map: tolerates string|object label forms"
    - "Canonical-keys leak guard test (D-18 W9): Object.keys(result).sort() deepEqual constant"

key-files:
  created:
    - src/providers/github/normalize.js
    - test/providers/github/normalize.test.js
    - test/fixtures/github/issue-with-priority.json
    - test/fixtures/github/issue-with-kodo.json
    - test/fixtures/github/issue-closed.json
    - test/fixtures/github/issue-no-body.json
    - test/fixtures/github/issue-no-labels.json
  modified: []

key-decisions:
  - "D-07 lock-in: TaskItem.id = issue.node_id (opaque, stable cross-rename) NOT numeric id"
  - "D-10 lock-in: description = body || '' (raw Markdown, no HTML strip — GitHub returns Markdown directly)"
  - "D-13 lock-in: projectName = projectId (same slug — GitHub has no separate human name)"
  - "D-14 lock-in: groups = [] hardcoded (milestone NOT extracted — closes STATE.md open question)"
  - "D-17 lock-in: priority whitelist is strict subset of VALID_PRIORITIES (urgent/high/medium/low, NO 'none', NO aliases p0/critical/blocker)"
  - "D-18 lock-in: zero leaks — exactly 11 canonical TaskItem fields, no GitHub-only fields (pull_request, assignees, milestone, user, comments, locked, state_reason)"

patterns-established:
  - "Pure normalizer + exported helper: extractPriority is exported alongside normalizeIssue for direct unit testing (≥90% branch coverage D-35)"
  - "Defensive label extraction: Array.isArray + map(typeof string | object?.name) + filter(Boolean) tolerates GitHub endpoint variations"
  - "Canonical-keys leak guard test pattern: lock down TaskItem shape with Object.keys deepEqual constant array — bloque against future field leaks in v0.8+"
  - "Incremental fixture pattern: each new fixture is a minimal fork of a base, mutating ONE canonical field for cherry-pick narrative readability"

requirements-completed: [GH-03, TEST-01]

# Metrics
duration: ~15min
completed: 2026-05-14
---

# Phase 24 Plan 01: GitHub Issue Normalizer Summary

**Pure GitHub Issue → canonical TaskItem normalizer (105 LOC) with strict priority whitelist (urgent/high/medium/low, no aliases), defensive label extraction, and a D-18 leak guard test that locks down the 11-field canonical TaskItem shape.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3
- **Files created:** 7 (1 SUT module + 1 test file + 5 fixtures)
- **Files modified:** 0
- **Tests added:** 23 (15 normalizeIssue + 8 extractPriority)

## Accomplishments

- `src/providers/github/normalize.js` (105 LOC): pure `normalizeIssue(issue, context)` + exported `extractPriority(labels)` helper. Zero API calls, zero side effects (D-06).
- 5 incremental GitHub Issue fixtures (`issue-with-priority`, `issue-with-kodo`, `issue-closed`, `issue-no-body`, `issue-no-labels`), each a minimal fork of `issue.json` mutating one canonical field.
- 23 normalizer tests covering D-07..D-18 + extractPriority edge cases. Includes the **D-18 canonical-keys leak guard (W9)**: `Object.keys(result).sort()` deepEqual to the 11-field canonical array — blocks future GitHub-only field leaks.
- Plane normalizer suite still green (invariant) and global `npm test` suite stays at 654/655 pass (1 pre-existing skipped, 0 fail).

## Task Commits

Each task was committed atomically (TDD RED → GREEN order):

1. **Task 24-01-01: 5 incremental fixtures** — `4a72822` (test) — `test/fixtures/github/issue-{with-priority,with-kodo,closed,no-body,no-labels}.json`
2. **Task 24-01-02: RED tests** — `017a60d` (test) — `test/providers/github/normalize.test.js` (23 tests, fails RED with "Cannot find module")
3. **Task 24-01-03: GREEN implementation** — `0824ca6` (feat) — `src/providers/github/normalize.js` (105 LOC, all 23 tests green)

## Files Created/Modified

- `src/providers/github/normalize.js` — pure normalizer: `normalizeIssue` + `extractPriority` exports, JSDoc on all public functions, `// @ts-check` (CONVENTIONS.md compliance).
- `test/providers/github/normalize.test.js` — 23 tests in 2 `describe` blocks (`normalizeIssue` + `extractPriority`). Imports 6 fixtures via ESM JSON.
- `test/fixtures/github/issue-with-priority.json` — `kodo` + `priority:high` labels (D-17 coverage).
- `test/fixtures/github/issue-with-kodo.json` — `kodo` + `kodo:sonnet` labels (D-11 multi-label coverage).
- `test/fixtures/github/issue-closed.json` — `state="closed"`, `state_reason="completed"` (D-16 coverage).
- `test/fixtures/github/issue-no-body.json` — `body: null` (D-10 default branch coverage).
- `test/fixtures/github/issue-no-labels.json` — `labels: []` (D-11 + D-17 empty coverage).

## Decisions Made

None new — plan executed exactly per locked decisions D-06..D-18 + D-34..D-35 from 24-CONTEXT.md.

Two minor in-code annotations:

- `VALID_PRIORITIES` is imported and referenced via `void VALID_PRIORITIES` to anchor contract symmetry without using `VALID_PRIORITIES.includes(value)` (D-17 explicitly forbids this because the array contains `'none'` which is not idiomatic for GitHub priority labels).
- The priority whitelist uses string-literal comparison (`value === 'urgent' || value === 'high' || ...`) for D-17 explicit subset semantics, as specified in PATTERNS.md §Pattern E.

## Deviations from Plan

None — plan executed exactly as written.

All 3 tasks committed in TDD order (fixtures → RED tests → GREEN implementation). 23 tests pass on first GREEN execution. No auto-fixes needed under Rules 1-3. No architectural questions surfaced (Rule 4 not triggered). Plane normalizer suite still green (invariant) confirming zero cross-provider impact.

## Coverage Summary

Branch coverage of `normalize.js` ≥ 90% (D-35), covered by tests:

| Branch                                  | Test coverage                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `body \|\| ''` truthy                   | `issueFixture`, `issuePriorityFixture`, `issueKodoFixture`, `issueClosed`    |
| `body \|\| ''` falsy (null/undefined)   | `issueNoBodyFixture`, inline `delete issue.body`                             |
| `Array.isArray(labels)` true            | All fixtures with labels                                                     |
| `Array.isArray(labels)` false           | `extractPriority(null)`, `extractPriority(undefined)`                        |
| `typeof l === 'string'` defensive       | `extractPriority(['priority:medium'])`, inline `labels: ['foo','bar']`       |
| `name.startsWith('priority:')` true     | All priority tests                                                           |
| `name.startsWith('priority:')` false    | `kodo`-only fixtures, `extractPriority([{name:'kodo'}, {name:'bug'}])`       |
| Whitelist hit (urgent/high/medium/low)  | One test per value + `issuePriorityFixture`                                  |
| Whitelist miss (invalid/alias p0)       | `priority:invalid`, `priority:p0` (D-17 alias rejection)                     |
| Case-insensitive priority match         | `Priority:HIGH`, `PRIORITY:urgent`                                           |
| `state` open vs closed                  | `issueFixture` (open), `issueClosedFixture` (closed)                         |
| `groups` always `[]` even with milestone | Inline `milestone: {...}` test                                              |
| D-18 leak guard (canonical 11 keys)     | `Object.keys(result).sort()` deepEqual `CANONICAL_KEYS.sort()`               |

## Verification Performed

- `node --test test/providers/github/normalize.test.js` → 23 pass, 0 fail
- `node --test test/normale.test.js` (Plane) → 19 pass, 0 fail (invariant confirmed)
- `npm test` global → 654 pass, 1 skipped (pre-existing), 0 fail
- `grep -c "// @ts-check" src/providers/github/normalize.js` → 1
- `grep -c "import.*VALID_PRIORITIES.*interface" src/providers/github/normalize.js` → 1
- `grep -cE "stripHtml|resolveWorkItemLabels|parseKodoLabels|parseTriggerEvent" src/providers/github/normalize.js` → 0 (intentional DROPs)
- 5 fixtures pass the structural check (`node_id` + `number` present, mutated field correct).

## Issues Encountered

- **Worktree base state correction:** At agent startup, the worktree HEAD pointed at `9185f92` (v0.6 archive) which is an ancestor of the expected base `d7be719` (Phase 23 already shipped). The `worktree_branch_check` step in the prompt detected the mismatch (merge-base ≠ expected base) and ran `git reset --hard d7be719...` to align the worktree with the expected base. After the reset, `test/fixtures/github/issue.json` and `src/providers/github/client.js` were available for the plan. No content lost (the reset only fast-forwarded into Phase 23 + Phase 24 planning commits already in the remote/main branch).

## Issues Encountered (cont.) — Stubs

None. Both `normalizeIssue` and `extractPriority` are fully wired; there are no placeholder values or unwired data flows.

## Next Phase Readiness

- **Wave 2 (Plan 24-02 provider):** `normalizeIssue` import is stable; the provider can call `normalizeIssue(issue, { projectId: 'owner/repo' })` directly.
- **Wave 2 priority extraction:** `extractPriority` is exported and tested independently — the provider does NOT need to re-implement priority logic.
- **Wave 3 (Plan 24-03 registry):** No coupling — registry only loads `provider.js`, which in turn imports this module. No changes here required for registry integration.
- **Phase 27 (TEST-03 cross-provider contract):** TaskItem shape is locked down by the D-18 leak guard test — any future divergence from the 11-field canonical shape will fail here first, before reaching the cross-provider matrix.

## Self-Check

- [x] `src/providers/github/normalize.js` exists (105 LOC).
- [x] `test/providers/github/normalize.test.js` exists (23 tests).
- [x] 5 fixtures exist under `test/fixtures/github/`.
- [x] Commits `4a72822`, `017a60d`, `0824ca6` exist in `git log`.
- [x] `node --test test/providers/github/normalize.test.js` exit 0.
- [x] `node --test test/normalize.test.js` (Plane) exit 0 — invariant.
- [x] `npm test` global suite green (654/655 pass, 1 pre-existing skipped, 0 fail).

## Self-Check: PASSED

---
*Phase: 24-githubprovider-normalizer-registry*
*Completed: 2026-05-14*
