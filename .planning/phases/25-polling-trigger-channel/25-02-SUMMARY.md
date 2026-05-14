---
phase: 25
plan: 02
subsystem: polling-trigger-channel
tags:
  - polling
  - trigger-channel
  - github
  - clock-mock
  - state-cache
requirements:
  - POLL-01
  - POLL-02
  - POLL-03
  - POLL-04
  - TEST-02
requirements_addressed:
  - POLL-01
  - POLL-02
  - POLL-03
  - POLL-04
  - TEST-02
dependency_graph:
  requires:
    - "Plan 25-01: EVENTS{POLLING_TICK,POLLING_DISPATCH,POLLING_ERROR} + 3 helpers (pollingTick/Dispatch/Error)"
    - "Phase 23: GitHubClient.listIssues envelope {status, items, etag, rate_limit_remaining}"
    - "Phase 24: TaskProvider.listPendingTasks + normalizeIssue + getProvider('github')"
    - "v0.2: dispatchTrigger(event, opts, deps)"
  provides:
    - "startPolling({provider?, client?, repos, intervalSec?, clock?, logger?, statePath?, dispatchTriggerFn?}) -> {stop}"
    - "Third trigger channel (after webhook + manual CLI) — polling loop with state cache"
    - "Test helpers createTestClock() + makeFakeClient() + makeFakeProvider() + makeFakeLogger() — reusable Phase 27 cross-provider"
  affects:
    - "Phase 26 CFG-04 — kodo polling start CLI integration (consumes startPolling as-is)"
    - "Phase 27 cross-provider matrix — provider-only path verified by TEST-02"
tech_stack:
  added: []
  patterns:
    - "Recursive setTimeout (Phase 24 Pitfall #4 — prevents overlapping ticks by design)"
    - "Clock injection via DEFAULT_CLOCK constant (Pitfall #5 — sole Date.now() lives there)"
    - "tmp + rename atomic write (Pitfall #6 — POSIX-only, Mac/Linux)"
    - "First-tick skip dispatch + populate cursor (Pitfall #7 / T-25-04)"
    - "Fire-and-forget dispatchFn().catch(...) (mirror webhook.js:46-48)"
    - "Hybrid signature: client priority for etag path, provider fallback for cross-provider"
    - "createTestClock() — zero-dep scheduler queue with manual advance (vs sinon useFakeTimers)"
    - "Live-fetch leak guard before/after globalThis.fetch override (lift de provider.test.js)"
    - "Wall-time meta-assertion via process.hrtime.bigint() — in-suite timing budget"
key_files:
  created:
    - src/triggers/polling.js
    - test/triggers/polling.test.js
    - test/triggers/ (directory)
  modified:
    - test/check-isolation.test.js
decisions:
  - "Hybrid signature locked: client priority for etag-optimized path; provider-only fallback constructs synthetic envelope {status:200, items:filtered, etag:undefined} from listPendingTasks. Phase 27 cross-provider seed without coupling polling to GitHub."
  - "Open Q #1 RESOLVED: warn-and-continue after retry exhaustion. NO polling.stopped event emitted; the next tick retries naturally from the preserved cursor. Asserted by Task 2b case warn-and-continue."
  - "Open Q #3 RESOLVED: duck-typed Clock {setTimeout, clearTimeout, now}. Sole Date.now() literal lives in DEFAULT_CLOCK.now (Pitfall #5 lint gate)."
  - "Open Q #4 RESOLVED: state cache saved once per repo within a tick. Bounds loss to one repo if crash mid-tick."
  - "KODO_DIR imported from ../config.js (verified exported at line 176). NO inline homedir() recompute. NO mutation of config.js (Karpathy Rule 3 surgical)."
metrics:
  duration_min: 18
  completed_date: 2026-05-14
  commits: 4
  files_modified: 1
  files_created: 2
  lines_added: 1557
  lines_removed: 0
  tests_added: 27  # 26 in polling.test.js + 1 in check-isolation.test.js
  tests_total_after: 715
---

# Phase 25 Plan 02: Polling Core + Tests Summary

Tercer canal de trigger (`src/triggers/polling.js`) — loop async recursivo cancelable que descubre issues con label `kodo` en repos configurados, dispara `dispatchTrigger` fire-and-forget con `TaskItem` normalizado, persiste cursor + etag en `~/.kodo/polling-state.json` con tmp+rename atómico, recupera de errores transitorios con backoff exponencial 2s/4s/8s × 3 retries, y nunca crashea el proceso parent. Acompañado por suite TEST-02 completa (26 casos con clock-mock, wall-time 139ms) y extensión del guardián LOG-12.

## What Was Built

### Production (`src/triggers/polling.js`, +478 LOC, NEW)

**Exports + signature (verbatim):**

```javascript
export function startPolling(opts: {
  provider?: TaskProvider,
  client?: GitHubClient,
  repos: Array<{ owner: string, repo: string }>,
  intervalSec?: number,       // default 60
  clock?: Clock,              // default DEFAULT_CLOCK
  logger?: Logger,            // optional — NDJSON is no-op without it
  statePath?: string,         // default join(KODO_DIR, 'polling-state.json')
  dispatchTriggerFn?: Function, // default dispatchTrigger from ./dispatcher.js
}) -> { stop: () => void };
```

**Constants lock-in:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `RETRY_BASE_MS` | `2000` | Base for exponential backoff (T-25-03) |
| `RETRY_MAX_ATTEMPTS` | `3` | Max retries per repo per tick (T-25-03) |
| `TRANSIENT_STATUSES` | `Set([429, 500, 502, 503, 504])` | HTTP statuses that trigger retry path |
| `DEFAULT_STATE_PATH` | `join(KODO_DIR, 'polling-state.json')` | Imported from `../config.js` |
| `DEFAULT_CLOCK` | `{setTimeout, clearTimeout, now}` delegating to `globalThis` + `Date.now()` | Pitfall #5: sole Date.now() literal of the module |

**Internal helpers (not exported):**

- `loadStateCache(path)` — fail-open: returns `{}` on missing file, JSON parse error, or non-object shape (array/null/primitive). NEVER throws.
- `saveStateCache(cache, path)` — `mkdirSync(recursive) + writeFileSync(tmp) + renameSync(tmp, path)` atomic POSIX.
- `shouldDispatch(issue, prev)` — first-tick guard: `!prev.last_updated_at → false`; else `issue.updated_at > prev.last_updated_at`.
- `classifyPattern(issue, prev)` — forensic hint emitted to NDJSON (`'first-tick' | 'a-new' | 'b-or-c-updated'`); NOT a contract.
- `sleep(clock, ms)` — Promise bridge over `clock.setTimeout` for mockeable retry sleep.
- `processRepo({...})` — single-repo retry loop with exponential backoff + dispatch + state save.

### Tests (`test/triggers/polling.test.js`, +1063 LOC, NEW)

26 `it(...)` cases organized in 6 describe blocks:

| Block | Cases | Coverage |
|-------|-------|----------|
| POLL-01 loop signature & scheduling | 5 | returns {stop}, throws without provider/client, schedules next tick, stop cancels, multi-repo per tick |
| POLL-02 state cache | 5 | load fail-open corrupt JSON, load fail-open missing file, atomic write tmp gone, 304 preserves cursor, 200 advances cursor |
| POLL-03 dispatch patterns + idempotency + fire-and-forget | 7 | first-tick skip (T-25-04), pattern (a) new, pattern (b/c) updated, fire-and-forget (slow promise), dispatch rejection (logger emits polling.dispatch.failed), PR filter (T-25-05), provider-only path |
| POLL-04 retry backoff | 6 | 429 base backoff, 5xx parametrized, network error (ETIMEDOUT/AbortError), exponential backoff 2s/4s/8s sequence, warn-and-continue exhaustion, non-transient 401/404 no-retry |
| TEST-02 NDJSON shape + invariants | 2 | polling.tick shape per repo, polling.dispatch redaction (T-25-02 guardian — body/title with SECRET TOKEN never leak) |
| TEST-02 wall-time budget | 1 | `process.hrtime.bigint()` meta-assertion < 1.5s (in-suite, captures full elapsed) |

**Wall-time measured:** 139ms internal (well under 1500ms budget). Total Node startup + suite: ~210ms wall clock.

### Check-isolation extension (`test/check-isolation.test.js`, +16 LOC, MODIFIED)

One new `it()` row mirroring the Phase 24 D-29 pattern (provider.js + normalize.js precedents at lines 113-131):

```javascript
it('kodo check does not import src/triggers/polling.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => p.endsWith('/triggers/polling.js'));
  assert.deepEqual(violators, [], `...`);
});
```

`it()` count went from 6 → 7. Zero changes to the walker, imports, or pre-existing tests.

## Hybrid Path Decision (Open Q #2 RESOLVED)

The signature accepts BOTH `provider` and `client`. The path is chosen at the
`processRepo` level:

**Client priority — direct optimized path** (production for GitHub in v0.7):

```javascript
if (client) {
  result = await client.listIssues(owner, repo, {
    labels: ['kodo'],
    state: 'open',
    ...(prev.last_updated_at ? { since: prev.last_updated_at } : {}),
    ...(prev.etag ? { etag: prev.etag } : {}),
  });
  // → {status: 200|304, items, etag, rate_limit_remaining}
}
```

**Provider-only fallback — cross-provider seed for Phase 27**:

```javascript
} else if (provider) {
  const tasks = await provider.listPendingTasks(); // Phase 24 D-25 already filters PRs
  const itemsForRepo = tasks.filter((t) => t.projectId === `${owner}/${repo}`);
  result = { status: 200, items: itemsForRepo, etag: undefined };
}
```

Verified by Task 2b case `provider-only path: listPendingTasks used when no client` — the provider's `listPendingTasks` spy gets incremented and only one dispatch fires for the matching `projectId`.

## Invariants Preserved

| ID | Description | Test guardian |
|-----|-------------|---------------|
| T-25-01 | `loadStateCache` fail-open on tampered cache | Cases 6+7 (`fail-open on corrupted JSON`, `fail-open on missing file`) |
| T-25-02 | `pollingDispatch` NDJSON excludes user content (body/title/raw) | Case 25 (`polling.dispatch NDJSON does NOT include issue.body — T-25-02 invariant`) — SECRET TOKEN ghp_xxx in body never appears in serialized event |
| T-25-03 | Retry bounded: max `1 + 3 = 4` calls per repo per tick; backoff 2s/4s/8s | Case 21 (`exponential backoff sequence 2s/4s/8s — 1+3 calls total per tick`) + case 22 (`warn-and-continue after 3 retries exhausted`) |
| T-25-04 | First-tick storm prevention: cursor populated, NO dispatch | Case 11 (`first tick skips dispatch (Pitfall #7 / T-25-04)`) — 5 issues, dispatchCalls.length === 0, cursor = max(updated_at) |
| T-25-05 | PR elevation guard: `pull_request !== null` skipped | Case 16 (`PR filter (Pitfall #2 / T-25-05)`) — mixed fixture, only issue dispatched |
| LOG-12 | `src/check.js` does NOT import `src/triggers/polling.js` transitively | New it() in check-isolation.test.js (Task 3) |
| Pitfall #2 | PR filter explicit on client path | Source grep: `grep -c "if (issue\.pull_request)" src/triggers/polling.js` = 3 |
| Pitfall #5 | Zero `Date.now()` outside DEFAULT_CLOCK.now | Source grep (excluding comments): `grep -v '^//' src/triggers/polling.js \| grep -v '^\\s*\\*' \| grep -c "Date\.now()"` = 1 |
| Pitfall #6 | tmp + rename atomic write documented POSIX-only | Source grep: `grep -c "renameSync" src/triggers/polling.js` = 5 |
| Pitfall #7 | First-tick skip + populate cursor | T-25-04 (same case 11) |
| Fire-and-forget | NEVER await dispatchFn | Source grep: `grep -E "await\s+dispatchFn\|await\s+dispatchTrigger" src/triggers/polling.js \| wc -l` = 0 |
| Lock per-repo (Phase 8 GSD-10) | Polling delegates idempotency to dispatcher | NOT touched — no new dedup mechanism in polling.js |
| Worktree path (Phase 18) | Polling does NOT compute worktree | NOT imported — only calls dispatchTrigger |
| HOOK-01 universal (Phase 20) | Preserved automatically | NO plan work — inherited transitively |
| Color isolation | Zero `import 'picocolors'` | Source grep: 0 |

## Verification Results

| Gate | Command | Result |
|------|---------|--------|
| Syntax | `node --check src/triggers/polling.js` | exit 0 |
| Runtime import | `node -e "const m = await import('./src/triggers/polling.js'); console.log(typeof m.startPolling)"` | `function` |
| Targeted suite | `node --test test/triggers/polling.test.js test/check-isolation.test.js test/logger-events.test.js` | 62 pass, 0 fail |
| Full suite | `node --test 'test/**/*.test.js'` | 715 pass, 1 skipped, 0 fail |
| Wall-time | `node --test test/triggers/polling.test.js` duration | 139ms (budget 1500ms) |
| Pitfall #5 lint | `grep -v '^//' src/triggers/polling.js \| grep -v '^\\s*\\*' \| grep -c "Date\.now()"` | 1 (in DEFAULT_CLOCK only) |
| Check-isolation rows | `grep -cE "^\\s*it\\(" test/check-isolation.test.js` | 7 (was 6) |
| Polling tests count | reported by node:test | 26 cases (5+5+7+6+2+1 meta) |
| Baseline preserved | full suite passes = 688 + 26 polling + 1 check-isolation = 715 | confirmed |

## Commits

| # | Hash | Type | Message |
|---|------|------|---------|
| 1 | `92ce1ff` | feat | `feat(25-02): create src/triggers/polling.js core (POLL-01..04)` |
| 2 | `d3e290e` | test | `test(25-02): add polling.test.js scaffolding + POLL-01/02 cases (Task 2a)` |
| 3 | `b598d47` | test | `test(25-02): add POLL-03/04 + TEST-02 cases (Task 2b)` |
| 4 | `b0066aa` | test | `test(25-02): extend check-isolation.test.js with polling.js LOG-12 row` |

## Deviations from Plan

### [Rule 3 — Blocking issue] Worktree branch was behind `main`

- **Found during:** Pre-Task 1 setup (right after loading the plan).
- **Issue:** The Claude Code worktree (`worktree-agent-a2f077590b3a751f3`) was created against commit `9185f92` (post-Phase-22 baseline) — its tree did NOT contain Phase 23 (GitHubClient), Phase 24 (GitHubProvider), or Plan 25-01 (logger-events polling helpers). Applying the plan verbatim would have produced a divergent baseline (688 → some smaller number due to missing tests; missing `EVENTS.POLLING_*`; no `src/providers/github/`).
- **Fix:** `git fetch origin main && git rebase main` inside the worktree before any edit. After the rebase, HEAD aligned to `032f58b` (post-25-01) — exactly matching the plan's `<interfaces>` snapshot.
- **Files modified:** None — purely a git history alignment. Mirror of the deviation tracked in Plan 25-01 Summary.

### [Rule 2 — Missing critical scope] T-25-02 source-level grep guard required reformulating documentation comments

- **Found during:** Task 1, while running the acceptance criteria grep `grep -c "issue\.body\|raw:\s*issue\.body" src/triggers/polling.js == 0`.
- **Issue:** Plan acceptance asserts zero source-level matches for `issue.body` or `raw:\s*issue.body`. My initial JSDoc / inline comment for the T-25-02 invariant used the literal string `issue.body` to *document the prohibition* (e.g., "JAMÁS `issue.body`, `title` o `raw`"). The grep guard is path-agnostic — it counts matches regardless of whether they live in code or comments — so documentation literals would have caused a false-positive guard failure.
- **Fix:** Reformulated the two comment blocks (module header T-25-02 paragraph + inline call-site comment) to express the prohibition in prose ("contenido de usuario — descripción, título, payload raw") without the literal tokens. Semantic intent preserved; grep guard passes (0 occurrences).
- **Files modified:** `src/triggers/polling.js` (only the two comment blocks).
- **Same pattern** as Plan 25-01 Summary deviation `[Rule 2] T-25-02 source-level grep guard required reformulating documentation comments` — confirming the planner gate is consistent across plans.

### [Note — worktree cwd drift recovery, not a deviation]

During Task 1, a `Write` call with absolute path `/Users/alex/dev/klab/kodo/src/triggers/polling.js` resolved to the **main repo** rather than the worktree (the worktree toplevel is at `.claude/worktrees/agent-a2f077590b3a751f3/`, and the absolute path was intercepted by the main repo's tree). I recovered by `mv`-ing the file from main repo to worktree and re-running the assertion grep. Subsequent `Write`/`Edit` calls used the full worktree-absolute path (`/Users/alex/dev/klab/kodo/.claude/worktrees/agent-a2f077590b3a751f3/...`) and behaved correctly. This is documented as a note for executor-pattern hardening (#3097/#3099 — already in agent rules).

## Self-Check: PASSED

- `src/triggers/polling.js` exists at the worktree path and has 478 lines.
- `test/triggers/polling.test.js` exists at the worktree path and has 1063 lines.
- `test/check-isolation.test.js` has 7 `it()` rows (was 6).
- All 4 commits exist on the worktree branch:
  - `92ce1ff` — `feat(25-02): create src/triggers/polling.js core (POLL-01..04)`
  - `d3e290e` — `test(25-02): add polling.test.js scaffolding + POLL-01/02 cases (Task 2a)`
  - `b598d47` — `test(25-02): add POLL-03/04 + TEST-02 cases (Task 2b)`
  - `b0066aa` — `test(25-02): extend check-isolation.test.js with polling.js LOG-12 row`
- `node --test 'test/**/*.test.js'` → 715 pass, 1 skipped, 0 fail.
- `Object.values(EVENTS).length === 18` and `Object.isFrozen(EVENTS) === true` (inherited from Plan 25-01, unchanged here).
- Plan 25 closed: 5/5 requirements (POLL-01..04 + TEST-02) all addressed.

## EXECUTION COMPLETE
