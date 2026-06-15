# Feature Research

**Domain:** Developer tooling — "promote ad-hoc working session into tracked task" (reverse session → task flow)
**Researched:** 2026-06-15
**Confidence:** MEDIUM-HIGH (pattern well-established in dev tooling; one hard gate on cmux introspection has positive signal but needs a spike to confirm)

## Context for this milestone

kodo today does **tarea → sesión** (a task manager launches a Claude Code session via cmux). v0.13 adds the inverse: take an ad-hoc Claude Code session running in cmux (NOT born from a task) and **adopt** it into a persistent task in Plane/GitHub. This research maps the feature landscape for that "promote / save my work" capability so each piece becomes a scoped requirement.

The dominant real-world analogs are:
- **GitHub CLI** (`gh issue create`) — terminal → tracker, no built-in idempotency (caller must check first).
- **Linear Triage / Intake** — capture an inbox item, auto-derive a title from context, surface likely duplicates, then "accept" into the backlog.
- **Branch-per-issue** workflows — a unit of in-flight work gets a persistent tracker identity.

kodo's twist: the local source of truth (`state.json`) already maps sessions ↔ tasks, so **idempotency is a local lookup, not a remote search**. That is kodo's structural advantage over `gh issue create`.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = the adopt flow feels broken or unsafe.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Create task in provider** (`createTask`) | The whole point — "save my work" must produce a real tracked task | MEDIUM | OPTIONAL method, typeof-detected, OUTSIDE the 9 FROZEN methods (mirror of `getTaskState` in Phase 40). POST plumbing already exists (`plane/client.js` + `github/client.js` already POST for `addComment`). Plane first (operator's daily driver). |
| **Register adoption in `state.json`** (`adoptSession`) | Without this, the session stays invisible to the dashboard / orchestrator — adoption is meaningless | MEDIUM | Inverts the launch path: instead of task→session, write the new `task_id` + workspace into `state.json`. Deterministic, 0-token. Must persist enough to make the row a first-class citizen (`task_id`, `task_url`, `project_path`/`workspace_ref`). |
| **`kodo adopt` CLI** receiving explicit workspace/cwd | A deterministic entry point that does NOT depend on auto-detection ships regardless of the cmux spike verdict | LOW-MEDIUM | Core, ships first. Caller passes the workspace explicitly → no detection risk. This is the de-risked rail. |
| **Title (auto-derived, editable)** | Every promote-to-tracker flow lets you set a title; a blank/garbage title is worse than none | LOW | Default from `basename(workspace)`/cwd, editable. Editable is the table stake; *smart* derivation is the differentiator (below). |
| **Project/destination selection** | A task with no project lands nowhere; Plane/GitHub both require a destination | LOW | `listProjects` is ALREADY in the 9-method contract — reuse it directly. For GitHub the "project" is the repo (likely auto-detected from git remote, as the polling wizard already does). |
| **Idempotency / double-adopt guard** | Adopting twice would create duplicate tasks — the #1 failure mode of every terminal→tracker tool | LOW-MEDIUM | **kodo's advantage:** check `state.json` for an existing `task_id` bound to this workspace BEFORE calling `createTask`. If found → refuse/no-op with a clear message. This is a LOCAL lookup (cheap, deterministic), not a remote duplicate search like `gh`. Mirror the dismiss 3-layer guard discipline (TUI guard + a pre-create re-read of fresh state = TOCTOU re-check). **Flag explicitly as a hard requirement.** |
| **Sane initial status for the new task** | A promoted task should land in a state that reflects "work already in progress", not "untriaged backlog" | LOW | Recommend the task start as **in-progress / todo-equivalent**, not "done" and not buried in triage — the session is live work. Use the provider's existing state vocabulary (`updateTaskState` / `getTaskState` mapping from Phase 40 already normalizes `in_progress`). Confirm the exact default with the operator; in-progress is the defensible default. |
| **Optional description** | Lets the operator add context; expected as optional, never forced | LOW | Plain optional field at create time. Backfilling it from session activity is a differentiator (below). |
| **Clear success/failure feedback** | Adoption hits the network; the operator must know if the task was really created and get the URL/id back | LOW | Never-throws end-to-end (kodo house style). On success surface the new `task_id` + `task_url`; on failure, do NOT half-write `state.json` (atomicity — see Pitfalls dependency). |

### Differentiators (Competitive Advantage)

Features that set kodo apart. Not required to ship, but align with the Core Value ("the orchestrator is the only LLM rail; everything else is deterministic plumbing").

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dashboard keybinding (`a`) to adopt an ad-hoc row** | One-keystroke promote from the surface the operator already lives in; no context switch to type a CLI command | MEDIUM | **GATED by the cmux-detection spike (HARD GATE).** Requires discovering + listing ad-hoc sessions (a `claude` process in cmux absent from `state.json`). Positive signal: `cmux list-workspaces --json` and `cmux identify --json` exist and expose CWD/git branch per workspace (MEDIUM confidence, version-dependent). If the spike fails, this half defers and `kodo adopt` still ships. Mirror of the Phase 49 spike-gate discipline. |
| **Smart title derivation from real session context** | `basename(workspace)` is lossy; a title derived from cwd + recent commits + transcript is far more useful (Linear does exactly this for Slack→issue) | MEDIUM | The orchestrator (ONLY LLM rail) derives a SMART title from real context. It is a **consumer** of the same plumbing, never the owner. The deterministic default (`basename`) is the fallback when the orchestrator isn't in the loop. |
| **Orchestrator-assisted proactive adoption** | The orchestrator notices an ad-hoc session and *proposes* adopting it before it evaporates at sprint close — the original pain point | MEDIUM-HIGH | Mirrors Linear Triage's "proactively surface" behavior. Proposes, derives the SMART title, but the human/CLI/key still drives the actual create. Depends on the cmux detection surface (same gate as the keybinding). Build AFTER the deterministic core proves out. |
| **Description backfill from session activity** | Auto-populate the description from commits/diff/transcript so the task carries real provenance, not an empty shell | MEDIUM | Orchestrator-driven (LLM), optional, enhances the table-stake "optional description". Keep it additive — never block adoption on it. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but violate kodo's boundaries or create maintenance traps.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Full task CRUD (update/delete/close tasks)** | "If we can create, we should manage" | Explicit Out of Scope: "kodo no crea ni elimina tareas, solo las lee y actualiza". Adoption is a *narrow, deliberate* exception to the create-side; CRUD would balloon the FROZEN contract and the maintenance surface | Add ONLY `createTask` (optional, typeof-detected). Lifecycle continues via the existing `updateTaskState`. **kodo never deletes tasks.** |
| **Auto-adopt every ad-hoc session silently** | "Never lose work — capture everything automatically" | Spams the tracker with throwaway/exploratory sessions; creates noise tasks the operator must then clean up (and kodo can't delete them). Removes operator intent | Orchestrator *proposes*; human/CLI/key confirms. Adoption is always an explicit act. |
| **Listing ad-hoc sessions as rows in the main task table** | "Show everything in one place" | A session with no `task_id` / `provider_state` / plan is a second-class citizen in that table (already noted in the backlog). Pollutes the columnar model built across v0.9–v0.12 | Adopt via a CLI command or a dedicated key/action on a clearly-distinct surface — NOT a new section in the task table. |
| **New HTTP endpoint on the server for adoption** | "It's a write, the server owns writes" | "Cero endpoints nuevos" has held since v0.10; adoption can live entirely in CLI + a (gated) dashboard action calling the same `adoptSession` plumbing | Keep adoption in CLI + dashboard action over shared deterministic plumbing. Confirm in planning, but default to no new endpoint. |
| **Remote duplicate search before creating** (à la `gh`) | "Avoid creating a task that already exists in the tracker" | Slow, network-bound, fuzzy (title matching), and unnecessary — kodo already owns the authoritative local mapping | Check `state.json` for an existing `task_id` on this workspace. Local, exact, deterministic. |
| **Two-way sync / continuous reconciliation of adopted tasks** | "Keep the adopted task perfectly in sync forever" | Adoption is a one-time promotion event; ongoing sync is a separate, much larger concern and re-opens the CRUD can of worms | Adopt once → the session then flows through the existing lifecycle (`updateTaskState`, dismiss, doctor) like any kodo session. |

## Feature Dependencies

```
kodo adopt (CLI)
    └──requires──> createTask (optional provider method, Plane first)
    └──requires──> adoptSession (writes state.json with new task_id)
    └──requires──> listProjects (ALREADY in the 9-method contract)
    └──requires──> idempotency guard (state.json lookup, pre-create)

Dashboard keybinding `a` (adopt)
    └──requires──> kodo adopt plumbing (createTask + adoptSession)
    └──requires──> cmux ad-hoc session DETECTION  ◄── HARD GATE (spike)
                       (cmux list-workspaces --json / identify --json)

Orchestrator-assisted adoption
    └──requires──> kodo adopt plumbing (consumer, not owner)
    └──requires──> cmux detection surface (same gate)
    └──enhances──> smart title derivation (LLM, replaces basename default)
    └──enhances──> description backfill (LLM, optional)

Smart title derivation ──enhances──> Title (auto-derived, editable)
Description backfill   ──enhances──> Optional description

Auto-adopt-everything ──conflicts──> explicit-intent adoption (anti-feature)
```

### Dependency Notes

- **`kodo adopt` requires `createTask` + `adoptSession`:** these two form the deterministic 0-token base layer. Everything else (CLI, key, orchestrator) is a *consumer* of this base — "una fontanería, tres consumidores".
- **`listProjects` is already shipped (v0.2 contract):** no new contract work for destination selection — reuse directly. This de-risks project selection to LOW complexity.
- **Idempotency guard depends on `state.json` + `findSession`:** `findSession` already scans `state.sessions` + `state.history` (v0.8 Phase 30). The guard is a local lookup keyed on workspace/cwd, NOT a remote search. Must include a pre-create TOCTOU re-read (fresh `loadState()`), mirroring the dismiss 409 re-check discipline (v0.10 Phase 42).
- **Dashboard key + orchestrator both depend on the cmux detection gate:** if the spike says cmux can't enumerate ad-hoc `claude` processes by workspace/cwd, BOTH defer; the explicit-workspace CLI still ships. This is why the CLI must NOT depend on detection.
- **Atomicity dependency (cross-cutting):** `createTask` (remote) then `adoptSession` (local write) is a two-step. If the remote succeeds but the local write fails, you get an orphan task kodo doesn't know about — and kodo can't delete it. Order so the local write is the last, cheapest, near-failure-free step, and surface partial-failure clearly. (Detail belongs in PITFALLS, flagged here for the requirement.)

## MVP Definition

### Launch With (v0.13 core)

Minimum viable to validate "ad-hoc work doesn't evaporate".

- [ ] **`createTask` (optional, Plane)** — the create-side, one provider first. Essential — no task, no point.
- [ ] **`adoptSession` → `state.json`** — register the new `task_id`. Essential — makes the session a first-class kodo citizen.
- [ ] **`kodo adopt` CLI with explicit workspace** — deterministic, detection-free entry point. Essential and ships regardless of the spike.
- [ ] **Title (basename default, editable) + `listProjects` destination + optional description** — the minimal editable data set. Essential.
- [ ] **Idempotency / double-adopt guard via `state.json`** — Essential; prevents the #1 failure mode (duplicate tasks kodo can't delete).
- [ ] **Sane initial status (in-progress default) + success feedback with new task_id/URL** — Essential for trust.

### Add After Validation (v0.13 stretch / gated)

- [ ] **`createTask` for GitHub** — trigger: Plane path proven; mirror to the second adapter to re-validate the typeof-detected pattern cross-provider.
- [ ] **Dashboard keybinding `a`** — trigger: cmux-detection spike returns VIABLE.
- [ ] **Orchestrator-assisted proactive adoption + smart title** — trigger: detection surface available AND deterministic core shipped.

### Future Consideration (post-v0.13)

- [ ] **Description backfill from transcript/diff** — defer: LLM-driven, additive polish; validate that operators want it before building.
- [ ] **Adopt into ClickUp / local adapter** — defer: tied to those adapters existing at all (already deferred candidates).

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `createTask` (Plane, optional method) | HIGH | MEDIUM | P1 |
| `adoptSession` → state.json | HIGH | MEDIUM | P1 |
| `kodo adopt` CLI (explicit workspace) | HIGH | LOW-MEDIUM | P1 |
| Idempotency / double-adopt guard | HIGH | LOW-MEDIUM | P1 |
| Title (basename default, editable) | HIGH | LOW | P1 |
| Destination via `listProjects` | HIGH | LOW | P1 (reuses existing) |
| Sane initial status + success feedback | MEDIUM | LOW | P1 |
| Optional description (manual) | MEDIUM | LOW | P1 |
| `createTask` for GitHub | MEDIUM | MEDIUM | P2 |
| Dashboard keybinding `a` | MEDIUM | MEDIUM | P2 (gated) |
| Smart title derivation (orchestrator) | MEDIUM | MEDIUM | P2 (gated) |
| Orchestrator proactive adoption | MEDIUM | HIGH | P2 (gated) |
| Description backfill (LLM) | LOW-MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for the v0.13 core (the deterministic, detection-free rail)
- P2: Should have, add when the cmux gate opens / Plane path is proven
- P3: Nice to have, future polish

## Competitor / Analog Feature Analysis

| Feature | GitHub CLI (`gh`) | Linear Triage/Intake | kodo's Approach |
|---------|-------------------|----------------------|-----------------|
| Create task from terminal/session | `gh issue create` (manual fields) | Email/Slack → Triage inbox | `kodo adopt` + optional `createTask` per provider |
| Idempotency / dedupe | None built-in; caller must query first | LLM duplicate detection against existing issues | **Local `state.json` lookup** — exact, deterministic, cheap |
| Smart title | None (you type it) | AI-generated title from message context | Orchestrator (LLM) derives from cwd/commits/transcript; `basename` fallback |
| Proactive capture | None | Triage inbox surfaces incoming items | Orchestrator proposes adoption (gated) |
| Lifecycle after capture | Full issue CRUD | Full issue management | **Adopt only** — then existing `updateTaskState`/dismiss/doctor; kodo never deletes |

## Sources

- [GitHub CLI Tutorial: Manage PRs and Issues From Terminal](https://www.commandinline.com/github-cli-tutorial-prs-issues/) — terminal→tracker baseline, no built-in idempotency
- [Idempotent issue creation pattern (workspace-hub #1710)](https://github.com/vamseeachanta/workspace-hub/issues/1710) — check-before-create idempotency for issue creation
- [Implementing Idempotency Keys in REST APIs — Zuplo](https://zuplo.com/learning-center/implementing-idempotency-keys-in-rest-apis-a-complete-guide) — general idempotency discipline
- [Linear Triage Docs](https://linear.app/docs/triage) — capture/triage inbox, proactive surfacing
- [Linear Intake](https://linear.app/intake) — convert incoming items into tracked issues
- [Linear Changelog — auto-generated titles from context](https://linear.app/changelog) — smart title derivation precedent (Slack→issue)
- [cmux configuration docs](https://cmux.com/docs/configuration) — sidebar exposes live CWD, git branch, PR per workspace
- [cmux list-workspaces / identify --json (ck:cmux skill)](https://lobehub.com/skills/khanglvm-agent-tips-cmux) — JSON introspection commands exist (MEDIUM confidence, version-dependent — confirm in spike)
- [tmux persistent sessions](https://dev.to/sysemperor/tmux-persistent-terminal-sessions-for-developers-436d) — "session as a unit of work that survives" mental model

---
*Feature research for: reverse session → task adoption flow (kodo bidireccional)*
*Researched: 2026-06-15*
