# Pitfalls Research

**Domain:** Adding an `ink` (React-for-CLI) live-monitoring TUI (`kodo dashboard`) to an existing mature Node.js CLI
**Researched:** 2026-05-26
**Confidence:** HIGH (ink lifecycle/raw-mode/exit verified against Context7 ink docs + GitHub issues; app-specific traps verified against `src/server.js`, `src/cli/format.js`, `package.json`)

> Scope note: these are pitfalls specific to wiring THIS TUI into THIS app. They build on the parallel researchers' stack findings (ink@6.8.0 / Node 20 floor / `React.createElement` no-build / hand-rolled table / unmount→spawn→re-render attach). Generic React advice is omitted. Every pitfall is phrased so it can become a plan task, a guard, or a test.
>
> **Phase shorthand** (final numbers assigned by roadmapper; continues from Phase 34):
> - **P-scaffold** = `kodo dashboard` subcommand + render bootstrap + non-TTY refusal + lifecycle/cleanup
> - **P-poll** = polling client (fetch loop, AbortController, error UX)
> - **P-table** = live table render + selection/cursor identity + filters
> - **P-attach** = `Enter` → `cmux attach` TTY handoff
> - **P-aux** = `c` comments / `l` logs-grep
> - **P-test** = test harness (DI clock + fetch, ink-testing-library)

---

## Critical Pitfalls

### Pitfall 1: `cmux attach` TTY handoff leaves the terminal in a broken state

**What goes wrong:**
`Enter` spawns `cmux attach <workspace_ref>` as an interactive foreground child with `stdio: 'inherit'`. If the handoff order is wrong, three things break: (a) spawning while ink still owns the TTY throws ink's `Raw mode is not supported` / produces doubled key echo because both ink's raw-mode stdin listener and the child are reading the same fd; (b) if `cmux attach` errors or the workspace is gone, the terminal is left in raw mode / alternate screen / cursor-hidden and the user gets a dead shell; (c) Ctrl-C during attach can kill `kodo` instead of detaching, or orphan the child.

**Why it happens:**
ink puts `process.stdin` into raw mode and (if `alternateScreen`) takes over the screen. Developers spawn the child from inside a `useInput` handler without first releasing the TTY. The naive mental model "ink is just rendering, I can spawn alongside it" is wrong — raw mode is process-global state on a single fd.

**How to avoid:**
Strict, sequenced handoff with `finally`-guaranteed restoration:
1. In the `Enter` handler, call `unmount()` (or `useApp().exit()`).
2. `await waitUntilExit()` — verified in ink docs: it settles only *after* unmount-related stdout writes complete and (per `cleanup()` semantics) terminal state including the alternate screen is torn down. This is the correct sync point; do NOT `spawn` before it resolves.
3. `spawn('cmux', ['attach', ref], { stdio: 'inherit' })` and `await` its close inside a `try`.
4. In `finally`, `render(<App/>)` again (fresh instance) — never inside the `try`, so a thrown/rejected attach still restores the UI.
5. Pre-flight guard: if the selected row's `alive === false` (server already merged cmux state into `/status`), do NOT attach — show "workspace gone" inline and stay mounted. This avoids the worst case (spawn a doomed child after tearing down the UI).
6. Wrap spawn errors (ENOENT for `cmux` not on PATH, non-zero exit) and surface them in the re-rendered UI, not as an uncaught throw.

**Warning signs:**
Doubled characters when typing after the first attach; `Raw mode is not supported` thrown on `Enter`; shell prompt with no echo / invisible cursor after `cmux attach` to a dead workspace; Ctrl-C during attach kills the dashboard.

**Phase to address:** P-attach (with the lifecycle primitives built in P-scaffold). Highest-risk integration — give it its own plan with a manual UAT (see Pitfall 13).

---

### Pitfall 2: Request stacking when a poll is slower than the 2-3s interval

**What goes wrong:**
A `setInterval(poll, 2500)` fires the next fetch regardless of whether the previous one finished. If `/status` is slow (provider `listPendingTasks` is on the hot path of `/status` — see `src/server.js:368`, it calls the Plane/GitHub API behind a TTL cache, and `cmux.listWorkspaces()` at line 378), requests pile up, responses arrive out of order, and the table flickers between stale and fresh data or renders a response that's already superseded.

**Why it happens:**
`setInterval` is fire-and-forget; it has no backpressure. Devs reach for it because it's the obvious "every N seconds" primitive.

**How to avoid:**
Self-scheduling loop, never overlapping:
- Use a recursive `setTimeout` (or `await sleep` loop), and only schedule the next tick in the `finally` of the current fetch — never `setInterval`.
- Attach an `AbortController` per request; abort the in-flight fetch on unmount and on a manual refresh (`r:` change). Re-create the controller each tick.
- Add a `fetch` timeout (the controller's `signal` + a `setTimeout(abort, ~2000ms)`) so a hung server doesn't freeze the loop forever.
- Guard against late responses: tag each tick with a monotonically increasing id; if a response arrives whose id is not the latest dispatched, drop it.

**Warning signs:**
Table "jumps" between two states; CPU climbs over time; multiple concurrent connections to `localhost:9090` visible in `lsof`; the UI updates after the server briefly recovers from a stall with a burst of stale frames.

**Phase to address:** P-poll. Make "no overlapping requests" a success criterion with a test that injects a slow fetch fn and asserts only one is in flight.

---

### Pitfall 3: Cursor/selection bound to array index instead of `task_id` identity

**What goes wrong:**
`/status` rebuilds the `sessions` array every poll (`listSessions().map(...)` at `src/server.js:379`). If the cursor is an integer index into the current array, then when a session ends (row vanishes), a new one starts, or the list reorders, the cursor silently points at a *different* session — so `Enter` attaches to the wrong workspace, `c` opens the wrong comments, `l` greps the wrong substring. This is the exact class of bug the project already hit (ROMAN-132 state-desync) but now in the UI layer.

**Why it happens:**
Index-based selection is the path of least resistance in a list UI, and it works fine until the underlying list mutates between renders — which here happens every 2-3s by design.

**How to avoid:**
- Track selection as the **`task_id`** (stable identity), not an index. On each poll, re-derive the cursor's array position by finding the row whose `task_id === selectedTaskId`.
- Stable sort rows by `started_at` (then `task_id` as tiebreaker) so order doesn't churn on equal timestamps.
- React keys on rows = `task_id` (not index) so reconciliation is correct and the table doesn't visually shuffle.
- If `selectedTaskId` is no longer present after a poll, clamp: select the nearest surviving row by prior position, or clear selection if the list is now empty (see Pitfall 6).

**Warning signs:**
`Enter` attaches to a different session than the highlighted one after a session ends; the highlight "jumps" rows on refresh without user input; selecting works at startup but breaks after the first session completes.

**Phase to address:** P-table. Unit-testable: feed two successive `/status` payloads (one with a removed row) to the selection reducer and assert the cursor still points at the same `task_id`.

---

### Pitfall 4: TUI crashes instead of refusing gracefully in a non-TTY environment

**What goes wrong:**
Running `kodo dashboard | cat`, in CI, or with redirected stdin throws ink's `Raw mode is not supported on the current process.stdin` and exits with a stack trace. For a tool whose other surfaces (`kodo logs --json`, `kodo check`) are scripting-friendly and byte-deterministic, an unhandled crash here is a regression in the project's CLI-hygiene culture.

**Why it happens:**
`useInput`/`setRawMode` require `stdin.isTTY`. ink only throws *when input is actually used*; devs test interactively (always a TTY) and never hit the pipe path.

**How to avoid:**
- **Pre-render guard** in the subcommand entry: if `!process.stdout.isTTY || !process.stdin.isTTY`, print a clear one-liner to stderr (`kodo dashboard requires an interactive terminal; use 'kodo status --json' for scripting`) and `process.exit(1)` — before calling `render()`. This is cheaper and clearer than ink's runtime throw.
- Belt-and-suspenders inside the component: gate `useInput` behind `useStdin().isRawModeSupported` (official ink API, verified) so any residual non-TTY path degrades to a static frame instead of throwing.
- Decide and document the contract: `kodo dashboard` is interactive-only; there is no `--json` mode (that already exists as `kodo status`).

**Warning signs:**
Stack trace mentioning `setRawMode` / `Raw mode is not supported`; the command works in your terminal but fails in a script or under `| head`.

**Phase to address:** P-scaffold. Test: spawn `bin/kodo dashboard` with a piped (non-TTY) stdin/stdout and assert exit code 1 + the canonical stderr message (mirrors the project's existing spawn-based UAT pattern, e.g. `test/session-of-resolver.test.js`).

---

### Pitfall 5: Server-down handled at startup but not mid-session (and vice versa)

**What goes wrong:**
Two distinct failure modes get conflated:
- **At startup**, the kodo server isn't running → first `/status` fetch is `ECONNREFUSED`. If unhandled, the TUI shows an empty table forever or crashes.
- **Mid-session**, the daemon dies (the documented weakness of "Opción A: muere si daemon kodo cae") → polls start failing after the UI was already populated. If the code clears the table on the first error, the operator loses all context the instant the server hiccups.

**Why it happens:**
Devs write one happy-path fetch with a single `catch` that does the same thing regardless of whether data was ever loaded.

**How to avoid:**
- **Keep-last-good** UX: on a failed poll after at least one success, retain the last good rows, dim them, and show a status line `⚠ server unreachable — last update 12s ago (retrying)`. Do NOT blank the table.
- **Startup** with no data yet: show a distinct "waiting for kodo server at localhost:9090…" state with the retry indicator, never a stack trace.
- Distinguish error classes: `ECONNREFUSED`/`fetch failed` → "server down, retrying"; HTTP 5xx → "server error"; (these inform the status line copy, not different recovery).
- Backoff without hammering: on consecutive failures, widen the interval (e.g. 2.5s → 5s → 10s, capped) and reset to base on first success. Never tighter than the base interval.

**Warning signs:**
Table goes blank the moment the server blips; tight reconnect loop hammering a down port (visible in logs/`lsof`); no visual difference between "loading" and "connection lost".

**Phase to address:** P-poll. Test with an injected fetch fn that succeeds twice then throws — assert rows are retained and a status flag flips to `stale`.

---

### Pitfall 6: Filter active while the underlying list changes; empty-list cursor

**What goes wrong:**
With a `/` search or `r:`/`s:` filter active, the displayed subset is recomputed each poll. Bugs: (a) the cursor points at a row that the new filter result no longer contains; (b) the filter matches zero rows and the cursor is `undefined` but `Enter`/`c`/`l` still try to act on `rows[cursor]` → crash or no-op on garbage; (c) a row matching the filter ends, the list shrinks, and the cursor index now exceeds `length-1`.

**Why it happens:**
Filtering and selection are computed independently; the invariant "selection ∈ filtered set" isn't enforced after every data/filter change.

**How to avoid:**
- Compute filtered rows first, then reconcile selection against the *filtered* set by `task_id` (Pitfall 3 applies post-filter).
- If the selected `task_id` falls outside the filtered set, move selection to the first filtered row, or null it if empty.
- Hard-guard every action: `Enter`/`c`/`l` early-return if there is no current selection or the filtered set is empty. Render an explicit "no sessions match" state.
- Filter string is plain substring (no regex) to avoid injection of a bad pattern crashing the render; `r:`/`s:` are exact-ish field matches.

**Warning signs:**
Crash or no-op when pressing `Enter` on an empty filtered list; highlight disappears when typing a filter that matches nothing; arrow keys move an invisible cursor.

**Phase to address:** P-table (selection reconciliation) + P-aux (action guards). Unit-test the reducer with empty and shrinking filtered sets.

---

### Pitfall 7: `l` (logs) implies a per-session tail but is a shared-buffer substring grep

**What goes wrong:**
`/logs` returns one flat 200-line ring buffer with **no `session_id`** (`src/server.js:417`, `getLogBuffer()` → `{ logs: [...] }`). The roadmap seed and PROJECT.md both phrase `l` as "tail de logs de **esa** sesión / filtrado por session_id" — but that key does not exist. Any per-session filter is a best-effort substring grep (e.g. by `task_ref` or `repo` appearing in the line). Presenting it as a precise per-session tail is a correctness lie: the user will trust lines that belong to another session and miss lines that don't contain the substring.

**Why it happens:**
The feature was specified against an assumed log shape; nobody re-checked that `/logs` lines carry a session key. PROJECT.md line 32 literally says "filtrado client-side de `GET /logs` por session_id" — which is impossible with the current shape.

**How to avoid:**
- Implement `l` as an honest substring grep over the shared buffer, matched against `task_ref` (and/or `repo`) of the selected row.
- **Label it honestly in the UI:** header like `logs (shared buffer, grep "<task_ref>" — may include other sessions)`. Do not title it "Session logs".
- Do NOT add a `session_id` to `/logs` server-side — that violates the hard "NO new endpoints / NO server changes" constraint. Document the limitation as accepted v1 scope.
- Correct the requirement text (`TUI-*` in REQUIREMENTS.md and PROJECT.md line 32) to say "best-effort grep", so downstream phases don't re-introduce the false-precision framing.

**Warning signs:**
A plan task or test asserts "logs filtered by session_id"; UI copy says "Session logs"; users report log lines that don't belong to the session they selected.

**Phase to address:** P-aux. Cheap to get right; expensive in trust if shipped as false precision. Also a documentation fix in the requirements phase.

---

### Pitfall 8: Re-render flicker / full-screen thrash under polling

**What goes wrong:**
Re-rendering the whole table every 2-3s causes visible flicker, scrollback spam, or CPU thrash if done wrong: (a) calling `console.clear()` or writing escape clears manually fights ink's own diffing; (b) setting fresh React state on every poll even when data is byte-identical forces a full re-render and re-pad of every cell; (c) re-creating row objects/arrays each tick defeats reconciliation.

**Why it happens:**
ink already diffs and only repaints changed cells — but only if you let it. Devs either over-clear (manual ANSI / `console.clear`) or over-update (new state object every tick regardless of change).

**How to avoid:**
- Let ink own the screen; never `console.clear()` or write raw clear sequences. Default `alternateScreen: false` is fine for a single full-frame app; if used, rely on `cleanup()` to tear it down (verified in ink docs).
- Only `setState` when the data actually changed: compare a cheap signature of the payload (e.g. `JSON.stringify` of the projected fields, or a hash of `task_id+state+elapsed_min` per row) and skip the update if identical to the last frame.
- Stable React keys (`task_id`) so unchanged rows aren't remounted (ties to Pitfall 3).
- `React.memo` the row component keyed on its projected props so only changed rows repaint.
- Respect ink's `maxFps` (default render throttling exists); don't fight it with manual timers that force extra frames.
- Note: `elapsed_min` / age changes every minute server-side, so frames *will* legitimately change ~once a minute even when nothing else moves — accept that, but don't recompute age client-side on a 1s timer (that would force needless frames).

**Warning signs:**
Visible flash/flicker on each poll; terminal scrollback fills with repeated frames (sign of `debug`-style separate-output rendering or manual clears); CPU usage proportional to poll frequency even when idle.

**Phase to address:** P-table. Verify by eye in UAT + a unit test that the "did data change" gate returns false for two identical payloads.

---

### Pitfall 9: Process lifecycle — dirty exit leaves terminal in raw mode / cursor hidden / intervals leaking

**What goes wrong:**
On `q`, SIGINT, or SIGTERM, if cleanup is incomplete the user is dumped back to a shell with: no cursor, no echo (raw mode still on), the alternate screen still active (their scrollback hidden), a leaked polling timer firing into a torn-down tree, or an in-flight fetch never aborted. ink restores most of this on a clean `unmount()`, but a `process.exit()` mid-render or a signal that bypasses ink's handlers skips the teardown.

**Why it happens:**
Devs call `process.exit(0)` directly on `q` instead of unmounting; or they don't wire SIGTERM (ink's `exitOnCtrlC` only covers Ctrl-C); or the polling timer/AbortController lives outside React and isn't cleared on unmount.

**How to avoid:**
- `q` → `useApp().exit()` (clean unmount), not `process.exit()`. Let `waitUntilExit()` resolve, then the process ends naturally.
- Clear the polling timer and `abort()` the in-flight controller in the `useEffect` cleanup (return fn) so unmount tears down all side effects.
- Wire SIGTERM explicitly to call `unmount()` then exit (SIGINT is covered by ink's default `exitOnCtrlC`, but you may want to disable that and handle both uniformly so the same cleanup path runs).
- Keep `patchConsole` at its default `true` — ink restores native console before React cleanup (verified in ink docs), so teardown-time logging behaves.
- Exit codes: `0` for clean `q`/signal quit; `1` only for the non-TTY refusal (Pitfall 4) and unrecoverable startup errors. Keep them deterministic, consistent with the project's exit-code discipline (D-19 / Pitfall #6 Opción A elsewhere in the codebase).

**Warning signs:**
After `q` the shell has no cursor or doesn't echo typing; `Ctrl-C` leaves a hung process; the alternate screen "sticks" hiding prior scrollback; a stray fetch hits the server after quit.

**Phase to address:** P-scaffold (lifecycle/cleanup wiring) — the attach handoff (P-attach) reuses the same unmount/restore primitives.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `setInterval(poll, 2500)` instead of self-scheduling `setTimeout` | One line, "it polls" | Request stacking, out-of-order frames, CPU climb (Pitfall 2) | Never — the no-overlap loop is the same effort |
| Index-based cursor instead of `task_id` identity | Trivial list nav | Wrong-session attach/comments/logs once a row ends (Pitfall 3, mirrors ROMAN-132) | Never for this app — the list mutates by design |
| `console.clear()` + full re-print each tick | Mental model "just redraw" | Flicker, scrollback spam, fights ink diffing (Pitfall 8) | Never — let ink diff |
| `process.exit(0)` on `q` | Immediate quit | Skips ink teardown → raw mode / hidden cursor leak (Pitfall 9) | Never — use `exit()`/`unmount()` |
| Title `l` as "Session logs" | Matches the seed wording | False precision; user trusts wrong lines (Pitfall 7) | Never — label as shared-buffer grep |
| Skip non-TTY guard ("nobody pipes a dashboard") | Less code | Crash in CI / under pipe, breaks CLI hygiene (Pitfall 4) | Never — cheap guard, project values scriptability |
| Bump to `ink@7` for a nicer API | Latest features | Raises Node engines floor above the `>=20` invariant | Only if the whole project moves its Node floor deliberately |
| Pull in `ink-table` to skip hand-rolling | Less table code | Stale/CJS dep against minimal-deps culture (already rejected by stack research) | Never — hand-roll |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `cmux attach` (foreground child) | Spawn while ink owns the TTY → raw-mode error / doubled echo | `unmount()` → `await waitUntilExit()` → `spawn(stdio:'inherit')` → re-`render()` in `finally` (Pitfall 1) |
| `cmux attach` to a gone workspace | Tear down UI then spawn a doomed child → broken terminal | Pre-flight on `alive===false` (already in `/status`); refuse + stay mounted (Pitfall 1) |
| `GET /status` | Assume it's cheap/instant | It awaits `provider.listPendingTasks()` (network, TTL-cached) + `cmux.listWorkspaces()`; treat as slow → AbortController + no-overlap (Pitfall 2) |
| `GET /logs` | Filter by `session_id` (doesn't exist) | Substring grep on `task_ref`/`repo`; label honestly (Pitfall 7) |
| `GET /comments/<task_id>` | Navigate/key by `task_ref` then call with ref | Endpoint is keyed by **`task_id`**; carry both — display `task_ref`, fetch by `task_id` (server resolves session by `task_id`, `src/server.js:424`) |
| kodo server lifecycle | Assume server is always up | Handle ECONNREFUSED at startup AND mid-session distinctly; keep-last-good (Pitfall 5) |
| `localhost:9090` parsing | Garbage/partial JSON crashes render | `try/catch` around `res.json()`; treat parse failure as a failed poll (keep-last-good), never throw into React |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| New state object every poll even when unchanged | Constant repaint, CPU ∝ poll rate | Diff payload signature; skip `setState` if identical (Pitfall 8) | Immediately at idle (always-on tool) |
| Client-side age timer recomputing every 1s | Extra frames/min for cosmetic age | Use server `elapsed_min`; only repaint on real data change | Any always-on session |
| Re-creating row arrays/objects each tick | React remounts rows, table shuffles | Stable `task_id` keys + `React.memo` rows | As soon as >a few rows |
| Unbounded log grep render | Slow paint if buffer grows | Buffer is fixed 200 lines server-side; render a capped slice | N/A at current 200-line cap, but cap client render anyway |

> Scale note: expected scale is 3-10 active sessions (per the seed), occasionally up to ~100 with filters. Do not over-engineer virtualization; correct keys + memo + diff-gate is sufficient. The 200-line `/logs` cap is server-enforced.

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Importing `picocolors` directly in TUI code for color | Breaks the color-isolation invariant + `test/format-isolation.test.js` (grep + walker) fails | Color comes from ink (`<Text color>`); if any plain-string ANSI is needed, route through `createFormatter` from `src/cli/format.js`. Add the TUI dir to the isolation walker's scan so a stray `picocolors` import is caught (Pitfall 10) |
| Rendering raw provider/comment text into the terminal unescaped | A malicious task title/comment with ANSI escapes could move the cursor / clear screen / spoof UI | ink `<Text>` does not interpret embedded escapes as control by default, but strip/sanitize known CSI sequences from untrusted `/comments` and `/status` fields before display |
| Logging the `localhost:9090` payloads (could contain task content) | Leaks task data to scrollback/files | Don't `console.log` payloads; ink already owns the screen |

> Note: no auth/secrets in the TUI path — it only reads localhost JSON the server already exposes. The real "security-flavored" risk here is the color-isolation invariant (a project-defining test), covered as Pitfall 10.

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Blank table the instant the server blips | Operator loses all context | Keep-last-good + dim + "stale 12s ago" status line (Pitfall 5) |
| `l` titled "Session logs" | Trusts lines from other sessions | "shared buffer, grep — may include other sessions" (Pitfall 7) |
| No "no sessions match" / "waiting for server" states | Looks frozen/broken | Explicit empty + loading + error states (Pitfalls 5, 6) |
| Cursor jumps rows on auto-refresh | Disorienting; wrong attach | `task_id` identity + stable sort (Pitfall 3) |
| Flicker every poll | Looks janky, hard to read | Diff-gate + ink diffing, no manual clears (Pitfall 8) |
| NO_COLOR / dumb terminal ignored | Unreadable in some terminals | ink respects `NO_COLOR`; verify a `NO_COLOR=1` UAT renders monochrome; degrade box-drawing if needed |

## "Looks Done But Isn't" Checklist

- [ ] **Attach handoff:** Works on the *first* `Enter`, but verify the *second* attach after returning (re-`render` must produce a fresh, working raw-mode instance — no doubled echo).
- [ ] **Attach to dead workspace:** Select a row, kill its cmux workspace, press `Enter` — terminal must survive (cursor + echo intact), not just the happy path.
- [ ] **Ctrl-C during attach:** Confirm it detaches/returns cleanly, doesn't kill `kodo` or orphan the child.
- [ ] **Mid-session server death:** Kill the kodo daemon while the dashboard is up — table dims + stale banner, no crash, recovers on restart.
- [ ] **Non-TTY:** `kodo dashboard | cat` exits 1 with a clear message, no stack trace.
- [ ] **Quit cleanliness:** After `q` and after Ctrl-C, the shell has a visible cursor, echoes input, and scrollback is intact (alternate screen torn down).
- [ ] **Selection identity:** Highlight a row, let a *different* session end, confirm the highlight still tracks the same `task_id`.
- [ ] **Empty/filtered actions:** `Enter`/`c`/`l` on an empty or zero-match filter are no-ops, not crashes.
- [ ] **Color isolation:** `test/format-isolation.test.js` still green; TUI imports no `picocolors`.
- [ ] **No build step / Node floor:** `bin/kodo dashboard` runs straight from `.js` (no transpile); `ink@6` keeps `engines.node >=20`.
- [ ] **No new endpoints:** `git diff` on `src/server.js` is empty.
- [ ] **comments fetch:** Uses `task_id` (not `task_ref`) for the `/comments/<id>` call.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Terminal left broken after bad attach (Pitfall 1) | LOW (user) / MEDIUM (fix) | User: `reset` / `stty sane`. Fix: enforce `finally`-re-render + pre-flight `alive` guard |
| Index-based selection shipped (Pitfall 3) | MEDIUM | Refactor selection state to `task_id`; add the two-payload reducer test before re-shipping |
| `setInterval` request stacking (Pitfall 2) | LOW | Swap to self-scheduling `setTimeout` + AbortController; add slow-fetch single-flight test |
| `picocolors` leaked into TUI (Pitfall 10) | LOW | Remove import, use `<Text color>` / `createFormatter`; isolation test catches it |
| `l` shipped as "Session logs" (Pitfall 7) | LOW | Re-label header; correct REQUIREMENTS/PROJECT wording |
| Accidental `ink@7` Node-floor bump | LOW (if caught pre-merge) | Pin `ink@6.x`; add an engines/floor assertion to the smoke test |

## Project-Invariant Traps (kodo-specific)

These are the "don't break the existing project contracts" traps the roadmapper must bake into success criteria:

1. **Color isolation (`picocolors` single-source):** Only `src/cli/format.js` may import `picocolors`; `test/format-isolation.test.js` enforces via grep + module walker. The TUI must get color from ink's `<Text color>`, not `picocolors`. **Action for roadmapper:** ensure the isolation walker's scan path includes the new TUI directory so a stray import is caught, and the new subcommand entry in `bin/kodo` doesn't pull `picocolors` transitively. (Pitfall 10)

2. **No build step:** Project is plain `.js` + JSDoc `@ts-check`, no transpile (PROJECT.md "TypeScript migration … sin build step"). The TUI must use `React.createElement` in `.js` (per stack research) — **no JSX, no Babel/esbuild, no `tsx`**. A build step would be a new architectural cost the project explicitly rejected. **Verify:** `bin/kodo dashboard` runs directly under `node`.

3. **Node engines floor `>=20`:** `ink@6.8.0` keeps the floor (stack research). Picking `ink@7` (or any dep requiring Node 22+) silently raises the floor — a breaking runtime change. **Verify:** keep `engines.node: ">=20.0.0"`; pin ink major to 6.

4. **Minimal deps culture:** Prod deps are exactly `commander` + `picocolors`. The TUI adds `ink`, `react`, `ink-text-input` (per stack research) — that's the agreed, scoped expansion. **Trap:** scope-creeping in extra ink-ecosystem packages (`ink-table` already rejected, spinners, gradient, big-text, etc.). Each added dep must be justified; default to hand-rolling (consistent with the hand-rolled table decision).

5. **DI-for-testability (Node test runner has no `mock.module`):** The project's established pattern is pure helpers + injected deps (Key Decision: "Pure helper extraction + DI for testability"). The TUI must inject its **clock** (poll interval) and **fetch fn** so tests are hermetic — no real timers, no real network (Pitfall 11). Don't reach for a mocking lib.

6. **`--json` / byte-determinism culture:** Other surfaces are scriptable and deterministic. The dashboard is interactive-only by design; the trap is *implying* a machine mode. Point scripters at the existing `kodo status` / `--json`, don't half-build a non-interactive dashboard.

### Pitfall 10: Accidental `picocolors` import breaks color isolation

**What goes wrong:** A TUI file imports `picocolors` (or a transitive dep does) to colorize a string outside `<Text>`. `test/format-isolation.test.js` (grep + walker) goes red — a project-defining invariant breaks.
**How to avoid:** All color via ink `<Text color="...">`; any plain-string ANSI via `createFormatter(stream)` from `src/cli/format.js`. Extend the isolation walker to scan the TUI dir.
**Warning signs:** `format-isolation` test failure after adding TUI code; a `from 'picocolors'` import outside `src/cli/format.js`.
**Phase to address:** P-scaffold (set the import discipline up front; extend the walker as part of scaffolding).

### Pitfall 11: Tests that depend on real timers/network → flaky, non-hermetic

**What goes wrong:** ink components are tested with real `setTimeout` polling and a real `fetch` to `localhost:9090`. Tests flake (timing), require a running server, and can't run in CI. Testing input/raw-mode without a TTY throws.
**How to avoid:**
- Inject the **clock** (the poll scheduler) and the **fetch fn** as deps (project DI pattern). Tests advance the clock manually and return canned payloads — no real timers, no network.
- Use `ink-testing-library` (`render` returns `lastFrame()` / `stdin.write()`), which renders to a fake stdout and feeds input without needing a TTY — so `useInput` works in tests.
- Drive interaction by writing to the test `stdin` (arrow keys = escape sequences); assert on `lastFrame()`.
- Mark what genuinely can't be unit-tested — the real `cmux attach` TTY handoff (raw-mode handoff to a foreground child) — as **manual UAT** (Pitfall 13), consistent with the project's spawn-real-child UAT pattern where feasible.
**Warning signs:** tests that `await sleep(3000)`; tests that fail without the kodo server up; `Raw mode is not supported` in the test runner.
**Phase to address:** P-test (harness), with each feature phase contributing its own injected-dep tests.

### Pitfall 12: Partial / garbage JSON from `/status` crashes the render

**What goes wrong:** A truncated response, an HTML error page, or a 500 with non-JSON body makes `res.json()` throw inside the poll; if unhandled it becomes an uncaught rejection that tears down the ink tree.
**How to avoid:** `try/catch` `res.json()`; on parse failure treat the tick as a failed poll (keep-last-good, Pitfall 5), increment the failure counter for backoff, never let it reach React as a throw. Validate the shape minimally (`Array.isArray(payload.sessions)`) before using it.
**Warning signs:** unhandled-rejection crash; table tears down on a transient server error.
**Phase to address:** P-poll.

### Pitfall 13: The attach handoff can't be unit-tested — no UAT planned

**What goes wrong:** The single highest-risk behavior (real raw-mode handoff to an interactive `cmux attach`, then restoration) is unobservable in `ink-testing-library` (fake stdout, no real TTY). If no manual UAT is scheduled, it ships untested and breaks in the operator's hands.
**How to avoid:** Schedule an explicit manual UAT in P-attach covering the four scenarios in the "Looks Done But Isn't" checklist (first attach, second attach, dead-workspace attach, Ctrl-C during attach). This mirrors the project's existing practice of HUMAN-UAT for things that can't be automated. Automate what *can* be: the pre-flight `alive` guard and the unmount-before-spawn ordering are unit-testable with an injected spawn fn that records call order relative to `unmount`.
**Warning signs:** P-attach has no UAT artifact; "tested" claim rests only on `lastFrame()` assertions.
**Phase to address:** P-attach.

## Pitfall-to-Phase Mapping

| # | Pitfall | Prevention Phase | Verification |
|---|---------|------------------|--------------|
| 1 | `cmux attach` TTY handoff breaks terminal | P-attach | Manual UAT (4 scenarios) + injected-spawn ordering test |
| 2 | Poll request stacking | P-poll | Slow-fetch single-flight test (only 1 in flight) |
| 3 | Index-based selection (wrong session) | P-table | Two-payload reducer test: cursor tracks `task_id` |
| 4 | Non-TTY crash instead of graceful refuse | P-scaffold | Spawn with piped stdin → exit 1 + canonical stderr |
| 5 | Server-down startup vs mid-session | P-poll | Injected fetch succeed×2 then throw → keep-last-good |
| 6 | Filter/empty-list cursor bugs | P-table + P-aux | Reducer test on empty/shrinking filtered set; action no-op guards |
| 7 | `l` false-precision logs | P-aux (+ requirements doc fix) | UI header labeled "shared buffer grep"; REQUIREMENTS corrected |
| 8 | Re-render flicker/thrash | P-table | Diff-gate returns false for identical payloads; visual UAT |
| 9 | Dirty exit (raw mode/cursor/intervals) | P-scaffold | Post-`q` and post-Ctrl-C terminal sane; cleanup clears timer+abort |
| 10 | `picocolors` color-isolation leak | P-scaffold | `test/format-isolation.test.js` green; walker scans TUI dir |
| 11 | Non-hermetic timer/network tests | P-test | Tests inject clock+fetch; `ink-testing-library`; no real net |
| 12 | Garbage JSON crashes render | P-poll | Injected fetch returns bad JSON → treated as failed poll |
| 13 | Attach handoff untested | P-attach | Manual UAT artifact exists |
| — | No build step / Node floor / minimal deps | P-scaffold | `bin/kodo dashboard` runs under node; `engines.node` unchanged; dep list reviewed |
| — | No new server endpoints | all | `git diff src/server.js` empty at milestone close |

## Sources

- [Ink — Context7 `/vadimdemedes/ink`](https://context7.com/vadimdemedes/ink) — `render` options (`exitOnCtrlC`, `patchConsole`, `alternateScreen`, `maxFps`, `debug`), `waitUntilExit()` settle-after-unmount semantics, `cleanup()` terminal/alt-screen teardown, `useApp().exit()` (HIGH)
- [ink `useStdin().isRawModeSupported` / raw mode & input processing — DeepWiki](https://deepwiki.com/vadimdemedes/ink/7.3-raw-mode-and-input-processing) (HIGH)
- [setRawMode fails when running with non-TTY stdin · ink#166](https://github.com/vadimdemedes/ink/issues/166) — the canonical non-TTY crash + `isRawModeSupported` fallback pattern (HIGH)
- [Raw mode is not supported when piping input · claude-code#5925](https://github.com/anthropics/claude-code/issues/5925) and [#404](https://github.com/anthropics/claude-code/issues/404) — real-world manifestation of the same crash in a shipped Node+ink CLI (MEDIUM)
- kodo `src/server.js:355-441` — verified `/status` (sessions enriched with `alive`/`elapsed_min`, awaits `listPendingTasks` + `cmux.listWorkspaces`), `/logs` (flat ring buffer, no `session_id`), `/comments/<task_id>` (keyed by `task_id`) (HIGH — read directly)
- kodo `src/cli/format.js` + `package.json` — color-isolation single-source, `engines.node >=20`, prod deps `commander`+`picocolors` only (HIGH — read directly)
- kodo `.planning/PROJECT.md` / `PENDING-INTEGRATIONS.md` — Opción A decision, NO new endpoints constraint, DI-for-testability, ROMAN-132 desync history, `l` "filtrado por session_id" wording to correct (HIGH — read directly)

---
*Pitfalls research for: ink TUI added to the kodo Node.js CLI (`kodo dashboard`, v0.9)*
*Researched: 2026-05-26*
