# Stack Research

**Domain:** CLI bridge / task-manager ↔ Claude-Code-session orchestration (Node.js) — *reverse flow `sesión → tarea` (v0.13 kodo bidireccional)*
**Researched:** 2026-06-15
**Confidence:** HIGH (Plane + GitHub create endpoints verified against official docs; cmux detection surface verified empirically against the installed binary `cmux 0.x` at `/Applications/cmux.app/Contents/Resources/bin/cmux`)

## TL;DR — Default-No-New-Dependency holds

**No new runtime dependency is justified.** Every capability the milestone needs is already reachable with the four existing prod deps (`commander`, `picocolors`, `ink`, `react`) plus the built-in `node:child_process` / `fetch`. The three "unknowns" all resolved in favor of reuse:

| Capability | Verdict | Reuse point |
|------------|---------|-------------|
| `createTask` on Plane | POST to an endpoint the existing `PlaneClient.request()` already speaks | add one method to `src/providers/plane/client.js` |
| `createTask` on GitHub | POST to an endpoint the existing `GitHubClient.request()` already speaks | add one method to `src/providers/github/client.js` |
| Detect ad-hoc cmux `claude` sessions (cwd + process) | cmux already exposes `current_directory` per workspace **and** `resume_binding.kind === "claude"` + launch command + cwd per surface, all as `--json` | extend `src/host/cmux.js#listWorkspaces` (already runs `cmux list-workspaces --json`) |

The interesting work is **architectural** (the optional typeof-detected method, `adoptSession` writing `state.json`, the spike normalization), not dependency selection.

## Recommended Stack

### Core Technologies (all already present — no install)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 20+ (dev box on 22.22.3) | Runtime | Native `fetch`, `AbortSignal.timeout`, stable ESM — both clients already rely on these. No polyfill needed for POST. |
| `node:child_process` (`execFile`/`execFileSync`) | builtin | cmux IPC (enumerate workspaces/panes) | `src/host/cmux.js` is the **single authorized cmux caller** and already shells out with a 5s timeout + never-throws. Detection rides this exact path — no socket library, no new transport. |
| `fetch` (global) | builtin | Plane/GitHub `POST` create-task | Both `request()` methods already POST `addComment` with auth + 10s timeout + error mapping. `createTask` is the same transport with a different path/body. |
| `commander` | (existing) | `kodo adopt` CLI subcommand | Same registration pattern as every other `kodo` subcommand. |
| `ink` + `react` | `^6.8.0` / `^19.2.0` (existing, lazy-imported) | Dashboard keybinding to list/adopt ad-hoc sessions (gated by spike) | The TUI layer already renders rows + `useInput` mode-gating; the adopt key is one more gated action, not a new framework. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| — | — | — | **None.** Explicitly: do NOT add an HTTP client (`axios`/`got`/`octokit`), a cmux SDK, or a process-introspection lib (`ps-list`, `pidtree`). All three needs are already covered (see "What NOT to Use"). |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `node --test` (existing suite) | Contract + isolation tests | New `createTask` must be added to the cross-provider contract matrix (`test/providers/contract.test.js`) as a **capability-gated** assertion (mirror of how `getTaskState` is tested), NOT as a 10th mandatory method. |
| cmux binary (installed) | Empirical spike fixture source | Capture real `list-workspaces --json` + `list-panels --json` output as a test fixture (the host already DI-injects `run`, so fixtures drop straight in). |

## Installation

```bash
# Core
# (nothing — all runtime deps already in package.json)

# Supporting
# (nothing)

# Dev dependencies
# (nothing — node --test is builtin)
```

---

## Verified API Shapes

### 1. Plane CE — Create Work Item (`createTask`)

**Source:** https://developers.plane.so/api-reference/issue/add-issue (verified 2026-06-15) — confidence HIGH.

- **Method / Path:** `POST /api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/`
  *(Note the trailing slash — Plane is trailing-slash-strict, and `PlaneClient.request()` already composes `/api/v1/workspaces/{slug}` as its base, so the new method passes only `/projects/${projectId}/work-items/` — byte-identical to the existing `listWorkItems`/`createComment` paths.)*
- **Auth:** `X-API-Key: <key>` header — **already set on every `PlaneClient.request()`**. No new scope/token. The same key kodo uses today to read & PATCH work items can create them (Plane API keys are workspace-scoped, not capability-scoped).
- **Required body field:** `name` (string) — the only mandatory field.
- **Relevant optional fields:** `description_html` (formatted body — matches kodo's existing HTML rail for Plane comments), `priority`, `state` (a **state UUID**, not a label — must come from `listStates(projectId)`, which `PlaneClient` already has), `assignees`, `labels`, `external_id`/`external_source` (useful to stamp provenance, e.g. `kodo-adopt`).
- **Response (201):** JSON work item including **`id`** (UUID) and **`sequence_id`** (the human number, e.g. the `42` in `KL-42`). kodo needs both: `id` for API calls, and `project.identifier` + `sequence_id` to reconstruct the `KL-42` `task_id` it stores in `state.json` (mirror of `resolveIdentifier`, run in reverse).

**Integration into `src/providers/plane/client.js`** (sketch — ~6 lines, reuses `request`):
```js
async createWorkItem(projectId, { name, description_html, state, priority, labels }) {
  return this.request(`/projects/${projectId}/work-items/`, {
    method: 'POST',
    body: { name, description_html, state, priority, labels },
  });
}
```
Then `createTask` lives on the **provider** (`src/providers/plane/provider.js`), normalizing the 201 into a canonical `{ task_id, task_url }` — `task_url` from `plane.web_url ?? base_url` (the v0.12 Phase 48 fix already wired this).

**CE availability caveat (MEDIUM confidence):** The public docs target Plane Cloud; they don't explicitly state "CE supported." However, kodo's Plane adapter already runs against a self-hosted CE instance using this exact `/api/v1/workspaces/.../work-items/` surface for GET/PATCH/POST-comment, and the CE REST API is the same Django app. **Plan a 5-minute manual create against the real CE instance during the phase** to confirm the 201 + `sequence_id` shape (cheap, deterministic). This is the one residual risk and it's de-riskable in minutes.

### 2. GitHub — Create Issue (`createTask`)

**Source:** https://docs.github.com/en/rest/issues/issues#create-an-issue (REST API version `2022-11-28`, verified 2026-06-15) — confidence HIGH.

- **Method / Path:** `POST /repos/{owner}/{repo}/issues`
- **Auth:** Bearer/`token` PAT — **already set on every `GitHubClient.request()`** (`Authorization: token <pat>` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28`). **Required scope: `repo`** for classic PATs, or **Issues: Read & write** for fine-grained PATs. *Docs note: "Any user with pull access can create an issue."* The PAT kodo already uses to read + PATCH + comment on issues necessarily has write scope, so **no scope change** is needed.
- **Required body field:** `title` (string) — the only mandatory field.
- **Relevant optional fields:** `body` (**Markdown**, not HTML — diverges from Plane, matching the existing `addComment` Markdown/HTML split already documented in the client), `labels` (string[]), `assignees` (string[]), `milestone`.
- **Response (201):** raw issue payload with **`number`** (the issue number kodo uses as its `task_id` axis) and **`html_url`** (→ `task_url`).

**Integration into `src/providers/github/client.js`** (sketch — ~6 lines, reuses `request`):
```js
async createIssue(owner, repo, { title, body, labels, assignees }) {
  const o = encodeURIComponent(owner), r = encodeURIComponent(repo);
  return this.request(`/repos/${o}/${r}/issues`, {
    method: 'POST',
    body: { title, body, labels, assignees },
  });
}
```
The provider's `createTask` then normalizes via the existing `normalizeIssue` path.

### 3. cmux — Detect ad-hoc `claude` sessions (the HARD GATE)

**Source:** empirical inspection of the **installed** cmux binary, 2026-06-15 — confidence HIGH (this is the gold-standard verification: real output from the version kodo runs against).

**Verdict on the gate: VIABLE — strongly.** cmux exposes both axes the spike asks for (cwd + process identity), and kodo already calls the exact command needed.

**a) Workspace enumeration + cwd** — `cmux list-workspaces --json` (alias of `cmux workspace list`, the legacy form "keeps working indefinitely"). Real output per workspace includes:
- `ref` (e.g. `"workspace:1"`) — **positional/recyclable** (this is the v0.10 phantom-session bug source).
- `current_directory` (e.g. `"/Users/alex/dev/klab/kodo"`) — **the cwd, exactly what detection needs.**
- `title`, `index`, `latest_submitted_at`, `latest_conversation_message`, `selected`, `listening_ports`.
- With `--id-format both`: a stable **`id`** UUID (e.g. `"E74F2ED2-..."`) — **use this, not `ref`, for durable identity** (the recyclable-ref hazard is already documented in `src/host/cmux.js`).

**b) Per-workspace process identity ("is a `claude` running here?")** — `cmux list-panels --workspace <ref> --json` returns `surfaces[]`, and each surface carries a **`resume_binding`** object. For a Claude Code surface it is non-null with:
```json
"resume_binding": {
  "kind": "claude",
  "name": "Claude Code",
  "cwd": "/Users/alex/dev/klab/kodo",
  "command": "... claude --resume <checkpoint> --dangerously-skip-permissions ...",
  "source": "agent-hook", "auto_resume": true
}
```
`resume_binding.kind === "claude"` is the **reliable ad-hoc-claude signal** — no PID scraping, no `ps`. (`cmux rpc debug.terminals` additionally exposes `current_directory`, `git_branch`, `git_dirty`, and `tty` per terminal, but **no PID**; `resume_binding` is the cleaner, supported signal and should be preferred over `debug.*` which is explicitly a debug surface.)

**c) The "ad-hoc" predicate** = a workspace/surface where `resume_binding.kind === "claude"` **whose identity is absent from `state.json`**. kodo stores `workspace_ref` in `SessionRecord` (verified: `state.json` holds `"workspace_ref":"workspace:7"`). So detection = `{cmux claude surfaces}` minus `{state.json workspace_refs}`. **Caveat to flag for the roadmap:** because `state.json` keys on the recyclable `ref`, the set-difference should be hardened with `current_directory` and/or the stable workspace `id` UUID to avoid the same recycling false-positive that bit v0.10 (reconcile defensivo por identidad).

**d) Integration anchor — already exists.** `src/host/cmux.js#listWorkspaces` **already** runs `run(['list-workspaces','--json'])`, JSON-parses `.workspaces`, and normalizes to `WorkspaceInfo` (never-throws, 5s timeout, DI-injectable `run` for fixtures). The spike's detection layer is a **strict extension** of this proven helper:
1. Map the already-present `current_directory` (and `--id-format both` → `id`) into `WorkspaceInfo` (currently dropped).
2. Optionally fan out `cmux list-panels --workspace <ref> --json` to read `resume_binding.kind` (one extra `execFile` per workspace, same never-throws envelope).

No new cmux discovery, no socket library, no `--password`/auth surface change (the host already inherits the caller's socket).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Extend existing `PlaneClient.request()` / `GitHubClient.request()` | `@octokit/rest`, `axios`, `got` | Never for this milestone. Would duplicate auth/timeout/error-mapping/NDJSON-emission the clients already do, and break the LOG-12 isolation walker + color-isolation invariants. Only reconsider if kodo ever needs GraphQL (octokit) — not in scope. |
| `cmux list-workspaces`/`list-panels --json` via `execFile` | `cmux rpc <method>` (raw socket RPC) or `cmux events --json` (event stream) | `rpc`/`events` are viable for a *push* model (live ad-hoc-session notifications) in a future milestone. For v0.13's *pull* detection (CLI `kodo adopt` + a dashboard keypress), the `--json` list commands are simpler and already wired. |
| `resume_binding.kind` for claude detection | `cmux rpc debug.terminals` (tty/cwd/git) or external `ps`/`ps-list` | `debug.terminals` is a *debug* surface (unstable contract) and exposes no PID; `ps` would be a new cross-platform process-scan dependency. `resume_binding` is the supported, structured signal. |
| `name`-only Plane create + `state` from `listStates` | Forcing a default state client-side | If the operator wants the adopted task to land in a specific column (e.g. "In Progress"), resolve the state UUID via the existing `listStates(projectId)`; otherwise omit `state` and let Plane apply the project default. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@octokit/*` / `octokit` | ~Megabyte of transitive deps, its own auth/retry stack, breaks LOG-12 + color-isolation walkers, violates "minimal external deps" constraint | Existing `GitHubClient.createIssue` (one method, ~6 LOC) |
| `axios` / `got` / `node-fetch` | Native `fetch` already used everywhere; both clients already wrap it with timeout + retry (Plane) + error mapping (GitHub) | `this.request(..., { method: 'POST', body })` |
| `ps-list` / `pidtree` / spawning `ps` | Cross-platform process scanning is fragile and unnecessary — cmux already reports the running agent structurally | `cmux list-panels --json` → `resume_binding.kind === "claude"` |
| A cmux "SDK"/socket client lib | `src/host/cmux.js` is the single sanctioned cmux caller via `execFile`; adding a socket lib breaks that isolation (test `test/host/cmux-isolation.test.js`) | Extend `src/host/cmux.js#listWorkspaces` |
| Adding `createTask` to the 9 FROZEN `TASK_PROVIDER_METHODS` | Breaks the "FROZEN en 9" contract invariant and forces every (future) provider to implement creation | **OPTIONAL typeof-detected method**, capability-gated — exact mirror of how `getTaskState` was added in Phase 40 |
| A new HTTP endpoint on `src/server.js` for adopt | "Cero endpoints nuevos" invariant (held since v0.10); also reintroduces the XSS rail (WR-01) this milestone is meant to *harden* | Adoption lives in the CLI (`kodo adopt`) + a dashboard action calling the same deterministic 0-token plumbing |

## Stack Patterns by Variant

**If the adopt flow is invoked deterministically (CLI `kodo adopt`, dashboard key):**
- Use the base plumbing only: `provider.createTask()` (typeof-detected) → `adoptSession()` writes `SessionRecord` to `state.json` with the new `task_id`/`task_url`/`workspace_ref`.
- 0 tokens, no LLM. Title defaults to `basename(cwd)` or the cmux `title`, editable.

**If the adopt flow is orchestrator-assisted (the only LLM rail):**
- The orchestrator is a **consumer** of the same `createTask`/`adoptSession` base — it does NOT own a parallel path. It only enriches the `name`/`description_html` argument with a smart title derived from cwd/commits/transcript before calling the identical plumbing.

**If Plane vs GitHub:**
- Plane: `description_html` (HTML rail), `state` is a **UUID** from `listStates`, `task_id` = `${project.identifier}-${sequence_id}`.
- GitHub: `body` is **Markdown**, no state UUID (state = open/closed + label convention), `task_id` = issue `number`.
- This Markdown/HTML + identity divergence is **already encoded** in the existing `addComment`/`normalize` split — `createTask` follows the same seam.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| GitHub REST `2022-11-28` | existing `GitHubClient` headers | Client already pins `X-GitHub-Api-Version: 2022-11-28`; create-issue is GA on this version. |
| Plane API `/api/v1` | existing self-hosted CE instance | Same versioned surface kodo already reads/PATCHes. Confirm the create endpoint on the real CE box (5-min manual check) — only residual MEDIUM-confidence item. |
| cmux `list-workspaces`/`list-panels --json` + `resume_binding` | installed cmux build (dev box) | Verified live. `resume_binding.kind`/`list-panels` are not formally docs-pinned → capture a JSON fixture and assert via the host's DI `run` so a future cmux change fails loudly (same ASSUMPTION R-7 guard the host already uses for `notification.list`). |

## Sources

- https://developers.plane.so/api-reference/issue/add-issue — Plane create-work-item: `POST .../projects/{id}/work-items/`, `name` required, `X-API-Key`, 201 returns `id`+`sequence_id` (HIGH).
- https://developers.plane.so/api-reference/introduction — Plane API auth/base path confirmation (HIGH).
- https://docs.github.com/en/rest/issues/issues#create-an-issue (apiVersion 2022-11-28) — `POST /repos/{owner}/{repo}/issues`, `title` required, pull/`repo` write access (HIGH).
- Live `cmux list-workspaces --json`, `cmux --id-format both list-workspaces`, `cmux list-panels --json`, `cmux rpc debug.terminals`, `cmux capabilities` against `/Applications/cmux.app/.../bin/cmux` — `current_directory` + stable `id` UUID + `resume_binding.kind:"claude"` + launch command per surface (HIGH, empirical).
- `src/host/cmux.js`, `src/providers/plane/client.js`, `src/providers/github/client.js`, `~/.kodo/state.json` — existing reuse points: never-throws `execFile` cmux caller, generic authenticated `request()` POST plumbing, `workspace_ref` in `SessionRecord` (HIGH, source-read).

---
*Stack research for: CLI task-manager ↔ Claude-Code-session bridge — reverse flow (v0.13 kodo bidireccional)*
*Researched: 2026-06-15*
