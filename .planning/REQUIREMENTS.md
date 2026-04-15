# Requirements: kodo v0.3

**Defined:** 2026-04-15
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones.

**Milestone Goal:** Que una tarea Plane con label `kodo:gsd` arranque una sesión Claude que opera bajo el workflow GSD (1 tarea = 1 fase), con bootstrap automático si el repo no está inicializado, y que todo el sistema emita logs estructurados inspeccionables desde el CLI.

## v0.3 Requirements

### GSD Integration

- [ ] **GSD-01**: Usuario puede etiquetar una tarea Plane con `kodo:gsd` y kodo reconoce el modo GSD en el dispatcher
- [ ] **GSD-02**: kodo detecta si el repo destino tiene `.planning/PROJECT.md` y dispara `/gsd:new-project` en la sesión solo cuando el directorio está ausente (guard por presencia)
- [ ] **GSD-03**: kodo lee `.planning/ROADMAP.md` del repo destino y resuelve la fase correspondiente a la tarea Plane (match por título/heading, 1:1 estricto)
- [ ] **GSD-04**: Sesión GSD recibe contexto inyectado con la secuencia `/gsd:plan-phase <n>` → `/gsd:execute-phase <n>` → `/gsd:verify-work` al arrancar
- [ ] **GSD-05**: Orquestador inspecciona `.planning/phases/<n>/VERIFICATION.md` y bloquea la transición a In Review si el artefacto no existe o su checklist no está completo
- [ ] **GSD-06**: kodo comenta en la tarea Plane el identificador de fase resuelto y el resultado de la verificación (pasada/fallida con motivo)
- [ ] **GSD-07**: Orquestador recibe metadata GSD (phase_id, project_path) al spawnearse y carga PROJECT.md + ROADMAP.md + PLAN.md de la fase en su contexto
- [ ] **GSD-08**: Bootstrap `/gsd:new-project` usa la descripción de la tarea Plane como project-brief inicial
- [ ] **GSD-09**: Cuando el título de la tarea Plane matchea un heading de fase en ROADMAP.md, kodo infiere la fase sin requerir configuración explícita
- [ ] **GSD-10**: Dos tareas Plane apuntando al mismo repo no arrancan sesiones GSD concurrentes (lock a nivel de repo, no solo de tarea)

### Structured Logging

- [ ] **LOG-01**: Sistema emite logs con 4 niveles (debug/info/warn/error), configurables vía `KODO_LOG_LEVEL` y flag CLI
- [ ] **LOG-02**: Logs se escriben como NDJSON (una línea JSON por evento) con campos `timestamp` (ISO-8601), `level`, `component`, `msg` y contexto libre
- [ ] **LOG-03**: Cada sesión escribe en `~/.kodo/logs/<session-id>.ndjson` con correlación (session_id, plane_task_id, phase_id cuando aplica)
- [ ] **LOG-04**: Consola muestra pretty-print legible a stderr en INFO+ durante ejecuciones interactivas sin duplicar el JSON
- [ ] **LOG-05**: Usuario puede ejecutar `kodo logs <session-id>` para ver el log completo de una sesión
- [ ] **LOG-06**: `kodo logs <session-id> --follow` hace tail en vivo mientras la sesión corre
- [ ] **LOG-07**: `kodo logs <session-id> --level <n>` filtra por nivel mínimo al mostrar
- [ ] **LOG-08**: Logger redacta secretos (PLANE_API_KEY, firmas de webhook, headers Authorization) antes de escribir a disco o consola
- [ ] **LOG-09**: Eventos de ciclo de vida emiten tipos estructurados: `session.start`, `session.end`, `state.transition`, `orchestrator.review`, `gsd.phase.resolved`, `gsd.bootstrap`, `plane.api.call`
- [ ] **LOG-10**: Cada `session.start` registra el path del transcript de Claude para pivotar entre la vista de kodo y la de Claude
- [ ] **LOG-11**: Usuario puede ejecutar `kodo logs --session-of <plane-task-id>` para localizar el log de una tarea sin conocer el session-id
- [ ] **LOG-12**: El vigilante `kodo check` (0 tokens) no carga el logger transitivamente y respeta su budget de arranque

## v2 Requirements (Deferred)

### GSD extensions

- **GSD-F1**: Slash command desde comentario Plane para re-disparar review del orquestador
- **GSD-F2**: Monorepo con múltiples `.planning/` roots
- **GSD-F3**: Orquestador auto-crea siguiente tarea Plane al completar fase

### Logging extensions

- **LOG-F1**: Rotación/retención configurable (tamaño, edad)
- **LOG-F2**: Export de métricas estilo Prometheus
- **LOG-F3**: Integraciones de shipping (Loki, Datadog) vía transports pluggables

### Otros adapters (pospuestos desde Active de PROJECT.md)

- **ADP-F1**: GitHub Issues adapter
- **ADP-F2**: ClickUp adapter
- **ADP-F3**: Local JSON/Markdown adapter
- **ADP-F4**: Polling trigger channel
- **ADP-F5**: File watcher trigger

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dashboard web de logs | Duplica Loki/Grafana; NDJSON + operator's own stack es suficiente |
| Multi-phase per task | Rompe atomicidad y verificación; enforce 1:1 |
| Auto-bootstrap en cada tarea GSD | Corrompería `.planning/` existente; guard por presencia es obligatorio |
| Formato de log propietario | Toda herramienta de agregación asume NDJSON |
| Niveles extra (trace/fatal/notice/critical/verbose) | Paralysis of choice; los 4 estándar cubren todo |
| Two-way sync GSD plan ↔ Plane subtasks | Distributed-systems tarpit; link unidireccional basta |
| Orquestador auto-encadena fases | Elimina el checkpoint humano que hace GSD confiable |
| Rotación de logs en v0.3 | Prematuro; NDJSON se comprime bien y sesiones son cortas |
| Log shipping integrado (Datadog/Loki) | Acoplamiento a vendors; NDJSON en disco basta |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GSD-01 | Phase 8 | Pending |
| GSD-02 | Phase 9 | Pending |
| GSD-03 | Phase 9 | Pending |
| GSD-04 | Phase 8 | Pending |
| GSD-05 | Phase 10 | Pending |
| GSD-06 | Phase 10 | Pending |
| GSD-07 | Phase 10 | Pending |
| GSD-08 | Phase 9 | Pending |
| GSD-09 | Phase 9 | Pending |
| GSD-10 | Phase 8 | Pending |
| LOG-01 | Phase 6 | Pending |
| LOG-02 | Phase 6 | Pending |
| LOG-03 | Phase 6 | Pending |
| LOG-04 | Phase 6 | Pending |
| LOG-05 | Phase 7 | Pending |
| LOG-06 | Phase 7 | Pending |
| LOG-07 | Phase 7 | Pending |
| LOG-08 | Phase 6 | Pending |
| LOG-09 | Phase 7 | Pending |
| LOG-10 | Phase 7 | Pending |
| LOG-11 | Phase 7 | Pending |
| LOG-12 | Phase 6 | Pending |

**Coverage:**
- v0.3 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-04-15*
*Traceability updated: 2026-04-15*
