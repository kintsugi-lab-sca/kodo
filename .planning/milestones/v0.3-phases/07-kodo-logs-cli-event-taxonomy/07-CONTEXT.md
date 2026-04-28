# Phase 7: `kodo logs` CLI + Event Taxonomy - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Entregar el sub-comando `kodo logs` (LOG-05, LOG-06, LOG-07, LOG-11), la taxonomía de eventos de ciclo de vida de 7 tipos (LOG-09) y la correlación con el transcript de Claude Code (LOG-10). Todo ello consume el `createLogger` ya entregado en Fase 6 sin modificar su API. No hay cambios al formato NDJSON, la redacción ni el aislamiento del vigilante.

**Queda fuera de Fase 7:** label `kodo:gsd` y propagación de flags (Fase 8), phase resolver + bootstrap (Fase 9), gate de verificación del orquestador (Fase 10).

</domain>

<decisions>
## Implementation Decisions

### CLI shape (LOG-05, LOG-06, LOG-07, LOG-11)
- **D-01:** Forma `kodo logs <session-id> [flags]` — session-id posicional obligatorio salvo cuando se pasa `--session-of`. Resuelto vía `commander` siguiendo el estilo del resto de sub-comandos (`src/cli.js`).
- **D-02:** Flags soportados: `--follow`, `--level <debug|info|warn|error>`, `--component <name>`, `--event-type <type>`, `--json`, `--session-of <plane-task-id>`.
- **D-03:** Output default **pretty-print** idéntico al mirror stderr del logger (`HH:MM:SS LEVEL component msg +ctx`) con colores si stdout es TTY y `NO_COLOR` no está set. Con `--json` imprime NDJSON crudo (pipe-friendly para `jq`/`grep`).
- **D-04:** `--follow` implementado con `fs.watchFile(path, { interval: 200 })` (polling stdlib). No usar `fs.watch` — evita casos edge de inotify/FSEvents (rename, truncate, coalescing).
- **D-05:** Semántica de `--follow`: **dump completo + tail** (como `tail -f`). Imprime el archivo entero desde byte 0 y sigue en vivo. Si el archivo no existe todavía, espera hasta que aparezca (poll) — no falla. Esto aplica tanto para `kodo logs <id> --follow` como para `--session-of X --follow` (una vez resuelto el id).
- **D-06:** Filtros (`--level`, `--component`, `--event-type`) se aplican **en el cliente**, parseando cada línea JSON y descartando antes de imprimir. No alteran el fichero.

### Taxonomía de eventos de ciclo de vida (LOG-09)
- **D-07:** Campo top-level nuevo `event` en el NDJSON (string) para líneas tipadas. Los 7 tipos del ROADMAP son el contrato cerrado: `session.start`, `session.end`, `state.transition`, `orchestrator.review`, `gsd.phase.resolved`, `gsd.bootstrap`, `plane.api.call`. Líneas sin `event` siguen siendo válidas (logs libres con `logger.info('…')`).
- **D-08:** Constantes exportadas desde nuevo módulo `src/logger-events.js`: `export const EVENTS = Object.freeze({ SESSION_START: 'session.start', SESSION_END: 'session.end', STATE_TRANSITION: 'state.transition', ORCHESTRATOR_REVIEW: 'orchestrator.review', GSD_PHASE_RESOLVED: 'gsd.phase.resolved', GSD_BOOTSTRAP: 'gsd.bootstrap', PLANE_API_CALL: 'plane.api.call' })`. Descubrible desde IDE, robusto ante typos.
- **D-09:** Helpers por evento en el mismo archivo: `sessionStart(logger, fields)`, `sessionEnd(logger, fields)`, `stateTransition(logger, { from, to, reason })`, `orchestratorReview(logger, { phase_id, verdict, reason })`, `gsdPhaseResolved(logger, { phase_id, match_heading })`, `gsdBootstrap(logger, { project_path })`, `planeApiCall(logger, { method, path, status, duration_ms })`. Cada helper rellena `event` + campos obligatorios del tipo y delega en `logger.info(...)` (o `warn`/`error` según corresponda).
- **D-10:** Contrato mínimo para `session.start`: `session_id, plane_task_id, provider, project_path, transcript_path, started_at`. Es el único tipo con contrato de campos obligatorios auditado por tests dedicados (pivot a Claude + task Plane desde un tail).
- **D-11:** Validación por evento vía tests unitarios (`test/logger-events.test.js`) que invocan cada helper con una fixture de logger (captura de NDJSON en memoria/tmpfile) y assertan que el registro emitido contiene `event` correcto y todos los campos del contrato.
- **D-12:** No hay seq monotónico por línea. Timestamp ISO-8601 con ms + `appendFileSync` atómico en POSIX son suficientes para ordering. Los 7 tipos no son alta frecuencia; concurrency real entre child loggers queda cubierta por el kernel. (Resuelve la nota deferida de Fase 6.)

### DI del logger en consumers
- **D-13:** Root logger se crea en **`src/cli.js`** (para `kodo logs`, `kodo check`, `kodo launch`, etc.) y **`src/server.js`** (para webhooks). Cada entrypoint resuelve `minLevel` con precedencia flag CLI > `KODO_LOG_LEVEL` env > default `info`.
- **D-14:** Se pasa explícito como argumento (u `options.logger`) a: `session/manager.js`, `session/state.js` (si emite), `providers/plane/*`, `cmux/client.js`, `hooks/*.js`, `orchestrator/launch.js`. Sin singletons globales, sin `getLogger()` factory.
- **D-15:** Cada consumer hace `logger.child({ component: '<name>' })` al recibir el logger raíz. Componentes previstos: `session`, `plane`, `cmux`, `hook`, `orchestrator`, `gsd` (reservado para Fase 9+).
- **D-16:** `src/check.js` sigue prohibido de importar `logger.js` (convención Fase 6, guardada por `test/check-isolation.test.js`). La Fase 7 no toca el vigilante.

### Transcript correlation (LOG-10)
- **D-17:** Path resuelto determinísticamente desde `project_path` + `session_id`: `~/.claude/projects/${encodeURIComponent(project_path).replace(/%2F/g, '-')}/${sessionId}.jsonl`. Sin glob, sin I/O en el resolver. Si el fichero no existe cuando el dev abre el transcript, el logger no es responsable — sólo persiste la referencia.
- **D-18:** Emisor de `session.start`: **hook `SessionStart`** (`src/hooks/session-start.js`). El hook ya se invoca cuando Claude arranca y recibe el payload con `transcript_path` en primera persona — fuente de verdad sin reconstruir. El manager emite `session.spawn` (opcional, aún no contado en los 7 tipos — si se añade, se revisa ROADMAP).
- **D-19:** Correlation fields bindeados via `.child({ plane_task_id, phase_id })` se añaden al logger tras conocer los IDs. En el hook, el payload ya trae `session_id` y (próximamente) `plane_task_id` por flags de Fase 8.

### Lookup `--session-of` (LOG-11)
- **D-20:** Resolver en dos pasos: (1) `loadState()` busca por `task_id` en `~/.kodo/state.json`; (2) si no hay match, escanea `~/.kodo/logs/*.ndjson` leyendo **sólo la primera línea** de cada archivo (la cabecera `session.start` contiene `plane_task_id` si la sesión es del label GSD / viene de Plane). Si ambos fallan, error con lista de task_ids vistos en los logs.
- **D-21:** Multi-match: ordenar por `session.start.timestamp` DESC y elegir la más reciente. Warn a stderr listando los `session_id` descartados con su timestamp — el dev ve que hubo otros y puede re-invocar con `kodo logs <id>` específico.
- **D-22:** `--session-of` + `--follow`: resuelve UN session-id al arrancar (aplicando D-21) y hace follow sobre ese archivo fijo. Sesiones nuevas del mismo task durante el follow no aparecen — semántica `tail -f` sobre archivo concreto.

### Claude's Discretion
- Nombre exacto del archivo (`src/logger-events.js` vs `src/events.js`) y forma interna (un objeto `EVENTS` vs una const por tipo).
- Algoritmo exacto para leer la primera línea de cada `.ndjson` en el fallback del lookup (stream line reader vs read + split). Debe cortar tras la primera línea — no leer archivos enteros.
- Formato exacto del warn de multi-match a stderr.
- Interval del `watchFile` (200ms es sugerencia; planner puede bajar a 100ms si tests lo exigen responsiveness).
- Estructura del helper de fixture para tests de eventos (in-memory sink que captura líneas sin I/O real vs tmp dir por test).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contexto de fase previa (Phase 6 — logger foundation)
- `.planning/phases/06-structured-logger-foundation/06-CONTEXT.md` — Contrato completo del logger (API, campos NDJSON, redacción, aislamiento del vigilante). Phase 7 no modifica nada de esto.
- `.planning/phases/06-structured-logger-foundation/06-VERIFICATION.md` — PASS record de la fase anterior + deuda transferida a Fase 7 (CLI, taxonomía, DI, lint anti-interpolación).
- `.planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md` — Baseline empírico del startup de `kodo check` (fundamenta por qué startup-budget test quedó skip).

### Requisitos y roadmap
- `.planning/REQUIREMENTS.md` §v0.3 — LOG-05..LOG-11 (eventos + CLI), explicit out-of-scope (rotación, shipping).
- `.planning/ROADMAP.md` §"Phase 7" — Goal + success criteria + 7 tipos de evento fijados.
- `.planning/PROJECT.md` — principios zero-runtime-deps, NDJSON única, observabilidad desde commit #1.

### Código existente que Phase 7 toca o integra
- `src/logger.js` — factory + redactor (intocable; se consume).
- `src/logger-noop.js` — fallback sin I/O (intocable).
- `src/cli.js` — registrará `kodo logs`. Estilo commander ya establecido (ver comandos `config`, `start`, `check`, `launch`).
- `src/config.js` — `KODO_DIR` export (usado para resolver `logs/`).
- `src/session/state.js` — schema v2 `SessionRecord { session_id, task_id, task_ref, provider, project_path, ... }` consumido por `--session-of`.
- `src/hooks/session-start.js` — emisor de `session.start` con `transcript_path`.
- `test/check-isolation.test.js` — guardián de LOG-12; Phase 7 debe seguir pasando sin modificarlo.

### Convenciones externas
- `~/.claude/projects/` — convención Claude Code para transcripts (encodeURIComponent + `%2F→-`). Referencia práctica: `/Users/alex/.claude/projects/-Users-alex-dev-klab-kodo/`.
- [commander docs](https://github.com/tj/commander.js) — sólo para referencia de API, no se añade como doc interno.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/logger.js` — `createLogger({ sessionId, minLevel })` + `.child(bindings)`. Campos base: `timestamp, level, component, msg, session_id, plane_task_id?, phase_id?`. Colores ANSI en `COLOR_BY_LEVEL` reutilizables en el pretty printer del CLI.
- `src/logger-noop.js` — para paths que no deben activar I/O (no se usa en Fase 7 pero referencia obligada).
- `src/config.js` — `KODO_DIR` (`~/.kodo`) para componer `${KODO_DIR}/logs/${sessionId}.ndjson` en el reader.
- `src/session/state.js` — `loadState()` + `State.sessions` map indexado por `task_id`, usable directamente en `--session-of`.
- Patrón commander ya establecido en `src/cli.js` (7 sub-comandos, `--option <value>` y acciones async).

### Established Patterns
- ES modules puros, `"type": "module"`. `src/logger-events.js` exporta named `EVENTS` + helpers.
- Factory/funciones puras sobre classes. Helpers de eventos son funciones, no una clase `Emitter`.
- JSDoc `@param`/`@returns` obligatorio en API público (eventos + CLI action handlers).
- Tests: `node --test test/*.test.js`, assertions con `node:assert/strict`, fixtures en tmp dir con cleanup.
- Zero runtime deps nuevos — reader, watcher, reverse-line-read se hand-roll sobre stdlib.

### Integration Points
- **CLI entry:** `src/cli.js` añade `.command('logs')` entre `.command('status')` y cualquier otro. Action handler delega en nuevo módulo `src/logs/reader.js` (o equivalente — a decidir en planning).
- **Hook emission:** `src/hooks/session-start.js` deja de emitir logs sueltos y pasa a llamar `sessionStart(logger, { ... })` con campos del contrato D-10.
- **Consumers DI:** cada uno de los 6 consumers (session/manager, providers/plane, cmux, hooks, orchestrator, session/state) recibe un logger vía argumento; cambio de firma mínimo y compatible con el wiring actual (entrypoints en cli.js y server.js se encargan).
- **Redactor ya aplicado:** todos los helpers pasan por `emit()` del logger, que ejecuta `redact()` antes de escribir. Ni el transcript_path ni el project_path se redactan (no match de SENSITIVE_KEYS ni de JWT_RE/BEARERY_RE).

</code_context>

<specifics>
## Specific Ideas

- **Pretty printer del CLI reutiliza formato del mirror stderr** del logger (consistencia visual entre `logger.warn(...)` en vivo y `kodo logs` en batch). Idealmente exportando la función `formatLine(record)` desde `src/logger.js` o duplicándola minimal en el reader; decisión concreta queda al planner pero queremos **una sola fuente de verdad para el formato pretty**.
- **Test fixture de taxonomía:** `test/fixtures/events-golden.ndjson` con un ejemplo limpio de cada uno de los 7 tipos y sus campos obligatorios. Sirve de referencia humana y de oracle para tests de integración.
- **Filtro `--event-type` acepta múltiples:** `--event-type session.start --event-type plane.api.call` (commander `variadic`), o valor CSV. Detalle de sintaxis al planner; el contrato es: se puede filtrar por uno o varios tipos.
- **Helper `sessionEnd` acepta `status: 'done'|'error'|'review'|'interrupted'`** para alinear con `SessionRecord.status` y permitir correlación entre el state.json y los logs.
- **--follow arrancando con archivo inexistente** espera hasta que exista. Emite `stderr` pretty: `"waiting for session <id> to start..."` una única vez — no flood. Timeout opcional `--timeout <s>` (Claude's Discretion si se implementa o no en Fase 7).

</specifics>

<deferred>
## Deferred Ideas

- **`kodo logs --since <timestamp>`** — filtro temporal explícito. No está en requirements de v0.3; al backlog si hace falta.
- **`kodo logs --grep <pattern>`** — ripgrep sobre el contenido. Parcialmente cubierto por `--component` + `--event-type`; cualquier usuario avanzado puede `kodo logs <id> --json | jq` o `| rg`.
- **`session.spawn` como 8vo tipo de evento** — útil para separar "el manager lanzó el comando" vs "Claude arrancó y emitió SessionStart". No entra en Fase 7: los 7 tipos del ROADMAP son contrato fijo. Revisar en una fase v0.4 si la necesidad aparece.
- **`--follow` multi-sesión con `--session-of`** — seguir cualquier sesión nueva del mismo task mientras el CLI corre. Complica tests y atenta contra la semántica `tail -f`. Backlog.
- **Exporter de métricas Prometheus** → LOG-F2 (v2, ya deferido en REQUIREMENTS.md).
- **Lint rule anti-interpolación de secretos** — heredada de deuda Fase 6. Queda **fuera de Fase 7** (no es CLI ni taxonomía); considerar como phase chica o tarea de Fase 8 de cierre de milestone.
- **Refactor `src/check.js` separando snapshot/act para reactivar `startup-budget.test.js`** — heredado de Fase 6. Fuera de Fase 7 (no es CLI ni taxonomía); posible Fase 10.5 o post-milestone.

</deferred>

---

*Phase: 07-kodo-logs-cli-event-taxonomy*
*Context gathered: 2026-04-16*
