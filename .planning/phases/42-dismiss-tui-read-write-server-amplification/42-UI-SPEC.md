---
phase: 42
slug: dismiss-tui-read-write-server-amplification
status: draft
shadcn_initialized: false
preset: none
surface: tui
created: 2026-06-05
---

# Phase 42 — UI Design Contract (TUI)

> Visual and interaction contract for the `d` (dismiss) capability of the kodo terminal dashboard.
> This is a **terminal UI** built with Node + ink@6 + react@19 (`React.createElement` plano, no build step). There is NO CSS, NO Tailwind, NO web palette, NO pixel spacing. The template's web dimensions are adapted: typography→column/cell layout, spacing→terminal-cell alignment, color→semantic ink `<Text color>`. The bulk of this contract lives in the **Interaction Contract** and **Copy Contract** sections.
>
> Grounded in `42-CONTEXT.md` (D-01..D-13, ALL LOCKED) and the existing dashboard source (`App.js`, `SessionTable.js`, `client.js`, `select.js`). It does NOT re-open settled questions and does NOT invent a new design system — it mirrors v0.9 conventions.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (terminal UI — shadcn/web design systems not applicable) |
| Preset | not applicable |
| Component library | ink@6 (`<Box>` / `<Text>`), React.createElement plano (no JSX, no build step) |
| Icon library | none — Unicode glyphs only (`●`, `⚠`, `›`, `▏`, `…`, `[!]`), mirroring existing `App.js`/`SessionTable.js` usage |
| Font | terminal monospace (operator's terminal; not controllable) |

**Color isolation invariant (cross-milestone, MUST hold):** all color comes from ink `<Text color>` name strings (`green`/`red`/`cyan`/`yellow`/`dimColor`). ZERO `picocolors`, ZERO inline ANSI in `src/cli/dashboard/`. Verified by `test/format-isolation.test.js` (automatic walker). Any new footer/confirm rendering this phase adds is covered by that walker.

**Markup convention:** `React.createElement` plano (alias `h` in `SessionTable.js`, `createElement` in `App.js`). No JSX. Mirror the existing files exactly.

---

## Layout / Cell Alignment (template "Spacing" + "Typography", adapted)

The dismiss feature adds NO new columns and NO new full-screen region. It reuses the existing footer line slot at the bottom of `SessionTable` (the same `<Box marginTop:1>` slot today occupied by `filterLine` / `errorLine`).

| Region | Existing slot | Phase 42 usage |
|--------|---------------|----------------|
| Table body | `dataRows` (COLS fixed widths) | unchanged — the dismissed row disappears by natural poll (D-11), `resolveSelection` clamps cursor (D-13) |
| Footer line (bottom, modal) | `<Box marginTop:1><Text>…</Text></Box>` — currently `errorLine ?? filterLine` | **armed/confirm prompt** and **transient result message** render here, same `<Box marginTop:1>` shape |
| Footer hint line (App.js root) | `<Text dimColor>'↑↓ move · / filter · q quit'</Text>` | gains a `· d dismiss` hint segment (dim, only meaningful when a dead row is selected) |

**Cell-alignment rules (mirror existing):**
- The confirm/result line is a single `<Text>` in a `<Box marginTop:1>` — NOT a new bordered box, NOT a centered overlay. It mirrors `filterLine` (`App.js`/`SessionTable.js` line ~227) and `errorLine` (line ~236) exactly in shape and granularity.
- Footer-message precedence (extends the existing `errorLine ?? filterLine` precedence): **confirm/armed line wins over filterLine** while `mode === 'confirm'`; **transient result message wins over filterLine** until cleared by clear-on-any-input. Recommended single precedence chain: `confirmLine ?? resultLine ?? errorLine ?? filterLine`. The planner generalizes the existing `focusError` state into a sibling/unified "footer message" state (D-12 — planner's discretion on exact state shape).
- No frozen overlay region: under `mode === 'confirm'` the render does NOT freeze (D-05) — unlike the Phase 39 overlay. The table keeps polling beneath the confirm line.

**Exceptions:** none beyond the above (no new fixed-width columns; `COLS` in `SessionTable.js` is unchanged).

---

## Semantic Color (template "Color", adapted to ink `<Text color>`)

Reuse the EXISTING semantic palette only. Do not introduce new colors.

| Role | ink color | Reserved for (this phase) |
|------|-----------|---------------------------|
| Success | `green` | result footer on full success (`dismissed <task>`). Mirrors the `● live` green semantic. |
| Warning / partial | `yellow` | result footer on partial success (worktree preserved as `.dirty`, or fail-open sub-warnings). Mirrors the `⚠ server caído` yellow and the `OVERLAY_LOGS_LABEL` honesty-yellow. |
| Error | `red` | result footer on hard failure (`{ok:false}` from `dismissSession`), and the guard-rejection message on `d` over a live row. Mirrors `errorLine` red (`SessionTable.js` ~238). |
| Armed / confirm prompt | `cyan` **or** `dimColor` | the armed confirm line ("press d again to dismiss"). RECOMMENDED: `cyan` for the actionable verb prompt (mirrors the `comments` overlay-title cyan), so the destructive armed state reads as active/attention, distinct from a neutral dim hint. Planner may use `dimColor` if it prefers parity with the filter prompt — but the armed state MUST be visually distinguishable from the idle footer hint. |
| Neutral hint | `dimColor` | the `· d dismiss` segment in the root footer hint (`App.js` ~480). |

**Color is never the sole signal (NO_COLOR / accessibility, mirrors D-09 + the `(zombie)` precedent):** each state is ALSO distinguishable by its literal copy. A `green`/`yellow`/`red` result is legible and unambiguous as plain text under `NO_COLOR`. The partial-vs-success distinction is carried by the WORDS (`— worktree preserved (.dirty)`), not only by yellow — the TUI derives the nuance from `actions[]` (D-09), not from a color lookup.

---

## Interaction Contract (PRIMARY — the core of this spec)

### Mode state machine

Extend the `mode` union in `App.js` (line 172) from `'list' | 'filter' | 'overlay'` to add `'confirm'` (D-01). The new mode is keyboard-routed modally, mirroring `filter`/`overlay`.

```
                press `d` on selected row
                with row.alive === false            press `d` again
   ┌────────┐  ─────────────────────────────▶  ┌──────────┐  ──────────────▶  (await dismissSession)
   │  list  │                                   │ confirm  │                   │ DELETE → result footer │
   │        │  ◀─────────────────────────────   │ (armed,  │                   └────────────────────────┘
   └────────┘   any key ≠ `d`/`Esc`  (cancel)   │ targetId)│                            │
        ▲       Esc (explicit cancel)           └──────────┘                            ▼
        │                                                                      back to `list`
        └──────────────────────────────────────────────────────────────────────────────┘
                              (result footer is transient, clears on any next key — D-12)
```

| Trigger | Precondition | Effect | Locked by |
|---------|--------------|--------|-----------|
| `d` in `list` | selected `row.alive === false` (inverse of the Enter `alive===true` guard, `App.js` ~412) | capture `row.task_id` as the confirm target; `setMode('confirm')`; render armed footer | D-01, D-02, D-07-TUI, DISMISS-04 |
| `d` in `list` | selected `row.alive === true` | DO NOT enter confirm, DO NOT send DELETE; show red guard-rejection footer (`DISMISS_GUARD_ALIVE`) | D-07-TUI, SC#2, DISMISS-04 |
| `d` in `list` | no row selected (`sel.index < 0`) | no-op (mirror the `c`/`l` `if (!row) return`) | mirrors `App.js` ~320 |
| `d` in `confirm` | armed | `await dismissSession(...)` (never-throws); map result → transient footer; `setMode('list')` | D-02, D-10 |
| `Esc` in `confirm` | armed | explicit cancel: `setMode('list')`, clear armed target, NO message | D-04 |
| any key ≠ `d`/`Esc` in `confirm` | armed | cancel armed state, return to `list` (clear-on-any-input, mirrors `App.js` ~252) | D-04 |
| any key after a result message | result footer present | clear the message (consume the keystroke), then process nothing further this keystroke | D-12, mirrors `App.js` ~252 |

**Hard rules (do NOT violate):**
- **No auto-cancel by timer (D-03):** the armed state persists until `d` (confirm) or cancel. No `setTimeout` to clear in transitions/teardown. The stale-armed risk is covered by the server's fresh `alive` re-check (409, D-07/D-08).
- **Render does NOT freeze under `confirm` (D-05):** the poll keeps updating the table so the second-`d` re-check runs against the freshest snapshot. The authoritative TOCTOU re-check is server-side (D-07/D-08): the server re-reads fresh `alive` on the DELETE and rejects a live target with HTTP 409 `{ok:false, error:'alive'}` BEFORE delegating to `doctor.execute`.
- **Identity, never index (D-13, Phase 36 invariant):** confirm targets `task_id`, never an array index or frozen snapshot. After the row disappears, `resolveSelection` (`select.js` ~78) clamps the cursor positionally — NO new cursor code.
- **Never-throws end to end (D-10, SC#4):** the `d` handler `await`s `dismissSession`, which collapses every network/HTTP/JSON failure to `{ok:false, error}`. No bare `await` that can throw reaches React (v0.9 invariant). The handler is already `async` (`App.js` ~245).
- **`d` is the only execute key:** a stray keystroke always aborts (D-04). Only an explicit repeat of `d` mutates.

### Footer-message precedence in `useInput`

The clear-on-any-input guard must run in the right order relative to the new mode. Recommended ordering inside `useInput` (extending the existing chain at `App.js` ~252–306):

1. If a transient **result message** is present → clear it, consume keystroke, return (mirror `focusError` clear, ~252).
2. If `mode === 'overlay'` → existing overlay sub-mode (unchanged).
3. If `mode === 'confirm'` → if `d`: execute; else if `Esc`: cancel; else: cancel (clear-on-any-input). Return.
4. If `mode === 'filter'` → existing filter sub-mode (unchanged).
5. `mode === 'list'` → existing keys; ADD the `d` handler (with the inverse `alive` guard) alongside `c`/`l`/Enter.

(Exact state factoring — whether `focusError` is generalized into one "footerMessage" state with a `kind` discriminant, or a sibling state — is the planner's discretion per D-12. The contract only requires: ONE transient footer slot, clear-on-any-input, precedence above filterLine.)

---

## Copywriting Contract (PRIMARY — literal-stable EXPORTED constants)

All strings below MUST be EXPORTED `const` from `App.js` (mirror `FOCUS_ERR_*` / `OVERLAY_*` at `App.js` ~69–98) so tests import them and assert equality without duplicating literals — killing code/render drift. Constant NAMES are recommendations; the LITERAL copy is the contract.

| Element | Constant (recommended) | Literal copy | Color | Source / locked by |
|---------|------------------------|--------------|-------|--------------------|
| Footer hint segment (idle) | — (inline in root hint) | append ` · d dismiss` to `'↑↓ move · / filter · q quit'` → `'↑↓ move · / filter · d dismiss · q quit'` | `dimColor` | mirrors `App.js` ~480 |
| Armed / confirm prompt | `DISMISS_CONFIRM` | `dismiss <task_ref>? press d again · Esc cancel` | `cyan` (armed) | D-02, D-04; `<task_ref>` is the selected row's `task_ref` (mirrors overlay title `· <taskRef>`) |
| Guard rejection (live row) | `DISMISS_GUARD_ALIVE` | `[!] session is alive — only dead sessions can be dismissed` | `red` | D-07-TUI, DISMISS-04, SC#2; `[!]` prefix mirrors `FOCUS_ERR_*` |
| Success (full) | `DISMISS_OK` (fn) | `dismissed <task_ref>` | `green` | D-09, D-12; parametric on `task_ref` |
| Partial — worktree dirty | `DISMISS_PARTIAL_DIRTY` (fn) | `dismissed <task_ref> — worktree preserved (.dirty)` | `yellow` | D-09; derived from `actions[]` containing `result:'moved-dirty'` |
| Partial — warnings | `DISMISS_PARTIAL_WARN` (fn) | `dismissed <task_ref> — completed with warnings` | `yellow` | D-09; derived from `actions[]` containing any `result:'error'` (fail-open sub-failure) |
| Error (DELETE failed) | `DISMISS_ERR` (fn) | `[!] dismiss failed (<reason>) — press any key` | `red` | D-10, D-12; `<reason>` from `{ok:false, error}` (e.g. `HTTP 500`, `network`, `alive`) |
| Error — server 409 alive | (reuse `DISMISS_ERR` with reason `alive`) | `[!] dismiss failed (alive) — press any key` | `red` | D-07/D-08 server guard surfaced honestly; the operator sees the race was caught |

**Copy rules (locked):**
- **Empty state:** N/A as a new screen — if no row is selected, `d` is a no-op (no message). The existing `no active sessions` / `no sessions match` empty states (`SessionTable.js` ~250) are unchanged.
- **Destructive confirmation (the one destructive action this phase):** dismiss is gated behind double-`d` (arm then confirm) with explicit `Esc` cancel AND clear-on-any-input cancel (D-02/D-04). No modal box, no typed confirmation — an inline armed footer, consistent with the TUI's modal-footer idiom.
- **Transparency over `.dirty` (lesson v0.9 37/38, D-09):** a preserved `.dirty` worktree MUST be surfaced in the footer (`DISMISS_PARTIAL_DIRTY`), never buried only in logs. The operator learns a `.dirty` remains to inspect without opening logs.
- **`<task_ref>`** (human-readable, e.g. `ROMAN-22`) is the display token in all copy — NOT the internal `task_id`. The handler resolves and DELETEs against `task_id` (identity), but renders `task_ref` (legibility), mirroring the overlay title `· <taskRef>`.
- All `[!]`-prefixed error/guard messages and the success/partial messages are transient: cleared by the next keystroke (clear-on-any-input, D-12). The armed `DISMISS_CONFIRM` is NOT transient in that sense — it persists until `d`/`Esc`/cancel-key (D-03, no timer).

### Result-to-footer mapping (from `dismissSession` discriminant)

`dismissSession(baseUrl, taskId, fetchFn?)` returns the never-throws mold (D-10): `{ok:true, data:{removed, actions}}` or `{ok:false, error}`. Map to footer:

| `dismissSession` result | `actions[]` content | Footer message | Color |
|-------------------------|---------------------|----------------|-------|
| `{ok:true}` | every action `removed`/`pruned`/`kept` (no dirty, no error) | `DISMISS_OK(task_ref)` | green |
| `{ok:true}` | contains `result:'moved-dirty'` | `DISMISS_PARTIAL_DIRTY(task_ref)` | yellow |
| `{ok:true}` | contains any `result:'error'` (fail-open sub-failure) | `DISMISS_PARTIAL_WARN(task_ref)` | yellow |
| `{ok:false, error:'alive'}` (server 409) | — | `DISMISS_ERR('alive')` | red |
| `{ok:false, error}` (HTTP/network/JSON) | — | `DISMISS_ERR(error)` | red |

Precedence when both `moved-dirty` AND `error` appear in `actions[]`: surface the MORE severe — recommended `DISMISS_PARTIAL_WARN` (error wins over dirty), since an errored sub-action is a stronger signal than a preserved worktree. (Planner's fine call; either yellow variant satisfies D-09's "distinguishable from full success" requirement.)

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| n/a (no shadcn, no component registry — terminal UI) | none | not applicable |

No third-party registries. No shadcn. No `components.json`. The registry vetting gate does not apply to this TUI phase.

---

## Checker Sign-Off

> Adapted dimensions for a TUI: Copywriting = footer literal constants; Visuals = glyphs/footer layout; Color = semantic ink colors + NO_COLOR legibility; Typography = column/cell alignment (unchanged this phase); Spacing = footer-slot placement; Registry = n/a.

- [ ] Dimension 1 Copywriting (footer constants exported, literal-stable, transient rules): PASS
- [ ] Dimension 2 Visuals (footer-slot reuse, glyph conventions, no new overlay region): PASS
- [ ] Dimension 3 Color (semantic ink colors only, color-isolation, NO_COLOR legibility): PASS
- [ ] Dimension 4 Typography / cell alignment (COLS unchanged, no new columns): PASS
- [ ] Dimension 5 Spacing / footer-slot placement + precedence chain: PASS
- [ ] Dimension 6 Registry Safety (n/a — TUI): PASS

**Approval:** pending
