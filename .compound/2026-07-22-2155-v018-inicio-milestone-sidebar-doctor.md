---
fecha: 2026-07-22
proyecto: kodo
slug: v018-inicio-milestone-sidebar-doctor
---

## Resumen
Milestone v0.18 «Higiene del sidebar de cmux» iniciado el mismo día del cierre de v0.17: promueve la candidata 999.3 del Backlog (sidebar doctor determinista + carril orquestador + reconciliación skill/prompt) más fase de saneo de los items menores del audit. 12 requirements (SDR/ORCH/DEBT) y roadmap de 3 fases (79-81) aprobados y commiteados (186a793, 765bd04, 4e92b36); research saltado por venir la candidata pre-especificada con constraints LOCKED.

## Reto
DEBT-04 (flaky `gsd-lock-race`) entra como requirement de solo-diagnóstico (`/gsd-debug`, jamás fix a ciegas) — habrá que vigilar en plan-phase que no se degrade a un "arreglo rápido" que rompa el invariante de locks de v0.16.

## Propuesta de skill
Un `/gsd-promote-backlog <999.x>` que convierta una candidata del Backlog (goal + constraints + success criteria ya redactados) directamente en milestone sin re-preguntar lo ya decidido — esta sesión fue exactamente ese flujo hecho a mano.
