---
phase: 27-cross-provider-contract-matrix
plan: 01
subsystem: testing
tags: [test-only, cross-provider, contract-matrix, invariant-v0.2, TEST-03]
requirements-completed: [TEST-03]
dependency-graph:
  requires: []
  provides:
    - "Empirical proof that v0.2 invariant holds across plane + github adapters"
    - "Regression guard: any future asymmetry (e.g. new field in only one normalizer) breaks loud"
  affects:
    - "test/providers/contract.test.js — sole new artifact"
tech-stack:
  added: []
  patterns:
    - "Cross-provider matrix loop in node:test (idiomatic for...of over describe, no describe.each in stdlib)"
    - "DI divergence hiding via instantiateProvider(name) helper (Pattern J)"
    - "Strict-suffix route matching for stubPlaneFetch (avoids /projects/ shadowing /projects/{uuid}/work-items/)"
    - "Subset shape check (W-1) — keys ⊆ CANONICAL + required-present; tolerates future legitimate additions while keeping D-18 leak guard"
key-files:
  created:
    - test/providers/contract.test.js
  modified: []
decisions:
  - "Use subset check (keys ⊆ CANONICAL_TASK_ITEM_KEYS) + required-present check instead of exact-11 equality. Rationale: GitHub and Plane normalizers both emit 11 keys today, but exact equality would break loud if either adds a new canonical field in the future. Subset check keeps D-18 leak guard (any non-canonical key throws) while tolerating roll-forward."
  - "Use strict path.endsWith matching in stubPlaneFetch (NOT String.includes). String.includes matches `/projects/` against `/api/v1/workspaces/test/projects/{uuid}/work-items/`, shadowing the intended /work-items/ route. Discovered during GREEN attempt 1 — Rule 1 auto-fix (bug)."
  - "Call factory functions directly (createPlaneProvider, createGitHubProvider) instead of getProvider('name') from registry. Rationale: getProvider() calls loadConfig() which requires real config v0.7 — fragile in CI. SC#1 still holds (the contract is the adapter's, not the registry's)."
  - "Per-provider fixtures (plane-workitem.json for Plane, issue.json for GitHub) — NO shared cross-provider fixture. Plane and GitHub raw payloads have distinct structural shapes; abstracting them would be premature."
  - "Error contract negativo símétrico — `getTask(invalidRef)` must throw Error with .message string in both providers, but .code values legitimately diverge (Plane: no .code; GitHub: .code='not_found'). Tested via err instanceof Error + typeof err.message === 'string', NOT equality on .code."
metrics:
  duration: "~30min (estimated; rebase + read + write + test + commit + summary)"
  completed: "2026-05-14"
  loc-created: 448
  loc-modified: 0
  tests-added: 14
---

# Phase 27 Plan 01: Cross-Provider Contract Matrix Summary

**One-liner:** `test/providers/contract.test.js` itera estructuralmente `['plane','github']` × 7 asserts contract core con cero touch a producción — cierra TEST-03 (último requirement del milestone v0.7) demostrando empíricamente el invariante v0.2.

## What Was Done

Creado un único archivo de test (`test/providers/contract.test.js`, 448 LOC) que ejecuta una matriz de 7 contract asserts contra cada uno de los dos `TaskProvider` adapters de producción (`createPlaneProvider`, `createGitHubProvider`). Los 14 casos resultantes (7 × 2) ejercitan los 9 métodos canonical, el shape canónico del `TaskItem` (D-18 leak guard cross-provider), el contract negativo simétrico (`getTask` lanza, `parseTriggerEvent({})` retorna `null`, `verifySignature('', {})` retorna `false`), y el contract `init() no-throw`. La asimetría DI entre providers (Plane usa `globalThis.fetch` stub; GitHub usa `opts.client` injection) queda oculta detrás de un helper `instantiateProvider(name)` — el loop matricial no conoce ni le importa.

## Confirmation Checks

### Test count derivado por construcción

```
$ node --test test/providers/contract.test.js
…
ℹ tests 14
ℹ suites 2
ℹ pass 14
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 120.111333
```

14 = `PROVIDERS.length × N_core_asserts` = 2 × 7. **No hardcoded en el código** — el conteo emerge del `for (const providerName of PROVIDERS) describe(...)`.

### Live-fetch leak guard verbatim

`test/providers/contract.test.js:49-58`:

```js
const _originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => {
    throw new Error('live fetch leak: contract matrix must stub or inject');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});
```

Verificación runtime: `node --test test/providers/contract.test.js 2>&1 | grep -cE "live fetch leak|ENOTFOUND|ECONNREFUSED|api\.github\.com|plane\.app"` → **0** (zero leaks, zero hits a paths reales).

### Suite delta (baseline → post-plan)

```
$ npm test
…
ℹ tests 778
ℹ suites 161
ℹ pass 777
ℹ fail 0
ℹ skipped 1
ℹ todo 0
```

Baseline pre-plan: **763 pass / 1 skipped / 0 fail / 764 tests** (capturado al inicio de la ejecución).
Post-plan: **777 pass / 1 skipped / 0 fail / 778 tests**.
Delta: **+14 pass** (exactamente lo esperado).

### Grep verification — estructural

| Check | Command | Expected | Actual |
|-------|---------|----------|--------|
| Matrix loop estructural | `grep -cE "for\s*\(\s*const\s+\w+\s+of\s+(PROVIDERS\|providers)" test/providers/contract.test.js` | ≥ 1 | 2 (1 código real + 1 docblock) |
| Zero `it()` top-level | `grep -cE "^  it\(" test/providers/contract.test.js` | 0 | 0 |
| Zero hardcoded counts | `grep -cE "providers.length \* [0-9]+\|assert.*=== 14\|tests.* 14" test/providers/contract.test.js` | 0 | 0 |
| `CANONICAL_TASK_ITEM_KEYS` contiene 11 fields | grep + count del array | 11 | 11 |
| Import attributes JSON | `grep -cE "from.*\.json' with \{ type: 'json' \}" …` | ≥ 3 | 3 |
| Imports `TASK_PROVIDER_METHODS` desde `src/interface.js` | grep | 1 | 1 |
| `providerName` mentions (W-2 robust grep) | `grep -c 'providerName' …` | ≥ 7 | 33 |
| Wall-time del archivo | `node --test … duration_ms` | < 1500 | 120 |

### Karpathy Rule 3 — cambios quirúrgicos

```
$ git diff --name-only HEAD~1 HEAD -- 'src/**'
(empty)
```

Cero modificaciones a `src/**`, a `test/plane-provider.test.js`, a `test/providers/github/provider.test.js`, ni a fixtures existentes. El único archivo creado es `test/providers/contract.test.js`.

## Threat Mitigations Verified

| Threat ID | Category | Disposition | Verification |
|-----------|----------|-------------|--------------|
| T-27-01 | Information Disclosure (live fetch leak) | **mitigate** | File-level `before/after` reemplaza `globalThis.fetch` por thrower. Runtime grep `live fetch leak\|ENOTFOUND` → 0 hits. |
| T-27-02 | Tampering (globalThis.fetch cross-contamination) | **mitigate** | `instantiateProvider('plane')` retorna `cleanup = stub.restore`; `afterEach(() => cleanup?.())` se ejecuta SIEMPRE. File-level `after()` restaura el `_originalFetch` capturado como segunda red. Suite global mantiene 777 pass / 0 fail (sin regresión en tests posteriores). |
| T-27-03 | Denial of Service (timeouts en stubs faltantes) | **accept** | Leak guard hace throw síncrono — sin retry, sin timeout. Wall-time del file: 120ms (target <1500ms). |
| T-27-04 | Repudiation (asimetría oculta) | **mitigate** | Estructura `for-of describe` garantiza 7×2=14 casos por construcción. Zero `it()` top-level (grep verifica). Si alguien añade un `it()` solo en un provider, el conteo deja de ser derivado y el code review lo detecta. |
| T-27-05 | Spoofing (fixtures compartidos) | **accept** | Per-provider fixtures (plane-workitem.json para Plane, issue.json para GitHub). El matrix valida convergencia del OUTPUT (TaskItem), NO uniformidad del INPUT. |
| T-27-06 | Elevation of Privilege (side-effects en factories) | **accept** | `createPlaneProvider` y `createGitHubProvider` son factories puras — no escriben archivos, no mutan env. El único side-effect intencional es `globalThis.fetch` (cubierto por T-27-02). |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] stubPlaneFetch usó `String.includes` shadowing `/projects/` over `/work-items/`**

- **Found during:** GREEN attempt 1 (primera ejecución del test tras escribir el archivo).
- **Issue:** `path.includes('/projects/')` matchea contra `/api/v1/workspaces/test/projects/{uuid}/work-items/` — el route handler de `/projects/` (que retorna `listProjects` payload) shadow-shadowed el handler de `/work-items/` (que retorna el work-item fixture). Consecuencia: `getWorkItemBySequence(projectId, 42)` recibía un payload de proyectos en lugar de work-items, `results.find(item => item.sequence_id === 42)` retornaba `undefined`, y `getTask('KL-42')` lanzaba `Work item KL-42 not found`. Falló 1/14 test.
- **Fix:** Cambiado el matching de `path.endsWith(suffix) || path.includes(suffix)` a **solo `path.endsWith(suffix)`**. Los 5 endpoints stubbeados (`/projects/`, `/labels/`, `/states/`, `/modules/`, `/work-items/`) terminan con suffixes distintos, así que `endsWith` es estricto y unívoco. Documented inline con comment explicando el shadow.
- **Files modified:** `test/providers/contract.test.js` (single line of logic + 3-line comment).
- **Verification:** GREEN attempt 2 → 14/14 pass.
- **Committed in:** `efc3ad1`.

**2. [Rule 1 - Bug] Write tool con path absoluto cwd-drift desde worktree → main repo (filesystem-level)**

- **Found during:** GREEN attempt 1 (al ejecutar `node --test`, error `Could not find 'test/providers/contract.test.js'`).
- **Issue:** El `Write` tool inicial recibió un path relativo que se resolvió contra el cwd de la herramienta — el archivo terminó en `/Users/alex/dev/klab/kodo/test/providers/contract.test.js` (main repo), NO en el worktree. Exactamente el caso descrito en la directiva `<absolute-path-safety>` del agente.
- **Fix:** Movido el archivo via `cp` + `rm` desde el path del main repo al path correcto del worktree (`/Users/alex/dev/klab/kodo/.claude/worktrees/agent-a4b7fbab553a13ea9/test/providers/contract.test.js`). El main repo queda intacto (cero archivos untracked allí). Subsiguientes `Edit` calls usaron path absoluto derivado de `git rev-parse --show-toplevel`.
- **Files modified:** Filesystem only — el contenido del archivo era el correcto, sólo se reubicó.
- **Verification:** `git status` en el main repo limpio; `wc -l test/providers/contract.test.js` desde el worktree retorna 448.
- **Committed in:** `efc3ad1` (commit final, ya en el path correcto del worktree).

### Plan Adjustments Honored

- **W-1 (subset check):** El plan ofrecía dos opciones — "exactly 11 canonical fields" (D-18 strict) o "keys ⊆ CANONICAL set" (subset). Optado por **subset check** porque (a) mantiene fail-loud sobre key leaks (cualquier campo no-canonical revienta), (b) tolera roll-forward si en v0.8+ se añade un campo canonical legítimo sin romper la matriz, (c) es lo recomendado por el plan-checker iter 1. La verificación empírica confirma que AMBOS providers emiten exactamente 11 keys hoy (Plane via `state: workItem.state_detail?.name || … || undefined` — la key existe aunque el valor sea undefined; GitHub via `state: issue.state` literal).
- **W-2 (grep robusto):** AC#11 usa `grep -c 'providerName'` en lugar del template-literal escape frágil que estaba en el plan original (`grep -cE "\[\$\{providerName\}\]"`). Retornó 33 occurrences (target ≥ 7).

## Files Created

| File | LOC | Purpose |
|------|-----|---------|
| `test/providers/contract.test.js` | 448 | Matrix runner — itera `['plane','github']` × 7 asserts core; helpers inline (`assertTaskItemShape`, `makeFakeGitHubClient`, `stubPlaneFetch`, `instantiateProvider`, `getValidRef`, `getInvalidRef`); file-level live-fetch leak guard; `CANONICAL_TASK_ITEM_KEYS` frozen array (11 fields). |

## Files Modified

None.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `efc3ad1` | test | add cross-provider contract matrix (TEST-03) |

## Self-Check: PASSED

- File `test/providers/contract.test.js` exists at `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-a4b7fbab553a13ea9/test/providers/contract.test.js` — verified via `wc -l` → 448 lines.
- Commit `efc3ad1` exists in `git log` — verified via `git log -1 --format="%h %s"`.
- 14 new tests pass — verified via `node --test test/providers/contract.test.js | grep "^ℹ pass"` → `ℹ pass 14`.
- Suite global at 777 pass / 0 fail / 1 skipped — verified via `npm test | grep "^ℹ"`.
- Zero src/** modifications — verified via `git diff --name-only HEAD~1 HEAD -- 'src/**'` → empty.
- Zero modifications to existing tests — verified via `git diff --name-only HEAD~1 HEAD -- 'test/plane-provider.test.js' 'test/providers/github/**'` → empty.

## EXECUTION COMPLETE
