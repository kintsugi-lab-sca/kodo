---
fecha: 2026-08-28
proyecto: kodo
slug: kodo-40-descomponer-app-js
---

## Resumen
Descompuesto `src/cli/dashboard/App.js` (2109 LOC) en siete módulos por *modo de teclado*, no por componente de render: el render de los overlays ya vivía en SessionTable.js, así que lo que hinchaba el fichero eran ~120 literales exportados y un `useInput` monolítico de ~1170 líneas con 15 sub-máquinas.
App.js queda en 893 LOC re-exportando los 81 exports originales (verificado por comparación automática antes/después), con 98 casos unit nuevos sobre handlers que antes eran ramas anónimas intestables y `npm test` verde tras mergear main.

## Reto
El enunciado pedía 5 módulos y App.js <1000 LOC, pero esos 5 solo bajaban a ~1150: los literales y los handlers de fila (Enter/o/O/d) pesaban más de lo que sugería el reparto original. Hubo que añadir `RowActions.js` y `rows.js` — mismo patrón, fuera del enunciado — y comprimir los bloques de comentario de App.js cuya lógica se había mudado. Queda pendiente la decisión humana de si se aceptan esos dos extras, y `SessionTable.js` sigue en 1136 LOC como siguiente candidato.

## Propuesta de skill
Una skill `extract-keyboard-modes` que, ante un componente TUI con un `useInput`/reducer monolítico, mapee las ramas por modo, genere un módulo por modo con handlers que reciban un `ctx` (estado + setters), inserte los re-exports de compatibilidad en el fichero original y verifique automáticamente la paridad de exports antes/después — el paso que aquí evitó la regresión silenciosa en los ~10 tests que importan de App.js.
