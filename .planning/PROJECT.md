# kodo

## What This Is

kodo es un bridge entre sistemas de gestión de tareas y sesiones de Claude Code via cmux. La arquitectura es provider-agnostic: cualquier sistema de tareas (Plane, GitHub Issues, ClickUp, local) se integra implementando la interfaz `TaskProvider` de 9 métodos. Plane CE es el primer adaptador implementado y validado. A partir de v0.3, kodo también orquesta sesiones Claude bajo el workflow GSD (1 tarea Plane = 1 fase GSD) con bootstrap automático, gate de verificación contra `VERIFICATION.md`, y observabilidad NDJSON end-to-end.

## Core Value

Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. Con v0.3, ese mismo sistema también se convierte en disparador del workflow GSD sin acoplar el código GSD al proveedor.

## Current State

**Shipped:** v0.3 (2026-04-22) — GSD Integration + Structured Logging

v0.3 añadió la pipeline completa de `kodo:gsd`: label Plane → dispatcher → per-repo lock → resolver 1:1 título→fase (con bootstrap condicional) → sesión Claude GSD → gate de verificación que comenta en Plane y transiciona a Review sólo tras `VERIFICATION.md` pass. Todo cableado con logger estructurado NDJSON (8 tipos de evento tipados) y CLI `kodo logs` para inspección local.

## Current Milestone: v0.4 GSD Quick Mode

**Goal:** Una task etiquetada `kodo:gsd-quick` arranca una sesión Claude que ejecuta `/gsd-quick` (one-shot, sin plan/execute/verify), comparte lock+skip-permissions con `kodo:gsd`, y el orchestrator no intenta verify post-mortem.

**Target features:**
- Persistencia de modo (`gsd_mode: 'full'|'quick'`) en sesiones
- Hooks bifurcados (SessionStart inyecta `/gsd-quick` en lugar de plan/execute/verify)
- Stop nudge sin verify para quick (one-shot)
- Tag distintivo en orchestrator launch summary
- Cobertura de tests (labels, manager, dispatcher, session-start)

**Key context:** WIP no-committeado en `src/labels.js`, `src/session/state.js`, `src/triggers/dispatcher.js` introdujo el dispatch de `kodo:gsd-quick` pero el resto de la cadena (manager + hooks + orchestrator) sigue mirando `flags.includes('gsd')` literal — una task quick arranca sin `gsd: true` persistido, sin skip-permissions, y SessionStart le pide `/gsd-new-project` en vez de `/gsd-quick`. Sin research — polish interno sin nueva tecnología.

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

### Active

- [ ] Adapter de GitHub Issues que implementa TaskProvider
- [ ] Adapter de ClickUp que implementa TaskProvider
- [ ] Adapter local (JSON/Markdown) que implementa TaskProvider
- [ ] Polling trigger channel para providers sin webhook
- [ ] File watcher trigger para provider local
- [ ] Output del CLI con colores y formato mejorado
- [ ] Cerrar deuda LOG-09: migrar literales del dispatcher a `EVENTS.*` y cablear `markSessionStatus` en callsites de producción para que `state.transition` se emita en runtime
- [ ] Completar UATs humanos de Phase 7 (live --follow, `session.start` real, `--session-of` E2E)

### Out of Scope

- Dashboard web — CLI es suficiente para uso personal
- Multi-tenant / multi-usuario — herramienta personal
- Persistencia en base de datos — JSON files suficientes para el volumen actual
- TypeScript migration — JSDoc + @ts-check cubre las necesidades sin build step
- Retry/backoff en la interfaz — responsabilidad de cada adapter internamente
- CRUD completo de tareas — kodo no crea ni elimina tareas, solo las lee y actualiza
- Rotación/retención de logs, export Prometheus, shipping a Loki/Datadog — deferidos como LOG-F1..F3 en REQUIREMENTS v2
- Slash commands desde Plane para re-disparar review, monorepo con múltiples `.planning/`, auto-creación de siguiente fase — deferidos como GSD-F1..F3

## Context

**Current state (post v0.3):** ~7,270 LOC JavaScript (src +2,620 / test +4,410 desde v0.2), +23,178 líneas de planning, ~80 archivos test. Node.js 20+ con una sola dependencia externa (commander). 366/367 tests pasan (1 pre-existing skip: startup-budget demoted por Decisión B).

**Architecture v0.3 añade:**
- `src/logger.js` + `src/logger-noop.js` — factory NDJSON con niveles, redactor de secretos, pretty-print stderr
- `src/logger-events.js` — 8 tipos tipados con helpers; único punto de taxonomía
- `src/logs/` — reader, follow, session-lookup para el CLI `kodo logs`
- `src/gsd/` — lock (per-repo PID+TTL), roadmap (parser), brief (buildBriefFromTask), resolver (discriminated union), verification (parser+verdict puros), verify (orquestación Plane+NDJSON)
- `src/cli/gsd-inspect.js` + `src/cli/gsd-verify.js` — thin CLI handlers delegando en los módulos `src/gsd/`
- `src/labels.js` — `parseKodoLabels` para extraer flags (`gsd`) de labels Plane
- `src/orchestrator/prompt.md` — sección condicional `## Sesiones GSD`; `launch.js` con `buildContextSummary` tag `[GSD phase N]`

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
| Event taxonomy cerrada en `src/logger-events.js` | Un único punto para añadir tipos y typo-guard | ⚠️ Partial — dispatcher todavía usa literales para 2 tipos (deferred) |
| Per-repo lock con PID+TTL + realpath | Dos webhooks al mismo repo deben coalescer, no duplicar | ✓ Good — integration test exercises race |
| Session-start hook en inglés para el agente, prompt.md orquestador en ES | Agente Claude espera comandos EN; orquestador humano lee ES | ✓ Good — D-04 Phase 8 + D-16 Phase 10 |
| Resolver con discriminated union (Phase/Bootstrap/Error verdict) | Exhaustive switch en callsites, fail-closed | ✓ Good — usado en dispatcher + gsd inspect + gsd verify |
| Dispatcher como ÚNICA fuente de `gsd.phase.resolved` y `gsd.bootstrap` | Un solo emisor evita dobles eventos en el log | ✓ Good — pattern-mapper #3 Phase 9 |
| Verification gate: parser puro separado de orquestación con side-effects | Testeable sin mockear Plane; side-effects fail-open | ✓ Good — 21 tests parser + 26 orquestación |
| Comentarios Plane deterministas en ES (mismo verdict → mismos bytes) | Dedup futuro por content-hash y lectura humana coherente | ✓ Good — renders sin timestamp |
| Transición a Review condicional a `verdict.action === 'pass'` + `addComment` OK | El gate no mueve el estado si el operador no vio el comentario | ✓ Good — legacy verdict mapping pitfall #2 resuelto |
| Exit codes deterministas en `kodo gsd verify` (0/1/2 + 64..78 usage/not-found/etc.) | Agentes y humanos pueden ramificar sin parsear stdout | ✓ Good — Pitfall #6 Opción A |
| CONTEXT.md + PATTERNS.md + DISCUSSION-LOG por fase | Facilita onboarding del agente ejecutor y trazabilidad de decisiones | ✓ Good — se usó en Phase 9 y Phase 10 |

---
*Last updated: 2026-04-28 — v0.4 milestone started (GSD Quick Mode)*
