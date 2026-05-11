# kodo

## What This Is

kodo es un bridge entre sistemas de gestión de tareas y sesiones de Claude Code via cmux. La arquitectura es provider-agnostic: cualquier sistema de tareas (Plane, GitHub Issues, ClickUp, local) se integra implementando la interfaz `TaskProvider` de 9 métodos. Plane CE es el primer adaptador implementado y validado. Desde v0.3, kodo orquesta sesiones Claude bajo el workflow GSD (1 tarea Plane = 1 fase GSD) con bootstrap automático, gate de verificación contra `VERIFICATION.md`, y observabilidad NDJSON end-to-end. Desde v0.4, una segunda label `kodo:gsd-quick` arranca sesiones one-shot sin plan/execute/verify, con el mismo lock + skip-permissions y orchestrator que las distingue.

## Core Value

Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. El mismo sistema dispara dos modos GSD: full (`kodo:gsd`, multi-fase con verify) y quick (`kodo:gsd-quick`, one-shot), sin acoplar el código GSD al proveedor.

## Current State

**Shipped:** v0.4 (2026-04-30) — GSD Quick Mode

v0.4 cierra la cadena `kodo:gsd-quick` que el WIP de v0.3 dejó solo en el dispatcher. Ahora `gsd_mode: 'full'|'quick'` se persiste en `SessionRecord` desde `buildSessionFromTask` vía el helper `getGsdMode(flags)`, los tres puntos de lectura del modo (SessionStart hook, Stop hook, orchestrator launch summary) ramifican vía `getSessionMode(session)`, una sesión quick recibe `/gsd-quick "<title>"` en lugar del bloque plan/execute/verify, su Stop nudge pide revisión manual sin sugerir `kodo gsd verify`, y el orchestrator emite `[GSD quick]` en su tag para distinguirla. La cobertura cross-cutting del modo (helper, manager, dispatcher, session-start, stop, launch) queda blindada con 44 tests nuevos contra 7 sitios de la cadena. El lock per-repo y el contrato `--dangerously-skip-permissions` se comparten entre full y quick (mismo `session.gsd === true` en ambos modos).

## Current Milestone: v0.5 CLI Polish & v0.3 Debt Cleanup

**Goal:** Pulir la experiencia CLI con colores y formato legible, y cerrar la deuda técnica heredada de v0.3 (LOG-09 + UATs Phase 7) sin tocar el alcance de adapters.

**Target features:**
- Output del CLI con colores semánticos (info/warn/error) y reformat de tablas/headers vía `picocolors`, con TTY detection y respeto a `NO_COLOR`/`FORCE_COLOR` — `--json` mantiene bytes idénticos al output sin TTY.
- Cerrar LOG-09: migrar literales de `dispatcher.js` (`'gsd.phase.resolved'` y `'gsd.bootstrap'`) al catálogo `EVENTS.*` y cablear `markSessionStatus` en transiciones reales (`verify.js` cuando mueve la tarea Plane a Review tras `pass`, y `stop.js` cuando libera el lock per-repo) para que `state.transition` se emita en runtime.
- Convertir los 3 UATs humanos pendientes de Phase 7 (live `--follow`, `session.start` con campos reales, `--session-of` E2E) en integration tests automatizados con fixtures NDJSON y `state.json`.

**Key context:**
- `picocolors` será la 2ª dependencia externa de kodo (junto a `commander`). Trade-off aceptado a cambio del DX win y de no escribir un wrapper ANSI custom.
- v0.5 es deliberadamente un milestone de pulido + cierre de deuda. Adapters (GitHub Issues, ClickUp, local), polling y file-watcher triggers permanecen en `Active` y se atacarán en v0.6.
- El contrato del logger NDJSON no cambia: `KODO_LOG_LEVEL` y `--json` siguen produciendo bytes deterministas; los colores solo aplican a salida TTY interactiva.

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

### Active

**In v0.5 (current milestone):**
- (todos los items planificados en v0.5 están validated)

**Deferred to v0.6 or later:**
- [ ] Adapter de GitHub Issues que implementa TaskProvider
- [ ] Adapter de ClickUp que implementa TaskProvider
- [ ] Adapter local (JSON/Markdown) que implementa TaskProvider
- [ ] Polling trigger channel para providers sin webhook
- [ ] File watcher trigger para provider local
- [ ] Hook prompt: que `buildSessionContext` (sesiones no-GSD) recuerde a la sesión que kodo NO hace push automático, y exija verificar el push real o redactar en condicional las afirmaciones de deploy/publicación (HOOK-01 — driver: ROMAN-125 / ROMAN-126)
- [ ] **SKILL-01**: `kodo skill sync` CLI que empuje la canonical de `<repo>/.claude/skills/` a `~/.claude/skills/`, permitiendo lanzar `kodo orchestrator` desde cualquier `cwd` con la skill auto-cargada. Hoy (post Phase 999.1) se exige cwd = repo (Constraint añadida) en su lugar; si la fricción demuestra ser alta en v0.6+, retomar SKILL-01.

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

**Current state (post v0.4):** ~13,160 LOC JavaScript total (src + test). 37 archivos `*.test.js`, 415 tests con 414 pass + 1 skip pre-existente (startup-budget Decisión B). Node.js 20+ con una sola dependencia externa (commander).

**Architecture v0.4 añade:**
- `getGsdMode(flags)` + `getSessionMode(session)` en `src/labels.js` — únicas fuentes de derivación de modo. Cualquier consumer (manager, dispatcher, hooks, orchestrator) DEBE llamar al helper, NO inspeccionar `flags.includes('gsd-quick')` ni `session.gsd_mode` inline (D-09/D-10/D-11 source-hygiene blindados con tests).
- `SessionRecord.gsd_mode: 'full' | 'quick'` — campo aditivo opcional. Falsy/missing equivale a `'full'` para preservar compatibilidad con sesiones persistidas en v0.3.
- `src/hooks/session-start.js` rama quick — inyecta `/gsd-quick "<title>"` en inglés (mismo idioma que la rama full por D-04 Phase 8).
- `src/hooks/stop.js` switch exhaustivo `getSessionMode(session)` con 3 cases: `quick` (revisión manual), `full` (verify nudge), default (no-GSD). Lock se libera dentro del bloque `if (session.gsd) { ... }` que ambos modos disparan.
- `src/orchestrator/launch.js` `buildContextSummary` emite gsdTag mode-first con 3 etiquetas: `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]`.
- `src/orchestrator/prompt.md` § "Sesiones GSD" aclara que quick no se verifica via `kodo gsd verify`.

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
*Last updated: 2026-05-10 — v0.5 Phase 17 (Phase 7 UAT Automation) complete; los 3 UATs humanos pendientes (`--follow` live, `session.start` real, `--session-of` E2E) convertidos en integration tests con fixtures NDJSON progresivos y `state.json` sintético — `test/logs-follow-integration.test.js` (spawn real con 3 batches + SIGINT cleanup), `test/session-start-event.test.js` (spawn real `src/hooks/session-start.js` + 6 keys D-10 + fail-loud), `test/session-of-resolver.test.js` (4 escenarios D-12 con exit codes 0/0/1/1 deterministas); `07-HUMAN-UAT.md` reducido a redirect `status: superseded` y `MILESTONES.md` v0.3 marca UAT debt closure; +6 tests netos sin modificar `src/` ni introducir deps; suite 509/510 pass + 1 skip pre-existente*
