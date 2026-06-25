# Milestones

## v0.13 kodo bidireccional (Shipped: 2026-06-25)

**Phases completed:** 11 phases, 17 plans, 19 tasks

**Key accomplishments:**

- `KODO_LABEL_ADOPTED` + `isAdopted` helper in labels.js plus a load-bearing `isAdopted(task.labels)` early cut in the dispatcher that drops `kodo:adopted` tasks with `{action:'ignored', code:'adopted'}` before lock/resolver/launch, surviving `--force`.
- `createTask` delivered as a typeof-detected optional method on the Plane adapter (outside the FROZEN-9): an authenticated `POST .../work-items/` in the configured trigger state, stamped with the `kodo:adopted` marker (label-UUID lookup-or-create), with the 201 normalized back to a shape-identical canonical `TaskItem` via the existing `normalizeWorkItem` + full 6-field context.
- `createTask` delivered as a typeof-detected optional method on the GitHub adapter (outside the FROZEN-9): an authenticated `POST /repos/{o}/{r}/issues` (title required, body Markdown) that stamps the `kodo:adopted` marker as a plain string at create and normalizes the 201 back to a shape-identical canonical `TaskItem` via the existing `normalizeIssue` — plus the capability-gated contract-matrix `it()` (mirror of B8) that round-trips a mocked 201 for BOTH providers, closing BIDIR-01 + BIDIR-02, and the FROZEN-9 negative-assert locking `createTask` out of `TASK_PROVIDER_METHODS`.
- 1. [Rule 1 - Bug] Absolute-path regex over-redacted the home-relative tail
- 1. [Aclaración] `grep -c "logger.js" src/host/cmux.js` devuelve 1, no 0
- 1. [Rule 3 - Blocking] `projects` source for resolveProjectId was under-specified
- FIX A — `src/adopt.js`:
- `skill.md`:
- 1. Plane client (`src/providers/plane/client.js`)
- kodo ahora escucha `SessionEnd`: el cleanup terminal destructivo (removeSession + worktree + promptFile) ocurre UNA vez al cierre real de la sesión (`/exit`), mientras `Stop` (per-turn) queda solo para el estado ligero (idle/lock/color/nudge). Una sesión cerrada desaparece del dashboard en vez de quedar colgada como `dead`.
- `kodo adopt` ahora renombra el workspace de cmux a `"<task_ref>: <título>"` justo después de crear la tarea, de modo que el check EXISTENTE `reconcile.liveForSession`/`titleIdentifiesSession` reconoce la sesión adoptada como viva (running/idle/needs-input) en vez de dead/zombie — exactamente como las sesiones lanzadas por kodo (p.ej. ROMAN-189).
- Una tarea adoptada ahora acaba con información real: el orquestador deriva un título inteligente Y un resumen-descripción del contexto real, rellenando la tarea al adoptar (`kodo adopt --description`) o enriqueciéndola a posteriori con un comentario-resumen (`kodo comment` → `addComment`). El LLM vive solo en el orquestador (prosa); los consumidores CLI son deterministas 0-token.
- Una sesión GSD adoptada ahora muestra su `N/M` en el dashboard igual que una lanzada. El gate del progreso pasó de "flag `gsd`" a "STATE.md GSD legible en el path resuelto" (dinámico), el lector resuelve el path con fallback worktree→project_path, y la adopción marca `gsd`/`gsd_mode` para las columnas phase/mode.
- `runAdopt` inserta el par `--description <d>` en el argv como espejo literal de `--title` — implementa el carril shell de ORCH-02 SC#4 (cuerpo at-adopt derivado por Haiku, injection-inerte vía execFile sin shell)
- El estado `mode==='deriving'` se interpone entre el armado de la tecla `a` y el confirm: arma la surface, espera `onDerive` (deriveAdoptionMeta, Plan 01) fail-open a `{}`, fusiona `{title, description}` en `armedSurface`, muestra la propuesta en el confirm (`título:/desc:` o degradado), y cablea `onDerive`/`onAdopt(description)` en index.js — cierra ORCH-02 end-to-end (UX derive-then-confirm + carril shell `kodo adopt --title --description`).

---

## v0.12 Atajos al gestor y progreso vivo (Shipped: 2026-06-15)

**Phases:** 5 phases (48, 49, 50, 50.1 insertada, 51), 10 plans, 10 tasks
**Stats:** 90 commits · 87 files (+10.993 / −1.274) · timeline 2026-06-11 → 2026-06-15 (4 días) · suite 1307 pass + 1 skip + 0 fail
**Git range:** feat(48-01) → feat(50.1-02)

**Delivered:** El dashboard se profundiza en dos direcciones desde la fila de sesión — *hacia afuera* (abrir la tarea en Plane/GitHub con una tecla) y *hacia adentro* (mostrar el progreso vivo `N/M` de cada sesión GSD), todo sin añadir un solo endpoint al server.

**Key accomplishments:**

- **Open-in-manager (Phase 48):** la tecla `o` sobre una fila con `task_url` abre la tarea (Plane/GitHub) en el navegador vía `runOpen` (`execFile` never-throws + allowlist `http(s)` con `new URL()` antes de exec + argv literal anti flag-injection); no-op legacy con footer `no task URL for this session`. Incluye el fix del bug latente de browse-URL de Plane: `plane.web_url ?? base_url` cableado end-to-end (registry → provider → ambos context builders → normalizer), link web vivo en deploys split self-hosted, supresión de `UNKNOWN-<seq>` muerto. Cerrado por HUMAN-UAT en macOS real (5/5).
- **Live-progress spike — HARD GATE (Phase 49):** veredicto empírico **VIABLE** sobre Claude Code 2.1.175 — el progreso N/M de una sesión es capturable vía hook `TaskCreated`/`TaskCompleted` (payload con `session_id`), correlacionable a `task_id` vía el `findSession` existente. Gate abierto a Phase 50.
- **Live-progress display (Phase 50 + corrección 50.1):** columna condicional `prog` en el dashboard que muestra `N/M` (= `completed_phases`/`total_phases`) por sesión GSD, enrich client-side, cero endpoints nuevos, keep-last-good por `session_id`. La fuente inicial de Phase 50 (hook propio + `~/.claude/tasks/`) resultó vacía en sesiones GSD reales que usan `Agent`, y fue reemplazada en Phase 50.1 por la lectura del bloque `progress:` del `STATE.md` del worktree real (`readGsdProgress` + `computeRealWorktreePath`); el hook 50-02 quedó demotado.
- **Backfill Nyquist v0.11 (Phase 51):** los 3 `VALIDATION.md` draft de las Phases 44/45/46 togglados in-place a citation-based (`nyquist_compliant: true`) citando su evidencia VERIFICATION/HUMAN-UAT sin re-ejecutar la suite, + STATE.md Deferred Items reconciliado — Tier 1 doc-only, `git diff src/ test/ bin/` vacío.

**Invariantes preservadas:** cero endpoints nuevos en `src/server.js`, contrato `TaskProvider` FROZEN en 9 (la URL va como campo de `TaskItem`, no método nuevo), color isolation, TUI never-throws, selección por identidad `task_id`, `execFile` fire-and-forget sin desmontar el panel.

**Known deferred items at close: 2** (ver STATE.md `## Deferred Items`)

- HUMAN-UAT de Phase 50.1 (3 escenarios) + `50.1-VERIFICATION.md` (`human_needed`, 8/8 must-haves auto-verificados): el display de progreso vivo requiere verificación visual en un TTY real con una sesión GSD viva, no montable en el momento del cierre. Diferido sin penalización — espejo de cómo v0.9/v0.10/v0.11 cerraron con deuda reconocida.

---

## v0.11 Ventana al plan (Shipped: 2026-06-10)

**Phases completed:** 4 phases, 5 plans, 6 tasks

**Key accomplishments:**

- A pure React-free `deriveAnyGsd(rows)` computed over the unfiltered `sorted` set that conditionally drops the `phase/mode` column (header + every data cell) when no active session is GSD, plus an additive per-row `(zombie)` mark in the `state` cell whose red is read from the existing `statusColor` — zero new color, zero picocolors, zero RegExp, COLS.state widened 16→18.
- buildSessionContext (ES) y la rama quick de buildGsdContext (EN) inyectan una instrucción de una línea que dirige a la sesión a escribir un plan corto en `~/.kodo/plans/<task_id>.md` (ruta resuelta vía KODO_DIR), preservando golden-bytes y la D-04 common-block invariance.
- Task 1 — NYQ-01 (v0.10, 2 NEW):

---

## v0.10 Higiene y estado real de sesiones (Shipped: 2026-06-08)

**Phases completed:** 4 phases (40-43), 10 plans · 118 commits desde v0.9 · suite 1213 pass + 1 skip
**Audit:** `tech_debt` — 14/14 requirements, integración cross-phase 14/14, 3/3 flujos E2E verificados (deuda Nyquist en 41/43, sin blockers).

**Key accomplishments:**

- **Cadena `provider_state` end-to-end (cierra el driver ROMAN-150):** `getTaskState` opcional en Plane (state vivo vía `getWorkItem`) y GitHub (convención de labels), vocabulario normalizado `in_progress|in_review|blocked|done|unknown` con assert capability-gated en la contract matrix (`TASK_PROVIDER_METHODS` sigue FROZEN en 9); `GET /status` enriquece cada fila con un resolver puro DI (cache 30s + dedup in-flight + `Promise.allSettled` fail-open por fila), carril read-only que jamás escribe `state.json` ni se acopla a `alive`.
- **`kodo gsd doctor`:** módulo puro de saneo (`src/gsd/doctor.js`) que detecta y sanea worktrees huérfanos, sesiones zombie, locks colgados y logs viejos — dry-run por defecto, `--fix` re-checa liveness y usa `git worktree remove/prune` (nunca `rm -rf`), exit code 0/1, reusable por el CLI y por el dismiss.
- **Dismiss TUI read-write (primera ruptura consciente del invariante "TUI read-only", UAT humano firmado):** tecla `d` sobre sesiones dead → `DELETE /sessions/{id}` reusando `doctor.execute`, doble-`d`/`Esc` por `task_id`, guard `alive` server-side (409 TOCTOU), capa client never-throws.
- **Render + filtro de `provider_state`:** columna dedicada `task` con los 3 reason-states sin color (valor crudo / `—` unsupported / `?` fetch-failed), separada del status v3; prefijo de filtro `ps:` con `String.includes` anti-ReDoS, eje independiente del `s:`.
- **3 bugs reales arreglados en dogfooding (con verificación en vivo):** provider_state mostraba `unknown` (la API de Plane no puebla `state_detail` → resolver vía definiciones cacheadas, `53d2220`); divergencia `state`/`status` → columna `status` redefinida a outcome (`91df2b8`); reciclado de `workspace_ref` de cmux producía sesiones fantasma `alive` → reconcile defensivo por identidad+`task_id` (`9b090cd`).

---

## v0.9 kodo TUI — sesiones en vivo (Shipped: 2026-06-03)

**Delivered:** kodo gana una superficie de observabilidad ambient en terminal — el subcomando `kodo dashboard` (Node + ink, sin build step) que monitoriza en vivo las N sesiones kodo activas consumiendo exclusivamente el contrato JSON existente del server (`GET /status`, `/comments/<task_id>`, `/logs`), sin añadir un solo endpoint. Tabla viva por polling con selección por identidad, navegación + focus a cmux, overlays de comentarios y logs, y un modelo de ciclo de vida v3 (idle/needs-input/dead/closed) promovido desde backlog tras diagnosticar sesiones invisibles en el dashboard. Cierra con una fase de gap-closure (39.1) que saldó el blocker + 3 warnings del audit.

**Phases completed:** 7 phases (34-39 + cierre 39.1), 23 plans
**Git range:** `e6ae74f` (2026-05-27) → `fa981fe` (2026-06-03) — 9 días, 202 commits (42 feat/fix)
**LOC:** +29,871 / -1,248 (163 files changed)
**Requirements:** 16/16 satisfied (TUI-01..16) + TUI-17 (audit cleanup, cerrado por eliminación)
**Suite:** 1073 pass + 1 skip + 0 fail (915 baseline tras Phase 35 → +158 netos)
**Audit:** `tech_debt` (re-audit 2026-06-03; sin blockers, 16/16 requirements, 47/47 exports wired, 5/5 flujos E2E; deuda Nyquist parcial/ausente en 5/7 fases + 2 warnings de código diferidos conscientemente — ver STATE.md Deferred Items)

**Key accomplishments:**

- **TUI Fundación + Datos resilientes (Phases 34-35)** — subcomando `kodo dashboard` registrado en `src/cli.js` (ink@6 + react@19 + `React.createElement` plano, lazy import para arranque ligero): guard non-TTY pre-render (exit 1 limpio ANTES de `render()`), ciclo de vida intacto (q→`useApp().exit()`, SIGTERM→`unmount()`, Ctrl-C, terminal restaurada), color-isolation extendida a `src/cli/dashboard/` (cero picocolors). Capa de datos `fetchStatus` puro **never-throws** (`{ok:false, error}` colapsa ECONNREFUSED/HTTP-no-ok/JSON-corrupto — ningún throw llega a React) + hook `usePoll`/`runPollLoop` self-scheduling con `setTimeout` recursivo (jamás `setInterval`), **single-flight** (re-arma el timer solo tras `await`), backoff 2.5→5→10s con reset al primer ok, timeout 5s vía `AbortController`, keep-last-good + 3 estados de degradación. TUI-01..06.
- **Tabla viva — render + selección + filtros (Phase 36)** — capa derive PURA React-free (`select.js`/`format.js`): `sortSessions` DESC estable por `started_at` (NaN→epoch determinista), `resolveSelection` por **identidad `task_id`** (sigue a la sesión al reordenar, clamp posicional al desaparecer la fila), `applyFilter`/`parseFilter` (`/` substring + `r:`/`s:` AND, `String.includes` nunca `RegExp` — anti-ReDoS), `countByStatus`. Render ink columnar con color semántico (running+alive=green, zombie `running`+`!alive`=red+`(zombie)`, review=cyan…), header live + contadores, dos estados vacíos. Interacción `useInput` mode-gated. Code review encontró 1 BLOCKER (cursor perdía identidad al ocultar toda la lista por filtro → violaba TUI-12) corregido con test de regresión antes de cerrar. TUI-07..12.
- **Focus a workspace cmux (Phase 37, mayor riesgo · UAT manual obligatorio)** — Enter sobre fila `alive===true` ejecuta `cmux select-workspace --workspace <ref>` fire-and-forget (~50ms vía `execFile`); guard inverso rechaza `alive===false` con footer-error y NO invoca cmux; ENOENT / exit≠0 se muestran en el footer y el panel **permanece montado** (cero unmount, cero alt-screen toggle). `runDashboard` extendido con DI mínima (4 cambios literales) sin tocar el lifecycle de 34/36. Cerrado vía `37-UAT.md` + `37-HUMAN-UAT.md` (2 escenarios obligatorios passed). TUI-13, TUI-14.
- **WorkspaceHost provider + ciclo de vida v3 (Phase 38, promovido desde backlog 999.2)** — provider de host intercambiable (cmux/orca/…) + estados `idle`/`needs-input`/`dead`/`closed` + migración `state.json` v2→v3 + `reconcileTick` como único escritor de `alive`. Trigger: diagnóstico ROMAN-151/152 — sesiones `Needs input` visibles en la GUI cmux pero archivadas `done` en `state.history`, invisibles en el dashboard. `38-HUMAN-UAT.md` passed (firmado por alex 2026-06-01: 2 escenarios en vivo + 2 via-tests).
- **Paneles auxiliares — comentarios + logs (Phase 39)** — dos overlays a pantalla completa sobre la fila seleccionada como tercer `mode:'overlay'` del useInput mode-gated: `c` (comentarios por `task_id` vía `GET /comments`, copy distinta por 404/vacío/error) y `l` (logs por `grepLogs` substring OR anti-ReDoS sobre el buffer compartido de `/logs`, etiquetado honestamente como no-per-session), con snapshot congelado bajo el poll vivo y `Esc` que preserva el cursor. TUI-15, TUI-16.
- **Cierre de gaps v0.9 (Phase 39.1)** — saldó la deuda del audit antes de archivar: **TUI-17** (blocker) eliminación del wiring host muerto (`grep host/hostError/HOST_ERR_*` → 0), **TUI-13/14** fuente única de `alive` (override legacy fuera de `GET /status`, `grep workspaceList` → 0), **TUI-10** `statusColor(status, alive, state)` v3-aware reusando `STATE_BADGES`, **TUI-15** overlay distingue "provider sin soporte" de "sin comentarios" vía campo aditivo byte-compatible `supported`, y reconciliación de bookkeeping en REQUIREMENTS.md. VERIFICATION 14/14 must-haves; suite 1073 pass.

**Known deferred items at close:** deuda Nyquist (VALIDATION.md parcial en 36/37, ausente en 38/39/39.1) + ausencia de VERIFICATION.md formal en 37/38 (cerradas vía UAT/HUMAN-UAT) + ciclo de import App.js↔SessionTable.js (runtime-resolved) + divergencia D-09 en la web UI legacy (cero impacto en TUI). Detalle en STATE.md `## Deferred Items` y `milestones/v0.9-MILESTONE-AUDIT.md`.

---

## v0.8 Consolidación + GSD Provider Reporting (Shipped: 2026-05-25)

**Delivered:** v0.8 consolida la promesa arquitectónica de kodo cerrando el tech debt de v0.7 (POLL provider-only path + DAEMON observabilidad), integrando la cadena de reporting GSD → proveedor (opt-in, anti-recursión blindada) reutilizando una rama paralela vía cherry-pick selectivo + planning regen, resolviendo bugs reales de lifecycle SessionRecord (desync state.json ↔ cmux confirmado por ROMAN-132), y limpiando el advisory follow-up de Phases 21/22. Cierra con dos phases de bookkeeping (v0.7 + v0.8) que reconcilian doc-drift y nyquist coverage. Cero adapters nuevos — tema "consolidación" preservado.

**Phases completed:** 6 phases (28-33), 20 plans
**Git range:** `36a68b7` (2026-05-15) → `b5c9859` (2026-05-25) — 10 días, 152 commits (23 feat/fix)
**LOC:** +21,462 / -169 (123 files changed)
**Requirements:** 17/17 satisfied (POLL-FIX-01, DAEMON-01/02, REPORT-01..06, LIFE-01/02, ADVISORY-01..03, BOOK-01..03)
**Suite:** 895 pass + 1 skip + 0 fail (777 baseline v0.7 → +118 netos)
**Audit:** PASSED (re-auditado 2026-05-25 tras Phase 33; verdict original TECH_DEBT → cerrado)

**Key accomplishments:**

- **Polling/Daemon Hardening (Phase 28)** — TaskItem canónico extendido 11 → 13 fields (`updated_at` + `created_at` REQUIRED), normalizers GitHub/Plane simétricos y contract matrix Phase 27 a 18 asserts; `shouldDispatch` opera sobre timestamps reales en el provider-only path (cierra D-18 leak guard de Phase 25). `kodo polling start --verbose` emite stdout estructurado por tick (evento `polling.tick.summary`, taxonomy 18 → 19). Módulo `polling-logfile.js` redirige el daemon a `~/.kodo/logs/polling-YYYY-MM-DD.log` (chmod 0o600 + retención diaria 7 días), cerrando T-26-DIAG silent crash. POLL-FIX-01, DAEMON-01, DAEMON-02.
- **GSD Provider Reporting Integration (Phase 29)** — cherry-pick selectivo de los 9 SHAs de la rama `gsd-provider-reporting` + 38 tests heredados + planning regen con numeración v0.8. Anti-recursión `kodo:gsd-child` cortada ANTES de `parseKodoLabels` / lock / resolver / launch (ni `--force` recursa); opt-in `workflow.report_to_provider` con strict `=== true` (DEFAULT_CONFIG anti-mutation); `applyReportingGate(prompt, enabled)` pure idempotente entre marcadores `<!-- BEGIN/END reporting -->`; prosa ES provider-agnostic (`{{provider_name}}`) en `prompt.md`; `KODO_LABEL_GSD_CHILD` + `isGsdChild` con source-hygiene anti-inline. REPORT-01..06.
- **SessionRecord Lifecycle (Phase 30)** — `findSession` escanea `state.sessions` (activas) + `state.history` (terminadas) con tagged return `{id, session, source}`, resolviendo el desync state.json ↔ cmux que ROMAN-132 confirmó empíricamente (cierra CR-01 Phase 19). `markSessionStatus` refactor: falsy guard observable + discriminated union return `{ok, reason}` (cierra WR-07 Phase 22). HUMAN-UAT 2/2. LIFE-01, LIFE-02.
- **Phase 21/22 Advisory Cleanup (Phase 31)** — pureza `syncSkill({onConsoleWarn})` callback DI (defaults a `console.warn`, tests sin spy global); `runSkillSyncCli` await `cleanupFn()` ANTES de `process.exit(N)` (exit ordering verificable); test `launchOrchestrator` con spawn REAL (no mockSpawn) + observables post-launch (state.json muta + NDJSON `session.start` con `transcript_path`). ADVISORY-01, ADVISORY-02, ADVISORY-03.
- **v0.7 Bookkeeping Doc-Only (Phase 32)** — traceability `v0.7-REQUIREMENTS.md` a 16/16 Complete (GH-01..05, CFG-01/02, TEST-01); backfill `VERIFICATION.md` Phase 23 por uniformidad documental; toggle `nyquist_compliant: true` en VALIDATION.md de phases 23/25/26/27. Tier 1 doc-only invariant respetado (`git diff -- src/ test/ bin/` vacío). BOOK-01, BOOK-02, BOOK-03.
- **v0.8 Bookkeeping & Nyquist Backfill + Surgical Fix (Phase 33)** — cierre de los ~14 items de tech debt del audit v0.8 en 3 bloques paralelos: **A** doc-drift (9 REQ-IDs Pending → Complete en REQUIREMENTS.md, 5 SUMMARYs reconciliados, fix copy-paste sección Phase 32 en ROADMAP); **B** 3 VALIDATION.md backfill citation-based (28/30/31) `nyquist_compliant: true` + NYQ-32-NA, elevando sign-off de 1/5 a 4/5 compliant + 1/5 N/A sin re-ejecutar la suite; **C** surgical fix LIFE-02-FOLLOWUP — los 2 callers de `markSessionStatus` (`verify.js#finalize` rama pass + `stop.js#runStopHook`) consumen el return discriminado `{ok, reason}` y emiten `log.warn('markSessionStatus.skipped', {reason, session_id})` dentro de los try existentes, haciendo observable el drift `missing-task-id` sin cambiar el comportamiento E2E.

---

## v0.5 CLI Polish & v0.3 Debt Cleanup (Shipped: 2026-05-11)

**Delivered:** El CLI de kodo pasa de output mono a TTY-aware con colores semánticos y columnas alineadas (helper `src/cli/format.js` + `picocolors`), preservando `--json` byte-deterministic y el guard LOG-12 sobre `kodo check`. En paralelo se cierra la deuda v0.3 (EVENTS migration + `markSessionStatus` real en runtime) y se automatizan los 3 UATs humanos de Phase 7 como integration tests. Cierra con la migración del skill `kodo-orchestrate` al repo como source canonical provider-agnostic.

**Phases completed:** 5 phases (14-17 + 999.1), 21 plans
**Git range:** `23533ce` (2026-05-04) → `1f89dd2` (2026-05-11) — 8 días, 128 commits
**LOC:** +21,327 / -364 (111 files changed; src+test = 16,355 LOC actual)
**Requirements:** 13/13 satisfied (DX-01..07, LOG-13..15, UAT-01..03)

**Key accomplishments:**

- **CLI Format Foundation (Phase 14)** — `src/cli/format.js` factory pure devuelve un object literal de bound methods (debug/info/warn/error/ok/fail + colores + `formatRow`/`formatTable`/`visibleWidth`), con precedencia `NO_COLOR > FORCE_COLOR > stream.isTTY` (D-02, eager). `picocolors@^1.1.1` añadido como única fuente de ANSI; LOG-12 extension walker en `test/format-isolation.test.js` bloquea regresión hacia `src/logger.js`. Golden bytes contract: `useColor=false → zero ANSI` (base de `--json` determinismo). DX-06, DX-07.
- **CLI Polish Wiring (Phase 15)** — `kodo logs` (logger.js#formatLine dual shape + reader.js `_resolveUseColor`), `kodo check` (ANSI inline eliminado, fmt.* via formatterFn DI), `kodo gsd inspect` (renderHuman 4 secciones config/fetch/roadmap/match + `Exit: N` visible), `kodo gsd verify` (color mapping pass/soft-fail/hard-fail + `plane.comment_body` slice). `--json` bypasea el helper (early-return). DX-01..05.
- **LOG-09 Debt Cleanup (Phase 16)** — `dispatcher.js` migra los 4 literales runtime a `EVENTS.GSD_PHASE_RESOLVED`/`EVENTS.GSD_BOOTSTRAP` + comment-aware grep test. `verify.js` invoca `markSessionStatus` en la rama `pass` tras `updateTaskState` OK (6 asserts negative cubren soft-fail/hard-fail/errors). `stop.js` invoca `markSessionStatus` PRE-release dentro de `if (session.gsd)` (D-08 emit-before-mutation), con 3 escenarios test full/quick/no-GSD. LOG-13, LOG-14, LOG-15.
- **Phase 7 UAT Automation (Phase 17)** — los 3 UATs humanos pendientes de v0.3 convertidos en integration tests: `test/logs-follow-integration.test.js` (subprocess + 3 batches progresivos + SIGINT cleanup), `test/session-start-event.test.js` (spawn hook + `state.json` sintético + 6 keys D-10 + fail-loud), `test/session-of-resolver.test.js` (4 escenarios E2E con exit codes deterministas observados). `07-HUMAN-UAT.md` redirect a status: superseded. UAT-01, UAT-02, UAT-03.
- **Skill kodo-orchestrate al repo (Phase 999.1)** — `.claude/skills/kodo-orchestrate/skill.md` provider-agnostic v0.5 como source canonical (3 tags GSD literales, 4 flujos diagnóstico CLI con exit codes, mapping vía `~/.kodo/projects.json`, mecanismo auto-update preservado). `src/orchestrator/prompt.md` reducido de ~90 → 37 líneas como fallback degradado con 3 placeholders intactos y cross-ref a la skill. `src/hooks/stop.js` con `KODO_ROOT` env override + `SKILL_PATH`/git apuntando a `.claude/skills/` (fix D-14), JSDoc actualizado (D-15). `test/skill-auto-commit.test.js` cubre D-16 (2 escenarios spawnSync). PROJECT.md captura D-05/D-06 (cwd=repo para skill auto-load) + SKILL-01 deferred a v0.6. Skill global eliminado manualmente (checkpoint humano D-04).

**Tech debt aceptada (no bloqueante):**

- Phase 14 — `test/version-smoke.test.js` spawnSync sin timeout explícito (WR-01); regex ANSI defensiva pendiente (IN-01); caso `FORCE_COLOR=''` sin test explícito (IN-02 cosmético).
- Phase 15 — `src/check.js` 127 LOC vs threshold 130 (2.3% bajo, contrato funcional cumplido); `src/gsd/verify.js` 402 vs 405; `ANSI_*` exports retenidos en `src/logger.js` para back-compat (decisión explícita).
- Phase 16 — 8 WR + 4 IN documentados en `16-REVIEW.md` Resolution Log, aplazados por decisión explícita (doble logger en stop.js, eager EVENTS + dynamic helpers en dispatcher.js, etc.).
- Phase 14 — `SECURITY.md` ausente (low-risk, presentation-only); `/gsd-secure-phase 14` opcional para auditar threats_open: 0 explícito.

---

## v0.4 GSD Quick Mode (Shipped: 2026-04-29)

**Phases completed:** 3 phases, 11 plans, 11 tasks

**Key accomplishments:**

- buildStopNudgeText refactorizado a switch exhaustivo sobre getSessionMode(session) — sesiones quick reciben "revisión manual" en lugar de `kodo gsd verify`, sin tocar el lock release.
- Cobertura completa de getGsdMode (4 estados) y getSessionMode (4 estados de SessionRecord) en test/labels.test.js — 11 tests nuevos, todos passing, 0 regresiones en suite global (380/381).
- Cobertura completa de `gsd_mode` en `buildSessionFromTask` (4 estados behavior) más source-hygiene anti-inline anti-renombrado en `test/manager.test.js`. 5 tests nuevos (4 behavior + 1 source-hygiene), todos passing al primer intento. 0 regresiones — suite global 385/386 (1 skip pre-existente).
- Cobertura behavior completa de las 3 ramas resolver-específicas del modo quick en `test/dispatcher.test.js`: (1) descarte de `phase_id` en match, (2) tolerancia + continúa al launch en no-match, (3) fail-closed + lock release en roadmap-missing. 3 tests nuevos, todos passing al primer intento. 0 regresiones en suite global (388/389 pass, 1 skip pre-existente).
- Cobertura behavior completa (7 tests) de la rama `mode === 'quick'` de `buildGsdContext` en `src/hooks/session-start.js` (líneas 96-121, Phase 12) más 2 invariants source-hygiene (Phase 13 D-09 anti-inline + D-10 anti-acceso directo) en `test/session-start.test.js`. 9 tests nuevos, todos passing al primer intento. 0 regresiones — suite global 397/398 (1 skip pre-existente).
- Cobertura behavior completa de los dos sitios complementarios que Phase 12 introdujo: (a) `buildStopNudgeText` switch exhaustivo de 3 cases en `src/hooks/stop.js` (5 tests), (b) `buildContextSummary` gsdTag mode-first en `src/orchestrator/launch.js` (6 tests con 3 etiquetas + caso defensivo Phase 12 D-11 + legacy Phase 11 D-08 + mix). Más 6 tests source-hygiene Phase 13 D-09/D-10/D-11 distribuidos entre ambos archivos. 17 tests nuevos (11 behavior + 6 source-hygiene), todos passing al primer intento. 0 regresiones — suite global 414/415 pass, 1 skip pre-existente.

---

## v0.3 GSD Integration + Structured Logging (Shipped: 2026-04-22)

**Delivered:** Un sistema completo para que tareas Plane etiquetadas `kodo:gsd` arranquen sesiones Claude bajo el workflow GSD — bootstrap automático de repos, resolver 1:1 título→fase, gate de verificación con comentarios Plane deterministas, y observabilidad NDJSON end-to-end.

**Phases completed:** 5 phases (6-10), 25 plans, 43 feat/fix commits
**Git range:** `2ecffd6` (2026-04-15) → `ceade7e` (2026-04-22) — 7 días
**LOC:** +2,620 src / +4,410 tests / +23,178 planning = +30,216 total
**Requirements:** 22/22 satisfied (GSD-01..10 + LOG-01..12)

**Key accomplishments:**

- **Structured logging foundation (Phase 6)** — `src/logger.js` factory con NDJSON per-session, 4 niveles + `KODO_LOG_LEVEL`, redactor deep-walk de secretos (JWT/bearer/API keys), pretty-print stderr sin duplicar JSON, y vigilante `kodo check` aislado del logger (LOG-01..04, LOG-08, LOG-12)
- **`kodo logs` CLI + event taxonomy (Phase 7)** — subcomando con filtros `--level` / `--component` / `--event-type`, `--follow` tail via fs.watchFile, resolver `--session-of <plane-task-id>` two-step (state.json → head-line scan), y 7 tipos de evento tipados (session.start/end, state.transition, orchestrator.review, gsd.phase.resolved, gsd.bootstrap, plane.api.call) con helpers + DI logger cableado en 7 consumers (LOG-05..07, LOG-09..11)
- **GSD label plumbing + per-repo lock (Phase 8)** — flag `kodo:gsd` propagado desde dispatcher hasta `Session.gsd`, per-repo file lock con PID liveness + TTL, `buildGsdContext` inyecta `/gsd-plan-phase → /gsd-execute-phase → /gsd-verify-work` al arrancar sesión, y stop hook libera el lock (GSD-01, GSD-04, GSD-10)
- **Phase resolver + bootstrap (Phase 9)** — `src/gsd/roadmap.js` parser (accept `##`/`###` + decimales, reject rangos), `src/gsd/resolver.js` con discriminated union `PhaseVerdict | BootstrapVerdict | ErrorVerdict`, match 1:1 título Plane→heading, brief extraído de `task.description_markdown`, y `kodo gsd inspect <task-id>` CLI dry-run forense (GSD-02, GSD-03, GSD-08, GSD-09)
- **Orchestrator verification gate (Phase 10)** — `src/gsd/verification.js` parser + verdict discriminado pass/soft-fail/hard-fail (zero deps, prototype-pollution defense), `src/gsd/verify.js` orquestación con comentario Plane determinista en español + transición condicional a Review + evento `orchestrator.review`, `kodo gsd verify <session-id>` CLI handler con exit codes deterministas, y integración en prompt/launch/stop del orquestador (GSD-05, GSD-06, GSD-07)
- **Post-audit cleanup (Phase 10 tail)** — añadido `plane.api.call.failed` al catálogo EVENTS (8º tipo) + helper `planeApiCallFailed`, cableado en `verify.js`, y distinguidos EACCES/EMFILE de ENOENT en discovery de VERIFICATION.md (WR-01, WR-02, WR-03 del code review)
- **UAT debt closure (Phase 17, v0.5 milestone)** — los 3 UATs humanos pendientes de Phase 7 (live `--follow` tail, `session.start` con campos D-10, `--session-of` E2E) se automatizaron en `test/logs-follow-integration.test.js`, `test/session-start-event.test.js`, `test/session-of-resolver.test.js`. Cobertura equivalente sin coste humano recurrente. Ver `.planning/phases/17-phase-7-uat-automation/`.

**Known deferred items (accepted as tech debt):**

- INT-MED-01 — `dispatcher.js` usa literales `'gsd.phase.resolved'` y `'gsd.bootstrap'` en vez de `EVENTS.*` (diferido Phase 9, sin impacto runtime)
- INT-LOW-01 — `markSessionStatus` exportado pero sin callsites de producción → `state.transition` nunca se emite (diferido Phase 7 D-06)
- INT-LOW-02 — 07-01-SUMMARY doc-only mismatch `plane_task_id` vs `task_id` en código
- Nyquist validation drafts en Phases 6-8; missing en 9-10 (no bloqueante, aplicar batch retroactivo si procede)
- GSD-07 es instruction-driven via prompt.md (no programmatic pre-load) — diseño intencional

---

## v0.2 Provider Abstraction (Shipped: 2026-04-13)

**Phases completed:** 5 phases, 10 plans, 0 tasks

**Key accomplishments:**

- TaskProvider interface (9 methods) with canonical TaskItem/TriggerEvent shapes — any adapter just implements the contract
- PlaneProvider adapter with normalizer, HMAC-SHA256 verification, and label resolution behind the interface
- Provider registry with factory functions, lazy init, and singleton caching
- All 4 internal consumers (check, stop, manager, session-start) rewired to TaskProvider — zero PlaneClient imports outside adapter
- Central dispatchTrigger + pure handleWebhookRequest extracted from server.js — server is now a slim HTTP shell
- Provider-agnostic config wizard, ensureConfig guard, and orchestrator prompt with {{provider}} placeholders
- 122 tests, 4,650 LOC JavaScript (1,868 LOC tests), 28/28 requirements satisfied

---
