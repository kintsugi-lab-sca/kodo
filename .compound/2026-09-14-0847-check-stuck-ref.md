---
fecha: 2026-09-14
proyecto: kodo
slug: check-stuck-ref
---

## Resumen
`kodo check` leía `s.identifier` en los HealthReport stuck; ahora `checkStuckSessions` usa `report.ref` y no cuenta como stuck las sesiones con tarea `in_review`.
Resultado: 4 tests nuevos (verificados por mutación), suite en verde (4622 pass) y la tarea ya no lanza el orquestador en cada check por sesiones que esperan revisión.

## Reto
`stuck` en `src/session/health.js` se decide solo por minutos desde `started_at`, así que cualquier sesión viva de más de 30 min es «stuck» trabaje o no; el filtro `in_review` tapa el caso más ruidoso, no la causa.

## Propuesta de skill
Una skill «typedef-drift» que, al tocar un consumidor de un `@typedef` JSDoc, cruce los campos leídos contra el typedef (el `identifier` inexistente lo habría cazado `tsc --checkJs`, que el repo no ejecuta).
