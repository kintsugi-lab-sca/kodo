# Feature Landscape: TaskProvider Interface

**Domain:** Task provider abstraction for kodo (bridge between task managers and Claude Code)
**Researched:** 2026-04-07
**Confidence:** HIGH (based on live API docs + codebase analysis)

---

## What kodo actually does with a task provider

Before listing operations, here is the exhaustive set of what the current system does with Plane — this drives the interface requirements:

1. **Trigger detection** — Receive event (webhook) when a task enters a trigger state ("In Progress")
2. **Label inspection** — Read labels on the task to decide if kodo should act (presence of "kodo" label) and which model/flags to use
3. **Task hydration** — Fetch the full task: title, description, ID, sequence identifier, project
4. **Identifier resolution** — Convert a human-readable ref ("KL-42") to internal IDs
5. **Group/module lookup** — Find which module/epic/milestone the task belongs to (for workspace naming)
6. **State transition** — Move task to "In Review" when session ends
7. **Comment posting** — Post progress updates and closing summaries as comments on the task
8. **Pending task count** — List tasks that have the kodo label and are in a "pending" state (for the vigilante check)
9. **State listing** — Enumerate available states in a project to find the ID for a named state

---

## Table Stakes

Operations that **every provider adapter must implement**. Without these, kodo cannot function at all.

| Operation | Method signature | Why required |
|-----------|-----------------|--------------|
| Get single task | `getTask(taskRef)` | Trigger handler needs full task details |
| Update task state | `updateTaskState(taskRef, stateName)` | Stop hook moves task to "In Review" |
| Add comment | `addComment(taskRef, text)` | Progress updates, session summaries |
| List tasks by filter | `listPendingTasks()` | Vigilante check counts workable backlog |
| Parse trigger signal | `parseTriggerEvent(rawPayload)` | Server/polling detects when to act |
| Parse labels/tags | `parseKodoConfig(task)` | Determine if task has kodo label + model |
| Resolve human ref | `resolveRef(humanRef)` | CLI `kodo launch KL-42` style invocation |

### Normalized task object (what every adapter must return)

Every provider returns tasks in a different shape. The interface must normalize to:

```js
{
  id: string,           // provider-internal opaque ID
  ref: string,          // human-readable ("KL-42", "#42", "task_abc123")
  title: string,
  description: string,  // plain text (strip HTML if needed)
  state: string,        // normalized state name ("in_progress", "in_review", etc.)
  labels: string[],     // array of label/tag names (NOT IDs)
  projectId: string,    // internal project ID
  groupName: string|null, // module/milestone/sprint name (or null)
  url: string,          // deep link to task in the UI
}
```

**Key design decision:** Labels arrive as IDs from Plane webhooks (must resolve) and as name strings from GitHub. The interface should normalize to names before returning. The adapter is responsible for this resolution, not the caller.

---

## Provider-Specific Features

Capabilities that only some providers have. These should NOT be part of the core interface — they are adapter extensions or configuration.

### Trigger mechanism (varies wildly)

| Provider | Mechanism | Notes |
|----------|-----------|-------|
| Plane CE | Webhook (HMAC-SHA256 signed) | Event: `issue.updated` or `work_item.updated`, fires on state change |
| GitHub Issues | Webhook | Event: `issues`, action `labeled` (no native "state") — trigger must be label-based, not state-based |
| ClickUp | Webhook (`taskStatusUpdated`) OR polling | Has both; polling needed if webhook infra not available; supports `history_items` with before/after |
| Local file | Polling only | File watcher or cron reads a JSON/Markdown file |

**Implication:** The trigger concept must be abstracted. Providers expose a trigger via either:
- `onWebhook(rawPayload) → TriggerEvent | null` — for webhook-capable providers
- `pollForTriggers() → TriggerEvent[]` — for polling-only providers

Both return the same `TriggerEvent` shape. The server/check decides which to call based on provider config.

### State model (fundamentally different)

| Provider | State model | Notes |
|----------|-------------|-------|
| Plane CE | Named states per project, UUID-addressed, grouped into categories (unstarted/started/completed/cancelled) | Must call `listStates()` to resolve name → ID |
| GitHub Issues | Binary only: `open` / `closed` | No "In Progress" state; workaround is label-based ("status: in-progress") or Projects v2 |
| ClickUp | Status names per Space/List, string-addressed | Status is a string in the API, no separate lookup needed |
| Local file | Arbitrary field in the file | Developer defines the schema |

**Implication:** `updateTaskState` takes a logical state name ("in_review"). Adapters map this to whatever the provider needs. GitHub adapter may add a label instead of changing state. This mapping lives in provider config, not the interface.

### Identifier scheme

| Provider | Identifier format | Resolution path |
|----------|------------------|-----------------|
| Plane CE | `KL-42` (project prefix + sequence) | List projects → match prefix → get by sequence_id |
| GitHub Issues | `#42` or `owner/repo#42` | Direct: `GET /repos/{owner}/{repo}/issues/42` |
| ClickUp | `abc123xyz` (task ID) or custom ID | Direct by task_id; or by custom_task_ids parameter |
| Local file | Filename or frontmatter field | Scan directory |

GitHub and ClickUp have direct lookup by numeric/opaque ID — much simpler than Plane's two-step resolution. `resolveRef` is still table stakes, but the complexity differs.

### Group/module support

| Provider | Equivalent concept | API support |
|----------|-------------------|-------------|
| Plane CE | Modules (like epics) | Requires separate API call: list module-issues |
| GitHub Issues | Milestones | Included in issue object directly |
| ClickUp | Folders or Lists | Included in task response (`list.name`, `folder.name`) |
| Local file | Frontmatter field | Direct |

Plane is the only provider that requires an extra round-trip to find the module. GitHub and ClickUp include group context in the task response itself. `getTask` should always return `groupName` if available — adapters should populate this from whatever the provider includes.

### Comment format

| Provider | Format | Notes |
|----------|--------|-------|
| Plane CE | HTML (`comment_html`) | Current stop hook sends HTML with `<h3>`, `<pre>`, etc. |
| GitHub Issues | Markdown (`body`) | `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` |
| ClickUp | Plain text (`comment_text`) | No rich formatting in the API |

**Implication:** `addComment(taskRef, text)` receives plain text from the caller. The adapter formats it appropriately (wraps in HTML for Plane, markdown for GitHub, plain for ClickUp). This is an adapter responsibility, not the interface's.

### Label resolution requirement

| Provider | Webhook delivers labels as | Requires resolution? |
|----------|---------------------------|----------------------|
| Plane CE | Sometimes UUIDs, sometimes objects | YES — `resolveLabels()` already exists |
| GitHub Issues | Full label objects always (`{id, name, color}`) | NO |
| ClickUp | Tag name strings always | NO |

---

## Anti-Features

Things to explicitly NOT abstract or build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Abstract the full task lifecycle (create, delete, reorder) | kodo only reads and modifies tasks it was told to work on — it is not a task manager | Only expose the 7 operations kodo actually uses |
| Provider-level authentication management | Config wizard already handles credentials | Keep credentials in the existing config.js system; provider reads from there |
| Cross-provider state mapping table | Too much configuration surface for a personal tool | Per-provider config: `trigger_state`, `review_state` as name strings |
| Pagination abstraction | `listPendingTasks()` only needs to count; 100 items is sufficient for a personal tool | Keep `per_page: 100` hardcoded per adapter, do not build cursor pagination |
| Retry/backoff logic in the interface | Each provider has different rate limits | Each adapter handles its own errors; the interface is not a resilience layer |
| Provider auto-detection | kodo is configured explicitly | Provider type is always in config; no detection needed |
| HTML-to-Markdown conversion in the interface | GitHub sends Markdown, Plane sends HTML | Normalizing to one format is premature; adapters output plain text in `description`; comment formatting is per-adapter |
| GitHub Projects v2 support | Separate product from Issues, uses GraphQL, massive added complexity | Not needed for MVP adapter; document as out of scope |

---

## Feature Dependencies

```
parseTriggerEvent → parseKodoConfig (labels must be resolved to names first)
resolveRef → getTask (resolveRef returns the canonical ID used by getTask)
getTask → updateTaskState (need task ID)
getTask → addComment (need task ID)
listPendingTasks → parseKodoConfig (filter by kodo label)
```

---

## Operation-by-Operation API Comparison

### getTask

| Provider | Endpoint | Round-trips | Notes |
|----------|----------|------------|-------|
| Plane CE | `GET /projects/{pid}/work-items/{id}/?expand=state_detail,project_detail` | 1 | Module requires separate call |
| GitHub Issues | `GET /repos/{owner}/{repo}/issues/{number}` | 1 | Milestone included; labels included as objects |
| ClickUp | `GET /task/{task_id}?include_markdown_description=true` | 1 | List/Folder name included; tags included as strings |

### updateTaskState

| Provider | Endpoint | How state is addressed |
|----------|----------|----------------------|
| Plane CE | `PATCH /projects/{pid}/work-items/{id}/` body: `{state: uuid}` | UUID — requires prior `listStates()` call |
| GitHub Issues | `PATCH /repos/{owner}/{repo}/issues/{number}` body: `{state: "open"|"closed"}` | Binary only; adapter may add label as workaround |
| ClickUp | `PUT /task/{task_id}` body: `{status: "name string"}` | Direct name — no lookup needed |

### addComment

| Provider | Endpoint | Body field |
|----------|----------|-----------|
| Plane CE | `POST /projects/{pid}/work-items/{id}/comments/` | `comment_html` |
| GitHub Issues | `POST /repos/{owner}/{repo}/issues/{number}/comments` | `body` (Markdown) |
| ClickUp | `POST /task/{task_id}/comment` | `comment_text` (plain) |

### listPendingTasks

| Provider | Approach | Notes |
|----------|----------|-------|
| Plane CE | List work items + filter by state group (`unstarted`) + filter by kodo label IDs | 3 calls: listWorkItems, listStates, listLabels |
| GitHub Issues | `GET /repos/{owner}/{repo}/issues?labels=kodo&state=open` | 1 call; no "pending vs in-progress" distinction without Projects |
| ClickUp | `GET /list/{list_id}/task?statuses[]=todo&tags[]=kodo` | 1 call; per-list, may need multiple lists |

### parseTriggerEvent (webhook)

| Provider | Event type | Trigger condition |
|----------|-----------|------------------|
| Plane CE | `issue` or `work_item`, action `updated` | `state.name` matches `trigger_state` config |
| GitHub Issues | `issues`, action `labeled` | Label name is `kodo` AND issue is open |
| ClickUp | `taskStatusUpdated` | `history_items[].after.status` matches `trigger_state` config |

**Critical difference for GitHub:** GitHub Issues has no "state change to In Progress" concept. The trigger for GitHub must be label-based: adding the `kodo` label to an open issue is the trigger. This means the trigger event semantics differ — the interface must allow for this without forcing providers to fake a state model.

---

## MVP Recommendation for Interface

Prioritize in this order:

1. **Normalize the 7 table-stakes operations** into a `TaskProvider` interface (JSDoc typed)
2. **Refactor PlaneClient** to implement the interface — validates the contract with real usage
3. **Keep trigger mechanism pluggable** — adapter declares `triggerMechanism: 'webhook' | 'polling'` and implements the appropriate method(s)
4. **Per-provider config block** — each adapter reads its own config section, not a shared schema (avoids over-abstraction)

Defer:
- GitHub Issues adapter: interface first, then adapter
- ClickUp adapter: interface first, then adapter
- Local file adapter: simplest to implement once interface is stable

---

## Sources

- Plane API: https://developers.plane.so/api-reference/issue/overview
- Plane Webhooks: https://developers.plane.so/dev-tools/intro-webhooks
- GitHub Issues REST API: https://docs.github.com/en/rest/issues/issues
- GitHub Webhook Events: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- ClickUp Get Tasks: https://developer.clickup.com/reference/gettasks
- ClickUp Update Task: https://developer.clickup.com/reference/updatetask
- ClickUp Create Comment: https://developer.clickup.com/reference/createtaskcomment
- ClickUp Webhooks: https://developer.clickup.com/docs/webhooks
