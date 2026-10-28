---
fecha: 2026-10-28
proyecto: kodo
slug: kodo-109-send-back-feedback
---

## Resumen
Se añadió `kodo send-back` y la tecla `b` del dashboard: comentan «Devuelto:», persisten `tasks[id].send_back` y mueven la tarea a `states.trigger`; la siguiente sesión recibe el feedback en su contexto y lo consume.
20 tests nuevos y `npm test` en verde (4756 pass); audit gate cerrado con un hallazgo corregido (el README no documentaba la tecla ni el comando).

## Reto
Las interacciones ocultas: `upsertTaskHandoff` reconstruía la entrada y borraba el campo nuevo; el backstop de SessionEnd deshacía una devolución hecha sobre una sesión aún viva; y el move relanza vía webhook, así que hay que persistir antes de mover. Queda abierto si el destino es «In Progress» (trigger) o «Todo».

## Propuesta de skill
Una skill «kodo-state-field» con un checklist para añadir un campo a `state.tasks`/`sessions`: qué escritores reconstruyen la entrada, qué hooks lo leen o lo consumen y qué backstops podrían deshacer el efecto.
