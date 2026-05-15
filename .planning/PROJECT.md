# kodo

## What This Is

kodo es un bridge entre sistemas de gestión de tareas y sesiones de Claude Code via cmux. La arquitectura es provider-agnostic: cualquier sistema de tareas (Plane, GitHub Issues, ClickUp, local) se integra implementando la interfaz `TaskProvider` de 9 métodos. Plane CE es el primer adaptador implementado y validado. Desde v0.3, kodo orquesta sesiones Claude bajo el workflow GSD (1 tarea Plane = 1 fase GSD) con bootstrap automático, gate de verificación contra `VERIFICATION.md`, y observabilidad NDJSON end-to-end. Desde v0.4, una segunda label `kodo:gsd-quick` arranca sesiones one-shot sin plan/execute/verify, con el mismo lock + skip-permissions y orchestrator que las distingue.

## Core Value

Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. El mismo sistema dispara dos modos GSD: full (`kodo:gsd`, multi-fase con verify) y quick (`kodo:gsd-quick`, one-shot), sin acoplar el código GSD al proveedor.

## Current State

**Shipped:** v0.7 (2026-05-14) — GitHub Issues Adapter

v0.7 entrega GitHub Issues como segundo adapter funcional del contrato `TaskProvider` y valida empíricamente la promesa arquitectónica de v0.2 ("cambiar de provider no requiere reescribir lógica"). Cuatro capas: (1) `GitHubClient` (`src/providers/github/client.js`) — REST wrapper contra `api.github.com` con auth PAT (token leído de `~/.kodo/.env`, NUNCA escrito a `config.json`), rate-limit warn cuando `X-RateLimit-Remaining < 100`, etag/304 conditional fetch retornando envelope `{status, items, etag, rate_limit_remaining}`. (2) `createGitHubProvider` (`src/providers/github/provider.js`) + `normalizeIssue` (`normalize.js`) — los 9 métodos canónicos `TASK_PROVIDER_METHODS` con `init`/`parseTriggerEvent`/`verifySignature` no-op (polling-only en v0.7); registry factory `github` con singleton lazy + 9-method validation. (3) `startPolling` (`src/triggers/polling.js`) — tercer canal de trigger junto a webhook + manual CLI: loop async con `clock` injectable, state cache atómico (`~/.kodo/polling-state.json` tmp+rename + 304 preserva cursor), retry exponencial 2s/4s/8s + warn-and-continue fail-open, fire-and-forget dispatch delegando idempotencia al lock per-repo Phase 8 GSD-10, first-tick skip evita storm; CLI `kodo polling start/stop/status` con daemon (`spawn detached` + PID file `chmod 0o600` shape `{pid, started_at, repos}`) o `--no-daemon` foreground, exit codes deterministas 0/1/2/3, Windows guard refuse-with-guidance, `--json` byte-determinista DX-06, lazy import de `startPolling` solo en path real. (4) `kodo config` wizard reconoce `provider: github` con auto-detect del git remote (3 URL formats SSH/HTTPS/HTTPS.git); `kodo orchestrate --polling` flag integrado con `runOrchestratePollingSetup` DI helper y SIGINT cleanup orden estricto (handler→polling.start→launchOrchestrator); mutex implícito daemon ↔ orchestrator vía lock per-repo, documentado en `--help`. Cross-provider contract matrix (`test/providers/contract.test.js`) itera Plane + GitHub × 7 asserts core = 14 nuevos casos demostrando con código real que ambos adapters cumplen idéntico contrato. Invariantes preservadas: zero changes a `src/labels.js`/`src/triggers/dispatcher.js`/`src/interface.js`; closed NDJSON taxonomy 15 → 18 events (POLLING_TICK/DISPATCH/ERROR + GITHUB_API_CALL/FAILED); LOG-12 walker extendido (`provider.js`/`normalize.js`/`polling.js` filters); color isolation v0.5; cwd=repo Phase 999.1; HOOK-01 universal Phase 20 + worktree always-on Phase 18 heredados automáticamente por sesiones disparadas via polling. Suite global: 777 pass + 1 skip + 0 fail (+89 vs baseline v0.6).

## Current Milestone: v0.8 Consolidación + GSD Provider Reporting

**Goal:** Cerrar tech debt v0.7 (POLL provider-only path + DAEMON `--verbose` + bookkeeping doc-only), integrar la rama paralela `gsd-provider-reporting` con regeneración de planning, resolver bugs reales de lifecycle SessionRecord (CR-01 Phase 19 + WR-07 Phase 22), y limpiar advisory follow-up de Phases 21/22. Cero adapters nuevos.

**Target areas:**
- **Polling/Daemon hardening** — `normalizeIssue` incluye `updated_at`/`created_at` canónicos (cierra D-18 leak guard del Phase 25); `kodo polling start` gana `--verbose` flag + log file con rotación (cierra T-26-DIAG silent crash).
- **GSD Provider Reporting integration** — cherry-pick selectivo de 9 commits de la rama `gsd-provider-reporting` (`KODO_LABEL_GSD_CHILD`, anti-recursión en dispatcher, `isReportToProviderEnabled` opt-in, `applyReportingGate` + prosa ES en `prompt.md`) + regeneración manual de planning v0.8. 38 tests heredados.
- **SessionRecord lifecycle** — CR-01 Phase 19 (`findSession` debe escanear `state.history`, no solo activas) + WR-07 Phase 22 (`markSessionStatus` early-return refactor estructural). Memoria reciente: ROMAN-132 2026-05-15 confirma state.json desync real (sesión viva en cmux mientras `state.json` reporta sessions={}).
- **Phase 21/22 advisory follow-up** — pureza `syncSkill` (console.warn → callback inyectable), `runSkillSyncCli` async cleanup correcto, test `launchOrchestrator` real.
- **Bookkeeping doc-only** — 8 IDs `pending` → `Complete` en v0.7 REQUIREMENTS traceability; backfill `VERIFICATION.md` Phase 23; toggle `nyquist_compliant` en phases 23/25/26/27.

**Out of v0.8 scope (deferidos a v0.9+):**
- Adapters TaskProvider adicionales: ClickUp, local (JSON/Markdown) + file watcher trigger.
- Webhook GitHub ingress real-time, GitHub Enterprise self-hosted (`base_url`), OAuth GitHub App.
- `kodo gsd doctor` (limpieza zombies worktrees/sesiones legacy).

## Requirements

### Validated

- ✓ TaskProvider interface genérica con 9 métodos (init + 7 negocio + listProjects) — v0.2
- ✓ TaskItem/TriggerEvent shapes canónicas provider-agnostic — v0.2
- ✓ PlaneProvider adaptador completo (normalizer, HMAC, labels) — v0.2
- ✓ Provider registry con factory functions y singleton caching — v0.2
- ✓ Todos los consumidores internos rewired a TaskProvider — v0.2
- ✓ Server como HTTP shell delegando a handleWebhookRequest — v0.2
- ✓ dispatchTrigger centralizado para webhook y CLI manual — v0.2
- ✓ Config wizard provider-agnostic con ensureConfig guard — v0.2
- ✓ Orchestrator prompt neutral con {{provider}} placeholders — v0.2
- ✓ State migration automática v1→v2 con schema_version — v0.2
- ✓ 122 tests cubriendo contratos, normalización, rewiring, triggers y config — v0.2
- ✓ Logger estructurado NDJSON con niveles (debug/info/warn/error) y redactor — v0.3 Phase 6 (LOG-01..04, LOG-08)
- ✓ `kodo check` aislado del logger (test-graph guard + startup-budget demoted por Decisión B) — v0.3 Phase 6 (LOG-12)
- ✓ `kodo logs` CLI con filtros (--level, --component, --event-type, --json, --follow, --session-of) — v0.3 Phase 7 (LOG-05..07, LOG-11; 3 manual UATs pendientes)
- ✓ Event taxonomy tipada (8 tipos: session.start/end, state.transition, orchestrator.review, gsd.phase.resolved, gsd.bootstrap, plane.api.call, plane.api.call.failed) — v0.3 Phase 7 + Phase 10 tail (LOG-09; `state.transition` sin callsites en producción — deferred Phase 7 D-06)
- ✓ Correlación con transcript de Claude Code vía `transcript_path` en `session.start` — v0.3 Phase 7 (LOG-10)
- ✓ Resolver `kodo logs --session-of <plane-task-id>` (two-step: state.json → head-line scan) — v0.3 Phase 7 (LOG-11)
- ✓ Label `kodo:gsd` reconocido en dispatcher y propagado hasta `Session.gsd` — v0.3 Phase 8 (GSD-01)
- ✓ `buildGsdContext` inyecta `/gsd-plan-phase N → /gsd-execute-phase N → /gsd-verify-work` en el prompt de la sesión — v0.3 Phase 8 (GSD-04)
- ✓ Per-repo file lock con PID liveness + TTL — dos tareas Plane sobre el mismo repo no lanzan sesiones concurrentes — v0.3 Phase 8 (GSD-10)
- ✓ Phase resolver + bootstrap: `resolvePhase` (discriminated union), detección `.planning/PROJECT.md`, match 1:1 por título contra ROADMAP.md, brief desde `task.description_markdown` — v0.3 Phase 9 (GSD-02, GSD-03, GSD-08, GSD-09)
- ✓ `kodo gsd inspect <task-id>` como dry-run forense del resolver (exit codes D-19: 0=ok, 1=config error, 2=fetch failure) — v0.3 Phase 9
- ✓ Dispatcher como fuente única para `gsd.phase.resolved` y `gsd.bootstrap` (pattern-mapper #3, invariante D-14) — v0.3 Phase 9
- ✓ Orchestrator verification gate: `verification.js` (parser YAML + verdict discriminado pass/soft-fail/hard-fail), `verify.js` (orquestación Plane comment + state transition condicional a pass + evento `orchestrator.review`), `kodo gsd verify <session-id>` CLI handler con exit codes deterministas (Pitfall #6 Opción A) — v0.3 Phase 10 (GSD-05, GSD-06)
- ✓ Orchestrator GSD integration: sección condicional `## Sesiones GSD` en `prompt.md`, `buildContextSummary` con tag `[GSD phase N]`, `stop.js` nudge mencionando `kodo gsd verify` (preservando idioma ES; `buildGsdContext` Phase 8 D-04 permanece en inglés) — v0.3 Phase 10 (GSD-07; artifact loading es instruction-driven, no pre-load programático)
- ✓ Label `kodo:gsd-quick` reconocida + `getGsdMode(flags)` con precedencia `gsd-quick > gsd` — v0.4 Phase 11 (QUICK-01)
- ✓ Resolver tolerance en modo quick: descarta `phase_id` cuando hay match (phase-agnostic), tolera `code: 'no-match'` (continúa al launch), `roadmap-missing` y `multi-match` siguen fail-closed — v0.4 Phase 11 (QUICK-02)
- ✓ `SessionRecord` persiste `gsd_mode: 'full'|'quick'` (aditivo, opcional, falsy → 'full' por compat v0.3) + lock acquisition compartido entre full y quick — v0.4 Phase 11 (QUICK-03)
- ✓ `kodo:gsd-quick` implica `--dangerously-skip-permissions` (parity con `kodo:gsd` desde commit `004995c`) — v0.4 Phase 11 (QUICK-04)
- ✓ SessionStart hook bifurca: `/gsd-quick "<title>"` para quick (one-shot), `/gsd-plan-phase → /gsd-execute-phase → /gsd-verify-work` para full — v0.4 Phase 12 (QUICK-05)
- ✓ Stop hook bifurca: nudge para quick pide revisión manual sin mencionar `kodo gsd verify`; lock se libera igual en ambos modos — v0.4 Phase 12 (QUICK-06)
- ✓ `buildContextSummary` del orchestrator emite 3 etiquetas distintas: `[GSD quick]`, `[GSD phase N]` (full match), `[GSD bootstrap]` (full sin match); sección `## Sesiones GSD` de `prompt.md` aclara que quick no se verifica — v0.4 Phase 12 (QUICK-07)
- ✓ Test coverage matrix QUICK-08: 4 estados de label × 7 sitios de la cadena (helper, manager, dispatcher, session-start, getSessionMode, stop switch, launch gsdTag) + invariants source-hygiene D-09/D-10/D-11 anti-inline anti-acceso-directo — v0.4 Phase 13 (44 tests añadidos, suite global 414/415 pass)
- ✓ Helper `src/cli/format.js` (factory `createFormatter(stream, env?)`) con eager useColor (`NO_COLOR > FORCE_COLOR > stream.isTTY`), level chips, ok/fail symbols, formatRow/formatTable strip-aware + `picocolors@^1.1.1` como 2ª dep prod, single-source D-07 blindado por `test/format-isolation.test.js` (LOG-12 extension + grep) y smoke `test/version-smoke.test.js` — v0.5 Phase 14 (DX-06, DX-07; 44 tests añadidos, suite 458/459 pass)
- ✓ Output del CLI con colores y formato mejorado (TTY-aware, `--json` byte-determinista): los 5 callsites cablean `src/cli/format.js` — `kodo logs` (logger.js shape dual NO_COLOR/TTY columnar `timestamp · level · component · message` + `_resolveUseColor` unificado en logger+reader), `kodo check` (3 ANSI inline → `fmt.yellow/red/ok` via `formatterFn` DI), `kodo gsd inspect` (4 secciones literales `config/fetch/roadmap/match` con `✓/✗` + línea final `Exit: N`), `kodo gsd verify` (verdict pass=green/soft=yellow/hard=red + `result.plane.comment_body` expuesto + summary slice 3 líneas sin re-render), single-source-of-color invariant cerrado por `test/format-isolation.test.js` extension (5 callsites importan `format.js` + 0 leak `picocolors`); LOG-12 verde, exit codes D-19/Pitfall #6 invariantes, bytes Plane comment idénticos por verdict — v0.5 Phase 15 (DX-01, DX-02, DX-03, DX-04, DX-05; suite 494 pass + 1 skip pre-existente)
- ✓ LOG-09 debt cleanup: `dispatcher.js` runtime literals `'gsd.phase.resolved'` migrados a `EVENTS.GSD_PHASE_RESOLVED` (import eager, comentarios D-14 históricos preservados, source-hygiene guard `test/dispatcher-isolation.test.js` con 3 asserts comment-aware), `markSessionStatus(taskId, 'review', 'gate-passed', log)` cableado en `verify.js#finalize` rama pass tras `addComment + updateTaskState` con try/catch silencioso que preserva D-17 (orchestratorReview en TODAS las ramas), `markSessionStatus(taskId, 'done', 'session-stop:lock-released', log)` cableado en `stop.js` ANTES de `releaseGsdLock` (D-08 emit BEFORE mutation, refactor light a `runStopHook(input, deps)` DI W-4 completa); 7 asserts NDJSON `state.transition` (1 SC#2 positive + 6 SC#3 negative B-1 enforced), 4 escenarios SC#5 stop-hook con tmpdir+HOME override (CR-02 fix) — v0.5 Phase 16 (LOG-13, LOG-14, LOG-15; suite 506/507 pass + 1 skip pre-existente)
- ✓ UAT debt closure: los 3 UATs humanos pendientes de v0.3 Phase 7 convertidos en integration tests automatizados — `test/logs-follow-integration.test.js` (UAT-01: spawn real `bin/kodo logs --follow` con 3 batches NDJSON progresivos + awaitLine strict order + SIGINT cleanup con waitForExit 2s), `test/session-start-event.test.js` (UAT-02: spawn real `src/hooks/session-start.js` con stdin canónico + import estático `EVENTS.SESSION_START` + 6 keys D-10 + fail-loud externo 5x `assert.fail`), `test/session-of-resolver.test.js` (UAT-03: 4 escenarios D-12 vía spawnSync `bin/kodo` con state.json sintético + exit codes deterministas observados 0/0/1/1 + stderr canonical messages); `07-HUMAN-UAT.md` reducido a redirect `status: superseded` (D-15) y `MILESTONES.md` v0.3 marca UAT debt closure (D-16); +6 tests netos sin modificar `src/` ni introducir deps — v0.5 Phase 17 (UAT-01, UAT-02, UAT-03; suite 509/510 pass + 1 skip pre-existente)
- ✓ Worktree runtime wiring: TODAS las sesiones kodo (full + quick + no-GSD) se lanzan con `claude --worktree <sessionId>` apuntando a `<projectPath>/.bg-shell/<sessionId>` derivado por helper puro `computeWorktreePath(projectPath, sessionId)` (`src/session/state.js`); `worktree_path` se persiste en `SessionRecord` PRE-spawn (D-03 — `addSession` antes de `cmux.send`) para que la traza forense esté disponible aún si el spawn falla; dispatcher fail-fast con error canonical `worktree_collision` (`existsSync` check + DispatchDeps.existsSyncFn DI), threadea `dispatchSessionId` en ambos paths (Launch + stale_relaunch) tras fix CR-01; orchestrator/launch preserva `cwd=process.cwd()` SIN `--worktree` (D-06 — orchestrator no necesita isolation, vive sobre el repo principal); lock per-repo (Phase 8 GSD-10) sigue sobre `projectPath`, jamás sobre el worktree (WT-03 invariante: `grep -rE "(acquire|release)GsdLockFn?\(...worktree" src/` → 0 matches) — v0.6 Phase 18 (WT-01, WT-02, WT-03; suite 547 tests / 546 pass + 1 skip pre-existente; CR-02 — SessionRecord huérfano si `cmux.send` falla post-addSession — diferido a Phase 19 cleanup vía stop hook fail-open)
- ✓ Worktree cleanup & integration: cierre del ciclo de vida del worktree con fail-open. `stop.js` ejecuta `git worktree remove --force` tras `releaseGsdLock` (D-07 orden); si el tree está limpio, branch + directorio desaparecen y se emite `worktree.cleanup.ok`; si quedan cambios sin commitear, el worktree se renombra a `<wt>.dirty` (pre-check con `lstatSync(target)` que discrimina ENOENT — symlinks colgantes, archivos regulares y EACCES caen en variante sufijada `<wt>.dirty-<ts>` por CR-03), persiste para inspección y se emite `worktree.cleanup.dirty` warn (nunca silenciosamente borrado). `markSessionStatus(task_id, 'done', 'session-stop')` aplica a TODAS las sesiones (GSD + no-GSD) ANTES de `sessionEnd` + `removeSession` (CR-02 — observable NDJSON refleja estado terminal real). `kodo gsd verify` lee `VERIFICATION.md` desde `session.worktree_path ?? session.project_path` (D-06 fallback transparente). `handleOrchestratorStop` preserva `cwd: KODO_ROOT` (D-05 satisfied-by-design — orchestrator vive sobre el repo principal). `runStopHook` mantiene contrato fail-open: ningún error interno crashea el hook. CR-01 (orden cleanup/nudge/removeSession + `findSession` no escanea `state.history`) deferido a Phase 21+ por override D-07 — el flujo embedded `/gsd-verify-work` (lectura desde worktree) es funcional; el orchestrator-led queda como deuda explícita — v0.6 Phase 19 (WT-04, WT-05 satisfied-by-design, WT-06; suite 567/568 pass + 1 skip pre-existente; 5 WR advisory tech-debt en `19-REVIEW.md`, no bloqueantes; 3 smoke UATs en `19-HUMAN-UAT.md`)

### Active

**In scope for v0.8 (placeholders — REQ-IDs canónicos en `.planning/REQUIREMENTS.md`):**
- [ ] **POLL fix**: `normalizeIssue` incluye `updated_at`/`created_at` canónicos para que `shouldDispatch` no evalúe `undefined` en provider-only path. Cierra D-18 leak guard de Phase 25.
- [ ] **DAEMON DX**: `kodo polling start` con flag `--verbose` + log file (con rotación). Cierra T-26-DIAG silent crash sin logfile.
- [ ] **GSD Provider Reporting integration**: cherry-pick selectivo + regeneración planning v0.8 + 38 tests heredados de la rama `gsd-provider-reporting`.
- [ ] **SessionRecord lifecycle**: `findSession` escanea `state.history` (CR-01 Phase 19) + `markSessionStatus` early-return refactor estructural (WR-07 Phase 22).
- [ ] **Phase 21/22 advisory cleanup**: pureza `syncSkill` (callback inyectable), `runSkillSyncCli` async cleanup, test `launchOrchestrator` real.
- [ ] **Bookkeeping doc-only**: REQUIREMENTS traceability v0.7 (8 IDs pending → Complete), Phase 23 VERIFICATION.md backfill, nyquist_compliant flag en phases 23/25/26/27.

**Deferred to v0.9+ (no necesarios aún):**
- [ ] Adapter de ClickUp que implementa TaskProvider
- [ ] Adapter local (JSON/Markdown) que implementa TaskProvider + file watcher trigger
- [ ] Webhook GitHub ingress real-time (depende de si latencia 60s polling emerge como restricción)
- [ ] GitHub Enterprise self-hosted (`base_url` configurable) — depende de demanda
- [ ] OAuth GitHub App (vs PAT actual)
- [ ] `kodo gsd doctor` — limpieza zombies (worktrees huérfanos + sesiones legacy)

**Tech debt v0.7 (ahora in scope v0.8, ver arriba):**
- POLL provider-only path fix (Phase 25 D-18)
- DAEMON `--verbose` + log rotation (T-26-DIAG)
- v0.7 REQUIREMENTS traceability (8 IDs pending → Complete)
- Phase 23 VERIFICATION.md backfill
- Phase 25 nyquist_compliant flag toggle (+ 23/26/27)

### Out of Scope

- Dashboard web — CLI es suficiente para uso personal
- Multi-tenant / multi-usuario — herramienta personal
- Persistencia en base de datos — JSON files suficientes para el volumen actual
- TypeScript migration — JSDoc + @ts-check cubre las necesidades sin build step
- Retry/backoff en la interfaz — responsabilidad de cada adapter internamente
- CRUD completo de tareas — kodo no crea ni elimina tareas, solo las lee y actualiza
- Rotación/retención de logs, export Prometheus, shipping a Loki/Datadog — deferidos como LOG-F1..F3 en REQUIREMENTS v2
- Slash commands desde Plane para re-disparar review, monorepo con múltiples `.planning/`, auto-creación de siguiente fase — deferidos como GSD-F1..F3
- `kodo gsd verify` para sesiones quick — quick es one-shot sin `VERIFICATION.md`; humano revisa manualmente como cualquier sesión no-GSD
- Migración de sesiones legacy en `state.json` — `gsd_mode` es aditivo opcional, sesiones v0.3 se siguen leyendo sin cambios

## Context

**Current state (post v0.5):** ~16,355 LOC JavaScript total (src + test). Node.js 20+ con dos dependencias externas en producción (`commander` + `picocolors@^1.1.1`). Suite global: 511/512 pass + 1 skip pre-existente (startup-budget Decisión B).

**Architecture v0.5 añade:**
- `src/cli/format.js` factory `createFormatter(stream, env?)` — única fuente de color/format para el CLI. Devuelve un object literal de bound methods (debug/info/warn/error/ok/fail + colores + `formatRow`/`formatTable`/`visibleWidth`) con precedencia eager `NO_COLOR > FORCE_COLOR > stream.isTTY` (D-02). Golden bytes contract: `useColor=false → zero ANSI` (base de `--json` determinismo). LOG-12 extension walker en `test/format-isolation.test.js` bloquea regresión hacia `src/logger.js` desde el grafo de `format.js`.
- `picocolors` como única fuente de ANSI: `src/cli/format.js` es el único importador (`test/format-isolation.test.js` blinda con grep + walker).
- `kodo logs` con shape dual: TTY → columnar `timestamp · level · component · message` + colores por nivel; no-TTY/`--json` → bytes idénticos al output pre-Phase 14 (early-return bypass del helper).
- `dispatcher.js` ya no emite literales: `EVENTS.GSD_PHASE_RESOLVED` y `EVENTS.GSD_BOOTSTRAP` son las únicas referencias runtime (comment-aware grep test).
- `markSessionStatus` con callsites reales: `verify.js#finalize` rama `pass` tras `addComment + updateTaskState` (try/catch silencioso preserva D-17 orchestratorReview en TODAS las ramas); `stop.js` PRE-`releaseGsdLock` dentro de `if (session.gsd)` (D-08 emit-before-mutation). `state.transition` se emite real en runtime con `from`/`to`.
- `.claude/skills/kodo-orchestrate/skill.md` como source canonical provider-agnostic (deriva `provider` desde `~/.kodo/config.json`, mapping vía `~/.kodo/projects.json`, 3 tags GSD literales, 4 flujos diagnóstico CLI con exit codes deterministas). `src/orchestrator/prompt.md` reducido a fallback degradado (~37 LOC) con 3 placeholders preservados y cross-ref a la skill.
- `src/hooks/stop.js` con `KODO_ROOT = process.env.KODO_ROOT || join(__dirname, '..', '..')` (env override aditivo), `SKILL_PATH` y los dos comandos git de `handleOrchestratorStop` apuntando a `.claude/skills/` (fix D-14).

**Architecture v0.4 (heredada):**
- `getGsdMode(flags)` + `getSessionMode(session)` en `src/labels.js` — únicas fuentes de derivación de modo. Cualquier consumer (manager, dispatcher, hooks, orchestrator) DEBE llamar al helper, NO inspeccionar `flags.includes('gsd-quick')` ni `session.gsd_mode` inline (D-09/D-10/D-11 source-hygiene blindados con tests).
- `SessionRecord.gsd_mode: 'full' | 'quick'` — campo aditivo opcional. Falsy/missing equivale a `'full'` para preservar compatibilidad con sesiones persistidas en v0.3.
- `src/hooks/session-start.js` rama quick — inyecta `/gsd-quick "<title>"` en inglés (mismo idioma que la rama full por D-04 Phase 8).
- `src/hooks/stop.js` switch exhaustivo `getSessionMode(session)` con 3 cases: `quick` (revisión manual), `full` (verify nudge), default (no-GSD). Lock se libera dentro del bloque `if (session.gsd) { ... }` que ambos modos disparan.
- `src/orchestrator/launch.js` `buildContextSummary` emite gsdTag mode-first con 3 etiquetas: `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]`.

**Adding a new provider requires only:**
1. Create `src/providers/<name>/provider.js` implementing 9 TaskProvider methods
2. Register in `src/providers/registry.js`
3. No changes to generic modules needed

## Constraints

- **Stack**: Node.js, sin frameworks pesados, mínimas dependencias externas
- **Compatibilidad**: Breaking changes OK (v0.x, no hay usuarios externos)
- **Runtime**: Debe funcionar en macOS con cmux instalado
- **Tokens**: Vigilante/server consumen 0 tokens; solo el orquestador usa LLM
- **Logger aislado del vigilante**: `kodo check` no debe cargar `src/logger.js` transitivamente (LOG-12 guard)
- **Modo derivado por helper, NO inline**: cualquier consumidor de `gsd_mode` o de las flags debe usar `getGsdMode(flags)` / `getSessionMode(session)`. Source-hygiene Phase 13 D-09/D-10/D-11 blindado con tests.
- **Color isolation**: `picocolors` solo se importa desde `src/cli/format.js`. Cualquier callsite que necesite color va por `createFormatter(stream)` — test/format-isolation.test.js blinda la single-source con grep + walker (LOG-12 extension + D-07/D-08 source-hygiene).
- **Orchestrator se lanza desde cwd = repo kodo**: `kodo orchestrator` DEBE invocarse desde el directorio `~/dev/klab/kodo` (o el path real del repo) para que Claude Code auto-cargue `.claude/skills/kodo-orchestrate/skill.md` como skill local. Si se lanza desde otro cwd, la sesión arranca con `src/orchestrator/prompt.md` como render mínimo provider-specific (fallback degradado documentado, no error). La skill canonical solo vive en el repo desde Phase 999.1 (D-04/D-05/D-06); `~/.claude/skills/kodo-orchestrate/` se eliminó al cierre de esa phase.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Interfaz en JS puro con JSDoc @typedef | Consistente con el stack, sin build step | ✓ Good — contratos validados por suite de tests |
| Plane como primer adaptador de referencia | Valida la interfaz con uso real | ✓ Good — all 9 methods exercised |
| Labels como mecanismo cross-provider | Funciona en Plane labels, GitHub labels, ClickUp tags | ✓ Good — parseKodoLabels is generic |
| Webhook + polling + manual como triggers | Cada proveedor tiene capacidades distintas | ✓ Good — webhook + manual validated |
| Pure helper extraction + DI for testability | Node 24 test runner lacks mock.module | ✓ Good — all consumers testable without mocking |
| Fire-and-forget dispatch in webhook handler | Fast HTTP response, session launch is async | ✓ Good — server responds 200 before dispatch |
| State migration clears active sessions | v1 schema incompatible con v2 fields | ✓ Good — clean break, no corruption |
| ensureConfig guards commands needing provider | First-run UX, auto-launches wizard | ✓ Good — clean onboarding flow |
| NDJSON + redactor en emit (no post-process) | Imposible exfiltrar secretos si el redactor ya corrió antes del sink | ✓ Good — una sola pipeline de escritura |
| `kodo check` aislado del logger (LOG-12) | Vigilante bajo budget de arranque; logger I/O lo rompe | ✓ Good — test-graph guard impide regresión |
| Event taxonomy cerrada en `src/logger-events.js` | Un único punto para añadir tipos y typo-guard | ⚠️ Partial — dispatcher todavía usa literales para 2 tipos (deferred LOG-09) |
| Per-repo lock con PID+TTL + realpath | Dos webhooks al mismo repo deben coalescer, no duplicar | ✓ Good — integration test exercises race; v0.4 confirma que lock se comparte entre full y quick |
| Session-start hook en inglés para el agente, prompt.md orquestador en ES | Agente Claude espera comandos EN; orquestador humano lee ES | ✓ Good — D-04 Phase 8 + D-16 Phase 10 + rama quick Phase 12 mantiene contrato |
| Resolver con discriminated union (Phase/Bootstrap/Error verdict) | Exhaustive switch en callsites, fail-closed | ✓ Good — usado en dispatcher + gsd inspect + gsd verify; v0.4 lo extiende con tolerancia quick (phase_id discard + no-match continue) |
| Dispatcher como ÚNICA fuente de `gsd.phase.resolved` y `gsd.bootstrap` | Un solo emisor evita dobles eventos en el log | ✓ Good — pattern-mapper #3 Phase 9; preservado en v0.4 (quick reusa eventos sin nueva taxonomía) |
| Verification gate: parser puro separado de orquestación con side-effects | Testeable sin mockear Plane; side-effects fail-open | ✓ Good — 21 tests parser + 26 orquestación |
| Comentarios Plane deterministas en ES (mismo verdict → mismos bytes) | Dedup futuro por content-hash y lectura humana coherente | ✓ Good — renders sin timestamp |
| Transición a Review condicional a `verdict.action === 'pass'` + `addComment` OK | El gate no mueve el estado si el operador no vio el comentario | ✓ Good — legacy verdict mapping pitfall #2 resuelto |
| Exit codes deterministas en `kodo gsd verify` (0/1/2 + 64..78 usage/not-found/etc.) | Agentes y humanos pueden ramificar sin parsear stdout | ✓ Good — Pitfall #6 Opción A |
| CONTEXT.md + PATTERNS.md + DISCUSSION-LOG por fase | Facilita onboarding del agente ejecutor y trazabilidad de decisiones | ✓ Good — usado desde Phase 9; en v0.4 los CONTEXT capturaron 17+ decisiones de Phase 12 |
| `gsd_mode` aditivo y opcional en SessionRecord (falsy/missing → 'full') | Compat con sesiones v0.3 ya persistidas; no forzar migración | ✓ Good — Phase 11 D-08 ratificado en tests legacy de getSessionMode |
| `getGsdMode(flags)` y `getSessionMode(session)` como ÚNICAS fuentes de derivación de modo | DRY hard-enforced; un solo sitio cambia si añadimos un tercer modo | ✓ Good — Phase 13 D-09/D-10/D-11 invariants source-hygiene en tests grep against src/ |
| Quick es phase-agnostic: descartamos `phase_id` aunque el resolver lo encuentre | El verdict del resolver es informativo en quick, no estructural | ✓ Good — Phase 11 D-03 + tests dispatcher quick + match |
| Quick no produce `VERIFICATION.md` ni se verifica via `kodo gsd verify` | One-shot por diseño; gate sería un no-op | ✓ Good — Phase 12 stop nudge ramificado + prompt.md aclara revisión manual |
| `picocolors` como única fuente de ANSI (color isolation) | Un único importador (`src/cli/format.js`) evita drift y permite golden bytes test | ✓ Good — Phase 14 D-07 + `test/format-isolation.test.js` blinda con grep+walker |
| Helper de color/format devuelve object literal de bound methods (factory) | Espejo de `src/logger.js#makeNode`: DI-friendly, sin clases, sin estado mutable | ✓ Good — Phase 14 D-01..D-04; 5 callsites consumen sin fricción |
| `--json` bypasea el helper (early-return) en lugar de "pasar a través con useColor=false" | Garantiza determinismo de bytes histórico sin depender del helper | ✓ Good — Phase 15 D-08; golden bytes test sigue verde |
| Eager `useColor` calculado al construir el formatter (NO_COLOR > FORCE_COLOR > stream.isTTY) | Evita re-lectura del env dentro de cada helper; previene races test/runtime | ✓ Good — Phase 14 D-02; matriz de 4 estados validada |
| `state.transition` se emite ANTES de mutar (release del lock, transición Plane) | Si el emit falla, el operador ve el intento; evita "fantasmas" donde la mutación ocurrió sin trazar | ✓ Good — Phase 16 D-08 emit-before-mutation; 3 escenarios stop test |
| `markSessionStatus` en `verify.js` SÓLO en rama pass (NO en soft-fail/hard-fail/errors) | El gate no debe afirmar progreso si el verdict no es pass | ✓ Good — Phase 16 SC#3; 6 asserts negative en gsd-verify-integration.test |
| UATs humanos se automatizan via spawn child process real (NO mock) | Tail real, exit codes deterministas observados; equivalencia con UAT humano | ✓ Good — Phase 17; 3 integration tests pass sin sleeps largos |
| Skill `kodo-orchestrate` vive sólo en `<repo>/.claude/skills/` (NO en `~/.claude/skills/`) | Source canonical único, versionado con el código; cwd=repo como contrato operativo | ✓ Good — Phase 999.1 D-04..D-06; SKILL-01 deferred si la fricción aparece |
| `KODO_ROOT` env override en `stop.js` (aditivo) | Permite tests spawnSync contra tmpdir aislado sin tocar el path por defecto | ✓ Good — Phase 999.1 D-16; `test/skill-auto-commit.test.js` 2 escenarios |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-15 — Milestone v0.8 (Consolidación + GSD Provider Reporting) initialized via `/gsd-new-milestone`. v0.7 GitHub Issues Adapter shipped (2026-05-14, audit PASSED) y archivado (2026-05-15). v0.8 cierra tech debt v0.7 (POLL + DAEMON + bookkeeping), integra rama paralela `gsd-provider-reporting` con cherry-pick + planning regen, resuelve lifecycle SessionRecord (CR-01 Phase 19 + WR-07 Phase 22 — driver real: ROMAN-132 state.json desync 2026-05-15), y limpia advisory follow-up Phases 21/22. Adapters nuevos (ClickUp/local) y `kodo gsd doctor` deferidos a v0.9+. Próximo: REQUIREMENTS.md + ROADMAP.md (continúa numeración desde Phase 28).*
