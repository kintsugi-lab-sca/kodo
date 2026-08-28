// @ts-check
/**
 * KODO-35 — retry con backoff en 5xx y errores de red (+jitter) en `PlaneClient`.
 *
 * Estrategia: `fetch` y `sleep` inyectados por constructor (seams D-06, mismo patrón que
 * `GitHubClient`). Cero red, cero esperas reales — `sleep` solo registra los ms pedidos.
 *
 * El `fetch` fake consume una SECUENCIA de pasos: un paso por intento esperado. Si el
 * cliente reintenta de más, se queda sin pasos y falla loud en vez de colgarse.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// El constructor llama a `loadConfig()`, que lee `$HOME/.kodo/config.json`. Redirigimos HOME a
// un tmpdir ANTES de importar el cliente para no depender del config real de la máquina.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'kodo-plane-client-'));
process.env.HOME = TEST_HOME;
mkdirSync(join(TEST_HOME, '.kodo'), { recursive: true });
writeFileSync(
  join(TEST_HOME, '.kodo', 'config.json'),
  JSON.stringify({
    provider: 'plane',
    providers: {
      plane: {
        base_url: 'https://plane.test',
        api_key_env: 'KODO_TEST_PLANE_KEY',
        workspace_slug: 'ws',
        projects: [],
        states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
      },
    },
  }) + '\n',
);

const { PlaneClient, computeBackoffMs } = await import('../../../src/providers/plane/client.js');

// Leak guard: cualquier test que olvide inyectar `fetch` toca este thrower en vez de la red.
const _originalFetch = globalThis.fetch;
const _originalWarn = console.warn;
before(() => {
  // @ts-ignore — override intencional, con scope a este fichero.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: el test debe inyectar fetch por constructor');
  };
  console.warn = () => {}; // el loop de retry es ruidoso por diseño
});
after(() => {
  globalThis.fetch = _originalFetch;
  console.warn = _originalWarn;
});

/** @param {{ status?: number, body?: any, headers?: Record<string,string> }} step */
function makeResponse({ status = 200, body = { ok: true }, headers = {} }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      /** @param {string} name */
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

/**
 * Construye un cliente con `fetch` secuencial y `sleep` instrumentado.
 *
 * @param {Array<{ status?: number, body?: any, headers?: Record<string,string>, error?: Error }>} steps
 *   Un paso por intento esperado. `error` → el fetch lanza (error de transporte).
 */
function makeClient(steps) {
  const calls = [];
  const waits = [];
  const client = new PlaneClient({
    baseUrl: 'https://plane.test',
    apiKey: 'test-key',
    workspaceSlug: 'ws',
    // @ts-ignore — shape mínimo: el cliente solo lee status/ok/headers.get/json/text.
    fetch: async (url, init) => {
      const step = steps[calls.length];
      calls.push({ url: String(url), init });
      if (!step) throw new Error(`fetch inesperado #${calls.length}: la secuencia tenía ${steps.length} pasos`);
      if (step.error) throw step.error;
      return makeResponse(step);
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { client, calls, waits };
}

/** Error de transporte tal y como lo lanza undici cuando la conexión no se establece. */
function networkError() {
  return new TypeError('fetch failed');
}

describe('PlaneClient retry (KODO-35)', () => {
  it('GET: 502 transitorio → reintenta → 200', async () => {
    const { client, calls, waits } = makeClient([{ status: 502 }, { status: 200, body: { results: [1] } }]);

    const data = await client.request('/projects/');

    assert.deepEqual(data, { results: [1] });
    assert.equal(calls.length, 2, 'debe haber reintentado exactamente una vez');
    assert.equal(waits.length, 1);
    assert.ok(waits[0] >= 500 && waits[0] <= 1000, `backoff del intento 0 fuera de rango: ${waits[0]}`);
  });

  it('GET: "fetch failed" → reintenta → 200', async () => {
    const { client, calls, waits } = makeClient([{ error: networkError() }, { status: 200, body: { ok: 1 } }]);

    const data = await client.request('/projects/');

    assert.deepEqual(data, { ok: 1 });
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
  });

  it('GET: timeout de AbortSignal → reintenta → 200', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const { client, calls } = makeClient([{ error: timeout }, { status: 200, body: { ok: 1 } }]);

    assert.deepEqual(await client.request('/projects/'), { ok: 1 });
    assert.equal(calls.length, 2);
  });

  it('PUT reintenta sobre 503; PATCH reintenta sobre 500', async () => {
    const put = makeClient([{ status: 503 }, { status: 200, body: { m: 'put' } }]);
    assert.deepEqual(await put.client.request('/x/', { method: 'PUT', body: { a: 1 } }), { m: 'put' });
    assert.equal(put.calls.length, 2);
    assert.equal(put.calls[1].init.method, 'PUT');

    const patch = makeClient([{ status: 500 }, { status: 200, body: { m: 'patch' } }]);
    assert.deepEqual(await patch.client.request('/x/', { method: 'PATCH', body: { state: 'uuid' } }), { m: 'patch' });
    assert.equal(patch.calls.length, 2, 'PATCH es set absoluto de campos → reintentable');
  });

  it('POST NO reintenta sobre 5xx (la petición llegó: duplicaría el recurso)', async () => {
    const { client, calls, waits } = makeClient([{ status: 502, body: { detail: 'bad gateway' } }]);

    await assert.rejects(
      client.request('/comments/', { method: 'POST', body: { comment_html: '<p>x</p>' } }),
      /Plane API 502/,
    );
    assert.equal(calls.length, 1, 'un único intento');
    assert.equal(waits.length, 0);
  });

  it('POST SÍ reintenta ante error de red (la petición nunca se cursó)', async () => {
    const { client, calls } = makeClient([{ error: networkError() }, { status: 201, body: { id: 'c1' } }]);

    assert.deepEqual(await client.request('/comments/', { method: 'POST', body: { x: 1 } }), { id: 'c1' });
    assert.equal(calls.length, 2);
  });

  it('POST SIGUE reintentando sobre 429 (rate limit no aplicó el cambio)', async () => {
    const { client, calls, waits } = makeClient([
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 201, body: { id: 'c1' } },
    ]);

    assert.deepEqual(await client.request('/comments/', { method: 'POST', body: { x: 1 } }), { id: 'c1' });
    assert.equal(calls.length, 2);
    assert.equal(waits[0], 2000, 'Retry-After del servidor manda, sin jitter');
  });

  it('agota maxRetries: 5xx persistente → 1 + N intentos y throw con el status', async () => {
    const { client, calls, waits } = makeClient([
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503, body: { detail: 'down' } },
    ]);

    await assert.rejects(client.request('/projects/'), /Plane API 503/);
    assert.equal(calls.length, 4, 'intento inicial + 3 reintentos (maxRetries por defecto)');
    assert.equal(waits.length, 3);
    // El backoff crece: cada escalón tiene un suelo (mitad fija del equal jitter).
    assert.ok(waits[0] >= 500 && waits[0] <= 1000, `waits[0]=${waits[0]}`);
    assert.ok(waits[1] >= 1000 && waits[1] <= 2000, `waits[1]=${waits[1]}`);
    assert.ok(waits[2] >= 2000 && waits[2] <= 4000, `waits[2]=${waits[2]}`);
  });

  it('agota maxRetries: error de red persistente → propaga el error ORIGINAL', async () => {
    const err = networkError();
    const { client, calls } = makeClient([{ error: err }, { error: err }, { error: err }, { error: err }]);

    await assert.rejects(client.request('/projects/'), (e) => e === err);
    assert.equal(calls.length, 4);
  });

  it('maxRetries: 0 desactiva el retry', async () => {
    const { client, calls } = makeClient([{ status: 502, body: { detail: 'x' } }]);

    await assert.rejects(client.request('/projects/', { maxRetries: 0 }), /Plane API 502/);
    assert.equal(calls.length, 1);
  });

  it('4xx no reintenta (404 falla al primer intento)', async () => {
    const { client, calls } = makeClient([{ status: 404, body: { detail: 'not found' } }]);

    await assert.rejects(client.request('/projects/'), /Plane API 404/);
    assert.equal(calls.length, 1);
  });
});

describe('computeBackoffMs (KODO-35)', () => {
  it('Retry-After del servidor tiene prioridad y no lleva jitter', () => {
    assert.equal(computeBackoffMs(0, 5), 5000);
    assert.equal(computeBackoffMs(3, 1, () => 0.99), 1000);
  });

  it('equal jitter: mitad fija + mitad aleatoria', () => {
    assert.equal(computeBackoffMs(0, 0, () => 0), 500);
    assert.equal(computeBackoffMs(0, 0, () => 1), 1000);
    assert.equal(computeBackoffMs(1, 0, () => 0.5), 1500);
  });

  it('respeta el cap de 8s', () => {
    assert.equal(computeBackoffMs(10, 0, () => 1), 8000);
    assert.equal(computeBackoffMs(10, 0, () => 0), 4000);
  });

  it('con Math.random real cae siempre dentro del rango del escalón', () => {
    for (let i = 0; i < 50; i++) {
      const ms = computeBackoffMs(2);
      assert.ok(ms >= 2000 && ms <= 4000, `fuera de rango: ${ms}`);
    }
  });
});
