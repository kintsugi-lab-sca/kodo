# Research Summary: Provider Abstraction

## Stack
- **Factory functions + static registry** (patrón Vercel AI SDK, Octokit)
- **JSDoc `@typedef` + `@ts-check`** para contratos de interfaz sin TypeScript
- **`TriggerMechanism` separado** del provider: webhook/polling/manual convergen en `dispatchTrigger()`
- **Zero dependencias nuevas**

## Interface: 7 métodos de tabla stakes
- `getTask(ref)` — hidratación completa desde referencia legible
- `updateTaskState(task, stateName)` — mover tarea entre estados
- `addComment(task, text)` — texto plano, adapter formatea
- `listPendingTasks()` — tareas elegibles para auto-launch
- `parseTriggerEvent(rawPayload)` → `TriggerEvent | null`
- `verifySignature(rawBody, headers)` → `boolean`
- `resolveRef(humanRef)` → `TaskItem` canónico

## Shape canónica: TaskItem
```
{ id, ref, title, description (plain text), labels (string[]), projectId, group (string|null), url }
```

## Acoplamiento actual (de más a menos)
1. `check.js`, `stop.js`, `server.js` — TIGHT (instancian PlaneClient)
2. `manager.js` — MEDIUM
3. `session-start.js` — LOW (solo lee state.json)
4. `state.js` — SCHEMA DEBT (campos `plane_id`/`plane_identifier`)

## Pitfalls críticos
1. Interfaz diseñada desde PlaneClient en vez de desde consumidores
2. Webhook payload normalization olvidada en el adapter
3. Stop hook dejado acoplado a Plane
4. Migración de state.json diferida
5. Shape canónica con fugas de Plane (`description_html`, UUIDs)

## Watch Out For
- `stop.js` corre dentro del proceso de Claude — cualquier excepción se traga silenciosamente
- `verifySignature` debe ser síncrono, cada provider usa headers distintos
- Labels tienen IDs distintos por proyecto en Plane, pero son strings en GitHub/ClickUp
- Polling rate limits en ClickUp requieren backoff

## Roadmap sugerido (5 fases)
1. Interface definition + state schema migration
2. PlaneProvider adapter + registry + tests
3. Consumer rewiring (check → stop → manager)
4. Server + trigger channel abstraction
5. Cleanup + config migration UX
