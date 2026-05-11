---
phase: 15-cli-polish-wiring
plan: 03
subsystem: cli
tags: [cli, formatter, picocolors, gsd-inspect, dx, tdd]

# Dependency graph
requires:
  - phase: 14-cli-format-foundation
    provides: "src/cli/format.js — createFormatter(stream, env?) factory con fmt.ok / fmt.fail / level chips (DX-06, DX-07)"
provides:
  - "renderHuman 4-section output (config / fetch / roadmap / match) con ✓/✗ por sección via fmt.ok / fmt.fail"
  - "Exit: N visible como última línea en human mode, coincidente con el código retornado"
  - "formatterFn DI siguiendo el mismo molde que writeFn / errFn / getProviderFn"
  - "Exit: N consistency en error paths (config-error → 1, fetch-failure → 2), suprimido en --json mode"
affects:
  - "15-04 (gsd-verify wiring) — el patrón de DI con formatterFn se reutiliza tal cual"
  - "15-05 (kodo logs wiring) — mismo patrón de inyección"
  - "Cualquier futura sección con verdict-like rendering (operadores que graban kodo gsd inspect en scripts)"

# Tech tracking
tech-stack:
  added: []  # No new dependencies — sólo consume src/cli/format.js de Phase 14
  patterns:
    - "formatterFn DI: callsite recibe `() => Formatter` — tests inyectan createFormatter({ isTTY: false }, {}) para asertar bytes plain (NO_COLOR golden)"
    - "Exit: N visible suprimido en --json mode (if (!opts.json) write(`Exit: ...`)) para no romper consumers que parsean stdout"
    - "Pre-cómputo de exitCode antes de renderHuman → garantía de que el N visible es exactamente el N retornado (D-13 invariante)"

key-files:
  created: []
  modified:
    - "src/cli/gsd-inspect.js — renderHuman refactorizado, formatterFn DI añadido, Exit: N consistente"
    - "test/gsd-inspect-cli.test.js — 13 tests (10 actualizados + 3 nuevos: Test 4 roadmap-missing, Test 5b json-suppression, Test 8 exit-N-consistency)"

key-decisions:
  - "Las secciones config y fetch siempre renderizan ✓ OK en renderHuman porque cualquier fallo previo retorna antes via errFn (D-13 / PATTERNS finding #4). NO se inyectan flags configOk/fetchOk al renderer — quedaría innecesariamente acoplado."
  - "Exit: N visible también en error paths tempranos (config error, fetch failure) PERO suprimido en --json mode para preservar stdout JSON parseable. Recomendación PATTERNS línea 427 opción (a): consistencia operador en human, hands-off en json."
  - "Pre-cómputo de exitCode en runGsdInspect antes de invocar renderHuman → la línea Exit: N nunca puede divergir del valor retornado (single source of truth para el N)."
  - "matchLine para verdict.error usa formato `<code>[: <detail>]` colapsando code + detail en una sola línea (vs. el shape antiguo que los separaba en `code:` / `detail:` / `matches:`). matches no se renderiza explícitamente — el detail del verdict ya lo lleva cuando aplica (multi-match)."

patterns-established:
  - "renderer parameters: { ...payload, write, fmt, exitCode } — exitCode siempre pre-computado por el handler"
  - "test fixture nocolorFormatter() = createFormatter({ isTTY: false }, {}) → bytes plain con símbolos ✓/✗ literales (golden bytes contract base de SC#5)"
  - "test fixture makeProjectDirWithPlanning() / makeProjectDirWithoutPlanning() → tmp dirs con/sin .planning/PROJECT.md para cubrir el existsSync real del handler sin mockear FS"
  - "Plan-level TDD gate: commit test(...) RED → commit feat(...) GREEN, ambos visibles en git log antes de SUMMARY"

requirements-completed: [DX-03]

# Metrics
duration: 5min
completed: 2026-05-05
---

# Phase 15 Plan 03: gsd-inspect 4-section render + Exit: N visible Summary

**`kodo gsd inspect` renderHuman refactor a 4 secciones literales (`config / fetch / roadmap / match`) con `fmt.ok` / `fmt.fail` por sección y `Exit: N` como última línea; D-19 exit codes y D-17 JSON shape inalterados.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-05T14:34:36Z
- **Completed:** 2026-05-05T14:38:50Z
- **Tasks:** 2 (Task 1 refactor + Task 2 test updates, ambos TDD)
- **Files modified:** 2 (src/cli/gsd-inspect.js, test/gsd-inspect-cli.test.js)

## Accomplishments

- `renderHuman` ahora emite 4 secciones literales en orden SC#3 (`config / fetch / roadmap / match`) con `✓ OK` / `✗ FAIL` por sección via `fmt.ok` / `fmt.fail`, eliminando el shape antiguo `Verdict: / action: phase / phase_id: ...`.
- `Exit: N` aparece como última línea en human mode en TODAS las ramas — happy path (phase/bootstrap/error) Y error paths tempranos (config error → exit 1, fetch failure → exit 2). Suprimido en `--json` mode (`if (!opts.json) write(...)`) para no contaminar el stdout JSON.
- `formatterFn` DI añadido siguiendo el molde existente (`writeFn`, `errFn`, `getProviderFn`) — tests inyectan `createFormatter({ isTTY: false }, {})` para asertar bytes plain con símbolos literales (NO_COLOR golden).
- Pre-cómputo de `exitCode` en `runGsdInspect` antes de invocar `renderHuman` → el N visible nunca puede divergir del N retornado (D-13 single-source-of-truth).
- Bloque preview de `buildGsdContext` se conserva exclusivamente para verdict `bootstrap` (Discretion CONTEXT línea 70 — útil para auditoría de fresh projects).
- D-17 (`--json` shape) preservado: exactamente las 5 keys `{ task, project_path, has_planning_dir, verdict, brief }`, sin `Exit: N` adicional.
- D-18 (dry-run estricto) preservado: 0 imports nuevos de lock/state/cmux. Anti-regression test sigue verde.
- D-19 (exit codes) preservado: 0=phase|bootstrap, 1=verdict-error|config-error, 2=fetch-failure. La línea visible siempre coincide.

## Task Commits

Each task was committed atomically following the TDD gate sequence:

1. **Task 2 (RED) — failing tests for new shape** — `110eb5b` (test)
   - Tests asertan 4 secciones literales con `fmt.ok` / `fmt.fail`, `Exit: N` last-line, `--json` shape inalterado, y los 3 verdicts × Exit: N consistency.
2. **Task 1 (GREEN) — renderHuman refactor + Exit: N visible** — `3eed5aa` (feat)
   - Implementación que vuelve los tests verdes; D-12 + D-13 + formatterFn DI; D-19 / D-17 / D-18 invariantes preservadas.

_Note: Plan-level TDD: `test(...)` antes de `feat(...)` en `git log`, ambos verificables._

## Files Created/Modified

- `src/cli/gsd-inspect.js` — renderHuman refactorizado a 4 secciones (`config / fetch / roadmap / match`), `formatterFn` DI añadido, `Exit: N` consistente en human mode (con guard `if (!opts.json)` en error paths). 128 líneas tocadas (190 totales, +77/-51 sobre baseline).
- `test/gsd-inspect-cli.test.js` — 13 tests cubriendo: 4 verdicts (phase/bootstrap/error happy path + multi-match), Test 4 roadmap-missing, Test 5 config-error, Test 5b json-suppression, Test 6 fetch-failure, Test 7 json shape inalterado (combinado con tests existentes), Test 8 exit-N-consistency parametrizado, D-04 / D-18 invariantes anti-regresión. Fixtures `makeProjectDirWithPlanning` / `nocolorFormatter` añadidas.

## Decisions Made

- **`config` y `fetch` no inyectan flags `configOk` / `fetchOk`**: si llegamos a `renderHuman`, ambos pasaron — los fallos previos retornan antes via `errFn`. Pattern más simple y menos acoplado (PATTERNS finding #4).
- **`Exit: N` en error paths**: opción (a) de PATTERNS línea 427 — consistencia operador. Pero suprimido en `--json` para no romper `JSON.parse` de consumers downstream.
- **`exitCode` pre-computado** antes de invocar `renderHuman` → garantía de coincidencia visible/retornado.
- **Match line collapsing**: `match: ✗ FAIL — <code>[: <detail>]` en lugar de las múltiples líneas del shape antiguo (`code:` / `detail:` / `matches:`). Más compacto y coherente con las otras 3 secciones (cada una en una sola línea). El campo `matches` del verdict no se renderiza explícitamente — cuando aplica (multi-match), el resolver ya pone el listado en `verdict.detail`.

## Deviations from Plan

None — plan executed exactly as written. Las acceptance criteria del plan coinciden 1:1 con las assertions implementadas.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. `picocolors` ya estaba instalado desde Phase 14.

## Verification Performed

- `node --test test/gsd-inspect-cli.test.js` → 13 pass / 0 fail.
- `node --test 'test/**/*.test.js'` (full suite) → 461 pass / 1 skip / 0 fail (skip = pre-existing `startup-budget`, Decisión B).
- Smoke test inline (default `formatterFn`, TTY-less stdout): renderiza las 4 secciones + `Exit: 0` correctamente.
- Smoke test inline (`NO_COLOR=1`, verdict error): bytes sin ANSI escapes, símbolos `✓` / `✗` literales presentes, `Exit: 1` matches return code.
- Acceptance criteria checks (grep): `createFormatter` import (1), `formatterFn` refs (2), `fmt.ok('OK')` (4), `fmt.fail('FAIL')` (2), 4 secciones literales (1+1+1+1), `Exit: ${exitCode}` literal (1), `if (!opts.json) write(\`Exit:` (2), shape antiguo eliminado (0). Test acceptance: 4 section labels asserted ≥4, `Exit: \d` asserts ≥4 (12 hits).

## TDD Gate Compliance

- ✓ RED commit (`test(15-03)`, `110eb5b`) presente antes de la implementación.
- ✓ GREEN commit (`feat(15-03)`, `3eed5aa`) presente después del RED.
- No REFACTOR commit necesario — la primera implementación cubre el shape final sin clean-up adicional.

## Next Phase Readiness

- Plan 15-04 (`gsd-verify` wiring) puede reutilizar el mismo patrón `formatterFn` DI sin cambios.
- Plan 15-05 (`kodo logs` wiring) idem.
- D-12, D-13 cerrados al nivel de `gsd inspect`. SC#3 ROADMAP §15 satisfecho para esta superficie.
- DX-03 marcado como cubierto.

## Self-Check: PASSED

Files exist:
- ✓ `src/cli/gsd-inspect.js` (modified, 190 lines)
- ✓ `test/gsd-inspect-cli.test.js` (modified, 13 tests pass)
- ✓ `.planning/phases/15-cli-polish-wiring/15-03-SUMMARY.md` (created — this file)

Commits exist (verified in `git log d16f8e4..HEAD`):
- ✓ `110eb5b` test(15-03): add failing tests for renderHuman 4-section shape (D-12, D-13)
- ✓ `3eed5aa` feat(15-03): refactor renderHuman to 4 sections + Exit: N visible (D-12, D-13)

---
*Phase: 15-cli-polish-wiring*
*Plan: 03*
*Completed: 2026-05-05*
