---
phase: 54
slug: cli-kodo-adopt
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-16
---

# Phase 54 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, `node --test`) |
| **Config file** | none — package.json `test` script |
| **Quick run command** | `node --test test/adopt-cli.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~quick: <2s · full: ~30s |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/adopt-cli.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds (full suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T1 | 54-01 | 1 | BIDIR-07 | T-54-04 | Test Wave 0: exit-code map (6 shapes) + render éxito/fallo + --json byte-det + projectPath unmapped (RED hasta T2) | unit | `node --test test/adopt-cli.test.js` | ❌ W0 | ⬜ pending |
| T2 | 54-01 | 1 | BIDIR-07 | T-54-01 / T-54-02 | Handler runAdoptCli: exit ok/ALREADY→0, INVALID/UNSUPPORTED/PERSIST→1, CREATE→2; PERSIST_FAILED LOUD stderr; --project unmapped fail-fast antes del POST | unit | `node --test test/adopt-cli.test.js` | ✅ (GREEN tras T2) | ⬜ pending |
| T3 | 54-01 | 1 | BIDIR-07 (invariante) | — | src/cli/adopt.js importa format.js, nunca picocolors (color isolation) | static | `node --test test/format-isolation.test.js` | ✅ extend PHASE_15_CALLSITES | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Planner: populate from RESEARCH.md §"Validation Architecture". Observable behaviors to cover:
> exit-code mapping per discriminant state (ok→0, ALREADY_ADOPTED→0, INVALID_INPUT/UNSUPPORTED→1, PERSIST_FAILED→1 LOUD, CREATE_FAILED→2);
> human render of success (task_id/task_url/session_id) and failure (code/detail); `--json` byte-determinism;
> projectPath resolution from `loadProjects()[projectId]` + usage error when unmapped. All unit-testable via DI stubs (adoptSessionFn/writeFn/errFn/formatterFn).

---

## Wave 0 Requirements

- [ ] `test/adopt-cli.test.js` — DI-stubbed handler tests for BIDIR-07 (exit-code map + render + --json), mirror of `test/gsd-verify-cli-handler.test.js`

*Existing node:test infrastructure covers the framework; only the new test file is needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `bin/kodo adopt --help` renders | BIDIR-07 | Smoke confidence in real commander wiring | Run `bin/kodo adopt --help`; expect usage with all flags |

*The CLI is deterministic and fully unit-testable via DI — the --help smoke is a nicety, not a gate. No human UAT strictly required.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (planner) — nyquist_compliant=true; Wave 0 (test/adopt-cli.test.js) cubre todas las refs MISSING; sampling continuo (cada task tiene <automated>); sin watch-mode; latencia <30s.
