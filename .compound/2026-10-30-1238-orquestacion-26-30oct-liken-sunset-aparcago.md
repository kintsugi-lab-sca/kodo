---
fecha: 2026-10-30
proyecto: kodo
slug: orquestacion-26-30oct-liken-sunset-aparcago
---

## Resumen
Orquestación del 26 al 30-oct: 30 tareas lanzadas y cerradas (liken: alta con cuenta existente, dependabot, pay 12, modales, sunset con análisis de BD y las 3 tareas de cierre; Aparca&Go: diagnóstico v1–v3 y verificación, auditoría de la nueva web, plan v2; SCP: estado para dirección, guion de status, feedback de Teresa con fix; clipping: requisitos, Meltwater, MyNews y envío diario en 4 PRs; kodo: anclado de grupos, Kanvas, `kodo ask`, send-back; Sindicadas: calendarios, estadísticas, menú; Brotli CVE).
Tres reglas nuevas del operador quedaron en la skill: entregar siempre acceso directo a las conclusiones, crear tareas en Backlog (Todo despacha) y pair test en Chrome antes de cerrar sesiones con UI.

## Reto
Las tareas creadas en Todo se lanzaron solas (una tocaba Stripe) y los informes de docs se quedaban en ramas con worktree borrado y `gh pr merge` bloqueado por hook: el operador no podía ver lo entregado.

## Propuesta de skill
`kodo-entrega`: al cerrar una sesión, copia los ficheros de `.planning/` de la rama a `<repo>/.planning/entregas/` (excluido de git), abre Chrome en la URL local si hay UI con un guion de prueba, y escribe el bloque de acceso directo (PR, rutas, URL) para el mensaje del orquestador.
