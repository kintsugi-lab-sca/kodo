# Technology Stack: Provider Abstraction Layer

**Project:** kodo v0.2 — Provider Abstraction  
**Researched:** 2026-04-07  
**Scope:** Adapter/provider abstraction patterns for plain Node.js (ESM, no TypeScript, minimal dependencies)

---

## Recommended Approach

The right pattern for kodo is a **factory-based provider registry with a JSDoc-enforced contract interface**. This is not a plugin system (too heavy), not a class hierarchy (too rigid for dynamic selection), and not dynamic `await import()` at runtime (unnecessary complexity for a handful of known providers).

The model to follow is how the Vercel AI SDK structures providers: each provider is a factory function that returns an object conforming to a shared interface, and the registry maps a string key from config to the right factory. Consumers call the interface, never the concrete class.

---

## Core Patterns

### Pattern 1: Contract-as-JSDoc Interface

Define the `TaskProvider` contract in a single file using `@typedef` and `@interface`. This gives IDE autocomplete and `@ts-check` validation without a build step.

```javascript
// src/providers/interface.js
// @ts-check

/**
 * A normalized work item. Providers must map their native data to this shape.
 *
 * @typedef {Object} WorkItem
 * @property {string} id            - Provider-internal unique ID
 * @property {string} identifier    - Human-readable key, e.g. "KL-42" or "#123"
 * @property {string} title
 * @property {string} description
 * @property {string} state         - Normalized state name (trigger-agnostic)
 * @property {string[]} labels      - Raw label strings
 * @property {string} projectId
 * @property {string} projectPath   - Resolved local filesystem path
 */

/**
 * @typedef {Object} TaskProvider
 * @property {string} name                              - Provider identifier, e.g. "plane"
 * @property {() => Promise<void>} init                 - Called once at startup; validate credentials
 * @property {(identifier: string) => Promise<WorkItem>} resolveItem
 * @property {(projectId: string) => Promise<WorkItem[]>} listPendingItems
 * @property {(item: WorkItem, state: string) => Promise<void>} updateState
 * @property {(item: WorkItem, body: string) => Promise<void>} addComment
 * @property {() => TriggerMechanism} getTrigger        - Returns the trigger for this provider
 */

/**
 * @typedef {Object} TriggerMechanism
 * @property {'webhook'|'polling'|'manual'} type
 * @property {(handler: (item: WorkItem) => Promise<void>) => void} attach
 * @property {() => void} detach
 */
```

**Why this approach:**
- `@ts-check` at the top of every consumer file surfaces type mismatches in the editor without a build step.
- Keeping the typedef in a standalone file (not inside the implementation) lets any file `import type` the contract independently.
- `WorkItem` normalization is the critical design decision: every provider maps its native representation to this shape, so `session/manager.js` never needs to know it is talking to Plane vs GitHub Issues.

---

### Pattern 2: Factory Function per Provider (not class inheritance)

Each provider exports a factory function, not a class. Factory functions are simpler to test (no `new`, no `this` binding issues), allow private state through closure, and are the idiomatic ESM pattern in 2025.

```javascript
// src/providers/plane/index.js
// @ts-check

import { PlaneClient } from './client.js';
import { PlaneTrigger } from './trigger.js';
import { normalizeWorkItem } from './normalize.js';

/**
 * @param {object} config
 * @param {string} config.baseUrl
 * @param {string} config.apiKey
 * @param {string} config.workspaceSlug
 * @param {string} config.triggerState
 * @param {string} config.doneState
 * @param {string} config.reviewState
 * @returns {import('../interface.js').TaskProvider}
 */
export function createPlaneProvider(config) {
  const client = new PlaneClient(config);
  const trigger = new PlaneTrigger(config);

  return {
    name: 'plane',

    async init() {
      // Validate credentials — fail fast at startup, not mid-session
      await client.listProjects();
    },

    async resolveItem(identifier) {
      const { project, workItem } = await client.resolveIdentifier(identifier);
      return normalizeWorkItem(workItem, project);
    },

    async listPendingItems(projectId) {
      const items = await client.listWorkItems(projectId, { expand: 'state_detail,label_detail' });
      return items
        .filter(item => item.state_detail?.name === config.triggerState)
        .map(item => normalizeWorkItem(item, { id: projectId }));
    },

    async updateState(item, state) {
      await client.updateWorkItem(item.projectId, item.id, { state });
    },

    async addComment(item, body) {
      await client.createComment(item.projectId, item.id, body);
    },

    getTrigger() {
      return trigger;
    },
  };
}
```

**Why factory over class inheritance:**
- No `super()` chains, no method resolution order confusion.
- Private state (client, trigger) is naturally encapsulated in closure without needing `#private` syntax.
- The returned object is a plain POJO that satisfies the typedef — no instanceof checks needed anywhere.
- Testing: `createPlaneProvider({ ...mockConfig })` returns a mockable object; you can override individual methods directly.

---

### Pattern 3: Static Provider Registry (config-driven selection)

Avoid dynamic `await import()` at runtime. The set of providers is known at build time. Register all available providers upfront and select based on config. This keeps startup predictable and stack traces clean.

```javascript
// src/providers/registry.js
// @ts-check

import { createPlaneProvider } from './plane/index.js';
// Future: import { createGitHubProvider } from './github/index.js';
// Future: import { createLocalProvider } from './local/index.js';

/** @type {Map<string, (config: object) => import('./interface.js').TaskProvider>} */
const REGISTRY = new Map([
  ['plane', createPlaneProvider],
  // ['github', createGitHubProvider],
  // ['local', createLocalProvider],
]);

/**
 * @param {string} providerName
 * @param {object} providerConfig
 * @returns {import('./interface.js').TaskProvider}
 */
export function createProvider(providerName, providerConfig) {
  const factory = REGISTRY.get(providerName);
  if (!factory) {
    const available = [...REGISTRY.keys()].join(', ');
    throw new Error(`Unknown provider "${providerName}". Available: ${available}`);
  }
  return factory(providerConfig);
}
```

Config selects the provider:
```json
// ~/.kodo/config.json
{
  "provider": "plane",
  "plane": { ... }
}
```

```javascript
// src/config.js — provider initialization
import { createProvider } from './providers/registry.js';

let _provider = null;

export function getProvider() {
  if (!_provider) {
    const config = loadConfig();
    _provider = createProvider(config.provider, config[config.provider]);
  }
  return _provider;
}
```

**Why static registry over dynamic `import()`:**
- Dynamic import paths are harder to audit, test, and error-check.
- With ~4 known providers, there is no justification for the complexity of runtime module loading.
- The registry pattern is how Octokit authentication strategies work and how the tweedegolf storage-abstraction library works — proven at scale.

---

### Pattern 4: Trigger Abstraction (webhook vs polling vs manual)

The key insight is that webhook and polling are different in *how* events arrive, but identical in *what* the consumer does with them. The `TriggerMechanism` interface hides this distinction.

```javascript
// src/providers/plane/trigger.js — webhook-based
// @ts-check

import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

export class PlaneTrigger {
  constructor(config) {
    this.config = config;
    this._server = null;
    this.type = 'webhook';
  }

  attach(handler) {
    this._server = createServer(async (req, res) => {
      if (!this._verifySignature(req)) {
        res.writeHead(401).end();
        return;
      }
      const payload = await this._readBody(req);
      const item = this._parseWebhookPayload(payload);
      if (item) {
        handler(item).catch(err => console.error('[kodo:plane] handler error', err));
      }
      res.writeHead(200).end();
    });
    this._server.listen(this.config.port);
  }

  detach() {
    this._server?.close();
    this._server = null;
  }

  // ... _verifySignature, _readBody, _parseWebhookPayload
}
```

```javascript
// src/providers/local/trigger.js — polling-based (future)
// @ts-check

export class LocalFileTrigger {
  constructor(config) {
    this.config = config;
    this._timer = null;
    this.type = 'polling';
  }

  attach(handler) {
    const poll = async () => {
      const items = await this._scanDirectory();
      for (const item of items) {
        await handler(item);
      }
    };
    this._timer = setInterval(poll, this.config.pollIntervalMs ?? 30_000);
  }

  detach() {
    clearInterval(this._timer);
    this._timer = null;
  }
}
```

The server (`src/server.js`) becomes provider-agnostic:

```javascript
// src/server.js — after refactor
import { getProvider } from './config.js';
import { launchWorkItem } from './session/manager.js';

export function startServer() {
  const provider = getProvider();
  const trigger = provider.getTrigger();

  trigger.attach(async (item) => {
    console.log(`[kodo] trigger: ${item.identifier}`);
    await launchWorkItem(item);
  });

  console.log(`[kodo] trigger attached (${trigger.type})`);
}
```

---

### Pattern 5: Auth per Provider (encapsulated inside factory)

Each provider factory receives its own config slice from `~/.kodo/config.json`. Auth is the factory's internal concern — the registry and consumers never touch credentials directly.

```javascript
// config.json structure
{
  "provider": "plane",
  "plane": {
    "base_url": "https://tasks.kintsugi-lab.com",
    "api_key_env": "PLANE_API_KEY",      // env var name, not the value
    "workspace_slug": "k-lab",
    "trigger_state": "In Progress",
    "webhook_port": 9090
  },
  "github": {                             // future, ignored until provider = "github"
    "token_env": "GITHUB_TOKEN",
    "owner": "myorg",
    "repo": "myrepo",
    "label": "kodo",
    "trigger_state_label": "in-progress"
  }
}
```

Auth resolution happens inside the factory:

```javascript
export function createPlaneProvider(config) {
  // Resolve API key from env var at factory creation time
  const apiKey = process.env[config.api_key_env];
  if (!apiKey) throw new Error(`Set ${config.api_key_env} env var for Plane provider`);

  const client = new PlaneClient({ ...config, apiKey });
  // ...
}
```

**Why this auth model:**
- Credentials never flow through the provider interface — only normalized domain objects do.
- Each provider can use a completely different auth mechanism (Bearer token, HMAC, PAT, OAuth) without leaking that complexity upward.
- Failing fast (`if (!apiKey) throw`) in the factory means auth errors surface at `kodo start`, not deep in a session.

---

### Pattern 6: Normalization Layer (thin per-provider mappers)

Each provider adapter has a `normalize.js` file responsible for translating native API responses into `WorkItem`. This is where all provider-specific field mapping lives.

```javascript
// src/providers/plane/normalize.js
// @ts-check

/**
 * @param {object} raw     - Plane API work item response
 * @param {object} project - Plane project object
 * @returns {import('../interface.js').WorkItem}
 */
export function normalizeWorkItem(raw, project) {
  return {
    id: raw.id,
    identifier: `${project.identifier}-${raw.sequence_id}`,
    title: raw.name,
    description: raw.description_stripped ?? raw.description_html ?? '',
    state: raw.state_detail?.name ?? raw.state,
    labels: (raw.label_detail ?? raw.labels ?? []).map(l =>
      typeof l === 'string' ? l : l.name
    ),
    projectId: project.id,
    projectPath: '', // resolved by session/manager.js via projects.json
  };
}
```

**Why a dedicated normalize.js:**
- Keeps the provider factory readable — no field-mapping noise in business logic.
- Makes API response changes easy to find and fix in one place.
- The `WorkItem` shape can be tested independently with raw API fixtures.

---

## What NOT to Do

### Avoid: Abstract base class with `throw new Error('not implemented')`

```javascript
// Anti-pattern — do not use
class TaskProvider {
  async resolveItem(id) { throw new Error('Not implemented'); }
}
class PlaneProvider extends TaskProvider { ... }
```

Runtime "not implemented" errors are silent until a code path is actually exercised. With JSDoc `@typedef`, violations are caught statically in the editor. The class hierarchy also forces `new` everywhere and breaks the clean factory pattern.

### Avoid: Checking `provider.name` inside consumers

```javascript
// Anti-pattern — do not do this
if (provider.name === 'plane') {
  // plane-specific code
}
```

If any consumer checks the provider name, the abstraction has already failed. This is a sign that the interface is missing a method — add it.

### Avoid: Dynamic import() for provider loading

```javascript
// Anti-pattern — unnecessary complexity
const mod = await import(`./providers/${name}/index.js`);
```

The static registry is simpler, more predictable, and supports the same extensibility for the 3-4 providers kodo will ever have.

### Avoid: Passing raw Plane API objects to session/manager.js

After refactoring, `session/manager.js` must receive `WorkItem`, not raw Plane objects. Any function signature that accepts `workItemId` + `projectId` as separate Plane-specific strings should be replaced with `WorkItem`.

---

## Migration Path for Existing Code

The current `PlaneClient` class is well-structured and can be kept as-is as the HTTP transport layer inside `src/providers/plane/`. The refactor is additive:

1. Create `src/providers/interface.js` with `@typedef WorkItem` and `@typedef TaskProvider`
2. Create `src/providers/plane/normalize.js` — extract field mapping from current call sites
3. Create `src/providers/plane/trigger.js` — extract HTTP server logic from `src/server.js`
4. Create `src/providers/plane/index.js` — factory wrapping existing `PlaneClient`
5. Create `src/providers/registry.js` — static map with `createProvider()`
6. Update `src/config.js` — add `getProvider()` singleton
7. Update consumers one by one: `server.js`, `session/manager.js`, `hooks/stop.js`, `hooks/session-start.js`, `check.js`

No new dependencies required. The existing `PlaneClient` class moves to `src/providers/plane/client.js` unchanged.

---

## Confidence Assessment

| Decision | Confidence | Source |
|----------|------------|--------|
| Factory function > class inheritance | HIGH | ES2020 idiomatic pattern, Vercel AI SDK, Octokit auth strategies |
| Static registry > dynamic import() | HIGH | tweedegolf/storage-abstraction, kodo constraint of 4 known providers |
| JSDoc @typedef for interface contract | HIGH | JSDoc official docs, Node.js @ts-check ecosystem |
| TriggerMechanism as separate concept | MEDIUM | Own design, supported by unified.to polling vs webhook analysis |
| Config-driven provider selection | HIGH | Standard pattern across all surveyed SDKs |
| Normalization layer per provider | HIGH | Supported by storage-abstraction IAdapter pattern |

---

## Sources

- [tweedegolf/storage-abstraction — IAdapter interface pattern](https://github.com/tweedegolf/storage-abstraction)
- [Octokit authentication-strategies.js — swappable auth per provider](https://github.com/octokit/authentication-strategies.js)
- [Vercel AI SDK — createOpenAI/createAnthropic factory pattern](https://vercel.com/blog/ai-sdk-5)
- [JSDoc @interface and @implements tags](https://jsdoc.app/tags-implements)
- [JSDoc @abstract tag](https://docs.w3cub.com/jsdoc/tags-abstract)
- [Node.js Advanced Patterns: Plugin Manager](https://v-checha.medium.com/node-js-advanced-patterns-plugin-manager-44adb72aa6bb)
- [Unified API: polling vs webhooks analysis](https://unified.to/blog/polling_vs_webhooks_when_to_use_one_over_the_other)
- [Building unified API abstraction for multi-provider integration](https://dev.to/kuldeep-modi/building-a-unified-api-abstraction-layer-for-multi-channel-e-commerce-integration-37j5)
