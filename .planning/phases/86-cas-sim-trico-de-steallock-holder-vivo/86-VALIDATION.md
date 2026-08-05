---
phase: 86
slug: cas-sim-trico-de-steallock-holder-vivo
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-05
---

# Phase 86 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Fuente: `86-RESEARCH.md` §Validation Architecture (baseline medido en esa sesión).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (runner nativo) + `node:assert/strict` |
| **Config file** | none — convención `test/**/*.test.js` |
| **Quick run command** | `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js test/gsd-lock.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 s (quick) · ~22 s (suite completa) |
| **Baseline a HEAD** | 2.590 tests · 2.589 pass · 0 fail · 1 skipped · 588 suites · 21,6 s (VERIFIED en research) |

---

## Sampling Rate

- **After every task commit:** `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js test/gsd-lock.test.js` (~5 s)
- **After every plan wave:** `npm test` (~22 s)
- **Before `/gsd-verify-work`:** suite completa verde (≥ 2.590 tests, 0 fail) **más** la evidencia manual de la mordida (LOCK-06) registrada en el SUMMARY
- **Max feedback latency:** ~22 seconds

---

## Per-Task Verification Map

> Seeded en `draft`: los Task IDs se asignan cuando `gsd-planner` escribe los PLAN.md. La columna Requirement y el comando ya están fijados por el research.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | LOCK-04 (a) | — | El CAS aborta en vez de clobbear con holder VIVO que libera + creador Case-1 legítimo; sobrevive el lock del creador | integration (procesos reales) | `node --test test/gsd-lock-race.test.js` | ✅ se extiende | ⬜ pending |
| TBD | 01 | 1 | LOCK-04 (b) | — | El abort devuelve `reason: 'lock-replaced-mid-steal'` y lo emite por `[kodo:lock]` | integration (marcador lateral) | `node --test test/gsd-lock-race.test.js` | ➕ marcador nuevo | ⬜ pending |
| TBD | 01 | 1 | LOCK-04 (c) | — | El CAS **no** aborta cuando nada cambió — sin regresión del steal dead-PID | regresión existente | `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js` | ✅ existen, no se tocan | ⬜ pending |
| TBD | 01 | 1 | LOCK-04 (d) | V5 | Un lock corrupto sigue siendo robable con el CAS puesto (`content: null` no bloquea la rama PRESENT) | unit | `node --test test/gsd-lock.test.js` | ✅ existe (`:136-148`) | ⬜ pending |
| TBD | 01 | 1 | LOCK-05 (a) | — | Se siembra holder **VIVO** (TTL vencido + PID vivo), nunca `DEAD_PID` | source-assert | `grep -c 'DEAD_PID' test/gsd-lock-race.test.js` = 0 | ✅ se extiende | ⬜ pending |
| TBD | 01 | 1 | LOCK-05 (b) | — | Cardinalidad exacta con N≥2 y N=5: adquiere uno solo | integration (procesos reales) | `node --test test/gsd-lock-race.test.js` | ✅ se extiende | ⬜ pending |
| TBD | 01 | 1 | LOCK-05 (c) | — | El escenario ejercitó de verdad la rama del CAS (anti-degradación silenciosa) | guard de cobertura | mismo comando; falla con mensaje propio si el marcador no aparece | ➕ se crea | ⬜ pending |
| TBD | 01 | 1 | LOCK-06 (b) | — | No se debilitó ningún assert, timeout ni presupuesto | source-assert | `grep -c 'MAX_STEAL_ATTEMPTS = 8' src/gsd/lock.js` = 1 · `grep -c 'STEAL_GUARD_STALE_MS = 5_000' src/gsd/lock.js` = 1 | ✅ existen | ⬜ pending |
| TBD | 01 | 1 | LOCK-07 (a) | — | Ventana residual declarada en el JSDoc de `stealLock` con su clase de riesgo nombrada | source-assert | `grep -c 'TOCTOU' src/gsd/lock.js` ≥ 1 · `grep -c 'Phase 83' src/gsd/lock.js` ≥ 1 | ✅ existe | ⬜ pending |
| TBD | 01 | 1 | LOCK-07 (b) | — | Declarada también en `STATE.md` | source-assert | `grep -c 'ventana residual' .planning/STATE.md` ≥ 1 + `state.validate` → `valid: true` | ✅ existe | ⬜ pending |
| TBD | 01 | 1 | LOCK-07 (c) | — | El comentario de premisa falsa desapareció (D-18) | source-assert | `grep -c 'No fresh Case-1 creator can race here' src/gsd/lock.js` = 0 | ✅ existe | ⬜ pending |
| TBD | 01 | 1 | Criterio 5 | V3 | Suite completa verde y consumidores intactos | suite + source-assert | `npm test` → ≥ 2.590 tests, 0 fail · `git diff --exit-code src/triggers/dispatcher.js src/gsd/doctor.js src/hooks/` | ✅ existe | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/lock-race-child.mjs` — `kind`(s) nuevo(s): holder stale-pero-vivo con release bajo barrera, y stealer con seam (LOCK-05)
- [ ] `test/gsd-lock-race.test.js` — orquestación de tres tiempos + lector de marcadores + guard de cobertura `assertCasExercised` (LOCK-04/05)
- [ ] Marcador de canal lateral (p. ej. `steal-reasons.log`) y su lector en el padre (LOCK-04b / LOCK-05c)

*No hay hueco de framework: `node:test` ya cubre todo y no se instala nada (cero deps nuevas, constraint LOCKED).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| La **mordida** del guard: revertir el CAS a mano pone el harness ROJO | LOCK-06 | Automatizarla es mutation testing = infraestructura nueva, prohibida en v0.20 y ya diferida con trigger en `86-CONTEXT.md` §Deferred | Revertir el CAS a mano → `node --test test/gsd-lock-race.test.js` debe salir `# fail ≥ 1` → restaurar. Citar en el SUMMARY: diff exacto de la reversión + salida `# fail` con el mensaje del assert + salida verde tras restaurar. Precedente: `83-VERIFICATION.md:78`, `STATE.md:113` |
| Que la redacción de la ventana residual sea **honesta**, no solo presente | LOCK-07 | Un `grep` verifica presencia, no honestidad | Revisar el texto en el VERIFICATION comprobando los 4 elementos de D-17: qué es (2 syscalls contiguos) · clase de riesgo nombrada (TOCTOU residual, misma clase que el guard del inbox de Phase 83) · qué cambia de verdad (la magnitud, no la existencia) · nunca presentada como cierre por construcción |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 22s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
