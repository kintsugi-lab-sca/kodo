# Architecture Patterns: Provider Abstraction

**Domain:** Task provider abstraction for an event-driven bridge
**Researched:** 2026-04-07
**Confidence:** HIGH (based on direct codebase analysis)

---

## Current State: Where Plane Leaks Through

The coupling is not uniform. Some components are deeply coupled; others are almost
provider-agnostic already. Understanding the gradient determines refactoring order.

### Coupling Gradient (tightest → loosest)

| File | Coupling Level | What It Does with Plane |
|------|---------------|------------------------|
| `src/plane/client.js` | Definition layer — not a leak | IS the Plane adapter |
| `src/check.js` | TIGHT | Instantiates PlaneClient, calls listWorkItems/listStates/labels — Plane-specific pagination and state group names (`'backlog'`, `'unstarted'`) |
| `src/hooks/stop.js` | TIGHT | Instantiates PlaneClient, calls listStates, updateWorkItem, createComment; references `config.plane.review_state` |
| `src/server.js` | TIGHT | Instantiates PlaneClient, interprets Plane-specific payload fields (`sequence_id`, `state_detail`, `state__name`, `x-plane-signature` header), calls listProjects to build identifier |
| `src/session/manager.js` | MEDIUM | Instantiates PlaneClient, calls resolveIdentifier + getWorkItemModule; uses `plane_id` and `plane_identifier` as session record keys |
| `src/hooks/session-start.js` | LOW | Only reads from `state.json`; Plane references are already stored strings (`plane_id`, `plane_identifier`) — no direct API calls |
| `src/session/state.js` | SCHEMA | The session schema uses `plane_id` and `plane_identifier` field names — a naming concern, not a behavior concern |
| `src/labels.js` | CONCEPTUAL | Logic is pure/generic but named after Plane; the label format is cross-provider compatible |

---

## Recommended Architecture

### The Adapter Boundary

The boundary sits between the provider's API surface and the normalized domain objects
that the rest of kodo operates on. Everything inside the adapter knows about Plane (or
GitHub, or ClickUp). Everything outside operates on `TaskItem`, `TaskState`, and
`TriggerEvent`.

```
External World                   kodo Core
─────────────────────────────────────────────────────────────
Plane webhook POST  ──►  ProviderAdapter.parseTriggerEvent()
                                    │
                              TriggerEvent
                                    │
                         server.js handleTrigger()
                                    │
                    ProviderAdapter.getTaskItem(ref)
                                    │
                               TaskItem
                                    │
                         manager.js launchTask()
                                    │
                    ProviderAdapter.postComment()
                    ProviderAdapter.updateState()
```

The `ProviderAdapter` interface is the single seam. Everything to the left of it is
provider-specific; everything to the right is generic.

### The `TaskProvider` Interface

```javascript
/**
 * @typedef {Object} TaskItem
 * @property {string} id           — Provider-internal ID (opaque to kodo core)
 * @property {string} ref          — Human-readable reference ("KL-42", "#123", etc.)
 * @property {string} title        — Task title
 * @property {string} [description] — Plain text description
 * @property {string[]} labels     — Label names (not IDs)
 * @property {string} projectId    — Provider-internal project ID
 * @property {string} projectRef   — Human-readable project reference
 */

/**
 * @typedef {Object} TriggerEvent
 * @property {'task_started'|'task_updated'|'manual'} type
 * @property {string} taskRef      — e.g. "KL-42", "#123"
 * @property {object} raw          — Original provider payload (for debugging)
 */

/**
 * Minimal interface every provider adapter must implement.
 * Methods are async; throw on unrecoverable errors.
 */
class TaskProvider {
  /** @returns {string} Provider slug, e.g. "plane", "github" */
  get name() { throw new Error('not implemented'); }

  /**
   * Parse an incoming event payload into a normalized TriggerEvent.
   * Return null if the event should be ignored.
   * @param {object} rawPayload
   * @returns {Promise<TriggerEvent|null>}
   */
  async parseTriggerEvent(rawPayload) {}

  /**
   * Verify an incoming webhook signature.
   * Return true if no secret is configured (treat as valid).
   * @param {string} rawBody
   * @param {object} headers
   * @returns {boolean}
   */
  verifySignature(rawBody, headers) {}

  /**
   * Resolve a task reference to a full TaskItem.
   * @param {string} ref  e.g. "KL-42"
   * @returns {Promise<TaskItem>}
   */
  async getTask(ref) {}

  /**
   * Resolve a local filesystem path for the project containing this task.
   * Returns null if no mapping is configured.
   * @param {TaskItem} task
   * @returns {Promise<string|null>}
   */
  async resolveProjectPath(task) {}

  /**
   * Fetch all tasks eligible for auto-launch (pending + kodo-labeled).
   * Used by kodo check. Return empty array if not supported.
   * @returns {Promise<TaskItem[]>}
   */
  async listPendingTasks() {}

  /**
   * Mark a task as in review (session completed).
   * @param {TaskItem} task
   */
  async markInReview(task) {}

  /**
   * Mark a task as done.
   * @param {TaskItem} task
   */
  async markDone(task) {}

  /**
   * Post a progress or completion comment.
   * @param {TaskItem} task
   * @param {string} body   — Plain text or HTML depending on provider capability
   */
  async postComment(task, body) {}
}
```

This interface is deliberately minimal. Advanced Plane capabilities (`getWorkItemModule`,
listing states by group) live inside the Plane adapter, not in the interface.

### Session Record Schema

The current `plane_id` / `plane_identifier` naming is a debt item but not a blocker.
Rename to `task_id` and `task_ref` during the refactor. The session record becomes:

```javascript
{
  workspace_ref: "workspace:42",
  session_id: "uuid",
  task_id: "abc-123",          // was plane_id
  task_ref: "KL-42",           // was plane_identifier
  provider: "plane",           // NEW: which adapter owns this session
  project_id: "proj-uuid",
  summary: "Fix auth bug",
  status: "running",
  started_at: "2026-04-07T...",
  project_path: "/Users/alex/dev/myproject"
}
```

Adding `provider` to the session record allows multi-provider operation: the stop hook
and orchestrator can instantiate the correct adapter for each session.

---

## Event Model Abstraction: Webhook vs Polling

The challenge is that `server.js` currently IS the Plane webhook handler. For providers
that use polling (ClickUp) or manual triggers, there is no incoming HTTP event.

### Recommended: Trigger Channels alongside the server

Introduce a `TriggerChannel` concept that abstracts how events enter the system. The HTTP
server becomes one channel; polling becomes another.

```
src/
  triggers/
    webhook.js      — HTTP server, provider-agnostic routing
    polling.js      — interval-based poll loop
    manual.js       — direct invocation (kodo launch KL-42)
```

**`webhook.js`** keeps the HTTP server structure but delegates to the registered adapter:

```javascript
async function handleRequest(req, res, adapter) {
  const body = await readBody(req);
  
  // Each adapter verifies its own signature format
  if (!adapter.verifySignature(body, req.headers)) {
    res.writeHead(401); return;
  }
  
  const event = await adapter.parseTriggerEvent(JSON.parse(body));
  if (event) dispatchTrigger(event, adapter);
  
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}
```

**`polling.js`** drives the same `dispatchTrigger` path:

```javascript
async function pollLoop(adapter, intervalMs) {
  const pending = await adapter.listPendingTasks();
  for (const task of pending) {
    dispatchTrigger({ type: 'task_started', taskRef: task.ref, raw: task }, adapter);
  }
}
```

**`dispatchTrigger(event, adapter)`** is the shared entry point: checks capacity, checks
for existing session, calls `launchTask()`. This is currently spread between
`handleTriggerState()` in `server.js` and `launchWorkItem()` in `manager.js` — extract
it into `src/core/dispatch.js`.

### How `kodo start` selects the right channel

Config drives channel selection:

```yaml
# ~/.kodo/config.json
provider: "plane"
providers:
  plane:
    trigger: "webhook"          # "webhook" | "polling" | "manual"
    poll_interval_sec: 60       # only relevant when trigger = polling
    base_url: "https://..."
    workspace_slug: "..."
    api_key_env: "PLANE_API_KEY"
    webhook_secret_env: "PLANE_WEBHOOK_SECRET"
    trigger_state: "In Progress"
    review_state: "In Review"
```

`kodo start` reads `provider` + `providers[provider].trigger`, then starts the
appropriate channel. No special-casing in the server code.

---

## Component Boundaries After Refactor

```
src/
  providers/
    base.js               — Abstract TaskProvider class (JSDoc interface)
    plane/
      index.js            — PlaneProvider (implements TaskProvider)
      client.js           — Raw REST client (moved from src/plane/client.js)
    github/               — Future: GitHubProvider
    local/                — Future: LocalProvider
  
  triggers/
    webhook.js            — HTTP server, provider-agnostic
    polling.js            — Poll loop
    manual.js             — CLI manual trigger
  
  core/
    dispatch.js           — dispatchTrigger(), capacity checks, duplicate detection
    labels.js             — parseKodoLabels() — already provider-agnostic
  
  session/
    manager.js            — launchTask(taskItem, adapter, opts) — no Plane import
    state.js              — renamed fields: task_id, task_ref, provider
    health.js             — unchanged (cmux-only)
  
  hooks/
    session-start.js      — reads state.json only — minimal change needed
    stop.js               — uses adapter from session.provider — main change
    install.js            — unchanged
  
  orchestrator/
    launch.js             — unchanged (cmux-only)
    prompt.md             — remove Plane-specific MCP references
  
  config.js               — extended for multi-provider config schema
  check.js                — uses provider.listPendingTasks() — simplified
  cli.js                  — add provider selection, trigger type display
```

### How `stop.js` finds its adapter

```javascript
// In stop.js, after finding the session record:
const { getProvider } = await import('../providers/index.js');
const adapter = getProvider(session.provider);  // "plane" → PlaneProvider instance

await adapter.markInReview(taskItem);
await adapter.postComment(taskItem, closingComment);
```

`getProvider(name)` is a simple registry:

```javascript
// src/providers/index.js
import { PlaneProvider } from './plane/index.js';

const registry = {
  plane: PlaneProvider,
};

export function getProvider(name) {
  const Cls = registry[name];
  if (!Cls) throw new Error(`Unknown provider: ${name}`);
  return new Cls();
}
```

---

## Refactoring Order (dependency analysis)

The dependency graph determines the safe refactoring sequence. Build bottom-up: define
the interface first, then adapt the existing implementation, then rewire consumers one
by one.

### Phase 1: Interface + Schema (no behavior change)

1. Create `src/providers/base.js` — JSDoc `TaskProvider` interface and JSDoc typedefs
   for `TaskItem`, `TriggerEvent`
2. Rename `state.js` fields: `plane_id` → `task_id`, `plane_identifier` → `task_ref`,
   add `provider` field. Update all callers in the same commit.
3. Add `provider` key to `config.json` schema and `config.js` loader.

**Risk:** Low. The rename is mechanical. No behavior changes.

### Phase 2: Wrap PlaneClient into PlaneProvider

4. Move `src/plane/client.js` → `src/providers/plane/client.js`
5. Create `src/providers/plane/index.js` that extends/wraps PlaneClient and implements
   `TaskProvider`: `parseTriggerEvent`, `verifySignature`, `getTask`, `resolveProjectPath`,
   `listPendingTasks`, `markInReview`, `markDone`, `postComment`
6. Create `src/providers/index.js` registry

**Risk:** Medium. PlaneProvider must pass the same behavior as the raw client calls.
Write tests against PlaneProvider directly using recorded fixtures from the real API.

### Phase 3: Rewire check.js (safest consumer to migrate first)

7. Replace `const plane = new PlaneClient()` + manual loops in `check.js` with
   `provider.listPendingTasks()`. `check.js` becomes ~60 lines.

**Risk:** Low. `check.js` is standalone, easy to test manually with `kodo check`.

### Phase 4: Rewire stop.js

8. Replace PlaneClient instantiation in `stop.js` with `getProvider(session.provider)`.
   Replace `listStates` + `updateWorkItem` calls with `adapter.markInReview(task)`.
   Replace `createComment` with `adapter.postComment(task, body)`.

**Risk:** Medium-High. Stop hook runs inside Claude Code's process and must not crash.
Test with a real session termination before declaring done.

### Phase 5: Rewire manager.js

9. Change `launchWorkItem(identifier, opts)` signature to
   `launchTask(taskItem, adapter, opts)`. The caller (dispatch.js) passes the already-
   resolved TaskItem.
10. Remove PlaneClient import from manager.js entirely.

**Risk:** Medium. manager.js is called from server.js, CLI, and orchestrator — all three
callers must be updated in the same change.

### Phase 6: Extract dispatch.js + rewire server.js

11. Extract `handleTriggerState` from server.js into `src/core/dispatch.js`.
12. Rewrite server.js webhook handler to call `adapter.parseTriggerEvent()` +
    `adapter.verifySignature()`, then call `dispatchTrigger()`.
13. server.js no longer imports PlaneClient.

**Risk:** Medium. The existing signature verification logic moves into PlaneProvider.
Test with a real Plane webhook before and after.

### Phase 7: Add polling trigger channel

14. Create `src/triggers/polling.js` — drives the same `dispatchTrigger()` path.
15. Update `kodo start` in cli.js to read `trigger` from config and start the
    appropriate channel.

**Risk:** Low for the structural change; Medium for correctness of the poll loop
(debounce, duplicate detection, backoff on errors).

### Phase 8: Cleanup

16. Remove Plane-specific references from `orchestrator/prompt.md`
17. Update `session-start.js` context template to use provider-neutral language
18. Update `kodo config` wizard to support multi-provider configuration

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Interface Creep from Day One
**What:** Adding methods to `TaskProvider` for every Plane capability during initial
abstraction (modules, sprints, estimates, sub-tasks).
**Why bad:** The interface becomes Plane-shaped, making other providers impossible to
implement cleanly. GitHub Issues has no modules; a local JSON provider has no states.
**Instead:** Keep the interface at the lowest common denominator. Provider-specific
capabilities stay inside the adapter and are invoked via optional duck-typing checks
(`if (typeof adapter.getModule === 'function')`), or simply not used when the provider
doesn't support them.

### Anti-Pattern 2: Provider-Aware Session Schema
**What:** Storing Plane-specific fields (e.g. `plane_module_id`, `plane_state_id`) in
the session record.
**Why bad:** Every provider would need its own schema fields; state.js becomes a union
type.
**Instead:** Session records store only the normalized fields. Provider-specific context
lives inside the adapter's own optional metadata or is re-fetched from the API when
needed.

### Anti-Pattern 3: God Registry
**What:** Putting all provider logic (instantiation, config validation, credential
loading) into `src/providers/index.js`.
**Why bad:** Adding a new provider requires modifying the registry file.
**Instead:** The registry is a simple name → class map. Each provider's `index.js`
handles its own config loading via the standard `loadConfig()`. The registry stays dumb.

### Anti-Pattern 4: Parallel Webhook Routes per Provider
**What:** Adding `/webhook/plane`, `/webhook/github` routes as providers multiply.
**Why bad:** External webhook URLs need to change when providers are added; impossible
to run two providers on the same URL pattern.
**Instead:** Keep a single `/webhook` endpoint. The registered adapter (one per `kodo
start` invocation) handles the route. If multi-provider webhook reception is needed in
the future, a routing layer reads a `X-Provider` header or uses path-based routing — but
that is out of scope for this milestone.

### Anti-Pattern 5: Async Interface Methods for Signature Verification
**What:** Making `verifySignature` return a Promise.
**Why bad:** The HTTP handler must respond within milliseconds; the signature check is
synchronous crypto. Async adds overhead and complicates error handling in the request
pipeline.
**Instead:** `verifySignature(rawBody, headers): boolean` is always synchronous. HMAC
is CPU-bound and cheap.

---

## Config Structure for Multi-Provider Support

The config grows to accommodate provider selection and per-provider credentials. The
structure below avoids breaking the existing flat `plane.*` keys by introducing a
`providers` namespace while keeping `provider` as a top-level selector.

```json
{
  "provider": "plane",
  "server": {
    "port": 9090
  },
  "claude": {
    "default_model": "claude-opus-4-5",
    "max_parallel": 3
  },
  "providers": {
    "plane": {
      "trigger": "webhook",
      "base_url": "https://plane.example.com",
      "workspace_slug": "myworkspace",
      "api_key_env": "PLANE_API_KEY",
      "webhook_secret_env": "PLANE_WEBHOOK_SECRET",
      "trigger_state": "In Progress",
      "review_state": "In Review",
      "projects": []
    },
    "github": {
      "trigger": "webhook",
      "org": "myorg",
      "token_env": "GITHUB_TOKEN",
      "webhook_secret_env": "GITHUB_WEBHOOK_SECRET",
      "trigger_label": "kodo",
      "repos": []
    },
    "local": {
      "trigger": "manual",
      "tasks_file": "~/.kodo/tasks.json"
    }
  }
}
```

Migration path: `config.js` reads the old flat `plane.*` keys and promotes them to
`providers.plane.*` on first load, then writes the new format. This makes the migration
transparent for existing installs.

---

## Scalability Considerations

kodo is a personal tool. Scalability concerns are about code complexity, not load.

| Concern | Current | After Refactor |
|---------|---------|----------------|
| Adding a new provider | Requires modifying 6 files | Add one file in `src/providers/` + update registry |
| Adding a new trigger channel | No concept exists | Add one file in `src/triggers/`, wire in `kodo start` |
| Session schema changes | One file to update | Same — state.js is already centralized |
| Running two providers simultaneously | Not supported | Not in scope; single `provider` config key is explicit |
| Config migration | N/A | Handled in config.js loader transparently |

---

## Sources

- Direct codebase analysis: `src/server.js`, `src/session/manager.js`, `src/hooks/stop.js`,
  `src/check.js`, `src/plane/client.js`, `src/hooks/session-start.js`
- Project context: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`
- Adapter pattern and interface segregation principle: standard OOP, no external source needed
- Confidence: HIGH — all findings are based on direct code reading, not inference
