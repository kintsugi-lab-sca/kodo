# Requirements: kodo — Milestone v0.18 «Higiene del sidebar de cmux»

**Defined:** 2026-07-22
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.

## v0.18 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Sidebar Doctor (SDR)

- [ ] **SDR-01**: `kodo sidebar doctor` (dry-run por defecto) lista las acciones pendientes clasificadas — grupo faltante → `create`, workspace suelto con grupo esperado → `add`, grupo disuelto por cierre de su anchor → re-crear/`set-anchor`, grupo vacío → `ungroup` — sin ejecutar nada
- [ ] **SDR-02**: `kodo sidebar doctor --fix` ejecuta las acciones usando exclusivamente el allowlist (`create`, `add`, `set-anchor`, `ungroup`); `workspace-group delete` no existe en el código y un guard source-hygiene automático verifica su ausencia
- [ ] **SDR-03**: La detección es 100% determinista y 0 tokens — reutiliza `deriveExpectedGroupName` (`src/session/manager.js`) y `listWorkspaceGroups` (`src/cmux/client.js`); ningún paso consulta un LLM
- [ ] **SDR-04**: El launch path queda byte-idéntico — GRP-01..03 intactos (`--group` solo si el grupo ya existe al lanzar, fail-open en 2 capas)
- [ ] **SDR-05**: Las sesiones adoptadas o ya lanzadas convergen al grupo esperado en el siguiente pase del doctor (resuelve la frontera D-13 de Phase 77)
- [ ] **SDR-06**: El CLI es espejo del patrón `gsd doctor` — `--json` byte-determinista (DX-06) y exit codes deterministas

### Carril orquestador (ORCH — continúa numeración desde ORCH-06, v0.17)

- [ ] **ORCH-07**: Con el orquestador activo, un sidebar con grupos faltantes o workspaces sueltos converge al estado agrupado en ≤1 pase sin intervención humana — el orquestador invoca `kodo sidebar doctor --fix` de piggyback en pases ya motivados por `kodo check` (el sidebar NO es trigger)
- [ ] **ORCH-08**: El skill `kodo-orchestrate` y `src/orchestrator/prompt.md` mencionan el sidebar doctor y reflejan las features v0.17 (handoff + `NEXT:`, superficie dashboard/nudge, `pending_stale`/`pending_fetched_at`, agrupación `--group`) — sin prometer features borradas ni omitir las nuevas (disciplina HYG-08)

### Saneo de deuda v0.17 (DEBT)

- [ ] **DEBT-01**: Un cierre de sesión sin `NEXT:` no deja un `next` obsoleto en `state.tasks` — semántica de clear/stale decidida y aplicada en `upsertTaskHandoff` (`src/session/state.js`)
- [ ] **DEBT-02**: Doc-drift de Phase 75 corregido — comentario de App.js «lee tasks UNA vez por tick» (75/WR-02) y typedef del prop `overlaySnapshot` sin `render` (75/WR-04)
- [ ] **DEBT-03**: `nextCell` colapsa `\n`/`\t` en el render de fila — un `next` hand-editado en `state.json` no descuadra la tabla (75/WR-03)
- [ ] **DEBT-04**: El flaky de `test/gsd-lock-race.test.js` («concurrent dead-holder steal», CR-01) tiene diagnóstico de causa raíz documentado vía `/gsd-debug`; solo se toca con la causa entendida, jamás a ciegas (protege el invariante de locks de v0.16)

## Future Requirements (v2, no en este roadmap)

### Pulido

- **FUT-01**: Fidelidad markdown inline del overlay del plan (`#`/`**` visibles) — solo si molesta en uso real (75-UAT Test 3)
- **FUT-02**: `kodo doctor --fix` asistido para desalineaciones config.json↔projects.json (propuesta compound KODO-10)
- **FUT-03**: Puerta LLM para ambigüedad de agrupación en el sidebar doctor — YAGNI hoy (constraint de la conversación de origen 2026-07-20)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| `workspace-group delete` | Destructivo (cierra todos los workspaces del grupo); NI SE CABLEA — constraint LOCKED 2026-07-20; guard source-hygiene lo verifica (SDR-02) |
| Sidebar como trigger del orquestador | La higiene va de piggyback en pases ya motivados por `kodo check` — constraint LOCKED; consistencia eventual asumida |
| Gestión de grupos en el launch path | GRP-04 re-fronterizado conscientemente: la gestión pasa a estar permitida SOLO en el carril doctor; el launch sigue fail-open byte-idéntico |
| Renombrar el grupo `SCP-CMRi` → `SCP` | Acción de operador, no de código (audit v0.17) |
| IN-07 / R-77-D10 (retry TOCTOU puede duplicar workspace) | Riesgo aceptado y documentado (LOCKED D-10, 78-SECURITY.md §Accepted Risks) |
| CONC-09 sign-off empírico de worktrees · UAT GitHub del backstop | Diferidos por diseño/entorno (D-15 / repo GitHub real); siguen trazados en STATE.md §Deferred Items |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SDR-01 | Phase 79 | Pending |
| SDR-02 | Phase 79 | Pending |
| SDR-03 | Phase 79 | Pending |
| SDR-04 | Phase 79 | Pending |
| SDR-05 | Phase 79 | Pending |
| SDR-06 | Phase 79 | Pending |
| ORCH-07 | Phase 80 | Pending |
| ORCH-08 | Phase 80 | Pending |
| DEBT-01 | Phase 81 | Pending |
| DEBT-02 | Phase 81 | Pending |
| DEBT-03 | Phase 81 | Pending |
| DEBT-04 | Phase 81 | Pending |

**Coverage:**
- v0.18 requirements: 12 total
- Mapped to phases: 12 ✓ (SDR-01..06 → Phase 79 · ORCH-07..08 → Phase 80 · DEBT-01..04 → Phase 81)
- Unmapped: 0 ✓ (sin huérfanos, sin duplicados)

---
*Requirements defined: 2026-07-22*
*Last updated: 2026-07-22 after roadmap creation (phases 79-81 mapped; coverage 12/12)*
