# Phase 31: Phase 21/22 Advisory Cleanup — Discussion Log

**Date:** 2026-05-20
**Mode:** /gsd-discuss-phase 31 (standard discuss mode)

## Areas Discussed

### 1. ADVISORY-03 (test launchOrchestrator real) — enfoque de spawn

**Options presented:**
- Inyectar spawnFn + node -e stub (Recomendado)
- Stub claude binary en tmp PATH
- Real Claude session sin assertions de runtime

**User selected:** Inyectar spawnFn + node -e stub

**Notes:**
- Patrón ya usado en otros tests de kodo.
- Real proceso + real fs effects + sin claude binary requerido.
- Decisiones derivadas: D-09 (spawnFn DI), D-10 (inline script behavior), D-11 (observables), D-12 (cmux stub), D-14 (refactor location en src/orchestrator/launch.js).

---

### 2. ADVISORY-02 (cleanup ordering) — ubicación cleanupFn

**Options presented:**
- DI dep en runSkillSyncCli (Recomendado)
- Wrapper externo en bin/kodo
- Hook interno (await logger.flush + clean tmp files)

**User selected:** DI dep en runSkillSyncCli

**Notes:**
- Sigue el patrón DI existente (syncFn/writeFn/cwdFn/errFn/formatterFn).
- Test inyecta cleanupFn + caller verifica timestamps por orden.
- Decisiones derivadas: D-04 (ubicación dep), D-05 (orden de ejecución), D-06 (test ordering), D-07 (process.exit no se mueve), D-08 (try/finally semantics).

---

### 3. Estructura de planes — agrupación

**Options presented:**
- 3 plans paralelos en Wave 1 (Recomendado)
- 1 plan bundled
- 2 plans: skill + orchestrator

**User selected:** 3 plans paralelos en Wave 1

**Notes:**
- Archivos no se solapan en `src/*`. Overlap controlado en `test/skill-sync.test.js` entre 31-01 y 31-02 (describe blocks distintos).
- Si executor paralelo causa merge conflicts, fallback es serializar 31-01 + 31-02 dentro de Wave 1.
- Decisiones derivadas: D-15 (plan estructura), D-18 (single source of truth para closure tracking).

---

## Deferred Ideas

Ninguna idea nueva surgida durante discuss. Phase 31 es scope cerrado por SC del ROADMAP — cualquier follow-up estructural va al backlog del milestone (v0.9+).

## Claude's Discretion

- D-13: ubicación del test (ampliar `test/launch.test.js` o crear `test/orchestrator/launch.test.js`) — planner/researcher deciden por encaje con tests existentes.
- D-18: si `v0.6-MILESTONE-AUDIT.md` debe actualizarse o si STATE.md es suficiente como single source of truth — el executor decide al final del wave.

## Outcome

CONTEXT.md generado con 18 decisiones (D-01..D-18) + canonical refs + code context + deferred (vacío). Ready para `/gsd-plan-phase 31`.
