---
fecha: 2026-08-28
proyecto: kodo
slug: kodo-38-saneo-prompt-orquestador
---

## Resumen
`buildContextSummary` metía el título del proveedor verbatim en el prompt del orquestador; ahora pasa por `stripForPrompt` (tercer carril de saneo, junto a render y keystroke) y va envuelto en `<task_title>…</task_title>`.
La otra mitad va en `prompt.md`: una sección que declara que lo delimitado es dato y no una orden — 3186 tests en verde tras mergear `main`.

## Reto
El saneo por sí solo no arregla prompt-injection: `stripControlChars` neutraliza terminal, no un LLM. Lo que hacía falta era decidir qué vector cambia al cambiar de destinatario — aquí el `\n` REAL, que el carril de render preserva a propósito, pasa a ser estructura markdown falsificable — y aceptar que la prosa hostil debe sobrevivir intacta (es el nombre real de la tarea) mientras el envoltorio y la cota son lo único que se garantiza.

## Propuesta de skill
Una skill `untrusted-rail-audit`: dado un campo que llega de un proveedor externo, enumera sus destinos (render / keystroke / prompt / shell / fichero) y comprueba que cada callsite usa el saneador de SU carril — el bug de esta tarea fue exactamente un carril nuevo sin saneador, con los otros dos ya bien cubiertos.
