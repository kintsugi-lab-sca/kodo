# Phase 44: Overlay de plan GSD + pulido de dashboard - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 6 (1 new + 5 modified) + tests
**Analogs found:** 6 / 6 (every file has a verbatim in-repo template)

All analogs verified against current source by `Read`/`grep`. Line numbers are real
(file state at mapping time). This phase is **pattern-extension only** — zero new
deps, zero new colors, zero new endpoints.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/plan.js` **(NEW)** | utility (pure DI fs reader) | file-I/O (sync, never-throws) | `src/gsd/verify.js:123-186` (discovery) + `src/cli/dashboard/client.js:49-116` (never-throws shape) | exact (composite) |
| `src/cli/dashboard/App.js` **(MODIFY)** | component (handler + constants + prop thread) | event-driven (keypress) | `c`/`l` handlers `App.js:391-463` + `OVERLAY_COMMENTS_*` `App.js:89-99` | exact (but SYNC — see divergence) |
| `src/cli/dashboard/SessionTable.js` **(MODIFY)** | component (render: overlay + column + state cell) | request-response (render) | `renderOverlay` `:119-165` + column header `:283-296` + state-cell IIFE `:314-318` | exact |
| `src/cli/dashboard/select.js` **(MODIFY)** | utility (pure derive) | transform | `countByStatus` `:193-201`, `sortSessions` `:44-62` | exact |
| `src/cli/dashboard/format.js` **(MODIFY/maybe no-op)** | utility (pure color/cell) | transform | `statusColor` `:108-116` (already v3-aware) | exact (likely zero-change) |
| `test/dashboard-plan.test.js` **(NEW)** + extends | test | n/a | `test/dashboard-overlay.test.js`, `test/dashboard-select.test.js`, `test/dashboard-table.test.js`, `test/format-isolation.test.js` | exact |

**Correction to upstream context:** the pattern-mapping prompt referenced
`test/dashboard/*.test.js` and `test/format-isolation.test.js`. The actual test
layout is **flat**: `test/dashboard-*.test.js` (no `test/dashboard/` subdir). The
new pure-helper test is `test/dashboard-plan.test.js`.

---

## Pattern Assignments

### `src/cli/dashboard/plan.js` (NEW — utility, file-I/O, sync, never-throws)

**Analogs:** `src/gsd/verify.js:123-186` (phase-dir discovery) + `src/cli/dashboard/client.js:49-60` (never-throws discriminant). **Copy structurally — do NOT import `verify.js`** (it is an async orchestrator with provider side-effects).

**Phase-dir discovery + ENOENT/EACCES mapping to copy** (`verify.js:126-186`):
```javascript
// Source: src/gsd/verify.js:126-186 — retarget VERIFICATION.md → *-PLAN.md glob
const padded = /^\d+$/.test(session.phase_id)
  ? session.phase_id.padStart(2, '0')
  : session.phase_id; // "02.1" se queda como está
const phasesRoot = join(session.worktree_path ?? session.project_path, '.planning', 'phases');
if (!existsFn(phasesRoot)) { /* missing */ }
else {
  let entries;
  try {
    entries = readdirFn(phasesRoot);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ENOENT') entries = [];
    else { /* malformed/error — NOT missing */ }
  }
  const match = entries.find((e) => e.startsWith(`${padded}-`));   // ← anti-ReDoS, String.startsWith (D-13)
  // ...readFileFn with its own try/catch for EACCES-after-exists
}
```
Key invariants to mirror: **`worktree_path ?? project_path` fallback**, **`startsWith(`${padded}-`)` prefix** (so "03" matches "03-foo" not "30-foo"), **DI params** `readdirFn`/`readFileFn`/`existsFn`, and **ENOENT→empty vs EACCES/other→error** (verify.js calls the latter `malformed`; in plan.js it collapses to `status:'error'`).

**Never-throws discriminant shape to copy** (`client.js:49-60`):
```javascript
// Source: src/cli/dashboard/client.js:49-60
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    // ...happy path...
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```
`readPlan` returns `{ status: 'ok'|'no-phase'|'no-plan'|'error', lines: string[] }` (the RESEARCH §Pattern 1 template at `44-RESEARCH.md:208-280` is the full verbatim recipe — executor copies it).

**resolvePhase fallback (D-03) — keep thin & crash-proof.** Signature confirmed `src/gsd/resolver.js:40` `resolvePhase({ projectPath, task })`, returns discriminated union `{action:'phase',phase_id}` | `{action:'bootstrap'}` | `{action:'error',code}`. **Critical (Pitfall 2):** `resolver.js:59` matches `normalizeTitle(task.title)` — but the dashboard row has **no `task.title`** (only `task_ref`/`summary`). So the fallback near-always returns `no-match`/`bootstrap` → collapses to `'no-phase'`. **Do NOT write a test asserting the fallback succeeds**; assert only that it never throws. `phase_id`-primary is the load-bearing path. `resolvePhase` is safe to import (pure-ish: only `existsSync`/`readFileSync`, no writes).

---

### `src/cli/dashboard/App.js` (MODIFY — component, event-driven keypress)

**Three edits:** (1) `OVERLAY_PLAN_*` constants, (2) `input === 'p'` handler, (3) thread `anyGsd` to SessionTable.

**(1) Constants — analog `OVERLAY_COMMENTS_*`/`OVERLAY_LOGS_*` (`App.js:89-99`):**
```javascript
// Source: src/cli/dashboard/App.js:89-99 — exported so tests assert equality (no string dup)
export const OVERLAY_COMMENTS_EMPTY = 'no comments yet';
export const OVERLAY_COMMENTS_NOT_FOUND = 'task not found';
export const OVERLAY_COMMENTS_ERROR = 'error fetching comments';
export const OVERLAY_COMMENTS_UNSUPPORTED = 'comments not supported by this provider';
```
Add `OVERLAY_PLAN_NO_PHASE` / `OVERLAY_PLAN_NO_PLAN` / `OVERLAY_PLAN_ERROR` (distinct, honest copy per D-07 — wording is discretion, distinctness is contract). EXPORTED so `SessionTable.js` imports them (same direction as today, see Shared Patterns / WARNING-01).

**(2) Handler — analog `c` handler (`App.js:391-433`), made SYNC:**
```javascript
// Source: src/cli/dashboard/App.js:391-433 (c handler) — adapt to SYNC (no await, no reqId)
if (input === 'c') {
  const row = sel.index >= 0 ? filtered[sel.index] : null;
  if (!row) return;
  const reqId = ++overlayReqRef.current;          // ← OMIT for `p` (sync, no await window)
  const res = await fetchComments(baseUrl, row.task_id, fetchFn);  // ← `p` calls readPlan(row,...) SYNC
  if (overlayReqRef.current !== reqId) return;    // ← OMIT for `p`
  // ...status discrimination...
  setOverlaySnapshot({ kind: 'comments', taskRef: row.task_ref ?? '', status, lines });
  setOverlayKind('comments');
  setScrollOffset(0);
  setMode('overlay');
  return;
}
```
**⚠ SYNC-vs-ASYNC DIVERGENCE (load-bearing, Pitfall 1 / UI-SPEC §Async guard divergence):** `c`/`l` are async (`await fetchComments`) and need `overlayReqRef` (CR-01) to discard a stale open superseded during the await. **`readPlan` is synchronous → no await window → no stale-reopen race → the `p` open must NOT capture `reqId`** (it would be dead/misleading code). The Esc-close path (`App.js:296-302`) already increments `overlayReqRef.current++` to invalidate *other* in-flight opens — that stays untouched and works for `plan` verbatim. Document this divergence in the plan so the executor does not cargo-cult the async guard.

**Overlay state typedefs to widen** (`App.js:225-229`): add `'plan'` to `overlayKind` (`'comments'|'logs'|'plan'|null`) and to `overlaySnapshot.kind`.

**(3) Thread `anyGsd`** — derive it over **`sorted`** (NOT `filtered`), at `App.js:265-268`:
```javascript
// Source: src/cli/dashboard/App.js:265-268 — derive anyGsd from `sorted` (filter-insensitive, D-08)
const sorted = sortSessions(sessions);
const filtered = applyFilter(sorted, parseFilter(query), deriveRepo);
// + const anyGsd = deriveAnyGsd(sorted);   ← from sorted, NOT filtered (Pitfall 4)
```
Pass `anyGsd` into the `createElement(SessionTable, {...})` prop bag at `App.js:556-573` (mirror how `overlayKind`/`scrollOffset` are threaded).

**Esc close — reused verbatim, NO change** (`App.js:296-302`): the existing escape/↑/↓ scroll branch already handles any `overlaySnapshot.lines[]` identically. `selectedTaskId` is untouched → cursor preserved by `task_id`.

---

### `src/cli/dashboard/SessionTable.js` (MODIFY — component, render)

**Three edits across the same file (TUI-18 + TUI-19 + overlay 'plan'). Owned by ONE plan to avoid intra-file conflict (see Shared-File Coordination).**

**(A) `renderOverlay` 'plan' kind — analog `:119-165`:**
```javascript
// Source: src/cli/dashboard/SessionTable.js:119-158 — extend kind + status branches
function renderOverlay(snap, scrollOffset, kind) {
  const isLogs = (kind ?? snap.kind) === 'logs';
  const titleText = `${isLogs ? 'logs' : 'comments'} · ${snap.taskRef}`;  // ← add 'plan' title
  // ...
  if (snap.status === 'ok') { /* slice scrollOffset..+OVERLAY_VIEWPORT, one <Text> per line */ }
  else {
    // map 'no-phase'/'no-plan' → dim informational (like `unsupported`); 'error' → red (like `not-found`/`error`)
    body = h(Text, { color, dimColor: color ? undefined : true }, copy);
  }
}
```
Map: `'no-phase'`→`OVERLAY_PLAN_NO_PHASE` dim, `'no-plan'`→`OVERLAY_PLAN_NO_PLAN` dim, `'error'`→`OVERLAY_PLAN_ERROR` red. Title `plan · <taskRef>` cyan bold (mirror of comments). The body `'ok'` slice path (`:133-140`) works for plan `lines[]` unchanged.

**(B) TUI-19 zombie mark in state cell — analog state-cell IIFE `:314-318`:**
```javascript
// Source: src/cli/dashboard/SessionTable.js:314-318 (CURRENT — shows green ▶ running for a zombie, the bug)
(() => {
  const badge = stateBadge(session.state ?? session.status ?? '');
  const text = (badge.glyph || badge.label) ? `${badge.glyph ?? ''} ${badge.label ?? ''}`.trim() : '';
  return cell({ width: COLS.state, text, color: badge.color, bold: selected, truncate: false });
})(),
```
Inject zombie branch (RESEARCH §Pattern 4, `44-RESEARCH.md:327-337`): when `(session.status === 'running' || session.state === 'running') && session.alive === false`, append ` (zombie)` to `text` and pull color from `statusColor(session.status ?? '', session.alive, session.state).color` (already `'red'` — `format.js:109`). **Zero new color, zero picocolors.** `statusColor` is already imported (used at `:302`).

**(C) TUI-18 conditional column drop — analog header `:291` + data cell `:323`:**
```javascript
// Source: src/cli/dashboard/SessionTable.js:291 (header) and :323 (data cell) — guard both behind anyGsd
h(Box, { width: COLS.phasemode }, h(Text, { dimColor: true }, 'phase/mode')),   // :291 header
cell({ width: COLS.phasemode, text: cells.phasemode, dim: cells.phasemode === NO_GSD_LABEL, bold: selected, truncate: true }),  // :323 cell
```
When `anyGsd === false`, **do not emit** the phasemode `<Box>` (header AND every data cell). Dropping the element reclaims its 11 cells for free — ink's `flexDirection:'row'` shifts siblings left, no width arithmetic (RESEARCH Pattern 3; A3 assumption, verifiable in render test). Add `anyGsd` to the prop destructure (`:199-216`) and its JSDoc.

**(D) `COLS.state` widen 16→18 (TUI-19)** — analog `COLS` at `:48`:
```javascript
// Source: src/cli/dashboard/SessionTable.js:48 — widen state so `▶ running (zombie)` (~18 cells) survives un-truncated
const COLS = { gutter: 2, state: 16, task_ref: 10, repo: 18, phasemode: 11, status: 18, task: 12, age: 7 };
```
Change `state: 16` → `state: 18`. The cell already renders `truncate: false` (`:317`), so widening is the clean path (Pitfall 3). **Update byte-stable assertions in `test/dashboard-table.test.js`.** The comment block `:38-43` documents the historical width tuning — match its convention if extending the comment.

---

### `src/cli/dashboard/select.js` (MODIFY — utility, pure derive, TUI-18)

**Analog:** `countByStatus` (`:193-201`) / `sortSessions` (`:44-62`) — pure, React-free, testable.
```javascript
// Source: pattern mirror of countByStatus (select.js:193-201) — same pure-derive shape
/** @param {Array<Partial<EnrichedSession>>} rows */
export function deriveAnyGsd(rows) {
  return rows.some((r) => r.phase_id != null);   // structural; consumed over `sorted`, NOT `filtered` (D-08)
}
```
One pure exported fn. No regex, no color, no React. Threaded in `App.js` over `sorted` (see App.js edit 3).

---

### `src/cli/dashboard/format.js` (MODIFY — likely ZERO change)

**Analog / existing:** `statusColor(status, alive, state)` at `:108-116` **already returns `{color:'red'}` for `running && !alive`** (line 109). TUI-19 consumes it as-is from `SessionTable.js`. **No edit to `statusColor` is needed.** Only touch `format.js` if the planner chooses to extract a `stateCell` helper (discretion) — RESEARCH recommends inline in `SessionTable.js` (simpler). Default: `format.js` is **untouched**.

---

### Tests

| File | Action | Analog | Covers |
|------|--------|--------|--------|
| `test/dashboard-plan.test.js` | NEW (pure unit) | `test/dashboard-select.test.js` (pure-fn DI harness) | PLAN-01/02, D-13: phase_id-primary, resolvePhase fallback never-throws, `44 vs 4` prefix, `*-PLAN.md` collection + ascending sort, multi-file `── <f> ──` concat, EACCES→error, ENOENT→no-plan, regex-special filename matched literally |
| `test/dashboard-overlay.test.js` | EXTEND | existing `c`/`l` ink tests | PLAN-01/02: `p` open, 3 distinct copy cases, Esc-preserves-cursor (`›` still on row). Inject fake fs into `readPlan` via deps OR temp `.planning/phases/` dir |
| `test/dashboard-select.test.js` | EXTEND | existing derive tests | TUI-18: `deriveAnyGsd` truth table over unfiltered rows |
| `test/dashboard-table.test.js` | EXTEND | existing byte-stable render tests | TUI-18 column-hide render + TUI-19 `(zombie)` mark + `COLS.state` width update |
| `test/format-isolation.test.js` | **NO edit** | — | D-12: walker enforces picocolors imported from exactly ONE file (`src/cli/format.js`); auto-covers new `plan.js` the moment it exists |

**Quick run:** `node --test test/dashboard-overlay.test.js test/dashboard-select.test.js test/dashboard-format.test.js test/dashboard-table.test.js`. **Full suite:** `node --test`.

---

## Shared Patterns

### Never-throws filesystem contract
**Source:** `src/gsd/verify.js:142-186` (ENOENT/EACCES mapping) + `src/cli/dashboard/client.js:50-59` (try/catch → discriminant)
**Apply to:** `plan.js` (every `readdir`/`readFile`/dir-resolution wrapped; failures collapse to `status`, never throw). Cross-milestone invariant "TUI nunca crashea" (STATE.md). The `p` handler never bare-`await`s.

### Frozen overlay snapshot + scroll + Esc-preserves-cursor
**Source:** `src/cli/dashboard/App.js:296-317` (Esc/↑/↓ branch, untouched) + `setOverlaySnapshot`/`OVERLAY_VIEWPORT` (`App.js:126`)
**Apply to:** the `plan` overlay — fourth consumer of `mode:'overlay'`. Zero new sub-mode (D-02/D-06). `Esc` leaves `selectedTaskId` intact → cursor free on return.

### Color isolation (D-12) — zero picocolors under `src/cli/dashboard/`
**Source:** enforced by `test/format-isolation.test.js:98-127` (picocolors imported from EXACTLY ONE file: `src/cli/format.js`)
**Apply to:** ALL files incl. new `plan.js`. Color comes ONLY from ink `<Text color>` string names / `dimColor`. The TUI-19 red is read from `statusColor` (`format.js:109`), not a new literal.

### Anti-ReDoS (D-13) — String matching, never `new RegExp`
**Source:** `verify.js:160` `entries.find((e) => e.startsWith(`${padded}-`))`; `select.js:159-176` `String.includes`
**Apply to:** plan-dir prefix (`startsWith`), `*-PLAN.md` collection (`endsWith`), any filename match. No regex compiled from filesystem-derived strings.

### Exported copy constants (kill string drift)
**Source:** `App.js:89-99` `OVERLAY_*` exported, imported by `SessionTable.js:29-36` and by tests
**Apply to:** `OVERLAY_PLAN_*` — declared in `App.js`, imported by `SessionTable.js` (same edge direction), asserted by tests.

---

## ⚠ WARNING-01 — ESM import cycle (App.js ↔ SessionTable.js)

**VERIFIED at mapping time** (`grep`):
- `App.js:68` → `import SessionTable from './SessionTable.js'`
- `SessionTable.js:36` → `} from './App.js'` (imports `OVERLAY_*`, `OVERLAY_VIEWPORT`, `DISMISS_CONFIRM` constants)

This is a real runtime-resolved ESM cycle (App imports the SessionTable default; SessionTable imports App's named constants). It resolves today because the constants are module-top exports evaluated before render.

**Plans MUST NOT worsen it:**
- `OVERLAY_PLAN_*` go in `App.js`, imported by `SessionTable.js` — **same direction, no new edge.**
- Do **NOT** add `import ... from './SessionTable.js'` anywhere new in `App.js` beyond the existing default import.
- Do **NOT** import `App.js` from leaf modules `select.js` / `format.js` / `plan.js`. Keep them leaves (imported *by* App, importing neither App nor SessionTable).
- `plan.js` imports only `node:fs`, `node:path`, and (optionally) `src/gsd/resolver.js` — never a dashboard render module.
- Run the full suite after wiring to confirm the cycle still resolves.

---

## Shared-File Coordination (blast radius)

| File | plan-overlay | TUI-18 | TUI-19 |
|------|:---:|:---:|:---:|
| `App.js` | ✅ handler + `OVERLAY_PLAN_*` | ✅ compute+thread `anyGsd` | — |
| `SessionTable.js` | ✅ renderOverlay 'plan' | ✅ drop phasemode col | ✅ state-cell mark + `COLS.state` |
| `select.js` | — | ✅ `deriveAnyGsd` | — |
| `plan.js` (new) | ✅ | — | — |
| `format.js` | — | — | none (statusColor already correct) |

**Both overlay and polish touch `App.js` AND `SessionTable.js` → cannot run in parallel without conflict.** RESEARCH recommends 2 sequential plans (granularity `coarse`): **44-01** plan-helper + overlay wiring (`plan.js` new + `App.js` handler/constants + `SessionTable.renderOverlay`), then **44-02** TUI-18 + TUI-19 (`select.js` + `App.js` anyGsd thread + `SessionTable.js` column-drop & state-cell & `COLS.state`). Do **NOT** split TUI-18 and TUI-19 — they edit the same `SessionTable.js` body and would conflict with each other.

---

## No Analog Found

None. Every file has a verbatim in-repo template:

| File | Status |
|------|--------|
| `plan.js` | composite analog (`verify.js` discovery + `client.js` never-throws) — exact |
| all others | exact analog in the same or sibling module |

---

## Metadata

**Analog search scope:** `src/cli/dashboard/` (App, SessionTable, select, format, client), `src/gsd/` (verify, resolver), `test/`
**Files scanned:** App.js, SessionTable.js, select.js, format.js, client.js, verify.js, resolver.js + test layout
**Verified facts:** import-cycle direction (App→SessionTable default, SessionTable→App constants); `statusColor:109` already red for `running+!alive`; `COLS:48` state=16; resolver matches `task.title` (absent on row); test layout is flat `test/dashboard-*.test.js`; format-isolation walker enforces single picocolors source
**Pattern extraction date:** 2026-06-09
