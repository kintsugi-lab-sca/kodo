---
phase: 81-saneo-de-deuda-v0-17
plan: 02
subsystem: ui
tags: [tui, ink, dashboard, whitespace-collapse, jsdoc, doc-drift]

# Dependency graph
requires:
  - phase: 75-superficie-del-next-dashboard-y-nudge
    provides: "columna `next` (LIVE-05), typedef `overlaySnapshot`, comentario del render de `tasks`"
  - phase: 78
    provides: "capa `stripControlChars` (defensa terminal-injection) en el enrich de App.js"
provides:
  - "`nextCell` colapsa whitespace (`/\\s+/g`→' ' + trim) en el render — un `next` malformado no descuadra la tabla de ancho fijo"
  - "Comentario de App.js :735 corregido a la realidad del render (75/WR-02)"
  - "Typedef `overlaySnapshot` en SessionTable.js con `render?: 'markdown'|'plain'` (75/WR-04)"
affects: [dashboard, tui, format.js, deuda-tecnica]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "collapse-at-projection: el saneo de LAYOUT vive en el punto de proyección al render (`nextCell`), no en el write ni en el enrich — el dato persistido queda verbatim (D-06)"

key-files:
  created: []
  modified:
    - src/cli/dashboard/format.js
    - test/dashboard-format.test.js
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js

key-decisions:
  - "El colapso de whitespace es render-only (capa de LAYOUT), complementario a `stripControlChars` de Phase 78 — NO lo sustituye ni migra a persistencia (D-06)"
  - "Estado vacío de `nextCell` = `''` byte-idéntico al no-seteado, SIN placeholder glyph (SC5, asimetría intencional frente a `progCell`)"
  - "DEBT-02 es doc-only: la suite verde SIN modificar tests es la prueba de cero-cambio (D-12)"

patterns-established:
  - "collapse-at-projection: normalizar layout en la función de celda pura, dejando el dato de origen intacto"

requirements-completed: [DEBT-02, DEBT-03]

coverage:
  - id: D1
    description: "`nextCell` colapsa `\\n`/`\\t`/`\\r`/multi-espacio a un espacio único + trim en el render; solo-whitespace → '' sin placeholder; no-string → '' never-throws"
    requirement: "DEBT-03"
    verification:
      - kind: unit
        ref: "test/dashboard-format.test.js#DEBT-03: colapsa \\n/\\t/\\r/multi-espacio a un espacio único + trim"
        status: pass
      - kind: unit
        ref: "test/dashboard-format.test.js#DEBT-03: next solo-whitespace → '' (celda vacía, SIN placeholder, SC5)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Dato persistido en state.json queda verbatim; el enrich de App.js sigue con `stripControlChars` únicamente (colapso NO migra a persistencia, D-06)"
    requirement: "DEBT-03"
    verification:
      - kind: other
        ref: "git diff HEAD~2 src/cli/dashboard/App.js (enrich intacto durante Task 1); grep -c 'stripControlChars' src/cli/dashboard/App.js == 9"
        status: pass
    human_judgment: false
  - id: D3
    description: "Comentario App.js :735 corregido a la realidad del render (readTasksFn en CADA render, no una vez por tick — 75/WR-02); doc-only cero runtime"
    requirement: "DEBT-02"
    verification:
      - kind: other
        ref: "suite completa verde SIN modificación de tests: node --test $(find test -name '*.test.js') → 2364 pass, 0 fail (D-12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Typedef `overlaySnapshot` en SessionTable.js :817 gana `render?: 'markdown'|'plain'` espejando plan.js:48 PlanResult (75/WR-04); JSDoc puro"
    requirement: "DEBT-02"
    verification:
      - kind: other
        ref: "grep -c \"render?: 'markdown'|'plain'\" src/cli/dashboard/SessionTable.js >= 1"
        status: pass
    human_judgment: false

# Metrics
duration: 2min
completed: 2026-07-24
status: complete
---

# Phase 81 Plan 02: Colapso de whitespace en `nextCell` + doc-drift de Phase 75 Summary

**`nextCell` colapsa `\n`/`\t`/`\r`/multi-espacio a un espacio único + trim en el render (DEBT-03), y se corrigen el comentario del render de App.js y el typedef `overlaySnapshot` de SessionTable (DEBT-02) — sin tocar comportamiento, suite verde.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-24T07:44:16Z
- **Completed:** 2026-07-24T07:47:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- **DEBT-03 cerrado:** `nextCell` (`src/cli/dashboard/format.js`) colapsa toda secuencia de whitespace con `replace(/\s+/g, ' ').trim()` en el punto de proyección al render — un `next` hand-editado en state.json (con `\n`/`\t`/`\r`/espacios múltiples) ya no puede romper la fila de ancho fijo ni descuadrar la tabla TUI. Never-throws (no-string → `''`), estado vacío `''` sin placeholder (SC5), celda pura sin color propio (D-12).
- **Dato persistido intacto:** el colapso es render-only; el enrich de App.js sigue aplicando SOLO `stripControlChars` (capa de Phase 78, inalterada) — defensa en profundidad, no sustitución (D-06).
- **DEBT-02a cerrado:** el comentario de `App.js` (:735) deja de afirmar que el bloque `tasks` se lee «una vez por tick» y describe la realidad que 75/WR-02 señaló: `readTasksFn({})` se ejecuta en CADA render (cada tecla en filtro, cada scroll, cada cambio de `mode`), haciendo piggyback sobre el tick de `usePoll` pero no limitada a él.
- **DEBT-02b cerrado:** el typedef del prop `overlaySnapshot` en `SessionTable.js` (:817) gana `render?: 'markdown'|'plain'`, espejando literalmente `plan.js:48` `PlanResult` (75/WR-04).

## Task Commits

Cada task se commiteó atómicamente (Task 1 en flujo TDD RED→GREEN):

1. **Task 1 (RED): tests de whitespace-collapse fallando** - `9fa81e5` (test)
2. **Task 1 (GREEN): colapso en `nextCell`** - `f564d67` (feat)
3. **Task 2: correcciones doc-only de Phase 75** - `58ca38f` (docs)

**Plan metadata:** (pendiente en commit final de este plan)

_Task 1 no requirió fase REFACTOR: la implementación resultante ya es mínima y limpia._

## Files Created/Modified
- `src/cli/dashboard/format.js` - `nextCell` reescrita con colapso `/\s+/g`→' ' + trim, no-string→'', vacío→'' sin placeholder; JSDoc actualizado notando el colapso de layout
- `test/dashboard-format.test.js` - 3 nuevos `it` de whitespace-collapse añadidos al describe `nextCell` existente (colapso, solo-whitespace→'', passthrough)
- `src/cli/dashboard/App.js` - comentario :735 corregido a la realidad del render (doc-only)
- `src/cli/dashboard/SessionTable.js` - typedef `overlaySnapshot` :817 con `render?: 'markdown'|'plain'` (doc-only)

## Decisions Made
None - followed plan as specified. Las tres decisiones clave (colapso render-only vs. persistencia, vacío sin placeholder, DEBT-02 doc-only con suite verde como prueba) fueron dictadas por el plan y respetadas verbatim.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. El RED confirmó 2 tests fallando antes de la implementación; el GREEN los puso verdes sin regresiones; la suite completa (2364 pass, 0 fail, 1 skip pre-existente no relacionado) confirmó cero-cambio para DEBT-02.

## Threat Surface
Sin superficie nueva. El único trust boundary (state.json `next` editable → render TUI) queda mitigado por el colapso `/\s+/g` (T-81-02-01, DoS-of-display); `stripControlChars` (T-81-02-02) intacto; dato persistido verbatim (T-81-02-03). Sin instalaciones de paquetes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEBT-02 y DEBT-03 cerrados. Queda `81-03-PLAN.md` pendiente en la fase.
- Sin blockers ni stubs.

## Self-Check: PASSED
Todos los ficheros modificados existen y los 3 commits de task (9fa81e5, f564d67, 58ca38f) están en el historial.
