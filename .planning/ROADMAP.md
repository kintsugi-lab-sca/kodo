# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- ✅ **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (shipped 2026-05-13)
- 🚧 **v0.7 GitHub Issues Adapter** — Phases 23-27 (planned 2026-05-13)

## Phases

- [x] **Phase 23: GitHubClient + Auth Foundation** — REST wrapper sobre `api.github.com` con PAT, rate limit handling y etag/304 conditional fetch. ✅ shipped 2026-05-14
- [ ] **Phase 24: GitHubProvider + Normalizer + Registry** — Los 9 métodos `TaskProvider`, normalizer GitHub Issue → `TaskItem`, factory en registry, contract tests offline.
- [ ] **Phase 25: Polling Trigger Channel** — Loop async + state cache (etag + cursor) + wiring a `dispatchTrigger` + fail-open retry, con clock-mock tests.
- [ ] **Phase 26: Config Wizard + CLI Integration** — `kodo config` extiende `provider: github`, `kodo polling start/stop/status` daemon y `kodo orchestrator --polling` integrado.
- [ ] **Phase 27: Cross-Provider Contract Matrix** — Test matrix corriendo el mismo contract suite contra `plane` y `github`, demostrando el invariante v0.2 con uso real ≠ Plane.

## Phase Details

### Phase 23: GitHubClient + Auth Foundation
**Goal**: Existe un cliente REST aislado capaz de hablar con `api.github.com` con auth PAT, conciencia de rate limits y soporte de fetch condicional via etag/304 — sin acoplarse a `TaskProvider`.
**Depends on**: Nothing (foundational for v0.7)
**Requirements**: GH-01
**Success Criteria** (what must be TRUE):
  1. `src/providers/github/client.js` exporta `GitHubClient` con métodos `getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels` (estos son métodos del HTTP client de Phase 23 — NO del contrato `TaskProvider`; `listLabels` aquí no es la fantasía-original del roadmapper sino un endpoint REST legítimo) y opera contra `https://api.github.com` con header `Authorization: token <GITHUB_TOKEN>` (token leído via `~/.kodo/.env`, NO config.json — espejo de `getPlaneApiKey`).
  2. El cliente emite warn estructurado NDJSON (`github.api.call` event) cuando `X-RateLimit-Remaining < 100` y rechaza con error canonical `rate_limit_exceeded` en `429`.
  3. `listIssues` acepta opciones `{ since, etag }` y reporta `304 Not Modified` sin levantar excepción — devuelve `{ status: 304, items: [], etag: <returned> }` para que el caller (Phase 25 polling) decida.
  4. Suite añade ≥ 8 tests offline con fixtures `test/fixtures/github/*.json` (issues, rate-limit, 304, 401, 429) — zero live API calls.
**Plans**: 3 plans (23-01 logger-events extension, 23-02 client + tests + fixtures, 23-03 capture script [optional])
  - [ ] 23-01-PLAN.md — Extender taxonomía NDJSON con github.api.call + github.api.call.failed
  - [ ] 23-02-PLAN.md — GitHubClient core + 5 métodos + 14 tests + 10 fixtures JSON
  - [ ] 23-03-PLAN.md — (opcional) scripts/capture-github-fixtures.js para refresh manual

### Phase 24: GitHubProvider + Normalizer + Registry
**Goal**: `getProvider('github')` devuelve un `TaskProvider` válido que normaliza issues a `TaskItem` canónico, propaga `parseKodoLabels` sin tocarlo, y supera el mismo gate de validación de interface que `plane`.
**Depends on**: Phase 23
**Requirements**: GH-02, GH-03, GH-04, GH-05, TEST-01
**Success Criteria** (what must be TRUE):
  1. `src/providers/github/provider.js` exporta `createGitHubProvider(config, opts?)` que implementa los **9 métodos REALES** del contrato `TaskProvider` definido en `src/interface.js` (`TASK_PROVIDER_METHODS`): `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. GitHub no usa webhook en v0.7 → `parseTriggerEvent` retorna `null` y `verifySignature` retorna `false` (no-op funcional). `init()` es no-op (sin cache, labels embedded en cada payload). Corrección 2026-05-14 vía Phase 24 CONTEXT.md D-01: la lista original (`listTasks`, `listLabels`, `listStates`, `transitionTask`) era fantasía — esos métodos no están en el contrato canonical y `registry.js:73-77` los rechazaría.
  2. `src/providers/github/normalize.js` convierte un GitHub Issue payload a `TaskItem` canónico con shape contractual: `id` = `node_id` opaco, `ref` = `<owner>/<repo>#<number>`, `labels` array de strings, `priority` derivada de label `priority:urgent|high|medium|low` (default `null`, simétrico con Plane normalize.js — Phase 27 TEST-03 valida cross-provider), `projectId` = `<owner>/<repo>`, `state` = `'open'`/`'closed'` literal, `groups` = `[]`; cero fugas de campos GitHub-only (`pull_request`, `assignees`, `milestone`, `comments_count`, etc.).
  3. `src/providers/registry.js` registra factory `github` con singleton lazy init; `getProvider('github')` valida que los 9 métodos existen (`TASK_PROVIDER_METHODS`); arrancar `bin/kodo` con `provider: github` en config no crashea.
  4. `parseKodoLabels` invocado sobre labels de un GitHub Issue reconoce `kodo`, `kodo:sonnet`, `kodo:haiku`, `kodo:gsd`, `kodo:gsd-quick` con la misma semántica que en Plane — invariante: zero cambios en `src/labels.js`.
  5. `test/providers/github/provider.test.js` cubre los 9 métodos con fixtures offline + ≥ 90% branches del normalizer (priority extraction, body→description plain text, missing-field defaults).
**Plans**: 3 plans
  - [x] 24-01-PLAN.md — Normalizer puro + 5 fixtures incrementales + normalize tests (Wave 1, GH-03 / TEST-01)
  - [x] 24-02-PLAN.md — Provider factory + 9 métodos + contract tests con fakeClient + leak guard (Wave 2, GH-02 / TEST-01)
  - [x] 24-03-PLAN.md — Registry factory 'github' + invariant guards (LOG-12 + GH-05) + D-01 doc safety net (Wave 3, GH-04 / GH-05 / TEST-01)

### Phase 25: Polling Trigger Channel
**Goal**: Existe un tercer canal de trigger (junto a webhook + manual CLI) que descubre issues con label `kodo` mediante polling periódico, dispara `dispatchTrigger` con `TaskItem` normalizado, y nunca crashea el loop por errores transitorios.
**Depends on**: Phase 24
**Requirements**: POLL-01, POLL-02, POLL-03, POLL-04, TEST-02
**Success Criteria** (what must be TRUE):
  1. `src/triggers/polling.js` exporta `startPolling({ provider, repos, intervalSec, clock?, logger? })` que pollea cada `intervalSec` segundos (default 60) llamando `provider.listPendingTasks()` (o `client.listIssues(...)` directo con etag para el path optimizado) por cada repo configurado. Corrección 2026-05-14 vía Phase 24 CONTEXT.md D-01: la redacción original `provider.listTasks({ labels:['kodo'], state:'open', since:<cursor> })` era fantasía — `listTasks` no está en el contrato canonical `TASK_PROVIDER_METHODS`.
  2. `~/.kodo/polling-state.json` persiste `{ <owner>/<repo>: { last_updated_at: <iso>, etag: <string> } }`; respuesta `304` no actualiza cursor (no-op observable en NDJSON); cache corrupto → reset (no crashea).
  3. Tres patrones de detección emiten dispatch: (a) issue nuevo con label `kodo`, (b) issue existente que recibió label `kodo`/`kodo:gsd*` desde el último cursor, (c) cambio de estado relevante; idempotencia delegada al lock per-repo Phase 8 GSD-10 (sin nuevo mecanismo de dedup).
  4. Errores transitorios (`429`, `5xx`, network) entran en backoff exponencial (base 2s, max 3 retries), emiten evento NDJSON `polling.error` con `{ owner, repo, status, attempt }`, y el loop continúa la siguiente iteración fail-open (nunca propaga al proceso parent).
  5. `test/triggers/polling.test.js` valida los 3 patterns + 304 handling + retry exponencial usando clock mock (override `setTimeout`/helper `controlledTime`) con wall-time < 1s; zero live API calls; zero `setTimeout` real en happy path.
**Plans**: 2 plans
  - [x] 25-01-PLAN.md — Logger events extension: 3 helpers `pollingTick`/`pollingDispatch`/`pollingError` + EVENTS taxonomía 15→18 + test contract T-25-02 (Wave 1, TEST-02)
  - [x] 25-02-PLAN.md — Core `src/triggers/polling.js` (startPolling + state cache atómico + retry backoff + fire-and-forget) + `test/triggers/polling.test.js` (~25 casos clock-mock) + LOG-12 row para polling.js (Wave 2, POLL-01..04 / TEST-02)

### Phase 26: Config Wizard + CLI Integration
**Goal**: El operador puede configurar `provider: github` desde `kodo config`, arrancar polling como daemon (`kodo polling start`) o integrado al orchestrator (`kodo orchestrator --polling`), y las configs v0.6 siguen leyéndose sin error.
**Depends on**: Phase 25
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04
**Success Criteria** (what must be TRUE):
  1. `kodo config` con `provider: github` pide `GITHUB_TOKEN` (escribe a `~/.kodo/.env`, NO a `config.json` — espejo Plane), pide `repos` array `[{owner, repo}]` con auto-detect desde `git remote get-url origin` (parseo `github.com[:/]owner/repo(.git)?`) y confirmación interactiva antes de añadir.
  2. `~/.kodo/config.json` schema extendido: `providers.github = { repos, poll_interval (default 60), mcp_hint (default "GitHub MCP server"), states: { review: "closed" } }`; configs v0.6 sin clave `github` cargan idéntico (zero breaking change demostrado por test fixture).
  3. CLI `kodo polling start` arranca daemon (PID file `~/.kodo/polling.pid`) o foreground con `--no-daemon`; `kodo polling stop` finaliza via PID file; `kodo polling status` reporta `running`/`idle`; exit codes deterministas `0` ok / `1` ya corriendo / `2` no config / `3` stop sin daemon vivo.
  4. `kodo orchestrator --polling` arranca el polling loop integrado en el mismo proceso (sin daemon separado); el flag es ortogonal a `kodo polling start` daemon path y la operación documenta el contrato "elige uno u otro por repo" (mutex implícito vía lock per-repo Phase 8 GSD-10).
**Plans**: 3 plans
  - [x] 26-01-PLAN.md — Wizard branch `provider: github` + `configureGithubProvider` helper DI + `parseGitHubRemote` + `getDefaultGithubProviderConfig` factory + 2 fixtures v0.6/v0.7 + migration test (Wave 1, CFG-01 / CFG-02)
  - [x] 26-02-PLAN.md — `src/cli/polling.js` start/stop/status handlers + `src/cli/polling-daemon.js` PID lifecycle + spawn detached + 15 casos integration + exit codes D-14 + 5 casos unit daemon (Wave 2, CFG-03)
  - [x] 26-03-PLAN.md — `kodo orchestrate --polling` flag + SIGINT cleanup + mutex implícito doc + ≥4 casos integration (Wave 3, CFG-04)

### Phase 27: Cross-Provider Contract Matrix
**Goal**: Existe un test matrix provider-agnostic que corre el mismo contract suite contra `plane` y `github`, demostrando con código real que el invariante v0.2 ("cambiar de provider no requiere reescribir lógica") se mantiene con 2 adapters distintos.
**Depends on**: Phase 24 + Phase 25 (necesita ambos providers verdes y el polling channel cableado)
**Requirements**: TEST-03
**Success Criteria** (what must be TRUE):
  1. `test/providers/contract.test.js` itera sobre `['plane', 'github']` ejecutando la misma batería de asserts contra cada `getProvider(name)` instance — mismas signatures, mismos error shapes, mismos campos en `TaskItem` devuelto.
  2. El test usa fixtures offline para ambos providers (zero live API calls) y falla loud si cualquier provider devuelve un shape inconsistente (e.g. `TaskItem.priority` undefined en uno y string en el otro).
  3. Suite global v0.7 termina en ≥ 614 + N tests pass (baseline v0.6) sin regresiones; el matrix añade un test count derivado (`providers.length × asserts`); zero skip nuevos.
**Plans**: TBD

## Progress

**Execution Order:**
Phase 23 → 24 → 25 → 26 → 27 (lineal; 27 puede solaparse con 26 una vez 25 verde).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 23. GitHubClient + Auth Foundation | v0.7 | 2/3 (23-03 optional, skipped) | Complete | 2026-05-14 |
| 24. GitHubProvider + Normalizer + Registry | v0.7 | 3/3 | Complete   | 2026-05-14 |
| 25. Polling Trigger Channel | v0.7 | 2/2 | Complete   | 2026-05-14 |
| 26. Config Wizard + CLI Integration | v0.7 | 3/3 | Complete   | 2026-05-14 |
| 27. Cross-Provider Contract Matrix | v0.7 | 0/? | Not started | — |

## Archived Milestones

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

## Historical Progress (shipped phases)

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

---
*Last updated: 2026-05-14 — Plan 26-02 complete (CFG-03 daemon CLI). 9/11 plans done. Plan 26-03 pending (CFG-04 orchestrate --polling).*
