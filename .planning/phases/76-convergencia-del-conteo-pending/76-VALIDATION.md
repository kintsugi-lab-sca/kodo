---
phase: 76
slug: convergencia-del-conteo-pending
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 76 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, cero deps) |
| **Config file** | none — `npm test` corre `node --test test/` |
| **Quick run command** | `node --test test/tasks/pending.test.js test/check.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (suite completa ~2027 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/tasks/pending.test.js test/check.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (se rellena por el planner con los tasks reales) | — | — | ORCH-05 / ORCH-06 | — | — | unit/integration | — | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/tasks/pending.test.js` — stubs para el módulo compartido (TTL fresco/caducado, catch etiquetado stale, cold-start caído, clock inyectado) — ORCH-05/ORCH-06
- [ ] `test/server/status-pending.test.js` — contrato `/status` (`pending_stale`/`pending_fetched_at` presentes en ambas ramas) — ORCH-06
- [ ] Ampliar `test/check-isolation.test.js` — el grafo de `check.js` sigue pasando el guard LOG-12 con el import del módulo nuevo
- [ ] Ampliar `test/check.test.js` — output sano de `checkPendingTasks` byte-idéntico (D-07)

---

## Manual-Only Verifications

*None: "All phase behaviors have automated verification."* El indicador visual de staleness en el HTML del dashboard web es verificable por assert de contenido del HTML generado (string assertion), no requiere UAT humano obligatorio.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
