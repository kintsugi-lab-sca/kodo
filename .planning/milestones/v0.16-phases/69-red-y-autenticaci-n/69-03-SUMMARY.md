---
phase: 69-red-y-autenticaci-n
plan: 03
subsystem: ui
tags: [ink, react, tui, bearer-auth, dashboard, fetch, 401]

# Dependency graph
requires:
  - phase: 69-01
    provides: "src/server/auth.js bearer primitives + config.server.bind default (the API rail this client now authenticates against)"
provides:
  - "makeAuthedFetch(token, base) — pure fetch wrapper attaching Authorization: Bearer <token>"
  - "fetchStatus code:'unauthorized' discriminant on 401 (additive, no signature change)"
  - "UNAUTHORIZED_MESSAGE constant + 401 banner rendered by LiveIndicator with precedence"
affects: [69-02 web-dashboard-auth, dashboard, tui, red-y-autenticacion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single authed fetchFn injection covers all four dashboard clients (status/comments/logs/dismiss) with zero client.js signature changes (D-07)"
    - "Additive discriminant field (code:'unauthorized') on a never-throws result, mirroring fetchComments' code pattern (D-08)"
    - "401 as a visible, actionable degradation banner with precedence over generic waiting/stale states — never a blank frame"

key-files:
  created: []
  modified:
    - "src/cli/dashboard/index.js — makeAuthedFetch helper + fetchFn prop wiring"
    - "src/cli/dashboard/client.js — fetchStatus 401 → code:'unauthorized'"
    - "src/cli/dashboard/App.js — UNAUTHORIZED_MESSAGE, unauthorized state, onResult wiring, SessionTable props"
    - "src/cli/dashboard/SessionTable.js — LiveIndicator 401 banner with precedence"
    - "test/dashboard-client.test.js — 401/500 discriminant + makeAuthedFetch tests"
    - "test/dashboard-status-line.test.js — 401 render + clear-on-OK test"

key-decisions:
  - "One token read + one authed fetch wrapper authenticates all four dashboard requests via App's existing fetchFn threading — zero client.js signature changes (D-07)"
  - "fetchStatus gains an additive code:'unauthorized' field on 401 only; 500 stays generic — App distinguishes actionable auth failure from transient degradation (D-08)"
  - "UNAUTHORIZED_MESSAGE uses lowercase register '⚠ no autorizado — revisa KODO_API_TOKEN' matching '⚠ server caído', color yellow (UI-SPEC §Color: bounded to yellow/red)"
  - "401 banner takes precedence over live/stale/waiting in LiveIndicator — rendered first, never a blank frame (D-08)"

patterns-established:
  - "Authed fetch injection: wrap globalThis.fetch once at the composition root, thread through props, keep data-layer signatures untouched"
  - "Token isolation: bearer lives only in the outbound Authorization header, never in a <Text>/render prop/log (PERSIST-04/T-69-08)"

requirements-completed: [NET-02]

coverage:
  - id: D1
    description: "makeAuthedFetch attaches Authorization: Bearer <token> to every dashboard request, preserving method, caller headers, and AbortSignal"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/dashboard-client.test.js#makeAuthedFetch: bearer merge preservando method + signal (NET-02, D-07)"
        status: pass
    human_judgment: false
  - id: D2
    description: "fetchStatus returns code:'unauthorized' on 401 and NOT on 500 (discriminable)"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/dashboard-client.test.js#fetchStatus: discriminante {ok} never-throws — 401/500 cases"
        status: pass
    human_judgment: false
  - id: D3
    description: "A 401 poll renders UNAUTHORIZED_MESSAGE in yellow with precedence over waiting/stale; an OK poll returns to ● live; frame never empty"
    requirement: "NET-02"
    verification:
      - kind: integration
        ref: "test/dashboard-status-line.test.js#NET-02 (D-08): estado 401 no autorizado — banner accionable, nunca frame vacío"
        status: pass
      - kind: unit
        ref: "test/format-isolation.test.js (color-isolation walker still green)"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-06
status: complete
---

# Phase 69 Plan 03: Ink dashboard bearer auth + 401 state Summary

**The Ink TUI dashboard authenticates all four of its requests with one injected authed fetchFn (no client.js signature change) and surfaces a 401 as an exported yellow "no autorizado" banner with precedence over generic degradation — never a blank frame, token never rendered.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-06T08:27:04Z
- **Completed:** 2026-07-06T08:32:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `makeAuthedFetch(token, base)` in index.js — pure wrapper merging `Authorization: Bearer <token>` while preserving method, caller headers, and AbortSignal; wired as App's `fetchFn` prop so status/comments/logs/dismiss are all authenticated with zero client.js signature changes (D-07).
- `fetchStatus` gains an additive `code:'unauthorized'` discriminant on 401 (500 stays generic), mirroring the existing `fetchComments` code pattern (D-08).
- `UNAUTHORIZED_MESSAGE` exported constant + `unauthorized` state in App; `LiveIndicator` renders the yellow 401 banner FIRST, with precedence over live/stale/waiting, cleared by any OK poll.
- Token isolation preserved: the bearer travels only in the outbound header, never into any `<Text>`/render prop/log (PERSIST-04/T-69-08). Color-isolation walker still green (no picocolors import).

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: bearer + 401 discriminant** — `1426eab` (test) → `e63d01e` (feat)
2. **Task 2: render 401 state** — `b02fda3` (test) → `92d42c2` (feat)

**Plan metadata:** _(final docs commit)_

## Files Created/Modified
- `src/cli/dashboard/index.js` — `makeAuthedFetch` helper; `fetchFn: makeAuthedFetch(process.env.KODO_API_TOKEN ?? '')` passed to App
- `src/cli/dashboard/client.js` — `fetchStatus` returns `code:'unauthorized'` on 401; typedef updated
- `src/cli/dashboard/App.js` — `UNAUTHORIZED_MESSAGE` export, `unauthorized` state, `onResult` sets/clears it, two new SessionTable props
- `src/cli/dashboard/SessionTable.js` — `LiveIndicator` threads `unauthorized`/`unauthorizedMessage` and renders the banner first
- `test/dashboard-client.test.js` — 401/500 discriminant cases + `makeAuthedFetch` merge/preservation tests
- `test/dashboard-status-line.test.js` — 401 renders banner (precedence, non-empty) + OK poll returns to `● live`

## Decisions Made
None beyond those the plan specified (D-07 one-fetchFn injection, D-08 additive discriminant + yellow lowercase banner). Followed plan as written.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Both TDD RED phases failed as expected (missing `makeAuthedFetch` export / missing `UNAUTHORIZED_MESSAGE` export), and both GREEN phases passed on first implementation.

## Verification

- Plan set: `node --test test/dashboard-client.test.js test/dashboard-status-line.test.js test/format-isolation.test.js` → 41 tests, 41 pass, 0 fail.
- `UNAUTHORIZED_MESSAGE` equality check exits 0.
- Full suite `npm test` → 1811 tests, 1810 pass, 1 skip, 0 fail (baseline 1788 pass + 1 skip not regressed; delta = new tests added this plan).

## User Setup Required

None - no external service configuration required. (The bearer token itself is produced/persisted by the server-side plumbing of plan 69-01; this plan only consumes `KODO_API_TOKEN` from the environment.)

## Next Phase Readiness
- Plan 69-02 (embedded web dashboard auth) is the sibling authenticated consumer; this plan's authed-fetch + visible-401 pattern is the reference for it.
- No blockers. Zero new npm dependencies.

## Known Stubs
None — the 401 banner is fully wired to the live poll result; no placeholder data paths introduced.

## Self-Check: PASSED

All modified source/test files present on disk; all four task commits (1426eab, e63d01e, b02fda3, 92d42c2) present in git history.

---
*Phase: 69-red-y-autenticaci-n*
*Completed: 2026-07-06*
