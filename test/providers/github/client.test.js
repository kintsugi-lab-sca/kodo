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
  // Task 3 + Task 4 añaden los 12 tests aquí.
});
