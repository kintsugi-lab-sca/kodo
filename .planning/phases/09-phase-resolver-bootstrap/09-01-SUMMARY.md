---
phase: 09-phase-resolver-bootstrap
plan: 01
subsystem: gsd
tags: [parser, roadmap, markdown, regex, pure-module]

# Dependency graph
requires:
  - phase: 02-plane-adapter
    provides: parseKodoLabels analog (pure transform, zero imports) used as shape reference
provides:
  - parseRoadmap(md) — pure markdown parser extracting {n,title,heading,line} from ## / ### Phase headings
  - normalizeTitle(s) — minimal normalization (trim + collapse whitespace + lowercase) for strict 1:1 matching
  - Regex `^(#{2,3})\s+Phase\s+(\d+(?:\.\d+)?)(?::\s*|\s+-\s+)(.+)$` that rejects ranges by requiring padded dash
affects: [09-03-resolver, 09-04-dispatcher-wiring, 09-05-cli-inspect]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure module: zero imports, 100% deterministic, testable without fixtures"
    - "@ts-check header convention for src/* modules"
    - "node:test + assert/strict + describe/it flat (analog de test/labels.test.js)"

key-files:
  created:
    - src/gsd/roadmap.js
    - test/gsd-roadmap.test.js
  modified: []

key-decisions:
  - "D-05 regex se implementa como `#{2,3}` (dos-a-tres hashes) — el `##{2,3}` del CONTEXT matchearía 3-4 hashes"
  - "D-08 dash separator requiere whitespace a ambos lados (`\\s+-\\s+`) para rechazar rangos como `Phase 1-5`"
  - "D-07 normalización mantiene puntuación y backticks — strict 1:1 por diseño"
  - "No se persiste nada del parser en estado; consumidores (resolver) leen disco y pasan string"

patterns-established:
  - "Parser puro: una función exportada que toma string y devuelve object literal, sin throws para entrada inválida"
  - "Rejected-vs-accepted heading levels documentados en JSDoc y cubiertos por tests explícitos"

requirements-completed: [GSD-03]

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 09 Plan 01: ROADMAP.md Parser Foundation Summary

**Módulo puro `src/gsd/roadmap.js` con `parseRoadmap` + `normalizeTitle` — regex corregido que acepta `##`/`###` + decimales y rechaza rangos, validado por 13 unit tests.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-21T09:28:46Z
- **Completed:** 2026-04-21T09:31:24Z
- **Tasks:** 2
- **Files modified:** 2 (ambos nuevos)

## Accomplishments

- Parser 100% puro (zero `node:fs` / `node:path` imports) listo para reuso sin mocks en resolver (09-03) y CLI inspect (09-05)
- Regex del CONTEXT D-05 (`##{2,3}`) corregido a `#{2,3}` en implementación + separador dash reforzado con `\s+-\s+` para rechazar rangos (`Phase 1-5`) sin falsos positivos
- `normalizeTitle` aplica exactamente los 3 pasos mandados por D-07 (trim → collapse whitespace → lowercase), preservando puntuación y backticks para que el match sea 1:1 estricto
- 13 unit tests cubren: empty/non-string input, `##`/`###` accepted, `#`/`####` rejected, decimales `72.1`, rangos `1-5` ignorados, dash-con-espacios aceptado, line numbers 1-indexed, normalización con puntuación preservada y coerción `String()`

## Task Commits

1. **Task 1: Crear `src/gsd/roadmap.js`** — `54874c8` (feat)
2. **Task 2: Crear `test/gsd-roadmap.test.js`** — `04028a7` (test)

**Plan metadata:** pending — final commit below.

## Files Created/Modified

- `src/gsd/roadmap.js` (NEW, 57 líneas) — `parseRoadmap`, `normalizeTitle`, regex anclado de 2-3 hashes con separador `(?::\s*|\s+-\s+)`
- `test/gsd-roadmap.test.js` (NEW, 88 líneas) — 13 tests con `node:test` + `assert/strict`

## Decisions Made

- **Regex corregido vs. CONTEXT literal:** CONTEXT D-05 escribía `##{2,3}` (matchea 3-4 hashes) y el plan lo corrigió a `#{2,3}` en su `<action>`. Durante ejecución descubrí además que `[:\-]` como separador dejaba pasar `## Phase 1-5: Overview` como fase `1` con título `5: Range`. Cambié el separador a `(?::\s*|\s+-\s+)` — colon puede ir pegado, dash requiere espacios a ambos lados. Resultado: todos los tests del `<behavior>` pasan.
- **No añadir tests de ReDoS en este plan:** el threat register (T-09-01-01) marcó la mitigación como "regex anclado + sin alternancia anidada"; añadir un test de 10k líneas quedará para un plan futuro si surge evidencia de lentitud.
- **Sin cambios a `package.json` ni `.gitignore`:** el módulo no introduce deps ni artefactos generados.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Regex del `<action>` literal matcheaba rangos como fase válida**

- **Found during:** Task 1 (verificación inline `node -e "..."` del bloque `<verify>`)
- **Issue:** El regex escrito en el `<action>` del plan (`\s*[:\-]\s*`) permitía que `## Phase 1-5: Overview` matcheara como fase `1` con título `5: Range` (greedy `\d+` captura `1`, `\s*` permite vacío, `[:\-]` matchea el `-`). Esto contradice directamente el `must_haves.truths` del plan ("parseRoadmap ignora rangos tipo `## Phase 1-5: Overview` (no matchean)"), el behavior Test 7, el success criteria #3, y la descripción D-08 del CONTEXT. El `<verify>` inline del propio plan falla con este regex (`expected 1 phase, got 2`).
- **Fix:** Cambié el separador a `(?::\s*|\s+-\s+)` — dos alternativas:
  - `:\s*` → colon con whitespace opcional (cubre `Phase 1: Foo` y `Phase 1:Foo`)
  - `\s+-\s+` → dash obligado a estar rodeado de whitespace (cubre `Phase 1 - Foo`, rechaza `Phase 1-5`)
- **Files modified:** `src/gsd/roadmap.js` (regex + comentario explicativo)
- **Verification:** `node -e` inline del plan pasa (1 fase, n=9); los 13 tests node:test pasan; la suite completa (232 tests) sigue verde sin regresiones.
- **Committed in:** `54874c8` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug en la especificación literal del `<action>`)
**Impact on plan:** Mínimo. El fix mantiene intacta la intención del plan (behavior + truths + verify) y corrige una contradicción entre la descripción literal del `<action>` y el resto de la especificación. No afectó el alcance ni añadió trabajo adicional.

## Issues Encountered

Ninguno más allá del bug del regex documentado arriba. La estructura del plan (analog `labels.js`, snippets literales, `<verify>` ejecutable) hizo la ejecución lineal y sin ambigüedad.

## User Setup Required

None — módulo puro, sin dependencias, sin configuración externa.

## Next Phase Readiness

**Ready for:**
- **Plan 09-02:** puede reusar `normalizeTitle` si el helper `buildBriefFromTask` comparte normalización (probable que no, pero el export está disponible).
- **Plan 09-03 (resolver):** importa `parseRoadmap` + `normalizeTitle` directamente. Contract estable: `parseRoadmap(md) → { phases: [{n,title,heading,line}] }`.
- **Plan 09-05 (CLI inspect):** indirectamente via resolver.

**No blockers.** El separador dash padeado (`\s+-\s+`) es más estricto que el literal del `<action>` pero coincide con lo que los tests y el `must_haves.truths` exigen — futuros consumidores no deberían encontrar sorpresas.

## Self-Check: PASSED

- **Files exist:**
  - `src/gsd/roadmap.js` — FOUND
  - `test/gsd-roadmap.test.js` — FOUND
  - `.planning/phases/09-phase-resolver-bootstrap/09-01-SUMMARY.md` — FOUND (this file)
- **Commits exist:**
  - `54874c8` — FOUND (feat: roadmap parser)
  - `04028a7` — FOUND (test: gsd-roadmap tests)
- **Verification block from plan:**
  - `node --test test/gsd-roadmap.test.js` → 13 pass, 0 fail
  - `node --check src/gsd/roadmap.js` → exit 0
  - `grep -E "import.*(node:fs|node:path|'fs'|'path')" src/gsd/roadmap.js` → 0 matches
  - `grep -n "#{2,3}" src/gsd/roadmap.js` → 4 matches (regex + JSDoc)
- **Full test suite regression:** 232 tests, 231 pass, 1 skip (pre-existing), 0 fail

---
*Phase: 09-phase-resolver-bootstrap*
*Completed: 2026-04-21*
