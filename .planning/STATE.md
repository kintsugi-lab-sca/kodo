---
gsd_state_version: 1.0
milestone: v0.6
milestone_name: Session Isolation & Skill Sync
status: planning
last_updated: "2026-05-11T14:40:29.778Z"
last_activity: 2026-05-11
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Active milestone:** v0.6 — Session Isolation & Skill Sync (initialized 2026-05-11; requirements + roadmap pendientes)
**Last updated:** 2026-05-11

## Project Reference

See: `.planning/PROJECT.md` (Current Milestone v0.6)

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo, disparando dos modos GSD (full multi-fase / quick one-shot) sin acoplar el código GSD al proveedor.

**Current focus:** Definir REQUIREMENTS.md + ROADMAP.md de v0.6. Scope: worktree always-on, HOOK-01 universal, SKILL-01 (`kodo skill sync` manual + auto en orchestrator), tech debt v0.5 closure (Phase 14/15/16). Adapters (GitHub/ClickUp/local) y polling/file-watcher deferidos a v0.7+.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-11 — Milestone v0.6 started

## Accumulated Context

### Roadmap (recent)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`. Phase artifacts: `milestones/v0.4-phases/`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`, `milestones/v0.5-REQUIREMENTS.md`, `milestones/v0.5-MILESTONE-AUDIT.md`.

### Open Blockers

None.

### Open Questions

- ¿Auto-sync de SKILL-01 en `kodo orchestrator` rompe la Constraint cwd=repo (Phase 999.1 D-04/D-05/D-06)? Reevaluar al planificar la fase SKILL-01.
- ¿El worktree always-on requiere cambios en el lock per-repo (Phase 8 GSD-10), `KODO_ROOT` (Phase 999.1) o auto-commit path (`stop.js`)?
- ¿HOOK-01 universal altera bytes del prompt en sesiones GSD? Validar golden bytes y tags `[GSD quick/phase N/bootstrap]`.

### Critical Invariants to Preserve (cross-phase)

- **LOG-12 guard**: `kodo check` NO debe cargar `src/logger.js` transitivamente. Reafirmado por Phase 14 (helper aislado) y Phase 15 (`kodo check` cableado sin importar logger).
- **Color isolation**: `picocolors` solo se importa desde `src/cli/format.js`. Cualquier nuevo callsite que necesite color DEBE consumir `createFormatter(stream)` — `test/format-isolation.test.js` blinda con grep + walker.
- **`--json` determinismo**: bytes idénticos entre TTY y no-TTY (DX-06 invariante). Golden bytes test cubre `kodo logs --json` y los demás surfaces hacen early-return.
- **Source-hygiene D-09/D-10/D-11**: anti-inline anti-direct-access para `gsd_mode` derivation. Cualquier consumer de modo va por `getGsdMode(flags)` / `getSessionMode(session)`.
- **Lock release idempotente** (Phase 8 GSD-10): preservado tras cableado de `markSessionStatus` en `stop.js` (Phase 16) — emit BEFORE mutation (D-08).
- **Orchestrator cwd = repo kodo**: `kodo orchestrator` debe lanzarse desde el directorio del repo para que `.claude/skills/kodo-orchestrate/skill.md` se auto-cargue. Fallback: `src/orchestrator/prompt.md` provider-specific.

## Session Continuity

- **Last session:** 2026-05-11 — v0.6 initialized
- **Stopped at:** PROJECT.md actualizado con Current Milestone v0.6; STATE.md reset; pendiente REQUIREMENTS.md + ROADMAP.md
- **Next action:** Decidir research/skip → definir requirements → spawn `gsd-roadmapper`
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone v0.6, scope confirmado)
  - `.planning/STATE.md` (este archivo)
  - `.planning/ROADMAP.md` (v0.5 colapsado — pendiente regenerar para v0.6)
  - `.planning/MILESTONES.md` (v0.5 entry con 5 fases, 13/13 reqs, tech debt)
  - `.planning/milestones/v0.5-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md`

---
*v0.6 milestone initialized: 2026-05-11. Goal: aislar sesiones en worktrees, sync skill canonical, anti-push-fantasma universal, cerrar tech debt v0.5.*
