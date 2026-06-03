# Architecture Research

**Domain:** ink (React-for-CLI) TUI subcommand integrated into an existing ESM Node.js CLI (`kodo dashboard`)
**Researched:** 2026-05-26
**Confidence:** HIGH

> Scope note: the existing kodo architecture (ESM, no-build-step, `commander`, `src/cli/format.js` color isolation, the HTTP `/status`·`/logs`·`/comments` contract, `cmux attach`) is treated as **fixed**. This document specifies only how the new TUI hangs off it. STACK (ink@6.8.0 + react@19 + `React.createElement`, no JSX) and FEATURES decisions from the parallel researchers are taken as given and are not re-litigated.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  bin/kodo  →  src/cli.js  (commander)                                  │
│     program.command('dashboard').action(lazy import → runDashboard())  │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ (entry, owns process lifecycle + exit code)
┌────────────────────────────────▼─────────────────────────────────────┐
│  src/cli/dashboard/index.js   — runDashboard(deps)                     │
│    • resolves base URL (http://localhost:<config.server.port>)         │
│    • render(<App/>)  /  unmount → cmux attach → re-render (attach loop) │
└──────────┬───────────────────────────────────────────┬────────────────┘
           │ (ink owns the TTY)                          │ (process spawn)
┌──────────▼───────────────────┐          ┌──────────────▼────────────────┐
│  PRESENTATION (ink/react)     │          │  ATTACH HANDOFF                │
│  src/cli/dashboard/App.js     │          │  src/cli/dashboard/attach.js   │
│   ├─ Header   (count + live)  │          │   unmount() → waitUntilExit()  │
│   ├─ Table → Row              │          │   → spawn('cmux',['attach',r], │
│   ├─ DetailPanel (comments/   │          │      {stdio:'inherit'})        │
│   │   logs)                   │          │   → await child → re-render()  │
│   ├─ FilterInput              │          └────────────────────────────────┘
│   └─ Footer (keybindings)     │
└──────────┬────────────────────┘
           │ (calls pure functions / hook; NO direct picocolors, NO cmux rpc)
┌──────────▼───────────────────┐   ┌────────────────────────────────────┐
│  DATA LAYER (pure, no React)  │   │  DERIVE LAYER (pure, no React)      │
│  src/cli/dashboard/client.js  │   │  src/cli/dashboard/select.js        │
│   fetchStatus(baseUrl,fetch?) │   │   sortSessions(rows)                │
│   fetchComments(baseUrl,id)   │   │   filterSessions(rows, filterText)  │
│   fetchLogs(baseUrl,fetch?)   │   │   resolveSelection(rows, taskId)    │
│   → {ok, data} | {ok:false,   │   │   rowCells(session) (display strs)  │
│      error}  (never throws)   │   │   taskRefToTaskId(rows, ref)        │
└──────────┬────────────────────┘   └────────────────────────────────────┘
           │ HTTP GET (global fetch, injectable)
┌──────────▼────────────────────────────────────────────────────────────┐
│  EXISTING kodo server  (src/server.js, localhost:9090) — READ ONLY      │
│   GET /status   → {sessions[{...,alive,elapsed_min}], count, pending...} │
│   GET /comments/<task_id> → {comments}                                  │
│   GET /logs     → {logs: string[]}  (shared 200-line ring, no session)  │
│   ── NO NEW ENDPOINTS (hard constraint) ──                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `src/cli.js` registration | Declare `kodo dashboard`, lazy-import the entry, own `process.exitCode` | `program.command('dashboard').action(async () => { const {runDashboard} = await import('./cli/dashboard/index.js'); await runDashboard(); })` — mirrors every existing subcommand |
| `dashboard/index.js` (`runDashboard`) | Process-level orchestration: resolve base URL, `render()`, host the attach loop, exit code hygiene | Plain `.js`, DI deps `{ render, spawn, fetch, baseUrl, config }` for testability |
| `dashboard/App.js` | Root ink component: owns React state, polling hook, `useInput` key routing, panel switching | `React.createElement` tree, no JSX (no-build invariant) |
| `dashboard/client.js` | Pure HTTP client; one function per endpoint; never throws (returns result objects) | `async fetchStatus(baseUrl, fetchFn = globalThis.fetch)` |
| `dashboard/select.js` | Pure derive helpers: sort, filter, selection-by-id, row→display-cells | Pure functions, zero React, zero I/O |
| `dashboard/usePoll.js` | Cancellable self-scheduling poll hook (no stacked requests) | Custom React hook wrapping `useEffect` + recursive `setTimeout` |
| `dashboard/attach.js` | The unmount→spawn→re-render handoff (extracted so it is unit-testable with fakes) | Pure-ish orchestrator taking `{instance, spawn, ref}` |
| `Header/Table/Row/DetailPanel/FilterInput/Footer` | Dumb presentational components; receive props, render `<Box>`/`<Text>` | One file each under `dashboard/components/` (or co-located if truly minimal) |

---

## Recommended Project Structure

```
src/cli/dashboard/
├── index.js            # runDashboard(deps) — commander entry, render() + attach loop, exit code
├── App.js              # root ink component: state, usePoll, useInput routing, panel switch
├── client.js           # PURE: fetchStatus / fetchComments / fetchLogs (result objects, no throw)
├── select.js           # PURE: sortSessions, filterSessions, resolveSelection, taskRefToTaskId, rowCells
├── usePoll.js          # custom hook: cancellable self-scheduling poll (no stacking)
├── attach.js           # unmount → waitUntilExit → spawn('cmux','attach') → rerender
└── components/
    ├── Header.js       # count summary + live/poll indicator + connection status
    ├── Table.js        # column header + maps rows → <Row>
    ├── Row.js          # one session line; highlights when selected
    ├── DetailPanel.js  # renders comments (c) or logs (l) for the selected task
    ├── FilterInput.js  # ink-text-input wrapper for `/` search + r:/s: prefixes
    └── Footer.js       # static keybinding hints (↑↓ Enter c l / q)
```

### Structure Rationale

- **`src/cli/dashboard/` (a folder, not a single file):** every other subcommand is a single file (`gsd-inspect.js`, `polling.js`), but the TUI is the first multi-module surface. A folder keeps the component/data/hook split visible and keeps `src/cli/` flat for the simple commands. This is the smallest structure that still separates the four testability tiers (pure data, pure derive, ink components, process orchestration).
- **`client.js` and `select.js` are React-free on purpose:** they are imported by tests with zero ink/terminal involvement. This is the direct application of the project's "pure helpers + DI for testability" decision (the Node test runner lacks `mock.module`).
- **`index.js` owns the process, `App.js` owns the UI:** the attach handoff (unmount/spawn/re-render) must live *outside* the React tree because it tears the tree down and rebuilds it — it cannot live in a component. `index.js` holds the `render()` instance and is the only place that touches `spawn`/`process.exitCode`.
- **`components/` subfolder:** keeps `dashboard/` top level scannable (entry + data + derive + hook + attach) and groups the dumb presentational pieces. If "lo más simple" wins in planning, Header/Footer/Row could collapse into `App.js`; keep Table/DetailPanel/FilterInput separate because they carry the most logic.

---

## Architectural Patterns

### Pattern 1: Pure HTTP client returning result objects (never throws)

**What:** Each endpoint gets one async function that wraps `fetch`, parses JSON, and returns a discriminated result `{ ok: true, data }` or `{ ok: false, error }`. The fetch implementation is injectable (defaults to `globalThis.fetch`, native in Node 20+ — no dependency added).

**When to use:** All three reads. The TUI's "degradación elegante si el server no responde (no crash)" requirement is satisfied *here*, not in the components — components just render `lastError`/connection status from state.

**Trade-offs:** Returning result objects instead of throwing means callers must check `ok`, but it makes the no-crash invariant structural and the client trivially unit-testable with a fake fetch (no network, no ink).

**Example:**
```js
// src/cli/dashboard/client.js — pure, no React, no picocolors
// @ts-check
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`${baseUrl}/status`);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err.message }; // server down → graceful
  }
}
// fetchComments(baseUrl, taskId, fetchFn) → GET /comments/<task_id>
// fetchLogs(baseUrl, fetchFn)             → GET /logs
```

### Pattern 2: Self-scheduling cancellable poll (NOT a fixed `setInterval`)

**What:** A custom hook polls with a recursive `setTimeout` that schedules the *next* tick only after the current fetch resolves. This prevents request stacking when the server is slow (a fixed `setInterval(fetch, 2500)` fires regardless of whether the previous request returned). A `cancelled` flag guards against `setState` after unmount.

**When to use:** The live `/status` table (~2-3s). Reuse the same hook shape for on-demand comment/log fetches (or fetch those once on panel-open rather than polling).

**Trade-offs:** Slightly more code than `setInterval`, but it is the correct primitive: no overlapping in-flight requests, clean teardown on unmount, and it naturally backs off when the server is slow. The existing web `dashboardHtml` uses `setInterval(refresh, 5000)` — acceptable in a browser tab, **not** appropriate here because the attach handoff unmounts/remounts the tree and a stray interval would keep firing.

**Example:**
```js
// src/cli/dashboard/usePoll.js
// @ts-check
import { useEffect, useRef } from 'react';
export function usePoll(fn, intervalMs, deps = []) {
  const savedFn = useRef(fn); savedFn.current = fn;
  useEffect(() => {
    let cancelled = false; let timer;
    const tick = async () => {
      await savedFn.current();           // awaits → no stacking
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); }; // teardown
  }, deps);
}
```

### Pattern 3: Selection by `task_id` identity, re-derived every poll

**What:** `/status` rebuilds the `sessions` array on every request, so an array index is not stable. The TUI stores `selectedTaskId` (a string), and on every render derives the selected row by *finding* it in the freshly-sorted array. Sort is stable by `started_at`. If the selected task disappeared (session ended) `resolveSelection` clamps to the nearest valid row.

**When to use:** Cursor navigation (↑↓), `Enter` (attach to the selected row's `workspace_ref`), and `c`/`l` (map selected `task_ref` → `task_id` for `/comments`).

**Trade-offs:** Re-deriving selection each render is O(n) per poll, trivially cheap for the expected N (single-digit sessions). It is the only correct approach given the server re-emits the array.

**Example:**
```js
// src/cli/dashboard/select.js — pure
// @ts-check
export function sortSessions(rows) {
  return [...rows].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
}
export function resolveSelection(sortedRows, selectedTaskId) {
  const idx = sortedRows.findIndex((r) => r.task_id === selectedTaskId);
  if (idx !== -1) return { index: idx, row: sortedRows[idx] };
  // selected session vanished → clamp to first row (or null if empty)
  return sortedRows.length ? { index: 0, row: sortedRows[0] } : { index: -1, row: null };
}
// taskRefToTaskId(rows, taskRef) → string|null   (for /comments lookup)
// filterSessions(rows, filterText) → rows         ('/' substring, r:<repo>, s:<state>)
```

### Pattern 4: Attach handoff lives in `index.js`, outside the React tree

**What:** ink owns the TTY in raw mode. Spawning `cmux attach` with `stdio:'inherit'` while ink is mounted fights over the terminal (ink's raw-mode footgun). The correct sequence: capture the `render()` return `{ unmount, waitUntilExit, rerender }`; on `Enter`, the component signals the chosen `workspace_ref` up to `index.js` via `useApp().exit(value)`; `index.js` does `await waitUntilExit()` (which resolves with that value after the tree unmounts), then `spawn('cmux', ['attach', ref], { stdio:'inherit' })`, awaits child exit, then `render(<App/>)` again (fresh tree).

**When to use:** `Enter` on a selected row. This is the one flow that cannot be an ink component because it destroys and recreates the ink instance.

**Trade-offs:** Requires threading the attach intent out of the component. Idiomatic ink: `exit(value)` → `waitUntilExit()` resolves with that value (verified against ink docs), keeping a single control loop in `index.js`. The alternative (an injected `onAttach(ref)` prop) works too but splits the lifecycle owner.

**Example:**
```js
// src/cli/dashboard/index.js — the attach loop
// @ts-check
import { render } from 'ink';
import { spawn } from 'node:child_process';
export async function runDashboard(deps = {}) {
  const { renderFn = render, spawnFn = spawn, baseUrl, cmuxBin = 'cmux' } = deps;
  let attachRef = null;
  do {
    const inst = renderFn(/* createElement(App, { baseUrl, onAttach:(ref)=>inst.exit({attachTo:ref}) }) */);
    const result = await inst.waitUntilExit(); // {attachTo} | undefined (quit)
    attachRef = result?.attachTo ?? null;
    if (attachRef) {
      await new Promise((res) => {
        const child = spawnFn(cmuxBin, ['attach', attachRef], { stdio: 'inherit' });
        child.on('exit', res);
      });
    }
  } while (attachRef);
  process.exitCode = 0; // clean quit
}
```
> Note: with `exit(value)`, `unmount()` is implicit — `exit()` tears the tree down and `waitUntilExit()` resolves after unmount-related stdout writes complete (verified against ink docs). The loop re-`render()`s a brand-new instance after `cmux attach` returns, so no stale interval/raw-mode state survives.

---

## Data Flow

### Poll → render flow

```
usePoll(2500ms) ──► client.fetchStatus(baseUrl)
                         │ {ok:true, data}                 │ {ok:false, error}
                         ▼                                  ▼
                  setSessions(sortSessions(data.sessions))   setLastError(error)
                  setConnected(true)                         setConnected(false)
                         │
                         ▼
        filterSessions(sessions, filterText)  →  resolveSelection(.., selectedTaskId)
                         │
                         ▼
            App renders Header + Table(rows, selectedIndex) + Footer
```

### Key-press → action flow

```
useInput(input, key)
  ├ key.upArrow/downArrow → setSelectedTaskId(neighbour row's task_id)
  ├ key.return (Enter)    → exit({ attachTo: selectedRow.workspace_ref })  → index.js attach loop
  ├ input === 'c'         → setActivePanel('comments'); fetchComments(baseUrl, selectedRow.task_id)
  ├ input === 'l'         → setActivePanel('logs');     fetchLogs(baseUrl) then client-side grep
  ├ input === '/'         → setActivePanel('table' + filter focus); FilterInput captures text
  └ input === 'q'/escape  → exit()  (no attachTo → loop ends → exitCode 0)
```

### State Management

```
App state (useState):
  sessions:        SessionRow[]   // sorted copy from last successful /status
  selectedTaskId:  string|null    // identity-stable selection (survives array rebuild)
  filterText:      string         // '/' search + r:<repo> + s:<state> prefixes
  activePanel:     'table'|'comments'|'logs'
  detail:          { comments?, logs? }   // fetched on panel open
  connected:       boolean        // last poll ok?
  lastError:       string|null    // shown in Header when !connected
```

### Key Data Flows

1. **Live table:** `usePoll` → `fetchStatus` → sort → store; selection re-resolved by `task_id` each render so a session ending mid-poll degrades gracefully (cursor clamps, no crash).
2. **Comments:** `c` maps selected `task_ref` → `task_id` (via `taskRefToTaskId`) → `fetchComments(baseUrl, task_id)` → `DetailPanel`. (The `/comments` endpoint is keyed by `task_id`, not `task_ref` — the mapping is mandatory.)
3. **Logs:** `l` → `fetchLogs` → `DetailPanel` does a *best-effort substring grep* by the row's identifying tokens. `/logs` is a shared 200-line ring with no `session_id`, so this is explicitly not a true per-session tail — surface that honestly in the UI label.

---

## Color / Formatting: the `picocolors` single-source invariant

**Ruling: ink's `<Text color="...">` does NOT violate the color-isolation invariant, and the TUI must NOT route through `src/cli/format.js`. The existing `test/format-isolation.test.js` stays green with zero changes.**

Evidence, from reading the test itself:

- The invariant is specifically about the **`picocolors`** import specifier. The test (`test/format-isolation.test.js:99-115`) asserts `importers === ['src/cli/format.js']` where `importers` is computed by scanning every `.js` under `src/` for an import whose specifier is literally `'picocolors'`. ink colors are produced by ink's own renderer (it ships its own ANSI generation via `chalk`/`ansi-styles` internally), **not** by importing `picocolors`. So ink components emitting `<Text color="green">` add zero `picocolors` importers → the assertion is untouched.
- The first isolation test (`format.js` must not transitively import `logger.js`) walks the import graph *starting from `format.js`*. The dashboard does not sit on that graph, so it is irrelevant.
- The `listJsFiles` walker recurses all of `src/` including the new `src/cli/dashboard/` folder. **Therefore the one hard rule for the TUI is: no file under `src/cli/dashboard/` may `import ... from 'picocolors'`.** ink supplies all color via `<Text>`/`<Box>` props; `picocolors` would be redundant anyway.

**Why NOT funnel ink through `format.js`:** `format.js` returns *strings with embedded ANSI escapes* sized for a flat `console.log` columnar layout. ink does its own Flexbox layout and color compositing on a virtual DOM; feeding it pre-ANSI'd strings would double-encode colors and break ink's width math (`visibleWidth` and ink's layout would disagree). The two color systems are orthogonal by design:

| Surface | Color source | Layout |
|---------|--------------|--------|
| Classic CLI (`kodo logs`, `check`, `gsd verify`) | `picocolors` via `createFormatter` | manual `formatRow`/`formatTable` strings |
| TUI (`kodo dashboard`) | ink `<Text color>` (ink's internal chalk) | ink Flexbox `<Box>` |

**Recommendation for planning:** Add a *second* isolation guard (cheap, optional) asserting that `src/cli/dashboard/**` contains zero `picocolors` imports — symmetrical to the existing invariant but pointed at the new folder. This documents intent and prevents a future contributor from "reusing" `createFormatter` inside the TUI. It is additive and does not modify the existing test. The existing `picocolors` single-source test continues to pass because ink is not `picocolors`. (Confidence: HIGH — verified by reading the assertion logic directly.)

---

## Build Order (dependency-ordered phasing)

Each step is independently testable and leaves the tree green. Ordered by hard dependency, simplest-first.

1. **Data client (`client.js`) + derive helpers (`select.js`)** — pure, zero ink, zero terminal. Unit-test with fake `fetch` and fixture `/status` JSON. *No dependency on anything ink.* Build first; everything else consumes these.
2. **Static table render (`App.js` minimal + Table/Row/Header/Footer)** — render a *static* sessions array (no polling yet) and assert `lastFrame()` with `ink-testing-library`. Depends on (1)'s `select.js` for row cells. Land the commander registration here so `bin/kodo dashboard` is invokable end-to-end as early as possible.
3. **Polling / live (`usePoll.js` wired into `App`)** — add the cancellable poll, connection status, `lastError` rendering. Test the hook's no-stack/teardown behaviour with a fake clock + fake client.
4. **Navigation (`useInput` ↑↓ + selection-by-task_id)** — inject arrow-key escape sequences via `ink-testing-library`'s `stdin.write` and assert the highlighted row moves and survives a simulated array rebuild (re-`rerender` with a reordered array, assert selection follows `task_id`).
5. **Attach handoff (`attach.js` + `index.js` loop)** — unit-test the loop with fake `render`/`spawn` (assert: exit value `{attachTo}` triggers `spawn('cmux',['attach',ref])` then re-render; `q` ends the loop with exitCode 0). Real TTY handoff is manual UAT.
6. **Detail panels (`DetailPanel` + `c`/`l`)** — comments (`task_ref`→`task_id` mapping) and best-effort log grep. Depends on (1)'s `fetchComments`/`fetchLogs` and (4)'s selection.
7. **Filters (`FilterInput` + `/`, `r:`, `s:`)** — `ink-text-input`-driven; depends on (4) for panel/focus routing and (1)'s `filterSessions`.

> Commander registration (one-liner in `src/cli.js`) lands in step 2 so the command is invokable end-to-end as early as possible (`bin/kodo dashboard` renders the static table), then each later step is purely additive to `App.js`/`index.js`.

---

## Testability Map (pure / ink-testing-library / manual-UAT)

| Surface | Tier | How |
|---------|------|-----|
| `client.fetchStatus/fetchComments/fetchLogs` | **Pure unit** (`node:test`) | Inject fake `fetch` returning fixtures + a throwing fake → assert `{ok}` discriminant and no-throw graceful path |
| `select.sortSessions / filterSessions / resolveSelection / taskRefToTaskId / rowCells` | **Pure unit** | Plain in/out assertions; the `resolveSelection`-survives-array-rebuild case is the load-bearing one |
| `usePoll` no-stack + teardown | **Pure-ish unit** | Drive with a fake async fn + fake timer; assert next tick only after prior resolves and `clearTimeout` on teardown (test the effect logic via a tiny harness component, or extract the scheduler core into a pure function) |
| `index.js` attach loop | **Unit with fakes** | Inject fake `renderFn` (returns `{waitUntilExit, exit}`) + fake `spawnFn`; assert `{attachTo}` → spawn `cmux attach` → re-render; `undefined` (quit) → loop ends, `process.exitCode === 0` |
| `App` static render | **ink-testing-library** | `render(createElement(App,{sessions:fixture}))` → assert `lastFrame()` contains expected columns/rows |
| Keyboard nav, panel switch, filter input | **ink-testing-library** | `stdin.write('\x1b[B')` (down arrow), `stdin.write('c')`, `stdin.write('/')` → assert `lastFrame()` reflects selection/panel/filter; `rerender` with reordered array to prove selection follows `task_id` |
| Color correctness (ink `<Text color>`) | **ink-testing-library (frames)** | Assert presence/absence of ANSI in `frames` if needed; mostly visual, low value to over-test |
| **Real `cmux attach` TTY handoff** | **Manual UAT** | The actual raw-mode unmount → `cmux attach` → re-render against a live cmux workspace cannot be faked; this is the one human smoke test (mirrors the project's pattern of automating UATs where possible but accepting a manual TTY smoke). Optionally a spawn-real `bin/kodo dashboard` smoke that asserts it renders and quits cleanly on `q` (no live cmux), leaving only the attach itself manual. |

**Pure-vs-ink boundary is the whole point:** every piece of *logic* (fetch, sort, filter, selection, the attach control flow) is pure/DI and lives outside React, so the bulk of coverage is fast `node:test` with no terminal. `ink-testing-library` is reserved for render assertions and key routing. Only the live `cmux attach` TTY swap stays manual.

---

## Anti-Patterns

### Anti-Pattern 1: Selecting rows by array index
**What people do:** Track `selectedIndex` and read `sessions[selectedIndex]`.
**Why it's wrong:** `/status` rebuilds the `sessions` array every poll (the server `.map()`s fresh each request — see `src/server.js:379`). The row under a fixed index changes out from under the cursor, and a vanished session shifts everything.
**Do this instead:** Track `selectedTaskId` and re-derive the index via `resolveSelection` each render (Pattern 3).

### Anti-Pattern 2: Spawning `cmux attach` while ink is still mounted
**What people do:** `spawn('cmux',['attach',ref],{stdio:'inherit'})` from inside a `useInput` handler.
**Why it's wrong:** ink holds the TTY in raw mode; the child and ink both grab stdin/stdout → garbled terminal, stuck raw mode, broken exit (ink's documented raw-mode footgun).
**Do this instead:** `exit({attachTo:ref})` → `index.js` `await waitUntilExit()` (tree fully unmounted) → spawn → on child exit, fresh `render()` (Pattern 4).

### Anti-Pattern 3: `setInterval` polling
**What people do:** `setInterval(fetchStatus, 2500)` like the existing web `dashboardHtml`.
**Why it's wrong:** A slow/hung server lets requests stack; an interval also survives the unmount/remount of the attach handoff if not perfectly cleared, firing into a torn-down tree (`setState` after unmount warnings / leaks).
**Do this instead:** Self-scheduling `setTimeout` that re-arms only after the prior fetch resolves, with a `cancelled` teardown flag (Pattern 2).

### Anti-Pattern 4: Routing ink colors through `createFormatter`
**What people do:** Import `createFormatter` and pre-color strings before passing them to `<Text>`.
**Why it's wrong:** Double-encodes ANSI and breaks ink's Flexbox width math; `format.js` is built for flat `console.log`, not a virtual DOM.
**Do this instead:** Use ink `<Text color>`/`<Box>` directly. `format.js` stays the classic-CLI color source; the TUI is a separate color domain (see Color section). Never `import 'picocolors'` under `src/cli/dashboard/`.

### Anti-Pattern 5: Calling `cmux rpc` from the TUI for liveness
**What people do:** Have the TUI query cmux directly to know which sessions are `alive`.
**Why it's wrong:** The server already merges live cmux workspace state into `/status` (each session carries `alive` + `elapsed_min` — `src/server.js:379-383`). Duplicating it in the client adds a second source of truth and an external dependency. The milestone decision explicitly states "la TUI NO llama a `cmux rpc`".
**Do this instead:** Render `alive`/`elapsed_min` straight from the `/status` payload. The TUI is a pure read-only HTTP client.

---

## Integration Points

### External / process boundaries

| Boundary | Integration Pattern | Notes |
|----------|---------------------|-------|
| kodo HTTP server | `fetch` GET only, base URL `http://localhost:${config.server.port}` (default 9090, `src/config.js:63`) | READ ONLY — no new endpoints (hard constraint). Resolve port from `loadConfig().server.port`, not a literal. Server down → `{ok:false}` → graceful UI |
| `cmux attach <ref>` | `child_process.spawn(cmuxBin, ['attach', ref], {stdio:'inherit'})` after ink unmount | Binary path: existing code reads `loadConfig().cmux.binary` (see `src/cmux/client.js:5`); reuse it rather than hardcoding `'cmux'`. The dashboard does NOT use the `execFile`-based `src/cmux/client.js` helpers (those capture output; attach needs `stdio:'inherit'` + interactive lifetime) |
| Node global `fetch` | Native in Node 20+ | No new dependency; injectable for tests |

### Internal boundaries

| Boundary | Communication | Considerations |
|----------|---------------|----------------|
| `src/cli.js` ↔ `dashboard/index.js` | `await import()` lazy load in the `.action()` | Identical to all existing subcommands; keeps startup budget unaffected and the `kodo check` logger-isolation guard (LOG-12) untouched since dashboard isn't on that graph |
| `dashboard/App.js` ↔ `client.js`/`select.js` | Direct import of pure functions | App holds state; logic stays pure and React-free |
| `dashboard/App.js` ↔ `index.js` | `useApp().exit(value)` resolving `waitUntilExit()` | Single control loop in `index.js` owns process lifecycle + exit code |
| `dashboard/**` ↔ `picocolors` | **forbidden** | ink owns TUI color; keeps `test/format-isolation.test.js` green (single `picocolors` importer remains `src/cli/format.js`) |
| `package.json` deps | add `ink`, `react`, `ink-text-input` as prod deps | First deps beyond `commander`+`picocolors`; aligns with STACK decision (ink@6.8.0 keeps Node 20 floor). No build step: `React.createElement`, no JSX |

---

## New vs Modified Modules (explicit)

**New (all under `src/cli/dashboard/`):** `index.js`, `App.js`, `client.js`, `select.js`, `usePoll.js`, `attach.js`, `components/{Header,Table,Row,DetailPanel,FilterInput,Footer}.js`.

**Modified:**
- `src/cli.js` — one `program.command('dashboard')...action(lazy import)` block (~8 lines, mirrors existing commands).
- `package.json` — add `ink`, `react`, `ink-text-input` to `dependencies`.

**Untouched (and must stay so):** `src/server.js` (no new endpoints), `src/cli/format.js` (color isolation), `test/format-isolation.test.js` (stays green unmodified), `src/cmux/client.js` (attach uses its own `spawn` for `stdio:'inherit'`, but may read the binary path from `loadConfig().cmux.binary`).

---

## Sources

- **kodo codebase (HIGH):** `src/server.js` (lines 354-455 — `/status`·`/logs`·`/comments` contract, array rebuilt per request, `alive`/`elapsed_min` merge), `src/cli/format.js` (createFormatter / single picocolors import), `test/format-isolation.test.js` (lines 98-129 — the assertion that defines the invariant), `src/cli.js` (subcommand registration + lazy-import pattern), `src/config.js:62-66` (`server.port: 9090`), `src/cmux/client.js:5` (cmux binary resolution from config), `.planning/PROJECT.md` (constraints: color isolation, no-build-step, DI-for-testability; milestone v0.9 stack decision).
- **ink official docs via Context7 `/vadimdemedes/ink` (HIGH):** `render()` returns `{rerender, unmount, waitUntilExit}`; `useApp().exit(value)` → `waitUntilExit()` resolves with that value after unmount-related stdout flushes; `useInput((input,key)=>...)` with `key.upArrow/downArrow/return/escape`; `ink-testing-library` `render()` exposes `{lastFrame, frames, stdin, rerender, unmount}` with `stdin.write()` for raw input (incl. ANSI arrow sequences).
- **STACK/FEATURES sibling research (carried forward, MEDIUM→HIGH):** ink@6.8.0 + react@19 + `React.createElement` (no JSX, preserves no-build-step); attach = unmount→waitUntilExit→spawn→re-render; `/logs` is a shared ring with no `session_id` (best-effort grep); `/comments` keyed by `task_id`; selection by `task_id` not index.

---
*Architecture research for: ink TUI subcommand in an existing ESM Node.js CLI*
*Researched: 2026-05-26*
