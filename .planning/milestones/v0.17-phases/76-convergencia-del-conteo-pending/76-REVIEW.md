---
phase: 76-convergencia-del-conteo-pending
reviewed: 2026-07-17T13:09:44Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/check.js
  - src/server.js
  - src/tasks/pending.js
  - test/check-isolation.test.js
  - test/check.test.js
  - test/server/status-pending.test.js
  - test/tasks/pending.test.js
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 76: Code Review Report

**Reviewed:** 2026-07-17T13:09:44Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 76 extracts a zero-import leaf `src/tasks/pending.js` so that `check.js`
(`kodo check`) and `server.js` (`GET /status`) share ONE pending read lane. The
LOG-12 isolation invariant is genuinely preserved: `pending.js` has zero imports
and the isolation test now also asserts positive convergence (`check.js` reaches
`pending.js` in its import graph). The freshness discrimination
(`fetchFreshPending` raw vs `createPendingResolver` TTL+stale) is well-tested at
the unit level, and the fail-open / frozen-`fetched_at` behavior (ORCH-06 /
Pitfall 3) is correct.

No BLOCKER-class defects (crash, injection, data loss) were found in the changed
surface. The findings below are correctness-adjacent robustness and
maintainability concerns. The most important is that the "convergence" the phase
name promises is **structural, not behavioral**: the two consumers still run
different freshness policies, so the user-visible pending *count* can legitimately
disagree between `kodo check` and the dashboard — this is documented as
intentional (D-07), but it is worth a human confirming that residual divergence is
acceptable, because it is exactly the axis the phase set out to converge.

## Warnings

### WR-01: Count convergence is structural, not behavioral — `kodo check` and dashboard can report different pending counts

**File:** `src/check.js:41`, `src/server.js:525-529`, `src/tasks/pending.js:39-41`
**Issue:** The phase goal is "convergencia del conteo pending", but the two
consumers deliberately take different lanes out of the shared module:

- `check.js` calls `fetchFreshPending(() => provider.listPendingTasks())` — raw,
  uncached, throws on provider failure (reports `Error checking tasks` and NO
  pending count).
- `server.js` calls `createPendingResolver(...).resolve()` — 30 s TTL cache,
  fail-open, serves last-known-good LABELED stale on outage.

Consequence: during the TTL window or a provider outage the two surfaces show
different pending counts for the same instant — the dashboard renders a
last-known-good count (e.g. `3?`) while `kodo check` shows an error and treats
pending as unknown/zero. What actually converged is the *fetch function* and the
*task shape*, not the *count*. This is documented as an intentional trade-off
(D-07, raw mode to keep the red error line byte-identical), so it is not a bug per
se — but the reviewer's job is to surface that the phase's headline invariant
("the count can never disagree") is not what the code guarantees.
**Fix:** No code change strictly required if the trade-off is accepted; make the
residual divergence explicit so it does not read as an unconditional guarantee.
Either (a) route `check.js` through a shared read that also returns the
`stale`/last-known-good tasks (so an outage still yields the last count instead of
zero), or (b) document in the phase artifacts that convergence is on the read lane
and task shape, and that counts may diverge during TTL/outage windows by design.

### WR-02: `resolve()` returns the cached `tasks` array by reference — latent cache corruption

**File:** `src/tasks/pending.js:68,80`
**Issue:** Both the cache-hit branch (`return { tasks: cache.tasks, ... }`) and the
stale branch (`return { tasks: cache.tasks, ... }`) hand back the *same* array
object held in the closure cache. Any caller that mutates the returned `tasks`
(sort/splice/push) silently corrupts every subsequent cache hit within the TTL
window. Today the only server caller passes it straight to
`buildPendingStatusFields`, which `.map()`s into fresh objects, so it is safe —
but this is a latent trap for any future consumer (including `check.js` if it ever
adopts the resolver) that treats the returned list as owned/mutable.
**Fix:** Return a shallow copy so the cache slot is never aliased:
```js
if (cache && now() - new Date(cache.fetched_at).getTime() < ttlMs) {
  return { tasks: cache.tasks.slice(), fetched_at: cache.fetched_at, stale: false };
}
// ...and in the stale branch:
if (cache) return { tasks: cache.tasks.slice(), fetched_at: cache.fetched_at, stale: true };
```

### WR-03: Stale warning floods the 200-line log ring buffer during an outage — evicts the diagnostics you need

**File:** `src/server.js:614`
**Issue:** `if (pendingResult.stale) console.warn('[kodo] listPendingTasks stale — serving last-known-good')`
runs on every `/status` request. The dashboard polls `/status` every 5 s
(`setInterval(refresh, 5000)`), so a sustained provider outage emits this
identical line every 5 s. The server keeps only the last 200 log lines
(`LOG_BUFFER_SIZE = 200`, `pushLog` shifts on overflow), so ~17 minutes of outage
completely overwrites the ring buffer with duplicate stale warnings — evicting the
provider-error / reconcile logs an operator would actually use to diagnose the
outage. The warning is most harmful exactly when it is most repeated.
**Fix:** Rate-limit / de-duplicate the stale warning (log once on the
fresh→stale transition, and again on stale→fresh recovery), e.g. track the last
logged staleness on the resolver or in a module-level flag and only warn on edge:
```js
if (pendingResult.stale && !wasStale) console.warn('[kodo] listPendingTasks stale — serving last-known-good');
if (!pendingResult.stale && wasStale) console.log('[kodo] listPendingTasks recovered');
wasStale = pendingResult.stale;
```

### WR-04: `buildPendingStatusFields` JSDoc claims "preserves the task shape verbatim" but silently whitelists 5 fields

**File:** `src/tasks/pending.js:93-110`
**Issue:** The doc comment says "Preserves the task shape verbatim (Assumption
A1)", but the implementation explicitly picks `{ ref, title, url, state,
projectName }` and drops everything else. Relative to the current `PendingTask`
typedef this is accurate, but the comment misleads a future maintainer: if a
provider ever enriches a pending task with a field the dashboard needs, it is
dropped here silently with no test catching it. The "verbatim" wording invites the
assumption that adding a field to the provider output automatically flows through.
**Fix:** Either correct the comment to say the shaper intentionally projects a
fixed field allowlist (and why), or spread-then-normalize
(`{ ...t, ref: t.ref, ... }`) if downstream should receive the full shape. Prefer
tightening the comment over widening the surface, unless a concrete field is
needed.

## Info

### IN-01: `fetchFreshPending` is a trivial pass-through providing no shared logic

**File:** `src/tasks/pending.js:39-41`
**Issue:** `export async function fetchFreshPending(fn) { return await fn(); }` is
functionally an identity wrapper around the injected function. Its only value is
being a shared *symbol* both consumers import (satisfying the import-graph
convergence test). It contributes no caching, dedup, or normalization — the real
shared logic lives in `createPendingResolver`, which `check.js` does not use. The
abstraction earns its keep only as a test anchor, which is a thin justification.
**Fix:** Acceptable to keep for the convergence guard, but consider a brief note
that its purpose is the shared seam (not shared behavior) so it is not mistaken
for a meaningful fetch layer and later "simplified" away, breaking the isolation
test.

### IN-02: `createPendingResolver` lacks the in-flight dedup its sibling `createProviderStateResolver` advertises

**File:** `src/tasks/pending.js:58-87`, `src/server.js:501-517`
**Issue:** The provider-state resolver wiring (server.js:501-504) explicitly touts
"in-flight dedup" as a design goal, but the pending resolver has none: two
`/status` polls arriving past TTL (e.g. two open dashboard tabs) each trigger a
concurrent `provider.listPendingTasks()`. This is primarily a performance /
thundering-herd concern (out of v1 scope) and single-client polling is
serialized, so it is noted only for consistency with the sibling resolver the code
comments hold up as the pattern being mirrored.
**Fix:** If desired, cache the in-flight promise and return it to concurrent
callers until it settles (mirror the provider-state resolver). Not required for
correctness.

---

_Reviewed: 2026-07-17T13:09:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
