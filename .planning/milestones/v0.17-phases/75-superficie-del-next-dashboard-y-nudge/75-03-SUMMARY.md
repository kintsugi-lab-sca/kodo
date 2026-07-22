---
phase: 75-superficie-del-next-dashboard-y-nudge
plan: 03
subsystem: ui
tags: [ink, react, tui, markdown, dashboard, handoff, overlay]

# Dependency graph
requires:
  - phase: 75-01
    provides: "overlay p (readPlan), columna next, enrich-por-tick del dashboard"
  - phase: 74-01
    provides: "handoff.js — dueño único del contrato del marcador kodo:handoff (writer + parser)"
provides:
  - "stripHandoffMarker(line) — helper string-only en handoff.js que elimina el marcador HTML del heading (D-06)"
  - "renderMarkdownLines(lines) — mini-renderer markdown line-based (nuevo módulo markdown.js)"
  - "PlanResult.render ('markdown'|'plain') — discriminante que decide qué overlay pinta cada carril"
  - "gate del mini-renderer en renderOverlay: carril light → markdown, GSD → <Text> plano byte-idéntico"
affects: [dashboard, overlay, plan-ligero, LIVE-06, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mini-renderer markdown in-house line-based (cero deps): heading/label/bullet/fence → props ink, NO CommonMark"
    - "Discriminante render en el PlanResult para ramificar overlays sin acoplar el leaf a React"
    - "Delegación del strip del marcador en el dueño único del contrato (handoff.js), no regex ad-hoc en el dashboard"

key-files:
  created:
    - src/cli/dashboard/markdown.js
    - test/dashboard-markdown.test.js
  modified:
    - src/session/handoff.js
    - src/cli/dashboard/plan.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/App.js
    - test/session/handoff.test.js
    - test/dashboard-overlay.test.js
    - test/dashboard-plan.test.js

key-decisions:
  - "stripHandoffMarker vive en handoff.js (dueño único D-06/D-13), exporta el helper — no los constantes crudos — para encapsular el formato del marcador"
  - "El mini-renderer es in-house line-based best-effort (cero deps: nada de marked/ink-markdown), color SOLO por props ink"
  - "El gate render:'markdown' aplica SOLO al carril light 'ok'; la rama GSD queda byte-idéntica (D-02 LOCKED, SC3)"
  - "renderMarkdownLines recorre TODAS las líneas desde 0 (fence correcto por posición absoluta); SessionTable slicea los ELEMENTOS, no las líneas"

patterns-established:
  - "Saneo del contenido LLM (stripControlChars) por línea ANTES de proyectar al terminal (T-75-02)"
  - "Discriminante de render en el resultado del leaf para ramificar el overlay sin lógica divergente"

requirements-completed: [LIVE-06]

coverage:
  - id: D1
    description: "stripHandoffMarker elimina el marcador kodo:handoff de un heading (string-only, never-throws, hoja de cero imports)"
    requirement: "LIVE-06"
    verification:
      - kind: unit
        ref: "test/session/handoff.test.js#handoff: stripHandoffMarker"
        status: pass
      - kind: unit
        ref: "test/check-isolation.test.js#D-13: handoff contract isolation"
        status: pass
    human_judgment: false
  - id: D2
    description: "renderMarkdownLines mapea líneas a <Text> best-effort (heading bold+cyan con marcador strippeado, label bold, bullet plano, fence dim con toggle), saneando el contenido LLM"
    requirement: "LIVE-06"
    verification:
      - kind: unit
        ref: "test/dashboard-markdown.test.js#renderMarkdownLines — mini-renderer line-based"
        status: pass
      - kind: unit
        ref: "test/format-isolation.test.js#TUI-04 (D-13): cero picocolors bajo src/cli/dashboard/"
        status: pass
    human_judgment: false
  - id: D3
    description: "Discriminante render: readLightPlan 'ok' → 'markdown', ramas GSD 'ok' → 'plain'"
    requirement: "LIVE-06"
    verification:
      - kind: unit
        ref: "test/dashboard-plan.test.js#readPlan — resolución de fase / fallback plan ligero"
        status: pass
    human_judgment: false
  - id: D4
    description: "Overlay del plan ligero (phaseId==null) pinta el heading con el marcador INVISIBLE; la rama GSD queda byte-idéntica (marcador verbatim); Esc preserva el cursor por task_id"
    requirement: "LIVE-06"
    verification:
      - kind: integration
        ref: "test/dashboard-overlay.test.js#LIVE-06 SC2/SC3 (no-regresión GSD, marcador invisible, Esc cursor)"
        status: pass
    human_judgment: true
    rationale: "SC2 exige que un operador humano confirme por UAT que la fidelidad del render markdown best-effort (headings/labels/bullets/fences, NO CommonMark) es suficiente para leer el plan ligero — es el backstop flagged del plan (assumption A3)."

# Metrics
duration: 7min
completed: 2026-07-17
status: complete
---

# Phase 75 Plan 03: Superficie del plan ligero renderizado en el overlay Summary

**Overlay del plan ligero (filas no-GSD) renderizado line-based con el marcador kodo:handoff invisible vía un mini-renderer in-house, mientras la rama GSD queda byte-idéntica (D-02 LOCKED intacto)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-17T10:45:23Z
- **Completed:** 2026-07-17T10:52:48Z
- **Tasks:** 3
- **Files modified:** 7 (2 creados, 5 modificados)

## Accomplishments
- `stripHandoffMarker` en handoff.js: helper string-only (indexOf/slice, cero regex anti-ReDoS) que hace invisible el marcador HTML en el render; el módulo conserva CERO imports (guard check-isolation verde), saldando la deuda de Phase 74 D-01.
- Nuevo `markdown.js`: mini-renderer line-based best-effort (headings bold+cyan, labels bold, bullets planos, code fences dim con toggle acumulado) — cero deps, color SOLO por props ink, cada línea LLM saneada con stripControlChars (T-75-02).
- Discriminante `render` en el PlanResult + gate en `renderOverlay`: el carril light 'ok' (phaseId==null) pasa por el mini-renderer; la rama GSD queda EXACTAMENTE como antes (`<Text>` plano byte-idéntico, SC3), con un test de no-regresión explícito que asserta que el marcador aparece VERBATIM en GSD.

## Task Commits

Each task was committed atomically:

1. **Task 1: stripHandoffMarker en handoff.js (TDD)** - `fceacca` (test) → `71f84a9` (feat)
2. **Task 2: Mini-renderer markdown.js (TDD)** - `aa3cd5e` (test) → `123e134` (feat)
3. **Task 3: Discriminante render + gate del overlay** - `efd93f0` (feat)

_Nota: Tasks 1 y 2 son TDD (RED → GREEN); Task 3 es integración con tests extendidos en el mismo commit._

## Files Created/Modified
- `src/session/handoff.js` - Añadido `stripHandoffMarker` (string-only, dueño único del contrato del marcador D-06).
- `src/cli/dashboard/markdown.js` - NUEVO. Mini-renderer `renderMarkdownLines` line-based best-effort.
- `src/cli/dashboard/plan.js` - Campo `render` en PlanResult (readLightPlan ok → 'markdown', GSD ok → 'plain') + typedef.
- `src/cli/dashboard/SessionTable.js` - `renderOverlay` ramifica el body 'ok' por `snap.render`; import de renderMarkdownLines.
- `src/cli/dashboard/App.js` - Handler `p` threadea `render: res.render` al overlaySnapshot.
- `test/session/handoff.test.js` - 5 casos de stripHandoffMarker.
- `test/dashboard-markdown.test.js` - NUEVO. Cubre el mini-renderer (props de cada <Text>).
- `test/dashboard-overlay.test.js` - No-regresión GSD, plan ligero con marcador invisible, Esc preserva cursor.
- `test/dashboard-plan.test.js` - Asserts de `render` en las ramas light y GSD.

## Decisions Made
- **stripHandoffMarker exporta el helper, no los constantes MARKER_OPEN/CLOSE crudos**: encapsula el formato del marcador en su dueño único (D-06/D-13), evitando que el dashboard divergiese con una regex ad-hoc.
- **Mini-renderer in-house, cero deps**: descartado marked/ink-markdown para no añadir superficie supply-chain (T-75-SC accept) ni parser CommonMark completo; best-effort line-based es suficiente para LIVE-06.
- **El slice del scroll opera sobre los ELEMENTOS devueltos por renderMarkdownLines, no sobre las líneas**: así el toggle de code fence se resuelve por posición absoluta (recorrido desde 0) y el scroll no lo corrompe.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- El shim `gsd_run` de `<load_project_state>` no persistía entre invocaciones de bash (shell state no persiste) y la ruta del init apuntaba a `${repo}/gsd-core/bin/gsd-tools.cjs` inexistente. Resuelto localizando el binario real en `~/.claude/gsd-core/bin/gsd-tools.cjs` e invocándolo con ruta absoluta por comando. Sin impacto en la implementación.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- LIVE-06 implementado y con tests verdes (suite completa: 2253 pass / 0 fail / 1 skipped).
- Backstop flagged (assumption A3, must_haves D4): la fidelidad del render markdown best-effort debe confirmarse por UAT humano en `/gsd-verify-work`; si el operador exige tablas/links/nested rendering es fricción a confirmar (scroll/paginación del overlay difiere a v0.18, M21).
- `src/server.js`, `package.json` y `package-lock.json` sin cambios (cero endpoints, cero paquetes).

## Self-Check

- FOUND: src/cli/dashboard/markdown.js
- FOUND: test/dashboard-markdown.test.js
- FOUND commits: fceacca, 71f84a9, aa3cd5e, 123e134, efd93f0

## Self-Check: PASSED

---
*Phase: 75-superficie-del-next-dashboard-y-nudge*
*Completed: 2026-07-17*
