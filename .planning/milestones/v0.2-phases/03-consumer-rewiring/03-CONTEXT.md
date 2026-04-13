# Phase 3: Consumer Rewiring - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Todos los consumidores internos (check.js, stop.js, manager.js, session-start.js) usan TaskProvider via el registry — ninguno instancia PlaneClient directamente. Al final de esta fase, `PlaneClient` no aparece en imports fuera de `src/providers/plane/`.

</domain>

<decisions>
## Implementation Decisions

### stop.js — Estrategia de rewire
- Claude decide el formato de comentarios (construir en Markdown, el adapter convierte si necesario)
- Claude decide cómo obtener el TaskItem (getTask vs TaskItem mínimo del state)
- Claude decide mecanismo defensivo para errores silenciosos (try-catch granular recomendado)
- Claude decide cómo resolver el provider (getProvider(session.provider) vs config global)
- Concern activo: stop.js corre dentro del proceso de Claude — excepciones se tragan silenciosamente. Manejo defensivo es crítico.

### check.js — Queries y output
- `listPendingTasks()` del provider cubre todo el filtrado (labels kodo + estados pendientes). check.js solo cuenta `array.length`
- Output mejorado con colores ANSI básicos: verde para "All clear", amarillo para warnings, rojo para errores. Sin dependencias externas (ANSI escape codes directos)
- Claude decide manejo del caso sin API key / provider no configurado

### manager.js — Lanzamiento de sesiones
- Prompt de Claude usa `task.description` (ya Markdown) directamente — sin stripHtml
- Claude decide secuencia de resolución (resolveRef + getTask vs getTask directo)
- Claude decide cómo usar groups[] para módulos en el workspace name
- Claude decide cómo obtener labels kodo en lanzamiento manual (TaskItem.labels + parseKodoLabels)
- Claude decide qué campos guardar en el state de la sesión (task_id, task_ref, project_id, provider mínimo)

### session-start.js — Contexto inyectado
- Instrucciones provider-agnostic: no mencionar "Plane" sino el nombre del provider activo
- Referencia dinámica al MCP: usar `providers.{name}.mcp_hint` del config para indicar qué herramienta usar
- Campos renombrados: `session.plane_identifier` → `session.task_ref`, `session.plane_id` → `session.task_id`

### Claude's Discretion
- Formato exacto de comentarios Markdown en stop.js
- Obtención de TaskItem en stop.js (getTask vs state parcial)
- Manejo defensivo de errores en stop.js
- Resolución de provider en stop.js (session.provider vs config)
- Manejo de provider no disponible en check.js
- Secuencia de resolución de refs en manager.js
- Campos del state de sesión en manager.js
- Uso de groups[] para módulos
- Labels kodo en lanzamiento manual

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/providers/plane/provider.js`: PlaneProvider con createPlaneProvider(config) — factory completa con los 7 métodos + init
- `src/providers/registry.js`: getProvider(name?) con singleton cacheado y lazy default registration
- `src/interface.js`: TaskProvider, TaskItem, TriggerEvent typedefs + TASK_PROVIDER_METHODS constante
- `src/labels.js`: parseKodoLabels() — parsing de labels kodo existente, reutilizable fuera del adapter
- `src/cmux/colors.js`: colorForStatus() — ya mapea estados a colores

### Established Patterns
- Factory pattern: createPlaneProvider(config) devuelve objeto implementando TaskProvider
- JSDoc @ts-check en todo el codebase
- Config via loadConfig() con providers.plane.* (schema v2)
- Sessions en state.json con findSession({ cwd }) para lookup

### Integration Points
- `src/providers/registry.js` → getProvider() es el entry point para todos los consumers
- `src/session/state.js` → ya migrado a campos genéricos (task_id, task_ref, provider)
- `src/config.js` → loadConfig() con schema v2 (providers.plane.*)
- `src/labels.js` → parseKodoLabels() sigue siendo útil para consumers que leen labels del TaskItem

</code_context>

<specifics>
## Specific Ideas

- check.js output con colores ANSI directos (sin chalk ni dependencias): `\x1b[32m` verde, `\x1b[33m` amarillo, `\x1b[31m` rojo
- session-start.js usa `providers.{provider}.mcp_hint` del config (ej. `"mcp_hint": "MCP de Plane"`) para instrucciones dinámicas
- verifySignature debe seguir siendo síncrono — cada provider usa headers distintos (concern de STATE.md)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-consumer-rewiring*
*Context gathered: 2026-04-09*
