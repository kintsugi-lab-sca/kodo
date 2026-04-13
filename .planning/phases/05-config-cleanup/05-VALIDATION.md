---
phase: 5
slug: config-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none (scripts.test in package.json) |
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
| 05-01-01 | 01 | 1 | CONF-01 | unit | `node --test test/migration.test.js` | Partially | ⬜ pending |
| 05-01-02 | 01 | 1 | CONF-02 | unit | `node --test test/migration.test.js` | ✅ | ⬜ pending |
| 05-01-03 | 01 | 1 | CONF-03 | manual-only | N/A (interactive readline) | N/A | ⬜ pending |
| 05-01-04 | 01 | 1 | CONF-04 | unit | `node --test test/prompt.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/prompt.test.js` — covers CONF-04 (verify no hardcoded Plane references in resolved prompt)
- [ ] `test/migration.test.js` — extend to cover CONF-01 (provider field presence and registry selection)
- [ ] `test/interface.test.js` — extend to include `listProjects` in TASK_PROVIDER_METHODS check

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wizard provider selection flow | CONF-03 | Interactive readline prompts cannot be automated in node:test | 1. Run `kodo config` 2. Verify provider selection prompt appears 3. Select provider, enter credentials 4. Verify config.json written with correct provider field |
| First-run auto-wizard | CONF-03 | Requires absence of config.json + full CLI bootstrap | 1. Remove config.json 2. Run `kodo check` 3. Verify wizard launches automatically 4. Complete wizard 5. Verify original command resumes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
