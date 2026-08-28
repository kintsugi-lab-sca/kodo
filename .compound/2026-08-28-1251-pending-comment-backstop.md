---
fecha: 2026-08-28
proyecto: kodo
slug: pending-comment-backstop
---

## Resumen
KODO-36: el comentario del backstop de cierre deja de perderse cuando el provider está caído — se persiste como marcador en la clave aditiva `state.pending_comments` y el loop del orphan sweep lo reintenta hasta publicarlo una sola vez.
Suite completa verde (3123 pass / 0 fail), commit `0f13176` local en la rama del worktree, tarea en «In review».

## Reto
La primera versión del test escribió en el `~/.kodo` REAL: `config.js` evalúa `join(homedir(), '.kodo')` en MODULE-LOAD, así que cualquier import estático que arrastre `state.js` —aquí, el propio módulo bajo prueba— rompe el aislamiento de HOME antes de que `before()` llegue a redirigirlo. Se detectó en la primera corrida, se limpió con backup, y obligó a partir los tests en dos ficheros: la mitad pura (DI, cero FS) y la mitad de persistencia (import dinámico post-HOME + seed v3).

## Propuesta de skill
Una skill `kodo-test-home-isolation` que, antes de escribir un test que toque state.json, resuelva el grafo de imports estáticos del fichero y avise si alcanza `state.js`/`config.js` — convirtiendo en check mecánico la trampa que hoy solo está documentada en el docblock de `test/state/handoff-state.test.js`.
