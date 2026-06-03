# Stack Research

**Domain:** Terminal UI (TUI) subcommand inside an existing Node.js ESM CLI (`kodo dashboard`), built with ink (React-for-CLI)
**Milestone:** v0.9 — kodo TUI sesiones en vivo
**Researched:** 2026-05-26
**Confidence:** HIGH (core versions/peerDeps verified against npm registry + the official package.json on GitHub master; spawn mechanism verified against ink's own README)

> Scope note: the stack decision (ink, Node subcommand, not Go/separate repo) is **already made** in PROJECT.md. This document details *what to add and at which versions*, and surfaces the two tensions that conflict with kodo's "no build step / minimal deps" culture so they become explicit decisions, not silent assumptions.

---

## The two tensions up front (read this first)

kodo today: Node `>=20`, ESM, **2 prod deps** (`commander`, `picocolors`), **no build step** (plain `.js` + JSDoc `@ts-check`), `node --test` suite (895 pass).

ink forces two decisions that cut against that culture:

1. **React major + Node floor.** The current `ink@7` requires **`react >=19.2.0` AND Node `>=22`**. kodo declares `engines.node >=20`. So `ink@7` either forces bumping kodo's Node floor to 22, or you pin **`ink@6.8.0`** (Node `>=20`, still `react >=19`). There is no current ink that runs on Node 20 with React 18 except the older `ink@5` line (`react >=18`, Node `>=18`). **Recommendation: `ink@6.8.0` + `react@19`** — keeps Node `>=20` (no engine bump), stays on a maintained ink line.

2. **JSX needs a transpile, or you write `createElement` by hand.** ink components are JSX. kodo has no build step. Two real options: (A) keep zero build step and author the TUI in plain `.js` using `React.createElement` (verbose but honest to the "no build step" constraint), or (B) introduce a *dev-only, on-the-fly* loader so you can write `.jsx`. **Recommendation: Option A (`createElement`, no build step)** — see "JSX / build-step decision" below.

Both are flagged again in the tables. Neither is hidden.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `ink` | **`^6.8.0`** | React renderer for the terminal — `<Box>`/`<Text>` layout (flexbox via yoga), `useInput` for keys, `render()` lifecycle | Current maintained line that **still supports Node `>=20`** (verified `engines.node: ">=20"`). `ink@7.0.1` is npm `latest` but requires **Node `>=22`** + `react >=19.2.0` — adopting it forces bumping kodo's `engines.node`. `ink@6.8.0` peerDeps: `react >=19.0.0`, `@types/react >=19.0.0`, `react-devtools-core >=6.1.2` (last two satisfiable / optional). Does NOT bundle React — it's a peer dep you install. |
| `react` | **`^19.2.0`** (e.g. `19.2.5`) | ink's required peer; provides `useState`/`useEffect`/`useRef` for polling + cursor state | ink@6 peer-requires `react >=19.0.0`. react is a **separate install**, not pulled transitively by ink. Pin a 19.2.x to satisfy both ink@6 (`>=19`) and the stricter ink@7 peer (`>=19.2.0`) if you ever bump. npm `latest` react at time of research: `19.2.5`. |

> **If you instead choose to bump kodo to Node 22:** use `ink@^7.0.1` + `react@^19.2.0`. Same companion packages below all still apply (they peer-require `ink >=5`/`>=4`, satisfied by 7). The only thing you change is `engines.node` and the ink pin.
>
> **If you must stay on React 18 / Node 18-20 line:** the last ink supporting that is `ink@^5.2.1` (`react >=18`, Node `>=18`). Not recommended — it's a maintenance dead-end relative to the 6/7 line — but it exists.

### Supporting Libraries

| Library | Version | Purpose | When to Use / dep-count cost |
|---------|---------|---------|------------------------------|
| `ink-text-input` | **`^6.0.0`** | The `/` search box + `r:`/`s:` prefix filter input | **Needed.** Hand-rolling a controlled text input over `useInput` (cursor, backspace, paste handling) is fiddly; this is the canonical component. peerDeps `ink >=5`, `react >=18` (✓ compatible with ink@6/react@19). ESM (`"type":"module"`), Node `>=18`. **Cost: +1 prod dep.** Worth it. |
| `ink-spinner` | **`^5.0.0`** | A spinner while `/status` is in-flight / on first load / reconnecting | **Optional / avoidable.** Nice for the "degradación elegante si el server no responde" reconnect state, but a static `<Text>Loading…</Text>` or a tiny hand-rolled frame-cycler (`useEffect` + `setInterval` over `['⠋','⠙',…]`) gives the same effect with **zero new deps**. peerDeps `ink >=4`, `react >=18`; ESM; Node `>=14.16`. **Recommendation: skip it; hand-roll if you want motion.** Saves a dep. |
| `ink-testing-library` | **`^4.0.0`** | Render ink components to a string buffer in `node --test` and assert frames + simulate `stdin.write()` for keys | **Needed (dev only).** kodo has a large suite and a culture of testing real behavior; this is the standard way to test ink without a TTY. `render()` returns `{lastFrame, frames, stdin, rerender, unmount}`. peerDeps: only `@types/react` (optional) — it does **not** force a react/ink version, so it slots into any ink line. ESM; Node `>=18`. **Cost: +1 devDep.** Put it in `devDependencies`. |
| `ink-table` | **AVOID** | A table component | **Do NOT add.** Verified unmaintained: published as `0.0.0-development`, CommonJS (`main: dist/index.js`, no `"type":"module"`), stale peerDeps (`ink >=3.0.0`, `react >=16.8.0`). It predates the ESM ink line and the React 18/19 era — high risk of peer/ESM friction. **Hand-roll the table** with `<Box>`/`<Text>` instead (the project explicitly favors minimal deps; the columns are fixed and known: `task_ref / repo / phase / mode / state / age`). A fixed-width column layout with `<Box width={N}>` + truncation is ~40 LOC and you already own the rendering. ink ships an official `table` *example* (not a published package) you can copy from if needed. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `@types/react` | Type-checking the TUI under existing `@ts-check` JSDoc | `^19.x`. **Optional but recommended** as a devDep so `// @ts-check` keeps working over the ink/React surface. ink's peer marks it optional. |
| `node --test` (built-in) | Run TUI tests via `ink-testing-library` | Already kodo's runner (`npm test`). No new runner needed. ink-testing-library works under `node:test`. |
| (No transpiler) | — | See JSX decision below. **Recommendation: do not add Babel/esbuild/tsx as a build step.** |

---

## JSX / build-step decision (KEY tension — explicit recommendation)

**Fact:** ink components are React; React needs either JSX (transpiled) or `React.createElement` (no transpile). kodo has **no build step** today and treats "no build step" as a constraint (PROJECT.md: "TypeScript migration… JSDoc + @ts-check cubre las necesidades sin build step").

### Recommended: Option A — plain `.js` + `React.createElement`, zero build step

Author the dashboard in plain ESM `.js` files using `createElement` (commonly aliased `const h = React.createElement`). Example shape:

```js
import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
const h = React.createElement;

function Row({ s, selected }) {
  return h(Box, null,
    h(Text, { inverse: selected }, `${s.task_ref}  ${s.repo}  ${s.state}  ${s.elapsed_min}m`)
  );
}
```

- **Pro:** Preserves the no-build-step invariant exactly. Ships as ordinary ESM next to `src/server.js`. `node bin/kodo dashboard` runs it directly. Tests run under `node --test` with no transform. This is the lowest-friction path and is honest to the stated constraint.
- **Con:** `createElement` is more verbose than JSX, especially for nested layout. Mitigated by small components and the `h` alias. For a ~5-view dashboard this is very manageable.

### Alternative: Option B — `.jsx` via a dev-only on-the-fly loader (NO bundler/build artifact)

If `createElement` verbosity becomes painful, you can keep "no build artifact" while still writing JSX by using a runtime/loader transform rather than a bundle step:
- `tsx` (a Node loader: `node --import tsx bin/kodo dashboard`) or a Node `--loader` that transpiles `.jsx` on import.
- **This is still a dependency and a runtime flag** — it changes how the binary is invoked and adds a devDep (and arguably a prod dep, since the loader must be present at run time unless you ship transpiled output). That re-introduces exactly the build-step coupling the project avoids.
- **Only choose this if** the team explicitly decides the JSX ergonomics are worth a loader dep. Surface it as a decision, don't default into it.

**Bottom line for the roadmapper:** default to Option A. Treat Option B as an opt-in escape hatch requiring an explicit "yes, we accept a loader" decision.

---

## HTTP polling with ZERO new deps

The TUI polls `GET http://localhost:9090/status` every ~2-3s and `GET /logs`, `GET /comments/<task_id>` on demand. **No HTTP client dep is needed** — Node 20+ ships global `fetch` + `AbortController` + `AbortSignal.timeout`.

Pattern (inside an ink component):

```js
import { useState, useEffect, useRef } from 'react';

function useStatus(intervalMs = 2500) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let timer;
    async function tick() {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 2000); // hard timeout < interval
      try {
        const res = await fetch('http://localhost:9090/status', { signal: ac.signal });
        const json = await res.json();
        if (!cancelled) { setData(json); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e); // server down → degrade, don't crash
      } finally {
        clearTimeout(to);
        if (!cancelled) timer = setTimeout(tick, intervalMs);
      }
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [intervalMs]);
  return { data, err };
}
```

Notes:
- `AbortController` + a timeout shorter than the poll interval prevents a stuck request from stacking ticks (the "degradación elegante" requirement). `AbortSignal.timeout(2000)` is an even terser equivalent available in Node 20+.
- Self-scheduling (`setTimeout` in `finally`) rather than `setInterval` avoids overlapping in-flight requests.
- On `err`, keep the last good `data` on screen and show a "server unreachable, retrying…" line → satisfies "no crash if server doesn't respond."
- **No new endpoints** are consulted: `/status` (enriched with `alive` + `elapsed_min` server-side already), `/logs` (client-side filter by `session_id`), `/comments/<task_id>`. Matches the hard constraint.

---

## Spawning `cmux attach` (interactive foreground child) from inside ink — exact mechanism

This is the load-bearing part. ink owns the TTY (raw mode, alternate screen, stdin). You **cannot** just `spawn('cmux', ['attach', ref], {stdio:'inherit'})` while ink is still mounted — ink and the child would fight over stdin/stdout. The canonical sequence (verified against ink's README lifecycle docs):

**Mechanism: tear ink down, then hand the raw TTY to the child.**

1. From the row's `Enter` handler, call `exit()` from `useApp()` (unmounts the whole ink app), **or** call `unmount()` on the instance returned by `render()`. Both restore the terminal (ink restores native console on unmount; raw mode is released).
2. `await waitUntilExit()` on the render instance — resolves after ink has finished unmount-related stdout writes, so the terminal is clean before the child takes over.
3. `spawn('cmux', ['attach', workspace_ref], { stdio: 'inherit' })` — `stdio:'inherit'` gives the child kodo's real stdin/stdout/stderr (a full interactive TTY). Use `child_process.spawn` from `node:child_process`.
4. When the child exits, either re-`render()` a fresh ink instance to return to the dashboard, or exit kodo. (ink's README explicitly warns: *"Reusing the same stdout across multiple render() calls without unmounting is unsupported. Call unmount() first…"* — so always fully unmount before spawning, and re-`render()` a new instance to come back.)

Concrete shape (outside the component, around `render()`):

```js
import { spawn } from 'node:child_process';
import { render } from 'ink';

let app;
function start() {
  app = render(React.createElement(Dashboard, {
    onAttach: async (workspaceRef) => {
      app.unmount();                 // give the TTY back
      await app.waitUntilExit();     // wait for ink teardown to flush
      const child = spawn('cmux', ['attach', workspaceRef], { stdio: 'inherit' });
      child.on('exit', () => start());   // re-mount dashboard when attach ends
    },
  }));
}
start();
```

API facts verified from ink's README:
- `render(tree)` returns an instance with `unmount()`, `waitUntilExit()`, `clear()`, `rerender()`.
- `useApp()` returns `{ exit, waitUntilRenderFlush }`. `exit()` unmounts the whole app; `waitUntilExit()` then resolves.
- `exitOnCtrlC` defaults `true` — handles the `q`→quit / Ctrl+C path; you also wire `q` via `useInput`.
- `patchConsole` defaults `true` and is restored to native console at unmount start — important so that, after handing off to `cmux attach`, console output isn't still routed through a dead ink renderer.

**Do NOT** use the community `ink-spawn` package for this (it's for rendering child *output inside* the ink tree, e.g. ink's `subprocess-output` example, not for a full interactive TTY handoff). For an interactive attach you specifically want ink **out of the way**. No extra dep needed — `node:child_process` + ink's lifecycle covers it.

**Keyboard nav / keybindings:** `useInput((input, key) => …)` gives `key.upArrow`/`key.downArrow` (cursor over rows), `key.return` (Enter → attach), and `input === 'c' | 'l' | 'q' | '/'` for the single-letter bindings. While the `/` filter input is focused, gate `useInput` (or use `ink-text-input`'s own focus) so letters go to the text box, not the keybindings — standard ink focus handling (`useFocus`/`isFocused` or a simple `mode` state flag).

---

## Installation

```bash
# Core (prod) — ink + its required React peer
npm install ink@^6.8.0 react@^19.2.0

# Supporting (prod) — only the text input is non-negotiable
npm install ink-text-input@^6.0.0

# Dev dependencies — testing + types (NO transpiler/build step)
npm install -D ink-testing-library@^4.0.0 @types/react@^19

# Explicitly NOT installing: ink-table (unmaintained, hand-roll), ink-spinner (optional,
# hand-roll), any HTTP client (Node fetch), any Babel/esbuild/tsx build step (use React.createElement)
```

Net prod-dep change: **2 → 5** (`ink`, `react`, `ink-text-input`). Plus 2 devDeps. This is the minimal honest cost of an ink TUI; the avoidance choices (`ink-table`, `ink-spinner`, HTTP client, transpiler) keep it from ballooning further.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `ink@6.8.0` + Node `>=20` | `ink@7.0.1` + Node `>=22` | If the team is fine bumping kodo's `engines.node` to 22. ink@7 is npm `latest`; choose it once Node 22 is the floor. Same companions apply. |
| `ink@6.8.0` (react 19) | `ink@5.2.1` (react 18, Node `>=18`) | Only if some other constraint pins React to 18. Otherwise avoid — 5.x is the legacy line. |
| Hand-rolled `<Box>`/`<Text>` table | `ink-table` | Essentially never for this project — it's `0.0.0-development`, CJS, react `>=16.8`. If you truly want a prebuilt table, copy ink's official `table` example or vet a maintained fork; do not take the `ink-table` package as-is. |
| Hand-rolled spinner / static `Loading…` | `ink-spinner@5` | If you want a polished animated spinner and accept +1 dep. Functionally optional. |
| `React.createElement` (no build) | `tsx`/loader for `.jsx` | If `createElement` verbosity is hurting maintainability AND the team accepts a loader dep + changed invocation. Explicit decision only. |
| Node global `fetch` | `undici` / `node-fetch` / `axios` | Never here — `fetch` is built into Node 20+. Adding an HTTP client would be a pure regression against minimal-deps. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ink-table` | Published `0.0.0-development`, CommonJS (no `"type":"module"`), peerDeps stuck at `ink >=3 / react >=16.8` — predates the ESM + React 18/19 ink line; peer & ESM friction risk | Hand-roll fixed-width columns with `<Box>`/`<Text>` (fixed known columns) |
| `ink@7` *while keeping `engines.node >=20`* | ink@7 requires Node `>=22`; installing it under a Node-20 floor is a latent runtime/engine mismatch | `ink@6.8.0` (Node `>=20`), or consciously bump the engine to 22 |
| `axios` / `node-fetch` / `undici` | Redundant — Node 20+ has global `fetch` + `AbortController` | `globalThis.fetch` |
| A bundler/build step (webpack/esbuild/rollup) for the TUI | Breaks the "no build step" invariant; ships build artifacts kodo doesn't have today | `React.createElement` in plain `.js` |
| `ink-spawn` for the `cmux attach` handoff | It renders child *output inside* ink; it does not give the child an interactive TTY | `unmount()` + `waitUntilExit()` + `spawn(..., {stdio:'inherit'})` |
| `commander` sub-parsing inside the TUI | The TUI is interactive, not flag-driven; `commander` only needs to register the `dashboard` subcommand entry point | Register one `kodo dashboard` command in the existing `commander` setup, then hand off to ink |

## Stack Patterns by Variant

**If kodo keeps `engines.node >=20` (default / recommended):**
- Use `ink@^6.8.0` + `react@^19.2.0`.
- Because ink@7 would silently require Node 22; ink@6.8.0 is the newest line that honors the existing Node floor.

**If the team accepts bumping to `engines.node >=22`:**
- Use `ink@^7.0.1` + `react@^19.2.0` and update `package.json#engines`.
- Because ink@7 is npm `latest` and the future-maintained line; only the Node floor blocks it today.

**If JSX ergonomics become painful:**
- Add a dev loader (`tsx`) and write `.jsx`, accepting the loader dep + changed invocation.
- Because a loader avoids a *bundle artifact* while restoring JSX — but it is still a dependency, so it's an explicit tradeoff, not a default.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ink@6.8.0` | `react >=19.0.0`, Node `>=20` | Verified `engines.node: ">=20"`, peerDeps `react/@types/react >=19.0.0`, `react-devtools-core >=6.1.2`. React is NOT bundled — install it. |
| `ink@7.0.1` (npm latest) | `react >=19.2.0`, Node `>=22` | Verified `engines.node: ">=22"`. **Engine conflict with kodo's `>=20`** unless you bump. |
| `ink-text-input@6.0.0` | `ink >=5`, `react >=18` | ESM, Node `>=18`. Compatible with both ink@6 and ink@7. |
| `ink-spinner@5.0.0` | `ink >=4.0.0`, `react >=18.0.0` | ESM, Node `>=14.16`. Optional. |
| `ink-testing-library@4.0.0` | peer only `@types/react` (optional) | ESM, Node `>=18`. Version-agnostic to ink/react — slots into any ink line. devDep. |
| `react@19.2.5` | `ink@6` (`>=19`) and `ink@7` (`>=19.2.0`) | Pin a 19.2.x to satisfy the stricter ink@7 peer too, easing a future bump. |
| Node global `fetch` | Node `>=20` | Built-in; `AbortController`/`AbortSignal.timeout` also built-in. No dep. |

## Sources

- npm registry (`npm view`, verified directly) — `ink@7.0.1` (latest): `engines.node ">=22"`, peerDeps `react/@types/react ">=19.2.0"`, `react-devtools-core ">=6.1.2"`, does not list react as a regular dependency. `ink@6.8.0`: `engines.node ">=20"`, peerDeps `react/@types/react ">=19.0.0"`. `ink@5.2.1`: `engines.node ">=18"`, peerDeps `react/@types/react ">=18.0.0"`. `ink` dist-tags: `{ next: '3.0.0-7', latest: '7.0.1' }`. `react` latest: `19.2.5`. — **HIGH**
- GitHub `vadimdemedes/ink` `package.json` (master) — version `7.0.4`, `"type":"module"`, `engines.node ">=22"`, peerDeps `react/@types/react ">=19.2.0"`. Confirms the npm data and that master is slightly ahead of npm latest. — **HIGH**
- GitHub `vadimdemedes/ink-text-input` `package.json` (master) — version `6.0.0`, `"type":"module"`, `engines.node ">=18"`, peerDeps `ink ">=5"`, `react ">=18"`. — **HIGH**
- GitHub `vadimdemedes/ink-spinner` `package.json` (master) — version `5.0.0`, `"type":"module"`, `engines.node ">=14.16"`, peerDeps `ink ">=4.0.0"`, `react ">=18.0.0"`. — **HIGH**
- GitHub `vadimdemedes/ink-testing-library` `package.json` (master) — version `4.0.0`, `"type":"module"`, `engines.node ">=18"`, peerDeps only `@types/react` (optional). — **HIGH**
- GitHub `maticzav/ink-table` `package.json` (master) — version `0.0.0-development`, CommonJS (`main: dist/index.js`, no `"type":"module"`), peerDeps `ink ">=3.0.0"`, `react ">=16.8.0"` → flagged unmaintained / avoid. — **HIGH**
- ink README (GitHub master) — `useInput((input,key)=>…)` with `key.upArrow/downArrow/return`; `useApp()` → `{exit, waitUntilRenderFlush}`; `render()` instance → `{unmount, waitUntilExit, clear, rerender}`; `exitOnCtrlC` default `true`; `patchConsole` default `true` restored to native at unmount; explicit warning that reusing stdout across `render()` calls without `unmount()` is unsupported; `ink-spawn` listed as "render child process output" (not interactive handoff); official `table` and `subprocess-output` examples present. — **HIGH**
- WebSearch (npmjs.com / Socket) — corroborated `ink-text-input@6.0.0` latest, peerDeps `ink >=5`, `react >=18`. — **MEDIUM** (used only to cross-check the GitHub package.json)

> Environment note: the npm registry and registry.npmjs.org JSON API were intermittently unreachable from the research sandbox (DNS `ENOTFOUND`/`ECONNREFUSED`). The successful `npm view` calls (ink, react) and the GitHub `package.json` reads (companion packages) provided authoritative version/peer/engine data; WebSearch corroborated `ink-text-input`. All version claims are backed by at least one HIGH source.

---
*Stack research for: ink TUI subcommand inside kodo (Node ESM CLI)*
*Researched: 2026-05-26*
