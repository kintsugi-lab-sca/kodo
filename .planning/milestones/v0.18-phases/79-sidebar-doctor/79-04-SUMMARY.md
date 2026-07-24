---
phase: 79-sidebar-doctor
plan: 04
subsystem: infra
tags: [cmux, sidebar, doctor, workspace-group, gap-closure, advisory]

# Dependency graph
requires:
  - phase: 79-02
    provides: "motor scan()/execute() del sidebar doctor (missing_group/loose_workspace/empty_group)"
  - phase: 79-03
    provides: "CLI runSidebarDoctor (dry-run/--fix/--json) espejo de runGsdDoctor"
provides:
  - "missing_group degradado a report-only/advisory: execute() ya no emite create/set-anchor"
  - "scan() con hasActions (solo loose+empty) + hasAdvisories (missing_group)"
  - "CLI: render advisory de missing_group (sin etiqueta ejecutable) + veredicto advisory-only exit 0"
  - "Cierre del blocker G-79-1 (absorción de identidad del anchor) por construcción"
affects: [80-carril-orquestador, phase-80-piggyback, sidebar-doctor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Advisory vs acción: un report separa deriva auto-arreglable (hasActions) de acción del operador (hasAdvisories)"
    - "Report-only por seguridad: eliminar una rama de mutación entera para hacer imposible una regresión por construcción"

key-files:
  created: []
  modified:
    - src/cmux/sidebar-doctor.js
    - src/cli/sidebar-doctor.js
    - test/cmux/sidebar-doctor.test.js
    - test/cli/sidebar-doctor-cli.test.js
    - .planning/phases/79-sidebar-doctor/79-RESEARCH.md

key-decisions:
  - "missing_group pasa a report-only/advisory (Opción A, ratificada por checkpoint) — supera D-07/D-08 y la política de re-anclaje eventual"
  - "execute() NO emite create ni set-anchor: el doctor nunca ancla un grupo en una sesión kodo viva (root cause de G-79-1)"
  - "hasActions excluye missing_group → --fix converge a exit 0; hasAdvisories distingue la deriva que requiere acción del operador"

patterns-established:
  - "Report-only/advisory: el motor detecta e informa un estado pero NO lo muta cuando la mutación es insegura; el operador actúa una vez y el doctor mantiene"
  - "Eliminación de superficie: quitar la rama de mutación insegura (create/set-anchor) en vez de intentar hacerla segura — regresión imposible por construcción, verificada por test de regresión"

requirements-completed: [SDR-01, SDR-05]

coverage:
  - id: D1
    description: "execute({fix:true}) con missing_group NO invoca createWorkspaceGroup ni setGroupAnchor; result.created===0; ninguna sesión viva anclada (regresión G-79-1)"
    requirement: "SDR-01"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#G-79-1: missing_group (2 members) → execute NO emite create ni set-anchor"
        status: pass
    human_judgment: false
  - id: D2
    description: "scan() computa hasActions solo con loose+empty (missing_group excluido) y expone hasAdvisories = missing_group.length > 0"
    requirement: "SDR-01"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#D-08 (G-79-1): ... hasActions=false, hasAdvisories=true"
        status: pass
    human_judgment: false
  - id: D3
    description: "loose_workspace sigue convergiendo vía add y empty_group vía ungroup (SDR-05 intacto)"
    requirement: "SDR-05"
    verification:
      - kind: unit
        ref: "test/cmux/sidebar-doctor.test.js#loose_workspace → add(group,workspace); empty_group → ungroup(ref)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CLI pinta missing_group como advisory (sin create+add+set-anchor) y un report advisory-only sale exit 0 con veredicto advisory; --json expone hasAdvisories"
    requirement: "SDR-01"
    verification:
      - kind: unit
        ref: "test/cli/sidebar-doctor-cli.test.js#advisory-only (missing_group, no actions) → returns 0 and renders advisory verdict"
        status: pass
    human_judgment: false
  - id: D5
    description: "Convergencia real en vivo de `kodo sidebar doctor --fix` en el sidebar cmux del operador (loose→add preserva fila/título; advisory de missing_group)"
    verification: []
    human_judgment: true
    rationale: "El motor y el CLI están cubiertos por tests herméticos (DI, cero cmux real). La convergencia real contra el sidebar GUI y la preservación visual de la fila/título de la sesión solo se pueden confirmar en una sesión cmux viva — diferido a /gsd-verify-work 79."

# Metrics
duration: 5min
completed: 2026-07-23
status: complete
---

# Phase 79 Plan 04: Cierre del blocker G-79-1 (missing_group report-only) Summary

**`kodo sidebar doctor --fix` deja de auto-crear grupos anclados en sesiones kodo vivas: `missing_group` pasa a advisory (report-only), execute() ya no emite create/set-anchor, y scan() separa deriva auto-arreglable (hasActions) de acción del operador (hasAdvisories) — la absorción de identidad del anchor es imposible por construcción.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-23T11:12:17Z
- **Completed:** 2026-07-23T11:17:32Z
- **Tasks:** 3 (Task 1 checkpoint de ratificación; Tasks 2-3 implementación)
- **Files modified:** 5

## Accomplishments
- **G-79-1 cerrado por construcción:** `execute()` ya no contiene el bucle de `missing_group` → cero llamadas a `createWorkspaceGroup`/`setGroupAnchor`. Ninguna sesión kodo viva puede convertirse en el header de un grupo por decisión del doctor.
- **`scan()` re-definido:** `hasActions = loose_workspace.length + empty_group.length > 0` (missing_group EXCLUIDO) + nuevo `hasAdvisories = missing_group.length > 0`. Un estado con solo advisories sale exit 0 y un 2º pase `--fix` converge (piggyback de Phase 80 no entra en bucle).
- **CLI advisory:** `missing_group` se pinta bajo el encabezado "Grupos faltantes (advisory — el operador debe crearlos)" con texto de acción del OPERADOR, nunca con la etiqueta ejecutable `create + add + set-anchor`. Veredicto advisory-only distinto de `drift found` y de `clean`.
- **SDR-05 preservado:** `loose_workspace → add` y `empty_group → ungroup` intactos (esas ramas son seguras y son la vía de convergencia una vez el grupo existe).
- **Research reconciliado:** addendum "Post-UAT correction (G-79-1)" documenta el modelo header-is-anchor de cmux 0.64.20 que A1–A5 no capturaron y la supersesión explícita de D-07/D-08.

## Task Commits

Task 1 fue un `checkpoint:decision` (gate blocking) — el operador ratificó la Opción A ("report-only") vía resume-signal; sin artefacto de código propio (la ratificación queda registrada en el addendum de 79-RESEARCH.md y en este SUMMARY).

1. **Task 2: Motor — missing_group pasa a advisory; execute() deja de anclar** - `7dee845` (feat, TDD)
2. **Task 3: CLI advisory + veredicto + addendum de research** - `4ec4c52` (feat)

_Nota: Task 2 combina test+motor en un commit atómico (RED confirmado antes del GREEN: 2 fallos esperados → 22/22 verde tras el cambio de motor)._

## Files Created/Modified
- `src/cmux/sidebar-doctor.js` - scan() excluye missing_group de hasActions y expone hasAdvisories; execute() sin el bucle create/set-anchor; typedef SidebarReport gana hasAdvisories
- `src/cli/sidebar-doctor.js` - renderAdvisory() para missing_group (sin etiqueta ejecutable); veredicto advisory-only; comentario de mapeo actualizado
- `test/cmux/sidebar-doctor.test.js` - D-08 pasa a advisory (hasActions false/hasAdvisories true); test de regresión G-79-1 (execute no emite create/set-anchor)
- `test/cli/sidebar-doctor-cli.test.js` - header advisory; test advisory-only exit 0; hasAdvisories en --json; fixtures con hasAdvisories
- `.planning/phases/79-sidebar-doctor/79-RESEARCH.md` - addendum Post-UAT (header-is-anchor, supersede D-07/D-08)

## Decisions Made
- **Opción A (report-only) ratificada por checkpoint** en vez de Opción B (anchor desechable). La Opción B dependía de una semántica de cmux (`workspace-group create --cwd` sin `--from`) sin verificar en vivo — exactamente la clase de supuesto que originó G-79-1 — y habría introducido un workspace desechable no rastreable (GRP-04) en un milestone de higiene.
- **`createWorkspaceGroup`/`setGroupAnchor` se conservan** en los imports y en `resolveDeps` (allowlist no-destructivo documentado D-12) — los tests los usan como spies para asertar que NO se invocan; no quedan huérfanos porque `resolveDeps` los referencia.

## Deviations from Plan

None - plan executed exactly as written.

Nota menor (no es desviación de scope): en el test file, la constante `DESTRUCTIVE` quedó sin consumidor al reescribir el test D-09; se reincorporó su aserción de no-destructividad en el nuevo test de regresión G-79-1 para no dejar código muerto (no hay linter en el repo, pero es higiene de código quirúrgica).

## Issues Encountered
None. El gate de verificación del plan (6 ficheros) y la suite completa (2348 pass / 0 fail / 1 skip) quedaron verdes al cierre.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Phase 80 (carril orquestador + piggyback):** el contrato del report ahora distingue `hasActions` (auto-arreglable) de `hasAdvisories` (acción del operador) — el piggyback de `kodo sidebar doctor --fix` en `kodo check` puede converger a exit 0 sin bucle sobre advisories no auto-arreglables.
- **Diferido a /gsd-verify-work 79:** convergencia real en vivo de `--fix` contra el sidebar cmux del operador (loose→add preserva fila/título; advisory de missing_group). Cubierto herméticamente por tests; la validación visual GUI requiere sesión viva.

## Self-Check: PASSED

Verificados en disco los 6 ficheros modificados/creados y presentes en git los 3 commits (`7dee845`, `4ec4c52`, `6f4985d`).

---
*Phase: 79-sidebar-doctor*
*Completed: 2026-07-23*
