---
gsd_state_version: 1.0
milestone: v0.9
milestone_name: kodo TUI — sesiones en vivo
status: executing
stopped_at: Phase 37 context gathered
last_updated: "2026-05-28T20:30:36.804Z"
last_activity: 2026-05-28 -- Phase 37 planning complete
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 12
  completed_plans: 9
  percent: 60
---

# Project State

**Project:** kodo
**Active milestone:** v0.9 kodo TUI — sesiones en vivo (Phases 34-38). Roadmap creado 2026-05-26.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-25 after v0.8 milestone — Current State: v0.8 shipped).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** vía cross-provider contract matrix (Plane + GitHub × 7 asserts core); **reforzado en v0.8** con reporting opt-in provider-agnostic.

**Current focus:** Phase 37 — attach handoff cmux

## Current Position

Phase: 37
Plan: Not started
Status: Ready to execute
Last activity: 2026-05-28 -- Phase 37 planning complete

Progress: [░░░░░░░░░░] 0%

## Most recent shipped milestone

**v0.8 Consolidación + GSD Provider Reporting** — shipped 2026-05-25 (6 phases 28-33 / 20 plans / 152 commits desde v0.7 / suite 895 pass + 1 skip). Audit PASSED.

- Roadmap archive: `milestones/v0.8-ROADMAP.md`
- Requirements archive: `milestones/v0.8-REQUIREMENTS.md`
- Audit: `milestones/v0.8-MILESTONE-AUDIT.md`
- Phase artifacts: `.planning/phases/` (no archivados a `milestones/v0.8-phases/` — opción Skip; usar `/gsd-cleanup` retroactivo si se desea)

## Accumulated Context

### Open Blockers

None.

### Open Questions

- **Phase 37 (attach) UAT manual:** la fase de mayor riesgo del milestone exige un artefacto de UAT manual con 4 escenarios (primer attach + vuelta · segundo attach consecutivo · workspace muerto · Ctrl-C durante attach). Sin ese artefacto la fase NO está completa (research flag).
- _Resuelto:_ stack decision v0.9 = Opción A (Node + ink), subcomando `kodo dashboard`. `ink@^6.8.0` + `react@^19.2.0` + `ink-text-input@^6.0.0`, `React.createElement` sin build step, Node ≥20.

### Roadmap (archived milestones)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`.
- **v0.6 Session Isolation & Skill Sync** — shipped 2026-05-13. See `milestones/v0.6-ROADMAP.md`, `v0.6-MILESTONE-AUDIT.md`.
- **v0.7 GitHub Issues Adapter** — shipped 2026-05-14. See `milestones/v0.7-ROADMAP.md`, `v0.7-MILESTONE-AUDIT.md`.
- **v0.8 Consolidación + GSD Provider Reporting** — shipped 2026-05-25. See `milestones/v0.8-ROADMAP.md`, `milestones/v0.8-MILESTONE-AUDIT.md`.

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider 9-method contract** (canonical en `src/interface.js`): `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. `getProvider(<name>)` valida con `TASK_PROVIDER_METHODS`. Cualquier adapter nuevo (v0.9 candidates: ClickUp, local) DEBE cumplir el contrato — empíricamente verificado por `test/providers/contract.test.js` (Phase 27 matrix).
- **TaskItem shape canónico de 13 fields** (v0.8 Phase 28 extendió 11→13 con `updated_at`/`created_at` REQUIRED): `shouldDispatch` evalúa contra timestamps reales en cualquier path (no provider-only divergente). `parseKodoLabels` opera sobre `string[]` sin saber el provider. Contract matrix asserta ambos timestamps × 2 providers.
- **Lock per-repo Phase 8 GSD-10**: el dispatcher coalesce sesiones por repo. Polling channel v0.7 delega idempotencia al lock. Anti-recursión REPORT-01 (v0.8) corta `kodo:gsd-child` ANTES del lock acquire — no afecta el invariante.
- **Dispatcher fire-and-forget** (v0.2): polling channel emula el patrón webhook — emite `dispatchTrigger` y continúa el loop sin esperar al launch.
- **markSessionStatus contrato non-throwing** (v0.8 Phases 30+33): retorna discriminated union `{ok, reason}`; falsy task_id → `{ok:false, reason:'missing-task-id'}` + `log.warn` SIN throw. Los 2 callers (`verify.js#finalize`, `stop.js#runStopHook`) CONSUMEN el return con log+continue dentro de sus try existentes. `src/session/manager.js` es el contrato — los callers consumen, no mutan.
- **findSession dual-scan** (v0.8 Phase 30): escanea `state.sessions` + `state.history` con priority a sessions. Cierra el desync state.json ↔ cmux (ROMAN-132). `kodo gsd verify <archived-id>` y `kodo logs --session-of` dependen de esto.
- **LOG-12 guard**: `kodo check` no carga `src/logger.js` transitivamente. Walker en `test/check-isolation.test.js`. Cualquier módulo nuevo en path "no-logger" debe añadir su row.
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. CLI handlers nuevos consumen `createFormatter(stream)`.
- **`--json` byte-determinismo** (DX-06): outputs JSON idénticos TTY/no-TTY.
- **Worktree always-on Phase 18**: dispatchers disparan `dispatchTrigger` → `computeWorktreePath` → spawn.
- **HOOK-01 universal Phase 20**: el bloque anti-push-fantasma se inyecta en TODAS las sesiones (full + quick + no-GSD). Sesiones disparadas por polling lo heredan.
- **cwd=repo Phase 999.1**: orchestrator se lanza desde el repo para auto-cargar skill. `kodo orchestrator --polling` (Phase 26) preserva este contrato.
- **`kodo:gsd-child` anti-recursión** (v0.8 Phase 29): `isGsdChild(labels)` corta ANTES de parseKodoLabels/lock/resolver/launch, ni con `--force`. `KODO_LABEL_GSD_CHILD` desde `src/labels.js`, NUNCA inline.
- **Reporting opt-in strict** (v0.8 Phase 29): `workflow.report_to_provider` activa SOLO con `=== true`; DEFAULT_CONFIG no contiene la key (anti-mutation).

## Session Continuity

- **Last session:** 2026-05-28T11:34:48.836Z
- **Stopped at:** Phase 37 context gathered
- **Next action:** `/gsd-plan-phase 34` (Fundación — subcomando + ciclo de vida).
- **Files of record:**
  - `.planning/PROJECT.md` (Current State: v0.8 shipped + candidatos v0.9)
  - `.planning/ROADMAP.md` (v0.8 colapsado en Archived Milestones)
  - `.planning/MILESTONES.md` (entrada v0.8 completa)
  - `.planning/RETROSPECTIVE.md` (sección v0.8 + trends actualizados)
  - `.planning/REQUIREMENTS.md` (v0.9 TUI-* requirements + traceability 16/16 → Phases 34-38)
  - `.planning/research/SUMMARY.md` (build order A→E + 13 pitfalls, confidence HIGH)
  - `.planning/PENDING-INTEGRATIONS.md` (seed v0.9: kodo TUI de sesiones en vivo)
  - `.planning/milestones/v0.8-*` (full milestone v0.8 archive)
