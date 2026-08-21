---
fecha: 2026-07-15
proyecto: kodo
slug: phase74-gap-live04-next-clobber
---

## Resumen
Cerrado el gap LIVE-04 de la Phase 74: `upsertTaskHandoff` hacía `next: entry.next ?? null` incondicional, así que un cierre mecánico (que pasa `next: null` por diseño — eso *es* LIVE-03) borraba el `NEXT:` real de la sesión anterior en una secuencia de dos sesiones perfectamente ordinaria.
El fix fusiona solo `next` (`entry.next ?? prev?.next ?? null`, con `prev` leído del `state` del mutator, nunca de un `loadState()` fresco), 2132 tests con 2131 verdes, y los 86 commits publicados en ambos remotos (`origin` y `kintsugi`, ambos en `cb29bb1`).

## Reto
El fix cierra una fuga de datos abriendo su imagen especular: `upsertTaskHandoff` es el **único** escritor de `state.tasks`, nada lo poda, y ninguna rama devuelve `null` una vez que `prev.next` es no-nulo — una tarea terminada arrastra su último `NEXT:` para siempre, y la Phase 75 es justo quien va a renderizarlo y a nudgear sobre él. Queda registrado como warning heredado por el discuss de la Phase 75, junto a su hermano estructural WR-04 (`state.tasks` sin cota).

## Propuesta de skill
`state-field-lifecycle-audit`: al añadir un campo a un estado persistido, verificar que existen las tres rutas —escritura, actualización y **borrado/expiración**— y no solo las dos primeras. Habría cazado el `next` inborrable en el momento de escribir el plan 74-02, no tres agentes después; el patrón se repite en WR-03 (`migrateStateV2toV3` pierde `tasks`) y WR-04, que son el mismo olvido de ciclo de vida en otras dos caras.
