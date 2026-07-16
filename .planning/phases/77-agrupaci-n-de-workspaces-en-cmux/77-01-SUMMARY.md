---
phase: 77-agrupaci-n-de-workspaces-en-cmux
plan: 01
subsystem: infra
tags: [cmux, workspace-groups, execFile, thin-client, host-legacy]

# Dependency graph
requires:
  - phase: 38-host-contract
    provides: "objeto _legacy en getHost('cmux') + walker cmux-isolation + HOST_METHODS congelado en 4"
provides:
  - "buildNewWorkspaceArgs(opts): función pura exportada que construye el argv de new-workspace con --group opcional (GRP-01)"
  - "listWorkspaceGroups(): passthrough read-only de `workspace-group list --json` en src/cmux/client.js (stdout crudo, D-05)"
  - "host._legacy.listWorkspaceGroups: espejo lazy-import fiel del passthrough (D-06)"
  - "flag --group <ref> en el argv de new-workspace, emitido solo cuando opts.group es truthy"
affects: [77-02, session-manager-launch, group-resolution, fail-open]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extracción de builder de argv puro (buildNewWorkspaceArgs) para testear sin execFile inyectable"
    - "Passthrough thin-client una-función-por-comando read-only (solo verbo list de workspace-group, GRP-04)"

key-files:
  created:
    - test/cmux/client-args.test.js
  modified:
    - src/cmux/client.js
    - src/host/cmux.js

key-decisions:
  - "buildNewWorkspaceArgs extraído como función pura exportada (RESEARCH §Wave 0 Gaps): run() no es inyectable, así que el argv se testea directo sin cmux real"
  - "listWorkspaceGroups devuelve stdout crudo sin JSON.parse (D-05): el parseo defensivo vive en la Plan 02"
  - "El método nuevo vive SOLO en _legacy; HOST_METHODS permanece congelado en 4 (D-06)"
  - "De la familia workspace-group solo se añade `list` read-only; create/rename/delete/ungroup/add quedan fuera (GRP-04)"

patterns-established:
  - "Pure argv builder + delgada envoltura async run(): el builder es testeable, la envoltura hace I/O"
  - "Fail-open capa 1 gratis: un fallo de run() rejecta la promesa del passthrough (GRP-03), consumido en Plan 02"

requirements-completed: [GRP-01, GRP-03, GRP-04]

coverage:
  - id: D1
    description: "buildNewWorkspaceArgs emite --group <ref> exactamente cuando opts.group es truthy; sin group el argv es byte-idéntico al previo; orden estable --name → --cwd → --command → --group (GRP-01)"
    requirement: "GRP-01"
    verification:
      - kind: unit
        ref: "test/cmux/client-args.test.js#buildNewWorkspaceArgs"
        status: pass
    human_judgment: false
  - id: D2
    description: "listWorkspaceGroups() es un passthrough read-only de `workspace-group list --json` que devuelve stdout crudo sin JSON.parse (D-05, GRP-04) y cuya rejección da la capa 1 de fail-open (GRP-03)"
    requirement: "GRP-03"
    verification:
      - kind: unit
        ref: "test/host/cmux-isolation.test.js (walker verde: cmux confinado a src/host+src/cmux)"
        status: pass
    human_judgment: false
  - id: D3
    description: "host._legacy.listWorkspaceGroups es un espejo lazy-import fiel; HOST_METHODS sigue en 4 y el walker de aislamiento sigue verde (D-06)"
    requirement: "GRP-04"
    verification:
      - kind: unit
        ref: "test/host/cmux-isolation.test.js"
        status: pass
    human_judgment: false

# Metrics
duration: ~15min
completed: 2026-07-16
status: complete
---

# Phase 77 Plan 01: Fontanería cmux para agrupación de workspaces Summary

**Función pura `buildNewWorkspaceArgs` con `--group` opcional + passthrough read-only `listWorkspaceGroups` en `client.js` y su espejo en `host._legacy`, con `HOST_METHODS` congelado en 4 y el walker de aislamiento verde.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-16T08:01Z
- **Completed:** 2026-07-16T08:16Z
- **Tasks:** 2
- **Files modified:** 3 (2 modificados, 1 creado)

## Accomplishments
- `buildNewWorkspaceArgs(opts)` extraída como función pura exportada en `src/cmux/client.js`: construye el argv de `new-workspace` de forma determinista con `--group <ref>` opcional (orden `--name` → `--cwd` → `--command` → `--group`), testeada directamente sin `execFile`.
- `newWorkspace` ahora delega en `buildNewWorkspaceArgs`; el regex `/(workspace:\d+)/` de extracción de ref permanece intacto.
- `listWorkspaceGroups()`: passthrough read-only de `workspace-group list --json`, devuelve stdout crudo sin `JSON.parse` (D-05). Solo el verbo `list` de la familia workspace-group (GRP-04).
- `host._legacy.listWorkspaceGroups`: espejo lazy-import fiel; `HOST_METHODS` sigue congelado en 4 y `test/host/cmux-isolation.test.js` sigue verde.

## Task Commits

Cada task se commiteó atómicamente (Task 1 con ciclo TDD RED→GREEN):

1. **Task 1 (RED): test para buildNewWorkspaceArgs** - `6292205` (test)
2. **Task 1 (GREEN): buildNewWorkspaceArgs + listWorkspaceGroups en client.js** - `9c89c7b` (feat)
3. **Task 2: espejo _legacy.listWorkspaceGroups en host/cmux.js** - `aceda86` (feat)

_Task 1 no necesitó fase REFACTOR: el código quedó limpio en GREEN._

## Files Created/Modified
- `test/cmux/client-args.test.js` - **Creado.** 9 tests de la función pura `buildNewWorkspaceArgs` (orden de flags, presencia/ausencia de `--group`, array plano de strings apto para `execFile` sin shell).
- `src/cmux/client.js` - **Modificado.** Nueva export `buildNewWorkspaceArgs`; `newWorkspace` delega en ella; nueva export `listWorkspaceGroups` (passthrough read-only).
- `src/host/cmux.js` - **Modificado.** Nuevo método `listWorkspaceGroups` dentro del objeto `_legacy` (lazy-import passthrough); el `return` de contrato de 4 métodos + `_legacy` sin cambios.

## Decisions Made
- **buildNewWorkspaceArgs como función pura exportada** (RESEARCH §Wave 0 Gaps): `run()` con `execFile` no es inyectable, así que extraer el builder da un test directo del argv sin ejecutar cmux real.
- **listWorkspaceGroups devuelve stdout crudo** (D-05): el parseo defensivo del JSON se difiere a la función pura de la Plan 02 — `client.js` no parsea.
- **Seguridad T-77-01 (Tampering):** el ref de grupo viaja como elemento de array a `execFile`, jamás interpolado en un string de shell — superficie de inyección nula.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- La Plan 02 puede cablear ya: dispone de `host._legacy.listWorkspaceGroups` (capa de lectura) y del flag `--group` vía `buildNewWorkspaceArgs`.
- Invariantes verificadas: `HOST_METHODS` = 4, walker `cmux-isolation` verde, `src/host/interface.js` intacto, cero deps npm nuevas.
- Suite completa verde tras la wave: 2140 pass / 0 fail / 1 skipped (sin flake `gsd-lock-race`).

## Self-Check: PASSED

- Files verified on disk: `test/cmux/client-args.test.js`, `src/cmux/client.js`, `src/host/cmux.js`, `77-01-SUMMARY.md`.
- Commits verified in git: `6292205` (test), `9c89c7b` (feat), `aceda86` (feat).

---
*Phase: 77-agrupaci-n-de-workspaces-en-cmux*
*Completed: 2026-07-16*
