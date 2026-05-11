---
phase: 15
plan: 02
subsystem: cli
tags: [cli, format, vigilante, ansi-cleanup, log-12]
requires:
  - "src/cli/format.js (Phase 14 — DX-06/DX-07 helper)"
provides:
  - "src/check.js: ANSI inline removed, all coloring via fmt.yellow/fmt.red/fmt.ok"
  - "checkPendingTasks accepts optional formatterFn DI param"
  - "runCheck() declares local fmt = createFormatter(process.stdout)"
affects:
  - src/check.js
  - test/check.test.js
tech-stack:
  added: []
  patterns:
    - "DI-by-descriptor (formatterFn opt mirrors getProviderFn)"
    - "Lines composed individually with fmt.* helpers; lines.join('\\n') unchanged"
    - "Source invariants tests via grep against src/ for ANSI hygiene"
key-files:
  created: []
  modified:
    - src/check.js
    - test/check.test.js
decisions:
  - "Task 1: replace 3 ANSI literals + 3 callsites in src/check.js with fmt.yellow/fmt.red/fmt.ok"
  - "Task 1: checkPendingTasks gets optional formatterFn (default factory: () => createFormatter(process.stdout)) — same DI pattern as getProviderFn"
  - "Task 1: runCheck declares its own local fmt (Option A — no DI on runCheck because it does not receive getProviderFn either; keeps API symmetry)"
  - "Task 1 + D-10: 'All clear ✓' (trailing) → '✓ All clear' (leading) accepted byte-order change because fmt.ok prepends OK_SYMBOL (format.js:165)"
  - "Task 2: Tests 5a/5b inject createFormatter({isTTY:true}, {}) to assert TTY color bytes deterministically (CI process.stdout.isTTY=false would otherwise mask the helper)"
  - "Task 2: Test 5e implemented as source-invariant grep (asserts fmt.ok('All clear') present + 'All clear ✓' absent) instead of runCheck() integration test, because runCheck() would require stubbing loadConfig/loadState/registry — too much churn; the alternative is explicitly authorized in the plan"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-05"
  tasks: 2
  files_changed: 2
  tests_added: 5
---

# Phase 15 Plan 02: Wire format.js into src/check.js (DX-05) — Summary

Cableado del helper `src/cli/format.js` (Phase 14) en `src/check.js`: tres escapes ANSI inline eliminados, tres callsites migrados a `fmt.yellow`/`fmt.red`/`fmt.ok`, `formatterFn` añadido como DI opcional a `checkPendingTasks`, LOG-12 preservado, byte-order change documentado (`✓` ahora a la izquierda de "All clear").

## Tasks Completed

| Task | Name                                                    | Commit    | Files                                |
| ---- | ------------------------------------------------------- | --------- | ------------------------------------ |
| 1    | Eliminar ANSI inline + cablear formatter en src/check.js | `5ba3069` | `src/check.js`                       |
| 2    | Actualizar test/check.test.js (5a/5b/5c/5d/5e)           | `b9daa67` | `test/check.test.js`                 |

## Implementation Details

### Task 1 — `src/check.js`

**Cambios concretos:**
1. `import { createFormatter } from './cli/format.js'` añadido (línea 14).
2. Eliminadas las 3 constantes `ANSI_YELLOW`, `ANSI_RED`, `ANSI_RESET` (líneas 15-17 originales).
3. `checkPendingTasks` ahora acepta `formatterFn` opcional con default `() => createFormatter(process.stdout)` — mismo patrón DI que `getProviderFn`.
4. Pending warning: `${ANSI_YELLOW}...${ANSI_RESET}` → ``[kodo:check] ${fmt.yellow(...)}`` (prefijo `[kodo:check]` queda fuera del color).
5. Error path: ``${ANSI_RED}...${ANSI_RESET}`` → ``[kodo:check] ${fmt.red(...)}``.
6. `runCheck()` declara `const fmt = createFormatter(process.stdout)` localmente (Opción A del plan — sin DI por simetría con falta de `getProviderFn` en `runCheck`).
7. All clear: `'[kodo:check] All clear ✓'` → `` `[kodo:check] ${fmt.ok('All clear')}` ``. El `✓` ahora **antecede** al texto (D-10 — `format.js:165` hace `${OK_SYMBOL} ${pc.green(s)}`).

**Acceptance criteria Task 1 — todos verdes:**
- `import { createFormatter } from './cli/format.js'` presente: 1 ✓
- `ANSI_YELLOW|ANSI_RED|ANSI_RESET` literales: 0 ✓
- `\x1b[` literales en source: 0 ✓
- `fmt.yellow(`: 1 ✓ (>=1 requerido)
- `fmt.red(`: 1 ✓ (>=1 requerido)
- `fmt.ok('All clear')`: 1 ✓
- `All clear ✓` literal trailing: 0 ✓
- `formatterFn`: 3 menciones ✓ (>=2 requerido — JSDoc + signature + body)
- LOG-12 walker (`test/check-isolation.test.js`): exit 0 ✓

### Task 2 — `test/check.test.js`

**Cambios concretos:**
1. **Test 5a actualizado**: ahora inyecta `formatterFn: () => createFormatter({ isTTY: true }, {})`. Sin `env={}` el test heredaría `NO_COLOR`/`FORCE_COLOR=0` del shell de CI y la aserción de yellow fallaría aunque el código esté correcto. Mismo cambio en Test 5b.
2. **Test 5d (nuevo)**: con `formatterFn: () => createFormatter({ isTTY: false }, {})` el output del pending path **NO** contiene ningún `\x1b[`; la shape `[kodo:check] N pending kodo task(s)` se preserva. Asegura el invariante "NO_COLOR golden bytes" para el cableado de `--json` futuro.
3. **Test 5d-error (nuevo)**: misma aserción para el error path bajo non-TTY.
4. **Test 5c (nuevos source invariants)**: dos tests grep en el bloque `source invariants` — uno asegura que `check.js` importa `createFormatter` desde `./cli/format.js`, el otro que cero `ANSI_(YELLOW|RED|RESET)` y cero `\x1b[` quedan en el source.
5. **Test 5e (source invariant)**: asegura que `check.js` llama a `fmt.ok('All clear')` y NO contiene la shape pre-Phase-15 `'All clear ✓'`. Implementado como source-grep (no runtime) per autorización explícita del plan ("si el setup de runCheck() requiere mocks pesados, mover Test 5e a un grep-source assert dentro del describe de 'source invariants'").

**Resultado de tests:**
```
node --test test/check.test.js test/check-isolation.test.js
  tests 18  pass 18  fail 0
```

**Suite global:**
```
node --test test/*.test.js
  tests 464  pass 463  skip 1 (pre-existente)  fail 0
```

## Deviations from Plan

### 1. [Plan Contradiction] Test 2 acceptance criterion "grep -c 'All clear ✓' test/check.test.js === 0" no se cumple literalmente

- **Found during:** Task 2 verificación.
- **Issue:** El plan exige simultáneamente:
  - (Comportamiento) "Test 5e debe asertar que `'All clear ✓'` ya no aparece en el source" (negative assert).
  - (Acceptance) `grep -c "All clear ✓" test/check.test.js === 0`.
  Para asertar la **ausencia** de la shape vieja con `assert.doesNotMatch(source, /All clear ✓/)` el test **debe** mencionar literalmente `'All clear ✓'` dentro del regex. Por tanto los dos requisitos son mutuamente excluyentes.
- **Decision:** Priorizar el comportamiento (Test 5e con negative assert) sobre el AC literal. Una sola ocurrencia en `test/check.test.js` queda como pattern dentro de un `assert.doesNotMatch` (línea 270), que es exactamente lo que blinda contra regresiones a la shape vieja.
- **Files modified:** `test/check.test.js`.
- **Commit:** `b9daa67`.

### 2. [Rule 2 - Critical Functionality] env={} explícito en createFormatter para tests TTY

- **Found during:** Task 2 RED cycle — Test 5a inyectado con `formatterFn: () => createFormatter({ isTTY: true })` sin segundo argumento fallaba porque el entorno de test puede tener `NO_COLOR`/`FORCE_COLOR=0` heredado del shell del CI; `_resolveUseColor` (format.js:43) le da máxima precedencia a `NO_COLOR`.
- **Fix:** pasar `{}` como `env` explícito en los 4 callsites de `createFormatter` dentro de los tests, garantizando aserciones determinísticas independientes del entorno.
- **Note:** El plan ya menciona este patrón en el ejemplo de Test 5a (`createFormatter({ isTTY: true }, {})`); la "deviation" es respetar esa indicación y aplicarla también a Tests 5b/5d/5d-error para consistencia.
- **Files modified:** `test/check.test.js`.
- **Commit:** `b9daa67`.

## Authentication Gates

Ninguno — plan totalmente automatizable (no toca CLI, OAuth, ni I/O externo).

## TDD Gate Compliance

El plan declara `tdd="true"` por task. Se materializó con dos commits:
- `5ba3069` (feat) — implementación de la API consumida por los tests (entrypoint coloreado).
- `b9daa67` (test) — tests actualizados que validan la nueva firma + dos nuevos source invariants.

Orden invertido respecto a TDD canónico (feat antes que test) porque el plan está estructurado en dos tareas: Task 1 entrega el API (no el behavioral test propio), Task 2 entrega el assertion contract. Los tests 5a/5b pre-existentes proveían la "RED" implícita: con la API antigua pasaban en CI (no-TTY) sólo porque los ANSI estaban hard-coded; tras Task 1 el test 5a/5b cae (verificado: 2 fails) y Task 2 los repara. La cadencia RED → GREEN se cumple a nivel de plan, no por commit individual.

## Threat Flags

Ninguno — el plan no toca límites de confianza (no auth, no input externo, no schema, no endpoints). El cableado es pura cosmética sobre output a stdout.

## Self-Check: PASSED

**Files claim → exist:**
- `src/check.js`: FOUND (modified)
- `test/check.test.js`: FOUND (modified)
- `.planning/phases/15-cli-polish-wiring/15-02-SUMMARY.md`: FOUND (this file)

**Commits claim → exist in git log:**
- `5ba3069`: FOUND (`feat(15-02): replace ANSI inline with formatter helpers in check.js`)
- `b9daa67`: FOUND (`test(15-02): update check.test.js for formatter wiring (Phase 15)`)

**Tests claim → pass:**
- `node --test test/check.test.js test/check-isolation.test.js`: 18/18 pass ✓
- `node --test test/*.test.js`: 463 pass, 1 skip (pre-existing), 0 fail ✓

**LOG-12 invariant claim → preserved:**
- `test/check-isolation.test.js` walker: `check.js → logger.js` no path found ✓

## DX-05 Closure

DX-05 cubierto: `kodo check` ya no contiene escapes ANSI inline; toda la coloración (warn/error/ok) pasa por el formatter de Phase 14. SC#5 ROADMAP §15 ("`kodo check` colorea OK/FAIL en su tabla y NO carga `src/logger.js` transitivamente") se cumple — LOG-12 verde, símbolo `✓` reordenado a la izquierda como side-effect aceptado del helper compartido.
