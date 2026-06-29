# Requirements: kodo — v0.14 Configuración editable desde el dashboard

**Defined:** 2026-06-29
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. El dashboard, ya superficie de observabilidad+gestión, gana ahora la capacidad de **configurar kodo** sin re-correr el wizard lineal.

## v1 Requirements

Requisitos del milestone v0.14. Cada uno mapea a una fase del roadmap.

### UX — Entrada y edición en la TUI

- [x] **UX-01**: El operador abre un editor de configuración desde el dashboard con una tecla dedicada (overlay), sin salir del dashboard ni re-correr `kodo config`.
- [x] **UX-02**: El operador puede escribir y editar valores de texto (rutas, números, strings) dentro del editor — campo editable en ink con cursor, backspace y confirmación.
- [x] **UX-03**: El operador puede cancelar la edición sin guardar (`Esc`) y volver al dashboard preservando su estado (selección de sesión por identidad `task_id`).
- [x] **UX-04**: El editor degrada con gracia ante errores (config ilegible, provider caído, escritura fallida) sin tumbar el dashboard — never-throws, panel ink permanece montado, mensaje claro al footer.

### PROJ — Editor de proyectos

- [ ] **PROJ-01**: El operador ve la lista de proyectos del provider (`listProjects()` en vivo) con su estado de mapeo actual (ruta local o "sin mapear").
- [x] **PROJ-02**: El operador puede asignar o editar la ruta local de un proyecto; la ruta se valida (debe existir) antes de aceptarse.
- [x] **PROJ-03**: El operador puede quitar el mapeo de un proyecto (dejarlo sin seguir) desde el editor.
- [x] **PROJ-04**: El operador puede mapear carpetas de módulos independientes de un proyecto (opcional), espejo del soporte de módulos del wizard.
- [ ] **PROJ-05**: Si `listProjects()` falla (sin conexión / provider caído), el editor lo comunica y permite reintentar o salir, sin crashear ni corromper el mapeo existente.

### CFG — Editor de ajustes comunes

- [x] **CFG-01**: El operador puede editar `claude.default_model` y `claude.max_parallel`.
- [x] **CFG-02**: El operador puede editar los estados del provider (`states.trigger` / `review` / `done`).
- [x] **CFG-03**: El operador puede editar los thresholds del server (`server.idle_threshold_min` / `stuck_threshold_min`).
- [x] **CFG-04**: El operador puede editar los colores cmux (`cmux.colors`: running / done / error / review).
- [x] **CFG-05**: Los valores se validan antes de guardar (p.ej. `max_parallel` y thresholds enteros positivos; `default_model` de un set conocido); un valor inválido se rechaza con mensaje, sin escribir el archivo.

### PERSIST — Persistencia, seguridad y propagación

- [x] **PERSIST-01**: Los cambios de proyectos se persisten a `~/.kodo/projects.json` y los de ajustes a `~/.kodo/config.json`, preservando el formato y la migración de schema existentes (`loadConfig`/`saveConfig`/`loadProjects`/`saveProjects`).
- [x] **PERSIST-02**: La escritura ocurre localmente **sin añadir endpoints al server** (`src/server.js` intacto) — vía filesystem directo o shell-out a `kodo config`, preservando "cero endpoints nuevos desde v0.10".
- [x] **PERSIST-03**: Tras guardar, el dashboard avisa de que hay que reiniciar server/daemon para aplicar (sin hot-reload).
- [x] **PERSIST-04**: Las API keys nunca se editan ni se muestran en el editor; siguen viviendo exclusivamente en `~/.kodo/.env`.
- [x] **PERSIST-05**: La escritura es no-corruptiva: si falla, el archivo previo se preserva (nunca queda un `config.json`/`projects.json` a medias).

## v2 Requirements

Diferidos a futuros milestones. Trackeados, fuera del roadmap actual.

### CONFIG-FUTURE

- **CFGF-01**: Hot-reload de config en server/daemon sin reiniciar (aplicación en vivo de los cambios).
- **CFGF-02**: `kodo config` CLI no-lineal (p.ej. `kodo config projects add <id> <ruta>`) compartiendo fontanería con el editor del dashboard.
- **CFGF-03**: Edición desde la TUI de campos estructurales del provider (`base_url`, `workspace_slug`, `api_key_env`, provider activo).

## Out of Scope

Excluido explícitamente para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Hot-reload de config en el server/daemon | El operador aceptó el aviso de reinicio; hot-reload añade superficie de fallo (config en memoria) — diferido a CFGF-01 |
| Edición de API keys / secrets desde la TUI | Invariante de seguridad: las keys viven solo en `~/.kodo/.env`, nunca en config.json ni en la TUI |
| Edición de `provider` activo / `base_url` / `workspace_slug` / `api_key_env` | Cambios estructurales raros; siguen en el wizard `kodo config` — diferido a CFGF-03 |
| Refactor / mejora del wizard `kodo config` CLI | Vehículo de este milestone es solo el dashboard; el wizard se deja como está |
| Crear proyectos nuevos en el provider desde el editor | kodo no crea proyectos (la creación introducida en v0.13 es de *tareas*, no de proyectos) |
| Endpoint nuevo en el server para escribir config (`POST /config`) | Viola "cero endpoints nuevos desde v0.10"; la escritura es local |

## Traceability

Qué fases cubren qué requisitos.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UX-01 | Phase 63 | Complete |
| UX-02 | Phase 63 | Complete |
| UX-03 | Phase 63 | Complete |
| UX-04 | Phase 63 | Complete |
| PROJ-01 | Phase 64 | Pending |
| PROJ-02 | Phase 64 | Complete |
| PROJ-03 | Phase 64 | Complete |
| PROJ-04 | Phase 64 | Complete |
| PROJ-05 | Phase 64 | Pending |
| CFG-01 | Phase 63 | Complete |
| CFG-02 | Phase 63 | Complete |
| CFG-03 | Phase 63 | Complete |
| CFG-04 | Phase 63 | Complete |
| CFG-05 | Phase 63 | Complete |
| PERSIST-01 | Phase 63 | Complete |
| PERSIST-02 | Phase 63 | Complete |
| PERSIST-03 | Phase 63 | Complete |
| PERSIST-04 | Phase 63 | Complete |
| PERSIST-05 | Phase 63 | Complete |

**Coverage:**

- v1 requirements: 19 total
- Mapped to phases: 19 ✓ (Phase 63: 14 · Phase 64: 5)
- Unmapped: 0 ✓
- Duplicates: 0 (cada requisito mapea a exactamente una fase)

---
*Requirements defined: 2026-06-29*
*Last updated: 2026-06-29 — roadmap v0.14 creado (Phases 63-64), traceability 19/19 mapeada*
