---
phase: 56-tecla-del-dashboard
plan: 03
subsystem: adopt-core + cli/dashboard
gap_closure: true
tags: [adopt, uat-gap-fix, idempotency, sessionId, never-throws, color-isolation, footer]
requires:
  - "Phase 53: adoptSession idempotency guard + findSession({sessionId}) lookup"
  - "Phase 54: kodo adopt CLI --json byte-deterministic discriminant + ALREADY_ADOPTED→exit 0 contract"
  - "Phase 56-01/02: runAdopt + App.js adopt confirm machine + ADOPT_* footer copies"
  - "Phase 55 D-06: set-difference keyed by sessionId (== resume_binding.checkpoint_id), never workspaceRef"
provides:
  - "adoptSession idempotency guard keyed by sessionId (stable checkpoint identity) — closes UAT Test 1 blocker"
  - "runAdopt distinguishes a genuine adopt from an ALREADY_ADOPTED no-op via the --json discriminant"
  - "App.js amber ADOPT_ALREADY footer (no more false-green 'adopted' on a duplicate)"
affects:
  - "Live adoption happy path (UAT Test 1): a genuinely-new ad-hoc session sharing a cwd is no longer falsely rejected; a true duplicate now shows a truthful amber footer"
tech-stack:
  added: []
  patterns:
    - "idempotency keyed by stable session identity (sessionId), not recyclable surface coordinates (workspaceRef/cwd)"
    - "exit-0 + --json discriminant parse to distinguish a real mutation from an idempotent no-op (defensive try/catch, never-throws)"
    - "footer branch ordering: specific no-op code (ALREADY_ADOPTED) BEFORE the generic success check"
key-files:
  created: []
  modified:
    - src/adopt.js
    - src/cli/dashboard/adopt.js
    - src/cli/dashboard/App.js
    - test/adopt.test.js
    - test/dashboard/adopt.test.js
    - test/dashboard/app-adopt.test.js
decisions:
  - "FIX A: the guard keys by sessionId only — findSession({sessionId}) matches solely by session_id (state.js:364-369 checks query.sessionId first). cmux recycles workspace refs and cwd is shared, so {workspaceRef, cwd} was the wrong key (UAT root cause)."
  - "FIX B: --json appended as the FINAL argv element; runAdopt parses stdout defensively on the exit-0 branch. exitCodeFor in src/cli/adopt.js is UNCHANGED — ALREADY_ADOPTED stays exit 0 (CLI contract shared with Phase 57)."
  - "App.js: ALREADY_ADOPTED maps to a NEW amber footer (ADOPT_ALREADY), branch placed BEFORE the generic success check so a no-op never paints green."
metrics:
  duration: ~25m
  completed: 2026-06-17
---

# Phase 56 Plan 03: Adopt UAT Gap-Fix (sessionId identity + truthful footer) Summary

Fixes the UAT Test 1 blocker by keying the `adoptSession` idempotency guard on the stable `sessionId` (== `resume_binding.checkpoint_id`) instead of the recyclable `{workspaceRef, cwd}` pair, and makes the dashboard surface a duplicate `ALREADY_ADOPTED` no-op as a distinct amber footer (via the `--json` discriminant) instead of a misleading green "adopted".

## Context

UAT reported that confirming an adopt "did nothing" and the row never appeared. Root cause: the Phase 56 picker offers adoptables keyed by `sessionId` (correct, D-06), but the Phase 53 core guard matched by `{workspaceRef, cwd}` via `findSession`. cmux recycles `workspace:N` refs and multiple ad-hoc sessions share a cwd, so a genuinely-new session was falsely rejected as `ALREADY_ADOPTED` (exit 0). Because `ALREADY_ADOPTED` maps to exit 0 and `runAdopt` only read the exit code, the dashboard then painted a false-green "adopted" footer.

## What Was Built

**FIX A — `src/adopt.js`:** The idempotency guard now calls `findSessionFn({ sessionId })` instead of `findSessionFn({ workspaceRef, cwd })`. `findSession` with a `sessionId`-only query matches solely by `session_id` (state.js scans `query.sessionId` first against sessions then history). `sessionId` is already validated non-empty by the `INVALID_INPUT` guard above it, so it is always present. Updated the stale guard comment to cite the stable-identity rationale and Phase 55 D-06.

**FIX B — `src/cli/dashboard/adopt.js` + `App.js`:**
- `runAdopt` appends `--json` as the final argv element. On the `!err` (exit 0) branch it parses `_stdout` inside a `try/catch` (never throws — the contract is absolute). An explicit `{ok:false, code:'ALREADY_ADOPTED'}` resolves `{ ok:false, code:'ALREADY_ADOPTED', detail: <task_id|undefined> }`; any other shape (parse failure, `{ok:true}`, anything else) stays `{ ok:true }` as before. ENOENT / NON_ZERO_EXIT / SPAWN_ERROR branches unchanged. `AdoptResult` typedef extended with the new code.
- `App.js` adds an amber `ADOPT_ALREADY = (ref) => 'already adopted ' + ref` copy and a result-mapping branch placed BEFORE the generic success check: `result?.code === 'ALREADY_ADOPTED'` → `ADOPT_ALREADY` + `setFooterColor('yellow')`. Genuine `{ok:true}` keeps green `ADOPT_OK`; real errors stay red. armedSessionId/armedSurface reset + `setMode('list')` preserved.

## Tests (TDD: RED → GREEN)

- `test/adopt.test.js`: two adoptions sharing cwd+workspaceRef but DIFFERENT sessionId both succeed; a true re-adopt (same sessionId) still returns ALREADY_ADOPTED.
- `test/dashboard/adopt.test.js`: `--json` is the final argv element; exit-0 + ALREADY_ADOPTED stdout → `{ok:false, code:'ALREADY_ADOPTED'}`; defensive fallbacks (`ok:true` stdout, unparseable stdout) stay `{ok:true}`.
- `test/dashboard/app-adopt.test.js`: `onAdopt` resolving ALREADY_ADOPTED renders the amber `ADOPT_ALREADY` footer, not green `ADOPT_OK`.

## Deviations from Plan

None — applied exactly the two fixes specified. The `exitCodeFor` contract in `src/cli/adopt.js` was intentionally left unchanged per constraint (ALREADY_ADOPTED stays exit 0).

## Invariants Verified

- `test/format-isolation.test.js` passes — `src/cli/dashboard/*` imports ZERO picocolors (only change to adopt.js is the literal `--json` argv element + a defensive JSON.parse).
- never-throws preserved: the new stdout parse is wrapped in try/catch; no throw reaches React.
- execFile-no-shell with literal argv preserved (only addition is the literal `--json` string).
- Zero new server endpoints — `src/server.js` untouched.
- `exitCodeFor` (src/cli/adopt.js) untouched.

## Verification

- Targeted: `node --test test/adopt.test.js test/adopt-cli.test.js test/dashboard/adopt.test.js test/dashboard/app-adopt.test.js test/format-isolation.test.js` → 58 pass, 0 fail.
- Full suite: `node --test $(find test -name '*.test.js' -type f)` → 1420 pass, 0 fail, 1 skip (pre-existing).

## Self-Check: PASSED
