---
gsd_state_version: 1.0
milestone: v0.18
milestone_name: Higiene del sidebar de cmux
status: planning
last_updated: "2026-07-22T16:00:11.920Z"
last_activity: 2026-07-22
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.17 «Plan vivo por-tarea» SHIPPED 2026-07-22** (verified closeout; audit `tech_debt` sin blockers — 13/13 requirements, Nyquist 5/5 compliant, deuda menor trazada → backlog v0.18). A la espera del siguiente milestone (`/gsd-new-milestone`).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-22 after v0.17).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene; **v0.17 hizo del plan por-tarea estado vivo** (handoff acumulativo + `NEXT:` → dashboard y nudge) + convergencia de `pending` + agrupación de workspaces cmux.

**Current focus:** Planning next milestone (`/gsd-new-milestone`)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-07-22 — Milestone v0.18 started

## Most recent shipped milestone

**v0.17 Plan vivo por-tarea** — shipped 2026-07-22 (5 phases 74-78, 17 plans, 24 tasks; audit `tech_debt` sin blockers — 13/13 reqs · 5/5 fases verificadas · 9/9 seams · 6/6 flujos E2E · Nyquist 5/5 compliant; suite 2027 → 2309 tests, verde completa al cierre; 168 commits). El plan de cada tarea es **estado vivo**: **productor** (Phase 74 — handoff acumulativo `Hecho/Pendiente/NEXT:` en `SessionEnd` pre-cleanup, autoría LLM + backstop mecánico, `NEXT:` en `state.tasks` bajo `withStateLock`; G-74-4 cerrado con detector de deriva en `kodo doctor` + registro real verificado en vivo), **consumidores** (Phase 75 — columna `next` del dashboard, overlay del plan renderizado en `phaseId == null` con D-02 intacto, nudge del orquestador con contexto), **ortogonales** (Phase 76 — `pending` convergido en `src/tasks/pending.js` con frescura discriminada `pending_stale`/`pending_fetched_at`; Phase 77 — workspaces agrupados en cmux por path resuelto vía `--group`, fail-open 2 capas, GRP-04), y **deuda de cierre saldada** (Phase 78 — nudge saneado `stripControlChars`/`stripForKeystroke` cerrando R-75-02 + 8 fixes de 77-REVIEW).

- Roadmap archive: `milestones/v0.17-ROADMAP.md`
- Requirements archive: `milestones/v0.17-REQUIREMENTS.md`
- Audit: `milestones/v0.17-MILESTONE-AUDIT.md`
- Phases: `milestones/v0.17-phases/`

## Deferred Items

Baseline post-v0.17. Todos pre-reconocidos al cierre (audit `tech_debt` sin blockers, verified closeout). Los 8 items menores de v0.17 detallados en `milestones/v0.17-MILESTONE-AUDIT.md` §tech_debt.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Estado | `next` un-clearable una vez seteado en `upsertTaskHandoff` (`src/session/state.js:443`) — un cierre posterior sin `NEXT:` no lo borra; ningún SC lo prometía | Abierto (limitación conocida, heredada por dashboard/nudge) | v0.17 Phase 74 |
| Tests | `test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)» es **flaky** bajo carga (timing). Preexistente de Phase 70; verde en las 3 runs completas de Phase 78 y en la run de cierre (2026-07-22) | Abierto — investigar con `/gsd-debug`; NO arreglar a ciegas (protege el invariante de locks de v0.16) | v0.17 Phase 74 (heredado de v0.16) |
| Doc-drift | 75/WR-02 (comentario App.js «una vez por tick» vs render real) · 75/WR-04 (typedef `overlaySnapshot` sin `render`) — solo documentación | Abierto (menor) | v0.17 Phase 75 |
| Render TUI | 75/WR-03: `nextCell` no colapsa `\n`/`\t` en el RENDER de fila (solo alcanzable por state.json hand-editado; carril keystroke cerrado en Phase 78) · fidelidad markdown best-effort (`#`/`**` inline visibles, dentro del contrato declarado) | Abierto (menor; fricción → v0.18 si molesta en uso real) | v0.17 Phase 75 |
| Operación | El grupo cmux `SCP-CMRi` del operador no matchea el identifier derivado `SCP` — tareas SCP se lanzan sin grupo (fail-open correcto); renombrar el grupo a `SCP` para agruparlas | Acción de operador | v0.17 Phase 77 |
| Riesgo aceptado | IN-07 / R-77-D10 (LOCKED D-10): el retry TOCTOU de `newWorkspaceWithGroupFallback` puede duplicar workspace ante timeout | Aceptado y documentado (78-SECURITY.md §Accepted Risks) | v0.17 Phase 77 |
| Verificación empírica | CONC-09 — sign-off humano de la ubicación real de worktrees (`.bg-shell` vs `.claude/worktrees`); `doctor --fix` scan path sin cambiar hasta confirmarlo en sesión GSD viva | Diferido por diseño (D-15, precedente 50.1); análisis en `milestones/v0.16-phases/70-.../70-WORKTREE-VERIFICATION.md` | v0.16 Phase 70 |
| UAT | Backstop GitHub real (nunca cierra issues) — skip reconocido por el operador 2026-07-09; mock de 3 capacidades como cobertura compensatoria | Abierto (requiere repo GitHub real) | v0.16 Phase 71 |
| Cliente Plane | B12b — throttle epoch-vs-delta (`x-ratelimit-reset` no confirmable barato en Plane self-hosted) | Diferido con nota (D-02) | v0.16 Phase 72 |
| Nyquist | VALIDATION.md en draft (mapa por-task vacío) en Phases 69/71/72 — cobertura real de tests sí evidenciada en VERIFICATION (las 5 fases de v0.17 SÍ quedaron validated al cierre) | Saldable con `/gsd-validate-phase` retroactivo | v0.16 |
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera de roadmap) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions — v0.17 añadió 8 filas (agrupación por path resuelto, fail-open 2 capas, GRP-04 consume-no-gestiona, handoff pre-cleanup LLM+backstop, `state.tasks` aditivo never-throws, detector de deriva instalación↔settings, convergencia por hoja cero-imports, saneo en punto de composición). Las decisiones per-plan de v0.17 quedaron archivadas con sus fases en `milestones/v0.17-phases/`.

### Open Blockers

Ninguno. v0.17 cerró con audit `tech_debt` sin blockers (verified closeout).

### Critical Invariants to Preserve (cross-milestone)

- **`/webhook` conserva HMAC y `/health` queda abierto** — la auth bearer es SOLO para el carril no-webhook.
- **Boundary PERSIST-04:** API key y bearer token solo en `~/.kodo/.env` (0600); nunca renderizados/logueados/en `/status`/en argv.
- **Server loopback-first:** bind `127.0.0.1` por defecto; exponer requiere `config.server.bind` explícito (topología multi-nodo en README).
- **Modelo daemon PERSISTENTE:** solo `kodo stop` lo tumba; PID ownership de v0.16 (CONC-04/05) no puede regresionar esto.
- **Escrituras de `state.json` bajo `withStateLock`** — cualquier escritor nuevo DEBE pasar por la primitiva (`src/session/state.js`); `reconcileTick` sigue siendo el único escritor de `alive`.
- **D-02 (v0.11 Phase 46):** `readPlan` da prioridad a GSD; el plan ligero (y el handoff) solo se surface en la rama `phaseId == null`. El handoff se escribe en disco para TODA sesión, pero no se pinta en el overlay GSD.
- **El handoff se escribe ANTES del cleanup terminal destructivo de `SessionEnd`** (`removeSession` + worktree + promptFile) — v0.17 Phase 74.
- **Contenido LLM hacia terminal/keystroke SIEMPRE saneado** (`stripControlChars` en composición, `stripForKeystroke` en el carril keystroke) — v0.17 Phase 78; simetría con HYG-07.
- **kodo consume grupos cmux, jamás los gestiona (GRP-04):** solo verbo `list` + flag `--group`; refs `workspace_group:N` nunca persistidos — v0.17 Phase 77 (re-fronterizable solo vía el carril doctor de la candidata 999.3).
- **Backstop de «In Review» en `SessionEnd` con gate de estado no-terminal** — jamás transicionar a un estado terminal (GitHub `closed`); el orden de efectos `backstop→setColor→notify` es LOCKED (D-08).
- **Auto-commit del orquestador gated por `KODO_ORCHESTRATOR=1` + pathspec** — sin la var → skip (cero commits fantasma).
- **`kodo start` legacy intacto** · **Cero endpoints nuevos en `src/server.js` (desde v0.10)** · **Cero nuevas dependencias npm** (locks vía `node:fs` built-in) · **TaskProvider contract FROZEN en 9** + métodos opcionales por `typeof` · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**.

### Roadmap Evolution

- (vacío — se rellena durante el siguiente milestone)

## Session Continuity

**Last session:** 2026-07-22 — cierre del milestone v0.17

**Resume file:**

None

- **Stopped at:** Milestone v0.17 archivado (roadmap + requirements + audit + phases) y tagged
- **Next action:** `/gsd-new-milestone` — questioning → research → requirements → roadmap. Candidatas del backlog: 999.2 (Inbox de capturas) y 999.3 (sidebar doctor + reconciliación skill/prompt con v0.17); + 8 items de tech debt v0.17 elegibles
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-22 after v0.17)
  - `.planning/ROADMAP.md` (v0.17 colapsado; Backlog con 999.1 + 999.2 + 999.3)
  - `.planning/MILESTONES.md` (entrada v0.17 completa)
  - `.planning/RETROSPECTIVE.md` (sección v0.17 añadida)
  - `.planning/milestones/v0.17-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `v0.17-phases/`
  - `.planning/REQUIREMENTS.md` eliminado (se crea fresco en `/gsd-new-milestone`)

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (baseline post-v0.17 — métricas per-plan de v0.17 archivadas en `milestones/v0.17-phases/`; medias v0.17: ~12 min/plan, 17 plans) |
