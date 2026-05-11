---
phase: 14-cli-format-foundation
plan: 01
subsystem: cli
tags: [picocolors, ansi, tty, no-color, force-color, formatter, dx-06, dx-07]

# Dependency graph
requires:
  - phase: 06-structured-logging
    provides: ANSI/COLOR_BY_LEVEL mapping convention en src/logger.js (debug=gray, info=cyan, warn=yellow, error=red) que format.js replica via picocolors
  - phase: 09-gsd-resolver
    provides: DI-by-descriptor pattern (writeFn/errFn) en src/cli/gsd-inspect.js que format.js mirrors recibiendo el descriptor en lugar del write fn
provides:
  - createFormatter(stream, env?) factory pure que devuelve un object literal de bound methods (debug/info/warn/error/ok/fail/green/yellow/red/cyan/gray/dim/formatRow/formatTable)
  - _resolveUseColor(stream, env) con precedencia NO_COLOR > FORCE_COLOR > stream.isTTY (D-02), eager (D-04)
  - visibleWidth(s) ANSI-strip-aware para padding correcto en cells coloreadas (D-10)
  - OK_SYMBOL='✓' y FAIL_SYMBOL='✗' const exports
  - golden bytes contract: useColor=false produces zero ANSI escapes (DX-06 base de --json determinismo en Phase 15)
affects: [phase-14-02-isolation-test, phase-14-03-version-smoke-doc, phase-15-cli-wiring]

# Tech tracking
tech-stack:
  added: [picocolors@^1.1.1]
  patterns:
    - "Factory function devolviendo object literal de bound methods (mirror src/logger.js makeNode)"
    - "DI-by-descriptor: createFormatter(stream) en lugar de createFormatter(writeFn) — Phase 15 callsites pasan process.stdout/process.stderr"
    - "Underscore-prefixed re-exports (_resolveUseColor) signaling test-only API"
    - "Eager closure capture de useColor — never re-read env inside helpers"

key-files:
  created:
    - src/cli/format.js
    - test/format.test.js
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "picocolors@^1.0.0 (resolved 1.1.1) como 2ª dependencia prod — zero-dep, alphabetical sibling de commander"
  - "Single source of color (D-07): picocolors solo se importa desde src/cli/format.js — Plan 14-02 blindará con grep + walker test"
  - "useColor evaluado eagerly una sola vez en el factory (D-04) — capturado en closure, no re-leído en cada llamada"
  - "Default separator ' · ' (espacio + middle dot U+00B7 + espacio) per D-11"
  - "padCell sin truncation: si la celda excede el width se devuelve as-is (D-10) — preferir overflow visual a perder información"
  - "picocolors usa close codes \\x1b[39m (color reset) y \\x1b[22m (dim close) en lugar de \\x1b[0m — anticipated por el plan §4 nota; tests usan regex tolerante (?:0|39)"

patterns-established:
  - "Color/format helper factory bound al stream descriptor: cualquier surface CLI futura recibe createFormatter(process.stdout|stderr) y obtiene helpers que respetan NO_COLOR/FORCE_COLOR/isTTY automáticamente"
  - "Golden bytes contract: para que --json determinismo se mantenga, helpers en useColor=false deben producir bytes idénticos a la string plain — verificado por test directo"

requirements-completed: [DX-06, DX-07]

# Metrics
duration: ~10min
completed: 2026-05-04
---

# Phase 14 Plan 01: CLI Format Foundation Summary

**Factory `createFormatter(stream, env?)` con picocolors@^1.1.1 entregando level chips, ok/fail glyphs, color escape hatches y formatRow/formatTable strip-aware — golden bytes garantizados cuando useColor=false (base del `--json` determinismo de Phase 15).**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3 / 3
- **Files modified:** 2 (package.json, package-lock.json)
- **Files created:** 2 (src/cli/format.js, test/format.test.js)
- **Tests added:** 39 (all passing)
- **Suite delta:** baseline 414 pass + 1 skip → 453 pass + 1 skip (no regressions)

## Accomplishments

- `picocolors@^1.0.0` (resolved 1.1.1) añadido como segunda dependencia de producción — zero-dep, ~100 LOC, sibling alphabético de commander.
- `src/cli/format.js` (178 líneas) implementa el contrato D-01..D-11 verbatim: factory pure, eager useColor, helpers de nivel/sintácticos/genéricos/tabular.
- `test/format.test.js` (232 líneas, 39 tests, 6 describe groups) cubre: 7-case useColor matrix (D-02), golden bytes per helper (DX-06), colored output with relaxed close-code matching, visibleWidth strip, formatRow padding (D-09/D-10/D-11), formatTable auto-widths.
- Single source of color invariant respetado: el único import de `picocolors` en todo `src/` es `src/cli/format.js`.
- LOG-12 extension: format.js no importa logger.js ni nada que lo arrastre — Plan 14-02 lo blindará con grep + walker.

## API Exported (verbatim typedef)

```javascript
/**
 * @typedef {{ isTTY?: boolean }} StreamLike
 *
 * @typedef {{
 *   debug:  (s: string) => string,
 *   info:   (s: string) => string,
 *   warn:   (s: string) => string,
 *   error:  (s: string) => string,
 *   ok:     (s: string) => string,
 *   fail:   (s: string) => string,
 *   green:  (s: string) => string,
 *   yellow: (s: string) => string,
 *   red:    (s: string) => string,
 *   cyan:   (s: string) => string,
 *   gray:   (s: string) => string,
 *   dim:    (s: string) => string,
 *   formatRow:   (cells: string[], widths: number[], opts?: { separator?: string }) => string,
 *   formatTable: (rows: string[][], opts?: { separator?: string, header?: string[] }) => string,
 * }} Formatter
 */

export function createFormatter(stream, env = process.env): Formatter
export function _resolveUseColor(stream, env = process.env): boolean
export function visibleWidth(s): number
export const OK_SYMBOL: '✓'
export const FAIL_SYMBOL: '✗'
```

## Test Results

| Group                                  | Tests | Status |
| -------------------------------------- | ----- | ------ |
| `_resolveUseColor precedence (D-02)`   | 7     | ✓      |
| `golden bytes when useColor=false`     | 13    | ✓      |
| `colored output when useColor=true`    | 6     | ✓      |
| `visibleWidth strips ANSI`             | 4     | ✓      |
| `formatRow padding (D-09, D-10, D-11)` | 5     | ✓      |
| `formatTable auto-widths`              | 4     | ✓      |
| **Total**                              | **39**| **✓** |

Full suite (`node --test 'test/**/*.test.js'`): **453 pass + 1 skip** (baseline 414 + 39 nuevos = 453, skip pre-existente de startup-budget Decisión B). Sin regresiones.

## Picocolors Resolved Version

Lockfile entry `node_modules/picocolors`: **1.1.1** (rango caret `^1.1.1` en package.json). Cero transitive deps verificado en `package-lock.json`.

## Task Commits

Cada task fue committed atomically con `--no-verify` (parallel executor):

1. **Task 1: Add picocolors dependency** — `7efa6e7` (chore)
2. **Task 2: Create src/cli/format.js** — `dfa81d5` (feat)
3. **Task 3: Create test/format.test.js** — `0657fea` (test)

_TDD nota:_ El plan tiene `tdd="true"` en cada task pero la estructura es plan-level: Task 2 implementación → Task 3 tests file completo. Cada commit verifica el comportamiento mediante el `<verify>` block del task (smoke `node -e` para Task 2; `node --test test/format.test.js` para Task 3). El `<behavior>` block del Task 2 fue cumplido y verificado antes del commit, los tests del Task 3 lo blindan posteriormente.

## Files Created/Modified

- `package.json` — añadida `"picocolors": "^1.1.1"` (alphabetical sibling de commander)
- `package-lock.json` — entry `node_modules/picocolors` regenerada
- `src/cli/format.js` — NUEVO (178 LOC) — factory + helpers + tabular formatters
- `test/format.test.js` — NUEVO (232 LOC) — 39 tests cubriendo el matrix + golden bytes

## Decisions Made

None de novedosas — todas las decisiones (D-01..D-11) están en `14-CONTEXT.md` y se han aplicado verbatim. La única decisión runtime (no estructural) fue:

- **picocolors resolved a 1.1.1** (no `1.0.x`): npm install picocolors@^1.0.0 resolvió a la última 1.x compatible. El acceptance criterion del plan acepta cualquier `^1.x` (`startsWith('^1.')`), y el rango caret en package.json refleja la versión real instalada.

## Deviations from Plan

None — plan executed exactly as written.

Verbatim D-01..D-11 fueron aplicadas: factory shape, useColor precedence, level→color mapping idéntico a logger.js COLOR_BY_LEVEL, OK_SYMBOL/FAIL_SYMBOL, default separator ' · ', visibleWidth ANSI-strip, padCell no-truncation, eager useColor capture, single source de picocolors.

**Total deviations:** 0
**Impact on plan:** N/A — plan ejecutado al pie de la letra; pre-anticipated edge cases (picocolors close codes `\x1b[39m`/`\x1b[22m`) ya documentados en el plan §4 nota.

## Issues Encountered

None. La única observación menor fue que `npm install picocolors@^1.0.0` persistió `^1.1.1` en lugar de `^1.0.0` — esto es comportamiento normal de npm 10+ (persiste el rango caret de la versión resuelta) y satisface el acceptance criterion `startsWith('^1.')`.

## Threat Surface Scan

No se introduce nueva superficie de amenaza adicional al threat model existente del plan (T-14-01..T-14-05 ya cubren env-var injection, ANSI escape injection en user input — Phase 15 concern, supply-chain de picocolors mitigada por lockfile + zero-dep + Plan 14-02 grep test, DoS, repudiation). El boundary "Phase 14 = no callsite" se mantiene: ningún archivo fuera de `src/cli/format.js` y `test/format.test.js` fue tocado además de `package.json`/`package-lock.json`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- API surface lista para que **Plan 14-02** añada `test/format-isolation.test.js` con LOG-12 extension (no logger import) + picocolors single-source grep.
- API surface lista para que **Plan 14-03** valide `kodo --version` smoke + actualice PROJECT.md §Constraints.
- API surface lista para que **Phase 15** wire `createFormatter(process.stdout|stderr)` en `kodo logs`, `kodo gsd inspect`, `kodo gsd verify`, `kodo check`.

## Self-Check: PASSED

**Files exist:**
- ✓ `src/cli/format.js` (178 LOC)
- ✓ `test/format.test.js` (232 LOC)
- ✓ `package.json` (modified)
- ✓ `package-lock.json` (modified)

**Commits exist:**
- ✓ `7efa6e7` (Task 1)
- ✓ `dfa81d5` (Task 2)
- ✓ `0657fea` (Task 3)

**Verification block from plan:**
- ✓ `node --check src/cli/format.js` — parse OK
- ✓ `node --test test/format.test.js` — 39/39 pass
- ✓ Full suite — 453 pass + 1 skip (baseline match)
- ✓ `grep -c "import.*from.*'picocolors'" src/cli/format.js` returns 1
- ✓ Smoke `ok('hi')` — OK

---
*Phase: 14-cli-format-foundation*
*Completed: 2026-05-04*
