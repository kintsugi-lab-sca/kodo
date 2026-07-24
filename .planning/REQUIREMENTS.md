# Requirements: kodo — Milestone v0.19 «Inbox de capturas + fix stealLock + saneo de deuda»

**Defined:** 2026-07-24
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.

## v1 Requirements

Requirements de este milestone. Cada uno mapea a una fase del roadmap.

### Fix stealLock (LOCK)

- [x] **LOCK-01**: Con N≥2 procesos robando el mismo lock GSD muerto, exactamente uno adquiere — la ventana no-atómica move-aside→`O_EXCL` de `stealLock` (`src/gsd/lock.js:283-351`) queda cerrada (diagnóstico base: `.planning/debug/gsd-lock-race-cr01.md` + `81-DEBT-04-DIAGNOSIS.md`)
- [x] **LOCK-02**: El test `gsd-lock-race` pasa verde de forma determinista validando la garantía real (sin debilitar el assert ni enmascarar la carrera — constraint heredado de DEBT-04)
- [x] **LOCK-03**: R-81-01 y la debug session `gsd-lock-race-cr01` quedan formalmente cerradas con la resolución documentada (STATE.md Deferred Items, debug session file)

### Inbox de capturas (CAPT)

- [ ] **CAPT-01**: `kodo capture "idea"` desde cualquier proyecto appendea a `~/.kodo/inbox.md` una línea con `texto · tag-proyecto · fecha · origen`; el append es atómico bajo capturas concurrentes (N capturas concurrentes → N líneas, cero pérdidas) y el texto se sanea a una sola línea en escritura (`stripForKeystroke`, carril keystroke)
- [ ] **CAPT-02**: `/kodo-capture` captura mid-session desde Claude Code con formato byte-idéntico al CLI — el skill deriva proyecto/tarea del contexto de sesión de forma determinista y shellea a `kodo capture` (un solo writer; jamás escribe el fichero directamente)
- [ ] **CAPT-03**: `kodo inbox` lista las capturas abiertas y marca cada una como `enrutada`/`descartada` al procesarla, sin borrar nunca una captura (traza permanente de qué se convirtió en qué); una captura concurrente durante el marcado nunca se pierde (modelo de estado decidido explícitamente en discuss-phase: lock compartido vs event-log append-only)
- [ ] **CAPT-04**: El enrutado de una captura a tarea/fase/config lo hace `gsd-capture` — kodo no reimplementa lógica de destinos (seam documental, sin import de código GSD)
- [ ] **CAPT-05**: `kodo skill sync` distribuye también el skill `kodo-capture` (generalización multi-skill del mecanismo hoy single-skill de `kodo-orchestrate`)
- [ ] **CAPT-06**: Una captura enrutada conserva un trace pointer `→ destino` en su línea cuando el flujo de enrutado aporta una ref utilizable; si `gsd-capture` no devuelve ref barata, la marca `enrutada` queda sin destino (best-effort explícito, nunca bloquea el enrutado)
- [ ] **CAPT-07**: El operador ve el conteo de capturas sin enrutar como superficie ambient (dashboard TUI, reader leaf never-throws sobre `~/.kodo/inbox.md`, cero endpoints nuevos) — presión de triage contra el inbox rot

### Saneo de deuda (DEBT)

- [ ] **DEBT-05**: El typedef `TaskHandoff` (`src/session/state.js`) documenta la semántica post-DEBT-01 (contrato tres-estados del `next` por presencia) — cierra 81-REVIEW WR-01
- [ ] **DEBT-06**: `deriveAnyNext` (`src/cli/dashboard/select.js`) colapsa whitespace al decidir la presencia de la columna `next` (coherente con el render de `nextCell`) — cierra 81-REVIEW WR-02 y con DEBT-05 salda R-81-02
- [ ] **DEBT-07**: Los 3 warnings de 80-REVIEW.md (observabilidad/cobertura) quedan resueltos o re-aceptados individualmente con razón documentada

### Nyquist retroactivo (NYQ)

- [ ] **NYQ-01**: Phases 79/80/81 tienen VALIDATION.md `nyquist_compliant: true` citation-based (`/gsd-validate-phase` retroactivo, evidencia de la suite existente sin re-derivar)
- [ ] **NYQ-02**: Phases 69/71/72 tienen VALIDATION.md `nyquist_compliant: true` citation-based — salda la columna Nyquist de v0.16 en Deferred Items

## v2 Requirements

Diferidos. Trazados pero fuera de este roadmap.

### Inbox de capturas

- **CAPT-F1**: Filtro `--project`/`--open` en `kodo inbox` — solo cuando el inbox tenga volumen real
- **CAPT-F2**: Archival/rotación del inbox — solo si el fichero crece hasta molestar

## Out of Scope

Exclusiones explícitas. Documentadas para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| NLP/quick-add parsing en `kodo capture` | Rompe «capture is instantaneous and dumb»; anti-feature del research |
| Auto-routing en el momento de captura | El triage es paso deliberado separado (GTD); enrutado solo vía `gsd-capture` |
| Múltiples inboxes / inbox por proyecto | Rompe la regla GTD «one trusted inbox»; el tag-proyecto ya segmenta |
| Editor TUI in-place del inbox | El fichero es human-editable en markdown; superficie extra sin valor |
| Endpoint `GET /inbox` en `src/server.js` | Invariante «cero endpoints nuevos desde v0.10»; el dashboard lee filesystem |
| Delete duro de capturas | La traza permanente es el valor del feature; solo transiciones de estado |
| Reimplementar el routing de `gsd-capture` en kodo | CAPT-04 delega; segunda implementación = drift garantizado |
| Deps npm nuevas (lockfile/markdown/uuid) | Invariante cero-deps; `node:fs` + `node:crypto` cubren todo |
| UAT GitHub del backstop · CONC-09 · evidencia en vivo `--fix` 79/80 | No ejecutables a demanda — siguen en Deferred Items con su trigger real |
| Fidelidad markdown best-effort del mini-renderer | Solo si molesta en uso real (trigger sin disparar) |

## Traceability

Qué fases cubren qué requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOCK-01 | Phase 82 | Complete |
| LOCK-02 | Phase 82 | Complete |
| LOCK-03 | Phase 82 | Complete |
| CAPT-01 | Phase 83 | Pending |
| CAPT-02 | Phase 84 | Pending |
| CAPT-03 | Phase 83 | Pending |
| CAPT-04 | Phase 83 | Pending |
| CAPT-05 | Phase 84 | Pending |
| CAPT-06 | Phase 83 | Pending |
| CAPT-07 | Phase 84 | Pending |
| DEBT-05 | Phase 85 | Pending |
| DEBT-06 | Phase 85 | Pending |
| DEBT-07 | Phase 85 | Pending |
| NYQ-01 | Phase 85 | Pending |
| NYQ-02 | Phase 85 | Pending |

**Coverage:**

- v1 requirements: 15 total
- Mapped to phases: 15 ✓
- Unmapped: 0

**Distribución por fase:**

- Phase 82 (Fix stealLock): LOCK-01, LOCK-02, LOCK-03 (3)
- Phase 83 (Inbox foundation — captura + triage): CAPT-01, CAPT-03, CAPT-04, CAPT-06 (4)
- Phase 84 (Superficies de captura): CAPT-02, CAPT-05, CAPT-07 (3)
- Phase 85 (Saneo de deuda + Nyquist): DEBT-05, DEBT-06, DEBT-07, NYQ-01, NYQ-02 (5)

---
*Requirements defined: 2026-07-24*
*Last updated: 2026-07-24 after roadmap creation (milestone v0.19 — 15/15 requirements mapeados a Phases 82-85)*
