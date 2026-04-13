# Roadmap: kodo v0.2 — Provider Abstraction

## Overview

kodo v0.2 abstrae el proveedor de tareas detrás de una interfaz genérica. Partimos de los contratos de datos y migración de estado, construimos el adaptador de Plane como implementación de referencia, reconectamos todos los consumidores a la nueva interfaz, abstraemos los mecanismos de trigger y cerramos con la migración de configuración. Al final, cualquier sistema de tareas puede reemplazar a Plane sin tocar la lógica de sesiones.

## Phases

- [ ] **Phase 1: Interface + State Schema** - Define contratos de datos y migra el schema de state.json
- [ ] **Phase 2: Plane Adapter + Registry** - PlaneProvider como implementación de referencia con registry y tests
- [ ] **Phase 3: Consumer Rewiring** - Reconectar check, stop, manager y session-start a TaskProvider
- [ ] **Phase 4: Server + Trigger Abstraction** - Desacoplar server de Plane y centralizar el dispatch de triggers
- [ ] **Phase 5: Config + Cleanup** - Migración de config, wizard actualizado, orchestrator neutral

## Phase Details

### Phase 1: Interface + State Schema
**Goal**: Los contratos de datos existen y el estado del sistema es provider-agnostic
**Depends on**: Nothing (first phase)
**Requirements**: INTF-01, INTF-02, INTF-03, STAT-01, STAT-02, STAT-03, STAT-04, TEST-03
**Success Criteria** (what must be TRUE):
  1. `TaskProvider` typedef con 7 métodos existe en JSDoc y un editor con @ts-check puede validar que un objeto lo implementa
  2. `TaskItem` y `TriggerEvent` tienen shapes documentadas que no contienen ningún campo específico de Plane (sin `plane_id`, sin `description_html`)
  3. Un state.json antiguo con `plane_id`/`plane_identifier` se convierte automáticamente al nuevo schema con `task_id`/`task_ref`/`provider` al arrancar kodo
  4. `schema_version` aparece en state.json tras la migración y los tests de migración pasan
**Plans**: 2 planes

Plans:
- [ ] 01-01-PLAN.md — Definir JSDoc typedefs (TaskProvider, TaskItem, TriggerEvent) y actualizar typedef Session
- [ ] 01-02-PLAN.md — Implementar migración automática de state.json y config.json con tests

### Phase 2: Plane Adapter + Registry
**Goal**: PlaneProvider funciona como adaptador de referencia validado por tests, y el registry sabe elegirlo
**Depends on**: Phase 1
**Requirements**: INTF-04, PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. `PlaneProvider` implementa `TaskProvider` y `getProvider("plane")` devuelve una instancia funcional
  2. Una respuesta cruda de la API de Plane se convierte a `TaskItem` canónico: description en plain text, labels como strings, sin fugas de UUIDs
  3. Un payload webhook de Plane parsea correctamente a `TriggerEvent` y la verificación HMAC funciona sin depender de código externo al adapter
  4. Los tests de normalización de TaskItem y label parsing pasan con fixtures reales de Plane
**Plans:** 1/2 plans executed

Plans:
- [ ] 02-01-PLAN.md — Normalizer: fixtures, tests y funciones puras para convertir respuestas Plane a TaskItem/TriggerEvent
- [ ] 02-02-PLAN.md — PlaneProvider factory, HMAC verification y registry con singleton caching

### Phase 3: Consumer Rewiring
**Goal**: Todos los consumidores internos usan TaskProvider — ninguno instancia PlaneClient directamente
**Depends on**: Phase 2
**Requirements**: REWI-01, REWI-02, REWI-03, REWI-05
**Success Criteria** (what must be TRUE):
  1. `kodo check` cuenta tareas pendientes usando `TaskProvider.listPendingTasks()` — PlaneClient no aparece en su código
  2. El stop hook lee `session.provider` del state y obtiene el adapter correcto del registry para actualizar el estado de la tarea
  3. `manager.js` resuelve una ref humana (ej. "TENDERIO-42") usando `TaskProvider.resolveRef()` sin saber nada de Plane
  4. `session-start.js` lee solo campos genéricos del state (`task_id`, `task_ref`) sin referencias a campos de Plane
**Plans:** 2 plans

Plans:
- [ ] 03-01-PLAN.md — Rewire check.js y session-start.js a TaskProvider (REWI-01, REWI-05)
- [ ] 03-02-PLAN.md — Rewire stop.js y manager.js a TaskProvider (REWI-02, REWI-03)

### Phase 4: Server + Trigger Abstraction
**Goal**: El server no sabe qué proveedor generó el evento y los triggers convergen en un punto central
**Depends on**: Phase 3
**Requirements**: REWI-04, TRIG-01, TRIG-02, TRIG-03
**Success Criteria** (what must be TRUE):
  1. `dispatchTrigger()` existe como función central que acepta un `TriggerEvent` normalizado y lanza la sesión — el server solo lo llama
  2. `server.js` delega el parsing del payload y la verificación de firma al adapter activo; el handler del webhook no contiene lógica específica de Plane
  3. Un evento de Plane procesado end-to-end (webhook → parse → dispatch → session) funciona igual que antes del refactor
  4. `kodo launch <ref>` (trigger manual) sigue creando la sesión correctamente usando la nueva abstracción
**Plans:** 2 plans

Plans:
- [ ] 04-01-PLAN.md — Extract dispatcher.js + webhook.js with unit tests (TRIG-01, TRIG-02, REWI-04)
- [ ] 04-02-PLAN.md — Rewire server.js as slim HTTP shell + cli.js launch to dispatchTrigger (TRIG-03)

### Phase 5: Config + Cleanup
**Goal**: La configuración es provider-agnostic y el sistema opera sin mencionar Plane en sitios genéricos
**Depends on**: Phase 4
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. `config.json` tiene campo `provider` y kodo arranca usando el adapter que indica ese campo
  2. Una config v0.1 con solo sección `plane.*` se migra transparentemente: kodo arranca sin error y el provider es `"plane"`
  3. `kodo config` pregunta al usuario qué provider quiere usar y escribe el campo `provider` correctamente
  4. El prompt del orchestrator no contiene referencias a Plane, Plane MCP ni identificadores de Plane
**Plans:** 2 plans

Plans:
- [ ] 05-01: Config migration, wizard update y orchestrator prompt cleanup

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Interface + State Schema | 1/2 | In Progress|  |
| 2. Plane Adapter + Registry | 1/2 | In Progress|  |
| 3. Consumer Rewiring | 0/2 | Not started | - |
| 4. Server + Trigger Abstraction | 0/1 | Not started | - |
| 5. Config + Cleanup | 0/1 | Not started | - |
