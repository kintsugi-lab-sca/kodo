---
phase: 8
slug: gsd-label-session-plumbing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node 25.x built-in) |
| **Config file** | `tests/` directory — existing convention |
| **Quick run command** | `node --test tests/unit/**/*.test.js` |
| **Full suite command** | `node --test tests/` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/unit/**/*.test.js`
- **After every plan wave:** Run `node --test tests/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | GSD-01 | — | N/A | unit | `node --test tests/unit/session-state.test.js` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | GSD-01 | — | N/A | unit | `node --test tests/unit/manager.test.js` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | GSD-10 | T-08-01 | Lock acquired atomically; stale locks auto-released | unit | `node --test tests/unit/gsd-lock.test.js` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | GSD-10 | T-08-02 | Concurrent sessions rejected with holder info | integration | `node --test tests/integration/gsd-lock-concurrency.test.js` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 2 | GSD-04 | — | N/A | unit | `node --test tests/unit/session-start-gsd.test.js` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 2 | GSD-10 | T-08-03 | Lock released on session stop | unit | `node --test tests/unit/stop-hook-lock.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/gsd-lock.test.js` — stubs for GSD-10 lock acquire/release/steal
- [ ] `tests/unit/session-start-gsd.test.js` — stubs for GSD-04 context injection
- [ ] `tests/integration/gsd-lock-concurrency.test.js` — stubs for concurrent lock rejection

*Existing test infrastructure (node:test) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Plane webhook → GSD session | GSD-01 + GSD-04 | Requires live Plane webhook + Claude Code session | 1. Create task with `kodo:gsd` label in Plane 2. Trigger webhook 3. Verify session starts with GSD context injected |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
