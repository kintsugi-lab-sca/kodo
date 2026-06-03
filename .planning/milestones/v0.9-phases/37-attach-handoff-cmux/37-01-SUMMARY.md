---
phase: 37-attach-handoff-cmux
plan: 01
subsystem: cli/dashboard/focus
tags: [TUI-13, TUI-14, never-throws, execFile-DI, leak-guard-structural]
requires: [Phase 35 D-07 never-throws contract, Phase 34 D-12 color-isolation]
provides:
  - "runFocus({exec, ref, binary, timeoutMs?}) never-throws discriminated union"
  - "FOCUS_VERB + FOCUS_FLAG exported constants for literal-stable args"
  - "Structural leak guard: missing exec → TypeError (never touches real execFile)"
affects:
  - "src/cli/dashboard/ (new module — Plan 02 will consume runFocus from App.js)"
tech_stack_added: []
patterns:
  - "Never-throws + discriminated union (Phase 35 D-07 inherited from fetchStatus)"
  - "execFile DI by injection (mirror of src/cmux/client.js#run with 5 divergences)"
  - "Literal-stable args constants (Phase 34 D-04 NON_TTY_MSG pattern)"
  - "Structural leak guard via required param without default"
key_files_created:
  - "src/cli/dashboard/focus.js (118 lines)"
  - "test/dashboard/focus.test.js (113 lines)"
key_files_modified: []
decisions:
  - "Two separate constants FOCUS_VERB + FOCUS_FLAG (not single FOCUS_ARGS_HEAD array) — máxima claridad y tests asseren args[0]/args[1]/args[2] independientemente"
  - "Leak guard via explicit `typeof exec !== 'function'` check ANTES del new Promise — sin esa precedencia, el try/catch del never-throws contract atrapaba el TypeError y lo degradaba a SPAWN_ERROR (descubierto al correr tests RED→GREEN; Rule 1 auto-fix)"
  - "Header documenta las 5 divergencias respecto a src/cmux/client.js#run Y la divergencia code-union vs error-string respecto a fetchStatus — espejo del header de client.js Phase 35"
metrics:
  duration: "~17 min (planning context loaded + 2 tasks + summary)"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  tests_added: 5
  tests_total_after: 965 pass + 1 skip pre-existente
completed: 2026-05-28
---

# Phase 37 Plan 01: focus.js orquestador puro never-throws — Summary

Aislamiento de la única pieza load-bearing de Phase 37 (la invocación al binario cmux) en un módulo puro testeable: `runFocus({exec, ref, binary, timeoutMs})` con discriminated union never-throws, args literales `['select-workspace', '--workspace', ref]` (D-07), y leak guard estructural que impide tocar `execFile` real desde tests. 5 escenarios Wave 0 cubren TUI-13 (args ordering literal) y TUI-14 (mapeo ENOENT/NON_ZERO_EXIT/SPAWN_ERROR + never-throws contract). 0 LOC de UI tocados — Plan 02 consumirá esta fundación.

## What Was Built

### `src/cli/dashboard/focus.js` (NEW — 118 lines)

Espejo de `src/cmux/client.js#run` con 5 divergencias load-bearing (PATTERNS.md §`focus.js` líneas 64-73):

| # | Divergencia | Rationale |
|---|---|---|
| 1 | `binary` por argumento (no `getCmuxBinary()` interno) | DI por testabilidad — tests no tocan `loadConfig` |
| 2 | `exec` inyectado (no `execFile` eager import) | Leak guard estructural — sin default, imposible tocar el `execFile` real desde tests |
| 3 | Args literales fijos `[FOCUS_VERB, FOCUS_FLAG, ref]` | D-07 — el verbo es contractual, no variable |
| 4 | NEVER-THROWS — `reject(...)` → `resolve({ok:false, code, detail})` | Phase 35 D-07 contract heredado; React jamás ve excepciones |
| 5 | Timeout 5_000ms (no 15_000) | D-07 — RPC al socket cmux es ~50ms; timeout corto evita enmascarar cmux colgado |

**Contrato del discriminated union:**

```js
{ ok: true }                                          // focus ejecutado
{ ok: false, code: 'ENOENT',         detail: string } // cmux no en PATH
{ ok: false, code: 'NON_ZERO_EXIT',  detail: number } // exit code ≠ 0
{ ok: false, code: 'SPAWN_ERROR',    detail: string } // cualquier otro
```

Constantes exportadas para que tests asseren ordering literal sin duplicar strings:
- `FOCUS_VERB = 'select-workspace'`
- `FOCUS_FLAG = '--workspace'`

### `test/dashboard/focus.test.js` (NEW — 113 lines)

5 escenarios Wave 0 organizados bajo 1 `describe('Phase 37 Plan 01: runFocus never-throws + args ordering (TUI-13/TUI-14)')`:

1. **ok path** — exec fake `(null, '', '')` resuelve `{ok:true}`; args capturados deep-equal a `['select-workspace', '--workspace', 'workspace:5']` literal (TUI-13).
2. **ENOENT mapping** — `err.code='ENOENT'` → `{ok:false, code:'ENOENT', detail: string}` (TUI-14).
3. **NON_ZERO_EXIT mapping** — `err.code=7` numérico → `{ok:false, code:'NON_ZERO_EXIT', detail:7}` (TUI-14).
4. **never-throws contract** — exec sync-throws → resuelve `{ok:false, code:'SPAWN_ERROR'}` (la promise jamás rechaza, verificado con try/catch wrap).
5. **leak guard estructural** — omitir `exec` → `TypeError` (verifica que sin inyección jamás se toca `execFile` real).

## Decisions Made

### 1. Constantes separadas FOCUS_VERB + FOCUS_FLAG (Claude's Discretion)

El plan permitía un array único `FOCUS_ARGS_HEAD = ['select-workspace', '--workspace']` o constantes separadas. Elegí **constantes separadas** porque:
- Los tests pueden asertar `captured.args[0] === FOCUS_VERB`, `captured.args[1] === FOCUS_FLAG`, `captured.args[2] === ref` independientemente.
- Más claro semánticamente: el verbo y el flag son cosas distintas que existirán independientemente si cmux añade más subcomandos.
- Cero coste (dos constantes vs un array).

### 2. Leak guard estructural ANTES del new Promise (Rule 1 auto-fix)

**Descubierto durante RED→GREEN:** mi primera implementación tenía el leak guard implícito ("`exec(...)` lanzará TypeError si es undefined"), pero ese TypeError lo capturaba el `try/catch` del never-throws contract y lo degradaba a `SPAWN_ERROR` (4/5 tests pasaban, leak guard fallaba).

**Fix (Rule 1):** Añadir un check explícito `if (typeof exec !== 'function') throw new TypeError(...)` ANTES de construir la `Promise`. Esto preserva ambas invariantes:
- **Leak guard estructural:** omitir `exec` produce `TypeError` visible al caller (no se camufla).
- **Never-throws contract:** si `exec` está presente pero lanza síncronamente, sí se captura y se mapea a `{ok:false, code:'SPAWN_ERROR'}`.

El mensaje del TypeError documenta el contrato y sugiere el fix: `"Inject (await import('node:child_process')).execFile from the caller."`.

### 3. JSDoc shape exacto: `{ exec, ref, binary, timeoutMs? }` con `exec` SIN default

El plan dejaba flexible si `exec` tenía default `execFile` o no. **Elegí no-default** para hacer el leak guard contractual desde la firma — el caller (Plan 03 `runDashboard`) será explícitamente responsable de inyectar `execFile` lazy-import.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Leak guard estructural degradado por try/catch del never-throws**
- **Found during:** Task 2 (al correr `node --test test/dashboard/focus.test.js` tras crear focus.js)
- **Issue:** 4/5 tests pasaban; test 5 fallaba con `Missing expected rejection`. Mi implementación inicial confiaba en que `exec(...)` lanzaría TypeError naturalmente cuando `exec === undefined`, pero el `try/catch` del never-throws contract atrapaba ese TypeError y lo degradaba a `{ok:false, code:'SPAWN_ERROR'}` en lugar de propagarlo.
- **Fix:** Añadir check explícito `if (typeof exec !== 'function') throw new TypeError(...)` ANTES del `new Promise(...)`. Preserva ambos invariantes (leak guard + never-throws para exec presente que sync-throws).
- **Files modified:** `src/cli/dashboard/focus.js` (líneas 78-83)
- **Commit:** Incluido en `e2d04fc` (Task 2 GREEN — el bug se descubrió antes del commit, no requirió commit separado).

## Verification

**Plan-level checks (todos verdes):**

```
✓ node --test test/dashboard/focus.test.js → 5/5 pass
✓ node --test test/format-isolation.test.js → 8/8 pass (walker cubre focus.js automáticamente)
✓ grep -v '^//' src/cli/dashboard/focus.js | grep -cE "\bspawn\b|'stdio'" → 0 (NO-STDIO-INHERIT)
✓ grep -c "export.*runFocus" src/cli/dashboard/focus.js → 1
✓ grep -cE "'select-workspace'" src/cli/dashboard/focus.js → 1 (literal en constante)
✓ npm test → 965 pass + 1 skip pre-existente + 0 fail (suite global, +5 net)
```

**Comando exacto que verifica GREEN del Plan 01:**
```bash
node --test test/dashboard/focus.test.js
```

**Cross-cutting invariants preservados:**
- ✅ NO-PICOCOLORS — walker `test/format-isolation.test.js` confirma cero leak en `src/cli/dashboard/focus.js`. Las menciones de `picocolors` en focus.js están solo en comentarios documentales describiendo lo que NO se hace; el walker mira `extractImports`, no texto libre.
- ✅ NEVER-THROWS — Test 4 verifica con try/catch wrap que la promise NUNCA rechaza ante exec sync-throw. Todos los paths del módulo colapsan al discriminated union.
- ✅ NO-STDIO-INHERIT — `grep -v '^//' | grep spawn|stdio` retorna 0 — las menciones de `spawn`/`stdio` viven solo en comentarios documentales que describen lo que NO se usa.
- ✅ LITERAL-STABLE-ARGS — Test 1 asserta args exactos `['select-workspace', '--workspace', 'workspace:5']` via `assert.deepEqual`.
- ✅ STRUCTURAL-LEAK-GUARD — Test 5 confirma que omitir `exec` falla con TypeError, no degrada al discriminado.

## Files Inventory

**Created:**
- `src/cli/dashboard/focus.js` (118 lines)
- `test/dashboard/focus.test.js` (113 lines)

**Modified:** none.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `a3098f8` | test(37-01) | add failing tests for runFocus never-throws + args ordering |
| `e2d04fc` | feat(37-01) | implement runFocus never-throws orchestrator |

## What's Next

**Plan 02 (Wave 2):** App.js Enter handler + focusError state + clear-on-any-input + 3 constantes literal-estables (`FOCUS_ERR_ZOMBIE`, `FOCUS_ERR_ENOENT`, `FOCUS_ERR_FAILED_FN`), SessionTable.js footer-error rojo, `test/dashboard/app-focus.test.js` (3 tests Wave 0: `alive===false` guard, ok path, clear-on-any-input).

**Plan 03 (Wave 3):** `runDashboard` DI extension (inyecta `exec` + lazy import `runFocus` + `cmuxBin` + `onFocus` prop) + `37-HUMAN-UAT.md` (2 obligatorios bloqueantes + 2 bonus opcionales — fixture cmux GUI + zombie reject cross-process).

## Self-Check: PASSED

- ✓ `src/cli/dashboard/focus.js` exists (118 lines, ≥ 30 required)
- ✓ `test/dashboard/focus.test.js` exists (113 lines, ≥ 80 required)
- ✓ Commit `a3098f8` exists in `git log --all`
- ✓ Commit `e2d04fc` exists in `git log --all`
- ✓ `node --test test/dashboard/focus.test.js` → 5/5 pass
- ✓ `node --test test/format-isolation.test.js` → 8/8 pass (walker cubre focus.js)
- ✓ All must_haves.truths verified (8/8)
- ✓ All must_haves.artifacts verified (2/2)
- ✓ All key_links verified (2/2)
