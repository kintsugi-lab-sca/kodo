---
gsd_state_version: 1.0
milestone: v0.7
milestone_name: GitHub Issues Adapter
status: completed
stopped_at: Phase 26 context gathered
last_updated: "2026-05-14T18:42:59.095Z"
last_activity: 2026-05-14 -- Phase 26 marked complete
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 11
  completed_plans: 10
  percent: 60
---

# Project State

**Project:** kodo
**Active milestone:** v0.7 — GitHub Issues Adapter (roadmap defined 2026-05-13; Phases 23-27 derived from REQUIREMENTS.md)
**Last updated:** 2026-05-13

## Project Reference

See: `.planning/PROJECT.md` (Current Milestone v0.7)

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. v0.7 valida la promesa de v0.2 implementando GitHub Issues como segundo adapter junto al de Plane.

**Current focus:** Phase 23 — githubclient-auth-foundation

## Current Position

Phase: 26 — COMPLETE
Plan: 3 of 3 (CFG-03 shipped; CFG-04 pending)
Status: Phase 26 complete
Last activity: 2026-05-14 -- Phase 26 marked complete

## Phases (v0.7)

- [ ] Phase 23: GitHubClient + Auth Foundation (GH-01)
- [ ] Phase 24: GitHubProvider + Normalizer + Registry (GH-02, GH-03, GH-04, GH-05, TEST-01)
- [ ] Phase 25: Polling Trigger Channel (POLL-01, POLL-02, POLL-03, POLL-04, TEST-02)
- [ ] Phase 26: Config Wizard + CLI Integration (CFG-01, CFG-02, CFG-03, CFG-04)
- [ ] Phase 27: Cross-Provider Contract Matrix (TEST-03)

## Accumulated Context

### Roadmap (recent)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`.
- **v0.6 Session Isolation & Skill Sync** — shipped 2026-05-13. See `milestones/v0.6-ROADMAP.md`, `v0.6-MILESTONE-AUDIT.md`.

### Open Blockers

None.

### Open Questions

- ¿GH-03 normalizer debe extraer milestone GitHub a algún campo de TaskItem? → Decisión en plan Phase 24 (default: ignorar; TaskItem.priority cubre el ordering signal).
- ¿POLL-04 retry debe escalar a `polling.stopped` event si los 3 retries agotan? → Decisión en plan Phase 25 (probable: warn-and-continue, el siguiente tick reintenta).
- ¿CFG-04 `--polling` debe rechazar arrancar si detecta `polling.pid` activo (mutex explícito) o documentarlo en help text (mutex implícito)? → Decisión en plan Phase 26.

### Critical Invariants to Preserve (cross-phase v0.7)

- **TaskProvider 9-method contract** (canonical en `src/interface.js:50-60`): `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. `getProvider('github')` valida con `TASK_PROVIDER_METHODS`. Phase 24 SC#3. _Corregido 2026-05-14 vía Phase 24 CONTEXT.md D-01 — la lista anterior (`listTasks`, `listLabels`, `listStates`, `transitionTask`) era fantasía del roadmapper inicial; el registry los rechazaría._
- **TaskItem/TriggerEvent shapes provider-agnostic** (v0.2): `parseKodoLabels` opera sobre `string[]` sin saber si vino de Plane labels o GitHub labels. Phase 24 SC#4 — zero cambios en `src/labels.js`.
- **Constraint cwd=repo Phase 999.1**: orchestrator se lanza desde el repo para auto-cargar skill. `kodo orchestrator --polling` (Phase 26 SC#4) NO debe alterar este contrato — el polling vive en el mismo proceso, no en un worktree.
- **Lock per-repo Phase 8 GSD-10**: el dispatcher coalesce sesiones por repo. POLL-03 (Phase 25 SC#3) delega idempotencia al lock — no introduce nuevo mecanismo de dedup.
- **Dispatcher fire-and-forget** (v0.2): el polling channel emula el patrón webhook — la detección emite `dispatchTrigger` y continúa el loop, sin esperar al launch.
- **LOG-12 guard**: `kodo check` no carga `src/logger.js` transitivamente. Phase 25 polling.js es independiente — `kodo check` NO importa polling.js. Validar en plan.
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. Phase 26 CLI handlers (`kodo polling start/stop/status`) consumen `createFormatter(stream)`, NO importan `picocolors` directo.
- **`--json` byte-determinismo** (DX-06): si Phase 26 añade `--json` flag a `kodo polling status`, debe respetar bytes idénticos TTY/no-TTY.
- **Worktree always-on Phase 18**: polling dispara `dispatchTrigger` que sigue el path Launch → `computeWorktreePath` → spawn. Phase 25 NO toca el path del worktree.
- **HOOK-01 universal Phase 20**: el bloque anti-push-fantasma se inyecta en TODAS las sesiones (full + quick + no-GSD). Una sesión disparada por polling sobre un GitHub Issue debe recibirlo idéntico. Validación en TEST-03 matrix Phase 27.

### v0.6 Deferred (carried, NOT in v0.7 scope)

- Phase 19 CR-01 — `findSession` no busca en `state.history` (latent bug). Defer a phase dedicada al lifecycle SessionRecord.
- Phase 22 WR-07 — `markSessionStatus` early-return refactor estructural. Defer.
- Phase 21 WR-04/05/06 advisory — pureza `syncSkill`, async cleanup. Defer.

## Session Continuity

- **Last session:** 2026-05-14T18:35:34.906Z
- **Stopped at:** Phase 26 context gathered
- **Next action:** `/gsd-plan-phase 23` para arrancar GitHubClient + Auth Foundation
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone v0.7, scope confirmado)
  - `.planning/REQUIREMENTS.md` (16 requirements en 4 categorías, traceability completo Phases 23-27)
  - `.planning/ROADMAP.md` (5 fases v0.7 + 5 milestones archived en details colapsado)
  - `.planning/STATE.md` (este archivo)
  - `.planning/milestones/v0.6-ROADMAP.md` (precedente — Session Isolation & Skill Sync structure)
  - `.planning/milestones/v0.2-ROADMAP.md` (precedente — original provider abstraction; reference para patterns)
  - `src/providers/plane/` (analog para GitHub provider; misma shape esperada)
  - `src/providers/registry.js` (factory function pattern)
  - `src/triggers/` (existing trigger channels — `dispatcher.js`, `webhook.js`; polling será el 3rd canal)

---
*v0.7 roadmap emitido: 2026-05-13. 5 fases (23-27), 16 requirements, 100% coverage. Granularity coarse aplicada (bundle provider+normalizer+registry+tests en P24, bundle polling completo en P25, bundle config wizard + CLI en P26; P23 aislada como foundation; P27 aislada para cross-provider matrix).*

## Deferred Items

Items acknowledged and deferred at milestone v0.6 close on 2026-05-13:

| Category | Phase | Item | Status | Rationale |
|----------|-------|------|--------|-----------|
| uat_gaps | 19 | 19-HUMAN-UAT.md | partial (3 pending) | Smoke UATs no ejecutados; cleanup automatizado cubre happy path. |
| verification_gaps | 19 | 19-VERIFICATION.md | human_needed | CR-01 latent bug `findSession` no busca en `state.history` — accepted by alex (override docs/19-VERIFICATION.md). |
| verification_gaps | 22 | 22-VERIFICATION.md | human_needed | WR-07 deferred — `markSessionStatus` early-return regresiona T20 fixture; refactor estructural defer a v0.7+. |

Detailed rationale in `.planning/v0.6-MILESTONE-AUDIT.md`.
