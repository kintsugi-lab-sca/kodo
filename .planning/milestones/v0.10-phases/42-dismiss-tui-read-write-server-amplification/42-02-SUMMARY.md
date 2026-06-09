---
phase: 42-dismiss-tui-read-write-server-amplification
plan: 02
subsystem: cli-dashboard-tui
tags: [tui, dismiss, ink, react, never-throws, read-write, destructive-mutation]
requires:
  - "DELETE /sessions/{id} amplified server (Plan 01, wave 1 sibling) returning {ok, removed, actions:[{type,result}]} / 409 {ok:false,error:'alive'}"
  - "doctor.execute({taskId, fix:true}) sanitation (Phase 41) — consumed transitively via the server"
provides:
  - "dismissSession(baseUrl, taskId, fetchFn?) never-throws DELETE client in client.js"
  - "mapDismissResult(res, taskRef) pure actions[]→{kind,color} mapper in select.js"
  - "mode:'confirm' state machine + d handler (inverse alive guard) + DISMISS_* exported consts in App.js"
  - "transient footer (green/yellow/red) + persistent confirm prompt in SessionTable.js"
affects:
  - "src/cli/dashboard/App.js (mode union, useInput routing, footer hint)"
  - "src/cli/dashboard/SessionTable.js (footer precedence chain)"
tech-stack:
  added: []
  patterns:
    - "never-throws data-layer client (calque of fetchComments)"
    - "ink mode-gated useInput state machine (sibling of filter/overlay)"
    - "pure derive mapper extracted to select.js for React-free unit testing"
    - "transient footer via generalized focusError + footerColor sibling state"
key-files:
  created:
    - "test/dashboard/select-dismiss.test.js"
    - "test/dashboard/app-dismiss.test.js"
  modified:
    - "src/cli/dashboard/client.js"
    - "src/cli/dashboard/select.js"
    - "src/cli/dashboard/App.js"
    - "src/cli/dashboard/SessionTable.js"
    - "test/dashboard-client.test.js"
    - "test/dashboard/app-focus.test.js"
decisions:
  - "Generalized Phase 37 focusError into a transient footer with a footerColor sibling (lowest-diff, D-12) instead of a new {text,color} object"
  - "mapDismissResult returns a structured {kind,color,reason?} discriminant (not literal copy) so select.js stays free of App.js imports (grep gate == 0, no circular import)"
  - "confirmLine derives from mode==='confirm' (not focusError) so clear-on-any-input never consumes the second 'd' (RESEARCH Pitfall 4)"
  - "app-dismiss tests use setTimeout(80ms) tick (not the overlay setImmediate drain) because chained keystrokes depend on the prior mode re-render (RESEARCH Pitfall 5)"
metrics:
  duration_min: 35
  tasks: 2
  files_changed: 8
  commits: 4
  completed: 2026-06-05
---

# Phase 42 Plan 02: Dismiss TUI read-write Summary

Promoted the kodo dashboard TUI from read-only to read-write: `d` arms an inline `mode:'confirm'` prompt over a dead row, a second `d` dispatches `DELETE /sessions/{id}` through a never-throws client, and the structured result maps to a transient green/yellow/red footer — the first conscious break of the v0.9 "TUI read-only" invariant.

## What Was Built

**Task 1 — never-throws client + pure mapper:**
- `dismissSession(baseUrl, taskId, fetchFn?)` in `client.js`: a verbatim calque of `fetchComments` with `method:'DELETE'`. `encodeURIComponent(taskId)` in the path (T-39-01/V5). Collapses every network/HTTP/JSON failure to `{ok:false,error}`; reads the body so a 409 surfaces `error:'alive'`; on success returns `{ok:true,data:{removed,actions}}` with an `actions` array-shape guard. No throw reaches React (SC#4, v0.9 invariant).
- `mapDismissResult(res, taskRef)` in `select.js`: pure `actions[]→{kind,color,reason?}` discriminant. Precedence `!ok→error/red` (incl. `alive`), `result:'error'→warn/yellow` (error wins over dirty), `moved-dirty→dirty/yellow`, else `ok/green` (D-09). Stays free of App.js imports (no circular import; grep gate == 0).

**Task 2 — confirm state machine + d handler + footer:**
- `DISMISS_*` exported literal-stable consts in App.js (`DISMISS_GUARD_ALIVE`, `DISMISS_CONFIRM`, `DISMISS_OK`, `DISMISS_PARTIAL_DIRTY`, `DISMISS_PARTIAL_WARN`, `DISMISS_ERR`) matching the UI-SPEC copy contract.
- `'confirm'` added to the mode union; a new `mode==='confirm'` branch in useInput: `d` `await`s the never-throws `dismissSession` and maps the result to the transient footer; any other key (incl. Esc) cancels with no message and no timer (D-03/D-04).
- The `d` handler in the list branch: no-op without a row (mirror c/l), inverse `alive===true` guard (DISMISS-04/SC#2 — never dismisses a live row), else arms by `task_id` identity + captures `task_ref` for the copy (D-13). No optimistic UI; the row disappears via the natural poll (D-11).
- Generalized `focusError` into a transient footer with a `footerColor` sibling (D-09 color derived from actions[], not a color lookup). `confirmLine` (cyan, persistent) derives from `mode==='confirm'`; precedence chain updated to `confirmLine ?? errorLine ?? filterLine` in all three SessionTable return branches. Footer hint gains `· d dismiss`.

## How to Verify

```
node --test test/dashboard-client.test.js test/dashboard/select-dismiss.test.js   # never-throws client + pure mapper
node --test test/dashboard/app-dismiss.test.js                                     # state machine + 3-layer TUI guard + footer mapping
node --test test/format-isolation.test.js                                          # color-isolation walker (no picocolors)
grep -c "App.js" src/cli/dashboard/select.js                                        # == 0 (no circular import)
```

All green: client+mapper 30/30, app-dismiss 7/7, format-isolation 8/8, grep gate 0. Full suite: 1162 pass, 0 fail, 1 skipped (preexisting).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] app-focus.test.js footer-hint assertion broke after the `· d dismiss` hint addition**
- **Found during:** Task 2 (full dashboard suite run)
- **Issue:** `test/dashboard/app-focus.test.js` hardcoded the literal footer hint `↑↓ move · / filter · q quit`. The plan's acceptance criteria mandate appending `· d dismiss` to that hint (App.js root footer), so the preexisting assertion failed.
- **Fix:** Updated the assertion (and the header comment) to the new contract `↑↓ move · / filter · d dismiss · q quit`. This is the intended new copy, not a regression. Confirmed no other test hardcodes the old hint.
- **Files modified:** `test/dashboard/app-focus.test.js`
- **Commit:** aad35fc

### Test-harness adjustment (not a source deviation)

The `app-dismiss.test.js` harness uses `setTimeout(80ms)` ticks between keystrokes instead of the `setImmediate` `drain()` copied from the overlay test. Chained keystrokes that depend on the prior `mode` re-render (the second `d` must see `mode==='confirm'`) need a real frame for ink to re-register `useInput` with the fresh closure — exactly RESEARCH Pitfall 5. The molde for chained keystrokes is `app-focus.test.js` (also 80ms). Verified directly: with `setImmediate` the second `d` used a stale `mode==='list'` closure and re-armed instead of dispatching; with 80ms it dispatches one DELETE and clears confirm.

## Known Stubs

None. The dismiss path is fully wired end-to-end against the Plan 01 HTTP contract; no placeholder data flows to the UI.

## Threat Flags

None. The TUI dismiss surface introduces no new endpoints or trust boundaries beyond the `DELETE /sessions/{id}` consumption already in the plan's threat register (T-42-06..10): double-`d` arm/confirm (T-42-06), inverse alive guard (T-42-07), never-throws collapse (T-42-08), `encodeURIComponent` path (T-42-09), `.dirty` transparency in the footer (T-42-10) — all implemented and tested.

## Self-Check: PASSED

- Files created exist: `test/dashboard/select-dismiss.test.js`, `test/dashboard/app-dismiss.test.js` — FOUND.
- Commits exist: 5479815 (test), 5b55191 (feat), 7d90185 (test), aad35fc (feat) — all in `git log`.
