---
phase: 40-provider-state-contrato-providers-enrichment
plan: 02
subsystem: api
tags: [provider-state, server-enrichment, status-endpoint, cache, dedup, fail-open, ndjson-event, read-only-lane]

# Dependency graph
requires:
  - phase: 40-01
    provides: "Optional getTaskState on Plane ({id, projectId}) + GitHub ({ref}) adapters returning the normalized in_progress|in_review|blocked|done|unknown vocabulary"
  - phase: 35 (v0.9 TUI datos)
    provides: "GET /status contract the dashboard consumes (additive fields safe)"
provides:
  - "provider.state.fetch.failed NDJSON event + providerStateFetchFailed(logger, {task_id, provider, error}) explicit-whitelist helper"
  - "createProviderStateResolver({provider, logger, ttlMs, now}) — pure DI resolver: capability gate + task_id-keyed cache + in-flight dedup + per-row fail-open"
  - "GET /status rows carry provider_state (in_progress|in_review|blocked|done|unknown|null) + provider_state_reason (null|unsupported|fetch-failed), spread-additive read-only lane"
affects: [Phase 43 dashboard render/filter, provider_state cross-system, ROMAN-150 closure data-side]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure DI resolver factory closing over a task_id-keyed Map cache + Map<task_id, Promise> in-flight dedup (testable without booting the HTTP server)"
    - "Read-only lane invariant: module imports only logger-events.js — structurally cannot write state.json"
    - "Per-row fail-open via Promise.allSettled (never Promise.all) so one row's failure cannot 500 /status"
    - "Explicit-whitelist event helper (no ...fields spread) — T-40-04 info-disclosure mitigation"

key-files:
  created:
    - src/server/provider-state.js
    - test/server/provider-state.test.js
  modified:
    - src/logger-events.js
    - test/logger-events.test.js
    - src/server.js
    - .planning/STATE.md

key-decisions:
  - "D-06 reinterpretation of PSTATE-04: provider_state=null WITH provider_state_reason ('unsupported' permanent | 'fetch-failed' transient), NOT a silently-omitted field — Phase 43 needs three visual states"
  - "D-01/D-04: NEW task_id-keyed Map cache {state, reason, ts}, NOT the {data, ts} pendingCache shape"
  - "D-02: TTL reuses PENDING_CACHE_TTL_MS (30s) — no second literal"
  - "D-03: in-flight Map<task_id, Promise> dedup so overlapping polls share one fetch"
  - "D-07: no third `supported` boolean — provider_state_reason==='unsupported' derives it"
  - "Resolver constructed ONCE at server start (not per-request) — avoids NDJSON file churn, shares cache/dedup across polls"

requirements-completed: [PSTATE-04]

# Metrics
duration: 6min
completed: 2026-06-03
---

# Phase 40 Plan 02: Provider State — server enrichment Summary

**`GET /status` now enriches every active session with a read-only `provider_state` + `provider_state_reason` resolved by a pure, dependency-injected `createProviderStateResolver` module (capability gate + task_id-keyed 30s cache + in-flight dedup + per-row `Promise.allSettled` fail-open), with the `provider.state.fetch.failed` NDJSON event making failures observable — never silent, never written to `state.json`, never coupled to `alive`/`elapsed_min`.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-03T15:11:22Z
- **Completed:** 2026-06-03T15:16:58Z
- **Tasks:** 3 (Task 2 followed TDD: RED → GREEN)
- **Files created:** 2 / **modified:** 4

## Accomplishments
- Registered `provider.state.fetch.failed` in `EVENTS` (registry + `@type` JSDoc kept in sync) with the `providerStateFetchFailed(logger, {task_id, provider, error})` helper using an EXPLICIT field whitelist (no `...fields`), `logger.error`, and zero new imports — LOG-12 (import count stays 2) and T-40-04 (info disclosure) both held.
- Created `src/server/provider-state.js`: a pure factory `createProviderStateResolver({provider, logger, ttlMs, now})` closing over a `Map<task_id, {state, reason, ts}>` result cache (D-01/D-04) and a `Map<task_id, Promise>` in-flight dedup map (D-03). `resolve(session)` implements the four-branch flow: (a) `typeof getTaskState !== 'function'` → `{null, 'unsupported'}` (no fetch); (b) cache hit within TTL; (c) await in-flight; (d) fetch with success-cache / fail-cache + observable event + `finally` cleanup. Plane id-shape `{id, projectId}`, GitHub `{ref}`. Anti-ReDoS (zero RegExp), structurally unable to write state.json (only import is `logger-events.js`).
- Wired the resolver into `GET /status`: constructed ONCE at server start (TTL = `PENDING_CACHE_TTL_MS`, D-02), enrichment map uses `Promise.allSettled` (never `Promise.all`) so one row's failure becomes `provider_state_reason:'fetch-failed'` and `/status` still returns 200. Spread-additive (`...s`); `alive`/`elapsed_min` derivation unchanged; no third `supported` boolean (D-07).
- Updated `.planning/STATE.md` TaskProvider invariant to read "9 obligatorios + getTaskState opcional", naming `getTaskState` (v0.10) as optional with the array FROZEN at 9.

## Task Commits

1. **Task 1: register provider.state.fetch.failed event** — `d7783e9` (feat)
2. **Task 2 (RED): failing resolver tests** — `d5d35ef` (test)
3. **Task 2 (GREEN): pure DI resolver module** — `a1321ac` (feat)
4. **Task 3: wire resolver into GET /status + STATE.md note** — `4f34608` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified
- `src/server/provider-state.js` *(created)* — `createProviderStateResolver` pure DI resolver (capability gate + cache + dedup + fail-open + observable failure).
- `test/server/provider-state.test.js` *(created)* — 9 DI unit tests: unsupported/ok/fetch-failed, TTL cache + expiry, in-flight dedup, plane/github id-shapes, default `now`, post-fail re-attempt.
- `src/logger-events.js` *(modified)* — `PROVIDER_STATE_FETCH_FAILED` in EVENTS + JSDoc; `providerStateFetchFailed` helper (explicit whitelist).
- `test/logger-events.test.js` *(modified)* — taxonomy assertion grew 23 → 24 canonical types (kept in lockstep with the registry, in-scope to Task 1).
- `src/server.js` *(modified)* — resolver import + single construction at server start + `Promise.allSettled` per-row enrichment in `GET /status`.
- `.planning/STATE.md` *(modified)* — TaskProvider invariant note updated surgically.

## Decisions Made
- None beyond the plan — all decisions (D-01..D-07, D-15) were specified in PLAN.md/CONTEXT.md and followed exactly. The D-06 reinterpretation (null + reason, not omitted field) was the planner's documented intent and is implemented as such.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `test/logger-events.test.js` taxonomy assertion in lockstep**
- **Found during:** Task 1
- **Issue:** `test/logger-events.test.js` asserts the EXACT EVENTS key list and `Object.keys(EVENTS).length === 23`. Registering the new event without updating the test would fail the Task 1 verification (`node --test test/logger-events.test.js`).
- **Fix:** Added `'provider.state.fetch.failed'` to the sorted assertion list (correct position) and bumped the count 23 → 24, with the message updated to reference Phase 40. This is in-scope: Task 1 modifies the very taxonomy this test validates.
- **Files modified:** `test/logger-events.test.js`
- **Commit:** `d7783e9`

### Path correction (executor prompt directive, not a deviation)
The plan frontmatter/Task 3 referenced "STATE.md" as shorthand for `.planning/STATE.md` (no root-level STATE.md exists). All reads/edits and the `grep` verification targeted `.planning/STATE.md` per the executor prompt's `<critical_path_correction>`. No root-level STATE.md was created.

## Issues Encountered
- The `grep -c "session/state\|saveState\|state.json" src/server/provider-state.js` acceptance check returns 3, but all 3 matches are inside the read-only-invariant COMMENT block documenting what is NOT imported. Confirmed via `grep -n "^import"` that the sole import is `../logger-events.js` — the module is structurally unable to write state.json. No action needed.

## Verification

- `node --test test/server/provider-state.test.js test/logger-events.test.js` → 42 pass, 0 fail.
- `src/server.js` loads as an ES module without throwing (`import('./src/server.js')` resolves).
- `.planning/STATE.md`: `grep -q "getTaskState" && grep -qi "opcional"` → both pass; invariant reads "9 obligatorios + getTaskState opcional", array FROZEN at 9.
- Grep gates: `createProviderStateResolver` construction call appears exactly once (import is separate); `Promise.allSettled` present, zero bare `Promise.all(`; zero RegExp in the resolver; import count of `logger-events.js` unchanged at 2 (LOG-12); no `...fields` spread in the new helper.
- Full suite: 1103 pass + 1 skip (pre-existing startup-budget) + 0 fail — baseline 1094 pass + 1 skip from 40-01, +9 resolver tests, no regressions.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 43 (dashboard render/filter) can now consume `provider_state` + `provider_state_reason` directly off each `/status` row. The three visual states (ok / unsupported / fetch-failed) are distinguishable via `provider_state_reason` exactly as PSTATE-05/06 require — the D-06 reinterpretation closes that requirement on the data side.
- ROMAN-150 is closed end-to-end on the data side: a Plane "In Review" task now surfaces in `/status` even when kodo's local lifecycle says the session ended.

## Self-Check: PASSED

- Files: 40-02-SUMMARY.md, src/server/provider-state.js, test/server/provider-state.test.js — verified below.
- Commits: d7783e9, d5d35ef, a1321ac, 4f34608 — verified below.

---
*Phase: 40-provider-state-contrato-providers-enrichment*
*Completed: 2026-06-03*
