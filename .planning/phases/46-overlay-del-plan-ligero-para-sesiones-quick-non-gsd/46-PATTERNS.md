# Phase 46: Overlay del plan ligero para sesiones quick/non-GSD - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 4 (all MODIFY — no greenfield files)
**Analogs found:** 4 / 4 (every change has an exact in-file or sibling analog)

> **Nature of this phase:** Surgical edit of three source files + tests. There are no new files — for each modification the closest analog is *its own current structure* (the GSD branch it sits beside). The fallback rides the existing `{ status, lines }` overlay machinery; the only genuinely new surface is one copy constant, one render branch, and a private helper. Copy the established forms verbatim; do not invent new shapes.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/plan.js` | reader (pure, leaf) | file-I/O (read-only, never-throws) | GSD read logic in the **same file** (`plan.js:82-114` readdir/readFile try/catch + ENOENT mapping) | exact (in-file) |
| `src/cli/dashboard/App.js` | provider (copy constants) | transform (status→copy literal) | `OVERLAY_PLAN_NO_PHASE/NO_PLAN/ERROR` block in **same file** (`App.js:110-112`) | exact (in-file) |
| `src/cli/dashboard/SessionTable.js` | component (render) | transform (status→copy branch) | the `no-phase`/`no-plan`/`error` render branch in **same file** (`SessionTable.js:153-173`) | exact (in-file) |
| `test/dashboard-plan.test.js` | test (unit, DI) | file-I/O (mocked) | `makeFs` DI pattern + describe blocks in **same file** (`dashboard-plan.test.js:34-70`) | exact (in-file) |
| `test/dashboard-overlay.test.js` | test (integration, Ink) | transform (frame assert) | `planStatus` fixture + `p`-key tests (`dashboard-overlay.test.js:443-512`) | exact (in-file) — **must update, see Pitfall** |

---

## Pattern Assignments

### `src/cli/dashboard/plan.js` (reader, file-I/O)

**Analog:** itself — the existing GSD read path. Three concrete templates to copy.

**Template A — Imports (leaf-only, builtins).** Current imports at `plan.js:30-31`. Add `homedir` from `node:os` (builtin → preserves leaf-isolation per D-07; **do not** import `src/config.js`):
```javascript
// plan.js:30-31 (current)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// ADD (D-07): node:os is builtin, keeps plan.js a graph leaf — same convention as config.js:4
import { homedir } from 'node:os';
```

**Template B — DI default pattern.** Copy the `deps.X || default` shape from `plan.js:48-51` for any new override (`kodoPlansDir` / `homedirFn`):
```javascript
// plan.js:48-51 (the DI convention to mirror)
const readdirFn = deps.readdirFn || readdirSync;
const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
const existsFn = deps.existsFn || existsSync;
const resolvePhaseFn = deps.resolvePhaseFn; // no default (fallback only if injected)
```

**Template C — ENOENT-vs-error discrimination (THE core pattern to copy).** This is the exact never-throws read shape from `plan.js:86-92`. The new `readLightPlan` helper must mirror it, but map `ENOENT → no-light-plan` (not `no-plan`) per D-05:
```javascript
// plan.js:86-92 (canonical never-throws + ENOENT mapping — COPY THIS FORM)
try {
  entries = readdirFn(phasesRoot);
} catch (err) {
  const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
  if (code === 'ENOENT') entries = [];        // GSD: absent tree → empty
  else return { status: 'error', lines: [] }; // non-ENOENT → error
}
```
New helper applies the same skeleton with the D-05 mapping (content→`ok`, ENOENT→`no-light-plan`, other→`error`):
```javascript
// readLightPlan(taskId, deps) — derived from plan.js:86-92 + 122-133 (split('\n') render)
try {
  const md = readFileFn(join(plansDir, `${taskId}.md`)); // path CONSTRUCTED, not regex-derived (D-09)
  return { status: 'ok', lines: md.split('\n') };          // same flat render as plan.js:126
} catch (err) {
  const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
  if (code === 'ENOENT') return { status: 'no-light-plan', lines: [] }; // absent → honest copy (D-04)
  return { status: 'error', lines: [] };                                 // EACCES/other → error
}
```

**Template D — Insertion point (`plan.js:69`).** The single line to replace. Narrow `no-phase` (D-06): it stays terminal only when `task_id` is falsy.
```javascript
// plan.js:69 (BEFORE):
if (phaseId == null) return { status: 'no-phase', lines: [] };
// AFTER (D-02/D-03/D-06):
if (phaseId == null) {
  const taskId = row?.task_id;
  if (taskId) return readLightPlan(taskId, deps); // D-05 mapping
  return { status: 'no-phase', lines: [] };       // terminal: no task_id (defensive)
}
```

**Path-resolution convention (D-07).** Mirror `config.js:6` — `KODO_DIR = join(homedir(), '.kodo')` — and the producer at `session-start.js:85` which writes `join(KODO_DIR, 'plans', \`${session.task_id}.md\`)`. The consumer path must be **byte-identical**:
```javascript
// config.js:6 (producer derives KODO_DIR from this; replicate the FORM, don't import)
const KODO_DIR = join(homedir(), '.kodo');
// consumer (plan.js): join(homedir(), '.kodo', 'plans', `${taskId}.md`)
```
**Path-divergence cleared (Pitfall 1 / Open Q1 RESOLVED):** `config.js:6` computes `KODO_DIR` directly from `homedir()` with **no env-var recompute** (env isolation in tests works *through* `homedir()` honoring `process.env.HOME`, per observations 21811/22683/23215 — not via a `KODO_DIR` override). So `homedir()` inline in `plan.js` produces the identical root as the producer in production. No divergence risk. The `deps.kodoPlansDir` override is for test isolation only.

**Containment guard (D-09, optional but recommended).** Copy the `String.includes` guard already used at `plan.js:98,109` — never `new RegExp` (anti-ReDoS, structurally enforced by test:261-267):
```javascript
// plan.js:98 (the WR-01 containment form to reuse on task_id if adopted)
!e.includes('/') && !e.includes('\\') && !e.includes('..')
// applied to task_id: a failing guard → no-phase (same treatment as falsy task_id)
```
`task_id` is a provider UUID (`src/session/state.js:15`) with no separators; the guard makes the "fixed root" threat-model claim literally true. Cheap; recommended.

---

### `src/cli/dashboard/App.js` (provider, copy constant)

**Analog:** `App.js:110-112` — the existing `OVERLAY_PLAN_*` block. Copy verbatim as the pattern for the new constant. Place the new constant adjacent (~line 113), inside the same Phase-44-D-07 comment block.

```javascript
// App.js:110-112 (existing — the EXACT pattern to mirror)
export const OVERLAY_PLAN_NO_PHASE = 'not a GSD session / no phase resolved';
export const OVERLAY_PLAN_NO_PLAN = 'phase has no PLAN.md yet';
export const OVERLAY_PLAN_ERROR = 'error reading plan';
// ADD (D-04): honest copy, DISTINCT from NO_PHASE/NO_PLAN (dim/informative, not error). Literal at planner discretion:
export const OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet';
```

**Handler `p` does NOT change (D-01).** Confirmed at `App.js:482-501`: `readPlan(row, { resolvePhaseFn: resolvePhase })` is **synchronous** (no await, no `overlayReqRef` check — see the explicit comment at `App.js:486-492`). The fallback rides the same `setOverlaySnapshot({ kind:'plan', taskRef, status: res.status, lines: res.lines })` path. Do not touch this handler.

---

### `src/cli/dashboard/SessionTable.js` (component, render branch)

**Analog:** `SessionTable.js:153-173` — the existing status→copy branch. The new `no-light-plan` must mirror the **dim** treatment of `no-phase`/`no-plan` (NOT the red of `error`).

**Import (`SessionTable.js:34-36`).** Add the new constant to the existing import block (kills code/render drift, Pitfall 4):
```javascript
// SessionTable.js:34-36 (current import — add OVERLAY_PLAN_NO_LIGHT here)
  OVERLAY_PLAN_NO_PHASE,
  OVERLAY_PLAN_NO_PLAN,
  OVERLAY_PLAN_ERROR,
// ADD: OVERLAY_PLAN_NO_LIGHT,
```

**Render branch (insert beside `SessionTable.js:153-158`).** Copy the dim branch form (no `color` set → falls through to `dimColor: true` at line 174):
```javascript
// SessionTable.js:153-158 (existing dim branches — COPY this shape, NOT the red one)
if (snap.status === 'no-phase') {
  copy = OVERLAY_PLAN_NO_PHASE;          // dim (no color assigned)
} else if (snap.status === 'no-plan') {
  copy = OVERLAY_PLAN_NO_PLAN;           // dim, DISTINCT from no-phase
}
// ADD (D-04): new dim branch — mirrors no-phase/no-plan, NOT the red error branch:
} else if (snap.status === 'no-light-plan') {
  copy = OVERLAY_PLAN_NO_LIGHT;          // dim (informative), distinct copy
}
```
The dim-vs-red switch is at `SessionTable.js:174`: `dimColor: color ? undefined : true`. Leaving `color` unset = dim. The `error` branch (`SessionTable.js:166-169`) sets `color = 'red'` — **do not** follow that branch for `no-light-plan`.

---

### `test/dashboard-plan.test.js` (test, unit DI)

**Analog:** `dashboard-plan.test.js:34-70` — the `makeFs` DI builder and describe-block structure. The new tests reuse `deps.readFileFn` plus a `kodoPlansDir` override (no real disk, no real HOME).

**DI builder to extend (`dashboard-plan.test.js:34-52`).** The existing `makeFs` returns `{ existsFn, readdirFn, readFileFn }` driven by in-memory `dirs`/`files` maps where a missing key throws an `err.code = 'ENOENT'`. For the fallback, the simplest form is an inline `readFileFn` plus `kodoPlansDir` (RESEARCH:286-328 already drafted the 5 cases). Build errors the same way the existing builder does:
```javascript
// dashboard-plan.test.js:44-50 (the ENOENT-throwing readFileFn shape to reuse)
readFileFn: (p) => {
  if (p in files) return files[p];
  const err = new Error(`ENOENT: ${p}`);
  err.code = 'ENOENT'; // <- discriminant the helper keys on
  throw err;
},
```
**Cases to add** (new `describe('readPlan — fallback plan ligero (D-05/D-08/D-09)')`, mirroring RESEARCH:286-328):
1. `task_id` + artifact present → `ok` (lines include content)
2. `task_id` + ENOENT → `no-light-plan`
3. `task_id` + EACCES (`err.code='EACCES'`) → `error`
4. no `phase_id` + no `task_id` → `no-phase` (D-06 terminal)
5. `readFileFn` throws plain Error (no `.code`) → `error` AND `assert.doesNotThrow` (never-throws, D-09)
6. (if guard adopted) `task_id: '../../etc/passwd'` → `no-phase`, never reads outside plans dir

**Structural anti-ReDoS test is already present** (`dashboard-plan.test.js:261-267`): asserts `plan.js` contains no `new RegExp`. The fallback must keep this green — construct the path, never compile a regex from `task_id`.

---

### `test/dashboard-overlay.test.js` (test, integration Ink) — **REGRESSION RISK, read before editing**

**Analog:** `planStatus` fixture (`dashboard-overlay.test.js:443-470`) + the `p`-key frame-assert tests (`:499-512`).

**CRITICAL — Pitfall 3 CONFIRMED, not hypothetical.** The `planStatus({})` fixture **hardcodes `task_id: 'a'`** at `dashboard-overlay.test.js:448` (verified). The existing no-phase test at `:499-512` renders `planStatus({})` and asserts `OVERLAY_PLAN_NO_PHASE`. The handler `p` (`App.js:495`) calls `readPlan(row, { resolvePhaseFn })` with **no `kodoPlansDir` override** → after this phase, that row (which now has `task_id: 'a'`) triggers `readLightPlan`, reads the **real HOME** `~/.kodo/plans/a.md`, and — absent that artifact — yields `no-light-plan`, **breaking the existing `no-phase` assert.**

**Required fix (planner must choose one, keep BOTH cases covered):**
- **Option A (preserve the pure `no-phase` case):** give the no-phase fixture a row with **no `task_id`** (the fallback won't fire → stays `no-phase`). `planStatus` currently can't omit `task_id` — add a fixture variant or strip it for that test.
- **Option B (convert + add):** update the existing assert to expect `OVERLAY_PLAN_NO_LIGHT` (since a `task_id` with no artifact is now the honest state), AND add a separate fixture/test that still produces pure `no-phase` (row without `task_id`).
- Either way, add a NEW integration test: a row with `task_id` whose artifact exists (write `~/.kodo/plans/<id>.md` into a `mkdtemp` HOME, or use the existing `mkdtempSync`/`writeFileSync` pattern at `:515-520`) → frame shows the plan content via the same `setOverlaySnapshot` path.

**Note on HOME isolation in integration tests:** unlike the unit tests, the Ink integration goes through the real `readPlan` with production deps — there is no `kodoPlansDir` seam at the handler. Isolate via the `mkdtempSync` + `process.env.HOME` pattern already used in this file (`:515`, and observations 21811/22683 confirm `homedir()` honors `HOME`). This is the only place real-disk/HOME matters; the unit tests stay pure via `kodoPlansDir`.

---

## Shared Patterns

### Never-throws / best-effort (Phase 44 D-05)
**Source:** `src/cli/dashboard/plan.js:86-92, 111-113, 122-131`
**Apply to:** the new `readLightPlan` helper.
Every filesystem read is wrapped so no error reaches React; an unreadable file degrades to a `status`, never propagates. The fallback inherits this — its own try/catch maps ENOENT→`no-light-plan`, other→`error`.

### Anti-ReDoS / path containment (Phase 44 D-13 / D-09, hardening 23076)
**Source:** `src/cli/dashboard/plan.js:97-99, 109`
**Apply to:** the `task_id` interpolation in the artifact path.
Match/contain with `String.includes` (`!includes('/') && !includes('\\') && !includes('..')`) — never `new RegExp` from input. The path is **constructed**, not regex-derived. Structurally enforced by `dashboard-plan.test.js:261-267`.

### Honest-copy per case (Phase 44 D-07)
**Source:** `src/cli/dashboard/App.js:104-112` (constant block) + `SessionTable.js:153-174` (render switch)
**Apply to:** the new `no-light-plan` status.
Each empty state gets its own distinct, NO_COLOR-legible copy. `no-light-plan` is dim/informative (mirrors `no-phase`/`no-plan`), NOT red (`error`). Reusing `OVERLAY_PLAN_NO_PLAN` would lie about a quick session — forbidden by D-04.

### Leaf-isolation (WARNING-01 / color-isolation Phase 44 D-12)
**Source:** `src/cli/dashboard/plan.js:25-31` (header + imports), `src/config.js:4,6` (homedir convention)
**Apply to:** the new import.
`plan.js` imports only Node builtins. `homedir` from `node:os` is a builtin — adding it preserves the leaf. **Do not** import `src/config.js` (it drags `loadEnvFile()` / I/O). Replicate the `join(homedir(), '.kodo')` form instead.

### Copy constant exported, render imports it (drift-killer, Pitfall 4)
**Source:** `App.js:110-112` (export) ← `SessionTable.js:34-36` (import)
**Apply to:** `OVERLAY_PLAN_NO_LIGHT`.
The literal lives once in `App.js`, is imported by `SessionTable.js`, and asserted by tests via the same import — no duplicated string anywhere.

---

## No Analog Found

None. Every modification has an exact in-file or sibling analog. This phase introduces zero new structural shapes:

| Concern | Why no analog needed |
|---------|----------------------|
| Light-plan read | `plan.js` GSD read path (same file) is the template |
| New copy constant | `OVERLAY_PLAN_*` block (same file) is the template |
| New render branch | `no-phase`/`no-plan` dim branch (same file) is the template |
| DI unit tests | `makeFs` + describe blocks (same file) are the template |

---

## Metadata

**Analog search scope:** `src/cli/dashboard/` (plan.js, App.js, SessionTable.js), `src/config.js`, `src/hooks/session-start.js`, `test/dashboard-plan.test.js`, `test/dashboard-overlay.test.js`
**Files scanned:** 7
**Open questions resolved during mapping:**
- **Q1 (KODO_DIR env divergence):** RESOLVED — `config.js:6` derives `KODO_DIR` directly from `homedir()`, no env recompute; `homedir()` inline matches producer byte-for-byte in production. Test isolation flows through `process.env.HOME` (honored by `homedir()`), not a `KODO_DIR` override.
- **Q2 (no-phase fixture carries task_id):** RESOLVED — CONFIRMED `planStatus` hardcodes `task_id: 'a'` (`dashboard-overlay.test.js:448`). The existing `:499` no-phase integration test WILL break; planner must apply Option A or B above.

**Pattern extraction date:** 2026-06-10
