---
fecha: 2026-08-10
proyecto: kodo
slug: kodo15-sesion-zombi
---

## Resumen
Cerrado el hueco de vitalidad de KODO-15: un reloj persistido `process_dead_since`, sellado solo en la transición observada `process_alive: true → false`, permite que `deriveTarget` mande a `dead` una sesión con proceso muerto y tab viva tras 2 min de gracia.
Suite completa verde (2651 pass) y prueba en vivo con cmux y pgrep reales: `kill -9` → `dead` a los 120 s → el orphan sweep la recoge y emite el comentario de cierre incompleto.

## Reto
La regla ingenua («`process_alive:false` ⇒ muerta») habría marcado como zombis a todas las sesiones adoptadas o reanudadas: `pgrep -f "session-id <id>"` no casa la cmdline de `claude --resume <uuid>` (comprobado en `ps`), así que su `process_alive` es false permanentemente aunque estén trabajando. La guarda de «muerte observada» es lo que separa el fix de una fábrica de comentarios falsos en Plane.

## Propuesta de skill
Una skill de verificación en vivo para bugs de vitalidad de kodo: monta un state en memoria contra el host cmux real y el pgrep real, lanza un proceso señuelo con la cmdline `--session-id <uuid>`, lo mata y traza los ticks de `runReconcileTick` hasta la transición esperada, encadenando `runOrphanSweep` con un provider stub — todo sin tocar `~/.kodo/state.json` ni el provider real. Es el guion que se escribió a mano en esta sesión.
