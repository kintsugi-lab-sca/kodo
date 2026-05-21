---
phase: 25
slug: polling-trigger-channel
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `25-RESEARCH.md` § "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node.js stdlib) + `node:assert/strict` |
| **Config file** | None — `package.json` `scripts.test` runs `node --test` |
| **Quick run command** | `node --test test/triggers/polling.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | < 1s polling.test.js (clock-mock); ~6-8s full suite |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/triggers/polling.test.js test/check-isolation.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green (baseline post-Phase-24 = 682 pass; Phase 25 target ≈ 707 pass with ~25 new polling tests, zero regressions)
- **Max feedback latency:** < 1s (polling.test.js), < 10s (npm test)

---

## Per-Task Verification Map

> Task IDs (`25-NN-MM`) are placeholders — planner will assign exact IDs.
> Mapping is per requirement; planner allocates the test to the plan that creates/extends the production code.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-NN | 01 | 1 | TEST-02 | — | `polling.tick/dispatch/error` events allowed in closed taxonomy | unit | `node --test test/logger-events.test.js -g "polling"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-01 | — | `startPolling` returns `{stop}`; loop schedules next tick after `intervalSec` virtual seconds | unit (clock-mock) | `node --test test/triggers/polling.test.js -g "startPolling signature\|schedules next tick"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-01 | — | `stop()` cancels pending timer; no further ticks | unit | `node --test test/triggers/polling.test.js -g "stop cancels loop"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-02 | T-25-01 (Corrupted state crashes loop) | `loadStateCache` returns `{}` on missing/corrupted JSON; fail-open never throws | unit | `node --test test/triggers/polling.test.js -g "loadStateCache"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-02 | — | Atomic write: tmp file created, then renamed; no partial state on crash | unit | `node --test test/triggers/polling.test.js -g "atomic write"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-02 | — | `304` response does NOT update cursor (cache unchanged pre/post tick) | integration | `node --test test/triggers/polling.test.js -g "304 preserves cursor"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-02 | — | `200` response advances cursor to max(`updated_at`) of returned items | integration | `node --test test/triggers/polling.test.js -g "200 advances cursor"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-03 | — | First tick: NO dispatch; cursor populated only (avoids storm) | unit | `node --test test/triggers/polling.test.js -g "first tick skips dispatch"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-03 | — | Pattern (a) — new issue with `kodo` label fires `dispatchTrigger` once | integration | `node --test test/triggers/polling.test.js -g "dispatches new issue"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-03 | — | Pattern (b) — existing issue updated since cursor fires dispatch | integration | `node --test test/triggers/polling.test.js -g "dispatches updated issue"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-03 | — | Pattern (c) — state change (`updated_at` advances) reaches dispatcher (downstream filtering handled by Phase 8) | integration | `node --test test/triggers/polling.test.js -g "dispatches on updated_at change"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-03 | — | Idempotency — dispatch is fire-and-forget; rejected dispatch does NOT propagate to loop | unit | `node --test test/triggers/polling.test.js -g "dispatchTrigger fire-and-forget"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-03 | — | PR filtering — items with `pull_request !== null` skipped (uses `provider.listPendingTasks` D-25 path; explicit when using client direct path) | unit | `node --test test/triggers/polling.test.js -g "filters PRs"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-04 | — | `429` → emit `polling.error{attempt:1}`, virtual sleep 2s, retry | unit (clock-mock) | `node --test test/triggers/polling.test.js -g "retries on 429"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-04 | — | `5xx` (500/502/503/504) → same exponential retry path (2s, 4s, 8s) | unit | `node --test test/triggers/polling.test.js -g "retries on 5xx"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-04 | — | Network error (`AbortError`, `ETIMEDOUT`) → retry path | unit | `node --test test/triggers/polling.test.js -g "retries on network error"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-04 | — | 3 retries exhausted → warn-and-continue; loop schedules next tick (does NOT propagate) | unit | `node --test test/triggers/polling.test.js -g "warn-and-continue after 3 retries"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-04 | — | 4xx non-transient (401, 404) → emit `polling.error` ONCE; no retry; continue next repo | unit | `node --test test/triggers/polling.test.js -g "no retry on non-transient"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | POLL-04 | — | Wall-time of full retry test < 1s (proves clock injection works; no real timers) | meta | implicit — overall suite duration | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | TEST-02 | — | NDJSON `polling.tick` emitted per repo with `{owner, repo, status, dispatched}` | unit | `node --test test/triggers/polling.test.js -g "emits polling.tick"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | TEST-02 | T-25-02 (Token leak in NDJSON) | `polling.dispatch` event includes `{owner, repo, ref, pattern}` ONLY — NO `issue.body` or user text content | unit | `node --test test/triggers/polling.test.js -g "polling.dispatch excludes body"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | TEST-02 | — | NDJSON `polling.error` emitted with `{owner, repo, status, attempt}` on all retry+exhaustion paths | unit | `node --test test/triggers/polling.test.js -g "emits polling.error"` | ❌ W0 | ⬜ pending |
| 25-02-NN | 02 | 2 | TEST-02 | — | LOG-12 — `src/check.js` does NOT import `src/triggers/polling.js` transitively (extends existing isolation walker) | unit | `node --test test/check-isolation.test.js -g "polling.js"` | ❌ W0 (extend existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/triggers/polling.test.js` — new test file covering POLL-01..04 + TEST-02 (~22-25 cases)
- [ ] `test/triggers/` — directory does NOT exist yet (only `test/providers/github/` and flat `test/` exist); planner must create dir alongside polling.test.js
- [ ] `test/check-isolation.test.js` — extend existing file with `polling.js` LOG-12 walker filter (precedent: Phase 24 D-29 added `provider.js` filter — mirror that)
- [ ] `src/logger-events.js` — extend closed event taxonomy with `polling.tick`, `polling.dispatch`, `polling.error` helpers (mirror Phase 23-01 pattern: `githubApiCall` / `githubApiCallFailed`)
- [ ] `test/logger-events.test.js` — assert the 3 new event helpers exist + emit shape contracts
- [ ] Reuse `test/fixtures/github/issues-list.json` (2 issues + 1 PR) for dispatch-pattern tests; add `test/fixtures/github/issues-list-304.json` and `test/fixtures/github/issues-list-deltas.json` if needed for cursor tests

*Wave 0 is owned by Plan 25-01 (logger events extension); Plan 25-02 (core polling.js + tests) consumes it.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real polling against `api.github.com` discovers issue with label `kodo` and triggers a session | POLL-01, POLL-03 | Live API + cross-repo coordination + worktree spawn is end-to-end; the unit suite covers all dispatch contracts via fakeClient | Manual UAT will be drafted as part of `/gsd-verify-work`. Will be covered in Phase 26 CLI (`kodo orchestrator --polling`) — defer here. |
| Concurrent polling + webhook on same repo coalesces via lock per-repo | POLL-03 + Phase 8 GSD-10 | Requires 2 running processes on a real repo with a real label flip | Will be exercised in Phase 27 cross-provider matrix or operator dogfood. |
| Behavior over time-series (24h of polling without drift / leak) | POLL-04, TEST-02 | Long-running observation | Skip — out of scope for v0.7; observed during operator use. |

*All other phase behaviors have automated verification via clock-mocked unit/integration tests.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (LOG-12 task extends existing file → not Wave 0)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`polling.test.js`, `test/triggers/` dir, new logger-events helpers)
- [ ] No watch-mode flags
- [ ] Feedback latency < 1s (polling.test.js with clock-mock)
- [ ] `nyquist_compliant: true` set in frontmatter after sign-off

**Approval:** pending — auto-generated 2026-05-14 from `25-RESEARCH.md`. Planner may refine task IDs once `25-01-PLAN.md` / `25-02-PLAN.md` exist.
