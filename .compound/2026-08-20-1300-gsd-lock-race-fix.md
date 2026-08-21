---
fecha: 2026-08-20
proyecto: kodo
slug: gsd-lock-race-fix
---

## Resumen
Sincronizó el arranque y cierre de la carrera del lock GSD en el test flaky de KODO-24, eliminando la condición de carrera que causaba fallos bajo carga de suite completa. Se mergeó exitosamente a main con fix commiteado y tarea marcada como completada.

## Reto
El test fallaba de forma intermitente cuando se ejecutaba junto con la suite completa porque el holder del lock se liberaba antes de que el test validara el estado esperado.

## Propuesta de skill
Crear `gsd-test-flakiness-debugger`: automatizar la detección de race conditions en tests de sincronización mediante análisis de logs de timing y verificación de barriers de sincronización.
