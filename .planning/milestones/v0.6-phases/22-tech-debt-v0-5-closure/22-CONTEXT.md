# Phase 22: Tech Debt v0.5 Closure - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 22 --auto (auto-mode single pass)

<domain>
## Phase Boundary

Cerrar el Resolution Log acumulado en v0.5 (Phases 14/15/16) sin alterar comportamiento runtime ni golden bytes. Transformar 6 DEBT requirements en commits limpios:

- **DEBT-01 (Phase 14):** `SECURITY.md` para Phase 14 con `threats_open: 0` auditado (low-risk presentation-only — solo CLI output).
- **DEBT-02 (Phase 14):** `test/version-smoke.test.js` recibe `timeout` explícito en `spawnSync` (WR-01 Phase 14); regresión cubierta por `test/format-isolation.test.js` walker existente.
- **DEBT-03 (Phase 14):** Regex ANSI defensiva en `src/cli/format.js#visibleWidth` (IN-01) + test explícito `FORCE_COLOR=''` con `useColor=false` esperado (IN-02). Matriz `NO_COLOR > FORCE_COLOR > stream.isTTY` sigue verde.
- **DEBT-04 (Phase 15):** Retirar `ANSI_RESET` y `COLOR_BY_LEVEL` exports de `src/logger.js` (IN-01 Phase 15). Grep cross-repo verifica 0 consumers externos en `src/`; `test/logger-exports.test.js` se ajusta (borra los tests sobre los exports retirados o se elimina si solo testea esos).
- **DEBT-05 (Phase 16):** 8 WR del Resolution Log Phase 16 cerrados:
  - WR-01 stop.js — doble creación de logger
  - WR-02 stop.js — catch-todo silencia errores de programación
  - WR-03 verify.js — logger threading triplica child bindings
  - WR-04 stop-state-transition.test.js — Test 4 D-04 invariante valida solo `to`, no `from`
  - WR-05 gsd-verify-integration.test.js T27 — falta assert `markSessionStatus` ANTES de throw
  - WR-06 dispatcher.js — doble import eager `EVENTS` + dynamic helpers
  - WR-07 stop.js — catch no distingue logger fail vs lookup-not-found
  - WR-08 dispatcher-isolation.test.js — `stripComments` no captura inline
- **DEBT-06 (Phase 16):** 4 IN cosméticos/documentales Phase 16:
  - IN-01 stop.js — `runStopHook` no inyecta `releaseGsdLock`/`handleOrchestratorStop`
  - IN-02 dispatcher.js — falta test que valide shape exacto del payload tras EVENTS.* migration
  - IN-03 verify.js — comentario línea 240-245 cita "header line 26" sin auto-referencia
  - IN-04 stop.js — comentario cita "line 116" incorrecto tras refactor

Cubierto por esta phase:
- 3 plans agrupados por surface: Phase 14 closure (DEBT-01/02/03), Phase 15 closure (DEBT-04), Phase 16 closure (DEBT-05/06).
- Tests defensivos donde aplique: `spawnSync timeout` (DEBT-02), regex ANSI ampliada (DEBT-03), FORCE_COLOR='' explícito (DEBT-03), `from` assert (WR-04), markSessionStatus pre-throw (WR-05), payload shape (IN-02).
- Source-hygiene asserts cuando el fix lo permita (DEBT-04 grep + walker — 0 consumers en `src/`).
- Comentarios actualizados con referencias por contenido (no offset) — IN-03, IN-04.

Fuera de scope (Phase 22):
- 5 IN de Phase 15 (`WR-01 TRANSIENT_PATTERNS regex`, `WR-02 formatLine instancia formatter`, `IN-02 raw ANSI en writeNdjson`, `IN-03 dos formatters en runCheck`, `IN-04 comentario lazy gsd-verify`, `IN-05 gsd inspect exit 0`) — REQUIREMENTS.md DEBT-04 limita Phase 22 a retirar ANSI_* exports (IN-01 Phase 15 únicamente). El resto queda como deuda residual documentada en MILESTONES.md v0.5 (asumido por design).
- Refactor mayor de `runStopHook` para inyectar también `releaseGsdLock` (IN-01 Phase 16) — se aborda como sugerencia documental, NO se cambia la signature (riesgo de breaking changes en callers de tests Phase 16 LOG-13/14/15). El fix concreto: documentar el patrón "dynamic import for lazy DI" en un comentario JSDoc.
- Cambio de comportamiento runtime — DEBT-01..06 son todos cleanup interno. Bytes de output del CLI (golden bytes Phase 14 DX-06), bytes de comentarios Plane (Pitfall #6), exit codes deterministas (D-19/Pitfall #6 Opción A) — TODOS preservados.
- Migración de tests existentes que ya pasan — solo extensión donde se identifica gap (WR-04, WR-05, IN-02).

Fuera de scope (otras phases v0.6):
- HOOK-01 anti-push (Phase 20 completada).
- Skill sync CLI (Phase 21 completada).
- WR-04/05/06 deferred follow-up de Phase 21 (REVIEW Phase 21 advisory).

</domain>

<decisions>
## Implementation Decisions

### Granularidad de plans (3 plans agrupados por surface)

- **D-01:** 3 plans, uno por phase-of-origin:
  - **22-01** (Wave 1) — Phase 14 closure: DEBT-01 (SECURITY.md) + DEBT-02 (WR-01 timeout) + DEBT-03 (IN-01 regex + IN-02 FORCE_COLOR='').
  - **22-02** (Wave 1, paralelo) — Phase 15 closure: DEBT-04 (retiro ANSI_* exports de `src/logger.js`).
  - **22-03** (Wave 1, paralelo) — Phase 16 closure: DEBT-05 (8 WR) + DEBT-06 (4 IN).
- **D-01b:** Los 3 plans son INDEPENDIENTES (sin `depends_on` cruzados). Wave 1 con 3 plans paralelos en worktrees aislados.
- **D-01c:** Una alternativa monolítica (1 plan) fue descartada: 13+ tasks atómicas en un solo plan rompe el budget de scope (Plan size suele ser 2-5 tasks por Phase precedent). Agrupar por surface mantiene atomicidad por fix.

### Granularidad de tasks dentro de cada plan

- **D-02:** Cada DEBT-XX o WR-XX o IN-XX corresponde a una task discreta. Esto facilita el commit atómico (1 commit por fix) y revert quirúrgico si emerge regresión. Tareas pequeñas (~10-30 LOC cada una) consistente con CLAUDE.md Karpathy regla 3 (cambios quirúrgicos).
- **D-02b:** Excepción: IN-03 + IN-04 de Phase 16 (ambos comentarios obsoletos en mismos archivos `verify.js` y `stop.js`) pueden agruparse en 1 task de "actualizar comentarios obsoletos" — son trivialmente atómicos pero no requieren commits separados.

### SECURITY.md para Phase 14 (DEBT-01)

- **D-03:** Reutilizar plantilla Phase 19 SECURITY.md. Frontmatter:
  ```yaml
  ---
  phase: 14
  date: 2026-05-13
  threats_open: 0
  closed_by: phase-22
  ---
  ```
- **D-03b:** Contenido: justificar formalmente que Phase 14 (CLI Format Foundation) es low-risk presentation-only — solo añade output coloreado al CLI; no procesa input externo, no añade endpoints, no toca auth, no expone secretos. Threat surface = 0. Cita `picocolors` source review (la única dep nueva) — ya auditada por proxy del invariante `--json` byte-deterministic (Phase 14 DX-06).
- **D-03c:** Ubicación: `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` (en el árbol histórico, no en Phase 22 dir). El plan 22-01 lo crea ahí. Razón: SECURITY.md pertenece al phase auditado, no al phase que lo audita retroactivamente.

### Tests defensivos donde aplique

- **D-04:** Cada fix con behavior change añade test que blinda contra regresión:
  - **DEBT-02 WR-01:** `test/version-smoke.test.js` añade `timeout: 5000` al `spawnSync` + assert que el test mismo no excede 6s wall-clock (defensivo, no behavioral).
  - **DEBT-03 IN-01:** Regex ANSI ampliada en `src/cli/format.js#visibleWidth` cubre secuencias multi-param (`\x1b[33;1m`). Test añadido: `visibleWidth('\x1b[33;1mbold yellow\x1b[0m') === 11`.
  - **DEBT-03 IN-02:** Test explícito `_resolveUseColor` con `FORCE_COLOR=''` → `useColor=false`. Phase 14 ya cubre `FORCE_COLOR='1'` → true; este test cierra el gap empty-string.
  - **DEBT-05 WR-04:** Test "Test 4 D-04 invariante" en `stop-state-transition.test.js` extendido con assert `transition.from === <previous-state>`.
  - **DEBT-05 WR-05:** Test T27 en `gsd-verify-integration.test.js` extendido con assert que `markSessionStatus` fue invocado ANTES del throw (verificable via mock call order).
  - **DEBT-06 IN-02:** Test nuevo o extensión que valida shape exacto del payload de `gsd.phase.resolved` tras la migración EVENTS.* — usa `assert.deepEqual` contra payload literal.
- **D-04b:** Refactors puros que no cambian comportamiento (WR-01 stop.js doble logger, WR-03 verify.js triple child binding, WR-06 dispatcher.js doble import, WR-08 stripComments inline) — NO requieren tests nuevos. Los tests existentes de regresión cubren el comportamiento; el fix es source-hygiene.

### DEBT-04: retiro de ANSI_RESET + COLOR_BY_LEVEL (Phase 15 IN-01)

- **D-05:** Grep cross-repo confirma 0 consumers externos en `src/` (verificable hoy: solo comentario en `src/cli/format.js:101` cita `COLOR_BY_LEVEL` por nombre sin import).
- **D-05b:** Tests existentes en `test/logger-exports.test.js` (líneas 11-22) testean los exports. Phase 22 ELIMINA esos tests (no los renombra) — el contrato de Phase 15 era retirar exports, y los tests que los validan ya no aplican.
- **D-05c:** Acción en `src/logger.js`:
  - Eliminar `export const ANSI_RESET = '\x1b[0m';` (línea 42).
  - Eliminar `export const COLOR_BY_LEVEL = Object.freeze({...});` (línea 48 — verificar pre-edit que las constantes ANSI_GRAY/CYAN/YELLOW/RED ya no se referencian; si solo las consume `COLOR_BY_LEVEL`, eliminarlas también — son `const` no exportadas).
  - Si `formatLine` (mismo archivo) los consume internamente, mover las constantes a scope local de `formatLine` o inline.
- **D-05d:** Test guard nuevo: extensión a `test/format-isolation.test.js` (LOG-12 walker) que asserta `src/logger.js` NO contiene `export const ANSI_` (grep negativo). Source-hygiene blindado.
- **D-05e:** Comentario en `src/cli/format.js:101` actualizado para NO citar `COLOR_BY_LEVEL` (cita roto si se elimina) — reemplazar por "level chips: debug/info/warn/error (mapeo equivalente al logger NDJSON, ya no expuesto)".

### Orden de fixes dentro de cada plan

- **D-06:** Fixes independientes paralelos dentro de cada plan (sin orden estricto). El plan agrupa tasks que comparten surface area; tasks dentro pueden re-ordenarse sin afectar resultado. Ejemplo en Plan 22-03: WR-01 (stop.js) y WR-06 (dispatcher.js) NO comparten archivo, son tasks paralelas.
- **D-06b:** Excepción: cuando dos fixes tocan el MISMO archivo (ej. WR-01 + WR-02 + WR-07 todos sobre `src/hooks/stop.js`), el plan los agrupa en una sola task o establece orden explícito para evitar conflicts de merge. Preferencia: agrupar en 1 task per archivo.

### Comentarios actualizados (IN-03 + IN-04)

- **D-07:** Cita por contenido, no por offset. Reemplazos:
  - **IN-03 verify.js línea 240-245:** "header line 26" → "el frontmatter parser (función `parseVerificationFrontmatter` arriba en el mismo archivo)".
  - **IN-04 stop.js D-08/D-09 comments:** "line 116" → "el patrón `sessionEnd` definido más abajo en este archivo".
- **D-07b:** Patrón general: los comentarios que refieren a otro símbolo del mismo archivo deben citarlo por NOMBRE, no por número de línea. Establece convención para futuras phases.

### Phase 16 DEBT-05/06 — tasks por archivo

- **D-08:** Agrupación por archivo para evitar conflict en merges (worktree isolation):
  - **stop.js** (1 task): WR-01 (doble logger) + WR-02 (catch-todo) + WR-07 (catch no distingue) + IN-04 (comentario línea 116) + posible IN-01 (documenter "lazy DI" si aplica).
  - **verify.js** (1 task): WR-03 (triple child binding) + IN-03 (comentario línea 26).
  - **dispatcher.js** (1 task): WR-06 (doble import) + IN-02 (test shape payload).
  - **stop-state-transition.test.js** (1 task): WR-04 (assert `from`).
  - **gsd-verify-integration.test.js** (1 task): WR-05 (assert order pre-throw).
  - **dispatcher-isolation.test.js** (1 task): WR-08 (stripComments inline).

### Verificación post-cierre

- **D-09:** Para cada DEBT-XX, criterio de cierre:
  - `git log --grep="WR-XX\|IN-XX\|DEBT-XX"` → al menos 1 commit que cita el ID.
  - Tests asociados (D-04) pasan green.
  - Suite global verde (~609 tests pass + 1 skip).
  - Para DEBT-04: `grep -r "ANSI_RESET\|COLOR_BY_LEVEL" src/` → 0 matches.
  - Para DEBT-01: `cat .planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` muestra frontmatter `threats_open: 0`.

### Claude's Discretion

- Bytes exactos del SECURITY.md prosa (D-03b). Plantilla Phase 19 SECURITY.md define el shape.
- Reordering de tasks dentro de cada plan (D-06).
- Decisión de mover `ANSI_GRAY/CYAN/YELLOW/RED` constantes locales si solo `COLOR_BY_LEVEL` las consume (D-05c).
- Borrar o ajustar `test/logger-exports.test.js` (D-05b).
- Si IN-01 Phase 16 amerita refactor de `runStopHook` o solo documentación inline (D-02b heurística: documentar si refactor implica cambiar signature).
- Comentario exacto reemplazado en `src/cli/format.js:101` (D-05e).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap, requirements, estado

- `.planning/ROADMAP.md` §"Phase 22: Tech Debt v0.5 Closure" — goal canónico + 5 SCs.
- `.planning/REQUIREMENTS.md` §"Tech debt v0.5 closure (DEBT-*)" — DEBT-01..06 traceability.
- `.planning/STATE.md` — Phase 22 next; v0.5 retrospective deuda residual.
- `.planning/PROJECT.md` §"Current Milestone: v0.6" — Phase 22 cierra la milestone.

### Phase 14 (DEBT-01/02/03 origen)

- `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-REVIEW.md` — WR-01 (spawnSync timeout) + IN-01 (visibleWidth regex) + IN-02 (FORCE_COLOR=''). Fix targets concretos.
- `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-VERIFICATION.md` — confirma SECURITY.md missing (DEBT-01 driver).
- `src/cli/format.js` — sitio de IN-01 (regex `visibleWidth`).
- `test/version-smoke.test.js` — sitio de WR-01 (spawnSync timeout).
- `test/format-isolation.test.js` — referencia LOG-12 walker (extensible para DEBT-04).

### Phase 15 (DEBT-04 origen)

- `.planning/milestones/v0.5-phases/15-cli-polish-wiring/15-REVIEW.md` — IN-01 (`ANSI_*` exports dead). Phase 22 lo cierra.
- `src/logger.js` líneas 42-54 — `ANSI_RESET`, `ANSI_GRAY/CYAN/YELLOW/RED`, `COLOR_BY_LEVEL`. Phase 22 retira los exports.
- `test/logger-exports.test.js` líneas 11-22 — tests sobre los exports (Phase 22 los elimina o reescribe).
- `src/cli/format.js:101` — comentario que referencia `COLOR_BY_LEVEL` por nombre. Phase 22 lo actualiza.

### Phase 16 (DEBT-05/06 origen)

- `.planning/milestones/v0.5-phases/16-log-09-debt-cleanup/16-REVIEW.md` — WR-01..08 + IN-01..04 con `<finding>` blocks por item. Fix targets line-level.
- `src/hooks/stop.js` — WR-01/02/07 + IN-04.
- `src/gsd/verify.js` — WR-03 + IN-03.
- `src/triggers/dispatcher.js` — WR-06.
- `test/stop-state-transition.test.js` — WR-04.
- `test/gsd-verify-integration.test.js` — WR-05.
- `test/dispatcher-isolation.test.js` — WR-08.

### Phase 19 (precedente SECURITY.md)

- `.planning/phases/19-worktree-cleanup-integration/19-SECURITY.md` (si existe, o plantilla equivalente) — frontmatter shape + prosa formal "low-risk presentation-only" análoga.
- Phase 18 D-06 patrón "satisfied-by-design" — análogo para DEBT-01 SECURITY.md de Phase 14 (threats_open: 0 by-construction).

### Convenciones del proyecto

- `CLAUDE.md` — reglas Karpathy (simplicity, surgical changes, no rework). Phase 22 las respeta: cada fix es ~10-30 LOC, NO refactor mayor, NO breaking changes.
- `.planning/codebase/CONVENTIONS.md` — tests con `node --test` directo, source-hygiene patrón Phase 14/16.
- Phase 16 LOG-13/14/15 — invariante: NO romper signature de `runStopHook` (IN-01 Phase 16 → documentar, no refactor).

### Invariantes a preservar

- LOG-12 guard (`kodo check` NO carga `src/logger.js` transitivamente) — DEBT-04 retiro de exports NO añade imports nuevos.
- Color isolation Phase 14 D-07 — `picocolors` solo desde `src/cli/format.js`. DEBT-04 NO altera.
- Source-hygiene D-09/D-10/D-11 Phase 13 — `getGsdMode`/`getSessionMode` única fuente. DEBT-05 fixes NO tocan ese contrato.
- Pitfall #6 Opción A — exit codes deterministas Phase 9/10. DEBT-05 fixes en `verify.js` (WR-03) son source-hygiene, NO alteran exit codes.
- Golden bytes DX-06 — `--json` byte-deterministic. Ningún fix toca formato JSON.
- Phase 21 D-08 — `syncSkill` single-source (2 callsites). Phase 22 NO modifica.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `test/format-isolation.test.js` walker (Phase 14 LOG-12 extension) — extensible para DEBT-04 guard (`src/logger.js` no exporta `ANSI_*`).
- `test/dispatcher-isolation.test.js` `stripComments` (Phase 16) — fix WR-08 lo amplía para inline comments.
- Patrón `tmpdir + HOME override + spawnSync timeout` (Phase 16 CR-02 + Phase 999.1) — referencia para DEBT-02 fix.
- `gsd-sdk query commit --files <list>` — pattern atómico por fix (cada WR/IN un commit citado).

### Established Patterns

- **Cita por contenido, no offset** — D-07 establece convención. Phase 22 lo aplica retroactivamente a IN-03/IN-04 Phase 16.
- **Source-hygiene grep + walker** (Phase 14/16) — DEBT-04 lo blinda para `ANSI_*` exports.
- **Tests defensivos sobre regresión** — patrón Phase 16 LOG-13/14/15. Phase 22 lo aplica a WR-04, WR-05, IN-02.
- **SECURITY.md frontmatter `threats_open: N` + audit prose** — patrón Phase 19. DEBT-01 lo reusa.

### Integration Points

- `.planning/milestones/v0.5-phases/14-cli-format-foundation/` — destino del SECURITY.md DEBT-01 (D-03c).
- `src/logger.js`, `src/cli/format.js`, `src/hooks/stop.js`, `src/gsd/verify.js`, `src/triggers/dispatcher.js` — archivos modificados (~5 src + 6 tests).
- Suite global: target 609 → ~615 pass (+6-10 tests defensivos).

### Risks identificados

- **WR-04 fix puede ser flaky** si el assert sobre `from` depende del orden de transición Plane → kodo. Mitigation: usar fixture con estado pre-determinado, no live Plane.
- **DEBT-04 retiro de exports** podría romper código externo no en `src/` (ej. scripts de usuario). Mitigation: changelog v0.6 documenta el retiro como breaking change interno (no hay usuarios externos hoy).
- **IN-02 test shape payload** puede acoplar al implementation detail. Mitigation: assert solo campos canonical (event_type + keys requeridas), no order.

</code_context>

<specifics>
## Specific Ideas

- Phase 22 cierra v0.6 — DEBT-01..06 son la última deuda v0.5 acumulada. Tras Phase 22, milestone v0.6 está al 100% (5/5 phases).
- Prioridad implícita: DEBT-01 (SECURITY.md) primero porque destrava la audit completion de Phase 14; el resto son cleanup paralelo.
- Phase 22 NO introduce features nuevas — todos los cambios son cleanup interno o refactor leve. Golden bytes preservados por construcción.
- Driver: closing the loop — el ROADMAP marca v0.6 como "in progress" hasta que Phase 22 valide los 6 DEBT requirements. Sin Phase 22, la milestone queda al 80% indefinidamente.

</specifics>

<deferred>
## Deferred Ideas

- **Refactor mayor de `runStopHook` para inyectar releaseGsdLock/handleOrchestratorStop (IN-01 Phase 16)** — fuera de scope (D-02b, riesgo de breaking changes). Documentar como comentario JSDoc explicando el patrón "dynamic import for lazy DI" sin refactor.
- **5 IN restantes de Phase 15 (WR-01 TRANSIENT_PATTERNS regex, WR-02 formatLine instancia, IN-02 raw ANSI writeNdjson, IN-03 dos formatters runCheck, IN-04 comentario lazy, IN-05 gsd inspect exit 0)** — REQUIREMENTS.md DEBT-04 NO los incluye; queda como deuda residual en MILESTONES.md v0.5 retrospective.
- **WR-04/05/06 Phase 21 follow-up advisory** — REVIEW Phase 21 marcó tres WRs como advisory no-blocking. Defer a v0.7+ o Phase 23+ si emerge necesidad.
- **Migración del symlink residual `~/.claude/skills/kodo-orchestrate` con `kodo doctor`** — Phase 21 lo resolvió inline en el primer `kodo skill sync` o `kodo orchestrator`. No requiere doctor adicional.
- **Tests E2E reales contra Plane para WR-04/05** — descartados; los fixtures sintéticos cubren el comportamiento sin requerir live API.
- **Audit retrospectivo de SECURITY.md para Phases 15-21** — sobrescope; cada phase actual genera SECURITY.md en su propia execución vía `/gsd-secure-phase`. Phase 22 solo cierra el gap de Phase 14 retroactivamente.

### Reviewed Todos (not folded)

No hubo todos cross-referenced en esta sesión.

</deferred>

---

*Phase: 22-tech-debt-v0-5-closure*
*Context gathered: 2026-05-13 — auto-mode single pass*
