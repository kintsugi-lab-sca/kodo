---
fecha: 2026-09-03
proyecto: kodo
slug: auto-dismiss-filas-dead
---

## Resumen
Implementado el auto-dismiss de filas `dead` (KODO-83) como tercer barrido del tick del daemon, con una regla de tres condiciones y fail-safe en toda rama de duda.
Suite completa verde (4376/4377) y ensayo en seco contra el `state.json` real confirmando las tres ramas: descarta, conserva y aplaza.

## Reto
Una feature destructiva sobre datos del operador obliga a invertir el fail-open habitual del repo: aquí «no sé» tiene que colapsar a «no toco». La parte cara no fue el barrido sino averiguar qué paths puede tocar realmente un dismiss —`doctor.execute` enumera el legacy `.bg-shell/<sid>`, no el `worktree_path` persistido— y que `pending.js`, que la tarea señalaba como fuente del estado del provider, no sabe responder por una tarea concreta.

## Propuesta de skill
Una skill de *blast-radius audit*: dada una mutación destructiva que se va a automatizar, rastrea todos los caminos de borrado que dispara aguas abajo (aquí: dismiss → `doctor.execute` → `cleanupWorktree` → `branch -D`) y lista qué protege ya cada capa, para no reimplementar guardas que ya existen ni dejar huecos por asumir que el path persistido es el único. No hay candidata en `find-skills`.
