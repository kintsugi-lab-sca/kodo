---
fecha: 2026-08-28
proyecto: kodo
slug: tests-host-clients-espejo
---

## Resumen
79 tests nuevos para los exports async de `cmux/client.js` y `orca/client.js` (sin seam de
inyección) más `plane/labels.js`, y 5 moves que dejan `test/` reflejando `src/` 1:1 en
`triggers/` y `providers/`. Suite completa 3464 pass / 0 fail tras `git merge main` limpio.

## Reto
Los clientes de host resuelven el binario desde `loadConfig()` y llaman a `execFile`
importado directamente: no hay inyección y `mock.module` no sirve porque `npm test` no pasa
`--experimental-test-module-mocks`. La única puerta abierta era el path del binario en
`~/.kodo/config.json`, así que el seam acabó siendo un binario fake real (script node
ejecutable que registra cada invocación y responde por cola) con `HOME` a tmpdir e import
dinámico. Queda vivo un hallazgo: `resolveLabels` no tiene consumidores en `src/` — borrar
o recablear, decisión fuera de esta tarea.

## Propuesta de skill
Una skill `test-seam-scout` que, dado un módulo sin tests, clasifique su acoplamiento
(parámetro inyectable / import directo / config externa) y proponga el seam más barato ya
usado en el repo, en vez de redescubrir por prueba y error que `mock.module` no está
disponible.
