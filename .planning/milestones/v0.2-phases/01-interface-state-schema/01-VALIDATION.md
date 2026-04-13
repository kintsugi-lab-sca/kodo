---
phase: 1
slug: interface-state-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, already configured) |
| **Config file** | package.json `scripts.test` |
| **Quick run command** | `node --test test/migration.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INTF-01 | unit | `node --test test/interface.test.js` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | INTF-02 | unit | `node --test test/interface.test.js` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | INTF-03 | unit | `node --test test/interface.test.js` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | STAT-01,02,03 | unit | `node --test test/migration.test.js` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | STAT-04 | unit | `node --test test/migration.test.js` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | TEST-03 | unit | `node --test test/migration.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/interface.test.js` — stubs for INTF-01, INTF-02, INTF-03
- [ ] `test/migration.test.js` — stubs for STAT-01, STAT-02, STAT-03, STAT-04, TEST-03

*Existing test infrastructure (node:test, package.json) covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| @ts-check validates typedef | INTF-01 | Editor behavior | Open interface.js in VS Code, verify no @ts-check errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
