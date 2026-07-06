---
phase: 69-red-y-autenticaci-n
plan: 01
subsystem: auth
tags: [bearer-token, timing-safe, node-crypto, csprng, config, network-hardening]

# Dependency graph
requires:
  - phase: 67-68 (v0.15 onboarding)
    provides: writeEnvVar — the single 0600 secret writer (PERSIST-04)
  - phase: v0.2 Plane provider
    provides: verifySignature HMAC timing-safe compare pattern (D-03)
provides:
  - src/server/auth.js — pure/DI auth primitives (parseBearer, timingSafeTokenEqual, isOpenRoute, getOrCreateApiToken, MAX_BODY_BYTES)
  - New error code KODO_TOKEN_WRITE_FAILED on persist failure
  - New config key config.server.bind (default 127.0.0.1)
  - New env var KODO_API_TOKEN (auto-generated, 0600-persisted)
affects: [Plan 02 (server pipeline wiring), Phase 70 (concurrency), network topology docs]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — node:crypto built-in only
  patterns:
    - "Pure/DI auth module in src/server/ mirroring dismiss.js / provider-state.js"
    - "Length-guarded timingSafeEqual (never throws on unequal length) mirroring Plane HMAC compare"
    - "Generate-once CSPRNG bearer token persisted via the single secret writer, value never logged"

key-files:
  created:
    - src/server/auth.js
    - test/server/auth.test.js
  modified:
    - src/config.js
    - test/config.test.js

key-decisions:
  - "randomBytes(32).toString('hex') (64 hex) — parser-safe for the naive .env writer; NEVER base64 (Pitfall 1)"
  - "config.server.bind added to DEFAULT_CONFIG only (additive); migrated configs lack it, Plan 02 resolves defensively with ?? '127.0.0.1'"
  - "Persist failure surfaces as a coded throw (KODO_TOKEN_WRITE_FAILED) — never start with auth silently disabled (D-02)"

patterns-established:
  - "src/server/ pure auth primitives testable fully offline (no HTTP, no ~/.kodo/ writes)"
  - "Default-deny open-route allowlist: only GET /health and POST /webhook are open (D-04)"

requirements-completed: [NET-01, NET-02]

coverage:
  - id: D1
    description: "parseBearer extracts a case-insensitive, trimmed Bearer token; null on non-Bearer/empty/non-string"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/server/auth.test.js#parseBearer"
        status: pass
    human_judgment: false
  - id: D2
    description: "timingSafeTokenEqual is constant-time, length-guarded, never throws on unequal length, false on falsy"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/server/auth.test.js#timingSafeTokenEqual"
        status: pass
    human_judgment: false
  - id: D3
    description: "isOpenRoute is a default-deny allowlist of GET /health and POST /webhook only"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/server/auth.test.js#isOpenRoute"
        status: pass
    human_judgment: false
  - id: D4
    description: "getOrCreateApiToken: idempotent reuse / CSPRNG 64-hex generate+persist / coded throw on persist-fail / token value never logged"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/server/auth.test.js#getOrCreateApiToken"
        status: pass
    human_judgment: false
  - id: D5
    description: "MAX_BODY_BYTES exported as the 1 MB (1048576) pre-auth body cap"
    requirement: "NET-02"
    verification:
      - kind: unit
        ref: "test/server/auth.test.js#MAX_BODY_BYTES"
        status: pass
    human_judgment: false
  - id: D6
    description: "config.server.bind defaults to 127.0.0.1; port/idle/stuck unchanged; migrated configs without bind still load"
    requirement: "NET-01"
    verification:
      - kind: unit
        ref: "test/config.test.js#NET-01 — server.bind safe default"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-06
status: complete
---

# Phase 69 Plan 01: Auth primitives + safe-by-default bind Summary

**Pure, offline-testable bearer-auth building blocks in `src/server/auth.js` (RFC 6750 parse, length-guarded constant-time compare, default-deny open-route allowlist, generate-once CSPRNG token persisted 0600 and never logged) plus `config.server.bind` defaulting to `127.0.0.1` — zero new npm deps.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-06T08:19:58Z
- **Completed:** 2026-07-06T08:23:06Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `src/server/auth.js` exports the five NET-02 symbols — `parseBearer`, `timingSafeTokenEqual`, `isOpenRoute`, `getOrCreateApiToken`, `MAX_BODY_BYTES` — all unit-tested offline with no HTTP and no `~/.kodo/` writes.
- Token generation is CSPRNG 64-hex, idempotent, 0600-persisted via the single secret writer (`writeEnvVar`), surfaces persist failure as `KODO_TOKEN_WRITE_FAILED`, and never lets its value reach console output (asserted).
- `config.server.bind` defaults to `127.0.0.1` (NET-01) additively — migrated v0.15 configs without the key still load; Plan 02 resolves it defensively.
- Full suite green: 1805 pass + 1 skip (baseline 1788 + 1; +18 new tests, 0 regressions).

## Task Commits

TDD flow for Task 1 (test → feat), single feat for Task 2:

1. **Task 1 (RED): failing auth primitive tests** - `bf23ad7` (test)
2. **Task 1 (GREEN): src/server/auth.js pure auth primitives** - `5b00098` (feat)
3. **Task 2: config.server.bind default 127.0.0.1** - `6122afb` (feat)

_No REFACTOR commit — the GREEN implementation was already minimal._

## Files Created/Modified
- `src/server/auth.js` - Pure/DI auth primitives + MAX_BODY_BYTES constant (NET-02/NET-03)
- `test/server/auth.test.js` - 14 unit tests covering every `<behavior>` bullet
- `src/config.js` - Added `bind: '127.0.0.1'` to `DEFAULT_CONFIG.server`
- `test/config.test.js` - Added NET-01 describe block (bind default, unchanged keys, migrated-config-loads)

## Decisions Made
- `randomBytes(32).toString('hex')` (64 hex chars) chosen over base64 — hex is parser-safe for the naive `.env` writer whose `validateEnvValue` rejects `+`/`/`/`=` (Pitfall 1).
- `config.server.bind` added to `DEFAULT_CONFIG` only, not injected into `migrateConfig` — keeps the change additive and zero-breaking; Plan 02 resolves absent keys with `config.server.bind ?? '127.0.0.1'`.
- `getOrCreateApiToken` seeds `env.KODO_API_TOKEN` in-process on success because `loadEnvFile` is load-no-override (the current run must see the freshly written token).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. (`KODO_API_TOKEN` auto-generates on first server run in Plan 02; no operator action.)

## Threat Model Verification
- **T-69-04 (timing leak):** mitigated — `timingSafeTokenEqual` uses `crypto.timingSafeEqual` with a length guard, never `===`; unit test asserts no-throw on unequal length.
- **T-69-08 (token gen/leak):** mitigated — 256-bit CSPRNG token, 0600 persist via `writeEnvVar`, log emits only `ENABLED`; unit test asserts the value never appears in captured console output.
- **T-69-SC (supply chain):** honored — zero new npm dependencies; only `node:crypto` built-in + internal `writeEnvVar`.

## Next Phase Readiness
- Plan 02 can wire these primitives into the `src/server.js` request pipeline (bearer gate on the non-webhook lane, 413 body cap, `config.server.bind ?? '127.0.0.1'` resolution) — no new endpoints, invariants preserved.
- No blockers.

## Self-Check: PASSED
- FOUND: src/server/auth.js
- FOUND: test/server/auth.test.js
- FOUND commits: bf23ad7, 5b00098, 6122afb

---
*Phase: 69-red-y-autenticaci-n*
*Completed: 2026-07-06*
