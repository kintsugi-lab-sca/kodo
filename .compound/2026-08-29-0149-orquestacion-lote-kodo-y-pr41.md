---
fecha: 2026-08-29
proyecto: kodo
slug: orquestacion-lote-kodo-y-pr41
---

## Resumen
Orquestación de un día completo: PR #41 de JJ (motor de identidad, clipping) revisada, resuelta en local (9 conflictos), aprobada y mergeada, con ITCLIP-124 (sondeo muere a 300 s) detectada en dev y cerrada como PR #53; en kodo, 21 tareas (KODO-34…54) integradas en `main` con suite tras cada merge (3258 → 3561/0).
Dos regresiones cazadas antes de `main` (48: robo del lock no atómico; 50: imports rotos al mover tests), una devuelta por conflictos (44), y el gate `max_parallel` diagnosticado como TOCTOU (12 sesiones con límite 5) → KODO-55.

## Reto
Integrar 12 ramas paralelas del mismo repo sin CI en el flujo: la cola de `kodo integrate` solo se llena cuando la sesión termina (no cuando está idle), así que la integración fue manual (`merge-tree` → merge → `npm test` → push) y cada merge avanzaba `main` y devolvía conflictos a las sesiones aún vivas; el orden de entrada (aisladas primero, traducción/reorganización de tests al final) fue lo que evitó rehacer trabajo.

## Propuesta de skill
`kodo-integrate-batch`: dado un conjunto de sesiones idle/terminadas, calcula conflictos por pares y contra `main`, propone el orden de menor a mayor invasión, integra en cadena con suite tras cada merge (y repetición ×N de tests marcados como flaky), retira el merge y nudgea a la sesión con la aserción exacta si algo rompe, y cierra workspace/worktree/rama/Plane al pasar — hoy todo eso fue a mano en ~10 comandos por tarea.
