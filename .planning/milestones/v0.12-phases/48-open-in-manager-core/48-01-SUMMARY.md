---
phase: 48-open-in-manager-core
plan: 01
subsystem: api
tags: [plane, normalize, config, web_url, browse-url, self-hosted, split-deploy]

# Dependency graph
requires:
  - phase: 23-27 (GitHub adapter / Plane normalizer baseline)
    provides: normalizeWorkItem + NormalizeContext + PlaneProviderConfig + registry plane factory
provides:
  - "plane.web_url config field (resolve-on-read default = base_url)"
  - "webUrl threaded end-to-end: config -> registry factory -> PlaneProviderConfig -> both NormalizeContext builders -> normalizeWorkItem"
  - "browse-URL routed through webUrl with base_url fallback (zero regression on unified deploys, live web link on split deploys)"
  - "UNKNOWN/falsy identifier suppresses url at normalize-time (no dead browse/UNKNOWN-<seq> link persisted)"
affects: [48-02-open-in-manager-launcher, task_url-persistence, SessionRecord]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resolve-on-read default (D-06): additive config key NOT injected into DEFAULT_CONFIG; default `web_url ?? base_url` applied at the consumer (registry + normalizer), mirroring getDefaultGithubProviderConfig zero-breaking-change precedent"
    - "End-to-end threading of an optional context field through every call-site (a one-line normalize edit is inert unless the caller passes the value from config)"
    - "Normalize-time suppression of unreliable derived values (UNKNOWN identifier -> no url) keeping downstream consumers dumb"

key-files:
  created: []
  modified:
    - src/config.js
    - src/providers/registry.js
    - src/providers/plane/provider.js
    - src/providers/plane/normalize.js
    - src/server.js
    - test/config.test.js
    - test/normalize.test.js

key-decisions:
  - "D-06 resolve-on-read: web_url NOT injected into DEFAULT_CONFIG; default applied at consumer (registry.js) preserving zero-breaking-change for existing on-disk configs"
  - "migrateConfig defaults web_url = base_url for v1->v2 configs (safe pre-fix behavior until operator sets a distinct web host)"
  - "D-08 UNKNOWN-suppression located at normalize-time, not in the launcher (the launcher stays dumb; rows simply arrive with no task_url)"
  - "Rule 2 fix in server.js renderPending: render ref as plain text when url is absent instead of emitting a dead <a href=\"\"> anchor"

patterns-established:
  - "Resolve-on-read default for additive provider config keys (consumer-side `?? base_url`)"
  - "Optional NormalizeContext field threaded through both getTask and listPendingTasks builders"

requirements-completed: [OPEN-04]

# Metrics
duration: ~30min
completed: 2026-06-11
---

# Phase 48 Plan 01: Open-in-manager core (Plane browse-URL fix) Summary

**Routed the Plane browse-URL through a new resolve-on-read `plane.web_url` config threaded end-to-end (config -> registry -> provider -> both context builders -> normalizer), making `task_url` a live web link on split self-hosted deploys while staying byte-identical on unified deploys, plus normalize-time suppression of dead `UNKNOWN-<seq>` links.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-11T18:52Z (approx)
- **Completed:** 2026-06-11T19:21Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- `plane.web_url` config field with resolve-on-read default (= `base_url`); migrated v1->v2 configs carry `web_url = base_url` as the safe pre-fix default, and DEFAULT_CONFIG intentionally omits the key (zero-breaking-change for existing configs).
- `webUrl` wired through the whole call chain — the one-line `normalize.js` fix is NOT inert: registry resolves `plane.web_url ?? plane.base_url`, both `NormalizeContext` builders carry `webUrl: config.webUrl`, and `normalizeWorkItem` builds the browse-URL from `context.webUrl ?? context.baseUrl`.
- UNKNOWN/falsy project identifier now emits NO url at normalize-time (D-08) — no dead `.../browse/UNKNOWN-<seq>` link is ever persisted into a SessionRecord.
- `client.js` (the API host) left untouched; the TaskProvider contract (FROZEN at 9) and all endpoints unchanged.

## Task Commits

Each task was committed atomically (TDD: failing test in same commit as the implementation it drives, per the plan's task granularity):

1. **Task 1: Add web_url config support (resolve-on-read default)** - `3be36c3` (feat)
2. **Task 2: Thread webUrl end-to-end (registry -> provider config -> both context builders)** - `531a217` (feat)
3. **Task 3: Route browse-URL through webUrl + suppress UNKNOWN-ref URLs** - `79c2c58` (feat)

_TDD note: RED was confirmed before each GREEN (config migration test failed pre-fix; split-deploy + UNKNOWN + falsy normalize tests failed pre-fix). Tests and implementation were committed together to keep each task atomic._

## Files Created/Modified
- `src/config.js` - `migrateConfig` now carries `web_url: planeOld.base_url` for v1->v2 configs; DEFAULT_CONFIG unchanged (no web_url key).
- `src/providers/registry.js` - plane factory resolves `webUrl: plane.web_url ?? plane.base_url` into `createPlaneProvider`.
- `src/providers/plane/provider.js` - `PlaneProviderConfig` typedef gains `webUrl: string`; both context builders (getTask, listPendingTasks) carry `webUrl: config.webUrl`.
- `src/providers/plane/normalize.js` - `NormalizeContext` gains optional `webUrl`; url built from `context.webUrl ?? context.baseUrl`; UNKNOWN/falsy identifier -> `url: undefined`.
- `src/server.js` - `renderPending` renders the ref as plain `<span>` when `url` is absent (no dead anchor) — Rule 2 fix.
- `test/config.test.js` - 3 tests: v1->v2 web_url migration, idempotency, DEFAULT_CONFIG absence.
- `test/normalize.test.js` - 5 tests: unified deploy (byte-exact), split deploy (web host present / API host absent), UNKNOWN identifier (no url), falsy identifier (no url).

## Decisions Made
- Followed the plan's D-06 resolve-on-read decision exactly: the default lives at the consumer, never in DEFAULT_CONFIG, mirroring the `getDefaultGithubProviderConfig` precedent.
- UNKNOWN-suppression placed at normalize-time (D-08), keeping the launcher dumb as the plan directed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] server.js renderPending emitted a dead anchor when url is absent**
- **Found during:** Task 3 (UNKNOWN-suppression)
- **Issue:** The new `url: undefined` path for UNKNOWN identifiers flowed into `src/server.js:258` (`renderPending`), where `'<a href="' + escapeHtml(t.url) + '">'` would have produced `<a href="">KL-42</a>` — a misleading anchor pointing at the current page. This consumer was directly affected by the current task's change (in-scope).
- **Fix:** Render the ref as a plain `<span class="ref">` when `t.url` is falsy, otherwise the anchor as before.
- **Files modified:** src/server.js
- **Verification:** Full server test suite (test/server/*.test.js, dismiss-e2e, reconcile-logger) green (24/24 in test/server/); full suite 1267 pass + 1 skip + 0 fail.
- **Committed in:** `79c2c58` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The single auto-fix was a correctness requirement directly caused by the Task 3 `url: undefined` introduction (a downstream consumer would have rendered a dead anchor). No scope creep — client.js, the TaskProvider contract, and all endpoints remain untouched as required.

## Issues Encountered
- None of substance. One false-positive while running tests: invoking `node --test test/server/` treated the `test/server` directory as a test file (exit 1); re-running with `test/server/*.test.js` confirmed 24/24 pass. Not a code issue.

## Threat Model Compliance
- T-48-01 (mitigate): UNKNOWN/falsy identifier suppresses the url (no dead/wrong link persisted); `ref` keeps the human slug + `sequence_id`, never the workspace/issue UUID. Satisfied.
- T-48-02 / T-48-03 (accept / mitigate-downstream): web_url is operator-controlled local config; any URL produced here is re-validated by the http(s) allowlist in the launcher (Plan 48-02). This plan launches nothing.
- T-48-SC (n/a): no package installs — Node built-ins + existing deps only. Confirmed.

## User Setup Required
None - no external service configuration required. Operators on a split web/API self-hosted Plane deploy MAY set `providers.plane.web_url` in `~/.kodo/config.json` to point browse URLs at the web host; if unset it falls back to `base_url` (current behavior).

## Next Phase Readiness
- The data-layer half of Phase 48 is complete: `task_url` is now a live web link in all deploy topologies and is suppressed when unreliable.
- Ready for Plan 48-02 (the launcher / open-in-manager key) which consumes the persisted `task_url` and enforces the http(s) allowlist before `execFile`.

## Self-Check: PASSED
- All 8 modified/created files present on disk.
- All 3 task commits (3be36c3, 531a217, 79c2c58) present in git history.
- Full data-layer regression matrix green (config + normalize + plane-provider + registry = 60/60); full suite 1267 pass + 1 skip + 0 fail.
