---
fecha: 2026-11-10
proyecto: kodo
slug: zombies-chrome-pila-clipping
---

## Resumen
Orquestación 9–10 nov: 7 sesiones zombie reapuntadas tras el reinicio de cmux, 6 tareas lanzadas (3 con prueba en Chrome que cazó 5 fallos antes de la revisión), 4 PRs de Edanray verificadas con suite aislada, SCP desplegado y la pila #59–#67 de clipping integrada por una PR única (#68).
Resultado: 14 tareas a Done, tope de kodo a 15, regla «la sesión prueba en Chrome antes de entregar», canal Mattermost + push para decisiones urgentes, y comando de limpieza de worktrees en la PR #28 de kodo.

## Reto
El push directo a `main` de clipping lo rechazan las reglas del repo y GitHub no cierra las PRs apiladas: hubo que subir el `main` local como rama, abrir una PR única y cerrar las ocho restantes a mano; además `set -- $var` en zsh no parte palabras y el primer cierre masivo falló en silencio.

## Propuesta de skill
Skill `integrar-pila`: dado un repo con PRs apiladas y un `main` local que ya las contiene, verifica reglas de rama, sube la rama de integración, abre la PR única, y tras el merge cierra las apiladas con `merge-base --is-ancestor` y borra sus ramas.
