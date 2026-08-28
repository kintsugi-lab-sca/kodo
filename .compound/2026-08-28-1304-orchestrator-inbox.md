---
fecha: 2026-08-28
proyecto: kodo
slug: orchestrator-inbox
---

## Resumen
Sustituidos los dos nudges por evento al orquestador (fin de sesión, sesión lanzada) por una bandeja persistida en `state.orchestrator_inbox` que la ronda lee, más un aviso de una línea que solo se teclea si el orquestador está idle, con debounce de 30 s.
Commit `d8b36be` en `feat/kodo-53-orchestrator-inbox` (21 ficheros, +2293/−127), suite 3164 verde y los tres criterios de éxito verificados end-to-end; pendiente de `git push` y PR.

## Reto
Cablear el carril nuevo destapó que las suites de `session-end` escribían en el `~/.kodo/state.json` REAL: 59 eventos falsos de fixtures en una sola pasada, en silencio y con los tests en verde. La causa es estructural y ya conocida en el repo (`config.js` evalúa `homedir()` en module-load, así que pisar `HOME` desde un fichero con imports estáticos llega tarde), pero cada seam nuevo la reabre por su cuenta: fue la cuarta y quinta vez que este mismo agujero aparecía tras `plansDir`, `stateWriterFn`, `getOrchestratorFn` y `captureIntegrationFn`. Quedó cerrado con un helper compartido de seams obligatorios, pero nada impide que el siguiente escritor de `state.json` lo vuelva a abrir.

## Propuesta de skill
Un gate de higiene `state-json-isolation`: recorre los ficheros de `test/` que invocan hooks o el dispatcher y falla si alguna llamada omite alguno de los seams declarados como obligatorios en un manifiesto único (hoy `plansDir`, `stateWriterFn`, `getOrchestratorFn`, `captureIntegrationFn`, `enqueueOrchestratorEventFn`, `maybeNotifyOrchestratorFn`) — convertir en fallo de suite lo que hoy solo se descubre mirando el HOME a mano después. No existe candidata previa (`find-skills` no da nada cercano).
