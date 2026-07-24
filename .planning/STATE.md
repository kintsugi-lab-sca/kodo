---
gsd_state_version: 1.0
milestone: v0.18
milestone_name: Higiene del sidebar de cmux
status: Awaiting next milestone
stopped_at: Phase 81 complete (UAT 1/1, SECURITY 0 open) — milestone v0.18 100%, ready to complete milestone
last_updated: "2026-07-24T09:43:50.842Z"
last_activity: 2026-07-24
last_activity_desc: Milestone v0.18 completed and archived
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 9
  completed_plans: 9
  percent: 100
current_phase: 999.1
current_phase_name: PROMOVIDO → v0.13 Phases 52-62, SHIPPED
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.18 «Higiene del sidebar de cmux» SHIPPED 2026-07-24** (Phases 79-81, 9 plans, audit `tech_debt` sin blockers — 12/12 reqs, integración 8/8, E2E 4/4, suite 2364 pass). Archivado en `milestones/v0.18-*`. **Awaiting next milestone** (`/gsd-new-milestone`). Decisión pendiente candidata v0.19: fix o aceptación definitiva de la carrera de `stealLock` (R-81-01, diagnóstico en `.planning/debug/gsd-lock-race-cr01.md`).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-24 after v0.18).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene; **v0.17 hizo del plan por-tarea estado vivo** (handoff acumulativo + `NEXT:` → dashboard y nudge) + convergencia de `pending` + agrupación de workspaces cmux; **v0.18 quitó al humano la carga de mantener el sidebar de cmux** — un doctor determinista lo cura, el orquestador lo invoca de piggyback, y la deuda menor de v0.17 quedó saldada.

**Current focus:** Definir el siguiente milestone (`/gsd-new-milestone`)

## Current Position

Phase: Milestone v0.18 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-07-24 — Milestone v0.18 completed and archived

## Most recent shipped milestone

**v0.18 Higiene del sidebar de cmux** — shipped 2026-07-24 (3 phases 79-81, 9 plans; audit `tech_debt` sin blockers — 12/12 reqs · 3/3 fases verificadas · integración 8/8 · flujos E2E 4/4; suite 2309 → 2364 tests; 86 commits en 3 días). El sidebar de cmux se mantiene solo: **Phase 79** — `kodo sidebar doctor [--fix|--json]` determinista 0-tokens (allowlist `add`/`ungroup`, `missing_group` advisory tras G-79-1: `execute()` jamás emite `create`/`set-anchor`, guard source-hygiene contra `delete`, launch path byte-idéntico, UAT 4/4 en vivo). **Phase 80** — piggyback in-process del doctor en pases motivados de `kodo check` (gate `needsOrchestrator`, fail-open, sidebar NO trigger — D-04) + skill `kodo-orchestrate`/`prompt.md` reconciliados con v0.17. **Phase 81** — deuda v0.17 saldada: contrato tres-estados del `next` por presencia (DEBT-01), doc-drift 75 (DEBT-02), colapso de whitespace render-only en `nextCell` (DEBT-03), y diagnóstico de causa raíz del flaky `gsd-lock-race`: **carrera real en `stealLock`**, fix → decisión de mantenedor (DEBT-04/R-81-01).

- Roadmap archive: `milestones/v0.18-ROADMAP.md`
- Requirements archive: `milestones/v0.18-REQUIREMENTS.md`
- Audit: `milestones/v0.18-MILESTONE-AUDIT.md`
- Phases: `milestones/v0.18-phases/`

(Anterior: **v0.17 Plan vivo por-tarea**, shipped 2026-07-22 — archivos en `milestones/v0.17-*`.)

## Deferred Items

Baseline al cierre de v0.18 (2026-07-24). Los 4 items DEBT absorbidos por Phase 81 quedan **CERRADOS** (DEBT-01/02/03 implementados; DEBT-04 diagnosticado — su hallazgo genera el primer item de la tabla). **Acknowledged al cierre del milestone (override_closeout):** la debug session `gsd-lock-race-cr01` queda abierta A PROPÓSITO — el diagnóstico está completo; su cierre formal depende de la decisión de mantenedor sobre R-81-01 (única entrada del audit-open pre-cierre, reconocida y diferida).

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Concurrencia | **Carrera real confirmada en `stealLock`** (`src/gsd/lock.js:283-351`): el move-aside `renameSync` deja `lockPath` ausente una ventana en la que dos `O_EXCL` pueden ganar a la vez → doble adquisición posible con N≥2 procesos robando el mismo lock muerto. Diagnóstico completo en `.planning/debug/gsd-lock-race-cr01.md` + `81-DEBT-04-DIAGNOSIS.md`; el test `gsd-lock-race` queda flaky-red A PROPÓSITO (greenearlo enmascararía). Fix real o aceptación definitiva → decisión de mantenedor (candidato v0.19) | Abierto — R-81-01 (81-SECURITY.md §Accepted Risks, interino) | v0.18 Phase 81 (DEBT-04) |
| Doc/consistencia | 81-REVIEW WR-01 (typedef `TaskHandoff` en `state.js:53` documenta la semántica PRE-DEBT-01) · WR-02 (`deriveAnyNext` en `select.js:258` no colapsa whitespace al decidir presencia de columna) — aceptados explícitamente por el operador en UAT 81 como deuda conocida | Aceptado — R-81-02 (81-SECURITY.md §Accepted Risks) | v0.18 Phase 81 |
| Operación | El grupo cmux `SCP-CMRi` del operador no matchea el identifier derivado `SCP` — tareas SCP se lanzan sin grupo (fail-open correcto); renombrar el grupo a `SCP` para agruparlas | Acción de operador (fuera de scope v0.18) | v0.17 Phase 77 |
| Riesgo aceptado | IN-07 / R-77-D10 (LOCKED D-10): el retry TOCTOU de `newWorkspaceWithGroupFallback` puede duplicar workspace ante timeout | Aceptado y documentado (78-SECURITY.md §Accepted Risks) | v0.17 Phase 77 |
| Verificación empírica | CONC-09 — sign-off humano de la ubicación real de worktrees (`.bg-shell` vs `.claude/worktrees`); `doctor --fix` scan path sin cambiar hasta confirmarlo en sesión GSD viva | Diferido por diseño (D-15, precedente 50.1) | v0.16 Phase 70 |
| UAT | Backstop GitHub real (nunca cierra issues) — skip reconocido por el operador 2026-07-09; mock de 3 capacidades como cobertura compensatoria | Abierto (requiere repo GitHub real) | v0.16 Phase 71 |
| Cliente Plane | B12b — throttle epoch-vs-delta (`x-ratelimit-reset` no confirmable barato en Plane self-hosted) | Diferido con nota (D-02) | v0.16 Phase 72 |
| Nyquist | VALIDATION.md en draft (mapa por-task vacío) en Phases 69/71/72 — cobertura real de tests sí evidenciada en VERIFICATION | Saldable con `/gsd-validate-phase` retroactivo | v0.16 |
| Nyquist | VALIDATION.md en draft (seeded, nunca reconciliado) en Phases 79/80/81 — cobertura real sí evidenciada en cada VERIFICATION (suite 2364) | Saldable con `/gsd-validate-phase` retroactivo | v0.18 |
| Evidencia en vivo | Round-trip completo `kodo sidebar doctor --fix` sobre sesión suelta real (79/SDR-05) y convergencia ≤1 pase del piggyback contra cmux vivo (80/ORCH-07) — cableado y unit verificados; falta solo el escenario real con deriva | Pendiente de que aparezca deriva real (no fabricar estado en el sidebar del operador) | v0.18 Phases 79-80 |
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera de roadmap) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions — v0.18 añadió 5 filas (`missing_group` report-only tras G-79-1, piggyback in-process gated/fail-open, reconciliación documental asimétrica, contrato tres-estados del `next` por presencia, colapso whitespace render-only, DEBT-04 diagnóstico-sin-fix con `lock.js` READ-ONLY). Las decisiones per-plan y los constraints LOCKED de v0.18 quedaron archivados con sus fases en `milestones/v0.18-phases/` y en `milestones/v0.18-ROADMAP.md`.

**Frontera vigente cross-milestone (v0.18):** la gestión de grupos cmux (`create`/`add`/`set-anchor`/`ungroup`) SOLO existe en el carril doctor; `workspace-group delete` jamás se cablea (guard source-hygiene); el launch path sigue solo-`list` + `--group` fail-open; el sidebar NO es trigger del orquestador; `missing_group` es advisory del operador — el doctor nunca crea/ancla grupos en sesiones vivas.

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
- **kodo consume grupos cmux — la gestión (`create`/`add`/`set-anchor`/`ungroup`) se permite SOLO en el nuevo carril doctor de v0.18 (GRP-04 re-fronterizado); el launch path sigue solo-`list` + `--group`, refs `workspace_group:N` nunca persistidos, y `workspace-group delete` jamás cableado** — v0.17 Phase 77 → re-fronterizado en v0.18 Phase 79.
- **Backstop de «In Review» en `SessionEnd` con gate de estado no-terminal** — jamás transicionar a un estado terminal (GitHub `closed`); el orden de efectos `backstop→setColor→notify` es LOCKED (D-08).
- **Auto-commit del orquestador gated por `KODO_ORCHESTRATOR=1` + pathspec** — sin la var → skip (cero commits fantasma).
- **`kodo start` legacy intacto** · **Cero endpoints nuevos en `src/server.js` (desde v0.10)** · **Cero nuevas dependencias npm** (locks vía `node:fs` built-in) · **TaskProvider contract FROZEN en 9** + métodos opcionales por `typeof` · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**.

### Roadmap Evolution

- 2026-07-22 — Roadmap v0.18 creado: candidata backlog 999.3 (sidebar doctor + reconciliación skill/prompt) promovida a Phases 79-80; los 4 items de deuda menor del audit v0.17 absorbidos como Phase 81 (DEBT-01..04). Granularidad `coarse` → 3 fases. 12/12 requirements mapeados.

## Session Continuity

**Last session:** 2026-07-24T08:07:53.023Z

**Resume file:**

None

- **Stopped at:** Milestone v0.18 completed and archived (2026-07-24) — audit `tech_debt` sin blockers, tag v0.18
- **Next action:** `/gsd-new-milestone` — definir requirements y roadmap del siguiente ciclo. Decisión candidata v0.19: fix o aceptación definitiva de la carrera de `stealLock` (R-81-01).
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-24 after v0.18)
  - `.planning/ROADMAP.md` (v0.18 colapsado; Backlog con 999.1 + 999.2 + 999.3 promovida)
  - `.planning/MILESTONES.md` (entrada v0.18 completa con stats y override registrado)
  - `.planning/milestones/v0.18-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `v0.18-phases/`
  - `.planning/REQUIREMENTS.md` eliminado (fresh para el siguiente milestone)

## Operator Next Steps

- Arrancar el siguiente milestone con `/gsd-new-milestone`
- **Decisión pendiente (candidata v0.19):** fix real de la carrera de `stealLock` o aceptación definitiva — diagnóstico en `.planning/debug/gsd-lock-race-cr01.md`; el test `gsd-lock-race` queda flaky-red a propósito hasta entonces
- Opcional: `/gsd-validate-phase 79|80|81` retroactivo (Nyquist en draft) · 3 warnings de 80-REVIEW
- `git push` (+ tag v0.18) pendiente de decisión del operador — todo el milestone es local

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (baseline post-v0.18 — métricas per-plan de v0.18 archivadas en `milestones/v0.18-phases/`; medias v0.18: ~8 min/plan, 9 plans; medias v0.17: ~12 min/plan, 17 plans) |
