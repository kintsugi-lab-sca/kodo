---
fecha: 2026-07-28
proyecto: kodo
slug: v019-cierre-milestone
---

## Resumen
Cerrado el milestone v0.19 (inbox de capturas + fix `stealLock` + saneo de deuda): 4 fases archivadas, ROADMAP colapsado, PROJECT/STATE/RETROSPECTIVE evolucionados y tag `v0.19` creado en local.
Cierre verificado — 15/15 requirements, 4/4 fases `passed`, suite 2364 → 2590 (0 fail); commits y tag pendientes de `git push`.

## Reto
El CLI `milestone complete` extrae los one-liners de todos los SUMMARY sin filtrar, así que la entrada de MILESTONES.md llegó con 17 bullets, tres de ellos literalmente «Nada de código» (planes doc-only). Hubo que reescribir la entrada entera a mano agrupando por fase. Además, archivar las fases rompe silenciosamente las rutas `.planning/phases/...` citadas en STATE.md — no hay verificación de enlaces post-archivado.

## Propuesta de skill
Un `gsd-milestone-entry` que sintetice la entrada de MILESTONES.md agrupando one-liners por fase (descartando los doc-only), calcule stats de git/suite automáticamente, y reescriba las rutas `.planning/phases/**` a `milestones/vX.Y-phases/**` en STATE.md y PROJECT.md tras el archivado.
