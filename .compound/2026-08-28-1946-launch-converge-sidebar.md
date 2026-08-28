---
fecha: 2026-08-28
proyecto: kodo
slug: launch-converge-sidebar
---

## Resumen
Se extrajo `convergeProject()` del sidebar doctor y se cableó en `launchWorkItem`, de modo que un workspace creado sin grupo resuelto converge en el acto (create si falta el grupo, add si está suelto, no-op si ya es miembro) en vez de esperar al siguiente arranque frío de `kodo check`.
El launch sigue siendo fail-open total (una línea `group_skipped` y la sesión continúa) y cmux queda confinado a `src/host/`: los dos verbos mutadores nuevos entran por `host._legacy`, sin `ungroup`.

## Reto
El gate `GRP-04` de `manager.test.js` prohibía por diseño CUALQUIER verbo de gestión de grupos en `manager.js` — justo lo que la tarea pedía abrir. Hubo que reescribirlo como allowlist estrecho (create/add sí y solo vía `host._legacy`; rename/delete/ungroup y el argv crudo siguen prohibidos) en vez de borrarlo, para no perder el ratchet que protege la invariante de aislamiento.

## Propuesta de skill
Una skill `invariant-gate-review`: ante un cambio que hace fallar un test de source-assertion (walker/ratchet), localiza el gate, distingue qué parte de la invariante sigue vigente y propone la reescritura mínima del regex en vez de la supresión del test.
