# Requirements: kodo v0.2

**Defined:** 2026-04-07
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones.

## v1 Requirements

### Interface

- [ ] **INTF-01**: `TaskProvider` interfaz definida con 7 métodos via JSDoc `@typedef`
- [ ] **INTF-02**: `TaskItem` shape canónica definida (id, ref, title, description plain text, labels string[], projectId, group, url)
- [ ] **INTF-03**: `TriggerEvent` shape normalizada definida (taskRef, action, provider, raw)
- [ ] **INTF-04**: Registry estático de providers con factory functions (`getProvider()`)

### Plane Adapter

- [ ] **PLAN-01**: `PlaneProvider` implementa `TaskProvider` envolviendo `PlaneClient` existente
- [ ] **PLAN-02**: Normalizer convierte respuestas Plane API → `TaskItem` canónico (description HTML → plain text dentro del adapter)
- [ ] **PLAN-03**: `parseTriggerEvent` parsea payload webhook de Plane → `TriggerEvent`
- [ ] **PLAN-04**: `verifySignature` con HMAC-SHA256 dentro del adapter
- [ ] **PLAN-05**: Labels resueltos dentro del adapter (UUIDs → nombres)

### State Migration

- [ ] **STAT-01**: Campos renombrados: `plane_id` → `task_id`, `plane_identifier` → `task_ref`
- [ ] **STAT-02**: Campo `provider` añadido a cada sesión en state.json
- [ ] **STAT-03**: `schema_version` en state.json para migraciones futuras
- [ ] **STAT-04**: Migración automática de state.json existente al nuevo schema

### Consumer Rewiring

- [ ] **REWI-01**: `check.js` usa `TaskProvider` en vez de `PlaneClient`
- [ ] **REWI-02**: `stop.js` lee `session.provider` y usa el adapter correcto
- [ ] **REWI-03**: `manager.js` usa `TaskProvider` para resolver refs y obtener tasks
- [ ] **REWI-04**: `server.js` delega parsing de webhook y verificación de firma al adapter
- [ ] **REWI-05**: `session-start.js` usa campos genéricos del state (task_id, task_ref)

### Trigger Abstraction

- [ ] **TRIG-01**: `dispatchTrigger()` extraído de `server.js` como función central
- [ ] **TRIG-02**: Webhook channel funcional (usado por Plane adapter)
- [ ] **TRIG-03**: CLI manual (`kodo launch`) sigue funcionando con la nueva abstracción

### Config & UX

- [ ] **CONF-01**: Campo `provider` en config.json selecciona el adapter activo
- [ ] **CONF-02**: Config existente (`plane.*`) migra transparentemente al nuevo schema
- [ ] **CONF-03**: `kodo config` wizard actualizado para soportar selección de provider
- [ ] **CONF-04**: Orchestrator prompt neutral (sin referencias directas a Plane)

### Testing

- [ ] **TEST-01**: Tests para TaskItem normalization (Plane response → canonical shape)
- [ ] **TEST-02**: Tests para label parsing con la nueva interfaz
- [ ] **TEST-03**: Tests para state migration (old schema → new schema)

## v2 Requirements

### Providers adicionales

- **GHUB-01**: Adapter de GitHub Issues que implementa TaskProvider
- **CLUP-01**: Adapter de ClickUp que implementa TaskProvider
- **LOCL-01**: Adapter local (JSON/Markdown) que implementa TaskProvider

### Triggers adicionales

- **POLL-01**: Polling trigger channel para providers sin webhook
- **WTCH-01**: File watcher trigger para provider local

### UX

- **UX-01**: Output del CLI con colores y formato mejorado
- **UX-02**: Logging estructurado con niveles (debug, info, warn, error)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Dashboard web | CLI es suficiente para uso personal |
| Multi-tenant | Herramienta personal, no SaaS |
| Base de datos | JSON files suficiente para el volumen actual |
| TypeScript migration | JSDoc + @ts-check cubre las necesidades sin build step |
| Retry/backoff en la interfaz | Responsabilidad de cada adapter internamente |
| CRUD completo de tareas | kodo no crea ni elimina tareas, solo las lee y actualiza |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INTF-01 | Phase 1 | Pending |
| INTF-02 | Phase 1 | Pending |
| INTF-03 | Phase 1 | Pending |
| INTF-04 | Phase 2 | Pending |
| PLAN-01 | Phase 2 | Pending |
| PLAN-02 | Phase 2 | Pending |
| PLAN-03 | Phase 2 | Pending |
| PLAN-04 | Phase 2 | Pending |
| PLAN-05 | Phase 2 | Pending |
| STAT-01 | Phase 1 | Pending |
| STAT-02 | Phase 1 | Pending |
| STAT-03 | Phase 1 | Pending |
| STAT-04 | Phase 1 | Pending |
| REWI-01 | Phase 3 | Pending |
| REWI-02 | Phase 3 | Pending |
| REWI-03 | Phase 3 | Pending |
| REWI-04 | Phase 4 | Pending |
| REWI-05 | Phase 3 | Pending |
| TRIG-01 | Phase 4 | Pending |
| TRIG-02 | Phase 4 | Pending |
| TRIG-03 | Phase 4 | Pending |
| CONF-01 | Phase 5 | Pending |
| CONF-02 | Phase 5 | Pending |
| CONF-03 | Phase 5 | Pending |
| CONF-04 | Phase 5 | Pending |
| TEST-01 | Phase 2 | Pending |
| TEST-02 | Phase 2 | Pending |
| TEST-03 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after initial definition*
