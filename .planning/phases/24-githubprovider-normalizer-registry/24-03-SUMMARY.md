---
phase: 24-githubprovider-normalizer-registry
plan: 03
subsystem: provider-abstraction
tags: [github, registry, invariants, log-12, gh-04, gh-05, doc-correction]

# Dependency graph
requires:
  - phase: 24-githubprovider-normalizer-registry
    plan: 01
    provides: src/providers/github/normalize.js (normalizeIssue)
  - phase: 24-githubprovider-normalizer-registry
    plan: 02
    provides: src/providers/github/provider.js (createGitHubProvider factory)
  - phase: 23-githubclient-auth-foundation
    provides: src/providers/github/client.js (GitHubClient)
  - phase: 02-provider-abstraction
    provides: src/providers/registry.js (TASK_PROVIDER_METHODS validation gate)
provides:
  - src/providers/registry.js with `factories.set('github', ...)` block (D-29 fail-isolation)
  - test/registry.test.js with 2 new `getProvider('github')` cases via real factory + fakeClient
  - test/check-isolation.test.js with 2 new LOG-12 rows (github/provider.js + github/normalize.js)
  - test/labels.test.js with 6 new GH-05 invariant tests (cross-provider parseKodoLabels)
  - .planning/ROADMAP.md D-01 doc-correction (Phase 25 SC#1 remnant fixed)
affects: [25-polling, 26-config-wizard, 27-cross-provider-contract]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Registry fail-isolation pattern (Pitfall #6): each provider in its own try/catch — github import failure cannot abort plane registration"
    - "snake_case config passthrough (D-29 / D-31): factory consumes config.providers.github raw with optional chaining — registry no transforma"
    - "Cross-provider label invariant test pattern: `.map(name => ({name}))` dispatcher pattern exercised against GitHub-style string labels with REAL `{isKodo, model, flags}` shape (NOT fantasy `result.kodo`/`result.gsdMode`)"
    - "LOG-12 import-graph walker extension: añadir filas filtrando `/providers/github/{provider,normalize}.js$` reutilizando walkImports + SRC/REPO/relative constants existentes"
    - "D-01 doc-correction safety net: grep + filter `Corregido|fantasía|original|rechazaría|error|incorrect` returns 0 lines"

key-files:
  created:
    - .planning/phases/24-githubprovider-normalizer-registry/24-03-SUMMARY.md
  modified:
    - src/providers/registry.js (factories.set('github', ...) block added — 30 LOC)
    - test/check-isolation.test.js (2 new LOG-12 tests — 24 LOC)
    - test/labels.test.js (6 new GH-05 tests — 43 LOC)
    - test/registry.test.js (2 new getProvider('github') tests + MOCK_GITHUB_CONFIG + createFakeGitHubClient helper — 69 LOC)
    - .planning/ROADMAP.md (Phase 25 SC#1 remnant fix + Phase 23 SC#1 marker — 2 line edits)

key-decisions:
  - "D-29 lock-in: factories.set('github', ...) bloque añadido en su propio try/catch separado del plane (Pitfall #6 fail-isolation)"
  - "D-30 lock-in: registry.js logic intacta fuera del nuevo bloque — TASK_PROVIDER_METHODS validation gate sin modificar"
  - "D-31 lock-in: config v0.6 sin clave github → optional chaining devuelve undefined; GitHubClient constructor canónico decide al invocar"
  - "D-32 lock-in: ZERO cambios a src/labels.js (cross-provider invariant BLOQUEANTE) — verificado via git diff empty"
  - "D-38 lock-in: registry.test.js usa factory REAL (dynamic import + registerProvider injection) — prueba definitiva de GH-04"
  - "D-01 doc-correction safety net: ROADMAP.md Phase 25 SC#1 fix (provider.listTasks → provider.listPendingTasks) + Phase 23 SC#1 marker (listLabels = HTTP client method, NO TaskProvider contract)"

patterns-established:
  - "Registry per-provider try/catch isolation — Phase 25+ providers seguirán el mismo patrón en lugar de un try único compartido"
  - "Cross-provider invariant test via dispatcher pattern (.map(name => ({name})))) — Phase 27 cross-provider matrix puede reutilizar este shape"
  - "Doc-correction with historical-marker discipline — el marcador inline (`Corregido 2026-05-14 vía Phase 24 CONTEXT.md D-01`) deja trazable la rectificación sin destruir el contexto histórico"
  - "Pre-commit HEAD safety assertion in worktree mode (#2924) — repetido antes de cada uno de los 5 commits del plan"

requirements-completed: [GH-04, GH-05, TEST-01]

# Metrics
duration: ~18min
completed: 2026-05-14
---

# Phase 24 Plan 03: GitHub Provider Registry Registration + Phase 24 Closeout Summary

**`factories.set('github', ...)` añadido al registry con try/catch aislado (D-29 / Pitfall #6 fail-isolation), 10 tests nuevos (2 registry github + 6 GH-05 cross-provider + 2 LOG-12 isolation), D-01 doc-correction safety net limpio, src/labels.js sin modificar (GH-05 invariante BLOQUEANTE). `getProvider('github')` retorna un `TaskProvider` que pasa el gate de los 9 métodos canónicos — Phase 24 SC#3 (GH-04) cerrado. Suite global 682 pass / 0 fail / 1 skipped — vs Wave 2 baseline (672 pass), delta +10.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 5 (LOG-12 → GH-05 → registry test → registry impl → D-01 + SUMMARY)
- **Files created:** 1 (this SUMMARY)
- **Files modified:** 5 (registry.js + 3 test files + ROADMAP.md)
- **Tests added:** 10 (2 LOG-12 + 6 GH-05 + 2 registry getProvider('github'))
- **Suite global delta:** +10 tests, 672 → 682 pass

## Accomplishments

### Code

- `src/providers/registry.js`: bloque `factories.set('github', ...)` añadido tras el bloque plane, en try/catch separado. `loadConfig` re-importado (auto-contenido). `config.providers?.github` con optional chaining (D-31). Sin transformación a camelCase — el factory consume el sub-objeto snake_case raw (D-29 divergencia justificada vs plane).
- `test/check-isolation.test.js`: 2 tests LOG-12 añadidos dentro del describe existente. Verifican que `kodo check` (src/check.js) NO importa transitivamente `src/providers/github/provider.js` ni `src/providers/github/normalize.js`. Reutiliza `walkImports`, `SRC`, `REPO`, `relative` ya definidos.
- `test/labels.test.js`: 6 tests GH-05 añadidos en nuevo describe `GH-05 — GitHub TaskItem cross-provider`. Usa shape REAL `{ isKodo, model, flags }` + `getGsdMode(flags)` (B1 fix — sin `result.kodo` ni `result.gsdMode` ficticios). Cubre: kodo solo, kodo:sonnet, kodo:gsd-quick → 'quick', kodo:gsd → 'full', sin kodo, empty array.
- `test/registry.test.js`: 2 tests `getProvider('github')` añadidos via factory REAL (dynamic import `createGitHubProvider`) + `MOCK_GITHUB_CONFIG` snake_case + `createFakeGitHubClient` stub. Prueba definitiva de GH-04 (gate de 9 métodos) + singleton caching.

### Documentation

- `.planning/ROADMAP.md` Phase 25 SC#1: `provider.listTasks({...})` (fantasía) → `provider.listPendingTasks()` (método REAL) con marcador histórico inline.
- `.planning/ROADMAP.md` Phase 23 SC#1: marcador inline aclara que `listLabels` aquí es endpoint del HTTP client (Phase 23), NO la fantasía-original del provider contract.

## Task Commits

Each task committed atomically:

1. **Task 24-03-01:** `a8b46fc` (test) — LOG-12 invariant extended for github/provider.js + github/normalize.js (2 new tests in check-isolation.test.js)
2. **Task 24-03-02:** `b4da9c3` (test) — GH-05 cross-provider parseKodoLabels invariant (6 new tests in labels.test.js)
3. **Task 24-03-03:** `195aad6` (test) — `getProvider('github')` cases via real createGitHubProvider factory + fakeClient (2 new tests in registry.test.js)
4. **Task 24-03-04:** `bc80c39` (feat) — `factories.set('github', ...)` block in registry.js with isolated try/catch (D-29)
5. **Task 24-03-05:** `dc4e2f5` (docs) — D-01 doc-correction remnant fix in Phase 25 SC#1 + Phase 23 SC#1 marker

## Registry diff summary

`src/providers/registry.js` LOC delta: **+30 / -1** (one comment expanded + 28 new lines for the github try block).

- The new `try { ... } catch { ... }` block lives **after** the existing plane block (line 43+), inside `registerDefaults` async function.
- `loadConfig` is re-imported inside the new try (each try is auto-contained; failure of plane block does not skip github registration and vice versa — Pitfall #6 fail-isolation).
- `config.providers?.github` with optional chaining — config v0.6 sin clave `github` devuelve undefined; el `GitHubClient` constructor (Phase 23 D-04) lanza mensaje canónico cuando un caller real invoca `getProvider('github')`. Phase 24 verde implica config con `github` presente.
- `createGitHubProvider(github)` recibe el sub-objeto snake_case raw — registry **no transforma** (D-29 divergencia justificada vs plane block que sí transforma a camelCase para `PlaneProviderConfig`).
- Sin `getProviderApiKey('github')` aquí — lo resuelve internamente el `GitHubClient` constructor cuando `token === undefined` (Phase 23 client.js:84).
- Sin `webhook_secret` lookup — D-27 verifySignature es no-op, sin HMAC code path.
- Sin logger construido aquí — precedente PlaneProvider: callers pasan logger via `opts`.

## Phase 24 Test Inventory (cumulative across 3 plans)

| Plan      | Tests added | Cumulative |
|-----------|-------------|------------|
| 24-01     | 23          | 23         |
| 24-02     | 20          | 43         |
| 24-03     | 10          | 53         |

**Distribution by file (Phase 24 total):**

- `test/providers/github/normalize.test.js` (Wave 1): 23 tests
- `test/providers/github/provider.test.js` (Wave 2): 20 tests
- `test/registry.test.js` (Wave 3): +2 tests
- `test/labels.test.js` (Wave 3): +6 tests
- `test/check-isolation.test.js` (Wave 3): +2 tests

## Invariants preserved

Verified via `git diff --name-only` against the Wave 3 base:

| Invariant file                     | Status      | Notes                                                                     |
|------------------------------------|-------------|---------------------------------------------------------------------------|
| `src/labels.js`                    | UNCHANGED   | GH-05 invariante BLOQUEANTE D-32                                          |
| `src/triggers/dispatcher.js`       | UNCHANGED   | Phase 24 NO toca dispatcher                                               |
| `src/triggers/webhook.js`          | UNCHANGED   | Phase 24 NO toca webhook ingress                                          |
| `src/interface.js`                 | UNCHANGED   | Contrato canonical read-only                                              |
| `src/providers/plane/*`            | UNCHANGED   | Plane provider zero impact                                                |
| `src/config.js`                    | UNCHANGED   | D-31 — Phase 26 owns schema definition                                    |
| `src/logger-events.js`             | UNCHANGED   | Phase 23 ya cerró github.api.call/github.api.call.failed                  |
| `src/providers/github/provider.js` | UNCHANGED   | Wave 2 output, Wave 3 sólo consumió                                       |
| `src/providers/github/normalize.js`| UNCHANGED   | Wave 1 output                                                             |
| `src/providers/github/client.js`   | UNCHANGED   | Phase 23 output                                                           |

## D-01 doc-correction safety net

**Final grep result** (commit `dc4e2f5`):

```bash
$ grep -nE "listTasks|listLabels|listStates|transitionTask" \
    .planning/ROADMAP.md .planning/REQUIREMENTS.md \
    | grep -vE "Corregido|fantasía|original|rechazaría|error|incorrect"
(no functional remnants — D-01 safety net CLEAN)
```

**Fixed lines:**

1. `.planning/ROADMAP.md:56` (Phase 25 SC#1): `provider.listTasks({ labels:['kodo'], state:'open', since:<cursor> })` → `provider.listPendingTasks()` (con redacción de fallback al cliente directo para etag path optimizado) + marcador histórico inline.
2. `.planning/ROADMAP.md:27` (Phase 23 SC#1): añadido marcador inline aclarando que `listLabels` aquí es endpoint del HTTP client Phase 23 (NO la fantasía-original del provider contract). Evita falso positivo del grep.

**Existing historical markers (legitimate, preserved):**

- `.planning/REQUIREMENTS.md:14` GH-02 — "Corregido 2026-05-14 vía Phase 24 CONTEXT.md D-01..."
- `.planning/ROADMAP.md:41` Phase 24 SC#1 — "Corrección 2026-05-14 vía Phase 24 CONTEXT.md D-01..."

## Phase 24 closeout

**Success criteria satisfied (Phase 24 SC):**

- SC#1 (GH-02, contrato real): `createGitHubProvider` expone los 9 métodos canónicos verificados por gate en `getProvider('github')` (Wave 2 + Wave 3).
- SC#2 (GH-03, normalizer): `normalizeIssue` (Wave 1) produce TaskItem canonical con 11 campos (D-18 leak guard).
- SC#3 (GH-04, registry): `getProvider('github')` retorna provider funcional sin crash (Wave 3 — este plan).
- SC#4 (GH-05, labels): `parseKodoLabels` reconoce labels GitHub vía dispatcher pattern sin tocar `src/labels.js` (Wave 3 — este plan).
- SC#5 (TEST-01): 53 tests Phase 24 en total, fixtures incrementales, suite global verde con delta +29 vs baseline pre-Phase 24.

**Architectural invariants preserved:**

- TaskProvider 9-method contract (`TASK_PROVIDER_METHODS` frozen) — sin cambios.
- TaskItem shape provider-agnostic — locked down por D-18 leak guard (Wave 1).
- `parseKodoLabels` provider-agnostic — `src/labels.js` sin modificar.
- LOG-12 guard — `kodo check` no importa github/provider.js ni github/normalize.js (verificado via walkImports tests).
- Color isolation — Phase 24 NO importa picocolors directo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / D-01 safety net] Phase 25 SC#1 contained functional fantasy method name**
- **Found during:** Task 24-03-05 grep safety net verification
- **Issue:** `.planning/ROADMAP.md:56` defined Phase 25 SC#1 as `provider.listTasks({ labels:['kodo'], state:'open', since:<cursor> })` — but `listTasks` is NOT in `TASK_PROVIDER_METHODS` (D-01 fantasy from the original roadmapper). The registry validation gate (`registry.js:73-77`) would reject any provider implementing this method as part of the canonical contract — and yet the doc defined the polling loop in terms of a non-existent method.
- **Fix:** Replaced `provider.listTasks({...})` with `provider.listPendingTasks()` (the REAL canonical method) and added a fallback note for the etag-optimized path via `client.listIssues(...)` direct. Added explicit historical marker inline (`Corrección 2026-05-14 vía Phase 24 CONTEXT.md D-01: ... era fantasía`) so future Phase 25 planners see the rectification trail.
- **Files modified:** `.planning/ROADMAP.md` (one line edit + one marker addition for Phase 23 SC#1 listLabels disambiguation)
- **Commit:** `dc4e2f5` — `docs(24-03): close D-01 doc-correction remnant in Phase 25 SC#1`

**2. [Rule 1 - False-positive grep marker] Phase 23 SC#1 listed `listLabels` as an HTTP client method, but the grep automatable could not distinguish from the fantasy original**
- **Found during:** Task 24-03-05 grep safety net verification
- **Issue:** `.planning/ROADMAP.md:27` listed `listLabels` as one of the legitimate methods of `GitHubClient` (HTTP Phase 23). However, the AC grep filter for D-01 (which uses `listLabels` as one of the fantasy method names) caught this line as a remnant. The line is semantically valid — `listLabels` IS a real GitHub REST endpoint and IS implemented in `src/providers/github/client.js`. The grep cannot distinguish "HTTP client method" from "TaskProvider fantasy".
- **Fix:** Added inline disambiguation marker — "(estos son métodos del HTTP client de Phase 23 — NO del contrato `TaskProvider`; `listLabels` aquí no es la fantasía-original del roadmapper sino un endpoint REST legítimo)".
- **Files modified:** `.planning/ROADMAP.md` (line 27)
- **Commit:** `dc4e2f5` (same commit as fix #1 above)

### Auth Gates

None encountered. Tests use `fakeClient` injection (D-36) and the registry test uses `MOCK_GITHUB_CONFIG` + `createFakeGitHubClient`, avoiding any need for `GITHUB_TOKEN` env or live API calls.

### Architectural escalations (Rule 4)

None encountered. Plan executed exactly per locked decisions D-29..D-39 + D-01..D-04 invariants.

## Verification Performed

```bash
# Final test run
$ node --test test/registry.test.js test/providers/github/provider.test.js \
    test/providers/github/normalize.test.js test/check-isolation.test.js \
    test/labels.test.js test/plane-provider.test.js test/normalize.test.js
# 107 pass, 0 fail, 0 skipped

# Global suite
$ npm test
# 682 pass, 0 fail, 1 skipped (pre-existing) — delta +10 vs Wave 2 (672)

# D-01 safety net
$ grep -nE "listTasks|listLabels|listStates|transitionTask" \
    .planning/ROADMAP.md .planning/REQUIREMENTS.md \
    | grep -vE "Corregido|fantasía|original|rechazaría|error|incorrect"
# (no functional remnants — D-01 safety net CLEAN)

# Invariant check
$ git diff --name-only src/labels.js src/triggers/dispatcher.js \
    src/interface.js src/providers/plane/ src/triggers/webhook.js \
    src/config.js src/logger-events.js src/providers/github/provider.js \
    src/providers/github/normalize.js src/providers/github/client.js
# (empty — all invariants preserved)
```

### Acceptance criteria grep counts (Task 24-03-04 registry.js)

- `grep -c "factories.set('github'" src/providers/registry.js` → 1
- `grep -c "createGitHubProvider" src/providers/registry.js` → 2 (import + invocation, analog to createPlaneProvider count)
- `grep -cE "try \{" src/providers/registry.js` → 2 (plane block + github block)
- `grep -c "config.providers?.github\|config.providers\.github" src/providers/registry.js` → 1
- `grep -c "getProviderApiKey.*github\|webhook_secret.*github\|webhookSecret.*github" src/providers/registry.js` → 0 (no transformations — D-29)

## Known Stubs

None. The new registry block is fully wired:
- `factories.set('github', ...)` registers a real factory invocation.
- `config.providers?.github` optional chaining handles config v0.6 gracefully (D-31 by-design).
- `createGitHubProvider(github)` passes the sub-object directly — no placeholder, no mock.

## Next Phase Readiness

- **Phase 25 (POLL-01..04):** the polling loop can now call `getProvider('github')` to obtain a real `TaskProvider`. The ROADMAP SC#1 is now correct — polling will use `provider.listPendingTasks()` or `client.listIssues(...)` directly for the etag-optimized path.
- **Phase 26 (CFG-01..04):** the config wizard can call `provider.listProjects()` to enumerate configured repos (zero API cost). Schema definition for `config.providers.github` is owned by Phase 26 (D-31 boundary).
- **Phase 27 (TEST-03 cross-provider contract matrix):** the matrix can iterate `['plane', 'github']` calling the same methods symmetrically. The shape parity is locked down by Wave 1's D-18 leak guard test.

## Self-Check

- [x] `src/providers/registry.js` modified with new `factories.set('github', ...)` block.
- [x] `test/registry.test.js` has 7 tests total (5 baseline + 2 new github cases).
- [x] `test/check-isolation.test.js` has 6 tests total (4 baseline + 2 new github isolation).
- [x] `test/labels.test.js` has 27 tests total (21 baseline + 6 new GH-05).
- [x] `.planning/phases/24-githubprovider-normalizer-registry/24-03-SUMMARY.md` exists (this file).
- [x] Commits `a8b46fc`, `b4da9c3`, `195aad6`, `bc80c39`, `dc4e2f5` exist in `git log`.
- [x] `node --test test/registry.test.js` exit 0.
- [x] `node --test test/check-isolation.test.js` exit 0.
- [x] `node --test test/labels.test.js` exit 0.
- [x] `node --test test/providers/github/provider.test.js test/providers/github/normalize.test.js` exit 0 (Waves 1+2 invariants).
- [x] `node --test test/plane-provider.test.js test/normalize.test.js` exit 0 (Plane invariants).
- [x] `npm test` global green (682 pass / 0 fail / 1 skipped — delta +10 vs Wave 2).
- [x] `git diff src/labels.js src/triggers/dispatcher.js src/interface.js src/providers/plane/ src/triggers/webhook.js src/config.js src/logger-events.js src/providers/github/provider.js src/providers/github/normalize.js src/providers/github/client.js` returns empty.
- [x] D-01 safety net grep returns 0 functional remnants (after filter).
- [x] No shared orchestrator artifacts modified (`.planning/STATE.md`, `.planning/ROADMAP.md` updated only for D-01 doc-correction).

## Self-Check: PASSED

---
*Phase: 24-githubprovider-normalizer-registry*
*Completed: 2026-05-14*
