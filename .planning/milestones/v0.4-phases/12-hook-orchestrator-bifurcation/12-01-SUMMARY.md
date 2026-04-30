---
phase: 12-hook-orchestrator-bifurcation
plan: 01
subsystem: hooks
tags:
  - hooks
  - session-start
  - quick-mode
  - context-injection
dependency-graph:
  requires:
    - "src/labels.js getSessionMode (Phase 11 D-09)"
    - "Phase 11 commits 7cd4b2d, e935a3d, 2f65f71 (gsd_mode persistence)"
  provides:
    - "buildGsdContext with three exhaustive branches (quick, full+phase, full+bootstrap)"
    - "First consumer of getSessionMode from src/labels.js"
  affects:
    - "Quick sessions launched by kodo:gsd-quick now receive /gsd-quick \"<title>\" instead of plan/execute/verify or new-project"
tech-stack:
  added: []
  patterns:
    - "Helper en labels.js + consumer downstream (D-12 Phase 8 / D-09 Phase 11)"
    - "Brief FIRST, comando AFTER en bootstrap (D-11 Phase 9) — replicado en quick"
    - "Idioma EN para hooks que escribe el agente (D-04 Phase 8)"
key-files:
  created: []
  modified:
    - "src/hooks/session-start.js"
decisions:
  - "D-01..D-06 Phase 12 implementadas verbatim según CONTEXT.md"
  - "Reemplazo de comillas con replace simple `\" → '` (D-04) en lugar de JSON.stringify o backslash escapes — el parser de slash commands de Claude Code interpreta escapes inconsistentemente"
  - "Quick gana sobre phase_id (D-06) — defensa en profundidad ante phase_id residual"
  - "Idioma EN preservado en todo el hook (D-04 Phase 8)"
metrics:
  duration: "~6 min"
  completed: "2026-04-28"
  tasks_executed: 2
  files_modified: 1
requirements:
  - QUICK-05
---

# Phase 12 Plan 01: Hook Quick Branch — Summary

One-liner: `buildGsdContext` ahora ramifica en `getSessionMode(session)` y emite `/gsd-quick "<safe-title>"` para sesiones quick, preservando intactos los branches full+phase y full+bootstrap.

## What Shipped

- **Import añadido** (`src/hooks/session-start.js:11`): `import { getSessionMode } from '../labels.js';`
- **Branch quick añadido** (`src/hooks/session-start.js:96-121`): primer arm del switch `if/else if/else`, ejecutado cuando `getSessionMode(session) === 'quick'`.
- **Comando inyectado verbatim**: `` 1. `/gsd-quick "${safeTitle}"` `` donde `safeTitle = session.summary.replace(/"/g, "'")`.
- **Frase de cierre EN** (línea 120): `Run the slash command and finish — no plan/execute/verify cycle.`
- **Branches preservados verbatim**: `else if (session.phase_id)` (full+phase, líneas 122-134) y `else` (full+bootstrap, líneas 135-152) sin cambios de texto.

## Tasks Executed

| Task | Name                                         | Commit  | Files                          |
| ---- | -------------------------------------------- | ------- | ------------------------------ |
| 1    | Importar getSessionMode en session-start.js  | 3cccb6e | src/hooks/session-start.js     |
| 2    | Añadir branch quick a buildGsdContext        | 5d42b76 | src/hooks/session-start.js     |

## Verification

- `node --check src/hooks/session-start.js` → exit 0.
- 6 assertions inline (Task 2 `<verify>`):
  1. quick sin brief → `/gsd-quick "Fix login"` presente, sin `/gsd-plan-phase`/`/gsd-execute-phase`/`/gsd-verify-work`/`/gsd-new-project`, frase `one-shot` presente.
  2. quick+bootstrap → brief precede al comando.
  3. Title con comillas dobles → `/gsd-quick "TASK-Z 'with quotes'"` (escape de comillas funciona).
  4. full+phase preservado → `/gsd-plan-phase 7` + `/gsd-execute-phase 7`, sin `/gsd-quick`.
  5. full+bootstrap preservado → `/gsd-new-project`, sin `/gsd-quick`.
  6. Legacy `gsd:true` sin `gsd_mode` → lee como full (regla D-08 Phase 11 vía helper).
- Suite completa: `node --test test/*.test.js` → **369 pass, 1 skipped (pre-existente), 0 fail**. Sin regresión.
- Acceptance criteria grep:
  - `if (mode === 'quick')` → 1
  - `const mode = getSessionMode(session);` → 1
  - `} else if (session.phase_id)` → 1
  - `/gsd-quick` → presente
  - `session.summary.replace` → presente
  - `no plan/execute/verify cycle` → presente
  - `/gsd-plan-phase` → 1 (preservado)
  - `/gsd-execute-phase` → 1 (preservado)
  - `/gsd-verify-work` → 1 (preservado)
  - `/gsd-new-project` → 1 (preservado)
  - Total imports → 4 (3 originales + 1 nuevo)

## Comando inyectado (confirmación verbatim)

Para una sesión `{ task_ref: 'TASK-X', summary: 'Fix login', gsd: true, gsd_mode: 'quick' }`, el bloque emitido es:

```
This is a one-shot GSD session.

Execute the slash command:

1. `/gsd-quick "Fix login"`

Run the slash command and finish — no plan/execute/verify cycle.
```

Si el `summary` contiene comillas dobles (`'TASK-Z "with quotes"'`), se renderizan como simples antes de envolver: `1. \`/gsd-quick "TASK-Z 'with quotes'"\``.

## Deviations from Plan

None — plan ejecutado exactamente como estaba escrito. Las líneas del SUMMARY descritas en `<output>` del plan corresponden 1:1 con las líneas reales del archivo modificado.

## Hand-off Note for Phase 13

`test/session-start.test.js` puede importar `buildGsdContext` directamente y assert los 6 estados (quick+match, quick+bootstrap, full+phase, full+bootstrap, legacy `gsd:true` sin `gsd_mode`, no-GSD). Las 6 aserciones inline ejecutadas en la verificación de este plan ya documentan los inputs/outputs esperados — copiarlos a un test runner es directo.

Patrones de test sugeridos:
- `summary` con comillas dobles → exit con `'` rendered.
- `opts.brief` truthy + `gsd_mode: 'quick'` → brief precede a `/gsd-quick`.
- `gsd: true` + `phase_id: '5'` + sin `gsd_mode` → renderiza branch full+phase, NO quick (regla legacy D-08 Phase 11).

## Self-Check: PASSED

- File `src/hooks/session-start.js` exists and contains:
  - line 11: `import { getSessionMode } from '../labels.js';`
  - line 96: `const mode = getSessionMode(session);`
  - line 97: `if (mode === 'quick') {`
  - line 122: `} else if (session.phase_id) {`
- Commits in branch:
  - `3cccb6e feat(12-01): import getSessionMode in session-start hook`
  - `5d42b76 feat(12-01): bifurcate buildGsdContext for quick mode`
- All acceptance criteria verified passing.
- Full test suite: 369 pass / 1 skipped / 0 fail.
