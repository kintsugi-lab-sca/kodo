---
gsd_state_version: 1.0
milestone: v0.18
milestone_name: Higiene del sidebar de cmux
current_phase: 999.1
current_phase_name: PROMOVIDO → v0.13 Phases 52-62, SHIPPED
status: planning
stopped_at: Completed 81-03-PLAN.md
last_updated: "2026-07-24T09:31:30.803Z"
last_activity: 2026-07-24
last_activity_desc: Phase 81 complete, transitioned to Phase 999.1
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.18 «Higiene del sidebar de cmux»** — **100% completo: Phases 79, 80 y 81 cerradas** (81 el 2026-07-24: UAT 1/1, SECURITY threats_open: 0, suite 2364 pass). Phase 79: `kodo sidebar doctor` determinista (UAT 4/4, missing_group report-only ratificado). Phase 80: carril orquestador + reconciliación documental skill/prompt. Phase 81: deuda v0.17 saldada (DEBT-01..04) — con hallazgo material: el flaky `gsd-lock-race` es una **carrera real en `stealLock`** (diagnóstico en `.planning/debug/gsd-lock-race-cr01.md`; fix diferido a decisión de mantenedor). Pendiente: `/gsd-complete-milestone` para archivar v0.18. Milestone anterior v0.17 SHIPPED 2026-07-22.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-22 after v0.17).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene; **v0.17 hizo del plan por-tarea estado vivo** (handoff acumulativo + `NEXT:` → dashboard y nudge) + convergencia de `pending` + agrupación de workspaces cmux. **v0.18 quita al humano la carga de mantener el sidebar de cmux** — un doctor determinista lo cura, el orquestador lo invoca de piggyback, y se salda la deuda menor de v0.17.

**Current focus:** Cierre del milestone v0.18 (todas las fases completas)

## Current Position

Phase: — (v0.18 completo: Phases 79-81 cerradas; el «999.1» que reportó `phase.complete` es un placeholder del Backlog, no una fase real)
Plan: —
Status: Milestone ready to complete (`/gsd-complete-milestone`)
Last activity: 2026-07-24 — Phase 81 complete (UAT 1/1, SECURITY 0 open) — milestone v0.18 100%

## Roadmap v0.18 (activo)

| Phase | Goal | Requirements | Depends on |
|-------|------|--------------|------------|
| 79 — Sidebar Doctor | `kodo sidebar doctor` determinista (scan+execute, dry-run/`--fix`, 0 tokens, allowlist no destructivo) cura el sidebar; launch path byte-idéntico | SDR-01..06 | v0.17 Phase 77 (shipped) |
| 80 — Carril orquestador + reconciliación documental | El orquestador invoca `kodo sidebar doctor --fix` de piggyback en `kodo check` (sidebar NO es trigger); skill + prompt reconciliados con v0.17 | ORCH-07, ORCH-08 | Phase 79 |
| 81 — Saneo de deuda v0.17 | Cerrar los 4 items menores del audit v0.17 (next clearable, doc-drift 75, nextCell whitespace, diagnóstico flaky `gsd-lock-race`) | DEBT-01..04 | Nothing (ortogonal, paralelizable) |

**Coverage:** 12/12 requirements mapeados (sin huérfanos, sin duplicados). Ver `.planning/ROADMAP.md §Phase Details (v0.18 activo)` y `.planning/REQUIREMENTS.md §Traceability`.

## Most recent shipped milestone

**v0.17 Plan vivo por-tarea** — shipped 2026-07-22 (5 phases 74-78, 17 plans, 24 tasks; audit `tech_debt` sin blockers — 13/13 reqs · 5/5 fases verificadas · 9/9 seams · 6/6 flujos E2E · Nyquist 5/5 compliant; suite 2027 → 2309 tests, verde completa al cierre; 168 commits). El plan de cada tarea es **estado vivo**: **productor** (Phase 74 — handoff acumulativo `Hecho/Pendiente/NEXT:` en `SessionEnd` pre-cleanup, autoría LLM + backstop mecánico, `NEXT:` en `state.tasks` bajo `withStateLock`; G-74-4 cerrado con detector de deriva en `kodo doctor` + registro real verificado en vivo), **consumidores** (Phase 75 — columna `next` del dashboard, overlay del plan renderizado en `phaseId == null` con D-02 intacto, nudge del orquestador con contexto), **ortogonales** (Phase 76 — `pending` convergido en `src/tasks/pending.js` con frescura discriminada `pending_stale`/`pending_fetched_at`; Phase 77 — workspaces agrupados en cmux por path resuelto vía `--group`, fail-open 2 capas, GRP-04), y **deuda de cierre saldada** (Phase 78 — nudge saneado `stripControlChars`/`stripForKeystroke` cerrando R-75-02 + 8 fixes de 77-REVIEW).

- Roadmap archive: `milestones/v0.17-ROADMAP.md`
- Requirements archive: `milestones/v0.17-REQUIREMENTS.md`
- Audit: `milestones/v0.17-MILESTONE-AUDIT.md`
- Phases: `milestones/v0.17-phases/`

## Deferred Items

Baseline post-Phase 81 (2026-07-24). Los 4 items DEBT absorbidos por Phase 81 quedan **CERRADOS** (DEBT-01/02/03 implementados; DEBT-04 diagnosticado — su hallazgo genera el primer item nuevo de la tabla). El resto sigue trazado.

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
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera de roadmap) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions — v0.17 añadió 8 filas (agrupación por path resuelto, fail-open 2 capas, GRP-04 consume-no-gestiona, handoff pre-cleanup LLM+backstop, `state.tasks` aditivo never-throws, detector de deriva instalación↔settings, convergencia por hoja cero-imports, saneo en punto de composición). Las decisiones per-plan de v0.17 quedaron archivadas con sus fases en `milestones/v0.17-phases/`.

**Constraints LOCKED de v0.18 (decididos en la conversación de origen 2026-07-20, no re-discutir):**

- **Allowlist no destructivo** en el sidebar doctor: `create`, `add`, `set-anchor`, `ungroup`. `workspace-group delete` NI SE CABLEA (cierra todos los workspaces del grupo) — guard source-hygiene que verifique su ausencia.
- **0 tokens**: lógica 100% determinista reutilizando `deriveExpectedGroupName` (`src/session/manager.js`) y `listWorkspaceGroups` (`src/cmux/client.js`); el LLM no decide nada (puerta LLM → FUT-03, YAGNI hoy).
- **El sidebar NO es trigger del orquestador**: la higiene va de piggyback en pases ya motivados por `kodo check` (stuck/review/pending). Consistencia eventual asumida.
- **Launch path byte-idéntico**: GRP-01..03 fail-open intactos; la gestión de grupos pasa a estar permitida SOLO en el carril doctor (re-fronterización consciente de GRP-04).
- **Política de anchor por re-anclaje eventual**: los grupos se disuelven al cerrarse su anchor; el doctor re-crea/re-ancla (`set-anchor` al miembro más longevo) en el siguiente pase.
- **DEBT-04 (flaky `gsd-lock-race`) es SOLO diagnóstico vía `/gsd-debug`** — no arreglar a ciegas; protege el invariante de locks de v0.16.
- [Phase ?]: Phase 79-01: allowlist no-destructivo workspace-group (create/add/set-anchor/ungroup) en client.js; delete/remove/rename LOCKED, guard source-hygiene lo verifica
- [Phase ?]: 79-02: scan() del sidebar doctor es async (await de raws cmux execFile), no sync como gsd/doctor.js
- [Phase ?]: 79-02: reverse-lookup de módulo offline (taskLikeFrom) reconstruye el task-like sin persistir expected_group (D-02/D-03)
- [Phase ?]: 79-03: kodo sidebar doctor CLI (runSidebarDoctor espejo de runGsdDoctor) SIN ensureConfig — 0-provider preservado; exit hasActions?1:0, --json byte-determinista
- [Phase ?]: 79-03: checkpoint SDR-05 approved con alcance acotado — rama READ-ONLY (dry-run/--json/exit) verificada en vivo; convergencia real --fix + A1/A2/A5 + D-04 diferidos a /gsd-verify-work 79
- [Phase ?]: 79-04 (G-79-1): missing_group pasa a report-only/advisory — execute() ya no emite create/set-anchor; el doctor nunca ancla un grupo en una sesión kodo viva. Supera D-07/D-08 y la política de re-anclaje eventual (ratificado por checkpoint).
- [Phase ?]: 79-04: scan() computa hasActions solo con loose+empty (missing_group excluido) y expone hasAdvisories — el CLI/Phase 80 distinguen deriva auto-arreglable de acción del operador; --fix converge a exit 0 sin bucle.
- [Phase ?]: 80-01: carril orquestador ORCH-07 — runCheckAndAct ejecuta scan+execute del sidebar doctor in-process, gated por needsOrchestrator, antes de launchOrchestrator, fail-open; el resultado del doctor jamás alimenta el gate (D-04)
- [Phase ?]: 80-02: reconciliación documental ORCH-08 — skill canónica con detalle (higiene sidebar + flujo 5 + 4 features v0.17), prompt fallback conciso; bloque reporting y placeholders intactos (D-09/D-12)
- [Phase 81]: DEBT-01 — contrato tres-estados del `next` por PRESENCIA del campo (string sobrescribe / `null` explícito borra / ausente preserva); `session-end.js` mapea autoría con flag `authored: 'llm'|'auto'` y spread condicional (LLM sin `NEXT:` → `null` clear; backstop mecánico → omite → preserva). Refina 74/WR-02 sin invalidarlo
- [Phase 81]: DEBT-03 — colapso de whitespace SOLO en el punto de proyección al render (`nextCell`, `/\s+/g`→' '+trim); dato persistido verbatim, `stripControlChars` del enrich intacto (capas complementarias)
- [Phase 81]: DEBT-04 — el flaky CR-01 NO era timing del harness: carrera real en `stealLock` (ventana no-atómica move-aside→O_EXCL, hold-independiente, ~48% repro en loop aislado); `lock.js` intacto por mandato D-09, test flaky-red a propósito, fix → decisión de mantenedor
- [Phase 81]: WR-01/WR-02 de 81-REVIEW aceptados en UAT como deuda conocida (R-81-02) en lugar de arreglarse en fase — precedente: la misma vía que 75/WR-02/WR-04 usaron para entrar como DEBT-02
- [Phase ?]: DEBT-01: merge de next en tres estados por presencia (overwrite/clear/preserve); autoría mapeada al contrato en session-end.js
- [Phase ?]: 81-02: colapso de whitespace en nextCell es render-only (LAYOUT), complementario a stripControlChars de Phase 78 — dato persistido verbatim (D-06)
- [Phase ?]: DEBT-04: flaky gsd-lock-race (CR-01) es carrera de producto real en stealLock (ventana briefly-empty move-aside->create); lock.js READ-ONLY, fix gated D-09; test red-by-design (T-81-03-02, no enmascarar)

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

- **Stopped at:** Phase 81 complete (UAT 1/1, SECURITY 0 open) — milestone v0.18 100%, ready to complete milestone
- **Next action:** `/gsd-complete-milestone` — archivar v0.18 y preparar el siguiente ciclo.
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-22 after v0.17; §Current Milestone = v0.18)
  - `.planning/ROADMAP.md` (v0.18 activo — Phases 79-81; v0.17 colapsado; Backlog con 999.1 + 999.2 + 999.3 promovida)
  - `.planning/REQUIREMENTS.md` (v0.18 — 12 requirements, traceability 12/12 mapeados)
  - `.planning/MILESTONES.md` (entrada v0.17 completa)
  - `.planning/milestones/v0.17-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `v0.17-phases/`

## Operator Next Steps

- Cerrar el milestone con `/gsd-complete-milestone` — v0.18 al 100% (Phases 79-81, UAT y SECURITY verificados)
- **Decisión pendiente (candidata v0.19):** fix real de la carrera de `stealLock` o aceptación definitiva — diagnóstico en `.planning/debug/gsd-lock-race-cr01.md`; el test `gsd-lock-race` queda flaky-red a propósito hasta entonces
- Opcional: `/gsd-code-review 80 --fix` (3 warnings de 80-REVIEW.md) · WR-01/WR-02 de 81-REVIEW aceptados como deuda (R-81-02)
- `git push` pendiente de decisión del operador (todo el milestone es local)

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (baseline post-v0.17 — métricas per-plan de v0.17 archivadas en `milestones/v0.17-phases/`; medias v0.17: ~12 min/plan, 17 plans) |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 79 P01 | 7min | 2 tasks | 2 files |
| Phase 79 P02 | 18min | 2 tasks | 4 files |
| Phase 79 P03 | 6min | 3 tasks | 3 files |
| Phase 79 P04 | 5min | 3 tasks | 5 files |
| Phase 80 P01 | 10min | 2 tasks | 4 files |
| Phase 80 P02 | 3min | 2 tasks | 2 files |
| Phase 81 P01 | 5min | 2 tasks | 4 files |
| Phase 81 P02 | 2min | 2 tasks | 4 files |
| Phase 81 P03 | 17min | 2 tasks | 2 files |
