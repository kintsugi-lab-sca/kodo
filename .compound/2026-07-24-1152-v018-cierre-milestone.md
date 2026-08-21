---
fecha: 2026-07-24
proyecto: kodo
slug: v018-cierre-milestone
---

## Resumen
Cierre completo del milestone v0.18 «Higiene del sidebar de cmux»: audit de milestone corrido inline (pre-flight lo detectó ausente; salió `tech_debt` sin blockers — 12/12 reqs, integración 8/8, E2E 4/4) y archivado íntegro (roadmap+requirements+audit+fases → `milestones/v0.18-*`, PROJECT/STATE/ROADMAP/RETROSPECTIVE evolucionados, tag `v0.18`, commits `198c7bd`+`2cc14e8`, push pendiente del operador).
El cierre más barato de los últimos tres: audit único al primer intento gracias a fases pre-verificadas (UAT+SECURITY+VERIFICATION por fase), con 1 override reconocido (debug session `gsd-lock-race-cr01` abierta a propósito — carrera real en `stealLock`, decisión de mantenedor candidata v0.19).

## Reto
El pre-flight de `/gsd-complete-milestone` encontró el milestone sin audit y con deriva documental (ROADMAP con checkboxes sin marcar y tabla 0/9, traceability con 6 filas «Planned» obsoletas, 2 SUMMARYs sin frontmatter `requirements-completed`) — hubo que correr el audit inline y reconciliar a mano antes de archivar; el `gsd-tools summary-extract` tampoco extrae `one_liner`/`requirements_completed` del formato real de los SUMMARYs.

## Propuesta de skill
Un paso de «pre-close reconcile» en gsd (o extensión de `gsd-health`) que, al cerrar cada fase, marque checkboxes de ROADMAP, actualice la traceability y valide el frontmatter de los SUMMARYs — eliminaría la reconciliación manual que hoy se acumula hasta el día del cierre.
