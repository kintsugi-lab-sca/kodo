# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- 🚧 **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 (in progress, started 2026-05-04)

## Phases

<details>
<summary>✅ v0.2 Provider Abstraction (Phases 1-5) — SHIPPED 2026-04-13</summary>

- [x] Phase 1: Interface + State Schema (2/2 plans) — completed 2026-04-07
- [x] Phase 2: Plane Adapter + Registry (2/2 plans) — completed 2026-04-08
- [x] Phase 3: Consumer Rewiring (2/2 plans) — completed 2026-04-10
- [x] Phase 4: Server + Trigger Abstraction (2/2 plans) — completed 2026-04-13
- [x] Phase 5: Config + Cleanup (2/2 plans) — completed 2026-04-13

Full details: `.planning/milestones/v0.2-ROADMAP.md`

</details>

<details>
<summary>✅ v0.3 GSD Integration + Structured Logging (Phases 6-10) — SHIPPED 2026-04-22</summary>

- [x] Phase 6: Structured Logger Foundation (4/4 plans) — completed 2026-04-15
- [x] Phase 7: `kodo logs` CLI + Event Taxonomy (6/6 plans) — completed 2026-04-16
- [x] Phase 8: GSD Label + Session Plumbing (5/5 plans) — completed 2026-04-20
- [x] Phase 9: Phase Resolver + Bootstrap (6/6 plans) — completed 2026-04-21
- [x] Phase 10: Orchestrator Verification Gate (4/4 plans) — completed 2026-04-22

Full details: `.planning/milestones/v0.3-ROADMAP.md`
Milestone audit: `.planning/milestones/v0.3-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.3-REQUIREMENTS.md`

</details>

<details>
<summary>✅ v0.4 GSD Quick Mode (Phases 11-13) — SHIPPED 2026-04-30</summary>

- [x] Phase 11: Quick Mode Recognition & Persistence (3/3 plans) — completed 2026-04-28
- [x] Phase 12: Hook & Orchestrator Bifurcation (3/3 plans) — completed 2026-04-28
- [x] Phase 13: Test Coverage Matrix (5/5 plans) — completed 2026-04-29

Full details: `.planning/milestones/v0.4-ROADMAP.md`
Requirements archive: `.planning/milestones/v0.4-REQUIREMENTS.md`
Phase artifacts: `.planning/milestones/v0.4-phases/`

</details>

<details open>
<summary>🚧 v0.5 CLI Polish & v0.3 Debt Cleanup (Phases 14-17) — IN PROGRESS</summary>

- [x] **Phase 14: CLI Format Foundation** — `src/cli/format.js` helper centraliza color/format con TTY detection + `picocolors` añadido como dependencia, sin tocar callsites todavía (completed 2026-05-05)
- [x] **Phase 15: CLI Polish Wiring** — `kodo logs`, `kodo gsd inspect`, `kodo gsd verify`, `kodo check` consumen el helper para colorear niveles/verdicts/tablas; `--json` mantiene bytes deterministas y `kodo check` preserva guard LOG-12 (completed 2026-05-05)
- [x] **Phase 16: LOG-09 Debt Cleanup** — `dispatcher.js` migra literales a `EVENTS.*` y `markSessionStatus` se cabela en `verify.js` (transición Plane → Review) y `stop.js` (release del lock per-repo) para emitir `state.transition` real en runtime (completed 2026-05-06)
- [x] **Phase 17: Phase 7 UAT Automation** — los 3 UATs humanos pendientes (`--follow` live, `session.start` campos reales, `--session-of` E2E) se convierten en integration tests con fixtures NDJSON progresivos y `state.json` sintético (completed 2026-05-10)

</details>

## Phase Details

### Phase 14: CLI Format Foundation
**Goal**: Establecer el helper `src/cli/format.js` como única fuente de color/format y añadir `picocolors` como dependencia, dejando la API lista para que las fases siguientes la cableen sin que ningún callsite cambie todavía.
**Depends on**: v0.4 Phase 13 (línea base estable, 414/415 pass, 1 skip)
**Requirements**: DX-06, DX-07
**Success Criteria** (what must be TRUE):
  1. `src/cli/format.js` existe y exporta una API de color/format (al menos: helpers por nivel, helpers `ok`/`fail`, formateador de columnas) que detecta TTY a partir del descriptor pasado y respeta `NO_COLOR` y `FORCE_COLOR` (matriz de 4 estados validada por test).
  2. El helper NO importa `src/logger.js` ni nada que lo arrastre transitivamente — un test source-hygiene bloquea regresión del guard LOG-12 desde el grafo de `src/cli/format.js`.
  3. Cuando el descriptor no es TTY (o `NO_COLOR` está set), las funciones del helper devuelven el string original sin secuencias ANSI (golden bytes test): este es el contrato que los callers usarán para `--json`.
  4. `picocolors` aparece en `package.json` (`dependencies`) y en el lockfile; PROJECT.md documenta el bump (commander → commander+picocolors) en la sección Constraints/Context y `kodo --version` sigue funcionando sin warnings.
  5. La suite global pasa (`node --test` reporta 0 fallos nuevos respecto a la línea base) — no se ha modificado ningún callsite todavía, así que cualquier rotura indica problema en el helper o en la dependencia.
**Plans**: 3 plans
  - [x] 14-01-PLAN.md — picocolors dep + src/cli/format.js helper + unit tests (matrix + golden bytes + formatRow/formatTable)
  - [x] 14-02-PLAN.md — test/format-isolation.test.js (LOG-12 extension walker + picocolors single-source grep, D-06/D-07/D-08)
  - [x] 14-03-PLAN.md — PROJECT.md §Constraints color-isolation bullet + test/version-smoke.test.js (kodo --version exit 0, no warnings)
**UI hint**: no

### Phase 15: CLI Polish Wiring
**Goal**: Cablear el helper Phase 14 en los cuatro surfaces del CLI (`kodo logs`, `kodo gsd inspect`, `kodo gsd verify`, `kodo check`) para que el output TTY sea legible (colores semánticos + columnas alineadas + símbolos pass/fail) sin alterar el contrato `--json` ni el guard LOG-12 del vigilante.
**Depends on**: Phase 14 (consume `src/cli/format.js`)
**Requirements**: DX-01, DX-02, DX-03, DX-04, DX-05
**Success Criteria** (what must be TRUE):
  1. `kodo logs` en TTY colorea cada nivel (debug=gris, info=cyan, warn=amarillo, error=rojo) y reformatea stderr en columnas alineadas `timestamp · level · component · message`; cuando `stdout`/`stderr` no es TTY o `NO_COLOR` está set, los bytes coinciden con el output anterior a Phase 14.
  2. `kodo logs --json` produce bytes idénticos a los de antes de Phase 14 (golden bytes test) — el flag bypasea el helper completamente, esté o no en TTY.
  3. `kodo gsd inspect <task-id>` presenta el verdict del resolver con símbolos `✓`/`✗` por sección (config, fetch, roadmap, match) y muestra el exit code al final del output; los exit codes siguen siendo D-19 (0=ok, 1=config, 2=fetch).
  4. `kodo gsd verify <session-id>` colorea pass=verde / soft-fail=amarillo / hard-fail=rojo y muestra un resumen del comentario Plane que se postea, sin alterar los exit codes deterministas (Pitfall #6 Opción A) ni el contenido del comentario Plane (mismo verdict → mismos bytes).
  5. `kodo check` colorea OK/FAIL en su tabla de chequeos y NO carga `src/logger.js` transitivamente — el test-graph guard LOG-12 sigue verde tras los cambios.
**Plans**: 5 plans
  - [x] 15-01-PLAN.md — kodo logs wiring (logger.js#formatLine shape dual + reader.js useColor source via _resolveUseColor)
  - [x] 15-02-PLAN.md — kodo check wiring (eliminar ANSI inline, fmt.yellow/red/ok via formatterFn DI)
  - [x] 15-03-PLAN.md — gsd inspect renderHuman 4 secciones (config/fetch/roadmap/match) + Exit: N visible
  - [x] 15-04-PLAN.md — gsd verify expone plane.comment_body + renderHuman color mapping + summary slice
  - [x] 15-05-PLAN.md — Wave 2: extender test/format-isolation.test.js con cableado positivo (5 callsites) + anti-leak picocolors
**UI hint**: no

### Phase 16: LOG-09 Debt Cleanup
**Goal**: Cerrar la deuda de v0.3 sobre la taxonomía de eventos: migrar los dos literales del dispatcher a `EVENTS.*` y cablear `markSessionStatus` en los dos sitios de transición real (verify.js cuando la task pasa a Review y stop.js cuando se libera el lock per-repo) para que `state.transition` se emita en runtime sin romper los flujos existentes.
**Depends on**: Phase 14/15 (independiente, pero se planifica después para no acumular patches concurrentes en CLI)
**Requirements**: LOG-13, LOG-14, LOG-15
**Success Criteria** (what must be TRUE):
  1. `src/triggers/dispatcher.js` usa `EVENTS.GSD_PHASE_RESOLVED` y `EVENTS.GSD_BOOTSTRAP` (o los helpers de `src/logger-events.js` ya existentes) en lugar de los literales `'gsd.phase.resolved'` y `'gsd.bootstrap'`; un test source-hygiene con grep contra `src/triggers/dispatcher.js` falla si los literales reaparecen.
  2. Cuando `verify.js` mueve la task Plane a Review tras `verdict.action === 'pass'` y `addComment` OK, llama a `markSessionStatus(taskId, 'review', reason, logger)` (o el estado terminal acordado) y se emite un evento `state.transition` con `from`/`to` reales — un test verifica los campos canónicos del NDJSON con un logger fake.
  3. La transición Phase 16 SC#2 sólo se dispara en la rama `pass`: `soft-fail`, `hard-fail` y errores de `addComment`/transition Plane NO emiten `state.transition` (regression test cubre las 4 ramas del verdict).
  4. Cuando `stop.js` libera el lock per-repo (rama `if (session.gsd) { ... }`) llama a `markSessionStatus` al estado terminal de la sesión y se emite `state.transition`; el test verifica que el evento se emite ANTES o DESPUÉS del release del lock (orden documentado) sin romper la idempotencia del release ni la rama no-GSD del switch.
  5. La cadena quick + full sigue intacta: una sesión `gsd_mode: 'quick'` llega a stop, el lock se libera, `state.transition` se emite con el estado terminal correcto y el nudge sigue siendo el de revisión manual (no se ha tocado el switch del modo). Los 414+ tests existentes pasan; los nuevos tests cubren los 3 callsites (dispatcher EVENTS, verify pass branch, stop release branch).
**Plans**: 3 plans
  - [x] 16-01-PLAN.md — dispatcher.js EVENTS.GSD_PHASE_RESOLVED migration (4 literales runtime) + test/dispatcher-isolation.test.js comment-aware grep (LOG-13, SC#1)
  - [x] 16-02-PLAN.md — verify.js markSessionStatus en pass branch tras updateTaskState OK + 6 asserts SC#3 negative en gsd-verify-integration.test.js (LOG-14, SC#2/SC#3)
  - [x] 16-03-PLAN.md — stop.js markSessionStatus PRE-release dentro de if (session.gsd) + refactor light runStopHook + test/stop-state-transition.test.js 3 escenarios full/quick/no-GSD (LOG-15, SC#4/SC#5)
**UI hint**: no

### Phase 17: Phase 7 UAT Automation
**Goal**: Convertir los tres UATs humanos pendientes de v0.3 Phase 7 en integration tests automatizados con fixtures NDJSON progresivos y `state.json` sintético, eliminando los TODOs de `07-HUMAN-UAT.md` sin reescribir el subsistema `kodo logs`.
**Depends on**: Phase 16 (Phase 16 garantiza que `state.transition` se emite en runtime, lo que estabiliza los fixtures de session.start/transition que UAT-02 referencia)
**Requirements**: UAT-01, UAT-02, UAT-03
**Success Criteria** (what must be TRUE):
  1. Existe un integration test que arranca `kodo logs --follow` como child process, escribe progresivamente NDJSON al archivo objetivo, verifica que el child emite las líneas según se añaden (tail real, no fake) y cierra el watcher limpiamente al terminar el test (sin handles abiertos que rompan la suite).
  2. Existe un integration test que dispara una emisión real de `session.start` con `transcript_path`, `session_id`, `plane_task_id` y los demás campos canónicos definidos en Phase 7; el test parsea el NDJSON producido y assert-a contra el contrato del evento (no contra un fixture estático), de modo que un cambio en el contrato del evento rompe el test.
  3. Existe un integration test que monta un `state.json` sintético + ficheros de log y ejecuta `kodo logs --session-of <plane-task-id>` E2E, verificando la resolución two-step (`state.json` lookup → head-line scan) y los exit codes deterministas para los casos: task encontrada, task no presente en state.json, task presente sin log file.
  4. `07-HUMAN-UAT.md` se elimina o se reduce a una nota apuntando a los integration tests que lo sustituyen; `MILESTONES.md` v0.3 deja de listar los UATs como deferred (actualización de la entrada al cierre del milestone).
  5. La suite global pasa (`node --test`) y los 3 nuevos tests forman parte de los pasados — sin nuevos `--test-only`, sin sleeps mayores que el watcher poll de fs.watchFile, sin dependencias externas más allá de las ya existentes.
**Plans**: 5 plans
  - [x] 17-01-PLAN.md — UAT-01 logs-follow-integration.test.js (subprocess + 3 batches progresivos + SIGINT cleanup, D-01..D-07, SC#1)
  - [x] 17-02-PLAN.md — UAT-02 session-start-event.test.js (spawn hook + state.json sintético + 6 keys D-10 + fail-loud, D-08..D-11, SC#2)
  - [x] 17-03-PLAN.md — UAT-03 session-of-resolver.test.js (4 escenarios E2E con state.json + logs/ sintéticos + exit codes deterministas observados, D-12..D-14, SC#3)
  - [x] 17-04-PLAN.md — 07-HUMAN-UAT.md redirect (status: superseded) + MILESTONES.md v0.3 entry actualizada (D-15, D-16, SC#4)
  - [x] 17-05-PLAN.md — Full suite green check + audits source-hygiene/sleeps/deps/imports + 9 runs deterministicos (SC#5)
**UI hint**: no

## Backlog

### Phase 999.1: Skill kodo-orchestrate al repo y actualizar a v0.5 (BACKLOG)

**Goal:** Mover la skill `kodo-orchestrate` desde `~/.claude/skills/` al repo (`.claude/skills/kodo-orchestrate/skill.md`) y actualizarla a v0.5: provider-agnostic (eliminar referencias hardcoded a Plane API), cheat-sheet de `kodo` CLI moderno (`kodo logs --session-of`, `kodo gsd inspect`, `kodo gsd verify`), flujos de diagnóstico (sesión stuck → `kodo logs --follow`; lock no se libera → `~/.kodo/locks/`), eliminar el mapping hardcoded de proyectos (leerlo siempre de `~/.kodo/projects.json`). Cierra la fuente de drift entre `src/orchestrator/prompt.md` y la skill global (última edición 2026-04-16, anterior a v0.3 GSD y v0.4 Quick).

**Requirements:** TBD
**Plans:** 5/5 plans complete

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Interface + State Schema | v0.2 | 2/2 | Complete | 2026-04-07 |
| 2. Plane Adapter + Registry | v0.2 | 2/2 | Complete | 2026-04-08 |
| 3. Consumer Rewiring | v0.2 | 2/2 | Complete | 2026-04-10 |
| 4. Server + Trigger Abstraction | v0.2 | 2/2 | Complete | 2026-04-13 |
| 5. Config + Cleanup | v0.2 | 2/2 | Complete | 2026-04-13 |
| 6. Structured Logger Foundation | v0.3 | 4/4 | Complete | 2026-04-15 |
| 7. `kodo logs` CLI + Event Taxonomy | v0.3 | 6/6 | Complete | 2026-04-16 |
| 8. GSD Label + Session Plumbing | v0.3 | 5/5 | Complete | 2026-04-20 |
| 9. Phase Resolver + Bootstrap | v0.3 | 6/6 | Complete | 2026-04-21 |
| 10. Orchestrator Verification Gate | v0.3 | 4/4 | Complete | 2026-04-22 |
| 11. Quick Mode Recognition & Persistence | v0.4 | 3/3 | Complete | 2026-04-28 |
| 12. Hook & Orchestrator Bifurcation | v0.4 | 3/3 | Complete | 2026-04-28 |
| 13. Test Coverage Matrix | v0.4 | 5/5 | Complete | 2026-04-29 |
| 14. CLI Format Foundation | v0.5 | 3/3 | Complete    | 2026-05-05 |
| 15. CLI Polish Wiring | v0.5 | 5/5 | Complete    | 2026-05-05 |
| 16. LOG-09 Debt Cleanup | v0.5 | 3/3 | Complete    | 2026-05-06 |
| 17. Phase 7 UAT Automation | v0.5 | 5/5 | Complete    | 2026-05-10 |

---
*Last updated: 2026-05-10 — Phase 17 planned (5 plans, 2 waves — Wave 1 parallel: 01/02/03; Wave 2: 04/05)*
