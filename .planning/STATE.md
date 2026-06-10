---
gsd_state_version: 1.0
milestone: v0.11
milestone_name: Ventana al plan
status: executing
stopped_at: Phase 46 UI-SPEC approved
last_updated: "2026-06-10T09:04:13.730Z"
last_activity: 2026-06-10 -- Phase 46 planning complete
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 4
  completed_plans: 3
  percent: 50
---

# Project State

**Project:** kodo
**Active milestone:** **v0.11 Ventana al plan** (planning) — roadmap creado 2026-06-09, 4 phases (44-47), 8/8 requirements mapeados. Previo: **v0.10 Higiene y estado real de sesiones SHIPPED 2026-06-08** (audit `tech_debt`, 14/14 requirements).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-09 — Current Milestone: v0.11 "Ventana al plan").

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** vía cross-provider contract matrix (Plane + GitHub × 7 asserts core); **reforzado en v0.8** con reporting opt-in provider-agnostic. v0.9 añadió una superficie de observabilidad en terminal (`kodo dashboard`) read-only; v0.10 la promovió a gestión (dismiss). v0.11 profundiza la observabilidad: ver el plan de cada sesión sin salir de la TUI.

**Current focus:** Phase 46 — overlay del plan ligero para sesiones quick/non gsd

## Current Position

Phase: 46
Plan: Not started
Status: Ready to execute
Last activity: 2026-06-10 -- Phase 46 planning complete

## Roadmap v0.11 (active)

Build order: **OVERLAY+POLISH → SPIKE → CAPTURA CONDICIONAL → NYQUIST**. Phase 44 es el core de bajo riesgo (overlay GSD + pulido); Phase 45 (spike) gobierna si Phase 46 (captura no-GSD) se ejecuta o se corta a v2; Phase 47 (nyquist backfill) es doc-only e independiente.

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 44. Overlay de plan GSD + pulido de dashboard | Tecla nueva muestra `PLAN.md` de la fase GSD vía `resolvePhase`; oculta `phase/mode` sin GSD; zombie por-fila en `state` | PLAN-01, PLAN-02, TUI-18, TUI-19 | bajo |
| 45. Spike — captura de plan no-GSD vía hook | Veredicto empírico VIABLE/INVIABLE sobre si `--dangerously-skip-permissions` emite plan capturable vía hook soportado (`ExitPlanMode`/equiv) | PLAN-03 | n/a (spike — gate) |
| 46. Captura + persistencia de plan no-GSD *(condicional — cuttable a v2)* | Si el spike sale VIABLE: captura/persiste plan no-GSD en fuente propia + overlay lo muestra | PLAN-04 | medio/alto (sujeto a spike) |
| 47. Backfill de deuda Nyquist | `VALIDATION.md` citation-based para 41/43 (v0.10) + 36/37/38/39/39.1 (v0.9) | NYQ-01, NYQ-02 | bajo (doc-only Tier 1) |

- **Gate duro Phase 45 → 46:** Phase 46 SOLO se planifica/ejecuta si Phase 45 concluye VIABLE. Si INVIABLE, PLAN-04 se difiere a v2 (PLAN-F1/PLAN-F2 lo anticipan) y el milestone cierra con Phases 44/45/47 sin penalización.
- **Discuss-phase decisions (no bloquean el roadmap):** Phase 44 — tecla concreta del overlay (junto a `c`/`l`), presentación multi-`PLAN.md` (lista navegable vs concatenado). Phase 46 — contrato de persistencia propio (heredado del veredicto del spike), confirmación de cero-endpoints.
- **Invariantes a honrar:** color isolation (cero picocolors en `src/cli/dashboard/`, color solo de `<Text>` ink), TUI never-throws (lectura de plan best-effort, ningún `await` desnudo en React), selección por identidad `task_id`, anti-ReDoS `String.includes`, cero endpoints nuevos (el overlay lee el filesystem como `focus.js`), read-only (la única superficie read-write de la TUI sigue siendo el dismiss de v0.10).

## Most recent shipped milestone

**v0.10 Higiene y estado real de sesiones** — shipped 2026-06-08 (4 phases 40-43 / 10 plans / 118 commits desde v0.9 / suite 1213 pass + 1 skip). Audit `tech_debt` (14/14 requirements, integración cross-phase + 3/3 flujos E2E; deuda Nyquist en 41/43 diferida → saldada en Phase 47 de v0.11).

- Roadmap archive: `milestones/v0.10-ROADMAP.md`
- Requirements archive: `milestones/v0.10-REQUIREMENTS.md`
- Audit: `milestones/v0.10-MILESTONE-AUDIT.md`
- Phase artifacts: `.planning/milestones/v0.10-phases/` (40-43)

## Deferred Items

Items reconocidos y diferidos al cierre de milestones previos (ninguno bloqueante). La deuda Nyquist se salda en **Phase 47 de v0.11** (NYQ-01/NYQ-02).

| Categoría | Item | Estado |
|-----------|------|--------|
| nyquist | Phase 36 (v0.9) VALIDATION.md nyquist_compliant=false | PARTIAL → Phase 47 (NYQ-02) |
| nyquist | Phase 37 (v0.9) VALIDATION.md status=draft, nyquist_compliant=false | PARTIAL → Phase 47 (NYQ-02) |
| nyquist | Phase 38 (v0.9) sin VALIDATION.md | MISSING → Phase 47 (NYQ-02) |
| nyquist | Phase 39 (v0.9) sin VALIDATION.md (39-VERIFICATION sí existe, passed) | MISSING → Phase 47 (NYQ-02) |
| nyquist | Phase 39.1 (v0.9) sin VALIDATION.md (39.1-VERIFICATION passed 14/14) | MISSING → Phase 47 (NYQ-02) |
| nyquist | Phase 41 (v0.10) VALIDATION.md ausente/no-compliant | MISSING → Phase 47 (NYQ-01) |
| nyquist | Phase 43 (v0.10) VALIDATION.md ausente/no-compliant | MISSING → Phase 47 (NYQ-01) |
| verification | Phase 37 (v0.9) sin VERIFICATION.md formal — cerrada vía 37-UAT + 37-HUMAN-UAT passed | covered-by-UAT |
| verification | Phase 38 (v0.9) sin VERIFICATION.md formal — cerrada vía 38-HUMAN-UAT passed (firmado) | covered-by-UAT |
| code | Ciclo de import ESM App.js ↔ SessionTable.js (constantes OVERLAY_*) — resuelto en runtime, suite verde, frágil | WARNING-01 |
| frontmatter | `requirements_completed` vacío en summaries de 41/42/43-02 (cobertura verificada por VERIFICATION + integration) | cosmético |

Las fases archivadas viven en `.planning/milestones/v0.10-phases/` (41/43) y `.planning/milestones/v0.9-phases/` (36/37/38/39/39.1). Backfill citation-based vía `/gsd:validate-phase <N>` en Phase 47.

## Accumulated Context

### Decisions (Roadmap v0.11)

- **Numeración continua (NO reset):** v0.11 continúa desde Phase 43 (v0.10) → primera fase es **Phase 44**. Espejo de cómo v0.10 continuó desde v0.9.
- **PLAN-03 (spike) separado de PLAN-04 (captura) en fases distintas (45 vs 46):** el spike gobierna un gate duro. Phase 46 es CONDICIONAL Y CUTTABLE — si el spike sale INVIABLE, PLAN-04 va a v2 sin reescribir el roadmap ni penalizar el cierre del milestone.
- **TUI-18/TUI-19 (pulido) plegados en Phase 44** junto al overlay GSD (PLAN-01/02): mismo concern (`src/cli/dashboard/`), granularidad coarse → fewer cohesive phases. Watch: ediciones compartidas en `select.js`/`format.js`/`App.js` al planificar.
- **NYQ-01/NYQ-02 (Phase 47) como última fase, doc-only Tier 1:** `git diff -- src/ test/ bin/` debe quedar vacío; independiente de las demás fases.
- **Cero endpoints nuevos preservado:** el overlay de plan lee el filesystem directamente (`.planning/phases/<fase>/<N>-NN-PLAN.md` vía `resolvePhase`), espejo de cómo `focus.js` invoca cmux — no se añaden endpoints al server salvo decisión explícita en discuss-phase.
- **Phase 45 PLAN-03 (ejecutado 2026-06-10):** instrucción de plan ligero universal inyectada en `buildSessionContext` (ES, non-GSD) y en la rama `mode === 'quick'` de `buildGsdContext` (EN). Ruta resuelta `~/.kodo/plans/<task_id>.md` vía `join(KODO_DIR, 'plans', \`${task_id}.md\`)` — sin literal `<task_id>`. El hook NO hace I/O (D-03): solo emite el string; la sesión escribe el fichero (latest-wins, D-06). Golden-bytes (HOOK-02) y D-04 common-block invariance preservados; ramas phase/bootstrap byte-idénticas. Habilita el overlay de Phase 46.

### Roadmap Evolution

- **v0.11 roadmap creado (2026-06-09):** 4 phases (44-47), numeración continua desde v0.10 (NO reset). Build order OVERLAY+POLISH → SPIKE → CAPTURA CONDICIONAL → NYQUIST. 8/8 requirements mapeados. Phase 46 marcada cuttable (gate de Phase 45).
- **v0.10 roadmap creado (2026-06-03):** 4 phases (40-43), numeración continua desde v0.9. Build order PROVIDER-STATE → DOCTOR → DISMISS → RENDER. Backlog 999.1 (dismiss) promovido a Phase 42.

### Open Blockers

None.

### Open Questions

Decisiones discuss-phase (no bloquean el roadmap; se resuelven al planificar cada fase):

- **Phase 45 (redefinida 2026-06-09):** ruta y formato exactos del artefacto de plan ligero (p. ej. `<worktree_path>/.kodo/plan.md` vs state dir de kodo); cómo se inyecta la instrucción en `buildSessionContext`/`buildGsdContext` (quick) preservando golden-bytes.
- **Phase 46:** mecánica del fallback en el overlay de Phase 44 cuando la fila no tiene `phase_id` (leer el artefacto de plan ligero en vez de `PLAN.md`); confirmación de que no se añaden endpoints.

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider contract: 9 obligatorios + getTaskState/listComments opcionales** (canonical en `src/interface.js`): `TASK_PROVIDER_METHODS` FROZEN en 9. v0.11 no toca adapters.
- **TaskItem shape canónico de 13 fields** (v0.8 Phase 28).
- **Lock per-repo Phase 8 GSD-10**: el dispatcher coalesce sesiones por repo.
- **markSessionStatus contrato non-throwing** (v0.8): retorna `{ok, reason}`.
- **findSession dual-scan** (v0.8 Phase 30): escanea `state.sessions` + `state.history`. **v0.11 Phase 44: el overlay de plan deriva `worktree_path`/`project_path` de la fila del dashboard (`GET /status`), no de `findSession`.**
- **LOG-12 guard**: `kodo check` no carga `src/logger.js` transitivamente.
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. **v0.11 Phase 44 (overlay + pulido): `src/cli/dashboard/` usa `<Text color>` de ink, cero picocolors — incluido el zombie por-fila de TUI-19.**
- **`--json` byte-determinismo** (DX-06).
- **Worktree always-on Phase 18**: **v0.11 Phase 44: el overlay lee `PLAN.md` desde `worktree_path ?? project_path` (fallback transparente, espejo de cómo `kodo gsd verify` lee VERIFICATION.md).**
- **resolvePhase discriminated union** (v0.3 Phase 9): **v0.11 Phase 44 lo REUSA para mapear tarea→fase; debe tolerar los verdicts no-match/bootstrap/error sin crashear el overlay (PLAN-02 never-throws).**
- **TUI read-WRITE solo para dismiss-de-dead-sessions, cero endpoints nuevos** (v0.10): **v0.11 PRESERVA read-only para el overlay de plan — la única superficie read-write de la TUI sigue siendo el dismiss de v0.10. El overlay NO escribe `PLAN.md` ni añade endpoints.**
- **Fuente única de `alive`** (v0.9 Phase 38 + 39.1): `reconcileTick` único escritor de `alive`. v0.11 no toca el lifecycle.
- **TUI nunca crashea** (v0.9 Phase 35): capa de datos never-throws; ningún throw llega a React. **v0.11 Phase 44: la lectura del/los `PLAN.md` es best-effort never-throws (espejo de los overlays `c`/`l`); el handler del overlay nunca hace `await` desnudo.**
- **Selección por identidad `task_id`** (v0.9 Phase 36): **v0.11 Phase 44: el overlay de plan se abre sobre la fila revalidada por `task_id`, `Esc` preserva el cursor por identidad; filtros con `String.includes` anti-ReDoS.**

## Session Continuity

- **Last session:** 2026-06-10T08:45:36.263Z
- **Stopped at:** Phase 46 UI-SPEC approved
- **Next action:** `/gsd:discuss-phase 45` con el nuevo scope (inyección de plan ligero en `session-start.js`). Phase 44 ya shipped; Phase 46 (overlay del plan ligero) depende de 45.
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.11)
  - `.planning/ROADMAP.md` (v0.11 activo Phases 44-47; v0.10 colapsado en archived)
  - `.planning/REQUIREMENTS.md` (v0.11, traceability 8/8 → Phases 44-47)
  - `.planning/MILESTONES.md` (entrada v0.10 completa)
  - `.planning/milestones/v0.10-*` y `v0.9-*` (archivos de fase para el backfill Nyquist de Phase 47)

## Operator Next Steps

- Re-discutir Phase 45 con el nuevo scope: `/gsd:discuss-phase 45` (inyección de plan ligero universal).
