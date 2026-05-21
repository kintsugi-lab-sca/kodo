---
phase: 23
slug: githubclient-auth-foundation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The planner fills the Per-Task Verification Map after PLAN.md tasks are defined.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 20+) + `node:assert/strict` |
| **Config file** | none — runner built into Node |
| **Quick run command** | `node --test test/providers/github/client.test.js test/logger-events.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~1s; full ~3-4s (baseline v0.6) |

---

## Sampling Rate

- **After every task commit:** Run quick command (focused on file(s) touched).
- **After every plan wave:** Run full suite (`npm test`) — must be green before moving to next wave.
- **Before `/gsd-verify-work`:** Full suite green AND zero live API calls (assertion injected in tests).
- **Max feedback latency:** ≤ 5 seconds wall-time per quick run.

---

## Per-Task Verification Map

> The planner replaces this stub table after PLAN.md tasks are defined. Each row maps task → automated verify command + GH-01 success criterion ref. Wave 0 covers test helper scaffolding (fixture-loader, fake-fetch builder) if not already present.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-01-01 | 01 | 1 | GH-01 / SC#2 | — | `githubApiCall` emits warn level when rate_limit_remaining < 100; info otherwise | unit | `node --test test/logger-events.test.js` | ❌ W0 | ⬜ pending |
| 23-01-02 | 01 | 1 | GH-01 / SC#2 | — | `githubApiCallFailed` emits error-level with `{method, path, status, error}` fields | unit | `node --test test/logger-events.test.js` | ❌ W0 | ⬜ pending |
| 23-02-01 | 02 | 2 | GH-01 / SC#1 | — | `GitHubClient` constructor throws when token unset (no live env access in test) | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-02 | 02 | 2 | GH-01 / SC#1 | — | `getIssue(owner, repo, number)` returns raw payload (id, number, body, labels, state) | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-03 | 02 | 2 | GH-01 / SC#3 | — | `listIssues(...)` 200 path returns `{status:200, items, etag, rate_limit_remaining}` | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-04 | 02 | 2 | GH-01 / SC#3 | — | `listIssues({etag})` 304 path returns `{status:304, items:[], etag, rate_limit_remaining}` without throwing | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-05 | 02 | 2 | GH-01 / SC#2 | — | 429 response throws `Error` with `.code === 'rate_limit_exceeded'`, `.status === 429`, `.retryAfter` populated when header present | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-06 | 02 | 2 | GH-01 / SC#2 | — | When `X-RateLimit-Remaining < 100`, helper emits warn-level NDJSON (verified via logger sink spy) | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-07 | 02 | 2 | GH-01 / SC#1 | — | `addComment(owner, repo, number, body)` issues `POST` with markdown body intact | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-08 | 02 | 2 | GH-01 / SC#1 | — | `updateIssue(owner, repo, number, {state})` issues `PATCH` with body payload | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-09 | 02 | 2 | GH-01 / SC#1 | — | `listLabels(owner, repo)` returns array of `{id, name, color}` raw entries | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-10 | 02 | 2 | GH-01 / SC#1 | — | 401/403/404/410/422/5xx map to canonical `Error.code` values (table-driven test) | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-11 | 02 | 2 | GH-01 / SC#4 | — | All 9+ fixtures load via fixture-loader helper; zero live `fetch` calls in suite | unit | `node --test test/providers/github/client.test.js` | ❌ W0 | ⬜ pending |
| 23-02-12 | 02 | 2 | invariant | — | `kodo check` does NOT transitively import `src/providers/github/client.js` (LOG-12 guard preserved) | integration | `node --test test/check-isolation.test.js` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/providers/github/client.test.js` — file does not yet exist; created in plan 23-02 task 1.
- [ ] `test/providers/github/__helpers/fake-fetch.js` (or inline in test file) — factory `makeFetch(scenario)` returning Response-like with `.status`, `.ok`, `.headers`, `.json()`, `.text()`.
- [ ] `test/providers/github/__helpers/load-fixture.js` (or inline) — reads `test/fixtures/github/*.json` synchronously.
- [ ] `test/fixtures/github/` directory + 9 JSON fixtures (issue, issues-list, issues-list-304, rate-limit-low, rate-limit-exceeded, unauthorized-401, forbidden-403, not-found-404, comment-created, labels-list).
- [ ] `test/logger-events.test.js` — update existing EVENTS array assertion from 13 to 15 entries; add 2 test cases for `githubApiCall` (info+warn switch) and `githubApiCallFailed`.

*Existing infrastructure (`node:test`, `node:assert/strict`, repo-level `npm test` script) covers the framework requirement — only fixtures and helpers are net-new.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Token redaction in NDJSON | GH-01 / SC#2 implicit | Existing redactor (Phase 6) is the contract owner; Phase 23 only verifies via grep that NDJSON output never contains the raw PAT string | After running suite, `grep -i "ghp_\|github_pat_" ~/.kodo/logs/*.ndjson` should return zero matches |
| GitHub API contract drift | GH-01 / SC#1 | If GitHub changes header names or response shape, fixtures become stale | Quarterly: re-run `scripts/capture-github-fixtures.js` (if plan 23-03 ships) against the canonical test repo and diff |

*All automated phase behaviors are covered by the test commands above. Manual items are guardrails, not blockers for phase verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify OR Wave 0 dependencies listed
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 1 + Wave 2 tasks each cover their own files)
- [ ] Wave 0 covers all MISSING references (test/providers/github/ dir + fixtures)
- [ ] No watch-mode flags (`node:test` runs once and exits)
- [ ] Feedback latency < 5s per quick run
- [ ] `nyquist_compliant: true` set in frontmatter after plan-checker pass

**Approval:** pending
