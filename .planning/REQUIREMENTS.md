# Requirements: kodo v0.10 — Higiene y estado real de sesiones

**Defined:** 2026-06-03
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. v0.10 cierra el ciclo de vida de las sesiones: sanea lo muerto y refleja fielmente lo vivo cross-system.

## v1 Requirements

Requirements del milestone v0.10. Cada uno mapea a una fase del roadmap.

### Provider State

Reflejar el estado real del task en el provider (driver: ROMAN-150, sesión "In Review" en Plane invisible tras `/exit`).

- [x] **PSTATE-01**: `getTaskState(taskId)` como método **opcional** del provider (NO en `TASK_PROVIDER_METHODS`) que retorna un estado normalizado `in_progress | in_review | blocked | done | unknown`; Plane mapea por grupo + nombre de estado (substring "review"/"block").
- [x] **PSTATE-02**: GitHub deriva `provider_state` por convención de labels (substring "review"→`in_review`, "block"→`blocked`) + fallback open→`in_progress` / closed→`done`, sin llamadas API extra.
- [x] **PSTATE-03**: la cross-provider contract matrix se extiende con un assert **capability-gated** para `getTaskState` (no rompe el determinismo PROVIDERS × N_asserts).
- [x] **PSTATE-04**: `GET /status` enriquece cada sesión con `provider_state` vía cache server-side (TTL ~10-30s por `task_id`), **fail-open por fila** (omite el campo si la llamada falla o el provider no soporta el método), sin acoplar `alive`/`elapsed_min` ni escribir en `state.json`.
- [x] **PSTATE-05**: el dashboard muestra `provider_state` de forma separada de `statusColor` v3 (forma exacta — columna vs badge vs color — decidida en discuss-phase).
- [x] **PSTATE-06**: el filtro del dashboard permite acotar por `provider_state` con `String.includes` anti-ReDoS (semántica `s:review` OR vs prefijo `ps:` decidida en discuss-phase).

### Doctor

`kodo gsd doctor` — utilidad de saneo del ciclo de vida.

- [x] **DOCTOR-01**: `kodo gsd doctor` detecta y reporta (**dry-run por defecto**) las 4 categorías de basura: worktrees huérfanos, sesiones zombie (`alive===false`), locks per-repo colgados (PID muerto / TTL), logs NDJSON antiguos.
- [x] **DOCTOR-02**: `kodo gsd doctor --fix` ejecuta el saneo **re-checando liveness** (`isPidAlive` + `alive`) antes de cada acción destructiva; reusa `git worktree remove/prune` (no `rm -rf`) y los helpers existentes de `lock.js`/`stop.js`.
- [x] **DOCTOR-03**: output agrupado por categoría; exit code determinista **0=limpio / 1=problemas encontrados**.
- [x] **DOCTOR-04**: la lógica de saneo vive en un módulo puro `src/gsd/doctor.js` (espejo de `reconcile.js`), reusable por el CLI `gsd doctor` y por el dismiss del dashboard — una sola fuente de saneo.

### Dismiss

Descartar sesiones dead desde el dashboard — la TUI pasa de read-only a read-write (promoción del backlog 999.1).

- [x] **DISMISS-01**: la tecla `d` sobre una fila `alive===false` invoca `DELETE /sessions/{id}` (endpoint ya existente) reusando la lógica de saneo de `doctor`.
- [x] **DISMISS-02**: confirmación inline en el footer (doble `d` / `Esc`) resuelta contra la identidad `task_id`, nunca contra índice de array ni snapshot congelado.
- [x] **DISMISS-03**: la mutación pasa por la capa `client.js` **never-throws** — un error muestra mensaje en el footer sin desmontar el panel (preserva el invariante no-crash de v0.9).
- [x] **DISMISS-04**: guard inverso al de Enter — rechaza `alive===true`, nunca descarta una sesión viva.

## v2 Requirements

Diferidos a un milestone futuro. Reconocidos pero fuera del roadmap actual.

### Provider State (extensiones)

- **PSTATE-F1**: GitHub deriva `in_review` del review-state del PR linkeado (vía Timeline API) cuando el issue no tiene label de review — descartado como path primario por ser N+1 frágil.
- **PSTATE-F2**: distinguir `cancelled`/`closed` (won't-do) de `done` (completado) en el vocabulario normalizado — colapsados a `done` en v0.10 hasta que aparezca un driver real.

### Doctor (extensiones)

- **DOCTOR-F1**: confirmación interactiva por-item en `--fix` (hoy es herramienta personal, sin confirmación por-item).

## Out of Scope

Exclusiones explícitas para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Undo del dismiss | El registro descartado es de una sesión ya muerta; no hay estado vivo que restaurar |
| Vocabulario normalizado > 5 estados (backlog/triage/cancelled/paused) | Son estados pre-sesión o won't-do irrelevantes para un dashboard de sesiones vivas; colapsan a `done`/`in_progress` |
| `getTaskState` obligatorio en el contrato (9→10 métodos en `TASK_PROVIDER_METHODS`) | El registry loop lanzaría al arranque para adapters incompletos; va como método opcional + capability `supported` (patrón `listComments` v0.9) |
| Nuevos endpoints en `src/server.js` | `DELETE /sessions/{id}` y `GET /status` ya existen; el enrichment y el dismiss reusan el contrato |
| Acoplar el lifecycle de kodo al estado del provider | `provider_state` es un carril read-only en `/status`; `alive` sigue siendo escrito solo por `reconcileTick` |
| Rotación/shipping de logs (Loki/Datadog/Prometheus) | `doctor` solo limpia logs locales antiguos; el resto sigue deferido como LOG-F1..F3 |

## Traceability

Mapa requirement → fase. Completado por el roadmapper al crear el roadmap (2026-06-03).

| Requirement | Phase | Status |
|-------------|-------|--------|
| PSTATE-01 | Phase 40 | Complete |
| PSTATE-02 | Phase 40 | Complete |
| PSTATE-03 | Phase 40 | Complete |
| PSTATE-04 | Phase 40 | Complete |
| PSTATE-05 | Phase 43 | Complete |
| PSTATE-06 | Phase 43 | Complete |
| DOCTOR-01 | Phase 41 | Complete |
| DOCTOR-02 | Phase 41 | Complete |
| DOCTOR-03 | Phase 41 | Complete |
| DOCTOR-04 | Phase 41 | Complete |
| DISMISS-01 | Phase 42 | Complete |
| DISMISS-02 | Phase 42 | Complete |
| DISMISS-03 | Phase 42 | Complete |
| DISMISS-04 | Phase 42 | Complete |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14 ✓ (Phase 40: 4 · Phase 41: 4 · Phase 42: 4 · Phase 43: 2)
- Unmapped: 0 ✓

**Phase summary:**
- **Phase 40 — Provider State** (contrato + providers + enrichment): PSTATE-01, PSTATE-02, PSTATE-03, PSTATE-04
- **Phase 41 — Doctor** (módulo puro + CLI): DOCTOR-01, DOCTOR-02, DOCTOR-03, DOCTOR-04
- **Phase 42 — Dismiss** (TUI read-write): DISMISS-01, DISMISS-02, DISMISS-03, DISMISS-04
- **Phase 43 — Render** (provider_state en el dashboard, discuss-phase): PSTATE-05, PSTATE-06

---
*Requirements defined: 2026-06-03*
*Last updated: 2026-06-03 — traceability completada por el roadmapper (14/14 mapeados a Phases 40-43)*
