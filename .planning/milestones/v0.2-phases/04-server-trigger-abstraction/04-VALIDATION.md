---
phase: 4
slug: server-trigger-abstraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node 20+ built-in) |
| **Config file** | None — uses `package.json` scripts |
| **Quick run command** | `node --test test/dispatcher.test.js test/webhook.test.js` |
| **Full suite command** | `node --test test/**/*.test.js` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dispatcher.test.js test/webhook.test.js`
- **After every plan wave:** Run `node --test test/**/*.test.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | TRIG-01 | unit | `node --test test/dispatcher.test.js` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | REWI-04 | integration | `node --test test/webhook.test.js` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | TRIG-02 | unit | `node --test test/webhook.test.js` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | TRIG-03 | unit | `node --test test/dispatcher.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/dispatcher.test.js` — stubs for TRIG-01, TRIG-03 (dispatchTrigger with webhook and manual events)
- [ ] `test/webhook.test.js` — stubs for REWI-04, TRIG-02 (pure webhook handler, signature verification delegation)
- [ ] Test fixtures: sample Plane webhook payloads (verify if already in `test/fixtures/`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end Plane webhook | TRIG-02 | Requires live Plane instance sending webhooks | Send test webhook via Plane UI, verify session launches |
| `kodo launch` CLI | TRIG-03 | Requires active task in provider | Run `kodo launch <ref>` against a real task, verify session |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
