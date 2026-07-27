---
phase: 85
slug: saneo-de-deuda-nyquist-retroactivo
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 85 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase desde `85-RESEARCH.md` §Validation Architecture. El mapa por-tarea lo puebla el planner con los task IDs reales.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (runner nativo) + `node:assert/strict` |
| **Config file** | none — convención del repo `test/**/*.test.js` |
| **Quick run command** | `node --test test/dashboard-select.test.js test/check.test.js test/check-isolation.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~1 s (quick) · ~120 s (full, 2586 tests) |
| **Baseline a HEAD** | 2586 tests · 2585 pass · 0 fail · 1 skipped (`84-VERIFICATION.md:94`) |

---

## Sampling Rate

- **After every task commit:** Run el quick command de los ficheros tocados por esa tarea.
- **After every plan wave:** Run `npm test`.
- **Before `/gsd-verify-work`:** Full suite must be green (2586+, cero fail).
- **Max feedback latency:** ~120 s (suite completa).
- **Bloque NYQ (D-12):** cobertura **por CITACIÓN** a la evidencia ya en disco — **cero tests nuevos, cero re-ejecución de la suite**. El sampling de NYQ-01/02 es la verificación documental del frontmatter resultante, no una corrida.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(pendiente — el planner rellena esta tabla con los task IDs reales)* | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Reparto de cobertura fijado por CONTEXT.md + RESEARCH.md §Validation Architecture:**

| Requirement | Cobertura |
|---|---|
| DEBT-05 | **CITATION** — cero tests nuevos (D-03). Cita a `test/state/handoff-state.test.js:265` (CLEAR) / `:288` (PRESERVE) / `:307` (OVERWRITE). Backstop: suite verde sin tocar tests. |
| DEBT-06 | **unit NUEVO** en `test/dashboard-select.test.js` (RED antes del fix) + los 8 asserts LIVE-05 existentes verdes **sin tocarlos** + guard `test/format-isolation.test.js` sin modificar (D-18). |
| DEBT-07 / WR-01+WR-02 | **unit NUEVO** en `test/check.test.js` (un `it()` cubre ambos). |
| DEBT-07 / WR-03 (a) | **manual-only** — un comentario no es testeable; evidencia = diff + cita a `src/providers/registry.js:27,28,57,58`. |
| DEBT-07 / WR-03 (b) | **unit NUEVO (guard)** en `test/check-isolation.test.js`; `walkImports` **no se modifica**. |
| NYQ-01 / NYQ-02 | **CITATION** — cero tests nuevos (D-12). Verificación = frontmatter resultante de los 6 `VALIDATION.md`. |

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — `node:test` nativo, los 3 ficheros de test a extender ya existen, cero deps npm nuevas (constraint LOCKED).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El comentario de `test/check-isolation.test.js` deja de afirmar la premisa falsa | DEBT-07 / WR-03 (a) | Un comentario no es ejecutable | Inspección del diff en el SUMMARY, citando los `await import()` reales de `src/providers/registry.js:27,28,57,58` |
| El guard reforzado tiene mordida real | DEBT-07 / WR-03 (b) | Probar que un guard falla exige romperlo temporalmente | Insertar `await import('../logger.js')` en un fichero del grafo de `check.js`, comprobar ROJO, revertir |
| Las 6 fases del backfill quedan con `nyquist_compliant: true` defendible por cita | NYQ-01, NYQ-02 | La evidencia es documental (VERIFICATION/SUMMARY/UAT ya en disco), no una corrida | `grep -c "nyquist_compliant: true"` sobre los 6 ficheros + revisión de que cada dimensión cite fichero + resultado concreto |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or están declaradas CITATION/manual-only con su razón
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (ninguna — infra nativa suficiente)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
