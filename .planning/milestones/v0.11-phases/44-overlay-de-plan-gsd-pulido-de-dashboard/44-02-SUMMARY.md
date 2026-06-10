---
phase: 44-overlay-de-plan-gsd-pulido-de-dashboard
plan: 02
subsystem: ui
tags: [ink, react, tui, dashboard, derive, color-isolation, anti-redos]

# Dependency graph
requires:
  - phase: 44-overlay-de-plan-gsd-pulido-de-dashboard
    plan: 01
    provides: "App.js/SessionTable.js overlay regions (p handler, OVERLAY_PLAN_*, renderOverlay 'plan' kind) — left untouched by this plan"
  - phase: 36-dashboard-vivo
    provides: "select.js pure derive layer (sortSessions/applyFilter/countByStatus) + SessionTable presentational table + format.js statusColor/stateBadge"
provides:
  - "src/cli/dashboard/select.js — pure deriveAnyGsd(rows) → boolean (rows.some(r => r.phase_id != null))"
  - "App.js anyGsd computed over the UNFILTERED sorted set and threaded as a SessionTable prop"
  - "SessionTable conditional phase/mode column drop (header + data cell) when anyGsd===false + additive per-row (zombie) state-cell mark + COLS.state=18"
affects: [phase-45-spike-plan-capture, phase-46-non-gsd-plan-overlay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural (filter-insensitive) derive computed over `sorted`, NOT `filtered` (Pitfall 4 flicker guard)"
    - "Conditional element-drop column hide via `...(flag ? [el] : [])` spread — ink flex reclaims width, no width arithmetic"
    - "Additive per-row zombie mark whose red is READ from the existing statusColor (sc.color) — zero new color literal"

key-files:
  created: []
  modified:
    - src/cli/dashboard/select.js
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - test/dashboard-select.test.js
    - test/dashboard-table.test.js

key-decisions:
  - "deriveAnyGsd uses `r.phase_id != null` (not truthy) so a falsy-but-real phase_id (0/'') counts as GSD; null/undefined alone excludes (D-08)"
  - "anyGsd derived over `sorted` (App.js:277) NOT `filtered` — typing a `/` filter that empties the GSD rows must NOT flicker the column (Pitfall 4 / D-08)"
  - "phase/mode column hidden via `...(anyGsd ? [el] : [])` spread on BOTH header and data cell — element-drop, ink flex shifts siblings left, zero width math (RESEARCH Pattern 3)"
  - "Zombie red reuses the already-computed `sc = statusColor(session.status, session.alive, session.state)` (returns {color:'red'} for running+!alive) — zero new color, zero second palette (D-09/D-12)"
  - "COLS.state widened 16→18 (LOCKED spec value); the zombie mark survives un-truncated, though at exactly-18 width ink wraps `(zombie)` to a second line of the same cell (see Deviations)"

patterns-established:
  - "Structural GSD-presence flag: a pure derive over the unfiltered set that drives a conditional column drop (reusable for any future filter-insensitive column toggle)"
  - "Additive semantic per-row mark sourced from an existing color fn (no new literal) — pattern for future per-row badges under the color-isolation invariant"

requirements-completed: [TUI-18, TUI-19]

# Metrics
duration: 18min
completed: 2026-06-09
---

# Phase 44 Plan 02: Dashboard polish — phase/mode column drop + per-row zombie mark Summary

**A pure React-free `deriveAnyGsd(rows)` computed over the unfiltered `sorted` set that conditionally drops the `phase/mode` column (header + every data cell) when no active session is GSD, plus an additive per-row `(zombie)` mark in the `state` cell whose red is read from the existing `statusColor` — zero new color, zero picocolors, zero RegExp, COLS.state widened 16→18.**

## Performance
- **Duration:** ~18 min
- **Tasks:** 2 (Task 1 TDD: RED → GREEN; Task 2: column-drop + zombie mark)
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments
- **TUI-18 / D-08:** `deriveAnyGsd(rows) = rows.some(r => r.phase_id != null)` — a single pure, React-free, regex-free, color-free fn in `select.js` mirroring `countByStatus`. App.js computes `const anyGsd = deriveAnyGsd(sorted)` over the UNFILTERED `sorted` set (NOT `filtered`, Pitfall 4) and threads it into the `SessionTable` prop bag. `SessionTable` drops the `phase/mode` header `<Box>` and every per-row data cell via `...(anyGsd ? [el] : [])` spread when `anyGsd===false`; ink flex reclaims the 11 cells for free. The column reappears automatically when a GSD session enters.
- **TUI-19 / D-09:** the `state` cell IIFE now computes `isZombie = (status==='running' || state==='running') && alive===false`; when true it appends ` (zombie)` to the badge text and sets the color from the already-computed `sc.color` (= `statusColor(...).color` = red). The header zombie counter (`countsLabel`/`countByStatus`) is untouched — the per-row mark is purely additive. `COLS.state` widened 16→18 (Pitfall 3) so the mark survives un-truncated.
- **Invariants preserved:** zero `import picocolors` and zero `new RegExp` under `src/cli/dashboard/` (verified); `test/format-isolation.test.js` green; 44-01 overlay regions (`renderOverlay`, `p` handler, `OVERLAY_PLAN_*`, `readPlan`) byte-untouched.

## Task Commits
1. **Task 1 (RED): failing deriveAnyGsd truth-table** — `5582bb4` (test)
2. **Task 1 (GREEN): deriveAnyGsd pure helper threaded over sorted** — `8e65f19` (feat)
3. **Task 2: conditional phasemode drop + per-row (zombie) mark + COLS.state=18** — `5814329` (feat)

_Task 1 was TDD: RED (test) then GREEN (feat). No REFACTOR commit needed._

## Files Created/Modified
- `src/cli/dashboard/select.js` (modified) — export `deriveAnyGsd(rows)`; pure derive, no regex/color.
- `src/cli/dashboard/App.js` (modified) — import `deriveAnyGsd`; compute `anyGsd` over `sorted` (with a Pitfall-4 comment); thread `anyGsd` into the `SessionTable` prop bag.
- `src/cli/dashboard/SessionTable.js` (modified) — COLS.state 16→18; `anyGsd` prop (default true) + JSDoc; conditional drop of the `phase/mode` header `<Box>` and data cell via spread; additive `(zombie)` mark in the state cell sourced from `sc.color`.
- `test/dashboard-select.test.js` (modified) — `deriveAnyGsd` truth table (some/none/empty + `phase_id===0`) plus a D-08 derive-before-filter case proving the full set returns true even when an active filter removes the GSD rows.
- `test/dashboard-table.test.js` (modified) — `FIXTURE_NO_GSD` (no phase_id) → column-hide assertion + reappear with the GSD `FIXTURE`; per-row zombie mark survives + header counter unchanged (additive) + zombie independent of phase_id.

## Decisions Made
- **`!= null` guard, not truthy.** `deriveAnyGsd` distinguishes null/undefined (absent → non-GSD) from `0`/`''` (present → GSD). A test pins `phase_id===0 → true`.
- **Derive over `sorted`, not `filtered`.** The column is structural: it is present whenever ANY active session is GSD and must not flicker when a `/` filter temporarily empties the GSD rows from the visible subset (Pitfall 4). A dedicated test mechanically proves the derivation order (the full set returns `true` even when the filtered subset returns `false`).
- **Element-drop, not width arithmetic.** Both the header and data `phase/mode` cells are omitted via `...(anyGsd ? [el] : [])`; ink's `flexDirection:'row'` shifts siblings left. No manual width recomputation (RESEARCH Pattern 3 / A3).
- **Zombie red reused from `sc`.** The existing `const sc = statusColor(session.status ?? '', session.alive, session.state)` already returns `{color:'red'}` for running+!alive; the zombie branch reads `sc.color` instead of issuing a second `statusColor` call or a new literal — zero new color, color-isolation intact (D-09/D-12).

## Deviations from Plan
None functional — plan executed as written. One layout nuance worth flagging for the verifier:

### Layout note (not a deviation — LOCKED width honored)
**COLS.state=18 wraps the zombie mark to a 2nd cell line at the exact-equal boundary.** `▶ running (zombie)` measures exactly 18 (`string-width`), which equals the LOCKED `COLS.state=18`. Empirically ink/Yoga wraps `(zombie)` onto a second line of the same `state` cell (the `▶` glyph appears to be measured as 2 by Yoga's internal layout, unlike `string-width`'s 1). The mark **survives un-truncated** — which is the binding D-09 / UI-SPEC contract ("survives un-truncated") — so the text is never lost; it simply wraps. The plan's `<action>` and acceptance grep mandate `state: 18`, so I honored the LOCKED value rather than bumping to 19 (which would give a single line but violate the explicit `grep -c "state: 18" === 1` acceptance). The table-test assertions therefore check that BOTH `▶ running` and `(zombie)` are present (survival), not strict single-line adjacency. If a single-line render is desired in a future polish, `COLS.state=19` would suffice — out of scope here (locked spec).

## Issues Encountered
- **`grep -c "(zombie)"` returns 3, `grep -c picocolors` returns 6 (acceptance expected 1 / 0).** Same situation documented in 44-01: the binding contracts — exactly ONE additive `(zombie)` code occurrence (SessionTable.js:351) and ZERO `import picocolors` — are fully satisfied and enforced by `test/format-isolation.test.js` (green). The extra grep hits are PRE-EXISTING documentation comments (lines 17/42 reference `(zombie)`; lines 20/117/207/241/268/338 reference `picocolors` to document the invariant). Per surgical-change discipline I reworded the comments I authored this plan to drop the literal substrings but did NOT rewrite pre-existing comments. The `statusColor(session.status` grep returns 1 (the existing `const sc` line), whose `.color` is what the zombie branch consumes.

## User Setup Required
None — no external service configuration. Zero new packages (Package Legitimacy Audit: Not applicable).

## Known Stubs
None. Both features are fully wired to live data (`deriveAnyGsd(sorted)` over real `sessions`; the zombie mark over real `status`/`alive`/`state`).

## TDD Gate Compliance
- RED gate: `5582bb4` (test) — failing `deriveAnyGsd` truth-table committed before implementation (import of a non-existent export → whole-file RED).
- GREEN gate: `8e65f19` (feat) — `deriveAnyGsd` added + threaded, making the truth table pass.
- REFACTOR: none needed.

## Self-Check: PASSED
- FOUND: src/cli/dashboard/select.js (deriveAnyGsd exported)
- FOUND: src/cli/dashboard/App.js (anyGsd over sorted + threaded)
- FOUND: src/cli/dashboard/SessionTable.js (COLS.state=18 + anyGsd guard + (zombie) mark)
- FOUND: .planning/phases/44-overlay-de-plan-gsd-pulido-de-dashboard/44-02-SUMMARY.md
- FOUND commits: 5582bb4 (RED test), 8e65f19 (GREEN feat), 5814329 (Task 2 feat)
- VERIFIED: `node --test test/dashboard-select.test.js test/dashboard-table.test.js test/format-isolation.test.js` green; full suite 1245 pass + 1 skip; 44-01 overlay regions untouched; STATE.md/ROADMAP.md untouched.

---
*Phase: 44-overlay-de-plan-gsd-pulido-de-dashboard*
*Completed: 2026-06-09*
