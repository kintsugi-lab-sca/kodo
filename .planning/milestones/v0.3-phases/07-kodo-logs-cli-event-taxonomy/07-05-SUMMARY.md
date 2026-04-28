---
phase: 07-kodo-logs-cli-event-taxonomy
plan: 05
subsystem: cli
tags: [cli, commander, logs, ndjson, sub-command, variadic, dynamic-import]

# Dependency graph
requires:
  - phase: 07-kodo-logs-cli-event-taxonomy/07-03
    provides: src/logs/reader.js exportando runLogs(opts) — dump + filtros client-side + follow/session-of delegation
  - phase: 07-kodo-logs-cli-event-taxonomy/07-04
    provides: src/logs/session-lookup.js (resolveSessionIdFromTaskId) — consumido por runLogs cuando --session-of está presente
provides:
  - Sub-comando `kodo logs [session-id]` registrado en src/cli.js entre `status` y `program.parse()`
  - 6 flags expuestos al usuario: -f/--follow, -l/--level, -c/--component, -e/--event-type (variadic), --json, --session-of
  - Action handler async que delega en runLogs vía dynamic import, con error handling consistente con patrón de `launch`
  - End-to-end path CLI → runLogs → NDJSON reader operativo sobre `~/.kodo/logs/`
affects:
  - 07-06 (DI wiring de consumers — el CLI ya es invocable, queda propagar logger root a session/manager/plane/cmux/hooks/orchestrator)

# Tech tracking
tech-stack:
  added: []  # zero new runtime deps preservado (commander sigue siendo la única dependencia)
  patterns:
    - "Sub-comando commander con positional opcional + flag alternativo: `.command('logs [session-id]')` con `--session-of <task-id>` como forma alternativa de resolución"
    - "Variadic option commander 13: `'-e, --event-type <type...>'` → `opts.eventType` es array (ver RESEARCH A4)"
    - "Action handler async con dynamic import lazy-load del módulo pesado (./logs/reader.js) — mismo patrón de `launch`, `status`, `orchestrate`"
    - "Explicit opts mapping `{ follow: opts.follow || false, ... }` antes de pasar a runLogs — shape estable incluso cuando commander deja flags como undefined"

key-files:
  created: []
  modified:
    - src/cli.js

key-decisions:
  - "Insertar el bloque DIRECTAMENTE entre `status` y `program.parse()` — preserva orden alfabético lógico de sub-comandos y evita mover helpers."
  - "NO aplicar `ensureConfig()` al action handler — runLogs sólo lee `~/.kodo/logs/` y no necesita provider config. Coherente con la naturaleza read-only del sub-comando."
  - "Mapeo explícito de opts a parámetros de runLogs (no spread) — garantiza contrato visible entre CLI y reader, facilita future refactor si cambian nombres de flags sin romper runLogs."
  - "Error handling wrapper try/catch idéntico al patrón de `launch` (líneas 183-186) — consistencia interna; exit 1 con mensaje formateado `Error: <msg>`."

patterns-established:
  - "CLI thin wiring pattern: cada sub-comando nuevo en src/cli.js se limita a (1) registrar flags, (2) dynamic-import del módulo de runtime, (3) mapear opts → contract explícito, (4) try/catch → process.exit(1)."

requirements-completed: [LOG-05, LOG-06, LOG-07, LOG-11]

# Metrics
duration: 8min
completed: 2026-04-16
---

# Phase 07 Plan 05: CLI Registration (`kodo logs`) Summary

**Sub-comando `kodo logs [session-id]` expuesto en el binario con 6 flags (follow, level, component, event-type variadic, json, session-of) delegando en runLogs de Plan 03.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-16T11:01:00Z
- **Completed:** 2026-04-16T11:09:30Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `kodo logs --help` imprime los 6 flags + positional `[session-id]`
- `kodo --help` lista los 10 sub-comandos (los 9 previos + `logs`)
- End-to-end: `kodo logs <id>` lee `~/.kodo/logs/<id>.ndjson` y aplica filtros client-side
- `node --test` completo verde (177 pass, 1 skip pre-existente, 0 fail)
- Verificación contra fixture golden (pretty path): 7 líneas totales, 1 con `--level warn`, 2 con `--event-type session.start session.end`, 1 con `--component plane`

## Task Commits

Each task was committed atomically:

1. **Task 1: Registrar `kodo logs [session-id]` en src/cli.js** - `aaef953` (feat)

**Plan metadata commit:** pendiente (lo crea este SUMMARY + handoff al orchestrator).

## Files Created/Modified
- `src/cli.js` — Insertadas 28 líneas nuevas entre `status` (fin en línea 211) y `program.parse()` (línea 213). Nuevo bloque `.command('logs [session-id]')` con todos los flags de D-02, action async que hace `await import('./logs/reader.js')`, mapeo explícito de opts, try/catch con `process.exit(1)`.

## Decisions Made
- **No ensureConfig() en el handler:** runLogs no necesita provider config. Coherente con la responsabilidad read-only del sub-comando y evita flujo interactivo en un CLI pensado para `jq`/`grep` pipelines.
- **Mapeo opts explícito:** elegí `{ follow: opts.follow || false, level: opts.level, ... }` en lugar de spread para dejar visible el contrato entre CLI y reader. Un cambio de nombre en futuras migraciones es localizable con un solo grep.
- **Insertion point entre `status` y `program.parse()`:** única opción que respeta el anchor de `program.parse()` como última acción y deja el helper section (`setNestedValue`, `timeSince`, `ensureConfig`, `interactiveConfig`) intacto.

## Deviations from Plan

None — plan ejecutado exactamente como fue escrito.

---

**Total deviations:** 0
**Impact on plan:** Ninguno — el bloque insertado es copia textual del spec del `<action>` del Task 1.

## Issues Encountered

**Observación no bloqueante** sobre la sección `<verification>` del plan (líneas 156-161): los smoke tests que combinan `--json` con `--level warn` o `--event-type` esperan 1 y 2 líneas respectivamente. Sin embargo, `src/logs/reader.js` (entregado en Plan 03, líneas 75-79) documenta e implementa intencionadamente que `--json` es **passthrough crudo sin filtrar** (consistente con D-03 de 07-CONTEXT.md: "Con `--json` imprime NDJSON crudo (pipe-friendly para `jq`/`grep`)"). Por tanto, el comando correctamente devuelve 7 líneas en ambos casos con `--json`, y las líneas filtradas (1 y 2 respectivamente) cuando se omite `--json` — comportamiento que coincide con el contrato documentado.

- No es un bug ni en Plan 03 ni en Plan 05. El plan de verificación de 07-05 tiene un fragmento internamente inconsistente con su propio D-03.
- **Acción:** documentado aquí para que Plan 06 y/o el verifier de Fase 7 actualicen el script de verificación (quitar `--json` en los smoke de filtros, o ejecutar filtros con pretty-print).
- **No requiere cambios de código.**

## User Setup Required

None — el sub-comando funciona out-of-the-box contra `~/.kodo/logs/`. No hay nuevas variables de entorno ni pasos de configuración.

## Next Phase Readiness

- `kodo logs` queda totalmente invocable end-to-end. Plan 06 (DI del logger en consumers) puede empezar inmediatamente: cada emisor que se cablee pasará a ser visible con `kodo logs <session-id>` sin trabajo adicional de CLI.
- Smoke manual confirmado: `node bin/kodo logs inexistente-sess-999` imprime `No log file at /Users/alex/.kodo/logs/inexistente-sess-999.ndjson` a stderr y exit 1 (comportamiento de runLogs intocado).
- No hay blockers para Plan 06.

## Self-Check: PASSED

- FOUND: src/cli.js
- FOUND: .planning/phases/07-kodo-logs-cli-event-taxonomy/07-05-SUMMARY.md
- FOUND: commit aaef953 (feat: register kodo logs sub-command)

---
*Phase: 07-kodo-logs-cli-event-taxonomy*
*Completed: 2026-04-16*
