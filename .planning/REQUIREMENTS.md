# Requirements: kodo v0.4 — GSD Quick Mode

**Milestone goal:** Una task etiquetada `kodo:gsd-quick` arranca una sesión Claude que ejecuta `/gsd-quick` (one-shot, sin plan/execute/verify), comparte lock + skip-permissions con `kodo:gsd`, y el orchestrator no intenta verify post-mortem.

**Scope context:** Cierre de la cadena `kodo:gsd-quick`. WIP no-committeado en `src/labels.js` + `src/triggers/dispatcher.js` ya cubre el dispatch; el resto de la cadena (manager, hooks, orchestrator) sigue tratando una sesión quick como no-GSD. Este milestone normaliza el modo de ejecución a través de toda la cadena y blinda con tests.

---

## v0.4 Requirements

### Label parsing & dispatch

- [ ] **QUICK-01**: `parseKodoLabels` expone `'gsd-quick'` en `flags`. `getGsdMode(flags)` devuelve `'quick'` cuando está presente, `'full'` cuando hay `'gsd'` literal, `null` en otro caso. `gsd-quick` gana sobre `gsd` si ambos están presentes (intent más específico).
- [ ] **QUICK-02**: Dispatcher trata `kodo:gsd-quick` como sesión GSD (lock acquisition, ramas resolver). Resolver verdict `phase` en modo quick descarta `phase_id` (la sesión es phase-agnostic). Resolver verdict `error` con `code: 'no-match'` en modo quick NO falla cerrado (continúa al launch). `roadmap-missing` y `multi-match` siguen fail-closed.

### Session persistence

- [ ] **QUICK-03**: `SessionRecord` persiste `gsd: true` para ambos modos (full y quick) y un campo `gsd_mode: 'full'|'quick'` que distingue. Hooks y orchestrator leen `session.gsd_mode` para ramificar.

### Skip-permissions parity

- [ ] **QUICK-04**: `kodo:gsd-quick` implica `--dangerously-skip-permissions` en el comando claude (mismo contrato que `kodo:gsd` desde commit `004995c`). Razón: el slash command `/gsd-quick` también requiere automatización sin tool-confirmation.

### Hook bifurcation

- [ ] **QUICK-05**: SessionStart hook (`buildGsdContext`) inyecta `/gsd-quick "<task title>"` cuando `session.gsd_mode === 'quick'`, en lugar del bloque `/gsd-plan-phase → /gsd-execute-phase → /gsd-verify-work` o del bloque `/gsd-new-project` de bootstrap. La rama quick es one-shot.

### Stop hook semantics

- [ ] **QUICK-06**: Stop hook (`buildStopNudgeText`) NO sugiere `kodo gsd verify <session-id>` cuando `session.gsd_mode === 'quick'`. Razón: quick es one-shot sin `VERIFICATION.md`. El nudge debe pedir revisión manual al humano. El lock se libera igual en ambos modos.

### Orchestrator visibility

- [ ] **QUICK-07**: `buildContextSummary` del orchestrator distingue tres etiquetas en su tag `[GSD …]`: `quick`, `phase N`, `bootstrap`. La sección `## Sesiones GSD` del `prompt.md` aclara que sesiones quick no se verifican via `kodo gsd verify` (el orchestrator las revisa como cualquier sesión no-GSD).

### Test coverage

- [ ] **QUICK-08**: Cobertura de los 4 estados de label (none, `gsd`, `gsd-quick`, ambos) en `test/labels.test.js` (helper), `test/manager.test.js` (`buildSessionFromTask` + skip-perms source-hygiene), `test/dispatcher.test.js` (resolver tolerance + phase_id discard), `test/session-start.test.js` (`buildGsdContext` rama quick).

---

## Future Requirements

(empty — defer items belong to higher-level v0.5+ candidates listed in `PROJECT.md`)

---

## Out of Scope

- **`kodo gsd verify` para quick:** quick es one-shot y no produce `VERIFICATION.md`. Cualquier verificación de calidad en sesiones quick queda al humano que revise la task en Plane.
- **Migración de sesiones existentes en `state.json`:** `gsd_mode` es aditivo y opcional; sesiones legacy siguen leyéndose sin cambios.
- **Cambios en el slash command `/gsd-quick`:** se asume que el comando ya existe en `~/.claude/skills/`.
- **Nuevos tipos de evento NDJSON específicos para quick:** quick reusa `gsd.phase.resolved` (con `phase_id` opcional) y `gsd.bootstrap`. No se añade taxonomía.
- **Polling y otros adapters de provider:** sigue diferido (PROJECT.md Active section).

---

## Traceability

(filled by roadmap)

| Requirement | Phase |
|-------------|-------|
| QUICK-01    | TBD   |
| QUICK-02    | TBD   |
| QUICK-03    | TBD   |
| QUICK-04    | TBD   |
| QUICK-05    | TBD   |
| QUICK-06    | TBD   |
| QUICK-07    | TBD   |
| QUICK-08    | TBD   |

---
*Created: 2026-04-28 — v0.4 milestone requirements*
