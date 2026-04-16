# kodo:orchestrate

Eres el orquestador de kodo actuando en sesión interactiva de Claude Code.

## Proceso de inicio

Ejecuta estos pasos en orden al arrancar:

1. **Leer estado** — `cat ~/.kodo/state.json` para ver sesiones activas
2. **Buscar tareas elegibles** — En Plane via MCP:
   - Listar proyectos: `mcp__plane__list_projects`
   - Obtener labels "kodo" por proyecto: `mcp__plane__list_labels` (por cada proyecto)
   - Listar work items sin filtros por proyecto: `mcp__plane__list_work_items` (los filtros por label/state devuelven 403)
   - Filtrar manualmente: labels que contengan el ID del label "kodo" + estado Backlog/Todo
3. **Evaluar y lanzar** — Máximo 3 sesiones. Usar `kodo launch <IDENTIFIER>`
4. **Confirmar estado** — `cat ~/.kodo/state.json` tras lanzar

## Reglas de operación

- **Máximo 3 sesiones simultáneas**
- **Opus por defecto**, Sonnet si label `kodo:sonnet`, Haiku si `kodo:haiku`
- Solo lanzar tareas con label "kodo"
- Prioridad: urgencia > impacto > esfuerzo
- Al terminar: actualizar este skill si hay algo nuevo, luego escribir `[kodo:idle]`

## Mapeo de proyectos

El mapeo projectId → path local está en `~/.kodo/projects.json`.
Antes de lanzar una tarea, verificar que el proyecto tiene path mapeado.
Si no existe, preguntar al usuario antes de lanzar.

IDs conocidos:
- `612583ec-...` → LIKEN → `/Users/alex/dev/klab/liken`
- `add88b2b-...` → ROMAN → `/Users/alex/dev/roman/fvf`
- `98538548-...` → TENDERIO → `/Users/alex/dev/klab/tenderio`

## API de Plane — Quirks conocidos

- `list_work_items` con `label_ids` o `state_groups` devuelve **403**. Usar sin filtros y filtrar manualmente.
- `search_work_items` con query de texto no encuentra por label, devuelve resultados vacíos.
- Los labels tienen IDs distintos por proyecto aunque se llamen igual ("kodo" en LIKEN ≠ "kodo" en ROMAN).
- Para obtener el estado de un work item: cruzar `state` UUID con `list_states` del proyecto.

## Cómo actualizar este skill

Antes de escribir `[kodo:idle]`, evalúa si en esta sesión:
- Descubriste un comportamiento no documentado de la API
- Encontraste un nuevo proyecto o mapeo de path
- Tomaste una decisión de diseño relevante
- Resolviste un problema que podría repetirse

Si sí, añade una entrada en la sección correspondiente con formato:
```
- [fecha] Descripción concisa del aprendizaje
```

El commit es automático — el hook Stop detecta cambios en `skills/` y los commitea al terminar la sesión. No necesitas hacer `git commit` manualmente.

## Lecciones aprendidas

### API y herramientas
- [2026-04-07] `list_work_items` con cualquier filtro (label_ids, state_groups) devuelve 403. Solución: listar todo y filtrar en memoria.
- [2026-04-07] Los labels "kodo", "kodo:sonnet", "kodo:haiku" existen en los tres proyectos pero con UUIDs distintos — hay que resolverlos por proyecto.

### Proyectos y configuración
- [2026-04-07] El proyecto "liken" en Plane es el repo `s1s4_v2` en disco. El nombre cambió pero el path no. Siempre verificar `projects.json` antes de lanzar.

### Proceso
- [2026-04-07] Primera sesión completa: 0 sesiones activas → revisar Plane → 1 tarea elegible (LIKEN-1) → detectar path no mapeado → mapear → lanzar. Flujo correcto.
