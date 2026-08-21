---
fecha: 2026-07-25
proyecto: kodo
slug: phase82-steallock-fix-guard-window
---

## Resumen
Phase 82 completa vía cadena --auto (discuss→plan→execute→verify): la carrera de `stealLock` (R-81-01) quedó cerrada con reemplazo in-place atómico + steal-guard `O_EXCL` publicado vía `linkSync`, CR-01 verde 100/100 bajo carga y suite 2370 pass.
El primer fix movió la ventana briefly-empty del lock al guard (`writeFileSync {flag:'wx'}` no es atómico en contenido); el stress loop de 82-02 lo cazó y bloqueó correctamente, forzando el rework antes del cierre.

## Reto
El code review post-ejecución encontró una carrera de 2º orden (82-REVIEW CR-01, holder VIVO + release concurrente vs rename incondicional del branch PRESENT) fuera del criterio LOCK-01 — trazada como R-82-01 en STATE.md §Deferred Items, pendiente de decisión del mantenedor (fix con gate = serializar Case-1/release con el guard, vs riesgo aceptado).

## Propuesta de skill
Una skill "stress-gate" que encapsule el patrón que salvó esta fase — correr un test de carrera N× bajo carga paralela como gate bloqueante previo a commitear cualquier cambio en primitivas de concurrencia (no existe candidata en find-skills; describible en 1 script parametrizable test/iteraciones/concurrencia).
