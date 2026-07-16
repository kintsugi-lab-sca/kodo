---
gsd_state_version: 1.0
milestone: v0.17
milestone_name: Plan vivo por-tarea
current_phase: 77
current_phase_name: Agrupación de workspaces en cmux
status: verifying
stopped_at: Completed 77-02-PLAN.md
last_updated: "2026-07-16T08:27:27.144Z"
last_activity: 2026-07-16
last_activity_desc: Phase 77 execution started
progress:
  total_phases: 2
  completed_phases: 2
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.17 «Plan vivo por-tarea»** con roadmap creado 2026-07-15 — **Phases 74-77**, 13/13 requirements mapeados (Phase 77 añadida 2026-07-16: agrupación de workspaces cmux, GRP-01..04). Primer milestone de features tras v0.16 Hardening (shipped 2026-07-15, audit PASSED).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-15 after v0.16).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega y higiene (remediación completa de la auditoría adversarial 2026-07-03/05).

**Current focus:** Phase 77 — Agrupación de workspaces en cmux

## Current Position

Phase: 77 (Agrupación de workspaces en cmux) — EXECUTING
Plan: 2 of 2
Status: Phase complete — ready for verification
Progress: [██████████] 100% (0/4 fases)
Last activity: 2026-07-16 — Phase 77 execution started

**Fases del milestone:**

| Fase | Goal (resumen) | Requirements | Depende de |
|------|----------------|--------------|------------|
| 74 | Handoff acumulativo `## Handoff <fecha>` en `SessionEnd` (pre-cleanup, LLM + backstop mecánico) + puntero/`NEXT:` en `state.json` bajo `withStateLock` | LIVE-01..04 | v0.16 Phase 70 (shipped) |
| 75 | `NEXT:` en la lista del dashboard + plan completo renderizado en `phaseId == null` (D-02 intacto) + nudge con contexto | LIVE-05, LIVE-06, LIVE-07 | Phase 74 |
| 76 | `/status` y `kodo check` convergen en `pending_count`; provider caído no sirve conteo caducado como fresco | ORCH-05, ORCH-06 | ninguna (paralelizable) |
| 77 | Workspaces agrupados en la sidebar de cmux por path resuelto (`--group` en `new-workspace`, resolución en fresco, fail-open; kodo no crea grupos) | GRP-01..04 | ninguna (paralelizable; cmux ≥ 0.64.19) |

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
| Tests | `test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)» es **flaky** (~1 de cada 3 runs, timing). Preexistente: no lo causó la Phase 74 (`git diff` vs baseline vacío en `src/gsd/`) | Abierto — investigar con `/gsd-debug`; NO arreglar a ciegas (podría enmascarar una carrera real del lock). Evidencia en `phases/74-.../deferred-items.md` | v0.17 Phase 74 |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions (v0.16 añadió 8 filas: bind+bearer default-deny, advisory lockfile vs single-writer, backstop mecánico + gate no-terminal, cursor confirmado, borrar-no-cablear, auto-commit gated, Phase 73 retirada por eliminación).

- [Phase 74-01]: sessionId NO se sanea en buildHandoffBlock — writer y parser deben usar el mismo valor crudo o la deteccion D-04 daria falsos negativos permanentes
- [Phase 74-01]: el truncado del NEXT a 200 vive en extractNext (el contrato), no en el caller (D-02)
- [Phase 74-01]: src/session/handoff.js es hoja de CERO imports, blindada por test/check-isolation.test.js (D-13)
- [Phase 74-02]: state.tasks es aditivo SIN bump de schema_version — los tests siembran v3 explicito: loadState devuelve forma v2 si no hay fichero y migrateStateV2toV3 descartaria la clave
- [Phase 74-02]: el caso anti-drop de reconcileTick fuerza una transicion — sin cambios reconcile.js:233 devuelve state referencialmente y el test seria vacuo; teeth verificadas por mutacion
- [Phase 74-02]: upsertTaskHandoff devuelve {ok:false} ante lock-timeout y jamas lanza — el caller (Plan 04) sigue el cierre igualmente, nunca aborta (D-06)
- [Phase 74-03]: las etiquetas del formato (Hecho/Pendiente/NEXT) van en espanol en AMBAS ramas — lo que alterna por rama es la instruccion (D-08), no el contrato que parsea D-02
- [Phase 74-03]: session-start.js NO importa src/session/handoff.js — la instruccion es un prompt, no una construccion de bloque; el acoplamiento se cubre asserting el marcador literal
- [Phase 74-03]: D-11 confirmado empiricamente — cero tests preexistentes modificados; no habia golden bytes que reparar, solo prefijos que conservar
- [Phase 74-03]: el guard de emojis EN preexistente NO cubria la instruccion quick (corta desde el bloque comun, posterior) — el caso nuevo corta desde la instruccion de plan
- [Phase ?]: 74-04: writeHandoff propaga el EACCES en vez de capturarlo — el try/catch del seam es el punto ÚNICO de captura (SC#5)
- [Phase ?]: 74-04: la fuga de HOME (T-74-15) se REPRODUJO — la suite del hook con el seam cableado y sin DI escribió en el ~/.kodo real con los tests verdes; cerrada por DI en las 17 invocaciones
- [Phase ?]: 74-04: LIVE-01/03/04 quedan Pending hasta el cierre de fase (el Plan 05 verifica la concurrencia) — WR-01: nunca reclamar un éxito no verificado end-to-end
- [Phase ?]: 74-05: la barrera se libera tras el evento 'spawn' de todos los hijos — el go-file sincrono del analog es un no-op (spawn() retorna antes de que el hijo arranque)
- [Phase ?]: 74-05: el verdicto 'written' del hijo significa 'no lanzo', no 'escribio' (D-06 fail-safe); el assert que carga el peso es el conteo de bloques
- [Phase ?]: 74-05: teeth verificadas por mutacion — sin withFileLock las 3 carreras D-08 fallan 5/5; la Carrera 1 sigue verde porque mide withStateLock
- [Phase ?]: 77-01: buildNewWorkspaceArgs extraído como función pura exportada para testear el argv de new-workspace (incl. --group) sin execFile
- [Phase ?]: 77-01: listWorkspaceGroups devuelve stdout crudo sin JSON.parse (D-05); solo verbo list de workspace-group (GRP-04); espejo en host._legacy con HOST_METHODS congelado en 4
- [Phase ?]: Phase 77 Plan 02: agrupación de workspaces cmux resuelta en fresco por lanzamiento con fail-open en dos capas (D-09/D-10); cero persistencia de refs de grupo (GRP-04)

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

**Resume file:** None

- **Last session:** 2026-07-16T08:27:21.127Z
- **Stopped at:** Completed 77-02-PLAN.md
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
| 74 | 01 | 18m | 3 tasks, 3 files (contrato de handoff: hoja pura + 40 tests) |
| Phase 74 P02 | 14m | 3 tasks | 3 files |
| Phase 74 P03 | 12m | 2 tasks | 3 files |
| Phase 74 P04 | 5m | 3 tasks | 3 files |
| Phase 74 P05 | 18m | 2 tasks | 2 files |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 74 P06 | 35 min | 2 tasks | 2 files |
| Phase 77 P01 | 15min | 2 tasks | 3 files |
| Phase 77 P02 | ~6min | 2 tasks | 3 files |
