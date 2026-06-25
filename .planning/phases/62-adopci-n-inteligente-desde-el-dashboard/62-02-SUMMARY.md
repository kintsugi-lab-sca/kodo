---
phase: 62-adopci-n-inteligente-desde-el-dashboard
plan: 02
subsystem: ui
tags: [dashboard, adopt, execFile, argv, injection-safe, cli, tdd]

# Dependency graph
requires:
  - phase: 56-adopcion-ad-hoc-desde-el-dashboard
    provides: "runAdopt (src/cli/dashboard/adopt.js) con par --title literal + never-throws {ok} discriminado"
  - phase: 54-cli-kodo-adopt
    provides: "kodo adopt --description ya registrado y enhebrado downstream (cli.js → cli/adopt.js → adoptSession → createTask)"
provides:
  - "runAdopt inserta el par --description <d> en el argv (espejo literal de --title)"
  - "carril shell de ORCH-02 SC#4: la descripción derivada viaja como cuerpo at-adopt, NO comentario post-hoc (D-10)"
  - "injection-inerte de la descripción vía execFile sin shell (D-13/T-62-07), cubierto por test"
affects: [62-03-wiring-index-app, adopcion-inteligente, orquestador-consumidor]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Par argv literal espejo: cada valor downstream precedido de su --flag explícita (T-62-07)"
    - "Inserción condicional con spread vacío: ...(typeof x === 'string' && x.length > 0 ? ['--flag', x] : [])"

key-files:
  created: []
  modified:
    - src/cli/dashboard/adopt.js
    - test/dashboard/adopt.test.js

key-decisions:
  - "D-10: la descripción viaja como --description at-adopt (NO comentario post-hoc); el título existe antes del createTask (--title precede a --description en el argv)"
  - "D-12: el {title, description} pasa por sanitizeAdoptionData (BIDIR-08) aguas abajo en adoptSession — runAdopt NO re-sanea (backstop estructural downstream)"
  - "D-13/T-62-07: --description como par literal vía execFile sin shell → metacaracteres inertes (injection-safe automático, cero shell-quoting)"

patterns-established:
  - "Par --description espejo EXACTO del par --title: misma guarda (string no vacío), misma posición relativa (antes de --json), mismo never-throws"

requirements-completed: [ORCH-02]

# Metrics
duration: 6min
completed: 2026-06-25
---

# Phase 62 Plan 02: runAdopt --description argv pair Summary

**`runAdopt` inserta el par `--description <d>` en el argv como espejo literal de `--title` — implementa el carril shell de ORCH-02 SC#4 (cuerpo at-adopt derivado por Haiku, injection-inerte vía execFile sin shell)**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-25T09:06:00Z
- **Completed:** 2026-06-25T09:12:34Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- `runAdopt` ahora inserta `--description <d>` como par argv literal, inmediatamente tras el bloque `--title` y antes de `'--json'` (el último elemento).
- Firma de `runAdopt` extendida con `description` + `@param` JSDoc espejo del de `title` (semántica D-10/D-12/D-13 documentada inline).
- 5 nuevos tests unitarios cubren los comportamientos 1:1 con VALIDATION.md: presente, orden con title (`--title` antes de `--description`, `--json` último), ausente, vacío, e injection-inerte con metacaracteres.
- Cadena downstream intacta: cero cambios en `cli.js` / `cli/adopt.js` / `adoptSession` (RESEARCH A1 — el flag ya estaba enhebrado a `createTask`).
- Suite global verde: 1514 pass + 1 skip (pre-existente), cero regresión.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: tests de --description (RED)** - `b9fcfbc` (test)
2. **Task 2: runAdopt inserta el par --description (GREEN)** - `ef23118` (feat)

_REFACTOR omitido: el cambio es un mirror literal mínimo del patrón `--title` existente; no había nada que limpiar._

## Files Created/Modified
- `src/cli/dashboard/adopt.js` - Añadido `description` al destructuring de `runAdopt` (línea 91) + `@param` JSDoc (líneas 89-95) + par argv literal `['--description', description]` (línea 141, entre el bloque `--title` y `'--json'`).
- `test/dashboard/adopt.test.js` - Nuevo `describe('Phase 62 (ORCH-02): runAdopt --description …')` con 5 tests clonados del molde de `--title` (presente/orden/ausente/vacío/injection-inerte).

## Decisions Made
None - followed plan as specified. Las decisiones D-10/D-12/D-13 vienen pre-definidas en el plan y se respetaron al pie de la letra (orden `--title` antes de `--description`, sin saneo nuevo en `runAdopt`, argv literal injection-safe).

## Deviations from Plan

None - plan executed exactly as written.

Nota sobre los números de línea del plan: el `<interfaces>` del plan citaba `cli.js:250` y `cli/adopt.js:174` para la cadena downstream; los valores reales son `cli.js:257` (verificado con grep en PATTERNS.md). Irrelevante para la ejecución — esos archivos downstream NO se tocaron (RESEARCH A1: ya enhebrados). El punto de inserción en `adopt.js` (tras `--title`, antes de `--json`) sí coincidió exactamente.

## Issues Encountered
None. El RED produjo exactamente 3 fallos esperados (los tests que assertan presencia de `--description`: presente, orden, injection); los tests de "ausente"/"vacío" pasan en RED porque la ausencia ES el comportamiento previo. El GREEN los puso los 5 en verde sin tocar nada más.

## Threat Surface Scan

Sin superficie de seguridad nueva fuera del `<threat_model>` del plan. El par `--description` es la mitigación de T-62-07 (Tampering — inyección shell) y queda cubierto por el test `injection-inerte`: la descripción con `$()`, backticks, `;`, `&&` y `|` viaja como UN solo elemento literal del argv (execFile sin shell). T-62-08 (Information Disclosure — leak de rutas/home) se mitiga aguas abajo en `adoptSession` vía `sanitizeAdoptionData` (BIDIR-08), sin saneo nuevo aquí (D-12). Cero dependencias npm nuevas (T-62-SC N/A).

## Known Stubs
None. El par `--description` queda funcional end-to-end aguas abajo (el flag ya estaba enhebrado a `createTask`). El wiring desde el dashboard (`index.js` `onAdopt` + el derive en `App.js`) que pasa la `description` derivada a `runAdopt` se completa en Plan 03 — eso es scope explícito del plan ("no rompe el wiring existente de index.js, que se actualiza en Plan 03"), NO un stub colgante de este plan.

## Next Phase Readiness
- `runAdopt` listo para recibir `description` desde el caller. Plan 03 cablea `index.js`/`App.js` para pasar la descripción derivada por Haiku (Plan 01) al par `--description`.
- ORCH-02 SC#4 (carril shell): cubierto. Falta el carril UI (derive-then-confirm) que llega en Plan 03.

## Self-Check: PASSED

- FOUND: src/cli/dashboard/adopt.js
- FOUND: test/dashboard/adopt.test.js
- FOUND: 62-02-SUMMARY.md
- FOUND commit: b9fcfbc (RED test)
- FOUND commit: ef23118 (GREEN feat)

---
*Phase: 62-adopci-n-inteligente-desde-el-dashboard*
*Completed: 2026-06-25*
