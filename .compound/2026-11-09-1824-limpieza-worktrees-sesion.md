---
fecha: 2026-11-09
proyecto: kodo
slug: limpieza-worktrees-sesion
---

## Resumen
Nuevo `.claude/skills/worktree-cleanup/sessions.py`: borra un worktree de sesión solo con tarea Done, 0 commits propios, árbol limpio y sin sesión viva; simula por defecto y falla cerrado. Test e2e con Plane falso (PR deikka/kodo#28).
La simulación real da 0 borrables de 23: 7 con tarea Done fallan solo porque tienen `.compound/` sin seguimiento.

## Reto
Las sesiones dejan su resumen compound sin seguimiento en el worktree, y eso bloquea la limpieza para siempre. Falta decidir dónde se guardan esos resúmenes (commit en la rama o copia al checkout principal) antes de cerrar la sesión.

## Propuesta de skill
`kodo-recycle` o el cierre de sesión de kodo deberían commitear o mover `.compound/` antes del «Keep worktree», para que `sessions.py` pueda limpiar el worktree.
