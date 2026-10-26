---
fecha: 2026-10-15
proyecto: kodo
slug: orquestacion-15oct-mynews-scp-demo
---

## Resumen
Día de orquestación: 16 tareas cerradas entre clipping (MyNews, Hallon sin login y con región, recortes en segundo plano, Ediciones, editor de reglas, Tono unificado, regla de tema viva, tema Cristal, sync klab) y SCP (139, 140, 141, 142 para la demo del 16-oct).
Limpieza de 25 worktrees huérfanos con regla nueva en la skill; status, guion corto y correo de credenciales de SCP preparados.

## Reto
Alex revocó el permiso de rellenar huecos (#37232) tras dos lanzamientos no pedidos; desde entonces todo lanzamiento va con «go» explícito, y el daemon lanza solo cualquier tarea creada ya con label kodo + assignee (para «crear sin lanzar» hay que omitir el label).

## Propuesta de skill
`kodo-close-session`: cerrar una sesión terminada en un solo paso (/exit + Keep worktree + close-workspace + Done/In Review en Plane + borrar worktree y rama si no hay commits fuera de main), que hoy son 4-5 llamadas a mano por tarea.
