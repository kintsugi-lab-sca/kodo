# Architecture Research

**Domain:** TUI ↔ task-manager integration on an existing Node.js CLI (kodo, milestone v0.12 "Atajos al gestor y progreso vivo")
**Researched:** 2026-06-11
**Confidence:** HIGH (grounded in the actual source at every integration point, not inferred)

> **Headline finding that reframes the whole question:** the URL plumbing for feature 1
> **already exists end-to-end in shipped code.** `TaskItem.url` is one of the 13 canonical
> fields (GitHub `issue.html_url`, Plane `${baseUrl}/${workspaceSlug}/browse/${ref}`).
> `buildSessionFromTask` already persists `task_url: task.url` into `SessionRecord`
> (`src/session/manager.js:48`), the field is already documented in the `Session` typedef
> (`src/session/state.js:23`), and `GET /status` already passes it through to every dashboard
> row via `...s` (`src/server.js:424`). The HTML server view even renders it as a clickable
> `<a href>` (`src/server.js:206`, `:272`). **Design (a) is therefore ~90% already done.**
> Open-in-manager collapses to: add ONE keypress handler + ONE never-throws `open.js` module.
> This makes the recommendation between (a) and (b) decisive — see the comparison below.

---

## Standard Architecture

### System Overview — where the two features land

```
┌──────────────────────────────────────────────────────────────────────┐
│  NORMALIZER LAYER  (pure, provider-specific)                         │
│  ┌────────────────────────┐    ┌────────────────────────┐           │
│  │ github/normalize.js    │    │ plane/normalize.js     │           │
│  │  url: issue.html_url   │    │  url: `${base}/.../br…`│ ← url ALREADY│
│  └───────────┬────────────┘    └───────────┬────────────┘   a field │
│              └──────────► TaskItem.url ◄────┘  (13 canonical fields) │
├──────────────────────────────────────────────────────────────────────┤
│  PERSISTENCE LAYER  (launch-time, pre-spawn)                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ session/manager.js  buildSessionFromTask()                   │  │
│  │   task_url: task.url   ← ALREADY persisted (mirror of        │  │
│  │   worktree_path: …       worktree_path, gsd_mode, phase_id)  │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
│                          state.json  (SessionRecord)                │
├──────────────────────────────────────────────────────────────────────┤
│  SERVER LAYER  (read-only enrichment — NO new endpoints)            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ server.js  GET /status →  { ...s, elapsed_min,               │  │
│  │   provider_state, provider_state_reason }                    │  │
│  │   `...s` already carries task_url to the row  (line 424)     │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  TUI LAYER  (ink/react, never-throws, color-isolated)              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐    │
│  │ client.js   │  │ select.js / │  │ App.js  useInput          │    │
│  │ fetchStatus │  │ format.js   │  │  mode: list/filter/       │    │
│  │ (no change) │  │ (no change) │  │       overlay/confirm     │    │
│  └─────────────┘  └─────────────┘  └────┬─────────────────────┘    │
│                                          │ keypress dispatch        │
│       ┌──────────────────┐   ┌───────────▼───────────┐              │
│       │ focus.js          │   │ open.js  (NEW)        │ ← mirror of  │
│       │ runFocus → cmux   │   │ runOpen → `open` URL  │   focus.js   │
│       │ (execFile)        │   │ (execFile, never-throws)│            │
│       └──────────────────┘   └───────────────────────┘              │
└──────────────────────────────────────────────────────────────────────┘
```

Feature 2 (live task-state) reuses the **light-plan seam** proven in v0.11: a kodo-controlled file
under `~/.kodo/`, written by a hook, read by the TUI via the filesystem (never an endpoint) —
exactly how `~/.kodo/plans/<task_id>.md` already works.

### Component Responsibilities

| Component | Responsibility | Status for v0.12 |
|-----------|----------------|------------------|
| `providers/*/normalize.js` | Produce canonical `TaskItem` incl. `url` | **No change** — `url` already populated |
| `session/manager.js` | Persist `task_url` into SessionRecord at launch | **No change** — `task_url: task.url` already there |
| `server.js` `GET /status` | Pass SessionRecord fields to row via `...s` | **No change** — `task_url` already passes through |
| `cli/dashboard/App.js` | `useInput` keypress dispatch | **Modify** — add one `input === 'o'` branch |
| `cli/dashboard/open.js` | Never-throws `open <url>` via `execFile` | **NEW** — mirror of `focus.js` |
| `cli/dashboard/index.js` | DI-wire `onOpen` into `<App />` | **Modify** — add `onOpen` prop (mirror `onFocus`) |
| `hooks/session-start.js` | (feature 2) instruct agent to write live state | **Modify** if spike VIABLE |
| `hooks/<capture>.js` | (feature 2) capture task-state to `~/.kodo/` | **NEW** if spike VIABLE |
| `cli/dashboard/<state-reader>.js` | (feature 2) never-throws read of the state file | **NEW** if spike VIABLE |

---

## The two designs for the URL — evaluated against the invariants

### Design (a) — `url` on `TaskItem` + `task_url` on `SessionRecord` (persist at launch)

**What it is:** the URL is a *data field* that rides the canonical `TaskItem`, gets snapshotted into
`SessionRecord` at launch (mirror of `worktree_path`), and flows to the row for free.

**Reality check:** this is **already implemented.** Verified callsites:
- `src/providers/github/normalize.js:102` → `url: issue.html_url` (D-15)
- `src/providers/plane/normalize.js:76` → `url: \`${context.baseUrl}/${context.workspaceSlug}/browse/${ref}\``
- `src/session/manager.js:48` → `task_url: task.url` inside `buildSessionFromTask`
- `src/session/state.js:23` → `task_url?: string` documented in the `Session` typedef
- `src/server.js:424` → `{ ...s, … }` spreads `task_url` onto the `/status` row

**Invariant scorecard:**
- *Zero new endpoints* → ✅ PERFECT. The URL is already in the row; the TUI reads it from the poll
  result it already has. No `GET /status` change, no new route. This is the **exact same read pattern
  as `focus.js`** (which reads `workspace_ref` straight off the row).
- *Contract FROZEN at 9* → ✅ PERFECT and **not even touched.** `url` is a `TaskItem` field, not a
  `TaskProvider` method. `TASK_PROVIDER_METHODS` stays at 9, untouched. No new method to typeof-detect,
  no capability gate, no contract-matrix row.
- *Forensic trace* → ✅ The URL is snapshotted at launch, so it survives even if the task is later
  deleted/renamed in the provider — consistent with the `worktree_path` rationale (persist derived
  data pre-spawn so the trace exists).

### Design (b) — optional `getTaskUrl(task)` provider method (mirror `getTaskState`)

**What it is:** add an OPTIONAL, typeof-detected `getTaskUrl` to each provider, *outside* the 9, and
call it live to resolve a URL on demand.

**Invariant scorecard:**
- *Zero new endpoints* → ⚠️ WEAKER. A provider method is invoked **server-side or at launch**, not from
  the already-present row. To get the URL to the TUI you would either (i) re-enrich `/status` server-side
  like `provider_state` (more server work, a live provider call per row, cache/dedup/fail-open machinery —
  all to recompute something static), or (ii) call it at launch and persist anyway — at which point you
  have re-implemented design (a) with an extra indirection.
- *Contract FROZEN at 9* → ✅ Technically honored (outside the 9, like `getTaskState`), BUT it spends the
  "optional method" affordance on a value that is **static and already known at normalize time.**
  `getTaskState` earned that affordance because state is *live and changes after launch*; a task's URL
  does not change for the life of the session.
- *Complexity* → ✗ Strictly worse: two new methods (Plane + GitHub), capability gating, a contract-matrix
  entry, and a resolver — for zero behavioral gain over a field that already exists.

### Recommendation: **Design (a). Unambiguously.**

Rationale tied to the invariants:

1. **It is already shipped.** The roadmap should treat the URL data path as *done* and scope the core
   feature to the consumer side only (one keypress + `open.js`). Re-deriving it via (b) would be net-new
   code replacing working code.
2. **`getTaskState` is the wrong analogy.** `getTaskState` (v0.10) was added as an optional method
   *because state is live* — it must be re-fetched after launch and differs per poll. A URL is **static**
   (known at normalize time, immutable for the session). The correct mirror for a static value is the
   `worktree_path` pattern (persist-derived-at-launch) — **which is exactly design (a) and exactly what
   the code already does.**
3. **Best honoring of "zero new endpoints."** (a) reads the URL off the row the dashboard already polls —
   identical to how `focus.js` reads `workspace_ref`. (b) tempts a `/status` re-enrichment (more server
   surface) or a redundant launch-time persist.
4. **Best honoring of "FROZEN at 9."** (a) doesn't touch the provider contract at all; the URL is a
   `TaskItem` field. (b) adds method #10-as-optional for no live-data reason.

**One small gap to verify, not a redesign:** `manager.js` sets `task_url` from `task.url`, and both
normalizers populate `url`, so webhook/polling/manual dispatch all carry it. The only edge is a **legacy
SessionRecord persisted before this field existed** — those rows have `task_url === undefined`, so the
keypress handler **must no-op gracefully on a falsy `task_url`** (same defensive posture as
`worktree_path ?? project_path`).

---

## Architectural Patterns

### Pattern 1: never-throws side-effect module (the `focus.js` mold) — for `open.js`

**What:** a leaf module wrapping a single `execFile` invocation, collapsing *every* failure mode to a
discriminated `{ok:false, code, detail}` — never rejects, never throws to React.
**When to use:** any TUI-triggered external side effect (cmux focus; now: open URL in browser).
**Trade-offs:** more ceremony than a bare `execFile`, but it's the load-bearing reason the TUI never
crashes and the panel never unmounts. Non-negotiable here.

**`open.js` (new) — direct structural copy of `focus.js`:**
```js
// src/cli/dashboard/open.js  (mirror of focus.js)
// macOS: `open <url>`. Pure DI: `exec` injected (execFile-shaped), no default — leak guard.
export function runOpen({ exec, url, binary = 'open', timeoutMs = 5_000 }) {
  if (typeof exec !== 'function') throw new TypeError('runOpen: `exec` is required (leak guard).');
  return new Promise((resolve) => {
    try {
      exec(binary, [url], { timeout: timeoutMs }, (err) => {
        if (!err) return resolve({ ok: true });
        if (err.code === 'ENOENT') return resolve({ ok: false, code: 'ENOENT', detail: err.message });
        if (typeof err.code === 'number') return resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: err.code });
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      resolve({ ok: false, code: 'SPAWN_ERROR', detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
```
**Note on the binary:** `focus.js` takes `binary` from `loadConfig().cmux.binary`. For `open.js` the
binary is the OS `open` (macOS — Constraints pin the runtime to macOS). Keep it injectable but default
to `'open'`. (If cross-platform is ever wanted, `xdg-open`/`start` — explicitly out of scope today.)

### Pattern 2: read-off-the-row (the `focus.js` consumer mold) — for the `o` keypress

**What:** the keypress handler reads the datum **directly off the already-polled row** and fires the side
effect; no fetch, no overlay, no await window before dispatch.
**When to use:** the datum is already on the `SessionRecord`/row (`workspace_ref`, and now `task_url`).
**Trade-offs:** none — cheapest, most invariant-safe path. Contrast with the `c`/`l` overlays which DO
fetch (and thus need the `overlayReqRef` race guard); `o` does **not** need it.

**App.js handler (modify) — sits in the `mode === 'list'` block, mirror of the Enter/`d` handlers:**
```js
if (input === 'o') {
  const row = sel.index >= 0 ? filtered[sel.index] : null;
  if (!row) return;
  if (!row.task_url) {                 // legacy/missing → footer message, no exec
    setFocusError(OPEN_ERR_NO_URL); setFooterColor('red'); return;
  }
  const result = await onOpen?.(row.task_url);   // never-throws, panel stays mounted
  if (result && !result.ok) {
    setFocusError(result.code === 'ENOENT' ? OPEN_ERR_ENOENT : openErrFailed(result.detail ?? 'unknown'));
    setFooterColor('red');
  }
  return;
}
```
Reuses the existing `focusError`/`footerColor` footer channel (clear-on-any-input already handles it).
No new `mode`. No overlay. Cursor untouched (identity by `task_id` preserved for free).

### Pattern 3: kodo-controlled file seam (the light-plan mold) — for feature 2 capture/display

**What:** a hook **writes** a kodo-owned artifact to a stable, `task_id`-correlated path under `~/.kodo/`;
the TUI **reads** it from the filesystem via a pure never-throws helper. No endpoint crosses the boundary —
producer and consumer agree on a byte-identical path.
**When to use:** any session-scoped data the agent produces that the dashboard must display.
**Why it's the right mold for feature 2:** it's *exactly* how `~/.kodo/plans/<task_id>.md` works today
(`session-start.js` instructs the write; `plan.js#readLightPlan` reads it; the seam is verified
byte-identical). Live task-state is the same shape: agent-produced, session-scoped, displayed read-only.
**Trade-off:** the agent must cooperate (it writes the file) — which is precisely what the **spike must
prove is reliably capturable** with a *supported* Claude Code hook/surface. (PROJECT.md notes TodoWrite is
deprecated and transcript/`~/.claude/plans/` are fragile across versions — hence the hard gate.)

---

## Data Flow

### Feature 1 — Open-in-manager (core, ships unconditionally)

```
normalize.js  url: html_url / browse-URL      ← ALREADY
        ↓ (TaskItem.url)
manager.js  buildSessionFromTask → task_url    ← ALREADY (pre-spawn, mirror worktree_path)
        ↓ (state.json SessionRecord)
server.js  GET /status → { ...s }              ← ALREADY (task_url passes through)
        ↓ (poll result row, already in TUI memory)
App.js  useInput  input==='o'  → row.task_url  ← MODIFY (new branch, no fetch)
        ↓
open.js  runOpen({exec, url})  → `open <url>`  ← NEW (never-throws, execFile)
        ↓
[browser opens the task in Plane/GitHub; ink panel stays mounted]
```
Net change for the core: **1 new file (`open.js`), 2 edits (`App.js` handler, `index.js` `onOpen` DI).**
Everything upstream of the keypress is already shipped.

### Feature 2 — Live task-state (conditional on spike VIABLE)

```
[running Claude session emits todo/task progress]
        ↓  (capture surface — TBD by spike: PostToolUse hook on the todo tool,
            transcript watcher, or structured-file poll — spike picks the SUPPORTED one)
hooks/<capture>.js   write  ~/.kodo/state/<task_id>.json   ← NEW (kodo-controlled path)
        ↓  (filesystem; producer↔consumer seam, byte-identical path — light-plan mold)
cli/dashboard/<state-reader>.js   readTaskState(row)        ← NEW (pure, sync, never-throws)
        ↓
App.js   render in table column OR a new overlay (`t`?)     ← MODIFY (display only)
```
**Endpoint-free read decision:** read it from the **filesystem** in the TUI, exactly like the plan overlay
(`plan.js#readLightPlan`) — *not* by enriching `/status` server-side. The plan overlay already proves the
filesystem-read path honors "zero new endpoints." Server enrichment (the `provider_state` mold) is the
*alternative* pattern but costs server surface and a per-row resolve; prefer it ONLY if the state must be
merged/derived server-side (it does not — it's a passthrough of an agent-written file).
**Recommendation: filesystem read (light-plan mold), not `/status` enrichment.**

---

## Suggested Build Order (respects the spike gate; low-risk core first)

1. **Core: Open-in-manager** *(ships unconditionally — lowest risk, mostly already built).*
   - `src/cli/dashboard/open.js` (NEW) — `runOpen`, exact `focus.js` mold, never-throws, DI `exec`.
   - `src/cli/dashboard/index.js` (MODIFY) — wire `onOpen: (url) => runOpen({exec: execImpl, url})` as a
     prop to `<App/>`, mirror of the existing `onFocus` wiring (line 136).
   - `src/cli/dashboard/App.js` (MODIFY) — `input === 'o'` branch in the `list` block; falsy `task_url`
     guard; reuse the footer channel; literal-stable copy strings (`OPEN_ERR_*`).
   - Tests: unit the `runOpen` discriminant (ENOENT / non-zero / sync-throw); App handler test for the
     no-url no-op and success/exec paths. UAT: the `open`→browser step is GUI, so it closes by **manual
     UAT** (same as `focus.js`/Enter in Phase 37 — `execFile` to a GUI isn't auto-verifiable).
   - **No server, normalizer, manager, or contract change.** Dogfood: verify `task_url` present on live
     rows; confirm legacy rows degrade gracefully.

2. **Research** *(precedes the spike)* — what replaced TodoWrite in current Claude Code, and which
   hook/surface exposes live task-state. Output feeds the spike's candidate list.

3. **Spike (HARD GATE)** — empirical VIABLE/INVIABLE verdict on capturing live task-state via a *supported*
   surface. If INVIABLE → feature 2 is cut for v0.12; the milestone still ships the core.

4. **Feature 2 (ONLY if spike VIABLE)** — capture → persist → display:
   - Capture hook (NEW) writing `~/.kodo/state/<task_id>.json` (or `.md`) — light-plan mold, `KODO_DIR`-rooted,
     `task_id`-correlated, byte-identical producer/consumer path.
   - `session-start.js` (MODIFY) if the chosen surface needs an instruction injected (mirror of the v0.11
     light-plan instruction).
   - Pure never-throws reader in `src/cli/dashboard/` (NEW) — mirror `plan.js#readLightPlan`:
     `homedir`/`KODO_DIR`-rooted, anti-ReDoS `task_id` containment guard, ENOENT→"no state yet", other→"error",
     never throws.
   - App.js (MODIFY) display — a column cell or a fifth `mode:'overlay'` consumer; reuse the snapshot-on-open
     + `Esc`-preserves-cursor machinery already there for `c`/`l`/`p`.
   - **Endpoint-free:** filesystem read, NOT `/status` enrichment.

5. **Backfill Nyquist v0.11** (doc-only Tier 1) — saldar 44/45/46 `draft` VALIDATION.md, citation-based,
   mirror of Phase 47. Independent of the above; can run last.

---

## Anti-Patterns (specific to this integration)

### Anti-Pattern 1: re-deriving the URL via an optional provider method
**What people do:** add `getTaskUrl` to mirror `getTaskState`, then enrich `/status` to expose it.
**Why it's wrong:** the URL is static and already on the row; `getTaskState`'s optional-method affordance
exists for *live* data. This adds server surface (tension with "zero new endpoints"), two provider
implementations, and a capability gate — to recompute a value that's already persisted.
**Do this instead:** read `row.task_url` (design (a) — already shipped).

### Anti-Pattern 2: opening the URL through an overlay / fetch
**What people do:** model `o` like the `c`/`l` overlays (fetch, snapshot, `overlayReqRef` race guard).
**Why it's wrong:** there's nothing to fetch — the URL is on the row. An overlay adds a `mode`, a race
guard, and UI for a fire-and-forget action.
**Do this instead:** model `o` like Enter/`d` — read off the row, fire `runOpen`, footer-report errors.

### Anti-Pattern 3: enriching `/status` for live task-state
**What people do:** add server-side merge of the agent's state file into `/status` (the `provider_state` mold).
**Why it's wrong:** it's a passthrough of an agent-written file — no server-side derivation is needed — and
it grows server surface against the "zero new endpoints" invariant.
**Do this instead:** read the file in the TUI (the light-plan / `plan.js` mold).

### Anti-Pattern 4: unmounting the panel or toggling alt-screen on open
**What people do:** `spawn` with `stdio:'inherit'` or unmount ink to "hand off" to the browser.
**Why it's wrong:** breaks the `execFile` fire-and-forget invariant; `open <url>` returns in ~ms and the
TUI must stay mounted (mirror of `focus.js`'s explicit "NO TTY, NO alt-screen toggle").
**Do this instead:** `execFile('open', [url])`, ignore stdout/stderr, panel stays mounted.

---

## Integration Points

### External Services / OS

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Browser (via OS `open`) | `execFile('open', [url])` fire-and-forget | macOS-only per Constraints; mirror of `cmux select-workspace`. Default binary `'open'`, injectable. |
| Plane / GitHub web UI | URL only — already constructed by normalizers | No live API call for the URL; persisted at launch. |
| Claude Code (feature 2) | capture hook surface — **spike-gated** | TodoWrite deprecated; transcript/`~/.claude/plans/` fragile (PROJECT.md). Spike must find a SUPPORTED surface. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| normalizer → SessionRecord | `task.url` → `task_url` at launch | Already wired (`manager.js:48`). Mirror of `worktree_path`. |
| SessionRecord → TUI row | `...s` in `GET /status` | Already wired (`server.js:424`). Zero endpoint change. |
| App.js → open.js | `onOpen(url)` prop, DI `exec` | NEW prop, mirror of `onFocus` (`index.js:136`). |
| capture hook → TUI (feature 2) | `~/.kodo/state/<task_id>.json` filesystem seam | Light-plan mold; byte-identical producer/consumer path; never an endpoint. |

---

## Sources

- `src/providers/github/normalize.js:102` — `url: issue.html_url` (HIGH, source-of-truth)
- `src/providers/plane/normalize.js:76` — Plane URL construction (HIGH)
- `src/session/manager.js:48` — `task_url: task.url` persisted at launch (HIGH)
- `src/session/state.js:23` — `task_url?` in `Session` typedef (HIGH)
- `src/server.js:206`, `:272`, `:424` — `task_url` rendered as `<a>` + spread onto `/status` row (HIGH)
- `src/cli/dashboard/focus.js` — never-throws `execFile` side-effect mold for `open.js` (HIGH)
- `src/cli/dashboard/index.js:111`,`:136` — `onFocus` DI wiring to mirror for `onOpen` (HIGH)
- `src/cli/dashboard/App.js:489-573` — `useInput` `list`-block handlers (`p`/`d`/Enter) as the mold (HIGH)
- `src/cli/dashboard/plan.js#readLightPlan` — light-plan filesystem seam for feature 2 (HIGH)
- `.planning/PROJECT.md` — invariants, v0.10 `getTaskState`/`provider_state` precedent, v0.11 light-plan seam, TodoWrite-deprecated note (HIGH)

---
*Architecture research for: kodo TUI ↔ task-manager integration (v0.12)*
*Researched: 2026-06-11*
