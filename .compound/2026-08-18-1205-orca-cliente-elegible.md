---
fecha: 2026-08-18
proyecto: kodo
slug: orca-cliente-elegible
---

## Resumen
Orca queda como cliente elegible junto a cmux: selector `host` en `~/.kodo/config.json` + adapter `src/orca/client.js` / `src/host/orca.js` sobre el contrato `WorkspaceHost` que ya existía desde la Phase 38.
La abstracción aguantó: los 4 métodos del contrato no se tocaron, el coste real fue el vocabulario cmux filtrado en el launch path (`setColor`, `claude --worktree`) y el selector que faltaba en 6 call sites.

## Reto
Nada de esto se podía diseñar leyendo la documentación de Orca: `worktree ps --json` distingue `status: active|inactive` (presencia ≠ vida, al revés que cmux), `--name` se materializa como rama git (rompe con `:` y acentos), y `agents[]` es la única fuente honesta de `needs-input` — descartar `unread` como proxy solo se ve mirando el JSON real. Hubo que arrancar la app, crear worktrees de prueba y borrarlos para fijar cada shape. Queda pendiente el UAT end-to-end con una tarea real y `kodo orchestrate`, que sigue cableado a cmux.

## Propuesta de skill
Un `verify-cli-surface`: dado un binario con `--json`, arrancarlo, ejercitar el ciclo CRUD completo sobre un recurso desechable, guardar los shapes reales como fixtures anonimizadas y limpiar el recurso — que es exactamente el bucle que aquí se hizo a mano tres veces (probe, probe2, smoke) antes de escribir una línea de adapter.
