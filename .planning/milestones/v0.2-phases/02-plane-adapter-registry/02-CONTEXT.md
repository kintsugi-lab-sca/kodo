# Phase 2: Plane Adapter + Registry - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Envolver PlaneClient existente en un PlaneProvider que implementa TaskProvider. Crear registry estático con factory functions. Validar con tests usando fixtures reales de Plane API. Al final, `getProvider("plane")` devuelve un adapter funcional — pero ningún consumidor lo usa aún (eso es Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
El usuario confía completamente en las decisiones técnicas. Las siguientes son directrices derivadas del research y Phase 1:

### PlaneProvider structure
- Factory function `createPlaneProvider(config)` que devuelve objeto implementando TaskProvider
- PlaneClient existente se mueve a `src/providers/plane/client.js` sin cambios
- Normalizer en `src/providers/plane/normalize.js` — convierte respuestas API a TaskItem
- El factory lee config de `providers.plane.*` (schema v2)

### Normalizer
- HTML → Markdown: strip tags básico (ya existe `stripHtml` en manager.js, adaptar)
- Prioridades de Plane mapean directo: urgent/high/medium/low/none son los mismos valores
- Labels: resolver UUIDs a nombres usando listLabels del proyecto, devolver como string[]
- Groups: resolver módulos via getWorkItemModule (ya implementado en PlaneClient)
- URL: construir desde `baseUrl/{workspaceSlug}/browse/{projectIdentifier}-{sequenceId}`

### Registry
- `src/providers/registry.js` — Map estático de nombre → factory function
- `getProvider(name?)` — si no se pasa nombre, usa `config.provider`
- Singleton por defecto — la instancia se cachea tras el primer `init()`
- Validación: verificar que el objeto devuelto tiene todos los TASK_PROVIDER_METHODS

### Label parsing dentro del adapter
- PlaneProvider.parseTriggerEvent resuelve labels del webhook payload
- Devuelve `TriggerEvent` con `kodoConfig: { isKodo, model, flags }` en el campo `raw`
- La lógica existente de `labels.js` se integra en el normalizer

### Webhook handling
- `parseTriggerEvent(rawPayload)` → extrae state name, verifica que es trigger state, parsea labels
- `verifySignature(rawBody, headers)` → HMAC-SHA256 con `X-Plane-Signature` header
- La lógica existente de server.js se mueve al adapter

### init() fail-fast
- Valida: API key presente, conexión a Plane (GET /users/me/), workspace slug correcto
- Si falla → throw con mensaje claro

### Test strategy
- Fixtures JSON grabadas de respuestas reales de Plane API
- Tests puros: normalizer recibe fixture → devuelve TaskItem → assert campos
- Tests de label resolution con fixtures de labels + work items
- No requiere API key para ejecutar tests

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/plane/client.js`: PlaneClient completo con todos los métodos necesarios — se mueve sin cambios
- `src/labels.js`: `parseKodoLabels()` ya parsea labels — se integra en el normalizer
- `src/server.js`: lógica de HMAC y webhook parsing — se extrae al adapter
- `src/interface.js`: TaskProvider, TaskItem, TriggerEvent typedefs + TASK_PROVIDER_METHODS constante

### Established Patterns
- Factory pattern: investigación recomienda factory functions (como Vercel AI SDK)
- JSDoc @ts-check en todo el codebase
- Config via `loadConfig()` con `providers.plane.*` (schema v2 ya migrado)

### Integration Points
- PlaneClient lee `config.plane.*` (schema v1) — necesita actualizar a `config.providers.plane.*`
- `labels.js` exporta `parseKodoLabels` y `resolveLabels` — se integran en el provider
- Los consumers (server, manager, hooks, check) NO se tocan en esta fase

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. El usuario confía en la implementación derivada del research.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-plane-adapter-registry*
*Context gathered: 2026-04-08*
