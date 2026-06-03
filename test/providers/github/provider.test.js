// @ts-check
/**
 * Phase 24 GH-02 / TEST-01 — createGitHubProvider contract + 9-method coverage.
 *
 * Estrategia: fakeClient injection (D-36) + live-fetch leak guard (D-37). Cero llamadas a
 * `globalThis.fetch` — cada test pasa `opts.client = makeFakeClient()` al factory, así el
 * provider NO construye un `GitHubClient` real (que tocaría `getProviderApiKey('github')` y
 * lanzaría `GitHub token not found` sin config).
 *
 * Si algún test olvida inyectar `opts.client`, el constructor real intentará usar
 * `globalThis.fetch`, que está reemplazado por un thrower (`before/after`) — el error
 * `live fetch leak: ...` surge loud en lugar de tocar `api.github.com`.
 *
 * NO importar HMAC machinery (crypto helpers) — D-26/D-27: GitHub provider tiene
 * `parseTriggerEvent → null` y `verifySignature → false` deterministicos (polling-only en v0.7).
 */

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { TASK_PROVIDER_METHODS } from '../../../src/interface.js';

import issueFixture from '../../fixtures/github/issue.json' with { type: 'json' };
import issuesListFixture from '../../fixtures/github/issues-list.json' with { type: 'json' };

/** @type {import('../../../src/providers/github/provider.js')['createGitHubProvider']} */
let createGitHubProvider;

// D-29: snake_case config (raw del config, sin transformación registry).
const MOCK_CONFIG = {
  base_url: 'https://api.github.com',
  api_key_env: 'GITHUB_TOKEN',
  repos: [{ owner: 'octocat', repo: 'hello-world' }],
  states: { trigger: 'open', review: 'closed', done: 'closed' },
};

// D-37 live-fetch leak guard (lift de test/providers/github/client.test.js:32-43).
// Cualquier test que olvide `opts.client` provoca que el factory construya un GitHubClient
// real, que llama `globalThis.fetch` y revienta loud con este mensaje.
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject opts.client');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});

/**
 * Mock minimal del `GitHubClient` — sólo los 5 métodos consumidos por el provider
 * (getIssue, listIssues, addComment, updateIssue, listLabels). Cada método es un spy
 * que captura argumentos en `calls[methodName]`. `overrides` per-método permite
 * forzar respuestas específicas en tests.
 *
 * D-36: el factory acepta `opts.client?` para inyección de tests sin tocar fetch.
 *
 * @param {Record<string, Function>} [overrides]
 */
function makeFakeClient(overrides = {}) {
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

describe('GitHubProvider', () => {
  beforeEach(async () => {
    ({ createGitHubProvider } = await import('../../../src/providers/github/provider.js'));
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-01 — Contract: factory returns 9 methods of TASK_PROVIDER_METHODS
  // ───────────────────────────────────────────────────────────────────────

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

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-02 — init() no-op (D-19): no throw, cero calls al cliente
  // ───────────────────────────────────────────────────────────────────────

  it('init() is no-op (D-19): does not throw and makes zero client calls', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    await provider.init();
    assert.equal(fakeClient.calls.getIssue.length, 0, 'D-19: init must not call getIssue');
    assert.equal(fakeClient.calls.listIssues.length, 0, 'D-19: init must not call listIssues');
    assert.equal(fakeClient.calls.listLabels.length, 0, 'D-19: init must not call listLabels');
    assert.equal(fakeClient.calls.updateIssue.length, 0, 'D-19: init must not call updateIssue');
    assert.equal(fakeClient.calls.addComment.length, 0, 'D-19: init must not call addComment');
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-03 — getTask(ref): parseRef + client.getIssue + normalizeIssue (D-20)
  // ───────────────────────────────────────────────────────────────────────

  it('getTask(ref) parses ref, calls client.getIssue, returns normalized TaskItem (D-20)', async () => {
    const fakeClient = makeFakeClient({
      getIssue: () => issueFixture,
    });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const task = await provider.getTask('octocat/hello-world#42');

    // parseRef forwarding correcto
    assert.equal(fakeClient.calls.getIssue.length, 1);
    assert.deepEqual(fakeClient.calls.getIssue[0], {
      owner: 'octocat',
      repo: 'hello-world',
      number: 42,
    });

    // normalizeIssue forwarding correcto (TaskItem shape canonical)
    assert.equal(task.id, 'I_kwTEST001', 'D-07: id = node_id');
    assert.equal(task.ref, 'octocat/hello-world#42', 'D-08: ref = owner/repo#number');
    assert.equal(task.projectId, 'octocat/hello-world', 'D-12: projectId from context');
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-04 — resolveRef(humanRef): returns node_id (D-21)
  // ───────────────────────────────────────────────────────────────────────

  it('resolveRef(humanRef) returns issue.node_id (D-21)', async () => {
    const fakeClient = makeFakeClient({
      getIssue: () => issueFixture,
    });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const nodeId = await provider.resolveRef('octocat/hello-world#42');

    assert.equal(nodeId, 'I_kwTEST001', 'D-21: resolveRef returns issue.node_id');
    assert.equal(fakeClient.calls.getIssue.length, 1);
    assert.deepEqual(fakeClient.calls.getIssue[0], {
      owner: 'octocat',
      repo: 'hello-world',
      number: 42,
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-05 — parseRef rejects Plane refs / URLs / partial refs (D-22)
  // ───────────────────────────────────────────────────────────────────────

  it('getTask rejects Plane-style ref "KL-42" with "Invalid GitHub ref" (D-22)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    await assert.rejects(
      () => provider.getTask('KL-42'),
      /^Error: Invalid GitHub ref: KL-42\. Expected owner\/repo#number$/,
    );
    assert.equal(fakeClient.calls.getIssue.length, 0, 'client.getIssue must NOT be called on invalid ref');
  });

  it('getTask rejects partial ref "#42" with "Invalid GitHub ref" (D-22)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    await assert.rejects(
      () => provider.getTask('#42'),
      /^Error: Invalid GitHub ref: #42\. Expected owner\/repo#number$/,
    );
    assert.equal(fakeClient.calls.getIssue.length, 0);
  });

  it('getTask rejects full URL ref with "Invalid GitHub ref" (D-22)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    await assert.rejects(
      () => provider.getTask('https://github.com/octocat/hello-world/issues/42'),
      /^Error: Invalid GitHub ref: https:\/\/github\.com\/octocat\/hello-world\/issues\/42\. Expected owner\/repo#number$/,
    );
    assert.equal(fakeClient.calls.getIssue.length, 0);
  });

  it('getTask rejects ref without #number (e.g. "octocat/hello-world") (D-22)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    await assert.rejects(
      () => provider.getTask('octocat/hello-world'),
      /^Error: Invalid GitHub ref: octocat\/hello-world\. Expected owner\/repo#number$/,
    );
    assert.equal(fakeClient.calls.getIssue.length, 0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-06 — updateTaskState passthrough HARD (D-23)
  //   A: 'closed' literal → client.updateIssue({state:'closed'})
  //   B: 'open' literal → client.updateIssue({state:'open'})
  //   C (W8): 'Done' name → throw "Unknown state: Done." (NO mapping to 'closed')
  //   D: 'NoSuchState' → throw "Unknown state: NoSuchState." (same branch as C)
  // ───────────────────────────────────────────────────────────────────────

  it('updateTaskState(task, "closed") passes literal "closed" to client.updateIssue (D-23 sub-A)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const task = { ref: 'octocat/hello-world#42', projectId: 'octocat/hello-world' };
    await provider.updateTaskState(task, 'closed');

    assert.equal(fakeClient.calls.updateIssue.length, 1);
    assert.deepEqual(fakeClient.calls.updateIssue[0], {
      owner: 'octocat',
      repo: 'hello-world',
      number: 42,
      updates: { state: 'closed' },
    });
  });

  it('updateTaskState(task, "open") passes literal "open" to client.updateIssue (D-23 sub-B)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const task = { ref: 'octocat/hello-world#42', projectId: 'octocat/hello-world' };
    await provider.updateTaskState(task, 'open');

    assert.equal(fakeClient.calls.updateIssue.length, 1);
    assert.deepEqual(fakeClient.calls.updateIssue[0].updates, { state: 'open' });
  });

  it('updateTaskState(task, "Done") throws "Unknown state: Done." — D-23 passthrough hard, NO mapping (W8 sub-C)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const task = { ref: 'octocat/hello-world#42', projectId: 'octocat/hello-world' };

    // D-23 W8: 'Done' is NOT in ['open','closed'] AND NOT in Object.values(config.states)=['open','closed','closed'].
    // Provider MUST throw — it must NOT silently translate 'Done' → 'closed' (the caller does that).
    await assert.rejects(
      async () => provider.updateTaskState(task, 'Done'),
      { message: /^Unknown state: Done\./ },
    );
    assert.equal(
      fakeClient.calls.updateIssue.length,
      0,
      'D-23 W8: client.updateIssue must NOT be called when state is rejected',
    );
  });

  it('updateTaskState(task, "NoSuchState") throws "Unknown state: NoSuchState." (D-23 sub-D)', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const task = { ref: 'octocat/hello-world#42', projectId: 'octocat/hello-world' };

    await assert.rejects(
      async () => provider.updateTaskState(task, 'NoSuchState'),
      { message: /^Unknown state: NoSuchState\./ },
    );
    assert.equal(fakeClient.calls.updateIssue.length, 0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-07 — addComment posts Markdown literal (D-24): NO <p>/<br> wrap
  // ───────────────────────────────────────────────────────────────────────

  it('addComment(task, "**md**") posts Markdown literally — D-24: no HTML wrap', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const task = { ref: 'octocat/hello-world#42', projectId: 'octocat/hello-world' };

    await provider.addComment(task, '**md**\nsecond line');

    assert.equal(fakeClient.calls.addComment.length, 1);
    const call = fakeClient.calls.addComment[0];
    assert.equal(call.owner, 'octocat');
    assert.equal(call.repo, 'hello-world');
    assert.equal(call.number, 42);
    assert.equal(
      call.body,
      '**md**\nsecond line',
      'D-24: GitHub provider sends Markdown literal (no <p>/<br> wrap)',
    );
    assert.equal(
      call.body.includes('<p>'),
      false,
      'D-24: no <p> wrapping',
    );
    assert.equal(
      call.body.includes('<br>'),
      false,
      'D-24: no <br> conversion of newlines',
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-08 — listPendingTasks: server-side filter + PR filtering (D-25)
  // ───────────────────────────────────────────────────────────────────────

  it('listPendingTasks iterates repos, filters PRs, returns normalized TaskItems (D-25)', async () => {
    const fakeClient = makeFakeClient({
      listIssues: () => ({
        status: 200,
        items: issuesListFixture, // 2 issues + 1 PR (Pitfall #2)
        etag: undefined,
        rate_limit_remaining: 4500,
      }),
    });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });

    const tasks = await provider.listPendingTasks();

    // client.listIssues called once per repo (1 repo in MOCK_CONFIG)
    assert.equal(fakeClient.calls.listIssues.length, 1);
    assert.equal(fakeClient.calls.listIssues[0].owner, 'octocat');
    assert.equal(fakeClient.calls.listIssues[0].repo, 'hello-world');
    assert.deepEqual(
      fakeClient.calls.listIssues[0].opts,
      { labels: ['kodo'], state: 'open' },
      'D-25: server-side filter labels=kodo + state=open',
    );

    // 3 items en la fixture (2 issues + 1 PR), PR filtrado → 2 TaskItems
    assert.equal(tasks.length, 2, 'D-25 / Pitfall #2: PR filtered out');
    assert.equal(tasks[0].id, 'I_kwTEST001');
    assert.equal(tasks[1].id, 'I_kwTEST002');

    // El PR (node_id PR_kwTEST003) NO debe estar en el resultado
    const prInResult = tasks.find((t) => t.id === 'PR_kwTEST003');
    assert.equal(prInResult, undefined, 'D-25: PR must be filtered out');

    // Normalización aplicada (projectId desde context)
    assert.equal(tasks[0].projectId, 'octocat/hello-world');
    assert.equal(tasks[0].ref, 'octocat/hello-world#42');
  });

  it('listPendingTasks handles empty repos list gracefully', async () => {
    const fakeClient = makeFakeClient();
    const provider = createGitHubProvider({ ...MOCK_CONFIG, repos: [] }, { client: fakeClient });
    const tasks = await provider.listPendingTasks();
    assert.deepEqual(tasks, []);
    assert.equal(fakeClient.calls.listIssues.length, 0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 40-01 — getTaskState({ref}): label-convention mapping, ONE issue fetch (D-11/D-12)
  // ───────────────────────────────────────────────────────────────────────

  /** Build a fake getIssue returning the given labels + open/closed state. */
  function issueWith(labels, state) {
    return () => ({
      node_id: 'I_kwTEST001',
      number: 42,
      title: 't',
      body: '',
      labels: labels.map((name) => ({ name })),
      state,
      html_url: 'https://github.com/octocat/hello-world/issues/42',
    });
  }

  it('getTaskState: label "awaiting-review" → in_review (D-11 convention)', async () => {
    const fakeClient = makeFakeClient({ getIssue: issueWith(['awaiting-review'], 'open') });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    const state = await provider.getTaskState({ ref: 'octocat/hello-world#42' });
    assert.equal(state, 'in_review');
  });

  it('getTaskState: label including "block" → blocked (D-11 convention)', async () => {
    const fakeClient = makeFakeClient({ getIssue: issueWith(['blocked-by-dep'], 'open') });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    assert.equal(await provider.getTaskState({ ref: 'octocat/hello-world#42' }), 'blocked');
  });

  it('getTaskState: open issue, no review/block label → in_progress', async () => {
    const fakeClient = makeFakeClient({ getIssue: issueWith(['kodo'], 'open') });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    assert.equal(await provider.getTaskState({ ref: 'octocat/hello-world#42' }), 'in_progress');
  });

  it('getTaskState: closed issue, no review/block label → done', async () => {
    const fakeClient = makeFakeClient({ getIssue: issueWith(['kodo'], 'closed') });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    assert.equal(await provider.getTaskState({ ref: 'octocat/hello-world#42' }), 'done');
  });

  it('getTaskState makes exactly ONE issue fetch, no extra call (D-12)', async () => {
    const fakeClient = makeFakeClient({ getIssue: issueWith(['awaiting-review'], 'open') });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    await provider.getTaskState({ ref: 'octocat/hello-world#42' });
    assert.equal(fakeClient.calls.getIssue.length, 1, 'D-12: single issue fetch');
    assert.equal(fakeClient.calls.listIssues.length, 0, 'D-12: no PR/timeline lookup');
  });

  it('getTaskState anti-ReDoS: a label "(.*)+review" is matched as literal substring (D-11)', async () => {
    const fakeClient = makeFakeClient({ getIssue: issueWith(['(.*)+review'], 'open') });
    const provider = createGitHubProvider(MOCK_CONFIG, { client: fakeClient });
    assert.equal(await provider.getTaskState({ ref: 'octocat/hello-world#42' }), 'in_review');
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-09 — parseTriggerEvent → null deterministic (D-26)
  // ───────────────────────────────────────────────────────────────────────

  it('parseTriggerEvent returns null for any payload (D-26: GitHub polling-only)', () => {
    const provider = createGitHubProvider(MOCK_CONFIG, { client: makeFakeClient() });
    assert.equal(provider.parseTriggerEvent({}), null);
    assert.equal(provider.parseTriggerEvent({ action: 'opened', issue: {} }), null);
    assert.equal(provider.parseTriggerEvent(null), null);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-10 — verifySignature → false deterministic (D-27)
  // ───────────────────────────────────────────────────────────────────────

  it('verifySignature returns false for any body/headers (D-27: webhook off, no secret)', () => {
    const provider = createGitHubProvider(MOCK_CONFIG, { client: makeFakeClient() });
    assert.equal(provider.verifySignature('body', {}), false);
    assert.equal(provider.verifySignature('', { 'x-github-signature': 'whatever' }), false);
    assert.equal(provider.verifySignature('payload', { 'x-hub-signature-256': 'sha256=abc' }), false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 24-02-11 — listProjects returns config.repos.map(...) with ZERO API calls (D-28)
  // ───────────────────────────────────────────────────────────────────────

  it('listProjects returns config.repos mapped to {id,identifier,name} with zero API calls (D-28)', async () => {
    const fakeClient = makeFakeClient();
    const config = {
      ...MOCK_CONFIG,
      repos: [
        { owner: 'octocat', repo: 'hello-world' },
        { owner: 'github', repo: 'docs' },
      ],
    };
    const provider = createGitHubProvider(config, { client: fakeClient });
    const projects = await provider.listProjects();

    assert.equal(projects.length, 2);
    assert.deepEqual(projects[0], {
      id: 'octocat/hello-world',
      identifier: 'octocat/hello-world',
      name: 'octocat/hello-world',
    });
    assert.deepEqual(projects[1], {
      id: 'github/docs',
      identifier: 'github/docs',
      name: 'github/docs',
    });

    // D-28: cero API calls
    assert.equal(fakeClient.calls.listIssues.length, 0, 'D-28: listProjects must NOT call listIssues');
    assert.equal(fakeClient.calls.getIssue.length, 0, 'D-28: listProjects must NOT call getIssue');
    assert.equal(fakeClient.calls.listLabels.length, 0, 'D-28: listProjects must NOT call listLabels');
  });
});
