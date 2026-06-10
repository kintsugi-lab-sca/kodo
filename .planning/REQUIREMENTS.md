# Requirements: kodo v0.11 — Ventana al plan

**Defined:** 2026-06-09
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. v0.11 profundiza la observabilidad del dashboard: tras pasar de observabilidad (v0.9) a gestión (v0.10 dismiss), ahora se puede **ver el plan de cada sesión** sin salir de la TUI.

## v1 Requirements

Requirements del milestone v0.11. Cada uno mapea a una fase del roadmap.

### Plan Visibility (PLAN)

Driver: ver el plan de la tarea seleccionada desde el dashboard (igual que hoy se ven comentarios `c` y logs `l`), reusando el patrón de overlays de v0.9 Phase 39. Decisión validada contra docs oficiales de Claude Code: el plan GSD se lee del `PLAN.md` propio (estable, versionado), **no** de rutas internas de Claude Code (transcript JSONL / `~/.claude/plans/` tienen formato no documentado; `TodoWrite` está deprecado). Para sesiones **sin** `PLAN.md` (quick / non-GSD), kodo aplica el mismo principio: en vez de olfatear el plan nativo de Claude Code vía hooks (enfoque spike descartado el 2026-06-09 por frágil/version-specific), **inyecta una instrucción para que la sesión escriba un plan ligero** a una ruta kodo-controlada (PLAN-03), que el overlay muestra igual (PLAN-04).

- [x] **PLAN-01**: El operador puede abrir un overlay (tecla dedicada, junto a `c`/`l`) que muestra el/los `PLAN.md` de la fase GSD de la tarea seleccionada, reusando `resolvePhase` (v0.3 Phase 9) para mapear tarea→fase y leyendo `.planning/phases/<fase>/<N>-NN-PLAN.md` desde `worktree_path ?? project_path`.
- [x] **PLAN-02**: El overlay de plan distingue honestamente los casos sin contenido — tarea no-GSD / sin fase resuelta, fase sin `PLAN.md`, varios `PLAN.md` (lista navegable o concatenados) — con copy distinta por caso, snapshot congelado bajo el poll vivo y `Esc` que preserva el cursor (espejo de los overlays `c`/`l`). La lectura es never-throws / best-effort: ningún error de fichero crashea el panel.
- [x] **PLAN-03**: Toda sesión kodo que hoy no produce un `PLAN.md` (**quick** y **non-GSD**) emite un **plan ligero** a una ruta **kodo-controlada y estable**, mediante una instrucción inyectada en `session-start.js`, correlacionada con la sesión (`task_id` / `session_id` / `cwd`). No depende de hooks no documentados de Claude Code ni de rutas internas — kodo produce el artefacto **activamente**. El bloque inyectado se añade preservando los golden-bytes de los bloques existentes (HOOK-02 satisfied-by-construction). Mantiene quick ligero (no fuerza el ciclo plan/execute/verify).
- [x] **PLAN-04**: El overlay de plan de PLAN-01 lee ese artefacto de plan ligero y lo **muestra para sesiones quick/non-GSD** con la misma UX (snapshot congelado, copy honesta por caso, `Esc` preserva el cursor por `task_id`, lectura never-throws), como **fallback** cuando la fila no tiene `phase_id` / `PLAN.md` GSD. Cero endpoints nuevos en `src/server.js`; el overlay sigue read-only.

### Dashboard Polish (TUI)

Driver: candidatos de mejora detectados en el dogfooding de v0.10. Continúa la numeración TUI de v0.9 (TUI-01..17).

- [x] **TUI-18**: El dashboard **oculta la columna `phase/mode`** cuando ninguna sesión activa es GSD (columna íntegramente vacía → no se renderiza y se recupera el ancho); reaparece automáticamente si entra una sesión GSD. La derivación es pura (React-free), espejo del resto de `select.js`/`format.js`.
- [x] **TUI-19**: El dashboard **marca el estado zombie por-fila en la columna `state`** (no solo en el contador del header), coherente con la redefinición de `status` a outcome de v0.10. El color/marca sale solo de `<Text>` de ink (color isolation preservado).

### Nyquist Debt Backfill (NYQ)

Driver: saldar la deuda Nyquist acumulada (citation-based, sin re-ejecutar la suite — espejo de v0.8 Phase 33 Bloque B).

- [ ] **NYQ-01**: Phases **41 y 43** (v0.10) tienen `VALIDATION.md` citation-based con `nyquist_compliant: true`, citando la evidencia existente (VERIFICATION.md + tests + UAT).
- [ ] **NYQ-02**: Phases **36, 37, 38, 39, 39.1** (v0.9) tienen `VALIDATION.md` citation-based con `nyquist_compliant: true` (backfill de las 2 parciales + 3 ausentes registradas en STATE.md `## Deferred Items`).

## v2 Requirements

Diferidos a un milestone futuro. Reconocidos pero fuera del roadmap actual.

### Plan / Task capture

- **PLAN-F1**: Captura del **estado de Tasks** (sucesor de `TodoWrite`) de una sesión, si Claude Code expone un contrato de persistencia documentado para ellos.
- **PLAN-F2**: Mostrar el progreso de todos en vivo en el dashboard (bloqueado hoy: sin fuente soportada).

### Provider adapters (heredados)

- **ADAPT-F1**: Adapter ClickUp · **ADAPT-F2**: Adapter local (JSON/Markdown) + file watcher · **ADAPT-F3**: Webhook GitHub ingress real-time · **ADAPT-F4**: GitHub Enterprise (`base_url`) · **ADAPT-F5**: OAuth GitHub App.

## Out of Scope

Explícitamente excluido. Documentado para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Parsear el transcript JSONL crudo de Claude Code | Formato interno no documentado, frágil entre versiones (confirmado con `claude-code-guide`). El plan GSD se lee del `PLAN.md` propio. |
| Leer `~/.claude/plans/` o `~/.claude/todos/` | Formato no documentado / `TodoWrite` deprecado desde v2.1.142; sin correlación fiable con `task_id`. |
| Mostrar todos en vivo de una sesión | Sin fuente de datos soportada hoy (deferido a PLAN-F2). |
| Nuevos endpoints en `src/server.js` para el plan | El overlay lee ficheros del filesystem (como hace `focus.js` con cmux); no se añaden endpoints — invariante de cero-endpoints se preserva salvo decisión explícita en discuss-phase. |
| Editar/escribir el `PLAN.md` desde el dashboard | El overlay es read-only; la única superficie read-write de la TUI sigue siendo el dismiss de v0.10. |

## Traceability

Qué fases cubren qué requirements. Se completa durante la creación del roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLAN-01 | Phase 44 | Complete |
| PLAN-02 | Phase 44 | Complete |
| PLAN-03 | Phase 45 | Complete |
| PLAN-04 | Phase 46 | Complete |
| TUI-18 | Phase 44 | Complete |
| TUI-19 | Phase 44 | Complete |
| NYQ-01 | Phase 47 | Pending |
| NYQ-02 | Phase 47 | Pending |
