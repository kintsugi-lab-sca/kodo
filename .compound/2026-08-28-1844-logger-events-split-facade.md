---
fecha: 2026-08-28
proyecto: kodo
slug: logger-events-split-facade
---

## Resumen
Dividí `src/logger-events.js` (1188 LOC, 43 emisores) en 6 módulos de dominio más `events.js`, dejando el monolito como facade puro de re-exports (91 LOC).
Suite completa verde (3168 pass / 0 fail) sin tocar un solo test, y con `main` mergeado resolviendo el conflicto que KODO-34 había abierto en el mismo fichero.

## Reto
El criterio de la tarea decía «cambiando solo paths internos», pero `test/dispatcher-isolation.test.js:66` asserta con regex que `dispatcher.js` importe `{ EVENTS }` literalmente desde `'../logger-events.js'`: repuntar los 22 consumidores a los módulos de dominio habría exigido tocar ese test, justo lo que el mismo criterio prohíbe. Inspeccionar los tests de source-grep ANTES de mover código es lo que evitó el rojo. El segundo reto fue el conflicto de merge: main había añadido `webhookDispatchRetry` al monolito mientras yo lo convertía en facade.

## Propuesta de skill
`split-module-by-domain`: dado un fichero monolítico de exports, trocearlo por bloques `export function` (comentarios previos incluidos) con un generador idempotente, repartir por dominio, generar el facade de re-exports y verificar byte a byte que los cuerpos se movieron verbatim. El generador idempotente es lo que convirtió un conflicto de merge feo en un `checkout --theirs` + re-ejecutar; y el verificador verbatim es lo que permite afirmar "cero cambios de comportamiento" sin leer 1200 líneas de diff.
