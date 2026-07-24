---
gsd_state_version: 1.0
milestone: v0.18
milestone_name: Higiene del sidebar de cmux
current_phase: 81
current_phase_name: Saneo de deuda v0.17
status: executing
stopped_at: Phase 81 UI-SPEC approved
last_updated: "2026-07-24T07:33:04.971Z"
last_activity: 2026-07-23
last_activity_desc: Phase 80 complete, transitioned to Phase 81
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 67
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.18 «Higiene del sidebar de cmux»** — **Phases 79 y 80 completas 2026-07-23**. Phase 79: `kodo sidebar doctor` determinista (UAT 4/4, missing_group report-only ratificado). Phase 80: carril orquestador (piggyback in-process del doctor en pases motivados de `kodo check`, sidebar NO trigger) + reconciliación documental skill/prompt con v0.17 (UAT 1/1 en vivo, SECURITY threats_open: 0, suite 2356). Siguiente y última: Phase 81 (deuda v0.17). Milestone anterior v0.17 SHIPPED 2026-07-22.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-22 after v0.17).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene; **v0.17 hizo del plan por-tarea estado vivo** (handoff acumulativo + `NEXT:` → dashboard y nudge) + convergencia de `pending` + agrupación de workspaces cmux. **v0.18 quita al humano la carga de mantener el sidebar de cmux** — un doctor determinista lo cura, el orquestador lo invoca de piggyback, y se salda la deuda menor de v0.17.

**Current focus:** Phase 81 — Saneo de deuda v0.17 (última fase de v0.18)

## Current Position

Phase: 81 — Saneo de deuda v0.17
Plan: Not started
Status: Ready to execute
Last activity: 2026-07-23 — Phase 80 complete, transitioned to Phase 81

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

Baseline post-v0.17. Los 4 items marcados «→ v0.18» abajo quedan **absorbidos por el roadmap v0.18** (Phase 81, DEBT-01..04) — dejan de ser deuda diferida al planificarse. El resto sigue trazado.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Estado | `next` un-clearable una vez seteado en `upsertTaskHandoff` (`src/session/state.js:443`) — un cierre posterior sin `NEXT:` no lo borra | **Absorbido → v0.18 Phase 81 (DEBT-01)** | v0.17 Phase 74 |
| Tests | `test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)» es **flaky** bajo carga (timing). Preexistente de Phase 70 | **Absorbido → v0.18 Phase 81 (DEBT-04)** — diagnóstico vía `/gsd-debug`, NO arreglar a ciegas | v0.17 Phase 74 (heredado de v0.16) |
| Doc-drift | 75/WR-02 (comentario App.js «una vez por tick» vs render real) · 75/WR-04 (typedef `overlaySnapshot` sin `render`) — solo documentación | **Absorbido → v0.18 Phase 81 (DEBT-02)** | v0.17 Phase 75 |
| Render TUI | 75/WR-03: `nextCell` no colapsa `\n`/`\t` en el RENDER de fila (solo alcanzable por state.json hand-editado; carril keystroke cerrado en Phase 78) | **Absorbido → v0.18 Phase 81 (DEBT-03)** · fidelidad markdown best-effort → FUT-01 (v2, solo si molesta) | v0.17 Phase 75 |
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

**Last session:** 2026-07-24T07:12:52.156Z

**Resume file:**

.planning/phases/81-saneo-de-deuda-v0-17/81-UI-SPEC.md

- **Stopped at:** Phase 81 UI-SPEC approved
- **Next action:** `/gsd-discuss-phase 80` — discutir la Phase 80 (sin CONTEXT.md aún). Phase 81 es ortogonal (paralelizable).
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-22 after v0.17; §Current Milestone = v0.18)
  - `.planning/ROADMAP.md` (v0.18 activo — Phases 79-81; v0.17 colapsado; Backlog con 999.1 + 999.2 + 999.3 promovida)
  - `.planning/REQUIREMENTS.md` (v0.18 — 12 requirements, traceability 12/12 mapeados)
  - `.planning/MILESTONES.md` (entrada v0.17 completa)
  - `.planning/milestones/v0.17-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `v0.17-phases/`

## Operator Next Steps

- Discutir la Phase 81 con `/gsd-discuss-phase 81` (o `--auto` para la cadena completa) — última fase de v0.18
- Opcional: `/gsd-code-review 80 --fix` para los 3 warnings documentados en 80-REVIEW.md
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
