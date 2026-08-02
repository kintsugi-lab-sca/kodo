# Requirements: kodo — Milestone v0.20 «Cierre de deuda trazada»

**Defined:** 2026-08-02
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.

**Naturaleza del milestone:** saneo puro, **sin feature nueva**. Los cuatro items entran con causa raíz ya localizada en fichero y línea; ninguno es especulativo. Precedente: Phase 85 (v0.19) y Phase 81 (v0.18).

## v1 Requirements

### Concurrencia del lock GSD (R-82-01)

- [ ] **LOCK-04**: Con un holder stale pero **VIVO** que libera el lock en plena sección crítica del steal, un stealer NO puede sobrescribir el lock fresco de un creador Case-1 legítimo — la rama PRESENT de `stealLock` (`src/gsd/lock.js:453-471`) re-valida la identidad del `lockPath` (`ino` + bytes, baseline tomado de la lectura de la propia sección crítica) inmediatamente antes del `renameSync` destructivo y aborta con un `reason` discriminado si cambió, en vez de clobbear.
- [ ] **LOCK-05**: El harness de carrera siembra un holder **VIVO** (hoy solo siembra dead-PID vía `DEAD_PID`/`writeStaleDeadLock`, que es exactamente por qué esta carrera es invisible) y demuestra cardinalidad exacta: con N≥2 procesos y un release concurrente, adquiere **uno solo**.
- [ ] **LOCK-06**: El guard tiene **mordida verificada**: revertir a mano el CAS de LOCK-04 pone el harness ROJO. La verificación no debilita ningún assert, no sube timeouts y no amplía presupuestos de reintento — constraint DEBT-04 heredado, LOCKED.
- [ ] **LOCK-07**: La ventana residual del CAS (2 syscalls contiguos entre la comprobación de identidad y el `renameSync`) queda **declarada** en el JSDoc de `stealLock` y en `STATE.md`, con su clase de riesgo nombrada — misma clase que la ventana residual aceptada en el guard del inbox de Phase 83. Nunca presentada como cierre por construcción.

### Distribución de skills (D-08b)

- [ ] **SYNC-01**: Un operador que solo use `kodo orchestrate` y **nunca** ejecute `kodo skill sync` a mano recibe todas las skills de la allowlist congelada — hoy recibe únicamente `kodo-orchestrate`, de modo que `/kodo-capture` (v0.19 Phase 84) no le llega jamás.
- [ ] **SYNC-02**: El carril de auto-sync de `src/orchestrator/launch.js` consume la **misma allowlist congelada** que el CLI `kodo skill sync` — fuente única aseverada por test, de modo que añadir una skill futura no exija volver a tocar `launch.js`.
- [ ] **SYNC-03**: El auto-sync es resiliente por skill y **fail-open respecto al launch**: el fallo de sincronización de una skill no impide la de las demás ni bloquea el arranque del orquestador.

### Aislamiento de color en el TUI (D-18 + OQ-1 + UF-02)

- [ ] **ISO-01**: El guard de color-isolation detecta el arrastre **transitivo** de picocolors al grafo del TUI, no solo el import directo. Hoy el guard directo está verde mientras el leak existe.
- [ ] **ISO-02**: Los **3 leaks reales medidos** quedan cerrados: `src/cli/dashboard/App.js:73` y `src/cli/dashboard/markdown.js:27` dejan de alcanzar `src/cli/format.js` (hoy vía `stripControlChars`), y `src/cli/dashboard/SessionTable.js` deja de heredarlo por ambas vías.
- [ ] **ISO-03**: La pureza de `src/cli/dashboard/format.js` queda **congelada por un test** (UF-02): es la premisa sobre la que descansa que `select.js` pueda importarlo sin arrastrar color, y hoy ningún test la asevera.
- [ ] **ISO-04**: El guard cubre `import()` dinámico **o** declara con honestidad lo que no cubre — el comentario de premisa falsa de `test/format-isolation.test.js:14` y `:33` («el repo no lo usa») desaparece, porque es falso hoy (`src/providers/registry.js:27,28,57,58`, `src/session/state.js:247`). Un fichero no puede quedar declarando un punto ciego que no tapa.

### Verdad documental (D-20)

- [ ] **DOC-01**: `.planning/codebase/TESTING.md` refleja el inventario real de `test/` — hoy lista **2 ficheros** (congelado desde 2026-04-07) frente a **181 ficheros `*.test.js` / 2590 tests** reales. Falla como inventario, no como guía: framework (`node:test` + `node:assert/strict`), inyección de dependencias y `beforeEach`/cleanup siguen siendo correctos y no se reescriben.

## v2 Requirements

Diferidos con su trigger real. No entran en este roadmap.

### Concurrencia

- **LOCK-F1**: Rediseño del primitivo de lock — serializar `acquireGsdLock` Case-1 y `releaseGsdLock` con el mismo steal-guard, cerrando la carrera **por construcción** sin ventana residual. Descartado explícitamente por el mantenedor (2026-08-02) a favor del CAS simétrico: toca el camino caliente de dispatcher, orchestrator y polling. Trigger: que la ventana residual de LOCK-07 se manifieste en uso real.

### Inbox

- **CAPT-F1**: Filtros `--project` / `--open` en `kodo inbox`. Trigger: volumen real de capturas.
- **CAPT-F2**: Archival / rotación del inbox. Trigger: que el fichero crezca hasta molestar.

### Configuración y proveedores

- **CFGF-01**: Hot-reload de config en server/daemon (hoy exige reinicio).
- **PLANE-F1**: `Retry-After` en 429 del cliente Plane.
- **PLANE-F2**: Filtro server-side por label kodo en polling.
- **PLANE-F3**: Paginación del listado de work items.
- Adapters nuevos: ClickUp · local JSON/Markdown + file watcher · webhook GitHub ingress real-time.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rediseño del primitivo de lock (LOCK-F1) | Decisión del mantenedor 2026-08-02: el CAS simétrico cierra la ventana del review a una fracción del coste y del riesgo de regresión. Rediseñar el primitivo toca dispatcher, orchestrator y polling — es un milestone propio, no un item de saneo. |
| Greenear `gsd-lock-race` por reducción probabilística | Constraint DEBT-04 heredado y LOCKED: nada se greenea debilitando asserts, subiendo timeouts ni ampliando presupuestos de reintento. Ya se revirtió una vez por esto en Phase 83. |
| Feature nueva de cualquier tipo | v0.20 es saneo puro. Meter feature diluye el criterio de cierre y repite el patrón que la RETROSPECTIVE de v0.16 marcó como error (Phase 73 planificada sobre un síntoma). |
| Reescribir la guía de `TESTING.md` (framework, DI, cleanup) | Esa parte del documento **es correcta**. DOC-01 refresca el inventario, no la guía. |
| UAT GitHub real del backstop · evidencia en vivo del round-trip `--fix` 79/80 · CONC-09 sign-off | Requieren estado externo que no se puede fabricar (repo GitHub real, deriva real del sidebar, sesión GSD viva). Siguen abiertos con su trigger original — v0.19 los **contabilizó**, que no es resolverlos. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOCK-04 | Phase 86 | Pending |
| LOCK-05 | Phase 86 | Pending |
| LOCK-06 | Phase 86 | Pending |
| LOCK-07 | Phase 86 | Pending |
| ISO-01 | Phase 87 | Pending |
| ISO-02 | Phase 87 | Pending |
| ISO-03 | Phase 87 | Pending |
| ISO-04 | Phase 87 | Pending |
| SYNC-01 | Phase 88 | Pending |
| SYNC-02 | Phase 88 | Pending |
| SYNC-03 | Phase 88 | Pending |
| DOC-01 | Phase 88 | Pending |

**Coverage:**
- v1 requirements: 12 total
- Mapped to phases: 12 ✓ (Phase 86: 4 · Phase 87: 4 · Phase 88: 4)
- Unmapped: 0 ✓
- Duplicados: 0 — cada requirement mapea a exactamente una fase

---
*Requirements defined: 2026-08-02*
*Traceability mapeada: 2026-08-02 al crear el roadmap v0.20 (3 fases, granularidad `coarse`, 12/12 requirements, cero orphans).*
*Last updated: 2026-08-02 al abrir el milestone v0.20 «Cierre de deuda trazada» — sin research (causa raíz localizada en código en los 4 items). Radio de D-18 medido antes de definir el scope: 3 ficheros del TUI arrastran picocolors transitivamente.*
