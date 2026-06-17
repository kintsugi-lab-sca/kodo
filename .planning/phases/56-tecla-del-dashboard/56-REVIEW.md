---
phase: 56-tecla-del-dashboard
reviewed: 2026-06-17T09:40:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/cli/dashboard/adopt.js
  - src/cli/dashboard/select.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/index.js
  - src/cli/dashboard/SessionTable.js
  - test/dashboard/adopt.test.js
  - test/dashboard/select-adopt.test.js
  - test/dashboard/app-adopt.test.js
  - test/dashboard/app-focus.test.js
  - test/dashboard-render.test.js
findings:
  critical: 1
  critical_resolved: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 56: Code Review Report

**Reviewed:** 2026-06-17T09:40:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 56 adds the dashboard `a` key: discover ad-hoc cmux `claude` surfaces in-process, set-difference against the live `/status` snapshot, picker + double-confirm, and `kodo adopt` shelled via `execFile(process.execPath, [...literal argv])`. The architecture is sound and most invariants hold strongly:

- **execFile is argument-injection safe** — no shell, literal 8-element argv (`adopt.js:95-106`), each value preceded by its explicit `--flag`. Verified.
- **Color isolation holds** — `adopt.js` and `select.js` import zero picocolors / zero `src/cli/format.js` (only comments reference the words). Verified.
- **Zero new server endpoints** — discovery runs in-process via `getHost('cmux').listAgentSurfaces()` (`index.js:136,171-172`). Verified.
- **Set-difference keyed by `session_id`, never `workspace_ref`** — `computeAdoptable` (`select.js:341-346`) builds `tracked` from `session_id` only; the recycled-workspaceRef test passes. Verified.
- **Double-confirm isolation** — adopt arms by `armedSessionId`, dismiss by `armedTaskId`; the `mode==='confirm'` router checks `armedSessionId != null` FIRST (`App.js:562`), so `a` never triggers dismiss and `d` never triggers adopt. Verified by test (h).
- **runAdopt never-throws** — sync-throw, ENOENT, numeric exit code, and unknown errors all collapse to the discriminant; leak-guard TypeError is the sole deliberate throw. Verified.

All 31 phase tests pass. However, the **never-throws-into-React invariant is broken on one path**: `resolveProjectId` can throw a synchronous `TypeError` from operator-corruptible config inside the keyboard handler. Details below.

## Critical Issues

### CR-01: `resolveProjectId` throws synchronously into React when `projects.json` contains a non-string path

**Status:** RESOLVED (commit `1a2eea0`) — `resolveProjectId` now filters out non-string `projects` values and tolerates a non-string `cwd` before normalizing, so no synchronous `TypeError` can reach the ink `useInput` handler. Regression tests added in `test/dashboard/select-adopt.test.js`.

**File:** `src/cli/dashboard/select.js:373` (call site `src/cli/dashboard/App.js:511`)

**Issue:** `resolveProjectId` normalizes paths with `p.replace(/\/+$/, '')`. The `projects` map originates from `loadProjects()` (`config.js:143-151`), which does `JSON.parse(readFileSync(PROJECTS_PATH))` with **no value-type validation** — `~/.kodo/projects.json` is operator-editable / corruptible. If any project path value is a non-string (e.g. a number, `null`, an array from a hand-edit or a bad write), `norm(path)` calls `.replace` on a non-string and throws `TypeError: p.replace is not a function`.

This call sits **inside the synchronous picker `a` handler** (`App.js:504-519`), with no try/catch anywhere between it and the ink `useInput` callback. Unlike the adopt/dismiss/focus paths — which `await` never-throws orchestrators — this is a synchronous throw that propagates straight into React, tearing down the ink panel. That directly violates invariant (1) "never-throws — no throw reaches React, the ink panel stays mounted."

Reproduced:
```
resolveProjectId("/home/op/kodo", { kodo: 123, other: null })
→ TypeError: p.replace is not a function
```

The phase comments explicitly assume `loadProjects()` is `Record<string,string>` ("VERIFICADO `Record<string,string>`", `select.js:352`), but that is the *intended* shape, not an *enforced* one — `loadProjects` only guards against unparseable JSON, not against well-formed JSON with wrong value types.

**Fix:** Make `norm` (and the filter) tolerant of non-string entries — the same never-throws discipline `computeAdoptable` already applies to its inputs. For example:

```js
export function resolveProjectId(cwd, projects) {
  const norm = (/** @type {string} */ p) => p.replace(/\/+$/, '');
  const c = norm(cwd);
  const matches = Object.entries(projects ?? {})
    .filter(([, path]) => typeof path === 'string') // skip malformed entries (never-throws)
    .filter(([, path]) => {
      const p = norm(path);
      return c === p || c.startsWith(p + '/');
    });
  // ... unchanged
}
```

(Guarding `cwd` itself is not strictly required — `normalizeSurface` already validates `b.cwd` is a string before a surface reaches the consumer — but the `projects` side is unvalidated and must be defended.)

## Warnings

### WR-01: ADOPT discover handler resumes into a stale `sessions` snapshot after a long await, but never re-checks `mode`

**File:** `src/cli/dashboard/App.js:829-845`

**Issue:** The list-mode `a` handler awaits `onAdoptDiscover()` (a fan-out of `cmux surface resume show` calls — potentially hundreds of ms), then unconditionally calls `setOverlaySnapshot(...)`/`setMode('overlay')`. The `reqId` guard (`overlayReqRef`) only protects against a *second overlay open / Esc-close* during the await; it does not cover a transition into `confirm` or `filter` via another key, nor does it re-read `mode`. If during the await the operator armed a dismiss (`d` → `confirm`), the post-await `setMode('overlay')` would clobber the dismiss confirm and silently drop the operator's armed action. This is a narrower window than the `c`/`l` handlers (which share the same `reqId` pattern and the same gap), but the adopt discovery await is the longest of the four, so the window is widest here.

**Fix:** After the await, bail if the mode changed, mirroring the `reqId` check:
```js
const surfaces = (await onAdoptDiscover?.()) ?? [];
if (overlayReqRef.current !== reqId) return;
// also: the keystroke that opened this must still own list mode
// (capture mode at entry or check a mode-generation token)
```
At minimum, document that a mode-changing keystroke during discovery is a known race; ideally gate the post-await `setMode` on the entry mode still being `'list'`.

### WR-02: `computeAdoptable` diffs against `sessions` (raw, keep-last-good) — a stale snapshot can re-offer an already-adopted session

**File:** `src/cli/dashboard/App.js:832`

**Issue:** The set-difference uses the raw `sessions` state (`computeAdoptable(surfaces, sessions)`), which is keep-last-good: on a failed poll it is NOT refreshed (`onResult`, `App.js:374-379`). If the server is down (`connected === false`) when the operator presses `a`, `sessions` reflects the last good poll, which may predate a just-adopted session. The diff would then re-offer a session that is already tracked. Adopting it again shells `kodo adopt --session-id <dup>`; the resulting collision is handled server-side (exit 1/2 → footer), so this is not a data-loss bug, but the picker can present a misleading "adoptable" entry while the dashboard is visibly stale (the `⚠ server caído` banner is showing). This is acceptable per the phase's fail-loud-to-CLI posture, but it is an undocumented edge and worth a guard or a comment.

**Fix:** Either (a) note in the handler that the diff is best-effort against keep-last-good data (mirror the `grepLogs` "best-effort" framing), or (b) suppress the picker when `!connected` since the diff input is known-stale.

### WR-03: `ADOPT_OK` footer claims success even when `onAdopt` is absent (degraded/no-DI context)

**File:** `src/cli/dashboard/App.js:574-579`

**Issue:** In the confirm handler, `const result = await onAdopt?.(armedSurface)`. When `onAdopt` is undefined (module-level tests / degraded wiring), `result` is `undefined`, and the branch `if (!result || result.ok !== false)` treats that as success and renders the green `ADOPT_OK(ref)` footer — telling the operator the session was adopted when **nothing was shelled**. This mirrors the pre-existing `onOpen`/`onFocus` `?.` pattern (so it is consistent with the codebase), but adopt is a mutating action (it spawns `kodo adopt`), unlike `focus`/`open`. A green "adopted" confirmation for a no-op is more misleading here than for focus. In production `onAdopt` is always wired (`index.js:175-176`), so this is not a runtime BLOCKER, but the success-on-absent-callback conflation is a latent trap if the prop is ever made conditional.

**Fix:** This is the established convention, so a comment is the minimum. If tightening: only render `ADOPT_OK` when `onAdopt` actually ran (`result` truthy or `onAdopt` defined), and treat the no-DI path as a silent no-op rather than a green confirmation.

## Info

### IN-01: `renderOverlay` JSDoc and `props.overlaySnapshot` typedef omit the `'adopt'` kind

**File:** `src/cli/dashboard/SessionTable.js:125,271`

**Issue:** `renderOverlay`'s `@param snap` is typed `{ kind: 'comments'|'logs'|'plan', ... }` and `SessionTable`'s `props.overlaySnapshot` is `{ kind: 'comments'|'logs'|'plan', ... }`, but Phase 56 added the `'adopt'` kind (routed to `renderAdoptPicker` and present in `App.js`'s union at `App.js:360`). The runtime is correct (adopt is routed before `renderOverlay`), but the type annotations drift from reality and `adoptable?` is undocumented in the prop typedef.

**Fix:** Extend both annotations to include `'adopt'` and document the optional `adoptable` field, matching the `App.js:360` union.

### IN-02: `renderAdoptPicker` has no viewport slice — many surfaces render unbounded

**File:** `src/cli/dashboard/SessionTable.js:205-225`

**Issue:** `renderAdoptPicker` maps every entry of `adoptable` to a row with no `OVERLAY_VIEWPORT` slice (unlike `renderOverlay`, which slices `lines` to the viewport). If a host ever returns a large surface list, the picker renders all rows and the cursor can scroll past the visible viewport with no clamping to a visible window. Out of v1 performance scope and unlikely in practice (ad-hoc claude surfaces are few), but flagged as a robustness/consistency gap with the read overlays. Note the cursor itself is correctly clamped to `[0, len-1]` (`App.js:492,496`).

**Fix:** Optional — apply the same `scrollOffset`/`OVERLAY_VIEWPORT` slice used by `renderOverlay` if large lists are ever expected.

---

_Reviewed: 2026-06-17T09:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
