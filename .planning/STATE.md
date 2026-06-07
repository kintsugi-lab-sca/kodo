---
gsd_state_version: 1.0
milestone: v0.10
milestone_name: Higiene y estado real de sesiones
status: executing
stopped_at: Phase 43 context gathered
last_updated: "2026-06-07T10:11:12.394Z"
last_activity: 2026-06-07 -- Phase 43 planning complete
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 10
  completed_plans: 8
  percent: 60
---

# Project State

**Project:** kodo
**Active milestone:** v0.10 Higiene y estado real de sesiones (planning — roadmap creado). Ejes: `kodo gsd doctor` (saneo) + dismiss desde el dashboard (TUI read-write) + `provider_state` cross-system (Plane + GitHub). Anterior v0.9 kodo TUI — sesiones en vivo **shipped 2026-06-03**.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-03 after v0.9 milestone — Current State: v0.9 shipped).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** vía cross-provider contract matrix (Plane + GitHub × 7 asserts core); **reforzado en v0.8** con reporting opt-in provider-agnostic. v0.9 añade una superficie de observabilidad en terminal (`kodo dashboard`) read-only sobre ese contrato.

**Current focus:** Phase 43 — render — provider_state en el dashboard

## Current Position

Phase: 43
Plan: Not started
Status: Ready to execute
Last activity: 2026-06-07 -- Phase 43 planning complete

## Roadmap v0.10 (active)

Build order research-synthesized: **PROVIDER-STATE → DOCTOR → DISMISS → RENDER**. Phases 40 y 41 paralelizables (no comparten archivos críticos); 42 depende dura de `src/gsd/doctor.js` (41); 43 depende de los datos de 40.

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 40. Provider State — contrato + providers + enrichment | `getTaskState` opcional (Plane + GitHub) + enrichment fail-open con cache en `/status`; cierra ROMAN-150 | PSTATE-01..04 | medio |
| 41. Doctor — módulo puro de saneo + CLI | `kodo gsd doctor` (dry-run/--fix) sanea worktrees huérfanos, zombies, locks colgados, logs viejos | DOCTOR-01..04 | **ALTO** (--fix destructivo) |
| 42. Dismiss — TUI read-write + server amplification | tecla `d` descarta sesiones dead reusando doctor; **primera ruptura del invariante "TUI read-only"** | DISMISS-01..04 | **ALTO** (mutación desde TUI) |
| 43. Render — provider_state en el dashboard | render (columna/badge/color) + filtro de `provider_state` (decisiones discuss-phase) | PSTATE-05, 06 | bajo |

- **Discuss-phase decisions:** Phase 40 — honestidad del mapeo GitHub `in_review` (convention-driven por labels, no automático), TTL del cache (30s start). Phase 43 — render columna vs badge vs color (PSTATE-05), semántica del filtro `s:review` OR vs prefijo `ps:` (PSTATE-06).
- **Fases de mayor riesgo (probable UAT, espejo de cómo v0.9 cerró 37/38):** Phase 41 (`doctor --fix` borrado destructivo) y Phase 42 (dismiss = mutación destructiva desde la TUI).

## Most recent shipped milestone

**v0.9 kodo TUI — sesiones en vivo** — shipped 2026-06-03 (7 phases 34-39 + cierre 39.1 / 23 plans / 202 commits desde v0.8 / suite 1073 pass + 1 skip). Audit `tech_debt` (sin blockers, 16/16 requirements, 47/47 exports wired, 5/5 flujos E2E).

- Roadmap archive: `milestones/v0.9-ROADMAP.md`
- Requirements archive: `milestones/v0.9-REQUIREMENTS.md`
- Audit: `milestones/v0.9-MILESTONE-AUDIT.md`
- Phase artifacts: `.planning/milestones/v0.9-phases/` (34-39 + 39.1 archivados al iniciar v0.10)

## Deferred Items

Items reconocidos y diferidos al cierre del milestone v0.9 el 2026-06-03 (audit `tech_debt`, ninguno bloqueante — detalle en `milestones/v0.9-MILESTONE-AUDIT.md`):

| Categoría | Item | Estado |
|-----------|------|--------|
| nyquist | Phase 36 VALIDATION.md nyquist_compliant=false | PARTIAL |
| nyquist | Phase 37 VALIDATION.md status=draft, nyquist_compliant=false | PARTIAL |
| nyquist | Phase 38 sin VALIDATION.md | MISSING |
| nyquist | Phase 39 sin VALIDATION.md (39-VERIFICATION sí existe, passed) | MISSING |
| nyquist | Phase 39.1 sin VALIDATION.md (39.1-VERIFICATION passed 14/14) | MISSING |
| verification | Phase 37 sin VERIFICATION.md formal — cerrada vía 37-UAT + 37-HUMAN-UAT passed | covered-by-UAT |
| verification | Phase 38 sin VERIFICATION.md formal — cerrada vía 38-HUMAN-UAT passed (firmado) | covered-by-UAT |
| code | Ciclo de import ESM App.js ↔ SessionTable.js (constantes OVERLAY_*) — resuelto en runtime, suite verde, frágil | WARNING-01 |
| code | Web UI legacy (`src/server.js` displayStatus) recomputa `idle` con heurística propia divergente del estado v3 — cero impacto en el dashboard ink. **Relevante para Phase 42 (dismiss toca el server).** | WARNING-02 / D-09 |
| todo | `surface-provider-state-in-dashboard` (Plane "In Review" / GitHub equivalent) — **promovido a Phase 40/43 de v0.10** | CLOSED → v0.10 |

Backfill citation-based de los VALIDATION.md vía `/gsd:validate-phase <N>` si se desea cerrar la deuda Nyquist; las WARNINGs de código se revisan al planificar las fases relevantes (WARNING-02/D-09 al planificar Phase 42).

## Accumulated Context

### Decisions (Plan 40-01)

- **getTaskState OPCIONAL — TASK_PROVIDER_METHODS FROZEN en 9 (D-13):** detectado via `typeof === 'function'`, NUNCA añadido al array (rompería el boot de providers que no lo implementen). Espejo del patrón v0.9 `listComments`.
- **Plane: name substring gana sobre group (D-08):** "In Review" dentro del group `started` mapea a `in_review` — el driver ROMAN-150. Estado resuelto en vivo via `getWorkItem`, no desde el `stateCache` de init.
- **GitHub: `in_review`/`blocked` son CONVENCIÓN por labels, no estado nativo (D-11):** documentado inline en el adapter. Una sola llamada (`getTask`), sin lookup de PR review-state (D-12 deferred).
- **Anti-ReDoS (D-10/D-11):** ambos mappers usan `String.includes` case-insensitive, jamás `RegExp`/`.match`/`.test` sobre input del provider (state names / label names).
- **Contract matrix capability-gated (D-14):** `if (typeof provider.getTaskState !== 'function') return;` dentro del loop PROVIDERS preserva el determinismo `PROVIDERS × N_asserts` (14 → 16). B1 (9 métodos) inalterado.

### Decisions (Plan 40-02)

- **D-06 (reinterpretación de PSTATE-04):** `/status` emite `provider_state: string|null` + `provider_state_reason: null|'unsupported'|'fetch-failed'` — NO un campo omitido. `unsupported` (permanente) vs `fetch-failed` (transitorio) alimentan los 3 estados visuales de Phase 43.
- **Resolver puro DI (`src/server/provider-state.js`):** `createProviderStateResolver({provider, logger, ttlMs, now})` — capability gate + cache `Map<task_id, {state,reason,ts}>` (D-01/D-04, NO el shape `{data,ts}` de pendingCache) + dedup in-flight `Map<task_id, Promise>` (D-03). Importa SOLO `logger-events.js` — incapaz estructuralmente de escribir `state.json` (carril read-only). TTL = `PENDING_CACHE_TTL_MS` (D-02, sin segundo número).
- **Enrichment fail-open por fila:** `GET /status` usa `Promise.allSettled` (NUNCA `Promise.all`) — el fallo de una fila no tumba la respuesta 200. Resolver construido UNA vez al arrancar (no per-request). Sin tercer bool `supported` (D-07). `alive`/`elapsed_min` intactos.
- **Evento `provider.state.fetch.failed` (D-15):** whitelist explícito `{task_id, provider, error}` (sin `...fields`), `logger.error`, cero imports nuevos (LOG-12). El fail-open jamás es silencioso.

### Decisions (Plan 42-01/42-02)

- **Guard `alive` server-side = autoridad TOCTOU (D-07/D-08):** el 409 vive en `src/server/dismiss.js`, que re-lee `loadState().sessions[taskId]` FRESCO al recibir el DELETE (NO `findSession` — Pitfall 6: no indexa por task_id) y rechaza con `{ok:false, error:'alive'}` ANTES de invocar `execute`. El guard TUI es solo UX; la autoridad del re-check race-safe es el server. Una sesión que revive entre arm y confirm se caza aquí (el seam test 42-03 (d) lo prueba determinista: `executeFn` nunca corre sobre viva).
- **`dismiss.js` pure-DI extraction (espejo Phase 40 provider-state):** la lógica destructiva se extrajo del closure de `createServer` a un módulo puro DI (`createDismissHandler({loadState, executeFn, logger})`) para testearla sin boot HTTP. El handler DELETE de `server.js` queda como thin adapter. Replica el precedente `provider-state.js`.
- **`fix:true` LOCKEADO (DRIFT #2):** `doctor.execute` es un no-op silencioso sin `opts.fix` (`doctor.js:468`) — el server siempre llama `executeFn({}, {taskId, fix:true})`. Olvidarlo produciría un dismiss fantasma (reporta éxito, no sanea). Testeado.
- **`actions[]` SINTETIZADO de contadores (DRIFT #1):** `execute` devuelve contadores agregados (`worktrees/zombies/locks/errors`), NO el `actions:[{type,result}]` de D-06. `translateToActions()` los traduce (byte-determinista; `skipped` no emite acción). El seam test 42-03 verifica que el vocabulario emitido (`removed/moved-dirty/pruned/kept/error`) coincide exactamente con lo que `mapDismissResult` consume (drift canary T-42-11).
- **Máquina `mode:'confirm'` doble-`d` (D-01/D-02/D-04):** `d` sobre fila `alive===false` arma (captura `task_id` por identidad), segunda `d` ejecuta; `Esc` y cualquier otra tecla cancelan (clear-on-any-input, sin timer — D-03). El guard inverso `alive===true` jamás entra en confirm (DISMISS-04). La fila desaparece por el poll natural (D-11), `resolveSelection` clampa el cursor (D-13).
- **`dismissSession` never-throws (D-10) + `mapDismissResult` puro (D-09):** `dismissSession` (client.js) colapsa todo fallo red/HTTP/JSON/409 a `{ok:false,error}` (calque de `fetchComments`, `encodeURIComponent` anti path-traversal); ningún throw llega a React. `mapDismissResult` (extraído a `select.js`, React-free) deriva `{kind,color}` del `actions[]` con precedencia `error>dirty` — sin import circular de App.js (grep gate == 0).
- **UAT humano firmado (2026-06-05):** mutación destructiva real verificada end-to-end por el operador (worktree+lock+state removidos; máquina arm/confirm/Esc/any-key; guard live-row), espejo del cierre por UAT de v0.9 (Phases 37/38).

### Roadmap Evolution

- **v0.10 roadmap creado (2026-06-03):** 4 phases (40-43), numeración continua desde v0.9 (NO reset). Build order PROVIDER-STATE → DOCTOR → DISMISS → RENDER. 14/14 requirements mapeados. Backlog 999.1 (dismiss) promovido a Phase 42.
- Phase 38 moved: Phase 38 anterior (paneles auxiliares) renumbered a Phase 39 para hacer hueco al WorkspaceHost provider promovido desde backlog 999.2
- Phase 38 inserted after Phase 37: Promoted from backlog 999.2 — WorkspaceHost provider + ciclo de vida idle/needs-input. Trigger: diagnóstico ROMAN-151/152 invisibles en dashboard 2026-05-29.
- Phase 39.1 inserted after Phase 39: Cierre de gaps v0.9 desde milestone audit: BLOCKER host↔TUI + alive divergente + statusColor v3 (URGENT)

### Open Blockers

None.

### Open Questions

Decisiones discuss-phase (no bloquean el roadmap; se resuelven al planificar cada fase):

- **Phase 40:** TTL exacto de `provStateCache` (30s como punto de partida). Honestidad del mapeo GitHub `in_review` — documentar que es convention-driven (labels), no automático.
- **Phase 43:** render de `provider_state` — columna vs badge vs color (PSTATE-05). Semántica del filtro — `s:review` OR vs prefijo `ps:` (PSTATE-06).

- _Resuelto:_ orden de fases (tensión ARCHITECTURE doctor-first vs PITFALLS provider-state-first) → **PROVIDER-STATE primero** (cierra el driver ROMAN-150 y establece el contrato antes de que otras fases toquen los adapters); DISMISS depende de DOCTOR en cualquier orden.

### Roadmap (archived milestones)

- **v0.2 Provider Abstraction** — shipped 2026-04-13. See `milestones/v0.2-ROADMAP.md`.
- **v0.3 GSD Integration + Structured Logging** — shipped 2026-04-22. See `milestones/v0.3-ROADMAP.md`.
- **v0.4 GSD Quick Mode** — shipped 2026-04-30. See `milestones/v0.4-ROADMAP.md`.
- **v0.5 CLI Polish & v0.3 Debt Cleanup** — shipped 2026-05-11. See `milestones/v0.5-ROADMAP.md`.
- **v0.6 Session Isolation & Skill Sync** — shipped 2026-05-13. See `milestones/v0.6-ROADMAP.md`, `v0.6-MILESTONE-AUDIT.md`.
- **v0.7 GitHub Issues Adapter** — shipped 2026-05-14. See `milestones/v0.7-ROADMAP.md`, `v0.7-MILESTONE-AUDIT.md`.
- **v0.8 Consolidación + GSD Provider Reporting** — shipped 2026-05-25. See `milestones/v0.8-ROADMAP.md`, `milestones/v0.8-MILESTONE-AUDIT.md`.
- **v0.9 kodo TUI — sesiones en vivo** — shipped 2026-06-03. See `milestones/v0.9-ROADMAP.md`, `milestones/v0.9-MILESTONE-AUDIT.md`.

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider contract: 9 obligatorios + getTaskState opcional** (canonical en `src/interface.js`): obligatorios `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects` — validados por `TASK_PROVIDER_METHODS` (FROZEN en 9). **Métodos OPCIONALES** (NO en el array, detectados con `typeof === 'function'`): `listComments` (v0.9, con flag `supported`), y desde v0.10 `getTaskState` (carril read-only de `provider_state` en `/status`, distinción `unsupported`/`fetch-failed` vía `provider_state_reason`). El array sigue FROZEN en 9 — el registry loop lanza para métodos del array ausentes, así que añadir un opcional al array rompería el arranque. Empíricamente verificado por `test/providers/contract.test.js` (matrix capability-gated).
- **TaskItem shape canónico de 13 fields** (v0.8 Phase 28 extendió 11→13 con `updated_at`/`created_at` REQUIRED): `shouldDispatch` evalúa contra timestamps reales en cualquier path. Contract matrix asserta ambos timestamps × 2 providers.
- **Lock per-repo Phase 8 GSD-10**: el dispatcher coalesce sesiones por repo. **v0.10 Phase 41 (doctor) reusa `isPidAlive`/`readLock`/`releaseGsdLock` de `lock.js` — NO reimplementa liveness; el TTL es la red de seguridad contra PID-reuse.**
- **Dispatcher fire-and-forget** (v0.2): polling channel emula el patrón webhook.
- **markSessionStatus contrato non-throwing** (v0.8 Phases 30+33): retorna `{ok, reason}`; los 2 callers consumen con log+continue. `src/session/manager.js` es el contrato.
- **findSession dual-scan** (v0.8 Phase 30): escanea `state.sessions` + `state.history`.
- **LOG-12 guard**: `kodo check` no carga `src/logger.js` transitivamente. Cualquier módulo nuevo en path "no-logger" debe añadir su row.
- **Color isolation**: `picocolors` solo desde `src/cli/format.js`. **v0.10 Phase 41 (doctor CLI) consume `createFormatter(stream)`, cero ANSI inline; Phase 43 (render) usa `<Text color>` de ink, cero picocolors en `src/cli/dashboard/`.**
- **`--json` byte-determinismo** (DX-06): outputs JSON idénticos TTY/no-TTY. Aplica a `kodo gsd doctor --json` (Phase 41).
- **Worktree always-on Phase 18**: dispatchers disparan `dispatchTrigger` → `computeWorktreePath` → spawn. **v0.10 Phase 41: doctor NUNCA usa `rm -rf` — `git worktree remove`/`prune`; dirty → `.dirty`; nunca sigue symlinks fuera de `.bg-shell/`.**
- **HOOK-01 universal Phase 20** / **cwd=repo Phase 999.1** / **`kodo:gsd-child` anti-recursión** (v0.8 Phase 29) / **Reporting opt-in strict** (v0.8 Phase 29): sin cambios en v0.10.
- **TUI read-WRITE para dismiss-de-dead-sessions, cero endpoints nuevos** (v0.9→v0.10): `kodo dashboard` consume `GET /status`, `/comments/<task_id>`, `/logs` y **desde Phase 42 también `DELETE /sessions/{id}`**. **Phase 42 SHIPPÓ la ruptura consciente del invariante v0.9 "TUI read-only" → read-write** (backlog 999.1, UAT humano firmado 2026-06-05): el dashboard deja de ser una superficie de pura **observabilidad** y pasa a ser de **gestión** (cambio de identidad: observabilidad → gestión) para el caso ACOTADO de descartar sesiones **dead** (`alive===false`) vía la tecla `d`. La ruptura es DELIBERADA y ACOTADA: sigue **SIN añadir endpoints** (`DELETE /sessions/{id}` ya existía — se AMPLIÓ, no se creó — para delegar en `doctor.execute({taskId, fix:true})`); jamás descarta una sesión viva (guard `alive` en 3 capas, autoridad server-side 409 TOCTOU); `reconcileTick` sigue siendo el único escritor de `alive` (el dismiss solo borra la ENTRADA `sessions[taskId]`, archivada en `history`, jamás muta `alive`). Esta es la ÚNICA superficie read-write de la TUI a fecha de v0.10; futuras capacidades de mutación desde la TUI heredan este precedente (doble-confirm + guard server-side autoritativo + never-throws).
- **Fuente única de `alive`** (v0.9 Phase 38 + 39.1): `reconcileTick` es el ÚNICO escritor de `alive` → `state.json` → pass-through en `GET /status`. **v0.10: ni doctor ni dismiss escriben `alive`; `provider_state` es un carril read-only paralelo en `/status`, jamás escrito a `state.json` ni acoplado a `alive`/`elapsed_min`.**
- **TUI nunca crashea** (v0.9 Phase 35): la capa de datos (`fetchStatus`/`fetchComments`/`fetchLogs`) es never-throws (`{ok:false, error}`); ningún throw llega a React. **v0.10 Phase 42: `dismissSession` (DELETE) se añade a esa capa never-throws; el handler de `d` nunca hace `await` desnudo.**
- **Selección por identidad `task_id`** (v0.9 Phase 36): la TUI rastrea la fila por `task_id`, nunca por índice. **v0.10 Phase 42: el dismiss confirma y ejecuta contra `task_id` revalidado, nunca contra índice ni snapshot congelado; filtro provider_state con `String.includes` anti-ReDoS (Phase 43).**

## Session Continuity

- **Last session:** 2026-06-06T16:38:51.976Z
- **Stopped at:** Phase 43 context gathered
- **Next action:** `/gsd:plan-phase 40` (Provider State). Phase 40 y 41 paralelizables si hay bandwidth.
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.10)
  - `.planning/ROADMAP.md` (v0.10 activo Phases 40-43; v0.9 colapsado en Archived Milestones; Backlog 999.1 → promovido a Phase 42)
  - `.planning/REQUIREMENTS.md` (v0.10, traceability 14/14 → Phases 40-43)
  - `.planning/research/SUMMARY.md` + `ARCHITECTURE.md` + `PITFALLS.md` (research v0.10, confidence HIGH, ninguna fase necesita research-phase)
  - `.planning/MILESTONES.md` (entrada v0.9 completa)
  - `.planning/milestones/v0.9-*` (full milestone v0.9 archive)

## Operator Next Steps

- Plan la primera fase con `/gsd:plan-phase 40` (Provider State — contrato + providers + enrichment).
- Phases 41 (Doctor `--fix`) y 42 (Dismiss) son las de mayor riesgo: prever UAT/verificación explícita al planificarlas.
