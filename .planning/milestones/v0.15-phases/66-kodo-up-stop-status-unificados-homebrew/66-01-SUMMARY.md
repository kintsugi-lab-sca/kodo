---
phase: 66-kodo-up-stop-status-unificados-homebrew
plan: 01
subsystem: cli
tags: [kodo-up, daemon, net-probe, health-check, orchestrator, di, never-throws]

# Dependency graph
requires:
  - phase: 65-daemon-lifecycle-foundation
    provides: startDaemon/statusDaemon (lifecycle.js detached spawn + PID-alive), runDaemon (run.js foreground funnel)
  - phase: 34-dashboard-tui
    provides: runDashboard + resolveBaseUrl (dashboard/index.js — visor HTTP config-driven)
provides:
  - "probePortInUse — sonda node:net never-throws/never-hang (señal secundaria de idempotencia)"
  - "waitForHealth — readiness gate never-throws/bounded sobre GET /health"
  - "runUp — orquestador ensure-daemon → health-wait → attach dashboard → return (daemon persistente)"
affects: [66-02-stop-status, 66-03-cli-wiring-homebrew, 66-04-brew-spike]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sonda de puerto vía net.connect con timer independiente del socket (never-hang) — cero dep detect-port/get-port"
    - "Orquestador por composición pura de primitivas de Phase 65 detrás de seams DI (_dep), sin reimplementar spawn/PID"
    - "Idempotencia de dos señales: PID-alive (primario, statusDaemon) + probePort (secundario) → attach-if-running"

key-files:
  created:
    - src/cli/up.js
    - test/cli/port-probe.test.js
    - test/cli/health-wait.test.js
    - test/cli/up.test.js
  modified: []

key-decisions:
  - "El timer de probePortInUse NO se hace unref(): debe mantener vivo el event loop hasta resolver por timeout, si no el loop se vacía y node cancela la promesa (bug detectado en TDD GREEN)."
  - "Guard win32 se resuelve ANTES de leer config/red — en Windows runUp no depende de nada más que runDaemon (foreground)."
  - "startDaemon {ok:false} → aviso a stderr + return temprano: no health-wait ni attach si el daemon no arrancó (never-throws, sin process.exit)."

patterns-established:
  - "probePortInUse: connect→true, ECONNREFUSED→false, otro-error→true (conservador), timeout→false (never-hang)."
  - "waitForHealth: espejo del never-throws de fetchStatus (client.js), bounded por deadline, fail-open a false."
  - "runUp: cero signal handlers hacia el daemon (UP-02 LOCKED) — el aislamiento lo da detached:true de lifecycle.js:125."

requirements-completed: [UP-01, UP-02, UP-03, DIST-03]

coverage:
  - id: D1
    description: "probePortInUse — sonda node:net (idempotencia secundaria de kodo up)"
    requirement: "UP-03"
    verification:
      - kind: unit
        ref: "test/cli/port-probe.test.js#probePortInUse (5 casos: connect/ECONNREFUSED/otro-error/timeout)"
        status: pass
    human_judgment: false
  - id: D2
    description: "waitForHealth — readiness gate never-throws bounded sobre GET /health"
    requirement: "UP-01"
    verification:
      - kind: unit
        ref: "test/cli/health-wait.test.js#waitForHealth (200 inmediato, reintento, bounded, no-200)"
        status: pass
    human_judgment: false
  - id: D3
    description: "runUp — orquestador ensure→wait→attach→return, idempotente, daemon persistente"
    requirement: "UP-02"
    verification:
      - kind: unit
        ref: "test/cli/up.test.js#runUp (frío/vivo/puerto-ocupado/win32/cero-signal-handlers/ok:false/fail-open)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Guard win32 → foreground (runDaemon) sin detach ni crash"
    requirement: "DIST-03"
    verification:
      - kind: unit
        ref: "test/cli/up.test.js#runUp win32: runDaemon invocado; startDaemon y runDashboard NO"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 66 Plan 01: kodo up — orquestador + primitivas net/health Summary

**`runUp` compone las primitivas de Phase 65 en el flujo LOCKED ensure-daemon (detached, idempotente) → waitForHealth (never-throws) → attach dashboard como visor → return dejando el daemon vivo, más la sonda `probePortInUse` (node:net) y el guard win32 foreground; todo DI-testeado sin procesos ni red reales.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-02T06:14:00Z
- **Completed:** 2026-07-02T06:22:33Z
- **Tasks:** 3
- **Files modified:** 4 (created)

## Accomplishments
- `probePortInUse(port, host, timeoutMs, deps)` — sonda node:net never-throws/never-hang, señal secundaria de idempotencia; cero deps npm (elimina detect-port/get-port).
- `waitForHealth(baseUrl, opts, deps)` — readiness gate never-throws sobre `GET /health`, bounded por deadline, reintenta ante ECONNREFUSED, fail-open a `false`.
- `runUp(deps)` — orquestador ensure→wait→attach→return, idempotente (attach-if-running / puerto-ocupado), guard win32 foreground, y CERO signal handlers hacia el daemon (UP-02 LOCKED).

## Task Commits

Cada tarea se commiteó atómicamente (TDD → test rojo → feat):

1. **Task 1: probePortInUse (UP-03)** — `4ff5739` (test) → `adc62d5` (feat)
2. **Task 2: waitForHealth (UP-01)** — `88970c3` (test) → `710ac96` (feat)
3. **Task 3: runUp orchestrator + win32 guard (UP-01/02/03, DIST-03)** — `422f0f5` (feat, con test/cli/up.test.js)

_Note: Task 1 y 2 son TDD (2 commits cada una: RED → GREEN). Task 3 es type=auto (implementación + test en un commit)._

## Files Created/Modified
- `src/cli/up.js` — probePortInUse (sonda net), waitForHealth (health gate), runUp (orquestador) — cabecera `// @ts-check`, comentarios densos en español, cero deps npm.
- `test/cli/port-probe.test.js` — 5 casos DI (server real / ECONNREFUSED real / timeout / errores inyectados).
- `test/cli/health-wait.test.js` — 4 casos DI con clock/sleep inyectados (sin esperas reales).
- `test/cli/up.test.js` — 7 casos DI (frío/vivo/puerto-ocupado/win32/UP-02 cero-handlers/ok:false/fail-open).

## Decisions Made
- **Timer de probePortInUse sin `unref()`:** el primer intento con `unref()` causó `cancelledByParent` ("Promise resolution is still pending but the event loop has already resolved") en la rama timeout — al no haber otro trabajo pendiente, el loop se vaciaba antes de disparar el timer. Se quitó el `unref()` para que el reloj mantenga vivo el loop hasta resolver. Es correcto también en producción: el timer se `clearTimeout` en cuanto el socket resuelve.
- **Guard win32 primero, antes de leer config/red:** en Windows `runUp` solo depende de `runDaemon` (foreground); no carga config ni sondea puertos.
- **startDaemon `{ok:false}` → return temprano:** sin health-wait ni attach si el daemon no arrancó (never-throws, sin `process.exit`).

## Deviations from Plan

None - plan executed exactly as written. (El bug del `unref()` fue un fallo de implementación detectado y corregido dentro del ciclo TDD GREEN de Task 1, no una desviación del plan.)

## Issues Encountered
- **Rama timeout cancelada por el event loop (Task 1 GREEN):** el `setTimeout(...).unref()` inicial dejaba morir el loop antes del disparo → 3 subtests `cancelledByParent`. Resuelto quitando el `unref()`. Suite completa verde tras el fix.

## User Setup Required
None - no external service configuration required. (El wiring de `kodo up` en cli.js y el packaging Homebrew son de Plan 66-03; el spike real de `brew services` es Plan 66-04.)

## Next Phase Readiness
- `runUp` exportado y listo para cablearse en `src/cli.js` (Plan 66-03) — este plan NO lo registra en el CLI a propósito.
- `probePortInUse`/`waitForHealth`/`runUp` son primitivas estables reutilizables por 66-02 (stop/status) si hiciera falta.
- Verificación: `node --test test/cli/{port-probe,health-wait,up}.test.js` → 16/16 verde; `npm test` → 1689 pass / 0 fail / 1 skip (sin regresiones); cero imports npm nuevos en src/cli/up.js.

## Self-Check: PASSED

All 4 created files exist on disk; all 5 task commits (4ff5739, adc62d5, 88970c3, 710ac96, 422f0f5) present in git history.

---
*Phase: 66-kodo-up-stop-status-unificados-homebrew*
*Completed: 2026-07-02*
