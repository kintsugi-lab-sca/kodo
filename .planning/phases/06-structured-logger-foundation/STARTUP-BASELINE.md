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

## Post-phase measurement

**Measured:** 2026-04-15 (tras Plans 06-01, 06-02, 06-03)
**Host:** Darwin 25.3.0 arm64 (Apple Silicon) — misma máquina que pre-phase
**Runs:** 3 (submuestreo rápido; 10 runs hubiese tardado >11 min y la señal ya es clara con 3)

### Raw measurement

```json
{
  "runs": 3,
  "median_ms": 6206.62,
  "min_ms": 5881.20,
  "max_ms": 65273.20,
  "all_ms": [5881.20, 6206.62, 65273.20]
}
```

### Comparison

| Metric    | Pre-phase  | Post-phase | Delta    | Status                                |
| --------- | ---------- | ---------- | -------- | ------------------------------------- |
| median_ms | 65 759.20  | 6 206.62   | −90.6 %  | within noise — distribución bimodal   |
| min_ms    |  6 158.79  | 5 881.20   | −4.5 %   | stable (fast-path sin pending tasks)  |
| max_ms    | 68 067.71  | 65 273.20  | −4.1 %   | stable (slow-path con spawn cmux)     |

El delta del `median_ms` (−90 %) **NO es una mejora del arranque** — es ruido
de la distribución bimodal [fast-path ~6 s / slow-path ~65 s] con muestra de 3.
En pre-phase (10 runs) la mediana cayó en el slow-path; en post-phase (3 runs)
cayó en el fast-path. La dispersión `min..max` sigue siendo ~11× en ambos
casos, confirmando que el arranque está dominado por I/O (HTTP Plane +
potencial spawn cmux), no por load-time de imports JS.

### Decision

- [x] `test/startup-budget.test.js` demoted to `it.skip()` — **Decisión B** (ver
      `06-CONTEXT.md` sección "Aislamiento del vigilante (LOG-12)"). El test
      conserva el comentario explicativo y el código mock para reactivación
      futura (tras refactor que separe "status snapshot" de "act on status").
- [x] Canal fiable de LOG-12: `test/check-isolation.test.js` (4 `it()`
      endurecidos en Plan 06-04 Task 4.1) — walker transitivo de imports desde
      `src/check.js`. Smoke negativo verificado: al inyectar
      `import './logger.js'` en `check.js`, el test falla con mensaje que
      incluye violators + grafo completo.
- [x] `THRESHOLD_MS` **NO se recalibra** — subirlo para pasar verde enmascara
      regresiones reales; dejarlo en 75 623 ms hubiese seguido pasando trivial.
      Mejor señal: `it.skip` con razón documentada.
- [x] Helper `test/helpers/startup-baseline.js` preservado para invocación
      manual (pre/post refactor, CI opcional no bloqueante).

### Conclusion

No hay regresión del arranque atribuible al logger (consistente con el test
de isolation: `src/logger.js` no está en el grafo alcanzable desde
`src/check.js`). La medición post-phase confirma que Plans 02-03 no
degradaron el arranque del vigilante.
