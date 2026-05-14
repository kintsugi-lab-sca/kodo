---
phase: 23-githubclient-auth-foundation
plan: 02
subsystem: providers
tags: [github-api, rest-client, pat, etag-304, rate-limit, log-12]

# Dependency graph
requires:
  - phase: 23-githubclient-auth-foundation
    plan: 01
    provides: githubApiCall + githubApiCallFailed helpers in src/logger-events.js (15-event closed taxonomy)
  - phase: 07-kodo-logs-cli
    provides: Logger info/warn/error interface + NDJSON sink
  - phase: 16-rule-engine-vigilante  # LOG-12 invariant owner
    provides: check-isolation canary verifying logger-events.js stdlib-only
provides:
  - "src/providers/github/client.js — class GitHubClient with 5 async methods (getIssue, listIssues, addComment, updateIssue, listLabels)"
  - "Private request() centralizing fetch+auth+timeout+rate-limit+NDJSON+error-mapping (no retry, no proactive throttle)"
  - "Envelope shape {status, items, etag, rate_limit_remaining} for listIssues 200/304 paths"
  - "Canonical Error.code mapping: unauthorized | not_found | rate_limit_exceeded | forbidden | github_api_error"
  - "10 JSON fixtures in test/fixtures/github/ covering 200/201/304/401/403/404/429 + rate-limit-low scenarios"
  - "15 offline unit tests in test/providers/github/client.test.js covering verification map rows 01-10"
affects:
  - 24-github-provider  # consumes new GitHubClient({token, logger}) → builds TaskProvider
  - 25-github-polling   # consumes listIssues({etag}) → persists etag in polling-state.json
  - any future phase building on GitHub REST transport

# Tech tracking
tech-stack:
  added: []  # zero new dependencies — built on Node 20+ globalThis.fetch + AbortSignal
  patterns:
    - "Injectable fetch via constructor opts (opts.fetch ?? globalThis.fetch) — testability without globalThis mutation"
    - "Dynamic await import('../../logger-events.js') wrapped in try/catch silent — preserves LOG-12 invariant"
    - "Plain Error with .code/.status/.retryAfter properties — no custom Error subclass (D-12 YAGNI)"
    - "Runtime fetch-leak guard in test file: globalThis.fetch = thrower → restored in after() — catches any test forgetting opts.fetch"

key-files:
  created:
    - src/providers/github/client.js (333 lines: class + request + 2 helpers + JSDoc)
    - test/providers/github/client.test.js (379 lines: 15 it() + 3 helpers + leak guard)
    - test/fixtures/github/issue.json
    - test/fixtures/github/issues-list.json
    - test/fixtures/github/issues-list-304.json
    - test/fixtures/github/rate-limit-low.json
    - test/fixtures/github/rate-limit-exceeded.json
    - test/fixtures/github/unauthorized-401.json
    - test/fixtures/github/forbidden-403.json
    - test/fixtures/github/not-found-404.json
    - test/fixtures/github/comment-created.json
    - test/fixtures/github/labels-list.json
  modified: []

key-decisions:
  - "Zero retry in client (D-11): single fetch per request; Phase 25 polling (POLL-04) owns exponential backoff. Avoids double-retry antipattern."
  - "Envelope {status, items, etag, rate_limit_remaining} only on listIssues 200/304 paths (D-19). Other 4 methods return raw GitHub payloads."
  - "Injectable fetch via constructor (D-06) — diverges from PlaneClient. Tests inject makeFetch(scenario); zero globalThis mutation for live calls."
  - "Runtime leak guard installed (top-of-test-file): globalThis.fetch = thrower in before(), restored in after(). Catches any accidental live network call loud."
  - "parseRetryAfter helper handles both RFC 7231 forms (int seconds + HTTP-date) — GitHub usually returns int but spec admits both (Pitfall #4)."
  - "403 disambiguation: X-RateLimit-Remaining:0 OR Retry-After present → rate_limit_exceeded; otherwise → forbidden (D-12 + 23-RESEARCH error mapping table)."
  - "encodeURIComponent on owner+repo in all 5 methods (T-23-05 SSRF mitigation) — 10 grep matches."

patterns-established:
  - "Provider test directory structure: test/providers/<name>/<file>.test.js + test/fixtures/<name>/*.json — analog ready for Phase 24 GitHubProvider tests"
  - "Spy fetch + spy logger helpers (makeFetch/makeSpyFetch/makeSpyLogger) inline in test file — no shared helpers module yet (YAGNI per VALIDATION.md Wave 0)"
  - "Dynamic import of logger-events from provider client (mirrors PlaneClient) — keeps LOG-12 invariant; static logger.js import explicitly forbidden"

requirements-completed:
  - GH-01

# Metrics
duration: 6min
completed: 2026-05-14
---

# Phase 23 Plan 02: GitHubClient + Auth Foundation Summary

**REST wrapper sobre `https://api.github.com` con PAT auth, rate-limit awareness, ETag/304 conditional fetch y error-code canónico — clase `GitHubClient` con 5 métodos en 333 LOC, 15 tests offline en verde, cero dependencias nuevas.**

## Performance

- **Duration:** ~6 min wall-time
- **Started:** 2026-05-14T08:29:00Z
- **Completed:** 2026-05-14T08:35:00Z
- **Tasks:** 5 (4 con commits + 1 pure-verification)
- **Files created:** 12 (1 client + 1 test + 10 fixtures)
- **Files modified:** 0

## Accomplishments

- `src/providers/github/client.js` (333 LOC): class `GitHubClient` con constructor + `request()` privado + 2 helpers internos (`parseRetryAfter`, `mapErrorCode`) + 5 métodos públicos async (`getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels`).
- 10 fixtures JSON redactados con `kodo-test`/`fixture-repo`: issue, issues-list (issue + PR mixed, Pitfall #2 doc), 304 placeholder, rate-limit-low, rate-limit-exceeded (429), unauthorized (401), forbidden (403 secondary), not-found (404), comment-created (201), labels-list. **Zero PATs.** Total ~4.5 KB.
- 15 tests offline en `test/providers/github/client.test.js` cubriendo verification map rows 01-10 + 2 extras (info-level NDJSON path, listLabels detail). Runtime leak guard instalado para detectar cualquier llamada a `globalThis.fetch` que no use el inyectado.
- **Suite full:** 617 baseline → 632 (+15 nuevos). `# fail 0`. Skip count sin cambios (1).
- **LOG-12 invariant preservada:** `node --test test/check-isolation.test.js` 4/4 pass. `src/check.js` no carga `client.js` transitivamente.
- **Color isolation preservada:** zero `picocolors` imports en `src/providers/github/` ni en `test/providers/github/`.

## Task Commits

Cada task committed atómicamente:

1. **Task 1: 10 GitHub fixtures redactadas** — `213d51a` (test)
2. **Task 2: Test skeleton + helpers + leak guard** — `f966417` (test)
3. **Task 3: GitHubClient class (333 LOC)** — `2d1af4a` (feat)
4. **Task 4: 15 tests covering verification map rows 01-10** — `de04048` (test)
5. **Task 5: Invariant verification (LOG-12 + picocolors + full suite)** — sin commit (pure verification: check-isolation green, picocolors absent, no static logger.js import, npm test 632/0fail)

_Note: TDD-style order is fixtures → test skeleton → impl → tests → verify. Skeleton (Task 2) commits BEFORE impl (Task 3), so the skeleton's import of `GitHubClient` would fail if executed between commits — this is intentional and documented in the plan's verify block ("test falla intencionalmente una vez Task 3 carga GitHubClient antes de que Task 5 lo cree")._

## Files Created/Modified

- `src/providers/github/client.js` — class GitHubClient (constructor + 5 async methods + private request + 2 helpers); zero retry/throttle; envelope 304 in listIssues only; dynamic import of logger-events (LOG-12-safe).
- `test/providers/github/client.test.js` — 15 it() tests with makeFetch/makeSpyFetch/makeSpyLogger helpers inline; runtime fetch-leak guard installed in before() / restored in after().
- `test/fixtures/github/*.json` — 10 redacted GitHub API response bodies (4.5 KB total).

## Decisions Made

- **Runtime fetch-leak guard.** The plan's `<critical_reminders>` (#4) required installing `globalThis.fetch = thrower` at top of test file to catch any test forgetting `opts.fetch`. The plan-level success criteria explicitly states this line is ALLOWED ("the leak-guard line is ALLOWED, the goal is no test invocations of fetch global"). Task 2/4 acceptance criteria of `grep -c globalThis.fetch === 0` was relaxed per the macro criterion. Implementation: install in `before()`, restore in `after()` — 5 occurrences of "globalThis.fetch" in the test file (3 in comments/docs, 1 install, 1 restore). All accepted under the macro rule.
- **15 tests instead of 14.** The plan's text says "14 it()" but the enumerated list in `<behavior>` adds up to 15 distinct scenarios (1 constructor + 2 getIssue/headers + 1 list 200 + 1 list 304 + 1 If-None-Match + 1 query params + 1 401 + 1 404 + 1 429 + 1 403 + 1 warn + 1 info + 1 addComment + 1 updateIssue + 1 listLabels = 15). I implemented all 15 (better coverage; still ≥ 8 from SC#4). Acceptance criterion `grep -c "^      it(" === 14` is interpreted as ≥ 14 (with 6-space indent specifier off-by-2; my code uses 2-space indent inside describe).
- **Status-304 helper inside request() rather than listIssues only.** The plan's sketch had the 304-envelope construction in `request()` (centralized), making `listIssues` simply pass through. I followed the sketch verbatim. Pitfall: `getIssue`, `addComment`, etc. never send `If-None-Match`, so GitHub won't return 304 to them; the path is unreachable in practice. Centralization is harmless and matches the sketch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Spec Inconsistency] Plan asks for 14 tests but enumerates 15 distinct scenarios**
- **Found during:** Task 4 (filling the verification map tests)
- **Issue:** Plan `<behavior>` block describes 14 numbered tests but the actual list (1 constructor + 6 listIssues variants + 4 error mapping + 2 NDJSON level + 3 mutator methods) sums to 15. Acceptance grep `grep -c "^      it(" === 14` is inconsistent with the enumerated list.
- **Fix:** Implemented all 15 enumerated tests; verified `grep -c "^  it(" === 15` (with 2-space indent inside `describe`). The plan-level SC#4 requires ≥ 8 tests, so 15 satisfies it.
- **Files modified:** test/providers/github/client.test.js
- **Verification:** 15 pass / 0 fail in client.test.js; full suite 632 pass.
- **Committed in:** de04048 (Task 4 commit)

**2. [Rule 1 - Spec Inconsistency] `grep -c "globalThis.fetch" === 0` contradicts critical_reminders runtime leak guard**
- **Found during:** Task 2 (test skeleton)
- **Issue:** Plan acceptance criterion (Task 2 + Task 4) requires `grep -c "globalThis.fetch" === 0`. Plan `<critical_reminders>` (#4) AND plan-level success criteria require installing a runtime guard `globalThis.fetch = () => { throw ... };` with restore in `after()`. These contradict directly.
- **Fix:** Followed the plan-level success criterion explicit reconciliation ("the leak-guard line is ALLOWED"). Installed the guard in `before()` and restored in `after()`. The file has 5 occurrences of `globalThis.fetch`: 3 are comments/docstring, 2 are guard install/restore (no functional invocations).
- **Files modified:** test/providers/github/client.test.js (top-of-file block)
- **Verification:** Suite passes; if any test omitted `opts.fetch`, the thrower would fail loud (verified by reviewing each `it()` ensures `fetch` injection).
- **Committed in:** f966417 (Task 2 commit)

**3. [Rule 1 - Spec Inconsistency] Task 1 acceptance criterion `kodo-test count >= 7` for fixtures**
- **Found during:** Task 1 (fixtures creation)
- **Issue:** Acceptance criterion `grep -l "kodo-test" test/fixtures/github/*.json | wc -l >= 7`. Only 5 fixtures legitimately contain `kodo-test` (data-bearing fixtures: issue, issues-list, rate-limit-low, comment-created, labels-list). The other 5 are pure error bodies (`{"message": "Bad credentials"}`, etc.) that have no owner/repo references — adding `kodo-test` to those would falsify real GitHub error responses.
- **Fix:** Kept 5 legitimate `kodo-test` references; left the 5 error-body fixtures verbatim per real GitHub responses. The intent of the criterion (PII redaction, no real owner names) is satisfied — `grep -l "ghp_\|github_pat_"` returns 0 archives, and no error-body contains anything attributable.
- **Files modified:** None (this is the intentional shape from the plan's `<action>` block).
- **Verification:** Manual review; all 10 fixtures JSON-parse; full suite green.
- **Committed in:** 213d51a (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3× Rule 1: spec inconsistencies between acceptance criteria and other plan text)
**Impact on plan:** All 3 deviations resolve internal contradictions in the plan itself, not external constraints. No scope creep. All Plan-level Success Criteria (SC#1-4) satisfied per `<success_criteria>` block.

## Issues Encountered

None. The 3 deviations above are spec-level — no execution problems.

## LOG-12 Invariant Evidence

```
$ node --test test/check-isolation.test.js
# tests 4 / # pass 4 / # fail 0

$ grep -E "^import.*from\s+['\"]\.\./\.\./logger\.js" src/providers/github/client.js
(no output — static import absent; only dynamic await import('../../logger-events.js') is used)

$ grep "^import" src/providers/github/client.js
import { getProviderApiKey } from '../../config.js';
```

The client imports `getProviderApiKey` from `config.js` (not in the `check.js` graph) and uses `await import('../../logger-events.js')` dynamically inside `request()` — the same pattern as `PlaneClient`. `src/check.js` does not transitively load `client.js`.

## Color Isolation Evidence

```
$ grep -rnE "from\s+['\"]picocolors" src/providers/github/ test/providers/github/ test/fixtures/github/ 2>/dev/null
(no output — picocolors not leaked)
```

## Full Suite Numbers

```
ℹ tests 632
ℹ suites 136
ℹ pass 631
ℹ fail 0
ℹ skipped 1
ℹ todo 0
```

Baseline before plan 23-02: 617 tests / 616 pass / 1 skipped (per 23-01-SUMMARY).
After plan 23-02: 632 tests / 631 pass / 1 skipped. **Delta = +15 tests, all passing.** Skip count unchanged (pre-existing skip in unrelated test file).

## Threat Mitigation Coverage

The plan's `<threat_model>` STRIDE register dispositions:

| Threat ID | Mitigation | Evidence |
|-----------|------------|----------|
| T-23-04 (PAT in Error/NDJSON) | mitigate | `Error.message` interpolates only `path` + 200-char snippet; NDJSON helpers in 23-01 emit fields without Authorization header value. No code path concatenates `this.token` into emitted strings. |
| T-23-05 (SSRF via owner/repo) | mitigate | `encodeURIComponent(owner)` + `encodeURIComponent(repo)` in all 5 methods. `grep -c encodeURIComponent === 10` (5 methods × 2 args). Blocks `..`, `?`, `#`, `/`. |
| T-23-06 (TLS downgrade) | accept | `opts.baseUrl` permitted for tests; production lock-in deferred to Phase 26 CFG-02. No HTTPS enforcement in v0.7 (accepted risk). |
| T-23-07 (DoS via fetch hang) | mitigate | `AbortSignal.timeout(10_000)` in `request()`. Verified: `grep -c "AbortSignal.timeout(10_000)" === 1`. |
| T-23-08 (rate-limit info in NDJSON) | accept | Intentional telemetry; `rate_limit_remaining` is public header data, no secrets. |

## Next Plan Readiness (Phase 24 — GitHubProvider)

- **Ready to consume:** `import { GitHubClient } from './providers/github/client.js'` works (verified). Phase 24's `createGitHubProvider({ token, logger })` will instantiate `new GitHubClient({ token, logger })` and wire its 5 methods through the 9-method TaskProvider contract.
- **Envelope contract:** Phase 25 polling consumes `listIssues({etag})` and reads `{status, items, etag, rate_limit_remaining}`. The shape is locked.
- **Error contract:** `.code === 'rate_limit_exceeded'` is the polling-loop's signal for backoff (POLL-04). Phase 24 normalizer can pass errors through unchanged.
- **Blockers/concerns:** None. Phase 24 can begin immediately.

## Self-Check

Verified:

- [x] `src/providers/github/client.js` exists (`ls` returns it, 333 lines)
- [x] `test/providers/github/client.test.js` exists (379 lines, 15 it() tests)
- [x] 10 fixtures in `test/fixtures/github/*.json` (all parseable)
- [x] Commit `213d51a` present in git log (Task 1)
- [x] Commit `f966417` present in git log (Task 2)
- [x] Commit `2d1af4a` present in git log (Task 3)
- [x] Commit `de04048` present in git log (Task 4)
- [x] `node --test test/providers/github/client.test.js` exit 0 (15 pass / 0 fail)
- [x] `node --test test/check-isolation.test.js` exit 0 (4 pass / 0 fail — LOG-12 canary green)
- [x] `npm test` final: 631 pass / 1 skipped / 0 fail / 632 total
- [x] zero `picocolors` imports under new src/providers/github/ and test/providers/github/ trees
- [x] zero static `from '../../logger.js'` imports in client.js (dynamic-only)

## Self-Check: PASSED

---
*Phase: 23-githubclient-auth-foundation*
*Plan: 02*
*Completed: 2026-05-14*
