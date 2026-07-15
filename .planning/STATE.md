---
gsd_state_version: 1.0
milestone: v0.17
milestone_name: activo)
current_phase: 74
current_phase_name: Handoff acumulativo al cierre
status: executing
stopped_at: Phase 74 context gathered
last_updated: "2026-07-15T10:02:30.027Z"
last_activity: 2026-07-15
last_activity_desc: Phase 74 execution started
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 5
  completed_plans: 1
  percent: 0
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.17 «Plan vivo por-tarea»** con roadmap creado 2026-07-15 — **Phases 74-76**, 9/9 requirements mapeados. Primer milestone de features tras v0.16 Hardening (shipped 2026-07-15, audit PASSED). Listo para `/gsd-discuss-phase 74`.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-15 after v0.16).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene (remediación completa de la auditoría adversarial 2026-07-03/05).

**Current focus:** Phase 74 — Handoff acumulativo al cierre

## Current Position

Phase: 74 (Handoff acumulativo al cierre) — EXECUTING
Plan: 2 of 5
Status: Ready to execute
Progress: [░░░░░░░░░░░░░░░░░░░░] 0% (0/3 fases)
Last activity: 2026-07-15 — Phase 74 execution started

**Fases del milestone:**

| Fase | Goal (resumen) | Requirements | Depende de |
|------|----------------|--------------|------------|
| 74 | Handoff acumulativo `## Handoff <fecha>` en `SessionEnd` (pre-cleanup, LLM + backstop mecánico) + puntero/`NEXT:` en `state.json` bajo `withStateLock` | LIVE-01..04 | v0.16 Phase 70 (shipped) |
| 75 | `NEXT:` en la lista del dashboard + plan completo renderizado en `phaseId == null` (D-02 intacto) + nudge con contexto | LIVE-05, LIVE-06, LIVE-07 | Phase 74 |
| 76 | `/status` y `kodo check` convergen en `pending_count`; provider caído no sirve conteo caducado como fresco | ORCH-05, ORCH-06 | ninguna (paralelizable) |

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
| Orchestrator | ORCH-05 — discrepancia del conteo `pending` entre `check.js` y la vista del orchestrator (ex-Phase 73, retirada por eliminación 2026-07-14) | **Promovido → v0.17 Phase 76** (con ORCH-06, causa raíz localizada en código) | — |
| Nyquist | VALIDATION.md en draft (mapa por-task vacío) en Phases 69/71/72 — cobertura real de tests sí evidenciada en VERIFICATION | Saldable con `/gsd-validate-phase` retroactivo | v0.16 |
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera de roadmap) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions (v0.16 añadió 8 filas: bind+bearer default-deny, advisory lockfile vs single-writer, backstop mecánico + gate no-terminal, cursor confirmado, borrar-no-cablear, auto-commit gated, Phase 73 retirada por eliminación).

- [Phase 74-01]: sessionId NO se sanea en buildHandoffBlock — writer y parser deben usar el mismo valor crudo o la deteccion D-04 daria falsos negativos permanentes
- [Phase 74-01]: el truncado del NEXT a 200 vive en extractNext (el contrato), no en el caller (D-02)
- [Phase 74-01]: src/session/handoff.js es hoja de CERO imports, blindada por test/check-isolation.test.js (D-13)

### Open Blockers

Ninguno. v0.16 cerró con audit PASSED (verified closeout).

### Critical Invariants to Preserve (cross-milestone)

- **`/webhook` conserva HMAC y `/health` queda abierto** — la auth bearer es SOLO para el carril no-webhook.
- **Boundary PERSIST-04:** API key y bearer token solo en `~/.kodo/.env` (0600); nunca renderizados/logueados/en `/status`/en argv.
- **Server loopback-first:** bind `127.0.0.1` por defecto; exponer requiere `config.server.bind` explícito (topología multi-nodo en README).
- **Modelo daemon PERSISTENTE:** solo `kodo stop` lo tumba; PID ownership de v0.16 (CONC-04/05) no puede regresionar esto.
- **Escrituras de `state.json` bajo `withStateLock`** — cualquier escritor nuevo DEBE pasar por la primitiva (`src/session/state.js`); `reconcileTick` sigue siendo el único escritor de `alive`.
- **D-02 (v0.11 Phase 46):** `readPlan` da prioridad a GSD; el plan ligero (y el handoff) solo se surface en la rama `phaseId == null`. El handoff se escribe en disco para TODA sesión, pero no se pinta en el overlay GSD.
- **El handoff se escribe ANTES del cleanup terminal destructivo de `SessionEnd`** (`removeSession` + worktree + promptFile) — v0.17 Phase 74.
- **Backstop de «In Review» en `SessionEnd` con gate de estado no-terminal** — jamás transicionar a un estado terminal (GitHub `closed`); el orden de efectos `backstop→setColor→notify` es LOCKED (D-08).
- **Auto-commit del orquestador gated por `KODO_ORCHESTRATOR=1` + pathspec** — sin la var → skip (cero commits fantasma).
- **`kodo start` legacy intacto** · **Cero endpoints nuevos en `src/server.js` (desde v0.10)** · **Cero nuevas dependencias npm** (locks vía `node:fs` built-in) · **TaskProvider contract FROZEN en 9** + métodos opcionales por `typeof` · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**.

## Session Continuity

**Resume file:** .planning/phases/74-handoff-acumulativo-al-cierre/74-CONTEXT.md

- **Last session:** 2026-07-15T10:01:59.182Z
- **Stopped at:** Phase 74 context gathered
- **Next action:** `/gsd-discuss-phase 74` — clavar el **formato del handoff** (contrato parseable: detectar «¿hay bloque nuevo?» para LIVE-03 y extraer el `NEXT:` para LIVE-04); es el hueco detectado el 2026-07-15 y bloquea a las tres fases LIVE
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-15 after v0.16)
  - `.planning/REQUIREMENTS.md` (v0.17 — 9 requirements, traceability 9/9)
  - `.planning/ROADMAP.md` (v0.17 activo Phases 74-76; v0.16 y anteriores colapsados; Backlog con 999.1 + 999.2 Inbox)
  - `.planning/MILESTONES.md` (entrada v0.16 completa)
  - `.planning/milestones/v0.16-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md`

## Operator Next Steps

- `/gsd-discuss-phase 74` — formato del handoff + punto de escritura pre-cleanup en `SessionEnd`
- Phase 76 es ortogonal (server/check, no toca hooks ni planes): puede lanzarse en paralelo a 74/75 si interesa

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (baseline v0.17 — métricas de v0.16 archivadas en `milestones/v0.16-phases/`) |
| Phase 74 P01 | 18m | 3 tasks | 3 files |
