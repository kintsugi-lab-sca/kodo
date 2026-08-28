---
fecha: 2026-08-28
proyecto: kodo
slug: kodo-37-migracion-state-bajo-lock
---

## Resumen
La migración v2→v3 de `state.json` pasó a publicarse bajo el lock global y con el tmp+rename único de `saveState`, con un contador intra-proceso (`stateLockDepth`) que evita reentrar en un lock O_EXCL y un fail-safe que migra solo en memoria cuando el lock está tomado.
Cerrado con 3 tests multiproceso nuevos (el determinista verificado RED contra el código previo) y `npm test` completo en 3171 pass / 0 fail.

## Reto
El ticket señalaba a los escritores, pero éstos ya llegaban a la migración con el lock en la mano (`withStateLock → runUnderStateLock → loadState`); el expuesto era el **lector puro**. Eso convirtió el arreglo obvio ("envolver en `withStateLock`") en un auto-deadlock degradado a timeout, y obligó a distinguir "no tengo el lock" de "ya lo tengo" antes de tocar nada.

## Propuesta de skill
Una skill de auditoría de rutas de escritura: dado un fichero de estado compartido, mapear todas sus escrituras y, para cada una, quién sostiene el lock en cada camino de llamada — el bug aquí no era el `writeFileSync`, sino que un mismo punto se alcanzaba con y sin lock según el caller.
