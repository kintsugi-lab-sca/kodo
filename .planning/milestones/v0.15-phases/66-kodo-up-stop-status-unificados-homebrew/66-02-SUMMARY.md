---
phase: 66-kodo-up-stop-status-unificados-homebrew
plan: 02
subsystem: cli
tags: [daemon, cli, stop, status, json, di, lifecycle]

# Dependency graph
requires:
  - phase: 65
    provides: "src/daemon/lifecycle.js (stopDaemon/statusDaemon name-parametrizados)"
provides:
  - "src/cli/stop-status.js — runStopUnified(opts, deps) y runStatusUnified(opts, deps)"
  - "Handlers daemon-first testeables listos para el wiring en cli.js (Plan 66-03)"
  - "stop daemon-first con fallback legacy server.pid (back-compat kodo start)"
  - "status --json byte-determinista con keys fijas {status, pid}"
affects: [66-03-cli-wiring, kodo-stop, kodo-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Handler CLI extraído a módulo propio para unit-testing DI (cli.js parse() no es testeable)"
    - "Daemon-first con fallback legacy defensivo (never-throws) — único punto de fallback del milestone"
    - "--json byte-determinista sin createFormatter (molde runPollingStatusCli)"

key-files:
  created:
    - src/cli/stop-status.js
    - test/cli/stop-unified.test.js
    - test/cli/status-unified.test.js
  modified: []

key-decisions:
  - "stop SÍ hace fallback a server.pid legacy cuando no hay daemon (D-04), para no regresionar kodo start→kodo stop; polling standalone queda intacto."
  - "status reporta el estado del DAEMON (running/idle), NO la vista legacy listSessions (D-04 LOCKED); el detalle de sesiones vive en el dashboard + GET /status."
  - "--json conserva el vocabulario del daemon ('running'|'idle') para paridad scriptable con kodo polling status; el texto TTY usa 'stopped' para idle."

patterns-established:
  - "Seams DI por función (_stopDaemon/_stopServer/_write/_err/_fmt para stop; _statusDaemon/_write/_stdout para status)"
  - "server.js se importa LAZY (pesado: http/cmux/reconcile) solo en la rama de fallback"

requirements-completed: [UP-05]

coverage:
  - id: D1
    description: "kodo stop es daemon-first: stopDaemon('kodo') tumba el daemon; stopped/stale → sin fallback; notRunning → fallback legacy stopServer 1×; never-throws."
    requirement: "UP-05"
    verification:
      - kind: unit
        ref: "test/cli/stop-unified.test.js#runStopUnified"
        status: pass
    human_judgment: false
  - id: D2
    description: "kodo status --json byte-determinista: keys fijas {status, pid} siempre presentes, sin ANSI; running→pid, idle→null; exit 0 siempre."
    requirement: "UP-05"
    verification:
      - kind: unit
        ref: "test/cli/status-unified.test.js#runStatusUnified"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-02
status: complete
---

# Phase 66 Plan 02: kodo stop/status unificados (daemon-first) Summary

**Módulo `src/cli/stop-status.js` con `runStopUnified` (stop daemon-first + fallback legacy server.pid) y `runStatusUnified` (status daemon-first con `--json` byte-determinista de keys fijas), todo DI-testeado.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-02T06:27:31Z
- **Completed:** 2026-07-02T06:31:42Z
- **Tasks:** 2
- **Files modified:** 3 (creados)

## Accomplishments
- `runStopUnified`: `stopDaemon('kodo')` primero (SIGTERM→5s→SIGKILL vía lifecycle.js); `stopped`/`stale` → éxito sin fallback; `notRunning` → fallback lazy a `stopServer` legacy exactamente 1× (back-compat de `kodo start`). Never-throws.
- `runStatusUnified`: reporta el estado del daemon; `--json` emite una línea byte-determinista `{status, pid}` con keys fijas y sin `createFormatter` (DX-06); rama TTY colorea vía `createFormatter` (color isolation LOCKED). Exit 0 siempre (D-13).
- 9 unit tests DI (4 stop + 5 status), `--json` comparado byte-exacto con `===`. Full suite: 1698 pass / 0 fail. Sin tocar cli.js, server.js ni polling (invariante LOCKED).

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: runStopUnified — stop daemon-first + fallback legacy** - `ac4f7f9` (feat)
2. **Task 2: runStatusUnified — status daemon-first + --json byte-determinista** - `66fc643` (feat)

## Files Created/Modified
- `src/cli/stop-status.js` - Handlers `runStopUnified`/`runStatusUnified` daemon-first con seams DI; `server.js` importado lazy solo en el fallback.
- `test/cli/stop-unified.test.js` - 4 casos DI (stopped/stale/notRunning/never-throws), captura stdout/stderr.
- `test/cli/status-unified.test.js` - 5 casos DI, `--json` byte-comparado con `===`, keys/orden verificados.

## Decisions Made
- **Fallback legacy en stop (D-04):** `stop` cae a `stopServer` (server.pid) cuando no hay daemon, para no regresionar `kodo start`→`kodo stop`. Documentado en código como el único punto de fallback legacy del milestone.
- **status reporta el daemon, no listSessions (D-04 LOCKED):** cambio de comportamiento explícito en comentarios; el detalle de sesiones vive en el dashboard + `GET /status`.
- **`--json` conserva 'running'|'idle':** paridad scriptable con `kodo polling status`; el texto humano TTY usa 'stopped' para idle.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `runStopUnified`/`runStatusUnified` listos para el wiring trivial en cli.js (Plan 66-03, Wave 2), que importará AMBOS módulos (up.js de 66-01 + stop-status.js de 66-02).
- Cero cambios en el legacy `kodo start`/`polling` (invariante LOCKED verificado por kodo-start-regression.test.js).

## Self-Check: PASSED

---
*Phase: 66-kodo-up-stop-status-unificados-homebrew*
*Completed: 2026-07-02*
