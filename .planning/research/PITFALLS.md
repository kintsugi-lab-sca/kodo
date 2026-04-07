# Domain Pitfalls: Provider Abstraction Refactor

**Domain:** CLI tool provider abstraction — wrapping a concrete API client behind a generic interface
**Project:** kodo v0.2
**Researched:** 2026-04-07
**Confidence:** HIGH — grounded in the specific codebase, not generic advice

---

## Critical Pitfalls

Mistakes that cause regressions in working functionality or force a rewrite of the abstraction.

---

### Pitfall 1: Designing the Interface Around One Provider

**What goes wrong:** You look at `PlaneClient` methods and mirror them 1:1 into `TaskProvider`. The interface becomes Plane-shaped: `resolveIdentifier("KL-42")`, `listWorkItems(projectId)`, `updateWorkItem(projectId, workItemId, updates)`. GitHub Issues doesn't have project IDs the same way. ClickUp has spaces, folders, lists. Local JSON has none of these. Every future adapter has to fake Plane concepts.

**Why it happens:** Plane is the only working provider. It's the path of least resistance to just formalize what already exists.

**Consequences:** The abstraction doesn't abstract. Adapters end up with stub methods that throw "not supported." Callers can't stay generic because they need to know which provider they're talking to for edge cases. The interface has to be redesigned when the second provider arrives — exactly when the cost is highest.

**Prevention:**
- Start from the callers (server.js, manager.js, hooks, check.js), not from PlaneClient. Ask: what does each caller actually need? The answer is the interface.
- Callers need: get a task by some identifier, update a task's status, add a comment, list tasks with a label, resolve a short reference to a full task object.
- None of those require `projectId` to be a parameter — that's a Plane implementation detail. The adapter holds that knowledge internally.
- Test the interface design against a hypothetical GitHub Issues adapter before committing. Can you implement every method without faking a concept?

**Warning signs:**
- The interface has parameters named `projectId`, `workspaceSlug`, or `sequenceId`
- Adapter methods take more arguments than the interface signature specifies (adapter extends the call, leaking provider details to callers)
- You write `if (provider === 'plane') { ... }` anywhere in server.js or manager.js

**Phase that must address it:** Interface definition phase — get this wrong and every subsequent phase pays the price.

---

### Pitfall 2: Breaking the Webhook Handler While Abstracting the Client

**What goes wrong:** The webhook handler in `server.js` is deeply coupled to Plane's payload shape: `payload.event`, `payload.action`, `data.state?.name`, `data.state_detail?.name`, `data.state__name`, `data.labels`, `data.project`. Abstracting `PlaneClient` doesn't automatically decouple the webhook handler. The handler still parses Plane-specific JSON and passes Plane-specific data downstream.

**Why it happens:** People abstract the HTTP client layer (the `PlaneClient` class) but forget that the webhook shape is also provider-specific. It's a separate coupling point.

**Consequences:** After the refactor, the "provider" is abstracted but kodo still only works with Plane because the server parses Plane payloads. GitHub Issues webhooks have a completely different shape (`action: "labeled"`, `issue.state`, `issue.labels[].name`). The refactor looks complete but isn't.

**Prevention:**
- The abstraction boundary must include payload normalization. Each provider's webhook adapter (or polling adapter) is responsible for translating raw events into a canonical `TaskEvent` shape before handing off to the core.
- Define a canonical event shape: `{ type: 'task.updated', taskId, providerId, metadata }`. The Plane adapter normalizes to this. Future adapters normalize to this.
- The trigger mechanism (webhook vs. polling vs. manual) is a separate dimension from the provider. Model them separately.

**Warning signs:**
- `server.js` still contains `payload.event`, `payload.action`, or any Plane-specific field names after the refactor
- The webhook route is `/plane/webhook` instead of `/webhook` with provider-specific handler registration
- `handleWebhook()` receives raw payload and branches on field names

**Phase that must address it:** Server decoupling phase — must be done at the same time as client abstraction, not after.

---

### Pitfall 3: The Leaky Identifier Problem

**What goes wrong:** `manager.js` currently calls `plane.resolveIdentifier("KL-42")` which encodes Plane's `PROJECTPREFIX-NUMBER` convention. The returned object is `{ project, workItem }` with Plane-specific shapes. If the abstraction makes `resolveIdentifier` a generic interface method but keeps returning a Plane-shaped object, callers still depend on `workItem.id`, `workItem.name`, `workItem.description_html`, `project.id`, `project.identifier`. The abstraction leaks the provider model.

**Why it happens:** Returning the raw provider response is convenient. JSDoc types can be vague (`@returns {Promise<any>}`). No one notices the leak because tests are minimal.

**Consequences:**
- `manager.js` accesses `workItem.description_html` — GitHub Issues returns `body` (markdown), not HTML. Local JSON might return `description` (plain text). The field name is provider-specific.
- `buildClaudeCommand()` calls `stripHtml()` on the description — this assumption is baked into a layer that should be provider-agnostic.
- Every caller that touches a task object is implicitly coupled to Plane's field names.

**Prevention:**
- Define a canonical `Task` shape in the interface: `{ id, title, description, url, labels, state, projectId, projectPath }`. All adapters normalize to this. Description is always plain text — HTML stripping happens inside the adapter, not in manager.js.
- Keep provider-internal objects (Plane's `workItem`, GitHub's `issue`) inside the adapter boundary. Never let them escape to callers.
- `resolveIdentifier` becomes `resolveTask(ref)` returning a canonical `Task`. The format of `ref` is provider-specific (string identifier, number, URL) — the adapter knows how to parse it.

**Warning signs:**
- `manager.js` calls `stripHtml()` on task description
- `manager.js` accesses `workItem.description_html` or any `_html` field
- The canonical task type has optional fields that only some providers fill (optional everywhere = required nowhere = the interface doesn't actually specify behavior)

**Phase that must address it:** Interface definition — must define canonical data shapes alongside method signatures.

---

### Pitfall 4: Over-Abstracting the Label System

**What goes wrong:** Labels are a first-class concept in kodo (`kodo`, `kodo:sonnet`, `kodo:haiku`, `kodo:yolo`). The current implementation has a brittle label resolution problem (CONCERNS.md issue #3): labels arrive as IDs or objects depending on Plane API version, resolution is duplicated across server.js and check.js. The temptation during abstraction is to put label resolution inside the `TaskProvider` interface as a method. This is wrong.

**Why it happens:** Labels exist in all providers (Plane labels, GitHub labels, ClickUp tags), so it feels like a provider concern. But label normalization and kodo-label parsing are application logic, not provider logic.

**Consequences:** The interface method `resolveLabels(projectId, labelIds)` is Plane-specific (GitHub labels are embedded in issue objects directly, no separate resolution needed). Adapters for simpler providers implement a no-op or stub. The provider interface carries Plane's complexity as a requirement.

**Prevention:**
- The adapter's responsibility is to return `labels: string[]` (names, not IDs) as part of the canonical `Task` shape. Label resolution happens inside the adapter before returning.
- `parseKodoLabels()` stays in application code, operating on normalized label names. It never knows about label IDs or API resolution.
- The interface contract: "labels are always resolved to name strings." Each adapter enforces this internally.

**Warning signs:**
- `TaskProvider` interface has a `resolveLabels()` or `listLabels()` method
- Application code (server.js, check.js) still calls any label resolution method after the refactor
- The adapter returns label IDs anywhere in the canonical task shape

**Phase that must address it:** Interface definition + adapter implementation phases simultaneously.

---

### Pitfall 5: State.json Couples Sessions to Plane Identifiers

**What goes wrong:** `state.json` stores `plane_id`, `plane_identifier`, and `project_id` as top-level fields in every session record. After abstraction, these fields need to survive but their semantics change — they're no longer Plane-specific. If you rename them during the refactor (to `provider_id`, `task_ref`), every existing session in `state.json` breaks. If you don't rename them, the code is confusing and the second provider can't store its own identifier format cleanly.

**Why it happens:** State schema evolution is unglamorous and easy to defer. The refactor focuses on code structure, not data migration.

**Consequences:**
- `kodo check` reads state and tries to match sessions to live tasks — if field names changed but existing state wasn't migrated, sessions become invisible or orphaned.
- Health checker reads `plane_identifier` to build labels/notifications — if the field is gone, health checks silently lose context.
- The race condition in state.js (CONCERNS.md issue #1) makes migration riskier: a migration that reads-modifies-writes the whole state file has a higher collision window.

**Prevention:**
- Migrate the state schema in one explicit step: read existing state, transform records (rename `plane_id` → `task_id`, `plane_identifier` → `task_ref`, add `provider: 'plane'`), write back atomically.
- Do this migration before or alongside the code refactor, never after.
- Add a `schema_version` field to state.json to make future migrations detectable.
- The health checker, check.js, and stop hook must all be updated to use the new field names in the same PR — never leave mixed references.

**Warning signs:**
- `state.json` records have both `plane_id` and `task_id` fields (transition state leaked to production)
- Health checker logs mention `undefined` for session identifiers
- `kodo check` counts 0 active sessions after the refactor even though workspaces exist in cmux

**Phase that must address it:** State migration must be its own explicit step, not a side effect of the code refactor.

---

### Pitfall 6: The Stop Hook Updates Plane Directly — Easy to Miss

**What goes wrong:** `src/hooks/stop.js` updates Plane task state when a Claude session ends. This is currently a direct `PlaneClient` call. It's easy to focus abstraction effort on server.js and manager.js (the launch path) while forgetting that the stop hook is the completion path. If the stop hook still calls PlaneClient directly, the abstraction is incomplete: launching goes through the provider interface but completion doesn't.

**Why it happens:** The stop hook is triggered by Claude itself (not by kodo server), so it's less visible during refactoring. It lives in `hooks/` not `session/` or `server/`, and it's only invoked at session end.

**Consequences:**
- Stop hook hardcodes Plane's state transition logic (maps Claude exit reason to a Plane state name)
- For future providers, the stop hook must know which provider the session used — currently impossible because sessions don't store the provider
- If `provider` is not stored in state.json, the stop hook can't look up the right adapter

**Prevention:**
- Store `provider: 'plane'` in each session record during launch (part of the state schema migration above).
- Stop hook reads the session record, gets the provider name, instantiates the right adapter via the provider registry, calls `adapter.completeTask(taskId, outcome)`.
- `SessionStart` hook has the same pattern — it reads Plane IDs from state. Same fix applies.

**Warning signs:**
- `stop.js` contains `import { PlaneClient }` after the refactor
- Session records in state.json don't have a `provider` field
- Stop hook hardcodes state names like `"Done"` or `"Cancelled"` without going through the adapter

**Phase that must address it:** Hook decoupling phase — should happen in parallel with manager.js decoupling, not as an afterthought.

---

## Moderate Pitfalls

---

### Pitfall 7: Provider Registry Over-Engineering

**What goes wrong:** Building a dynamic plugin registry with discovery, lazy loading, and hot-swappable providers when there will be exactly one provider at runtime (the one in config). This is a common refactor over-engineering trap: adding infrastructure for future extensibility that never gets used and adds complexity that makes the current code harder to follow.

**Prevention:**
- A simple registry is a map of strings to factory functions: `{ plane: () => new PlaneAdapter(config) }`. `loadProvider(name)` returns the adapter for the configured name.
- No dynamic discovery, no plugin system, no factory patterns with DI containers. Static import + string lookup is sufficient.
- The registry file is ~20 lines. If it's longer, it's over-engineered.

**Warning signs:**
- Registry uses `require()` or dynamic `import()` to load adapters by filename
- There's an `AdapterBase` class with lifecycle hooks (initialize, teardown, etc.) when simple factory functions suffice
- The registry supports multiple simultaneous providers when config only ever picks one

**Phase that must address it:** Provider registry phase — timebox it. If it takes more than 2 hours, simplify.

---

### Pitfall 8: Untested Interface Contract Leads to Silent Regression

**What goes wrong:** The current codebase has zero tests for `PlaneClient`, `server.js`, and `manager.js` (CONCERNS.md issue #9). If the refactor doesn't add tests for the interface contract (not Plane-specific behavior, but the contract each caller depends on), then any regression in the adapter is silent. The refactor appears to work but subtly changes behavior.

**Prevention:**
- Before touching any code, write integration tests for the current working behavior using the real PlaneClient (or a recorded fixture of Plane API responses). These are regression anchors.
- After defining the interface, write tests that operate on the interface, with a mock adapter. These verify the callers work correctly for any adapter.
- The PlaneAdapter tests verify Plane-specific normalization: that `description_html` gets stripped to plain text, that label IDs get resolved to names, that state fields are normalized correctly.

**Warning signs:**
- Test suite passes but no test imports the interface (tests only test concrete classes)
- No test for the `resolveTask` flow end-to-end with a mock adapter
- Tests were not added before starting the refactor

**Phase that must address it:** Must begin test writing before the first refactor PR. Non-negotiable given the zero-coverage starting point.

---

### Pitfall 9: `check.js` Has Its Own Label Resolution Logic — Separate Coupling Point

**What goes wrong:** `src/check.js` implements its own label resolution with `listWorkItems` and inline label parsing. It's a separate coupling point from `server.js`. Abstracting the server but leaving check.js with its own PlaneClient instance means the tool still can't switch providers for the `kodo check` command.

**Why it happens:** check.js is the "vigilante" — it runs without triggering Claude sessions, so it's easy to treat it as a separate tool rather than part of the abstraction scope.

**Consequences:**
- `kodo check` fails or reports wrong data if provider is switched
- Two separate paths to list tasks with kodo labels, both needing maintenance

**Prevention:**
- check.js should call the provider adapter's method for listing tasks matching kodo labels. This is likely a `listPendingTasks()` or `findTasksWithLabel(label)` method on the interface.
- check.js should never construct a PlaneClient or know about Plane projects after the refactor.

**Warning signs:**
- `check.js` still imports from `'../plane/client.js'` after the refactor
- check.js has its own label resolution logic separate from the adapter
- `kodo check` output format differs between providers for the same underlying data

**Phase that must address it:** check.js decoupling phase — explicitly list it in scope, don't assume it'll be handled by the server refactor.

---

## Minor Pitfalls

---

### Pitfall 10: Trigger Mechanism Confusion

**What goes wrong:** Mixing trigger mechanism (webhook vs. polling vs. manual) with provider identity (Plane vs. GitHub vs. ClickUp). Plane uses webhooks. GitHub uses webhooks too. ClickUp might need polling. Local mode uses manual trigger. These are orthogonal.

**Prevention:**
- Trigger mechanisms are separate from providers. The `TaskProvider` interface defines how to read/write tasks. The trigger is how kodo learns about new tasks. A provider config specifies both: `{ type: 'plane', trigger: 'webhook' }`.
- Don't force every provider to support webhook — make trigger mechanism pluggable separately.

**Warning signs:**
- `TaskProvider` interface has a `startListening()` or `onEvent()` method — that's trigger logic, not provider logic
- Provider adapters contain HTTP server code

**Phase that must address it:** Architecture design phase — establish this separation before building.

---

### Pitfall 11: Module Context Is Plane-Specific But Valuable

**What goes wrong:** The `getWorkItemModule()` method is Plane-specific (modules don't exist in GitHub Issues the same way). If the canonical task shape doesn't have a `context` or `group` field, adapters for module-less providers can't provide equivalent grouping information, and kodo loses that context for Claude.

**Prevention:**
- Include an optional `group: string | null` field in the canonical task shape. Plane adapter fills it from module name. GitHub adapter might fill it from milestone or project board column. Local adapter might fill it from a folder or tag.
- Don't call it `module` in the interface — that's Plane terminology.

**Warning signs:**
- Canonical task shape has no grouping/context field
- manager.js hard-codes module lookup as a separate PlaneClient call after resolving the task

**Phase that must address it:** Interface definition phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Interface definition | Mirroring PlaneClient 1:1 (Pitfall 1) | Start from callers, not PlaneClient |
| Interface definition | Leaky identifier/task shapes (Pitfall 3) | Define canonical Task type explicitly |
| Interface definition | Label resolution in interface (Pitfall 4) | Labels are adapter internals, not interface methods |
| Interface definition | Module/grouping lost (Pitfall 11) | Add `group` field to canonical task shape |
| Server decoupling | Webhook payload still Plane-shaped (Pitfall 2) | Normalize at event ingestion boundary |
| Manager decoupling | Stop/start hooks forgotten (Pitfall 6) | Explicitly scope all hook files |
| State schema migration | Plane-specific field names in state.json (Pitfall 5) | Migrate schema as a dedicated step |
| check.js decoupling | check.js has separate coupling (Pitfall 9) | Explicitly list check.js in the refactor scope |
| Provider registry | Over-engineering (Pitfall 7) | String map + factory functions only |
| Testing | Zero coverage means silent regression (Pitfall 8) | Write regression anchors before first code change |
| Trigger mechanism | Conflating trigger with provider (Pitfall 10) | Separate concerns from the start |

---

## Summary of Priority

**Must get right before writing any code:**
1. Interface designed from callers, not from PlaneClient (Pitfall 1)
2. Canonical Task shape with normalized description, labels as strings, optional group (Pitfalls 3, 4, 11)
3. State schema migration plan with `provider` field (Pitfall 5)

**Must include in scope explicitly — easy to forget:**
4. Webhook payload normalization separate from client abstraction (Pitfall 2)
5. Stop hook and SessionStart hook decoupling (Pitfall 6)
6. check.js decoupling (Pitfall 9)

**Architecture guardrails:**
7. Simple provider registry, no plugin infrastructure (Pitfall 7)
8. Trigger mechanism separate from provider identity (Pitfall 10)
9. Tests before refactor, not after (Pitfall 8)
