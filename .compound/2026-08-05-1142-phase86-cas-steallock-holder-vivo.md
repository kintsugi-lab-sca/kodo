---
fecha: 2026-08-05
proyecto: kodo
slug: phase86-cas-steallock-holder-vivo
---

## Resumen
Pipeline GSD completo (discuss → plan → execute → review → verify) de la Phase 86: CAS simétrico en la rama PRESENT de `stealLock` que cierra la carrera de 2º orden con holder VIVO (R-82-01), más harness de tres procesos reales, mordida verificada y ventana residual declarada sin adornos.
LOCK-04..07 completos y verificados de forma independiente; suite 2590 → 2599 con 0 fallos, 18 commits en `main` sin push.

## Reto
El code review post-ejecución encontró un BLOCKER que ningún gate anterior detectó: el nuevo lector de identidad colapsaba «ausente» e «ilegible», de modo que un lock presente-pero-ilegible (`EACCES`) dejaba de ser robable — una regresión de comportamiento medida contra el commit base que violaba el criterio 5 de la propia fase. La cobertura existente de «lock corrupto» solo ejercitaba la subclase *parse-failure*, nunca *read-failure*, y por eso pasó verde. El review es advisory por diseño; tratarlo como tal habría shippeado la regresión.

## Propuesta de skill
Una skill `regression-probe-base` que, tras ejecutar una fase, ejecute automáticamente un probe diferencial de comportamiento (no solo la suite) entre el commit base de la fase y HEAD sobre los símbolos públicos que la fase tocó — exactamente lo que el revisor hizo a mano con `EACCES`/`EISDIR` para demostrar CR-01. Complementaría a `gsd-code-review`, que la encontró por lectura, no por medición.
