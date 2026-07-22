# Phase 76: Convergencia del conteo `pending` - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 6 (2 new, 4 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/tasks/pending.js` (NEW) | service (pure leaf module) | request-response / transform | `src/server/provider-state.js` | exact |
| `src/server.js` (MOD — wiring + `/status`) | route/controller | request-response | `src/server.js:504-509,588-663` (self, provider_state lane) | exact |
| `src/server.js:370` (MOD — HTML stat) | component (server-rendered HTML) | transform | `src/server.js:369-374` (self, adjacent stats) | exact |
| `src/check.js` (MOD — `checkPendingTasks`) | service (CLI) | request-response | `src/check.js:29-52` (self, existing DI point) | exact |
| `test/tasks/pending.test.js` (NEW) | test (unit) | — | `test/server/provider-state.test.js` | exact |
| `test/server/status-pending.test.js` (NEW) | test (contract) | — | `test/server/provider-state.test.js` | role-match |
| `test/check-isolation.test.js` (MOD — extend guard) | test (source-hygiene) | — | `test/check-isolation.test.js:160-177` (self, handoff leaf guard) | exact |
| `test/check.test.js` (MOD — regression) | test (unit) | — | `test/check.test.js:1-56` (self) | exact |

## Pattern Assignments

### `src/tasks/pending.js` (NEW — service, pure leaf module)

**Analog:** `src/server/provider-state.js`

**Header / zero-imports contract** (provider-state.js:1-21) — the new module MUST be a leaf with ZERO imports (D-02, unlike provider-state.js which imports `logger-events`). Model the header/doc-comment style but drop the `import { providerStateFetchFailed }` line. Precedent for a true zero-import leaf: `src/session/handoff.js`.

```javascript
// @ts-check
//
// src/tasks/pending.js — Phase 76 (ORCH-05/ORCH-06).
// Pure, zero-import leaf. Fetch + TTL cache + freshness policy for the
// `pending` read lane shared by server.js (/status) and check.js.
// Zero imports so kodo check's graph stays clean (LOG-12 / check-isolation).
```

**Factory + DI + TTL + fail-open core** (provider-state.js:63-122) — mirror this factory shape exactly (closure over private cache, `now = Date.now` default, `resolve()` never throws). Key adaptations from the analog:
- Cache is a single `{ tasks, fetched_at }` slot (not a `Map` keyed by task_id — pending is a whole-list fetch, not per-session).
- Result shape is `{ tasks, fetched_at, stale }` (not `{ state, reason }`).
- Freshness is discriminated per D-04 (see below), NOT collapsed to a single fail value.

```javascript
// Mirror of provider-state.js:63-122, adapted for pending:
export function createPendingResolver({ listPendingTasksFn, ttlMs, now = Date.now }) {
  let cache = null; // { tasks, fetched_at } | null (null = never succeeded)
  async function resolve() {
    // (a) cache hit within TTL → serve as fresh
    if (cache && now() - new Date(cache.fetched_at).getTime() < ttlMs) {
      return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: false };
    }
    // (b) fresh fetch
    try {
      const tasks = await fetchFreshPending(listPendingTasksFn);
      const fetched_at = new Date(now()).toISOString();
      cache = { tasks, fetched_at };
      return { tasks, fetched_at, stale: false };
    } catch {
      // (c) ORCH-06: fail → last-known-good LABELED, fetched_at from last success
      if (cache) return { tasks: cache.tasks, fetched_at: cache.fetched_at, stale: true };
      // (d) cold-start down: never succeeded
      return { tasks: [], fetched_at: null, stale: true };
    }
  }
  return { resolve };
}
```

**Single fetch consumed in two modes** (Pattern 2 from RESEARCH, no direct analog — new): export `fetchFreshPending` separately so `check.js` consumes it raw (lets the throw propagate → red line, D-07) while the resolver wraps it (never throws, D-04).

```javascript
export async function fetchFreshPending(listPendingTasksFn) {
  return await listPendingTasksFn(); // convergence point (ORCH-05); may throw
}
```

**In-flight dedup (OPTIONAL — Claude's Discretion):** provider-state.js:66-67,90-118 shows the `inflight` Map pattern. For pending (single-slot, not keyed) it would be a single `let inflight = null` promise. Mirror only if desired; not a requirement.

**Critical constraint (Pitfall 3):** the `fetched_at` returned in the catch is ALWAYS `cache.fetched_at` (last success), NEVER `now()`. Do not let `stale:true` carry a fresh-looking timestamp.

---

### `src/server.js` — wiring in `startServer()` (MOD — route)

**Analog:** `src/server.js:504-509` (the `providerStateResolver` wiring — exact sibling pattern)

**Wiring pattern** (server.js:504-509) — add the pending resolver right beside it, same shape, reusing `PENDING_CACHE_TTL_MS` (the single literal, D-03):

```javascript
const pendingResolver = createPendingResolver({
  listPendingTasksFn: () => provider.listPendingTasks(),
  ttlMs: PENDING_CACHE_TTL_MS,   // D-03 — the only literal, no second number
  now: Date.now,
});
```

**Module-level cleanup** (server.js:20-22): remove `let pendingCache = { data: [], ts: 0 }` (moves into the resolver closure). KEEP `PENDING_CACHE_TTL_MS = 30 * 1000` as the single source of the number.

---

### `src/server.js` — `/status` handler (MOD — request-response)

**Analog:** `src/server.js:588-663` (self — the current defective block + the provider_state consumption pattern at :614-624)

**Replace the defective block** (server.js:590-601) — this is the ORCH-06 bug (`:599` serves `pendingCache.data` in the catch with no TTL check). Replace with:

```javascript
const { tasks, fetched_at, stale } = await pendingResolver.resolve();
if (stale) console.warn('[kodo] listPendingTasks stale — serving last-known-good'); // caller emits, module only returns
```

Note: the `console.warn` stays in server.js (D-02 / Pitfall 1 — the leaf module must NOT log). This mirrors how server.js:598 already owns the warn today.

**Payload — additive fields** (server.js:648-662, mirroring the `provider_state`/`provider_state_reason` additive precedent at :620-621). Derive both `pending`/`pending_count` from the SAME `tasks` (Pitfall 4). Preserve the exact task shape at :651 (Assumption A1):

```javascript
res.end(JSON.stringify({
  sessions: enriched,
  count: enriched.length,
  pending: tasks.map((t) => ({ ref: t.ref, title: t.title, url: t.url, state: t.state, projectName: t.projectName })),
  pending_count: tasks.length,
  pending_stale: stale,               // D-05 — always present
  pending_fetched_at: fetched_at,     // D-05 — ISO string | null
  history: fullHistory.slice(0, 10),
  metrics: { /* unchanged */ },
  uptime: process.uptime(),
}));
```

---

### `src/server.js:370` — HTML stat «Candidatas» (MOD — component)

**Analog:** `src/server.js:369-374` (self — the adjacent stat divs, identical string-concat template)

**Current** (server.js:370):
```javascript
'<div class="stat"><div class="stat-val">' + data.pending_count + '</div><div class="stat-label">Candidatas</div></div>' +
```

**Pattern to apply** (D-06 — minimal staleness indicator, exact styling is Claude's Discretion):
```javascript
'<div class="stat"><div class="stat-val' + (data.pending_stale ? ' stale' : '') + '">' +
  data.pending_count + (data.pending_stale ? ' <span class="stale-tag">?</span>' : '') +
'</div><div class="stat-label">Candidatas</div></div>' +
```
The `.stale`/`.stale-tag` CSS goes in the existing `<style>` block of the served HTML. TUI ink is NOT touched (verified — does not consume `pending`).

---

### `src/check.js` — `checkPendingTasks` (MOD — service, CLI)

**Analog:** `src/check.js:29-52` (self — existing DI point; the `getProviderFn`/`formatterFn` injection already exists)

**Change** (check.js:37) — swap the raw provider call for `fetchFreshPending`, consuming the fetch RAW (not the resolver) so the throw propagates and the red-line catch stays byte-identical (D-07, Pitfall 2):

```javascript
import { fetchFreshPending } from './tasks/pending.js';
// ... inside the existing try (check.js:34-49), keep try/catch verbatim:
const pending = await fetchFreshPending(() => provider.listPendingTasks()); // ORCH-05 convergence
```

The `catch (err) { ... fmt.red(`Error checking tasks: ${err.message}`) }` (check.js:45-49) stays untouched — that is the byte-identical red line D-07 protects.

---

### `test/tasks/pending.test.js` (NEW — unit)

**Analog:** `test/server/provider-state.test.js` (exact — same DI test style)

**Structure to copy** (provider-state.test.js:1-74):
- Imports: `describe, it` from `node:test`; `assert` from `node:assert/strict` (lines 13-14).
- Mock provider with a spy + call counter (lines 35-48) — adapt `makeProvider` so its spied method is `listPendingTasks` returning an array (or throwing).
- Controllable `now` injected as `() => 1000` for deterministic TTL (lines 60, 70) — advance it to test TTL expiry without real timers.

**Cases required (D-08, from RESEARCH Test Map):**
- TTL fresh hit → `stale:false`, no second fetch (call counter stays 1).
- TTL expired → re-fetches.
- catch with cache → `{ last-known-good, stale:true, fetched_at === previous success }` (assert `fetched_at` did NOT advance — Pitfall 3).
- cold-start down → `{ tasks:[], fetched_at:null, stale:true }`.
- `fetchFreshPending` propagates the throw (raw mode).

---

### `test/server/status-pending.test.js` (NEW — contract)

**Analog:** `test/server/provider-state.test.js` (role-match — same dir/framework)

Contract test: `pending_stale` and `pending_fetched_at` present in BOTH branches (fresh + stale); assert `payload.pending_count === payload.pending.length` in both (Pitfall 4). Since `/status` has no HTTP harness, test at the resolver-consumption seam (inject a resolver whose `resolve()` returns each branch and assert the serialized shape), mirroring why provider-state was extracted (provider-state.test.js:5-11 rationale).

---

### `test/check-isolation.test.js` (MOD — source-hygiene guard, D-09)

**Analog:** `test/check-isolation.test.js:160-177` (self — the `handoff.js` zero-import leaf guard, D-13) + the `walkImports` walker (lines 40-52)

**Extend with two guards** (reuse `extractImports`/`walkImports` already in the file — do NOT re-implement):
1. `src/tasks/pending.js` exists and has ZERO imports — copy the handoff.js block verbatim (lines 161-176), swap the path to `join(SRC, 'tasks', 'pending.js')`.
2. `check.js` graph does not pull new prohibited deps via `pending.js` — the existing `walkImports(join(SRC, 'check.js'))` graph assertions (lines 75-88, 113-147) already cover this transitively; add a targeted assert that `pending.js` is IN the graph (proving convergence — check actually consumes it) while remaining a leaf.

---

### `test/check.test.js` (MOD — regression, D-07)

**Analog:** `test/check.test.js:1-56` (self)

Reuse `createFakeProvider` (lines 17-28) and `BASE_CONFIG` (lines 30-34). Existing Tests 1-5 must stay GREEN (byte-identical output, D-07). Add/adjust a case proving `checkPendingTasks` now routes through `fetchFreshPending` yet produces the same `/N pending/` lines and the same red line on error.

## Shared Patterns

### Factory + DI + TTL + fail-open
**Source:** `src/server/provider-state.js:63-122`
**Apply to:** `src/tasks/pending.js`
The canonical repo pattern (Phase 40): `create*Resolver({ deps, ttlMs, now = Date.now })` closing over a private cache, `resolve()` never throws. This is the pattern D-01 mandates replicating. See excerpt in the pending.js assignment above.

### "No second number" — constants passed by parameter
**Source:** `src/server.js:507` (`ttlMs: PENDING_CACHE_TTL_MS`)
**Apply to:** pending resolver wiring in `startServer()`
The single literal `PENDING_CACHE_TTL_MS = 30 * 1000` (server.js:21) is passed by parameter, never re-declared inside the module (D-03, Phase 40 precedent).

### Additive `/status` fields, types intact
**Source:** `src/server.js:620-621` (`provider_state` / `provider_state_reason`)
**Apply to:** the `/status` payload (add `pending_stale`, `pending_fetched_at`)
Enrich the existing payload with new always-present fields; never add endpoints; never change existing field types (D-05, Phase 40 precedent).

### Zero-import leaf module
**Source:** `src/session/handoff.js` (guarded by `test/check-isolation.test.js:160-177`)
**Apply to:** `src/tasks/pending.js`
The shared module imports NOTHING (unlike provider-state.js which imports `logger-events`). All deps by DI; the caller emits any log/warn. Guarded by an extension of the same import-walker (D-02/D-09).

### Never-throws / fail-open read lane; caller emits the warn
**Source:** `src/server.js:597-599` (current warn ownership) + `provider-state.js:102-114` (collapse-to-safe-value)
**Apply to:** resolver `resolve()` + the `/status` handler
The resolver collapses failures to a labeled result; the `console.warn` trace lives in server.js, NOT in the leaf module (Pitfall 1).

## No Analog Found

None — every file has a strong in-repo analog (mostly self, from the Phase 40 `provider-state` lane which is the explicit template).

## Metadata

**Analog search scope:** `src/server/`, `src/`, `src/session/`, `src/tasks/`, `test/`, `test/server/`
**Files scanned:** provider-state.js, check.js, server.js (targeted ranges), check-isolation.test.js, provider-state.test.js, check.test.js
**Pattern extraction date:** 2026-07-17
