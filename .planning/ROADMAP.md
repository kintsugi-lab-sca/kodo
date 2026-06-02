# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- ✅ **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (shipped 2026-05-13)
- ✅ **v0.7 GitHub Issues Adapter** — Phases 23-27 (shipped 2026-05-14)
- ✅ **v0.8 Consolidación + GSD Provider Reporting** — Phases 28-33 (shipped 2026-05-25)
- 🚧 **v0.9 kodo TUI — sesiones en vivo** — Phases 34-39 (in progress)

## Phases

### 🚧 v0.9 kodo TUI — sesiones en vivo (In Progress)

**Milestone Goal:** Un subcomando interactivo `kodo dashboard` (Node + ink) que monitoriza en vivo las N sesiones kodo activas, consumiendo exclusivamente el contrato JSON existente del server (`/status`, `/comments/<task_id>`, `/logs`) sin añadir endpoints. Build order A→E verificado contra el codebase en `.planning/research/SUMMARY.md`.

**Stack invariants (no negociables):** `ink@^6.8.0` + `react@^19.2.0` + `ink-text-input@^6.0.0` (Node ≥20; NO ink@7); `React.createElement` en `.js` plano (NO JSX, NO build step); HTTP vía `fetch` built-in (sin dep nueva); color SOLO de `<Text color>` de ink (NO `picocolors` bajo `src/cli/dashboard/`); selección por `task_id` (NO índice de array); poll self-scheduling con `setTimeout` recursivo (NO `setInterval`); cero endpoints nuevos en `src/server.js`.

- [ ] **Phase 34: Fundación — subcomando + ciclo de vida** - Esqueleto `kodo dashboard`, guard non-TTY, salida limpia, color-isolation
- [ ] **Phase 35: Datos — cliente HTTP + polling** - Cliente puro never-throws + poll self-scheduling con keep-last-good
- [ ] **Phase 36: Tabla viva — render + selección + filtros** - Tabla, selección por `task_id`, orden estable, color, header, filtros
- [x] **Phase 37: Focus — invocar `cmux select-workspace`** - Fire-and-forget RPC al socket cmux (revisado tras C-01; no es handoff TTY)
- [ ] **Phase 38: WorkspaceHost provider + ciclo de vida `idle`/`needs-input`** - Provider intercambiable (cmux/orca/…) + estados idle/needs-input/closed + reconciliación host ↔ state
- [ ] **Phase 39: Paneles auxiliares — comentarios + logs** - Overlays `c` (comments por `task_id`) y `l` (grep best-effort sobre `/logs`)

#### Phase 34: Fundación — subcomando + ciclo de vida

**Goal**: El operador puede lanzar y salir del panel `kodo dashboard` de forma segura, con el esqueleto, los guards y las invariantes de disciplina (non-TTY, color-isolation, ciclo de vida limpio) establecidos desde el primer commit antes de cualquier lógica de negocio.
**Depends on**: Phase 33 (v0.8 shipped — primera fase del milestone v0.9)
**Requirements**: TUI-01, TUI-02, TUI-03, TUI-04
**Success Criteria** (what must be TRUE):

  1. El operador ejecuta `kodo dashboard` en una terminal TTY y ve montarse el panel en vivo (esqueleto mínimo via `render()`).
  2. Si el operador redirige stdout a un pipe o lo ejecuta en CI (no-TTY), el comando se niega a arrancar con un mensaje claro y exit code ≠ 0 — sin crash ni error de raw-mode.
  3. El operador pulsa `q` (o Ctrl-C / SIGTERM) y la terminal queda intacta: cursor visible, echo restaurado, scrollback sin corromper.
  4. Ningún archivo bajo `src/cli/dashboard/` importa `picocolors`, y `test/format-isolation.test.js` lo verifica (walker extendido al directorio TUI).

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 34-01-PLAN.md — Stack ink/react + tests Wave 0 (non-TTY, render) + walker color-isolation extendido

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 34-02-PLAN.md — Subcomando `kodo dashboard`: registro + runDashboard (guard/lifecycle) + App.js (chrome + q->exit)

**UI hint**: yes

#### Phase 35: Datos — cliente HTTP + polling

**Goal**: El panel obtiene y refresca las sesiones desde el server de forma resiliente: cliente HTTP puro que nunca lanza, loop de polling que no apila requests, y degradación elegante (keep-last-good + backoff) cuando el server no responde.
**Depends on**: Phase 34
**Requirements**: TUI-05, TUI-06
**Success Criteria** (what must be TRUE):

  1. El panel refresca las sesiones desde `GET /status` cada ~2s; cuando un poll tarda más que el intervalo, el siguiente NO se encola (loop self-scheduling, una request en vuelo a la vez).
  2. Si el server kodo está caído al arrancar, el panel muestra un estado "server caído" claro en lugar de crashear.
  3. Si el server cae a mitad de sesión, el panel conserva el último dato bueno (keep-last-good), reintenta con backoff progresivo y se recupera solo cuando el server vuelve.
  4. Una respuesta JSON corrupta del server se trata como un poll fallido (keep-last-good), nunca como un crash del render.

**Plans**: 4 plans
Plans:
**Wave 1**

- [x] 35-01-PLAN.md — Cliente HTTP puro `fetchStatus` never-throws (`{ok}`) + tests Wave 0 (TUI-05/06)
- [x] 35-04-PLAN.md — Guard WR-01/D-10: baseUrl resuelve con config v1 migrado (fallback 9090, sin TypeError)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 35-02-PLAN.md — Hook `usePoll` self-scheduling: single-flight + backoff 2.5→5→10s + teardown (TUI-05)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 35-03-PLAN.md — `App.js` status line viva: keep-last-good + dos estados de degradación (TUI-06)
**UI hint**: yes

#### Phase 36: Tabla viva — render + selección + filtros

**Goal**: El operador ve y navega la lista viva de sesiones con una tabla legible, selección estable por identidad, orden que no salta, color semántico, resumen de contadores y filtros — la capa de presentación central sobre la que actúan attach/comments/logs.
**Depends on**: Phase 35
**Requirements**: TUI-07, TUI-08, TUI-09, TUI-10, TUI-11, TUI-12
**Success Criteria** (what must be TRUE):

  1. El operador ve una tabla de sesiones activas con columnas `task_ref · repo · phase/mode · status · age`.
  2. El operador mueve el cursor con ↑/↓ y la selección sigue a la misma sesión por `task_id` aunque la lista se reordene o una fila desaparezca en el refresh (nunca apunta a la sesión equivocada).
  3. Las filas mantienen un orden estable por `started_at` (no saltan en cada poll) y se colorean por `status` + `alive`, distinguiendo visualmente el caso zombie `running` + `!alive`.
  4. El header muestra un indicador "live" + contadores por estado (p. ej. "3 running · 1 review"); la lista vacía muestra "no active sessions".
  5. El operador filtra filas con `/` (substring) y los prefijos `r:<repo>` / `s:<state>`, y la posición del cursor se preserva al aplicar o limpiar el filtro.

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 36-01-PLAN.md — Capa derive pura (`select.js` + `format.js`) + Wave 0 RED tests, incl. las dos conductas load-bearing puras `resolveSelection` (TUI-07..12)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 36-02-PLAN.md — Render de la tabla viva en `App.js` + `SessionTable.js`: columnas, orden DESC estable, color + zombie, header contadores, estados vacíos (TUI-07/09/10/11)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 36-03-PLAN.md — `useInput` mode-gated: navegación ↑/↓ + filtro modal `/` (AND `r:`/`s:`, Esc cancel/Enter confirm, cursor preservado, no-match) (TUI-08/TUI-12)

**UI hint**: yes

#### Phase 37: Focus — invocar `cmux select-workspace`

> **REVISED 2026-05-28** tras hallazgo C-01 del research: el verbo `cmux attach <workspace_ref>` NO existe en el binario instalado (`/Applications/cmux.app/Contents/Resources/bin/cmux`). cmux es una app GUI de macOS controlada por socket Unix; sus workspaces son tabs GUI, no sesiones TTY reattachables. El verbo real para "ir a la sesión X" es `cmux select-workspace --workspace <ref>` (fire-and-forget, ~50ms, sin handoff TTY). El alcance original ("fase de mayor riesgo, UAT 4 escenarios, handoff TTY") se reduce a una invocación RPC simple análoga a `src/cmux/client.js`. Ver `37-RESEARCH.md §C-01` para evidencia.

**Goal**: El operador pulsa `Enter` sobre la fila seleccionada del dashboard y la app cmux focusea ese workspace en su GUI mediante una invocación fire-and-forget `cmux select-workspace --workspace <workspace_ref>`. El dashboard sigue corriendo (cero unmount, cero handoff TTY); los guards `alive===false` y errores de `cmux` (ENOENT, exit code ≠ 0) se muestran como footer-error rojo sin romper el panel.
**Depends on**: Phase 36 (el focus actúa sobre la fila seleccionada — la selección por `task_id` debe ser estable primero)
**Requirements**: TUI-13, TUI-14
**Success Criteria** (what must be TRUE):

  1. El operador pulsa `Enter` sobre la fila seleccionada con `alive===true`: kodo ejecuta `cmux select-workspace --workspace <row.workspace_ref>` vía `execFile`; cmux GUI cambia foco al workspace target. El dashboard sigue montado, polling continúa sin interrupción (no se desmonta, no se re-renderiza desde cero).
  2. Si la sesión seleccionada no está viva (`alive===false`), el panel rechaza el focus con un mensaje en el footer (`[!] workspace gone (alive=false) — press any key`) y NO invoca `cmux`. El TTY ni se toca.
  3. Si `cmux` no está en PATH (ENOENT) o `select-workspace` retorna exit code ≠ 0, el panel muestra el error en el footer (`[!] cmux not found in PATH` o `[!] cmux focus failed (code N)`) y permanece montado — nunca rompe el dashboard ni el terminal.
  4. Existe un artefacto de UAT manual documentado (`37-HUMAN-UAT.md`) que cubre los 2 escenarios obligatorios (focus exitoso visible en la GUI + zombie reject sin invocar cmux), y opcionalmente el ENOENT. Sin ese artefacto la fase NO está completa.

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 37-01-PLAN.md — focus.js (orquestador puro never-throws) + test/dashboard/focus.test.js (5 tests Wave 0: ok+args ordering, ENOENT, NON_ZERO_EXIT, SPAWN_ERROR, leak guard)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 37-02-PLAN.md — App.js Enter handler + focusError state + clear-on-any-input + 3 constantes literal-estables, SessionTable.js footer-error rojo, test/dashboard/app-focus.test.js (3 tests Wave 0: alive=false guard, ok path, clear-on-any-input)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 37-03-PLAN.md — runDashboard DI extension (inyecta exec + lazy import runFocus + cmuxBin + onFocus prop) + 37-HUMAN-UAT.md (2 obligatorios bloqueantes + 2 bonus opcionales)

**UI hint**: yes

#### Phase 38: WorkspaceHost provider + ciclo de vida `idle`/`needs-input`

> **PROMOTED 2026-05-30 desde backlog 999.2** (commit `7f6e041` capturó el seed). Reemplaza el slot Phase 38 anterior; los paneles auxiliares se mueven a Phase 39. Trigger: sesión de diagnóstico 2026-05-29 con ROMAN-151/152 visibles en cmux GUI como `Needs input` pero archivadas como `status: done` en `state.history` y por tanto invisibles en el dashboard. Causa raíz: `markSessionStatus(done)` interpreta exit del proceso Claude como cierre de sesión, pero la tab del workspace host sobrevive y puede retomarse (merge pendiente, push, segunda ronda con dudas).

**Goal**: El dashboard nunca pierde sesiones reanudables (proceso Claude exit pero tab del host viva esperando merge/push/duda) — esas sesiones quedan como `idle` o `needs-input` en `state.sessions`, NO se mueven a `history`. Simultáneamente, la dependencia directa de cmux se elimina vía un `WorkspaceHost` provider contract intercambiable (cmux hoy, orca u otros mañana), análogo al invariante v0.7 `TaskProvider 9-method contract`.
**Depends on**: Phase 37 (extrae el `runFocus` orchestrator y la lógica `cmux select-workspace` al provider)
**Requirements**: TUI-17, TUI-18, TUI-19, TUI-20 (TBD — candidatos confirmados en SEED.md)
**Success Criteria** (what must be TRUE):

  1. `src/host/interface.js` define `HOST_METHODS` + `getHost(name)` con contrato mínimo `listWorkspaces / selectWorkspace / isAlive / needsInput`; `CmuxHost` implementa el contrato; test de contrato análogo a `test/providers/contract.test.js` verde.
  2. `markSessionStatus` acepta `idle` / `needs-input` / `closed`; el exit del proceso Claude mapea a `idle` (NO a `done`); el state.json migra idempotentemente (schema_version bump) con backup automático; entries de history con tab del host aún viva → vuelven a `sessions` como `idle`.
  3. El dashboard lista TODOS los estados no-closed con badges visuales (`▶ running`, `⏸ idle`, `🔔 needs-input`, `✗ dead`); los filtros Phase 36 respetan multi-estado; el footer-error Phase 36/37 absorbe errores del host.
  4. La reconciliación polling cruza `state.sessions + state.history` contra `host.listWorkspaces()`; rescata huérfanos con tab viva; sella `closed` los sin tab; debouncing previene flicker idle↔running.
  5. Cero referencias directas a `cmux` en `src/cli/dashboard/`, `src/session/`, `src/cli/polling.js` — cmux confinado a `src/host/cmux.js` (style guard análogo a color-isolation walker).
  6. UAT manual de Phase 37 re-ejecutado sobre `CmuxHost` confirma parity (2 obligatorios siguen pasando).

**Plans**: 4 plans
Plans:
**Wave 1**

- [x] 38-01-PLAN.md — Contract `WorkspaceHost` + `CmuxHost` impl + contract test + cmux-isolation walker (SC#1 + SC#5; suite verde, 0 fallos)

**Wave 2** *(blocked on Wave 1)*

- [x] 38-02-PLAN.md — Estados idle/needs-input/dead/closed + migración v2→v3 + caller updates

**Wave 3** *(blocked on Wave 2)*

- [x] 38-03-PLAN.md — Dashboard render multi-estado: badges + filtros `s:<state>` + footer-error host

**Wave 4** *(blocked on Wave 3)*

- [x] 38-04-PLAN.md — Reconciliación host ↔ state + debouncing + 38-HUMAN-UAT (UAT firmado passed 2026-06-01; Escenario A/ROMAN-151-152 validado en vivo con ROMAN-22; suite 1034 pass)

**UI hint**: yes

#### Phase 39: Paneles auxiliares — comentarios + logs

> **RENUMBERED 2026-05-30** desde Phase 38 anterior — empujado un slot al insertar la nueva Phase 38 (WorkspaceHost). Sin cambios de scope; sólo cambia el orden por dependencia: los paneles ahora operan sobre la tabla con modelo de ciclo de vida correcto.

**Goal**: El operador inspecciona el detalle de una sesión sin salir del panel: overlay de comentarios de la tarea (resuelto correctamente por `task_id`) y overlay de logs (grep best-effort sobre el buffer compartido, etiquetado honestamente como no-per-session), volviendo siempre al mismo cursor.
**Depends on**: Phase 38 (additive sobre la infraestructura de selección + overlays + modelo de ciclo de vida multi-estado; orden E al final por dependencia de build)
**Requirements**: TUI-15, TUI-16
**Success Criteria** (what must be TRUE):

  1. El operador pulsa `c` sobre la fila seleccionada y ve los comentarios de la tarea (`GET /comments/<task_id>`, resuelto vía mapping `task_ref`→`task_id`), con manejo limpio de 404/vacío/error; `Esc` vuelve al mismo cursor.
  2. El operador pulsa `l` sobre la fila seleccionada y ve las líneas de log coincidentes por grep de substring (`task_ref`/`workspace_ref`) sobre el buffer compartido de `GET /logs`; `Esc` vuelve al mismo cursor.
  3. El overlay de logs está etiquetado honestamente como grep de un buffer compartido ("may include other sessions"), no como un tail real por sesión.
  4. El wording de PROJECT.md (línea ~32, "filtrado por session_id") queda corregido a "best-effort substring grep" para reflejar que `/logs` no tiene `session_id`.

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 39-01-PLAN.md — Capa datos/derive: fetchComments+fetchLogs never-throws (404 discriminable) + grepLogs substring puro + fix doc /logs D-08 (SC#4) (TUI-15/TUI-16)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 39-02-PLAN.md — Overlay UI: mode:'overlay' en App.js (c/l/Esc/scroll, snapshot congelado D-05) + chrome en SessionTable.js (header+body+footer+etiqueta honesta D-04) (SC#1/SC#2/SC#3)

**UI hint**: yes

## Archived Milestones

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
| 38. Paneles auxiliares — comentarios + logs | v0.9 | 4/4 | Complete    | 2026-06-01 |

---
*Last updated: 2026-05-28 — Phase 37 planned (3 plans, 3 waves: focus.js never-throws fundament → App.js+SessionTable.js UX → runDashboard wiring + UAT). 2/2 requirements TUI-13..14 cubiertas. Revisado post-C-01 (cmux select-workspace fire-and-forget, NO TTY handoff). Next: /gsd-execute-phase 37.*
