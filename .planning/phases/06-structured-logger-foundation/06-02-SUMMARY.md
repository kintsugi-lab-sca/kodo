---
phase: 06
plan: 02
subsystem: logging
tags: [logging, factory, ndjson, stderr, pino-ergonomics]
dependency_graph:
  requires:
    - "src/config.js exports KODO_DIR"
    - "Plan 06-01 test stubs (test/logger.test.js, test/helpers/logger-fixtures.js) — NOT AVAILABLE in this worktree"
  provides:
    - "src/logger.js: createLogger factory + LEVELS + LEVEL_NAMES + noopLogger re-export"
    - "src/logger-noop.js: noopLogger stub with zero imports"
  affects:
    - "Future consumers (Phases 7–10) can import createLogger for per-session structured logging"
tech_stack:
  added: []
  patterns: [factory-closure, ndjson-appendfilesync, stderr-writesync, ansi-pretty-print]
key_files:
  created:
    - src/logger.js (175 LoC)
    - src/logger-noop.js (28 LoC)
  modified: []
decisions:
  - "No-op stub en archivo separado (src/logger-noop.js) con zero imports — resuelve RESEARCH Open Question Q1 y permite a src/check.js consumirlo sin arrastrar logger.js (LOG-12)"
  - "appendFileSync + '\\n' por línea — atómico hasta PIPE_BUF; simplicidad sobre throughput"
  - "writeSync(2, ...) en lugar de console.error — determinista, no monkey-patcheable"
  - "I/O failures: un único warning pretty por sesión via closure flag, nunca throw"
  - "formatCtxInline excluye base keys (timestamp/level/msg/session_id/component/plane_task_id/phase_id) del sufijo +k=v"
metrics:
  duration: 5min
  completed: 2026-04-15
---

# Phase 06 Plan 02: Logger Factory (createLogger + NDJSON + Stderr Mirror) Summary

Factory `createLogger` con NDJSON a disco y pretty-print stderr mirror, más el stub `noopLogger` independiente — establece el contrato para LOG-01..LOG-04 sin romper el aislamiento del vigilante (LOG-12).

## What Was Built

### `src/logger-noop.js` (28 LoC)
No-op logger stub con zero imports (verificado por `grep -E "^\s*import\s"` que no devuelve match). `noopLogger.child(any)` retorna la misma referencia congelada. Existe en archivo separado para que módulos en el camino de `src/check.js` puedan importarlo sin arrastrar `src/logger.js` al grafo.

### `src/logger.js` (175 LoC)
Factory `createLogger({ sessionId, minLevel })` con closure-captured state (`writeFailedWarned`, `useColor`, `filePath`, `minLevelNum`):

- **NDJSON sink**: `appendFileSync(filePath, JSON.stringify(record) + '\n')` a `~/.kodo/logs/<sessionId>.ndjson`. Reutiliza `KODO_DIR` importado de `./config.js` (no duplica `homedir()+'.kodo'`). `mkdirSync({ recursive: true })` idempotente en el factory.
- **Stderr pretty-print**: `writeSync(2, ...)` con formato `HH:MM:SS LEVEL component msg +ctx`. Siempre espeja `warn`+`error`; espeja `info`/`debug` solo si `stderr.isTTY` y `minLevel` lo permite. Constantes ANSI respetan `process.env.NO_COLOR`.
- **Child bindings**: `root.child({ component, plane_task_id, phase_id })` mergea `boundFields` en cada línea. Recursivo — child de child también mergea.
- **I/O failure handling**: `writeNdjson` atrapa excepciones de `appendFileSync` y emite UN warning pretty por sesión via flag `writeFailedWarned`. Nunca lanza.
- **Validación del factory**: `sessionId` no vacío requerido; `minLevel` debe estar en `LEVELS` (o sino throw).
- **Re-export**: `export { noopLogger } from './logger-noop.js'` para ergonomía de consumidores.

## Verification

### Task-level (automated)

| Task | Verification | Result |
|------|-------------|--------|
| 2.1 | `node -c src/logger-noop.js` | PASS |
| 2.1 | `grep -E "^\s*import\s" src/logger-noop.js` → no match | PASS (zero imports) |
| 2.1 | `noopLogger.child({}) === noopLogger` + `Object.isFrozen(noopLogger)` | PASS |
| 2.2 | `node -c src/logger.js` | PASS |
| 2.2 | grep `import ... from './config.js'`, `appendFileSync(`, `writeSync(2`, `export function createLogger`, re-export noopLogger | PASS (all match) |
| 2.2 | `throw` solo en validación del factory, no en `writeNdjson`/`maybeMirrorToStderr` | PASS (líneas 74, 77) |
| 2.2 | Full suite `npm test` (123 tests pre-existentes) | PASS (123/123) |

### Smoke tests (runtime)

Ejecutados con `HOME=$(mktemp -d)`:

- **LOG-01 niveles**: `createLogger({ minLevel:'info' })` → `log.debug('drop')` no escribe; `log.info('keep')` escribe. `createLogger({ minLevel:'trace' })` lanza error.
- **LOG-02 NDJSON shape**: línea resultante contiene `timestamp` ISO-8601, `level:'info'`, `session_id`, `msg:'hello'`, `x:1` mergeado top-level (no bajo `ctx`).
- **LOG-03 child bindings**: `root.child({ component:'plane.client', plane_task_id:'KL-1' }).warn('x')` produce línea con `component` y `plane_task_id` mergeados.
- **LOG-04 stderr**: warn/error siempre a stderr, ninguna línea empieza con `{`, formato `HH:MM:SS LEVEL ...`.
- **I/O failure**: tras `rmSync` del logDir, 3 llamadas seguidas producen UN solo warning `[kodo:logger] write failed: ENOENT ...` y no lanzan.

## Deviations from Plan

### Ejecutado exactamente como el plan especifica

El código producido sigue literalmente el esqueleto del plan (`<action>` block de Task 2.2), con los siguientes ajustes menores:

1. **`BASE_RECORD_KEYS` extraído a constante module-level** — el plan lo definía inline dentro de `formatCtxInline`. Mover a constante top-level evita recrear el `Set` en cada llamada (micro-opt sin cambio de comportamiento). Misma lista literal.

2. **Anotaciones `/** @type {any} */` en `maybeMirrorToStderr`** — TypeScript bajo `// @ts-check` no infiere que `record.timestamp`, `record.component`, `record.msg` existen después del spread. Añadidas coacciones para silenciar el checker sin alterar runtime.

Ninguna desviación afecta comportamiento ni contrato.

## Blockers & Known Gaps

### Plan 06-01 artifacts no disponibles en este worktree

El plan lista en `<verify>` los comandos:
```
node --test test/logger.test.js test/check-isolation.test.js test/startup-budget.test.js
```

Estos archivos son output de **Plan 06-01** (Wave 0). En este worktree (rebased al commit `8d08cd4`, anterior al merge hipotético de 06-01), los archivos no existen:

- `test/logger.test.js` — ausente
- `test/logger-redaction.test.js` — ausente
- `test/check-isolation.test.js` — ausente
- `test/startup-budget.test.js` — ausente
- `test/helpers/logger-fixtures.js` — ausente
- `test/helpers/startup-baseline.js` — ausente
- `.planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md` — ausente

**Decisión:** NO crear estos archivos aquí. Son responsabilidad de 06-01 y crearlos en este worktree duplicaría el trabajo y causaría conflictos de merge con el worktree de 06-01. El ejecutor del plan 06-02 verificó LOG-01..LOG-04 via smoke tests runtime (documentados arriba) en lugar de los tests de 06-01.

**Acción requerida del orchestrator:** Tras merge de este plan + 06-01, ejecutar la suite completa para confirmar que los tests de 06-01 pasan a GREEN con la implementación de 06-02. Si alguna assertion de 06-01 no matchea el shape de mi implementación, hacer un ajuste menor (típicamente una key del record o el formato exacto de stderr).

### LOG-08 explícitamente fuera de alcance

El redactor de secretos se añade en Plan 03. El test `test/logger-redaction.test.js` (cuando 06-01 lo cree) seguirá en RED hasta Plan 03 — esperado.

### LOG-12 isolation enforcement depende de 06-01

El test de grafo de imports vive en `test/check-isolation.test.js` (Plan 06-01). Verificación manual: `src/check.js` no importa `src/logger.js` (grep explícito):

```
$ grep -E "from\s+['\"].*logger" src/check.js
(no output)
```

## Known Stubs

Ninguno. Tanto `src/logger.js` como `src/logger-noop.js` son completos para LOG-01..LOG-04.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `2ecffd6` | feat | Task 2.1 — add no-op logger stub with zero imports |
| `7050672` | feat | Task 2.2 — add NDJSON logger factory with stderr pretty-print mirror |

## Self-Check: PASSED

Verificado:
- `src/logger-noop.js` existe (28 LoC, zero imports)
- `src/logger.js` existe (175 LoC, `// @ts-check`, KODO_DIR reuse, factory closure, JSDoc completo)
- Commit `2ecffd6` presente en `git log`
- Commit `7050672` presente en `git log`
- `npm test` → 123/123 tests pre-existentes siguen verdes (no regression)
- Smoke tests runtime cubren LOG-01..LOG-04 (niveles, NDJSON shape, child bindings, stderr anti-duplication, I/O failure swallow)
