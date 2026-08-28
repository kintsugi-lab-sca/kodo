---
fecha: 2026-08-28
proyecto: kodo
slug: dispatch-lock-heartbeat
---

## Resumen
Se cerró KODO-48: el dedup lock de dispatch caducaba (TTL 120s) mientras su dueño seguía dentro de `launchWorkItem`, así que un webhook duplicado tardío lo robaba y lanzaba una segunda sesión para la misma tarea.
Se añadió `renewLock` / `startLockHeartbeat` a la primitiva de locks con techo `maxHoldMs`, se subió el TTL a 300s como suelo, y la suite completa quedó verde (3403 tests) tras mergear main.

## Reto
El test que "prueba" el arreglo casi no prueba nada por dos trampas de entorno: el helper de carrera hacía el hold con `Atomics.wait`, que bloquea el event loop y habría impedido latir al heartbeat (el escenario habría medido el bloqueo, no el lock); y la suite completa daba 5-6 rojos que parecían regresiones y resultaron ser flakes de contención de CPU — hubo que correr main sin los cambios para demostrarlo. La lección: un test de concurrencia hay que verificarlo en las dos direcciones (desactivar el arreglo y ver que FALLA), y un rojo en suite paralela no es un rojo hasta compararlo con la base.

## Propuesta de skill
Una skill `verify-fix-bidirectional`: dado un commit con arreglo + test, revierte el arreglo de forma quirúrgica (no el test), corre solo los tests nuevos para confirmar que fallan, restaura, y compara los rojos de la suite completa contra el commit padre para separar regresiones de flakes. Automatiza lo que aquí se hizo a mano con `git checkout <padre> -- src test`.
