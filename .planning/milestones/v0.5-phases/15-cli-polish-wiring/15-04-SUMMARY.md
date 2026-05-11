---
phase: 15
plan: 04
subsystem: cli
tags: [cli, format, verify, color, gsd, dx-04]
requirements: [DX-04]
dependency_graph:
  requires:
    - "Plan 14: createFormatter helper en src/cli/format.js (fmt.green/yellow/red)"
    - "src/gsd/verify.js#renderComment + 4 sub-renderers (Phase 10)"
  provides:
    - "RunGsdVerifyResult.plane.comment_body — markdown determinista expuesto"
    - "renderHuman parameterizado con Formatter (DI via formatterFn)"
    - "verdict→3-color mapping en gsd-verify CLI (pass/fail/missing|malformed)"
    - "Plane comment summary slice (3 líneas) para feedback humano sin re-render"
  affects:
    - "Plan 15-05 Wave 2: extension de test/format-isolation.test.js cubre este callsite"
tech_stack:
  patterns:
    - "Lazy formatter init en CLI handler (paridad con runVerifyFn/writeFn/errFn)"
    - "Single source of generation (Pitfall #2 Phase 10): renderComment vive en verify.js, el CLI consume el slice"
    - "Anti-re-render guard via grep source-test (REND1)"
key_files:
  created: []
  modified:
    - "src/gsd/verify.js (return shape +1 campo, typedef actualizada)"
    - "src/cli/gsd-verify.js (refactor renderHuman, formatterFn DI, summary block)"
    - "test/gsd-verify-integration.test.js (5 nuevos asserts/tests sobre comment_body)"
    - "test/gsd-verify-cli-handler.test.js (10 nuevos tests color/summary/anti-re-render)"
decisions:
  - "comment_body se incluye en plane.* (NO top-level): consistente con commented/transitioned"
  - "Slice 3 líneas (no 2): pass header tiene 'header / blank / first bullet' que da contexto"
  - "fmt.ok NO se usa en gsd-verify: el ✓ queda reservado para gsd-inspect (D-12)"
  - "Anti-re-render se enforce con grep src-test, NO con interface segregation"
metrics:
  tasks: 2
  files_modified: 4
  files_created: 0
  tests_added: 15
  tests_total: 88
  commits: 4
  duration: ~25min
  completed: 2026-05-05
---

# Phase 15 Plan 04: gsd-verify color + summary slice (DX-04)

Cablea `src/cli/format.js` (Phase 14) en `src/cli/gsd-verify.js` y simultáneamente expone `result.plane.comment_body` desde `runGsdVerify` para que el CLI pueda mostrar verdict coloreado + resumen del comentario Plane sin re-renderizar el markdown — protegiendo Pitfall #2 Phase 10 (determinismo byte-a-byte del comentario).

## What Changed

### `src/gsd/verify.js` (Task 1)

- **Typedef `RunGsdVerifyResult`** ampliada: `plane.comment_body: string` añadido al shape.
- **`finalize()` return shape** incluye el `markdown` ya computado en línea 199 como `plane.comment_body`. Cambio mínimo: una sola línea modificada en el return.
- **Sin alterar**: control flow de getTask/addComment/updateTaskState, fail-open semantics, mappings legacy de verdict, los 4 sub-renderers (`renderPassComment`, `renderFailComment`, `renderMissingComment`, `renderMalformedComment`), WR-01/WR-02 paths, hoisted provider.

### `src/cli/gsd-verify.js` (Task 2)

- **Imports**: `import { createFormatter } from './format.js'`.
- **`RunGsdVerifyCliDeps`** typedef: añade `formatterFn?: () => Formatter` (paridad con `runVerifyFn/writeFn/errFn`).
- **`runGsdVerifyCli`**: inicializa `fmt` lazy desde `deps.formatterFn || (() => createFormatter(process.stdout))`. Evita tocar `process.stdout` en import time.
- **`renderHuman(result, write, fmt)`** refactorizado:
  - **D-14 mapping** vía IIFE switch:
    - `verdict.action === 'pass'` → `fmt.green('pass')` (happy path)
    - `verdict.action === 'fail'` → `fmt.yellow('fail')` (soft-fail recoverable)
    - `verdict.action === 'missing'` → `fmt.red('missing')` (hard-fail)
    - `verdict.action === 'malformed'` → `fmt.red('malformed')` (hard-fail)
    - Cuerpo (phase_id, reason, detail, must_haves) en color neutro.
  - **D-15 summary block** vía slice del comment_body:
    ```
    Plane comment (summary):
      [kodo:gsd] ✅ Phase 10 verificada — Phaseno
      <empty>
      - Must-haves: 8/8 verificados
    ```
    `plane.comment_body.split('\n').slice(0, 3)` — slice puro, **NO** re-render.
  - **Orden**: Verdict → Plane comment summary → `Plane: commented=… transitioned=…`.
- **Sin alterar**: control flow del try/catch, exit codes 0/1/2 (Pitfall #6 Opción A), `--json` mode (sigue siendo `JSON.stringify(result, null, 2)`).

## TDD Cycles

### Task 1 — Expose `plane.comment_body`

| Phase  | Commit    | Status |
| ------ | --------- | ------ |
| RED    | `513fe3c` | 5 tests añadidos a `gsd-verify-integration.test.js` (T20-T25 byte-equality + T24 Plane unreachable + T25 idempotencia) — fallan todos como esperado |
| GREEN  | `94667a6` | `verify.js` + typedef + return shape — 27/27 verify tests + 73 baseline = 100/100 verde |

### Task 2 — Color mapping + summary block

| Phase  | Commit    | Status |
| ------ | --------- | ------ |
| RED    | `f124737` | 10 tests añadidos a `gsd-verify-cli-handler.test.js` (CLR1-CLR5 color, SUM1-SUM3 summary, REND1 anti-re-render, JSON1, EXIT1-EXIT3) — fallan en SUM/CLR/REND como esperado |
| GREEN  | `d6f0445` | `gsd-verify.js` refactor + `createFormatter` import + `formatterFn` DI + summary block — 61/61 verde |

## Acceptance Criteria — All Met

### Task 1
- ✓ `grep -c "comment_body: markdown" src/gsd/verify.js` === **1**
- ✓ `grep -c "comment_body: string" src/gsd/verify.js` === **1** (typedef)
- ✓ `grep -c "result.plane.comment_body" test/gsd-verify-integration.test.js` >= 4 → **20**
- ✓ Byte-equality test entre `result.plane.comment_body` y `renderComment(verdict, phaseName)`: presente y verde (T20).
- ✓ `node --test test/gsd-verify-integration.test.js test/gsd-verification.test.js` exit 0.

### Task 2
- ✓ `grep -c "import { createFormatter } from './format.js'" src/cli/gsd-verify.js` === **1**
- ✓ `grep -c "formatterFn" src/cli/gsd-verify.js` >= 2 → **3**
- ✓ `grep -c "fmt.green('pass')" src/cli/gsd-verify.js` === **1**
- ✓ `grep -c "fmt.yellow('fail')" src/cli/gsd-verify.js` === **1**
- ✓ `grep -c "fmt.red('missing')" src/cli/gsd-verify.js` === **1**
- ✓ `grep -c "fmt.red('malformed')" src/cli/gsd-verify.js` === **1**
- ✓ `grep -c "comment_body.split" src/cli/gsd-verify.js` === **1**
- ✓ `grep -c "Plane comment (summary):" src/cli/gsd-verify.js` === **2** (1 emit + 1 doc string en JSDoc)
- ✓ `grep -cE "renderComment|renderPass…|renderFail…|renderMissing…|renderMalformed…" src/cli/gsd-verify.js` === **0**
- ✓ Color mapping tests verdes para los 4 verdicts.
- ✓ Summary block tests (slice + orden) verdes.
- ✓ --json preservado (incluye comment_body, sin color, sin summary).
- ✓ Exit codes 0/1/2 invariantes.

## Verification Results

```
node --test test/gsd-verify-integration.test.js test/gsd-verify-cli.test.js \
            test/gsd-verify-cli-handler.test.js test/gsd-verification.test.js
# tests 88, pass 88, fail 0
```

Suite global: **473 pass + 1 skip pre-existente, 0 fail** (`node --test 'test/**/*.test.js'`).

## Pitfall #2 Phase 10 — determinismo byte-a-byte protegido

El `markdown` que `provider.addComment(task, markdown)` recibe es **el mismo string** que aparece en `result.plane.comment_body`. Tests T20+T24 lo asertan explícitamente:

```javascript
assert.equal(
  result.plane.comment_body,
  calls.addComment[0].md,
  'comment_body debe ser byte-idéntico al markdown que recibe addComment',
);
```

Y T25 confirma idempotencia:

```javascript
assert.equal(r1.plane.comment_body, r2.plane.comment_body);
```

El CLI **nunca** llama `renderComment` ni los sub-renderers (REND1 enforce via `grep` source-test).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Anti-re-render grep matchea comentarios JSDoc**

- **Found during:** Task 2 GREEN (al ejecutar tests post-implementación).
- **Issue:** El test REND1 usa `grep -E renderComment|renderPass…` contra el archivo entero. Los comentarios JSDoc explicativos del refactor mencionaban `renderComment` y rompían el assert.
- **Fix:** Reescritos los comentarios para describir el patrón ("NO se re-genera el markdown") sin nombrar las funciones del renderer (que son detalle de implementación de `verify.js`, no del CLI). El comportamiento del código no cambia.
- **Files modified:** `src/cli/gsd-verify.js` (2 comentarios JSDoc/inline reformulados).
- **Commit:** `d6f0445` (incluido en el GREEN).

### Auth Gates

Ninguna.

## Self-Check: PASSED

Verificaciones completadas:

```
src/gsd/verify.js                          → FOUND (402 líneas)
src/cli/gsd-verify.js                      → FOUND (165 líneas)
test/gsd-verify-integration.test.js        → FOUND (modificado)
test/gsd-verify-cli-handler.test.js        → FOUND (modificado)

Commit 513fe3c (test RED Task 1)           → FOUND
Commit 94667a6 (feat GREEN Task 1)         → FOUND
Commit f124737 (test RED Task 2)           → FOUND
Commit d6f0445 (feat GREEN Task 2)         → FOUND
```

## TDD Gate Compliance

Plan tiene `type: execute` (no `tdd`), pero ambas tasks tienen `tdd="true"`. Cada task siguió el ciclo RED → GREEN. No hubo REFACTOR commits porque el código quedó limpio en GREEN. Sin warnings de cumplimiento.
