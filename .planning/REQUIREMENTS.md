# Requirements: kodo v0.2

**Defined:** 2026-04-07
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones.

## v1 Requirements

### Interface

- [x] **INTF-01**: `TaskProvider` interfaz definida con 7 métodos via JSDoc `@typedef`
- [x] **INTF-02**: `TaskItem` shape canónica definida (id, ref, title, description plain text, labels string[], projectId, group, url)
- [x] **INTF-03**: `TriggerEvent` shape normalizada definida (taskRef, action, provider, raw)
- [x] **INTF-04**: Registry estático de providers con factory functions (`getProvider()`)

### Plane Adapter

- [x] **PLAN-01**: `PlaneProvider` implementa `TaskProvider` envolviendo `PlaneClient` existente
- [x] **PLAN-02**: Normalizer convierte respuestas Plane API → `TaskItem` canónico (description HTML → plain text dentro del adapter)
- [x] **PLAN-03**: `parseTriggerEvent` parsea payload webhook de Plane → `TriggerEvent`
- [x] **PLAN-04**: `verifySignature` con HMAC-SHA256 dentro del adapter
- [x] **PLAN-05**: Labels resueltos dentro del adapter (UUIDs → nombres)

### State Migration

- [x] **STAT-01**: Campos renombrados: `plane_id` → `task_id`, `plane_identifier` → `task_ref`
- [x] **STAT-02**: Campo `provider` añadido a cada sesión en state.json
- [x] **STAT-03**: `schema_version` en state.json para migraciones futuras
- [x] **STAT-04**: Migración automática de state.json existente al nuevo schema

### Consumer Rewiring

- [x] **REWI-01**: `check.js` usa `TaskProvider` en vez de `PlaneClient`
- [x] **REWI-02**: `stop.js` lee `session.provider` y usa el adapter correcto
- [x] **REWI-03**: `manager.js` usa `TaskProvider` para resolver refs y obtener tasks
- [x] **REWI-04**: `server.js` delega parsing de webhook y verificación de firma al adapter
- [x] **REWI-05**: `session-start.js` usa campos genéricos del state (task_id, task_ref)

### Trigger Abstraction

- [x] **TRIG-01**: `dispatchTrigger()` extraído de `server.js` como función central
- [x] **TRIG-02**: Webhook channel funcional (usado por Plane adapter)
- [x] **TRIG-03**: CLI manual (`kodo launch`) sigue funcionando con la nueva abstracción

### Config & UX

- [ ] **CONF-01**: Campo `provider` en config.json selecciona el adapter activo
- [ ] **CONF-02**: Config existente (`plane.*`) migra transparentemente al nuevo schema
- [ ] **CONF-03**: `kodo config` wizard actualizado para soportar selección de provider
- [ ] **CONF-04**: Orchestrator prompt neutral (sin referencias directas a Plane)

### Testing

- [x] **TEST-01**: Tests para TaskItem normalization (Plane response → canonical shape)
- [x] **TEST-02**: Tests para label parsing con la nueva interfaz
- [x] **TEST-03**: Tests para state migration (old schema → new schema)

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
| INTF-01 | Phase 1 | Complete |
| INTF-02 | Phase 1 | Complete |
| INTF-03 | Phase 1 | Complete |
| INTF-04 | Phase 2 | Complete |
| PLAN-01 | Phase 2 | Complete |
| PLAN-02 | Phase 2 | Complete |
| PLAN-03 | Phase 2 | Complete |
| PLAN-04 | Phase 2 | Complete |
| PLAN-05 | Phase 2 | Complete |
| STAT-01 | Phase 1 | Complete |
| STAT-02 | Phase 1 | Complete |
| STAT-03 | Phase 1 | Complete |
| STAT-04 | Phase 1 | Complete |
| REWI-01 | Phase 3 | Complete |
| REWI-02 | Phase 3 | Complete |
| REWI-03 | Phase 3 | Complete |
| REWI-04 | Phase 4 | Complete |
| REWI-05 | Phase 3 | Complete |
| TRIG-01 | Phase 4 | Complete |
| TRIG-02 | Phase 4 | Complete |
| TRIG-03 | Phase 4 | Complete |
| CONF-01 | Phase 5 | Pending |
| CONF-02 | Phase 5 | Pending |
| CONF-03 | Phase 5 | Pending |
| CONF-04 | Phase 5 | Pending |
| TEST-01 | Phase 2 | Complete |
| TEST-02 | Phase 2 | Complete |
| TEST-03 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 after initial definition*
