---
fecha: 2026-07-22
proyecto: kodo
slug: v017-cierre-milestone
---

## Resumen
Milestone v0.17 «Plan vivo por-tarea» cerrado y archivado (5 fases 74-78, 17 plans, 13/13 reqs, Nyquist 5/5, suite 2309 verde al cierre): archivos en `milestones/`, ROADMAP colapsado, PROJECT/STATE/RETROSPECTIVE evolucionados, tag `v0.17` local.
Peculiaridad del cierre: `init.manager` no indexaba las fases 74-78 (solo 999.x del backlog), así que la readiness se derivó del MILESTONE-AUDIT re-ejecutado el mismo día como fuente autoritativa.

## Reto
El CLI `milestone.complete` extrae accomplishments crudos de los SUMMARY (fragmentos tipo «Task 1 — lado escritor») que hubo que curar a mano en MILESTONES.md; además el triple re-audit y el sign-off Nyquist retroactivo ×5 el día del cierre confirman (3er milestone seguido) que el sign-off por-fase sigue desacoplado del flujo de ejecución.

## Propuesta de skill
Extender `gsd-validate-phase` (o el verifier) para auto-disparar el sign-off Nyquist al cerrar cada fase — eliminaría el backfill retroactivo en batch que encarece todos los cierres de milestone.
