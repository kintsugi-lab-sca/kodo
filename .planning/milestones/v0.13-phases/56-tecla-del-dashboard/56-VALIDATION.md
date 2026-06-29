---
phase: 56
slug: tecla-del-dashboard
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-17
---

# Phase 56 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) + node:assert/strict + ink-testing-library |
| **Config file** | none — `node --test` discovers `test/**/*.test.js` |
| **Quick run command** | `node --test test/dashboard/` |
| **Full suite command** | `node --test` |
| **Estimated runtime** | ~24 seconds (full suite) |

> NOTE: the test directory is `test/dashboard/` (verified — earlier draft said `test/cli/dashboard/`, which does not exist).

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dashboard/`
- **After every plan wave:** Run `node --test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 56-01-01 | 01 | 1 | DETECT-02 | — | Failing scaffolds prove assertions exercise real behavior (RED) | unit | `node --test test/dashboard/adopt.test.js test/dashboard/select-adopt.test.js` | ❌ W0 | ⬜ pending |
| 56-01-02 | 01 | 1 | DETECT-02 | T-56-01 / T-56-02 / T-56-04 | execFile no-shell + literal argv via process.execPath + absolute kodoBin; never-rejects; leak guard | unit | `node --test test/dashboard/adopt.test.js` | ❌ W0 | ⬜ pending |
| 56-01-03 | 01 | 1 | DETECT-02 | T-56-03 | Diff keyed by sessionId never workspaceRef; reverse-lookup is pure string-compare (no FS access) | unit | `node --test test/dashboard/select-adopt.test.js test/dashboard/select-dismiss.test.js` | ❌ W0 | ⬜ pending |
| 56-02-01 | 02 | 2 | DETECT-02 | — | Failing integration scaffold (RED) with 80ms drain (not setImmediate) | integration | `node --test test/dashboard/app-adopt.test.js` | ❌ W0 | ⬜ pending |
| 56-02-02 | 02 | 2 | DETECT-02 | T-56-05 / T-56-06 / T-56-08 / T-56-09 | typeof-gated fail-open discovery; confirm-key routed by armed-id (no dismiss/adopt collision); no/ambiguous project blocks shell; never-throws (panel mounted) | integration | `node --test test/dashboard/app-adopt.test.js test/dashboard/app-dismiss.test.js test/dashboard/app-open.test.js` | ❌ W0 | ⬜ pending |
| 56-02-03 | 02 | 2 | DETECT-02 | T-56-07 | In-process host wiring (no endpoint); kodoBin absolute (no PATH lookup) via process.execPath; server untouched | structural+integration | `node --test test/dashboard/ && git diff --stat src/server.js` (must be empty) | ✅ walker / ❌ W0 app-adopt | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test fakes for `execFile` (inject, never touch real child_process) — mold of `test/dashboard/open.test.js` / `focus.test.js` (Plan 01 Task 1)
- [ ] Pure-derive unit scaffolds for `computeAdoptable` + `resolveProjectId` (Plan 01 Task 1)
- [ ] Host stub returning `AgentSurface[]` — inline `onAdoptDiscover` stub (App-level) or reuse `test/host/contract.test.js` fixtures (`surface-resume-show.json`) (Plan 02 Task 1)
- [ ] `drain()` helper (~80ms) for ink async-handler tests (Pitfall 1) — NOT `setImmediate` (Plan 02 Task 1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tecla `a` → discover → picker → double-confirm → `kodo adopt` shelled, fila aparece en el próximo `/status` | DETECT-02 | Requiere una sesión claude ad-hoc viva en cmux + un TTY real; el shell de `kodo adopt` muta `state.json` y el provider | Lanzar `kodo dashboard` con una sesión ad-hoc no trackeada; pulsar `a`; verificar el picker, el cursor seleccionable, el double-confirm, el footer verde, y que la sesión aparece trackeada en el siguiente poll |

*The destructive double-confirm (mirror Phase 42) likely warrants a HUMAN-UAT like dismiss did — the automated app-adopt.test.js covers the state machine with stubs; only the live cmux+TTY path is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (planner-filled)
