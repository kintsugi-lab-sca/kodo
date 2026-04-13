# Phase 1: Interface + State Schema - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Definir los contratos de datos genéricos (`TaskProvider`, `TaskItem`, `TriggerEvent`) via JSDoc typedefs y migrar `state.json` + `config.json` a schemas provider-agnostic. No se implementa ningún adapter — solo las definiciones y la migración de datos.

</domain>

<decisions>
## Implementation Decisions

### TaskItem shape canónica
- `description` en **Markdown** — el adapter convierte desde el formato del provider (HTML en Plane, Markdown nativo en GitHub)
- `groups: string[]` — array de strings para soportar tareas en múltiples agrupaciones (módulos, milestones, folders)
- `url: string` — obligatorio, siempre presente. URL directa a la tarea en el provider
- `priority: string|null` — valores normalizados: urgent, high, medium, low, none
- `labels: string[]` — nombres de labels como strings (no UUIDs)
- Shape completa: `{ id, ref, title, description (markdown), labels (string[]), projectId, projectName, groups (string[]), url, priority }`

### TaskProvider API
- **7 métodos + init**: `init()`, `getTask(ref)`, `updateTaskState(task, stateName)`, `addComment(task, markdownText)`, `listPendingTasks()`, `parseTriggerEvent(rawPayload)`, `verifySignature(rawBody, headers)`, `resolveRef(humanRef)`
- `init()` es **fail-fast asíncrono** — valida credenciales y conexión al arrancar. Si falla, kodo no arranca
- `resolveRef` es responsabilidad completa del provider — cada uno parsea su formato de ref (Plane: `PREFIX-N`, GitHub: `#N`, ClickUp: task ID)
- `addComment` recibe **Markdown** — el adapter convierte al formato del provider
- Labels kodo (kodo:sonnet, kodo:yolo) se **parsean dentro del adapter** — el adapter devuelve `{ isKodo, model, flags }` ya parseado
- Estados lógicos (`trigger`, `review`, `done`) se mapean en **config por provider** — el usuario configura el mapeo para su workspace

### State migration
- Migración **automática con backup** (.bak) al detectar schema viejo
- Sesiones activas existentes se **limpian** durante migración (asumimos 0 sesiones al upgradar)
- `schema_version: 2` en el nuevo schema
- Campos: `plane_id` → `task_id`, `plane_identifier` → `task_ref`, nuevo campo `provider`

### Config migration (adelantada de Fase 5)
- Config y state se migran **juntos** en esta fase para coherencia
- `plane.*` se mueve a `providers.plane.*`
- Nuevo campo raíz `provider: "plane"` para seleccionar adapter activo
- Mapeo de estados configurable por provider: `providers.plane.states: { trigger: "In Progress", review: "In review", done: "Done" }`

### Claude's Discretion
- Estructura interna del archivo `interface.js` (un archivo vs múltiples)
- Orden de los campos en las typedefs
- Nombres exactos de las funciones helper de migración
- Formato del backup (.bak vs timestamp)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/plane/client.js`: Los 7 métodos existentes (listStates, listWorkItems, getWorkItem, updateWorkItem, createComment, listModules, getWorkItemModule) son la referencia para los métodos de TaskProvider
- `src/labels.js`: `parseKodoLabels()` ya tiene la lógica de parsing — se reutiliza dentro del adapter
- `src/session/state.js`: CRUD completo de sessions, `findSession()` con queries por cwd/workspaceRef

### Established Patterns
- JSDoc `@ts-check` + `@typedef` ya usado en todo el codebase
- Funciones puras para parsing (labels.js) — mismo patrón para normalization
- JSON files como store (config.js, state.js) con `loadX()`/`saveX()` pattern

### Integration Points
- `state.js` es importado por: server.js, manager.js, stop.js, session-start.js, health.js, check.js
- `config.js` es importado por todos los módulos — cambiar su estructura afecta a todo
- Las typedefs nuevas serán importadas por el adapter (Fase 2) y los consumers (Fase 3)

</code_context>

<specifics>
## Specific Ideas

- La interfaz debe poder estresarse mentalmente contra un hipotético GitHub Issues adapter antes de fijar el contrato
- Estado mapping en config permite que el mismo adapter funcione en workspaces con estados nombrados distinto

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-interface-state-schema*
*Context gathered: 2026-04-08*
