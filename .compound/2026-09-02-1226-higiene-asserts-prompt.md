---
fecha: 2026-09-02
proyecto: kodo
slug: higiene-asserts-prompt
---

## Resumen
Auditados los `includes()` sobre texto de prompt/skill en `test/` y despineados encabezados y prosa en 4 ficheros de test, conservando placeholders, comandos, marcadores, calls, labels y literales de log.
Verificado con mordida deliberada en los dos sentidos: reescribir la prosa de `prompt.md` deja la suite entera verde (4008 pass) y romper cualquier contrato la pone roja.

## Reto
La sustitución no trivial no fue borrar asserts, sino encontrar el aserto equivalente: «el bloque gated se retira entero» sólo es robusto si se deriva del propio fichero (localizar el bloque por marcadores y comprobar que ninguna de sus líneas sobrevive), y «el encabezado compuesto en código» sólo deja de ser prosa si se exporta como constante — el patrón que `HANDOFF_HEADING` ya tenía y nadie había extendido a `CONTEXT_HEADING`.

## Propuesta de skill
Una skill `audit-text-asserts`: dado un fichero fuente de texto (prompt, skill, plantilla), lista los asserts de la suite que lo pinean, los clasifica con la tabla contrato/prosa y ejecuta automáticamente la doble mordida (reescribir prosa -> debe quedar verde; borrar un literal de contrato -> debe quedar rojo).
