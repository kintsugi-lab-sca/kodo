# Phase 76: Convergencia del conteo `pending` - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 76-Convergencia del conteo `pending`
**Mode:** `--auto` (pase único; todas las áreas auto-seleccionadas con la opción recomendada, sin AskUserQuestion)
**Areas discussed:** Fuente única del conteo, Política de frescura en fallo (ORCH-06), Contrato /status y render web, Cobertura de verificación

---

## Fuente única del conteo (ORCH-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Módulo puro compartido con factory DI | Espejo de `src/server/provider-state.js`; server con TTL 30s, check en fresco; hoja de imports mínimos (LOG-12) | ✓ |
| Quitar el caché de `/status` | Ambos leen fresco siempre | |
| Caché cross-proceso en disco | Compartir el dato entre server y check vía fichero | |

**Auto-selected:** Módulo puro compartido con factory DI (recommended default)
**Notes:** `kodo check` es un proceso CLI separado — no comparte memoria con el server, así que la convergencia solo puede ser de código/semántica. Quitar el caché castigaría al provider (la TUI pollea `/status` cada ~2.5s). El caché en disco es el rediseño que REQUIREMENTS §Out of Scope descarta.

---

## Política de frescura en fallo del provider (ORCH-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Last-known-good etiquetado | Resultado discriminado `{tasks, fetched_at, stale}`; el catch sirve el último dato bueno con `stale: true` y su `fetched_at` real; cold-start caído → `[]`/`null`/`true` | ✓ |
| `pending_count: null` en error | Colapsar el conteo a null cuando el fetch falla | |
| Mantener el comportamiento actual con solo mejor logging | Warn más ruidoso, mismo dato sin marcar | |

**Auto-selected:** Last-known-good etiquetado (recommended default)
**Notes:** Null rompería el shape numérico que consume el HTML (`server.js:370`) y pierde información (el último conteo con su edad vale más que nada). La opción 3 no cumple ORCH-06.

---

## Contrato `/status` y render web

| Option | Description | Selected |
|--------|-------------|----------|
| Campos aditivos `pending_stale` + `pending_fetched_at` | Tipos de `pending`/`pending_count` intactos; HTML marca lo stale; TUI sin cambios; cero endpoints nuevos | ✓ |
| Objeto `pending: {tasks, meta}` anidado | Reestructurar el payload agrupando el meta | |

**Auto-selected:** Campos aditivos (recommended default)
**Notes:** Aditivo puro = precedente Phase 40 (`provider_state`); reestructurar rompería consumidores existentes sin beneficio.

---

## Cobertura de verificación de la convergencia

| Option | Description | Selected |
|--------|-------------|----------|
| Tests del módulo + guard source-hygiene | Unitarios de TTL/catch/cold-start con clock inyectado, contrato `/status` en ambas ramas, guard anti-inline de que server y check consumen el mismo módulo; check-isolation verde | ✓ |
| Solo tests unitarios del módulo | Sin guard de fuente única | |

**Auto-selected:** Tests del módulo + guard source-hygiene (recommended default)
**Notes:** Hoy hay CERO tests sobre el carril `pendingCache` (grep en `test/` vacío). Sin el guard anti-inline, una reimplementación futura re-divergiría en silencio — exactamente el bug que esta fase mata.

---

## Claude's Discretion

- Nombre/ubicación del módulo compartido (atención al grafo de `test/check-isolation.test.js`).
- Dedup in-flight de fetches solapados (recomendado espejar `provider-state.js`, no requisito).
- Indicador visual exacto de staleness en el HTML web.
- Forma exacta de consumo en `checkPendingTasks` (resolver TTL 0 vs función `fetchFresh` del mismo módulo).

## Deferred Ideas

None — la discusión se mantuvo dentro del scope de la fase.
