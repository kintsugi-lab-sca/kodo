// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PROVIDER_METHODS } from '../src/interface.js';

/** @type {import('../src/providers/registry.js')['getProvider']} */
let getProvider;
/** @type {import('../src/providers/registry.js')['registerProvider']} */
let registerProvider;
/** @type {import('../src/providers/registry.js')['clearRegistry']} */
let clearRegistry;

/**
 * Create a fake TaskProvider with all required methods as no-ops.
 * @returns {Record<string, Function>}
 */
function createFakeProvider() {
  const provider = {};
  for (const method of TASK_PROVIDER_METHODS) {
    provider[method] = () => {};
  }
  return provider;
}

/**
 * Phase 24 D-29: mock minimal de `config.providers.github` (snake_case raw).
 * El factory consume el sub-objeto tal cual viene del config — el registry no transforma.
 */
const MOCK_GITHUB_CONFIG = {
  base_url: 'https://api.github.com',
  api_key_env: 'GITHUB_TOKEN',
  repos: [{ owner: 'octocat', repo: 'hello-world' }],
  states: { trigger: 'open', review: 'closed', done: 'closed' },
};

/**
 * Stub minimal del `GitHubClient` — sólo los 5 métodos consumidos por el provider
 * (getIssue, listIssues, addComment, updateIssue, listLabels). Permite inyectar
 * via `opts.client` (D-36) sin construir un cliente real (que requiere GITHUB_TOKEN).
 */
function createFakeGitHubClient() {
  return {
    async getIssue() {
      return {
        node_id: 'I_x',
        number: 1,
        title: '',
        body: '',
        labels: [],
        state: 'open',
        html_url: '',
      };
    },
    async listIssues() {
      return { status: 200, items: [], etag: '', rate_limit_remaining: 5000 };
    },
    async addComment() {
      return { id: 1 };
    },
    async updateIssue(_o, _r, n, u) {
      return { number: n, state: u.state };
    },
    async listLabels() {
      return [];
    },
  };
}

describe('Provider Registry', () => {
  beforeEach(async () => {
    ({ getProvider, registerProvider, clearRegistry } = await import('../src/providers/registry.js'));
    clearRegistry();
  });

  it('getProvider returns registered provider', () => {
    registerProvider('test', () => createFakeProvider());
    const provider = getProvider('test');
    for (const method of TASK_PROVIDER_METHODS) {
      assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
    }
  });

  it('getProvider caches instances (singleton)', () => {
    registerProvider('test', () => createFakeProvider());
    const first = getProvider('test');
    const second = getProvider('test');
    assert.equal(first, second, 'Expected same instance (singleton)');
  });

  it('getProvider throws for unknown provider', () => {
    assert.throws(
      () => getProvider('nonexistent'),
      { message: /Unknown provider: nonexistent/ },
    );
  });

  it('registerProvider validates interface compliance', () => {
    registerProvider('bad', () => {
      // Missing 'init' method
      const provider = {};
      for (const method of TASK_PROVIDER_METHODS.slice(1)) {
        provider[method] = () => {};
      }
      return provider;
    });
    assert.throws(
      () => getProvider('bad'),
      { message: /missing method: init/i },
    );
  });

  it('clearRegistry resets cache', () => {
    let callCount = 0;
    registerProvider('test', () => {
      callCount++;
      return createFakeProvider();
    });
    getProvider('test');
    assert.equal(callCount, 1);
    clearRegistry();
    registerProvider('test', () => {
      callCount++;
      return createFakeProvider();
    });
    getProvider('test');
    assert.equal(callCount, 2, 'Expected new factory call after clearRegistry');
  });

  // Phase 24 D-38: prueba definitiva de GH-04 — el factory REAL de github
  // satisface el gate de los 9 TASK_PROVIDER_METHODS. Usa inyección directa via
  // `registerProvider` (NO initRegistry/registerDefaults) para no disparar
  // loadConfig() — config v0.6 sin clave github haría crash.
  it('getProvider("github") via createGitHubProvider passes TASK_PROVIDER_METHODS gate', async () => {
    const { createGitHubProvider } = await import('../src/providers/github/provider.js');
    registerProvider('github', () =>
      createGitHubProvider(MOCK_GITHUB_CONFIG, { client: createFakeGitHubClient() }),
    );
    const provider = getProvider('github');
    for (const method of TASK_PROVIDER_METHODS) {
      assert.equal(typeof provider[method], 'function', `Missing method: ${method}`);
    }
  });

  it('getProvider("github") returns cached singleton across calls', async () => {
    const { createGitHubProvider } = await import('../src/providers/github/provider.js');
    registerProvider('github', () =>
      createGitHubProvider(MOCK_GITHUB_CONFIG, { client: createFakeGitHubClient() }),
    );
    const first = getProvider('github');
    const second = getProvider('github');
    assert.equal(first, second, 'Expected same instance (singleton)');
  });
});
