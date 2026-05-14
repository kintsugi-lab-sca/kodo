// @ts-check
/**
 * Phase 27 TEST-03 — Cross-Provider Contract Matrix.
 *
 * Itera estructuralmente `['plane', 'github']` × 7 asserts contract core, todos
 * compartidos. Demuestra empíricamente el invariante v0.2: "cambiar de provider
 * no requiere reescribir lógica" — los outputs (TaskItem, contract negativo)
 * convergen aunque el input (raw payload) diverja.
 *
 * INVARIANTE ESTRUCTURAL (Pitfall #3): TODOS los `it(...)` viven DENTRO del
 * `for (const providerName of PROVIDERS) describe(...)` loop. Cero `it()` top-level.
 * Plan-checker valida con grep que no haya tests asimétricos. El test count se
 * deriva por construcción: `PROVIDERS.length × N_asserts` (7 × 2 = 14 casos).
 *
 * DI divergence (Pitfall #2 + #7):
 *   - Plane: `globalThis.fetch` stub (no acepta `opts.client` injection nativa).
 *   - GitHub: `opts.client` injection (D-36 Phase 24).
 * El helper `instantiateProvider(name)` oculta la asimetría — el loop no sabe
 * ni le importa. File-level live-fetch leak guard (D-37 Phase 24) garantiza
 * que cualquier path Plane no-stubbeado revienta loud antes de tocar red real.
 *
 * Shape diff (W-1 acceptance):
 *   El plan original asertaba "exactly 11 canonical fields"; tras revisar los
 *   normalizers Plane (`state: workItem.state_detail?.name || … || undefined`)
 *   y GitHub (`state: issue.state` literal), AMBOS emiten 11 keys consistentes
 *   (la key existe aunque el valor sea undefined). Aún así, `assertTaskItemShape`
 *   usa SUBSET check (keys ⊆ CANONICAL) + required-present check para tolerar
 *   futuras divergencias legítimas y mantener fail-loud en field leaks (D-18).
 */

import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { TASK_PROVIDER_METHODS } from '../../src/interface.js';
import { createPlaneProvider } from '../../src/providers/plane/provider.js';
import { createGitHubProvider } from '../../src/providers/github/provider.js';

import issueFixture from '../fixtures/github/issue.json' with { type: 'json' };
import planeWorkItem from '../fixtures/plane-workitem.json' with { type: 'json' };
import planeLabels from '../fixtures/plane-labels.json' with { type: 'json' };

// ───────────────────────────────────────────────────────────────────────
// File-level live-fetch leak guard (Pattern B — Phase 24 D-37 lift)
// ───────────────────────────────────────────────────────────────────────
// Si el stub Plane olvida cubrir un endpoint, el fetch original revienta loud
// aquí en lugar de tocar `plane.test` (DNS fail) o internet real (peor). Doble
// red de seguridad para T-27-01 / T-27-02 (threat register Phase 27).

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

// ───────────────────────────────────────────────────────────────────────
// Constants — single source of truth
// ───────────────────────────────────────────────────────────────────────

/**
 * Lista de providers a iterar. Frozen — un `.push()` rompe loud, garantizando
 * que cualquier add a la matrix pase por code review (no por mutación implícita
 * en runtime).
 */
const PROVIDERS = Object.freeze(['plane', 'github']);

/**
 * Los 11 fields canonical del TaskItem typedef (`src/interface.js:11-24`).
 * Anclado en D-18 cross-provider leak guard. Si se añade un campo al typedef,
 * este array DEBE actualizarse y los normalizers DEBEN emitirlo — el matrix
 * revienta loud en caso contrario.
 */
const CANONICAL_TASK_ITEM_KEYS = Object.freeze([
  'id',
  'ref',
  'title',
  'description',
  'labels',
  'projectId',
  'projectName',
  'groups',
  'url',
  'priority',
  'state',
]);

/** Los 5 priority values válidos (subset de VALID_PRIORITIES + null). */
const VALID_PRIORITY_VALUES = Object.freeze(['urgent', 'high', 'medium', 'low', 'none']);

// ───────────────────────────────────────────────────────────────────────
// Mock configs
// ───────────────────────────────────────────────────────────────────────

const MOCK_PLANE_CONFIG = Object.freeze({
  baseUrl: 'https://plane.test',
  apiKey: 'test-key',
  workspaceSlug: 'test',
  // Pitfall #5: identifier MUST match `plane-workitem.json` (KL, sequence_id 42).
  projects: [{ id: 'p0p0p0p0-1111-2222-3333-444444444444', identifier: 'KL', name: 'Kodo Lab' }],
  states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  webhookSecret: 'test-secret',
});

const MOCK_GITHUB_CONFIG = Object.freeze({
  base_url: 'https://api.github.com',
  api_key_env: 'GITHUB_TOKEN',
  repos: [{ owner: 'octocat', repo: 'hello-world' }],
  states: { trigger: 'open', review: 'closed', done: 'closed' },
});

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Asserta que `task` satisface el TaskItem canonical shape:
 *   - todas las keys ∈ CANONICAL_TASK_ITEM_KEYS (no field leak — D-18)
 *   - todas las required keys presentes (CANONICAL menos `state` opcional)
 *   - tipos correctos por campo
 *
 * Cada assertion message prefija `[${providerName}]` para localización rápida
 * en failures (Pattern shared — grep-friendly method-error messages).
 *
 * @param {any} task
 * @param {string} providerName
 */
function assertTaskItemShape(task, providerName) {
  assert.equal(typeof task, 'object', `[${providerName}] task must be object`);
  assert.notEqual(task, null, `[${providerName}] task must not be null`);

  const keys = Object.keys(task);

  // Subset check — keys ⊆ CANONICAL_TASK_ITEM_KEYS (no field leaks)
  const extraKeys = keys.filter((k) => !CANONICAL_TASK_ITEM_KEYS.includes(k));
  assert.deepEqual(
    extraKeys,
    [],
    `[${providerName}] TaskItem leaks non-canonical keys: ${JSON.stringify(extraKeys)}`,
  );

  // Required present — every CANONICAL key except 'state' (optional per typedef)
  const requiredKeys = CANONICAL_TASK_ITEM_KEYS.filter((k) => k !== 'state');
  const missingKeys = requiredKeys.filter((k) => !keys.includes(k));
  assert.deepEqual(
    missingKeys,
    [],
    `[${providerName}] TaskItem missing required keys: ${JSON.stringify(missingKeys)}`,
  );

  // Type asserts por campo
  assert.equal(typeof task.id, 'string', `[${providerName}] id must be string`);
  assert.equal(typeof task.ref, 'string', `[${providerName}] ref must be string`);
  assert.equal(typeof task.title, 'string', `[${providerName}] title must be string`);
  assert.equal(typeof task.description, 'string', `[${providerName}] description must be string`);
  assert.ok(Array.isArray(task.labels), `[${providerName}] labels must be array`);
  assert.equal(typeof task.projectId, 'string', `[${providerName}] projectId must be string`);
  assert.equal(typeof task.projectName, 'string', `[${providerName}] projectName must be string`);
  assert.ok(Array.isArray(task.groups), `[${providerName}] groups must be array`);
  assert.equal(typeof task.url, 'string', `[${providerName}] url must be string`);
  assert.ok(
    task.priority === null || VALID_PRIORITY_VALUES.includes(task.priority),
    `[${providerName}] priority must be null or one of ${JSON.stringify(VALID_PRIORITY_VALUES)}, got: ${task.priority}`,
  );
}

/**
 * Mock minimal del `GitHubClient` — los 5 métodos consumidos por el provider.
 * Lift textual de `test/providers/github/provider.test.js:60-105` (Pattern H).
 *
 * @param {Record<string, Function>} [overrides]
 */
function makeFakeGitHubClient(overrides = {}) {
  const calls = {
    getIssue: [],
    listIssues: [],
    addComment: [],
    updateIssue: [],
    listLabels: [],
  };
  return {
    calls,
    async getIssue(owner, repo, number) {
      calls.getIssue.push({ owner, repo, number });
      if (overrides.getIssue) return overrides.getIssue(owner, repo, number);
      return {
        node_id: 'I_kwTEST001',
        number,
        title: 't',
        body: '',
        labels: [],
        state: 'open',
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

/**
 * Stub `globalThis.fetch` con una route table. Pitfall #7 fail-loud:
 * cualquier path no mapeado lanza `Error('plane stub miss: ...')` en lugar
 * de devolver `{ results: [] }` default (que oculta endpoints olvidados).
 *
 * @param {Record<string, () => any>} routes
 * @returns {{ calls: Record<string, number>, restore: () => void }}
 */
function stubPlaneFetch(routes) {
  const original = globalThis.fetch;
  const calls = {};
  // @ts-ignore — intentional override scoped to the test caller.
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    // Strict suffix matching only — `/projects/` would otherwise shadow
    // `/projects/{uuid}/work-items/` via `String.includes()` (the work-items
    // path also contains the substring `/projects/`).
    const matched = Object.keys(routes).find((suffix) => path.endsWith(suffix));
    if (!matched) {
      throw new Error(`plane stub miss: ${path}`);
    }
    calls[matched] = (calls[matched] || 0) + 1;
    const body = routes[matched]();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/**
 * Provider-agnostic instantiation. Devuelve `{ provider, cleanup }` — el caller
 * llama `cleanup()` en `afterEach` SIEMPRE (no-op en GitHub; restore en Plane).
 *
 * Oculta la divergencia DI:
 *   - plane: stub `globalThis.fetch` con 5 rutas + cleanup que restaura
 *   - github: `opts.client = makeFakeGitHubClient(...)` + cleanup no-op
 *
 * @param {string} name
 */
async function instantiateProvider(name) {
  if (name === 'plane') {
    const stub = stubPlaneFetch({
      // listProjects → /projects/ (también consumido por `provider.listProjects`)
      '/projects/': () => ({
        results: [
          {
            id: 'p0p0p0p0-1111-2222-3333-444444444444',
            identifier: 'KL',
            name: 'Kodo Lab',
          },
        ],
      }),
      // init() — labels por proyecto
      '/labels/': () => ({ results: planeLabels }),
      // init() — states por proyecto. UUID matching plane-workitem.json's `state`
      '/states/': () => ({
        results: [
          { id: 'd1e2f3a4-b5c6-7890-1234-567890abcdef', name: 'In Progress' },
          { id: 'state-rev', name: 'In review' },
          { id: 'state-done', name: 'Done' },
        ],
      }),
      // init() — modules por proyecto (vacío tolerado, provider.js:108)
      '/modules/': () => ({ results: [] }),
      // listPendingTasks + getWorkItemBySequence — ambos pegan a /work-items/
      '/work-items/': () => ({ results: [planeWorkItem] }),
    });
    const provider = createPlaneProvider(MOCK_PLANE_CONFIG);
    return { provider, cleanup: stub.restore };
  }
  if (name === 'github') {
    // getIssue override: si number !== 42, lanza (simula not-found para `getInvalidRef`)
    const provider = createGitHubProvider(MOCK_GITHUB_CONFIG, {
      client: makeFakeGitHubClient({
        getIssue: (_owner, _repo, number) => {
          if (number !== 42) {
            const err = new Error(`Issue not found: ${number}`);
            // @ts-ignore — match GitHubClient `not_found` code shape (client.js:54).
            err.code = 'not_found';
            throw err;
          }
          return issueFixture;
        },
        // listIssues retorna al menos 1 issue (filtrado por PR es no-op aquí)
        listIssues: () => ({
          status: 200,
          items: [issueFixture],
          etag: undefined,
          rate_limit_remaining: 5000,
        }),
      }),
    });
    return { provider, cleanup: () => {} };
  }
  throw new Error(`Unknown provider in matrix: ${name}`);
}

/**
 * Ref válido por provider (matchea fixtures).
 * @param {string} name
 */
function getValidRef(name) {
  if (name === 'plane') return 'KL-42';
  if (name === 'github') return 'octocat/hello-world#42';
  throw new Error(`No valid ref for: ${name}`);
}

/**
 * Ref inválido por provider (force not-found path).
 * @param {string} name
 */
function getInvalidRef(name) {
  if (name === 'plane') return 'KL-9999';
  if (name === 'github') return 'octocat/hello-world#9999';
  throw new Error(`No invalid ref for: ${name}`);
}

// ───────────────────────────────────────────────────────────────────────
// Matrix loop — TODOS los `it()` viven DENTRO de este loop (Pitfall #3)
// ───────────────────────────────────────────────────────────────────────

for (const providerName of PROVIDERS) {
  describe(`TaskProvider contract — ${providerName}`, () => {
    /** @type {import('../../src/interface.js').TaskProvider} */
    let provider;
    /** @type {() => void} */
    let cleanup;

    beforeEach(async () => {
      ({ provider, cleanup } = await instantiateProvider(providerName));
      // Pitfall #1: SIEMPRE init() — Plane requiere warmup (stateCache, labelCache);
      // GitHub es no-op (D-19). Símétrico por contrato.
      await provider.init();
    });

    afterEach(() => {
      // Restaura `globalThis.fetch` (Plane); no-op en GitHub. T-27-02 mitigation.
      cleanup?.();
    });

    // B7 — init() no-throw (Pattern shared)
    it('init() does not throw', async () => {
      // Ya fue llamado en beforeEach; ahora aserta el contract directo en una
      // segunda instancia para garantizar idempotencia/no-throw símétrico.
      const { provider: p2, cleanup: c2 } = await instantiateProvider(providerName);
      try {
        await assert.doesNotReject(
          () => p2.init(),
          `[${providerName}] init() must not throw`,
        );
      } finally {
        c2?.();
      }
    });

    // B1 — Contract: 9 TASK_PROVIDER_METHODS (Pattern D)
    it('exposes 9 TASK_PROVIDER_METHODS as functions', () => {
      for (const method of TASK_PROVIDER_METHODS) {
        assert.equal(
          typeof provider[method],
          'function',
          `[${providerName}] missing method: ${method}`,
        );
      }
    });

    // B2 — getTask(validRef) returns TaskItem canonical shape (Pattern E + D-18)
    it('getTask(validRef) returns TaskItem with canonical shape (no field leaks)', async () => {
      const task = await provider.getTask(getValidRef(providerName));
      assertTaskItemShape(task, providerName);
    });

    // B3 — getTask(invalidRef) throws Error (Pattern F — contract negativo simétrico)
    it('getTask(invalidRef) throws Error with message string (no .code equality)', async () => {
      await assert.rejects(
        () => provider.getTask(getInvalidRef(providerName)),
        (err) => {
          assert.ok(err instanceof Error, `[${providerName}] must throw Error instance`);
          assert.equal(
            typeof err.message,
            'string',
            `[${providerName}] err.message must be string`,
          );
          // Pitfall #6: NO comparar `.code` ni mensaje literal — diverge legítimamente
          // (Plane: "Work item KL-9999 not found"; GitHub: Error con .code='not_found').
          return true;
        },
      );
    });

    // B5 — listPendingTasks returns Array<TaskItem> (Pattern E aplicado a items)
    it('listPendingTasks returns array; each item satisfies canonical shape', async () => {
      const tasks = await provider.listPendingTasks();
      assert.ok(Array.isArray(tasks), `[${providerName}] listPendingTasks must return array`);
      for (const t of tasks) {
        assertTaskItemShape(t, providerName);
      }
    });

    // B4 — parseTriggerEvent({}) returns null (Pattern F — simétrico)
    it('parseTriggerEvent({}) returns null', () => {
      const result = provider.parseTriggerEvent({});
      assert.equal(
        result,
        null,
        `[${providerName}] parseTriggerEvent({}) must return null, got: ${JSON.stringify(result)}`,
      );
    });

    // B6 — verifySignature('', {}) returns false (Pattern F — simétrico)
    it('verifySignature("", {}) returns false', () => {
      const result = provider.verifySignature('', {});
      assert.equal(
        result,
        false,
        `[${providerName}] verifySignature('', {}) must return false, got: ${result}`,
      );
    });
  });
}
