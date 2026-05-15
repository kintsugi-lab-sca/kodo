# Phase 24: GitHubProvider + Normalizer + Registry — Research

**Researched:** 2026-05-14
**Domain:** TaskProvider adapter (GitHub Issues) — factory + pure normalizer + registry factory
**Confidence:** HIGH

## Summary

Phase 24 implementa el segundo adaptador `TaskProvider` (`createGitHubProvider`), un normalizer puro `GitHub Issue → TaskItem`, y la entry `github` en `src/providers/registry.js`. El alcance es estrecho y bien delimitado: 3 archivos nuevos (`src/providers/github/provider.js`, `src/providers/github/normalize.js`, fixtures + tests bajo `test/providers/github/` y `test/fixtures/github/`) y una modificación mínima a `src/providers/registry.js` (añadir el bloque `factories.set('github', ...)`). CONTEXT.md (D-01..D-42) ya cierra 42 decisiones, y `src/providers/github/client.js` (Phase 23) está vivo con 15 tests verdes.

La mayor parte del trabajo de investigación es **estructural** — confirmar shapes de payload, mapeo de tests, y patrones a mirror desde el módulo Plane — más que descubrimiento técnico. El stack está fijado: Node 20+ stdlib, `node:test` + `node:assert/strict`, JSDoc + `@ts-check`, cero deps externas. CONTEXT.md prevalece como spec; esta investigación documenta los **patrones concretos** que el planner debe levantar y bloquea los riesgos de regresión en el registry y en el contrato cross-provider con Phase 25.

**Primary recommendation:** Mirror estructural 1:1 desde `src/providers/plane/provider.js` + `src/providers/plane/normalize.js`, con las simplificaciones justificadas por CONTEXT.md (no caches, no HTML strip, no API calls en `init`/`listProjects`). El gate de validación es el contrato `TASK_PROVIDER_METHODS` del registry — todo lo demás se valida con tests offline + fixtures.

## User Constraints (from CONTEXT.md)

### Locked Decisions

42 decisiones D-01..D-42 — el planner las consume textualmente. Resumen de las críticas (no exhaustivo; ver `24-CONTEXT.md` para texto completo):

**Contrato del provider:**
- **D-01:** Los 9 métodos REALES de `src/interface.js` — `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. **Actualizar ROADMAP §Phase 24 SC#1 + REQUIREMENTS §GH-02 ANTES de planificar** (la lista original `listTasks`/`listLabels`/`listStates`/`transitionTask` era fantasía del roadmapper).
- **D-02:** Factory `createGitHubProvider(config, opts?)` — mirror exacto de `createPlaneProvider`.

**Module shape:**
- **D-03..D-05:** `src/providers/github/{provider.js, normalize.js}`, `// @ts-check` + JSDoc, cliente construido en factory con `config.{base_url, api_key_env}` + `logger.child({component: 'github'})`.

**Normalizer (GH-03):**
- **D-06..D-18:** `normalizeIssue(issue, context)` puro; `context = {projectId: 'owner/repo', baseUrl?}`; `id = node_id`, `ref = 'owner/repo#number'`, `description = body || ''` (Markdown crudo sin strip), `labels = issue.labels.map(l => l.name)`, `projectId = projectName = context.projectId`, `groups = []`, `url = html_url`, `state = issue.state` literal, `priority` scan label `priority:<valid>`, NO milestone/assignees/PR/etc.

**Métodos:**
- **D-19..D-28:** `init()` no-op; `getTask` usa `parseRef` + `client.getIssue`; `resolveRef` devuelve `issue.node_id`; `parseRef` regex strict `^([^/]+)\/([^#]+)#(\d+)$`; `updateTaskState` passthrough hard (`open`/`closed`); `addComment` Markdown literal sin `<p><br>` wrap; `listPendingTasks` itera `config.repos` con server-side filter `labels=kodo&state=open`, sin etag; `parseTriggerEvent → null`; `verifySignature → false`; `listProjects` devuelve `config.repos.map(...)` sin API calls.

**Registry (GH-04):**
- **D-29..D-31:** Añadir `factories.set('github', ...)` después del bloque `plane` en `registerDefaults` (líneas 25-38); NO cambiar lógica del registry; NO modificar `src/config.js`.

**Labels (GH-05):**
- **D-32:** Cero cambios en `src/labels.js`.

**Tests (TEST-01):**
- **D-33..D-38:** `test/providers/github/{normalize,provider}.test.js`; 5 fixtures nuevos; ≥ 90% branches normalizer; `opts.client?` inyectable en factory; assert `live fetch leak` guard si fakeClient no se inyecta; extender `test/registry.test.js`.

**Documentación in-code:**
- **D-39:** Header doc en `src/providers/github/provider.js` mirror Phase 23 client.js:1-30.

### Claude's Discretion

- **D-40:** Nombre helper privado `parseRef` (no `parseGitHubRef`).
- **D-41:** Tipo JSDoc del factory: `{ client?: import('./client.js').GitHubClient, logger?: Logger }`.
- **D-42:** Orden de métodos del provider literal sigue `TASK_PROVIDER_METHODS`.

### Deferred Ideas (OUT OF SCOPE)

- Auto-pagination en `listPendingTasks` (single-page max 100).
- `listProjects` con enriquecimiento (description) — Phase 26 wizard lo hará directo via client.
- Discovery de repos via `/user/repos`.
- Milestone extraction a `TaskItem.groups` (cierra open question STATE.md como NO).
- Aliases de priority (`p0`, `critical`, `blocker`).
- State mapping a semántica Plane (`open→In Progress`).
- `updateTaskState` con map de aliases (passthrough hard).
- GitHub webhook ingress real (`parseTriggerEvent`/`verifySignature` no-op funcional).
- Cachear labels per-repo en `init()`.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GH-02 | `GitHubProvider` implementa los 9 métodos REALES del contrato `TaskProvider` (`TASK_PROVIDER_METHODS`); `parseTriggerEvent`/`verifySignature` no-op; `init()` no-op | §Standard Stack (interface.js), §Code Examples (factory template), §Architecture Patterns (D-19..D-28 method-by-method) |
| GH-03 | Normalizer GitHub Issue → `TaskItem` canonical con shape simétrica a Plane (`id`/`ref`/`description`/`labels`/`projectId`/`state`/`groups=[]`/`priority`) | §Code Examples (normalizeWorkItem template), §GitHub Issue Payload Shape, §Common Pitfalls (PR filter, body=null) |
| GH-04 | Registry update — `factories.set('github', ...)` en `registerDefaults`; tests existentes siguen verdes | §Architecture Patterns (registry mirror), §Risk Surface (registry change) |
| GH-05 | `parseKodoLabels` reconoce `kodo`/`kodo:*` desde labels GitHub idénticamente a Plane; cero cambios en `src/labels.js` | §Don't Hand-Roll, §Code Examples (dispatcher consumer line 65,74) |
| TEST-01 | `test/providers/github/provider.test.js` + `normalize.test.js`; cobertura ≥ 90% branches normalizer; cero live API calls | §Test Infrastructure (Phase 23 patterns), §Validation Architecture |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GitHub HTTP transport | API client (`src/providers/github/client.js`) | — | Phase 23 ya lo cerró; Phase 24 consumer puro. |
| Issue → TaskItem normalization | Pure function (`normalize.js`) | — | Sin side effects, cross-provider symmetry (Phase 27 TEST-03). |
| Provider orchestration | Adapter factory (`provider.js`) | API client | Closure sobre `config` + `client`; los 9 métodos delegan al client. |
| Registry factory lookup | Registry (`registry.js`) | Adapter factory | Lazy init + singleton + interface validation. |
| Label parsing (provider-agnostic) | `src/labels.js` | Dispatcher caller | GH-05 invariante: zero cambios; dispatcher `task.labels.map(name => ({name}))`. |
| Trigger event ingress | Dispatcher (`src/triggers/dispatcher.js`) | Provider `parseTriggerEvent` | v0.7 GitHub polling-only → provider devuelve `null`; dispatcher consume `TriggerEvent` construido por polling.js (Phase 25). |
| Config schema | `src/config.js` (Phase 26 owner) | Provider factory consumer | Phase 24 ASUME `config.providers.github` presente; runtime falla limpio si ausente. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | Node 20+ built-in | Test runner | Repo convention TESTING.md; cero deps. [VERIFIED: `package.json` line 10 → `"test": "node --test test/**/*.test.js"`] |
| `node:assert/strict` | Node 20+ built-in | Assertion library | Repo convention; `assert.equal` (===), `assert.deepEqual`, `assert.rejects`. [VERIFIED] |
| JSDoc + `// @ts-check` | — | Type discipline | `CONVENTIONS.md` §Linting + §JSDoc/TSDoc; sin build step. [VERIFIED: `src/providers/plane/provider.js:1`, `src/providers/github/client.js:1`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` | Node 20+ built-in | HMAC para `verifySignature` | NO usado en Phase 24 (D-27: `verifySignature → false` sin HMAC). Plane lo importa (`provider.js:2`). [VERIFIED] |
| `src/providers/github/client.js` `GitHubClient` | Phase 23 shipped | REST wrapper | Único consumer Phase 24. 5 métodos: `getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels`. [VERIFIED] |
| `src/labels.js` `parseKodoLabels` | shipped v0.2 | Label parsing | Invocado indirecto por dispatcher con `task.labels.map(name => ({name}))`. NO importado en provider Phase 24. [VERIFIED: GH-05 invariante] |
| `src/interface.js` `TASK_PROVIDER_METHODS` + `VALID_PRIORITIES` | shipped v0.2 | Contract constants | `VALID_PRIORITIES` usado en normalize.js para whitelist priority extraction. [VERIFIED: `interface.js:50-69`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:test` | `vitest` / `jest` | Romperia convención repo; añade dep; cero precedente. Descartado. |
| GraphQL `/graphql` API | REST `/repos/{o}/{r}/issues/...` | REQUIREMENTS §Out of Scope explícito; v0.7 REST only. Descartado. |
| `octokit/rest.js` SDK | Custom `GitHubClient` | Phase 23 ya descartó (D-04: globalThis.fetch nativo). Descartado. |

**Installation:** Cero deps nuevas. Phase 24 NO modifica `package.json`.

**Version verification:** `node:test` y `node:assert/strict` son built-ins desde Node 18.0 (stable), confirmado para Node 20+ en `package.json`. No aplica `npm view`.

## Architecture Patterns

### System Architecture Diagram

```
                ┌──────────────────────────────────────────────────────────┐
                │  Phase 25 polling.js  /  CLI dispatch  /  test harness    │
                └────────────────────────────┬──────────────────────────────┘
                                             │
                                             ▼  getProvider('github')
                              ┌────────────────────────────────┐
                              │   src/providers/registry.js    │
                              │   factories.get('github')()    │  ◄── D-29 mod target
                              │   validates TASK_PROVIDER_METHODS
                              └────────────────────────────────┘
                                             │
                                             ▼  createGitHubProvider(config, opts?)
                  ┌────────────────────────────────────────────────────┐
                  │   src/providers/github/provider.js                  │
                  │                                                    │
                  │   • init()              → no-op  (D-19)             │
                  │   • getTask(ref)        → parseRef → client.getIssue│
                  │   • updateTaskState     → client.updateIssue        │
                  │   • addComment         → client.addComment (md)    │
                  │   • listPendingTasks   → iter config.repos →        │
                  │                          client.listIssues          │
                  │   • parseTriggerEvent  → null   (D-26)              │
                  │   • verifySignature    → false  (D-27)              │
                  │   • resolveRef        → client.getIssue → node_id   │
                  │   • listProjects      → config.repos.map  (D-28)    │
                  └─────────────┬──────────────────────┬────────────────┘
                                │                      │
                                ▼                      ▼
              ┌───────────────────────────┐   ┌──────────────────────────┐
              │ src/providers/github/      │   │ src/providers/github/    │
              │ normalize.js               │   │ client.js  (Phase 23)    │
              │   normalizeIssue(          │   │   getIssue/listIssues/   │
              │     issue, context)        │   │   addComment/updateIssue │
              │   → TaskItem               │   │   listLabels             │
              └───────────────────────────┘   └──────────────────────────┘
                            │                              │
                            └──── shared shape ────────────┘
                                       │
                                       ▼  TaskItem
              ┌────────────────────────────────────────────────────────┐
              │  src/triggers/dispatcher.js                            │
              │    task.labels.map(name => ({name})) → parseKodoLabels │  ◄── GH-05
              │    task.state literal vs config.providers.github.states │
              └────────────────────────────────────────────────────────┘
```

**Component Responsibilities:**

| Component | File | Responsibility |
|-----------|------|----------------|
| Registry entry | `src/providers/registry.js` (mod) | Lazy import + `factories.set('github', ...)` block, mirror Plane lines 25-38 |
| Provider factory | `src/providers/github/provider.js` (new) | `createGitHubProvider(config, opts?)` + 9 method literal + `parseRef` helper |
| Normalizer | `src/providers/github/normalize.js` (new) | `normalizeIssue(issue, context)` pure + priority extraction helper |
| GitHub client (consumed) | `src/providers/github/client.js` (Phase 23) | REST transport — Phase 24 sólo invoca, no modifica |
| Label parser (consumed) | `src/labels.js` (untouched) | `parseKodoLabels` — invocado indirecto via dispatcher |

### Recommended Project Structure

```
src/
├── interface.js                          # CANONICAL contract — read-only
├── labels.js                             # GH-05 invariante: untouched
├── providers/
│   ├── registry.js                       # MOD: añadir bloque github factory
│   ├── plane/
│   │   ├── client.js
│   │   ├── provider.js                   # template estructural
│   │   └── normalize.js                  # template estructural
│   └── github/
│       ├── client.js                     # Phase 23 shipped, untouched
│       ├── provider.js                   # NEW (Phase 24)
│       └── normalize.js                  # NEW (Phase 24)
└── triggers/
    └── dispatcher.js                     # consumer, untouched

test/
├── registry.test.js                      # MOD: añadir caso 'github'
├── plane-provider.test.js                # template estructural
├── normalize.test.js                     # template estructural
├── providers/
│   └── github/
│       ├── client.test.js                # Phase 23 shipped (15 tests)
│       ├── provider.test.js              # NEW
│       └── normalize.test.js             # NEW
└── fixtures/
    └── github/
        ├── issue.json                    # Phase 23
        ├── issues-list.json              # Phase 23 (incluye PR para Pitfall #2)
        ├── comment-created.json          # Phase 23
        ├── labels-list.json              # Phase 23
        ├── issue-with-priority.json      # NEW (D-34)
        ├── issue-with-kodo.json          # NEW (D-34)
        ├── issue-closed.json             # NEW (D-34)
        ├── issue-no-body.json            # NEW (D-34)
        └── issue-no-labels.json          # NEW (D-34)
```

### Pattern 1: Factory function `create<Name>Provider(config, opts?)`

**What:** Closure factory que captura `config`, `client`, `logger` y devuelve un objeto literal `/** @type {TaskProvider} */` con los 9 métodos.

**When to use:** TODO adaptador `TaskProvider`. Convención Plane (provider.js:24); Phase 24 sigue.

**Example (template directo — `src/providers/plane/provider.js:24-66`):**
```javascript
// Source: src/providers/plane/provider.js
export function createPlaneProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'plane' });
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
    logger,
  });

  function parseRef(ref) {
    const match = ref.match(/^([A-Z]+)-(\d+)$/i);
    if (!match) throw new Error(`Invalid task ref: ${ref}. Expected format: KL-42`);
    return { prefix: match[1].toUpperCase(), sequenceId: parseInt(match[2], 10) };
  }

  /** @type {import('../../interface.js').TaskProvider} */
  const provider = {
    async init() { /* ... */ },
    async getTask(ref) { /* ... */ },
    // ... 7 más
  };
  return provider;
}
```

**Adaptación GitHub (per CONTEXT.md D-02, D-05, D-19..D-28, D-36, D-41):**
```javascript
// New: src/providers/github/provider.js
export function createGitHubProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'github' });
  // D-36: opts.client inyectable para tests sin tocar globalThis.fetch.
  const client = opts.client || new GitHubClient({
    baseUrl: config.base_url,
    token: undefined,  // GitHubClient lee getProviderApiKey('github') si undefined
    logger,
  });

  /** @param {string} ref */
  function parseRef(ref) {
    const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) throw new Error(`Invalid GitHub ref: ${ref}. Expected owner/repo#number`);
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
  }

  /** @type {import('../../interface.js').TaskProvider} */
  const provider = {
    async init() {},  // D-19 no-op
    async getTask(ref) {
      const { owner, repo, number } = parseRef(ref);
      const issue = await client.getIssue(owner, repo, number);
      return normalizeIssue(issue, { projectId: `${owner}/${repo}` });
    },
    async updateTaskState(task, stateName) {
      const { owner, repo, number } = parseRef(task.ref);
      // D-23: passthrough hard — caller resuelve config.providers.github.states.X antes.
      if (stateName !== 'open' && stateName !== 'closed') {
        const states = config.states || {};
        if (!Object.values(states).includes(stateName)) {
          throw new Error(`Unknown state: ${stateName}. Configured: ${Object.values(states).join(', ')}`);
        }
      }
      await client.updateIssue(owner, repo, number, { state: stateName });
    },
    async addComment(task, markdownText) {
      const { owner, repo, number } = parseRef(task.ref);
      // D-24: markdown literal, NO <p>...<br></p> wrap.
      await client.addComment(owner, repo, number, markdownText);
    },
    async listPendingTasks() {
      const allTasks = [];
      for (const r of config.repos || []) {
        const result = await client.listIssues(r.owner, r.repo, {
          labels: ['kodo'],
          state: 'open',
        });
        // result.items contiene PRs intermixed (Pitfall #2 GitHub).
        for (const issue of result.items) {
          if (issue.pull_request) continue;  // filter PRs
          allTasks.push(normalizeIssue(issue, { projectId: `${r.owner}/${r.repo}` }));
        }
      }
      return allTasks;
    },
    parseTriggerEvent(_rawPayload) { return null; },     // D-26
    verifySignature(_rawBody, _headers) { return false; }, // D-27
    async resolveRef(humanRef) {
      const { owner, repo, number } = parseRef(humanRef);
      const issue = await client.getIssue(owner, repo, number);
      return issue.node_id;
    },
    async listProjects() {
      // D-28: cero API calls.
      return (config.repos || []).map((r) => ({
        id: `${r.owner}/${r.repo}`,
        identifier: `${r.owner}/${r.repo}`,
        name: `${r.owner}/${r.repo}`,
      }));
    },
  };
  return provider;
}
```

### Pattern 2: Pure normalizer

**What:** Función pura que toma un payload raw del API y devuelve un `TaskItem` canónico. Cero side effects, cero API calls, cero state.

**When to use:** TODO adaptador. Plane normalize.js:64 establece el patrón.

**Example (template — `src/providers/plane/normalize.js:64`):**
```javascript
// Source: src/providers/plane/normalize.js
export function normalizeWorkItem(workItem, context) {
  const ref = `${context.projectIdentifier}-${workItem.sequence_id}`;
  return {
    id: workItem.id,
    ref,
    title: workItem.name,
    description: stripHtml(workItem.description_html || ''),
    labels: resolveWorkItemLabels(workItem.labels, context.labels),
    projectId: workItem.project_detail?.id || workItem.project,
    projectName: workItem.project_detail?.name || '',
    groups: [],
    url: `${context.baseUrl}/${context.workspaceSlug}/browse/${ref}`,
    priority: VALID_PRIORITIES.includes(workItem.priority) ? workItem.priority : null,
    state: workItem.state_detail?.name || context.stateMap?.get(workItem.state) || undefined,
  };
}
```

**Adaptación GitHub (per D-06..D-18):**
```javascript
// New: src/providers/github/normalize.js
import { VALID_PRIORITIES } from '../../interface.js';

/**
 * @typedef {{ projectId: string, baseUrl?: string }} NormalizeContext
 */

/**
 * @param {Array<{name: string}>} labels
 * @returns {'urgent'|'high'|'medium'|'low'|null}
 */
export function extractPriority(labels) {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    const name = (l?.name || '').toLowerCase();
    if (name.startsWith('priority:')) {
      const value = name.slice('priority:'.length);
      // D-17: whitelist VALID_PRIORITIES sin 'none' (priority:none no es un label idiomático)
      if (['urgent', 'high', 'medium', 'low'].includes(value)) {
        return /** @type {any} */ (value);
      }
    }
  }
  return null;
}

/**
 * @param {object} issue       — raw GitHub issue payload
 * @param {NormalizeContext} context
 * @returns {import('../../interface.js').TaskItem}
 */
export function normalizeIssue(issue, context) {
  const labelNames = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
    : [];
  return {
    id: issue.node_id,                                          // D-07
    ref: `${context.projectId}#${issue.number}`,                // D-08
    title: issue.title,                                         // D-09
    description: issue.body || '',                              // D-10 Markdown crudo
    labels: labelNames,                                         // D-11
    projectId: context.projectId,                               // D-12
    projectName: context.projectId,                             // D-13
    groups: [],                                                 // D-14 hardcoded
    url: issue.html_url,                                        // D-15
    priority: extractPriority(issue.labels),                    // D-17
    state: issue.state,                                         // D-16 literal
  };
}
```

### Pattern 3: Registry factory entry (D-29)

**Source — `src/providers/registry.js:25-38`:**
```javascript
factories.set('plane', () => {
  const config = loadConfig();
  const plane = config.providers.plane;
  const secretEnv = 'KODO_WEBHOOK_SECRET_PLANE';
  const webhookSecret = process.env[secretEnv] || process.env.PLANE_WEBHOOK_SECRET || plane.webhook_secret;
  return createPlaneProvider({
    baseUrl: plane.base_url,
    apiKey: getPlaneApiKey(),
    workspaceSlug: plane.workspace_slug,
    projects: plane.projects || [],
    states: plane.states,
    webhookSecret,
  });
});
```

**New block (per D-29):**
```javascript
const { createGitHubProvider } = await import('./github/provider.js');
factories.set('github', () => {
  const config = loadConfig();
  const github = config.providers.github;
  return createGitHubProvider({
    base_url: github.base_url,
    repos: github.repos || [],
    states: github.states,
  });
});
```

Insertar dentro del `try { ... } catch { /* silent */ }` block existente (líneas 21-41). El `catch` swallow es deliberado para test isolation (CONTEXT.md D-29: el registry hace lazy init + singleton caching ya implementados — sin cambios en lógica).

### Anti-Patterns to Avoid

- **HTMLstrip en `description`:** Plane usa `stripHtml` porque su API devuelve HTML; GitHub devuelve Markdown nativo. D-10 lo prohíbe explícitamente — `description = body || ''`.
- **Markdown→HTML wrap en `addComment`:** Plane envuelve con `<p>...<br></p>`. GitHub acepta Markdown directo. D-24 lo prohíbe — el `markdownText` va literal.
- **Cache de labels/states en `init()`:** Plane hace 3 ciclos de caché (labels, states, modules). GitHub NO los necesita: labels embedded por payload (D-11), states son `'open'`/`'closed'` fijos. D-19 lo prohíbe — `init()` no-op.
- **Auto-resolución de `repository_url` para `projectId`:** GitHub embebe `repository_url`; tentación de parsear `https://api.github.com/repos/<owner>/<repo>`. D-08 lo prohíbe — `projectId` viene de `context`, no del payload (mantiene normalizer puro respecto a configuración).
- **Aliases de priority (`p0`, `critical`):** D-17 explícito: solo `urgent|high|medium|low` case-insensitive. Cualquier otro → `null`.
- **Importar `picocolors`/`chalk` desde provider:** Invariante color isolation (`STATE.md`). Phase 24 emite via `logger`, nunca colorea directo.
- **Modificar `src/labels.js`:** GH-05 invariante. Cero cambios.
- **Importar transitivamente desde `check.js`:** LOG-12 guard. Verificar tras edits que `kodo check` no carga `provider.js` (mirror precedente Phase 23 23-02-12).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP transport + auth + rate limits | Custom fetch wrapper | `GitHubClient` (Phase 23) | 15 tests verdes, 304 envelope, error mapping, rate-limit headers, fetch inyectable. |
| Label parsing (`kodo`/`kodo:*`) | Re-implementar | `parseKodoLabels(labels)` desde `src/labels.js` | Provider-agnostic; dispatcher ya lo invoca con `task.labels.map(name => ({name}))`. GH-05 invariante. |
| Priority whitelist | Inline array literal | `VALID_PRIORITIES` desde `src/interface.js` | Frozen const compartido con Plane; Phase 27 TEST-03 validará simetría. |
| Provider validation | Inline checks | `getProvider(name)` ya valida `TASK_PROVIDER_METHODS` (registry.js:73-77) | Mismo gate que Plane usa; no añadir validación duplicada en el factory. |
| Webhook signature verification (GitHub) | HMAC-SHA256 ad-hoc | NO HACER — D-27 `verifySignature → false` | v0.7 polling-only; si v0.8+ añade webhook, mirror Plane HMAC pattern entonces. |
| `parseRef`/`resolveRef` parser tolerante | Regex multi-formato | `^([^/]+)\/([^#]+)#(\d+)$` strict (D-22) | Sin tolerancia a `#N`/URL/issues path; si emerge demand, v0.8+. |

**Key insight:** Phase 24 es un thin layer — la complejidad real vive en `GitHubClient` (Phase 23) y en `src/labels.js`/`src/interface.js` (v0.2). El provider es un orquestador con 9 closures.

## GitHub Issue Payload Shape Verification

Los campos que el normalizer consume están verificados contra (a) docs oficiales GitHub REST API y (b) los fixtures Phase 23 que ya cargan en tests verdes.

| Field | Source | Type | Used For | Verification |
|-------|--------|------|----------|--------------|
| `node_id` | issue payload | string | `TaskItem.id` (D-07) | [VERIFIED: `test/fixtures/github/issue.json:3` → `"I_kwTEST001"`; client test row 23-02-02 carga issue completo] |
| `number` | issue payload | integer | `TaskItem.ref` (`owner/repo#number`) | [VERIFIED: `test/fixtures/github/issue.json:4` → `42`] |
| `title` | issue payload | string | `TaskItem.title` (D-09) | [VERIFIED: `test/fixtures/github/issue.json:5`] |
| `body` | issue payload | string \| null | `TaskItem.description` (D-10) | [VERIFIED: `test/fixtures/github/issues-list.json:28` → `body: null` en issue 43 cubre default '' branch; client.js docstring línea 221: "puede ser null cuando la issue se creó sin descripción"] |
| `labels[]` | issue payload | Array of `{id, node_id, name, color, default, description}` objects | `TaskItem.labels` map a names (D-11) | [VERIFIED: `test/fixtures/github/issue.json:7-9`; client test row 23-02-02 línea 132 asserts `issue.labels[0].name === 'kodo'`] |
| `state` | issue payload | `'open'` \| `'closed'` | `TaskItem.state` literal (D-16) | [CITED: docs.github.com/en/rest/issues — `state` is enum]; [VERIFIED: `test/fixtures/github/issue.json:10`] |
| `html_url` | issue payload | string | `TaskItem.url` (D-15) | [VERIFIED: `test/fixtures/github/issue.json:12` → `"https://github.com/kodo-test/fixture-repo/issues/42"`] |
| `pull_request` | issue payload | object \| null | Filter en `listPendingTasks` (Pitfall #2) | [VERIFIED: `test/fixtures/github/issues-list.json:50` — fixture 3 tiene `pull_request: {...}`, los issues 1 y 2 tienen `pull_request: null`] |
| `assignees`, `milestone`, `user`, `created_at`, `updated_at`, `closed_at`, `state_reason`, `locked`, `comments`, `reactions` | issue payload | varios | **NO usados** (D-18) | Documentado para evitar fugas accidentales. |

**Anti-edge case verificado:** `issue.labels` puede llegar como array de strings (no objects) en algunos endpoints — D-11 explícito: usar `.map(l => l.name)`. El código defensivo recomendado en §Code Examples Pattern 2 (`typeof l === 'string' ? l : l?.name`) cubre ambos casos sin coste.

[CITED: https://docs.github.com/en/rest/issues/issues#list-repository-issues — confirma shape de payload]
[CITED: https://docs.github.com/en/rest/issues/issues#get-an-issue — confirma `node_id`, `state`, `html_url`, `body` nullable]

## Cross-Phase Coupling: Phase 25 Consumer Contract

Phase 25 (POLL-01..04) consumirá `provider.listPendingTasks()` y `provider.getTask(ref)`. Hay que asegurar que Phase 24 NO bake-in un contrato incompatible.

| Phase 25 expectation | Phase 24 delivery | Compatible? |
|---------------------|-------------------|-------------|
| `listPendingTasks()` returns `TaskItem[]` | D-25: returns `TaskItem[]` (concat sobre `config.repos`) | ✅ |
| Each `TaskItem.state === 'open'` (since filtered server-side) | D-25: `state: 'open'` query param; D-16 state literal | ✅ |
| Each `TaskItem.labels` contains `'kodo'` | D-25: server-side filter `labels=kodo`; D-11 string array | ✅ |
| `TaskItem.id` is stable across renames/transfers | D-07: `node_id` (opaque, repo-rename-stable) | ✅ |
| `TaskItem.ref` is human-readable for logs | D-08: `owner/repo#number` | ✅ |
| etag/304 condicional fetch (POLL-02) | **NOT in Phase 24** — `listPendingTasks` sin etag (D-25). | ⚠️ Phase 25 llamará directamente a `client.listIssues(...{etag})` o añadirá un método nuevo al provider en Phase 25. CONTEXT.md asume lo primero (D-25 último párrafo). |
| `provider.getTask(ref)` on new detected issue | D-20: `parseRef + client.getIssue + normalizeIssue` | ✅ |
| Idempotencia: Phase 25 delega al lock per-repo Phase 8 GSD-10 | Phase 24 no introduce dedup nuevo | ✅ |
| Error code surface: `not_found` for missing issue | D-20: propaga `Error.code='not_found'` del client (Phase 23 D-12) | ✅ |
| Rate limit handling: surface `rate_limit_exceeded` | Phase 23 client throws con `.code`; Phase 24 sin try/catch propaga | ✅ |

**Sin conflicto detectado.** El único matiz es que Phase 25 polling.js NO consumirá `listPendingTasks` de forma idéntica al consumer típico — usará el client directo para etag/304. Esto está alineado con CONTEXT.md D-25 final: *"el `listIssues` con etag es del CLIENTE (Phase 23), accedido via el provider en `listPendingTasks` D-25 sin etag o directo desde polling con etag"*.

## CONCERN: Apparent contract drift (resolved by CONTEXT.md D-01)

ROADMAP §Phase 24 SC#1 (texto original 2026-05-13) listaba `listTasks`, `listLabels`, `listStates`, `transitionTask` — métodos que NO existen en `TASK_PROVIDER_METHODS` (`src/interface.js:50-60`). El registry `getProvider()` validation (`registry.js:73-77`) RECHAZARÍA un provider con esos métodos en lugar de los 9 reales.

**Estado:** Ya resuelto en CONTEXT.md D-01 + STATE.md §Critical Invariants + REQUIREMENTS §GH-02 + ROADMAP §Phase 24 SC#1 (corregidos 2026-05-14, ver observation `19592`). No queda divergencia activa. El planner debe verificar antes de PLAN que los 4 archivos están con la versión corregida; si encuentra el texto original, parar y resolver (no asumir).

**Tag:** [VERIFIED via read of ROADMAP:41-46, REQUIREMENTS:14, STATE.md:68 — todos contienen la nota "_Corregido 2026-05-14 vía Phase 24 CONTEXT.md D-01_"]

## Runtime State Inventory

**Trigger:** N/A — Phase 24 es greenfield (3 archivos nuevos + 1 modificación quirúrgica). Sin rename, sin migration, sin string replacement.

**Categories audit:**

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore changes. `~/.kodo/state.json` shape preservado. | none |
| Live service config | None — Phase 24 no escribe en n8n / Datadog / Cloudflare Tunnel. | none |
| OS-registered state | None — Phase 24 no toca tasks/launchd/pm2. | none |
| Secrets/env vars | `GITHUB_TOKEN` ya consumido por `GitHubClient` (Phase 23); Phase 24 no modifica env var names. | none |
| Build artifacts | None — JS puro, sin compilación; cero deps nuevas en `package.json`. | none |

**Skip status:** Section preserved para auditabilidad; sin acciones.

## Environment Availability

Phase 24 es **pure code change** — sin dependencias externas que requieran probe.

**Skip status:** No external CLI tools, services, runtimes o databases nuevos. El consumer (`GitHubClient` Phase 23) ya está validado contra `globalThis.fetch` nativo Node 20+, ya verificado en el shell.

## Common Pitfalls

### Pitfall 1: PR contamination en `listPendingTasks`

**What goes wrong:** `client.listIssues(owner, repo, {labels:['kodo'], state:'open'})` devuelve PRs intermixed con issues (GitHub trata PRs como "issues con `pull_request` ≠ null"). Si normalizas todos, el dispatcher procesa PRs como tareas.

**Why it happens:** Endpoint `/repos/{o}/{r}/issues` no distingue PR vs issue — el filter es `pull_request != null`.

**How to avoid:** En `listPendingTasks` filtrar `if (issue.pull_request) continue;` antes de normalizar. Verificado en fixture `issues-list.json:50` (3 entries: 2 issues + 1 PR).

**Warning signs:** `dispatchTrigger` logs procesando `kodo-test/repo#44` cuando #44 es un PR.

### Pitfall 2: `body: null` en issues sin description

**What goes wrong:** Si `issue.body === null`, `description = issue.body` resulta en `null` en `TaskItem.description` → rompe consumers que esperan string.

**Why it happens:** Issues creadas vía UI con descripción vacía vienen con `body: null` (no `''`).

**How to avoid:** D-10 explícito: `description = issue.body || ''`. Verificado en fixture `issues-list.json:28` (issue 43 con `body: null`).

**Warning signs:** Tests del normalizer fallan `assert.equal(typeof result.description, 'string')` con `null`.

### Pitfall 3: Labels como strings (raro pero documentado)

**What goes wrong:** Algunos endpoints GitHub devuelven `labels: ['kodo', 'bug']` (strings) en vez de `[{name: 'kodo', ...}, {name: 'bug', ...}]`. Si haces `issue.labels.map(l => l.name)` puro, obtienes `[undefined, undefined]`.

**Why it happens:** Endpoints como `/issues` (cross-repo) y filtros legacy pueden devolver strings. Endpoint `/repos/{o}/{r}/issues/{n}` siempre devuelve objects.

**How to avoid:** Mapper defensivo: `issue.labels.map(l => typeof l === 'string' ? l : l?.name).filter(Boolean)`. CONTEXT.md D-11 lo menciona.

**Warning signs:** `parseKodoLabels` recibe array con `undefined` y `isKodo: false` falsamente.

### Pitfall 4: `node_id` vs `id` confusion

**What goes wrong:** Usar `issue.id` (numérico, repo-scoped) en `TaskItem.id` → IDs no son cross-rename-stable (si el repo se renombra el `id` cambia; `node_id` sobrevive).

**Why it happens:** `id` parece el campo "obvio" y existe en cada payload.

**How to avoid:** D-07 explícito: `TaskItem.id = issue.node_id`. Plus: el `node_id` es string (`"I_kwTEST001"`), simétrico al UUID Plane.

**Warning signs:** Si renombras un repo y de pronto `listSessions()` no encuentra la sesión por `task_id`, has usado `id` en vez de `node_id`.

### Pitfall 5: Provider `state` no-transformado contra dispatcher case-sensitive comparison

**What goes wrong:** Dispatcher hace `terminalStates.some((s) => s.toLowerCase() === task.state.toLowerCase())` (línea 87). Si normalizer devuelve `state: undefined`, el `.toLowerCase()` revienta.

**Why it happens:** `state` está marcado `state?: string` en `interface.js:22` (opcional). GitHub siempre devuelve `'open'` o `'closed'`, así que NO debería ser undefined — pero un fixture mal formado podría dispararlo.

**How to avoid:** D-16 explícito `state = issue.state` literal (siempre string `'open'`/`'closed'` desde GitHub). Verificar con test fixture `issue.json:10`.

**Warning signs:** `dispatcher.js:87` `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`.

### Pitfall 6: Registry `try { ... } catch { }` swallow oculta errores reales

**What goes wrong:** El bloque `try { ... } catch { }` en `registerDefaults` (`registry.js:21-41`) silencia errores de import. Si añades un bug en `github/provider.js` que rompe el import (e.g., `import` mal escrito), `registerDefaults` lo swallow y `factories.set('github', ...)` no se registra — luego `getProvider('github')` lanza "Unknown provider: github" en vez del import error real.

**Why it happens:** El catch existe para que tests con `clearRegistry()` no fallen al re-importar config.

**How to avoid:** Tests `test/registry.test.js` (D-38) deben (a) registrar manualmente vía `registerProvider('github', () => fakeGitHubProvider)` para validar el gate, y (b) si quieren validar el bloque real, importarlo directo. Durante development: `node -e "import('./src/providers/github/provider.js')"` para detectar import errors antes de pushear.

**Warning signs:** `getProvider('github')` lanza "Unknown provider" en lugar de "Provider 'github' missing method X" — significa que `factories.set` no corrió por error pre-set.

### Pitfall 7: `parseRef` con repos cuyo nombre contiene `/` o `#`

**What goes wrong:** El regex `^([^/]+)\/([^#]+)#(\d+)$` asume `owner` sin `/` y `repo` sin `#`. GitHub permite `repo` con caracteres restringidos pero NO `/` ni `#`, así que es safe — pero `owner` puede tener guiones, dots, underscores. El regex actual permite cualquier `[^/]+` así que OK.

**Why it happens:** Sobre-restricción accidental al copiar el regex Plane (`^([A-Z]+)-(\d+)$`).

**How to avoid:** Verificar con fixture `octocat/hello-world#42`, `kodo-test/fixture-repo#42`, `Microsoft/TypeScript#123`. Mínimo 3 cases en `parseRef` test.

**Warning signs:** Tests pass `KL-42`-like refs pero fail con `microsoft.github.io/repo#1`.

### Pitfall 8: Importar `picocolors` directo desde provider (color isolation invariant)

**What goes wrong:** El temptation de coloreer logs desde el provider rompe el invariante v0.5: `picocolors` solo desde `src/cli/format.js`.

**How to avoid:** Phase 24 NO importa `picocolors`. El `logger` (Phase 6) ya emite NDJSON estructurado, no coloreado. Verificar tras edits: `grep -r "picocolors" src/providers/github/` debe devolver vacío.

**Warning signs:** Manual code review highlights `import pc from 'picocolors'` en provider.js.

## Code Examples

### Test pattern (lifted from `test/providers/github/client.test.js`)

```javascript
// Source: test/providers/github/client.test.js:32-43 — Phase 23 verified
const _originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject fetch via constructor opts');
  };
});
after(() => { globalThis.fetch = _originalFetch; });
```

**Adaptación Phase 24:** Misma idiom para `provider.test.js`. Cada test construye `fakeClient` (D-36):
```javascript
function makeFakeClient(overrides = {}) {
  return {
    getIssue: async () => { throw new Error('fakeClient.getIssue not stubbed'); },
    listIssues: async () => ({ status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 }),
    addComment: async () => ({ id: 1 }),
    updateIssue: async () => ({}),
    listLabels: async () => [],
    ...overrides,
  };
}

it('getTask normalizes a fetched issue', async () => {
  const fakeClient = makeFakeClient({
    getIssue: async (owner, repo, number) => {
      assert.equal(owner, 'kodo-test');
      assert.equal(repo, 'fixture-repo');
      assert.equal(number, 42);
      return issueFixture;
    },
  });
  const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
  const task = await provider.getTask('kodo-test/fixture-repo#42');
  assert.equal(task.id, 'I_kwTEST001');
  assert.equal(task.ref, 'kodo-test/fixture-repo#42');
  assert.equal(task.state, 'open');
});
```

### Normalize test pattern (lifted from `test/normalize.test.js`)

```javascript
// Source: test/normalize.test.js:70-86
describe('normalizeWorkItem', () => {
  it('converts Plane work item to canonical TaskItem', () => {
    const result = normalizeWorkItem(workItemFixture, defaultContext);
    assert.equal(result.id, 'a1b2c3d4-...');
    assert.equal(result.ref, 'KL-42');
    // ... etc
  });
});
```

**Adaptación Phase 24:** Cada branch crítico del normalizer (D-35):
- Priority extraction: `urgent`, `high`, `medium`, `low`, miss, invalid (`'critical'`), case-insensitive
- Body: null, undefined, empty string, full Markdown
- Labels: array of strings, array of objects, empty
- State: open, closed
- id mapping: assert `result.id === issue.node_id` (NOT `issue.id`)
- groups: always `[]` (even si issue tiene milestone)

### Registry test extension (per D-38)

```javascript
// Source: test/registry.test.js — extend after line 84
it('getProvider("github") validates 9-method contract', () => {
  registerProvider('github', () => createFakeProvider());
  const provider = getProvider('github');
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
  }
});
```

**Importante:** El test NO debe disparar `loadConfig()` real (no hay fixture de config con `providers.github` válido en v0.6). La inyección vía `registerProvider` evita ese path. Si en algún punto se quiere validar el `registerDefaults` block real, hacerlo con un test de integración separado que mockee `loadConfig`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plane only (single provider) | Provider abstraction (Plane + GitHub) | v0.2 (2026-04-13) | Validates "swap provider, keep logic" promise. |
| HTML-strip en description | Markdown crudo (GitHub) | Phase 24 (D-10) | Cross-provider divergence justificada por API differences. |
| Cache labels+states en `init()` | No-op init para GitHub | Phase 24 (D-19) | Labels embedded → no necesita pre-fetch. |
| Webhook signature HMAC | No-op `verifySignature → false` | Phase 24 (D-27) | Polling-only en v0.7. |

**Deprecated/outdated:**
- ROADMAP §Phase 24 SC#1 listing `listTasks/listLabels/listStates/transitionTask` — corregido 2026-05-14 (CONTEXT.md D-01).
- REQUIREMENTS §GH-02 listing those same fantasy methods — corregido 2026-05-14.

## Project Constraints (from CLAUDE.md)

Repo `kodo` NO tiene `./CLAUDE.md` propio (verificado: `ls /Users/alex/dev/klab/kodo/CLAUDE.md` no existe). El planner consume:

- **TESTING.md:** `node:test` + `node:assert/strict`; `test/` dir; `npm test` script. No mocking framework.
- **CONVENTIONS.md:** `// @ts-check` top of file; kebab-case files; camelCase exports; JSDoc on public methods; `throw new Error(\`Context: detail\`)` pattern.
- **STATE.md §Critical Invariants:**
  - **TaskProvider 9-method contract** frozen.
  - **TaskItem shape provider-agnostic** (Phase 27 TEST-03 valida).
  - **`parseKodoLabels` provider-agnostic** — `src/labels.js` untouched.
  - **LOG-12 guard:** `kodo check` no transitively loads `src/logger.js` — Phase 24 NO importa nada que rompa el árbol.
  - **Color isolation:** Phase 24 NO importa `picocolors` directo.
- **Karpathy rules (global):** simplicity first (D-19, D-22, D-14), cambios quirúrgicos (un solo file modificado fuera de `providers/github/`), no overengineering.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GitHub `listIssues` con `labels=kodo` aplica AND-match (incluye issues con `kodo` + cualquier otra) — no OR-match | Architecture Patterns D-25 verification | Bajo. Documentado en GitHub REST docs como query param; comportamiento server-side. [ASSUMED — confirmable con un curl manual contra api.github.com] |
| A2 | El `node_id` es estable cross-rename de owner/repo y cross-transfer del repo | Pitfall #4 / D-07 | Bajo. GitHub doc indica que `node_id` es el GraphQL identifier (opaque, stable). [ASSUMED — no probado live, pero ROADMAP/CONTEXT lo asume] |
| A3 | GitHub permite `repo` names con dots/underscores pero NO `/` ni `#` (relevante para `parseRef` regex) | Pitfall #7 | Bajo. GitHub repo naming docs son explicitos. [ASSUMED] |
| A4 | Phase 25 polling.js consume `provider.listPendingTasks()` para warmup inicial pero llama `client.listIssues({etag})` directo para ticks subsecuentes | Cross-Phase Coupling | Medio. CONTEXT.md D-25 sugiere ambos paths; si Phase 25 decide solo via provider, falta método con etag — pero ese sería un cambio de contrato del provider en Phase 25, no en Phase 24. [ASSUMED] |
| A5 | El registry `try/catch` swallow en `registerDefaults` no causa flakiness en CI por orden de tests | Pitfall #6 | Bajo. `clearRegistry()` en `beforeEach` lo aisla, comportamiento heredado. [ASSUMED — Phase 23 no introdujo regresión] |

**If this table is empty:** N/A — 5 assumptions identificadas. Todas son de riesgo bajo-medio y no bloquean implementación; el planner puede proceder y el agente verify-work confirmará en runtime con tests.

## Open Questions

1. **¿`parseRef` debe normalizar el `owner`/`repo` a lower-case?**
   - **What we know:** GitHub URLs son case-insensitive para owner/repo (`github.com/Octocat/Hello-World` == `github.com/octocat/hello-world`). Pero los APIs devuelven el casing canonical del owner. Plane normaliza prefix a UPPER (`provider.js:52` `match[1].toUpperCase()`).
   - **What's unclear:** Si dos sesiones se crean para `Octocat/Hello-World#42` y `octocat/hello-world#42`, ¿colisionan en `task.id`? Sí, porque `task.id = node_id` que es opaque y único — el ref-as-string difiere pero el lookup interno coalesce.
   - **Recommendation:** NO normalizar en `parseRef` (preservar input). El node_id resuelve la dedup. Si emerge necesidad, planner puede añadir lower-case + test en v0.8+.

2. **¿`listPendingTasks` debe surface `client.listIssues` `etag` para que Phase 25 lo persista?**
   - **What we know:** D-25 dice "sin etag persistente"; el client devuelve envelope `{status, items, etag, rate_limit_remaining}` pero el provider lo descarta tras normalizar.
   - **What's unclear:** Si Phase 25 quiere etag desde el provider (en vez de bypass al client), necesitaría extender el shape de retorno → rompería contract Phase 27 TEST-03 que asume `TaskItem[]` puro.
   - **Recommendation:** Phase 25 accede al client directamente para el path etag (consistente con CONTEXT.md D-25 final). NO cambiar `listPendingTasks` shape en Phase 24.

3. **¿Validar shape de `config.providers.github` en el factory o en runtime?**
   - **What we know:** D-31 dice "Phase 24 NO modifica `src/config.js`"; el factory no valida shape, simplemente accede `config.repos`, `config.states`, `config.base_url`.
   - **What's unclear:** Si Phase 26 wizard genera config malformado, el primer crash será en `client.listIssues(undefined, undefined, ...)` → mensaje poco útil.
   - **Recommendation:** El planner puede añadir guard fail-fast en el factory: `if (!Array.isArray(config.repos)) throw new Error(...)`. NO requerido por CONTEXT.md pero buena ciudadanía. Bajo prioridad — Phase 26 es el owner del schema.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 20+) + `node:assert/strict` |
| Config file | none — runner built into Node |
| Quick run command | `node --test test/providers/github/provider.test.js test/providers/github/normalize.test.js test/registry.test.js` |
| Full suite command | `npm test` |
| Estimated runtime | quick ~1s; full ~3-4s (baseline v0.6, +N tests Phase 24) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GH-02 / D-01 | `createGitHubProvider` returns object with all 9 `TASK_PROVIDER_METHODS` as functions | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-19 | `init()` is no-op (zero API calls; doesn't throw) | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-20 | `getTask('owner/repo#N')` → `parseRef → client.getIssue → normalizeIssue`; returns TaskItem | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-21 | `resolveRef('owner/repo#N')` returns `issue.node_id`; invalid ref throws with expected message | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-22 | `parseRef` accepts `owner/repo#N`; rejects `KL-42`, `#42`, URL formats with canonical error | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-23 | `updateTaskState(task, 'closed')` PATCHes with `{state:'closed'}`; passthrough 'open'/'closed'; rejects unknown | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-24 | `addComment(task, '## md')` posts markdown literal (no HTML wrap) | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-25 | `listPendingTasks()` iterates `config.repos`, calls `client.listIssues({labels:['kodo'], state:'open'})`, filters PRs, concats normalized | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-26 | `parseTriggerEvent(anyPayload)` returns `null` deterministically | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-27 | `verifySignature(rawBody, headers)` returns `false` deterministically | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-02 / D-28 | `listProjects()` returns `config.repos.map(...)` without invoking client | unit | `node --test test/providers/github/provider.test.js` | ❌ Wave 0 |
| GH-03 / D-07..D-18 | `normalizeIssue(fixture, context)` produces TaskItem with all 11 fields per shape table | unit | `node --test test/providers/github/normalize.test.js` | ❌ Wave 0 |
| GH-03 / D-10 | `body: null` → `description: ''`; `body: undefined` → `description: ''`; `body: 'hello'` → `description: 'hello'` (markdown literal) | unit | `node --test test/providers/github/normalize.test.js` | ❌ Wave 0 |
| GH-03 / D-11 | `labels: [{name:'a'}, {name:'b'}]` → `['a','b']`; empty → `[]`; strings array → strings as-is | unit | `node --test test/providers/github/normalize.test.js` | ❌ Wave 0 |
| GH-03 / D-14 | `groups` is always `[]` even if issue has milestone | unit | `node --test test/providers/github/normalize.test.js` | ❌ Wave 0 |
| GH-03 / D-17 | priority extraction: `priority:urgent`/`priority:high`/`priority:medium`/`priority:low` cases; case-insensitive; `priority:critical` → null; no `priority:` label → null | unit | `node --test test/providers/github/normalize.test.js` | ❌ Wave 0 |
| GH-04 / D-29..D-30 | `getProvider('github')` validates 9-method contract (via `registerProvider` injection in test) | unit | `node --test test/registry.test.js` | ✅ (extend) |
| GH-05 / D-32 | `parseKodoLabels(task.labels.map(name => ({name})))` recognizes `kodo`/`kodo:sonnet` from a normalized GitHub TaskItem | unit | `node --test test/labels.test.js` (or inline) | ✅ |
| TEST-01 / D-35 | normalizer test file covers ≥ 90% branches (priority×5, body×3, labels×3, state×2, id×1, groups×1 = 15 branches min) | coverage | manual review via test count | ❌ Wave 0 |
| TEST-01 / D-37 | Zero live API calls: leak guard throws if any test forgets `opts.client` injection | unit | `node --test test/providers/github/provider.test.js` (top-of-file `before`/`after`) | ❌ Wave 0 |
| invariant LOG-12 | `kodo check` does NOT transitively import `src/providers/github/provider.js` or `normalize.js` | integration | `node --test test/check-isolation.test.js` | ✅ (extend per Phase 23 precedent) |

### Sampling Rate

- **Per task commit:** `node --test test/providers/github/{provider,normalize}.test.js` (quick — afecta solo el módulo tocado).
- **Per wave merge:** `npm test` full suite — debe estar verde antes de pasar al siguiente wave.
- **Phase gate:** `npm test` verde + zero live API calls + LOG-12 guard verde antes de `/gsd-verify-work`.
- **Max feedback latency:** ≤ 5s wall-time por quick run; full suite ≤ 5s.

### Wave 0 Gaps

- [ ] `test/providers/github/provider.test.js` — file does not yet exist (Phase 23 sólo creó `client.test.js`).
- [ ] `test/providers/github/normalize.test.js` — file does not yet exist.
- [ ] `test/fixtures/github/issue-with-priority.json` — new fixture (D-34).
- [ ] `test/fixtures/github/issue-with-kodo.json` — new fixture (D-34).
- [ ] `test/fixtures/github/issue-closed.json` — new fixture (D-34).
- [ ] `test/fixtures/github/issue-no-body.json` — new fixture (D-34).
- [ ] `test/fixtures/github/issue-no-labels.json` — new fixture (D-34).
- [ ] `test/registry.test.js` — extend with `getProvider('github')` test case (D-38).
- [ ] `test/check-isolation.test.js` — extend (or create new test row) verifying `src/providers/github/provider.js` is NOT in `kodo check` transitive graph (per Phase 23 23-02-12 precedent).

*Framework already installed (Node built-in); fixtures + new test files are the only Wave 0 deliverables.*

### Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-provider TaskItem shape symmetry | invariant v0.2 / Phase 27 TEST-03 | Phase 27 is the owner of automated cross-provider matrix; Phase 24 only ships the GitHub side | After Phase 24 green, run `npm test` then inspect any TaskItem fixture in test logs to confirm GitHub TaskItem.priority and Plane TaskItem.priority share `'urgent'|'high'|'medium'|'low'|null` enum |
| GitHub API contract drift | GH-02/GH-03 | If GitHub changes `node_id`/`html_url`/`state` field names, fixtures become stale | Quarterly: re-run `scripts/capture-github-fixtures.js` (Phase 23 plan 23-03 is optional) against canonical repo and diff |
| ROADMAP/REQUIREMENTS doc consistency | D-01 | Documentation drift not caught by code tests | Pre-plan grep: `grep -E "listTasks|listLabels|listStates|transitionTask" .planning/ROADMAP.md .planning/REQUIREMENTS.md` must return zero matches (text already corrected 2026-05-14) |

## Security Domain

Phase 24 NO introduce nuevas superficies de seguridad — es pure code refactor consumiendo el client Phase 23 que ya gestiona auth/HMAC. La matriz ASVS aplica de forma minimal:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (heredado Phase 23) | `Authorization: token <PAT>` via `GitHubClient`; Phase 24 no toca auth header |
| V3 Session Management | no | N/A — `TaskProvider` no maneja sesiones HTTP |
| V4 Access Control | no | GitHub PAT scope es el control; Phase 24 no añade roles |
| V5 Input Validation | yes | `parseRef` regex strict (D-22) valida shape `owner/repo#N`; rechaza inputs malformed |
| V6 Cryptography | no | `verifySignature → false` (D-27) — no HMAC en v0.7. Si v0.8+ añade webhook, mirror Plane HMAC con `timingSafeEqual` |
| V14 Configuration | yes (light) | Factory NO loguea `config.api_key`/`token` — sólo consume vía `GitHubClient` que ya redacta |

### Known Threat Patterns for Node 20 / GitHub adapter

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leakage via stack trace | Information disclosure | `GitHubClient` constructor lanza con mensaje genérico "GitHub token not found"; Phase 24 nunca incluye `config.token` en error templates |
| Comment injection (markdown XSS) | Tampering | Phase 24 `addComment` envía markdown literal; XSS-de-output es responsabilidad del renderer GitHub (no del provider). PlaneClient envuelve en `<p>` HTML (riesgo HTML injection real); GitHub markdown NO requiere ese workaround |
| Ref injection (regex bypass) | Tampering / DoS | `parseRef` regex strict `^([^/]+)\/([^#]+)#(\d+)$` rechaza variaciones; el `parseInt(match[3], 10)` previene NaN/Infinity injection en `number` param |
| Webhook signature bypass (N/A v0.7) | Spoofing | `verifySignature → false` siempre (D-27) → si el webhook handler lo invoca, rechaza el evento. NO es path activo en v0.7 polling. |
| Untrusted fixture in tests | Tampering | Fixtures viven en repo committed; cualquier modificación es revisable. Phase 24 NO descarga fixtures externos en runtime. |

**No new attack surface introduced.** El planner debe verificar que ningún archivo Phase 24 importa `child_process`, `node:fs` con paths user-input, o ejecuta `eval`/`new Function`. (Verificación tras edits: `grep -E "child_process|new Function|eval\\(" src/providers/github/`.)

## Sources

### Primary (HIGH confidence)

- `src/interface.js` (canonical contract) — `TASK_PROVIDER_METHODS`, `TaskItem` typedef, `VALID_PRIORITIES`. Verified directly.
- `src/providers/plane/provider.js` (template) — factory pattern, parseRef helper, 9 method literal, JSDoc style.
- `src/providers/plane/normalize.js` (template) — pure normalizer pattern, `VALID_PRIORITIES` usage, context shape.
- `src/providers/registry.js` (mod target) — `registerDefaults` block, lazy import + factory map pattern.
- `src/providers/github/client.js` (Phase 23) — 5 public methods, 304 envelope shape, error codes, fetch injection pattern.
- `src/labels.js` (untouched dependency) — `parseKodoLabels` provider-agnostic contract.
- `src/triggers/dispatcher.js:65,74,83-88` (consumer) — `task.labels.map(name => ({name}))` + `task.state.toLowerCase()` comparison patterns.
- `test/plane-provider.test.js`, `test/normalize.test.js`, `test/registry.test.js` (test templates) — `describe`/`it`/`beforeEach`, fetch leak guard, fixture loader pattern.
- `test/providers/github/client.test.js` (Phase 23 verified 15-test suite) — `makeFetch`/`makeSpyFetch`/`makeSpyLogger` helpers, fixture import via `with { type: 'json' }`.
- `test/fixtures/github/{issue,issues-list,comment-created,labels-list}.json` (Phase 23 fixtures) — confirma shape `node_id`, `body: null`, `pull_request`, `labels[].name`.
- `.planning/phases/24-githubprovider-normalizer-registry/24-CONTEXT.md` — 42 locked decisions.
- `.planning/phases/23-githubclient-auth-foundation/{23-CONTEXT.md, 23-VALIDATION.md}` — pattern precedent.

### Secondary (MEDIUM confidence)

- `.planning/STATE.md §Critical Invariants to Preserve (v0.7)` — TaskProvider 9-method, label invariant, LOG-12, color isolation.
- `.planning/REQUIREMENTS.md §GH-02..GH-05, TEST-01` — corregidos 2026-05-14 (D-01 reconciliation).
- `.planning/ROADMAP.md §Phase 24` — corregido 2026-05-14.
- `.planning/codebase/{TESTING.md, CONVENTIONS.md}` — test patterns + style rules.

### Tertiary (LOW confidence)

- GitHub REST API docs (`docs.github.com/en/rest/issues/issues`) — [CITED] for `node_id`/`html_url`/`state`/`pull_request` field semantics. Not fetched live this session; relied on Phase 23 fixtures + client.js docstrings as proxy verification.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `node:test`/`node:assert/strict` verified via `package.json`; cero deps nuevas.
- Architecture patterns: HIGH — Plane templates leídos completos; CONTEXT.md D-01..D-42 ya cierran shape.
- Pitfalls: HIGH — derivados de Phase 23 fixtures (PR contamination, body=null) y de invariantes ya documentados (color isolation, LOG-12).
- Cross-phase coupling: MEDIUM — Phase 25 contract derivado de CONTEXT.md, no de código Phase 25 (no existe aún).
- GitHub API payload shape: HIGH para campos consumidos; MEDIUM para edge cases (label as string en endpoints raros).

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 días, stack estable — solo cambia si GitHub renombra `node_id`/`state` fields, evento improbable; ROADMAP/REQUIREMENTS doc drift es el único riesgo conocido).
