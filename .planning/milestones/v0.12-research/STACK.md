# Stack Research

**Domain:** Node.js CLI/TUI — milestone v0.12 "Atajos al gestor y progreso vivo" (kodo)
**Researched:** 2026-06-11
**Confidence:** HIGH (open-in-manager) · MEDIUM (live task-state — successor mechanism is documented and stable; the exact on-disk file schema is NOT, which is the spike's job to pin down)

## Headline Verdict

**No new production dependencies are needed for either feature.** Both fit the existing
hard constraint (4 prod deps, no build step, no frameworks) using Node built-ins plus the
two patterns kodo already owns: `execFile` fire-and-forget (`focus.js`) and the
SessionStart hook script.

- **Open-in-manager (core):** `child_process.execFile('open', [url])` on macOS — a clean
  reuse of the `runFocus` shape in `src/cli/dashboard/focus.js`. **No `open` npm package.**
- **Live task-state (spike-gated):** TodoWrite has a documented, stable successor — the
  **Task tools** (`TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`) plus **two dedicated hook
  events** `TaskCreated` and `TaskCompleted`. A hook script (kodo's existing pattern) can
  capture this with Node built-ins only — **no new dep.** What is fragile is the exact JSON
  shape/path of the persisted task list, not the mechanism. That fragility is precisely what
  the spike must resolve.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `node:child_process` (`execFile`) | Node 20+ built-in | Launch `open <url>` for open-in-manager | Identical proven pattern to `focus.js` (`cmux select-workspace`). Fire-and-forget, ~tens of ms, no TTY capture, never-throws discriminated `{ok}` result. Zero deps. |
| Claude Code **Task tools** | Claude Code **v2.1.142** / TS Agent SDK **0.3.142** (default since v2.1.142; Tasks introduced ~v2.1.16, Jan 22 2026) | The documented successor to `TodoWrite` for live session progress | `TaskCreate`/`TaskUpdate` are the new `tool_use` blocks; `TaskCreated`/`TaskCompleted` are first-class hook events. This is the surface to observe progress from. |
| Claude Code **`TaskCreated` / `TaskCompleted` hooks** | Claude Code v2.1.x hook surface | Capture live task progress via a kodo hook script | First-class lifecycle events (no matcher needed — "always fire on every occurrence"). Hook script reads stdin JSON, writes a kodo-controlled file — **exactly** the v0.11 light-plan pattern (`~/.kodo/plans/<task_id>.md`). Zero deps. |
| `node:fs` | Node 20+ built-in | Persist captured task-state to a kodo-controlled path | Mirrors v0.11: producer (hook) writes, consumer (TUI overlay/column) reads byte-identical path. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | — | — | **Deliberately empty.** Both features ship on built-ins. Adding a lib here would violate the milestone's invariants and the 4-dep ceiling. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Existing `node:test` runner | Test the new hook script + `runOpen` helper with injected `exec`/fake fs | Same DI-with-fakes approach as `focus.js` (`exec` injected, no default — structural leak guard) and `session-start.js`. |

## Installation

```bash
# Core — NOTHING. Both features use Node built-ins + existing patterns.
# (No `npm install`. The 4 prod deps stay: commander, picocolors, ink, react.)
```

---

## Feature 1 — Open-in-manager: integration detail

**Recommendation: `execFile('open', [url])`, no new dependency. HIGH confidence.**

The reference machine is macOS, where `open <url>` launches the URL in the default browser
and returns immediately. This is the same class of call as `cmux select-workspace`: a short,
fire-and-forget external process invoked from the TUI on a keypress. The cleanest
implementation is a near-clone of `runFocus`:

- New helper (e.g. `src/cli/dashboard/open-url.js#runOpen({ exec, url })`) returning the
  same never-throws discriminated `{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}`.
- `exec` injected (no default) — structural leak guard, identical to `focus.js`.
- Args **literal-fixed**: `execFile('open', [url], {timeout})` (or `'/usr/bin/open'`). Pass the
  URL as an **arg, not via a shell** — never `exec` with string concatenation (avoids
  shell-injection of a provider-supplied URL).
- Color isolation holds automatically: the file lives under `src/cli/dashboard/**`, imports
  only `node:*`, so `test/format-isolation.test.js`'s walker covers it for free.
- TUI: new keypress (mode-gated `list`), guard that `task_url` is present; on a missing URL
  show a footer message (never throw, never unmount), mirroring the `alive===false` guard on
  Enter.

**Why no `open` npm package** (sindresorhus/open): it exists and is the popular cross-platform
choice (`open` on macOS, `start` on Windows, `xdg-open` on Linux), but kodo already targets
macOS-only at runtime and already has a **"refuse-with-guidance" Windows guard pattern**
(used by polling). The package buys nothing kodo can't express in ~5 lines of the `focus.js`
shape, and it would be the 5th prod dep against an explicit minimal-deps constraint. Reuse the
existing pattern instead.

**Cross-platform note (for the roadmapper, not a blocker):** if multi-OS is ever wanted, the
mapping is `open` (macOS) / `start` (Windows, needs the empty-title quirk `start "" <url>`) /
`xdg-open` (Linux). The cheapest forward-compatible move is a tiny `urlOpener(platform)` that
returns the binary+args triple — still no dep. For v0.12, macOS `open` + the existing Windows
refuse-with-guidance guard is sufficient and consistent with prior milestones.

**Where `task_url` comes from (already decided in PROJECT.md, restated for stack completeness):**
persisted on `SessionRecord` at launch, provided by each normalizer — GitHub `html_url`
(already on the issue payload); Plane constructed from web host + workspace + project + issue
slug. The TUI reads it like `focus.js` reads `workspace_ref` — no new endpoint.

---

## Feature 2 — Live task-state capture: the spike-gating findings

**Verdict for the spike: the successor mechanism is REAL and DOCUMENTED. v0.11's research
("TodoWrite deprecated; transcript/`~/.claude/plans/` fragile") is now partially superseded —
there is a sanctioned replacement with first-class hooks. MEDIUM confidence overall because
the *capture surface* is solid but the *exact persisted file schema* is not yet pinned.**

### What replaced TodoWrite (HIGH confidence — official docs)

`TodoWrite` was superseded by the **Task tools**, default since **Claude Code v2.1.142 /
TypeScript Agent SDK 0.3.142** (the Tasks system was introduced around v2.1.16, ~Jan 22 2026).

| Old (`TodoWrite`) | New (Task tools) |
|---|---|
| One tool call rewrites the whole `todos` array | `TaskCreate` adds one item; `TaskUpdate` patches one by `taskId` |
| Item: `{ content, status, activeForm }` | `TaskCreate` input `{ subject, description, activeForm?, metadata? }`; `TaskUpdate` input `{ taskId, status?, subject?, ... }`. `status ∈ {pending, in_progress, completed}` (`deleted` to remove) |
| Ephemeral, in context window | **Persisted to `~/.claude/tasks/`**, survives across sessions |

`TodoWrite` still exists but is deprecated; `CLAUDE_CODE_ENABLE_TASKS=0` reverts to old
behavior. **kodo must NOT rely on `TodoWrite`** going forward.

### The capture surfaces available to a hook (ranked by robustness)

There are **three** candidate surfaces. The spike should evaluate them in this order:

1. **`TaskCreated` / `TaskCompleted` hook events** *(most promising — first-class, no SDK).*
   These are dedicated lifecycle events (NOT `PostToolUse` matchers — they "don't support
   matchers and always fire on every occurrence"). Reported payload (MEDIUM confidence —
   community-documented; the official hooks page lists the events but does not yet publish the
   full field schema): standard common fields (`session_id`, `transcript_path`, `cwd`,
   `hook_event_name`) **plus** `task_id`, `task_subject`, and optionally `task_description`,
   `teammate_name`, `team_name`. A kodo hook script writes a running tally to
   `~/.kodo/progress/<task_id>.json` — **exactly the v0.11 producer pattern.** This is the
   spike's primary hypothesis to confirm: *do these events fire for normal interactive
   `claude --worktree` sessions (not just Agent-SDK `query()` runs)?* That is the single
   biggest unknown.
   - **Caveat the spike MUST check:** `TaskCreated`/`TaskCompleted` give create + complete,
     but **`in_progress` transitions go through `TaskUpdate`**, for which there is no dedicated
     event. To show "3/7 in progress" precisely you may also need surface (2) or (3).

2. **`PostToolUse` with matcher on the Task tools** *(catches every transition).*
   `PostToolUse` supports a `tool_name` matcher; matching `TaskCreate|TaskUpdate` captures
   *every* status change (including `in_progress`), with `tool_input`/`tool_response` in the
   stdin payload (`tool_response` for `TaskCreate` carries the assigned `{ task: { id, subject } }`).
   This is the richest stream but requires the hook to **accumulate state across calls**
   (map keyed by `taskId`), since each call is a delta, not a snapshot.
   - **Caveat:** the official hooks reference documents that matchers filter on `tool_name`,
     but does not explicitly enumerate `TaskCreate`/`TaskUpdate` as guaranteed-stable matcher
     values (those tool names come from the agent-SDK docs). The spike must confirm the matcher
     actually fires for these names in an interactive session.

3. **The persisted task files under `~/.claude/tasks/`** *(snapshot read, no hook stream).*
   Tasks persist to `~/.claude/tasks/` (with `~/.claude/tasks/<task-list-id>/` when
   `CLAUDE_CODE_TASK_LIST_ID` is set; **default is one list per session**). Fields confirmed
   to exist on a task: `id`, `subject`, `description`, `status`, `owner`, `blockedBy`,
   `blocks`. **The exact on-disk JSON file layout (one file per task? one list file? field
   names/casing?) is NOT officially documented** — community sources describe the location and
   logical fields but not a published schema. This is the **fragile** part and the reason this
   remains spike-gated rather than auto-greenlit.
   - **Critical correlation problem for the spike:** kodo keys everything by *task manager*
     `task_id` (Plane/GitHub). Claude's task-list id is per-session and **not** the kodo
     `task_id`. The spike must establish the join: most likely set `CLAUDE_CODE_TASK_LIST_ID`
     (or read `session_id`/`transcript_path` from the hook payload, already correlated in kodo
     via `session.start`'s `transcript_path`, see LOG-10) to bridge Claude's list to the kodo
     `task_id`. Surfaces (1)/(2) sidestep this because their hook payload already carries
     `session_id`, which kodo can map to its `task_id` from `state.json`.

### Recommended spike shape (no new dep either way)

- **Primary path:** a `PostToolUse` (matcher `TaskCreate|TaskUpdate`) **or** `TaskCreated`+
  `TaskCompleted` hook script (Node built-ins, reads stdin JSON, `fs.writeFile`s an aggregate
  `{done, total, in_progress, items[]}` to `~/.kodo/progress/<task_id>.json`). Consumer: the
  TUI reads it like the plan overlay reads `~/.kodo/plans/<task_id>.md` — **zero new endpoint,
  zero new dep.**
- **Correlation:** derive kodo `task_id` from the hook's `session_id` via existing `state.json`
  (kodo already correlates `session_id`↔`task_id`↔`transcript_path`). Do **not** depend on
  parsing `~/.claude/tasks/` paths unless surfaces (1)/(2) prove insufficient.
- **Spike exit criteria (VIABLE):** hook fires for a normal interactive `claude --worktree`
  session; payload is stable enough to compute "N/M done"; correlation to kodo `task_id` is
  deterministic. **INVIABLE if:** events only fire under the Agent SDK `query()` path (not
  interactive CLI), or the only reliable surface is the undocumented `~/.claude/tasks/` file
  shape that drifts between versions (the same fragility class v0.11 already rejected).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `execFile('open', [url])` (built-in) | `open` npm package (sindresorhus/open) | Only if kodo ever needs true first-class multi-OS browser launching AND drops the minimal-deps constraint. For macOS-only + existing Windows guard, not worth the 5th dep. |
| `TaskCreated`/`TaskCompleted` hook | `PostToolUse` matcher on `TaskCreate\|TaskUpdate` | Use `PostToolUse` if the spike needs `in_progress` transitions (the dedicated events only cover create+complete) or the richest delta stream. |
| Hook → `~/.kodo/progress/<task_id>.json` | Read `~/.claude/tasks/<list>/*.json` directly | Only if no hook surface fires interactively. Higher fragility (undocumented schema/path, per-version drift, correlation problem) — last resort. |
| Correlate by `session_id` from hook payload | `CLAUDE_CODE_TASK_LIST_ID=<kodo task_id>` at launch | Set the env var only if the file-read path (surface 3) is the one that proves viable, to force a deterministic list id matching the kodo `task_id`. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `open` / `opn` / `mac-open` npm packages | Violates 4-dep ceiling; `execFile('open', …)` is ~5 lines and matches the `focus.js` pattern already in the codebase | `node:child_process.execFile` |
| `TodoWrite` tool / `block.name === "TodoWrite"` | Deprecated; off by default since v2.1.142 (gated behind `CLAUDE_CODE_ENABLE_TASKS=0`). Building on it now builds on a sunset surface | Task tools (`TaskCreate`/`TaskUpdate`) + `TaskCreated`/`TaskCompleted` hooks |
| `~/.claude/plans/` or transcript JSONL parsing for progress | v0.11 already found these fragile/undocumented between versions; the new Task surface is purpose-built | `TaskCreated`/`TaskCompleted` hooks (or `PostToolUse` Task matcher) |
| `child_process.exec` with a shell string for the URL | Shell-injection risk on a provider-supplied URL; no benefit | `execFile` with URL as a literal arg |
| A new HTTP endpoint to expose progress | Violates the "zero new endpoints since v0.10" invariant | Producer hook writes a file; TUI reads it (mirror of v0.11 plan overlay) |
| Treating `~/.claude/tasks/` JSON schema as a stable contract | Not officially documented; reverse-engineered shape drifts between Claude Code versions | Prefer the hook-payload surfaces (1)/(2) whose fields are at least event-documented |

## Stack Patterns by Variant

**If the spike returns VIABLE (hook fires interactively, payload stable):**
- Add one hook script + one TUI consumer (column or overlay). Reuse the v0.11
  producer→consumer file pattern (`~/.kodo/progress/<task_id>.json`), correlate by `session_id`.
- No new dep, no new endpoint, no `TaskProvider` contract change (this is Claude-session
  state, orthogonal to the frozen-9 provider interface — though the optional `getTaskState`
  precedent exists if a provider-side mirror is ever wanted).

**If the spike returns INVIABLE (events SDK-only, or only the undocumented file works):**
- Ship open-in-manager + Nyquist backfill; defer live progress. Do NOT ship a fragile
  file-schema reader that breaks on the next Claude Code release — that repeats the exact
  mistake v0.11 consciously avoided.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Claude Code v2.1.142+ | Task tools default ON | `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`; `TodoWrite` deprecated. kodo's reference env must be on a 2.1.142+ build for the Task hooks to fire. |
| Claude Code v2.1.x hooks | `TaskCreated`, `TaskCompleted` events | Verify the installed CC version exposes these events (hook surface changes between minor versions — pin/check at spike time). |
| Node 20+ | `child_process.execFile`, `fs` | Built-ins; no version risk. |
| kodo 4 prod deps | unchanged | commander, picocolors@^1.1.1, ink@^6.8.0, react@^19.2.0 — this milestone adds none. |

## Sources

- https://code.claude.com/docs/en/agent-sdk/todo-tracking — **official.** TodoWrite → Task tools migration; tool names `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`; input schemas; default since CC v2.1.142 / SDK 0.3.142; `CLAUDE_CODE_ENABLE_TASKS=0` revert. HIGH confidence.
- https://code.claude.com/docs/en/hooks — **official.** Full hook event list incl. `TaskCreated`/`TaskCompleted` (no matcher, always fire, exit-2 rollback); `PostToolUse` matches on `tool_name`; common input fields (`session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`). HIGH on event existence; the per-event full field schema for `TaskCreated`/`TaskCompleted` is NOT published there (MEDIUM on exact fields).
- https://claudearchitect.com/docs/claude-code/claude-code-tasks-guide/ — tasks persisted to `~/.claude/tasks`; `CLAUDE_CODE_TASK_LIST_ID` controls list sharing (default per-session); task fields `id/subject/description/status/owner/blockedBy/blocks`. MEDIUM confidence (third-party).
- https://thepromptshelf.dev/blog/claude-code-hooks-complete-reference-2026/ + community hook references — `TaskCreated` payload reported as `task_id`, `task_subject`, optional `task_description`/`teammate_name`/`team_name`. MEDIUM/LOW confidence (community, unverified against official schema) — **flagged for the spike to verify empirically.**
- https://x.com/bcherny/status/2014485078815211652 — Anthropic (Boris Cherny) announcing "Todos => Tasks." Corroborates the upgrade direction. MEDIUM confidence.
- https://github.com/sindresorhus/open — the `open` npm package (macOS `open`/Win `start`/Linux `xdg-open`). Considered and **rejected** for kodo's dep constraint. HIGH confidence on what it does.
- Codebase: `src/cli/dashboard/focus.js` (read) — the exact `execFile` never-throws pattern open-in-manager should clone. `.planning/PROJECT.md` — invariants, 4-dep ceiling, v0.11 light-plan producer/consumer pattern, optional `getTaskState` precedent.

---
*Stack research for: Node.js CLI/TUI milestone v0.12 (open-in-manager + spike-gated live task-state)*
*Researched: 2026-06-11*
