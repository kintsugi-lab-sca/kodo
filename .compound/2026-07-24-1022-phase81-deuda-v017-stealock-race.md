---
fecha: 2026-07-24
proyecto: kodo
slug: phase81-deuda-v017-stealock-race
---

## Resumen
Cadena GSD completa de la Phase 81 (discuss --auto → plan → execute → UAT → SECURITY → transición): DEBT-01..04 cerrados, WR-01/WR-02 aceptados como deuda (R-81-02), milestone v0.18 al 100% listo para `/gsd-complete-milestone`.
El diagnóstico de DEBT-04 volcó la hipótesis inicial: el flaky de `gsd-lock-race` es una carrera REAL en `stealLock` (ventana no-atómica renameSync→O_EXCL, doble adquisición posible); fix diferido a decisión de mantenedor (R-81-01, candidata v0.19); suite 2364 pass.

## Reto
El propio code review de la fase encontró 2 warnings frescos en los símbolos que la fase tocó (typedef `TaskHandoff` con la semántica antigua; `deriveAnyNext` desalineado del colapso de `nextCell`) — una fase de "saneo de deuda" que genera deuda documental nueva exige que el reviewer corra ANTES del cierre, y la decisión fix-vs-defer quedó como único item de UAT.

## Propuesta de skill
Un gate ligero "review-echo" que, tras `/gsd-code-review N`, cruce los warnings contra los ficheros que la fase acaba de modificar y proponga automáticamente el parche doc-only (o el registro de deferral) antes de la verificación — evitaría el ciclo human_needed por deuda cosmética autoinfligida.
