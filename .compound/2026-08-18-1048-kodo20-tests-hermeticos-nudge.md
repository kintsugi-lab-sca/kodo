---
fecha: 2026-08-18
proyecto: kodo
slug: kodo20-tests-hermeticos-nudge
---

## Resumen
Cerrada la fuga de KODO-20: los dos consumidores de `resolveOrchestratorTargets` llamaban sin deps y leían el `~/.kodo/state.json` real, así que `npm test` daba verde o rojo según si la máquina tenía un orquestador registrado.
Threadeado `getOrchestratorFn` en `session-end.js` y `manager.js`, stub inyectado en todas las invocaciones del hook, y suite nueva que fija la hermeticidad: 2713 pass / 0 fail con orquestador vivo y 83/83 idéntico con y sin registro.

## Reto
Un seam de DI que existe y está bien testeado NO protege de nada si los consumidores no lo threadean: `resolveOrchestratorTargets` aceptaba `deps.getOrchestratorFn` desde KODO-16 y su propio test lo usaba, pero los dos call sites lo ignoraban. El issue además apuntaba mal el segundo suite fallando (vivía en `session-end-handoff.test.js`, no en `session-end.test.js`), y solo se vio corriendo la suite COMPLETA — el fichero citado ya estaba verde tras el primer arreglo. La rama del worktree arrancó 79 commits detrás de `main` y ni siquiera contenía el fichero a arreglar.

## Propuesta de skill
Una skill `test-hermeticity-audit` que, dado un módulo con seams de DI (`deps.xFn || xReal`), recorra todos los call sites y liste los que no threadean el seam, más un walker de higiene generado que impida la reintroducción — exactamente el patrón que aquí hubo que escribir a mano en `orchestrator-target.test.js`.
