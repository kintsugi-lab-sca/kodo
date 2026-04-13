---
phase: 3
slug: consumer-rewiring
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (node:test) |
| **Config file** | None (script in package.json) |
| **Quick run command** | `node --test test/**/*.test.js` |
| **Full suite command** | `node --test test/**/*.test.js` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/**/*.test.js`
- **After every plan wave:** Run `node --test test/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | REWI-01 | integration | `node --test test/check.test.js` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | REWI-05 | unit | `node --test test/session-start.test.js` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | REWI-02 | integration | `node --test test/stop.test.js` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | REWI-03 | integration | `node --test test/manager.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/check.test.js` — mock provider, verify no PlaneClient import, REWI-01
- [ ] `test/session-start.test.js` — verify generic field names, mcp_hint, REWI-05
- [ ] `test/stop.test.js` — mock provider, verify defensive error handling, REWI-02
- [ ] `test/manager.test.js` — mock provider, verify TaskItem-based session, REWI-03

*Existing tests (`registry.test.js`, `plane-provider.test.js`) demonstrate the mocking pattern with `clearRegistry()` + `registerProvider()`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ANSI colors in check.js output | REWI-01 | Visual output verification | Run `kodo check` and verify green/yellow/red output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
