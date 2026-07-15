---
phase: 66-kodo-up-stop-status-unificados-homebrew
plan: 05
subsystem: daemon
gap_closure: true
tags: [epipe, logging, daemon, launchd, brew-services, hardening, tdd]

# Dependency graph
requires:
  - phase: 65
    provides: runDaemon (src/daemon/run.js) — funnel foreground único del daemon
  - phase: 66-03
    provides: fórmula kodo.rb + `kodo daemon run` bajo launchd/brew services
  - phase: 66-04
    provides: spike brew-services que DESTAPÓ el flood EPIPE bajo launchd
provides:
  - "Logging del daemon EPIPE-safe: bajo brew services/launchd un pipe roto ya NO produce flood infinito"
  - "makeSafeConsoleWriter / getLogBuffer exportados en server.js (testeable vía DI)"
  - "Guards 'error' idempotentes en process.stdout/stderr instalados en el entrypoint del daemon"
affects: [homebrew, brew-services, release-v0.15.1]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Writer de console EPIPE-safe: pushLog SIEMPRE primero, luego try/catch alrededor del write original que TRAGA el error y NUNCA re-loguea (re-loguear recursa)"
    - "Guard de stream idempotente vía tag (__kodo_epipe_guard) para no acumular listeners cuando runDaemon corre N veces en el mismo proceso (evita MaxListenersExceededWarning)"
    - "Hardening scoped al entrypoint (run.js), NO al module load global → legacy kodo start byte-idéntico (UP-06)"

key-files:
  created:
    - test/daemon/logging-epipe-safe.test.js
  modified:
    - src/server.js
    - src/daemon/run.js

key-decisions:
  - "El buffer in-memory de /logs (pushLog) corre ANTES del write a stdout/stderr: /logs sigue mostrando la línea aunque el pipe esté roto"
  - "En un fallo de write NO se loguea nada — reescribir en el pipe roto es exactamente lo que auto-sostiene el bucle EPIPE"
  - "Los guards se instalan en runDaemon (no en el load de server.js) para no alterar la semántica de proceso del legacy kodo start"
  - "Re-validación real del fix requiere re-cortar release (v0.15.1) + bump del tap formula + re-correr el spike brew services"

metrics:
  duration: ~15m
  tasks: 2
  files-created: 1
  files-modified: 2
  completed: 2026-07-02

status: complete
---

# Phase 66 Plan 05: Daemon Logging EPIPE-Safe Hardening Summary

Gap-closure del spike `brew services` de Phase 66: el daemon del kodo ya no inunda su log de forma infinita bajo launchd cuando el pipe de stdout/stderr se rompe (EPIPE). Fix defensivo de logging con blast radius mínimo, implementado en TDD.

## El bug (destapado en el spike 66-04)

Durante el spike manual de `brew services`, el daemon (`kodo daemon run` bajo launchd) arrancaba bien (`Server listening on :9090`) y acto seguido inundaba su log de forma infinita con `Error: Failed to write to socket (Broken pipe, errno 32)` (EPIPE). En un TTY (foreground `kodo start`, tests unitarios) el pipe nunca se rompe, así que el fallo solo se manifestaba bajo launchd — razón por la que ningún test unitario lo cazó.

## Root cause (verificado leyendo fuente)

1. `src/server.js:34-42` monkey-patchea `console.log/error/warn` a `pushLog(...)` + la llamada al `console.*` ORIGINAL (que escribe en stdout/stderr).
2. NO existía ningún handler `'error'` sobre `process.stdout`/`process.stderr` (grep vacío).
3. Bajo `brew services`, launchd conecta stdout/stderr a un PIPE. Cuando ese pipe se rompe (EPIPE / "Broken pipe, errno 32"), Node emite el error del stream; sin handler queda unhandled, y cualquier intento de loguearlo/reportarlo reescribe en el pipe roto → bucle auto-sostenido.

## El fix (dos superficies, blast radius mínimo)

### `src/server.js` — patch de console endurecido

Se extrae el writer patcheado a una factory `makeSafeConsoleWriter(level, origWriter)` que:
1. Corre `pushLog(level, args)` SIEMPRE primero (el buffer in-memory de `/logs` no depende del éxito del write, así `/logs` sigue mostrando la línea con el pipe roto).
2. Envuelve la llamada al writer original en `try/catch` que TRAGA el error (EPIPE). Crítico: en el fallo NO intenta loguear nada — reescribir en el pipe roto es justo lo que recursa. En un TTY el `catch` nunca se dispara → comportamiento byte-idéntico al patch previo.

`makeSafeConsoleWriter` y `getLogBuffer` se exportan para poder testear el swallow con un writer stub que tira EPIPE, sin abrir un pipe real.

### `src/daemon/run.js` — guards EPIPE en stdout/stderr

Al inicio de `runDaemon` (antes de componer server/polling) se instalan guards `'error'` idempotentes sobre `process.stdout` y `process.stderr` vía `installStreamEpipeGuard`, que tragan el error en silencio y jamás reescriben. Es idempotente (tag `__kodo_epipe_guard`) para no acumular listeners cuando `runDaemon` corre varias veces en el mismo proceso (la suite de tests) y evitar `MaxListenersExceededWarning`. Nuevos deps `_stdout`/`_stderr` (default `process.stdout`/`process.stderr`) permiten conducir el registro/emisión de error vía DI.

El scope es el entrypoint del daemon (`run.js`), NO el module load global, para no tocar la semántica de proceso del legacy `kodo start`.

## Tests añadidos (`test/daemon/logging-epipe-safe.test.js`)

- Writer patcheado (server.js): al tirar el writer original un EPIPE, (a) no lanza, (b) llama al writer exactamente una vez (sin loop/recursión), (c) igualmente puebla el buffer in-memory (pushLog corrió). Cubre `error`, `info` y `warn`.
- `runDaemon` (run.js): registra listeners `'error'` en stdout y stderr (fakes DI), y un EPIPE emitido sobre cualquiera de los dos no lanza (swallow).

## Verificación

- TDD RED confirmado (imports inexistentes / assertions fallando), luego GREEN.
- Suite completa `npm test`: **1701 pass / 0 fail / 1 skip** (era 1698/0/1 antes; +3 tests nuevos). Cero regresión, incluido `test/cli/kodo-start-regression.test.js` (golden UP-06 byte-idéntico).

## Deviations from Plan

None - fix implementado exactamente según spec.

## Re-validación pendiente

El fix es defensivo y está cubierto por unit tests con fakes de pipe, pero la re-validación **real** end-to-end bajo launchd requiere: re-cortar una release (v0.15.1) → actualizar el tap formula (tag + sha256) → re-correr el spike `brew services` y confirmar que el log ya no floodea. Esto queda fuera de este plan (mismo ritual de release documentado en Phase 66).

## Self-Check: PASSED

- Archivos verificados en disco: `test/daemon/logging-epipe-safe.test.js`, `src/server.js`, `src/daemon/run.js`, `66-05-SUMMARY.md`.
- Commits verificados: `bc08307` (RED test), `f2af000` (GREEN fix).
