---
phase: 79-sidebar-doctor
plan: 01
subsystem: infra
tags: [cmux, workspace-group, execFile, source-hygiene, allowlist, sidebar-doctor]

# Dependency graph
requires:
  - phase: 77-workspace-groups
    provides: "listWorkspaceGroups() read-only, resolveWorkspaceGroup/deriveExpectedGroupName, launch path GRP-01..03 fail-open"
provides:
  - "Allowlist no-destructivo de workspace-group en client.js: createWorkspaceGroup, addToWorkspaceGroup, setGroupAnchor, ungroupWorkspaceGroup"
  - "listWorkspacesJson(): lector JSON crudo de `workspace list --json` para liveness de workspace_refs"
  - "Guard source-hygiene (SDR-02) que falla si se cablea el verbo destructivo de workspace-group en src/"
  - "Evidencia SDR-04: el launch path (manager.js) y buildNewWorkspaceArgs quedan byte-idénticos"
affects: [79-02 (scan/execute del doctor consume el allowlist), 79-03 (CLI sidebar doctor)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Passthrough cmux argv-plano vía run() (execFile, timeout 15s, sin shell) — ref/nombre como elementos de array, jamás interpolados (T-79-01)"
    - "Guard source-hygiene con walker recursivo comment-stripped + bloque detector-no-trivial (espejo hygiene-api-key.test.js)"

key-files:
  created:
    - "test/sidebar-doctor-hygiene.test.js"
  modified:
    - "src/cmux/client.js"

key-decisions:
  - "El verbo destructivo `delete` (cierra todos los workspaces del grupo) NI SE CABLEA; el guard extiende la prohibición a `remove`/`rename` de workspace-group (familia LOCKED)"
  - "Re-fronterización GRP-04: la gestión de workspace-group se permite SOLO en el carril doctor con allowlist create/add/set-anchor/ungroup; el launch path sigue consumiendo únicamente `list`"
  - "El adjacency regex se ancla a 'workspace-group' para no marcar el legítimo `['workspace','rename', ...]` (renombra un workspace, no un grupo)"

patterns-established:
  - "Allowlist cmux no-destructivo: cada mutación es un passthrough fino en client.js sin parseo (el parseo defensivo vive en la función pura del scan, Plan 02)"
  - "Guard mecánico como evidencia de invariante de fase (no revisión humana), probado por fixtures sintéticos con/sin cableado prohibido"

requirements-completed: [SDR-02, SDR-04]

coverage:
  - id: D1
    description: "4 passthroughs del allowlist no-destructivo (create/add/set-anchor/ungroup) + listWorkspacesJson en client.js, todos argv-plano vía run()"
    requirement: "SDR-02"
    verification:
      - kind: unit
        ref: "node -e import('./src/cmux/client.js') — los 5 exports resuelven como funciones (exit 0)"
        status: pass
      - kind: unit
        ref: "test/host/cmux-isolation.test.js — walker de aislamiento verde con client.js modificado"
        status: pass
    human_judgment: false
  - id: D2
    description: "Guard source-hygiene SDR-02: falla si se cablea workspace-group delete/remove/rename (argv adyacente o export de gestión), con bloque detector-no-trivial"
    requirement: "SDR-02"
    verification:
      - kind: unit
        ref: "test/sidebar-doctor-hygiene.test.js#SDR-02 guard source-hygiene + detector NO es trivial"
        status: pass
    human_judgment: false
  - id: D3
    description: "Evidencia SDR-04: launch path (newWorkspaceWithGroupFallback, buildNewWorkspaceArgs) byte-idéntico; golden GRP-01..03 intactos"
    requirement: "SDR-04"
    verification:
      - kind: unit
        ref: "test/sidebar-doctor-hygiene.test.js#SDR-04 launch path byte-idéntico"
        status: pass
      - kind: unit
        ref: "test/manager.test.js + test/session/group-resolve.test.js — golden GRP-01..03 sin modificación (98 pass)"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-07-23
status: complete
---

# Phase 79 Plan 01: Base cmux del sidebar doctor Summary

**Allowlist no-destructivo de workspace-group (create/add/set-anchor/ungroup) + lector JSON en client.js, blindados por un guard source-hygiene que falla ante cualquier cableado del verbo destructivo `delete` y con evidencia de que el launch path queda byte-idéntico.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-23T07:54:24Z
- **Completed:** 2026-07-23T08:01:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `src/cmux/client.js` gana 4 passthroughs del allowlist (`createWorkspaceGroup`, `addToWorkspaceGroup`, `setGroupAnchor`, `ungroupWorkspaceGroup`) + `listWorkspacesJson`, todos delegando en el `run()` existente con argv plano de strings — cero superficie de inyección (T-79-01).
- El docstring de `listWorkspaceGroups` queda re-fronterizado (GRP-04): la gestión de grupos se permite SOLO en el carril doctor con allowlist no-destructivo; `delete`/`remove`/`rename` siguen LOCKED fuera del código.
- Nuevo guard `test/sidebar-doctor-hygiene.test.js`: escanea `src/` (comment-stripped) y falla si aparece cableado el verbo destructivo (argv adyacente a `workspace-group` o export de gestión), con bloque detector-no-trivial que prueba que no pasa trivialmente.
- Evidencia SDR-04: el mismo guard afirma que `newWorkspaceWithGroupFallback`, sus dos capas fail-open y el orden de flags de `buildNewWorkspaceArgs` (--name → --cwd → --command → --group) quedan byte-idénticos; los golden GRP-01..03 pasan sin tocar.

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: Passthroughs del allowlist + lector JSON en client.js** - `719fbf9` (feat)
2. **Task 2: Guard source-hygiene SDR-02 + evidencia launch path SDR-04** - `0425c5c` (test)

## Files Created/Modified
- `src/cmux/client.js` - +4 passthroughs del allowlist no-destructivo, +listWorkspacesJson, docstring GRP-04 re-fronterizado
- `test/sidebar-doctor-hygiene.test.js` - guard SDR-02 (walker + detector-no-trivial) + aserciones de forma del launch path SDR-04

## Decisions Made
- El guard extiende la prohibición del verbo destructivo `delete` a toda la familia LOCKED `delete`/`remove`/`rename` de workspace-group, anclando la adyacencia al literal `workspace-group` para no marcar el legítimo `['workspace','rename', ...]` de la función `rename` existente.
- Ningún passthrough parsea JSON: el ref del grupo nuevo tras `create` se obtiene por re-list en el Plan 02 (OQ1), y `listWorkspacesJson` devuelve stdout crudo — el parseo defensivo vive en la función pura del scan.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- El allowlist cmux y el lector JSON están listos para que el Plan 02 (`src/cmux/sidebar-doctor.js`, scan/execute) los consuma.
- El guard protege TODA la fase: cualquier cableado futuro del verbo destructivo fallará en CI antes de mergear.
- Sin blockers.

## Self-Check: PASSED

---
*Phase: 79-sidebar-doctor*
*Completed: 2026-07-23*
