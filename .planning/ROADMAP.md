# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- ✅ **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (shipped 2026-05-13)
- ✅ **v0.7 GitHub Issues Adapter** — Phases 23-27 (shipped 2026-05-14)
- ✅ **v0.8 Consolidación + GSD Provider Reporting** — Phases 28-33 (shipped 2026-05-25)
- ✅ **v0.9 kodo TUI — sesiones en vivo** — Phases 34-39 + 39.1 (shipped 2026-06-03)
- 🚧 **v0.10 Higiene y estado real de sesiones** — Phases 40-43 (in progress)

## Phases

### 🚧 v0.10 Higiene y estado real de sesiones (In Progress)

**Milestone Goal:** Cerrar el ciclo de vida de las sesiones — sanear lo muerto (worktrees, zombies, locks, logs) y reflejar fielmente lo vivo cross-system — promoviendo el dashboard de read-only a una superficie de gestión.

**Build order (research-synthesized):** PROVIDER-STATE → DOCTOR → DISMISS → RENDER. PROVIDER-STATE (Phase 40) y DOCTOR (Phase 41) son paralelizables (no comparten archivos críticos). DISMISS (Phase 42) tiene **dependencia dura** sobre `src/gsd/doctor.js` de Phase 41 (reusa el saneo) y es la **primera ruptura consciente del invariante v0.9 "TUI read-only"**. RENDER (Phase 43) depende de los datos de Phase 40 y carga decisiones discuss-phase.

- [ ] **Phase 40: Provider State — contrato + providers + enrichment** - `getTaskState` opcional (Plane + GitHub) + enrichment fail-open con cache en `GET /status`
- [ ] **Phase 41: Doctor — módulo puro de saneo + CLI** - `kodo gsd doctor` (dry-run/--fix) sanea worktrees huérfanos, zombies, locks colgados, logs viejos
- [ ] **Phase 42: Dismiss — TUI read-write + server amplification** - tecla `d` descarta sesiones dead reusando doctor; la TUI pasa a read-write
- [ ] **Phase 43: Render — provider_state en el dashboard** - render (columna/badge/color) + filtro de `provider_state` (decisiones discuss-phase)

## Phase Details

### Phase 40: Provider State — contrato + providers + enrichment
**Goal**: El dashboard refleja el estado real de cada tarea en su sistema de gestión (Plane + GitHub) sin acoplar el lifecycle local ni romper el contrato del provider. Cierra el driver del milestone (ROMAN-150: sesión "In Review" invisible tras `/exit`).
**Depends on**: Nothing (paralelizable con Phase 41 — no comparten archivos críticos)
**Requirements**: PSTATE-01, PSTATE-02, PSTATE-03, PSTATE-04
**Success Criteria** (what must be TRUE):
  1. `GET /status` devuelve `provider_state` (`in_progress|in_review|blocked|done|unknown`) por sesión para Plane y GitHub, sin nuevos endpoints
  2. El server abre el dashboard con provider `github` o `plane` sin que el registry lance — `getTaskState` es opcional (NO en `TASK_PROVIDER_METHODS`, que permanece en 9; capability flag `supported`, espejando el patrón `listComments` de v0.9)
  3. Con N sesiones activas, dos polls consecutivos dentro del TTL del cache producen ≤ N llamadas a `getTaskState` (no 2N) — cache server-side por `task_id`
  4. Un `getTaskState` que falla deja la fila sin `provider_state` (fail-open por fila, `reason: fetch-failed`), `GET /status` responde 200 igual, y se emite NDJSON `provider.state.fetch.failed` — nunca silencioso en el log
  5. La cross-provider contract matrix itera un assert capability-gated de `getTaskState` × Plane + GitHub sin romper el determinismo PROVIDERS × N_asserts
**Plans**: 2 plans (2 waves)
- [ ] 40-01-PLAN.md — Provider adapters: optional `getTaskState` (Plane name-first/group, GitHub label-convention) + capability-gated contract-matrix assert (PSTATE-01, PSTATE-02, PSTATE-03)
- [ ] 40-02-PLAN.md — `GET /status` enrichment: `provider_state`/`provider_state_reason` via pure DI resolver (task_id cache + in-flight dedup + fail-open) + `provider.state.fetch.failed` event + STATE.md invariant doc (PSTATE-04)

**Invariantes / notas:**
- `getTaskState` NO entra en `TASK_PROVIDER_METHODS` (FROZEN en 9). Método opcional + `typeof === 'function'` + `supported`. El registry loop lanza para métodos ausentes del array — añadir el 10º rompería el arranque. STATE.md actualiza la nota del invariante "9-method contract" → "9 obligatorios + getTaskState opcional" en esta misma fase (doc-work).
- `reconcileTick` sigue siendo el ÚNICO escritor de `alive`. `provider_state` es un carril read-only en `/status`, JAMÁS escrito a `state.json` ni acoplado a `alive`/`elapsed_min`.
- **Discuss-phase:** honestidad del mapeo GitHub `in_review` (convention-driven por labels, NO automático — documentar explícitamente); TTL exacto del cache (30s como punto de partida).
- Token=0: `getTaskState` son HTTP calls al provider, no llamadas al modelo. El redactor NDJSON cubre el nuevo evento.

### Phase 41: Doctor — módulo puro de saneo + CLI
**Goal**: El operador dispone de `kodo gsd doctor` para detectar y sanear la basura del ciclo de vida (worktrees huérfanos, sesiones zombie, locks colgados, logs viejos) sin tocar jamás recursos vivos, y deja un módulo puro reusable que DISMISS consumirá — una sola fuente de saneo.
**Depends on**: Nothing (paralelizable con Phase 40)
**Requirements**: DOCTOR-01, DOCTOR-02, DOCTOR-03, DOCTOR-04
**Success Criteria** (what must be TRUE):
  1. `kodo gsd doctor` (sin flags) reporta las 4 categorías de basura agrupadas por categoría SIN mutar nada (dry-run por defecto)
  2. `kodo gsd doctor --fix` sanea re-checando liveness (`isPidAlive` + `alive`) inmediatamente antes de cada acción destructiva; usa `git worktree remove`/`prune` (nunca `rm -rf`) y reusa los helpers de `lock.js`/`stop.js`
  3. Exit code determinista: 0 = limpio, 1 = problemas encontrados
  4. Un lock con PID vivo + TTL no excedido NO se borra; un lock con PID muerto (o TTL excedido) se roba — espejando la máquina de estados de `acquireGsdLock`
  5. El saneo vive en `src/gsd/doctor.js` puro + DI + never-throws (espejo de `reconcile.js`), exportando un helper reusable por el CLI y por el dismiss del dashboard
**Plans**: TBD

**Invariantes / notas:**
- **Fase de alto riesgo (mutación destructiva en `--fix`).** Probable UAT/verificación explícita, espejando cómo v0.9 cerró 37/38 por UAT manual.
- doctor NUNCA sanea worktree/lock de sesión viva (`alive===true` o PID vivo). `stop.js` sigue siendo dueño del cleanup happy-path; doctor recoge solo huérfanos. `git worktree remove` sin `--force` (git como segundo guard); dirty → mover a `.dirty`, nunca borrar.
- "Log viejo" = mtime > 7 días, reusando la retención del polling-daemon (v0.8 Phase 28); nunca borrar el log del día activo; unlink entero (no truncar) para no romper followers POSIX.
- TTL del lock como red de seguridad real contra PID-reuse en macOS; cross-check del PID contra `state.json`. Distinguir worktree registrado-sin-dir (`git worktree remove`) de metadata stale (`git worktree prune`).

### Phase 42: Dismiss — TUI read-write + server amplification
**Goal**: El operador descarta sesiones dead desde el dashboard con la tecla `d`, reusando la lógica de saneo de doctor — promoviendo la TUI de read-only a read-write (backlog 999.1) sin romper el invariante never-throws de v0.9.
**Depends on**: Phase 41 (dependencia dura — reusa `src/gsd/doctor.js`), Phase 40 (mismo milestone; idealmente tras render verde de provider_state aunque no es bloqueante para el dismiss en sí)
**Requirements**: DISMISS-01, DISMISS-02, DISMISS-03, DISMISS-04
**Success Criteria** (what must be TRUE):
  1. La tecla `d` sobre una fila `alive===false` dispara `DELETE /sessions/{id}` (endpoint existente) que delega en `doctor.execute({taskId})` — el dashboard NO reimplementa saneo
  2. Guard inverso al de Enter: `d` sobre `alive===true` se rechaza con mensaje al footer y NO descarta — nunca se descarta una sesión viva
  3. La confirmación inline (doble `d` / `Esc`) se resuelve contra la identidad `task_id` revalidada, nunca contra índice de array ni snapshot congelado, re-checando `alive===false` en el momento del DELETE
  4. Un fallo del DELETE muestra mensaje en el footer sin desmontar el panel — la mutación pasa por `client.js` never-throws (`{ok:false, error}`), preservando el invariante "ningún throw llega a React" de v0.9
**Plans**: TBD
**UI hint**: yes

**Invariantes / notas:**
- **PRIMERA ruptura consciente del invariante v0.9 "TUI read-only".** Justificación: backlog 999.1; `DELETE /sessions/{id}` ya existe. Documentar el cambio de identidad de la superficie (observabilidad → gestión) en STATE.md.
- **Fase de alto riesgo (mutación destructiva desde la TUI).** Probable UAT/verificación explícita (espejo de 37/38 en v0.9).
- TOCTOU: re-validar `alive===false` contra el snapshot MÁS reciente al confirmar, no al pulsar `d`. Considerar congelar el render bajo el modo confirm (patrón overlay de Phase 39).
- El handler de `useInput` no hace `await` desnudo: o fire-and-forget con `.catch` al footer, o delega a `dismissSession` never-throws. `reconcileTick` sigue siendo el ÚNICO escritor de `alive`; el dismiss solo invoca saneo vía el server.

### Phase 43: Render — provider_state en el dashboard
**Goal**: El dashboard muestra y permite filtrar `provider_state` de forma legible y honesta — separado del estado v3 local — cerrando la cadena provider_state end-to-end. Capa fina sobre los datos de Phase 40.
**Depends on**: Phase 40 (necesita `provider_state` en el JSON de `/status`)
**Requirements**: PSTATE-05, PSTATE-06
**Success Criteria** (what must be TRUE):
  1. El dashboard muestra `provider_state` de forma SEPARADA de `statusColor` v3 (sin fusionar los dos ejes — proceso local vs tarea en el sistema de gestión)
  2. El render distingue tres estados visuales: ok / unsupported / fetch-failed (p. ej. dim + `?`), reusando el campo `supported`/`reason` de Phase 40
  3. El filtro del dashboard acota por `provider_state` con `String.includes` case-insensitive sobre el string crudo (anti-ReDoS, nunca `RegExp` ni `switch` sobre literales hardcodeados)
  4. El render/filtro sobrevive a un renombrado del estado en el provider sin cambios de código (estado tratado como dato crudo)
**Plans**: TBD
**UI hint**: yes

**Invariantes / notas:**
- **Decisiones discuss-phase (no research):** forma de render — columna vs badge vs color (PSTATE-05); semántica del filtro — `s:review` OR vs prefijo `ps:` (PSTATE-06). Resolver al planificar la fase.
- Color isolation: el render usa `<Text color>` de ink, cero picocolors. Selección por identidad `task_id` (invariante Phase 36) intacta.
- No acoplar `alive`/lifecycle al vocabulario del provider (anti-pattern D-09 web UI legacy).

## Archived Milestones

<details>
<summary>✅ v0.9 kodo TUI — sesiones en vivo (Phases 34-39 + 39.1) — SHIPPED 2026-06-03</summary>

- [x] Phase 34: Fundación — subcomando + ciclo de vida (2/2 plans) — completed 2026-05-27
- [x] Phase 35: Datos — cliente HTTP + polling (4/4 plans) — completed 2026-05-27
- [x] Phase 36: Tabla viva — render + selección + filtros (3/3 plans) — completed 2026-05-27
- [x] Phase 37: Focus — invocar cmux select-workspace (3/3 plans) — completed 2026-05-28
- [x] Phase 38: WorkspaceHost provider + ciclo de vida idle/needs-input (4/4 plans) — completed 2026-06-01
- [x] Phase 39: Paneles auxiliares — comentarios + logs (2/2 plans) — completed 2026-06-02
- [x] Phase 39.1: Cierre de gaps v0.9 (INSERTED) (5/5 plans) — completed 2026-06-03

Full details: `.planning/milestones/v0.9-ROADMAP.md`
Milestone audit: `.planning/milestones/v0.9-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.9-REQUIREMENTS.md`

</details>

<details>
<summary>✅ v0.8 Consolidación + GSD Provider Reporting (Phases 28-33) — SHIPPED 2026-05-25</summary>

- [x] Phase 28: Polling/Daemon Hardening (3/3 plans) — completed 2026-05-18
- [x] Phase 29: GSD Provider Reporting Integration (4/4 plans) — completed 2026-05-20
- [x] Phase 30: SessionRecord Lifecycle (4/4 plans) — completed 2026-05-20
- [x] Phase 31: Phase 21/22 Advisory Cleanup (3/3 plans) — completed 2026-05-21
- [x] Phase 32: v0.7 Bookkeeping (Doc-Only) (3/3 plans) — completed 2026-05-21
- [x] Phase 33: v0.8 Bookkeeping & Nyquist Backfill + Surgical Fix (3/3 plans) — completed 2026-05-25

Full details: `.planning/milestones/v0.8-ROADMAP.md`
Milestone audit: `.planning/milestones/v0.8-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.8-REQUIREMENTS.md`

</details>

<details>
<summary>✅ v0.7 GitHub Issues Adapter (Phases 23-27) — SHIPPED 2026-05-14</summary>

- [x] Phase 23: GitHubClient + Auth Foundation (2/3 plans, 23-03 optional/skipped) — completed 2026-05-14
- [x] Phase 24: GitHubProvider + Normalizer + Registry (3/3 plans) — completed 2026-05-14
- [x] Phase 25: Polling Trigger Channel (2/2 plans) — completed 2026-05-14
- [x] Phase 26: Config Wizard + CLI Integration (3/3 plans) — completed 2026-05-14
- [x] Phase 27: Cross-Provider Contract Matrix (1/1 plan) — completed 2026-05-14

Full details: `.planning/milestones/v0.7-ROADMAP.md`
Milestone audit: `.planning/v0.7-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.7-REQUIREMENTS.md`

</details>

<details>
<summary>✅ v0.6 Session Isolation & Skill Sync (Phases 18-22) — SHIPPED 2026-05-13</summary>

- [x] Phase 18: Worktree Runtime Wiring (3/3 plans) — completed 2026-05-12
- [x] Phase 19: Worktree Cleanup & Integration (2/2 plans) — completed 2026-05-12
- [x] Phase 20: HOOK-01 Universal Anti-Push-Fantasma (2/2 plans) — completed 2026-05-12
- [x] Phase 21: Skill Sync CLI + Auto-Sync (2/2 plans) — completed 2026-05-12
- [x] Phase 22: Tech Debt v0.5 Closure (3/3 plans) — completed 2026-05-13 (WR-07 deferred)

Full details: `.planning/milestones/v0.6-ROADMAP.md`
Milestone audit: `.planning/v0.6-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.6-REQUIREMENTS.md`

</details>

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

<details>
<summary>✅ v0.5 CLI Polish & v0.3 Debt Cleanup (Phases 14-17 + 999.1) — SHIPPED 2026-05-11</summary>

- [x] Phase 14: CLI Format Foundation (3/3 plans) — completed 2026-05-05
- [x] Phase 15: CLI Polish Wiring (5/5 plans) — completed 2026-05-05
- [x] Phase 16: LOG-09 Debt Cleanup (3/3 plans) — completed 2026-05-06
- [x] Phase 17: Phase 7 UAT Automation (5/5 plans) — completed 2026-05-10
- [x] Phase 999.1: Skill kodo-orchestrate al repo (5/5 plans) — completed 2026-05-11

Full details: `.planning/milestones/v0.5-ROADMAP.md`
Milestone audit: `.planning/milestones/v0.5-MILESTONE-AUDIT.md`
Requirements archive: `.planning/milestones/v0.5-REQUIREMENTS.md`

</details>

## Progress

**Execution Order (v0.10):** Phases ejecutan en orden numérico: 40 → 41 → 42 → 43. PROVIDER-STATE (40) y DOCTOR (41) son paralelizables si hay bandwidth; DISMISS (42) requiere doctor.js de 41; RENDER (43) requiere los datos de 40.

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
| 14. CLI Format Foundation | v0.5 | 3/3 | Complete | 2026-05-05 |
| 15. CLI Polish Wiring | v0.5 | 5/5 | Complete | 2026-05-05 |
| 16. LOG-09 Debt Cleanup | v0.5 | 3/3 | Complete | 2026-05-06 |
| 17. Phase 7 UAT Automation | v0.5 | 5/5 | Complete | 2026-05-10 |
| 999.1. Skill kodo-orchestrate al repo | v0.5 | 5/5 | Complete | 2026-05-11 |
| 18. Worktree Runtime Wiring | v0.6 | 3/3 | Complete | 2026-05-12 |
| 19. Worktree Cleanup & Integration | v0.6 | 3/3 | Complete | 2026-05-12 |
| 20. HOOK-01 Universal Anti-Push-Fantasma | v0.6 | 2/2 | Complete | 2026-05-12 |
| 21. Skill Sync CLI + Auto-Sync | v0.6 | 2/2 | Complete | 2026-05-12 |
| 22. Tech Debt v0.5 Closure | v0.6 | 3/3 | Complete | 2026-05-13 |
| 23. GitHubClient + Auth Foundation | v0.7 | 2/3 (23-03 skipped) | Complete | 2026-05-14 |
| 24. GitHubProvider + Normalizer + Registry | v0.7 | 3/3 | Complete | 2026-05-14 |
| 25. Polling Trigger Channel | v0.7 | 2/2 | Complete | 2026-05-14 |
| 26. Config Wizard + CLI Integration | v0.7 | 3/3 | Complete | 2026-05-14 |
| 27. Cross-Provider Contract Matrix | v0.7 | 1/1 | Complete | 2026-05-14 |
| 28. Polling/Daemon Hardening | v0.8 | 3/3 | Complete | 2026-05-18 |
| 29. GSD Provider Reporting Integration | v0.8 | 4/4 | Complete | 2026-05-20 |
| 30. SessionRecord Lifecycle | v0.8 | 4/4 | Complete | 2026-05-20 |
| 31. Phase 21/22 Advisory Cleanup | v0.8 | 3/3 | Complete | 2026-05-21 |
| 32. v0.7 Bookkeeping (Doc-Only) | v0.8 | 3/3 | Complete | 2026-05-21 |
| 33. v0.8 Bookkeeping & Nyquist Backfill + Surgical Fix | v0.8 | 3/3 | Complete | 2026-05-25 |
| 34. Fundación — subcomando + ciclo de vida | v0.9 | 2/2 | Complete    | 2026-05-27 |
| 35. Datos — cliente HTTP + polling | v0.9 | 4/4 | Complete    | 2026-05-27 |
| 36. Tabla viva — render + selección + filtros | v0.9 | 3/3 | Complete    | 2026-05-27 |
| 37. Focus — invocar cmux select-workspace | v0.9 | 3/3 | Complete   | 2026-05-28 |
| 38. WorkspaceHost provider + ciclo de vida idle/needs-input | v0.9 | 4/4 | Complete    | 2026-06-01 |
| 39. Paneles auxiliares — comentarios + logs | v0.9 | 2/2 | Complete    | 2026-06-02 |
| 39.1. Cierre de gaps v0.9 (INSERTED) | v0.9 | 5/5 | Complete | 2026-06-03 |
| 40. Provider State — contrato + providers + enrichment | v0.10 | 0/2 | Not started | - |
| 41. Doctor — módulo puro de saneo + CLI | v0.10 | 0/TBD | Not started | - |
| 42. Dismiss — TUI read-write + server amplification | v0.10 | 0/TBD | Not started | - |
| 43. Render — provider_state en el dashboard | v0.10 | 0/TBD | Not started | - |

---
*Last updated: 2026-06-03 — v0.10 "Higiene y estado real de sesiones" roadmap creado (Phases 40-43). Build order PROVIDER-STATE → DOCTOR → DISMISS → RENDER. 14/14 requirements mapeados (PSTATE-01..06, DOCTOR-01..04, DISMISS-01..04). Phase 42 (Dismiss) y Phase 41 (Doctor --fix) son las de mayor riesgo (mutación destructiva) — probable UAT. v0.9 (Phases 34-39 + 39.1) SHIPPED y archivado.*

## Backlog

### Phase 999.1: Dismiss de sesiones dead desde el dashboard ink (PROMOTED → Phase 42, v0.10)

**Status:** Promovido a Phase 42 del milestone v0.10 (Dismiss — TUI read-write). Conservado aquí como rastro de origen.

**Goal:** Dar al operador una forma de descartar sesiones `dead`/zombie desde la TUI ink (tecla `d`), cerrando la asimetría con la web (que ya puede). Promueve TUI-F4 (dismissal) de v2 a candidato v1.0, restringido al caso seguro. Origen: una sesión `dead` (ROMAN-22, 40h+) se queda atascada en el dashboard sin forma de limpiarla.
**Requirements:** DISMISS-01..04 (formalizados en `.planning/REQUIREMENTS.md` v0.10)
**Plans:** ver Phase 42

**Por qué NO entró en v0.9:** v0.9 se definió como "TUI read-only del contrato existente". Una mutación cambia la identidad del milestone → `DELETE /sessions/<id>` como acción del TUI estaba explícitamente en *Out of Scope* y TUI-F4 diferido a v2. Material de v0.10.

**Contexto técnico (verificado en código, 2026-06-03):**
- `DELETE /sessions/{taskId}` YA EXISTE (`src/server.js:451` → `removeSession`). NO requiere endpoint nuevo.
- La vista HTML web legacy YA lo consume (`src/server.js:163`). Asimetría: la web descarta, la TUI ink no.
- `removeSession` (`src/session/state.js`) es bookkeeping-only: quita de `state.json` sessions/history (FIFO 50-slot). NO mata proceso ni limpia worktree.
- Guard `row.alive === false` ya existe en `App.js:412` (hoy bloquea Enter sobre dead/zombie).

**Decisiones de alcance resueltas en v0.10:** el dismiss reusa la lógica de saneo de `doctor` (Phase 41) vía `DELETE /sessions/{id}` ampliado, cubriendo worktree huérfano + lock + state — no solo el olvido de `state.json`. Alcance dead/zombie (`alive===false`).

**Relacionado:** WARNING-02/D-09 del `v0.9-MILESTONE-AUDIT.md` — la web UI recomputa `idle` con heurística propia divergente del estado v3; al tocar la web/server para el dismiss, considerar reconciliar esa divergencia.
