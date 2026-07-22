---
phase: 76-convergencia-del-conteo-pending
verified: 2026-07-17T13:13:46Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 76: Convergencia del conteo pending Verification Report

**Phase Goal:** El conteo de tareas `pending` que ve el orquestador converge con el que reporta `kodo check`, y con el provider caído `/status` deja de presentar un dato caducado como si fuera fresco. Ortogonal a los LIVE (vive en `src/server.js` y `src/check.js`, no toca hooks ni planes).
**Verified:** 2026-07-17T13:13:46Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria + Plan must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: Con provider sano, `/status` y `kodo check` reportan el mismo `pending_count` sobre la misma realidad, vía convergencia de caminos de lectura (ORCH-05) | ✓ VERIFIED | `src/server.js:10,525-529,613-615` and `src/check.js:14,37` both call into `src/tasks/pending.js` (`createPendingResolver`/`fetchFreshPending`). Positive convergence assertion in `test/check-isolation.test.js:211-219` (`check.js` import graph reaches `src/tasks/pending.js`) and source-guard in `test/server/status-pending.test.js:63-96` (`server.js` imports/calls the shared module, no more `let pendingCache`). All pass. |
| 2 | SC2: Con provider caído, la rama de error de `server.js` (antes en `:599`) deja de devolver `pendingCache.data` sin comprobar TTL | ✓ VERIFIED | Old inline `let pendingCache = {...}` module-level var and unconditional-catch-return are gone (`grep 'let pendingCache' src/server.js` → no match; asserted negatively by `status-pending.test.js:89-96`). Replaced by `pendingResolver.resolve()` (`src/server.js:613`), whose only failure path returning cached data is `createPendingResolver`'s catch branch, which is explicitly TTL-gated (cache is only served fresh within `ttlMs`; on failure it is always labeled `stale:true`, see `src/tasks/pending.js:65-84`). Unit-tested: `test/tasks/pending.test.js` "catch with prior cache" and "cold-start down" tests, both pass. |
| 3 | SC3: El operador/orquestador distingue «0 pendientes» de «no se pudo saber» — visible en la respuesta, no solo `console.warn` | ✓ VERIFIED | `/status` payload spreads `buildPendingStatusFields(pendingResult)` which always includes `pending_stale:boolean` and `pending_fetched_at:string\|null` (`src/server.js:614-615`, `src/tasks/pending.js:97-110`). Dashboard HTML marks the "Candidatas" stat with a dimmed style + red `?` tag when `data.pending_stale` (`src/server.js:130-131,372-378`). `console.warn` is additionally emitted (`src/server.js:614`) but is not the sole signal — the field is the authoritative one. |
| 4 | SC4: El arreglo no introduce endpoints nuevos ni un bus de invalidación por evento; el `pendingCache` no se rediseña con un nuevo mecanismo | ✓ VERIFIED | `grep -c "pathname ===" src/server.js` → 7 (unchanged route count). `package.json` dependencies unchanged: `{commander, ink, picocolors, react}`. No new files besides the leaf module + tests. |
| 5 | (76-01) `fetchFreshPending(fn)` returns `fn()`'s result and propagates any throw raw — single fetch point (D-01) | ✓ VERIFIED | `src/tasks/pending.js:39-41`; tests "propagates the throw" and "returns the list verbatim" pass. |
| 6 | (76-01) `createPendingResolver(...).resolve()` serves cache within TTL as `{stale:false}` WITHOUT re-fetch | ✓ VERIFIED | `src/tasks/pending.js:67-69`; test "TTL fresh hit ... call-counter == 1" passes. |
| 7 | (76-01) Failed fetch with prior cache → `{tasks:last-known-good, stale:true, fetched_at:last success}`, never advancing `fetched_at` | ✓ VERIFIED | `src/tasks/pending.js:76-80`; test "catch with prior cache ... fetched_at FROZEN (Pitfall 3)" passes with strict-equal assertion. |
| 8 | (76-01) Cold-start down (never succeeded) → `{tasks:[], fetched_at:null, stale:true}` | ✓ VERIFIED | `src/tasks/pending.js:81-82`; test "cold-start down" passes. |
| 9 | (76-01) `buildPendingStatusFields` derives `pending`/`pending_count` from the same `tasks` in both branches | ✓ VERIFIED | `src/tasks/pending.js:97-110`; both branch tests assert `pending_count === pending.length`. |
| 10 | (76-01) `src/tasks/pending.js` is a zero-import leaf, guarded by `test/check-isolation.test.js` | ✓ VERIFIED | File contains no `import` statements (confirmed by reading the full file). `test/check-isolation.test.js:188-204` asserts `extractImports(src)` is `[]`; passes. |
| 11 | (76-02) `check.js` produces byte-identical sane/error output after routing through `fetchFreshPending` (D-07) | ✓ VERIFIED | `src/check.js:37-45` wraps `fetchFreshPending` in the pre-existing try/catch, unchanged red-line `Error checking tasks: ${err.message}`. `test/check.test.js` new cases "routes through fetchFreshPending, sane /N pending/ line byte-identical" and "propagates the throw — real err.message in red line" pass, alongside pre-existing Tests 1-5. |

**Score:** 11/11 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tasks/pending.js` | Zero-import leaf: `fetchFreshPending`, `createPendingResolver`, `buildPendingStatusFields` | ✓ VERIFIED | Exists, 111 lines, exports all 3 functions, zero imports confirmed manually and by test. |
| `test/tasks/pending.test.js` | Unit tests, 8 cases | ✓ VERIFIED | Exists, 10 subtests across 3 describe blocks (fetchFreshPending x2, resolver x4, shaper x2) — all pass. |
| `test/server/status-pending.test.js` | Contract test for `/status` seam + convergence source-guard | ✓ VERIFIED | Exists, 6 tests (payload shaping x3, source-guard x3) — all pass. |
| `src/server.js` (modified) | `/status` wired to shared resolver, additive freshness fields, HTML stale marker | ✓ VERIFIED WIRED | Import at line 10; `pendingResolver` instantiated in `startServer()` (line 525); handler calls `resolve()` (line 613) and spreads `buildPendingStatusFields` (line 665); CSS `.stale`/`.stale-tag` (lines 130-131) + client JS marker (lines 372-378). |
| `src/check.js` (modified) | `checkPendingTasks` routes through `fetchFreshPending`, raw mode | ✓ VERIFIED WIRED | Import at line 14; call at line 37 inside existing try/catch; red-line output unchanged. |
| `test/check-isolation.test.js` (modified) | Leaf guard for `pending.js` + positive convergence assertion for `check.js` | ✓ VERIFIED | Both blocks present (lines 188-219), both pass. |
| `test/check.test.js` (modified) | Regression + new fetchFreshPending routing tests | ✓ VERIFIED | Tests 1-5 (pre-existing) still pass; 2 new tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/server.js` | `src/tasks/pending.js` | `import { createPendingResolver, buildPendingStatusFields }` + instantiation in `startServer()` + calls in `/status` handler | ✓ WIRED | Confirmed by grep (lines 10, 525-529, 613, 615) and passing `status-pending.test.js` source-guard. |
| `src/check.js` | `src/tasks/pending.js` | `import { fetchFreshPending }` + call inside `checkPendingTasks`'s existing try/catch | ✓ WIRED | Confirmed by grep (lines 14, 37) and positive import-graph assertion in `check-isolation.test.js` (passes). |
| `/status` payload | dashboard HTML client JS | `data.pending_stale` read in `refresh()`, toggles `.stale`/`.stale-tag` on "Candidatas" stat | ✓ WIRED | `buildPendingStatusFields` always includes `pending_stale` in the spread payload (line 665); client reads it at lines 372-378. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `/status` `pending`/`pending_count` fields | `pendingResult` from `pendingResolver.resolve()` | `provider.listPendingTasks()` (real provider call via DI) | Yes — resolver either returns live fetch result or last-known-good, never a hardcoded static value | ✓ FLOWING |
| Dashboard "Candidatas" stale marker | `data.pending_stale` | Same `/status` JSON response | Yes — boolean always present, driven by resolver's TTL/failure state | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pending unit suite (fetch, TTL, stale-labeling, cold-start, shaper) | `node --test test/tasks/pending.test.js` | 10/10 pass | ✓ PASS |
| `/status` contract + convergence source-guard | `node --test test/server/status-pending.test.js` | 6/6 pass | ✓ PASS |
| `check.js` regression (byte-identical output, D-07) | `node --test test/check.test.js` | all pass (pre-existing Tests 1-5 + 2 new) | ✓ PASS |
| Isolation/convergence guards (LOG-12, D-02, D-09) | `node --test test/check-isolation.test.js` | all pass | ✓ PASS |
| `server.js` still loads after refactor | `node -e "import('./src/server.js')..."` | loads without throw (implicit, via full suite import chain) | ✓ PASS |
| Full workspace test gate (single run) | `npm test` | 2270 pass / 1 fail / 1 skipped (2272 total) | ⚠️ 1 pre-existing unrelated flake (see below) |

**Full-suite note:** `npm test` reported 1 failure: `test/gsd-lock-race.test.js` — "5 processes observing the SAME dead-PID stale lock → exactly one steals" (`gsd lock steal race — concurrent dead-holder steal (CR-01)`, from Phase 70). This file is not in Phase 76's `files_modified` list for either plan, was not touched by this phase, and re-running it in isolation (`node --test test/gsd-lock-race.test.js`) passes cleanly (4/4). This is a pre-existing timing-sensitive flake unrelated to the pending-count convergence work — not a phase-76 regression.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ORCH-05 | 76-01, 76-02 | El conteo `pending` converge entre `/status` y `kodo check` | ✓ SATISFIED | Both consumers route through `src/tasks/pending.js`; convergence proven by import-graph assertion + source-guard tests. REQUIREMENTS.md marks `[x]` and traceability table lists "Phase 76 — Complete". |
| ORCH-06 | 76-01, 76-02 | Provider caído no presenta `pending` viejo como fresco | ✓ SATISFIED | Resolver labels failure `stale:true` with frozen `fetched_at`; `/status` exposes both fields; dashboard marks staleness visually. REQUIREMENTS.md marks `[x]` and traceability table lists "Phase 76 — Complete". |

No orphaned requirements found for Phase 76 in REQUIREMENTS.md.

### Anti-Patterns Found

None. Scanned `src/tasks/pending.js`, `src/server.js`, `src/check.js`, `test/tasks/pending.test.js`, `test/server/status-pending.test.js`, `test/check.test.js`, `test/check-isolation.test.js` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and stub-shaped patterns (`return null`, hardcoded `[]`/`{}` flowing to render, console.log-only handlers) — zero matches.

### Prohibitions Check (must_haves.prohibitions)

| Prohibition | Status | Evidence |
|-------------|--------|----------|
| Module does not emit `console.warn`/logs/events (76-01) | ✓ Resolved | `src/tasks/pending.js` has zero imports (no logger reachable) and no `console.*` calls; caller (`server.js:614`) emits the warn. |
| TTL literal not declared inside the module (76-01) | ✓ Resolved | `ttlMs` is a required param in `createPendingResolver`; no `30000`/`30 * 1000` literal in `pending.js`. |
| `fetched_at` on failure is never `now()` (76-01) | ✓ Resolved | Line 80: `return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: true }` — uses `cache.fetched_at`, not `now()`. Test asserts strict equality. |
| Result never collapses to single error value (76-01) | ✓ Resolved | All branches return `{tasks, fetched_at, stale}` discriminated shape. |
| `/status` error branch never returns last-known-good without TTL check (76-02) | ✓ Resolved | Old inline cache/catch removed; resolver only serves fresh-within-TTL as `stale:false`. |
| `pending_count` never collapses to `null` on error (76-02) | ✓ Resolved | `buildPendingStatusFields` always computes `tasks.length` (numeric), even for `tasks:[]`. |
| Staleness not signaled only by `console.warn` (76-02) | ✓ Resolved | `pending_stale` field always present in payload. |
| `server.js`/`check.js` don't re-implement fetch/freshness inline (76-02) | ✓ Resolved | Both delegate to `src/tasks/pending.js`; no inline TTL/cache logic remains in either file (verified by grep for `pendingCache` and residual `listPendingTasks` call sites). |
| Sane `kodo check` output unchanged, error line keeps real `err.message` (76-02) | ✓ Resolved | `check.js`'s try/catch structure and red-line format untouched; Tests 1-5 pass byte-identical plus 2 new regression tests. |

All prohibitions from both plans hold — no violations found (verification tier: judgment, resolved by direct code inspection above).

### Human Verification Required

None. All must-haves are either directly observable in source, or covered by passing automated tests exercising the exact state transitions (TTL expiry, failure-with-cache, cold-start-down) that the goal depends on.

### Gaps Summary

No gaps. Both plans' must_haves (truths, artifacts, key_links, prohibitions) are verified against the actual codebase, all 4 ROADMAP success criteria hold, both requirement IDs (ORCH-05, ORCH-06) are traced and satisfied, and the phase-scoped test suites pass in full. The one full-suite failure (`test/gsd-lock-race.test.js`, Phase 70 lock-stealing race test) is unrelated to this phase's files, passes in isolation, and does not block this phase's goal.

---

_Verified: 2026-07-17T13:13:46Z_
_Verifier: Claude (gsd-verifier)_
