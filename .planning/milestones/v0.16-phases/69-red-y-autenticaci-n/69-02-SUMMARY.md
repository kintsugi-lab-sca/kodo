---
phase: 69-red-y-autenticaci-n
plan: 02
subsystem: api
tags: [http, auth, bearer-token, node-http, dos-protection, error-hygiene]

# Dependency graph
requires:
  - phase: 69-01
    provides: parseBearer / timingSafeTokenEqual / isOpenRoute / getOrCreateApiToken / MAX_BODY_BYTES + config.server.bind default
provides:
  - Default-deny bearer guard on every non-webhook route (neutral 401)
  - Loopback bind by default (config.server.bind ?? 127.0.0.1) at both listen sites
  - 1 MB pre-auth/pre-HMAC request body cap → 413
  - Neutral 500 bodies (internal detail logged, never returned)
  - Embedded web dashboard carries the bearer on all four of its fetches
affects: [69-03, 69-04, server, dashboard, webhook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Default-deny middleware at the createServer callback head (fail-closed: unlisted routes stay protected)"
    - "Unified URL(req.url) pathname parsing so ?token= cannot break exact-match routing"
    - "Bounded readBody: drain-and-discard on overflow so the client reads a clean 413 (no socket reset)"
    - "Inline HTML token binding + authedFetch wrapper for the embedded dashboard"

key-files:
  created:
    - test/server-auth.test.js
    - test/server-bind.test.js
    - test/server-body-limit.test.js
    - test/server-error-hygiene.test.js
  modified:
    - src/server.js
    - test/server-managed.test.js

key-decisions:
  - "Do NOT req.destroy() on an oversized body — drain-and-discard instead so the client cleanly reads the 413 rather than an ECONNRESET (undici surfaces a reset as 'fetch failed')"
  - "Query-param token accepted ONLY for the two HTML routes; the API rail is header-only (D-05 tradeoff, T-69-07 accepted)"
  - "getOrCreateApiToken() is called unconditionally at startup (even under --insecure/KODO_DEV) — auth is never silently disabled"

patterns-established:
  - "Fail-closed guard: isOpenRoute allowlist gates everything before route branches run"
  - "Neutral error bodies: {error:'unauthorized'} / {error:'payload too large'} / {error:'internal error'} — detail only to the log"

requirements-completed: [NET-01, NET-02, NET-03, NET-04]

coverage:
  - id: D1
    description: "Default-deny bearer guard: /status, /logs, /comments, DELETE /sessions require a valid bearer; /health open; /webhook keeps HMAC; neutral 401; ?token= for HTML routes only"
    requirement: "NET-02"
    verification:
      - kind: integration
        ref: "test/server-auth.test.js (bearer guard + HTML token cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Server binds to 127.0.0.1 by default; config.server.bind overrides at both listen sites"
    requirement: "NET-01"
    verification:
      - kind: integration
        ref: "test/server-bind.test.js"
        status: pass
    human_judgment: false
  - id: D3
    description: "1 MB pre-HMAC body cap → 413 emitted before verifySignature; ≤1 MB webhook body stays byte-identical and its HMAC still verifies"
    requirement: "NET-03"
    verification:
      - kind: integration
        ref: "test/server-body-limit.test.js"
        status: pass
    human_judgment: false
  - id: D4
    description: "A throwing handler returns 500 {error:'internal error'}; the thrown message never appears in the response body"
    requirement: "NET-04"
    verification:
      - kind: integration
        ref: "test/server-error-hygiene.test.js"
        status: pass
    human_judgment: false
  - id: D5
    description: "Embedded web dashboard is served only with a valid ?token= and routes all four fetches through an Authorization-adding wrapper; token never rendered as visible text"
    requirement: "NET-02"
    verification:
      - kind: integration
        ref: "test/server-auth.test.js (D-05 web-token cases)"
        status: pass
    human_judgment: false

# Metrics
duration: 24min
completed: 2026-07-06
status: complete
---

# Phase 69 Plan 02: Red y autenticación — server wiring Summary

**The `node:http` server is now default-deny bearer-gated, binds to loopback by default, cuts oversized bodies with a pre-HMAC 413, returns neutral 500s, and carries the bearer into the embedded dashboard — while `/health` stays open and `/webhook` keeps its HMAC intact.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-07-06T08:43:00Z
- **Completed:** 2026-07-06T09:08:00Z
- **Tasks:** 3 completed
- **Files modified:** 6 (2 source/test edits + 4 new test files)

## Accomplishments
- Wired the Plan 01 auth primitives into `src/server.js`: a fail-closed default-deny bearer guard at the callback head that gates every route except the `GET /health` / `POST /webhook` allowlist, with unified `URL(req.url)` pathname routing so `?token=` never breaks the exact-match branches (Pitfall 2).
- Closed the external network surface (T3): loopback bind by default via `config.server.bind ?? '127.0.0.1'` at both the managed and legacy listen sites; a 1 MB body cap that rejects oversized uploads with 413 BEFORE any auth/HMAC work; and neutral 500 bodies that log internal detail instead of leaking it.
- Made the embedded web dashboard first-class under the new guard: `dashboardHtml(token)` binds the bearer once inline and routes its four fetches (`/status`, `/logs`, `/comments`, DELETE `/sessions`) through an `authedFetch` wrapper, so the browser dashboard works with `?token=` without ever rendering the token as visible page text.

## Task Commits

Each task was committed atomically:

1. **Task 1: Default-deny bearer middleware + unified path parsing + token startup** - `970f69d` (feat)
2. **Task 2: Safe-default bind + 1 MB pre-auth body limit + neutral 500 errors** - `d691473` (feat)
3. **Task 3: Pass the token into the embedded web dashboard (D-05)** - `fc095c2` (feat)

_Tests were authored before/with each implementation (tasks 1 & 2 are `tdd="true"`); to keep every commit green under the pre-commit hooks, each task's test + implementation landed in a single commit rather than separate RED/GREEN commits._

## Files Created/Modified
- `src/server.js` - Unified pathname parsing; default-deny bearer guard; startup `getOrCreateApiToken()`; `host = config.server.bind ?? '127.0.0.1'` at both listen sites; bounded drain-and-discard `readBody` with typed `PAYLOAD_TOO_LARGE`; 413 branch in the `/webhook` caller; neutral 500 in the `/comments` catch; `dashboardHtml(token)` + inline `authedFetch`.
- `test/server-auth.test.js` - (new) 13 cases: bearer guard, open routes, HTML `?token=`, HTML-leak guard, and the D-05 dashboard token-wiring.
- `test/server-bind.test.js` - (new) resolved bind host: 127.0.0.1 default + config override (asserted via `server.address().address`).
- `test/server-body-limit.test.js` - (new) 2 MB POST → 413 pre-HMAC (verifySignature never runs) + ≤1 MB body preserved so a valid HMAC still verifies.
- `test/server-error-hygiene.test.js` - (new) a throwing `/comments` handler → 500 `{error:'internal error'}` with the thrown secret absent from the body.
- `test/server-managed.test.js` - (modified) EADDRINUSE blocker now binds `127.0.0.1` to match the server's new loopback bind (see Deviation 2).

## Decisions Made
- **Drain instead of destroy on oversized bodies.** The plan specified `req.destroy()`; that resets the socket mid-upload and the client (undici `fetch`) reports "fetch failed" instead of reading the 413. Chose to drain-and-discard the remaining bytes (memory stays bounded — the actual DoS goal) so the client cleanly receives the 413. See Deviation 1.
- **Query-param token is HTML-route-only** (D-05 / T-69-07 accepted tradeoff): a browser navigation cannot send an `Authorization` header, so `/` and `/dashboard` read `?token=`; every other route is header-only. `GET /status?token=` is still 401 (asserted).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `req.destroy()` on an oversized body broke 413 delivery**
- **Found during:** Task 2 (body limit)
- **Issue:** The plan's `req.destroy()` on overflow tears down the socket before the caller can write the 413, so the client sees a connection reset (undici: "fetch failed"), not a 413. It was intermittently passing in isolation but failed under parallel test execution.
- **Fix:** `readBody` now `req.resume()`-drains and discards the remaining upload (never buffering past the cap — memory bound preserved) and rejects with `code:'PAYLOAD_TOO_LARGE'`; the caller writes a plain 413 (no `Connection: close`). The client finishes its send and reads the 413 cleanly.
- **Files modified:** src/server.js
- **Verification:** `test/server-body-limit.test.js` green across 3 consecutive full-set runs (previously flaky).
- **Committed in:** `d691473` (initial) + `fc095c2` (drain hardening)

**2. [Rule 1 - Bug] Pre-existing `server-managed.test.js` EADDRINUSE collision broke under the new bind**
- **Found during:** Task 2 (bind)
- **Issue:** NET-01 moves the server bind from `0.0.0.0` to `127.0.0.1`. The existing EADDRINUSE test bound its blocker on all interfaces, which no longer collides with a loopback-bound server on macOS → "Missing expected rejection".
- **Fix:** The blocker now binds `127.0.0.1` to match the server's loopback bind (comment updated). Directly caused by this plan's change — in scope.
- **Files modified:** test/server-managed.test.js
- **Verification:** `node --test test/server-managed.test.js` → 3/3 pass.
- **Committed in:** `d691473`

---

**Total deviations:** 2 auto-fixed (2× Rule 1)
**Impact on plan:** Both fixes are correctness-required and stay within the plan's intent (bounded-memory 413, loopback bind). No scope creep; the webhook 413-before-HMAC and memory-bound DoS guarantees are preserved.

## Issues Encountered
- The plan's Task 1 acceptance said `/webhook` bad-signature returns "400"; the real `handleWebhookRequest` returns **401 `{error:'Invalid signature'}`** for a bad/missing signature (400 is only for a JSON parse / read error). The webhook test therefore asserts the response is NOT the bearer body `{error:'unauthorized'}` and IS `{error:'Invalid signature'}` — proving the request crossed the guard into the HMAC lane, which is the actual invariant the acceptance intends.

## User Setup Required
None - no external service configuration required. The bearer token is auto-generated and persisted on first boot by `getOrCreateApiToken()` (Plan 01).

## Verification
- `node --test test/server-auth.test.js test/server-bind.test.js test/server-body-limit.test.js test/server-error-hygiene.test.js` → 18 pass, 0 fail (stable across 3 runs).
- Full suite `npm test` → 1838 pass, 1 skip, 0 fail (baseline 1820 pass + 1 skip + 18 new tests; no regression).
- Acceptance greps: `new URL(req.url` present; `server.listen(port, host` count = 2; no `1024 * 1024` literal in server.js (imports `MAX_BODY_BYTES`); `dashboardHtml(TOKEN)` present.

## Self-Check: PASSED
All 6 key files exist on disk; all 3 task commits (`970f69d`, `d691473`, `fc095c2`) are present in git history.
