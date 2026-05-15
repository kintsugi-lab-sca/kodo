---
gsd_state_version: 1.0
milestone: null
milestone_name: null
status: between_milestones
stopped_at: v0.7 archived (commit pending) — awaiting /gsd-new-milestone
last_updated: "2026-05-15T06:50:00.000Z"
last_activity: 2026-05-15 -- v0.7 milestone archived; awaiting next milestone scope
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Active milestone:** _(none — v0.7 shipped & archived; awaiting `/gsd-new-milestone` to scope v0.8)_
**Last updated:** 2026-05-15

## Project Reference

See: `.planning/PROJECT.md` (Current State — v0.7 shipped).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** vía cross-provider contract matrix con Plane + GitHub × 7 asserts core.

## Current Position

Phase: _(none)_
Plan: _(none)_
Status: between milestones
Last activity: 2026-05-15 -- v0.7 archived

## Most recent shipped milestone

**v0.7 GitHub Issues Adapter** — shipped 2026-05-14 (5 phases / 11 plans / 80 commits / +89 nuevos tests sobre baseline v0.6).
- Roadmap archive: `milestones/v0.7-ROADMAP.md`
- Requirements archive: `milestones/v0.7-REQUIREMENTS.md`
- Audit: `v0.7-MILESTONE-AUDIT.md`
- Phase artifacts: `milestones/v0.7-phases/`

## Accumulated Context

### Roadmap (archived milestones)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`.
- **v0.6 Session Isolation & Skill Sync** — shipped 2026-05-13. See `milestones/v0.6-ROADMAP.md`, `v0.6-MILESTONE-AUDIT.md`.
- **v0.7 GitHub Issues Adapter** — shipped 2026-05-14. See `milestones/v0.7-ROADMAP.md`, `v0.7-MILESTONE-AUDIT.md`.

### Open Blockers

None.

### Open Questions

_(reset for next milestone)_

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider 9-method contract** (canonical en `src/interface.js`): `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. `getProvider(<name>)` valida con `TASK_PROVIDER_METHODS`. Cualquier adapter nuevo (v0.8 candidates: ClickUp, local) DEBE cumplir el contrato — empíricamente verificado por `test/providers/contract.test.js` (Phase 27 matrix).
- **TaskItem/TriggerEvent shapes provider-agnostic** (v0.2): canonical 11-field shape ancla `D-18` (Phase 24). `parseKodoLabels` opera sobre `string[]` sin saber el origen del provider. Zero changes a `src/labels.js`.
- **Lock per-repo Phase 8 GSD-10**: el dispatcher coalesce sesiones por repo. Polling channel v0.7 delega idempotencia al lock — no introduce nuevo mecanismo de dedup.
- **Dispatcher fire-and-forget** (v0.2): polling channel emula el patrón webhook — la detección emite `dispatchTrigger` y continúa el loop, sin esperar al launch.
- **LOG-12 guard**: `kodo check` no carga `src/logger.js` transitivamente. Walker en `test/check-isolation.test.js` extendido en v0.7 con filtros para `provider.js`, `normalize.js`, `polling.js`. Cualquier módulo nuevo en path "no-logger" debe añadir su row.
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. CLI handlers nuevos consumen `createFormatter(stream)`.
- **`--json` byte-determinismo** (DX-06): outputs JSON deben ser idénticos TTY/no-TTY (verificado en `kodo logs --json` v0.5 + `kodo polling status --json` v0.7).
- **Worktree always-on Phase 18**: dispatchers dispara `dispatchTrigger` que sigue el path Launch → `computeWorktreePath` → spawn.
- **HOOK-01 universal Phase 20**: el bloque anti-push-fantasma se inyecta en TODAS las sesiones (full + quick + no-GSD). Verificado v0.7 — sesiones disparadas por polling lo heredan automáticamente.
- **cwd=repo Phase 999.1**: orchestrator se lanza desde el repo para auto-cargar skill. `kodo orchestrator --polling` (Phase 26) preserva este contrato — el polling vive en el mismo proceso, no en un worktree.

### v0.7 Tech Debt Carried Forward (NOT in milestone, candidates for v0.8 scope)

- **Phase 25 provider-only path:** `normalizeIssue` excluye `updated_at`/`created_at` del TaskItem canónico (D-18 leak guard); `shouldDispatch` evaluaría contra `undefined` si el caller usa provider-only path en producción real. Path productivo es client-direct.
- **Phase 26-02 T-26-DIAG:** silent daemon crash sin logfile. Prep `--verbose` flag para v0.8.
- **Phase 26-02 timing-sensitive caso 2:** 700ms SIGINT race no-emerged en ejecución; prep `--polling`-status liveness check para v0.8.

### v0.6 Deferred (still deferred, NOT in v0.7 scope)

- Phase 19 CR-01 — `findSession` no busca en `state.history` (latent bug). Defer a phase dedicada al lifecycle SessionRecord.
- Phase 22 WR-07 — `markSessionStatus` early-return refactor estructural. Defer.
- Phase 21 WR-04/05/06 advisory — pureza `syncSkill`, async cleanup. Defer.

## Session Continuity

- **Last session:** 2026-05-15T06:50:00Z
- **Stopped at:** v0.7 milestone archived; awaiting next milestone scope
- **Next action:** `/gsd-new-milestone` para arrancar v0.8 con scope definido
- **Files of record:**
  - `.planning/PROJECT.md` (Current State actualizado con v0.7 shipped + v0.8 candidates)
  - `.planning/ROADMAP.md` (v0.7 collapsed; awaiting v0.8 phases)
  - `.planning/STATE.md` (este archivo)
  - `.planning/v0.7-MILESTONE-AUDIT.md` (final audit — passed)
  - `.planning/milestones/v0.7-ROADMAP.md` (full milestone archive)
  - `.planning/milestones/v0.7-REQUIREMENTS.md` (requirements archive — 16/16 satisfied)
  - `.planning/milestones/v0.7-phases/` (5 phase directories archived)
