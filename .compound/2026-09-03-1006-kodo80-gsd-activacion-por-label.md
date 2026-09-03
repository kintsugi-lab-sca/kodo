---
fecha: 2026-09-03
proyecto: kodo
slug: kodo80-gsd-activacion-por-label
---

## Resumen
Se auditó si el orquestador de kodo arrastra el carril GSD a tareas que no lo son: la activación resultó ser estrictamente por label (`kodo:gsd` / `kodo:gsd-quick`), con 0 sesiones `gsd:true` en todo el estado y las únicas invocaciones de agentes `gsd-*` viniendo de skills ejecutadas a mano.
La auditoría destapó una excepción latente: `kodo adopt` deriva `gsd:true` de la mera presencia de `.planning/`, lo que dejaría a una tarea adoptada con un gate de fase espurio y un prompt de bootstrap contradictorio.

## Reto
La pregunta era binaria pero la respuesta honesta no lo era: el carril del dispatcher es limpio y el de `adopt` no, y sin cruzar código con estado real (`state.json` + `subagent_type` en los transcripts) no se distingue "no pasa" de "no ha pasado todavía". Queda pendiente decidir si el fix de `src/adopt.js:144` se abre como tarea propia.

## Propuesta de skill
Una skill `trace-flag` que, dado un flag booleano de `state.json`, enumere todos los puntos de escritura en el código y contraste con su incidencia real en el estado y en los transcripts — habría dado en un paso lo que aquí costó seis greps.
