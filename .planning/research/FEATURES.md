# Feature Research

**Domain:** Terminal dashboard (ink/react TUI) for a provider-agnostic CLI bridging task managers (Plane CE, GitHub Issues) and Claude Code sessions via cmux — milestone v0.12 "Atajos al gestor y progreso vivo"
**Researched:** 2026-06-11
**Confidence:** HIGH for Open-in-manager (GitHub `html_url` and Plane web-URL shapes verified against official docs + source PR); MEDIUM-LOW for Live-progress (capture surface is fluid; Task tools bypass hooks — verified — making it genuinely spike-gated)

---

## Scope Framing (read first)

This milestone adds **two independent capabilities** to an existing, mature TUI. They are NOT equal in certainty:

1. **Open-in-manager** — *core, ships regardless.* Outward link: one keypress on a session row → opens the task's URL in the system browser. Mechanically a clone of the existing `focus.js` pattern (`execFile` fire-and-forget, never unmount). LOW technical risk. The only real research question is **what URL to persist**, answered below.
2. **Live progress display** — *spike-gated, may be cut.* Inward view: render the running session's live task/todo progress (`3/7 steps`). The research below shows the capture surface is **unstable and partially hook-blind**, which is exactly why a hard spike gate is correct. Do not commit UI to this until the spike returns VIABLE.

The downstream requirements step should treat these as two separately-shippable units. Open-in-manager carries the milestone; live-progress is upside.

---

## Part 1 — Open-in-manager

### Verified URL facts (the load-bearing research)

**GitHub Issues — use `html_url`. CONFIRMED.**
- The Issues REST API response object includes an `html_url` field, typed `required, string, format: uri`, whose value is the browser-facing URL to the issue — e.g. `https://github.com/octocat/Hello-World/issues/1347`. (GitHub REST docs, [issues endpoints](https://docs.github.com/en/rest/issues/issues).)
- GitHub's own [best-practices guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) is explicit: **do not construct or parse these URLs yourself — use the `html_url` the API returns.** This is a direct mandate to persist `html_url` rather than rebuild `github.com/{owner}/{repo}/issues/{number}` by hand.
- **Implication for kodo:** `normalizeIssue` (`src/providers/github/normalize.js`) already receives the raw issue object. Persist `issue.html_url` straight into the canonical `task_url` field. Zero construction, zero parsing. Confidence: HIGH.

**Plane (self-hosted Community Edition) — construct `/{workspace_slug}/browse/{project_identifier}-{sequence_id}`. CONFIRMED via source.**
- Plane is open source. PR [makeplane/plane#6546](https://github.com/makeplane/plane/pull/6546) ("feat: url pattern") introduced a centralized `generateWorkItemLink` helper and a **new canonical work-item URL**:
  - **New (preferred):** `/{workspace_slug}/browse/{project_identifier}-{sequence_id}` — e.g. `https://plane.example.com/my-team/browse/PROJ-42`. Human-readable, shareable.
  - **Old (still works — redirects to new):** `/{workspace_slug}/projects/{project_id}/issues/{issue_id}` — UUID-based.
- `workspace_slug` is confirmed as the slug in the URL (e.g. `my-team` in `https://app.plane.so/my-team/projects/`) per [Plane workspaces docs](https://docs.plane.so/core-concepts/workspaces/overview). `sequence_id` is the per-project sequential identifier exposed in the API; `project_identifier` is the project's display code (e.g. `PROJ`).
- **Implication for kodo:** the Plane normalizer must persist enough to build the URL. Two strategies, in priority order:
  1. **Preferred:** persist the new short form `{web_base}/{workspace_slug}/browse/{project_identifier}-{sequence_id}`. Requires the normalizer to have `project_identifier` + `sequence_id` (both present in Plane work-item API responses) + the configured **web base host** (distinct from the API base; self-hosted instances differ — must come from config, not hardcoded).
  2. **Fallback:** the old UUID form `{web_base}/{workspace_slug}/projects/{project_id}/issues/{issue_id}` redirects correctly and needs only fields kodo already has (`project_id`, `issue_id`). Safe if `project_identifier`/`sequence_id` aren't readily on the normalized item.
- **IN-REPO VERIFICATION REQUIRED:** confirm (a) the Plane work-item payload kodo fetches actually carries `project_identifier` and `sequence_id`, and (b) kodo config has a **web base URL** separate from the API base URL. The dashboard already surfaces a Plane `sequence_id`-style identifier (the `task` column work in v0.10), so the data likely exists, but verify before choosing strategy 1 vs 2. Confidence: HIGH on the URL shape, MEDIUM on field availability pending repo check.

### Feature Landscape — Open-in-manager

#### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One key on a row → open task URL in default browser | The whole point of the feature; CLI tools that link out (lazygit, `gh`, `dash`) all bind a single key to "open in browser" | LOW | Clone `focus.js`: `execFile('open', [url])` (macOS-only is fine — runtime constraint is macOS+cmux), fire-and-forget, never unmount the panel. Guard: row must have a non-empty `task_url`. |
| `task_url` persisted on `SessionRecord` at launch | Reading a persisted field keeps the "zero new endpoints" invariant — the URL is read like `focus.js` reads `workspace_ref` | LOW | Each normalizer supplies it: GitHub `html_url` verbatim; Plane constructed. Persist PRE-spawn like `worktree_path` already is, so the trace survives spawn failure. |
| Honest footer error when URL is missing/unopenable | Sessions launched before the field existed, or providers without a URL, must degrade gracefully — never crash the TUI | LOW | Footer message ("no task URL for this session" / ENOENT on `open`), panel stays mounted. Mirrors the `focus.js` ENOENT/exit≠0 footer pattern exactly. |

#### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Copy-URL-to-clipboard fallback | When `open` isn't available (SSH, headless) or the user wants to paste elsewhere; a second key (e.g. `y`) copies the URL | LOW-MEDIUM | macOS `pbcopy` via `execFile` is trivial and dependency-free. Avoid cross-platform clipboard libs (OSC 52 etc.) — out of scope for a macOS personal tool. Genuinely useful, low cost. Recommend as the *one* differentiator worth keeping on the radar. |
| Show the URL in a row/overlay before opening | Lets the user confirm where they'll land; could live in an existing overlay (`c`/`l`/`p` family) | LOW | Cheap if folded into an existing overlay; a standalone overlay just for this would be gold-plating. |

#### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Disambiguation UI when one session maps to "multiple URLs" | Sounds thorough | A kodo session is 1:1 with a `task_id` → exactly one task → one URL. There is no real multi-URL case. Building a picker invents complexity for a scenario that can't occur. | Persist exactly one `task_url`. If a future provider truly had multiple, revisit then. |
| Construct GitHub URLs by hand from owner/repo/number | "We already have the parts" | GitHub explicitly tells you not to — `html_url` is authoritative and future-proof; hand-built URLs break on enterprise/custom hosts | Persist `html_url` verbatim. |
| Hardcode the Plane web host (or reuse the API base URL as the web base) | "It's my instance, I know the host" | Self-hosted Plane web host ≠ API host in general; hardcoding breaks portability and the provider-agnostic promise | Read web base from config; construct the path from `workspace_slug`/`project_identifier`/`sequence_id`. |
| Cross-platform browser opening (xdg-open/start branches) | "Be portable" | Runtime is explicitly macOS+cmux (PROJECT.md constraint); branching adds untested code paths for no current user | `open` only; document the constraint. |
| In-TUI embedded web view / preview | "Don't leave the terminal" | Massive complexity, no value for a personal tool; the browser is the right surface for a web app | Hand off to the system browser. |

---

## Part 2 — Live progress display (SPIKE-GATED)

### Verified capture-surface facts (why this is genuinely uncertain)

**Where live progress lives — and the moving target.**
- Claude Code surfaces multi-step progress via todos. Each legacy item has shape `{ content, status, activeForm }` where `status ∈ {pending, in_progress, completed}`. The canonical "good" render is **`completed/total` + currently-in-progress item(s)** with per-item icons (✅/🔧/❌) — exactly the format in Anthropic's own docs ([Todo Lists / Agent SDK](https://code.claude.com/docs/en/agent-sdk/todo-tracking)).
- **The tool changed.** As of **Claude Code v2.1.142 / TS Agent SDK 0.3.142**, sessions use structured **`TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet`** tools instead of the single `TodoWrite` call. `TaskCreate` adds one item (`{subject, description, activeForm?, metadata?}`); `TaskUpdate` patches one by `taskId` (`status ∈ {pending, in_progress, completed, deleted}`). The assigned task ID comes back in the `tool_result` (`{task: {id, subject}}`), not the input — so a monitor must accumulate a **map keyed by task ID** across calls, not replace a whole array. This directly confirms PROJECT.md's prior research note that "TodoWrite está deprecado."
- **The hook surface is partially blind. CONFIRMED.** The new Task tools **bypass PreToolUse/PostToolUse hooks** ([anthropics/claude-code#20243](https://github.com/anthropics/claude-code/issues/20243)). A PostToolUse hook on `TodoWrite` would only fire for **unmigrated/legacy** sessions (or those forced with `CLAUDE_CODE_ENABLE_TASKS=0`), **not** the current default. So the v0.11-style "inject an instruction + hook" approach that worked for the light-plan artifact **does not cleanly transfer** here.
- **The robust surface is the transcript JSONL.** Tool-use blocks are recorded in the session transcript (`~/.claude/projects/.../<session>.jsonl`), and **kodo already correlates the transcript via `transcript_path` captured in the `session.start` event** (v0.3 Phase 7, LOG-10). Parsing the transcript for `tool_use` blocks (`TaskCreate`/`TaskUpdate`, plus legacy `TodoWrite`) is the only capture path that survives both the tool migration and the hook bypass. This is the natural spike target.

**Net for the spike:** the question is not "does a hook exist" (the clean one largely doesn't anymore) but **"can kodo's zero-token server tail/parse the transcript JSONL to reconstruct live `completed/total` per session, reliably, across the TodoWrite→Task-tools transition?"** If the transcript reliably carries the blocks, VIABLE; if format drift / missing `tool_result` IDs / no-todos sessions dominate, INVIABLE.

### Feature Landscape — Live progress (conditional on spike = VIABLE)

#### Table Stakes (if shipped at all)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `completed/total` count per session row | This is the entire ask ("3/7 steps"); anything less isn't the feature | MEDIUM (capture) / LOW (render) | Render is trivial in the existing table (a column, like `task`/`status`). Cost is entirely in reliable capture from the transcript. |
| Honest "no progress data" degraded state | Many sessions have no todos (simple tasks, non-GSD, quick); pre-migration vs post-migration sessions differ | LOW | A neutral marker (e.g. `—`) exactly like the existing `provider_state` column's unsupported/`?`/crude trichotomy (v0.10 Phase 43). Reuse that no-color reason-state pattern. |
| Stale/unavailable marker when capture fails | Transcript unreadable, parse fails, format drift | LOW | Distinct degraded glyph (`?`) — never throw, never block the row. Same never-throws discipline as `fetchStatus`/overlays. |

#### Differentiators (almost all are over-engineering here — flagged)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Current-step text (`activeForm` of the in_progress item) in an overlay | "What is it doing right now" | MEDIUM | Reuse the existing overlay machinery (`c`/`l`/`p` family, snapshot-frozen, `Esc` preserves cursor). Defensible **only** if capture is already solved; otherwise skip. |
| Percent bar / sparkline | Pretty | LOW render / not worth it | A bar adds nothing over `3/7` in a dense table row. **Gold-plating** for a single-user tool. |
| Per-step checklist inline in the row | "See everything" | — | Breaks the one-row-per-session invariant; belongs in an overlay at most. |

#### Anti-Features (Live progress)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| New `/progress` server endpoint or websocket | "Stream it live" | Violates the hard "zero new endpoints" invariant; kodo's server consumes 0 tokens and must stay read-only ambient | Capture writes to a kodo-controlled file (mirror `~/.kodo/plans/<task_id>.md`); `GET /status` enriches the row by reading it, like `provider_state`. |
| Inject an instruction + PostToolUse hook to self-report todos | It worked for light plans in v0.11 | **Task tools bypass PostToolUse** (#20243); only catches legacy `TodoWrite`. Fragile across CC versions — the exact trap PROJECT.md already flags | Parse the transcript JSONL kodo already correlates via `transcript_path`. Decide empirically in the spike. |
| Polling the transcript every dashboard tick from the TUI | "Live!" | Re-parsing potentially large JSONL on every 2.5s poll, in the React layer, risks jank and breaks the pure-derive/never-throws layering | Capture/parse in the server's read-only enrichment lane (cache + TTL + fail-open, exactly like `provider-state.js`); TUI just renders the field. |
| Blocking the row / spinner while waiting for progress | "Show it's loading" | Any blocking violates never-throws + keep-last-good; a missing field must degrade silently | Keep-last-good + neutral `—`; never gate render on capture. |

### Required degraded / unavailable states (the spike may cut the feature entirely)

Because the feature is gated, the requirements MUST specify behavior for **feature-absent** and **data-absent** independently:

1. **Spike = INVIABLE → feature cut.** Dashboard ships **identical to today** for progress. No empty column, no placeholder, no dead code referencing a progress field. The Open-in-manager half ships alone. This must be a clean no-op, not a half-wired stub.
2. **Spike = VIABLE but a given session has no todos.** Neutral `—` (reuse `provider_state`'s unsupported reason-state). Common case — must look intentional, not broken.
3. **Capture transiently fails (parse error, transcript missing/locked).** `?` glyph, keep-last-good if a prior value exists, never-throws.
4. **Pre-migration session (legacy `TodoWrite`) vs Task-tools session.** Capture must tolerate **both** block shapes or the column lies for one cohort. The spike must exercise both; if only one is feasible, requirements should scope to the current default (Task tools) and degrade the other to `—`.

---

## Feature Dependencies

```
Open-in-manager (open key)
    └──requires──> task_url persisted on SessionRecord at launch
                       └──requires──> each normalizer supplies it
                                          ├── GitHub: html_url (verbatim)          [HIGH confidence]
                                          └── Plane:  {web_base}/{slug}/browse/{ident}-{seq}
                                                          └──requires──> web_base in config + ident/seq on item  [VERIFY IN REPO]
    └──reuses──> focus.js execFile fire-and-forget pattern (no unmount)
    └──honors──> "zero new endpoints" (reads a persisted field, like focus.js)
    └──honors──> TaskProvider FROZEN at 9 (URL as a TaskItem field OR a typeof-detected
                 optional method — mirror getTaskState, NOT method #10)

Copy-URL-to-clipboard  ──enhances──> Open-in-manager   (pbcopy via execFile; macOS only)

Live progress display (SPIKE-GATED)
    └──HARD-GATED-BY──> spike verdict VIABLE/INVIABLE (transcript-parse feasibility)
    └──requires──> transcript_path correlation (ALREADY EXISTS, v0.3 Phase 7 LOG-10)
    └──requires──> read-only enrichment lane in GET /status (mirror provider-state.js:
                   cache + TTL + dedup + Promise.allSettled fail-open)
    └──reuses──> provider_state column's no-color reason-state trichotomy (v0.10 Phase 43)
    └──reuses──> overlay machinery (c/l/p) IF a current-step overlay is added
    └──conflicts──> PostToolUse-hook capture approach (Task tools bypass hooks, #20243)
    └──honors──> "zero new endpoints", never-throws, identity selection by task_id
```

### Dependency Notes

- **Open-in-manager requires `task_url` persisted at launch:** keeps the zero-endpoints invariant — the TUI reads a field, the server adds nothing. Persist PRE-spawn (like `worktree_path`) so a failed spawn still leaves a usable URL in the trace.
- **The `TaskProvider` contract stays FROZEN at 9:** the URL rides as a `TaskItem` field (or a `typeof`-detected optional provider method, exactly mirroring how `getTaskState` was added outside the frozen 9 in v0.10). Do NOT add a 10th required method.
- **Live progress depends on an EXISTING asset, not a new one:** `transcript_path` correlation already exists. The spike leverages it; it does not need new instrumentation inside Claude Code.
- **Live progress CONFLICTS with the hook-based capture instinct:** the v0.11 "inject instruction + hook" playbook fails here because Task tools bypass PostToolUse. The spike must validate transcript parsing instead.
- **Both features reuse the `provider_state` rendering precedent:** a dedicated, no-color column with a small set of honest reason-states. This is the lowest-risk render path and already proven in v0.10.

---

## MVP Definition

### Launch With (this milestone, ships regardless of spike)

- [ ] **Open-in-manager keypress** — the milestone's core promise; LOW risk; clone of `focus.js`.
- [ ] **`task_url` persisted on `SessionRecord`** via both normalizers (GitHub `html_url`; Plane constructed) — prerequisite for the above.
- [ ] **Missing-URL degraded footer** — honest, never-throws; required for old/no-URL sessions.
- [ ] **Backfill Nyquist v0.11** (Phases 44/45/46 `VALIDATION.md` → `nyquist_compliant: true`) — inherited debt, doc-only Tier 1, mirror of Phase 47. Independent of both features.

### Add If Spike Returns VIABLE

- [ ] **`completed/total` per-session column** — the live-progress core; render is cheap, capture is the gated work.
- [ ] **No-todos `—` and capture-failed `?` degraded states** — reuse `provider_state` trichotomy; mandatory if the column exists.

### Defer / Reconsider Only Later (v0.13+)

- [ ] **Copy-URL-to-clipboard (`pbcopy`)** — cheap and useful, but not required for the core promise; add if the open-only flow proves limiting. (The one differentiator worth keeping on the radar.)
- [ ] **Current-step overlay (`activeForm`)** — only if capture is solidly solved and an overlay key is free; otherwise gold-plating.
- [ ] **Percent bar / sparkline / inline checklist** — gold-plating for a single-user tool; explicitly out.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Open-in-manager keypress | HIGH | LOW | P1 |
| `task_url` persisted (both normalizers) | HIGH | LOW | P1 |
| Missing-URL degraded footer | MEDIUM | LOW | P1 |
| Backfill Nyquist v0.11 | MEDIUM (debt) | LOW | P1 |
| Live-progress spike (verdict) | HIGH (de-risks) | MEDIUM | P1 (gate) |
| `completed/total` column | HIGH | MEDIUM | P2 (gated) |
| Progress degraded states (`—`/`?`) | MEDIUM | LOW | P2 (gated) |
| Copy-URL-to-clipboard | MEDIUM | LOW | P3 |
| Current-step overlay | LOW-MEDIUM | MEDIUM | P3 |
| Percent bar / sparkline | LOW | LOW | P3 (avoid) |

**Priority key:** P1 = must-have this milestone · P2 = ship iff spike VIABLE · P3 = defer / likely never for a personal tool.

---

## Competitor Feature Analysis

| Feature | lazygit / gh / dash (CLI link-out) | Claude Code Agent View (native progress) | kodo's Approach |
|---------|-----------------------------------|------------------------------------------|-----------------|
| Open item in browser | Single key → `open`/`xdg-open`, no picker | n/a | Single key → `open` via `execFile`, macOS-only, reads persisted `task_url` |
| URL source | Construct or use API-provided URL | n/a | GitHub: `html_url` verbatim (per GitHub guidance); Plane: constructed `/browse/{ident}-{seq}` |
| Copy to clipboard | Common secondary key | n/a | Optional `pbcopy` differentiator (P3) |
| Live step progress | n/a | `completed/total` + per-tool granular status, ✅/🔧/❌, current `activeForm` | If VIABLE: `completed/total` column from transcript parse; current-step overlay optional |
| Capture mechanism | n/a | In-process SDK message stream / native UI | Out-of-process transcript JSONL parse (kodo runs 0-token; can't tap the SDK stream) |

**Key asymmetry:** the native Agent View gets progress from inside the SDK message loop. kodo deliberately runs zero-token and out-of-process, so it can only reconstruct progress from the **transcript on disk** — which is precisely why this half is a spike and not a given.

---

## Sources

- GitHub REST API — Issues endpoints (`html_url`, `format: uri`): https://docs.github.com/en/rest/issues/issues — HIGH
- GitHub REST API — Best practices ("do not parse/construct URLs; use the returned `html_url`"): https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api — HIGH
- Plane PR #6546 — `generateWorkItemLink` + new `/{workspace_slug}/browse/{project_identifier}-{sequence_id}` URL pattern (old `/{slug}/projects/{project_id}/issues/{issue_id}` redirects): https://github.com/makeplane/plane/pull/6546 — HIGH
- Plane docs — workspace slug in URL: https://docs.plane.so/core-concepts/workspaces/overview — HIGH
- Plane API — work item fields (`sequence_id`, `project_id`): https://developers.plane.so/api-reference/issue/get-issue-detail — MEDIUM
- Claude Code / Agent SDK — Todo Lists & Task tools (`completed/total`, `{content,status,activeForm}`, TodoWrite → TaskCreate/TaskUpdate migration, v2.1.142): https://code.claude.com/docs/en/agent-sdk/todo-tracking — HIGH
- Claude Code issue #20243 — Task* tools bypass PreToolUse/PostToolUse hooks: https://github.com/anthropics/claude-code/issues/20243 — MEDIUM
- Claude Code Hooks reference — PostToolUse input (`transcript_path`, `tool_name`, `tool_input`, `tool_response`): https://code.claude.com/docs/en/hooks — HIGH
- kodo `.planning/PROJECT.md` — project context, invariants, existing features (HIGH)

---
*Feature research for: kodo v0.12 — terminal dashboard outward-link + inward live-progress*
*Researched: 2026-06-11*
