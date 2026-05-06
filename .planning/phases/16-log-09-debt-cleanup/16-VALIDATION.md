---
phase: 16
slug: log-09-debt-cleanup
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Reconstructed from artifacts** (post-execution audit) — Phase 16 already shipped
> green; this document closes the Nyquist loop by mapping every requirement / SC
> to its automated verification.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node.js built-in test runner) |
| **Config file** | none — `package.json` script only |
| **Quick run command** | `node --test test/dispatcher-isolation.test.js test/gsd-verify-integration.test.js test/stop-state-transition.test.js test/check-isolation.test.js` |
| **Full suite command** | `npm test` (i.e. `node --test test/**/*.test.js`) |
| **Estimated runtime** | ~0.2 s (Phase 16 subset) · ~6 s (full suite, 507 tests) |

---

## Sampling Rate

- **After every task commit:** Run the quick command above (4 files, ~0.2 s).
- **After every plan wave:** Run `npm test` (full suite).
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** ~6 s (full suite).

---

## Per-Task Verification Map

| Task ID    | Plan | Wave | Requirement       | Threat Ref          | Secure Behavior                                                                                                                                | Test Type        | Automated Command                                                                                  | File Exists | Status   |
|------------|------|------|-------------------|---------------------|------------------------------------------------------------------------------------------------------------------------------------------------|------------------|----------------------------------------------------------------------------------------------------|-------------|----------|
| 16-01-T1   | 01   | 1    | LOG-13 (SC#1)     | T-16-01 / T-16-05   | `dispatcher.js` migrates 4 runtime literals `'gsd.phase.resolved'` to `EVENTS.GSD_PHASE_RESOLVED`; preserves payload shape byte-for-byte; LOG-12 invariant intact | unit (existing)  | `node --test test/dispatcher.test.js test/check-isolation.test.js`                                  | ✅          | ✅ green |
| 16-01-T2   | 01   | 1    | LOG-13 (SC#1)     | T-16-04             | Source-hygiene guard: 3 comment-aware asserts block regression of `'gsd.phase.resolved'` / `'gsd.bootstrap'` literals + enforce eager `EVENTS` import | unit (new)       | `node --test test/dispatcher-isolation.test.js`                                                    | ✅          | ✅ green |
| 16-02-T1   | 02   | 1    | LOG-14 (SC#2)     | T-16-06 / T-16-11   | `verify.js#finalize` invokes `markSessionStatus(session.task_id, 'review', 'gate-passed', log)` ONLY in pass + addComment OK + updateTaskState OK (D-11 order) | unit (existing)  | `node --test test/gsd-verify-integration.test.js test/gsd-verification.test.js`                    | ✅          | ✅ green |
| 16-02-T2   | 02   | 1    | LOG-14 (SC#2/SC#3)| T-16-08             | 1 positive assert (T20) + 6 negative asserts (T21 soft-fail, T26 hard-fail, T22 malformed, T23 missing, T24 getTask-fail, T27 updateTaskState-fail). B-1 enforced: soft+hard tests separados | integration      | `node --test test/gsd-verify-integration.test.js`                                                  | ✅          | ✅ green |
| 16-03-T1   | 03   | 1    | LOG-15 (SC#4)     | T-16-12 / T-16-15 / T-16-19 | `stop.js` emits `markSessionStatus(... 'done', 'session-stop:lock-released' ...)` PRE-release inside `if (session.gsd)`, in silent try/catch; sessionEnd preserved BEFORE removeSession (W-2); no `session.gsd_mode` access (Phase 13 invariant) | unit (existing)  | `node --test test/stop.test.js test/manager.test.js test/check-isolation.test.js`                  | ✅          | ✅ green |
| 16-03-T2   | 03   | 1    | LOG-15 (SC#5)     | T-16-13 / T-16-14   | 4 SC#5 scenarios with W-4 DI: full review→done (D-05), quick running→done, non-GSD no-emit (D-07), D-04 invariant MANDATORY (both modes emit `to='done'` fixed) | integration (new)| `node --test test/stop-state-transition.test.js`                                                   | ✅          | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* `node --test` ships with Node.js; no framework install needed. All test files live alongside the source under `test/` and are discovered by the `npm test` glob.

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

Three manual sanity checks are recorded in the verification report (`16-VERIFICATION.md`) for runtime spot-checking on a real `~/.kodo/state.json` + NDJSON log, but they are not gating — every observable truth is also covered by the automated tests above:

- `kodo gsd verify <session-id>` against a real pass session emits `state.transition` in NDJSON (covered by T20 automated).
- `kodo` stop hook on a real GSD full session emits `from=review to=done` in NDJSON (covered by Test 1 of `test/stop-state-transition.test.js` automated).
- `kodo` stop hook on a real non-GSD session emits NO `state.transition` (covered by Test 3 automated).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task above has its own command)
- [x] Wave 0 covers all MISSING references (none — existing infra)
- [x] No watch-mode flags
- [x] Feedback latency < 10 s (full suite ~6 s; quick subset ~0.2 s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-06

---

## Validation Audit 2026-05-06

| Metric          | Count |
|-----------------|-------|
| Gaps found      | 0     |
| Resolved        | 0     |
| Escalated       | 0     |
| Tests verified  | 107/107 pass (Phase 16 + adjacent files) |
| Full suite      | 507 tests, 506 pass, 1 skip (pre-existing Decisión B Phase 6 startup-budget), 0 fail |

State B reconstruction from `16-01-SUMMARY.md`, `16-02-SUMMARY.md`, `16-03-SUMMARY.md`, and `16-VERIFICATION.md`. Every requirement (LOG-13/14/15) maps 1:1 to a green automated command. No auditor spawn required — Nyquist coverage already complete at execution time.
