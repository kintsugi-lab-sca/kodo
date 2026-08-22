---
fecha: 2026-08-22
proyecto: kodo
slug: kodo-30-cleanup-worktree-ausente
---

## Resumen
El cierre de sesión emitía `worktree.cleanup.error` y dejaba ramas mergeadas huérfanas porque `worktree_path` se persistía como `.bg-shell/<sid>` (que Claude Code nunca crea) y porque el worktree real ya no existía cuando corría el hook.
Se persiste ahora el path real, el hook Stop sella `session.branch` mientras el worktree vive, y el cleanup gana un camino explícito «already_gone» que decide sobre la rama persistida — 28 tests nuevos, suite en verde (3092/3093).

## Reto
La causa estaba bifurcada y solo una mitad era visible en el log: el path equivocado (`.bg-shell`) tapaba el problema real, que es que Claude Code ofrece «Remove worktree» al salir y borra directorio Y rama `worktree-<sid>` ANTES de que arranque `session-end.js`. El dato llegó del operador observando el diálogo en otra sesión, no del código; sin él, el arreglo habría cambiado un error espurio por un warn espurio (`branch.kept` sobre una ref ya borrada) sin que ningún test lo delatara.

## Propuesta de skill
Una skill `hook-lifecycle-probe` que, antes de tocar un hook de ciclo de vida, enumere qué recursos (worktree, rama, tab, lock) siguen existiendo en el instante EXACTO en que ese hook corre — con un cierre real instrumentado, no por inferencia del código. Aquí habría dado en una pasada lo que costó dos rondas: leer el log, el repo y esperar la observación del operador.
