---
created: 2026-05-28T10:15:33.879Z
title: Surface provider state in dashboard (Plane In Review / GitHub equivalent)
area: dashboard
files:
  - src/server.js:361-413
  - src/providers/plane/provider.js
  - src/providers/github/provider.js
  - src/providers/base.js
  - src/cli/dashboard/SessionTable.js
  - src/cli/dashboard/select.js
  - src/cli/dashboard/format.js
  - test/dashboard-table.test.js
---

## Problem

El dashboard de Phase 36 (TUI-07..TUI-12) pinta solo `SessionRecord.status` — el lifecycle
**interno** de kodo (`'running'|'done'|'error'|'review'`). Ese campo solo transiciona a
`'review'` cuando se ejecuta `kodo gsd verify <session>` rama pass (`src/gsd/verify.js:274`,
único call site fuera de `stop.js`). Si el agente mueve la tarea a "In Review" en Plane
directamente vía Plane MCP — **bypasseando `kodo gsd verify`** — kodo nunca se entera:
`status` se queda `'running'`, y en `/exit` el stop hook marca `'done'` + `removeSession`,
por lo que la sesión desaparece del dashboard pese a seguir siendo trabajo abierto del lado
del provider.

**Caso real que lo destapó (Phase 36 UAT):** ROMAN-150 fue movido a "In Review" en Plane
desde el propio agente Claude Code (vía la herramienta MCP de Plane, "Called plane 3 times").
La sesión nunca pasó por `kodo gsd verify`. Tras `/exit`, ROMAN-150 desapareció del dashboard
aunque la tarea seguía pendiente de merge + push en Plane esperando atención humana. Patrón
reproducible: cualquier flujo donde el agente actualiza el provider sin invocar el verify
canónico de kodo deja sesiones invisibles.

### Por qué Option 3 (esta) vs Option 2 (stop-hook lee provider)

Option 2 (modificar `stop.js` para que lea `provider.getTaskState` antes de marcar `done` y,
si es review, NO `removeSession`) se descartó por dos razones:
1. **Solo captura la transición `/exit`** — si el provider cambia de "In Progress" → "Blocked"
   mientras la sesión sigue activa, kodo nunca lo refleja. Necesitas leer el provider en cada
   poll, no solo en /exit.
2. **Acopla el lifecycle de kodo al estado del provider.** Un fallo de la API de Plane podría
   bloquear `/exit` (fail-open complicado de razonar). Mejor mantener el lifecycle de kodo
   decoupled y ENRIQUECER la vista en el dashboard con un campo separado.

Option 3 (este todo) es más robusta: añade `provider_state` como campo distinto, el dashboard
refleja la realidad cross-system continuamente, y el lifecycle de kodo no se entera.

## Solution

### Cambios cross-layer

1. **`TaskProvider` interface** (`src/providers/base.js` o donde viva el contrato de los 9
   métodos): añadir `getTaskState(taskId): Promise<NormalizedState>` donde
   `NormalizedState = 'in_progress' | 'in_review' | 'blocked' | 'done' | 'unknown'`.
   - Plane adapter: mapea el state name del task ("In Review" → `'in_review'`, "In Progress"
     → `'in_progress'`, "Done" → `'done'`, ...).
   - GitHub Issues adapter: no hay "review" nativo; derivar de labels (`awaiting-review` →
     `'in_review'`) o, si el issue está linkeado a un PR, leer review state del PR. Decisión
     de mapeo abierta — discutir en su discuss-phase.
   - Cross-provider matrix test (patrón de `test/providers/contract.test.js`).

2. **Server `/status` enrichment** (`src/server.js:379-383`): para cada sesión activa, llamar
   `provider.getTaskState(s.task_id)` y añadir `provider_state` al payload enriquecido.
   - **Fail-open**: si la llamada falla / timeout, omitir `provider_state` para esa fila (no
     romper el poll, no bloquear el endpoint).
   - **Rate-limit / cache**: probablemente reusar el cache de `pendingCache` con TTL similar
     (5-30s) — N sesiones activas × cada poll = riesgo de exhaust Plane API si TTL=0.
   - Hot path: si N sesiones es pequeño (típicamente <10), llamada serial está bien; si crece,
     batchear con `Promise.allSettled` y cap de concurrencia.

3. **Dashboard render** (`src/cli/dashboard/SessionTable.js`):
   - Opción A: columna nueva `provider` entre `status` y `age`. Conservador, layout cambia.
   - Opción B: badge inline en `status` (e.g. `running [In Review]` con un color secundario).
     Compacto, menos invasivo en anchos, pero más denso.
   - Opción C: solo afecta al color (si provider_state es 'in_review', overlay cyan sobre la
     fila aunque kodo siga en 'running'). Más mágico, menos explícito.
   - Decisión abierta — preview con mockups en discuss-phase.

4. **Filter parser** (`src/cli/dashboard/select.js#applyFilter`): semántica de `s:review` —
   debe matchear lifecycle `status==='review'` O `provider_state==='in_review'`. Probablemente
   OR (más útil), pero ojo con la confusión: añadir un prefijo distinto `ps:` para acotar al
   provider_state si se quiere precisión.

5. **Tests**:
   - Cross-provider contract test extendido (`getTaskState` con cada estado normalizado).
   - Render test del nuevo elemento visual (columna/badge/color).
   - Filter test del nuevo prefijo si se añade.

### Sizing

Fase propia. Estimación a vuelo: 3-4 plans (provider interface + adapter, server enrichment,
dashboard render, filter semantics). Touches TaskProvider contract → discuss-phase obligatorio
para nivelar el normalized vocabulary y la decisión render (A/B/C). NO meter en Phase 37
(attach — mayor riesgo) ni Phase 38 (overlays). Candidata a Phase 39 (post v0.9 polish) o a
nueva milestone v0.10 si v0.9 cierra antes.

### Pitfalls predecibles

- **Coupling al lifecycle de Plane** vía vocabulario: si el nombre de los estados cambia en
  Plane workspace, kodo se rompe. Cada adapter debe blindar el mapeo.
- **N+1 API calls** en cada poll. Cache obligatorio.
- **GitHub Issues** no tiene "review" nativo — la decisión de derivar de labels/PR-state
  abre interpretación. Necesita discuss explícito.
- **`s:review` semántico ambiguo**: ¿matchea solo lifecycle, solo provider_state, ambos? Hay
  que decidir y documentarlo.
- **Fail-open silencioso** puede ocultar fallos del provider durante horas — convendría log
  estructurado (`provider.state.fetch.failed`) y, si todas las llamadas fallan, degradar el
  banner del header (similar al `server caído` de Phase 35).

### Background trail (para Claude futura)

- Capturado durante Phase 36 UAT (2026-05-28) tras observar que ROMAN-150 desapareció del
  dashboard tras `/exit`.
- Decisión Option 2 vs Option 3 está documentada en la conversación que originó este todo.
- Phase 36 entregó `SessionRecord.status === 'review'` (cyan en SessionTable.js), pero solo
  para el flujo `kodo gsd verify` canónico. La inconsistencia con Plane MCP directo no es un
  bug de Phase 36 — es trabajo nuevo.
