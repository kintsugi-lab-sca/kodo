---
gsd_state_version: 1.0
milestone: v0.16
milestone_name: Hardening
current_phase: null
current_phase_name: null
status: Awaiting next milestone
stopped_at: Milestone v0.16 shipped
last_updated: "2026-07-15T07:30:00.000Z"
last_activity: 2026-07-15
last_activity_desc: Milestone v0.16 completed, audited (PASSED) and archived
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 18
  completed_plans: 18
  percent: 100
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.16 Hardening SHIPPED 2026-07-15** (4 phases 69-72, 18 plans, 44 tasks; audit PASSED 27/27 reqs · 6/6 seams · E2E completo; suite 2027 tests). No hay milestone activo — siguiente paso: `/gsd-new-milestone`.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-15 after v0.16).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene (remediación completa de la auditoría adversarial 2026-07-03/05).

**Current focus:** Planificar el siguiente milestone (`/gsd-new-milestone`). Candidatas v0.17 (features): Phase 74 «Plan vivo por-tarea» (LIVE-01..04) · Phase 75 «Inbox de capturas global» (CAPT-01..04) · ORCH-05.

## Current Position

Phase: — (milestone v0.16 shipped y archivado)
Plan: —
Status: Awaiting next milestone
Last activity: 2026-07-15 — Milestone v0.16 completed, audited (PASSED) and archived

## Most recent shipped milestone

**v0.16 Hardening** — shipped 2026-07-15 (4 phases 69-72, 18 plans, 44 tasks; audit PASSED 27/27 reqs · 6/6 seams · flujo E2E completo; suite 1788 → 2027 tests; 157 commits). Remediación de la auditoría adversarial en 4 olas por causa raíz: **red** (bind `127.0.0.1` + bearer default-deny, `/webhook` HMAC y `/health` intactos), **concurrencia/PID** (advisory locks `O_EXCL`+CAS sobre `state.json`, zombi libera slot de `max_parallel`, PID ownership + anti-PID-reuse), **entrega/backstop** (cursor de polling con dispatch confirmado + centinela, `adopt` idempotente por `task_url`, backstop mecánico de «In Review» en `SessionEnd` con gate no-terminal), **higiene** (auto-commit gated `KODO_ORCHESTRATOR=1`, `up --url`/`startHealthLoop` borrados, config endurecida, BAJAS, README reconciliado).

- Roadmap archive: `milestones/v0.16-ROADMAP.md`
- Requirements archive: `milestones/v0.16-REQUIREMENTS.md`
- Audit: `milestones/v0.16-MILESTONE-AUDIT.md`
- Phases: `milestones/v0.16-phases/`

## Deferred Items

Baseline post-v0.16. Todos pre-reconocidos al cierre (audit PASSED, verified closeout).

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Verificación empírica | CONC-09 — sign-off humano de la ubicación real de worktrees (`.bg-shell` vs `.claude/worktrees`); `doctor --fix` scan path sin cambiar hasta confirmarlo en sesión GSD viva | Diferido por diseño (D-15, precedente 50.1); análisis en `milestones/v0.16-phases/70-.../70-WORKTREE-VERIFICATION.md` | v0.16 Phase 70 |
| UAT | Backstop GitHub real (nunca cierra issues) — skip reconocido por el operador 2026-07-09; mock de 3 capacidades como cobertura compensatoria | Abierto (requiere repo GitHub real) | v0.16 Phase 71 |
| Cliente Plane | B12b — throttle epoch-vs-delta (`x-ratelimit-reset` no confirmable barato en Plane self-hosted) | Diferido con nota (D-02) | v0.16 Phase 72 |
| Orchestrator | ORCH-05 — discrepancia del conteo `pending` entre `check.js` y la vista del orchestrator (ex-Phase 73, retirada por eliminación 2026-07-14) | Backlog (ROADMAP.md §Backlog) | — |
| Nyquist | VALIDATION.md en draft (mapa por-task vacío) en Phases 69/71/72 — cobertura real de tests sí evidenciada en VERIFICATION | Saldable con `/gsd-validate-phase` retroactivo | v0.16 |
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera de roadmap) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions (v0.16 añadió 8 filas: bind+bearer default-deny, advisory lockfile vs single-writer, backstop mecánico + gate no-terminal, cursor confirmado, borrar-no-cablear, auto-commit gated, Phase 73 retirada por eliminación).

### Open Blockers

Ninguno. v0.16 cerró con audit PASSED (verified closeout).

### Critical Invariants to Preserve (cross-milestone)

- **`/webhook` conserva HMAC y `/health` queda abierto** — la auth bearer es SOLO para el carril no-webhook.
- **Boundary PERSIST-04:** API key y bearer token solo en `~/.kodo/.env` (0600); nunca renderizados/logueados/en `/status`/en argv.
- **Server loopback-first:** bind `127.0.0.1` por defecto; exponer requiere `config.server.bind` explícito (topología multi-nodo en README).
- **Modelo daemon PERSISTENTE:** solo `kodo stop` lo tumba; PID ownership de v0.16 (CONC-04/05) no puede regresionar esto.
- **Escrituras de `state.json` bajo `withStateLock`** — cualquier escritor nuevo DEBE pasar por la primitiva (`src/session/state.js`); `reconcileTick` sigue siendo el único escritor de `alive`.
- **Backstop de «In Review» en `SessionEnd` con gate de estado no-terminal** — jamás transicionar a un estado terminal (GitHub `closed`); el orden de efectos `backstop→setColor→notify` es LOCKED (D-08).
- **Auto-commit del orquestador gated por `KODO_ORCHESTRATOR=1` + pathspec** — sin la var → skip (cero commits fantasma).
- **`kodo start` legacy intacto** · **Cero endpoints nuevos en `src/server.js` (desde v0.10)** · **Cero nuevas dependencias npm** (locks vía `node:fs` built-in) · **TaskProvider contract FROZEN en 9** + métodos opcionales por `typeof` · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**.

## Session Continuity

- **Last session:** 2026-07-15 — cierre de milestone v0.16 (audit + archivado + tag)
- **Stopped at:** Milestone v0.16 shipped
- **Next action:** `/gsd-new-milestone` — definir v0.17 (candidatas: Phases 74-75 + ORCH-05 en Backlog)
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-15 after v0.16)
  - `.planning/ROADMAP.md` (v0.16 colapsado; Backlog con Phases 74-75)
  - `.planning/MILESTONES.md` (entrada v0.16 completa)
  - `.planning/milestones/v0.16-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md`

## Operator Next Steps

- `/gsd-new-milestone` para definir v0.17 (requirements frescos; REQUIREMENTS.md se regenera)

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (baseline v0.17 — métricas de v0.16 archivadas en `milestones/v0.16-phases/`) |
