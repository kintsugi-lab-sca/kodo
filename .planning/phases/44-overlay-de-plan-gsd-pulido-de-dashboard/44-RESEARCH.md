# Phase 44: Overlay de plan GSD + pulido de dashboard - Research

**Researched:** 2026-06-09
**Domain:** ink TUI overlay (read-only filesystem read) + pure derive-layer polish (column hide + per-row zombie mark)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Overlay key is **`p`** (mnemonic "plan"). Verified free in `App.js` mode-gated `useInput` (taken: `q`, `/`, `c`, `l`, `d`, arrows, Enter, Esc). Exact mirror of the `c`/`l` overlay pattern.
- **D-02:** Reuses the existing `mode:'overlay'` (fourth mode alongside `list`/`filter`/`confirm`). Reuses the **frozen snapshot** (`setOverlaySnapshot`), `scrollOffset` + `OVERLAY_VIEWPORT` scroll, and `Esc` close that **preserves the cursor by `task_id`** (does not touch `selectedTaskId`). The anti-stale `overlayReqRef` guard (CR-01 of Phase 39) is reused.
- **D-03:** Phase source: **`row.phase_id` already persisted** in the dashboard row is the PRIMARY source (`GET /status` spreads `...s` of `SessionRecord` → `phase_id`, `project_path`, `worktree_path`, `task_id`, `task_ref` available on the row — **no `findSession`**). If `phase_id` is absent, fall back to `resolvePhase({ projectPath: worktree_path ?? project_path, task })`. The overlay derives everything from the **row revalidated by `task_id`**, not a state re-fetch.
- **D-04:** Read path: phase directory located by **number prefix** under `.planning/phases/` (glob `<phase_id>-*/`) from **`worktree_path ?? project_path`** (transparent fallback, mirror of how `kodo gsd verify` reads `VERIFICATION.md`). Plan files collected by pattern **`*-PLAN.md`** inside that directory.
- **D-05:** **never-throws / best-effort:** ALL reading (dir resolution, glob, `readFile`) wrapped so no filesystem error reaches React. Any failure collapses to a discrete `status` (D-07), never a throw. Mirror of the never-throws contract of `client.js` / `c`/`l` overlays. The overlay handler **never bare-`await`s** something that can reject uncaught.
- **D-06:** When the phase has **multiple** `PLAN.md` (e.g. `44-01-PLAN.md`, `44-02-PLAN.md`), they are shown **concatenated** in the same flat `lines[]` snapshot, separated by a **per-file header** (e.g. `── 44-01-PLAN.md ──`), sorted ascending by filename. Reuses the existing scrollable viewport — **zero new sub-navigation / sub-mode**.
- **D-07:** `OVERLAY_PLAN_*` constants in `App.js`, lexical mirror of `OVERLAY_COMMENTS_*`, with **distinct copy per case**:
  - Non-GSD task / no phase resolved → e.g. `'not a GSD session / no phase resolved'`
  - Phase resolved but no `PLAN.md` → e.g. `'phase has no PLAN.md yet'`
  - File/FS read error → e.g. `'error reading plan'`
  - (Multiple `PLAN.md` is NOT an empty state: concatenated, D-06.)
- **D-08 (TUI-18):** **PURE React-free** derivation in `select.js`/`format.js`: `anyGsd = rows.some(r => r.phase_id != null)` over the set of **active sessions** (the `/status` rows), **NOT** sensitive to the `/` filter text (the column is structural, must not flicker on keystroke). If `anyGsd === false`, the `phase/mode` column **is not rendered** and its width is reclaimed/reassigned; it reappears automatically when a row with `phase_id` enters.
- **D-09 (TUI-19):** In the **`state` cell**, when the row is zombie (`running` + `alive === false`), add a **textual `(zombie)` mark** and **red** color, both coming from `statusColor(status, alive, state)` which is **already v3-aware** (zombie red LOCKED). **Zero new color, zero picocolors.** The header zombie counter is **kept** (per-row mark is additive, not a replacement).
- **D-10:** **Zero new endpoints.** Overlay reads the filesystem (glob + `readFile`), mirror of `focus.js` invoking cmux. `src/server.js` untouched.
- **D-11:** **Read-only.** The overlay never writes `PLAN.md`. The only read-write surface of the TUI remains the v0.10 dismiss.
- **D-12:** **Color isolation.** `src/cli/dashboard/` does not import `picocolors` (including the TUI-19 per-row zombie). Guarded by `test/format-isolation.test.js`.
- **D-13:** **Anti-ReDoS.** Any new matching/filter uses `String.includes`, never `new RegExp`.

### Claude's Discretion

- Exact wording of `OVERLAY_PLAN_*` constants (D-07) and separator header format (D-06) — contract is "distinct per case" + "honest".
- Plan-reading helper(s): pure testable module with DI (mirror of `grepLogs`/`fetchComments`) vs inline in handler — planner's decision, keeping the never-throws contract (D-05).
- Exact width-recalc mechanics when hiding `phase/mode` (D-08) — depends on the current columnar layout of `SessionTable.js`/`format.js`.

### Deferred Ideas (OUT OF SCOPE)

- **Capture/visualization of plan for non-GSD/quick sessions** → Phase 45 (spike PLAN-03) + Phase 46 (PLAN-04, conditional/cuttable). The Phase 44 overlay is designed to be **reused** for those sessions if Phase 46 proceeds (same `mode:'overlay'`, same snapshot).
- **Show all live Tasks/todos of a session** → v2 (PLAN-F1/PLAN-F2): no supported data source today.
- **Navigable multi-PLAN.md list** (vs D-06 concatenation) → reconsider in a future polish only if concatenation proves uncomfortable. Not now (YAGNI).
- **Parsing raw JSONL transcript, `~/.claude/plans/`, `~/.claude/todos/`** → out of scope (undocumented format).
- **Editing/writing `PLAN.md` from the dashboard** → overlay is read-only.
- **New endpoints in `src/server.js`** → overlay reads the filesystem directly.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-01 | Overlay (dedicated key, next to `c`/`l`) shows the `PLAN.md` of the GSD phase of the selected task, reusing `resolvePhase` to map task→phase and reading `.planning/phases/<phase>/<N>-NN-PLAN.md` from `worktree_path ?? project_path`. | `verify.js` is the verbatim template for phase-dir discovery (readdir + prefix match from `worktree_path ?? project_path`); `App.js` `c`/`l` handler is the overlay template; `row.phase_id` is primary, `resolvePhase` is fallback (see §Architecture Pattern 1, §Plan File Discovery). |
| PLAN-02 | Overlay honestly distinguishes content-less cases (non-GSD/no phase, no PLAN.md, multiple PLAN.md), frozen snapshot under live poll, `Esc` preserves cursor, never-throws. | `OVERLAY_COMMENTS_*` discriminant pattern in `App.js`; `renderOverlay` status branches in `SessionTable.js`; never-throws contract from `client.js`/`verify.js` WR-02 (see §Pattern 2, §Common Pitfalls). |
| TUI-18 | Hide `phase/mode` column when no active session is GSD; reclaim width; reappear when a GSD session enters. Pure (React-free) derivation. | `anyGsd` derivation belongs in `select.js`; column layout (`COLS` object) in `SessionTable.js` is the surface to edit (see §Pattern 3). |
| TUI-19 | Mark zombie state per-row in the `state` column (not only the header counter). Color only from `<Text>` of ink. | `statusColor` already returns red for `running + !alive`; `stateBadge`/`state` cell in `SessionTable.js` is the injection point (see §Pattern 4). |
</phase_requirements>

## Summary

Phase 44 is a **low-risk, pattern-extension** phase. Every capability has an exact existing template in the codebase, so there is almost no genuinely new ground — the work is disciplined mirroring plus careful shared-file coordination.

The plan overlay (PLAN-01/02) is the convergence of two existing patterns: (1) the **`c`/`l` overlay machinery** in `App.js`/`SessionTable.js` (frozen snapshot, `scrollOffset`, `overlayReqRef` anti-stale guard, `Esc`-preserves-cursor) provides the UX shell, and (2) **`src/gsd/verify.js`** provides the *exact* filesystem-read recipe: it discovers `.planning/phases/<padded>-<slug>/` via `readdirSync` + `startsWith(`${padded}-`)` prefix match from `worktree_path ?? session.project_path`, with injectable `readdirFn`/`readFileFn`/`existsFn` for testability and granular `ENOENT → missing` vs `EACCES → malformed` error mapping. The plan helper is `verify.js`'s phase-discovery logic, retargeted from `<padded>-VERIFICATION.md` to a `*-PLAN.md` glob, with the never-throws contract collapsing all failures to a discriminated `status`.

**One important correction to a CONTEXT assumption:** the dashboard row does **not** carry a clean `task.title`. The `SessionRecord` has `task_ref` ("KL-42") and `summary`, but `resolvePhase({projectPath, task})` matches `normalizeTitle(task.title)` against ROADMAP phase headings — and `task.title` is not a field present on the `/status` row. This means **`row.phase_id` is the real path** (and it is reliably present for GSD sessions: the dispatcher persists it after a successful resolve). `resolvePhase` as a fallback is **best-effort only** and, given the missing `task.title`, will usually return `no-match`/`bootstrap` for a dashboard row — which is fine, because that simply collapses to the "no phase resolved" copy (D-07). The plan should treat `phase_id`-primary as load-bearing and `resolvePhase` fallback as a thin, tolerant, never-crashing afterthought.

The polish items are pure-derive edits: TUI-18 is a one-line `anyGsd` derivation in `select.js` plus a conditional drop of the `phasemode` column (and its width) in `SessionTable.js`; TUI-19 is a textual `(zombie)` mark injected into the `state` cell, colored by the already-v3-aware `statusColor`. Both honor color-isolation (zero picocolors) and anti-ReDoS automatically since they add no regex and no color import.

**Primary recommendation:** Build the plan-reading helper as a pure DI module (`src/cli/dashboard/plan.js`) copied structurally from `verify.js`'s phase-discovery block, returning a never-throws discriminated `{status, lines}`; wire it into `App.js` as a synchronous fourth overlay handler (`input === 'p'`); land TUI-18 and TUI-19 as separate small derive-layer edits. Split into 2-3 plans by shared-file blast radius (see §Shared-File Coordination).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Plan-file discovery + read (PLAN-01) | Filesystem read helper (`src/cli/dashboard/plan.js`, pure/DI) | — | Mirror of `verify.js` (filesystem) and `focus.js`/`grepLogs` (pure DI helper outside React). Zero endpoints (D-10). |
| Overlay UX shell (open/scroll/freeze/Esc) | React component (`App.js` handler + `SessionTable.js` render) | — | The overlay machinery (`mode:'overlay'`, `overlayReqRef`, `OVERLAY_VIEWPORT`) already lives in the React layer. |
| Status discrimination / honest copy (PLAN-02) | Presentation constants (`App.js` `OVERLAY_PLAN_*`) + render branch (`SessionTable.js`) | Derive helper (returns the status) | Copy is presentation; the *decision* of which status comes from the read helper. Mirror of `OVERLAY_COMMENTS_*`. |
| `anyGsd` column-hide derivation (TUI-18) | Pure derive (`select.js`) | Presentation (`SessionTable.js` column drop) | Structural derivation belongs in the React-free derive layer, like sort/filter/counts. The render consumes the boolean. |
| Per-row zombie mark (TUI-19) | Presentation (`SessionTable.js` `state` cell) | Pure color decision (`format.js` `statusColor`, already exists) | The mark is a cell projection; the color is already decided by `statusColor`. No new derive logic. |

## Standard Stack

### Core

This phase adds **zero new dependencies**. It extends existing modules only.

| Module (existing) | Role in Phase 44 | Why Standard |
|---|---|---|
| `node:fs` (`readdirSync`, `readFileSync`, `existsSync`) `[VERIFIED: codebase grep]` | Plan-file discovery + read (sync, DI-injectable) | The entire `src/gsd/` layer reads the filesystem synchronously with these three APIs (`verify.js`, `doctor.js`, `resolver.js`). Consistency. |
| `node:path` (`join`, `basename`) `[VERIFIED: codebase grep]` | Compose phase-dir + plan-file paths | Already used by `verify.js`, `format.js`, `resolver.js`. |
| `ink` (`Box`, `Text`) `[VERIFIED: codebase grep]` | Overlay + column render | Already the only render layer; color-isolation invariant (D-12). |
| `react` (`createElement`, hooks) `[VERIFIED: codebase grep]` | `App.js` handler/state | Existing root component. |
| `src/gsd/resolver.js` `resolvePhase` `[VERIFIED: codebase grep]` | Best-effort fallback when `phase_id` absent (D-03) | Reused per locked decision; tolerated never-crashing. |

### Supporting

| Module (existing) | Role | When to Use |
|---|---|---|
| `src/gsd/verify.js` (read, not import) | **Template** for phase-dir discovery | Copy the `readdir + startsWith prefix + ENOENT/EACCES mapping` block structurally. Do NOT import it (it's an async orchestrator with provider side-effects). |
| `src/cli/dashboard/client.js` (read, not import) | **Template** for never-throws discriminant | Copy the `try/catch → {ok|status}` shape into the plan helper. |
| `ink-testing-library` `[VERIFIED: codebase grep]` | Overlay render tests | Already the harness for `dashboard-overlay.test.js`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sync fs in helper (`readdirSync`) | Async `fs/promises` | Async would force the `p` handler to `await` (like `c`/`l`) and engage `overlayReqRef`. **Sync is simpler and matches `verify.js`/`resolver.js`** — see §Pattern 1 on the `overlayReqRef` implication. Recommend SYNC. |
| `resolvePhase` fallback as primary | Drop fallback entirely | CONTEXT D-03 locks the fallback as present. But since the row lacks `task.title`, it's near-useless in practice — keep it thin and never-crashing, do not invest in making it accurate. |
| New `plan.js` helper module | Inline in `App.js` handler | Discretion (D-05 note). **Recommend separate `plan.js`** for pure unit-testability without React host (mirror of `grepLogs`/`mapDismissResult` extraction rationale). |

**Installation:** None — zero new packages.

## Package Legitimacy Audit

**Not applicable** — Phase 44 installs **zero external packages**. All work extends existing first-party modules (`src/cli/dashboard/*`, `src/gsd/*`) using already-vendored `node:fs`/`node:path`/`ink`/`react`. No registry interaction, no slopcheck needed.

## Architecture Patterns

### System Architecture Diagram

```
                 operator presses `p` (mode==='list')
                              │
                              ▼
        App.js useInput handler (input === 'p')
                              │
              read selected row by sel.index → filtered[sel.index]
                              │  (row carries: phase_id, worktree_path,
                              │   project_path, task_ref, task_id, summary)
                              ▼
        ┌─────────────────────────────────────────────┐
        │  readPlan({ row, readdirFn, readFileFn,      │  ← NEW pure helper
        │             existsFn })   (src/cli/dashboard/ │     (plan.js), SYNC,
        │             plan.js)                          │     never-throws
        └─────────────────────────────────────────────┘
                              │
          phase_id present? ──┬── yes → padded = phase_id.padStart(2,'0')
                              │
                              └── no  → resolvePhase({projectPath:
                                        worktree_path ?? project_path,
                                        task:{title: row.summary ?? '', ...}})
                                        → best-effort; usually no-match
                                        → status 'no-phase'
                              │
                              ▼
        phasesRoot = join(worktree_path ?? project_path,
                          '.planning','phases')
                              │
        readdirFn(phasesRoot)  →  entries.find(e => e.startsWith(`${padded}-`))
                              │        (ENOENT → 'no-phase'/'no-plan';
                              │         EACCES/other → 'error')
                              ▼
        readdirFn(phaseDir).filter(f => f.endsWith('-PLAN.md')).sort()
                              │
          0 files → status 'no-plan'  |  ≥1 files → readFileFn each
                              │
              concatenate with `── <filename> ──` headers (D-06)
                              ▼
        returns { status: 'ok'|'no-phase'|'no-plan'|'error', lines: string[] }
                              │
                              ▼
        App.js: setOverlaySnapshot({ kind:'plan', taskRef, status, lines })
                setOverlayKind('plan'); setScrollOffset(0); setMode('overlay')
                              │
                              ▼
        SessionTable.renderOverlay → frozen scrollable viewport
        (Esc → mode:'list', selectedTaskId untouched → cursor preserved)
```

Parallel, independent of the overlay (shared files, not shared data flow):

```
  /status rows ──► select.js: anyGsd = rows.some(r => r.phase_id != null)   [TUI-18]
                              │
                              ▼
            SessionTable.js: if !anyGsd → omit phasemode column + its width
                                          (column header + every data cell)

  each row ──► format.js statusColor(status, alive, state)  (already red for zombie)
                              │
                              ▼
            SessionTable.js: state cell text += ' (zombie)' when running+!alive  [TUI-19]
                             (color from statusColor, NOT picocolors)
```

### Recommended Project Structure

```
src/cli/dashboard/
├── App.js          # + OVERLAY_PLAN_* constants, + `input === 'p'` handler (sync)
├── SessionTable.js # + renderOverlay 'plan' kind, + conditional phasemode column (TUI-18),
│                   #   + (zombie) mark in state cell (TUI-19)
├── select.js       # + deriveAnyGsd(rows) pure helper (TUI-18)
├── format.js       # (statusColor already v3-aware; maybe a stateCell helper for TUI-19)
├── plan.js         # NEW: readPlan({row, deps}) — pure, sync, never-throws, DI
└── client.js       # untouched (no new endpoint)
```

### Pattern 1: Synchronous never-throws filesystem read helper (PLAN-01/02, D-04/D-05)

**What:** A pure, DI-injectable, synchronous helper that discovers the phase dir by number prefix and reads `*-PLAN.md` files, collapsing every failure to a discriminated status. It is `verify.js`'s phase-discovery block retargeted, plus `client.js`'s never-throws discipline.

**When to use:** The `p` handler calls it; tests call it directly with fake `readdirFn`/`readFileFn`/`existsFn`.

**Critical implication of SYNC for `overlayReqRef`:** The `c`/`l` handlers are **async** (`await fetchComments`), so they need `overlayReqRef` (CR-01) to discard a stale open that the operator superseded during the `await`. **A synchronous plan read has no `await` window** — `setOverlaySnapshot`/`setMode` run in the same tick as the keypress, so there is **no stale-reopen race** to guard. Therefore:
- If the helper is **sync** (recommended): the `p` handler does **not** need the `overlayReqRef` increment-and-check dance for the *open*. It still must increment `overlayReqRef.current++` on the **Esc close** path (the existing overlay-close branch already does this) so that any *other* in-flight `c`/`l` open is invalidated — but the `p` open itself is atomic. This is *simpler* than `c`/`l`, not a 1:1 mirror. **The plan must document this divergence explicitly** so the executor does not cargo-cult an unnecessary async guard.
- If the helper is **async** (not recommended): then mirror `c`/`l` exactly (reqId capture, post-await `if (overlayReqRef.current !== reqId) return`).

**Example (structural template, from `verify.js:123-186` retargeted):**
```javascript
// Source: src/gsd/verify.js:123-186 (phase-dir discovery) + src/cli/dashboard/client.js (never-throws)
// src/cli/dashboard/plan.js  — pure, sync, never-throws, DI
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ status: 'ok'|'no-phase'|'no-plan'|'error', lines: string[] }} PlanResult
 */
export function readPlan(row, deps = {}) {
  const readdirFn = deps.readdirFn || readdirSync;
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const existsFn = deps.existsFn || existsSync;
  const resolvePhaseFn = deps.resolvePhaseFn; // best-effort fallback (D-03)

  // 1. phase_id primary (D-03). Fallback resolvePhase only if absent.
  let phaseId = row?.phase_id;
  if (phaseId == null && resolvePhaseFn) {
    // NOTE: row has NO task.title — this fallback usually returns no-match/bootstrap.
    const r = resolvePhaseFn({
      projectPath: row?.worktree_path ?? row?.project_path,
      task: { title: row?.summary ?? '', ref: row?.task_ref },
    });
    if (r && r.action === 'phase') phaseId = r.phase_id;
  }
  if (phaseId == null) return { status: 'no-phase', lines: [] };

  const base = row?.worktree_path ?? row?.project_path;
  if (!base) return { status: 'no-phase', lines: [] };

  // 2. padded prefix match (verify.js canonical: "03" matches "03-foo" NOT "30-foo")
  const padded = /^\d+$/.test(String(phaseId))
    ? String(phaseId).padStart(2, '0')
    : String(phaseId); // "44.1" stays as-is
  const phasesRoot = join(base, '.planning', 'phases');
  if (!existsFn(phasesRoot)) return { status: 'no-plan', lines: [] };

  let entries;
  try {
    entries = readdirFn(phasesRoot);
  } catch (err) {
    // WR-02 mapping (verify.js:144-159): ENOENT → empty; EACCES/other → error.
    if (err && err.code === 'ENOENT') entries = [];
    else return { status: 'error', lines: [] };
  }
  const dir = entries.find((e) => e.startsWith(`${padded}-`));
  if (!dir) return { status: 'no-plan', lines: [] };

  // 3. collect *-PLAN.md, sort ascending (D-06), read + concatenate.
  let files;
  try {
    files = readdirFn(join(phasesRoot, dir))
      .filter((f) => f.endsWith('-PLAN.md'))   // String.endsWith, NO RegExp (D-13)
      .sort();                                  // ascending by filename (D-06)
  } catch {
    return { status: 'error', lines: [] };
  }
  if (files.length === 0) return { status: 'no-plan', lines: [] };

  const lines = [];
  for (const f of files) {
    try {
      const md = readFileFn(join(phasesRoot, dir, f));
      if (files.length > 1) lines.push(`── ${f} ──`, ''); // per-file header (D-06)
      for (const ln of md.split('\n')) lines.push(ln);
      if (files.length > 1) lines.push('');
    } catch {
      // a single unreadable file does not crash the whole overlay (best-effort).
      lines.push(`── ${f} (unreadable) ──`, '');
    }
  }
  return { status: 'ok', lines };
}
```

### Pattern 2: Overlay handler + snapshot wiring (PLAN-01/02, D-02/D-07)

**What:** A fourth `input === 'p'` branch in the `mode === 'list'` section of `App.js`'s `useInput`, mirroring `c`/`l` but **synchronous**.

**Example (from `App.js:434-463`, adapted to sync):**
```javascript
// Source: src/cli/dashboard/App.js:391-463 (c/l handlers), made synchronous
if (input === 'p') {
  const row = sel.index >= 0 ? filtered[sel.index] : null;
  if (!row) return;
  // SYNC: no await, no overlayReqRef capture needed for the open (see Pattern 1).
  const res = readPlan(row, { resolvePhaseFn: resolvePhase });
  setOverlaySnapshot({ kind: 'plan', taskRef: row.task_ref ?? '', status: res.status, lines: res.lines });
  setOverlayKind('plan');
  setScrollOffset(0);
  setMode('overlay');
  return;
}
```
Add `'plan'` to the `overlayKind` / `overlaySnapshot.kind` typedefs (`'comments'|'logs'|'plan'`). Add `OVERLAY_PLAN_NO_PHASE`/`OVERLAY_PLAN_NO_PLAN`/`OVERLAY_PLAN_ERROR` exported constants (mirror of `OVERLAY_COMMENTS_*`). Extend `SessionTable.renderOverlay`'s status branch to map `'no-phase'`/`'no-plan'`/`'error'` to the new copy (dim for the two informational cases, red for `'error'` — mirror of `unsupported` being dim vs `error` being red).

### Pattern 3: Conditional column hide via pure derivation (TUI-18, D-08)

**What:** `anyGsd` is derived **once, over the unfiltered `/status` rows** (structural, filter-insensitive), then threaded into `SessionTable` to drop the `phasemode` column header + every data cell, reclaiming `COLS.phasemode` (11) width.

**Where derived (`select.js`, new pure fn):**
```javascript
// Source: pattern mirror of countByStatus / resolveSelection (select.js)
/** @param {Array<Partial<EnrichedSession>>} rows */
export function deriveAnyGsd(rows) {
  return rows.some((r) => r.phase_id != null); // structural; NOT over `filtered`
}
```
**Critical (D-08):** compute it over **`sessions`/`sorted`** (the full active set), **NOT** over `filtered` — otherwise typing `s:done` could momentarily empty the GSD rows and make the column flicker. In `App.js`: `const anyGsd = deriveAnyGsd(sorted);` (use `sorted`, before `applyFilter`). Pass `anyGsd` as a prop to `SessionTable`.

**Where consumed (`SessionTable.js`):** Guard the `phasemode` column header `h(Box,{width:COLS.phasemode},...)` and the per-row `cell({width:COLS.phasemode,...})` behind `anyGsd`. Because every column is a fixed-width `<Box>` in a `flexDirection:'row'`, **simply not emitting the phasemode `<Box>` reclaims its width automatically** (the remaining boxes shift left; ink does not pad the gap). No width-arithmetic needed — dropping the element is the reclaim. This is the cleanest mechanic for the discretion item D-08.

### Pattern 4: Per-row zombie mark in the state cell (TUI-19, D-09)

**What:** The `state` cell currently renders `stateBadge(state ?? status)` → `▶ running` (green) for a live running session. A zombie is `running + alive === false`. Today the **header** counts it (`countByStatus`), and `statusColor(status, alive, state)` already returns `{color:'red'}` for `running+!alive` — but the per-row `state` cell uses `stateBadge` (which maps `running → green ▶ running`) and does **not** consult `alive`. So a zombie row's `state` cell currently shows a **green `▶ running`**, which is the bug TUI-19 fixes.

**Where (`SessionTable.js:314-318`, the state-cell IIFE):**
```javascript
// Source: src/cli/dashboard/SessionTable.js:310-318 (state cell)
(() => {
  const isZombie = (session.status === 'running' || session.state === 'running') && session.alive === false;
  const badge = stateBadge(session.state ?? session.status ?? '');
  let text = (badge.glyph || badge.label) ? `${badge.glyph ?? ''} ${badge.label ?? ''}`.trim() : '';
  let color = badge.color;
  if (isZombie) {
    text = `${text} (zombie)`.trim();          // additive textual mark (NO_COLOR-safe, D-09)
    color = statusColor(session.status ?? '', session.alive, session.state).color; // 'red', from existing fn
  }
  return cell({ width: COLS.state, text, color, bold: selected, truncate: false });
})(),
```
**Notes:** `COLS.state` is 16; `▶ running (zombie)` is ~17 visual chars — **the plan may need to widen `COLS.state`** (e.g. to 18) or accept ink's `truncate-end`. Since the comment at `SessionTable.js:38-39` says the `(zombie)` mark "must survive" un-truncated for accessibility, **recommend widening `COLS.state`** rather than truncating. Color comes from `statusColor` (already imported), so **zero new color and zero picocolors** — color-isolation holds. The header counter (`countByStatus` → `countsLabel`) is **untouched** (additive, D-09).

### Anti-Patterns to Avoid

- **Importing `verify.js` or `resolver.js`'s side-effecting paths into the dashboard.** `verify.js` is an async orchestrator that posts provider comments and transitions task state. Only **copy its phase-discovery block structurally** into `plan.js`. `resolvePhase` is safe to import (pure-ish: only `existsSync`/`readFileSync`, no writes) and is the locked fallback.
- **Adding an `overlayReqRef` guard to a synchronous `p` open.** There is no `await` window; the guard is dead code there and misleads future readers. (Keep the Esc-close increment that invalidates *other* in-flight opens.)
- **Deriving `anyGsd` over `filtered` instead of `sorted`/`sessions`.** Makes the column flicker on keystroke (violates D-08 "structural, not filter-sensitive").
- **Compiling any regex from a filename or phase id.** Use `String.startsWith`/`String.endsWith` (D-13). The existing `verify.js` uses `e.startsWith(`${padded}-`)` — mirror exactly.
- **Letting a single unreadable `PLAN.md` throw out of the loop.** Best-effort: a per-file `try/catch` keeps the rest of the concatenation alive (D-05).
- **Worsening the ESM import cycle.** `App.js` exports `OVERLAY_*` constants that `SessionTable.js` imports (WARNING-01). Adding `OVERLAY_PLAN_*` follows the *same* existing edge (App→SessionTable), so it does not add a *new* cycle direction — but do **not** add a `SessionTable.js → App.js` import of anything new beyond the existing constant imports, and do **not** import `SessionTable` from `plan.js`/`select.js`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Phase-dir discovery by number prefix | Custom glob / regex over `.planning/phases/` | `readdirFn(phasesRoot).find(e => e.startsWith(`${padded}-`))` from `verify.js` | Canonical, anti-ReDoS, already handles "03 vs 30" prefix correctness and `worktree_path ?? project_path` fallback. |
| Never-throws filesystem error handling | Ad-hoc try/catch per call | `verify.js` WR-02 mapping (ENOENT→empty, EACCES/other→error) collapsed to a discriminant | Battle-tested; distinguishes "no phase" from "can't read" honestly. |
| Overlay open/scroll/freeze/Esc UX | A new overlay mode/state machine | The existing `mode:'overlay'` + `setOverlaySnapshot` + `scrollOffset` + `OVERLAY_VIEWPORT` | Already 3-consumer-proven (comments/logs); D-02 mandates reuse, zero new sub-mode. |
| Column-width reclaim on hide | Recomputing fixed widths arithmetically | Conditionally **not emitting** the column `<Box>` | ink's flex row shifts remaining boxes; dropping the element reclaims the width for free. |
| Zombie color decision | A new color constant / picocolors | `statusColor(status, alive, state)` (already red for `running+!alive`) | Color-isolation (D-12); the decision already exists and is LOCKED. |
| Task→phase mapping | Parsing ROADMAP yourself | `row.phase_id` (primary) → `resolvePhase` (fallback) | phase_id is persisted on the row; resolvePhase is the locked, discriminated-union resolver. |

**Key insight:** This phase has a verbatim template for *every* sub-task. The risk is not technical novelty — it's (a) the synchronous-vs-async overlay subtlety that breaks the otherwise-perfect `c`/`l` mirror, and (b) merge friction in the four shared files. Both are addressed below.

## Runtime State Inventory

> This is a **code/render-only** phase (read-only overlay + pure derive edits). No rename, no migration, no stored-state mutation. Inventory included for completeness per protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified: overlay is read-only (D-11), reads `PLAN.md` from disk, writes nothing. No DB/datastore touched. | None |
| Live service config | None — verified: zero endpoints (D-10), `src/server.js` untouched; no external service config. | None |
| OS-registered state | None — verified: no OS registrations, no process/task names changed. | None |
| Secrets/env vars | None — verified: no secret/env references added or renamed. | None |
| Build artifacts | None — verified: no package rename, no build step (markup is plain `React.createElement`, no JSX build). | None |

## Common Pitfalls

### Pitfall 1: Sync helper, but cargo-culting the async `overlayReqRef` guard
**What goes wrong:** Executor copies the `c`/`l` handler verbatim (including `const reqId = ++overlayReqRef.current` and the post-await check) onto a synchronous `p` read, producing dead/misleading code.
**Why it happens:** D-02 says "exact mirror of `c`/`l`", but `c`/`l` are async and `p` (sync read) is not.
**How to avoid:** Document in the plan that the `p` open is atomic (no await window → no stale-reopen race → no reqId capture on open). Only the **Esc-close** path increments `overlayReqRef` (to invalidate other in-flight opens), which the existing close branch already does.
**Warning signs:** A `reqId` variable in the `p` handler that is never compared after an `await`.

### Pitfall 2: `resolvePhase` fallback silently never works (missing `task.title`)
**What goes wrong:** Plan assumes `resolvePhase` will resolve a phase for non-`phase_id` rows, but the dashboard row has no `task.title` — only `task_ref`/`summary`. `resolvePhase` matches `normalizeTitle(task.title)` against ROADMAP headings, so it returns `no-match`/`bootstrap` for nearly all rows.
**Why it happens:** CONTEXT D-03 phrases the fallback as if it were a real second path; the missing field is not obvious until you read `resolver.js:59` (`normalizeTitle(task.title)`) against the `SessionRecord` shape.
**How to avoid:** Treat `phase_id`-primary as the load-bearing path. Keep the fallback thin, tolerant, and crash-proof; do **not** write tests that assert the fallback *succeeds* — assert only that it **never throws** and collapses to `'no-phase'`. (For GSD sessions, `phase_id` is reliably persisted by the dispatcher, so the fallback rarely matters.)
**Warning signs:** A test fixture that omits `phase_id` *and* expects `status:'ok'` — that test will be flaky/wrong.

### Pitfall 3: `(zombie)` mark truncated by fixed `COLS.state`
**What goes wrong:** `▶ running (zombie)` exceeds `COLS.state` (16) and ink's `truncate-end` clips it to `▶ running (zom…`, defeating the accessibility purpose.
**Why it happens:** The state cell is fixed-width; the existing comment (`SessionTable.js:38-43`) already notes the width was tuned for `🔔 needs-input`.
**How to avoid:** Widen `COLS.state` (e.g. 16 → 18) when the zombie mark lands, or render the state cell with `truncate:false` (the gutter/age columns can absorb it). Recommend widening for predictable layout. Update `test/dashboard-table.test.js` byte-stable assertions accordingly.
**Warning signs:** A test that greps for `(zombie)` passing on the helper but the rendered frame showing `(zom…`.

### Pitfall 4: Column-hide derived over filtered rows → flicker
**What goes wrong:** `anyGsd` computed over `filtered` makes the `phase/mode` column appear/disappear as the operator types a filter (e.g. `s:done` hides all GSD rows momentarily).
**Why it happens:** Natural to thread it through the same pipeline as everything else.
**How to avoid:** Derive `anyGsd` from `sorted` (or raw `sessions`), **before** `applyFilter`. D-08 calls this out explicitly ("structural, not sensitive to filter text").
**Warning signs:** A test that filters down to zero GSD rows and sees the column vanish.

### Pitfall 5: Worsening the App.js ↔ SessionTable.js ESM cycle (WARNING-01)
**What goes wrong:** Adding cross-imports between `App.js` and `SessionTable.js` (beyond the existing `OVERLAY_*` constant edge) tightens the documented fragile runtime-resolved cycle.
**Why it happens:** Convenient to import a render helper either direction.
**How to avoid:** New `OVERLAY_PLAN_*` constants live in `App.js` and are imported by `SessionTable.js` — **same direction as today**, no new edge. Put pure logic in `plan.js`/`select.js` (leaf modules imported *by* App, importing neither App nor SessionTable). Run the full suite after wiring to confirm the cycle still resolves.
**Warning signs:** A new `import ... from './SessionTable.js'` inside `App.js`, or any import of `App.js` from `select.js`/`format.js`/`plan.js`.

## Code Examples

### Reading + concatenating multiple PLAN.md (D-06)
See **Pattern 1** `readPlan` above — the `for (const f of files)` block with per-file `── ${f} ──` headers and ascending `.sort()`.

### Honest per-case copy (D-07), mirror of OVERLAY_COMMENTS_*
```javascript
// Source: src/cli/dashboard/App.js:89-99 (OVERLAY_COMMENTS_* / OVERLAY_LOGS_*)
export const OVERLAY_PLAN_NO_PHASE = 'not a GSD session / no phase resolved';
export const OVERLAY_PLAN_NO_PLAN = 'phase has no PLAN.md yet';
export const OVERLAY_PLAN_ERROR = 'error reading plan';
// (multiple PLAN.md is NOT a status here — concatenated into lines[], D-06)
```
And in `SessionTable.renderOverlay`'s else-branch, map: `'no-phase'`/`'no-plan'` → the dim informational copy (like `unsupported`), `'error'` → red (like the existing `error`/`not-found`).

### Esc close preserves cursor (already correct, reused verbatim)
```javascript
// Source: src/cli/dashboard/App.js:296-302 — no change needed for 'plan' kind
if (mode === 'overlay') {
  if (key.escape) {
    overlayReqRef.current++;       // invalidates any OTHER in-flight c/l open
    setMode('list');
    setOverlayKind(null);
    return;
  }
  // ↑/↓ scroll branch unchanged — works for 'plan' lines[] identically
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Read plan from Claude Code internals (JSONL transcript, `~/.claude/plans/`, `TodoWrite`) | Read the project's own versioned `PLAN.md` from `.planning/phases/` | v0.11 design (REQUIREMENTS.md PLAN section) | Stable, documented, correlatable by `phase_id`. `TodoWrite` deprecated since Claude Code v2.1.142. Out-of-scope confirmed in REQUIREMENTS.md. |
| Zombie shown only in header counter | Zombie marked per-row in `state` column | Phase 44 (TUI-19) | Operator sees *which* row is zombie, not just the count. Consistent with v0.10 status→outcome redefinition. |
| `phase/mode` column always rendered (shows `No GSD` for non-GSD) | Column hidden entirely when no active GSD session | Phase 44 (TUI-18) | Reclaims horizontal space in non-GSD workflows (v0.10 dogfooding finding). |

**Deprecated/outdated:** `TodoWrite` (Claude Code) — irrelevant here since the plan source is the project's own `PLAN.md`, not Claude internals.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `phase_id` is reliably present on GET /status rows for GSD sessions (dispatcher persists it post-resolve). `[VERIFIED: codebase grep — state.js:27 "Populated by dispatcher when match succeeds"; server.js spreads `...s`]` | §Summary, Pitfall 2 | If absent more often than expected, more rows fall to the near-useless `resolvePhase` fallback → more `'no-phase'` overlays. Low risk (collapses to honest copy). |
| A2 | `PLAN.md` files follow the `<N>-NN-PLAN.md` naming (e.g. `44-01-PLAN.md`), matched by `endsWith('-PLAN.md')`. `[ASSUMED]` — based on phase-dir naming convention and CONTEXT D-04/D-06; no existing `PLAN.md` files on disk yet to grep (phase dir only has CONTEXT.md). | §Plan File Discovery, Pattern 1 | If real plans use a different suffix, the glob misses them → `'no-plan'`. Verify against an actual planned phase once plans exist, or broaden the match to `.includes('PLAN')` cautiously. |
| A3 | Dropping a column `<Box>` from an ink `flexDirection:'row'` reclaims its width (siblings shift, no gap padding). `[ASSUMED]` — standard ink/yoga flexbox behavior; consistent with how fixed-width `<Box>` columns compose today. | Pattern 3 | If ink pads the gap, a manual width pass is needed. Low risk; verifiable in a render test. |
| A4 | `COLS.state` (16) is too narrow for `▶ running (zombie)` (~17-18 visual). `[VERIFIED: arithmetic]` — `▶ running` (9) + ` (zombie)` (9) ≈ 18. | Pattern 4, Pitfall 3 | If ink measures the glyph differently, exact width differs but the "widen or truncate" decision stands. |

## Open Questions (RESOLVED)

1. **Exact PLAN.md filename suffix (A2)** — **RESOLVED:** `endsWith('-PLAN.md')` (matches `44-01-PLAN.md`).
   - What we knew: CONTEXT D-04/D-06 say `*-PLAN.md` and `<N>-NN-PLAN.md`; phase-dir naming is `<padded>-<slug>/`.
   - Resolution: Plan 44-01 adopts `endsWith('-PLAN.md')` as the glob predicate. The `44-NN-PLAN.md` files created by this very plan-phase run serve as the live fixture during UAT.

2. **Where the `(zombie)` mark width is absorbed** — **RESOLVED:** widen `COLS.state` 16→18.
   - What we knew: `COLS.state` is 16; the mark must not truncate (accessibility comment in SessionTable.js).
   - Resolution: Plan 44-02 widens `COLS.state` to 18 for predictable layout and updates the byte-stable table snapshot tests (`test/dashboard-table.test.js`).

## Environment Availability

> Skip rationale: Phase 44 has **no external tool/service/runtime dependencies** beyond the already-present Node runtime, `node:fs`/`node:path`, `ink`, and `react` — all vendored and in active use by the existing dashboard. No CLI, DB, container, or network service is introduced (D-10 zero-endpoints). **Step 2.6: SKIPPED (no external dependencies; code/render-only phase).**

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (built-in) + `ink-testing-library` for render tests `[VERIFIED: codebase grep]` |
| Config file | none — tests run via the `node --test` runner over `test/*.test.js` (no jest/vitest config) |
| Quick run command | `node --test test/dashboard-overlay.test.js test/dashboard-select.test.js test/dashboard-format.test.js test/dashboard-table.test.js` |
| Full suite command | `node --test` (project root; runs all `test/*.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-01 | `readPlan` finds `<padded>-` dir + reads `*-PLAN.md` from `worktree_path ?? project_path` (sync, DI fakes) | unit (pure) | `node --test test/dashboard-plan.test.js` | ❌ Wave 0 |
| PLAN-01 | `p` opens overlay on selected row; frame shows plan content or taskRef | integration (ink) | `node --test test/dashboard-overlay.test.js` | ⚠ extend existing |
| PLAN-02 | non-GSD/no-phase → `OVERLAY_PLAN_NO_PHASE`; no PLAN.md → `OVERLAY_PLAN_NO_PLAN`; FS error → `OVERLAY_PLAN_ERROR` (distinct copy per case) | unit + integration | `node --test test/dashboard-plan.test.js test/dashboard-overlay.test.js` | ❌ Wave 0 / ⚠ extend |
| PLAN-02 | multiple PLAN.md concatenated with `── <file> ──` headers, ascending | unit (pure) | `node --test test/dashboard-plan.test.js` | ❌ Wave 0 |
| PLAN-02 | never-throws: `readdirFn`/`readFileFn` throwing EACCES → `status:'error'`, no exception | unit (pure) | `node --test test/dashboard-plan.test.js` | ❌ Wave 0 |
| PLAN-02 | `Esc` closes plan overlay, cursor preserved (`›` still on selected task_ref) | integration (ink) | `node --test test/dashboard-overlay.test.js` | ⚠ extend existing |
| TUI-18 | `deriveAnyGsd` true when any row has `phase_id`, false otherwise; computed over unfiltered rows | unit (pure) | `node --test test/dashboard-select.test.js` | ⚠ extend existing |
| TUI-18 | render: no GSD rows → no `phase/mode` header; ≥1 GSD row → header present | integration (ink) | `node --test test/dashboard-table.test.js` | ⚠ extend existing |
| TUI-19 | zombie row (`running`+`alive:false`) state cell contains `(zombie)` and color red; header counter unchanged | integration (ink) + unit | `node --test test/dashboard-table.test.js` | ⚠ extend existing |
| (invariant) D-12 | no `picocolors` under `src/cli/dashboard/` (incl. new `plan.js`) | unit (walker) | `node --test test/format-isolation.test.js` | ✅ exists (auto-covers new files) |
| (invariant) D-13 | no `new RegExp` in plan/derive paths (String.includes/startsWith/endsWith) | code review + unit | covered by ReDoS-style fixture (regex-special filename matched literally) in `test/dashboard-plan.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** quick run (the 4 dashboard test files above) — < 5s.
- **Per wave merge:** full suite `node --test`.
- **Phase gate:** full suite green (baseline v0.10: 1213 pass + 1 skip) before `/gsd:verify-work`. The `format-isolation` walker auto-covers `plan.js` the moment it exists.

### Wave 0 Gaps
- [ ] `test/dashboard-plan.test.js` — NEW: pure unit tests for `readPlan` (phase-id primary, resolvePhase fallback never-throws, prefix match "44 vs 4", `*-PLAN.md` collection + ascending sort, multi-file concatenation headers, EACCES→error, ENOENT→no-plan, regex-special filename matched literally). Covers PLAN-01/PLAN-02/D-13.
- [ ] `test/dashboard-overlay.test.js` — EXTEND: `p` open + 3 distinct copy cases + Esc-preserves-cursor (mirror the existing `c` tests; reuse `makeRouter`/`makeFakeClock` harness; fixture needs a fake fs for `readPlan` via injected deps OR a temp `.planning/phases/` dir).
- [ ] `test/dashboard-select.test.js` — EXTEND: `deriveAnyGsd` truth table (with/without `phase_id`, over unfiltered rows).
- [ ] `test/dashboard-table.test.js` — EXTEND: column-hidden-when-no-GSD render assertion + per-row `(zombie)` mark assertion + byte-stable width update for `COLS.state`.
- [ ] Framework install: none — `node:test` + `ink-testing-library` already present.

## Security Domain

> `security_enforcement` not set to `false` in config → section included. Phase 44 is a **read-only, no-network, no-input-sink** feature; the surface is narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface (local TUI, no new endpoint). |
| V3 Session Management | no | No HTTP session; reuses existing read-only poll. |
| V4 Access Control | no | Local operator already has filesystem access; overlay reads files the operator can read. |
| V5 Input Validation | yes | Filenames/phase ids matched with `String.startsWith`/`endsWith` only — **no regex compiled from filesystem-derived strings** (anti-ReDoS, D-13, T-36-01 lineage). `phase_id` is a number/`02.1`-style string from `state.json`, used only to build a `padStart` prefix — not interpolated into a regex or shell. |
| V6 Cryptography | no | No crypto. |

### Known Threat Patterns for {ink TUI + local filesystem read}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `phase_id`/dir name | Tampering | `phase_id` originates from kodo's own `state.json` (not operator input); paths composed with `node:path.join` under a fixed `.planning/phases/` root; only directory **entries already present** are read (`readdir` then `find`), never an attacker-supplied path segment. No `..` injection vector since nothing is concatenated from untrusted input. |
| ReDoS via regex on filenames | Denial of Service | `String.startsWith`/`endsWith`/`includes` only — never `new RegExp` (D-13). Mirror of existing `applyFilter`/`grepLogs` discipline (T-36-01/T-39-02). |
| Unbounded read of a huge PLAN.md | Denial of Service | Render is bounded by `OVERLAY_VIEWPORT` (18 lines sliced); the full `lines[]` is held in memory but plans are small text files. (If a pathological multi-MB plan is a concern, the helper could cap `lines.length` — low priority, note for the planner.) |
| Throw from fs reaching React (crash) | Denial of Service | never-throws contract (D-05): every `readdir`/`readFile` wrapped; failures collapse to `status:'error'`. Guarded by the "TUI never crashes" cross-milestone invariant (STATE.md). |
| Color/ANSI injection via plan content | Tampering/Spoofing | Plan content rendered through ink `<Text>` (no raw ANSI passthrough beyond ink's own escaping); color-isolation (D-12) keeps zero picocolors. Plan text is the operator's own versioned content (low trust concern), displayed verbatim line-by-line. |

## Project Constraints (from CLAUDE.md)

> Global `~/.claude/CLAUDE.md` applies (no project-local `./CLAUDE.md` with kodo-specific build rules found beyond the global). Relevant directives:

- **Simplicity first / surgical changes (Karpathy rules 2 & 3):** This phase is pattern-extension — do not over-engineer the `resolvePhase` fallback, do not refactor adjacent overlay code, respect existing style (plain `React.createElement`, no JSX, `// @ts-check`, 2-space, JSDoc on public fns).
- **Goal-directed execution (rule 4):** success = the Validation Architecture test map green + the 4 success criteria in the phase description met.
- **Respond in Spanish** (interaction directive) — affects assistant prose, not code/comments (existing dashboard comments are in Spanish; match that convention in new files).
- **Tier classification (git policy):** This is a **Tier 2** change (feature touching React render + new helper). PR with review per the global merge policy — though kodo's own GSD workflow governs the actual merge gate.
- **Color-isolation / never-throws / anti-ReDoS / read-only / zero-endpoints** are STATE.md "Critical Invariants to Preserve" — treat with the same authority as locked decisions (they are, via D-10/D-11/D-12/D-13).

## Shared-File Coordination (wave/plan split recommendation)

**The friction:** Four files are touched by ≥2 of {plan-overlay, TUI-18, TUI-19}:

| File | plan-overlay | TUI-18 (column hide) | TUI-19 (zombie row) |
|------|:---:|:---:|:---:|
| `App.js` | ✅ (handler + `OVERLAY_PLAN_*` + `anyGsd` thread) | ✅ (compute `anyGsd`, pass prop) | — |
| `SessionTable.js` | ✅ (renderOverlay 'plan') | ✅ (drop column) | ✅ (state cell mark) |
| `select.js` | — | ✅ (`deriveAnyGsd`) | — |
| `format.js` | — | — | maybe (no change needed; `statusColor` already correct) |
| `plan.js` (new) | ✅ | — | — |

**Recommended split (minimizes intra-file merge conflicts; respects dependency order):**

- **Plan 44-01 — Plan-reading helper + overlay wiring (PLAN-01/02).** Owns `plan.js` (new, no conflict), the `App.js` `p` handler + `OVERLAY_PLAN_*` constants, and the `SessionTable.renderOverlay` `'plan'` branch. This is the largest, most isolated chunk. Wave 0: `test/dashboard-plan.test.js` (RED) + extend `dashboard-overlay.test.js`.
- **Plan 44-02 — Dashboard polish: TUI-18 + TUI-19.** Owns `select.js` (`deriveAnyGsd`), the `App.js` `anyGsd` compute+prop, the `SessionTable.js` column-drop **and** state-cell `(zombie)` mark (both in the same file, same plan → no cross-plan conflict in SessionTable), and `COLS.state` width. Wave 0: extend `dashboard-select.test.js` + `dashboard-table.test.js`.

**Why this split (not finer):** Both 44-01 and 44-02 edit `App.js` and `SessionTable.js`, so they **cannot run in parallel without conflict**. Run them **sequentially** (44-01 then 44-02), or — if the planner wants parallelism — isolate by section: 44-01 touches only the overlay-related regions (handler block, renderOverlay), 44-02 touches the table-body/column regions; with careful region ownership they can be parallelized, but **sequential is the safer default** given WARNING-01 (the App↔SessionTable cycle). Granularity is `coarse` in config, so 2 cohesive plans is appropriate. Do **not** split TUI-18 and TUI-19 into separate plans — they edit the same `SessionTable.js` body and would conflict with each other.

## Sources

### Primary (HIGH confidence)
- `src/gsd/verify.js:123-186` — phase-dir discovery template (readdir + `startsWith` prefix, `worktree_path ?? project_path`, ENOENT/EACCES mapping, DI `readdirFn`/`readFileFn`/`existsFn`). `[VERIFIED: Read]`
- `src/cli/dashboard/App.js:391-463` — `c`/`l` overlay handlers (snapshot freeze, `overlayReqRef` CR-01, async pattern). `[VERIFIED: Read]`
- `src/cli/dashboard/App.js:296-317` — overlay sub-mode (Esc close, scroll clamp). `[VERIFIED: Read]`
- `src/cli/dashboard/SessionTable.js:38-48, 119-165, 283-335` — `COLS` widths, `renderOverlay`, column header + data-cell render, state-cell IIFE. `[VERIFIED: Read]`
- `src/cli/dashboard/select.js:44-201` — pure derive layer (sort/filter/counts), the home for `deriveAnyGsd`. `[VERIFIED: Read]`
- `src/cli/dashboard/format.js:108-116` — `statusColor` already v3-aware (`running+!alive → red`). `[VERIFIED: Read]`
- `src/cli/dashboard/client.js:49-204` — never-throws discriminant template. `[VERIFIED: Read]`
- `src/gsd/resolver.js:40-80` — `resolvePhase` discriminated union; matches `normalizeTitle(task.title)` (the missing-field finding). `[VERIFIED: Read]`
- `src/session/state.js:15-29` — `SessionRecord` shape: `task_ref`, `phase_id?`, `worktree_path?`; **no `task.title`**. `[VERIFIED: Read]`
- `src/server.js:420-459` — GET /status spreads `...s` (enriched). `[VERIFIED: Read]`
- `test/dashboard-overlay.test.js`, `test/dashboard-select.test.js`, `test/dashboard-format.test.js`, `test/format-isolation.test.js` — test harness + isolation walker. `[VERIFIED: Read]`
- `.planning/phases/44-.../44-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — locked decisions, requirements, invariants. `[VERIFIED: Read]`

### Secondary (MEDIUM confidence)
- `.planning/config.json` — `nyquist_validation: true`, `granularity: coarse`. `[VERIFIED: Read]`

### Tertiary (LOW confidence)
- None — all claims grounded in read source. The only `[ASSUMED]` items (A2/A3) are flagged in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all templates read directly.
- Architecture: HIGH — every sub-task has a verbatim in-repo template (`verify.js`, `c`/`l` overlay, `statusColor`, derive layer).
- Pitfalls: HIGH — the sync-vs-async overlay subtlety and the missing-`task.title` finding are verified against source, not assumed.
- Plan-file naming (A2): MEDIUM — convention-based; no `PLAN.md` on disk yet to confirm exact suffix.

**Research date:** 2026-06-09
**Valid until:** ~2026-07-09 (stable internal codebase; re-verify only if the overlay machinery or `verify.js` discovery block changes).
