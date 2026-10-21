---
fecha: 2026-10-09
proyecto: kodo
slug: orquestacion-merges-chrome
---

## Resumen
Orquestación de 9 tareas de scp-cmri (SCP-76/77/78/79/83/85/105/117/119/121/131) y 2 nuevas de clipping (ITCLIP-208/209); 11 PRs fusionadas, 6 de ellas probadas en Chrome sobre una BD clonada y worktrees por PR.
Quedan #123 (SCP-133, sin prueba en Chrome posible) para el operador, SCP-134 lanzada y ITCLIP-208 esperando el Excel de Ecovidrio.

## Reto
Montar un entorno de prueba reproducible desde el orquestador sin tocar la BD ni el checkout del operador: pg_dump 17, worker de jobs aparte, versión publicada y runs para que el dashboard tenga datos, y clics de cambio de cuenta que fallan por ref.

## Propuesta de skill
`try-pr-local` ampliada a «scp-cmri test env»: clona la BD, crea el worktree del PR, migra, levanta server+jobs en cmux y siembra versión+runs de la Escuela en un solo comando (hoy son ~10 pasos manuales por PR).
