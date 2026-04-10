---
phase: 03-consumer-rewiring
plan: 02
subsystem: consumer-migration
tags: [taskprovider, registry, stop-hook, session-manager, tdd, plane]

# Dependency graph
requires:
  - phase: 01-interface-state-schema
    provides: TaskItem/TaskProvider typedefs, state schema v2 with task_id/task_ref/provider
  - phase: 02-plane-adapter-registry
    provides: PlaneProvider adapter and provider registry (initRegistry, getProvider)
provides:
  - stop.js rewired to TaskProvider — posts Markdown comments and transitions state via provider
  - manager.js rewired to TaskProvider — resolves refs via provider.getTask, saves generic session fields
  - Defensive per-operation try-catch inside stop hook (comment failure does not block state transition)
  - Pure testable helpers extracted from manager.js (buildSessionFromTask, resolveProjectPath, deriveModuleName, resolveTaskAndLaunchContext)
  - Zero direct PlaneClient usage from consumer files stop.js and manager.js
affects: [03-01 remaining consumers, phase-04 orchestrator, phase-05 GitHub adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Consumers depend only on TaskProvider interface + registry (no concrete provider imports)"
    - "Extract pure helpers from IO-heavy functions so they are unit-testable without mocks"
    - "Stop hook: per-operation independent try-catch to survive partial failures"
    - "Markdown comments standardized across providers (HTML translation is provider adapter's concern)"
    - "Source-level grep assertions in tests to enforce import hygiene"

key-files:
  created:
    - test/stop.test.js
    - test/manager.test.js
    - .planning/phases/03-consumer-rewiring/deferred-items.md
  modified:
    - src/hooks/stop.js
    - src/session/manager.js

key-decisions:
  - "Extract postClosingActions(session, config, provider, screenSummary) from stop.js main() so provider interaction is unit-testable"
  - "Build minimal TaskItem from session state fields (no extra provider.getTask call in stop hook) to keep the hook fast and resilient to read failures"
  - "Markdown comments use ### heading + triple-backtick code fences; HTML escaping is removed entirely — each adapter (e.g. PlaneProvider.addComment) converts to its native format"
  - "Extract pure helpers in manager.js (buildSessionFromTask, resolveProjectPath, deriveModuleName, resolveTaskAndLaunchContext) instead of relying on module mocking (mock.module unavailable in Node 24 test runner)"
  - "opts.model/opts.flags passed to launchWorkItem take precedence over label-derived values; label flags are merged (Set union) into CLI flags so kodo:yolo still enables --dangerously-skip-permissions"
  - "Add guard `if (isMainEntry) main()` in stop.js so the module can be imported by tests without executing the CLI path"

patterns-established:
  - "Consumer rewiring template: replace PlaneClient import with initRegistry/getProvider, extract pure helpers for testability, add source-level import hygiene assertions"
  - "Stop hook idempotency: each provider call in its own try-catch with structured stderr logging"

requirements-completed: [REWI-02, REWI-03]

# Metrics
duration: 4 min
completed: 2026-04-10
---

# Phase 3 Plan 2: stop.js and manager.js TaskProvider Rewiring Summary

**stop.js and manager.js now consume tasks through the provider registry — posting Markdown comments via provider.addComment, transitioning state via provider.updateTaskState, and resolving refs via provider.getTask — with zero PlaneClient imports in either consumer.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-10T07:38:58Z
- **Completed:** 2026-04-10T07:43:44Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 source + 2 test + 1 deferred log = 5

## Accomplishments

- **stop.js rewired** to read `session.provider`, resolve the adapter via `initRegistry + getProvider`, post a Markdown closing comment via `provider.addComment`, and transition to review state via `provider.updateTaskState` — each call wrapped in its own defensive try-catch so a failure in one operation never blocks the other.
- **HTML comment construction removed** — `escapeHtml` helper deleted; comments are now Markdown with `###` headings and triple-backtick code fences. The provider adapter owns any translation to its native format (PlaneProvider already wraps Markdown in `<p>…</p>` when calling the Plane API).
- **Minimal TaskItem built from session state** — no extra `provider.getTask` round-trip on session end, avoiding network dependency in the stop hook which runs silently inside Claude's process.
- **manager.js rewired** to launch sessions via `getProvider(config.provider).getTask(identifier)`. Pure helpers extracted (`buildSessionFromTask`, `resolveProjectPath`, `deriveModuleName`, `resolveTaskAndLaunchContext`) so they are unit-testable without module mocking — `mock.module` is not available on Node 24's test runner.
- **Session state saved with generic fields** (`task_id`, `task_ref`, `provider`, `project_id`) consistent with the v2 state schema; legacy `plane_id`/`plane_identifier` removed from both files.
- **Label-derived model/flags** computed from `task.labels.map(name => ({name}))` so `parseKodoLabels` gets the object shape it expects; `kodo:yolo` still enables `--dangerously-skip-permissions` through the merged flag set.
- **8 + 13 = 21 new tests** added, all green; full suite 96 tests passing with no regressions.

## Task Commits

Each task was committed atomically following the TDD red/green cycle:

1. **Task 1 RED: failing tests for stop.js rewiring** — `7f4ffc5` (test)
2. **Task 1 GREEN: rewire stop.js to TaskProvider** — `2f32b42` (feat)
3. **Task 2 RED: failing tests for manager.js rewiring** — `090ce50` (test)
4. **Task 2 GREEN: rewire manager.js to TaskProvider** — `4e5f5e6` (feat)

**Plan metadata:** pending (this commit)

_No refactor commits — implementation was clean on first pass._

## Files Created/Modified

- `src/hooks/stop.js` — removed `PlaneClient`/`escapeHtml`, added `postClosingActions` exported helper, switched to `initRegistry`/`getProvider`, Markdown comments, independent per-operation try-catch, guarded CLI entry so the file is importable by tests.
- `src/session/manager.js` — removed `PlaneClient`, added `initRegistry`/`getProvider`/`parseKodoLabels` imports, extracted 4 pure helpers (`buildSessionFromTask`, `resolveProjectPath`, `deriveModuleName`, `resolveTaskAndLaunchContext`), rebuilt `launchWorkItem` to orchestrate them, session record now carries generic task fields.
- `test/stop.test.js` — 8 tests covering Markdown formatting, defensive try-catch independence, state resolution from `session.provider`, minimal TaskItem construction, and source-level import hygiene.
- `test/manager.test.js` — 13 tests covering each pure helper, `provider.init()` call order, label wrapping for `parseKodoLabels`, plus source-level assertions (no PlaneClient, no `plane_id`/`plane_identifier`, no `stripHtml`, `getProvider` import present).
- `.planning/phases/03-consumer-rewiring/deferred-items.md` — logs a pre-existing 03-01 test failure observed at the start of execution (later resolved during the plan run by concurrent 03-01 commits — see Issues Encountered).

## Decisions Made

- **Extract `postClosingActions` from stop.js main loop.** The hook has heavy I/O side effects (stdin reading, cmux, state updates, orchestrator notification) that are impractical to unit test, but the provider-interaction logic is the risky part that benefits from TDD. Exporting this helper gives us a pure-ish seam with just two provider calls.
- **Build minimal TaskItem in stop.js instead of calling `provider.getTask` on stop.** The plan specified this and it was the right call: stop.js runs inside Claude's dying process where exceptions are swallowed, so avoiding a network round-trip makes it more robust.
- **Markdown-only comments.** The old stop.js constructed HTML with `<h3>`, `<pre>`, and `escapeHtml`. Moving to Markdown centralizes escaping concerns in the provider adapter (PlaneProvider already wraps Markdown in `<p>` for Plane's API; a future GitHub adapter can pass Markdown straight through). Removing `escapeHtml` also shrinks stop.js's attack surface.
- **Pure-helper extraction for manager.js tests instead of module mocking.** `mock.module` isn't exposed by Node 24's `node:test` module, so testing the full `launchWorkItem` would require dependency injection for `addSession`, `loadConfig`, `cmux`, etc. Extracting `buildSessionFromTask`, `resolveProjectPath`, `deriveModuleName`, and `resolveTaskAndLaunchContext` as pure functions gives us the same test coverage with zero mocks, plus each helper is independently reusable.
- **Merge label flags with `opts.flags` via `Set`-union** so CLI-supplied flags don't silently erase `kodo:yolo` / other label-driven flags when the orchestrator explicitly passes `opts.flags`. This preserves the label-as-config intent documented in PROJECT.md.
- **Guard the `main()` call in stop.js** with an `import.meta.url === argv[1]` check so the test suite can `await import('../src/hooks/stop.js')` without executing the stdin-reading CLI path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] stop.js CLI entry executed on test import**

- **Found during:** Task 1 GREEN
- **Issue:** Plan said to extract and export `postClosingActions`, but the original file ends with a bare `main()` call. Importing the module from the test file would execute `main()`, read from stdin, and hang the test until the 3-second timeout fired.
- **Fix:** Added an ESM-style entry guard at the bottom of stop.js: `const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; if (isMainEntry) main();`. This is the idiomatic Node pattern equivalent to `if __name__ == '__main__'`.
- **Files modified:** `src/hooks/stop.js`
- **Verification:** `node --test test/stop.test.js` imports the module without hanging; invoking `node src/hooks/stop.js` directly still runs `main()`.
- **Committed in:** `2f32b42` (Task 1 GREEN)

**2. [Rule 2 — Missing Critical] Missing config validation for review state**

- **Found during:** Task 1 GREEN
- **Issue:** If `config.providers[providerName]` or its `states.review` are missing (e.g. misconfigured provider entry), the old code would throw a confusing `TypeError: Cannot read properties of undefined`. The plan asked only to replace `config.plane.review_state`, but the new indirection made silent misconfiguration easier.
- **Fix:** Added an explicit `throw new Error('No review state configured for provider "…"')` inside the second try-catch. The defensive outer try-catch still swallows the error (logging to stderr) so the stop hook stays non-fatal.
- **Files modified:** `src/hooks/stop.js`
- **Verification:** Error path is covered implicitly by the defensive-failure test; the explicit throw makes the log message actionable.
- **Committed in:** `2f32b42` (Task 1 GREEN)

**3. [Rule 1 — Bug] `opts.flags` silently dropped label flags**

- **Found during:** Task 2 GREEN
- **Issue:** Original manager built `kodoFlags` from label parsing only; if a caller passed `opts.flags` those flags were completely ignored (the original code has a `flags: []` param on `buildClaudeCommand` that nobody populated from `opts`). Relevant when an orchestrator launches a session with explicit flags.
- **Fix:** Merged `opts.flags` with label-derived flags via `Array.from(new Set([...(opts.flags || []), ...labelFlags]))`, ensuring `kodo:yolo` semantics still work when `opts.flags` is empty and explicit flags still apply when provided.
- **Files modified:** `src/session/manager.js`
- **Verification:** Not directly covered by a new test (behavior is inside `launchWorkItem` which isn't unit-tested), but the resulting flag composition is now deterministic and traceable via code review.
- **Committed in:** `4e5f5e6` (Task 2 GREEN)

**4. [Rule 2 — Missing Critical] `resolveProjectPath` error message lost project name**

- **Found during:** Task 2 GREEN
- **Issue:** The old code threw `No local path mapped for project "${project.name}"`, but the new code only has `task.projectId`. Dropping `projectName` from the error would degrade debuggability.
- **Fix:** Used `task.projectName || task.projectId` in the error message so the human-readable project name (populated by `normalizeWorkItem`) appears when available.
- **Files modified:** `src/session/manager.js`
- **Verification:** Covered by the `throws with helpful message when no path mapped` test asserting the error message contains `"No local path mapped"`.
- **Committed in:** `4e5f5e6` (Task 2 GREEN)

---

**Total deviations:** 4 auto-fixed (1 blocking, 2 missing critical, 1 bug)
**Impact on plan:** All four were necessary for correctness/robustness/debuggability. None changed the plan's architectural direction — the rewiring remains pure consumer migration onto the TaskProvider abstraction.

## Issues Encountered

- **Pre-existing 03-01 test failure observed at start of Task 1 GREEN.** Running the full suite produced `test/check.test.js` failure (`does not provide an export named 'checkPendingTasks'`). Investigation showed plan 03-01 had a committed RED but no GREEN — out of scope for 03-02. Logged in `.planning/phases/03-consumer-rewiring/deferred-items.md`. After completing Task 1, two new commits appeared in `git log` (`79e08fa feat(03-01): rewire check.js …` and `2787d20 feat(03-01): rewire session-start.js …`) — apparently a parallel 03-01 execution finished while 03-02 was running. By the time Task 2 completed, the full suite was back to green (96 passing). The deferred-items log remains as a record of the transient state.
- **`mock.module` unavailable on Node 24's test runner.** Initially considered mocking `loadConfig`/`loadProjects`/`addSession`/`cmux` to unit-test `launchWorkItem` end-to-end, but `node:test`'s `mock.module` API is not exposed in the shipped runtime. Pivoted to pure-helper extraction — better design anyway and produced more granular tests.
- **Working tree has unrelated uncommitted changes** (`src/hooks/session-start.js`, `.planning/config.json`, and previously `src/check.js` before the 03-01 commit landed). These belong to plan 03-01 and were left untouched; only 03-02 files were staged in each commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **03-02 delivers zero PlaneClient imports in `src/hooks/stop.js` and `src/session/manager.js`** — the two consumer files this plan targeted. Combined with the already-landed 03-01 commits for `check.js` and `session-start.js`, all four consumers identified in phase 3 are now on the TaskProvider abstraction.
- **Plan 03-01 has in-flight work** (`test/session-start.test.js` uncommitted changes still in the working tree) — its SUMMARY is still missing. Recommend running the 03-01 executor next to formalize those commits into a SUMMARY and complete the phase.
- **Ready for phase 3 verification / completion** once 03-01 is finalized.

---
*Phase: 03-consumer-rewiring*
*Completed: 2026-04-10*

## Self-Check: PASSED

- test/stop.test.js — FOUND
- test/manager.test.js — FOUND
- src/hooks/stop.js — FOUND
- src/session/manager.js — FOUND
- .planning/phases/03-consumer-rewiring/03-02-SUMMARY.md — FOUND
- Commit 7f4ffc5 (test RED for stop.js) — FOUND
- Commit 2f32b42 (feat GREEN for stop.js) — FOUND
- Commit 090ce50 (test RED for manager.js) — FOUND
- Commit 4e5f5e6 (feat GREEN for manager.js) — FOUND
