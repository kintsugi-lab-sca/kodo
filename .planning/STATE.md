---
gsd_state_version: 1.0
milestone: v0.10
milestone_name: Higiene y estado real de sesiones
status: planning
last_updated: "2026-06-03T10:40:20.218Z"
last_activity: 2026-06-03
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Active milestone:** v0.10 Higiene y estado real de sesiones (planning). Ejes: `kodo gsd doctor` (saneo) + dismiss desde el dashboard (TUI read-write) + `provider_state` cross-system (Plane + GitHub). Anterior v0.9 kodo TUI — sesiones en vivo **shipped 2026-06-03**.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-03 after v0.9 milestone — Current State: v0.9 shipped).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** vía cross-provider contract matrix (Plane + GitHub × 7 asserts core); **reforzado en v0.8** con reporting opt-in provider-agnostic. v0.9 añade una superficie de observabilidad en terminal (`kodo dashboard`) read-only sobre ese contrato.

**Current focus:** v0.10 — definiendo requirements y roadmap

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-03 — Milestone v0.10 started

## Most recent shipped milestone

**v0.9 kodo TUI — sesiones en vivo** — shipped 2026-06-03 (7 phases 34-39 + cierre 39.1 / 23 plans / 202 commits desde v0.8 / suite 1073 pass + 1 skip). Audit `tech_debt` (sin blockers, 16/16 requirements, 47/47 exports wired, 5/5 flujos E2E).

- Roadmap archive: `milestones/v0.9-ROADMAP.md`
- Requirements archive: `milestones/v0.9-REQUIREMENTS.md`
- Audit: `milestones/v0.9-MILESTONE-AUDIT.md`
- Phase artifacts: `.planning/milestones/v0.9-phases/` (34-39 + 39.1 archivados al iniciar v0.10)

## Deferred Items

Items reconocidos y diferidos al cierre del milestone v0.9 el 2026-06-03 (audit `tech_debt`, ninguno bloqueante — detalle en `milestones/v0.9-MILESTONE-AUDIT.md`):

| Categoría | Item | Estado |
|-----------|------|--------|
| nyquist | Phase 36 VALIDATION.md nyquist_compliant=false | PARTIAL |
| nyquist | Phase 37 VALIDATION.md status=draft, nyquist_compliant=false | PARTIAL |
| nyquist | Phase 38 sin VALIDATION.md | MISSING |
| nyquist | Phase 39 sin VALIDATION.md (39-VERIFICATION sí existe, passed) | MISSING |
| nyquist | Phase 39.1 sin VALIDATION.md (39.1-VERIFICATION passed 14/14) | MISSING |
| verification | Phase 37 sin VERIFICATION.md formal — cerrada vía 37-UAT + 37-HUMAN-UAT passed | covered-by-UAT |
| verification | Phase 38 sin VERIFICATION.md formal — cerrada vía 38-HUMAN-UAT passed (firmado) | covered-by-UAT |
| code | Ciclo de import ESM App.js ↔ SessionTable.js (constantes OVERLAY_*) — resuelto en runtime, suite verde, frágil | WARNING-01 |
| code | Web UI legacy (`src/server.js` displayStatus) recomputa `idle` con heurística propia divergente del estado v3 — cero impacto en el dashboard ink | WARNING-02 / D-09 |
| todo | `surface-provider-state-in-dashboard` (Plane "In Review" / GitHub equivalent) — candidato siguiente milestone | open todo |

Backfill citation-based de los VALIDATION.md vía `/gsd:validate-phase <N>` si se desea cerrar la deuda Nyquist; las WARNINGs de código y el todo se revisan al planificar el siguiente milestone.

## Accumulated Context

### Roadmap Evolution

- Phase 38 moved: Phase 38 anterior (paneles auxiliares) renumbered a Phase 39 para hacer hueco al WorkspaceHost provider promovido desde backlog 999.2
- Phase 38 inserted after Phase 37: Promoted from backlog 999.2 — WorkspaceHost provider + ciclo de vida idle/needs-input. Trigger: diagnóstico ROMAN-151/152 invisibles en dashboard 2026-05-29.
- Phase 39.1 inserted after Phase 39: Cierre de gaps v0.9 desde milestone audit: BLOCKER host↔TUI + alive divergente + statusColor v3 (URGENT)

### Open Blockers

None.

### Open Questions

None. (v0.9 cerrado.)

- _Resuelto:_ Phase 37 (attach) UAT manual — `37-UAT.md` + `37-HUMAN-UAT.md` passed (2 escenarios obligatorios).
- _Resuelto:_ stack decision v0.9 = Opción A (Node + ink), subcomando `kodo dashboard`. `ink@^6.8.0` + `react@^19.2.0` + `ink-text-input@^6.0.0`, `React.createElement` sin build step, Node ≥20.

### Roadmap (archived milestones)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`.
- **v0.6 Session Isolation & Skill Sync** — shipped 2026-05-13. See `milestones/v0.6-ROADMAP.md`, `v0.6-MILESTONE-AUDIT.md`.
- **v0.7 GitHub Issues Adapter** — shipped 2026-05-14. See `milestones/v0.7-ROADMAP.md`, `v0.7-MILESTONE-AUDIT.md`.
- **v0.8 Consolidación + GSD Provider Reporting** — shipped 2026-05-25. See `milestones/v0.8-ROADMAP.md`, `milestones/v0.8-MILESTONE-AUDIT.md`.
- **v0.9 kodo TUI — sesiones en vivo** — shipped 2026-06-03. See `milestones/v0.9-ROADMAP.md`, `milestones/v0.9-MILESTONE-AUDIT.md`.

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider 9-method contract** (canonical en `src/interface.js`): `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. `getProvider(<name>)` valida con `TASK_PROVIDER_METHODS`. Cualquier adapter nuevo (v0.9 candidates: ClickUp, local) DEBE cumplir el contrato — empíricamente verificado por `test/providers/contract.test.js` (Phase 27 matrix).
- **TaskItem shape canónico de 13 fields** (v0.8 Phase 28 extendió 11→13 con `updated_at`/`created_at` REQUIRED): `shouldDispatch` evalúa contra timestamps reales en cualquier path (no provider-only divergente). `parseKodoLabels` opera sobre `string[]` sin saber el provider. Contract matrix asserta ambos timestamps × 2 providers.
- **Lock per-repo Phase 8 GSD-10**: el dispatcher coalesce sesiones por repo. Polling channel v0.7 delega idempotencia al lock. Anti-recursión REPORT-01 (v0.8) corta `kodo:gsd-child` ANTES del lock acquire — no afecta el invariante.
- **Dispatcher fire-and-forget** (v0.2): polling channel emula el patrón webhook — emite `dispatchTrigger` y continúa el loop sin esperar al launch.
- **markSessionStatus contrato non-throwing** (v0.8 Phases 30+33): retorna discriminated union `{ok, reason}`; falsy task_id → `{ok:false, reason:'missing-task-id'}` + `log.warn` SIN throw. Los 2 callers (`verify.js#finalize`, `stop.js#runStopHook`) CONSUMEN el return con log+continue dentro de sus try existentes. `src/session/manager.js` es el contrato — los callers consumen, no mutan.
- **findSession dual-scan** (v0.8 Phase 30): escanea `state.sessions` + `state.history` con priority a sessions. Cierra el desync state.json ↔ cmux (ROMAN-132). `kodo gsd verify <archived-id>` y `kodo logs --session-of` dependen de esto.
- **LOG-12 guard**: `kodo check` no carga `src/logger.js` transitivamente. Walker en `test/check-isolation.test.js`. Cualquier módulo nuevo en path "no-logger" debe añadir su row.
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. CLI handlers nuevos consumen `createFormatter(stream)`. **v0.9 extiende el walker a `src/cli/dashboard/`**: la TUI ink no importa `picocolors` — el color sale SOLO de `<Text color>` de ink.
- **`--json` byte-determinismo** (DX-06): outputs JSON idénticos TTY/no-TTY.
- **Worktree always-on Phase 18**: dispatchers disparan `dispatchTrigger` → `computeWorktreePath` → spawn.
- **HOOK-01 universal Phase 20**: el bloque anti-push-fantasma se inyecta en TODAS las sesiones (full + quick + no-GSD). Sesiones disparadas por polling lo heredan.
- **cwd=repo Phase 999.1**: orchestrator se lanza desde el repo para auto-cargar skill. `kodo orchestrator --polling` (Phase 26) preserva este contrato.
- **`kodo:gsd-child` anti-recursión** (v0.8 Phase 29): `isGsdChild(labels)` corta ANTES de parseKodoLabels/lock/resolver/launch, ni con `--force`. `KODO_LABEL_GSD_CHILD` desde `src/labels.js`, NUNCA inline.
- **Reporting opt-in strict** (v0.8 Phase 29): `workflow.report_to_provider` activa SOLO con `=== true`; DEFAULT_CONFIG no contiene la key (anti-mutation).
- **TUI read-only, cero endpoints nuevos** (v0.9): `kodo dashboard` consume solo `GET /status`, `/comments/<task_id>`, `/logs`. Cualquier mutación (p. ej. dismiss, backlog 999.1) debe justificar el cambio de identidad del milestone.
- **Fuente única de `alive`** (v0.9 Phase 38 + 39.1): `reconcileTick` es el ÚNICO escritor de `alive` → `state.json` → pass-through en `GET /status` (override legacy eliminado). El guard de Enter y `statusColor` v3-aware leen ese valor autoritativo, nunca recomputan.
- **TUI nunca crashea** (v0.9 Phase 35): la capa de datos (`fetchStatus`/`fetchComments`/`fetchLogs`) es never-throws (`{ok:false, error}`); ningún throw llega a React. Poll self-scheduling single-flight (`setTimeout` recursivo, NUNCA `setInterval`).
- **Selección por identidad `task_id`** (v0.9 Phase 36): la TUI rastrea la fila seleccionada por `task_id`, nunca por índice de array; sobrevive a reordenamiento/filtrado.

## Session Continuity

- **Last session:** 2026-06-03 — cierre del milestone v0.9
- **Stopped at:** Milestone v0.9 shipped and archived
- **Next action:** definir el siguiente milestone con `/gsd:new-milestone` (questioning → research → requirements → roadmap). `.planning/REQUIREMENTS.md` se elimina al cierre (fresca para el siguiente milestone).
- **Files of record:**
  - `.planning/PROJECT.md` (Current State: v0.9 shipped; Next Milestone Goals + candidatos)
  - `.planning/ROADMAP.md` (v0.9 colapsado en Archived Milestones; Backlog 999.1 preservado)
  - `.planning/MILESTONES.md` (entrada v0.9 completa)
  - `.planning/RETROSPECTIVE.md` (sección v0.9 + trends)
  - `.planning/milestones/v0.9-*` (full milestone v0.9 archive: ROADMAP + REQUIREMENTS + MILESTONE-AUDIT)
  - `.planning/research/SUMMARY.md` (build order A→E + 13 pitfalls, confidence HIGH — research v0.9)
  - `.planning/milestones/v0.8-*` (full milestone v0.8 archive)

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
