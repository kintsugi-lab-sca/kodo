---
phase: 53
slug: fontaner-a-src-adopt-js
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 53 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in `node --test`) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/adopt.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/adopt.test.js` (+ `test/state/` for the saveState upgrade)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Planner fills this from PLAN.md task IDs. Reference rows below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 53-01-XX | 01 | 1 | BIDIR-05 | — | `saveState` write is atomic (tmp+rename); no partial state.json | unit | `node --test test/state/` | ❌ W0 | ⬜ pending |
| 53-02-XX | 02 | 2 | BIDIR-03 | — | `adoptSession` returns `{ok:true,task,session}` and seeds state.json | unit | `node --test test/adopt.test.js` | ❌ W0 | ⬜ pending |
| 53-02-XX | 02 | 2 | BIDIR-04 | — | re-run on adopted session returns `ALREADY_ADOPTED`, no POST | unit | `node --test test/adopt.test.js` | ❌ W0 | ⬜ pending |
| 53-02-XX | 02 | 2 | BIDIR-05 | — | POST-ok / local-write-fail returns `PERSIST_FAILED` with task_id+task_url | unit | `node --test test/adopt.test.js` | ❌ W0 | ⬜ pending |
| 53-02-XX | 02 | 2 | BIDIR-08 | — | sanitize strips abs paths / redacts home / default title basename(cwd) | unit | `node --test test/adopt.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/adopt.test.js` — net-new; covers BIDIR-03/04/05/08 (mock provider.createTask, in-memory/temp state)
- [ ] Reuse existing mock-provider helpers from `test/providers/` (Phase 52 contract tests) where applicable

*Existing `node:test` infrastructure covers the rest — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live POST to Plane CE creates a real adopted work-item end-to-end | BIDIR-03/08 | Requires live Plane CE instance; unit tests mock the 201 | `kodo adopt` smoke once Phase 54 ships (deferred to consumer) |

*All core `adoptSession` logic has automated unit coverage; only the live-endpoint round-trip is manual (and belongs to the Phase 54 consumer).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
