# Phase 24: GitHubProvider + Normalizer + Registry — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 3 nuevos + 2 modificados + 5 fixtures nuevas (10 total)
**Analogs found:** 10 / 10 (100% cobertura — todos los archivos tienen análogo directo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/providers/github/provider.js` | provider/adapter factory | request-response | `src/providers/plane/provider.js` (253 LOC) | exact (template estructural 1:1) |
| `src/providers/github/normalize.js` | pure transform | transform | `src/providers/plane/normalize.js` (118 LOC) | exact (mirror función pura) |
| `src/providers/registry.js` (MOD) | service/registry | lazy-init lookup | bloque `plane` líneas 25-38 (mismo archivo) | exact (paste idéntico + key rename) |
| `test/providers/github/provider.test.js` | test (contract) | unit | `test/plane-provider.test.js` (125 LOC) | exact (contract + fakeClient injection) |
| `test/providers/github/normalize.test.js` | test (unit) | unit | `test/normalize.test.js` (161 LOC) | exact (per-field + fixture-loading) |
| `test/registry.test.js` (MOD) | test (registry) | unit | tests existentes mismo archivo | exact (extender con `'github'` case) |
| `test/check-isolation.test.js` (MOD) | test (invariant) | static graph walk | tests existentes mismo archivo | exact (añadir filas `github/*.js`) |
| `test/fixtures/github/issue-with-priority.json` | fixture | data | `test/fixtures/github/issue.json` (Phase 23) | exact (fork + mutate `labels`) |
| `test/fixtures/github/issue-with-kodo.json` | fixture | data | `test/fixtures/github/issue.json` | exact (fork + mutate `labels`) |
| `test/fixtures/github/issue-closed.json` | fixture | data | `test/fixtures/github/issue.json` | exact (fork + mutate `state`) |
| `test/fixtures/github/issue-no-body.json` | fixture | data | `test/fixtures/github/issue.json` | exact (fork + `body: null`) |
| `test/fixtures/github/issue-no-labels.json` | fixture | data | `test/fixtures/github/issue.json` | exact (fork + `labels: []`) |

**DO NOT TOUCH (invariantes locked):**
- `src/labels.js` — GH-05 invariante. `parseKodoLabels` ya es provider-agnostic, recibe `Array<{name}>`. Dispatcher hace `task.labels.map(name => ({name}))`. **Cero cambios.**
- `src/triggers/dispatcher.js` — D-32 / config-driven. La línea 83-88 ya soporta GitHub cuando `config.providers.github.states.done = 'closed'`. **Cero cambios.**
- `src/providers/github/client.js` — Phase 23 shipped (333 LOC, 15 tests verdes). Phase 24 lo CONSUME, no lo modifica.
- `src/config.js` — Phase 26 owner. Phase 24 ASUME `config.providers.github` presente (D-31).
- `src/interface.js` — contrato canonical, read-only.
- `src/logger-events.js` — Phase 23 ya cerró `github.api.call` / `github.api.call.failed`. **Cero eventos nuevos.**

---

## Pattern Assignments

### 1. `src/providers/github/provider.js` (provider/adapter factory, request-response)

**Analog:** `src/providers/plane/provider.js` (253 LOC en total — leer en full)
**Files-it-reads (data flow IN):** `./client.js` (Phase 23), `./normalize.js` (nuevo), `../../interface.js` (typedef only)
**Files-that-read-it (data flow OUT):** `src/providers/registry.js` (factory lazy-import), tests
**Expected LOC:** ~150-180 (vs 253 Plane — D-19 elimina init/3 ciclos cache).

#### Pattern A — Header doc (lift de `client.js:1-31`, mirror D-39)

Mirror estructural del header de Phase 23 client.js. Reescribir para describir:
- contrato (los 9 métodos)
- D-01 (contrato real vs ROADMAP)
- D-19 (init no-op)
- D-24 (markdown literal, no HTML wrap)
- D-26/D-27 (webhook no-op)
- referencia a CONTEXT.md

#### Pattern B — Imports + typedef (mirror `plane/provider.js:1-15`)

```javascript
// Source: src/providers/plane/provider.js:1-15
// @ts-check
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PlaneClient } from './client.js';
import { normalizeWorkItem, parseTriggerEvent } from './normalize.js';

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   workspaceSlug: string,
 *   projects: Array<{id: string, identifier: string, name: string}>,
 *   states: {trigger: string, review: string, done: string},
 *   webhookSecret?: string,
 * }} PlaneProviderConfig
 */
```

**What changes for Phase 24:**
- DROP `import { createHmac, timingSafeEqual } from 'node:crypto'` — D-27 verifySignature no-op, sin HMAC.
- IMPORT `{ GitHubClient } from './client.js'` (no PlaneClient).
- IMPORT `{ normalizeIssue } from './normalize.js'` (sin `parseTriggerEvent` — D-26 no-op inline en el provider).
- TYPEDEF `GitHubProviderConfig`:
  ```javascript
  /**
   * @typedef {{
   *   base_url: string,
   *   api_key_env: string,
   *   repos: Array<{owner: string, repo: string}>,
   *   states: {trigger: string, review: string, done: string},
   * }} GitHubProviderConfig
   */
  ```
  Notar `base_url` / `api_key_env` snake_case porque vienen del config directo (`config.providers.github`), mientras Plane usa camelCase porque el registry los transforma (registry.js:30-37). Phase 24 NO transforma — el factory recibe el sub-objeto raw del config (D-29).

#### Pattern C — Factory signature + closure (lift de `plane/provider.js:17-32`)

```javascript
// Source: src/providers/plane/provider.js:17-32
/**
 * Factory that creates a TaskProvider adapter for Plane.
 *
 * @param {PlaneProviderConfig} config
 * @param {{ logger?: import('../../logger.js').Logger }} [opts]
 * @returns {import('../../interface.js').TaskProvider}
 */
export function createPlaneProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'plane' });
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
    logger,
  });
```

**What changes for Phase 24:**
- Renombrar `createPlaneProvider` → `createGitHubProvider`.
- `logger.child({component: 'github'})` (D-05).
- D-36 + D-41: `opts` extiende con `client?: GitHubClient` para inyección en tests:
  ```javascript
  /**
   * @param {GitHubProviderConfig} config
   * @param {{
   *   logger?: import('../../logger.js').Logger,
   *   client?: import('./client.js').GitHubClient
   * }} [opts]
   * @returns {import('../../interface.js').TaskProvider}
   */
  export function createGitHubProvider(config, opts = {}) {
    const logger = opts.logger?.child({ component: 'github' });
    const client = opts.client || new GitHubClient({
      baseUrl: config.base_url,
      // token undefined → GitHubClient lee getProviderApiKey('github') (Phase 23 client.js:84)
      logger,
    });
  ```
- **DROP closures sobre cache state** (D-19): NO `labelCache`, NO `stateCache`, NO `stateByName`, NO `moduleCache`, NO `initTimestamp`. Estos 5 statefuls de Plane (líneas 33-42) no existen en GitHub.

#### Pattern D — `parseRef` helper privado (mirror `plane/provider.js:44-53`)

```javascript
// Source: src/providers/plane/provider.js:44-53
/**
 * Parse a human-readable ref like "KL-42" into identifier prefix and sequence number.
 * @param {string} ref
 * @returns {{ prefix: string, sequenceId: number }}
 */
function parseRef(ref) {
  const match = ref.match(/^([A-Z]+)-(\d+)$/i);
  if (!match) throw new Error(`Invalid task ref: ${ref}. Expected format: KL-42`);
  return { prefix: match[1].toUpperCase(), sequenceId: parseInt(match[2], 10) };
}
```

**What changes for Phase 24 (D-22, D-40):**
- Mismo nombre `parseRef` (local, no exported — D-40 sin colisión).
- Regex GitHub: `/^([^/]+)\/([^#]+)#(\d+)$/`.
- Devuelve `{owner, repo, number}` en lugar de `{prefix, sequenceId}`.
- Mensaje error grep-friendly: `Invalid GitHub ref: ${ref}. Expected owner/repo#number`.
```javascript
function parseRef(ref) {
  const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) throw new Error(`Invalid GitHub ref: ${ref}. Expected owner/repo#number`);
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}
```

**DROP `findProject` helper** (plane provider.js:55-64) — GitHub no necesita lookup en `config.projects` por identifier, el ref ya trae `owner/repo` directo.

#### Pattern E — Provider literal con orden de métodos (mirror `plane/provider.js:66-67`)

```javascript
// Source: src/providers/plane/provider.js:66-67
/** @type {import('../../interface.js').TaskProvider} */
const provider = {
```

**What changes for Phase 24 (D-42):** seguir orden de `TASK_PROVIDER_METHODS`: `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`.

#### Pattern F — Method `init()` (mirror simplificado de `plane/provider.js:68-123`)

**What changes for Phase 24 (D-19):** **TOTAL simplification.** Plane tiene 56 líneas (TTL guard + 3 ciclos cache). Phase 24:
```javascript
async init() {},  // D-19: no-op completo
```

#### Pattern G — Method `getTask(ref)` (mirror `plane/provider.js:125-160`)

```javascript
// Source: src/providers/plane/provider.js:125-160 (resumen estructural)
async getTask(ref) {
  const { prefix, sequenceId } = parseRef(ref);
  const proj = findProject(prefix);
  const workItem = await client.getWorkItemBySequence(proj.id, sequenceId);
  if (!workItem) throw new Error(`Work item ${ref} not found`);
  const context = { labels: labelCache, projectIdentifier: proj.identifier, ... };
  const task = normalizeWorkItem(workItem, context);
  // … módulo lookup fallback …
  return task;
},
```

**What changes for Phase 24 (D-20):**
```javascript
async getTask(ref) {
  const { owner, repo, number } = parseRef(ref);
  const issue = await client.getIssue(owner, repo, number);
  return normalizeIssue(issue, { projectId: `${owner}/${repo}` });
},
```
- Sin `findProject` lookup.
- Sin `if (!workItem) throw` — `client.getIssue` ya lanza `Error.code='not_found'` con 404 (Phase 23 D-12).
- Sin módulo lookup (D-14: groups siempre `[]`).
- Context simple: `{projectId: 'owner/repo'}` — sin labelCache, sin stateMap.

#### Pattern H — Method `updateTaskState(task, stateName)` (mirror `plane/provider.js:162-180`)

```javascript
// Source: src/providers/plane/provider.js:162-180 (estructura)
async updateTaskState(task, stateName) {
  let stateId = stateByName.get(task.projectId)?.get(stateName);
  if (!stateId) { /* cache miss → refresh */ }
  await client.updateWorkItem(task.projectId, task.id, { state: stateId });
},
```

**What changes for Phase 24 (D-23):** passthrough hard, sin cache lookup.
```javascript
async updateTaskState(task, stateName) {
  const { owner, repo, number } = parseRef(task.ref);
  // D-23: passthrough — callers resuelven config.providers.github.states.X antes.
  if (stateName !== 'open' && stateName !== 'closed') {
    const states = config.states || {};
    if (!Object.values(states).includes(stateName)) {
      throw new Error(
        `Unknown state: ${stateName}. Configured: ${Object.values(states).join(', ')}`,
      );
    }
  }
  await client.updateIssue(owner, repo, number, { state: stateName });
},
```

#### Pattern I — Method `addComment(task, markdownText)` (mirror `plane/provider.js:182-185`)

```javascript
// Source: src/providers/plane/provider.js:182-185
async addComment(task, markdownText) {
  const html = '<p>' + markdownText.replace(/\n/g, '<br>') + '</p>';
  await client.createComment(task.projectId, task.id, html);
},
```

**What changes for Phase 24 (D-24):** **DROP el `<p>...<br></p>` wrap.** GitHub acepta Markdown nativo (Phase 23 client.js:285 doc explícito).
```javascript
async addComment(task, markdownText) {
  const { owner, repo, number } = parseRef(task.ref);
  // D-24: markdown literal — GitHub no necesita HTML wrap.
  await client.addComment(owner, repo, number, markdownText);
},
```

**DROP `listComments`** (plane provider.js:187-195) — NO está en `TASK_PROVIDER_METHODS`, Plane lo tiene legacy fuera de contrato.

#### Pattern J — Method `listPendingTasks()` (mirror `plane/provider.js:197-215`)

```javascript
// Source: src/providers/plane/provider.js:197-215
async listPendingTasks() {
  const allTasks = [];
  for (const proj of config.projects) {
    const items = await client.listWorkItems(proj.id);
    const pending = items.filter((item) => stateCache.get(item.state) === config.states.trigger);
    const context = { labels: labelCache, projectIdentifier: proj.identifier, ... };
    for (const item of pending) {
      allTasks.push(normalizeWorkItem(item, context));
    }
  }
  return allTasks;
},
```

**What changes for Phase 24 (D-25):** server-side filter, sin cache lookup, **filtrar PRs**.
```javascript
async listPendingTasks() {
  const allTasks = [];
  for (const r of config.repos || []) {
    const result = await client.listIssues(r.owner, r.repo, {
      labels: ['kodo'],
      state: 'open',
    });
    // Pitfall #2 GitHub: PRs vienen intermixed (issues con .pull_request != null).
    // Ver test/fixtures/github/issues-list.json:42-57 para el shape PR.
    for (const issue of result.items) {
      if (issue.pull_request) continue;
      allTasks.push(normalizeIssue(issue, { projectId: `${r.owner}/${r.repo}` }));
    }
  }
  return allTasks;
},
```
- `client.listIssues` devuelve envelope `{status, items, etag, ...}` (Phase 23 D-19) — usar `result.items`.
- Sin etag persistente (D-25: Phase 25 owns polling-state).

#### Pattern K — Methods `parseTriggerEvent` / `verifySignature` (lift de `plane/provider.js:217-232`)

```javascript
// Source: src/providers/plane/provider.js:217-232
parseTriggerEvent(rawPayload) {
  return parseTriggerEvent(rawPayload, labelCache, config.projects);
},

verifySignature(rawBody, headers) {
  const signature = headers['x-plane-signature'];
  if (!signature || !config.webhookSecret) return false;
  const expected = createHmac('sha256', config.webhookSecret)
    .update(rawBody)
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
},
```

**What changes for Phase 24 (D-26, D-27):** ambos no-op funcional.
```javascript
parseTriggerEvent(_rawPayload) {
  return null;  // D-26: GitHub polling-only en v0.7
},

verifySignature(_rawBody, _headers) {
  return false;  // D-27: webhook off, sin secret
},
```
**Prefix `_` en los params** señala intencionalmente que no se consumen — convención repo para silenciar linter no-unused-vars.

#### Pattern L — Method `resolveRef(humanRef)` (mirror `plane/provider.js:243-249`)

```javascript
// Source: src/providers/plane/provider.js:243-249
async resolveRef(humanRef) {
  const { prefix, sequenceId } = parseRef(humanRef);
  const proj = findProject(prefix);
  const workItem = await client.getWorkItemBySequence(proj.id, sequenceId);
  if (!workItem) throw new Error(`Work item ${humanRef} not found`);
  return workItem.id;
},
```

**What changes for Phase 24 (D-21):**
```javascript
async resolveRef(humanRef) {
  const { owner, repo, number } = parseRef(humanRef);
  const issue = await client.getIssue(owner, repo, number);
  return issue.node_id;  // D-07: id = node_id
},
```

#### Pattern M — Method `listProjects()` (mirror `plane/provider.js:234-241`)

```javascript
// Source: src/providers/plane/provider.js:234-241
async listProjects() {
  const rawProjects = await client.listProjects();
  return rawProjects.map((p) => ({
    id: p.id,
    identifier: p.identifier,
    name: p.name,
  }));
},
```

**What changes for Phase 24 (D-28):** **cero API calls** — devuelve directo desde `config.repos`.
```javascript
async listProjects() {
  // D-28: cero API calls. Phase 26 wizard llama al client directo si quiere enriquecer.
  return (config.repos || []).map((r) => ({
    id: `${r.owner}/${r.repo}`,
    identifier: `${r.owner}/${r.repo}`,
    name: `${r.owner}/${r.repo}`,
  }));
},
```

---

### 2. `src/providers/github/normalize.js` (pure transform)

**Analog:** `src/providers/plane/normalize.js` (118 LOC en total)
**Files-it-reads (data flow IN):** `../../interface.js` (typedef + `VALID_PRIORITIES`)
**Files-that-read-it (data flow OUT):** `./provider.js` (importa `normalizeIssue`), tests
**Expected LOC:** ~80-100 (vs 118 Plane — sin stripHtml, sin resolveWorkItemLabels UUIDs, sin parseTriggerEvent).

#### Pattern A — Header + imports (mirror `plane/normalize.js:1-3`)

```javascript
// Source: src/providers/plane/normalize.js:1-3
// @ts-check
import { VALID_PRIORITIES } from '../../interface.js';
import { parseKodoLabels } from '../../labels.js';
```

**What changes for Phase 24:** **DROP `parseKodoLabels` import** — GitHub normalize NO lo invoca (GH-05: dispatcher hace `task.labels.map(name => ({name}))` después de la normalización). Solo `VALID_PRIORITIES` se importa.

#### Pattern B — Context typedef (mirror `plane/normalize.js:5-13`)

```javascript
// Source: src/providers/plane/normalize.js:5-13
/**
 * @typedef {{
 *   labels: Array<{id: string, name: string}>,
 *   projectIdentifier: string,
 *   baseUrl: string,
 *   workspaceSlug: string,
 *   stateMap?: Map<string, string>,
 * }} NormalizeContext
 */
```

**What changes for Phase 24 (D-06):** simplificación dramática — sólo `projectId` es necesario.
```javascript
/**
 * @typedef {{ projectId: string, baseUrl?: string }} NormalizeContext
 *
 * projectId: 'owner/repo' literal (D-08 / D-12).
 * baseUrl: opcional, sólo para tests con fake server (no usado por normalizeIssue,
 *          GitHub embebe `html_url` en cada payload — D-15).
 */
```

#### Pattern C — `stripHtml` helper

**DROP COMPLETO** (plane normalize.js:15-27, 7 líneas). D-10: GitHub devuelve Markdown crudo, no necesita strip. Phase 24 normalize NO exporta `stripHtml`.

#### Pattern D — `resolveWorkItemLabels` helper

**DROP COMPLETO** (plane normalize.js:29-53, 25 líneas). D-11: GitHub embebe `{id, node_id, name, color, ...}` por label — no hay UUID lookup. La extracción es inline en `normalizeIssue` con `.map(l => l.name)`.

#### Pattern E — `extractPriority` helper (nuevo, NO existe en Plane)

Plane recibe `workItem.priority` como string nativo del API (`'medium'`/`'high'`/etc, plane/normalize.js:77). GitHub no tiene campo priority — viene como label `priority:<value>`. Helper nuevo:

```javascript
/**
 * Extrae priority desde labels GitHub buscando prefix `priority:`.
 * Whitelist: urgent/high/medium/low (D-17, sin aliases p0/critical/blocker).
 *
 * @param {Array<{name: string}|string>|null|undefined} labels
 * @returns {'urgent'|'high'|'medium'|'low'|null}
 */
export function extractPriority(labels) {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    const name = (typeof l === 'string' ? l : l?.name || '').toLowerCase();
    if (name.startsWith('priority:')) {
      const value = name.slice('priority:'.length);
      // D-17: whitelist sin 'none' (priority:none no es idiomático en GitHub).
      if (value === 'urgent' || value === 'high' || value === 'medium' || value === 'low') {
        return /** @type {any} */ (value);
      }
    }
  }
  return null;
}
```
Exportarlo para que `normalize.test.js` lo pueda testear directo (cobertura ≥90% D-35).

#### Pattern F — `normalizeIssue` (mirror `plane/normalize.js:55-80`)

```javascript
// Source: src/providers/plane/normalize.js:55-80
/**
 * Convert a raw Plane API work item to a canonical TaskItem.
 *
 * Pure function — no API calls, no side effects.
 *
 * @param {object} workItem - Raw Plane API work item response
 * @param {NormalizeContext} context
 * @returns {import('../../interface.js').TaskItem}
 */
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

**What changes for Phase 24 (D-07..D-18):**
```javascript
/**
 * Convert a raw GitHub Issue payload to a canonical TaskItem.
 *
 * Pure function — no API calls, no side effects.
 *
 * @param {object} issue - Raw GitHub API issue payload
 * @param {NormalizeContext} context
 * @returns {import('../../interface.js').TaskItem}
 */
export function normalizeIssue(issue, context) {
  // D-11: labels embedded como objects {id, node_id, name, color, ...}.
  // Edge: algunos endpoints devuelven strings (raro, documentado) — protección defensiva.
  const labelNames = Array.isArray(issue.labels)
    ? issue.labels
        .map((l) => (typeof l === 'string' ? l : l?.name))
        .filter(Boolean)
    : [];

  return {
    id: issue.node_id,                                       // D-07: node_id (no id numérico)
    ref: `${context.projectId}#${issue.number}`,             // D-08: owner/repo#number
    title: issue.title,                                      // D-09
    description: issue.body || '',                           // D-10: Markdown crudo, sin strip
    labels: labelNames,                                      // D-11
    projectId: context.projectId,                            // D-12
    projectName: context.projectId,                          // D-13: mismo string
    groups: [],                                              // D-14: hardcoded vacío
    url: issue.html_url,                                     // D-15
    priority: extractPriority(issue.labels),                 // D-17: helper
    state: issue.state,                                      // D-16: 'open' | 'closed' literal
  };
}
```

**DROP `parseTriggerEvent` export** (plane normalize.js:82-118, 37 líneas) — D-26 lo hace el provider inline como `null` constant.

---

### 3. `src/providers/registry.js` (service/registry, lazy-init lookup) — MOD

**Analog:** mismo archivo, bloque `plane` líneas 25-38 — **template literal a copiar**.
**Files-it-reads (data flow IN):** `../config.js`, `./plane/provider.js`, `./github/provider.js` (nuevo)
**Files-that-read-it (data flow OUT):** todos los callers de `getProvider(name)`

#### Pattern A — Plane factory block (lift literal de `registry.js:22-38`)

```javascript
// Source: src/providers/registry.js:22-38
try {
  const { loadConfig, getPlaneApiKey } = await import('../config.js');
  const { createPlaneProvider } = await import('./plane/provider.js');

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
} catch {
  // Config or provider module not available — skip default registration
}
```

**What changes for Phase 24 (D-29):** añadir un **bloque paralelo** después del `factories.set('plane', ...)` (idealmente dentro del mismo `try` o en un `try` separado para resiliencia independiente). Patrón:

```javascript
// Después del plane block — añadir dentro del try o como try separado.
try {
  const { createGitHubProvider } = await import('./github/provider.js');

  factories.set('github', () => {
    const config = loadConfig();  // si está en el mismo try, ya está importado arriba
    const github = config.providers.github;
    return createGitHubProvider(github);
    // Nota: NO se transforma config (D-29 vs D-05) — el factory consume el sub-objeto raw.
    // El logger se pasa via opts en callers (precedente PlaneProvider — registry no construye logger).
  });
} catch {
  // skip
}
```

**Divergencias justificadas vs plane block:**
- Sin `getProviderApiKey('github')` aquí — el `GitHubClient` constructor (Phase 23 client.js:84) ya lo llama internamente cuando `token === undefined`.
- Sin `webhook_secret` lookup — D-27 verifySignature no-op, no hay secret a resolver.
- **Sin transformación de claves** — `createGitHubProvider(github)` recibe el sub-objeto raw (snake_case `base_url`, `api_key_env`, etc.) tal como viene de `config.providers.github`. Plane transforma a camelCase porque el provider firma `PlaneProviderConfig` con camelCase. Phase 24 firma con snake_case y simplifica el registry.

**Riesgo:** si el plane block está dentro de un `try/catch` único, una falla en `import('./github/provider.js')` ANTES de `factories.set('plane', ...)` lo aborta. **Solución preferida:** dos `try` separados — uno por provider — para aislar fallos.

---

### 4. `test/providers/github/provider.test.js` (test contract)

**Analog:** `test/plane-provider.test.js` (125 LOC en total)
**Analog secundario:** `test/providers/github/client.test.js` (Phase 23 — patterns `makeFetch`/`makeSpyFetch`/`makeSpyLogger`, fakeClient injection)

#### Pattern A — Imports + dynamic load (mirror `plane-provider.test.js:1-22`)

```javascript
// Source: test/plane-provider.test.js:1-22
// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TASK_PROVIDER_METHODS } from '../src/interface.js';

/** @type {import('../src/providers/plane/provider.js')['createPlaneProvider']} */
let createPlaneProvider;

const MOCK_CONFIG = {
  baseUrl: 'https://test.example.com',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  projects: [{ id: 'proj-uuid', identifier: 'TST', name: 'Test' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  webhookSecret: 'test-secret',
};

describe('PlaneProvider', () => {
  beforeEach(async () => {
    ({ createPlaneProvider } = await import('../src/providers/plane/provider.js'));
  });
```

**What changes for Phase 24:**
- DROP `import { createHmac } from 'node:crypto'` — verifySignature no-op (D-27).
- Path-fix: `../../../src/interface.js` (anidamiento `test/providers/github/`).
- MOCK_CONFIG snake_case:
  ```javascript
  const MOCK_CONFIG = {
    base_url: 'https://api.github.com',
    api_key_env: 'GITHUB_TOKEN',
    repos: [{ owner: 'octocat', repo: 'hello-world' }],
    states: { trigger: 'open', review: 'closed', done: 'closed' },
  };
  ```

#### Pattern B — Contract test (lift literal de `plane-provider.test.js:24-29`)

```javascript
// Source: test/plane-provider.test.js:24-29
it('createPlaneProvider returns object with all TaskProvider methods', () => {
  const provider = createPlaneProvider(MOCK_CONFIG);
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
  }
});
```

**What changes for Phase 24:** rename + inyectar fakeClient para evitar `GitHub token not found` throw del constructor:
```javascript
it('createGitHubProvider returns object with all TaskProvider methods', () => {
  const provider = createGitHubProvider(MOCK_CONFIG, { client: makeFakeClient() });
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
  }
});
```

#### Pattern C — fakeClient injection (NUEVO, basado en D-36 + estructura `client.test.js:79-103`)

NO existe análogo directo en `plane-provider.test.js` (Plane usa `stubFetch` que muta `globalThis.fetch`, plane-provider.test.js:66-77 — anti-pattern documentado en Phase 23 client.js header). Phase 24 usa el pattern más limpio de Phase 23: **inyectar `opts.client`**.

```javascript
// Inspirado en test/providers/github/client.test.js:95-103 makeSpyLogger pattern.
/**
 * Mock minimal del GitHubClient — sólo los 5 métodos consumidos por el provider.
 * Cada método es un spy que captura llamadas en `calls[name]`.
 */
function makeFakeClient(overrides = {}) {
  const calls = { getIssue: [], listIssues: [], addComment: [], updateIssue: [], listLabels: [] };
  return {
    calls,
    async getIssue(owner, repo, number) {
      calls.getIssue.push({ owner, repo, number });
      return overrides.getIssue ? overrides.getIssue(owner, repo, number) : { node_id: 'I_test', number, title: 't', body: '', labels: [], state: 'open', html_url: '' };
    },
    async listIssues(owner, repo, opts) {
      calls.listIssues.push({ owner, repo, opts });
      return overrides.listIssues ? overrides.listIssues(owner, repo, opts) : { status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 };
    },
    async addComment(owner, repo, number, body) {
      calls.addComment.push({ owner, repo, number, body });
      return overrides.addComment ? overrides.addComment(owner, repo, number, body) : { id: 1 };
    },
    async updateIssue(owner, repo, number, updates) {
      calls.updateIssue.push({ owner, repo, number, updates });
      return overrides.updateIssue ? overrides.updateIssue(owner, repo, number, updates) : { number, state: updates.state };
    },
    async listLabels(owner, repo) {
      calls.listLabels.push({ owner, repo });
      return overrides.listLabels ? overrides.listLabels(owner, repo) : [];
    },
  };
}
```

#### Pattern D — Live-fetch leak guard (lift de `client.test.js:32-43`)

```javascript
// Source: test/providers/github/client.test.js:32-43
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject fetch via constructor opts');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});
```

**What changes for Phase 24 (D-37):** lift literal — añade el mismo guard. Si algún test olvida pasar `opts.client`, el factory llamará `new GitHubClient(...)` que internamente toca `globalThis.fetch` y revienta loud.

#### Pattern E — Per-method test pattern (mirror `plane-provider.test.js:31-59`)

```javascript
// Source: test/plane-provider.test.js:31-37 — patrón básico
it('verifySignature returns true for valid HMAC', () => {
  const provider = createPlaneProvider(MOCK_CONFIG);
  const payload = '{"event":"issue","action":"update"}';
  const expected = createHmac('sha256', 'test-secret').update(payload).digest('hex');
  const result = provider.verifySignature(payload, { 'x-plane-signature': expected });
  assert.equal(result, true);
});
```

**What changes for Phase 24:** cobertura del contract real:
- `init()` no-op (no throws, resuelve)
- `getTask(ref)` → parseRef + client.getIssue + normalizeIssue (asserts forwarding correcto)
- `getTask` invalid ref → throw `Invalid GitHub ref:`
- `updateTaskState(task, 'open')` → passthrough (D-23)
- `updateTaskState(task, 'closed')` → passthrough
- `updateTaskState(task, 'unknown')` → throw `Unknown state:` (sin matchear en config.states)
- `addComment(task, '**md**')` → forwarding sin transform (D-24 NO `<p><br>`)
- `listPendingTasks()` → itera repos + filtra PRs (Pitfall #2) + normaliza
- `parseTriggerEvent({})` → `null` siempre (D-26)
- `verifySignature('', {})` → `false` siempre (D-27)
- `resolveRef('o/r#42')` → devuelve `node_id` (D-21)
- `listProjects()` → cero API calls (assert `calls.listIssues.length === 0` después)

---

### 5. `test/providers/github/normalize.test.js` (test unit)

**Analog:** `test/normalize.test.js` (161 LOC en total)

#### Pattern A — Imports + fixtures (mirror `normalize.test.js:1-22`)

```javascript
// Source: test/normalize.test.js:1-22
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWorkItem,
  parseTriggerEvent,
  stripHtml,
  resolveWorkItemLabels,
} from '../src/providers/plane/normalize.js';

import workItemFixture from './fixtures/plane-workitem.json' with { type: 'json' };
import webhookFixture from './fixtures/plane-webhook.json' with { type: 'json' };
import labelsFixture from './fixtures/plane-labels.json' with { type: 'json' };

/** @type {import('../src/providers/plane/normalize.js').NormalizeContext} */
const defaultContext = {
  labels: labelsFixture,
  projectIdentifier: 'KL',
  baseUrl: 'https://plane.klab.dev',
  workspaceSlug: 'klab',
};
```

**What changes for Phase 24:**
```javascript
import { normalizeIssue, extractPriority } from '../../../src/providers/github/normalize.js';

import issueFixture from '../../fixtures/github/issue.json' with { type: 'json' };
import issuePriorityFixture from '../../fixtures/github/issue-with-priority.json' with { type: 'json' };
import issueKodoFixture from '../../fixtures/github/issue-with-kodo.json' with { type: 'json' };
import issueClosedFixture from '../../fixtures/github/issue-closed.json' with { type: 'json' };
import issueNoBodyFixture from '../../fixtures/github/issue-no-body.json' with { type: 'json' };
import issueNoLabelsFixture from '../../fixtures/github/issue-no-labels.json' with { type: 'json' };

const defaultContext = { projectId: 'octocat/hello-world' };
```
- DROP `stripHtml`/`resolveWorkItemLabels`/`parseTriggerEvent` imports (no existen en GitHub normalize).
- Path-fix: `../../../src/...` (anidamiento extra).

#### Pattern B — Per-field assertion (mirror `normalize.test.js:70-86`)

```javascript
// Source: test/normalize.test.js:70-86
describe('normalizeWorkItem', () => {
  it('converts Plane work item to canonical TaskItem', () => {
    const result = normalizeWorkItem(workItemFixture, defaultContext);

    assert.equal(result.id, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    assert.equal(result.ref, 'KL-42');
    assert.equal(result.title, 'Fix login redirect after session timeout');
    assert.equal(typeof result.description, 'string');
    assert.ok(!result.description.includes('<'), 'description should not contain HTML');
    assert.deepEqual(result.labels, ['kodo', 'kodo:sonnet']);
    assert.equal(result.projectId, 'p0p0p0p0-1111-2222-3333-444444444444');
    assert.equal(result.projectName, 'Kodo Lab');
    assert.deepEqual(result.groups, []);
    assert.equal(result.url, 'https://plane.klab.dev/klab/browse/KL-42');
    assert.equal(result.priority, 'medium');
  });
```

**What changes for Phase 24:** asserts per-D-decision sobre `issueFixture`:
```javascript
describe('normalizeIssue', () => {
  it('converts GitHub Issue to canonical TaskItem (issue.json fixture)', () => {
    const result = normalizeIssue(issueFixture, defaultContext);

    assert.equal(result.id, 'I_kwTEST001');                    // D-07
    assert.equal(result.ref, 'octocat/hello-world#42');        // D-08
    assert.equal(result.title, 'Test issue');                  // D-09
    assert.equal(result.description, 'Issue body markdown');   // D-10
    assert.deepEqual(result.labels, ['kodo']);                 // D-11
    assert.equal(result.projectId, 'octocat/hello-world');     // D-12
    assert.equal(result.projectName, 'octocat/hello-world');   // D-13
    assert.deepEqual(result.groups, []);                       // D-14
    assert.equal(result.url, 'https://github.com/kodo-test/fixture-repo/issues/42'); // D-15
    assert.equal(result.state, 'open');                        // D-16
    assert.equal(result.priority, null);                       // D-17 (no priority label)
  });
```

#### Pattern C — Edge-case per-branch (mirror `normalize.test.js:93-130`)

```javascript
// Source: test/normalize.test.js:93-105
it('handles missing description_html', () => {
  const item = { ...workItemFixture, description_html: null };
  const result = normalizeWorkItem(item, defaultContext);
  assert.equal(result.description, '');
});

it('handles undefined description_html', () => {
  const item = { ...workItemFixture };
  delete item.description_html;
  const result = normalizeWorkItem(item, defaultContext);
  assert.equal(result.description, '');
});

it('handles empty labels', () => {
  const item = { ...workItemFixture, labels: [] };
  const result = normalizeWorkItem(item, defaultContext);
  assert.deepEqual(result.labels, []);
});
```

**What changes for Phase 24 (cubrir D-35 ≥ 90% branches):**
- `body: null` → `description === ''` (usar `issue-no-body.json`)
- `body: undefined` → `description === ''` (delete inline)
- `labels: []` → `labels: []` + `priority: null` (usar `issue-no-labels.json`)
- `labels: [string-form]` → `.map` defensivo (test inline mutación)
- `state: 'closed'` → `state: 'closed'` (usar `issue-closed.json`)
- `labels` con `priority:high` → `priority: 'high'` (usar `issue-with-priority.json`)
- `labels` con `priority:invalid` → `priority: null`
- `labels` con `Priority:HIGH` (case insensitive) → `priority: 'high'`
- `labels` con `kodo` + `kodo:sonnet` → `labels: ['kodo', 'kodo:sonnet']` (usar `issue-with-kodo.json`)
- `extractPriority(null)` → `null`
- `extractPriority([])` → `null`
- `extractPriority([{name:'priority:p0'}])` → `null` (D-17 sin aliases)

---

### 6. `test/registry.test.js` (MOD)

**Analog:** mismo archivo, líneas existentes (85 LOC).

#### Pattern A — Caso 'github' replicando 'test' pattern (mirror `registry.test.js:31-37`)

```javascript
// Source: test/registry.test.js:31-37
it('getProvider returns registered provider', () => {
  registerProvider('test', () => createFakeProvider());
  const provider = getProvider('test');
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
  }
});
```

**What changes for Phase 24 (D-38):**

**Riesgo crítico:** El test debe **NO disparar `registerDefaults()`** (porque `loadConfig()` falla sin config real con `providers.github`). El patrón existente del file ya lo cubre: `clearRegistry()` en `beforeEach` y `registerProvider('github', () => fakeProvider)` en lugar de invocar el default.

```javascript
it('getProvider("github") returns provider with all TaskProvider methods', () => {
  registerProvider('github', () => createFakeProvider());
  const provider = getProvider('github');
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
  }
});
```

**ALTERNATIVA (más fuerte) — testa que el factory REAL pase el gate:** importar `createGitHubProvider` y registrar manualmente:
```javascript
it('getProvider("github") via createGitHubProvider passes TASK_PROVIDER_METHODS gate', async () => {
  const { createGitHubProvider } = await import('../src/providers/github/provider.js');
  registerProvider('github', () => createGitHubProvider(
    { base_url: 'x', api_key_env: 'x', repos: [], states: { trigger: 'open', review: 'closed', done: 'closed' } },
    { client: { /* fakeClient stub */ } },
  ));
  const provider = getProvider('github');
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
  }
});
```

Esta segunda variante es lo que cierra GH-04 SC más fuerte — valida que el provider real (no un fake) cumpla el contrato. **Decisión del planner:** preferir la variante alternativa.

---

### 7. `test/check-isolation.test.js` (MOD)

**Analog:** mismo archivo (LOG-12 invariant, 108 LOC).
**Patrón existente:** el archivo solo testea que `src/check.js` NO importe `src/logger.js`. Phase 24 añade `src/providers/github/{provider,normalize}.js` al mismo principio.

#### Pattern A — Estructura de test (existente)

```javascript
// Source: test/check-isolation.test.js:75-88
it('kodo check does not import src/logger.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => /\/logger\.js$/.test(p));
  const relViolators = violators.map((p) => relative(REPO, p));
  // ...
  assert.deepEqual(violators, [], `...`);
});
```

**What changes for Phase 24 (LOG-12 invariant extension):** añadir filas que verifiquen que `check.js` NO importa transitivamente `src/providers/github/provider.js` ni `src/providers/github/normalize.js`. Estos módulos cargan `getProviderApiKey` (config) — fuera del árbol permitido de check.js.

```javascript
it('kodo check does not import src/providers/github/provider.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => p.endsWith('/providers/github/provider.js'));
  assert.deepEqual(violators, [], `check.js transitively imports github/provider.js via:\n  ${violators.map((p) => relative(REPO, p)).join('\n  ')}`);
});

it('kodo check does not import src/providers/github/normalize.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => p.endsWith('/providers/github/normalize.js'));
  assert.deepEqual(violators, [], `check.js transitively imports github/normalize.js via:\n  ${violators.map((p) => relative(REPO, p)).join('\n  ')}`);
});
```

**Si Phase 23 ya añadió la row para `github/client.js`:** revisar primero el archivo en HEAD por si ya existe — extender con `provider.js` y `normalize.js` siguiendo el mismo patrón.

---

### 8. Fixtures GitHub (5 nuevas en `test/fixtures/github/`)

**Analog base:** `test/fixtures/github/issue.json` (Phase 23, 20 LOC). Cada fixture nueva es un **fork + mutate one field** de la base.

#### Shape base (lift literal de `test/fixtures/github/issue.json`)

```json
{
  "id": 1,
  "node_id": "I_kwTEST001",
  "number": 42,
  "title": "Test issue",
  "body": "Issue body markdown",
  "labels": [
    { "id": 1, "node_id": "LA_TEST001", "name": "kodo", "color": "0e8a16", "default": false, "description": null }
  ],
  "state": "open",
  "state_reason": null,
  "html_url": "https://github.com/kodo-test/fixture-repo/issues/42",
  "pull_request": null,
  "assignees": [],
  "user": { "login": "kodo-test", "id": 1 },
  "created_at": "2026-05-14T07:00:00Z",
  "updated_at": "2026-05-14T08:00:00Z",
  "locked": false,
  "comments": 0
}
```

#### Mutations per fixture

**`issue-with-priority.json` (D-34):** mismo shape, mutar `labels`:
```json
"labels": [
  { "id": 1, "node_id": "LA_001", "name": "kodo", "color": "0e8a16", "default": false, "description": null },
  { "id": 2, "node_id": "LA_002", "name": "priority:high", "color": "d93f0b", "default": false, "description": null }
]
```
Y cambiar `number`, `node_id` (`I_kwTEST002`), `title` (`'Issue with priority'`) para distinguibilidad en asserts.

**`issue-with-kodo.json` (D-34):** mutar `labels` para incluir `kodo` + `kodo:sonnet`:
```json
"labels": [
  { "id": 1, "node_id": "LA_001", "name": "kodo", "color": "0e8a16", "default": false, "description": null },
  { "id": 3, "node_id": "LA_003", "name": "kodo:sonnet", "color": "1d76db", "default": false, "description": null }
]
```

**`issue-closed.json` (D-34):** mutar `state` + `state_reason`:
```json
"state": "closed",
"state_reason": "completed"
```
Y `number: 99` para distinción.

**`issue-no-body.json` (D-34):** mutar `body` → `null`:
```json
"body": null
```

**`issue-no-labels.json` (D-34):** mutar `labels` → `[]`:
```json
"labels": []
```

**Convención de tamaño:** mantener TODOS los demás campos idénticos a `issue.json`. La fixture es un cherry-pick narrativo de UN solo cambio para que el test sea trivial de leer ("este fixture es como issue.json, pero `labels=[]`").

---

## Shared Patterns

### Authentication
**No aplica** — Phase 24 no toca `parseTriggerEvent`/`verifySignature` con HMAC (D-26/D-27 no-op). El `GitHubClient` constructor (Phase 23 client.js:84) ya resuelve el token via `getProviderApiKey('github')` — Phase 24 no replica esa lógica.

### Error Handling
**Source:** `src/providers/github/client.js:188-195` (Phase 23 D-12 canonical Error).
**Apply to:** todos los métodos del provider — los errores del cliente se propagan tal cual.

```javascript
// Source: src/providers/github/client.js:188-195 — patrón de error que se PROPAGA, no se atrapa.
const err = /** @type {Error & { code?: string, status?: number, retryAfter?: number }} */ (
  new Error(`GitHub API ${res.status}: ${path} — ${snippet}`)
);
err.code = code;
err.status = res.status;
if (retryAfter !== undefined) err.retryAfter = retryAfter;
throw err;
```

**Phase 24 pattern:** los métodos del provider NO atrapan estos errores. `getTask` con issue inexistente → `client.getIssue` lanza `Error.code='not_found'` y el provider lo propaga directo. Los callers (`verify.js`, dispatcher) son quienes deciden cómo reaccionar.

**Errores propios del provider** (no del cliente) siguen el mismo patrón template:
```javascript
throw new Error(`Invalid GitHub ref: ${ref}. Expected owner/repo#number`);
throw new Error(`Unknown state: ${stateName}. Configured: ${available}`);
```
Mensaje formato fijo para grep en logs (convención repo).

### Validation
**Source:** `src/interface.js:50-69` — `TASK_PROVIDER_METHODS` (frozen) + `VALID_PRIORITIES` (frozen).
**Apply to:** registry gate (registry.js:73-77) valida los 9 métodos; `normalize.js extractPriority` consume `VALID_PRIORITIES` whitelist via comparación inline (D-17: subset `['urgent','high','medium','low']`, sin `'none'`).

```javascript
// Source: src/interface.js:50-60
export const TASK_PROVIDER_METHODS = Object.freeze([
  'init', 'getTask', 'updateTaskState', 'addComment', 'listPendingTasks',
  'parseTriggerEvent', 'verifySignature', 'resolveRef', 'listProjects',
]);
```

### Testing
**Source:** `test/providers/github/client.test.js:32-43` (live-fetch leak guard).
**Apply to:** `test/providers/github/provider.test.js` — añadir el mismo `before`/`after` guard para que tests sin `opts.client` revienten loud.

**Source:** `test/registry.test.js:17-23` (`createFakeProvider`).
**Apply to:** `test/registry.test.js` extensión — reusar `createFakeProvider()` para el caso simple, o crear `createFakeGitHubProvider()` que invoque el factory real con stub client para el caso alternativo más fuerte (Pattern 6.A).

---

## No Analog Found

Ningún archivo de Phase 24 está sin análogo. Coverage 100%:

| File | Why analog exists |
|------|-------------------|
| Todos los 10 archivos | Phase 24 es **mirror estructural** del módulo Plane (provider/normalize/tests) + extensión incremental del módulo GitHub (Phase 23 ya cerró client + 9 fixtures + 15 tests). |

---

## Metadata

**Analog search scope:**
- `/Users/alex/dev/klab/kodo/src/providers/plane/` (provider.js, normalize.js, client.js)
- `/Users/alex/dev/klab/kodo/src/providers/github/` (client.js — Phase 23)
- `/Users/alex/dev/klab/kodo/src/providers/registry.js`
- `/Users/alex/dev/klab/kodo/src/interface.js`
- `/Users/alex/dev/klab/kodo/test/plane-provider.test.js`
- `/Users/alex/dev/klab/kodo/test/normalize.test.js`
- `/Users/alex/dev/klab/kodo/test/registry.test.js`
- `/Users/alex/dev/klab/kodo/test/check-isolation.test.js`
- `/Users/alex/dev/klab/kodo/test/providers/github/client.test.js`
- `/Users/alex/dev/klab/kodo/test/fixtures/github/issue.json`
- `/Users/alex/dev/klab/kodo/test/fixtures/github/issues-list.json`

**Files scanned:** 11
**Pattern extraction date:** 2026-05-14
**Source-of-truth lines counted:** plane/provider.js 253 LOC, plane/normalize.js 118 LOC, plane-provider.test.js 125 LOC, normalize.test.js 161 LOC, registry.js 102 LOC, check-isolation.test.js 108 LOC, github/client.js 333 LOC, github/client.test.js 379 LOC.
