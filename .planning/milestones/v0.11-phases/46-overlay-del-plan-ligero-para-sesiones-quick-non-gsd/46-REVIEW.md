---
phase: 46-overlay-del-plan-ligero-para-sesiones-quick-non-gsd
reviewed: 2026-06-10T09:25:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/cli/dashboard/plan.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/SessionTable.js
  - test/dashboard-overlay.test.js
  - test/dashboard-plan.test.js
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 46: Code Review Report

**Reviewed:** 2026-06-10T09:25:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 46 adds a read-only lightweight-plan fallback (`readLightPlan`) to the `p` overlay: when a row is quick/non-GSD (`phaseId == null`) but carries a `task_id`, `readPlan` reads `~/.kodo/plans/<task_id>.md` and renders it. The core invariants hold up well under adversarial review:

- **Path-traversal containment is correct.** The guard at `plan.js:120-121` (`!includes('/') && !includes('\\') && !includes('..')`) runs at the call-site before `readLightPlan` is ever invoked, and the traversal test (`dashboard-plan.test.js:320-336`) asserts `readFileFn` is never called. Confirmed sound.
- **Never-throws holds.** Both the `resolvePhaseFn` throw path (caught at `plan.js:108`) and the `readFileFn` throw path (caught at `plan.js:73`) are wrapped; tests exercise both (a thrown resolver → `no-phase`; a `.code`-less Error → `error`).
- **ENOENT-vs-other discrimination is correct** (`plan.js:74-76`): `ENOENT` → `no-light-plan`, everything else → `error`. Tested for ENOENT, EACCES, and code-less Error.
- **Leaf isolation preserved.** `plan.js` imports only `node:fs`, `node:path`, `node:os` — no `src/config.js`, no render/color module. Verified.
- **Honest copy.** `OVERLAY_PLAN_NO_LIGHT` falls through to `dimColor` (SessionTable.js:160-165, 181), red is reserved for `error`. Verified.
- **Zero new endpoints**; the overlay stays synchronous and read-only.

No BLOCKERs found. The findings below are robustness, correctness-under-edge-input, and test-coverage gaps. The most material is **WR-01** (a real correctness gap in the `usable` guard that the traversal test does not actually catch) and **WR-02** (a latent crash-vector masked only by the surrounding try/catch).

No structural findings block was provided; this report is entirely narrative.

## Warnings

### WR-01: `usable` guard misses leading/embedded path separators and absolute paths via `task_id`

**File:** `src/cli/dashboard/plan.js:119-122`
**Issue:** The containment guard rejects `/`, `\`, and `..`, but a `task_id` such as `"."` or a Unicode/encoded variant is not the only gap — the more important one is what the guard *claims* vs. what it *checks*. The comment (plan.js:115-116, 119) asserts the path "nunca lee fuera del root fijo." But `join(plansDir, `${taskId}.md`)` with a `task_id` that has no separators yet equals `"."` produces `plansDir/..md` — harmless here, but a `task_id` of `""` is already filtered by the truthy check, so the real residual risk is narrow. The concrete defect: the guard relies on `String.includes('/')` which on Windows does catch `\\`, but an **absolute POSIX path is impossible without `/`** so that case is covered. The actual miss is that the guard does **not** verify the result still lives under `plansDir` (no `path.relative`/`startsWith(plansDir)` post-check). For the current input shape (provider UUIDs) this is safe, but the defense-in-depth claim in the threat model is asserted, not enforced — a future caller passing a differently-shaped id would not be protected by an independent post-join check.

The test at `dashboard-plan.test.js:320-336` only exercises `'../../etc/passwd'` (contains `/` and `..`), so it validates the happy rejection but does **not** prove containment for separator-free-but-still-escaping inputs. There is no input that escapes today, but the test gives false confidence that the guard is a containment guarantee rather than a denylist.

**Fix:** Make containment an enforced invariant rather than a denylist assertion. After building the path, verify it resolves under `plansDir`:
```js
import { resolve, sep } from 'node:path';
// in readLightPlan, before readFileFn:
const target = resolve(plansDir, `${taskId}.md`);
const root = resolve(plansDir) + sep;
if (!target.startsWith(root)) return { status: 'no-light-plan', lines: [] };
```
This keeps the denylist as a fast-path but makes the "fixed root" claim literally true (T-44-01) regardless of input shape, with no regex (anti-ReDoS preserved). At minimum, add a test for a separator-free escaping id to prove the guard is a guarantee.

### WR-02: `resolvePhaseFn` receives `projectPath: undefined` → `join(undefined,…)` throws by design

**File:** `src/cli/dashboard/plan.js:103-106` (cross-module with `src/gsd/resolver.js:40,44`)
**Issue:** `readPlan` passes `projectPath: row?.worktree_path ?? row?.project_path` to `resolvePhaseFn`. For a quick/non-GSD row (the exact Phase 46 target) `project_path` and `worktree_path` are frequently absent, so `projectPath` is `undefined`. `resolvePhase` (resolver.js:44) immediately calls `join(projectPath, '.planning', 'PROJECT.md')`, and `node:path.join(undefined, …)` throws `TypeError: Path must be a string`. This is currently swallowed by the try/catch at plan.js:102-111 (never-throws holds), so it is not a BLOCKER — but it means **every quick/non-GSD row without a project path takes the slow throw-and-catch path on every `p` press**, and the design depends on an exception for control flow rather than a clean `no-match`. A future refactor that narrows or removes that try/catch (e.g., to surface real resolver errors) would turn this into a crash. The light-plan tests never inject `resolvePhaseFn` (only the App.js integration does), so this path is unexercised in the pure suite.

**Fix:** Guard before delegating, so the resolver is only called with a usable base:
```js
const base = row?.worktree_path ?? row?.project_path;
if (phaseId == null && resolvePhaseFn && base) {
  try {
    const r = resolvePhaseFn({ projectPath: base, task: { … } });
    if (r && r.action === 'phase') phaseId = r.phase_id;
  } catch { /* never-throws */ }
}
```
This removes the exception-as-control-flow and makes the no-base case a clean fall-through to the light-plan branch.

### WR-03: light-plan path never checks `existsFn` → inconsistent with GSD branch; silent ENOENT round-trip

**File:** `src/cli/dashboard/plan.js:65-77` vs. `plan.js:135`
**Issue:** The GSD branch guards directory existence with `existsFn(phasesRoot)` (plan.js:135) before `readdir`. The light-plan branch has no equivalent: it goes straight to `readFileFn` and relies entirely on catching `ENOENT`. This is functionally correct (ENOENT → `no-light-plan`), but it is an inconsistent contract across the two branches of the same function, and it means the injected `existsFn` dep is silently ignored on the light-plan path. A test that injects `existsFn: () => false` expecting "not present" semantics (mirroring `dashboard-plan.test.js:177`) would not behave as the GSD branch does. Not a bug today because the catch handles ENOENT, but it is a latent inconsistency that will surprise the next maintainer who assumes `existsFn` gates all reads.

**Fix:** Either document explicitly that the light-plan branch is catch-based by design (cheaper: one read, no TOCTOU window — arguably the better pattern), or thread `existsFn` for symmetry. Given the never-throws catch already exists, prefer documenting the intentional divergence in the `readLightPlan` header comment so the asymmetry is a decision, not an accident.

### WR-04: integration tests mutate `process.env.HOME` — not hermetic, racy under parallel/`--test-concurrency`

**File:** `test/dashboard-overlay.test.js:526-551, 553-576`
**Issue:** The two PLAN-04 integration tests set `process.env.HOME = fakeHome` and restore it in `finally`. The phase context explicitly requires tests that exercise the outcomes "without touching real HOME." These tests touch the *process-global* HOME. node:test runs files in separate processes but can run tests **within** a file concurrently, and any other test (in this file or a shared worker) reading `homedir()` during the window between set and restore gets the fake home. The pure suite (`dashboard-plan.test.js`) correctly uses the `kodoPlansDir` DI seam and is hermetic; the integration suite does not because the `p` handler in App.js (App.js:502) hard-wires `readPlan(row, { resolvePhaseFn: resolvePhase })` with **no** `kodoPlansDir`/`homedirFn` seam. The test comment at overlay:524-525 even acknowledges this ("El handler `p` no tiene seam kodoPlansDir"). The root cause is a missing injection seam in App.js, not just the test.

**Fix:** Expose a seam so the integration test need not mutate global env. Minimal option: let App accept an optional `planDeps` prop (default `{ resolvePhaseFn: resolvePhase }`) and pass it to `readPlan`, so the test injects `{ kodoPlansDir }` instead of mutating `HOME`. If the env mutation must stay, at minimum these tests should be marked to run serially and the restore must be in `finally` (it is — good), but env mutation in a concurrent runner remains a flake source. Prefer the seam.

## Info

### IN-01: dead/misleading `existsFn` default for the light-plan branch

**File:** `src/cli/dashboard/plan.js:94`
**Issue:** `existsFn` is resolved as a dep (plan.js:94) but is only ever consulted on the GSD branch. For a row that hits the light-plan branch, `existsFn` is dereferenced from deps for nothing. Harmless, but the reader cannot tell from the dep list that `existsFn` is GSD-only. Tied to WR-03.
**Fix:** Move `existsFn` resolution into the GSD branch, or add a one-line comment that it is GSD-only.

### IN-02: `readLightPlan` re-resolves `readFileFn` independently of `readPlan`

**File:** `src/cli/dashboard/plan.js:66` vs. `plan.js:93`
**Issue:** `readPlan` computes `const readFileFn = deps.readFileFn || …` (plan.js:93) and `readLightPlan` recomputes the identical fallback from `deps` (plan.js:66). The `readPlan`-level `readFileFn` is unused on the light-plan path (the function returns before using it). Two sources of the same default invites drift if one is changed. Minor duplication.
**Fix:** Pass the already-resolved `readFileFn` into `readLightPlan(taskId, { readFileFn, plansDir })`, or accept the duplication with a comment. Cosmetic.

### IN-03: `no-light-plan` copy is reachable in the shared overlay switch from any kind

**File:** `src/cli/dashboard/SessionTable.js:160-165`
**Issue:** `renderOverlay`'s status switch is shared across `comments`/`logs`/`plan`. The `no-light-plan` branch is only ever produced by `readPlan`, so in practice it is plan-only (the comment at SessionTable.js:162-164 says so). But unlike the `error` branch (which keys copy off `isPlan`/`isLogs`), `no-light-plan` emits `OVERLAY_PLAN_NO_LIGHT` unconditionally. If a future comments/logs path ever returned `no-light-plan` it would show plan-specific copy in a comments overlay. Currently safe by construction; flagged as a latent coupling, not a live bug.
**Fix:** No change required now; if the switch grows, gate plan-specific copies behind `isPlan` as the `error` branch already does.

### IN-04: traversal test asserts rejection but mislabels it as proving containment

**File:** `test/dashboard-plan.test.js:320-336`
**Issue:** The test name claims "no lee fuera de plansDir (guard de contención D-09)" and asserts `readPath === null`. That proves the *denylist* fires for `'../../etc/passwd'`, not that *all* escaping inputs are contained (see WR-01). The assertion message ("NUNCA se invoca con una ruta que escape") overstates what one denylisted input demonstrates.
**Fix:** Either rename to reflect it tests the `..`/separator denylist specifically, or add the post-join containment check (WR-01) and a test for a separator-free escaping id.

---

_Reviewed: 2026-06-10T09:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
