# Feature Research

**Domain:** Live session-monitoring TUI (`kodo dashboard`) — an "ambient" terminal panel over kodo's existing `/status`, `/logs`, `/comments/<id>` JSON endpoints. Comparables: lazygit, k9s, lazydocker, btop, htop, gh dash.
**Researched:** 2026-05-26
**Milestone:** kodo v0.9 (kodo TUI — sesiones en vivo)
**Confidence:** HIGH (data contract verified against `src/server.js` + `src/session/state.js`; TUI patterns verified against ink/bubbletea docs + k9s/lazygit issue trackers)

---

## Critical data-contract findings (read first)

The TUI consumes ONLY existing endpoints. Three facts from reading the source change scope materially:

1. **`/logs` has NO `session_id`.** The ring buffer (`src/server.js:13-29`) pushes `{ ts, level, msg }`, where `msg` is a flattened string of `console.*` args (last 200 lines). There is **no structured session key** to filter by. The seed's phrase "filtrado client-side de `/logs` por session_id" is **not directly supported** by the shape. The only client-side filter possible is **substring matching** `msg` against the selected session's `task_ref` / `task_id` / `workspace_ref`. This is best-effort and may show partial or zero matches. The requirements author must scope `l` (tail logs) as a **substring grep over a shared 200-line buffer**, not a true per-session stream. (HIGH — read from source.)

2. **`DELETE /sessions/<id>` is pure bookkeeping, NOT a kill.** `removeSession` (`src/session/state.js:131-145`) moves the SessionRecord to `history` and deletes it from `state.sessions`. It does **not** stop the Claude process, does **not** touch the cmux workspace, does **not** remove the git worktree. Calling it from the TUI would "forget" a session that may still be `alive` in cmux — orphaning a live process from kodo's bookkeeping. This is the decisive fact for the deletion recommendation below. (HIGH — read from source.)

3. **`/comments/<id>` is keyed by `task_id`, not `task_ref`.** The handler (`src/server.js:421-441`) slices the URL and matches `s.task_id === taskId`. The visible column the user navigates is `task_ref` ("#42"/"KL-7"), but the comments fetch needs `task_id`. The session object from `/status` must therefore carry `task_id` (it does — it's the SessionRecord key). The TUI must call `/comments/<task_id>`, never `/comments/<task_ref>`. (HIGH — read from source.)

Everything else the v1 scope needs (`task_ref`, `project_path`, `provider`, `status`, `phase_id`, `gsd_mode`, `started_at`, `alive`, `elapsed_min`, `workspace_ref`, `task_url`, `summary`) is present on each `/status` session object. No new endpoints required for the decided v1 scope.

---

## Feature Landscape

### Table Stakes (Users Expect These)

A "live monitor" TUI that lacks these feels broken or janky. These are non-negotiable for a tool meant to run all day.

| Feature | Why Expected | Complexity | Notes / Data dependency |
|---------|--------------|------------|-------------------------|
| **Auto-refresh on a fixed cadence (~2s)** | A "live" panel that needs manual refresh isn't ambient. 2s is the de-facto default (k9s default 2s; btop `update_ms=2000`). | LOW | Poll `GET /status` on `setInterval`. 2-3s is correct; faster wastes CPU + hammers `listPendingTasks` (already cached 30s server-side). |
| **Visible "live / last refreshed" indicator** | The operator must trust the data is fresh. A spinner, a "↻ 2s ago" stamp, or a heartbeat dot is the universal tell that the loop is alive vs frozen. | LOW | Render from local clock + last successful poll timestamp. No data dependency. |
| **Stable, deterministic row order ("lazy sort")** | Rows that re-sort every tick make the cursor unusable — you select row 3, it jumps. btop's `cpu lazy` exists precisely to stop this. | LOW–MEDIUM | Sort by a **stable key** that doesn't churn (e.g. `started_at` ascending, or `task_ref`). Do NOT sort by `elapsed_min`/`status` (both mutate every tick → rows reorder). Resolve rows by `task_id` identity, not array index. |
| **Selection that survives refresh** | The single biggest "janky vs good" differentiator. On every poll the data array is rebuilt; if you track the cursor by index, the highlighted row drifts under the user. | MEDIUM | Track selection by **`task_id` (stable identity)**, re-derive the index after each poll. If the selected session disappears (moved to history / removed), fall back to nearest neighbor, not index 0. |
| **Selected-row highlight** | Navigation is meaningless without a clear "you are here." | LOW | ink: inverse/background color on the active row. |
| **Header + footer with keybinding hints** | Discoverability. lazygit/k9s always show contextual keybindings at the bottom; nobody memorizes them cold. | LOW | Static footer: `↑↓ nav · enter attach · c comments · l logs · / search · q quit`. Context-aware footer (different hints in comments/logs view) is a cheap nicety. |
| **Empty state** | Zero sessions is the *normal* idle state for kodo, not an error. A blank screen reads as "broken." | LOW | "No active sessions" + a hint (e.g. "waiting for tasks…"). Distinguish from the down state below. |
| **Graceful degradation when the server is down** | The seed's explicit requirement (PROJECT.md). The kodo daemon may be stopped; the TUI must NOT crash, must keep the last frame or show a clear banner, and recover when the server returns. | MEDIUM | `fetch` to `localhost:9090` fails → catch, show "⚠ server unreachable (localhost:9090) — retrying" banner, keep polling. Never let an unhandled rejection unmount the app. This is a known footgun: a single poll exception kills an ink app if uncaught. |
| **`q` to quit cleanly** | Universal. Must restore the terminal (cursor, raw mode) on exit. | LOW | ink `useApp().exit()` + `exitOnCtrlC`. Ensure raw mode is released so the shell isn't left broken. |
| **↑↓ navigation** | Decided v1 scope. The core interaction. | LOW | ink `useInput`. Clamp at list bounds (don't wrap unless desired). |

### Differentiators (Cheap to add, high value)

These set the tool apart from `kodo status` (a static dump). All are low-cost because the data already exists on `/status`. They directly serve the Core Value: *ambient, at-a-glance control of N parallel sessions.*

| Feature | Value Proposition | Complexity | Notes / Data dependency |
|---------|-------------------|------------|-------------------------|
| **Color-code rows by `status` + `alive`** | The single highest signal-per-pixel feature. Green=running/alive, yellow=review, red=error, dim/grey=done or `alive:false`. Lets the operator triage 10 rows in one glance — exactly what k9s/lazydocker do with status columns. | LOW | Both `status` and `alive` are on every session object. Pure presentation. **Highlight the `alive:false` + `status:'running'` combo** (zombie: kodo thinks it runs, cmux says dead) — that's the most actionable state and unique to kodo's merged view. |
| **Live age column (`elapsed_min`)** | "How long has this been going?" is the first question for a parallel-session operator. A stale/runaway session jumps out. | LOW | `elapsed_min` is server-computed on every `/status`. Render as `12m` / `1h03m`. Updates naturally each poll. |
| **Count summary in header** | "3 running · 1 review · 1 error · 4 pending" gives the whole-fleet state without scanning rows. k9s/htop all surface aggregate counts. | LOW | Derive from `sessions[]` (group by `status`) + `pending_count`. `/status` already returns `count` and `pending_count`. |
| **GSD mode / phase badge** | Distinguishes `full` (multi-phase) vs `quick` (one-shot) and shows `phase_id`. This is kodo-specific context cmux can't show — the seed explicitly says the value is "lo que cmux NO sabe." | LOW | `gsd` (bool), `gsd_mode`, `phase_id` all present. Compact badge: `[GSD p34]` / `[quick]` / `—`. |
| **Filters: `/` search + `r:<repo>` + `s:<state>`** | Decided v1 scope. With 3-10 rows it's a nicety; the operator wants it for habit/scale. Far simpler than the LLM the seed rejected. | MEDIUM | Pure client-side filter over the in-memory `sessions[]`. `r:` matches `project_path` (basename), `s:` matches `status`. `/` does substring over `task_ref`+`project_path`+`summary`. **Filter must NOT reset the cursor to top on every keystroke** (k9s issues #3220 / #3652 are exactly this pain) — keep the selected `task_id` selected if it still matches; otherwise select first match. |
| **`summary` as a detail line / column** | Each session carries a `summary`; showing it (truncated in the table, full in a detail strip) turns the table from "refs" into "what's actually happening." | LOW | `summary` present on session object. Truncate to terminal width; show full on the selected row footer. |

### Anti-Features (Tempting, but OUT OF SCOPE for "lo más simple" v1)

The seed and PROJECT.md set an explicit "deliberately reduced" boundary. These are the tempting additions that would bloat v1; each has a verified reason to defer.

| Feature | Why Requested / Surface Appeal | Why Problematic for v1 | Alternative |
|---------|-------------------------------|------------------------|-------------|
| **LLM/AI ranking, summarizing, or "ask the dashboard"** | "AI-powered" everything is fashionable. | The seed kills this explicitly: with 3-10 rows it adds nothing; with 100 you want filters, not embeddings. Metadata is already structured (provider/label/phase). Costs tokens (violates "vigilante consume 0 tokens" constraint). | Filters + color-coding. Revisit only if a real "classify/order" case appears that filters can't solve (seed: v0.10+). |
| **Killing / stopping sessions from the TUI** | An operator watching a runaway session naturally wants a `k`-to-kill. lazydocker/k9s have it. | There is **no kill endpoint**. `DELETE /sessions/<id>` does NOT kill — it only deletes bookkeeping (`removeSession`), leaving the cmux process + worktree orphaned. Building a real kill would require new endpoints (forbidden) + cmux teardown + worktree cleanup logic — a whole feature, not a keybinding. | To intervene, the operator uses `Enter` to attach and stops the session inside cmux, or uses existing CLI (`kodo gsd verify` / stop hook). The future `kodo gsd doctor` (already deferred in PROJECT.md) is the right home for zombie cleanup. |
| **Calling `DELETE /sessions/<id>` ("remove from list")** | "Done sessions clutter the table; let me dismiss them." | See finding #2: it's destructive bookkeeping that can orphan a *live* session, and `/status` already only lists active `state.sessions` (done sessions fall to `history`, not the live table). So clutter is largely self-solving. A `d` key here is a footgun that desyncs state vs reality (the exact ROMAN-132 class of bug in the project's memory). | **Recommend: OUT of v1.** Let sessions leave the table naturally when the stop hook removes them. If dismissal is ever wanted, gate it behind a confirmation and only for `alive:false` rows — but that's a v1.x decision, not v1. |
| **Mouse support (click rows, scroll wheel)** | Modern TUIs (k9s) support it. | Doubles input-handling complexity in ink, conflicts with terminal text selection, and the decided interaction model is keyboard-only. No user request. | Keyboard nav only. |
| **Config file / themes / customizable keybindings** | Power-user expectation; htop/btop/k9s all have config. | Premature for a personal one-operator tool. PROJECT.md radiates "no config files" ("herramienta personal"). Adds parsing, precedence, docs, tests for zero current value. | Hardcode sensible defaults (2s refresh, fixed keys). `NO_COLOR`/`FORCE_COLOR` already respected via the existing `format.js` discipline — reuse it, don't add config. |
| **Editing / mutating sessions or tasks beyond existing actions** | "Move task to review", "add a comment from the TUI". | PROJECT.md "Out of Scope": kodo does not do CRUD of tasks; it reads + updates state via the orchestrator, not via an operator UI. Comment-writing would need a new endpoint (forbidden). | Read-only TUI. Mutations stay in the orchestrator/GSD flow. `c` *views* comments; it does not write them. |
| **Persistent log streaming / real per-session log files** | "I want a true tail -f per session." | `/logs` is a shared 200-line ring buffer with no session key (finding #1). A real per-session stream would need new endpoints + structured logging changes. | `l` = client-side substring grep of the shared buffer against `task_ref`/`workspace_ref`. Honest, cheap, and clearly labeled as "matching lines," not a guaranteed complete stream. For full logs, the existing `kodo logs --session-of` CLI already exists. |
| **Sorting controls (Shift+C/M/S like k9s/top)** | Power feature. | Adds UI state + the row-stability problem the table-stakes section just solved (sorting by a mutating field reintroduces row-jumping). Not in decided scope. | One stable default sort. Defer interactive sort to v1.x if asked. |
| **Pending-tasks pane / history pane / metrics pane** | `/status` returns `pending`, `history`, and `metrics` — tempting to show all of it. | Scope creep. v1 is the **live sessions** table. Three more panes = three more layouts, nav modes, and empty states. | A single header count can borrow `pending_count` (one number). Full pending/history/metrics panes → v1.x tabs if the single table proves too thin. |

---

## The "attach" UX — concrete behavior (quality-gate item)

This is the highest-risk feature to get right. The requirement: `Enter` on a row hands the whole terminal to `cmux attach <workspace_ref>` (a full-screen interactive child), then returns the operator to the live table when they detach.

### How comparable TUIs do it

- **lazygit / gh dash / any bubbletea app:** use `tea.ExecProcess(cmd, ...)` — it "runs the given `*exec.Cmd` in a blocking fashion, effectively pausing the Program," explicitly "for spawning other interactive applications such as editors and shells." Under the hood that's `Program.ReleaseTerminal()` (gives input/terminal back to the child) → child runs → `Program.RestoreTerminal()` (re-acquires input, triggers a repaint). This is the canonical "suspend → hand off → restore" cycle. (HIGH — bubbletea docs + PR #237.)
- **k9s:** `s` to shell / `a` to attach into a pod spawns `kubectl exec`/`attach` as a foreground child; on exit you return to the table. (Known rough edges on some terminals — see below — but the model is the same: suspend TUI, inherit terminal, restore on exit.)

### The ink-specific pattern (this project's stack)

ink has **no** built-in `ExecProcess`. The verified, correct sequence is:

1. On `Enter`: stop the poll interval, then **`unmount()`** the ink app (or `app.exit()` and await `waitUntilExit()`). This releases ink's raw-mode hold on `process.stdin`.
2. **`spawn('cmux', ['attach', workspace_ref], { stdio: 'inherit' })`** — `stdio: 'inherit'` gives the child the real TTY so cmux's own UI takes over completely.
3. **`await` the child's exit** (operator detaches from cmux).
4. **Re-`render()` a fresh ink instance** and restart polling. (Ink docs: reusing the same stdout across `render()` calls without unmounting is unsupported — so the unmount→spawn→re-render order is mandatory.)

**The footgun to avoid:** spawning the interactive child *without* unmounting first triggers ink's classic *"Raw mode is not supported on the current process.stdin"* error and/or pushes the process to the background — both ink and Node have well-documented issues here (ink #378, node/help #3084). The fix is precisely "unmount before spawn." (HIGH.)

**Recommendation for the requirements author:** Specify attach as **full-screen handoff** (unmount → `stdio:'inherit'` spawn → await → re-render), NOT a split/embedded pane. A split-pane "attach" is far more complex (PTY multiplexing) and unnecessary — every comparable TUI suspends fully for shell/attach. Data dependency: `workspace_ref` (present on session object). Guard the `alive:false` case: attaching to a dead workspace should show a graceful message, not a hang.

---

## Detail-view UX patterns (`c` comments, `l` logs)

How lazygit/k9s present detail vs the main table informs the `c`/`l` views:

- **lazygit/k9s pattern:** main list stays; detail opens as a **focused panel or a full-screen overlay** that you `Esc` out of, returning to the same cursor position. For "lo más simple," a **full-screen overlay** (replace the table while viewing comments/logs, `Esc`/`q` to return) is the least layout-fiddly and matches the operator's mental model.
- **`c` (comments):** fetch `GET /comments/<task_id>` (NOT `task_ref` — finding #3) on keypress, show a scrollable read-only list, `Esc` to return. Handle: 404 (session not found server-side → "no comments"), empty list (provider has none), and fetch error (show message, don't crash). One-shot fetch is fine; live-refreshing comments is unnecessary.
- **`l` (logs):** client-side substring filter of `GET /logs` (shared 200-line buffer) against the selected session's `task_ref`/`workspace_ref`/`task_id` (finding #1). **Auto-scroll vs frozen:** the good-vs-janky line is *auto-scroll to the newest line by default, but freeze auto-scroll the moment the user scrolls up* (so they can read history without the view yanking them to the bottom on the next poll) — and show an indicator when frozen. Label the view honestly as "matching log lines," since completeness isn't guaranteed by the buffer.

---

## Feature Dependencies

```
Auto-refresh poll (/status)
    └──required by──> Live table
                          └──required by──> ↑↓ navigation
                                                └──required by──> Selection-survives-refresh (track by task_id)
                                                       └──required by──> Enter → attach (needs selected workspace_ref)
                                                       └──required by──> c → comments (needs selected task_id)
                                                       └──required by──> l → logs (needs selected task_ref/workspace_ref)

Selection-by-task_id ──enables──> Filters (cursor must stay on the same task_id post-filter)

Stable sort ──required by──> Selection-survives-refresh
   (if order churns, identity-tracking still works but the row visibly jumps; both needed)

Graceful-degradation ──wraps──> every fetch (/status, /comments, /logs)

DELETE /sessions/<id> ──conflicts──> kodo state integrity
   (orphans live cmux sessions; do NOT wire to a keybinding in v1)
```

### Dependency Notes

- **Selection-survives-refresh requires identity tracking, not index:** because each `/status` poll rebuilds the array. Track the cursor as a `task_id`; recompute the index every frame. This is the linchpin that makes everything below it (attach/comments/logs) reliable.
- **Attach/comments/logs all require a stable selection:** they act on "the selected row." If selection drifts on refresh, the operator attaches to / inspects the *wrong* session — a correctness bug, not a cosmetic one.
- **Filters depend on selection-by-identity:** so the cursor stays put while the filtered set changes (avoids the k9s `/`-resets-cursor annoyance, issues #3220/#3652).
- **Stable sort and identity-tracking are complementary:** identity-tracking keeps the *correct* row selected; stable sort keeps it from *visibly jumping*. Ship both.
- **DELETE conflicts with state integrity:** keep it out of the input map entirely in v1.

---

## MVP Definition

### Launch With (v1) — "lo más simple"

The decided scope, tightened by the data findings:

- [ ] **Live table** polling `GET /status` every ~2s — columns: `task_ref · repo(basename of project_path) · phase/mode · status · age(elapsed_min)` — *essential, this is the product.*
- [ ] **↑↓ navigation with selection tracked by `task_id`** — *essential, makes the rest reliable.*
- [ ] **Stable default sort** (by `started_at`) — *essential, prevents row-jumping.*
- [ ] **Color-code rows by `status` + `alive`** (incl. the zombie `running`+`!alive` highlight) — *cheap, highest at-a-glance value.*
- [ ] **Count summary in header** + **live indicator** — *cheap, makes it feel "live."*
- [ ] **`Enter` → attach** (unmount → `cmux attach <workspace_ref>` with `stdio:'inherit'` → await → re-render) — *essential, the killer interaction.*
- [ ] **`c` → comments overlay** via `GET /comments/<task_id>` — *decided scope.*
- [ ] **`l` → logs overlay** via client-side substring filter of `GET /logs` (labeled "matching lines"; auto-scroll-with-freeze) — *decided scope, but scoped honestly per finding #1.*
- [ ] **Filters: `/` search + `r:<repo>` + `s:<state>`** (client-side; cursor-preserving) — *decided scope.*
- [ ] **Empty state** + **graceful server-down banner** + **`q` clean quit** — *essential, non-crash requirement.*

### Add After Validation (v1.x)

- [ ] **Context-aware footer** (different hints per overlay) — *trigger: footer feels stale in overlays.*
- [ ] **`s:`/`r:` filter chips shown in header** — *trigger: operator forgets active filters.*
- [ ] **Pending-tasks tab** (reuse `/status.pending`) — *trigger: the single table proves too thin / operator wants the queue.*
- [ ] **Interactive sort toggle** — *trigger: row count regularly exceeds ~15.*

### Future Consideration (v2+)

- [ ] **Session dismissal `d`** (only for `alive:false`, with confirmation) — *defer: needs the orphan-safety argument resolved; tied to `kodo gsd doctor`.*
- [ ] **True per-session log stream** — *defer: requires structured logging + new endpoints (currently forbidden).*
- [ ] **Config file / themes** — *defer until a second operator or real customization need exists.*
- [ ] **LLM assist** — *defer to v0.10+ only if a filter-unsolvable classify/order case appears (seed's bar).*

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Live table + 2s poll | HIGH | LOW | P1 |
| Selection tracked by `task_id` | HIGH | MEDIUM | P1 |
| Stable sort (no row-jump) | HIGH | LOW | P1 |
| Color-code by `status`/`alive` | HIGH | LOW | P1 |
| `Enter` → attach (handoff) | HIGH | MEDIUM | P1 |
| Graceful server-down + empty state | HIGH | MEDIUM | P1 |
| Header counts + live indicator | MEDIUM | LOW | P1 |
| `c` comments overlay | MEDIUM | LOW | P1 |
| `l` logs overlay (substring) | MEDIUM | MEDIUM | P1 |
| Filters `/` `r:` `s:` (cursor-safe) | MEDIUM | MEDIUM | P1 |
| Context-aware footer | LOW | LOW | P2 |
| Pending/history/metrics panes | MEDIUM | MEDIUM | P2 |
| Interactive sort | LOW | MEDIUM | P3 |
| Session dismissal `d` | LOW | MEDIUM (+ risk) | P3 |
| Kill session | MEDIUM | HIGH (needs new endpoints) | OUT |
| LLM assist | LOW | HIGH | OUT |
| Mouse / config / themes | LOW | MEDIUM | OUT |

---

## Competitor Feature Analysis

| Behavior | k9s / lazydocker | lazygit / gh dash | btop / htop | kodo TUI (our approach) |
|----------|------------------|-------------------|-------------|--------------------------|
| Refresh cadence | 2s default, configurable | event + manual | 2s default | Fixed ~2s poll of `/status` (no config in v1) |
| Row stability | sort keys; selection by resource id | list re-render keeps cursor | "cpu lazy" sort to avoid jumping | stable sort by `started_at` + selection by `task_id` |
| Attach/shell | suspend TUI → `kubectl exec`/`attach` foreground → return | `tea.ExecProcess` (Release/RestoreTerminal) for editor/shell | n/a | ink `unmount()` → `spawn(cmux attach, stdio:'inherit')` → await → re-`render()` |
| Detail view | focused panel / overlay, `Esc` returns | overlay, `Esc` returns | inline panels | full-screen overlay for `c`/`l`, `Esc` returns to same cursor |
| Filtering | `/` filter (known to reset state on view-switch) | `/` fuzzy filter, `Esc` clears | n/a | client-side `/`+`r:`+`s:`, cursor-preserving (fixes the k9s reset annoyance) |
| Destructive ops | yes (delete/kill, with confirm) | yes (git ops) | kill signal | NONE in v1 (no kill endpoint; DELETE orphans state) |

---

## Recommendation on `DELETE /sessions/<id>` (quality-gate item)

**Verdict: OUT of v1.** Reasons, in order of weight:

1. **It does not do what an operator would expect.** A `d`/kill key implies "stop this session." `removeSession` only mutates bookkeeping (`state.sessions` → `history`); the cmux workspace and Claude process keep running. The operator would believe a session is gone while it is silently still alive — the exact desync class the project already hit (ROMAN-132 in memory, `state.json` lying about live sessions).
2. **It can orphan a live session.** Calling DELETE on an `alive:true` row removes kodo's only handle on it. There is no kill endpoint to pair it with (forbidden to add new endpoints in v1).
3. **The clutter it would "solve" doesn't exist.** The live table is sourced from `state.sessions`; finished sessions already fall out via the stop hook into `history`, which the v1 table does not show. So there is nothing to dismiss.
4. **It contradicts the read-only spirit** the seed and PROJECT.md set ("NO crear endpoints," "read `/status` and `/logs`," personal read-only ambient panel).

If session-cleanup is ever genuinely needed, it belongs in the already-deferred **`kodo gsd doctor`** (PROJECT.md deferred list: "limpieza de worktrees huérfanos + sesiones zombie"), which can do it *correctly* (kill cmux + remove worktree + then DELETE bookkeeping) — not in an ambient monitor.

---

## Sources

- [vadimdemedes/ink — README](https://github.com/vadimdemedes/ink) — `unmount()`, `waitUntilExit()`, `useApp().exit()`, `exitOnCtrlC`, raw-mode behavior. (HIGH)
- [ink — Raw Mode and Input Processing (DeepWiki)](https://deepwiki.com/vadimdemedes/ink/7.3-raw-mode-and-input-processing) — `isRawModeSupported`, reference-counted raw mode, why `setRawMode` must come from ink. (HIGH)
- [ink #378 — Raw Mode and Subprocesses](https://github.com/vadimdemedes/ink/issues/378) + [node/help #3084](https://github.com/nodejs/help/issues/3084) — the "Raw mode is not supported" footgun when spawning interactive children; unmount-before-spawn is the fix. (HIGH)
- [bubbletea — tea package docs (ExecProcess / ReleaseTerminal / RestoreTerminal)](https://pkg.go.dev/github.com/charmbracelet/bubbletea) + [PR #237](https://github.com/charmbracelet/bubbletea/pull/237) — canonical suspend→handoff→restore model used by lazygit/gh dash. (HIGH)
- [k9scli.io — Shell topic](https://k9scli.io/topics/shell/) + [k9s #1761](https://github.com/derailed/k9s/issues/1761) / [warp #1705](https://github.com/warpdotdev/Warp/issues/1705) — `s`/`a` to shell/attach, suspend-and-return model + real-world rough edges on some terminals. (MEDIUM)
- [k9s repo (refresh + sort)](https://github.com/derailed/k9s) + [btop/htop guide](https://32blog.com/en/cli/cli-htop-btop) — 2s default cadence, `proc_sorting = "cpu lazy"` to stop row-jumping. (MEDIUM)
- [k9s #3220 (preserve filter state)](https://github.com/derailed/k9s/issues/3220) + [#3652 (log filter sometimes doesn't work)](https://github.com/derailed/k9s/issues/3652) — filter/cursor reset pain points to design around. (MEDIUM)
- **Source of truth (HIGH):** `src/server.js:354-449` (`/status`, `/logs`, `/comments/<id>`, `DELETE /sessions/<id>`), `src/server.js:13-29` (log ring buffer shape), `src/session/state.js:131-145` (`removeSession` = bookkeeping only). Read directly.

---
*Feature research for: live session-monitoring TUI (`kodo dashboard`) over existing kodo JSON endpoints.*
*Researched: 2026-05-26*
