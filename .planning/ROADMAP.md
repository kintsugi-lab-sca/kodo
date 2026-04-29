# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- 🚧 **v0.4 GSD Quick Mode** — Phases 11-13 (in progress, started 2026-04-28)

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

### v0.4 GSD Quick Mode (Phases 11-13) — IN PROGRESS

- [x] **Phase 11: Quick Mode Recognition & Persistence** — `kodo:gsd-quick` propaga `gsd_mode='quick'` desde label hasta `SessionRecord` con skip-permissions parity (completed 2026-04-28)
- [x] **Phase 12: Hook & Orchestrator Bifurcation** — SessionStart inyecta `/gsd-quick`, Stop nudge omite `kodo gsd verify`, orchestrator distingue `[GSD quick]` en su tag (completed 2026-04-28)
- [ ] **Phase 13: Test Coverage Matrix** — los 4 estados de label (none, gsd, gsd-quick, ambos) cubiertos en `labels`, `manager`, `dispatcher`, `session-start`

## Phase Details

### Phase 11: Quick Mode Recognition & Persistence
**Goal**: Una task etiquetada `kodo:gsd-quick` es reconocida como sesión GSD por toda la ruta de arranque y persiste `gsd_mode='quick'` en `SessionRecord` con el mismo contrato de skip-permissions que `kodo:gsd`.
**Depends on**: v0.3 Phase 10 (resolver, lock, dispatcher)
**Requirements**: QUICK-01, QUICK-02, QUICK-03, QUICK-04
**Success Criteria** (what must be TRUE):
  1. Una task con label `kodo:gsd-quick` (sólo, o junto a `kodo:gsd`) produce una sesión persistida en `state.json` con `gsd: true` y `gsd_mode: 'quick'`; una task sólo con `kodo:gsd` persiste `gsd_mode: 'full'`.
  2. La sesión quick adquiere el mismo per-repo lock que la sesión full — dos tareas (`kodo:gsd` + `kodo:gsd-quick`) sobre el mismo repo no arrancan procesos concurrentes.
  3. Cuando el resolver retorna `phase` para una task quick, `phase_id` NO se persiste en `SessionRecord` (la sesión es phase-agnostic); cuando retorna `error` con `code: 'no-match'` la sesión arranca igual; `roadmap-missing` y `multi-match` siguen abortando.
  4. El comando claude lanzado por una task `kodo:gsd-quick` incluye `--dangerously-skip-permissions` (mismo flag que ya implica `kodo:gsd` desde commit `004995c`).
**Plans**: 3 plans
  - [x] 11-01-PLAN.md — Add getSessionMode helper to src/labels.js (D-09/D-10)
  - [x] 11-02-PLAN.md — Persist gsd_mode in buildSessionFromTask + unify skipPerms via getGsdMode (QUICK-03/QUICK-04)
  - [x] 11-03-PLAN.md — Dispatcher telemetry mode field + tolerated info emit + lift gsdBootstrap helper (QUICK-01/QUICK-02)

### Phase 12: Hook & Orchestrator Bifurcation
**Goal**: Los tres puntos de lectura del modo (SessionStart hook, Stop hook, orchestrator launch summary) ramifican en `session.gsd_mode` para que una sesión quick ejecute `/gsd-quick`, no se le sugiera `kodo gsd verify`, y aparezca distinguida en la pizarra del orchestrator.
**Depends on**: Phase 11 (necesita `gsd_mode` persistido)
**Requirements**: QUICK-05, QUICK-06, QUICK-07
**Success Criteria** (what must be TRUE):
  1. Cuando SessionStart se dispara para una sesión con `gsd_mode === 'quick'`, el contexto inyectado al agente contiene `/gsd-quick "<task title>"` y NO contiene la cadena `/gsd-plan-phase → /gsd-execute-phase → /gsd-verify-work` ni `/gsd-new-project`.
  2. Cuando Stop se dispara para una sesión quick, el nudge mostrado al humano NO menciona `kodo gsd verify <session-id>` y sí pide revisión manual; el lock se libera igual que en modo full.
  3. El `buildContextSummary` del orchestrator emite tres etiquetas distintas según el caso: `[GSD quick]` para quick, `[GSD phase N]` para full con match, `[GSD bootstrap]` para full con bootstrap.
  4. La sección `## Sesiones GSD` de `prompt.md` incluye un párrafo aclarando que las sesiones quick no se verifican via `kodo gsd verify` y se revisan como cualquier sesión no-GSD.
**Plans**: TBD
**UI hint**: no

### Phase 13: Test Coverage Matrix
**Goal**: Los cuatro estados de label (none, `gsd`, `gsd-quick`, ambos) están cubiertos por tests automatizados en cada uno de los cuatro puntos de la cadena (helper, manager, dispatcher, hook), más los tres sitios complementarios (`getSessionMode`, `stop.js` switch, `launch.js` gsdTag) que Phase 11/12 dejaron como deferred. Garantiza que un cambio futuro en cualquiera de los siete sitios no introduzca regresión silenciosa de modo.
**Depends on**: Phase 11 + Phase 12 (verifica el chain completo)
**Requirements**: QUICK-08 (+ scope ampliado por Phase 13 CONTEXT D-04..D-07)
**Success Criteria** (what must be TRUE):
  1. `test/labels.test.js` cubre los 4 estados sobre `parseKodoLabels` y `getGsdMode` (none → null, `gsd` → `'full'`, `gsd-quick` → `'quick'`, ambos → `'quick'`).
  2. `test/manager.test.js` verifica que `buildSessionFromTask` emite `gsd_mode: 'quick'` y que el comando claude incluye `--dangerously-skip-permissions` para quick (source-hygiene del flag desde una sola fuente). Source-hygiene extendido: `gsd_mode` se persiste vía `getGsdMode(flags)`, no inline.
  3. `test/dispatcher.test.js` cubre la tolerancia del resolver en modo quick (`code: 'no-match'` continúa, `roadmap-missing` aborta) y el descarte de `phase_id` cuando hay match.
  4. `test/session-start.test.js` cubre la rama quick de `buildGsdContext` (inyecta `/gsd-quick "<title>"` y omite la cadena plan/execute/verify); incluye source-hygiene anti-inline `|| 'full'` y anti-acceso directo a `session.gsd_mode`.
  5. La suite completa pasa: `node --test` reporta 0 fallos y los tests nuevos/extendidos están entre los pasados.
  6. `test/labels.test.js` cubre los 4 estados de `getSessionMode(session)`: `gsd:false` → null, legacy `gsd:true` sin `gsd_mode` → `'full'`, `gsd:true`+`gsd_mode:'full'` → `'full'`, `gsd:true`+`gsd_mode:'quick'` → `'quick'`.
  7. `test/stop.test.js` cubre los 3 cases del switch exhaustivo de `buildStopNudgeText` (`quick` sin `kodo gsd verify`, `full` con verify nudge, `default` no-GSD); source-hygiene assert que el bloque del case quick no contiene `kodo gsd verify` en el source.
  8. `test/orchestrator-gsd.test.js` (o equivalente) cubre las 3 etiquetas de `buildContextSummary` gsdTag (`[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]`) más el caso defensivo Phase 12 D-11 (sesión quick con phase_id residual sigue rindiendo `[GSD quick]`).
**Plans**: 5 plans
  - [ ] 13-01-PLAN.md — Extender test/labels.test.js con 4 estados de getGsdMode + 4 estados de getSessionMode (SC #1, #6)
  - [ ] 13-02-PLAN.md — Extender test/manager.test.js con gsd_mode propagation + source-hygiene anti-inline (SC #2)
  - [ ] 13-03-PLAN.md — Añadir test/dispatcher.test.js QUICK-08 quick mode resolver tolerance (SC #3)
  - [ ] 13-04-PLAN.md — Añadir test/session-start.test.js QUICK-08 quick mode buildGsdContext + source-hygiene D-09/D-10 (SC #4)
  - [ ] 13-05-PLAN.md — Extender test/stop.test.js + test/orchestrator-gsd.test.js con switch buildStopNudgeText + gsdTag 3 etiquetas + source-hygiene (SC #7, #8)

### Next milestone

Pending v0.4 ship. Candidates listed in `PROJECT.md` Active section (GitHub Issues adapter, ClickUp adapter, local provider, polling/file-watcher triggers, CLI colour output, LOG-09 deuda, Phase 7 UATs).

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
| 11. Quick Mode Recognition & Persistence | v0.4 | 3/3 | Complete    | 2026-04-28 |
| 12. Hook & Orchestrator Bifurcation | v0.4 | 3/3 | Complete   | 2026-04-28 |
| 13. Test Coverage Matrix | v0.4 | 3/5 | In Progress|  |

---
*Last updated: 2026-04-29 — Phase 13 planning complete (5 plans, all wave 1)*
