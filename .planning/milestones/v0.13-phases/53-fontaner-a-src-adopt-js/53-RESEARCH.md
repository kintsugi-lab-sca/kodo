# Phase 53: Fontanería `src/adopt.js` - Research

**Researched:** 2026-06-16
**Domain:** Node.js (ES modules) — deterministic 0-token session adoption plumbing (inverse of `manager.launchWorkItem`)
**Confidence:** HIGH (every recommendation grounded in actual kodo file:line; no external deps; pure codebase-internal patterns)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `adoptSession` returns the never-throws discriminant with 5 states:
  - `{ ok: true, task, session }` — success (task created + row seeded in `state.json`).
  - `ALREADY_ADOPTED` — idempotency guard hit; NO task created. `detail` includes the existing `task_id`.
  - `UNSUPPORTED` — provider does not implement `createTask` (typeof-gate fails). Read-lane never-throws.
  - `CREATE_FAILED` — the `createTask` POST failed (403/404/5xx/network); `detail` propagates provider context (mirror Phase 52 D-08: LOUD on insufficient scope).
  - `PERSIST_FAILED` — POST succeeded but local write failed (D-03); `detail` MUST embed `task_id` + `task_url`.
  - Exact `code` strings are planner-coordinable with the CLI (Phase 54); these 5 states are the contract.
- **D-02:** Pure/impure split in `src/adopt.js` (top-level, NOT under `src/gsd/`):
  - `adoptSession({ provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title?, description? })` — async orchestrator doing all I/O (loadState, POST, addSession), returns the discriminant.
  - `buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath })` — **pure**, returns the `SessionRecord` mirroring `buildSessionFromTask` (`status: 'running'`, `started_at`, no GSD flags). Omits `dead_since` / `last_seen_alive` (reconcile-owned).
  - `sanitizeAdoptionData({ cwd, title?, description? })` — **pure**, applies defaults + sanitization before POST.
- **D-03:** "POST OK / local write KO" is modeled INSIDE the discriminant as `{ ok:false, code:'PERSIST_FAILED', detail }`, NOT a thrown exception. LOUD = distinct code + non-swallowable + `detail` carrying orphan coordinates (`task_id` + `task_url` + "recoverable via idempotent re-run"). The consumer is responsible for making it noisy (CLI: exit ≠ 0 + stderr banner). **Operation order:** guard (fresh loadState + findSession) → POST `createTask` → `addSession` (local write LAST). No `cmux.send` in adoption.
- **D-04:** Core receives **resolved data**, never prompts/detection. `projectId`, `projectPath`, and (optionally) `title`/`description` arrive resolved by the consumer. `listProjects` lives in the consumer UI (Phase 54/56), NOT in `src/adopt.js`. Default title `basename(cwd)` applied INSIDE the core only when `title` is omitted.
- **D-04 guard:** fresh `loadState()` immediately before POST (mirror of dismiss's fresh 409 re-read, v0.10 Phase 42) → `findSession({ workspaceRef, cwd })` (scans sessions + history, `sessions > history` precedence per LIFE-01). If found → `ALREADY_ADOPTED` without POST.
- **D-05:** Upgrade the single writer chokepoint `saveState` (`src/session/state.js:241-242`) from plain `writeFileSync` to tmp+rename (write `${STATE_PATH}.tmp` + `renameSync`). Surgical (one function); all state writers benefit. **Confirm it does not break the `.bak` migration snapshot** (`state.js:200-208`).
- **D-06:** `sanitizeAdoptionData` (pure) applies before POST: (1) title = `title ?? basename(cwd)`; (2) strip embedded absolute paths; (3) redact home dir → `~`; (4) **never** embed transcript bodies; (5) optional description, sanitized with the same rules. Initial task state is healthy (in-progress/active, NOT "untriaged") — see D-07.
- **D-07 (carry-forward Phase 52 D-04):** the adopted task is created in **in-progress / active** state, never Backlog/passive.
- **D-08 (carry-forward Phase 52 D-01/D-02/D-06):** `createTask` already creates WITHOUT trigger label (`kodo:gsd`/`kodo:gsd-quick`) + `kodo:adopted` marker → anti-recursion (BIDIR-06) already shipped in Phase 52; Phase 53 only invokes the method. The 201 already round-trips to a canonical `TaskItem` via `normalizeWorkItem`/`normalizeIssue`, so `adoptSession` consumes a shape-identical `TaskItem` with no special case.

### Claude's Discretion
- Exact `code` strings of the discriminant (taxonomy D-01 is the contract; spelling fixed by planner coordinating with Phase 54 CLI).
- Exact signature of `adoptSession`'s input object (D-02/D-04 fields are the minimum set; concrete names at discretion).
- Internal mechanics of tmp+rename (temp suffix, `fsync` handling) — D-05 fixes the what, not the byte-for-byte how.

### Deferred Ideas (OUT OF SCOPE)
- **CLI `kodo adopt`** (argv parsing, `--workspace`/`--cwd`/`--project`, exit codes from discriminant) → **Phase 54**.
- **Interactive project selection** (`listProjects` as UI) + **smart title derivation** (cwd/commits/transcript) → consumers (Phase 54/56/57, ORCH-01).
- **cmux detection** (`describeSurface()` → `{ workspaceRef, cwd, sessionId, kind }`) → **Phase 55**. `adopt.js` receives these fields as data.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BIDIR-03 | Fontanería `src/adopt.js` + never-throws discriminant | `buildSessionFromTask` shape mapped (`manager.js:32-66`); discriminant idiom mapped (`dismiss.js`, `manager.js:371`); typeof-gate mapped (`dispatcher.js:82`, `contract.test.js:578`). |
| BIDIR-04 | Idempotency guard / double-adopt + TOCTOU | `findSession({workspaceRef,cwd})` mapped (`state.js:341-386`); fresh-reread 409 precedent mapped (`dismiss.js:113-121`). |
| BIDIR-05 | create+adopt atomicity LOUD | tmp+rename precedent mapped (`polling.js:149-154`, `polling-daemon.js:79-82`); `saveState` chokepoint + injection sites mapped; `.bak` path proven independent. |
| BIDIR-08 | Auto-derived data + sanitization | No reusable redaction helper exists (`logger.js` redactor is log-record-specific) — sanitizer is net-new, pure, backstop; `basename` from `node:path` precedent in `format.js:25`. |
</phase_requirements>

## Summary

Phase 53 is **pure plumbing assembly** — almost every primitive it needs already exists in the kodo codebase, verified at file:line. There are **zero new runtime dependencies** and the implementation is small: one new top-level module (`src/adopt.js`) with three functions (2 pure + 1 async orchestrator), one surgical one-line-shape upgrade to `saveState`, and unit tests that follow established HOME-isolation + DI patterns.

The core insight is that `adoptSession` is the exact inverse of `manager.launchWorkItem` minus the cmux branch: `buildSessionFromAdoption` mirrors `buildSessionFromTask` (`manager.js:32`), `addSession` is reused verbatim (`state.js:250`), the idempotency guard reuses `findSession` (`state.js:341`), the never-throws discriminant mirrors `dismiss.js`/`markSessionStatus`, and `createTask` (already shipped in Phase 52, typeof-detected) returns a canonical `TaskItem` with no special case. The tmp+rename atomicity primitive that BIDIR-05 demands **already exists twice** in the repo (`polling.js:149`, `polling-daemon.js:79`) and is ready to copy into `saveState`.

**Primary recommendation:** Build `src/adopt.js` as a thin orchestrator that composes existing exports; upgrade `saveState` to tmp+rename by copying the `polling.js:149-154` idiom; unit-test `adoptSession` with a fake provider object (`{ createTask: async () => fakeTaskItem }`) + HOME-isolated temp `state.json` (mirror `find-session.test.js` dynamic-import-post-HOME scaffold). Two genuinely net-new pieces require care: (1) the `sanitizeAdoptionData` pure function (no reusable redaction helper exists), and (2) the `PERSIST_FAILED` LOUD path (the one place where local-write failure must be caught and converted to a discriminant code instead of propagating).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Capability detection (`typeof provider.createTask`) | Core (`adopt.js`) | — | The gate lives at the call site, never in the FROZEN-9 contract (`interface.js:52`). Mirror of `dispatcher`/`contract.test.js:578`. |
| Task creation transport (POST) | Provider adapter | — | Already shipped Phase 52 (`plane/provider.js:280`, `github/provider.js:196`). `adopt.js` only invokes. |
| Idempotency guard (double-adopt) | Core (`adopt.js`) | State store (`findSession`) | Authoritative mapping is LOCAL (`state.json`), never a remote fuzzy query (REQUIREMENTS Out of Scope). |
| Local persistence (seed row) | State store (`addSession`→`saveState`) | — | Reuse verbatim; same write class as launch. `saveState` is the single chokepoint upgraded to atomic. |
| SessionRecord construction | Core pure fn (`buildSessionFromAdoption`) | — | Pure inverse of `buildSessionFromTask`; omits reconcile-owned fields. |
| Data sanitization | Core pure fn (`sanitizeAdoptionData`) | — | Backstop / defense-in-depth — guarantees no abs-paths/home/transcript leak even if consumer fails. |
| Project/title resolution | **Consumer** (Phase 54/56/57) | — | OUT OF SCOPE here (D-04). Core receives resolved `projectId`/`title`. |
| cmux surface detection | **Host** (Phase 55) | — | OUT OF SCOPE. `adopt.js` receives `cwd`/`sessionId`/`workspaceRef` as data, never calls cmux. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` (`writeFileSync`, `renameSync`) | builtin (Node v22.22.3) | Atomic tmp+rename in `saveState` | Already the repo's atomic-write primitive (`polling.js:149`, `polling-daemon.js:79`). [VERIFIED: `node --version` → v22.22.3] |
| `node:path` (`basename`, `join`) | builtin | Default title `basename(cwd)`, path detection in sanitizer | `basename` already used for the same display purpose in `format.js:25,42`. [VERIFIED: codebase grep] |
| `node:os` (`homedir`) | builtin | Home-dir redaction in sanitizer | Standard repo idiom (`config.js:4`, `logger-events.js:23`). [VERIFIED: codebase grep] |
| `node:test` + `node:assert/strict` | builtin | Unit tests | The repo's only test framework (every `test/*.test.js`). [VERIFIED: codebase grep] |

### Supporting (existing kodo exports reused — NOT installed)
| Export | Source | Purpose | When to Use |
|--------|--------|---------|-------------|
| `addSession(taskId, session, logger?)` | `src/session/state.js:250` | Seed the `state.json` row | The LAST I/O step of `adoptSession`. |
| `loadState()` | `src/session/state.js:230` | Fresh read for the idempotency guard | Immediately before the POST. |
| `findSession({sessionId?,cwd?,workspaceRef?})` | `src/session/state.js:341` | Double-adopt guard (scans sessions+history) | Before POST; match → `ALREADY_ADOPTED`. |
| `saveState(state)` | `src/session/state.js:241` | **Upgraded** to tmp+rename (D-05) | Indirect via `addSession`. |
| `buildSessionFromTask(...)` | `src/session/manager.js:32` | The EXACT shape to mirror | Read as the template for `buildSessionFromAdoption`. |
| `KODO_LABEL_ADOPTED`, `isAdopted` | `src/labels.js:138,153` | Provenance/anti-recursion (already wired Phase 52) | No new code — confirm marker present. |
| `normalizeWorkItem` / `normalizeIssue` | `plane/normalize.js`, `github/normalize.js` | Already applied INSIDE `createTask` | No call needed — `createTask` returns canonical `TaskItem`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Upgrading `saveState` in place (D-05) | A new `atomicWrite` helper imported by `saveState` | D-05 explicitly chose in-place upgrade (one function, surgical). Extracting a shared helper is a refactor beyond scope; the 3-line idiom inlined is simpler and matches `polling.js`/`polling-daemon.js` (both inline it, no shared helper). |
| `PERSIST_FAILED` as discriminant code (D-03) | Throwing an exception | D-03 locked: throw would force try/catch divergent from the rest of the API. Code-based LOUD chosen. |
| Pure `findSession({workspaceRef, cwd})` guard | Remote duplicate search | REQUIREMENTS Out of Scope: "Búsqueda remota de duplicados" excluded — local `state.json` is authoritative. |

**Installation:**
```bash
# NONE — zero new runtime dependencies (0-token / minimal-deps constraint).
# All primitives are Node builtins or existing kodo internal exports.
```

## Package Legitimacy Audit

> **Not applicable.** Phase 53 installs **zero external packages**. Every primitive is a Node.js builtin (`node:fs`, `node:path`, `node:os`, `node:test`, `node:crypto`) or an existing kodo internal module export. No registry interaction, no slopcheck surface. [VERIFIED: CONTEXT.md "cero deps nuevas" + REQUIREMENTS.md "0-token / minimal-deps" + codebase has no `package.json` dependency additions in scope]

## Architecture Patterns

### System Architecture Diagram

```
                 CONSUMER (Phase 54 CLI / 56 dashboard / 57 orchestrator)
                 resolves: { projectId, projectPath, title?, description?,
                             workspaceRef, cwd, sessionId, provider, providerName }
                                          │
                                          ▼
        ┌──────────────────────── adoptSession() [async] ───────────────────────┐
        │                                                                        │
        │  1. typeof provider.createTask !== 'function' ──► {ok:false,           │
        │                                                    code:UNSUPPORTED}   │
        │                                                                        │
        │  2. sanitizeAdoptionData({cwd,title?,description?}) [PURE]             │
        │       title := title ?? basename(cwd)                                  │
        │       strip abs paths · redact homedir→~ · never transcript           │
        │                          │                                            │
        │                          ▼                                            │
        │  3. loadState() [FRESH] ─► findSession({workspaceRef,cwd})            │
        │       match ──► {ok:false, code:ALREADY_ADOPTED, detail:{task_id}}    │
        │                          │ no match                                   │
        │                          ▼                                            │
        │  4. provider.createTask({projectId,title,description}) ──► POST       │
        │       throws ──► {ok:false, code:CREATE_FAILED, detail:<provider ctx>}│
        │                          │ returns canonical TaskItem                 │
        │                          ▼                                            │
        │  5. buildSessionFromAdoption({task,...}) [PURE]                       │
        │       status:'running', started_at; OMIT dead_since/last_seen_alive   │
        │                          │                                            │
        │                          ▼                                            │
        │  6. addSession(task.id, session) ──► saveState [tmp+rename, atomic]   │
        │       throws ──► {ok:false, code:PERSIST_FAILED,                      │
        │                   detail:{task_id, task_url, hint:'re-run'}}  ◄─ LOUD │
        │                          │ ok                                         │
        │                          ▼                                            │
        │                   {ok:true, task, session}                           │
        └────────────────────────────────────────────────────────────────────┘

  Invariant preserved: reconcileTick remains the SOLE writer of `alive`/
  `dead_since`/`last_seen_alive`. buildSessionFromAdoption omits all three.
```

### Recommended Project Structure
```
src/
├── adopt.js                 # NEW top-level: adoptSession + buildSessionFromAdoption + sanitizeAdoptionData
└── session/
    └── state.js             # MODIFY saveState (lines 241-242) → tmp+rename atomic

test/
└── adopt.test.js            # NEW: HOME-isolated unit tests (mirror find-session.test.js scaffold)
   # OR test/session/adopt.test.js if planner prefers the test/session/ subdir convention (D-10 Phase 30)
```

### Pattern 1: Never-throws discriminant `{ ok, code, detail }`
**What:** Every fallible orchestrator returns a tagged union; reads never throw.
**When to use:** `adoptSession`'s top-level return.
**Example:**
```javascript
// Source: src/server/dismiss.js:120,132,139 + src/session/manager.js:411,424
// Success:
return { status: 200, body: { ok: true, removed: taskId, actions } };
// Guard hit (no mutation):
return { status: 409, body: { ok: false, error: 'alive' } };
// Collapse:
return { status: 500, body: { ok: false, error: message } };
// markSessionStatus variant (same idiom, no HTTP wrapper):
return { ok: false, reason: 'missing-task-id' };
return { ok: true, from: fromStatus, to: nextStatus };
```
For `adoptSession`, mirror this exactly but with the 5-state taxonomy from D-01:
`{ ok:true, task, session }` | `{ ok:false, code:'UNSUPPORTED'|'ALREADY_ADOPTED'|'CREATE_FAILED'|'PERSIST_FAILED', detail }`.

### Pattern 2: typeof capability-gate (NOT in FROZEN-9)
**What:** Optional provider methods detected at the call site, never added to `TASK_PROVIDER_METHODS`.
**Example:**
```javascript
// Source: src/triggers/dispatcher.js:82 (isAdopted cut), test/providers/contract.test.js:578
if (typeof provider.createTask !== 'function') return; // capability-gated skip
// In adoptSession this becomes:
if (typeof provider.createTask !== 'function') {
  return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
}
```

### Pattern 3: SessionRecord construction (mirror, omitting reconcile-owned fields)
**What:** Build the row from the resolved `TaskItem` + host data.
**Example:**
```javascript
// Source: src/session/manager.js:37-66 (buildSessionFromTask)
// buildSessionFromAdoption MUST produce these REQUIRED fields:
{
  workspace_ref: workspaceRef,            // from host data (not task)
  session_id: sessionId,                  // from host data (the ad-hoc session already exists)
  task_id: task.id,
  task_ref: task.ref,
  provider: providerName,
  project_id: task.projectId,
  summary: task.title,
  status: 'running',                      // D-02: healthy/active
  started_at: new Date().toISOString(),
  project_path: projectPath,
  task_url: task.url,
  project_name: task.projectName,
}
// MUST OMIT (reconcile-owned — invariant): dead_since, last_seen_alive,
//   tab_alive, alive, process_alive, needs_input, state.
// MUST OMIT (GSD-only): gsd, gsd_mode, phase_id, brief, worktree_path.
//   (Adoption knows nothing about GSD — no flags input.)
```
**Key difference from `buildSessionFromTask`:** the launch version DERIVES `workspaceRef` from `cmux.newWorkspace` and `worktreePath` from `computeWorktreePath`. Adoption RECEIVES `workspaceRef`/`sessionId` as data (the ad-hoc session/workspace already exists) and has NO worktree (the human's session is not a kodo worktree). Do not compute or persist `worktree_path`.

### Pattern 4: Atomic tmp+rename for `saveState` (D-05)
**What:** Write to a temp sibling, then atomically rename.
**Example:**
```javascript
// Source: src/triggers/polling.js:149-154 (the canonical repo idiom) — copy verbatim shape.
// CURRENT saveState (src/session/state.js:241-242):
export function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
// UPGRADED (D-05) — mirror polling.js:151-153:
export function saveState(state) {
  const tmp = STATE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}
// renameSync is already imported nowhere in state.js — add to the existing
// `import { readFileSync, writeFileSync, existsSync } from 'node:fs'` at line 2.
```
**Cross-platform note:** `renameSync(tmp, dest)` is POSIX-atomic on the same filesystem (darwin/Linux). On Win32 it would fail if the destination exists — kodo does NOT support Windows (confirmed `polling.js:141-144` comment). darwin is the dev/runtime target. [VERIFIED: `polling.js:141-144` documents this exact constraint; Node v22 `fs.renameSync` semantics stable]

### Anti-Patterns to Avoid
- **Writing `dead_since`/`last_seen_alive`/`alive` in `buildSessionFromAdoption`:** breaks the "reconcileTick is the sole writer of `alive`" invariant (CONTEXT.md + REQUIREMENTS BIDIR-03). The fields must be ABSENT (reconcile populates them on the next tick).
- **Throwing on persist failure:** D-03 locks this as a discriminant `code`, not an exception. The ONLY `try/catch`-to-code conversion in the module is around `addSession`.
- **Calling `listProjects` or any interactive resolution in `adopt.js`:** D-04 — core is non-owner; consumers resolve.
- **Calling `cmux` / `host._legacy` from `adopt.js`:** the ad-hoc session/workspace already exists; adoption receives `workspaceRef`/`sessionId` as DATA (REQUIREMENTS DETECT-01 cross-cutting rule).
- **Re-normalizing the `createTask` result:** `createTask` already returns a canonical `TaskItem` (Phase 52 D-06). Do not call `normalizeWorkItem`/`normalizeIssue` again.
- **Keying the guard by `task_id`:** `findSession` does NOT key by `task_id` (documented `dismiss.js:18,113` Pitfall 6). The guard keys by `{ workspaceRef, cwd }` → `cwd` matches `session.project_path` (`state.js:361`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file write | A custom locking/fsync scheme | Copy `polling.js:149-154` tmp+rename idiom into `saveState` | Already the repo's proven primitive; over-engineering fsync/flock is out of scope (D-05 says "the what, not the byte-for-byte how"). |
| State read/write/scan | Re-implementing state.json access | `loadState`/`addSession`/`findSession` from `state.js` | These ARE the chokepoints; adoption reuses them verbatim (BIDIR-03). |
| TaskItem normalization | Mapping 201 fields by hand | `createTask` already returns canonical `TaskItem` | Phase 52 D-06 did this; double-normalizing yields undefined fields (Plane Pitfall 2). |
| Session shape | Inventing fields | Mirror `buildSessionFromTask` (`manager.js:32`) field-for-field | The downstream reconciler/dashboard/hooks all read this exact shape. |
| Anti-recursion / provenance marker | New label logic | `kodo:adopted` already attached by `createTask` + cut in `dispatcher.js:82` | Shipped Phase 52; adoption inherits it. |

**Key insight:** Phase 53 writes almost no new logic — it COMPOSES. The only genuinely net-new code is (1) `sanitizeAdoptionData` (no reusable redaction helper exists — see below), (2) the 5-state discriminant assembly, and (3) the 1-line `saveState` upgrade. Everything else is wiring existing verified exports.

## Sanitization Specifics (BIDIR-08 / D-06)

**Finding: there is NO reusable home-dir/path-redaction helper to import.** [VERIFIED: codebase grep]

- `src/logger.js:176-216` has a deep-walk `redact()` — but it redacts **log-record values by sensitive key name** (passwords/tokens), walking objects. It is NOT a string path-stripper and is private to the logger sink. Reusing it would be a mis-fit (wrong shape, wrong intent).
- `homedir()` from `node:os` is the standard repo idiom (`config.js:4`, `logger-events.js:23`, `dashboard/plan.js:45`).
- `basename` from `node:path` is already used for the same display-title purpose (`format.js:25,42`).

**Recommendation:** `sanitizeAdoptionData` is a **pure, net-new function** in `adopt.js`. Suggested mechanics (D-06 fixes the what; planner fixes exact regexes):
1. `title = title ?? basename(cwd)` — `node:path.basename`.
2. Home redaction: replace `homedir()` prefix with `~` in title/description. Inject `homedir` via a default param for testability (mirror `dashboard/plan.js:69` `homedirFn` DI pattern) so tests don't depend on the real `$HOME`.
3. Absolute-path strip: a conservative regex over title/description (e.g. POSIX `/…` segments). Keep it pure — operate on the passed strings only.
4. Never embed transcript: the function simply does not accept/forward a transcript field — there is no transcript parameter (structural guarantee, not a filter). Document this as the backstop.

**Confidence:** MEDIUM on exact regex shape (Claude's Discretion per D-06); HIGH that no existing helper fits and the function must be net-new and pure.

## Runtime State Inventory

> Phase 53 is greenfield code + one surgical write-semantics upgrade. The relevant "runtime state" question is the `saveState` blast radius (D-05).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.kodo/state.json` is the only datastore `saveState` writes. Schema v3 (`state.js:36-37`). Upgrading to tmp+rename changes durability semantics, NOT shape — readers unaffected. | None to data; verify `.tmp` sibling never confuses readers (it won't — `loadState` reads `STATE_PATH` only). |
| Live service config | None — `adopt.js` touches no external service config. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. `STATE_PATH` derived from `KODO_DIR` (`state.js:9`) — unchanged. | None. |
| Build artifacts | None. | None. |
| **`saveState` injection sites (D-05 blast radius)** | `saveState` is imported/injected at: `server.js:7,608` (passed to reconcile), `session/reconcile.js:308,351,388` (DI param, called via `deps.saveState`). All call the same exported `saveState` — the upgrade is transparent to them (same signature, atomic now). | Verify reconcile/server tests still pass (they inject the real `saveState` or a fake; the real one's new internals are invisible). |
| **`.bak` migration path (D-05 compat — CONTEXT flag)** | `migrateStateIfNeeded` (`state.js:189-227`) writes the `.bak.<ts>` snapshot AND the migrated state via **its own direct `writeFileSync`** (lines 202, 208) — it does NOT call `saveState`. | **None — PROVEN INDEPENDENT.** Upgrading `saveState` cannot affect the migration backup. The `.bak` path is tested by `test/state/migration-backup.test.js:64-88` (regex `^state\.json\.bak\.\d{8}T\d{6}$`), which exercises `loadState→migrateStateIfNeeded`, never `saveState`. [VERIFIED: `state.js:200-208` uses inline `writeFileSync`; grep confirms no `saveState` call in `migrateStateIfNeeded`] |

**Confirmation for the planner:** The D-05 upgrade is safe. `saveState` and the migration `.bak` writer are separate code paths. No migration test or `.bak` behavior changes.

## Common Pitfalls

### Pitfall 1: Guard keyed by the wrong field
**What goes wrong:** Using `task_id` for the double-adopt guard (it doesn't exist yet — the task isn't created) or expecting `findSession` to key by `task_id`.
**Why it happens:** `findSession` returns `{id}` where for history `id = task_id`, which misleads.
**How to avoid:** Guard with `findSession({ workspaceRef, cwd })`. Internally `cwd` matches `session.project_path` (`state.js:361,380`) and `workspaceRef` matches `session.workspace_ref` (`state.js:358,377`). Documented in `dismiss.js:18` Pitfall 6.
**Warning signs:** Guard never fires, or fires on unrelated sessions.

### Pitfall 2: Persisting reconcile-owned fields
**What goes wrong:** Copying the full `buildSessionFromTask` output including v3 lifecycle fields, or adding `alive: true`.
**Why it happens:** `buildSessionFromTask` itself does NOT write them (verify: `manager.js:37-66` has none of `alive`/`dead_since`/`last_seen_alive`) — but a well-meaning author might add them "for completeness."
**How to avoid:** Produce ONLY the 12 fields listed in Pattern 3. The reconciler populates lifecycle fields on the next tick (`migrateStateV2toV3`/`runReconcileTick`).
**Warning signs:** `reconcileTick` invariant test fails; dashboard shows wrong liveness immediately after adopt.

### Pitfall 3: `PERSIST_FAILED` swallowed or thrown
**What goes wrong:** Either letting `addSession`'s throw propagate (violates the never-throws discriminant API) or catching it silently (loses the orphan — irrecoverable since kodo never deletes tasks).
**Why it happens:** Tension between BIDIR-05 "LOUD" and the never-throws convention (D-03 acknowledges this).
**How to avoid:** Wrap ONLY the `addSession` call in try/catch; on catch return `{ ok:false, code:'PERSIST_FAILED', detail:{ task_id: task.id, task_url: task.url, hint:'recoverable via idempotent re-run' } }`. The consumer makes it noisy.
**Warning signs:** A created provider task with no `state.json` row and no loud signal — a silent orphan.

### Pitfall 4: Calling cmux or re-normalizing
**What goes wrong:** Importing `host`/cmux into `adopt.js`, or re-running `normalizeWorkItem` on the `createTask` result.
**How to avoid:** `adopt.js` imports ONLY `state.js` exports + `node:` builtins + (for types) the `TaskItem` typedef. `createTask` already returns canonical (Phase 52 D-06).
**Warning signs:** cmux-isolation walker test flags a new cmux import path; `task.url` undefined (double-normalize).

### Pitfall 5: Test HOME leakage
**What goes wrong:** Static-importing `state.js` at the top of the test file caches the real `~/.kodo/` `KODO_DIR` at module-load, so tests write to the real state.json.
**Why it happens:** `state.js:9` computes `STATE_PATH` from `KODO_DIR` at import time.
**How to avoid:** Set `process.env.HOME = tmpHome` BEFORE a **dynamic** `import('../src/session/state.js')` — exactly the `find-session.test.js:76-88` scaffold. Same applies to `adopt.js` (it transitively imports `state.js`).
**Warning signs:** Tests mutate real state; flaky cross-test contamination.

## Code Examples

### `adoptSession` skeleton (composition of verified exports)
```javascript
// Source pattern: manager.launchWorkItem (manager.js:170) inverse + dismiss.js never-throws
import { loadState, findSession, addSession } from './session/state.js';
import { basename } from 'node:path';
import { homedir } from 'node:os';

export function sanitizeAdoptionData({ cwd, title, description }, homedirFn = homedir) {
  const home = homedirFn();
  const t = (title ?? basename(cwd));
  // strip abs paths + redact home → '~' (exact regex = planner discretion, D-06)
  return { title: redactPaths(t, home), description: description ? redactPaths(description, home) : undefined };
}

export function buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath }) {
  return {
    workspace_ref: workspaceRef, session_id: sessionId,
    task_id: task.id, task_ref: task.ref, provider: providerName,
    project_id: task.projectId, summary: task.title,
    status: 'running', started_at: new Date().toISOString(),
    project_path: projectPath, task_url: task.url, project_name: task.projectName,
    // OMIT: dead_since/last_seen_alive/alive/tab_alive/process_alive/needs_input/state + GSD flags
  };
}

export async function adoptSession({ provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title, description }) {
  if (typeof provider.createTask !== 'function') {
    return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
  }
  const clean = sanitizeAdoptionData({ cwd, title, description });
  // D-04 guard: FRESH read immediately before POST (mirror dismiss.js:115)
  const existing = findSession({ workspaceRef, cwd });   // uses loadState() internally
  if (existing) {
    return { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: existing.session.task_id } };
  }
  let task;
  try {
    task = await provider.createTask({ projectId, title: clean.title, description: clean.description });
  } catch (err) {
    return { ok: false, code: 'CREATE_FAILED', detail: { message: err?.message ?? String(err) } };
  }
  const session = buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath });
  try {
    addSession(task.id, session);   // local write LAST (atomic via upgraded saveState)
  } catch (err) {
    return { ok: false, code: 'PERSIST_FAILED', detail: { task_id: task.id, task_url: task.url, hint: 'recoverable via idempotent re-run', message: err?.message ?? String(err) } };
  }
  return { ok: true, task, session };
}
```
*(Skeleton — exact `code` strings and regex are planner/Claude discretion per D-01/D-06. `findSession` already calls `loadState()` internally, satisfying the "fresh read before POST" requirement without a separate `loadState` call.)*

### Unit test scaffold (HOME-isolated, fake provider)
```javascript
// Source: test/session/find-session.test.js:76-103 (dynamic-import-post-HOME) +
//         test/server/dismiss.test.js (DI fake + never-throws asserts)
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome, origHome, adoptSession;
const STATE = ['.kodo', 'state.json'];

before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-adopt-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  ({ adoptSession } = await import('../src/adopt.js')); // DYNAMIC, post-HOME
});
after(() => { process.env.HOME = origHome; rmSync(tmpHome, { recursive: true, force: true }); });
afterEach(() => writeFileSync(join(tmpHome, ...STATE), JSON.stringify({ schema_version: 3, sessions: {}, history: [] }) + '\n'));

const fakeTaskItem = { id: 'KL-99', ref: 'KL-99', title: 'adopt smoke', url: 'https://x/KL-99', projectId: 'p1', projectName: 'Proj' };
const fakeProvider = { createTask: async () => fakeTaskItem };

it('UNSUPPORTED when provider lacks createTask', async () => {
  const r = await adoptSession({ provider: {}, providerName: 'plane', workspaceRef: 'w:1', cwd: '/dev/foo', sessionId: 's1', projectId: 'p1', projectPath: '/dev/foo' });
  assert.equal(r.ok, false); assert.equal(r.code, 'UNSUPPORTED');
});

it('ok:true seeds the state.json row', async () => {
  const r = await adoptSession({ provider: fakeProvider, providerName: 'plane', workspaceRef: 'w:1', cwd: '/dev/foo', sessionId: 's1', projectId: 'p1', projectPath: '/dev/foo' });
  assert.equal(r.ok, true);
  assert.equal(r.session.status, 'running');
  assert.equal(r.session.dead_since, undefined);    // invariant: reconcile-owned omitted
  assert.equal(r.session.alive, undefined);
});

it('ALREADY_ADOPTED on second adopt (no second createTask call)', async () => {
  let calls = 0;
  const counting = { createTask: async () => { calls++; return fakeTaskItem; } };
  const args = { provider: counting, providerName: 'plane', workspaceRef: 'w:1', cwd: '/dev/foo', sessionId: 's1', projectId: 'p1', projectPath: '/dev/foo' };
  await adoptSession(args);
  const r2 = await adoptSession(args);
  assert.equal(r2.ok, false); assert.equal(r2.code, 'ALREADY_ADOPTED');
  assert.equal(calls, 1, 'createTask must NOT be called the second time');
});

it('PERSIST_FAILED carries task_id + task_url', async () => {
  // Inject failure: e.g. make state dir read-only, or stub addSession via a module mock.
  // Assert r.code === 'PERSIST_FAILED' && r.detail.task_id && r.detail.task_url.
});
```
**Note on guard test:** `findSession({workspaceRef,cwd})` matches `cwd` against `session.project_path`. In the "ok:true seeds the row" test, the seeded `project_path` is `projectPath` (`/dev/foo`), and the guard passes `cwd` (`/dev/foo`) — they must be the SAME value for the `ALREADY_ADOPTED` test to fire. This is correct: the consumer passes the same `cwd` as both the guard key and (as `projectPath`) the persisted path.

### `CREATE_FAILED` propagation (provider throws LOUD)
```javascript
// Source: github/client.js:311-314, plane/client.js:212 — request() throws Error
//   with .code ('forbidden'/'not_found') + .status on non-ok. createTask does NOT
//   swallow (Phase 52 D-08). adoptSession catches and converts to CREATE_FAILED.
const failing = { createTask: async () => { const e = new Error('403'); e.code = 'forbidden'; throw e; } };
// → { ok:false, code:'CREATE_FAILED', detail:{ message:'403' } }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `saveState` plain `writeFileSync` (`state.js:242`) | tmp+rename atomic (Pattern 4) | Phase 53 (D-05) | All state writes durable; matches `polling.js`/`polling-daemon.js` which already do this. |
| "kodo never creates tasks" (historic PROJECT.md) | kodo CREATES (not deletes) via `createTask`+adopt | v0.13 (Phase 52→53) | Consciously reconciled: orphan = re-run, never delete. |
| `createTask` not yet consumed | `adoptSession` is its first caller | Phase 53 | typeof-gate; FROZEN-9 untouched. |

**Deprecated/outdated:** none relevant. `getTaskState` (Phase 40) remains the canonical optional-method precedent; `createTask` (Phase 52) follows it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact `code` strings (`UNSUPPORTED`/`ALREADY_ADOPTED`/`CREATE_FAILED`/`PERSIST_FAILED`) — used as literals in examples. | Discriminant | LOW — D-01 explicitly defers exact spelling to the planner/Phase-54 CLI coordination. Examples are illustrative. |
| A2 | The exact absolute-path-strip regex in `sanitizeAdoptionData`. | Sanitization | LOW-MEDIUM — D-06 marks mechanics as Claude's Discretion. Over-aggressive stripping could mangle legit titles; under-aggressive leaks paths. Planner should pick a conservative POSIX-segment regex + add a test asserting `/Users/...` → `~/...`. |
| A3 | Test file location `test/adopt.test.js` vs `test/session/adopt.test.js`. | Structure | LOW — both conventions exist in the repo; planner picks. |
| A4 | `fsync` is not required for the tmp+rename (matching `polling.js` which omits it). | Pattern 4 | LOW — D-05 says "the what, not the byte-for-byte how"; repo precedent omits fsync. |

**No `[ASSUMED]` claims about external packages, registry, or APIs** — Phase 53 has none. All assumptions are intra-codebase discretion points already flagged in CONTEXT.md.

## Open Questions

1. **Exact `sanitizeAdoptionData` path-strip regex.**
   - What we know: must strip absolute paths + redact `homedir()`→`~`, never forward transcript (D-06).
   - What's unclear: precise regex (over/under-stripping tradeoff).
   - Recommendation: conservative POSIX-segment regex; inject `homedirFn` for testability; add an explicit test `/Users/alex/secret → ~/secret`.

2. **Should `adoptSession` accept an injected `addSession`/`findSession` (DI) for cleaner unit tests, or rely on HOME-isolation?**
   - What we know: `dismiss.js` uses DI; `find-session.test.js` uses HOME-isolation.
   - What's unclear: which the planner prefers for `PERSIST_FAILED` testing (DI makes injecting a throwing `addSession` trivial; HOME-isolation requires a read-only-dir trick).
   - Recommendation: lean DI (default params `{ loadState, findSession, addSession }`) — it makes the `PERSIST_FAILED` and `ALREADY_ADOPTED` tests deterministic without filesystem tricks, and mirrors the `dismiss.js` precedent the planner already trusts. HOME-isolation still needed for any test that exercises the real `state.js`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | ✓ | v22.22.3 | — |
| `node:fs`/`path`/`os`/`test`/`crypto` builtins | All of Phase 53 | ✓ | builtin | — |
| `renameSync` POSIX-atomic | D-05 saveState | ✓ (darwin) | builtin | — (Windows unsupported by design, `polling.js:141`) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none. Phase 53 is builtins + internal exports only.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (builtin) |
| Config file | none — invoked via `node --test` (per `package.json` scripts; every `test/*.test.js`) |
| Quick run command | `node --test test/adopt.test.js` |
| Full suite command | `node --test` (runs all `test/**/*.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BIDIR-03 | `adoptSession` returns 5-state discriminant; `UNSUPPORTED` when no `createTask`; `ok:true` seeds row | unit | `node --test test/adopt.test.js` | ❌ Wave 0 |
| BIDIR-03 | `buildSessionFromAdoption` omits reconcile-owned + GSD fields (pure) | unit | `node --test test/adopt.test.js` | ❌ Wave 0 |
| BIDIR-04 | second adopt → `ALREADY_ADOPTED`, `createTask` NOT called again | unit | `node --test test/adopt.test.js` | ❌ Wave 0 |
| BIDIR-05 | `PERSIST_FAILED` carries `task_id`+`task_url`; `saveState` writes via tmp+rename | unit | `node --test test/adopt.test.js` + `node --test test/state.test.js` | ❌ Wave 0 (adopt) / ✅ (state) |
| BIDIR-05 | `.bak` migration unaffected by `saveState` upgrade | unit (regression) | `node --test test/state/migration-backup.test.js` | ✅ exists |
| BIDIR-08 | `sanitizeAdoptionData`: default title=`basename(cwd)`, homedir→`~`, abs-path strip, no transcript param | unit | `node --test test/adopt.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/adopt.test.js`
- **Per wave merge:** `node --test` (full suite — must stay green; reconcile/server tests confirm `saveState` upgrade transparency)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/adopt.test.js` (or `test/session/adopt.test.js`) — covers BIDIR-03/04/05/08. NEW.
- [ ] Confirm `test/state/migration-backup.test.js` still passes after `saveState` upgrade (regression guard — exists).
- [ ] Confirm `test/server-reconcile-logger.test.js` + reconcile tests pass (they inject `saveState`; new internals invisible).
- Framework install: none — `node:test` is builtin.

## Security Domain

> `security_enforcement` not explicitly `false` in config (key absent) — included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Auth lives in the provider client (`X-API-Key`/PAT), already present; `adopt.js` never touches credentials. |
| V3 Session Management | no | Not a web session; the "session" here is a cmux/Claude session record. |
| V4 Access Control | no | No new access surface; CLI/dashboard consumers gate the action (deferred phases). |
| V5 Input Validation | **yes** | `sanitizeAdoptionData` — strip abs paths, redact homedir, never embed transcript (BIDIR-08). This IS the input-validation/output-sanitization control before data crosses to an external system (the task manager). |
| V6 Cryptography | no | None — no hashing/signing in scope (`verifySignature` is GitHub-off per provider). |

### Known Threat Patterns for {Node ESM / external task-manager write}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Local path / home-dir leakage into externally-hosted task | Information Disclosure | `sanitizeAdoptionData` redaction (BIDIR-08) — the core backstop, applied even if the consumer (Phase 57 orchestrator) fails to sanitize. |
| Transcript body exfiltration to provider | Information Disclosure | Structural: `sanitizeAdoptionData` has NO transcript parameter — it cannot forward one (defense by construction). |
| Auto-recursion (adopted task re-dispatched) | Elevation / DoS (session storm) | Already mitigated Phase 52: `kodo:adopted` marker + `dispatcher.js:82` cut (pre-lock, `--force`-proof). Adoption inherits it; no new control needed here. |
| Provider orphan (task created, no local row, silent) | Tampering / Repudiation | `PERSIST_FAILED` LOUD discriminant with `task_id`+`task_url` (BIDIR-05/D-03); recoverable by idempotent re-run; kodo never deletes. |
| `state.json` corruption on crash mid-write | Tampering (integrity) | tmp+rename atomic `saveState` (BIDIR-05/D-05) — partial writes impossible; reader sees old or new, never torn. |

**Note:** The XSS-in-`task_url` threat (DEBT-01) is a SEPARATE phase (58) on the dashboard HTML lane — out of scope for `adopt.js`, which only writes `task_url` to local state, never renders HTML.

## Sources

### Primary (HIGH confidence — codebase file:line, verified this session)
- `src/session/manager.js:32-66` — `buildSessionFromTask` (the exact shape to mirror); `:170-297` `launchWorkItem` (the flow being inverted); `:371-424` `markSessionStatus` discriminant idiom.
- `src/session/state.js:230-386` — `loadState`/`saveState`/`addSession`/`findSession`/`migrateStateIfNeeded`; `:200-208` `.bak` path (uses inline `writeFileSync`, NOT `saveState`); `:241-242` the `saveState` to upgrade.
- `src/server/dismiss.js:99-142` — never-throws DI handler + fresh-reread 409 TOCTOU precedent; `:18,113` Pitfall 6 (findSession not keyed by task_id).
- `src/triggers/polling.js:149-154` — the canonical tmp+rename atomic-write idiom to copy; `:141-144` darwin/Win32 note.
- `src/cli/polling-daemon.js:79-82` — second tmp+rename precedent.
- `src/triggers/dispatcher.js:82-85` — `isAdopted` anti-recursion cut (Phase 52, inherited).
- `src/labels.js:138-162` — `KODO_LABEL_ADOPTED` / `isAdopted` (Phase 52, inherited).
- `src/providers/plane/provider.js:280-327` + `src/providers/github/provider.js:196-204` — `createTask` (returns canonical `TaskItem`, Phase 52 D-06).
- `src/providers/github/client.js:321-328` + `src/providers/plane/client.js:201-206` — POST transport, LOUD-propagation (Phase 52 D-08).
- `src/interface.js:11-62` — `TaskItem` typedef + FROZEN-9 `TASK_PROVIDER_METHODS`.
- `test/session/find-session.test.js:76-145` — HOME-isolation dynamic-import scaffold + addSession/findSession test pattern.
- `test/server/dismiss.test.js:14-70` — DI fake + spy + never-throws unit pattern.
- `test/providers/contract.test.js:484-582` — FROZEN-9 negative-assert + capability-gated `createTask` test (B9).
- `test/state/migration-backup.test.js:64-88` — `.bak` regression coverage (proves saveState/migration independence).
- `node --version` → v22.22.3 — confirms `fs.renameSync` semantics + builtin `node:test`.

### Secondary (MEDIUM confidence)
- CONTEXT.md D-01..D-08 + 52-CONTEXT.md + REQUIREMENTS.md BIDIR-03/04/05/08 — locked decisions (authoritative for scope, not for code shape).

### Tertiary (LOW confidence)
- none — no WebSearch needed; phase is entirely intra-codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all builtins + existing exports verified at file:line; zero new deps confirmed.
- Architecture: HIGH — `adoptSession` is a mechanical inverse of `launchWorkItem` with every primitive already present and read.
- Pitfalls: HIGH — each grounded in a documented codebase comment (Pitfall 6 in dismiss.js, invariant in CONTEXT/REQUIREMENTS, HOME-isolation in find-session.test.js).
- Sanitization mechanics: MEDIUM — no reusable helper exists (verified); exact regex is Claude's Discretion (D-06).
- `saveState`/`.bak` compat: HIGH — proven independent code paths; regression test already exists.

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (stable — intra-codebase, no fast-moving external surface; re-verify only if `state.js`/`manager.js`/`dismiss.js` are refactored before planning).
