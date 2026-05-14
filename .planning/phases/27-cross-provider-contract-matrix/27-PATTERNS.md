# Phase 27: Cross-Provider Contract Matrix — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 2 (1 obligatorio, 1 opcional)
**Analogs found:** 2 / 2 (cobertura completa)
**Producción tocada:** 0 archivos (test-only phase)

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `test/providers/contract.test.js` | test (matrix runner) | request-response (provider-mockeado) | `test/providers/github/provider.test.js` | exact (mismo runner, mismo DI shape, mismo leak-guard) |
| `test/providers/contract-helpers.js` *(opcional)* | test helper (asserts + factory) | transform/util | `test/registry.test.js` (`createFakeGitHubClient`) + `test/plane-provider.test.js` (`stubFetch`) | role-match (composición de 2 patterns existentes) |

**Single source of truth — los 9 métodos canonical y los 11 campos canonical viven en producción y se importan, NO se redeclaran**:
- `TASK_PROVIDER_METHODS` ← `src/interface.js:50-60`
- `TaskItem` typedef (11 fields) ← `src/interface.js:11-24`

## Pattern Assignments

### `test/providers/contract.test.js` (test, matrix runner)

**Primary Analog:** `/Users/alex/dev/klab/kodo/test/providers/github/provider.test.js`
**Secondary Analog (Plane DI):** `/Users/alex/dev/klab/kodo/test/plane-provider.test.js:62-77`

#### Pattern A — Imports header (`@ts-check` + `node:test` + `assert/strict` + interface)
**Source:** `test/providers/github/provider.test.js:1-25`
```javascript
// @ts-check
/**
 * Phase 27 TEST-03 — Cross-Provider Contract Matrix.
 *
 * Itera `['plane', 'github']` × N asserts core, todos contra mismas signatures.
 * Demuestra empíricamente el invariante v0.2: "cambiar de provider no requiere
 * reescribir lógica" — el output (TaskItem 11 fields) converge aunque el input
 * (raw payload) diverja.
 *
 * INVARIANTE ESTRUCTURAL (Pitfall #3): TODOS los `it(...)` viven DENTRO del
 * `for (const providerName of PROVIDERS) describe(...)` loop. Cero `it()` top-level.
 * Plan-checker valida con grep que no haya tests asimétricos.
 */

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PROVIDER_METHODS } from '../../src/interface.js';
```
**Rationale:** El header GitHub provider test ya tiene la fórmula exacta (`@ts-check` + nota explicativa + imports `node:test`). Phase 27 lo replica, ajustando el docblock al matrix.

#### Pattern B — Live-fetch leak guard (file-level)
**Source:** `test/providers/github/provider.test.js:40-49`
```javascript
// D-37 live-fetch leak guard (lift de Phase 24). OBLIGATORIO al nivel de archivo —
// si el stub de Plane olvida cubrir un endpoint, el fetch original revienta loud
// en lugar de pegar a `plane.test` o internet.
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: contract matrix must stub or inject');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});
```
**Rationale:** Pitfall #2 + #7 — Plane describe muta `globalThis.fetch`; si olvida cleanup o stubea sólo algunos endpoints, otros tests del suite global heredan estado. El guard at file-level garantiza fail-loud.

#### Pattern C — Matrix loop estructural (Pattern 1 del RESEARCH)
**Source nueva, derivada de:** `test/plane-provider.test.js:24-29` (contract loop sobre `TASK_PROVIDER_METHODS`) y `test/providers/github/provider.test.js:107-125` (mismo patrón).
```javascript
const PROVIDERS = /** @type {const} */ (['plane', 'github']);

for (const providerName of PROVIDERS) {
  describe(`TaskProvider contract — ${providerName}`, () => {
    /** @type {import('../../src/interface.js').TaskProvider} */
    let provider;
    /** @type {() => void} */
    let cleanup;

    beforeEach(async () => {
      ({ provider, cleanup } = await instantiateProvider(providerName));
      await provider.init();  // Pitfall #1: SIEMPRE init() — Plane requiere, GitHub no-op
    });

    // Si Plane stubeó globalThis.fetch, el cleanup lo restaura. GitHub no-op.
    afterEach(() => { cleanup?.(); });

    it('exposes 9 TASK_PROVIDER_METHODS as functions', () => {
      for (const method of TASK_PROVIDER_METHODS) {
        assert.equal(
          typeof provider[method],
          'function',
          `[${providerName}] missing method: ${method}`,
        );
      }
    });

    // … N-1 asserts más, todos prefijando `[${providerName}]` en mensajes
  });
}
```
**Rationale:** `node:test` no tiene `describe.each`; el `for...of describe` es el idiom equivalente. El prefijo `[${providerName}]` en cada assertion message es grep-friendly cuando falla.

#### Pattern D — Method contract loop con error messages grep-friendly
**Source:** `test/providers/github/provider.test.js:116-125` (idéntico shape en `test/plane-provider.test.js:24-29`)
```javascript
it('createGitHubProvider returns object with all TaskProvider methods (contract)', () => {
  const provider = createGitHubProvider(MOCK_CONFIG, { client: makeFakeClient() });
  for (const method of TASK_PROVIDER_METHODS) {
    assert.equal(
      typeof provider[method],
      'function',
      `Missing method: ${method}`,
    );
  }
});
```
**Adaptación matrix:** mismo loop, mensaje prefijado con `[${providerName}]`.

#### Pattern E — Canonical TaskItem shape assertion (D-18 leak guard)
**Source conceptual:** Phase 24 D-18 leak guard (cita: `.planning/phases/24-githubprovider-normalizer-registry/24-01-SUMMARY.md` — 11 fields canonical).
**Derivado del typedef:** `src/interface.js:11-24`
```javascript
// Ancla los 11 campos canonical del TaskItem typedef.
// Diff vs Plane single-provider tests: aquí asserta CROSS-provider que el output converge.
const CANONICAL_TASK_ITEM_KEYS = Object.freeze([
  'id', 'ref', 'title', 'description', 'labels',
  'projectId', 'projectName', 'groups', 'url',
  'priority', 'state',
]);

function assertTaskItemShape(task, providerName) {
  assert.equal(typeof task, 'object', `[${providerName}] task must be object`);
  assert.notEqual(task, null, `[${providerName}] task must not be null`);
  const keys = Object.keys(task).sort();
  const expected = [...CANONICAL_TASK_ITEM_KEYS].sort();
  assert.deepEqual(
    keys,
    expected,
    `[${providerName}] TaskItem shape divergence: got ${JSON.stringify(keys)} expected ${JSON.stringify(expected)}`,
  );
  // Tipos por campo (sin valores provider-specific)
  assert.equal(typeof task.id, 'string', `[${providerName}] id must be string`);
  assert.equal(typeof task.ref, 'string', `[${providerName}] ref must be string`);
  assert.ok(Array.isArray(task.labels), `[${providerName}] labels must be array`);
  assert.ok(Array.isArray(task.groups), `[${providerName}] groups must be array`);
  assert.ok(
    task.priority === null || ['urgent','high','medium','low','none'].includes(task.priority),
    `[${providerName}] priority must be null or enum value, got: ${task.priority}`,
  );
}
```
**Rationale:** Este es el cross-provider equivalente del D-18 leak guard de Phase 24 (single-provider). Single-source-of-truth de los 11 fields — si se añade un campo en `src/interface.js`, este array DEBE actualizarse, y el test rompe loud.

#### Pattern F — Error contract negativo simétrico (Pitfall #6)
**Source:** `test/providers/github/provider.test.js:191-199` + `test/providers/github/provider.test.js:380-396`
```javascript
it('getTask throws Error on not-found ref (negative contract — Pitfall #6)', async () => {
  const badRef = getInvalidRef(providerName);  // 'KL-9999' | 'octocat/hello-world#9999'
  await assert.rejects(
    () => provider.getTask(badRef),
    (err) => {
      assert.ok(err instanceof Error, `[${providerName}] must throw Error instance`);
      assert.equal(typeof err.message, 'string', `[${providerName}] err.message must be string`);
      // NO comparar `.code` ni mensaje literal — diverge legítimamente entre providers.
      return true;
    },
  );
});

it('parseTriggerEvent({}) returns null or TriggerEvent (never throw)', () => {
  // Plane: rawPayload.event !== 'issue' → null. GitHub: D-26 always-null.
  const result = provider.parseTriggerEvent({});
  assert.ok(
    result === null || (typeof result === 'object' && typeof result.taskRef === 'string'),
    `[${providerName}] parseTriggerEvent({}) must return null|TriggerEvent, got: ${JSON.stringify(result)}`,
  );
});

it('verifySignature("", {}) returns false (never throw)', () => {
  // Plane: missing header → false. GitHub: D-27 always-false.
  assert.equal(
    provider.verifySignature('', {}),
    false,
    `[${providerName}] verifySignature must be false on empty input`,
  );
});
```

#### Pattern G — `listProjects()` shape assertion (D-28 derivado)
**Source:** `test/providers/github/provider.test.js:402-430`
```javascript
it('listProjects returns Array<{id,identifier,name}>', async () => {
  const projects = await provider.listProjects();
  assert.ok(Array.isArray(projects), `[${providerName}] listProjects must return array`);
  assert.ok(projects.length >= 1, `[${providerName}] mock should return ≥1 project`);
  for (const p of projects) {
    assert.equal(typeof p.id, 'string', `[${providerName}] project.id must be string`);
    assert.equal(typeof p.identifier, 'string', `[${providerName}] project.identifier must be string`);
    assert.equal(typeof p.name, 'string', `[${providerName}] project.name must be string`);
  }
});
```

---

### `test/providers/contract-helpers.js` (test helper — OPCIONAL)

**Decisión split:** Crear sólo si `contract.test.js` excede ~300 LOC. Inicialmente todo inline; refactor cuando la longitud lo justifique.

**Primary Analog (fakeGitHubClient):** `/Users/alex/dev/klab/kodo/test/registry.test.js:41-67`
**Secondary Analog (Plane stubFetch):** `/Users/alex/dev/klab/kodo/test/plane-provider.test.js:62-77`

#### Pattern H — `makeFakeGitHubClient()` reusable
**Source:** `test/providers/github/provider.test.js:60-105` (cita textual)
```javascript
/**
 * Mock minimal del GitHubClient — los 5 métodos consumidos por el provider.
 * `overrides` per-método permite forzar respuestas por test.
 */
function makeFakeGitHubClient(overrides = {}) {
  const calls = {
    getIssue: [], listIssues: [], addComment: [], updateIssue: [], listLabels: [],
  };
  return {
    calls,
    async getIssue(owner, repo, number) {
      calls.getIssue.push({ owner, repo, number });
      if (overrides.getIssue) return overrides.getIssue(owner, repo, number);
      return {
        node_id: 'I_kwTEST001',
        number, title: 't', body: '', labels: [], state: 'open',
        html_url: `https://github.com/${owner}/${repo}/issues/${number}`,
      };
    },
    async listIssues(owner, repo, opts) {
      calls.listIssues.push({ owner, repo, opts });
      if (overrides.listIssues) return overrides.listIssues(owner, repo, opts);
      return { status: 200, items: [], etag: undefined, rate_limit_remaining: 5000 };
    },
    async addComment(owner, repo, number, body) {
      calls.addComment.push({ owner, repo, number, body });
      if (overrides.addComment) return overrides.addComment(owner, repo, number, body);
      return { id: 1 };
    },
    async updateIssue(owner, repo, number, updates) {
      calls.updateIssue.push({ owner, repo, number, updates });
      if (overrides.updateIssue) return overrides.updateIssue(owner, repo, number, updates);
      return { number, state: updates.state };
    },
    async listLabels(owner, repo) {
      calls.listLabels.push({ owner, repo });
      if (overrides.listLabels) return overrides.listLabels(owner, repo);
      return [];
    },
  };
}
```

#### Pattern I — `stubPlaneFetch()` con cleanup + route table
**Source:** `test/plane-provider.test.js:62-77` (route table) + extensión con cleanup tracking
```javascript
import issueFixture from '../fixtures/github/issue.json' with { type: 'json' };
import planeWorkItem from '../fixtures/plane-workitem.json' with { type: 'json' };
import planeLabels from '../fixtures/plane-labels.json' with { type: 'json' };

/**
 * Stub globalThis.fetch para Plane endpoints. Devuelve { restore } para teardown.
 * Pitfall #7: cualquier path NO mapeado pega contra el outer `before()` thrower
 * (live-fetch leak guard) — fail-loud por construcción.
 */
function stubPlaneFetch(routes) {
  const original = globalThis.fetch;
  const calls = {};
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const matched = Object.keys(routes).find((suffix) => path.endsWith(suffix) || path.includes(suffix));
    if (!matched) {
      // Re-throw del leak guard (no caer en el original).
      throw new Error(`plane stub miss: ${path}`);
    }
    calls[matched] = (calls[matched] || 0) + 1;
    const body = routes[matched]();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
```
**Diferencia clave vs `test/plane-provider.test.js:62-77`:** añadir el `throw` en miss (en lugar de devolver `{ results: [] }` default) — Pitfall #7 fail-loud en lugar de fail-silent.

#### Pattern J — `instantiateProvider(name)` — el helper que oculta la divergencia DI
**Source:** Pattern 3 del RESEARCH (sintetiza factories existentes)
```javascript
import { createPlaneProvider } from '../../src/providers/plane/provider.js';
import { createGitHubProvider } from '../../src/providers/github/provider.js';

/**
 * Provider-agnostic instantiation. Devuelve `{ provider, cleanup }` — el caller
 * llama `cleanup()` en afterEach SIEMPRE (no-op en GitHub).
 *
 * Pitfall #5: Plane requiere `projects: [{ identifier: 'KL', … }]` matching el
 * fixture `plane-workitem.json` (identifier KL, sequence_id 42).
 */
export async function instantiateProvider(name) {
  if (name === 'plane') {
    const stub = stubPlaneFetch({
      '/states/': () => ({ results: [
        { id: 'd1e2f3a4-b5c6-7890-1234-567890abcdef', name: 'In Progress' },
        { id: 'state-rev', name: 'In review' },
        { id: 'state-done', name: 'Done' },
      ] }),
      '/labels/': () => ({ results: planeLabels }),
      '/modules/': () => ({ results: [] }),
      '/work-items/': () => ({ results: [planeWorkItem] }),
      // getWorkItemBySequence resolves vía workspaces/{slug}/issues/?sequence_id=N
      '/issues/': () => ({ results: [planeWorkItem] }),
    });
    const provider = createPlaneProvider({
      baseUrl: 'https://plane.test',
      apiKey: 'test-key',
      workspaceSlug: 'test',
      projects: [{ id: 'p0p0p0p0-1111-2222-3333-444444444444', identifier: 'KL', name: 'Kodo Lab' }],
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
      webhookSecret: 'test-secret',
    });
    return { provider, cleanup: stub.restore };
  }
  if (name === 'github') {
    const provider = createGitHubProvider(
      {
        base_url: 'https://api.github.com',
        api_key_env: 'GITHUB_TOKEN',
        repos: [{ owner: 'octocat', repo: 'hello-world' }],
        states: { trigger: 'open', review: 'closed', done: 'closed' },
      },
      { client: makeFakeGitHubClient({ getIssue: () => issueFixture }) },
    );
    return { provider, cleanup: () => {} };
  }
  throw new Error(`Unknown provider in matrix: ${name}`);
}

export function getValidRef(name) {
  if (name === 'plane') return 'KL-42';
  if (name === 'github') return 'octocat/hello-world#42';
  throw new Error(`No valid ref for: ${name}`);
}

export function getInvalidRef(name) {
  if (name === 'plane') return 'KL-9999';
  if (name === 'github') return 'octocat/hello-world#9999';
  throw new Error(`No invalid ref for: ${name}`);
}
```

---

## Shared Patterns

### Live-fetch leak guard (file-level)
**Source:** `test/providers/github/provider.test.js:40-49`
**Apply to:** `test/providers/contract.test.js` (top-level, antes de cualquier `describe`)
**Why shared:** Aplica a AMBOS providers en el matrix, no es Plane-specific. El stub Plane se monta on-top dentro de `instantiateProvider('plane')`.

### Canonical 11-field TaskItem shape (D-18 cross-provider)
**Source:** `src/interface.js:11-24` (typedef) + Phase 24 D-18 leak guard
**Apply to:** `assertTaskItemShape(task, providerName)` invocado en `getTask`, `listPendingTasks` items
**Why shared:** Es EL invariante v0.2 que el matrix valida — single source of truth en `CANONICAL_TASK_ITEM_KEYS` array.

### Method-error grep-friendly messages
**Source:** `test/providers/github/provider.test.js:120-122` (`Missing method: ${method}`)
**Apply to:** TODOS los asserts del matrix — prefijo `[${providerName}]` en cada `message`
**Why shared:** Cuando un test falla, el output `node:test` muestra el assertion message — prefijar con provider hace el failure localizable sin abrir el código.

### Lazy import dentro de `beforeEach`
**Source:** `test/providers/github/provider.test.js:108-110` + `test/plane-provider.test.js:20-22`
**Apply to:** Si se hace dynamic import. PATRÓN OPCIONAL — el matrix probablemente puede importar estático en el header (no hay registry mutation que requiera fresh module).
**Why considerable:** Mantiene paralelismo visual con los analogs single-provider; no es estrictamente necesario.

### Fixture imports con `import attributes` (`with { type: 'json' }`)
**Source:** `test/providers/github/provider.test.js:23-24`
```javascript
import issueFixture from '../../fixtures/github/issue.json' with { type: 'json' };
import issuesListFixture from '../../fixtures/github/issues-list.json' with { type: 'json' };
```
**Apply to:** Ambos fixtures Plane (`plane-workitem.json`, `plane-labels.json`) y GitHub (`issue.json`, `issues-list.json`)
**Why shared:** Es el patrón estándar de fixtures offline en el repo (Phase 24 establecido).

---

## No Analog Found

**Ninguno.** Toda la phase es composición de patterns existentes. La novedad estructural es el `for (const providerName of PROVIDERS) describe(...)` loop, pero ese idiom es estándar de `node:test` (no requiere analog en el repo — RESEARCH §Pattern 1 lo justifica).

---

## Reference Files (read-only context para el planner)

| File | Líneas relevantes | Por qué |
|------|-------------------|---------|
| `src/interface.js` | 11-24, 50-60 | `TaskItem` typedef + `TASK_PROVIDER_METHODS` — single source of truth importable |
| `src/providers/plane/provider.js` | 24-32, 67-130 | Firma `createPlaneProvider(config, opts?)` + qué hace `init()` (Pitfall #1) |
| `src/providers/github/provider.js` | 67-100 | Firma `createGitHubProvider(config, opts?)` con `opts.client?` (D-36) |
| `src/providers/registry.js` | 91-110 | Validación 9-method que se replica en `Pattern D` del matrix |
| `test/providers/github/provider.test.js` | 1-105, 116-125, 380-396, 402-430 | Plantilla 1-a-1 del matrix (header, leak guard, fakeClient, contract loop, deterministic null/false) |
| `test/plane-provider.test.js` | 24-29, 61-77 | Patrón `stubFetch` + contract loop sobre Plane |
| `test/registry.test.js` | 41-67 | `createFakeGitHubClient` reusable (alternativa al lift de `makeFakeClient`) |
| `test/fixtures/plane-workitem.json` | 1-45 | Identifier `KL`, sequence_id `42` — el helper `instantiateProvider('plane')` debe matchear |
| `test/fixtures/github/issue.json` | (full) | Fixture default para `getIssue` override |

---

## Pitfall → Pattern Map

| Pitfall RESEARCH | Pattern que lo mitiga |
|------------------|----------------------|
| #1 init() asymmetry | Pattern C — `await provider.init()` siempre en `beforeEach`, ambos providers |
| #2 globalThis.fetch cross-contamination | Pattern B (file-level guard) + Pattern J (`cleanup` returned por `instantiateProvider`) |
| #3 hardcoded test counts | Pattern C — invariante estructural por construcción; no se hardcodea count |
| #4 fixture shape divergence | Pattern J — cada provider devuelve SU fixture nativo (no shared cross-provider fixture) |
| #5 Plane config.projects coupling | Pattern J — `instantiateProvider('plane')` pasa `identifier: 'KL'` matching `plane-workitem.json` |
| #6 parseTriggerEvent/verifySignature semantic asymmetry | Pattern F — asserta contract negativo simétrico (`null` o boolean `false`), nunca positivo |
| #7 live fetch leak desde Plane | Pattern B (file-level) + Pattern I (route-miss throws explícito) |

---

## Metadata

**Analog search scope:** `test/`, `src/interface.js`, `src/providers/{plane,github}/provider.js`, `src/providers/registry.js`, `test/fixtures/`
**Files scanned:** 8 (todos verificados directamente, ningún Grep necesario — RESEARCH ya proporcionó line numbers exactos)
**Re-reads evitados:** RESEARCH ya inlineó los excerpts clave; el mapping referenció line numbers verbatim del research en lugar de re-leer
**Pattern extraction date:** 2026-05-14
