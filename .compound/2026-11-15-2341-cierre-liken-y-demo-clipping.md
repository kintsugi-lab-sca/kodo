---
fecha: 2026-11-15
proyecto: kodo
slug: cierre-liken-y-demo-clipping
---

## Resumen
Orquestación del día del cierre de Liken (3 PRs, deploy manual y `sunset:cancel_renewals` en Stripe live, 196 suscripciones acotadas, 0 errores) y de la preparación de la demo de envío diario de Clipping del 16-nov.
Resultado: Liken cerrado antes de las 17:54 del 13-nov; DEV de Clipping en `0d1d73f` con catalán, árabe RTL y vista de montaje probados en Chrome con el modelo real; PRs de klab mal ubicadas cerradas o movidas a Roman.

## Reto
Di un orden de merge para tres PRs de Liken comprobando solo que estaban al día con `main`, no que chocaran entre ellas: las tres añadían `lib/tasks/sunset.rake` y la tercera dio conflicto con el reloj corriendo, además de un merge que GitHub rechazaba y hubo que hacer en local.

## Propuesta de skill
Una skill «pre-merge-train» que, dada una lista de PRs de un repo, simule los merges en orden con `git merge-tree`, liste los ficheros en conflicto y el estado de CI de cada una, y devuelva el orden seguro con los comandos listos para el operador.
