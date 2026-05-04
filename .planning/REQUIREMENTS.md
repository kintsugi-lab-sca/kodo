# Requirements: kodo

**Defined:** 2026-05-04
**Milestone:** v0.5 — CLI Polish & v0.3 Debt Cleanup
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo, disparando dos modos GSD (full multi-fase / quick one-shot) sin acoplar el código GSD al proveedor.

## Milestone v0.5 Requirements

Pulir la experiencia del CLI con colores y formato legible, y cerrar la deuda técnica heredada de v0.3 (LOG-09 + UATs Phase 7) sin tocar el alcance de adapters.

### DX — CLI Polish

- [ ] **DX-01**: `kodo logs` colorea cada nivel (debug=gris, info=cyan, warn=amarillo, error=rojo) con TTY detection y respeto a `NO_COLOR` / `FORCE_COLOR`.
- [ ] **DX-02**: `kodo logs` reformatea stderr con columnas alineadas (`timestamp · level · component · message`); `--json` no se ve afectado.
- [ ] **DX-03**: `kodo gsd inspect <task-id>` presenta el verdict del resolver con símbolos `✓`/`✗` por sección y exit code visible al final.
- [ ] **DX-04**: `kodo gsd verify <session-id>` colorea pass / soft-fail / hard-fail (verde / amarillo / rojo) y muestra resumen del comentario Plane.
- [ ] **DX-05**: `kodo check` colorea OK/FAIL en su tabla sin cargar `src/logger.js` (preserva el guard LOG-12 de bajo coste).
- [ ] **DX-06**: Helper `src/cli/format.js` centraliza color/format con TTY detection — invariante: `--json` produce bytes idénticos al output sin TTY (validado por test source-hygiene + golden bytes).
- [ ] **DX-07**: `picocolors` añadido como dependencia en `package.json` y reflejado en el lockfile; documentado en PROJECT.md (primer aumento de deps externas desde v0.2 / commander).

### LOG — Cierre de deuda v0.3

- [ ] **LOG-13**: `dispatcher.js` usa `EVENTS.gsdPhaseResolved` y `EVENTS.gsdBootstrap` en vez de literales `'gsd.phase.resolved'` / `'gsd.bootstrap'`; invariante validado con grep en test source-hygiene.
- [ ] **LOG-14**: `markSessionStatus` se invoca en `verify.js` cuando `verdict.action === 'pass'` y la transición Plane → Review es OK; emite `state.transition` con `from`/`to` reales (documentados como contrato del evento).
- [ ] **LOG-15**: `markSessionStatus` se invoca en `stop.js` cuando se libera el lock per-repo; emite `state.transition` al estado terminal de la sesión, sin romper el flujo de release del lock.

### UAT — Automatización de UATs Phase 7

- [ ] **UAT-01**: Integration test de `kodo logs --follow` — spawn child process con NDJSON que se escribe progresivamente; verifica tail real (no fake), incluyendo cierre limpio del watcher al terminar el test.
- [ ] **UAT-02**: Integration test de `session.start` con campos reales — fixture session que dispara emisión real (`transcript_path`, `session_id`, `plane_task_id`); verifica todos los campos canónicos en NDJSON contra el contrato de Phase 7.
- [ ] **UAT-03**: Integration test de `--session-of <plane-task-id>` E2E — fixture `state.json` + log files; verifica resolución two-step (state.json read → head-line scan) y exit codes.

## Future Requirements

Acknowledged y pendientes pero deferred a v0.6+. Continúan vivos en `PROJECT.md` Active section.

### Adapters

- **GH-01** (TBD): Adapter de GitHub Issues que implementa `TaskProvider`.
- **CU-01** (TBD): Adapter de ClickUp que implementa `TaskProvider`.
- **LOC-01** (TBD): Adapter local (JSON/Markdown) que implementa `TaskProvider`.

### Triggers

- **TRG-01** (TBD): Polling trigger channel para providers sin webhook.
- **TRG-02** (TBD): File watcher trigger para provider local.

## Out of Scope

Explicitly excluded del scope de v0.5. Documentado para evitar scope creep.

| Feature | Reason |
|---------|--------|
| Theming configurable (paletas custom) | YAGNI para CLI personal; un esquema fijo es suficiente |
| Reformat de output `--json` | Contrato deliberado: `--json` debe ser bytes deterministas para parseo |
| Library de TUI completa (ink, blessed) | Overkill — solo necesitamos colores y alineación de columnas |
| Migración a chalk en lugar de picocolors | picocolors cumple el use case con menor footprint |
| Reescritura del logger | LOG-09 es cableado quirúrgico, no rediseño |
| Cobertura E2E con Plane vivo | UATs Phase 7 se automatizan con fixtures, no con instancia real |
| Adapters nuevos (GitHub/ClickUp/local) | Deferred a v0.6 — milestone enfocado en pulido |
| Polling/file-watcher triggers | Deferred a v0.6 — dependen de adapters nuevos |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DX-06 | Phase 14 | Pending |
| DX-07 | Phase 14 | Pending |
| DX-01 | Phase 15 | Pending |
| DX-02 | Phase 15 | Pending |
| DX-03 | Phase 15 | Pending |
| DX-04 | Phase 15 | Pending |
| DX-05 | Phase 15 | Pending |
| LOG-13 | Phase 16 | Pending |
| LOG-14 | Phase 16 | Pending |
| LOG-15 | Phase 16 | Pending |
| UAT-01 | Phase 17 | Pending |
| UAT-02 | Phase 17 | Pending |
| UAT-03 | Phase 17 | Pending |

**Coverage:**
- v0.5 requirements: 13 total
- Mapped to phases: 13 ✓
- Unmapped: 0 ✓

**Distribution:**
- Phase 14 (CLI Format Foundation): 2 reqs (DX-06, DX-07)
- Phase 15 (CLI Polish Wiring): 5 reqs (DX-01..05)
- Phase 16 (LOG-09 Debt Cleanup): 3 reqs (LOG-13..15)
- Phase 17 (Phase 7 UAT Automation): 3 reqs (UAT-01..03)

---
*Requirements defined: 2026-05-04*
*Last updated: 2026-05-04 — Traceability completed by roadmapper agent (4 phases, 13/13 mapped)*
