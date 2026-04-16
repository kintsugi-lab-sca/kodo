---
phase: 07-kodo-logs-cli-event-taxonomy
plan: 06
subsystem: logging
tags: [logger, events, di, hooks, session-lifecycle, plane-api, state-transition, log-12]

# Dependency graph
requires:
  - phase: 07-kodo-logs-cli-event-taxonomy/07-02
    provides: src/logger-events.js con sessionStart/sessionEnd/stateTransition/planeApiCall helpers + EVENTS constant
  - phase: 07-kodo-logs-cli-event-taxonomy/07-03
    provides: src/logs/reader.js — runLogs() consume los NDJSON que ahora se emiten end-to-end
provides:
  - 4 typed events activos en runtime: session.start (hook), session.end (hook), plane.api.call (PlaneClient.request), state.transition (markSessionStatus wrapper)
  - DI logger opcional en 7 consumers: session/state, session/manager, hooks/session-start, hooks/stop, providers/plane/client, providers/plane/provider, cmux/client, orchestrator/launch
  - Helper exportado markSessionStatus(taskId, nextStatus, reason, logger?) en session/manager.js para dispatchers futuros
  - Pipeline CLI end-to-end: `kodo logs <session-id>` muestra eventos reales tras un startup del hook
affects:
  - Phase 8 (GSD label + session plumbing) — dispatcher puede consumir markSessionStatus para emitir state.transition sin boilerplate
  - Phase 10 (orchestrator verification gate) — orchestrator.launch ya tiene logger cableado, solo falta emitir orchestratorReview

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps preservado
  patterns:
    - "Dynamic import de logger.js + logger-events.js en hooks (session-start, stop) — aísla el logger del top-level del módulo y evita que los hooks tiren dependencias al cargar"
    - "Silent-failure anidado: try/catch interno específico para la emisión tipada + try/catch externo preexistente que nunca deja fallar al hook"
    - "DI logger opcional: firma `fn(..., logger = noopLogger)` vs `fn(..., logger?)`. Se usa noopLogger default cuando el callee invoca incondicionalmente el logger; optional-chain (`logger?.info(...)`) cuando el callee quiere saltarse la llamada en hot paths (plane/client)"
    - "Logger factory con env override: `createLogger({ sessionId, minLevel: process.env.KODO_LOG_LEVEL || 'info' })` en hooks — primer consumidor de KODO_LOG_LEVEL en runtime"
    - "state.js importa SOLO logger-noop.js (zero-import) — preserva LOG-12 porque check.js transitivamente alcanza state.js vía sessionUtils pero logger-noop.js está whitelisted"

key-files:
  created: []
  modified:
    - src/session/state.js
    - src/hooks/session-start.js
    - src/hooks/stop.js
    - src/providers/plane/client.js
    - src/providers/plane/provider.js
    - src/session/manager.js
    - src/cmux/client.js
    - src/orchestrator/launch.js

key-decisions:
  - "state.js usa noopLogger como default value (`logger = noopLogger`) en lugar de optional chain porque addSession/removeSession/updateSession son warm paths (no hot): el overhead de `noopLogger.info()` es cero en la práctica (función frozen vacía) y el código queda más limpio que `logger?.info` duplicado tres veces."
  - "plane/client.js guarda `this.logger = opts.logger` (undefined si no se pasa) + optional chain `if (this.logger) { ... }` antes de emitir. Razón: request() está en el hot path — retry loops, listPendingTasks polling cada X segundos. Evitar incluso el overhead de construir el objeto de emisión cuando no hay sink."
  - "markSessionStatus() se añade a manager.js pero NO se cablea en los callsites existentes. El wrapper queda disponible para Phase 8 dispatcher. Razón: el plan dice explícitamente 'NO rewiring forzado' — los callsites que hacen updateSession directamente siguen funcionando, y forzar el refactor expandiría el blast radius del plan 07-06."
  - "orchestrator.launch.js emite un log libre (`log?.info('orchestrator.launch.start', ...)`) en vez de orchestrator.review. El evento tipado se reserva para Fase 10 cuando la review real tenga verdict + reason; emitirlo aquí con datos sintéticos romperia el contrato D-09."
  - "KODO_LOG_LEVEL leído inline (`process.env.KODO_LOG_LEVEL || 'info'`) en los hooks en lugar de un módulo central. Razón: los hooks son procesos separados (cada SessionStart/Stop crea un nodo Node distinto), no comparten config runtime con la CLI principal. Un módulo central sería overhead."

patterns-established:
  - "Typed-event emission pattern en hooks: (1) try/catch anidado interno, (2) dynamic import de logger + logger-events, (3) createLogger({sessionId, minLevel}).child({component, plane_task_id}), (4) invocar helper tipado con campos D-XX, (5) swallow any error. Reusable para los 3 eventos restantes en Fases 9-10."
  - "DI logger en factory pattern: `createPlaneProvider(config, { logger })` + `logger?.child({ component: 'plane' })` + forward al constructor del client. Reusable para GitHubProvider futuro cuando se añada."
  - "LOG-12 safe-zone pattern para módulos en el grafo de check.js: importar solo desde logger-noop.js (zero-import). Documentado explícitamente en state.js: 'NEVER logger.js'."

requirements-completed: [LOG-09, LOG-10]

# Metrics
duration: 10min
completed: 2026-04-16
---

# Phase 07 Plan 06: Event Emission + DI Wiring Summary

**4 eventos tipados activos end-to-end (session.start, session.end, plane.api.call, state.transition) y DI logger cableado en 7 consumers — `kodo logs <id>` ahora muestra eventos reales en runtime con LOG-12 guardián verde.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-04-16
- **Tasks:** 5
- **Files modified:** 8

## Accomplishments

- `session.start` emitido en cada SessionStart hook con los 6 campos D-10 (session_id, plane_task_id, provider, project_path, transcript_path, started_at)
- `session.end` emitido en Stop hook justo antes de removeSession con D-09 contract (status + ended_at)
- `plane.api.call` emitido en PlaneClient.request() tras `res.ok`, con duration_ms medido entre fetch start y éxito; retries 429 no emiten (solo intento final exitoso)
- `state.transition` disponible vía `markSessionStatus(taskId, nextStatus, reason, logger)` para dispatchers
- DI logger opcional funcional en los 7 consumers listados en plan
- Smoke end-to-end: `kodo logs sess-golden-01 --json | head -1` devuelve JSON válido de session.start con transcript_path (verificado desde test/fixtures/events-golden.ndjson)
- Full test suite: 174 pass, 1 skip intencional (startup-budget Decision B), 0 fail
- LOG-12 guardián (test/check-isolation.test.js) PASS tras cada una de las 5 tareas

## Task Commits

Each task committed atomically:

1. **Task 1: DI logger en session/state.js** — `033cdf8` (feat)
2. **Task 2: session.start emitter en session-start.js** — `ca6bb81` (feat)
3. **Task 3: session.end emitter en stop.js** — `1897eca` (feat)
4. **Task 4: plane.api.call + DI logger en plane/client.js + provider.js** — `9fd8adf` (feat)
5. **Task 5: DI logger en manager/cmux/orchestrator + markSessionStatus wrapper** — `86eaa51` (feat)

## Files Created/Modified

- `src/session/state.js` — Añadido `import { noopLogger } from '../logger-noop.js'`. Extendidas firmas de `addSession`, `removeSession`, `updateSession` con parámetro opcional `logger = noopLogger` y emisión `info('state.session.added'|'removed'|'updated', ...)`. LOG-12 intacto: solo importa logger-noop.js (zero-import), NUNCA logger.js.
- `src/hooks/session-start.js` — Añadido bloque try/catch anidado antes de `process.stdout.write(output)` dentro de `main()`. Dynamic import de logger.js + logger-events.js, `createLogger` con `KODO_LOG_LEVEL` o 'info', child logger con component/plane_task_id, `sessionStart(log, {...6 campos...})`. El `transcript_path` viene de `input.transcript_path` del payload Claude (undefined activa el fallback de `resolveTranscriptPath` dentro del helper).
- `src/hooks/stop.js` — Análogo a session-start pero justo ANTES de `removeSession(id)` (orden importante para capturar status antes del remove). Campos D-09: `session_id`, `plane_task_id`, `status: session.status`, `ended_at: new Date().toISOString()`.
- `src/providers/plane/client.js` — Constructor acepta `opts.logger`, guardado como `this.logger = opts.logger` (undefined si no se pasa). En `request()`: `const started = Date.now()` dentro del while loop (cada intento tiene su propio timestamp), emisión `planeApiCall(this.logger, {method, path, status, duration_ms})` solo tras `!res.ok` check (los retries 429 NO emiten). Dynamic import de logger-events.js para preservar boundary.
- `src/providers/plane/provider.js` — `createPlaneProvider(config, opts = {})` acepta segundo arg con `{ logger }`. `const logger = opts.logger?.child({ component: 'plane' })` y se forwardea al `new PlaneClient({..., logger})`. Retrocompatible: `createPlaneProvider(config)` sigue funcionando.
- `src/session/manager.js` — Añadido `import { stateTransition } from '../logger-events.js'` + import de `updateSession`. Exportado nuevo helper `markSessionStatus(taskId, nextStatus, reason, logger?)` que lee el status previo via `listSessions().find(...)`, actualiza via `updateSession(taskId, {status: nextStatus})` y emite `stateTransition(childLog, {from, to, reason})` solo si hay logger. Los callsites existentes (`launchWorkItem` etc.) NO fueron rewireados — el plan explícitamente evita expansión de blast radius.
- `src/cmux/client.js` — `run(args, logger?)` acepta logger opcional. Emite `logger?.debug('cmux.exec', {cmd, argc})` antes de execFile y `logger?.warn('cmux.fail', {cmd, stderr})` en el error path. Wrappers externos (`newWorkspace`, `send`, `setColor`, `rename`, `listWorkspaces`, `notify`, `readScreen`) no se modificaron en firma para mantener compat — pueden extenderse en plan futuro si se necesita logger per-wrapper.
- `src/orchestrator/launch.js` — `launchOrchestrator(opts = {})` acepta `{ logger }`. `const log = opts.logger?.child({ component: 'orchestrator' })` + un log libre `log?.info('orchestrator.launch.start', { provider })` al inicio. NO emite `orchestrator.review` — ese evento tipado se entrega en Fase 10 con verdict real.

## Decisions Made

- **noopLogger default vs optional chain:** elegido noopLogger default en state.js (warm path, legibilidad) y optional chain en plane/client.js (hot path, evitar construir el objeto de emisión). Ambos patrones son válidos según el contexto.
- **markSessionStatus queda sin cablear en callsites existentes:** el plan explícitamente dice "NO rewiring forzado". El wrapper está exportado y listo para Phase 8 dispatcher, pero los `updateSession` directos en `launchWorkItem` etc. siguen funcionando.
- **orchestrator.launch emite log libre en vez de evento tipado:** el contrato D-09 de orchestrator.review requiere verdict + reason reales. Emitirlo con datos sintéticos aquí sería incorrecto. Fase 10 lo hace bien.
- **retries 429 NO emiten plane.api.call:** la emisión está DESPUÉS del `if (!res.ok) throw`, así que solo la respuesta exitosa final genera línea de log. Cada intento mide su propio `started` (dentro del while), así que `duration_ms` refleja el último intento, no el acumulado. Si en el futuro se quiere visibilidad del retry, añadir un evento `plane.api.retry` aparte — no ensuciar el contrato de plane.api.call.
- **KODO_LOG_LEVEL leído inline en hooks:** cada hook es un proceso Node nuevo, lee `process.env` en el momento. No vale la pena crear un módulo central de config porque la CLI principal y los hooks no comparten proceso.

## Deviations from Plan

None — plan ejecutado exactamente como fue escrito. Las 5 tareas siguieron el spec literal (incluyendo el comentario explícito del plan sobre "NO rewiring forzado" en Task 5 que evita refactorizar los callsites actuales de updateSession).

---

**Total deviations:** 0
**Impact on plan:** Ninguno.

## Issues Encountered

Ninguno. El único punto de fricción fue la validación mental del orden `sessionEnd` → `removeSession` en Task 3 (si se invierten, el status ya está undefined). El plan ya lo marcaba explícitamente: "ANTES de `removeSession(id)`".

## User Setup Required

None — no hay nuevas variables de entorno mandatorias. `KODO_LOG_LEVEL` es opcional (default 'info'). El usuario final verá eventos tipados automáticamente en `~/.kodo/logs/<session-id>.ndjson` después de la próxima sesión Claude tracked.

## Next Phase Readiness

- **Phase 8 (GSD label + session plumbing):** puede consumir directamente `markSessionStatus(taskId, nextStatus, reason, logger)` del manager para emitir state.transition sin boilerplate.
- **Phase 9 (phase resolver + bootstrap):** necesitará emitir `gsd.phase.resolved` y `gsd.bootstrap` — el patrón de dynamic import + silent-failure está establecido y replicable.
- **Phase 10 (orchestrator verification gate):** orchestrator/launch.js ya tiene logger cableado; solo falta añadir la llamada `orchestratorReview(log, {phase_id, verdict, reason})` en el callsite de la gate real.

No hay blockers.

## Verification

- **Suite completa:** `npm test` → 174 pass, 1 skip, 0 fail.
- **LOG-12:** `node --test test/check-isolation.test.js` → 4/4 pass.
- **Smoke end-to-end:** `mkdir -p ~/.kodo/logs && cp test/fixtures/events-golden.ndjson ~/.kodo/logs/sess-golden-01.ndjson && node bin/kodo logs sess-golden-01 --json | head -1` devuelve JSON válido de `session.start` con `transcript_path` no null.
- **Grep checks (Task 1-5 acceptance criteria):** todos los greps especificados en los `<acceptance_criteria>` retornan los matches esperados (verificado al escribir cada edit).

## Self-Check: PASSED

- FOUND: src/session/state.js (modified)
- FOUND: src/hooks/session-start.js (modified)
- FOUND: src/hooks/stop.js (modified)
- FOUND: src/providers/plane/client.js (modified)
- FOUND: src/providers/plane/provider.js (modified)
- FOUND: src/session/manager.js (modified)
- FOUND: src/cmux/client.js (modified)
- FOUND: src/orchestrator/launch.js (modified)
- FOUND: commit 033cdf8 (feat: DI logger en state.js)
- FOUND: commit ca6bb81 (feat: session.start emitter)
- FOUND: commit 1897eca (feat: session.end emitter)
- FOUND: commit 9fd8adf (feat: plane.api.call + DI)
- FOUND: commit 86eaa51 (feat: DI logger en manager/cmux/orchestrator)

---
*Phase: 07-kodo-logs-cli-event-taxonomy*
*Completed: 2026-04-16*
