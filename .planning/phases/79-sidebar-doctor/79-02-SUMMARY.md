---
phase: 79-sidebar-doctor
plan: 02
subsystem: infra
tags: [cmux, workspace-group, sidebar-doctor, scan-execute, DI, never-throws, reverse-lookup, 0-tokens]

# Dependency graph
requires:
  - phase: 79-01
    provides: "Allowlist no-destructivo en client.js (createWorkspaceGroup/addToWorkspaceGroup/setGroupAnchor/ungroupWorkspaceGroup) + listWorkspacesJson"
  - phase: 77-workspace-groups
    provides: "deriveExpectedGroupName + resolveWorkspaceGroup (manager.js) reutilizados verbatim"
provides:
  - "src/cmux/sidebar-doctor.js: scan(deps) + execute(deps,opts) — el motor determinista 0-token del kodo sidebar doctor (espejo de src/gsd/doctor.js)"
  - "taskLikeFrom(session, projects): reverse-lookup módulo offline (D-02) que reconstruye el task-like sin red"
  - "eventos sidebarDoctorScan/sidebarDoctorFix/sidebarDoctorFixError + EVENTS.SIDEBAR_DOCTOR_* en logger-events.js"
affects: [79-03 (el CLI sidebar doctor renderiza scan/execute), 80-orchestrator (piggyback --fix en kodo check)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doctor scan/execute con DI never-throws, fail-open per item, re-detección TOCTOU (D-06) — espejo estructural exacto de src/gsd/doctor.js"
    - "Re-derivación OFFLINE del grupo esperado por reverse-lookup de módulo en projects.json (D-02), sin persistir estado nuevo (D-03)"
    - "scan async (no sync como gsd doctor) porque los passthroughs cmux son execFile async — los stubs sync de test se resuelven igual vía await"

key-files:
  created:
    - "src/cmux/sidebar-doctor.js"
  modified:
    - "src/logger-events.js"
    - "test/cmux/sidebar-doctor.test.js"
    - "test/logger-events.test.js"

key-decisions:
  - "scan() es ASYNC (await de las raws cmux), no sync como gsd/doctor.js — los passthroughs listWorkspaceGroups/listWorkspacesJson son execFile async; execute await-ea scan; stubs sync de test se resuelven igual vía await"
  - "El split de eventos se hizo por task (SCAN en Task 1, FIX/FIX_ERROR en Task 2) en vez de todos en Task 2, para que sidebar-doctor.js sea importable en cada commit (semántica ESM: importar un named export inexistente lanza al cargar)"
  - "protected en el report = { sessions: [{ref, group, name}] } — sesiones kodo ya bien agrupadas; NO afecta hasActions (D-04)"

patterns-established:
  - "Pattern reverse-lookup módulo: taskLikeFrom mapea session.project_path -> nombre de módulo por first-match estable en entry.modules, alimentando groups=[name] al contrato deriveModuleName"
  - "Pattern TOCTOU en execute: RE-detecta con scan(deps) fresco antes de actuar (nunca consume un report externo); tras create el ref se resuelve por re-list (OQ1), no parseando stdout"

requirements-completed: [SDR-01, SDR-02, SDR-03, SDR-05]

coverage:
  - id: D1
    description: "scan() clasifica missing_group/loose_workspace/empty_group desde el JSON live, never-throws, anchor = started_at más antiguo (D-08), idempotente"
    requirement: "SDR-01"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#sidebar-doctor scan() (9 casos: D-08 anchor oldest, D-06 never-throws, D-04 exclusión, D-05 empty, idempotencia deepEqual)"
        status: pass
    human_judgment: false
  - id: D2
    description: "execute() emite el allowlist en orden D-09 (create --from=oldest -> add -> set-anchor), re-detecta TOCTOU, fail-open per item; el verbo destructivo nunca se emite"
    requirement: "SDR-02"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#sidebar-doctor execute() (spy de argv: orden D-09, fix:false no-op, TOCTOU 0 creaciones, fail-open, never-throws; ningún verbo delete/remove/rename)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Detección 100% determinista, 0 tokens — sidebar-doctor.js no importa provider/LLM/logger.js ni escritor de state; reutiliza deriveExpectedGroupName/resolveWorkspaceGroup verbatim"
    requirement: "SDR-03"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#sidebar-doctor source hygiene (SDR-03) (source assertion sobre imports, comment-stripped)"
        status: pass
    human_judgment: false
  - id: D4
    description: "taskLikeFrom reverse-lookup módulo offline (D-02): path==default -> identifier a secas; path==módulo -> IDENTIFIER/Módulo (first-match estable)"
    requirement: "SDR-03"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#sidebar-doctor taskLikeFrom() (4 casos: flat, default, módulo first-match, project_id sin entry)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Sesión suelta (workspace_ref ∉ member_workspace_refs del grupo existente) -> loose_workspace -> add; convergencia al grupo esperado (SDR-05)"
    requirement: "SDR-05"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#SDR-05 loose_workspace + execute loose->add"
        status: pass
    human_judgment: false
  - id: D6
    description: "Convergencia REAL de sesiones adoptadas/lanzadas en la GUI cmux viva (SDR-05, manual-only per VALIDATION.md — se confirma en el checkpoint del Plan 03)"
    verification: []
    human_judgment: true
    rationale: "La agrupación efectiva del sidebar cmux vivo bajo procesos OS reales no es confirmable en unit (cmux serializa fuera del control de kodo); backstop declarado en el plan"

# Metrics
duration: 18min
completed: 2026-07-23
status: complete
---

# Phase 79 Plan 02: Motor del sidebar doctor Summary

**`src/cmux/sidebar-doctor.js` — el motor determinista 0-token del `kodo sidebar doctor`: `scan()` clasifica las sesiones kodo vivas contra el sidebar real en missing_group/loose_workspace/empty_group y `execute()` re-detecta (TOCTOU) y emite el allowlist no-destructivo en orden D-09, fail-open per item; espejo arquitectónico exacto de `src/gsd/doctor.js`.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-23T10:07:00Z
- **Completed:** 2026-07-23T10:15:00Z
- **Tasks:** 2 (TDD RED/GREEN)
- **Files modified:** 4

## Accomplishments
- `scan(deps)` async never-throws (DI defaults lazy, LOG-12 noopLogger): agrupa las sesiones kodo vivas por nombre de grupo esperado y clasifica en `missing_group` (crea/re-crea), `loose_workspace` (agrupa) y `empty_group` (disuelve), con `protected` que no afecta `hasActions`.
- `taskLikeFrom(session, projects)` reconstruye el task-like offline por reverse-lookup determinista del módulo en `projects.json` (D-02), reutilizando VERBATIM `deriveExpectedGroupName` + `resolveWorkspaceGroup` de `manager.js` — cero red, cero tokens (SDR-03).
- `execute(deps,{fix:true})` RE-detecta con un `scan()` fresco (D-06 TOCTOU, no consume el report del dry-run), emite `create --from=oldest → add(resto) → set-anchor(oldest)` en orden D-09, obtiene el ref del grupo nuevo por re-list (OQ1/Pitfall 2), y aísla cada acción en su try/catch (fail-open per item); never-throws top-level.
- 3 eventos NDJSON nuevos (`sidebarDoctorScan`/`sidebarDoctorFix`/`sidebarDoctorFixError`) con taxonomía espejo de `doctor*`.
- 21 tests unit puros con spy de argv que prueba a nivel unit que el verbo destructivo (`delete`/`remove`/`rename`) JAMÁS se emite (SDR-02).

## Task Commits

Cada tarea se commiteó atómicamente (TDD RED → GREEN):

1. **Task 1 RED: test scan() + taskLikeFrom** - `e3bce6b` (test)
2. **Task 1 GREEN: scan() puro + taskLikeFrom** - `43ffb67` (feat)
3. **Task 2 RED: test execute() orden D-09** - `7bbc69a` (test)
4. **Task 2 GREEN: execute() TOCTOU + fail-open + eventos fix** - `0fc8423` (feat)
5. **Fix taxonomía EVENTS 31→34** - `897e30d` (test, deviación Rule 1)

## Files Created/Modified
- `src/cmux/sidebar-doctor.js` - NUEVO. scan/execute/taskLikeFrom + resolveDeps (DI lazy) + helpers (sortByOldest decorate-sort estable, buildMemberIndex, parseRaw defensivo)
- `src/logger-events.js` - +EVENTS.SIDEBAR_DOCTOR_SCAN/FIX/FIX_ERROR + funciones sidebarDoctorScan/Fix/FixError
- `test/cmux/sidebar-doctor.test.js` - NUEVO. 21 tests unit puros (scan, execute con spy de argv, taskLikeFrom, source hygiene)
- `test/logger-events.test.js` - taxonomía canónica actualizada 31→34

## Decisions Made
- **scan() es ASYNC**, no sync como `gsd/doctor.js`. Los passthroughs cmux (`listWorkspaceGroups`/`listWorkspacesJson`) son `execFile` async; el pseudocódigo sync del RESEARCH (§Pattern 1) era ilustrativo. `execute` await-ea `scan`; los stubs sync de test se resuelven igual vía `await` (await sobre no-Promise devuelve el valor). El CLI del Plan 03 deberá `await scanFn(deps)`.
- **Split de eventos por task** (SCAN en Task 1, FIX/FIX_ERROR en Task 2) en vez de los tres en Task 2 como sugería el plan: `sidebar-doctor.js` importa los named exports al cargar el módulo, y ESM lanza si un named export no existe todavía — así cada commit de task deja el módulo importable y sus tests verdes de forma independiente.
- **`protected`** se materializa como `{ sessions: [{ref, group, name}] }` (sesiones kodo ya bien agrupadas), sin afectar `hasActions` (D-04).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Taxonomía canónica de EVENTS rota por los 3 eventos nuevos**
- **Found during:** Verificación de suite completa tras Task 2
- **Issue:** `test/logger-events.test.js` asertaba un set congelado de 31 tipos canónicos de `EVENTS`; añadir `sidebar.doctor.scan/fix/fix.error` (34 total) rompía el `deepEqual` y el `assert.equal(...length, 31)`.
- **Fix:** Actualización quirúrgica del set esperado a 34 tipos (insertados en orden alfabético) + título/mensaje del test.
- **Files modified:** test/logger-events.test.js
- **Verification:** `node --test test/logger-events.test.js` verde (34 pass); suite completa 2335 pass / 0 fail.
- **Committed in:** `897e30d`

---

**Total deviations:** 1 auto-fixed (1 bug de guard de taxonomía)
**Impact on plan:** El fix es necesario para la consistencia del guard mecánico de taxonomía NDJSON. Sin scope creep — solo refleja los eventos que el plan mandaba añadir.

## Issues Encountered
- Un test de source-hygiene propio (GRP-04) matcheaba inicialmente los identificadores `saveState`/`withStateLock` mencionados en la PROSA del docstring del módulo. Resuelto haciendo `stripComments` del fuente antes de la aserción (espejo del patrón `hygiene-api-key.test.js`), para asertar sobre el código y no los comentarios.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- El motor `scan`/`execute` está listo para que el Plan 03 (`src/cli/sidebar-doctor.js`, handler `runSidebarDoctor` espejo de `gsd-doctor.js`) lo renderice: dry-run humano / `--fix` / `--json` byte-determinista / exit `hasActions ? 1 : 0`.
- Recordatorio para el Plan 03: `scan` es async → el handler debe `await scanFn(deps)` y `await executeFn(deps,{fix:true})`.
- Backstop pendiente (SDR-05, manual-only): la convergencia REAL en la GUI cmux viva se confirma en el checkpoint del Plan 03.
- Sin blockers.

## Self-Check: PASSED

---
*Phase: 79-sidebar-doctor*
*Completed: 2026-07-23*
