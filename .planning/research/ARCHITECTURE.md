# Architecture Research

**Domain:** kodo bidireccional — reverse flow `session → task` (adopt an ad-hoc cmux Claude session into a persistent provider task)
**Researched:** 2026-06-15
**Confidence:** HIGH (grounded in the actual source modules, not training data)

> Scope of this doc: ONLY how the NEW flow integrates with the existing kodo architecture. Every recommendation below is anchored to a real module/signature read from the repo. New-vs-modified is made explicit per component, and a build order honoring the spike HARD GATE and the "fontanería first, consumers after" layering closes the doc.

---

## Standard Architecture

### The core decision, mapped to real code

"Una fontanería, tres consumidores" means: a deterministic, 0-token base layer (`createTask` + `adoptSession`) that all three consumers call. The base is the inverse of the launch path that `launchWorkItem` already walks (`src/session/manager.js`): launch goes `getTask → newWorkspace → addSession`; adopt goes `createTask → adoptSession (write state.json)` — same plumbing, reversed direction.

```
┌────────────────────────────────────────────────────────────────────────┐
│                           THREE CONSUMERS                                │
│  ┌────────────────┐   ┌──────────────────────┐   ┌────────────────────┐ │
│  │ CLI `kodo      │   │ Dashboard keybinding │   │ Orchestrator       │ │
│  │ adopt` (det.)  │   │ (GATED by cmux spike)│   │ (the only LLM rail)│ │
│  │ src/cli/adopt  │   │ src/cli/dashboard/   │   │ skill + prompt.md  │ │
│  │ .js            │   │ adopt.js (TUI action)│   │ shells `kodo adopt`│ │
│  └───────┬────────┘   └──────────┬───────────┘   └─────────┬──────────┘ │
│          │  smart title          │ workspace+title         │ smart title │
│          │  (default)            │ from row                │ from context│
│          └──────────────┬────────┴─────────────────────────┘            │
│                         ▼                                                │
├─────────────────────────────────────────────────────────────────────────┤
│              THE FONTANERÍA  (deterministic, 0-token)                     │
│   src/adopt.js  →  adoptSession({ provider, providerName, projectId,     │
│                                   title, description?, workspaceRef,      │
│                                   cwd, sessionId? })                      │
│     1. provider.createTask({...})  →  raw provider payload               │
│     2. normalize → canonical TaskItem (reuse normalizeWorkItem/Issue)    │
│     3. addSession(task.id, buildSessionFromAdoption(...))  → state.json   │
│     returns { ok:true, task, session } | { ok:false, code, detail }      │
├─────────────────────────────────────────────────────────────────────────┤
│            OPTIONAL PROVIDER METHOD  (outside the FROZEN 9)               │
│   provider.createTask({ projectId, title, description })  →  raw payload  │
│     Plane:  POST /projects/{id}/work-items/  (client.createWorkItem)     │
│     GitHub: POST /repos/{o}/{r}/issues       (client.createIssue)        │
│   typeof-detected at the call site — EXACT mirror of getTaskState (Ph40) │
├─────────────────────────────────────────────────────────────────────────┤
│   EXISTING, UNTOUCHED:  registry (9-method validate) · client.request    │
│   POST plumbing · normalize.js · state.json single-writer-of-alive       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New / Modified | Real anchor |
|-----------|----------------|----------------|-------------|
| `src/adopt.js` (`adoptSession`) | The fontanería: orchestrate createTask → normalize → addSession; never-throws discriminated return | **NEW** | mirrors `manager.launchWorkItem` reversed |
| `provider.createTask` (Plane + GitHub) | Optional method: POST a new task, return raw payload | **NEW (additive, optional)** | mirror of `getTaskState` Phase 40 |
| `client.createWorkItem` / `client.createIssue` | Authenticated POST transport | **NEW (one method each)** | mirror of `createComment` / GitHub `addComment` |
| `buildSessionFromAdoption` | Pure: shape a `Session` record from an adopted task + workspace | **NEW (pure helper)** | mirror of `buildSessionFromTask` (manager.js:32) |
| `src/cli/adopt.js` + `program.command('adopt')` | Deterministic CLI consumer; explicit `--workspace`/`--cwd`/`--title`/`--project` | **NEW** | mirror of `launch <ref>` registration (cli.js:204) |
| `src/cli/dashboard/adopt.js` | TUI keybinding consumer; shells `kodo adopt` like focus shells cmux | **NEW (gated by spike)** | mirror of `focus.js` `runFocus` |
| Orchestrator skill / `prompt.md` | LLM consumer: proposes adoption, derives smart title, shells `kodo adopt` | **MODIFIED (skill prose)** | `.claude/skills/kodo-orchestrate/skill.md` |
| `registry.getProvider` | 9-method validation — UNCHANGED (createTask is NOT in the loop) | **UNCHANGED** | registry.js:107 |
| `TASK_PROVIDER_METHODS` | FROZEN at 9 — createTask is NOT added | **UNCHANGED** | interface.js:52 |

---

## Recommended Project Structure

```
src/
├── adopt.js                  # NEW — the fontanería. adoptSession() + buildSessionFromAdoption()
│                             #       (pure helper). Top-level, sibling of interface.js —
│                             #       it is provider-agnostic orchestration, not GSD, not a CLI.
├── interface.js              # UNCHANGED — TASK_PROVIDER_METHODS stays at 9. Add a JSDoc
│                             #             @typedef note documenting createTask as OPTIONAL
│                             #             (mirror of the getTaskState doc-comment).
├── providers/
│   ├── registry.js           # UNCHANGED — 9-method validate loop untouched.
│   ├── plane/
│   │   ├── client.js         # MODIFIED — add createWorkItem(projectId, {name, description_html})
│   │   ├── provider.js       # MODIFIED — add async createTask({projectId,title,description})
│   │   └── normalize.js      # UNCHANGED — reuse normalizeWorkItem for the created payload
│   └── github/
│       ├── client.js         # MODIFIED — add createIssue(owner, repo, {title, body})
│       ├── provider.js       # MODIFIED — add async createTask({projectId,title,description})
│       └── normalize.js      # UNCHANGED — reuse normalizeIssue
├── session/
│   ├── state.js              # UNCHANGED (additive read of fields only). adoptSession calls
│   │                         #            the EXISTING addSession(taskId, session).
│   ├── manager.js            # UNCHANGED — launchWorkItem untouched; buildSessionFromAdoption
│   │                         #            lives in adopt.js, not here (different direction).
│   └── reconcile.js          # UNCHANGED — see "single-writer-of-alive" below.
├── cli/
│   └── adopt.js              # NEW — runAdoptCli({ ...flags, deps }). Deterministic.
└── cli/dashboard/
    └── adopt.js              # NEW (GATED) — runAdopt({ exec, binary, ...row }). Shells `kodo adopt`.
                              #               Mirror of focus.js never-throws contract.
test/
├── providers/contract.test.js  # MODIFIED — add ONE capability-gated `it()` per the existing
│                                #            loop (mirror of the getTaskState B8 test).
├── adopt.test.js               # NEW — fontanería unit tests (DI providers + DI state writers).
└── cli/dashboard/adopt.test.js # NEW (GATED) — never-throws shell-out tests (mirror focus tests).
```

### Structure Rationale

- **`src/adopt.js` at top level (sibling of `interface.js`/`labels.js`), NOT under `src/gsd/`:** The flow is provider-agnostic and has nothing to do with GSD phases. Placing it in `src/gsd/` would falsely couple it to the GSD rail. It is the inverse of `manager.launchWorkItem`, which lives in `src/session/`. Two valid homes: `src/adopt.js` (top-level) or `src/session/adopt.js`. **Recommendation: `src/adopt.js`** — `manager.js` is large and launch-specific; a sibling module keeps the reverse path independently testable and avoids growing manager.js further (Karpathy rule 2/3). It imports `addSession` from `session/state.js` and `getProvider` from `providers/registry.js` exactly as `manager.js` does.
- **`buildSessionFromAdoption` lives in `adopt.js`, not `manager.js`:** It is a *different* shape derivation (no `task_ref` parse from a human ref, no `flags`/`gsd_mode`, an adopted session is never GSD at adoption time). Co-locating it with the fontanería keeps the single responsibility clean.
- **CLI and dashboard consumers are thin:** They parse input and call the fontanería (CLI) or shell `kodo adopt` (dashboard). Neither owns state.json logic. This is the explicit "consumers never own the base" constraint.

---

## Architectural Patterns

### Pattern 1: Optional provider method via typeof-detection (the FROZEN-at-9 contract)

**What:** `createTask` is added to each provider object literal but is NOT pushed into `TASK_PROVIDER_METHODS`. Callers gate with `typeof provider.createTask === 'function'`. This is the *exact* mechanism that added `getTaskState` in Phase 40 — verified in `provider.js:235-263` (the doc-comment literally says "OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13)").

**When to use:** Any capability not universal to all providers. The 9-method registry validation loop (`registry.js:107-111`) stays untouched, so the contract remains FROZEN at 9 and a provider without `createTask` still validates.

**Trade-offs:** Caller must handle the unsupported case (a provider could lack `createTask`). That is desirable — it makes "which providers can be adopted into" a runtime capability, not a contract break.

```javascript
// In adopt.js — the capability gate (mirror of server/provider-state.js Phase 40)
if (typeof provider.createTask !== 'function') {
  return { ok: false, code: 'CREATE_UNSUPPORTED', detail: providerName };
}
const raw = await provider.createTask({ projectId, title, description });
```

```javascript
// In plane/provider.js — additive method on the object literal, AFTER getTaskState.
// Reuses normalizeWorkItem so the created task round-trips into a canonical TaskItem.
async createTask({ projectId, title, description }) {
  const html = description ? '<p>' + description.replace(/\n/g, '<br>') + '</p>' : '';
  const workItem = await client.createWorkItem(projectId, { name: title, description_html: html });
  const proj = config.projects.find((p) => p.id === projectId);
  return normalizeWorkItem(workItem, {
    labels: labelCache,
    projectIdentifier: proj?.identifier || 'UNKNOWN',
    baseUrl: config.baseUrl, webUrl: config.webUrl,
    workspaceSlug: config.workspaceSlug, stateMap: stateCache,
  });
}
```

### Pattern 2: Never-throws discriminated return (the fontanería's contract)

**What:** `adoptSession` returns `{ ok:true, task, session } | { ok:false, code, detail }` and never throws. This is the codebase's universal seam contract: `focus.js` (`{ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR'}`), `client.js#fetchStatus` (`{ok:false, error}`), `markSessionStatus` (`{ok, reason}`), `server/dismiss.js`. All three consumers map the discriminant to their own surface (CLI exit code, TUI footer, orchestrator prose).

**When to use:** Always for the base — a CLI must exit cleanly, a TUI must never crash React, the orchestrator must read a structured result. A thrown error in the base would force every consumer to wrap try/catch differently.

**Trade-offs:** The POST itself (network) can fail; the base catches and collapses to `{ok:false, code:'CREATE_FAILED', detail}`. Distinguish create-failure (task NOT created) from adopt-failure (task created but state write failed) — see Pitfall on partial failure.

```javascript
export async function adoptSession({ provider, providerName, projectId, title, description,
                                     workspaceRef, cwd, sessionId, addSessionFn = addSession }) {
  if (typeof provider.createTask !== 'function')
    return { ok: false, code: 'CREATE_UNSUPPORTED', detail: providerName };
  let task;
  try { task = await provider.createTask({ projectId, title, description }); }
  catch (err) { return { ok: false, code: 'CREATE_FAILED', detail: err.message }; }
  const session = buildSessionFromAdoption({ task, providerName, cwd, workspaceRef, sessionId });
  try { addSessionFn(task.id, session); }
  catch (err) { return { ok: false, code: 'ADOPT_FAILED', detail: err.message, task }; } // task EXISTS
  return { ok: true, task, session };
}
```

### Pattern 3: Consumer shells the deterministic core (the dashboard rail)

**What:** The dashboard keybinding does NOT call `adoptSession` in-process and does NOT add an HTTP endpoint. It `execFile`s `kodo adopt --workspace <ref> --cwd <path> --title <derived> --project <id>` exactly as `focus.js` shells `cmux select-workspace`. This preserves the "cero endpoints nuevos desde v0.10" invariant.

**When to use:** When a TUI action needs to run deterministic logic that already exists as a CLI. The TUI process is the dashboard *client*; the server is the single writer of state.json. Shelling `kodo adopt` (a fresh process that writes state.json directly) avoids both a new endpoint AND a write from the dashboard client process.

**Trade-offs:** A subprocess per adoption (acceptable — adoption is a rare, operator-initiated action, not a poll). The never-throws shell wrapper (`runAdopt`, mirror of `runFocus`) collapses ENOENT/non-zero-exit into a footer message.

```javascript
// src/cli/dashboard/adopt.js — mirror of focus.js runFocus
export function runAdopt({ exec, binary, args, timeoutMs = 15_000 }) {
  // args = ['adopt', '--workspace', ref, '--cwd', cwd, '--title', title, '--project', id]
  // never-throws: { ok:true } | { ok:false, code, detail }  ← identical shape to FocusResult
}
```

### Pattern 4: Orchestrator as consumer, never owner (the LLM rail)

**What:** The orchestrator is the *only* LLM consumer. Its added value is deriving a **smart title** from real session context (cwd, recent commits, transcript) instead of `basename(workspace)`. But it produces the title and then shells the SAME `kodo adopt` CLI — it does NOT re-implement createTask/adoptSession. The skill prose instructs the LLM to call `kodo adopt --title "<derived>" ...`, keeping the deterministic base as the single rail that writes state.json.

**When to use:** The orchestrator already shells kodo CLIs (`kodo gsd verify`, etc.) per the skill. Adoption is one more CLI invocation. The 0-token constraint is preserved because the base (createTask + adoptSession) consumes 0 tokens; only the title derivation (already inside an LLM session) uses tokens, and that is the orchestrator's existing rail.

**Trade-offs:** None structurally — this is the cleanest way to keep "only the orchestrator uses LLM." The risk is prose drift; mitigate by making the skill point at `kodo adopt --help` as the source of truth.

---

## Data Flow

### Adopt flow (the reverse of launch)

```
[Operator / Orchestrator decides to adopt an ad-hoc session]
        ↓
[title derived]   CLI: basename(cwd) default (deterministic)
                  Orchestrator: smart title from cwd/commits/transcript (LLM)
        ↓
kodo adopt --workspace <ref> --cwd <path> --title <t> --project <id> [--description <d>]
        ↓
src/cli/adopt.js  →  initRegistry() + getProvider(config.provider)
        ↓
src/adopt.js  adoptSession({ provider, providerName, projectId, title, ... })
        ↓ capability gate: typeof provider.createTask === 'function'
        ↓
provider.createTask({ projectId, title, description })
        ↓
client.createWorkItem / createIssue   →  POST (auth plumbing already exists)
        ↓
normalizeWorkItem / normalizeIssue    →  canonical TaskItem  (round-trip)
        ↓
buildSessionFromAdoption(task, providerName, cwd, workspaceRef, sessionId)
        ↓
addSession(task.id, session)          →  state.json  (EXISTING writer)
        ↓
{ ok:true, task, session }  →  CLI prints ref+url / TUI footer / orchestrator prose
```

### Comparison: launch (existing) vs adopt (new)

```
LAUNCH (manager.launchWorkItem):     ADOPT (adopt.adoptSession):
  provider.getTask(ref)         →       provider.createTask({...})     ← inverse
  host.newWorkspace(...)        →       (workspace ALREADY exists)     ← skipped
  buildSessionFromTask(...)     →       buildSessionFromAdoption(...)  ← mirror
  addSession(task.id, session)  →       addSession(task.id, session)   ← SAME writer
  host.send(claudeCmd)          →       (session ALREADY running)      ← skipped
```

The adopt path is strictly *smaller* than launch: it reuses `addSession`, skips workspace creation and the claude spawn (both already done by the operator ad-hoc), and replaces `getTask` with `createTask`.

### state.json fields written by adoptSession (and the collision question)

`buildSessionFromAdoption` produces a `Session` (typedef in `state.js:11-37`). Recommended fields:

| Field | Value | Why |
|-------|-------|-----|
| `task_id` | `task.id` (newly created) | the new persistent identity; the state.json key |
| `task_ref` | `task.ref` | from the created+normalized TaskItem |
| `provider` / `project_id` | `config.provider` / `projectId` | provenance |
| `summary` | `task.title` | the derived/edited title |
| `task_url` / `project_name` | `task.url` / `task.projectName` | so dashboard `o`/columns work immediately |
| `workspace_ref` | the ad-hoc cmux ref | so reconcile can match the live tab |
| `session_id` | the ad-hoc claude `--session-id` if known, else `''`/omit | drives `isSessionProcessAlive` pgrep |
| `project_path` | `cwd` | reconcile cwd-match + resolvers |
| `started_at` | `new Date().toISOString()` | adoption time |
| `status` | `'running'` | it IS a live session |
| `state` (v3) | `'running'` | so reconcile/dashboard treat it as alive |
| `process_alive` | `true` | matches a live ad-hoc claude |
| `gsd` / `gsd_mode` / `phase_id` | OMITTED | adopted sessions are never GSD at adoption |

**Critical: the `session_id` field is what makes reconcile work.** `runReconcileTick` derives `process_alive` via `isSessionProcessAlive(session_id)` = `pgrep -f "session-id <id>"` (reconcile.js:280-290). If the spike can recover the ad-hoc session's `--session-id`, write it and reconcile tracks liveness natively. If it CANNOT (the operator launched plain `claude` without `--session-id`), reconcile falls back to `!!s.process_alive` (reconcile.js:338) — so seed `process_alive:true` and rely on the `tab_alive`/`workspace_ref` title-match path. **This is the single most important field for the spike to investigate** (see HARD GATE).

---

## Single-writer-of-alive: why adoptSession does NOT collide with reconcileTick

This is the load-bearing invariant. The constraint reads "reconcileTick is the single writer of `alive`." Read literally against the code (reconcile.js + state.js), here is why a one-shot `adoptSession → addSession` write is safe:

1. **`reconcileTick` is the single writer of the LIFECYCLE TRANSITION**, not the single writer of the state.json file. `addSession`, `updateSession`, `removeSession`, and `dismiss`→`doctor.execute` all write state.json today. `adoptSession` calling `addSession` is the same class of write as `launchWorkItem` calling `addSession` (manager.js:272) — and launch already does this on EVERY new session without colliding with reconcile.
2. **Adoption seeds the initial record; reconcile then OWNS subsequent `alive` transitions.** This is identical to launch: `buildSessionFromTask` writes `status:'running'` pre-spawn, and from then on `reconcileTick` drives `running→idle→dead`. Adoption writes the same seed shape, and reconcile picks it up on the next 2.5s tick exactly as it does a launched session.
3. **No write race in practice.** `reconcileTick` only *transitions* sessions it finds in `state.sessions`. If adoption's `addSession` lands between two ticks, the next tick simply sees a new session and derives its target from the live host (reconcile.js:138). If it lands mid-tick, `reconcileTick` operates on its own `loadState()` snapshot (reconcile.js:327) and the worst case is the new session is picked up one tick later — benign, identical to launch.

**Recommendation:** adoptSession writes the seed via the existing `addSession` and sets `state:'running'`, `process_alive:true`, `alive:true`. It must NOT write `dead_since`/`last_seen_alive` (those are reconcile-owned). Do NOT add a new state.json writer — reuse `addSession` verbatim. This keeps the invariant: reconcile remains the only thing that *transitions* `alive`; adoption only *seeds* a new row, exactly like launch.

---

## Idempotency: avoiding double-adopt

Two double-adopt risks, both real:

1. **Double-create (two POSTs → two provider tasks):** The CLI is deterministic and synchronous; a human double-pressing the dashboard key or the orchestrator proposing twice could fire two adoptions. **Mitigation:** before `createTask`, check `findSession({ workspaceRef, cwd })` (state.js:341 — already scans sessions AND history). If a session already exists for this workspace/cwd, return `{ ok:false, code:'ALREADY_ADOPTED', detail: existing.task_id }` BEFORE the POST. This is a pure read, 0-token, and reuses the existing `findSession`.
2. **Create-succeeded-but-adopt-failed (orphan provider task):** If `createTask` succeeds but `addSession` throws, the provider has a task with no state.json row. Return `{ ok:false, code:'ADOPT_FAILED', task }` so the caller can surface "task created (KL-99) but not registered locally — re-run `kodo adopt --existing KL-99`." Do NOT auto-delete the task (Out of Scope: "kodo no crea ni elimina tareas" — we are consciously adding *create*, not *delete*).

The dashboard double-press guard mirrors the dismiss double-`d`/`Esc` confirm pattern (Phase 42) at the UI layer, plus the `findSession` guard at the base layer — defense in two layers, same philosophy as the 3-layer `alive` guard in dismiss.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Personal tool (current) | None. Adoption is a rare, operator-initiated, single-shot action. No batching, no queue, no daemon. |
| Many ad-hoc sessions/day | The dashboard "list ad-hoc sessions" view (gated by spike) may need to dedup against state.json by workspace_ref — already cheap via `findSession`. |
| Multiple providers configured | `createTask` capability gate already handles "this provider can't be adopted into" gracefully. Start with ONE provider (Plane, per the backlog "Empezar por un solo provider"). |

### Scaling Priorities

1. **First bottleneck (none real):** This is not a hot path. The only "scale" concern is the spike's cmux-detection cost if the dashboard lists ALL ad-hoc sessions on every poll — defer that enumeration to keypress, not poll.
2. **Provider breadth:** Adding `createTask` to a third provider is the same additive pattern; no base change.

---

## Anti-Patterns

### Anti-Pattern 1: Adding `createTask` to `TASK_PROVIDER_METHODS`

**What people do:** "It's a provider method, so add it to the frozen list."
**Why it's wrong:** It breaks the FROZEN-at-9 contract and forces EVERY provider (and the registry validation loop at registry.js:107) to implement it. Phase 40 already established the correct precedent: optional methods live OUTSIDE the array, typeof-detected.
**Do this instead:** Add `createTask` to the provider object literal only; gate callers with `typeof`. Add ONE capability-gated `it()` to `contract.test.js` (mirror of the B8 `getTaskState` test at contract.test.js:498 — `if (typeof provider.createTask !== 'function') return;`).

### Anti-Pattern 2: A new HTTP endpoint for adoption (e.g. `POST /sessions`)

**What people do:** Mirror the dismiss `DELETE /sessions/{id}` and add `POST /sessions` for adoption.
**Why it's wrong:** Breaks "cero endpoints nuevos desde v0.10" — a standing invariant. Dismiss needed the server because it amplifies into `doctor.execute` server-side; adoption has no such server-side amplification. The deterministic write can happen in a fresh `kodo adopt` process.
**Do this instead:** Dashboard shells `kodo adopt` (Pattern 3). The CLI process writes state.json directly. No endpoint.

### Anti-Pattern 3: The orchestrator re-implementing the fontanería

**What people do:** Give the orchestrator skill its own create+register logic so it can "do it all in one LLM turn."
**Why it's wrong:** Creates a parallel rail that can drift from the deterministic base, and risks the LLM rail touching state.json semantics. Violates "consumers never own the base."
**Do this instead:** The orchestrator derives ONLY the smart title (its unique value), then shells `kodo adopt --title "<derived>" ...`. Same base, single rail.

### Anti-Pattern 4: The dashboard client writing state.json directly

**What people do:** Have the ink TUI call `addSession` in-process on keypress.
**Why it's wrong:** The dashboard is a read-mostly client; the server process owns reconcile's writes. An in-process write from the client races reconcile and duplicates the writer surface. (The dismiss precedent deliberately went through the *server*, not the client, for exactly this reason.)
**Do this instead:** Shell `kodo adopt` — a separate short-lived process — keeping the dashboard client read-only except for the shell-out.

### Anti-Pattern 5: Putting `adopt.js` under `src/gsd/`

**What people do:** "It writes state.json like the GSD stuff, put it in gsd/."
**Why it's wrong:** Adoption is provider-agnostic and GSD-unaware (adopted sessions are never GSD). `src/gsd/` is the GSD rail (resolver, verify, doctor, brief). Coupling them is a false dependency.
**Do this instead:** `src/adopt.js` at top level, sibling of `interface.js`/`labels.js`/`manager.js`'s domain.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Plane API | `client.createWorkItem(projectId, {name, description_html})` → `POST /projects/{id}/work-items/` via existing `request()` (client.js:23, method:'POST') | Auth (`X-API-Key`), retry, rate-limit already handled by `request`. Mirror `createComment` (client.js:175). Plane wants `description_html` (HTML, like comments). |
| GitHub API | `client.createIssue(owner, repo, {title, body})` → `POST /repos/{o}/{r}/issues` via existing `request()` (client.js:106) | Auth (`token`), error mapping already handled. Mirror `addComment` (client.js:293). GitHub wants markdown `body`. Defer to a later phase per backlog ("Empezar por un solo provider" = Plane first). |
| cmux | Read-only for the spike: does cmux expose per-workspace process/cwd so a `claude` absent from state.json can be detected? Via `host._legacy.listWorkspaces` (already used) + possibly OS-level `pgrep`/`lsof`. | **HARD GATE.** The verdict governs whether the dashboard keybinding "discover + list ad-hoc sessions" is viable. CLI `kodo adopt` does NOT depend on this (it takes `--workspace`/`--cwd` explicitly). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `adopt.js ↔ registry.js` | `getProvider(config.provider)` (direct import, like manager.js:174) | No change to registry. |
| `adopt.js ↔ provider.createTask` | `typeof`-gated direct call | Optional-method boundary; contract stays FROZEN at 9. |
| `adopt.js ↔ state.js` | `addSession(task.id, session)` (existing writer) | NO new writer. Seeds row; reconcile owns transitions. |
| `cli/adopt.js ↔ adopt.js` | in-process call, maps discriminant → exit code | Deterministic, 0-token. |
| `dashboard/adopt.js ↔ cli` | `execFile('kodo', ['adopt', ...])` never-throws (mirror focus.js) | No endpoint. Gated by spike. |
| orchestrator skill ↔ cli | shells `kodo adopt --title <smart> ...` | LLM derives title only; base unchanged. |

---

## Suggested Build Order (honors the spike HARD GATE + fontanería-first layering)

The ordering enforces two things: (a) the deterministic base ships before any consumer, and (b) the dashboard keybinding is GATED behind the cmux-detection spike — exactly mirroring how Phase 49's spike gated the Phase 50 progress display in v0.12.

```
Phase 52  ── createTask (Plane only) + contract matrix
            │  • client.createWorkItem (POST) — mirror createComment
            │  • provider.createTask (typeof-detected, OUTSIDE the 9) — mirror getTaskState
            │  • ONE capability-gated it() in contract.test.js — mirror B8
            │  • FROZEN-at-9 invariant verified (registry loop untouched)
            ▼
Phase 53  ── The fontanería: src/adopt.js (adoptSession + buildSessionFromAdoption)
            │  • never-throws discriminated return
            │  • findSession double-adopt guard
            │  • addSession seed write (state:'running', process_alive:true) — NO new writer
            │  • unit tests with DI providers + DI state writer
            ▼
Phase 54  ── CLI consumer: kodo adopt (deterministic, ships sí o sí)
            │  • program.command('adopt') — mirror launch <ref> registration
            │  • --workspace/--cwd/--title(default basename)/--project/--description
            │  • discriminant → deterministic exit codes (mirror gsd verify)
            │  • NO dependency on the spike — explicit workspace/cwd
            ▼
Phase 55  ── ★ SPIKE (HARD GATE): cmux per-workspace process/cwd detection
            │  • Can we recover an ad-hoc session's --session-id / cwd / workspace_ref?
            │  • Verdict VIABLE/NON-VIABLE governs Phase 56 (mirror Phase 49→50)
            ▼ (only if VIABLE)
Phase 56  ── Dashboard keybinding consumer (GATED)
            │  • src/cli/dashboard/adopt.js — shells kodo adopt (mirror focus.js)
            │  • discover/list ad-hoc sessions absent from state.json
            │  • cero endpoints nuevos preserved
            ▼ (parallelizable with 56, independent of the gate)
Phase 57  ── Orchestrator consumer: assisted adoption
            │  • skill prose: derive smart title from cwd/commits/transcript
            │  • shells the SAME kodo adopt — consumer not owner
            ▼
(separate)  Inherited v0.12 debt: XSS WR-01 (http(s) allowlist in src/server.js HTML rail)
            + deferred HUMAN-UAT of the 50.1 progress display. Schedulable anywhere;
            independent of the adopt flow.
```

**Why this order:**
- **createTask before the fontanería:** the fontanería calls `provider.createTask`; building it first lets `adopt.js` be tested against a real (typeof-detected) method and locks the FROZEN-at-9 invariant early.
- **fontanería before all consumers:** the explicit "consumers reuse the base, never own it" constraint. CLI/dashboard/orchestrator all depend on `adoptSession` existing.
- **CLI before the spike:** `kodo adopt` ships unconditionally (backlog: "ships sí o sí"), takes explicit `--workspace`/`--cwd`, and is the thing the dashboard and orchestrator shell. It must exist before its shell-out consumers.
- **Spike as a HARD GATE before the dashboard keybinding:** identical to Phase 49 gating Phase 50. If cmux can't expose per-workspace process/cwd, the "auto-discover ad-hoc sessions" dashboard feature is non-viable, but the CLI and orchestrator paths (which take explicit input) still ship.
- **Orchestrator last (or parallel with dashboard):** it only adds smart-title derivation atop the already-shipped `kodo adopt`; it has no hard dependency on the spike.

---

## Sources

- `src/interface.js` — TASK_PROVIDER_METHODS FROZEN at 9; TaskItem typedef (read 2026-06-15, HIGH)
- `src/providers/registry.js` — 9-method validation loop; capability not in loop (HIGH)
- `src/providers/plane/provider.js:235-263` — getTaskState optional-method precedent (HIGH)
- `src/providers/plane/client.js:175` — createComment POST plumbing to mirror (HIGH)
- `src/providers/github/client.js:293` — addComment POST plumbing to mirror (HIGH)
- `src/providers/plane/normalize.js` — normalizeWorkItem reuse for created payload (HIGH)
- `src/session/manager.js:32,272` — buildSessionFromTask + addSession launch path to invert (HIGH)
- `src/session/state.js:250,341` — addSession (existing writer) + findSession (double-adopt guard) (HIGH)
- `src/session/reconcile.js:117,280,338` — single-writer-of-alive semantics; process_alive/pgrep (HIGH)
- `src/cli/dashboard/focus.js` — never-throws shell-out consumer pattern to mirror (HIGH)
- `test/providers/contract.test.js:498` — capability-gated B8 getTaskState test to mirror (HIGH)
- `.planning/PROJECT.md` + `.planning/ROADMAP.md` (Phase 999.1) — milestone constraints & 4 pieces (HIGH)

---
*Architecture research for: kodo bidireccional — reverse session→task flow*
*Researched: 2026-06-15*
