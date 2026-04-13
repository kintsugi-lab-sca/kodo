# Phase 5: Config + Cleanup - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

La configuración es provider-agnostic y el sistema opera sin mencionar Plane en sitios genéricos. Cubre: migración de config, wizard actualizado, orchestrator prompt neutral, y limpieza de código legacy acoplado a Plane.

</domain>

<decisions>
## Implementation Decisions

### Wizard de config (`kodo config`)
- Flujo: selección de provider primero, luego configuración específica del provider elegido (API key, workspace, proyectos)
- Debe listar proyectos remotos del provider para hacer mapping (project → path local)
- Listado de proyectos vía `TaskProvider.listProjects()` — añadir método a la interfaz, no acceder al adapter directamente
- Validar conexión (API key válida, workspace accesible) antes de guardar config — si falla, error + reintentar, no guardar config inválida

### Prompt del orchestrator
- Parametrizado con placeholders: `{{provider}}`, `{{mcp_tool}}`, etc. — no genérico total ni hardcoded a Plane
- Template estático con string replace en runtime (prompt.md como template, launch.js hace los replaces)
- Schema de state.json documentado en el prompt para dar contexto al LLM
- Referencias a MCP tools: Claude decide el enfoque (genérico + nota del provider, o todo parametrizado)

### Limpieza de código legacy
- Eliminar `src/plane/` (directorio legacy) — todo el código funcional ya está en `src/providers/plane/`
- Reemplazar `getPlaneApiKey()` por `getProviderApiKey(name)` — función genérica que lee env var según provider activo
- Criterio de limpieza: solo sitios genéricos (config.js, cli.js, server.js, orchestrator). Dejar menciones DENTRO de `src/providers/plane/` intactas
- `src/labels.js`: Claude decide si tiene acoplamiento real que limpiar

### Experiencia de arranque (first run)
- Sin config.json → auto-lanzar wizard antes de ejecutar el comando
- Solo comandos que necesitan provider activan el wizard (check, launch, server, status). --help, --version, config funcionan sin config
- Tras el wizard, retomar automáticamente el comando original que el usuario quería ejecutar
- Provider no disponible en registry: Claude decide el manejo de error apropiado

### Claude's Discretion
- Enfoque exacto para referencias MCP en el prompt del orchestrator (genérico + nota vs todo parametrizado)
- labels.js: revisar y decidir si hay acoplamiento real a Plane que limpiar
- Manejo de error cuando provider configurado no tiene adapter disponible
- Detalles de implementación del auto-resume tras wizard

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config.js`: Ya tiene `migrateConfig()` como función pura (v1 → v2), DEFAULT_CONFIG con campo `provider`, y `migrateConfigIfNeeded()` con backup automático
- `src/providers/registry.js`: Registry con lazy default registration y `getProvider(name)` — el wizard puede usarlo directamente
- `src/interface.js`: JSDoc typedefs para TaskProvider — necesita extensión con `listProjects()`

### Established Patterns
- DI deps parameter pattern (Phase 3-4): funciones reciben dependencias como parámetro para testabilidad
- Provider factory recibe config explícito — sin acoplamiento interno a config.js
- Pure function extraction para testabilidad (Phase 3-4 pattern)
- Template: prompt.md leído por `orchestrator/launch.js`

### Integration Points
- `cli.js` línea 268: PlaneClient importado directamente en comando config — rewire a TaskProvider.listProjects()
- `config.js` exports: getPlaneApiKey() usado por consumers — reemplazar por getProviderApiKey()
- `orchestrator/prompt.md`: 8+ menciones de Plane — parametrizar con placeholders
- `src/plane/client.js`: legacy directory que puede tener imports residuales — verificar antes de eliminar

</code_context>

<specifics>
## Specific Ideas

- El wizard debe sentirse como un setup guiado: "¡Primera vez! Vamos a configurar kodo." → selección de provider → config específica → validación → "✓ Config guardada"
- El prompt del orchestrator debe ser auditablemente neutral: al leer prompt.md debes ver `{{provider}}`, no "Plane"
- La limpieza no toca nada dentro de `src/providers/plane/` — ahí Plane es correcto por diseño

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-config-cleanup*
*Context gathered: 2026-04-13*
