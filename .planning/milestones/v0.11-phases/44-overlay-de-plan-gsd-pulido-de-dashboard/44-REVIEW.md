---
phase: 44-overlay-de-plan-gsd-pulido-de-dashboard
reviewed: 2026-06-09T11:35:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/cli/dashboard/plan.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/SessionTable.js
  - src/cli/dashboard/select.js
  - test/dashboard-plan.test.js
  - test/dashboard-overlay.test.js
  - test/dashboard-select.test.js
  - test/dashboard-table.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 44: Code Review Report

**Reviewed:** 2026-06-09T11:35:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 44 adds a GSD plan overlay (`p` key) backed by a new pure/sync/never-throws filesystem reader (`plan.js`), the TUI-18 conditional `phase/mode` column drop via `deriveAnyGsd`, and the TUI-19 per-row `(zombie)` mark in the `state` cell. Overall the work is careful and the documented invariants hold up well under adversarial reading:

- **Color isolation** — verified: zero `picocolors` imports under `src/cli/dashboard/`; every color flows through ink `<Text>` props. The grep hits are all comments.
- **Anti-ReDoS** — verified: no `new RegExp` on filesystem/user strings; the only regex is the constant literal `/^\d+$/` on a kodo-sourced `phase_id`. Directory/file matching uses `String.startsWith/endsWith`.
- **never-throws** — verified: `readPlan` wraps every readdir/readFile and the injected `resolvePhaseFn` so no throw can reach React; the discriminated `{status, lines}` contract is honored, and a single unreadable PLAN.md degrades to `(unreadable)` without aborting the rest.
- **Synchronous `p` handler** — verified: it correctly does NOT capture `overlayReqRef` on open (no cargo-culted dead guard); the atomic same-tick `setMode` makes the c/l reqId race inapplicable, as documented.
- **Discriminant routing** — verified: `readPlan`'s `no-phase`/`no-plan`/`error`/`ok` map cleanly through `renderOverlay`; the shared `'error'`/`'ok'` discriminants between plan/logs/comments are disambiguated by `isPlan`/`isLogs`, no collision.

No blockers found. Three warnings (one genuine path-traversal surface, one stale `@ts-check` prop type, one unbounded synchronous read) and three info-level items below.

## Warnings

### WR-01: Path traversal possible through a crafted `*-PLAN.md` filename entry

**File:** `src/cli/dashboard/plan.js:100-116`
**Issue:** `readPlan` collects directory entries that merely `endsWith('-PLAN.md')` and feeds each entry name straight into `join(phasesRoot, dir, f)`. Because `node:path.join` collapses `..` segments, an entry name containing traversal escapes the fixed phase root. Reproduced:

```
readdir(.../44-foo) → ['44-01-PLAN.md', 'evil/../../escape-PLAN.md']
→ readFile('/proj/.planning/phases/44-foo/44-01-PLAN.md')   // intended
→ readFile('/proj/.planning/phases/escape-PLAN.md')          // ESCAPED the phase dir
```

The directory name (`dir`) is matched only by `startsWith(`${padded}-`)`, so a sibling like `44-../../X` would likewise escape. The practical blast radius is bounded — anyone able to write files into `.planning/phases/` already controls the repo content the overlay displays — so this is defense-in-depth rather than a remote vuln. But the module's own header claims "composes paths under a fixed `.planning/phases/` root", and that claim is currently false for adversarial entry names.

**Fix:** Reject entry/dir names that contain path separators or `..` before composing the path. Since these are bare directory-entry basenames, any separator is already anomalous:

```js
// dir guard (after find):
if (!dir || dir.includes('/') || dir.includes('\\') || dir.includes('..')) {
  return { status: 'no-plan', lines: [] };
}
// file filter:
.filter((f) => f.endsWith('-PLAN.md') && !f.includes('/') && !f.includes('\\') && !f.includes('..'))
```

(Pure `String.includes` — no new RegExp, preserves the anti-ReDoS invariant.)

### WR-02: Stale `@ts-check` prop types on `SessionTable` omit the `'plan'` overlay kind

**File:** `src/cli/dashboard/SessionTable.js:214,216`
**Issue:** Phase 44 widened the internal `renderOverlay` JSDoc to `'comments'|'logs'|'plan'` (lines 119/121) but left the public `SessionTable` prop JSDoc narrow:

```js
* @param {'comments'|'logs'|null} [props.overlayKind] - ...
* @param {{ kind: 'comments'|'logs', taskRef: string, status: string, lines: string[] }|null} [props.overlaySnapshot]
```

App.js calls `setOverlayKind('plan')` (line 498) and builds `{ kind: 'plan', ... }` snapshots (line 497), then passes both into `SessionTable` (lines 609/611). Under the file's `// @ts-check` directive these are now type-incompatible with the declared prop types — the annotation actively lies about the accepted domain and would surface as a checker error (or silently mislead future maintainers). The runtime works only because JSDoc types are erased.

**Fix:** Widen both annotations to include `'plan'`, mirroring the already-corrected `renderOverlay` JSDoc:

```js
* @param {'comments'|'logs'|'plan'|null} [props.overlayKind]
* @param {{ kind: 'comments'|'logs'|'plan', taskRef: string, status: string, lines: string[] }|null} [props.overlaySnapshot]
```

### WR-03: `readPlan` reads every `*-PLAN.md` fully and synchronously with no size bound on the React tick

**File:** `src/cli/dashboard/plan.js:114-124` and `src/cli/dashboard/App.js:495-497`
**Issue:** The `p` handler calls `readPlan` synchronously inside the keypress callback, and `readPlan` does `readFileFn(...)` on *every* matched PLAN.md with no length cap, splits the entire content into `lines`, and the whole array is stored verbatim in React state (`setOverlaySnapshot`). The documented mitigation (`OVERLAY_VIEWPORT` slicing) only limits *rendering* — it does not limit the *read*, the split, or the retained snapshot. A pathological or accidentally huge `*-PLAN.md` (or many of them) blocks the ink event loop on that tick and holds the full text in memory for the overlay's lifetime.

This is primarily a performance/robustness concern (v1 scope explicitly defers pure performance issues), and real PLAN.md files are small, so it is not a correctness defect today. Flagged as a WARNING for robustness because it is an *unbounded* sync read driven by on-disk content the dashboard does not own the size of.

**Fix:** Cap per-file read (e.g. read with a max byte length, or `slice` the line array to a sane ceiling and append a `… (truncated)` marker) so a degenerate file cannot stall the TUI or balloon the snapshot:

```js
const md = readFileFn(join(phasesRoot, dir, f));
const fileLines = md.split('\n');
const MAX = 5000; // ceiling per phase plan view
for (const ln of fileLines.slice(0, MAX)) lines.push(ln);
if (fileLines.length > MAX) lines.push('── … (truncated) ──');
```

## Info

### IN-01: `padStart(2,'0')` assumes max 2-digit numeric phase prefixes

**File:** `src/cli/dashboard/plan.js:76-78`
**Issue:** Numeric `phase_id` is zero-padded to width 2 to mirror `verify.js` (`"4"` → `"04"`). A three-digit phase (`"100"`) pads to `"100"` and still works, and `"44.1"` is left as-is, so there is no current bug. Worth a one-line note that the canonical convention is 2-digit; if phases ever exceed 99 the prefix match remains correct only because `padStart` is a no-op past width 2. No change required.

### IN-02: `existsFn(phasesRoot)` adds a TOCTOU-prone pre-check the readdir already covers

**File:** `src/cli/dashboard/plan.js:80,86-92`
**Issue:** The `existsFn(phasesRoot)` guard returns `no-plan` early, but the subsequent `readdirFn` already maps `ENOENT` to `entries=[]` → `no-plan`. The `existsSync`+`readdir` pair is a classic TOCTOU pattern (the tree can vanish between the two calls). It is harmless here because both branches converge on `no-plan` and the readdir is wrapped, so the existsFn check is effectively redundant belt-and-suspenders. Could be dropped to simplify, but it is consistent with `verify.js`'s shape and a test (`phasesRoot inexistente (existsFn false) → "no-plan"`) pins it, so leaving it is defensible.

### IN-03: Down-arrow scroll clamp ignores ink's visual line-wrapping

**File:** `src/cli/dashboard/App.js:326-330` and `src/cli/dashboard/SessionTable.js:142-149`
**Issue:** The scroll clamp computes `max = lines.length - OVERLAY_VIEWPORT` treating one `lines[]` entry as one visual row. ink wraps long lines, so a PLAN.md with lines wider than the terminal renders more visual rows than logical lines, and the last screen can under-fill (or a wrapped tail can sit just past the clamp). This is a pre-existing Phase 39 overlay behavior inherited unchanged by the plan overlay (markdown plans are more likely to have long lines than log/comment text), not a Phase 44 regression, and it never crashes or loses data. Noted for awareness; no fix required for this phase.

---

_Reviewed: 2026-06-09T11:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
