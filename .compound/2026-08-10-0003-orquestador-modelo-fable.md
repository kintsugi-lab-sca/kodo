---
fecha: 2026-08-10
proyecto: kodo
slug: orquestador-modelo-fable
---

## Resumen
Añadida la clave `claude.orchestrator_model` (default `fable`) que desacopla el modelo del orquestador del de las sesiones de trabajo, con `fable` incorporado al set de validación y al editor del dashboard.
Suite completa en verde (2596 pass) y tarea KODO-12 movida a "In review" con el commit `adb5252` pendiente de push.

## Reto
Insertar un campo editable en `getEditableFields` desplaza los índices de todos los siguientes, y varios tests del dashboard navegaban el overlay con un número fijo de ↓ (más un `API_KEY_ROW_INDEX = 11` hardcodeado): 8 tests rojos por un cambio de una línea. Se resolvió derivando el índice del path en los tests en vez de contarlo a mano.

## Propuesta de skill
Una skill `config-key-add` para este repo que, dada una clave nueva de `~/.kodo/config.json`, recorra el checklist completo —`DEFAULT_CONFIG`, validador, `getEditableFields`, shape inerte de `App.js`, fixtures de test y README— y avise de los tests que dependen de posiciones de campo.
