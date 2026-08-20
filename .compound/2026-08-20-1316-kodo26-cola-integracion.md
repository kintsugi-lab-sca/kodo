---
fecha: 2026-08-20
proyecto: kodo
slug: kodo26-cola-integracion
---

## Resumen
Implementada la cola de integración de KODO-26: captura al cerrar sesión (reusando el gate de KODO-21), heurística de tier, store aditivo en `state.json` bajo lock, `kodo integrate --ff|--merge|--pr|--drop`, evento NDJSON y superficie en dashboard y `kodo status`.
71 tests nuevos (unit + smoke con git real) y suite completa en verde (2964/2965, 1 skip preexistente); trabajo commiteado en local, pendiente de merge a `main`.

## Reto
El smoke manual con HOME limpio destapó una pérdida silenciosa preexistente: `loadState()` devolvía la forma **v2** cuando no había fichero, así que el primer escritor persistía un v2 con la clave aditiva y la siguiente lectura la borraba en `migrateStateV2toV3` (rebuild exhaustivo que descarta claves desconocidas). Ningún test unitario lo veía porque todos siembran un v3. La misma vía sigue abierta conceptualmente para cualquier clave aditiva futura si alguien vuelve a escribir sobre un state v2 en memoria.

## Propuesta de skill
Un `state-key-additiva` que, al añadir una clave top-level a `state.json`, genere de una vez: el guard defensivo de lectura, la entrada en el typedef `State`, un test de round-trip contra un HOME **vacío** (no solo sembrado) y la comprobación de que la migración vigente no la descarta. Habría cazado el bug de esta sesión antes del primer commit; no existe candidata equivalente en `find-skills`.
