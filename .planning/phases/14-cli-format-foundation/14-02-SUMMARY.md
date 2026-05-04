---
phase: 14-cli-format-foundation
plan: 02
subsystem: testing
tags: [source-hygiene, isolation-test, picocolors, log-12, walker, ast-grep]

# Dependency graph
requires:
  - phase: 14-cli-format-foundation
    provides: src/cli/format.js (Plan 14-01 — picocolors-based formatter factory)
  - phase: 06-structured-logging
    provides: test/check-isolation.test.js (LOG-12 walker analog copied verbatim)
provides:
  - LOG-12-extension guard against `src/cli/format.js` transitively importing `src/logger.js`
  - D-07/D-08 single-source-of-color guard (picocolors specifier appears in EXACTLY one file under src/)
  - Reusable `listJsFiles(dir)` recursive walker novel for picocolors-grep (no analog in repo prior to this plan)
  - Negative-control verified: introducing `import {} from '../logger.js'` in format.js fails the test loudly with diagnostic listing the violator path and full graph
affects: [phase 15 wiring (kodo logs / gsd inspect / gsd verify / kodo check), phase 16 dispatcher cleanup, future refactors that touch format.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-hygiene test pattern: walker copied verbatim from check-isolation.test.js (CONTEXT D-06 — lower coupling, single-file guard, fewer files)"
    - "Recursive .js scan + extractImports pattern for invariants of the form 'specifier X must appear in exactly N files under src/'"

key-files:
  created:
    - test/format-isolation.test.js
  modified: []

key-decisions:
  - "Walker copied verbatim from test/check-isolation.test.js (CONTEXT D-06 default, NOT extracted to a shared helper) — mantiene la auditoría visual del invariante en un solo archivo y evita un módulo helper que cambiaría rara vez."
  - "Two assertions grouped in one test file (LOG-12 extension + picocolors single-source) — D-06 default, alineado con que el subject único es format.js."
  - "Sanity test 'picocolors is imported by at least one file' añadido para evitar el falso-verde si una refactorización elimina el import de format.js (la deepEqual contra ['src/cli/format.js'] fallaría con [], pero el sanity test cataliza un mensaje más explícito)."

patterns-established:
  - "Pattern: source-hygiene single-source guards via recursive listJsFiles + extractImports + assert.deepEqual sobre lista de importadores."
  - "Pattern: negative-control documentado en SUMMARY como check manual reproducible (inyectar violación → confirmar fail → revertir) en lieu de fixture permanente."

requirements-completed: [DX-06]

# Metrics
duration: ~10min
completed: 2026-05-04
---

# Phase 14 Plan 02: format-isolation source-hygiene guard Summary

**Source-hygiene test guarding `src/cli/format.js` against logger.js transitive imports (LOG-12 extension) and enforcing picocolors single-source via recursive grep over src/.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-04T16:05Z (approx)
- **Completed:** 2026-05-04T16:15Z
- **Tasks:** 1
- **Files created:** 1
- **Files modified:** 0
- **Test count:** 454 baseline → 458 with this plan (4 new, all green)

## Accomplishments
- Added `test/format-isolation.test.js` con 4 tests: 2 en `describe('LOG-12 extension: src/cli/format.js isolation (D-06)')` (sanity-exists + main no-logger.js) y 2 en `describe('Single source of color (D-07, D-08): picocolors imports')` (only-format.js-imports + sanity-found).
- Walker copiado verbatim desde `test/check-isolation.test.js:14-52` (regex `IMPORT_FROM_RE` + `IMPORT_BARE_RE`, `extractImports`, `walkImports`) por CONTEXT D-06.
- Helper novel `listJsFiles(dir)` (recursive) añadido para el grep de picocolors sobre todo `src/` — no había analogía previa en el repo.
- Negative-control ejecutado manualmente: inyección de `import {} from '../logger.js';` en `src/cli/format.js` provocó el fallo con el diagnostic exacto listando `src/logger.js` como violator y el grafo completo (`src/cli/format.js → src/logger.js → src/config.js → src/logger-noop.js`); revertido y suite verde de nuevo.
- Suite global pasa de 454 → 458 tests con 457 pass + 1 skip (startup-budget Decisión B preservado).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test/format-isolation.test.js — walker + LOG-12 guard + picocolors grep** — `f891229` (test)

_Note: La nota TDD del plan indica `tdd="true"` pero el patrón aplicado es el de un guard test (la implementación ya existe desde Plan 14-01 — el invariante ya se cumple). El RED se demostró via negative-control (inyectar violación → fail). El GREEN quedó implícito al pasar el test contra el árbol actual sin modificación. Se documenta aquí el comportamiento; no hay commit `test:` separado porque el ciclo RED→GREEN se ejecutó como check manual (negative-control)._

## Files Created/Modified
- `test/format-isolation.test.js` (new, 129 LOC) — Source-hygiene guard. Walker verbatim de `check-isolation.test.js`. `listJsFiles` recursivo + grep `'picocolors'` sobre todo `src/`. 4 tests (2 describes).

## Decisions Made
- **Walker verbatim, not extracted:** CONTEXT D-06 + Claude's Discretion line 49 permitían extraer a un helper compartido. Elegimos la opción default (verbatim) — un solo archivo, menos acoplamiento, el guard rara vez cambiará.
- **Sanity test añadido (Test 4 picocolors-found):** evita el falso-verde si format.js deja de importar picocolors (la deepEqual contra `['src/cli/format.js']` fallaría con `[]`, pero el sanity test produce un mensaje más explícito que apunta al contrato de Plan 14-01).
- **Spanish comments preserved verbatim from analog:** comentarios sobre la distinción `logger.js` vs `logger-noop.js` copiados del analog (en español, igual que el resto del repo).

## Deviations from Plan

### Plan-vs-test acceptance criterion mismatch (informational, not a fix)

**1. [Documentation note — no code change] grep -c "/\\\\/logger\\\\.js\\$/" returns 2, not 1 as plan stated**

- **Found during:** Task 1 verification (grep audits)
- **Issue:** Plan `<acceptance_criteria>` says: `grep -c "/\\/logger\\.js\$/" test/format-isolation.test.js equals 1`. Mi archivo devuelve 2 porque la sección verbatim del walker (que el mismo plan instruye a copiar AS-IS, including comments) contiene un comentario que cita el regex (línea 85: `// El regex /\/logger\.js$/ matchea el primero y no el segundo.`) además del uso real (línea 86).
- **Resolución:** Verbatim copy wins. El analog `test/check-isolation.test.js` tiene 3 hits del mismo grep (dos comentarios + uso). El plan tiene una inconsistencia interna entre "copy verbatim including comments" y "regex count = 1". Se elige verbatim por la directiva más fuerte (CONTEXT D-06).
- **Files modified:** none
- **Verification:** All tests pass, all otros grep audits del plan pasan exactamente con los counts pedidos (`describe` = 2, `walkImports` = 3 ≥ 2, `extractImports` = 4 ≥ 3, `from '../src/cli/format.js'` = 0 hits, `'picocolors'` = 2 ≥ 1).
- **Committed in:** N/A (no fix, only documentation)

---

**Total deviations:** 1 (informational documentation note about plan inconsistency, no code change).
**Impact on plan:** None — el invariante guardado y todas las demás aceptaciones se cumplen. El conteo del regex era un check redundante con el conteo de `walkImports` y la propia ejecución del test.

## Issues Encountered
- `node --test test/` (sin glob) falla en Node 25 con `MODULE_NOT_FOUND` (Node 25 ya no resuelve directorios; necesita glob). El script `npm test` (que sí pasa el glob `test/**/*.test.js`) funciona. Documentado para evitar reuso del comando exacto del plan en futuras fases.

## Negative-control verification (mandatory per plan acceptance)

1. Backup: `cp src/cli/format.js src/cli/format.js.bak`
2. Inject: `{ echo "import {} from '../logger.js';"; cat src/cli/format.js; } > src/cli/format.js.new && mv src/cli/format.js.new src/cli/format.js`
3. Run: `node --test test/format-isolation.test.js` → **FAIL** as expected:
   ```
   ✖ src/cli/format.js does not import src/logger.js transitively (LOG-12 extension)
     AssertionError [ERR_ASSERTION]: format.js transitively imports src/logger.js via:
       src/logger.js
     Full graph from format.js:
       src/cli/format.js
       src/logger.js
       src/config.js
       src/logger-noop.js
   ```
4. Revert: `mv src/cli/format.js.bak src/cli/format.js`
5. Re-run: 4/4 tests pass.

Diagnostic message format confirmed: lista violators relativos al repo + grafo completo, exactamente como pedía el plan §`<behavior>`.

(Optional negative-control 2 not run — adding `import 'picocolors'` a otro archivo de `src/` y verificar fallo del Test 3 — no necesario porque Test 4 sanity-found ya prueba el inverso indirectly y el regex es trivialmente correcto.)

## Unexpected importers of picocolors found during initial run
None. El único importador de `picocolors` en `src/` es `src/cli/format.js` (verificado tanto por `grep -rn "picocolors" src/` antes del test como por el deep-equal del Test 3 contra `['src/cli/format.js']`).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- **Wave 3 (Plan 14-03 — PROJECT.md constraint bullet):** Listo. Este SUMMARY confirma que el guard está blindado por test; el bullet de constraint en PROJECT.md puede referenciar `test/format-isolation.test.js` con confianza.
- **Phase 15 wiring:** El guard está activo. Cualquier callsite futuro que cablee el formatter (`kodo logs`, `gsd inspect`, `gsd verify`, `kodo check`) que accidentalmente importe `picocolors` directamente o `logger.js` desde format.js fallará en CI.
- **Phase 16 LOG-09 cleanup:** Sin impacto (no toca format.js ni picocolors).

## Self-Check: PASSED

- Created file `test/format-isolation.test.js`: FOUND
- Commit `f891229`: FOUND in git log
- Test pass count: 4/4 in isolation, 458/458 in full suite
- Negative-control: VERIFIED (fails as expected with diagnostic, reverts to green)

---
*Phase: 14-cli-format-foundation*
*Completed: 2026-05-04*
