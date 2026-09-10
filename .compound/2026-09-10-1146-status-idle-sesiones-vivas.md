---
fecha: 2026-09-10
proyecto: kodo
slug: status-idle-sesiones-vivas
---

## Resumen
Se unificó en `isLiveWorkSession` (`status ∈ {running, idle}` + `alive !== false`) lo que cuenta como sesión de trabajo viva, y lo consumen `isSchedulable`, `check.js`, `health.js` y `buildContextSummary`.
Con ello `kodo check` deja de decir «0 running» con sesiones vivas y el gate de `max_parallel` vuelve a contar los slots ocupados; suite completa verde (4597 pass / 0 fail).

## Reto
El bug real no estaba en ningún filtro sino en el enum del typedef: `idle` era el valor que el hook Stop escribía en cada turno desde junio y no figuraba en la lista documentada, así que cuatro consumidores llevaban dos meses leyendo como inexistentes a la mayoría de las sesiones vivas sin que nada se pusiera rojo.

## Propuesta de skill
Un lint que cruce los literales escritos en un campo (`updateSession({status: X})`, `markSessionStatus(..., X, ...)`) contra el enum de su `@typedef` y falle cuando un writer escriba un valor que el enum no declara — el mismo chequeo habría cazado esto el día que Phase 38 introdujo `idle`.
