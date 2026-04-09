# Phase 3: Consumer Rewiring - Research

**Researched:** 2026-04-09
**Domain:** Internal consumer migration from PlaneClient to TaskProvider abstraction
**Confidence:** HIGH

## Summary

This phase rewires four consumer files (`check.js`, `stop.js`, `manager.js`, `session-start.js`) to use the `TaskProvider` abstraction via the registry instead of importing `PlaneClient` directly. The provider infrastructure (interface, PlaneProvider adapter, registry) is fully built from Phases 1-2. The state schema already defines generic fields (`task_id`, `task_ref`, `provider`). This is a straightforward refactoring phase — no new libraries, no new patterns to invent.

The main technical risk is **stop.js**, which runs inside Claude's process where exceptions are silently swallowed. Defensive error handling is critical there. The other consumers are simpler: check.js replaces ~40 lines of manual Plane querying with a single `listPendingTasks()` call, manager.js replaces `PlaneClient.resolveIdentifier()` with `provider.getTask()`, and session-start.js just renames field references.

**Primary recommendation:** Replace all `PlaneClient` imports in consumer files with `getProvider()` from the registry, using `initRegistry()` at entry points and the `TaskProvider` interface methods exclusively.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- stop.js: Claude decides comment format (Markdown, adapter converts), TaskItem acquisition strategy, defensive error mechanism, provider resolution
- check.js: `listPendingTasks()` covers all filtering; check.js only counts `array.length`. Output with direct ANSI escape codes (no external deps). Claude decides no-API-key handling
- manager.js: Prompt uses `task.description` (already Markdown) directly — no stripHtml. Claude decides ref resolution sequence, groups[] usage, labels in manual launch, session state fields
- session-start.js: Provider-agnostic instructions (no "Plane" mentions). Dynamic MCP reference via `providers.{name}.mcp_hint`. Fields renamed: `plane_identifier` -> `task_ref`, `plane_id` -> `task_id`

### Claude's Discretion
- Exact Markdown comment format in stop.js
- TaskItem acquisition in stop.js (getTask vs state partial)
- Defensive error handling in stop.js
- Provider resolution in stop.js (session.provider vs config)
- No-provider-available handling in check.js
- Ref resolution sequence in manager.js
- Session state fields in manager.js
- groups[] usage for modules
- Labels kodo in manual launch

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REWI-01 | `check.js` uses `TaskProvider` instead of `PlaneClient` | Replace `countPendingKodoTasks()` (lines 99-141) with `provider.listPendingTasks()`. Remove imports of PlaneClient, parseKodoLabels, resolveLabels. Add initRegistry() + getProvider(). |
| REWI-02 | `stop.js` reads `session.provider` and uses correct adapter | Replace `new PlaneClient()` (line 73) with `getProvider(session.provider)`. Use `provider.addComment()` for closing comment (Markdown instead of HTML). Use `provider.updateTaskState()` for state change. Wrap each provider call in try-catch. |
| REWI-03 | `manager.js` uses `TaskProvider` to resolve refs and get tasks | Replace `plane.resolveIdentifier(identifier)` with `provider.getTask(identifier)`. TaskItem already has all needed fields (id, ref, title, description, labels, groups, projectId). |
| REWI-05 | `session-start.js` uses generic state fields (task_id, task_ref) | Replace `session.plane_identifier` with `session.task_ref`, `session.plane_id` with `session.task_id`. Use `providers.{provider}.mcp_hint` from config for dynamic MCP instructions. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:test | Node 20+ built-in | Test runner | Already used in project (`node --test test/**/*.test.js`) |
| node:crypto | Built-in | N/A for this phase | Already in provider layer |

### Supporting
No new libraries needed. This phase only rewires existing imports.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct ANSI codes | chalk/kleur | CONTEXT.md locked: use raw `\x1b[...m` codes, zero deps |

## Architecture Patterns

### Current Consumer → Provider Coupling Map

Each consumer currently imports `PlaneClient` from `../plane/client.js` and calls Plane-specific methods directly. After rewiring, all consumers go through the registry:

```
BEFORE:                          AFTER:
consumer → PlaneClient           consumer → registry.getProvider() → TaskProvider
         → config.plane.*                 → config.provider (name only)
         → plane-specific fields          → generic TaskItem fields
```

### Pattern 1: Registry Entry Point
**What:** Every consumer that needs a provider calls `initRegistry()` once at startup, then `getProvider(name)` for the instance.
**When to use:** Any file that performs provider operations.
**Example:**
```javascript
// Source: src/providers/registry.js (existing code)
import { initRegistry, getProvider } from '../providers/registry.js';

// At startup (in main() or top of async flow)
await initRegistry();

// Get provider — name from config or session
const config = loadConfig();
const provider = getProvider(config.provider); // 'plane'
```

### Pattern 2: Defensive Provider Calls (stop.js)
**What:** Each provider operation wrapped in individual try-catch since stop.js runs in Claude's process where uncaught errors are swallowed silently.
**When to use:** Only in stop.js hook.
**Example:**
```javascript
// Each operation isolated — failure in one doesn't block others
try {
  await provider.addComment(task, commentMarkdown);
  console.error(`[kodo] Closing comment posted for ${session.task_ref}`);
} catch (err) {
  console.error(`[kodo] Error posting comment: ${err.message}`);
}

try {
  await provider.updateTaskState(task, config.providers[session.provider].states.review);
  console.error(`[kodo] ${session.task_ref} → review`);
} catch (err) {
  console.error(`[kodo] Error updating task state: ${err.message}`);
}
```

### Pattern 3: TaskItem as Session Seed
**What:** `manager.js` gets a `TaskItem` from `provider.getTask(ref)` and extracts generic fields for the session state.
**When to use:** When launching a new session.
**Example:**
```javascript
const provider = getProvider(config.provider);
await provider.init();
const task = await provider.getTask(identifier); // "KL-42"

// TaskItem fields map directly to session state
const session = {
  task_id: task.id,
  task_ref: task.ref,         // "KL-42"
  provider: config.provider,  // "plane"
  project_id: task.projectId,
  summary: task.title,
  // ...other fields
};
```

### Pattern 4: Minimal TaskItem for stop.js
**What:** Instead of calling `provider.getTask()` (extra API call), construct a minimal TaskItem from session state for `addComment` and `updateTaskState`.
**When to use:** In stop.js where the session already has task_id, task_ref, project_id.
**Example:**
```javascript
// Construct minimal TaskItem from session — avoids extra API round-trip
/** @type {import('../interface.js').TaskItem} */
const task = {
  id: session.task_id,
  ref: session.task_ref,
  projectId: session.project_id,
  // Other fields not needed for addComment/updateTaskState
  title: session.summary,
  description: '',
  labels: [],
  projectName: '',
  groups: [],
  url: '',
  priority: null,
};
```

### Anti-Patterns to Avoid
- **Importing PlaneClient in consumers:** The entire point of this phase. After rewiring, `PlaneClient` should only appear inside `src/providers/plane/`.
- **Calling `config.plane.*` from consumers:** Use `config.provider` to get the name, `config.providers[name].*` for provider-specific config only when absolutely needed (e.g., state names).
- **Hardcoding "plane" in consumer logic:** Use `session.provider` or `config.provider` dynamically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Counting pending tasks | Manual filter of work items by state + labels | `provider.listPendingTasks()` | Already handles all filtering internally (40+ lines of check.js replaced by 1 call) |
| Resolving "KL-42" to project+task | Manual identifier parsing + API calls | `provider.getTask(ref)` or `provider.resolveRef(ref)` | Already handles project lookup, sequence resolution, normalization |
| Posting comments with HTML | Manual HTML construction + escapeHtml | `provider.addComment(task, markdown)` | Adapter handles markdown→HTML conversion internally |
| Updating task state by name | Manual state lookup + ID mapping | `provider.updateTaskState(task, stateName)` | Adapter resolves state name to ID internally |
| ANSI color output | chalk, kleur, or any npm package | Raw `\x1b[32m` / `\x1b[33m` / `\x1b[31m` / `\x1b[0m` | CONTEXT.md decision: zero external deps for colors |

**Key insight:** The entire `countPendingKodoTasks()` function in check.js (lines 99-141) — including label fetching, state filtering, kodo label matching — is now a single `listPendingTasks()` call. This is the biggest win of the abstraction.

## Common Pitfalls

### Pitfall 1: Silent Failures in stop.js
**What goes wrong:** An uncaught exception in stop.js kills the entire hook silently — no error visible to user.
**Why it happens:** stop.js runs as a Claude Code hook subprocess. Claude doesn't surface hook errors.
**How to avoid:** Wrap the entire `main()` in try-catch (already done). Additionally wrap EACH provider operation in its own try-catch so one failure doesn't prevent others.
**Warning signs:** Session ends without closing comment or state update, no error output.

### Pitfall 2: initRegistry() Not Awaited
**What goes wrong:** `getProvider()` throws "Unknown provider: plane" because factory wasn't registered yet.
**Why it happens:** `initRegistry()` is async (uses dynamic imports). If not awaited, factories map is empty.
**How to avoid:** Always `await initRegistry()` before the first `getProvider()` call. In hooks that read stdin first, call initRegistry after parsing input but before provider operations.
**Warning signs:** "Unknown provider" errors at runtime.

### Pitfall 3: Old Field Names in Session State
**What goes wrong:** Code reads `session.plane_id` which no longer exists (now `session.task_id`).
**Why it happens:** State schema migrated in Phase 1 but consumer code still references old names.
**How to avoid:** Search-and-replace all occurrences: `plane_id` → `task_id`, `plane_identifier` → `task_ref`. The Session typedef in state.js already uses the new names.
**Warning signs:** `undefined` values when reading session fields.

### Pitfall 4: getPlaneApiKey() Still Used in Consumers
**What goes wrong:** check.js currently guards pending-task check with `if (getPlaneApiKey())`. This is Plane-specific.
**Why it happens:** API key checking was done at the consumer level before the provider abstraction.
**How to avoid:** Replace with a try-catch around `initRegistry() + getProvider()`. If provider is not configured or API key missing, the provider factory will throw. Catch and skip gracefully.
**Warning signs:** check.js still imports from config.js things it shouldn't need.

### Pitfall 5: HTML Comments in stop.js
**What goes wrong:** stop.js currently builds HTML comments (`<h3>`, `<pre>`, `escapeHtml`). The provider's `addComment()` expects Markdown.
**Why it happens:** Old code talked directly to Plane API which expects HTML.
**How to avoid:** Build comments in Markdown. The PlaneProvider's `addComment()` converts markdown to basic HTML internally. Remove `escapeHtml()` helper from stop.js.
**Warning signs:** HTML tags appearing literally in task comments.

## Code Examples

### check.js — Before vs After

**Before (current, lines 56-65 + 99-141):**
```javascript
import { PlaneClient } from './plane/client.js';
import { parseKodoLabels, resolveLabels } from './labels.js';

if (getPlaneApiKey()) {
  const pendingCount = await countPendingKodoTasks(config);
  // ...40-line function with manual Plane API calls
}
```

**After:**
```javascript
import { initRegistry, getProvider } from './providers/registry.js';

// In runCheck():
try {
  await initRegistry();
  const provider = getProvider(config.provider);
  const pending = await provider.listPendingTasks();
  if (pending.length > 0 && running.length < config.claude.max_parallel) {
    lines.push(`\x1b[33m[kodo:check] ${pending.length} pending kodo task(s), ${config.claude.max_parallel - running.length} slot(s) available\x1b[0m`);
    reasons.push(`${pending.length} tarea(s) pendientes con slots disponibles`);
  }
} catch (err) {
  lines.push(`\x1b[31m[kodo:check] Error checking tasks: ${err.message}\x1b[0m`);
}
```

### stop.js — Provider Resolution and Comment

```javascript
import { initRegistry, getProvider } from '../providers/registry.js';

// In main(), after finding session:
await initRegistry();
const provider = getProvider(session.provider || config.provider);

// Build minimal TaskItem from session state
const task = {
  id: session.task_id,
  ref: session.task_ref,
  projectId: session.project_id,
  title: session.summary,
  description: '', labels: [], projectName: '', groups: [], url: '', priority: null,
};

// Post closing comment (Markdown)
try {
  const elapsed = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60_000);
  const comment = [
    `### Session finalizada (${elapsed}min)`,
    `**Workspace:** ${session.workspace_ref}`,
    screenSummary ? `#### Ultimas lineas:\n\`\`\`\n${screenSummary}\n\`\`\`` : '',
  ].filter(Boolean).join('\n\n');
  await provider.addComment(task, comment);
} catch (err) {
  console.error(`[kodo] Error posting comment: ${err.message}`);
}

// Update task state to review
try {
  const providerConfig = config.providers[session.provider || config.provider];
  await provider.updateTaskState(task, providerConfig.states.review);
} catch (err) {
  console.error(`[kodo] Error updating state: ${err.message}`);
}
```

### manager.js — Task Resolution

```javascript
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseKodoLabels } from '../labels.js';

export async function launchWorkItem(identifier, opts = {}) {
  const config = loadConfig();
  await initRegistry();
  const provider = getProvider(config.provider);

  // Resolve identifier to TaskItem (replaces plane.resolveIdentifier)
  const task = await provider.getTask(identifier);

  // Extract kodo labels and flags
  const { model, flags } = parseKodoLabels(
    task.labels.map(name => ({ name }))
  );

  // Module from groups
  const moduleName = task.groups.length > 0 ? task.groups[0] : null;

  // Session state uses generic fields
  const session = {
    workspace_ref: workspaceRef,
    session_id: sessionId,
    task_id: task.id,
    task_ref: task.ref,
    provider: config.provider,
    project_id: task.projectId,
    summary: task.title,
    status: 'running',
    started_at: new Date().toISOString(),
    project_path: projectPath,
  };
}
```

### session-start.js — Generic Fields and Dynamic MCP Hint

```javascript
const { session } = result;
const config = loadConfig();
const providerName = session.provider || config.provider;
const providerConfig = config.providers[providerName] || {};
const mcpHint = providerConfig.mcp_hint || `MCP de ${providerName}`;

const context = [
  `# kodo ${session.task_ref} ${new Date().toISOString().slice(0, 16)}`,
  '',
  `Estas trabajando en **${session.task_ref}: ${session.summary}**`,
  `Proyecto path: ${session.project_path}`,
  `Session ID: ${session.session_id}`,
  '',
  '## Documentacion de progreso',
  '',
  'IMPORTANTE: Debes documentar tu progreso para que sea visible sin entrar en esta sesion.',
  '',
  '1. **Al empezar**: anade un comentario con tu plan de accion',
  '2. **Tras cada hito importante**: anade un comentario breve',
  '3. **Al terminar**: anade un comentario final con resumen',
  '',
  `Para comentar usa ${mcpHint}: work item ID = ${session.task_id} | project ID = ${session.project_id}`,
  '',
  'Al cerrar la sesion, el hook de Stop movera la tarea a "In Review" automaticamente.',
].join('\n');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `new PlaneClient()` in consumers | `getProvider(name)` from registry | Phase 2 (this project) | Consumers decoupled from Plane |
| `session.plane_id` / `session.plane_identifier` | `session.task_id` / `session.task_ref` | Phase 1 (this project) | Generic session schema |
| `config.plane.*` direct access | `config.providers[name].*` | Phase 1 (this project) | Multi-provider config support |
| HTML comments to Plane API | Markdown to `provider.addComment()` | Phase 2 (this project) | Provider handles format conversion |
| Manual label+state filtering | `provider.listPendingTasks()` | Phase 2 (this project) | All filtering internal to adapter |

## Open Questions

1. **parseKodoLabels input format after rewiring**
   - What we know: `TaskItem.labels` is `string[]` (label names). `parseKodoLabels()` expects objects with `.name` or strings.
   - What's unclear: After rewiring, manager.js needs to call `parseKodoLabels()` with `task.labels` which are already strings. The function currently filters on `typeof l === 'object' && l.name`.
   - Recommendation: Wrap labels as `task.labels.map(name => ({ name }))` to match expected input, OR update parseKodoLabels to also handle plain strings. The wrapper approach is simpler and avoids changing a tested function.

2. **Provider state names location**
   - What we know: stop.js needs `config.plane.review_state` (old) → now `config.providers.plane.states.review`
   - What's unclear: Should consumers read state names from config, or should provider expose them?
   - Recommendation: Read from `config.providers[session.provider].states.review`. The provider doesn't expose state name constants — that's config-level.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (node:test) |
| Config file | None (script in package.json) |
| Quick run command | `node --test test/**/*.test.js` |
| Full suite command | `node --test test/**/*.test.js` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REWI-01 | check.js uses provider.listPendingTasks() not PlaneClient | integration | `node --test test/check.test.js` | No - Wave 0 |
| REWI-02 | stop.js reads session.provider, uses adapter, defensive error handling | integration | `node --test test/stop.test.js` | No - Wave 0 |
| REWI-03 | manager.js uses provider.getTask() for ref resolution | integration | `node --test test/manager.test.js` | No - Wave 0 |
| REWI-05 | session-start.js uses task_ref, task_id, dynamic mcp_hint | unit | `node --test test/session-start.test.js` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/**/*.test.js`
- **Per wave merge:** `node --test test/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/check.test.js` — covers REWI-01 (mock provider, verify no PlaneClient import)
- [ ] `test/stop.test.js` — covers REWI-02 (mock provider, verify defensive error handling)
- [ ] `test/manager.test.js` — covers REWI-03 (mock provider, verify TaskItem-based session)
- [ ] `test/session-start.test.js` — covers REWI-05 (verify generic field names, mcp_hint)

**Note:** These are integration-style tests that need to mock the registry. Existing tests (`registry.test.js`, `plane-provider.test.js`) already demonstrate the mocking pattern with `clearRegistry()` + `registerProvider()`.

## Sources

### Primary (HIGH confidence)
- `src/check.js` — current consumer code, 141 lines, direct PlaneClient usage
- `src/hooks/stop.js` — current consumer code, 194 lines, PlaneClient + HTML comments
- `src/session/manager.js` — current consumer code, 135 lines, PlaneClient.resolveIdentifier
- `src/hooks/session-start.js` — current consumer code, 69 lines, plane_identifier/plane_id fields
- `src/providers/registry.js` — registry with initRegistry/getProvider, 99 lines
- `src/providers/plane/provider.js` — PlaneProvider with all 8 TaskProvider methods, 161 lines
- `src/interface.js` — TaskProvider/TaskItem/TriggerEvent typedefs, 66 lines
- `src/session/state.js` — Session typedef with task_id/task_ref/provider fields, 126 lines
- `src/config.js` — config with provider/providers schema, 160 lines

### Secondary (MEDIUM confidence)
- Phase 1-2 research and plan documents (project-internal, verified against code)

### Tertiary (LOW confidence)
- None — all findings are from direct code inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, pure refactoring
- Architecture: HIGH - all target patterns already exist in provider layer code
- Pitfalls: HIGH - identified from direct code analysis of current consumers
- Code examples: HIGH - derived from actual current code + existing provider API

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (stable — internal refactoring, no external dependencies)
