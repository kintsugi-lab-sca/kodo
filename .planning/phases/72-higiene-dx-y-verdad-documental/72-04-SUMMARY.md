---
phase: 72-higiene-dx-y-verdad-documental
plan: 04
subsystem: security
tags: [dashboard, ink, terminal-injection, osc-52, sanitization, format]

# Dependency graph
requires:
  - phase: 39-dashboard-paneles-aux
    provides: "overlay de comentarios (proyección comments.map en App.js) que consume contenido externo de Plane"
provides:
  - "stripControlChars(s) — helper puro exportado desde src/cli/format.js que elimina CSI + todos los bytes de control C0/C1/DEL (incl. ESC/BEL), preservando \\n/\\t"
  - "Cableado del saneo en el único punto de entrada del contenido externo: la proyección de comentarios de App.js (:1696-1699), tres ramas"
affects: [dashboard, seguridad, render-ink, HYG-08-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Strip amplio de secuencias de escape/control chars como saneo de contenido externo NO confiable antes del render Ink (defensa contra terminal injection / OSC-52)"

key-files:
  created: []
  modified:
    - src/cli/format.js
    - src/cli/dashboard/App.js
    - test/dashboard-format.test.js

key-decisions:
  - "El helper compone CSI-strip + control-strip (no solo control-strip): satisface el acceptance criterion `stripControlChars('\\x1b[31mrojo\\x1b[0m') === 'rojo'` que el control-strip puro no cumpliría (dejaría '[31mrojo[0m'). Estrictamente más fuerte, mismo objetivo de seguridad."
  - "Saneo cableado en App.js:1696-1699 (proyección comments.map), NO en SessionTable.js — es el único punto de entrada real; SessionTable renderiza líneas ya proyectadas."
  - "Cero deps npm nuevas (invariante v0.16); el helper es un regex puro built-in."

patterns-established:
  - "Sanea el contenido externo (proveedor) en su punto de entrada al render, no en el componente de presentación."

requirements-completed: [HYG-07]

coverage:
  - id: D1
    description: "stripControlChars elimina ESC/OSC/CSI/C0/C1/DEL preservando \\n/\\t, texto normal y acentos intactos; never-throws sobre input no-string"
    requirement: HYG-07
    verification:
      - kind: unit
        ref: "test/dashboard-format.test.js#HYG-07 (M4): stripControlChars neutraliza inyección de terminal"
        status: pass
    human_judgment: false
  - id: D2
    description: "La proyección de comentarios de App.js sanea las tres ramas (autor+body / String(body) / fallback JSON); una carga OSC-52 no inyecta en el terminal"
    requirement: HYG-07
    verification:
      - kind: unit
        ref: "test/dashboard-format.test.js#HYG-07 (Task 2): la proyección de comentarios sanea las tres ramas"
        status: pass
      - kind: integration
        ref: "grep -c stripControlChars src/cli/dashboard/App.js == 4 (import + 3 ramas)"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-07-13
status: complete
---

# Phase 72 Plan 04: Strip de \x1b en contenido externo del dashboard (HYG-07/M4) Summary

**`stripControlChars` neutraliza la inyección de terminal (OSC-52 al portapapeles y otras secuencias de escape) desde comentarios de Plane, saneando las tres ramas de la proyección de comentarios en su único punto de entrada al render Ink.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-07-13
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Helper puro exportado `stripControlChars(s)` en `src/cli/format.js`: elimina secuencias CSI completas + todos los bytes de control C0/C1 y `\x7f` (incluidos `\x1b`/ESC y `\x07`/BEL, cubriendo el vector OSC-52), preservando `\n`/`\t`. Never-throws (`String(s)`), sin color.
- Cableado del saneo en `App.js:1696-1699` — la proyección `comments.map` de contenido externo — envolviendo las TRES ramas (autor+body, `String(body)`, fallback `JSON.stringify`). Ninguna rama escapa al strip (cierra T-72-12 y T-72-13).
- `SessionTable.js` intacto (renderiza líneas ya saneadas — no es el punto de entrada).

## Task Commits

Cada tarea se comiteó atómicamente:

1. **Task 1 (RED): tests de stripControlChars** - `d8e26e5` (test)
2. **Task 1 (GREEN): helper stripControlChars en format.js** - `c5fc050` (feat)
3. **Task 2: cablear stripControlChars en la proyección de comentarios** - `4ea0cad` (feat)

_TDD: Task 1 siguió RED → GREEN (test falla por export ausente → implementación verde)._

## Files Created/Modified
- `src/cli/format.js` - Nueva función pura exportada `stripControlChars(s)` (CSI-strip + control-strip amplio).
- `src/cli/dashboard/App.js` - Import de `stripControlChars` desde `../format.js` + saneo aplicado a las tres ramas de la proyección de comentarios.
- `test/dashboard-format.test.js` - Tests del helper (OSC-52, CSI, C0/C1, `\n`/`\t`, acentos, coacción no-string) + tests de la proyección replicada (tres ramas con payload OSC-52).

## Decisions Made
- **Composición CSI-strip + control-strip.** El plan tenía una tensión interna: el `<action>` describía solo el control-char strip (`/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g`), que dejaría `[31mrojo[0m`; pero el `<acceptance_criteria>` y `<behavior>` Test 3 exigen `stripControlChars('\x1b[31mrojo\x1b[0m') === 'rojo'`. Se resolvió a favor de la definición de éxito (acceptance criteria) añadiendo un primer `.replace` que elimina las secuencias CSI completas. Es estrictamente más fuerte y cumple igual el objetivo de seguridad (sin ESC, cualquier secuencia queda inerte). Ver Deviaciones.
- **Punto de saneo:** App.js:1696-1699, no SessionTable.js (siguiendo PATTERNS/RESEARCH — el único punto de entrada del contenido externo).
- **Cero deps npm nuevas** (invariante v0.16) — regex puro built-in.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Contradicción interna del plan resuelta a favor del contrato testable] El helper añade CSI-strip además del control-strip**
- **Found during:** Task 1 (implementación de `stripControlChars`)
- **Issue:** El `<action>` de la Task 1 describía únicamente el control-char strip (regex de RESEARCH), que para `\x1b[31mrojo\x1b[0m` produce `[31mrojo[0m`. Pero el `<acceptance_criteria>` #2 y el `<behavior>` Test 3 exigen exactamente `'rojo'`. Ambas especificaciones son contradictorias.
- **Fix:** El helper compone dos pasos: (1) `.replace(/\x1b\[[\d;]*[A-Za-z]/g, '')` elimina las secuencias CSI completas; (2) `.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')` elimina el resto de bytes de control (ESC/BEL incluidos, cubriendo OSC). Satisface TODOS los acceptance criteria y es estrictamente más seguro (superset de lo que pedía el `<action>`).
- **Files modified:** src/cli/format.js
- **Verification:** `node --test test/dashboard-format.test.js` — 42 tests verdes, incluidos los 4 acceptance criteria explícitos.
- **Committed in:** c5fc050 (Task 1 GREEN)

---

**Total deviations:** 1 (resolución de contradicción interna del plan a favor del contrato de acceptance criteria).
**Impact on plan:** Sin scope creep. El helper resultante es un superset seguro de lo especificado; el objetivo de seguridad HYG-07/M4 se cumple íntegro y todos los acceptance criteria pasan.

## Issues Encountered
- **Flake en la suite completa:** una primera corrida de `npm test` reportó 1 fallo (2016 pass), no reproducible en corridas posteriores (2017 pass + 1 skip, 0 fail). El codebase tiene tests de proceso/timing propensos a flakes; mis cambios están aislados a `stripControlChars` + la proyección de App.js y no tienen superficie de timing. Confirmado con re-corrida limpia.

## User Setup Required
None - sin configuración de servicios externos.

## Next Phase Readiness
- HYG-07/M4 cerrado: el dashboard hace strip de `\x1b`/OSC en el contenido externo (criterio de éxito #3 de la fase).
- Nota para HYG-08 (pasada de README): el comportamiento de saneo es interno, no requiere doc de usuario nuevo salvo mención opcional en notas de seguridad.
- Queda el Plan 05 de la fase 72 (si aplica) según el roadmap.

---
*Phase: 72-higiene-dx-y-verdad-documental*
*Completed: 2026-07-13*
