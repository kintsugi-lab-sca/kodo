---
fecha: 2026-08-29
proyecto: kodo
slug: gate-max-parallel-toctou
---

## Resumen
El gate de `max_parallel` contaba fuera del lock y la sesión no aparecía en `state.json` hasta segundos después, así que una ráfaga de launches lo saltaba (12 sesiones con el límite en 5).
Ahora contar y reservar son la misma sección crítica de `withStateLock`: 8 procesos concurrentes contra `max_parallel = 3` dejan pasar exactamente 3, y la suite completa sigue verde (3575 pass).

## Reto
La reserva necesitaba una clave estable en `state.sessions`, pero en el punto del gate el `task_id` todavía no está resuelto — lo devuelve el provider varias llamadas más abajo. Adelantar esa resolución habría reordenado `launchWorkItem`, que era justo lo prohibido por la tarea concurrente KODO-19 sobre el mismo fichero. Se resolvió con clave propia `launching:<uuid>` y solape deliberado: `addSession` escribe el registro real antes de que el `finally` retire el placeholder, de modo que el slot nunca queda descubierto.

## Propuesta de skill
Una skill `toctou-audit`: dado un fichero, localizar los pares «leer estado compartido → decidir → escribir» separados por I/O (await, execFile, round-trip de red) e informar de la ventana entre el check y el commit. Los tres bugs de esta serie (KODO-37, KODO-48, KODO-55) son la misma forma, y ninguno se ve leyendo el punto de la lectura por separado.
