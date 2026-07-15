---
phase: 69-red-y-autenticaci-n
verified: 2026-07-06T09:38:12Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 69: Red y autenticación Verification Report

**Phase Goal:** Cerrar la superficie de red — el server deja de escuchar en toda interfaz por defecto y el carril no-webhook exige autenticación, sin filtrar datos ni errores a un atacante externo.
**Verified:** 2026-07-06T09:38:12Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `config.server.bind` defaults to `127.0.0.1`; both `listen()` call sites use it | ✓ VERIFIED | `src/config.js:64` (`bind: '127.0.0.1'` in `DEFAULT_CONFIG.server`); `src/server.js:482` resolves `host`; `grep -c "server.listen(port, host"` = 2 (lines 811, 827); `test/server-bind.test.js` passes (default + override cases) |
| 2 | An empty/whitespace `config.server.bind` does NOT silently expose `0.0.0.0` (WR-04 review fix) | ✓ VERIFIED | `src/server.js:482`: `(typeof rawBind === 'string' && rawBind.trim()) ? rawBind.trim() : '127.0.0.1'`; `test/server-bind.test.js` asserts `bind:''` and `bind:'   '` both resolve to `127.0.0.1` |
| 3 | Non-webhook rail (`GET /status`, `/logs`, `/comments/:id`, `DELETE /sessions/:id`) returns 401 `{"error":"unauthorized"}` without a valid bearer; 200 with the correct one | ✓ VERIFIED | `src/server.js:570-580` default-deny guard (`isOpenRoute` + `parseBearer` + `timingSafeTokenEqual`); `test/server-auth.test.js` drives real HTTP against an ephemeral-port server and asserts every case |
| 4 | `/health` stays open (no token); `/webhook` keeps HMAC verification unchanged | ✓ VERIFIED | `src/server/auth.js` `isOpenRoute` allowlists only `GET /health` + `POST /webhook`; `test/server-auth.test.js` asserts `/health` 200 with no auth header and `/webhook` reaches HMAC (400/401 on bad signature, not the bearer 401) |
| 5 | The bearer comparison is constant-time and never throws on length mismatch | ✓ VERIFIED | `src/server/auth.js:66-75` `timingSafeTokenEqual` — length-guard + try/catch around `crypto.timingSafeEqual`; unit-tested in `test/server/auth.test.js` |
| 6 | A fresh install auto-generates a 64-hex-char `KODO_API_TOKEN`, persists it via the single 0600 secret writer, and never logs its value | ✓ VERIFIED | `src/server/auth.js:115-135` `getOrCreateApiToken` (CSPRNG `randomBytes(32).toString('hex')`, calls `writeEnvVar`, logs only the literal `ENABLED`); unit-tested including a console-capture assertion |
| 7 | The embedded web dashboard (`/`, `/dashboard`) requires `?token=`, never leaks the HTML shell unauthenticated, and its 4 fetches carry the bearer | ✓ VERIFIED | `src/server.js:570-580,743-746` gate + `dashboardHtml(TOKEN)`; token JSON-escaped (`WR-02` fix, line 84: `JSON.stringify(String(token)).replace(/</g,'\\u003c')`); `test/server-auth.test.js` D-05 cases pass |
| 8 | The Ink TUI dashboard attaches the bearer to all 4 requests (status/comments/logs/dismiss) via one injected `fetchFn`; a 401 renders a distinct, non-blank banner; token never appears in rendered output | ✓ VERIFIED | `src/cli/dashboard/index.js:90` `makeAuthedFetch` wired as `fetchFn` prop (line 271); `src/cli/dashboard/client.js:59` `code:'unauthorized'` discriminant on 401; `src/cli/dashboard/App.js:216` `UNAUTHORIZED_MESSAGE`; `SessionTable.js:142-143` renders it first in yellow; `test/dashboard-client.test.js` + `test/dashboard-status-line.test.js` + `test/format-isolation.test.js` all pass |
| 9 | A POST body over 1 MB is rejected with 413 before any auth/HMAC work; a ≤1 MB body (incl. webhook) stays byte-identical | ✓ VERIFIED | `src/server.js:408-450` bounded `readBody` (imports `MAX_BODY_BYTES` from `auth.js`, no second literal); 413 branch at line 761-766 fires before `handleWebhookRequest`; `test/server-body-limit.test.js` passes |
| 10 | A handler that throws returns a neutral `{"error":"internal error"}`; the real message is only logged | ✓ VERIFIED | `src/server.js:703-710` (`/comments` catch) + `src/server.js:782-793` (CR-01 top-level boundary, review fix) both log via `console.error` and respond with the fixed neutral body; `test/server-error-hygiene.test.js` passes |
| 11 | A malformed request target / malformed percent-encoding never crashes the daemon (CR-01/WR-01 review fixes) | ✓ VERIFIED | `src/server.js:554-561` guarded `new URL()` → 400; guarded `decodeURIComponent` at lines 676-683 and 722-729 → 400; `test/server-malformed-request.test.js` drives a real raw-TCP malformed request and asserts the daemon still answers `/health` 200 afterward |
| 12 | A `sessionId` outside `/^[A-Za-z0-9_-]+$/` is rejected before touching the filesystem; `reconcile`/UUID ids and the README multi-node section are unaffected | ✓ VERIFIED | `src/logs/reader.js:30,74-76` hard reject (stderr + exit 2) before the log-path join; `src/logger.js:36,259-260` soft non-throwing guard (`diskSinkEnabled`); README `## Topología multi-nodo` section (line 143) documents the loopback default + `config.server.bind` + ACL + retained bearer/HMAC/health semantics, plus the WR-03 token-in-URL security note; `test/logs-reader.test.js` passes |

**Score:** 12/12 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/auth.js` | exports `parseBearer`, `timingSafeTokenEqual`, `isOpenRoute`, `getOrCreateApiToken`, `MAX_BODY_BYTES` | ✓ VERIFIED | All 5 symbols present and unit-tested (39 subtests, 122 assertions incl. this file) |
| `src/config.js` | `DEFAULT_CONFIG.server.bind === '127.0.0.1'` | ✓ VERIFIED | Confirmed at line 64; `port: 9090` etc. unchanged |
| `src/server.js` | default-deny bearer guard + bounded `readBody` + `listen(port, host)` (x2) + neutral 500/401/413 bodies + `dashboardHtml(token)` | ✓ VERIFIED | All present, wired, and covered by 4 integration test files + 1 review-fix test file |
| `src/cli/dashboard/index.js` / `client.js` / `App.js` / `SessionTable.js` | authed fetch wiring + 401 discriminant + banner | ✓ VERIFIED | All present and wired; color-isolation invariant preserved (`test/format-isolation.test.js` green) |
| `src/logs/reader.js` / `src/logger.js` | `SESSION_ID_RE` guard (hard + soft) | ✓ VERIFIED | Present at both anchors; reconcile/UUID unaffected (smoke-tested) |
| `README.md` | "Topología multi-nodo" section | ✓ VERIFIED | Present once, includes bind default, exposure path, ACL note, retained auth semantics, and the WR-03 token-rotation security note |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/server.js` | `src/server/auth.js` | `import { parseBearer, timingSafeTokenEqual, isOpenRoute, getOrCreateApiToken, MAX_BODY_BYTES }` | ✓ WIRED | Line 11; all 5 symbols consumed in the request pipeline |
| `src/server/auth.js` `getOrCreateApiToken` | `src/config.js` `writeEnvVar` | single 0600 secret writer reuse | ✓ WIRED | `import { writeEnvVar } from '../config.js'` (auth.js line 27) |
| `src/cli/dashboard/index.js` | `App.js`/`client.js`/`SessionTable.js` | `fetchFn` prop threading | ✓ WIRED | `makeAuthedFetch(...)` passed as `fetchFn` (index.js:271); `App.js` already threads `fetchFn` to all 4 data calls |
| `/webhook` caller | `readBody` | 413 pre-HMAC | ✓ WIRED | `test/server-body-limit.test.js` proves `verifySignature` never runs on an oversized body |
| `src/logs/reader.js` | filesystem `join(KODO_DIR, 'logs', ...)` | `SESSION_ID_RE` guard before the join | ✓ WIRED | Guard precedes the join at line 74-76 (join itself later in file) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase-specific suite | `node --test test/server/auth.test.js test/config.test.js test/server-auth.test.js test/server-bind.test.js test/server-body-limit.test.js test/server-error-hygiene.test.js test/server-malformed-request.test.js test/dashboard-client.test.js test/dashboard-status-line.test.js test/format-isolation.test.js test/logs-reader.test.js` | 122/122 pass, 0 fail | ✓ PASS |
| Daemon survives a raw-TCP malformed request target | `test/server-malformed-request.test.js` (real TCP socket, not fetch) | 400 + neutral body, `/health` 200 afterward | ✓ PASS |
| Full workspace suite (run once) | `npm test` | 1843 pass, 1 skip, 0 fail | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or PLAN-declared probes for this phase. Skipped — not applicable (unit/integration `node --test` suite is the phase's own verification mechanism, executed above).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| NET-01 | 69-01, 69-02 | Server binds to `127.0.0.1` by default; `config.server.bind` allows explicit exposure | ✓ SATISFIED | `DEFAULT_CONFIG.server.bind`, both `listen()` sites, WR-04 empty-string hardening |
| NET-02 | 69-01, 69-02, 69-03 | Non-webhook rail requires `Authorization: Bearer <token>`; 401 without; dashboard sends token; `/webhook` keeps HMAC; `/health` open | ✓ SATISFIED | Default-deny guard, web dashboard token wiring, Ink dashboard token wiring |
| NET-03 | 69-02 | `readBody` cuts at 1 MB pre-auth → 413 | ✓ SATISFIED | Bounded `readBody` + pre-HMAC 413 branch, tested |
| NET-04 | 69-02 | 500s return neutral message; `err.message` only to log | ✓ SATISFIED | `/comments` catch + CR-01 top-level boundary |
| NET-05 | 69-04 | `sessionId` validated with `/^[A-Za-z0-9_-]+$/` before touching filesystem | ✓ SATISFIED | Hard reject in `reader.js`, soft guard in `logger.js` |
| NET-06 | 69-04 | Multi-node topology documented | ✓ SATISFIED | README "Topología multi-nodo" section |

No orphaned requirements — REQUIREMENTS.md traceability table maps exactly NET-01..06 to Phase 69, and all 6 appear in the union of the 4 plans' `requirements` frontmatter.

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`), stub returns, or empty handlers found in any file modified by this phase (`src/server.js`, `src/server/auth.js`, `src/config.js`, `src/logs/reader.js`, `src/logger.js`, `src/cli/dashboard/{index,client,App,SessionTable}.js`, `README.md`). The Spanish-language "TODO" (= "all") and historical "placeholder" comments found via grep in `App.js`/`SessionTable.js` are pre-existing narrative comments referring to earlier phases (Phase 34/35), not new debt introduced by this phase.

### Post-Plan Code Review Fixes (CR-01, WR-01..04)

All 5 findings from `69-REVIEW.md` are confirmed fixed in the current `HEAD` and independently verified against the code (not just the claim in `69-REVIEW-FIX.md`):
- CR-01: top-level try/catch + guarded `new URL()` — confirmed at `src/server.js:554-561,782-793`, proven by a real raw-TCP integration test.
- WR-01: guarded `decodeURIComponent` on both `/comments/` and `DELETE /sessions/` — confirmed at lines 676-683, 722-729.
- WR-02: token JSON-escaped into the dashboard inline script — confirmed at line 84.
- WR-03: README security note on `?token=` browser-history exposure + rotation — confirmed in README.
- WR-04: empty/whitespace bind resolves to loopback — confirmed at line 482, tested.

### Human Verification Required

None. All must-haves are covered by real integration/unit tests exercising actual HTTP requests (ephemeral-port servers, raw TCP sockets for the crash-repro case) rather than presence-only checks.

### Gaps Summary

No gaps. All 12 derived truths (roadmap goal + must_haves from all 4 plans, plus the 5 post-review hardening fixes) are verified against the current codebase with passing automated tests. Full suite: 1843 pass, 1 skip, 0 fail — matches the claimed baseline exactly. All 18 referenced commits (bf23ad7 through 2e88342) exist in git history. Zero new npm dependencies introduced (confirmed no `package.json` changes in this phase's file list).

---

*Verified: 2026-07-06T09:38:12Z*
*Verifier: Claude (gsd-verifier)*
