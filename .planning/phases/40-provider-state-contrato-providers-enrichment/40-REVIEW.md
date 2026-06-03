---
phase: 40-provider-state-contrato-providers-enrichment
reviewed: 2026-06-03T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/logger-events.js
  - src/providers/github/provider.js
  - src/providers/plane/provider.js
  - src/server.js
  - src/server/provider-state.js
  - test/logger-events.test.js
  - test/plane-provider.test.js
  - test/providers/contract.test.js
  - test/providers/github/provider.test.js
  - test/server/provider-state.test.js
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 40: Code Review Report

**Reviewed:** 2026-06-03
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 40 adds the `provider_state` enrichment lane: a DI-driven resolver
(`src/server/provider-state.js`) wired into `GET /status` (`src/server.js`),
a new closed-taxonomy event (`provider.state.fetch.failed`) in
`src/logger-events.js`, and `getTaskState` adapters on both providers.

The core resolver logic (capability gate → TTL cache → in-flight dedup → fail-open)
is sound and well-tested. The fail-open contract holds: failures collapse to
`{state:null, reason:'fetch-failed'}` and never throw. No security vulnerabilities
or data-loss risks were found — the read-only invariant (never writes state.json)
is structurally enforced by the import graph.

The findings below are robustness and consistency concerns. The most material one
(WR-01) is a latent cross-provider mismatch: the resolver is bound to the single
configured provider but dispatches against per-session `provider`, so a session
whose `provider` differs from `config.provider` resolves against the wrong adapter.
It is contained by fail-open (degrades to `fetch-failed`, never crashes), which is
why it is a WARNING and not a BLOCKER.

## Warnings

### WR-01: Resolver dispatches every session against the single configured provider, ignoring `session.provider`

**File:** `src/server/provider-state.js:38-44, 97`
**Issue:** `createProviderStateResolver` closes over ONE `provider` instance
(`getProvider(config.provider)` in `server.js:342,356-361`). For every session row
it calls `provider.getTaskState(idShapeFor(session))`. But `idShapeFor` branches on
`session.provider` ("github" → `{ref}`, else → `{id, projectId}`), implying sessions
of mixed providers can appear in `listSessions()`. If a session has
`provider === 'github'` while `config.provider === 'plane'`, the resolver builds the
GitHub `{ref}` shape and hands it to the Plane adapter, whose `getTaskState({ref})`
destructures `{ id, projectId }` as `undefined` and calls
`client.getWorkItem(undefined, undefined)`. The result is a guaranteed
`fetch-failed` for every cross-provider row (silent except for the NDJSON event),
not a real provider_state. The mismatch is masked because fail-open swallows it.
**Fix:** Either (a) gate per row — skip enrichment (return `{state:null, reason:'unsupported'}`)
when `session.provider !== config.provider`, or (b) resolve the per-session provider
via `getProvider(session.provider)` instead of closing over a single instance. Prefer
(a) for v1 since multi-provider fetch is out of scope:
```js
// server.js, before resolve:
const { state, reason } = s.provider === config.provider
  ? await providerStateResolver.resolve(s)
  : { state: null, reason: 'unsupported' };
```

### WR-02: `fetch-failed` is cached for the full TTL, blinding `/status` to recovery for up to 30s

**File:** `src/server/provider-state.js:102-111`
**Issue:** On a fetch failure the catch block writes
`cache.set(key, { state: null, reason: 'fetch-failed', ts: now() })`. The cache-hit
branch (line 86) returns this poisoned entry for the full `ttlMs` (30s) regardless of
whether the underlying provider has since recovered. A single transient 5xx / rate-limit
blip pins the dashboard row to `fetch-failed` for 30 seconds. The resolver test at
`test/server/provider-state.test.js:153-168` documents this as intended ("transient
stays until TTL"), so it is a deliberate trade-off — but caching a *negative* result
for the same duration as a *positive* one is asymmetric and surprising for an
observability lane. A success cache of 30s is fine; a failure cache of 30s actively
hides recovery.
**Fix:** Use a shorter (or zero) TTL for failure entries so the next poll re-attempts,
e.g. store `ts: now()` only for successful results and treat `reason:'fetch-failed'`
entries as immediately stale:
```js
const cached = cache.get(key);
if (cached && cached.reason === null && now() - cached.ts < ttlMs) {
  return { state: cached.state, reason: cached.reason };
}
```

### WR-03: `idShapeFor` Plane branch silently builds a `{id, projectId}` shape with `undefined` fields

**File:** `src/server/provider-state.js:38-44`
**Issue:** The Plane branch returns `{ id: session.task_id, projectId: session.project_id }`
unconditionally. If a session record is missing `project_id` (legacy records,
partially migrated state — plausible given Phase 38's v2→v3 migration just landed),
`projectId` is `undefined` and the downstream `client.getWorkItem(undefined, id)`
fails. As with WR-01 this is contained by fail-open, but it converts a
missing-field data issue into an opaque `fetch-failed` with no signal that the cause
was a malformed session row rather than a provider outage.
**Fix:** Guard the required fields and short-circuit to `unsupported` (a permanent,
non-retried reason) when they are absent, so the NDJSON noise and 30s cache poisoning
of WR-02 are avoided:
```js
if (session.provider !== 'github' && !session.project_id) {
  return { id: session.task_id, projectId: session.project_id }; // will fail-open
}
```
Better: validate in `resolve()` and return `{state:null, reason:'unsupported'}`.

### WR-04: GitHub `updateTaskState` rejects valid configured aliases when `config.states` is undefined

**File:** `src/providers/github/provider.js:128-141`
**Issue:** The guard reads `Object.values(config.states || {})`. When `config.states`
is undefined, `configured` is `[]`, so any `stateName` other than the literals
`'open'`/`'closed'` throws `Unknown state: X. Configured: ` (empty list). That is the
intended passthrough-hard behavior, but the error message with an empty `Configured:`
suffix is misleading — it reads as if no states are configured when the real cause may
be a missing config block. The Plane provider (`provider.js:195-211`) surfaces the
available states list on the same failure, so the two adapters diverge in diagnosability.
**Fix:** When `configured.length === 0`, emit a clearer message:
```js
throw new Error(
  configured.length
    ? `Unknown state: ${stateName}. Configured: ${configured.join(', ')}`
    : `Unknown state: ${stateName}. Only 'open'/'closed' accepted (config.states empty).`,
);
```

### WR-05: `provider.state.fetch.failed` has no direct emission test; coverage is incidental

**File:** `test/logger-events.test.js:28-49, 56-86`
**Issue:** Phase 40's new helper `providerStateFetchFailed` is asserted only via the
EVENTS frozen-list test (line 74). Unlike every other helper in the file
(`sessionStart`, `planeApiCall`, etc.), it is neither imported (the destructure at
lines 28-49 stops at `pollingTickSummary`) nor given a dedicated emission test that
verifies the level (`error`), the whitelisted payload shape `{event, task_id, provider, error}`,
and the T-40-04 invariant that no extra caller fields leak. The resolver test
(`test/server/provider-state.test.js:76-88`) exercises emission through a spy logger,
but does not validate the NDJSON record shape or the explicit-whitelist guarantee at
the helper boundary. A regression that added `...fields` spread to the helper would
pass `logger-events.test.js`.
**Fix:** Add `providerStateFetchFailed` to the import block and a focused test mirroring
the existing helper tests, asserting the emitted record has exactly the four keys
`{event, task_id, provider, error}` and `level === 'error'`.

## Info

### IN-01: `getTaskState` typedef in resolver omits the `'unknown'` literal returned by Plane

**File:** `src/server/provider-state.js:57`
**Issue:** The DI typedef declares `getTaskState?: (arg) => Promise<string|null>`,
which is fine, but the providers return a closed vocabulary. Plane's `mapPlaneState`
(`plane/provider.js:70-86`) can return `'unknown'`, while GitHub's `mapGithubLabels`
(`github/provider.js:107-112`) never can. The asymmetry is correct behavior but
undocumented at the resolver boundary, so a reader cannot tell that `state:'unknown'`
is a legitimate value distinct from `reason:'fetch-failed'`/`null`.
**Fix:** Tighten the typedef to the closed union and add a one-line comment noting
GitHub never yields `'unknown'`.

### IN-02: Stale doc comment count in `logger-events.js` header

**File:** `src/logger-events.js:3`
**Issue:** The file header still reads "Taxonomía cerrada de 23 eventos" but the module
now exports 24 (`provider.state.fetch.failed` added in Phase 40, plus the Phase 38
host/migration events). The frozen test at `logger-events.test.js:85` asserts 24. The
header comment is the only place left claiming 23.
**Fix:** Update line 3 to "24 eventos" and extend the Phase enumeration comment
(lines 4-13) to mention Phase 38 + Phase 40 events for consistency with the rest of the
running changelog.

### IN-03: Test docstring undercounts the helper coverage it claims

**File:** `test/logger-events.test.js:5-9`
**Issue:** The describe-block docstring still says it validates "los 7 helpers" and lists
only the original seven, despite the import block (lines 28-49) pulling 20 helpers and the
file testing many of them. The narrative is stale and now actively misleading about scope
(it omits worktree/skill/polling/github, and the Phase 40 helper is absent entirely — see WR-05).
**Fix:** Update the docstring to reflect the actual helper set under test, or generalize
it ("all exported lifecycle helpers") to avoid future drift.

### IN-04: `console.warn` used for module-cache failures instead of the structured logger

**File:** `src/providers/plane/provider.js:151, 185`
**Issue:** Inside the DI provider factory (which already receives an injected
`logger` via `opts.logger`), two failure paths fall back to raw `console.warn`
(`Could not cache modules...`, `Module lookup failed...`). These bypass the NDJSON
sink and the redactor, so the messages — which interpolate `err.message` — never reach
`kodo logs` and are not redacted. This predates Phase 40 (not introduced here) but sits
in a reviewed file and is inconsistent with the structured-logging discipline the rest
of the phase enforces (e.g. `providerStateFetchFailed`).
**Fix:** Route through `logger?.warn(...)` when available, falling back to `console.warn`
only when no logger was injected.

---

_Reviewed: 2026-06-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
