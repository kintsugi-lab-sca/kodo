---
gsd_state_version: 1.0
milestone: v0.4
milestone_name: GSD Quick Mode
status: roadmap_complete
stopped_at: Roadmap created — Phase 11 ready to plan
last_updated: "2026-04-28T11:44:00.000Z"
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Milestone:** v0.4 — GSD Quick Mode
**Last updated:** 2026-04-28

## Project Reference

**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — una tarea Plane etiquetada `kodo:gsd` (full) o `kodo:gsd-quick` (one-shot) arranca una sesión Claude bajo el workflow GSD, con bootstrap automático, lock per-repo y logs estructurados inspeccionables desde el CLI.

**Current Focus:** Cerrar la cadena `kodo:gsd-quick` end-to-end — el WIP no-committeado tocó label parsing y dispatcher, pero manager + hooks + orchestrator todavía tratan una sesión quick como no-GSD.

## Current Position

Phase: 11 (Quick Mode Recognition & Persistence) — not started
Plan: —
Status: Roadmap aprobado, listo para planificar Phase 11
Last activity: 2026-04-28 — Roadmap v0.4 creado (Phases 11-13)

## Phase Sketch (v0.4)

| Phase | Goal | Requirements | Plans |
|-------|------|--------------|-------|
| 11 — Quick Mode Recognition & Persistence | `gsd_mode` persistido + skip-perms parity + resolver tolerance | QUICK-01..04 | TBD |
| 12 — Hook & Orchestrator Bifurcation | SessionStart, Stop y orchestrator ramifican en `gsd_mode` | QUICK-05..07 | TBD |
| 13 — Test Coverage Matrix | 4 estados × 4 puntos de la cadena | QUICK-08 | TBD |

**Coverage:** 8/8 requirements mapped.

## Accumulated Context

### Roadmap Evolution

- v0.4 milestone iniciado tras v0.3 shipped (2026-04-22). Motivo: WIP no-committeado en `src/labels.js` + `src/triggers/dispatcher.js` introdujo `kodo:gsd-quick` solo en el dispatcher; el resto de la cadena (manager, hooks, orchestrator) sigue tratando una sesión quick como no-GSD. v0.4 cierra esa cadena.
- Roadmap creado 2026-04-28 con 3 fases (Phases 11-13). Numeración continúa desde v0.3 (que terminó en Phase 10), no se resetea.
- Phase 11 cubre data-plane (label → dispatcher → SessionRecord), Phase 12 cubre control-plane (hooks + orchestrator), Phase 13 cierra con la matriz de tests cross-cutting que QUICK-08 enumera explícitamente.

### Decisions (carried from v0.3)

- **Resolver con discriminated union (Phase/Bootstrap/Error verdict):** el modo `quick` reutiliza el mismo resolver pero descarta el `phase_id` cuando hay match y tolera `code: 'no-match'` en error. `roadmap-missing` y `multi-match` siguen fail-closed.
- **Per-repo lock con PID+TTL + realpath:** ambos modos (full y quick) comparten el mismo lock para que `kodo:gsd` y `kodo:gsd-quick` sobre el mismo repo no se solapen.
- **Session-start hook en inglés para el agente, prompt.md orquestador en ES:** se mantiene en v0.4. La rama quick del hook también será inglés (`/gsd-quick "<title>"`).
- **Dispatcher como ÚNICA fuente de `gsd.phase.resolved` y `gsd.bootstrap`:** se mantiene; quick no añade nuevos eventos. `gsd.phase.resolved` se emite con `phase_id` opcional cuando el modo es quick.
- **`kodo:gsd` implica `--dangerously-skip-permissions` (commit `004995c`):** v0.4 extiende el mismo contrato a `kodo:gsd-quick` (QUICK-04).

### Decisions (new in v0.4)

- **`gsd_mode` aditivo y opcional en `SessionRecord`:** las sesiones legacy se siguen leyendo sin migración. Falsy/missing == `'full'` por compatibilidad con sesiones v0.3 ya persistidas.
- **`getGsdMode(flags)` ya implementado en `src/labels.js`:** centraliza la regla de precedencia (`gsd-quick` gana sobre `gsd`). Dispatcher, manager, hooks y tests deben consumir este helper, no `flags.includes(...)` literal.
- **Quick es phase-agnostic:** aunque el resolver pueda devolver `phase` con match exitoso, en modo quick descartamos `phase_id` antes de persistir. La sesión no se ata a una fase.
- **Quick no produce `VERIFICATION.md`:** el orchestrator no debe sugerir `kodo gsd verify` para sesiones quick; el humano revisa manualmente como cualquier sesión no-GSD.

### Blockers

None.

### Open Questions

- ¿El bloque "## Sesiones GSD" de `prompt.md` necesita re-redacción completa, o sólo añadir un párrafo sobre quick? (Resolvable en Phase 12 planning.)

## Session Continuity

- **Last session:** 2026-04-28T11:44:00.000Z
- **Stopped at:** Roadmap creado, esperando que el usuario inicie planificación de Phase 11
- **Next action:** `/gsd-plan-phase 11` para descomponer Phase 11 en plans ejecutables.
- **Files of record:**
  - `.planning/PROJECT.md`
  - `.planning/REQUIREMENTS.md` (v0.4, 8 reqs con traceability poblada)
  - `.planning/ROADMAP.md` (v0.4 phases añadidos)
  - `.planning/MILESTONES.md` (v0.2 + v0.3 shipped)
  - WIP no-committeado: `src/labels.js`, `src/session/state.js`, `src/triggers/dispatcher.js`
  - Plan base: `/Users/alex/.claude/plans/staged-meandering-wind.md`

---
*v0.4 roadmap created: 2026-04-28*
