---
fecha: 2026-08-10
proyecto: kodo
slug: kodo11-orphan-sweep
---

## Resumen
Diagnosticado el bug de tareas fantasma contando eventos en `~/.kodo/logs` (0 `session.end` en las 3 afectadas; 201 start vs 170 end en global) e implementado el barrido de sesiones huérfanas en el server más el comentario del backstop enriquecido con el handoff.
Suite completa verde (2608 pass / 0 fail), 3 commits en la rama del worktree y la tarea movida a In review.

## Reto
La hipótesis del ticket («el prompt pide el cierre pero nada lo garantiza») era correcta pero incompleta: el backstop mecánico YA existía desde julio y funcionaba — lo que no existía era cobertura cuando el hook que lo contiene no llega a dispararse. Sin contar eventos en los NDJSON se habría reimplementado un backstop que ya estaba ahí.

## Propuesta de skill
Una skill `kodo-forensics` que, dado un `task_ref` o `session_id`, cruce `state.json` (sessions + history), el NDJSON de la sesión y los comentarios del provider, y devuelva la línea temporal del ciclo de vida con los eventos que faltan — es el trabajo manual que ocupó la primera mitad de esta sesión y se repetirá en cada bug de «la sesión no hizo X».
