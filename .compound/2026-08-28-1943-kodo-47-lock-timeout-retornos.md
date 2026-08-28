---
fecha: 2026-08-28
proyecto: kodo
slug: kodo-47-lock-timeout-retornos
---

## Resumen
Cuatro call-sites (health, dispatcher, gsd/doctor, orphan-sweep) ignoraban el `{ok:false, reason:'lock-timeout'}` de los mutadores de `state.json` y reportaban éxito sobre escrituras inexistentes; ahora comprueban el retorno y avisan con warn.
En orphan-sweep, además de dejar de contar `reported` sin sello, se añadió un `sweptGuard` in-memory por loop que impide re-comentar al proveedor en los ticks siguientes: 15 tests nuevos, suite completa 3391 pass / 0 fail.

## Reto
El ticket pedía "no incrementar `stats.reported` si la marca falló", pero su criterio de éxito exigía además que el sweep no repitiera el comentario en el siguiente tick — y eso no se cumple solo con corregir el contador: sin `orphan_swept_at` en disco la sesión sigue siendo candidata y el proveedor recibe el comentario otra vez. Detectar que el arreglo pedido era insuficiente para el criterio pedido fue el trabajo real; la solución (guard in-memory inyectado, no module-level, para no contaminar entre tests) obligó a un cambio algo mayor que el enunciado literal.

## Propuesta de skill
Una skill `audit-result-returns` que, dado un módulo que exporta funciones con retorno `{ok:true}|{ok:false, reason}`, localice todos los call-sites del repo que descartan ese retorno y clasifique cada uno por consecuencia (telemetría mentirosa / efecto externo duplicado / silencio inocuo) — el trabajo manual de esta sesión fue exactamente ese grep + análisis caso por caso.
