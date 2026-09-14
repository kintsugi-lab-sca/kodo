---
fecha: 2026-09-09
proyecto: clipping
slug: orquestacion-lote-reglas-e-informes
---

## Resumen
Orquestación de un lote de 13 tareas de clipping (reglas: fallo del motor con Decimal, condiciones por efectivo/propio, listado de tiers; informes: dos periodos, cifra, separadores, dimensiones por nota y por campo propio; NL→regla) más el guión y el acta de la reunión del 7-sep, todo mergeado con suite en verde (1.621 tests).
El mapa del CLAUDE.md pasó a `.planning/MAPA.md` por app para acabar con los conflictos entre PRs paralelos, y la decisión del tier quedó cerrada: se predica del medio, el valor lo pone el cliente con sus reglas.

## Reto
La decisión del tier costó dos rehechos porque redirigí a la sesión por la reacción del operador («es del medio») sin cerrar antes el modelo; la respuesta correcta era parar y exponer las posiciones con su trade-off.

## Propuesta de skill
Un «ritual post-merge» de kodo (`kodo integrate <ref> --close`): pull, suite, Done en Plane, salir de la sesión con Remove worktree, cerrar workspace, borrar rama remota, drop de la cola y ack de la bandeja — hoy son seis comandos a mano por tarea.
