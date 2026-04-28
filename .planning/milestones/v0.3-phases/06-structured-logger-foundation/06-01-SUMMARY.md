---
phase: 06
plan: 01
subsystem: structured-logger-foundation
tags: [logging, testing, wave-0, nyquist]
dependency_graph:
  requires: []
  provides:
    - test/helpers/logger-fixtures.js (makeTmpHome, readAllLines)
    - test/helpers/startup-baseline.js (baseline measurement script)
    - .planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md (baseline + threshold record)
    - test/logger.test.js (stub suite LOG-01..LOG-04)
    - test/logger-redaction.test.js (stub suite LOG-08)
    - test/check-isolation.test.js (LOG-12 import-graph guard)
    - test/startup-budget.test.js (LOG-12 startup perf guard)
  affects: []
tech_stack:
  added: []
  patterns:
    - "tmpdir fixture con HOME override pre-import dinámico"
    - "spawnSync + process.hrtime.bigint para benchmark de arranque"
    - "regex import-graph walker sobre source files"
    - "t.mock.method para capturar process.stderr.write"
key_files:
  created:
    - test/helpers/logger-fixtures.js
    - test/helpers/startup-baseline.js
    - test/logger.test.js
    - test/logger-redaction.test.js
    - test/check-isolation.test.js
    - test/startup-budget.test.js
    - .planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md
  modified: []
decisions:
  - "Threshold THRESHOLD_MS=75623.08ms derivado mecánicamente del baseline (median=65759.2, factor 1.15)"
  - "kodo check baseline dominated by I/O (Plane API + cmux spawn), not module load-time"
metrics:
  duration: ~6min (incluye 2 runs del benchmark: baseline ~11min + startup-budget ~3.5min)
  completed: 2026-04-15
requirements: [LOG-01, LOG-02, LOG-03, LOG-04, LOG-08, LOG-12]
---

# Phase 6 Plan 01: Wave 0 Test Infrastructure Summary

Establecida la infraestructura de tests (Wave 0 / Nyquist) para el logger estructurado: 4 archivos de test stub, 2 helpers compartidos, y un registro de baseline del arranque de `kodo check` que expone una conclusión relevante sobre el estado real del vigilante.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1.1 | Fixtures + baseline measurement | `1f67afc` | test/helpers/logger-fixtures.js, test/helpers/startup-baseline.js, STARTUP-BASELINE.md |
| 1.2 | Stubs LOG-01..LOG-04 + LOG-08 | `132ace6` | test/logger.test.js, test/logger-redaction.test.js |
| 1.3 | Stubs LOG-12 (isolation + budget) | `0c058d2` | test/check-isolation.test.js, test/startup-budget.test.js |

## Baseline Measured

```json
{
  "runs": 10,
  "median_ms": 65759.2,
  "min_ms": 6158.79,
  "max_ms": 68067.71,
  "threshold_ms": 75623.08
}
```

Derived threshold: `max(50, median * 1.15) = 75623.08 ms` — hardcodeado en `test/startup-budget.test.js`.

## Hallazgo Clave (feedback para Plans 02-04)

El aspiracional LOG-12 (`kodo check <50 ms`) presupone que `check.js` es un **vigilante puro** (solo carga módulos, lee state local, sale). En el estado actual **no lo es**: `runCheckAndAct` invoca `provider.listPendingTasks()` (Plane API HTTP) y, cuando hay pending tasks, `launchOrchestrator()` (spawn cmux + refresh workspace). Los números lo confirman:

- `min=6.2 s` vs `max=68 s` — dispersión de 11× que es imposible para un load-time puro.
- `median=65.8 s` — dominado por red/IO, no por imports.

El threshold derivado (`75.6 s`) hace que `test/startup-budget.test.js` pase trivialmente hoy. Esto es un **guardrail débil hasta que Plans 02-04 decidan**:

1. Refactorizar `src/check.js` separando "status snapshot" (sin red) de "act on status" (con red) — LOG-12 aplica solo al primero.
2. Reinterpretar LOG-12 como "no-regresión del overhead de import" — medir load-time de módulos puros con `--import='data:text/javascript,...'` o similar.
3. Aceptar el threshold mecánico y reconocer que LOG-12 queda efectivamente desactivado como guardián hasta un refactor futuro.

La decisión no bloquea Plan 01: el stub mide lo que el RESEARCH definió medir y registra el número honestamente. STARTUP-BASELINE.md documenta las 3 opciones para el planner de Plans 02-04.

## Verification Run Results

- `node --test test/check-isolation.test.js` → **PASS** (2 tests). `logger.js` no existe en el grafo de `check.js` (trivialmente cierto hoy; guardián real cuando Plan 02 introduzca el archivo).
- `node --test test/startup-budget.test.js` → **PASS** (1 test, `median < 75623 ms`).
- `node --test test/logger.test.js test/logger-redaction.test.js` → **FAIL** con `ERR_MODULE_NOT_FOUND: '../src/logger.js'` (RED esperado de Wave 0, **no** `SyntaxError`).

## Deviations from Plan

Ninguna. Plan ejecutado exactamente como está escrito. Se documentó honestamente que el baseline no es puro load-time — eso es **hallazgo**, no desviación: el plan dice "medir baseline y usar `max(50, baseline*1.15)`", y eso se hizo.

## Known Stubs / Deferred Issues

- `test/logger.test.js` y `test/logger-redaction.test.js` están en estado RED — se resolverán en Plan 02 al introducir `src/logger.js` + `src/logger-noop.js`.
- `THRESHOLD_MS` en `test/startup-budget.test.js` es un guardián débil hasta que Plans 02-04 decidan cómo enforcar realmente LOG-12 (ver sección "Hallazgo Clave" arriba).

## Threat Flags

Ninguno. Los tests solo tocan `$TMPDIR` con sufijos únicos (PID+timestamp) y el benchmark usa `stdio: 'ignore'`. Todas las mitigaciones del `<threat_model>` del plan están aplicadas: `after()` cleanup en ambos test files, nombres únicos por fixture, `rmSync({recursive, force})` tolerante a fallos.

## Self-Check: PASSED

Archivos creados (todos verificados con `ls` / `git log`):
- FOUND: test/helpers/logger-fixtures.js
- FOUND: test/helpers/startup-baseline.js
- FOUND: test/logger.test.js
- FOUND: test/logger-redaction.test.js
- FOUND: test/check-isolation.test.js
- FOUND: test/startup-budget.test.js
- FOUND: .planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md

Commits verificados:
- FOUND: 1f67afc (Task 1.1)
- FOUND: 132ace6 (Task 1.2)
- FOUND: 0c058d2 (Task 1.3)
