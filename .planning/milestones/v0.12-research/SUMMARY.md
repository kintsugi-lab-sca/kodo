# Project Research Summary

**Project:** kodo — milestone v0.12 "Atajos al gestor y progreso vivo"
**Domain:** Node.js CLI/TUI (ink/react) — task-manager integration with Claude Code sessions
**Researched:** 2026-06-11
**Confidence:** HIGH (open-in-manager) · MEDIUM (live task-state spike)

---

## Executive Summary

kodo v0.12 adds two independent capabilities to an existing, production-quality TUI: (1) a keypress that opens the current task in the browser ("open-in-manager"), and (2) a live display of Claude session task-progress ("N/M steps done"). These are NOT equal in certainty and must be treated as separately-shippable units. Open-in-manager is the milestone's unconditional deliverable; live-progress is upside gated by a mandatory spike.

The most important research finding is that **open-in-manager is ~80–90% already built in shipped code.** All four research files converge on this: `TaskItem.url` is a canonical field in `src/interface.js`, both normalizers populate it (`issue.html_url` for GitHub; `${baseUrl}/${workspaceSlug}/browse/${ref}` for Plane), `manager.js:48` already persists `task_url` into `SessionRecord`, and `GET /status` already spreads it onto every dashboard row. The feature collapses to: add one `o` keypress handler, add one never-throws `open.js` module cloned from `focus.js`, and fix a latent Plane URL-host bug. No new stack additions, no new endpoints, no contract changes.

The live-progress half is genuinely uncertain and the researchers partially disagree on why — which is exactly the spike's job to resolve empirically. STACK research documents that `TaskCreated`/`TaskCompleted` dedicated hook events exist in Claude Code v2.1.x. FEATURES and PITFALLS research independently verified that the new `Task*` tools bypass `PostToolUse`/`PreToolUse` hooks entirely (anthropics/claude-code issue #20243), making the v0.11 "inject-instruction + hook" playbook non-transferable. The honest reconciliation: PostToolUse is bypassed for `Task*` tools, but dedicated `TaskCreated`/`TaskCompleted` events MAY still fire in interactive `claude --worktree` sessions — whether they do on the installed build is the spike's single load-bearing question. If not, the robust fallback is transcript JSONL parsing (already correlated via `transcript_path`, LOG-10). The roadmap's conditional half must never be depended upon; the default posture is INVIABLE.

---

## Key Findings

### Recommended Stack

No new production dependencies are needed for either feature. Both fit the existing hard constraint (4 prod deps, no build step) using Node built-ins plus two patterns kodo already owns.

**Core technologies:**
- `node:child_process.execFile` (built-in): browser launcher for open-in-manager — identical proven pattern to `focus.js`; fire-and-forget, never-throws, zero deps; never via shell string to avoid injection
- Claude Code `TaskCreated`/`TaskCompleted` hook events (CC v2.1.x): primary spike capture candidate — first-class lifecycle events that don't require matchers; payload carries `task_id`, `task_subject`, `session_id`; MEDIUM confidence on exact field schema
- `PostToolUse` matcher on `TaskCreate|TaskUpdate` (CC v2.1.x): secondary spike capture candidate — richest delta stream, catches `in_progress` transitions; accumulates state across calls by `taskId`
- `node:fs` (built-in): persist captured task-state to `~/.kodo/progress/<task_id>.json` — mirrors v0.11 light-plan producer/consumer seam exactly
- 4 prod deps unchanged: commander, picocolors, ink, react

**Critical version note:** the installed Claude Code build must be v2.1.142+ for `Task*` tools to be the default. The spike must run against the actual installed version, not docs.

### Expected Features

**Must have this milestone (ships regardless of spike):**
- `o` keypress on a session row opens `task_url` in default browser; guard on `mode === 'list'` only
- `task_url` persisted on `SessionRecord` at launch from both normalizers (already done — wire, don't rebuild)
- Honest footer error when `task_url` is missing/falsy (legacy rows from v0.9–v0.11)
- Fix latent Plane URL bug: optional `plane.web_url` config defaulting to `base_url`; treat `UNKNOWN-<seq>` identifier as "no URL" (footer), not a dead link
- URL security validation: `http:`/`https:` protocol allowlist before `execFile`, blocking `file://`, `javascript:`, leading-dash flag injection
- Backfill Nyquist v0.11 (Phases 44/45/46 VALIDATION.md → `nyquist_compliant: true`) — doc-only Tier 1, independent of both features

**Add only if spike returns VIABLE:**
- `completed/total` count column per session row (render is cheap; capture is the gated work)
- No-todos `—` and capture-failed `?` degraded states, reusing `provider_state` trichotomy
- Capture hook writing `~/.kodo/progress/<task_id>.json` via light-plan filesystem seam

**Defer to v0.13+:**
- Copy-URL-to-clipboard (`pbcopy` via `execFile`) — useful differentiator, not required for the core promise
- Current-step text overlay (`activeForm` of in-progress item)
- Percent bar, sparkline, inline checklist — gold-plating for a single-user tool

### Architecture Approach

All integration points for feature 1 are already wired end-to-end; the feature is a consumer addition, not a pipeline addition. Feature 2 follows the light-plan filesystem seam (producer hook → `~/.kodo/` file → TUI filesystem read), never an HTTP endpoint. Both features honor the three hard invariants: zero new endpoints since v0.10, `TASK_PROVIDER_METHODS` frozen at 9, and the never-throws/color-isolation TUI discipline.

**Major components touched (feature 1):**
1. `src/cli/dashboard/open.js` (NEW) — `runOpen({ exec, url })`, exact structural clone of `focus.js`; DI `exec` with no default (leak guard); never-throws discriminated result; http(s) allowlist validation before dispatch
2. `src/cli/dashboard/App.js` (MODIFY) — add `input === 'o'` branch in `mode === 'list'` block; read `row.task_url` off the already-polled row (no fetch, no overlay, no race guard); falsy URL shows footer message, never exec
3. `src/cli/dashboard/index.js` (MODIFY) — wire `onOpen` prop mirror of `onFocus` (line 136)
4. `src/providers/plane/normalize.js` (MODIFY) — route URL construction through `web_url` config, not `base_url`; `UNKNOWN-` identifier → no URL emitted

**Major components touched (feature 2, only if VIABLE):**
1. `hooks/<capture>.js` (NEW) — writes `~/.kodo/progress/<task_id>.json`; separate from HOOK-02 golden-bytes injection; fire-and-forget, never-throws, never breaks the session
2. `src/cli/dashboard/<state-reader>.js` (NEW) — pure never-throws filesystem read; anti-ReDoS `task_id` guard; mirrors `plan.js#readLightPlan`
3. `src/cli/dashboard/App.js` (MODIFY further) — render column cell or overlay

### Critical Pitfalls

1. **Re-building the URL pipeline that already exists** — `task_url` is already a field, persisted, and on the row. Any plan diff that adds a new normalizer `url:` line or a `getTaskUrl()` method is rebuilding. Treat feature 1 as a wiring + correctness audit; first task must be an explicit source audit before writing any new code.

2. **Plane URL built from the API base URL (dead on split web/API deploys)** — `normalize.js:76` reuses `baseUrl` (the API host) as the web host. Fix: add optional `plane.web_url` config defaulting to `base_url`. Additionally: `UNKNOWN-<seq>` identifier fallback at `normalize.js:107` emits a provably-dead link — treat as "no URL" instead.

3. **Launcher crashes the TUI or breaks alt-screen** — must clone `focus.js` verbatim: `execFile` (not `exec`/shell), DI `exec` with no default, never-throws discriminated return, short timeout, fire-and-forget (no TTY capture). Any plan that awaits the browser or unmounts the panel violates this.

4. **Shell/argument injection through a crafted URL** — `execFile([url])` removes the shell threat; the http(s) allowlist kills leading-dash flag injection (`-a Calculator`) and `file://`/`javascript:` protocol attacks. Both guards are required; tests must include an adversarial URL matrix.

5. **Shipping live-capture display before the spike verdict** — this is the highest-risk pitfall. PostToolUse does not fire for `Task*` tools (confirmed, issue #20243). INVIABLE is the current default expectation. A display phase built before the spike returns VIABLE is wasted work with sunk-cost pressure to ship something fragile.

---

## Implications for Roadmap

Based on combined research, four phases in strict order:

### Phase A: Open-in-manager core
**Rationale:** the URL data path is already built; this is purely a consumer addition. Lowest risk in the milestone. Closes by manual UAT (browser launch is not auto-verifiable, same as Phase 37 for `focus.js`). Ships unconditionally.
**Delivers:** `o` keypress opens task in browser; Plane URL bug fixed; legacy-row no-op with footer; security validation; full never-throws fault matrix tested
**Addresses:** P1 features (open keypress, `task_url` both normalizers, missing-URL footer, Plane `web_url` config)
**Avoids:** Pitfalls 0, 1, 2, 3, 4, 5
**Research flag:** NO — patterns are standard (`focus.js` clone, source already verified)

### Phase B: Live-progress spike (hard gate)
**Rationale:** must precede any display work. INVIABLE is the likely default per current source evidence (issue #20243). The spike must run against the actually-installed Claude Code build, not against docs. Produces a written VIABLE/INVIABLE verdict with empirical evidence.
**Delivers:** verdict + evidence for each capture surface in priority order:
  1. `TaskCreated`/`TaskCompleted` hook events in interactive `claude --worktree` sessions
  2. `PostToolUse` on `TaskCreate|TaskUpdate` (catches `in_progress` transitions)
  3. Transcript JSONL watcher (tolerant parse, existing `transcript_path` correlation, LOG-10)
  4. `~/.claude/tasks/` file read (last resort — fragile, undocumented schema)
**VIABLE criteria (ALL must hold):** capture surface demonstrably fires on installed CC version in interactive sessions; payload stable enough to produce "N/M done"; deterministic `task_id` correlation via `session_id` → `state.json`; no session latency or HOOK-02 golden-bytes breakage; kodo-controlled artifact (`~/.kodo/...`)
**INVIABLE criteria (ANY ONE suffices):** events only fire under Agent SDK `query()` not interactive CLI; only surface is undocumented `~/.claude/` file schema that churns between versions; reads produce partial/untolerable JSON; capture adds latency or can break sessions; no end-to-end demonstration within the timebox
**Research flag:** YES — this phase IS the research; empirical, version-specific, cannot be pre-researched from docs

### Phase C: Live-progress display (conditional — ONLY if Phase B = VIABLE)
**Rationale:** display is cheap (a column cell, proven `provider_state` pattern); the cost was entirely in capture, which the spike already solved. If spike is INVIABLE, this phase is cut entirely — no stub, no placeholder, no dead code.
**Delivers:** `completed/total` column per session row; `—` for no-todos; `?` for capture failures; both legacy `TodoWrite` and `Task*` shapes tolerated; capture hook writing `~/.kodo/progress/<task_id>.json`; filesystem-read consumer in TUI (light-plan mold, NOT `/status` enrichment)
**Avoids:** Pitfall 6; zero new endpoints invariant; HOOK-02 golden-bytes integrity
**Research flag:** NO if spike is VIABLE (patterns established by spike); N/A if INVIABLE

### Phase D: Nyquist v0.11 backfill
**Rationale:** independent doc-only Tier 1 debt (mirror of Phase 47). Zero dependencies on any other phase. Can run in parallel with Phase A if desired, or last.
**Delivers:** Phases 44/45/46 VALIDATION.md updated to `nyquist_compliant: true`, citation-based audit
**Research flag:** NO — pure documentation, standard pattern

### Phase Ordering Rationale

- Phase A before B: open-in-manager ships the milestone's core promise regardless of spike outcome. Starting here avoids spending the whole timebox on the spike and shipping nothing.
- Phase B before C: this is a hard gate, not a recommendation. Building display before knowing whether capture is viable repeats the exact mistake v0.11 research explicitly flagged.
- Phase D last (or parallel): pure doc debt, no code risk, no ordering constraint.
- The conditional half (Phase C) must be explicitly marked in the roadmap as "ships only if Phase B verdict = VIABLE." The roadmap must read cleanly with Phase C absent.

### Research Flags

Phases needing deeper research during planning:
- **Phase B (spike):** this phase IS the research — empirical, version-specific, cannot be pre-researched from docs. No prior research supersedes running it on the actual installed Claude Code binary.

Phases with standard patterns (skip research-phase):
- **Phase A:** patterns fully established — `focus.js` mold documented in source, URL data path verified in source, Plane URL fix is a straightforward config addition
- **Phase C:** patterns established by Phase B if VIABLE; light-plan mold and `provider_state` column pattern are both proven in v0.10–v0.11
- **Phase D:** pure documentation, Nyquist-compliant audit procedure already established in Phase 47

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (open-in-manager) · MEDIUM (live-capture) | Built-in `execFile` pattern verified in source. Hook event existence documented officially; exact payload schema for `TaskCreated`/`TaskCompleted` is community-reported, not officially published. |
| Features | HIGH (open-in-manager) · MEDIUM-LOW (live-progress) | GitHub `html_url` and Plane URL shape verified against official docs and source PRs. Live-capture surface confirmed partially hook-blind via primary GitHub issue. |
| Architecture | HIGH | Grounded entirely in actual `src/` reads. Every callsite (`manager.js:48`, `server.js:424`, `normalize.js:76`, `normalize.js:102`) verified in-repo. |
| Pitfalls | HIGH (open-in-manager) · MEDIUM-HIGH (live-capture) | Open-in-manager pitfalls verified against source. Live-capture hook bypass confirmed (issue #20243 HIGH); exact CC version numbers for the `Task*` default MEDIUM. |

**Overall confidence:** HIGH for the unconditional half. MEDIUM for the spike-gated half — the uncertainty is correctly isolated behind the spike gate and the roadmap's soundness does not depend on the conditional half shipping.

### Gaps to Address

- **Spike VIABLE/INVIABLE verdict:** the single most important unknown. Must be resolved empirically against the installed CC binary before any display work. The roadmap must remain coherent with the conditional half absent.
- **`TaskCreated`/`TaskCompleted` payload schema:** community-reported fields (`task_id`, `task_subject`, `session_id`) not yet officially published as a schema. The spike must pin these empirically before the capture hook is written.
- **`in_progress` transitions:** dedicated `TaskCreated`/`TaskCompleted` events cover create + complete but not `in_progress` transitions (which go through `TaskUpdate`). If "N/M in-progress" granularity is needed, `PostToolUse` on `TaskCreate|TaskUpdate` or transcript JSONL is required. The spike must characterize whether this matters for the "N/M done" display.
- **Plane `projectIdentifier` field availability:** `normalize.js:107` shows a real `UNKNOWN` fallback. Confirm whether the Plane work-item API response reliably carries `project_identifier` in the version kodo targets, or whether the UUID-form fallback URL is more reliable.
- **Legacy SessionRecord regression:** verify the `o` keypress graceful no-op and footer message on sessions from `state.json` predating `task_url`; add a regression test with an empty-`task_url` row before Phase A is marked complete.

---

## Sources

### Primary (HIGH confidence)
- kodo source (in-repo): `src/interface.js:20`, `src/providers/*/normalize.js`, `src/session/manager.js:48`, `src/session/state.js:23`, `src/server.js:206,272,424`, `src/cli/dashboard/focus.js`, `src/cli/dashboard/App.js`, `src/cli/dashboard/plan.js`
- https://code.claude.com/docs/en/agent-sdk/todo-tracking — official; TodoWrite → Task tools migration, schemas, default since CC v2.1.142
- https://code.claude.com/docs/en/hooks — official; `TaskCreated`/`TaskCompleted` (no matcher, always fire), `PostToolUse` `tool_name` matcher
- https://docs.github.com/en/rest/issues/issues — `html_url` required field, `format: uri`
- https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api — "do not construct URLs; use `html_url`"
- https://github.com/makeplane/plane/pull/6546 — `generateWorkItemLink`, canonical `/{slug}/browse/{ident}-{seq}` URL pattern
- https://github.com/anthropics/claude-code/issues/20243 — Task* tools bypass PreToolUse/PostToolUse hooks (load-bearing for spike gate)

### Secondary (MEDIUM confidence)
- https://developers.plane.so/api-reference/issue/get-issue-detail — Plane work-item fields (`sequence_id`, `project_id`)
- https://github.com/makeplane/plane/issues/2434 — web and API on separate URLs in self-hosting
- https://claudearchitect.com/docs/claude-code/claude-code-tasks-guide/ — tasks persisted to `~/.claude/tasks`; `CLAUDE_CODE_TASK_LIST_ID` behavior; task fields

### Tertiary (LOW confidence)
- https://thepromptshelf.dev/blog/claude-code-hooks-complete-reference-2026/ and community hook references — `TaskCreated` payload fields (`task_id`, `task_subject`, etc.) — flagged for spike to verify empirically
- https://x.com/bcherny/status/2014485078815211652 — Anthropic announcement of Todos → Tasks upgrade direction
- https://dev.to/prafulreddy/a-zero-token-progress-bar-for-claude-code-51bp — on-disk approach and TodoWrite dependency (shows the anti-pattern to avoid)

---
*Research completed: 2026-06-11*
*Ready for roadmap: yes*
