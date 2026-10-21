---
fecha: 2026-10-21
proyecto: kodo
slug: orquestacion-20oct-effort-recycle
---

## Resumen
Sesión orquestadora 19-21 oct: KODO-104 (claude.default_effort + dashboard) y KODO-105 (/kodo-recycle) creadas, lanzadas e integradas; ITCLIP-241 (paquete skills presentaciones) entregada y en revisión.
El primer /kodo-recycle real paró en su paso 1 por dos preguntas abiertas al operador, y `kodo integrate --ff` abortó por worktree-dirty hasta commitear launch.js y los .compound.

## Reto
El daemon lanza cualquier tarea con etiqueta kodo + asignado nada más crearla por API, sin esperar el «go» del operador (ITCLIP-241 se lanzó sola): la restricción «no cojas tareas sin preguntar» hay que respetarla creando sin etiqueta.

## Propuesta de skill
Extender kodo-orchestrate con una receta «crear sin lanzar» (crear sin label kodo, añadirla con el go) y hacer que el ritual de /kodo-recycle commitee tier 1 cualquier cambio suelto del repo antes de integrar.
