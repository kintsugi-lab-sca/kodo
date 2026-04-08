---
phase: 2
slug: plane-adapter-registry
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (node:test) |
| **Config file** | None — uses `node --test test/**/*.test.js` |
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
| 02-01-01 | 01 | 1 | INTF-04 | unit | `node --test test/registry.test.js` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | PLAN-01 | unit | `node --test test/plane-provider.test.js` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | PLAN-02 | unit | `node --test test/normalize.test.js` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | PLAN-03 | unit | `node --test test/normalize.test.js` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 1 | PLAN-04 | unit | `node --test test/plane-provider.test.js` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 1 | PLAN-05 | unit | `node --test test/normalize.test.js` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | TEST-01 | unit | `node --test test/normalize.test.js` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | TEST-02 | unit | `node --test test/normalize.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/fixtures/plane-workitem.json` — real Plane API response fixture
- [ ] `test/fixtures/plane-webhook.json` — real Plane webhook payload fixture
- [ ] `test/fixtures/plane-labels.json` — project labels fixture
- [ ] `test/normalize.test.js` — covers PLAN-02, PLAN-03, PLAN-05, TEST-01, TEST-02
- [ ] `test/plane-provider.test.js` — covers PLAN-01, PLAN-04
- [ ] `test/registry.test.js` — covers INTF-04

*Existing infrastructure covers test framework — only test files and fixtures needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
