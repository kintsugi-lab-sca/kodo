---
phase: 25
plan: 01
subsystem: logger-events
tags:
  - logger-events
  - ndjson-taxonomy
  - polling
requirements:
  - TEST-02
requirements_addressed:
  - TEST-02
dependency_graph:
  requires: []
  provides:
    - "POLLING_TICK / POLLING_DISPATCH / POLLING_ERROR entries in EVENTS frozen object"
    - "pollingTick(logger, fields) helper — info level"
    - "pollingDispatch(logger, fields) helper — info level, T-25-02 whitelist"
    - "pollingError(logger, fields) helper — warn level"
  affects:
    - "Plan 25-02 (src/triggers/polling.js) — direct consumer via static import"
    - "kodo logs CLI — surfaces new event types in NDJSON tail"
tech_stack:
  added: []
  patterns:
    - "Phase 23 githubApiCall/githubApiCallFailed shape (level switch by field, JSDoc typedef, return-less side-effect)"
    - "Truthy-spread for optional payload keys: ...(fields.first_tick ? { first_tick: true } : {})"
    - "Whitelist-only payload (T-25-02): helper takes exactly the documented fields; caller-supplied extras silently dropped"
key_files:
  created: []
  modified:
    - src/logger-events.js
    - test/logger-events.test.js
decisions:
  - "Updated the existing 'EVENTS is frozen and contains the 15 canonical types' contract test inside Task 1 (15 → 18) instead of Task 2. The plan's verify command for Task 1 (node --test test/logger-events.test.js) would otherwise red-fail post-edit, breaking the per-task atomic commit contract. The 6 behavioral helper tests still land in Task 2 as planned."
  - "Reformulated T-25-02 documentation comments to omit the literal tokens 'issue.body' / 'issue.title' / 'fields.raw' so the source-level grep guard (grep -cE 'issue.body|issue.title|fields.raw' src/logger-events.js == 0) holds without exception. The invariant is now expressed in prose ('contenido de usuario — body, título, raw object') with identical semantic intent."
metrics:
  duration_min: 12
  completed_date: 2026-05-14
  commits: 2
  files_modified: 2
  files_created: 0
  lines_added: 244
  lines_removed: 5
  tests_added: 6
  tests_total_after: 29
---

# Phase 25 Plan 01: Logger Events Extension — Summary

NDJSON closed-taxonomy ampliada con tres eventos de ciclo de polling (`polling.tick`, `polling.dispatch`, `polling.error`) y sus helpers tipados, espejando verbatim el patrón Phase 23 (`githubApiCall`/`githubApiCallFailed`). Wave 0 de la phase queda lista: Plan 25-02 puede ahora hacer `import { EVENTS, pollingTick, pollingDispatch, pollingError } from '../logger-events.js'` sin Wave-0-MISSING.

## What Was Built

### Production (`src/logger-events.js`, +113 LOC)

1. **Header inventory + comment header** (lines 1-19): contador actualizado de "15 eventos" → "18 eventos"; añadida la cita "Phase 25 (polling trigger channel)" y los 3 nuevos literales (`polling.tick`, `polling.dispatch`, `polling.error`) al inventario en prosa.

2. **JSDoc typedef + frozen object** (lines 24-67): 3 nuevas keys añadidas en el orden post-`GITHUB_API_CALL_FAILED`, con alineación visual respetada (colón + 11 espacios). `EVENTS` sigue siendo el resultado de `Object.freeze({...})` — el invariante `Object.isFrozen(EVENTS) === true` está cubierto por test.

3. **Tres helpers exportados** (lines 375-485), espejando el shape Phase 23:
   - `pollingTick(logger, {owner, repo, status, dispatched, first_tick?})` → `logger.info`
   - `pollingDispatch(logger, {owner, repo, ref, pattern})` → `logger.info` — **whitelist estricta**
   - `pollingError(logger, {owner, repo, status, attempt, error?})` → `logger.warn`

   Cada helper lleva JSDoc completo con typedef inline; los campos opcionales se incluyen vía truthy-spread (`...(fields.first_tick ? { first_tick: true } : {})`), lo que evita emitir `key: undefined` y mantiene la línea NDJSON minimal.

### Tests (`test/logger-events.test.js`, +131 LOC)

1. **Bloque de import dinámico** ampliado con `pollingTick`, `pollingDispatch`, `pollingError` (líneas 28-49).

2. **Contract test del array** ampliado de 15 a 18 entradas en orden lexicográfico (`polling.dispatch`, `polling.error`, `polling.tick` insertados entre `plane.api.call.failed` y `session.end`). Título del `describe` ampliado con "+ Phase 25 polling trigger channel". Título del `it` ampliado a "18 canonical types".

3. **6 nuevos tests `it(...)`** al final del describe — uno por contrato observable:

   | # | Test | Cubre |
   |---|------|-------|
   | 1 | `pollingTick emits event=polling.tick at info level with {owner, repo, status, dispatched}` | shape + level + ausencia de `first_tick` cuando no se pasa |
   | 2 | `pollingTick includes first_tick:true when set; omits the key otherwise` | truthy-spread guard explícito |
   | 3 | `pollingDispatch emits event=polling.dispatch at info level with {owner, repo, ref, pattern}` | shape + level |
   | 4 | `pollingDispatch does NOT leak user content (T-25-02 invariant: whitelist-only payload)` | **invariante de seguridad** — pasa campos hostiles (`issueBody`, `title`, `raw`, `body`) y asserta que ninguno aparece en la línea NDJSON |
   | 5 | `pollingError emits event=polling.error at warn level with {owner, repo, status, attempt}` | warn level + shape + ausencia de `error` cuando no se pasa |
   | 6 | `pollingError includes error field only when provided` | truthy-spread guard explícito |

## Invariants Preserved

### T-25-02 (Information Disclosure — User Content in NDJSON)

**Confirmado por construcción + test.** El helper `pollingDispatch` SOLO acepta y emite los 4 campos `{owner, repo, ref, pattern}`. La firma JSDoc no menciona `issue.body`, `title` ni `raw`, y el cuerpo del helper no hace spread del input: cualquier campo extra del caller queda fuera del payload.

Verificación de código fuente (grep):
```
grep -cE "issue\.body|issue\.title|fields\.raw" src/logger-events.js
-> 0
```

Verificación de comportamiento (test #4): pasa `issueBody`, `title`, `raw`, `body` en el `fields` del caller; el `for (forbidden of ['issueBody', 'title', 'raw', 'body']) assert.equal(forbidden in line, false)` falla con mensaje explícito si en producción se añadiese accidentalmente un campo como `body: fields.issueBody`.

### LOG-12 (check.js Graph Isolation — Zero New Imports)

**Confirmado.** El archivo `src/logger-events.js` sigue importando solo `node:os` + `node:path` (stdlib):
```
grep -cE "^import " src/logger-events.js
-> 2
```

No se añadió ningún import nuevo. Los 3 helpers son funciones puras que delegan en `logger.info` / `logger.warn` del logger inyectado por el caller.

### Closed Taxonomy

**Confirmado.** `Object.isFrozen(EVENTS) === true` se mantiene tras la extensión:
```
node -e "(async()=>{const m=await import('./src/logger-events.js'); console.log(Object.isFrozen(m.EVENTS), Object.values(m.EVENTS).length);})()"
-> true 18
```

## Verification Results

| Gate | Command | Result |
|------|---------|--------|
| Syntax | `node --check src/logger-events.js` | exit 0 |
| Runtime imports | `node -e "(await import('./src/logger-events.js')).pollingTick/Dispatch/Error"` | all 3 are `function` |
| Plan-level tests | `node --test test/logger-events.test.js` | 29 pass, 0 fail (baseline 23 + 6 new) |
| Full suite | `npm test` | 688 pass, 1 skipped, 0 fail (zero regressions) |
| T-25-02 source | `grep -cE "issue\\.body\|issue\\.title\|fields\\.raw" src/logger-events.js` | 0 |
| LOG-12 source | `grep -cE "^import " src/logger-events.js` | 2 |
| Helper exports | `grep -cE "^export function polling" src/logger-events.js` | 3 |
| Test coverage | `grep -cE "pollingTick\|pollingDispatch\|pollingError" test/logger-events.test.js` | 18 (≥ 9) |

## Commits

| # | Hash | Type | Message |
|---|------|------|---------|
| 1 | `b5eaba9` | feat | `feat(25-01): extend closed event taxonomy with polling.tick/dispatch/error` |
| 2 | `0d1ccf8` | test | `test(25-01): add 6 contract tests for pollingTick/Dispatch/Error helpers` |

## Deviations from Plan

### [Rule 3 — Blocking issue] Worktree was 50 commits behind `main`

- **Found during:** Task 1, before first edit
- **Issue:** The Claude Code worktree (`agent-a5c07f1edb5686588`) was created against an older commit on the timeline — its `src/logger-events.js` had only 13 events (pre-Phase-23). The plan was authored against post-Phase-23 `main` (15 events). Applying the plan verbatim would have generated a divergent baseline (e.g., 16 entries instead of 18) and a non-replayable commit graph relative to `main`.
- **Fix:** `git rebase main` inside the worktree before any edit. After the rebase, the worktree HEAD was aligned with the post-Phase-23 baseline (15 events, 23 tests), exactly matching the plan's `<interfaces>` snapshot.
- **Files modified:** none — purely a git history alignment.

### [Rule 2 — Missing critical scope] Task 1 needed to update the existing `15 canonical types` contract test inline

- **Found during:** Task 1, after Edit + first test run
- **Issue:** The plan assigned the contract test array (15 → 18 sorted entries) to Task 2. But Task 1's `<verify><automated>node --test test/logger-events.test.js</automated></verify>` would red-fail once `EVENTS` ships with 18 entries, breaking the per-task atomic commit contract documented in `execute-plan.md` ("each task committed individually after passing its verify"). 
- **Fix:** Updated the contract test array in the same commit as the production helpers (Task 1, commit `b5eaba9`). The 6 behavioral tests for the new helpers stayed in Task 2 (commit `0d1ccf8`) as the plan intended.
- **Files modified:** `test/logger-events.test.js` (only the `15 canonical types` test — title bumped to `18` + 3 new sorted literals added).
- **Tracked under:** decisions[0] in this Summary frontmatter.

### [Rule 2 — Missing critical scope] T-25-02 source-level grep guard required reformulating documentation comments

- **Found during:** Task 1, while running the acceptance criteria grep
- **Issue:** The plan asserts `grep -cE "issue\\.body|issue\\.title|fields\\.raw" src/logger-events.js == 0` as a source-level invariant. My initial JSDoc + section header for the new helpers used those exact literals to *document the prohibition* (e.g., "no se accede a `issue.body`, `title` ni `raw`"). The grep guard is path-agnostic — it counts string literal matches regardless of whether they appear in code or in comments — so documentation literals would have caused a false-positive guard failure.
- **Fix:** Reformulated the two comment blocks (section header + `pollingDispatch` JSDoc) to express the prohibition in prose ("contenido de usuario — body, título, raw object") without the literal tokens. Semantic intent preserved; grep guard passes (0 occurrences).
- **Files modified:** `src/logger-events.js` (only the two comment blocks).
- **Tracked under:** decisions[1] in this Summary frontmatter.

## Next-Step Consumer

**Plan 25-02** (`src/triggers/polling.js`, Wave 2) is now unblocked. It will:

```javascript
// @ts-check
import { dispatchTrigger } from './dispatcher.js';
import { EVENTS, pollingTick, pollingDispatch, pollingError } from '../logger-events.js';

// ... per-tick:
//   pollingTick(logger, { owner, repo, status: 200, dispatched: 2 });
// ... on dispatch:
//   pollingDispatch(logger, { owner, repo, ref: `${owner}/${repo}#${num}`, pattern: 'a-new' });
// ... on retryable error:
//   pollingError(logger, { owner, repo, status: 429, attempt: 2, error: 'rate limited' });
```

The static import path (`'../logger-events.js'`) is intentional for `polling.js`: it lives outside the `src/check.js` import graph (verified separately by `test/check-isolation.test.js` — Plan 25-02 will add the LOG-12 row for `triggers/polling.js`).

## Self-Check: PASSED

- `src/logger-events.js` exists and has 485 lines (was 372; +113).
- `test/logger-events.test.js` exists and has 519 lines (was 388; +131).
- `Object.values(EVENTS).length === 18` and `Object.isFrozen(EVENTS) === true` (verified via `node -e`).
- Commit `b5eaba9` exists on `worktree-agent-a5c07f1edb5686588` (`git log --oneline | grep b5eaba9` → present).
- Commit `0d1ccf8` exists on `worktree-agent-a5c07f1edb5686588` (`git log --oneline | grep 0d1ccf8` → present).
- `npm test` → 688 pass, 1 skipped, 0 fail.

## EXECUTION COMPLETE
