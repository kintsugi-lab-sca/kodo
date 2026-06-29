---
phase: 53
slug: fontaner-a-src-adopt-js
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-16
audited: 2026-06-24
---

# Phase 53 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node built-in test runner, no external deps) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/adopt.test.js test/state/save-state-atomic.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~115ms (targeted) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/adopt.test.js` (+ `test/state/` para saveState)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 53-01-01 | 01 | 1 | BIDIR-05 | T-53-01 | `saveState` escribe a tmp único y hace `renameSync` — no deja `.tmp` residual; `.bak` migration unaffected | unit | `node --test test/state/save-state-atomic.test.js` | ✅ | ✅ green |
| 53-02-01 | 02 | 1 | BIDIR-03/04/05/08 | T-53-03/05 | RED gate: 11 it() fallidos antes de que exista adopt.js (TDD) | unit | `node --test test/adopt.test.js 2>&1 \| grep -qE 'Cannot find module\|fail [1-9]' && echo RED` | ✅ | ✅ green (fase completada) |
| 53-02-02 | 02 | 2 | BIDIR-03 | T-53-03 | `adoptSession` retorna `{ok:true,task,session}` y siembra fila en state.json; 5-state never-throws discriminant | unit | `node --test test/adopt.test.js` | ✅ | ✅ green |
| 53-02-03 | 02 | 2 | BIDIR-04 | — | Re-adopt mismo sessionId retorna `ALREADY_ADOPTED` sin segundo createTask POST (call-counter === 1) | unit | `node --test test/adopt.test.js` | ✅ | ✅ green |
| 53-02-04 | 02 | 2 | BIDIR-05 | T-53-05 | `PERSIST_FAILED` lleva `task_id` + `task_url` cuando `addSession` lanza; nunca thrown, nunca swallowed | unit | `node --test test/adopt.test.js` | ✅ | ✅ green |
| 53-02-05 | 02 | 2 | BIDIR-08 | T-53-03 | `sanitizeAdoptionData` default title = basename(cwd); home→`~` boundary-anchored; abs-path strip; no-transcript structural; CR-01 regression (6 casos) | unit | `node --test test/adopt.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/adopt.test.js` — 20 it() cubriendo BIDIR-03/04/05/08 + CR-01 regression (6 casos boundary-anchored regex); HOME-isolated con dynamic import
- [x] `test/state/save-state-atomic.test.js` — 3 it() cubriendo BIDIR-05 atomicidad + .bak independence

*Existing `node:test` infrastructure covers the rest — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live POST a Plane CE crea work-item adoptada end-to-end | BIDIR-03/08 | Requiere instancia Plane CE live; unit tests mockean el 201 | ✅ Cubierto por D-07 smoke test de Phase 52 (2026-06-16) + `kodo adopt` vía Phase 54 CLI. Comportamiento live validado en UAT Phase 56. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (pre-existing coverage) |
| Escalated to manual-only | 0 (live E2E cubierto por Phase 54/56 UAT) |
| Requirements covered | 4/4 (BIDIR-03, BIDIR-04, BIDIR-05, BIDIR-08) |
| Tests run | 30 pass / 0 fail (adopt.test.js × 20 + save-state-atomic × 3 + 7 otras) |
