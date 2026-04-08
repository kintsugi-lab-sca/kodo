# Phase 2: Plane Adapter + Registry - Research

**Researched:** 2026-04-08
**Domain:** Provider adapter pattern, Plane API integration, registry pattern
**Confidence:** HIGH

## Summary

Phase 2 wraps the existing `PlaneClient` in a `PlaneProvider` that implements the `TaskProvider` interface defined in Phase 1. The codebase already has all the raw functionality scattered across `server.js`, `labels.js`, `manager.js`, and `plane/client.js` — this phase consolidates it into a single adapter with a normalizer, webhook handler, and signature verifier. A static registry maps provider names to factory functions.

The implementation is straightforward because: (1) `PlaneClient` already covers all API calls needed, (2) the HMAC verification logic already works in `server.js`, (3) label resolution already exists in `labels.js`, and (4) the `TaskProvider` typedef from Phase 1 is well-defined with 8 methods. The main engineering work is the normalizer (Plane API response -> `TaskItem`) and wiring everything through a clean factory function.

**Primary recommendation:** Extract and consolidate existing logic into `src/providers/plane/` with a normalizer module, then create a minimal registry in `src/providers/registry.js`. Test with real Plane API fixture JSON files.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
No explicitly locked decisions — all implementation choices are delegated to Claude's discretion based on Phase 1 output and research.

### Claude's Discretion
- PlaneProvider structure: factory function `createPlaneProvider(config)` returning TaskProvider object
- PlaneClient moves to `src/providers/plane/client.js` without changes
- Normalizer in `src/providers/plane/normalize.js`
- HTML to plain text: adapt existing `stripHtml` from manager.js
- Labels: resolve UUIDs to names using listLabels, return as string[]
- Groups: resolve via getWorkItemModule
- URL: construct from `baseUrl/{workspaceSlug}/browse/{projectIdentifier}-{sequenceId}`
- Registry: `src/providers/registry.js` with Map, singleton caching, TASK_PROVIDER_METHODS validation
- Webhook: `parseTriggerEvent` + `verifySignature` inside adapter
- init() fail-fast: validate API key, test connection, verify workspace
- Test strategy: fixture-based, no API key needed

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTF-04 | Registry estatico de providers con factory functions (`getProvider()`) | Registry pattern with Map + singleton cache + method validation |
| PLAN-01 | `PlaneProvider` implementa `TaskProvider` envolviendo `PlaneClient` existente | Factory function delegates to PlaneClient; all 8 methods mapped |
| PLAN-02 | Normalizer convierte respuestas Plane API -> `TaskItem` canonico | Normalizer module with HTML stripping, priority mapping, label resolution |
| PLAN-03 | `parseTriggerEvent` parsea payload webhook de Plane -> `TriggerEvent` | Extract from server.js handleWebhook; maps event/action/state |
| PLAN-04 | `verifySignature` con HMAC-SHA256 dentro del adapter | Extract from server.js; X-Plane-Signature header, createHmac + timingSafeEqual |
| PLAN-05 | Labels resueltos dentro del adapter (UUIDs -> nombres) | Integrate resolveLabels from labels.js into normalizer; uses /projects/{id}/labels/ endpoint |
| TEST-01 | Tests para TaskItem normalization (Plane response -> canonical shape) | Node test runner with fixture JSON files |
| TEST-02 | Tests para label parsing con la nueva interfaz | Fixture-based tests with label UUID resolution |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:test | Node 20+ built-in | Test framework | Already used in project (test/*.test.js) |
| node:assert/strict | Node 20+ built-in | Assertions | Already used in project |
| node:crypto | Node 20+ built-in | HMAC-SHA256 for webhook signatures | Already used in server.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | Zero external dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual HTML strip | turndown/html-to-text | Overkill — Plane descriptions are simple HTML, regex strip sufficient |
| Custom registry | awilix/tsyringe | Unnecessary DI for 1-2 providers; static Map is simpler |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── providers/
│   ├── registry.js          # getProvider(), registerProvider()
│   └── plane/
│       ├── client.js         # PlaneClient (moved from src/plane/client.js)
│       ├── provider.js       # createPlaneProvider() factory
│       └── normalize.js      # normalizeWorkItem(), parseTriggerEvent()
├── interface.js              # TaskProvider, TaskItem, TriggerEvent (unchanged)
├── labels.js                 # parseKodoLabels (stays — used by normalizer)
└── ...existing files unchanged
```

### Pattern 1: Factory Function Provider
**What:** `createPlaneProvider(config)` returns an object satisfying `TaskProvider`
**When to use:** Every provider adapter follows this pattern
**Example:**
```javascript
// src/providers/plane/provider.js
import { PlaneClient } from './client.js';
import { normalizeWorkItem, buildTriggerEvent } from './normalize.js';

/**
 * @param {{ baseUrl: string, apiKey: string, workspaceSlug: string, projects: string[], states: { trigger: string, review: string, done: string } }} config
 * @returns {import('../../interface.js').TaskProvider}
 */
export function createPlaneProvider(config) {
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
  });

  return {
    async init() {
      // fail-fast: verify API key + workspace access
      await client.request('/'); // GET /api/v1/workspaces/{slug}/
    },
    async getTask(ref) { /* resolve ref -> normalize */ },
    async updateTaskState(task, stateName) { /* find state UUID, PATCH */ },
    async addComment(task, markdownText) { /* convert to HTML, POST */ },
    async listPendingTasks() { /* list work items in trigger state, normalize */ },
    parseTriggerEvent(rawPayload) { /* extract event data -> TriggerEvent */ },
    verifySignature(rawBody, headers) { /* HMAC-SHA256 */ },
    async resolveRef(humanRef) { /* "KL-42" -> UUID */ },
  };
}
```

### Pattern 2: Static Registry with Singleton Cache
**What:** Map of provider name -> factory, with cached instances
**When to use:** Single entry point for all provider access
**Example:**
```javascript
// src/providers/registry.js
import { TASK_PROVIDER_METHODS } from '../interface.js';

/** @type {Map<string, Function>} */
const factories = new Map();

/** @type {Map<string, import('../interface.js').TaskProvider>} */
const instances = new Map();

export function registerProvider(name, factory) {
  factories.set(name, factory);
}

export function getProvider(name) {
  if (instances.has(name)) return instances.get(name);
  const factory = factories.get(name);
  if (!factory) throw new Error(`Unknown provider: ${name}`);
  const provider = factory();
  // Validate interface compliance
  for (const method of TASK_PROVIDER_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`Provider "${name}" missing method: ${method}`);
    }
  }
  instances.set(name, provider);
  return provider;
}
```

### Pattern 3: Normalizer as Pure Functions
**What:** Separate module of pure functions that transform Plane API shapes to canonical TaskItem
**When to use:** Makes testing trivial — input fixture JSON, assert output shape
**Example:**
```javascript
// src/providers/plane/normalize.js
import { parseKodoLabels } from '../../labels.js';

/**
 * @param {object} workItem - Raw Plane API work item
 * @param {{ labels: Array<{id: string, name: string}>, projectIdentifier: string, baseUrl: string, workspaceSlug: string }} context
 * @returns {import('../../interface.js').TaskItem}
 */
export function normalizeWorkItem(workItem, context) {
  const labelNames = resolveWorkItemLabels(workItem.labels, context.labels);
  return {
    id: workItem.id,
    ref: `${context.projectIdentifier}-${workItem.sequence_id}`,
    title: workItem.name,
    description: stripHtml(workItem.description_html || ''),
    labels: labelNames,
    projectId: workItem.project_detail?.id || workItem.project,
    projectName: workItem.project_detail?.name || '',
    groups: [], // populated via getWorkItemModule if needed
    url: `${context.baseUrl}/${context.workspaceSlug}/browse/${context.projectIdentifier}-${workItem.sequence_id}`,
    priority: mapPriority(workItem.priority),
  };
}
```

### Anti-Patterns to Avoid
- **PlaneClient reading config directly:** The provider factory reads config and passes explicit values to PlaneClient. Client should not call `loadConfig()` internally — that couples it to the global config system. However, CONTEXT.md says "PlaneClient moves without changes" so config reading stays as-is for now; the factory passes overrides via constructor opts.
- **Leaking UUIDs into TaskItem.labels:** Labels MUST be resolved to human-readable names before returning. Never return `["uuid-1", "uuid-2"]`.
- **Calling Plane API in parseTriggerEvent:** This method must be synchronous (returns `TriggerEvent|null`, not a Promise). Label resolution from UUIDs requires a cached label map fetched during `init()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC verification | Custom crypto | `node:crypto` createHmac + timingSafeEqual | Already proven in server.js; timing-safe comparison prevents timing attacks |
| HTML to text | Regex parser | Simple `stripHtml` (regex `.replace(/<[^>]+>/g, '')`) | Plane descriptions are simple HTML; no need for a full parser |
| Test fixtures | Mock API server | Static JSON files from real API responses | Deterministic, fast, no network needed |

**Key insight:** All the hard crypto and API work already exists in the codebase. This phase is about reorganization and normalization, not building new capabilities.

## Common Pitfalls

### Pitfall 1: parseTriggerEvent is synchronous but needs resolved labels
**What goes wrong:** `parseTriggerEvent` returns `TriggerEvent|null` (not a Promise), but webhook payloads contain label UUIDs that need API resolution.
**Why it happens:** Webhook payloads from Plane send labels as UUID arrays, not objects with names.
**How to avoid:** During `init()`, fetch and cache all project labels. The `parseTriggerEvent` method uses this cached label map for resolution. Alternatively, parse labels as UUIDs in the TriggerEvent.raw and let the consumer resolve later — but CONTEXT.md says "PlaneProvider.parseTriggerEvent resuelve labels del webhook payload."
**Warning signs:** Tests passing with object-format labels but failing with UUID-format labels.

### Pitfall 2: PlaneClient constructor calls loadConfig()
**What goes wrong:** PlaneClient internally calls `loadConfig()` in its constructor, which reads from disk. This means tests that import PlaneClient will try to read `~/.kodo/config.json`.
**Why it happens:** Current PlaneClient was designed as a singleton, not for DI.
**How to avoid:** The factory function passes all config values via the `opts` parameter to PlaneClient constructor, overriding the internal `loadConfig()` call. For tests, always pass explicit opts. Alternatively, mock the config module.
**Warning signs:** Tests failing on CI or clean machines without `~/.kodo/config.json`.

### Pitfall 3: Webhook payload field name inconsistency
**What goes wrong:** Plane webhook payloads use different field names across versions. State can be in `data.state`, `data.state_detail`, or `data.state__name`.
**Why it happens:** Plane API has evolved; webhooks may use "issue" or "work_item" as event name.
**How to avoid:** Handle both field paths (already done in server.js). Copy the defensive extraction: `data.state?.name || data.state_detail?.name || data.state__name`.
**Warning signs:** Webhook triggers stop working after Plane updates.

### Pitfall 4: Registry singleton prevents test isolation
**What goes wrong:** Cached provider instances leak between tests.
**Why it happens:** Module-level Map persists across test files in the same process.
**How to avoid:** Export a `clearRegistry()` function for tests. Or use `beforeEach` to reset.
**Warning signs:** Tests pass individually but fail when run together.

### Pitfall 5: getPlaneApiKey() dependency in PlaneClient
**What goes wrong:** `PlaneClient` constructor calls `getPlaneApiKey()` which reads from process.env based on config.
**Why it happens:** Tight coupling to config module.
**How to avoid:** Always pass `apiKey` explicitly in the factory, so the constructor never falls through to `getPlaneApiKey()`.

## Code Examples

### Existing HMAC verification (from server.js, lines 23-31)
```javascript
// Source: src/server.js
function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

### Existing label resolution (from labels.js, lines 49-61)
```javascript
// Source: src/labels.js
export async function resolveLabels(plane, projectId, labels) {
  if (!Array.isArray(labels) || labels.length === 0) return [];
  if (typeof labels[0] === 'object' && labels[0]?.name) return labels;
  const allLabels = await plane.request(`/projects/${projectId}/labels/`);
  const resolved = allLabels.results || allLabels;
  const labelIds = new Set(labels.map((l) => (typeof l === 'string' ? l : l?.id)));
  return resolved.filter((l) => labelIds.has(l.id));
}
```

### Existing HTML strip (from manager.js, line 120-122)
```javascript
// Source: src/session/manager.js
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
```

### Config schema v2 path for Plane (from config.js)
```javascript
// Config structure (providers.plane.*):
{
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'https://tasks.kintsugi-lab.com',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'k-lab',
      projects: [],
      states: {
        trigger: 'In Progress',
        review: 'In review',
        done: 'Done',
      },
    },
  },
}
```

### Plane webhook payload structure
```javascript
// Source: https://developers.plane.so/dev-tools/intro-webhooks
// Headers: X-Plane-Signature (HMAC-SHA256), X-Plane-Event, X-Plane-Delivery
{
  event: 'issue',           // or 'work_item'
  action: 'updated',        // 'created', 'updated', 'deleted'
  webhook_id: 'uuid',
  workspace_id: 'uuid',
  data: {
    id: 'uuid',
    name: 'Task title',
    description_html: '<p>...</p>',
    state: 'uuid',
    state_detail: { id: 'uuid', name: 'In Progress', group: 'started' },
    priority: 'medium',     // urgent|high|medium|low|none
    labels: ['uuid-1', 'uuid-2'],  // UUIDs, NOT objects
    project: 'uuid',
    project_detail: { id: 'uuid', name: 'Kodo', identifier: 'KL' },
    sequence_id: 42,
    // ...more fields
  },
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct PlaneClient usage in every consumer | Provider adapter pattern via registry | Phase 2 (now) | Consumers decoupled from Plane-specific API |
| Labels as UUIDs in webhook handling | Labels resolved inside adapter | Phase 2 (now) | No UUID leaks to consumers |
| `config.plane.*` | `config.providers.plane.*` | Phase 1 (complete) | Multi-provider config ready |
| `plane_id`/`plane_identifier` in state | `task_id`/`task_ref` + `provider` field | Phase 1 (complete) | Provider-agnostic session tracking |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (node:test) |
| Config file | None — uses `node --test test/**/*.test.js` |
| Quick run command | `node --test test/**/*.test.js` |
| Full suite command | `node --test test/**/*.test.js` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTF-04 | getProvider() returns valid TaskProvider | unit | `node --test test/registry.test.js` | No - Wave 0 |
| PLAN-01 | PlaneProvider implements all 8 TaskProvider methods | unit | `node --test test/plane-provider.test.js` | No - Wave 0 |
| PLAN-02 | Normalize Plane response to TaskItem | unit | `node --test test/normalize.test.js` | No - Wave 0 |
| PLAN-03 | parseTriggerEvent maps webhook to TriggerEvent | unit | `node --test test/normalize.test.js` | No - Wave 0 |
| PLAN-04 | verifySignature validates HMAC-SHA256 | unit | `node --test test/plane-provider.test.js` | No - Wave 0 |
| PLAN-05 | Labels resolved from UUIDs to names | unit | `node --test test/normalize.test.js` | No - Wave 0 |
| TEST-01 | TaskItem normalization with real fixtures | unit | `node --test test/normalize.test.js` | No - Wave 0 |
| TEST-02 | Label parsing with new interface | unit | `node --test test/normalize.test.js` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/**/*.test.js`
- **Per wave merge:** `node --test test/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/fixtures/plane-workitem.json` — real Plane API response fixture
- [ ] `test/fixtures/plane-webhook.json` — real Plane webhook payload fixture
- [ ] `test/fixtures/plane-labels.json` — project labels fixture
- [ ] `test/normalize.test.js` — covers PLAN-02, PLAN-03, PLAN-05, TEST-01, TEST-02
- [ ] `test/plane-provider.test.js` — covers PLAN-01, PLAN-04
- [ ] `test/registry.test.js` — covers INTF-04

## Open Questions

1. **parseTriggerEvent label caching strategy**
   - What we know: CONTEXT.md says parseTriggerEvent resolves labels. The method signature is synchronous.
   - What's unclear: Whether to cache labels in `init()` (might go stale) or make parseTriggerEvent async (breaks interface).
   - Recommendation: Cache labels during `init()`. Webhook events happen infrequently enough that stale labels are unlikely. Add a `refreshLabels()` internal method if needed later.

2. **PlaneClient config path migration**
   - What we know: PlaneClient reads `config.plane.*` (v1 path). Config module already migrates to `config.providers.plane.*` (v2).
   - What's unclear: CONTEXT.md says "PlaneClient se mueve sin cambios" but also "necesita actualizar a `config.providers.plane.*`".
   - Recommendation: Don't modify PlaneClient internals. The factory passes all values via opts, so PlaneClient's internal config reading is irrelevant when opts are provided.

## Sources

### Primary (HIGH confidence)
- Project source code: `src/interface.js`, `src/plane/client.js`, `src/server.js`, `src/labels.js`, `src/config.js`, `src/session/manager.js`, `src/session/state.js`
- Existing tests: `test/interface.test.js`, `test/labels.test.js`
- Phase 1 output: `TASK_PROVIDER_METHODS`, `TaskItem`, `TriggerEvent` typedefs

### Secondary (MEDIUM confidence)
- [Plane Webhooks Documentation](https://developers.plane.so/dev-tools/intro-webhooks) — webhook payload structure, HMAC verification, header names
- [Plane API Reference](https://developers.plane.so/api-reference/introduction) — labels endpoint, work item fields

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero new dependencies, all Node.js built-ins already used in project
- Architecture: HIGH - factory + registry pattern is well-understood, all source code for extraction is read
- Pitfalls: HIGH - identified from reading actual codebase (config coupling, sync label resolution, webhook field inconsistency)

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable — Plane API and Node.js built-ins change slowly)
