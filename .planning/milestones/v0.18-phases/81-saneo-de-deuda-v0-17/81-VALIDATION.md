---
phase: 81
slug: saneo-de-deuda-v0-17
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-07-24
---

# Phase 81 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, `node --test`) |
| **Config file** | none — package.json `test` script |
| **Quick run command** | `node --test test/state/handoff-state.test.js test/dashboard/format.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~120 seconds (suite completa ~2356 tests) |

---

## Sampling Rate

- **After every task commit:** Run `{quick run command}`
- **After every plan wave:** Run `{full suite command}`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 81-01 T1 (writer tres estados) | 81-01 | 1 | DEBT-01 | T-81-01-01/02 | `next` nunca logueado; merge bajo `withStateLock` | unit | `node --test test/state/handoff-state.test.js` | ✅ | ⬜ pending |
| 81-01 T2 (mapeo autoría caller) | 81-01 | 1 | DEBT-01 | T-81-01-03 | `effectiveNext` = valor post-merge (nudge LIVE-07) | unit | `node --test test/hooks/session-end-handoff.test.js test/hooks/session-end.test.js` | ✅ | ⬜ pending |
| 81-02 T1 (colapso nextCell) | 81-02 | 1 | DEBT-03 | T-81-02-01 | colapso `/\s+/g`→' '+trim en render; dato verbatim | unit | `node --test test/dashboard-format.test.js` | ✅ | ⬜ pending |
| 81-02 T2 (doc-drift) | 81-02 | 1 | DEBT-02 | T-81-02-03 | doc-only; cero-cambio (suite verde sin modificar) | regression | `node --test $(find test -name '*.test.js' -type f)` | ✅ | ⬜ pending |
| 81-03 T1 (repro flaky) | 81-03 | 1 | DEBT-04 | T-81-03-01/02 | `lock.js` READ-ONLY; observación pura | manual/loop | `for i in $(seq 1 50); do node --test test/gsd-lock-race.test.js || break; done` | ✅ | ⬜ pending |
| 81-03 T2 (artefacto diagnóstico) | 81-03 | 1 | DEBT-04 | T-81-03-01/02 | artefacto + `git diff --quiet -- src/gsd/lock.js` | manual/artifact | `test -f .planning/debug/gsd-lock-race-cr01.md && git diff --quiet -- src/gsd/lock.js` | N/A (artefacto) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Confirmar path del test de `nextCell`/`format.js` del dashboard → `test/dashboard-format.test.js` (describe `nextCell` en :509) — CONFIRMADO
- [x] Confirmar si existe test del hook `session-end` para el mapeo de autoría de DEBT-01 → `test/hooks/session-end.test.js` y `test/hooks/session-end-handoff.test.js` existen — CONFIRMADO

*Existing infrastructure covers all phase requirements — no Wave 0 scaffold task needed (todos los ficheros de test existen; se extienden in-place).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Diagnóstico del flaky CR-01 | DEBT-04 | El entregable es un artefacto de diagnóstico (/gsd-debug), no un test nuevo; repro bajo carga no determinista | Correr el loop de repro documentado en 81-RESEARCH.md §DEBT-04; registrar condiciones y verdicts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
