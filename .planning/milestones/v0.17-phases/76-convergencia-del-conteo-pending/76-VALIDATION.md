---
phase: 76
slug: convergencia-del-conteo-pending
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-17
validated: 2026-07-22
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
| 76-01-01 | 01 | 1 | ORCH-05, ORCH-06 | — | Test scaffold RED: TTL fresco/caducado, catch etiquetado stale con `fetched_at` congelado, cold-start caído, shaper con `pending_count` numérico | unit | `node --test test/tasks/pending.test.js` | ✅ existe (creado en W0) | ✅ green |
| 76-01-02 | 01 | 1 | ORCH-05, ORCH-06 | — | `src/tasks/pending.js` hoja cero-imports: `fetchFreshPending` propaga throw raw; resolver never-collapses a valor de error | unit | `node --test test/tasks/pending.test.js` | ✅ existe | ✅ green |
| 76-01-03 | 01 | 1 | ORCH-05 | — | Guard de hoja: `pending.js` con cero imports; grafo de `check.js` alcanza el módulo compartido (convergencia positiva) | isolation | `node --test test/check-isolation.test.js` | ✅ (extendido) | ✅ green |
| 76-02-01 | 02 | 2 | ORCH-05, ORCH-06 | — | `/status` cableado al resolver compartido; `pending_stale`/`pending_fetched_at` presentes en ambas ramas; marcador HTML de staleness; sin `let pendingCache` inline | contract | `node --test test/server/status-pending.test.js` | ✅ existe (creado en W0) | ✅ green |
| 76-02-02 | 02 | 2 | ORCH-05 | — | `check.js` enruta por `fetchFreshPending` con output sano byte-idéntico (D-07); throw propaga con `err.message` real en la línea roja | unit | `node --test test/check.test.js` | ✅ (extendido) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/tasks/pending.test.js` — stubs para el módulo compartido (TTL fresco/caducado, catch etiquetado stale, cold-start caído, clock inyectado) — ORCH-05/ORCH-06
- [x] `test/server/status-pending.test.js` — contrato `/status` (`pending_stale`/`pending_fetched_at` presentes en ambas ramas) — ORCH-06
- [x] Ampliar `test/check-isolation.test.js` — el grafo de `check.js` sigue pasando el guard LOG-12 con el import del módulo nuevo
- [x] Ampliar `test/check.test.js` — output sano de `checkPendingTasks` byte-idéntico (D-07)

---

## Manual-Only Verifications

*None: "All phase behaviors have automated verification."* El indicador visual de staleness en el HTML del dashboard web es verificable por assert de contenido del HTML generado (string assertion), no requiere UAT humano obligatorio.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-07-22 (validate-phase retroactivo)

---

## Validation Audit 2026-07-22

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Reconciliación retroactiva post-ejecución: el mapa por-task quedó como placeholder del planner y validate-phase nunca corrió tras la ejecución (2026-07-17) — reconstruido aquí desde las tareas reales de `76-01-PLAN.md` (3 tasks, wave 1) y `76-02-PLAN.md` (2 tasks, wave 2). Evidencia de hoy: las 4 suites mapeadas re-ejecutadas → **40/40 pass, 0 fail** (`node --test`, 2026-07-22). Los 4 ítems Wave 0 existen y están verdes. Cero ítems manual-only (declarado desde el seed). ORCH-05/06 con cobertura automatizada completa → `nyquist_compliant: true`.
