---
fecha: 2026-09-02
proyecto: kodo
slug: aviso-cola-integracion-dispatcher
---

## Resumen
KODO-72: el dispatcher ahora cuenta las entradas `pending` de `integration_queue` del repo destino y avisa —log del dispatcher y evento `integration-pressure` en la bandeja del orquestador— sin bloquear jamás el lanzamiento.
Commit `0099b7be` con 15 tests nuevos; suite completa en 4027 pass / 0 fail y la tarea en *In review*.

## Reto
Elegir dónde vivía el aviso sin inventar superficies: la tentación era un evento NDJSON nuevo (`integration.pressure`), que habría obligado a tocar el golden cerrado de `EVENTS` —44 tipos— justo mientras KODO-73 trabajaba en el mismo fichero. La salida fue reutilizar las dos superficies existentes (el `console.log` del carril `[kodo:dispatch]` y la bandeja que la ronda ya lee), lo que además dejó el diff acotado a un helper y dos llamadas.

## Propuesta de skill
Una skill `kodo-dispatcher-seam` que, ante un cambio en `src/triggers/dispatcher.js`, mapee de una pasada los puntos de retorno, los dos caminos que lanzan (`launched` / `stale_relaunch`) y los seams de `DispatchDeps` — el 80% del tiempo de esta sesión se fue en reconstruir esa secuencia leyendo 800 líneas para saber dónde encajaba una llamada de tres líneas.
