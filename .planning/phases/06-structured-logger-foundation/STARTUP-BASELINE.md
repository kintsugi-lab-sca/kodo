# Phase 6 — Startup Budget Baseline

**Measured:** 2026-04-15T20:36:06Z
**Host:** Darwin 25.3.0 arm64 (Apple Silicon)

## Raw measurement

```json
{
  "runs": 10,
  "median_ms": 65759.2,
  "min_ms": 6158.79,
  "max_ms": 68067.71,
  "threshold_ms": 75623.08
}
```

## Observations

La medición revela que `kodo check` NO es un arranque puro: invoca `provider.listPendingTasks()` (red Plane API) y, cuando hay tareas pendientes, `launchOrchestrator()` (spawn cmux + refresh workspace). Durante esta medición había 4 tareas pendientes y el orquestador ya existía, así que cada run hizo una llamada HTTP a Plane + un nudge cmux.

- `min_ms = 6158.79` — la primera iteración donde (presumiblemente) la API responde rápido y cmux no tarda.
- `median_ms = 65759.2` — dominado por I/O de red y operaciones cmux, no por load-time de JS.
- Dispersión `min..max` (6s..68s) es órdenes de magnitud mayor que la varianza esperable de un arranque Node puro.

El objetivo aspiracional de LOG-12 (`<50 ms`) presupone que `kodo check` sería un **vigilante puro** (solo carga módulos, lee state local, sale). Actualmente no lo es. Esto es una observación de Plan 01 para que Plans 02-04 decidan si:

1. Refactorizar `src/check.js` para separar "status snapshot" (sin red) del "act on status" (con red) — LOG-12 aplicaría solo al primero.
2. Reinterpretar LOG-12 como "no-regresión del overhead de import" midiendo load-time de módulos puros con `--import='data:text/javascript,...'`.
3. Aceptar el threshold derivado mecánicamente (~75 s) y reconocer que LOG-12 queda efectivamente desactivado hasta un refactor futuro.

## Derived threshold

- `THRESHOLD_MS = max(50, median * 1.15) = 75623.08`
- Este valor se hardcodea en `test/startup-budget.test.js` como constante `THRESHOLD_MS` en Plan 01 Task 1.3.
- El test pasará trivialmente con este threshold; su valor real como guardián depende de las decisiones en Plans 02-04 sobre cómo enforcar LOG-12.
- Re-medir si se cambia de host de CI, se añaden imports no-triviales a `src/check.js`, o se refactoriza `kodo check` para ser puro.
