---
phase: 40-provider-state-contrato-providers-enrichment
plan: 01
subsystem: api
tags: [provider, plane, github, task-provider, getTaskState, contract-matrix, anti-redos]

# Dependency graph
requires:
  - phase: 23-27 (v0.7 GitHub Issues Adapter)
    provides: createGitHubProvider + normalizeIssue (labels + open/closed state)
  - phase: 02 (v0.2 Provider Abstraction)
    provides: TaskProvider 9-method contract + createPlaneProvider + stateCache/getWorkItem
provides:
  - "Optional getTaskState({id, projectId}) on the Plane adapter — live state via getWorkItem, name-substring-first then group mapping"
  - "Optional getTaskState({ref}) on the GitHub adapter — label-convention mapping (review/block) + open/closed fallback, single issue fetch"
  - "Capability-gated getTaskState assert (B8) inside the cross-provider contract matrix, asserting the 5-literal vocabulary"
  - "Normalized provider_state vocabulary: in_progress | in_review | blocked | done | unknown"
affects: [40-02 server enrichment, Phase 43 dashboard render/filter, provider_state cross-system]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional provider method (NOT in TASK_PROVIDER_METHODS, detected via typeof === 'function') — mirrors v0.9 listComments"
    - "Anti-ReDoS string mapping: String.includes case-insensitive only, never RegExp over provider-controlled input"
    - "Pure mapping helpers (mapPlaneState / mapGithubLabels) inside the factory closure"

key-files:
  created: []
  modified:
    - src/providers/plane/provider.js
    - src/providers/github/provider.js
    - test/providers/contract.test.js
    - test/plane-provider.test.js
    - test/providers/github/provider.test.js

key-decisions:
  - "getTaskState stays OPTIONAL — TASK_PROVIDER_METHODS FROZEN at 9 (D-13); adding a 10th would break boot for providers that don't implement it"
  - "Plane: name substring wins over group (D-08) so 'In Review' inside group 'started' maps to in_review (the ROMAN-150 driver)"
  - "GitHub in_review/blocked are a labels CONVENTION, not native GitHub state — documented inline (D-11); no PR review-state lookup (D-12)"
  - "Plane resolves CURRENT state live via getWorkItem, never the init-time stateCache (state changes after init)"
  - "GitHub resolves the issue once via the existing getTask(ref) path — single fetch, no extra API call (D-12)"

patterns-established:
  - "Capability-gated contract assert: `if (typeof provider.X !== 'function') return;` inside the PROVIDERS loop preserves PROVIDERS × N_asserts determinism"
  - "Anti-ReDoS: provider state names / label names are matched with String.includes, never compiled to RegExp"

requirements-completed: [PSTATE-01, PSTATE-02, PSTATE-03]

# Metrics
duration: 18min
completed: 2026-06-03
---

# Phase 40 Plan 01: Provider State — contrato + providers Summary

**Optional `getTaskState` on both the Plane (live `getWorkItem`, name-substring-first then group) and GitHub (label-convention + open/closed) adapters, mapping native task state to the normalized `in_progress|in_review|blocked|done|unknown` vocabulary, with a capability-gated assert in the cross-provider contract matrix and `TASK_PROVIDER_METHODS` still frozen at 9.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-03T14:49:00Z
- **Completed:** 2026-06-03T15:07:11Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Plane adapter `getTaskState({id, projectId})` resolves the task's current state live via `client.getWorkItem` (expands `state_detail = {name, group}`) and maps it with the pure `mapPlaneState` helper — name substring wins over group (D-08/D-09), `String.includes` only (anti-ReDoS, D-10).
- GitHub adapter `getTaskState({ref})` resolves the issue once via the existing `getTask(ref)` path (single fetch, D-12) and maps labels by convention with `mapGithubLabels` — `review`/`block` substrings, else `open→in_progress`/`closed→done`, with an explicit honesty comment that this is a labels convention, not native GitHub state (D-11).
- Capability-gated `getTaskState` assert (B8) added inside the contract-matrix `PROVIDERS` loop; matrix count grew 14 → 16 (8 asserts × 2 providers) with determinism intact. B1 (9 `TASK_PROVIDER_METHODS`) untouched; `getTaskState` is NOT in the frozen array.

## Task Commits

Each task was committed atomically (Tasks 1-2 followed TDD: test → feat):

1. **Task 1 (RED): failing Plane getTaskState tests** - `8619ea5` (test)
2. **Task 1 (GREEN): Plane getTaskState + mapPlaneState** - `fd1b669` (feat)
3. **Task 2 (RED): failing GitHub getTaskState tests** - `35ba56d` (test)
4. **Task 2 (GREEN): GitHub getTaskState + mapGithubLabels** - `fb3f612` (feat)
5. **Task 3: capability-gated getTaskState assert in contract matrix** - `411df9f` (test)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `src/providers/plane/provider.js` - Added pure `mapPlaneState(name, group)` helper + optional `async getTaskState({id, projectId})` resolving live state via `getWorkItem`.
- `src/providers/github/provider.js` - Added pure `mapGithubLabels(labels, issueState)` helper + optional `async getTaskState({ref})` with inline honesty comment (convention, not native).
- `test/plane-provider.test.js` - Added the full D-09 mapping table + anti-ReDoS + single-fetch tests (10 new asserts).
- `test/providers/github/provider.test.js` - Added label-convention mapping + single-fetch + anti-ReDoS tests (6 new asserts).
- `test/providers/contract.test.js` - Added B8 capability-gated assert in the matrix loop + `getTaskStateArg` helper + a `/work-items/<id>/` route in the Plane fixture for `getWorkItem`.

## Decisions Made
- None beyond the plan — all decisions (D-08..D-14) were specified in PLAN.md/CONTEXT.md and followed exactly.

## Deviations from Plan

None - plan executed exactly as written.

The only fixture-level adjustment was anticipated by the plan itself (Task 3 action: "If the existing Plane `/states/` or GitHub issue fixtures lack a field the new assert needs, extend the fixture data in `instantiateProvider` minimally"): a `/work-items/${planeWorkItem.id}/` route was added to the strict Plane fetch stub so `getTaskState`'s `getWorkItem` call resolves against the existing `planeWorkItem` fixture. No matrix structure change.

## Issues Encountered
- The contract-matrix Plane stub (`stubPlaneFetch`) uses strict `endsWith` route matching (fail-loud on miss), unlike the looser per-provider stub. `getWorkItem` hits `/work-items/<id>/`, not `/work-items/`, so a specific suffix route was added returning the full `planeWorkItem` (whose `state_detail = {name:'In Progress', group:'started'}` → `in_progress`). Resolved within Task 3.

## Verification

- `node --test test/plane-provider.test.js test/providers/github/provider.test.js test/providers/contract.test.js` → 57 pass, 0 fail.
- Full suite: 1094 pass + 1 skip (pre-existing startup-budget) + 0 fail (baseline 1073 pass + 1 skip → +21 new asserts, no regressions).
- Registry boot smoke: both providers expose the 9 frozen methods; `typeof provider.getTaskState === 'function'` for both; `TASK_PROVIDER_METHODS.includes('getTaskState') === false`.
- Anti-ReDoS gate: 0 `new RegExp`/`.match(`/`.test(` in either `getTaskState`/mapper block.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 40-02 (server enrichment in `GET /status`) can now consume both adapters' `getTaskState` via the `typeof === 'function'` capability gate, using the cache + fail-open per-row pattern described in 40-PATTERNS.md.
- The normalized 5-literal vocabulary is the contract Phase 43 (dashboard render/filter) will render.

## Self-Check: PASSED

- Files: 40-01-SUMMARY.md, src/providers/plane/provider.js, src/providers/github/provider.js, test/providers/contract.test.js — all FOUND.
- Commits: 8619ea5, fd1b669, 35ba56d, fb3f612, 411df9f — all FOUND in git log.

---
*Phase: 40-provider-state-contrato-providers-enrichment*
*Completed: 2026-06-03*
