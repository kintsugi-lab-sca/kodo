---
phase: 81
slug: saneo-de-deuda-v0-17
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| (rellenado por el planner) | — | — | DEBT-01..04 | — | — | unit | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Confirmar path del test de `nextCell`/`format.js` del dashboard (gap flagged por research)
- [ ] Confirmar si existe test del hook `session-end` para el mapeo de autoría de DEBT-01

*Si ambos existen: "Existing infrastructure covers all phase requirements."*

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
