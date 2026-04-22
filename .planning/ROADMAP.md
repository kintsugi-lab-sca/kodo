# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- 🔄 **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (in planning, defined 2026-04-15)

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

### v0.3 GSD Integration + Structured Logging

**Core Value:** Una tarea Plane etiquetada `kodo:gsd` arranca una sesión Claude bajo el workflow GSD (1 tarea = 1 fase), con bootstrap automático si el repo no está inicializado, y el sistema completo emite logs estructurados inspeccionables desde el CLI.

- [x] **Phase 6: Structured Logger Foundation** — NDJSON logger, per-session file, redaction, vigilante isolation (completed 2026-04-15)
- [ ] **Phase 7: `kodo logs` CLI + Event Taxonomy** — subcommand with filters, structured lifecycle events, transcript correlation
- [x] **Phase 8: GSD Label + Session Plumbing** — label flag chain, SessionRecord schema, dispatcher wiring, per-repo lock (completed 2026-04-20)
- [ ] **Phase 9: Phase Resolver + Bootstrap** — `.planning/` presence detection, ROADMAP.md parser, title inference, Plane-body project brief
- [ ] **Phase 10: Orchestrator Verification Gate** — orchestrator metadata, VERIFICATION.md inspection, Plane comment on review outcome

## Phase Details

### Phase 6: Structured Logger Foundation
**Goal:** Todo el sistema emite logs estructurados inspeccionables a disco, sin comprometer el budget de arranque del vigilante.
**Depends on:** Nothing (foundational for v0.3)
**Requirements:** LOG-01, LOG-02, LOG-03, LOG-04, LOG-08, LOG-12
**Success Criteria** (what must be TRUE):
  1. Existe `src/logger.js` con factory `createLogger({ sessionId, minLevel })` que expone `debug/info/warn/error` y escribe NDJSON a `~/.kodo/logs/<session-id>.ndjson` con campos `timestamp` (ISO-8601), `level`, `component`, `msg` y contexto arbitrario.
  2. El nivel se configura vía `KODO_LOG_LEVEL` y flag CLI; `warn`/`error` se espejan a stderr en pretty-print sin duplicar el JSON de disco.
  3. Secretos conocidos (`PLANE_API_KEY`, firmas de webhook, headers `Authorization`) se redactan antes de cualquier escritura (disco o consola) — verificable con test unitario.
  4. `kodo check` no carga el logger transitivamente: test de grafo de imports + presupuesto de arranque <50ms guardan la regresión.
**Plans:** 4 plans
  - [x] 06-01-PLAN.md — Wave 0: baseline measurement + test stubs (fixtures, helpers, 4 test files, STARTUP-BASELINE.md)
  - [x] 06-02-PLAN.md — Wave 1: `src/logger-noop.js` + `src/logger.js` factory con NDJSON sink y pretty-print stderr (LOG-01..LOG-04)
  - [x] 06-03-PLAN.md — Wave 2: redactor deep-walk + key-set + JWT/bearer regex integrado en emit (LOG-08)
  - [x] 06-04-PLAN.md — Wave 3: endurecer tests de aislamiento + demote startup-budget (Decisión B, LOG-12)

### Phase 7: `kodo logs` CLI + Event Taxonomy
**Goal:** El usuario puede localizar e inspeccionar el log de cualquier sesión (por session-id o plane-task-id) con filtros y tail en vivo; los eventos de ciclo de vida están tipados.
**Depends on:** Phase 6
**Requirements:** LOG-05, LOG-06, LOG-07, LOG-09, LOG-10, LOG-11
**Success Criteria** (what must be TRUE):
  1. `kodo logs <session-id>` imprime el log completo; `--follow` hace tail en vivo; `--level <n>` filtra por nivel mínimo al mostrar.
  2. `kodo logs --session-of <plane-task-id>` localiza el log sin requerir el session-id.
  3. Los callsites críticos emiten tipos fijos: `session.start`, `session.end`, `state.transition`, `orchestrator.review`, `gsd.phase.resolved`, `gsd.bootstrap`, `plane.api.call` — validable inspeccionando el NDJSON de una sesión de prueba.
  4. Cada `session.start` incluye el path del transcript de Claude Code para pivotar entre la vista de kodo y la de Claude.
**Plans:** 6 plans
  - [x] 07-01-PLAN.md — Wave 0: test stubs (4 test files), golden fixture (7 eventos), logger-sink helper
  - [x] 07-02-PLAN.md — Wave 1: `src/logger-events.js` (EVENTS const + 7 helpers + resolveTranscriptPath) — LOG-09, LOG-10
  - [x] 07-03-PLAN.md — Wave 1: CLI reader — additive exports en `src/logger.js`, `src/logs/reader.js`, `src/logs/follow.js` — LOG-05, LOG-06, LOG-07
  - [x] 07-04-PLAN.md — Wave 1: `src/logs/session-lookup.js` + `src/logs/head-line.js` (two-step resolver) — LOG-11
  - [x] 07-05-PLAN.md — Wave 2: registrar `kodo logs [session-id]` en `src/cli.js` con 6 flags
  - [x] 07-06-PLAN.md — Wave 2: DI logger + emisión tipada en 7 consumers (session/state, manager, hooks, plane/client+provider, cmux, orchestrator)

### Phase 8: GSD Label + Session Plumbing
**Goal:** Una tarea Plane con label `kodo:gsd` atraviesa el dispatcher con el flag GSD propagado hasta la sesión, y dos tareas del mismo repo nunca arrancan sesiones GSD concurrentes.
**Depends on:** Phase 6 (logger observa el nuevo código); Phase 7 recomendado pero no bloqueante.
**Requirements:** GSD-01, GSD-04, GSD-10
**Success Criteria** (what must be TRUE):
  1. `parseKodoLabels` expone `'gsd'` en `flags` cuando la tarea trae label `kodo:gsd`; el dispatcher propaga el flag a `SessionRecord.gsd = true`.
  2. Cuando `session.gsd === true`, el hook `SessionStart` inyecta la secuencia `/gsd:plan-phase <n>` → `/gsd:execute-phase <n>` → `/gsd:verify-work` en el `additionalContext`.
  3. Dos webhooks Plane que resuelven al mismo realpath de repo no arrancan sesiones GSD concurrentes: existe lock por repo (no sólo por task_id) con sentinel en `.planning/.kodo.lock`, verificado por test de integración con dos tareas distintas en paralelo.
**Plans:** 5/5 plans complete
  - [x] 08-01-PLAN.md — Lock module (acquireGsdLock/releaseGsdLock) + Session typedef extension
  - [x] 08-02-PLAN.md — Flag propagation (buildSessionFromTask) + dispatcher GSD lock guard
  - [x] 08-03-PLAN.md — Hook bifurcation (buildGsdContext) + lock release in stop.js
  - [x] 08-04-PLAN.md — Integration test: concurrent GSD session prevention
  - [x] 08-05-PLAN.md — Gap closure: fix CR-01 (sessionId identity end-to-end) + WR-01 (release on launch throw)

### Phase 9: Phase Resolver + Bootstrap
**Goal:** kodo detecta si el repo destino ya tiene `.planning/`, bootstrapea cuando falta usando el cuerpo de la tarea Plane como brief, y resuelve la fase correspondiente a partir del título contra `ROADMAP.md`.
**Depends on:** Phase 8
**Requirements:** GSD-02, GSD-03, GSD-08, GSD-09
**Success Criteria** (what must be TRUE):
  1. El resolver devuelve `{ bootstrap: true }` cuando `.planning/PROJECT.md` está ausente y la sesión inyecta `/gsd:new-project` usando la descripción de la tarea Plane como project-brief; si `.planning/` ya existe, NO dispara bootstrap (guard por presencia estricto, nunca sobrescribe).
  2. `src/gsd/roadmap.js` parsea `## Phase N: Title` de `ROADMAP.md` y `resolvePhase(roadmap, task)` hace match 1:1 estricto por título/heading — falla cerrado (error visible) si hay 0 o >1 matches.
  3. Cuando el título de la tarea coincide con un heading de fase, kodo infiere `phase_id` sin configuración explícita, y `gsd.phase.resolved` registra qué fase y por qué match.
  4. Existe `kodo gsd inspect <task-id>` (dry-run) que reporta qué haría el resolver sin arrancar una sesión.
**Plans:** 3/5 plans complete
  - [x] 09-01-PLAN.md — Pure parser: src/gsd/roadmap.js (parseRoadmap + normalizeTitle) + unit tests (completed 2026-04-21)
  - [x] 09-02-PLAN.md — Session typedef brief? + src/gsd/brief.js (buildBriefFromTask, D-10 format) + unit tests (completed 2026-04-21)
  - [x] 09-03-PLAN.md — src/gsd/resolver.js (discriminated union verdict) + integration tests with tmpDir (completed 2026-04-21)
  - [x] 09-04-PLAN.md — Dispatcher wiring (resolver guard order, phase_id/brief threading) + buildGsdContext extension + hook cleanup
  - [x] 09-05-PLAN.md — kodo gsd inspect <task-id> CLI (dry-run, --json, exit codes) + anti-regression tests for D-04/D-18

### Phase 10: Orchestrator Verification Gate
**Goal:** El orquestador recibe metadata GSD al spawnearse, carga los artefactos de la fase, bloquea la transición a In Review si `VERIFICATION.md` falta o está incompleto, y refleja el resultado en un comentario Plane.
**Depends on:** Phase 9
**Requirements:** GSD-05, GSD-06, GSD-07
**Success Criteria** (what must be TRUE):
  1. El orquestador se spawnea con metadata GSD (`phase_id`, `project_path`) y carga `PROJECT.md` + `ROADMAP.md` + `phases/<n>/PLAN.md` en su contexto.
  2. Antes de aprobar In Review, el orquestador inspecciona `.planning/phases/<n>/VERIFICATION.md`: si falta o su checklist no está completa, bloquea la transición con motivo estructurado.
  3. Al finalizar el review, kodo comenta en la tarea Plane con el `phase_id` resuelto y el resultado (pasada/fallida con motivo); el evento `orchestrator.review` queda en el log de la sesión.
**Plans:** 3/4 plans executed
  - [x] 10-01-PLAN.md — Wave 1: src/gsd/verification.js (parseVerificationFrontmatter + computeVerdict) + unit tests — GSD-05
  - [x] 10-02-PLAN.md — Wave 2: src/gsd/verify.js (orchestration: findSession → VERIFICATION.md → verdict → Plane comment + transition + orchestrator.review log) + CLI/integration tests — GSD-05, GSD-06
  - [ ] 10-03-PLAN.md — Wave 3: src/cli/gsd-verify.js thin handler + cli.js subcommand registration (exit codes 0/1/2) — GSD-05, GSD-06
  - [x] 10-04-PLAN.md — Wave 2: prompt.md ## Sesiones GSD section + launch.js buildContextSummary [GSD phase N] tag + stop.js conditional nudge — GSD-07

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Interface + State Schema | v0.2 | 2/2 | Complete | 2026-04-07 |
| 2. Plane Adapter + Registry | v0.2 | 2/2 | Complete | 2026-04-08 |
| 3. Consumer Rewiring | v0.2 | 2/2 | Complete | 2026-04-10 |
| 4. Server + Trigger Abstraction | v0.2 | 2/2 | Complete | 2026-04-13 |
| 5. Config + Cleanup | v0.2 | 2/2 | Complete | 2026-04-13 |
| 6. Structured Logger Foundation | v0.3 | 4/4 | Complete | 2026-04-15 |
| 7. `kodo logs` CLI + Event Taxonomy | v0.3 | 0/6 | Planned | - |
| 8. GSD Label + Session Plumbing | v0.3 | 5/5 | Complete   | 2026-04-20 |
| 9. Phase Resolver + Bootstrap | v0.3 | 1/5 | Executing | - |
| 10. Orchestrator Verification Gate | v0.3 | 3/4 | In Progress|  |

## Coverage (v0.3)

- v0.3 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

| Requirement | Phase |
|-------------|-------|
| LOG-01 | Phase 6 |
| LOG-02 | Phase 6 |
| LOG-03 | Phase 6 |
| LOG-04 | Phase 6 |
| LOG-08 | Phase 6 |
| LOG-12 | Phase 6 |
| LOG-05 | Phase 7 |
| LOG-06 | Phase 7 |
| LOG-07 | Phase 7 |
| LOG-09 | Phase 7 |
| LOG-10 | Phase 7 |
| LOG-11 | Phase 7 |
| GSD-01 | Phase 8 |
| GSD-04 | Phase 8 |
| GSD-10 | Phase 8 |
| GSD-02 | Phase 9 |
| GSD-03 | Phase 9 |
| GSD-08 | Phase 9 |
| GSD-09 | Phase 9 |
| GSD-05 | Phase 10 |
| GSD-06 | Phase 10 |
| GSD-07 | Phase 10 |

---
*v0.3 roadmap created: 2026-04-15*
*Phase 6 plans created: 2026-04-15*
*Phase 7 plans created: 2026-04-16*
