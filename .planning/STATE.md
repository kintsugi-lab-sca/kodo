---
gsd_state_version: 1.0
milestone: v0.6
milestone_name: Session Isolation & Skill Sync
status: planning
stopped_at: Phase 19 context gathered
last_updated: "2026-05-12T10:47:34.748Z"
last_activity: 2026-05-12
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 100
---

# Project State

**Project:** kodo
**Active milestone:** v0.6 — Session Isolation & Skill Sync (roadmap defined 2026-05-11; Phases 18-22 derived from REQUIREMENTS.md)
**Last updated:** 2026-05-11

## Project Reference

See: `.planning/PROJECT.md` (Current Milestone v0.6)

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo, disparando dos modos GSD (full multi-fase / quick one-shot) sin acoplar el código GSD al proveedor.

**Current focus:** Phase 18 — worktree-runtime-wiring

## Current Position

Phase: 19
Plan: Not started
Status: Ready to plan
Last activity: 2026-05-12

## Phases (v0.6)

- [ ] Phase 18: Worktree Runtime Wiring (WT-01, WT-02, WT-03)
- [ ] Phase 19: Worktree Cleanup & Integration (WT-04, WT-05, WT-06)
- [ ] Phase 20: HOOK-01 Universal Anti-Push-Fantasma (HOOK-01, HOOK-02, HOOK-03)
- [ ] Phase 21: Skill Sync CLI + Auto-Sync (SKILL-01, SKILL-02, SKILL-03, SKILL-04)
- [ ] Phase 22: Tech Debt v0.5 Closure (DEBT-01..DEBT-06)

## Accumulated Context

### Roadmap (recent)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`. Phase artifacts: `milestones/v0.4-phases/`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`, `milestones/v0.5-REQUIREMENTS.md`, `milestones/v0.5-MILESTONE-AUDIT.md`.

### Open Blockers

None.

### Open Questions

- ¿Auto-sync de SKILL-01 en `kodo orchestrator` rompe la Constraint cwd=repo (Phase 999.1 D-04/D-05/D-06)? → Reflejado en SC#3 de Phase 21; resolver en plan de fase.
- ¿El worktree always-on requiere cambios en el lock per-repo (Phase 8 GSD-10), `KODO_ROOT` (Phase 999.1) o auto-commit path (`stop.js`)? → Cubierto explícitamente: lock NO toca worktree (Phase 18 SC#3), `KODO_ROOT` y auto-commit cwd cableados en Phase 19 SC#2.
- ¿HOOK-01 universal altera bytes del prompt en sesiones GSD? → Cubierto por Phase 20 SC#2 (golden bytes invariante).

### Critical Invariants to Preserve (cross-phase)

- **LOG-12 guard**: `kodo check` NO debe cargar `src/logger.js` transitivamente. Reafirmado por Phase 14 (helper aislado) y Phase 15 (`kodo check` cableado sin importar logger). Aplica a Phase 22 al retirar `ANSI_*` exports.
- **Color isolation**: `picocolors` solo se importa desde `src/cli/format.js`. Cualquier nuevo callsite que necesite color DEBE consumir `createFormatter(stream)` — `test/format-isolation.test.js` blinda con grep + walker.
- **`--json` determinismo**: bytes idénticos entre TTY y no-TTY (DX-06 invariante). Aplica a `kodo skill sync` cuando emita JSON (Phase 21).
- **Source-hygiene D-09/D-10/D-11**: anti-inline anti-direct-access para `gsd_mode` derivation. Cualquier consumer de modo va por `getGsdMode(flags)` / `getSessionMode(session)`.
- **Lock release idempotente** (Phase 8 GSD-10): preservado tras cableado de `markSessionStatus` en `stop.js` (Phase 16) — emit BEFORE mutation (D-08). Phase 19 cleanup del worktree NO debe alterar la idempotencia del release.
- **Orchestrator cwd = repo kodo** (Phase 999.1 D-04..D-06): `kodo orchestrator` debe lanzarse desde el repo para que `.claude/skills/kodo-orchestrate/skill.md` se auto-cargue. Phase 21 SKILL-02 auto-sync NO debe romper este contrato (skill local sigue ganando; sync solo asegura que home no quede stale).
- **Golden bytes GSD tags**: `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]` no mutan en shape ni offset relativo. Phase 20 HOOK-02 lo blinda con golden bytes test modo-por-modo.

## Session Continuity

- **Last session:** 2026-05-12T10:47:34.740Z
- **Stopped at:** Phase 19 context gathered
- **Next action:** `/gsd-plan-phase 18` para arrancar Worktree Runtime Wiring
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone v0.6, scope confirmado)
  - `.planning/REQUIREMENTS.md` (19 requirements en 4 categorías, traceability completo)
  - `.planning/ROADMAP.md` (5 fases v0.6 + historicos colapsados)
  - `.planning/STATE.md` (este archivo)
  - `.planning/MILESTONES.md` (v0.5 entry con 5 fases, 13/13 reqs, tech debt)
  - `.planning/milestones/v0.5-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md`

---
*v0.6 roadmap emitido: 2026-05-11. 5 fases (18-22), 19 requirements, 100% coverage. Granularity coarse aplicada (bundle de tech debt, split worktree por surface area).*
