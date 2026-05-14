// @ts-check
/**
 * Phase 23 GH-01 — GitHubClient unit tests.
 *
 * Estrategia: fetch inyectado via constructor (D-06) + fixtures JSON offline (D-33/D-34/D-35).
 * Zero llamadas a `globalThis.fetch` — el constructor de cada test recibe `makeFetch(scenario)`.
 *
 * Las 12 filas del Per-Task Verification Map (23-VALIDATION.md) están implementadas como
 * `it(...)` discretos. Cobertura: SC#1 (5 métodos + constructor), SC#2 (rate-limit warn +
 * 429 mapping), SC#3 (304 envelope sin throw), SC#4 (≥ 8 tests offline).
 *
 * Leak guard: el top-of-file reemplaza `globalThis.fetch` con un thrower para que cualquier
 * test que olvide inyectar `opts.fetch` falle loud en lugar de tocar `api.github.com`.
 * Se restaura en `after()` para no contaminar otros archivos de tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { GitHubClient } from '../../../src/providers/github/client.js';

import issueFixture from '../../fixtures/github/issue.json' with { type: 'json' };
import issuesListFixture from '../../fixtures/github/issues-list.json' with { type: 'json' };
import rateLimitLowFixture from '../../fixtures/github/rate-limit-low.json' with { type: 'json' };
import rateLimitExceededFixture from '../../fixtures/github/rate-limit-exceeded.json' with { type: 'json' };
import unauthorizedFixture from '../../fixtures/github/unauthorized-401.json' with { type: 'json' };
import forbiddenFixture from '../../fixtures/github/forbidden-403.json' with { type: 'json' };
import notFoundFixture from '../../fixtures/github/not-found-404.json' with { type: 'json' };
import commentCreatedFixture from '../../fixtures/github/comment-created.json' with { type: 'json' };
import labelsListFixture from '../../fixtures/github/labels-list.json' with { type: 'json' };

// Runtime fetch-leak guard: cualquier test que olvide `opts.fetch` toca este thrower.
// El restore en `after()` evita contaminar el resto de la suite.
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

/**
 * Construye un `fetch` fake que devuelve un `Response`-like object con
 * solo lo que `request()` realmente consume (status, ok, headers.get, json, text).
 *
 * @param {{ status: number, body?: any, headers?: Record<string,string> }} scenario
 * @returns {typeof fetch}
 */
function makeFetch(scenario) {
  // @ts-ignore — el shape mínimo es suficiente para lo que el cliente lee.
  return async (_url, _init) => ({
    status: scenario.status,
    ok: scenario.status >= 200 && scenario.status < 300,
    headers: {
      get(name) {
        return scenario.headers?.[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      if (scenario.status === 304) throw new Error('No body for 304');
      return scenario.body;
    },
    async text() {
      return scenario.body ? JSON.stringify(scenario.body) : '';
    },
  });
}

/**
 * Variant de `makeFetch` que captura cada call (url + init) en un array.
 * Útil para asserts de headers/body/URL.
 *
 * @param {{ status: number, body?: any, headers?: Record<string,string> }} scenario
 * @returns {{ fetch: typeof fetch, calls: Array<{ url: string, init: any }> }}
 */
function makeSpyFetch(scenario) {
  const calls = [];
  const inner = makeFetch(scenario);
  const fakeFetch = async (url, init) => {
    calls.push({ url: url.toString(), init });
    return inner(url, init);
  };
  // @ts-ignore — fakeFetch matches the shape we care about.
  return { fetch: fakeFetch, calls };
}

/**
 * Mock minimal de `Logger` (compatible con la shape que esperan
 * `githubApiCall` / `githubApiCallFailed`: `.info`/`.warn`/`.error`).
 * Captura cada call en `records` con el `level` derivado del método invocado.
 */
function makeSpyLogger() {
  const records = [];
  return {
    records,
    info: (event, fields) => records.push({ level: 'info', event, ...fields }),
    warn: (event, fields) => records.push({ level: 'warn', event, ...fields }),
    error: (event, fields) => records.push({ level: 'error', event, ...fields }),
  };
}

describe('GitHubClient', () => {
  // ───────────────────────────────────────────────────────────────────────
  // SC#1 — constructor + auth + headers + 5 método surface
  // ───────────────────────────────────────────────────────────────────────

  it('constructor throws when token unset (row 23-02-01)', () => {
    // No token, no env override. getProviderApiKey('github') returns undefined porque
    // el config v0.6 no tiene `providers.github`. El constructor debe lanzar.
    assert.throws(
      () => new GitHubClient({ fetch: makeFetch({ status: 200, body: {} }) }),
      /GitHub token not found\. Set GITHUB_TOKEN env var\./,
    );
  });

  it('getIssue returns raw payload + parses x-ratelimit-remaining (row 23-02-02)', async () => {
    const { fetch, calls } = makeSpyFetch({
      status: 200,
      body: issueFixture,
      headers: { 'x-ratelimit-remaining': '4998', 'x-ratelimit-reset': '1747200000' },
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    const issue = await client.getIssue('octocat', 'hello-world', 42);

    assert.equal(issue.number, 42);
    assert.equal(issue.title, 'Test issue');
    assert.equal(issue.state, 'open');
    assert.equal(Array.isArray(issue.labels), true);
    assert.equal(issue.labels[0].name, 'kodo');
    assert.equal(client._rateRemaining, 4998);

    // Headers correctos
    assert.equal(calls.length, 1);
    const headers = calls[0].init.headers;
    assert.equal(headers['Authorization'], 'token ghp_test');
    assert.equal(headers['Accept'], 'application/vnd.github+json');
    assert.equal(headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(headers['User-Agent'], 'kodo/0.7.x');
  });

  it('listIssues 200 path returns envelope {status, items, etag, rate_limit_remaining} (row 23-02-03)', async () => {
    const { fetch } = makeSpyFetch({
      status: 200,
      body: issuesListFixture,
      headers: { 'x-ratelimit-remaining': '4500', 'etag': 'W/"abc123"' },
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    const result = await client.listIssues('octocat', 'hello-world');

    assert.equal(result.status, 200);
    assert.equal(Array.isArray(result.items), true);
    assert.equal(result.items.length, 3); // 2 issues + 1 PR (Pitfall #2 — Phase 24 filtra)
    assert.equal(result.etag, 'W/"abc123"');
    assert.equal(result.rate_limit_remaining, 4500);
  });

  it('listIssues 304 path returns envelope {status:304, items:[], etag, rate_limit_remaining} WITHOUT throwing (row 23-02-04 / SC#3)', async () => {
    const { fetch } = makeSpyFetch({
      status: 304,
      headers: { 'x-ratelimit-remaining': '4499', 'etag': 'W/"abc123"' },
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });

    // El test PRINCIPAL: no throw + envelope correcto.
    const result = await client.listIssues('octocat', 'hello-world', { etag: 'W/"abc123"' });

    assert.equal(result.status, 304);
    assert.deepEqual(result.items, []);
    assert.equal(result.etag, 'W/"abc123"');
    assert.equal(result.rate_limit_remaining, 4499);
  });

  it('listIssues sends If-None-Match header when opts.etag provided', async () => {
    const { fetch, calls } = makeSpyFetch({
      status: 200,
      body: [],
      headers: { 'etag': 'W/"new"' },
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    await client.listIssues('octocat', 'hello-world', { etag: 'W/"old"' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers['If-None-Match'], 'W/"old"');
  });

  it('listIssues encodes state/labels/since/per_page as query params', async () => {
    const { fetch, calls } = makeSpyFetch({ status: 200, body: [], headers: {} });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    await client.listIssues('octocat', 'hello-world', {
      state: 'open',
      labels: ['kodo', 'priority:high'],
      since: '2026-05-14T00:00:00Z',
      per_page: 100,
    });

    assert.equal(calls.length, 1);
    const url = calls[0].url;
    assert.match(url, /state=open/);
    assert.match(url, /labels=kodo%2Cpriority%3Ahigh/);
    assert.match(url, /since=2026-05-14T00%3A00%3A00Z/);
    assert.match(url, /per_page=100/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // SC#1 / SC#2 — Error mapping table (row 23-02-10)
  // ───────────────────────────────────────────────────────────────────────

  it('401 throws Error with .code === "unauthorized", .status === 401', async () => {
    const client = new GitHubClient({
      token: 'ghp_test',
      fetch: makeFetch({ status: 401, body: unauthorizedFixture }),
    });
    await assert.rejects(
      () => client.getIssue('octocat', 'hello-world', 42),
      (err) => {
        assert.equal(err.code, 'unauthorized');
        assert.equal(err.status, 401);
        assert.match(err.message, /GitHub API 401:/);
        return true;
      },
    );
  });

  it('404 throws Error with .code === "not_found", .status === 404', async () => {
    const client = new GitHubClient({
      token: 'ghp_test',
      fetch: makeFetch({ status: 404, body: notFoundFixture }),
    });
    await assert.rejects(
      () => client.getIssue('octocat', 'missing-repo', 999),
      (err) => {
        assert.equal(err.code, 'not_found');
        assert.equal(err.status, 404);
        return true;
      },
    );
  });

  it('429 with Retry-After: 60 → .code="rate_limit_exceeded", .retryAfter=60 (row 23-02-05 / SC#2)', async () => {
    const client = new GitHubClient({
      token: 'ghp_test',
      fetch: makeFetch({
        status: 429,
        body: rateLimitExceededFixture,
        headers: { 'retry-after': '60' },
      }),
    });
    await assert.rejects(
      () => client.getIssue('octocat', 'hello-world', 42),
      (err) => {
        assert.equal(err.code, 'rate_limit_exceeded');
        assert.equal(err.status, 429);
        assert.equal(err.retryAfter, 60);
        return true;
      },
    );
  });

  it('403 with X-RateLimit-Remaining: 0 → .code="rate_limit_exceeded" (secondary rate limit map)', async () => {
    const client = new GitHubClient({
      token: 'ghp_test',
      fetch: makeFetch({
        status: 403,
        body: forbiddenFixture,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    });
    await assert.rejects(
      () => client.getIssue('octocat', 'hello-world', 42),
      (err) => {
        assert.equal(err.code, 'rate_limit_exceeded');
        assert.equal(err.status, 403);
        return true;
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // SC#2 — Rate-limit warn NDJSON (row 23-02-06)
  // ───────────────────────────────────────────────────────────────────────

  it('emits NDJSON at warn level when X-RateLimit-Remaining < 100 (row 23-02-06 / SC#2)', async () => {
    const logger = makeSpyLogger();
    const client = new GitHubClient({
      token: 'ghp_test',
      logger,
      fetch: makeFetch({
        status: 200,
        body: rateLimitLowFixture,
        headers: { 'x-ratelimit-remaining': '50' },
      }),
    });
    await client.getIssue('octocat', 'hello-world', 42);

    // Debe haber un único record con level=warn y rate_limit_remaining=50.
    const warns = logger.records.filter((r) => r.level === 'warn');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].event, 'github.api.call');
    assert.equal(warns[0].rate_limit_remaining, 50);
  });

  it('emits NDJSON at info level when X-RateLimit-Remaining >= 100', async () => {
    const logger = makeSpyLogger();
    const client = new GitHubClient({
      token: 'ghp_test',
      logger,
      fetch: makeFetch({
        status: 200,
        body: issueFixture,
        headers: { 'x-ratelimit-remaining': '4998' },
      }),
    });
    await client.getIssue('octocat', 'hello-world', 42);

    const infos = logger.records.filter((r) => r.level === 'info');
    assert.equal(infos.length, 1);
    assert.equal(infos[0].event, 'github.api.call');
    assert.equal(infos[0].rate_limit_remaining, 4998);
    assert.equal(logger.records.filter((r) => r.level === 'warn').length, 0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // SC#1 — addComment / updateIssue / listLabels (rows 23-02-07, 23-02-08, 23-02-09)
  // ───────────────────────────────────────────────────────────────────────

  it('addComment POSTs markdown body intact (row 23-02-07)', async () => {
    const { fetch, calls } = makeSpyFetch({
      status: 201,
      body: commentCreatedFixture,
      headers: {},
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    const result = await client.addComment('octocat', 'hello-world', 42, 'hello **world**');

    assert.equal(result.id, 123);
    assert.equal(result.author_association, 'OWNER');

    // Verificar el body enviado
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    const sentBody = JSON.parse(calls[0].init.body);
    assert.equal(sentBody.body, 'hello **world**');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  });

  it('updateIssue PATCHes with body payload (row 23-02-08)', async () => {
    const { fetch, calls } = makeSpyFetch({
      status: 200,
      body: { ...issueFixture, state: 'closed' },
      headers: {},
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    const result = await client.updateIssue('octocat', 'hello-world', 42, { state: 'closed' });

    assert.equal(result.state, 'closed');
    assert.equal(calls[0].init.method, 'PATCH');
    const sentBody = JSON.parse(calls[0].init.body);
    assert.deepEqual(sentBody, { state: 'closed' });
  });

  it('listLabels returns raw array of {id, name, color} (row 23-02-09)', async () => {
    const { fetch } = makeSpyFetch({
      status: 200,
      body: labelsListFixture,
      headers: {},
    });
    const client = new GitHubClient({ token: 'ghp_test', fetch });
    const labels = await client.listLabels('octocat', 'hello-world');

    assert.equal(Array.isArray(labels), true);
    assert.equal(labels.length, 3);
    assert.equal(labels[0].name, 'kodo');
    assert.equal(labels[0].color, '0e8a16');
    assert.equal(labels[2].name, 'priority:high');
  });
});
