// @ts-check
//
// test/dashboard-client.test.js — Phase 35 Plan 01 Wave 0 (TUI-05 + TUI-06).
//
// Cubre los 5 escenarios del discriminante {ok} de `fetchStatus` (D-07, Pattern 1):
//   1. ok           → payload válido → { ok:true, data }
//   2. HTTP no-ok    → 500 → { ok:false } con error que contiene "500"
//   3. JSON corrupto → json() lanza SyntaxError → { ok:false } (NO propaga, Pitfall 12)
//   4. throw         → fetchFn lanza ECONNREFUSED → { ok:false } con "ECONNREFUSED"
//   5. bad shape     → 200 sin `sessions` array → { ok:false, error:'bad shape' }
//
// fetchStatus NEVER-THROWS: cualquier modo de fallo colapsa al discriminante {ok:false},
// jamás una excepción que llegue a React (TUI-06 invariante "no crash" — estructural aquí).
//
// Leak guard: el top-of-file reemplaza `globalThis.fetch` por un thrower para que cualquier
// test que olvide inyectar el `fetchFn` fake falle loud en lugar de tocar la red. Se restaura
// en `after()` para no contaminar el resto de la suite. (Patrón copiado de
// test/providers/github/client.test.js:32-43.)
//
// Estado Wave 0: ROJO por diseño hasta que la Task 2 cree
// `src/cli/dashboard/client.js` (export `fetchStatus`). Hoy el import falla porque el
// archivo no existe — la mordida esperada del Nyquist gate.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { fetchStatus } from '../src/cli/dashboard/client.js';

// Runtime fetch-leak guard: cualquier test que olvide inyectar `fetchFn` toca este thrower.
// El restore en `after()` evita contaminar el resto de la suite.
const _originalFetch = globalThis.fetch;
before(() => {
  // @ts-ignore — intentional override scoped to this test file.
  globalThis.fetch = () => {
    throw new Error('live fetch leak: test must inject fetchFn as 2nd arg of fetchStatus');
  };
});
after(() => {
  globalThis.fetch = _originalFetch;
});

/**
 * Construye un `fetchFn` fake que devuelve un `Response`-like con solo lo que
 * `fetchStatus` consume: `ok` (bool), `status` (number) y `json()` (async, puede lanzar).
 *
 * @param {{ status: number, ok: boolean, json?: () => Promise<any> }} scenario
 * @returns {typeof fetch}
 */
function makeFetch(scenario) {
  // @ts-ignore — el shape mínimo es suficiente para lo que el cliente lee.
  return async (_url, _init) => ({
    status: scenario.status,
    ok: scenario.ok,
    json: scenario.json ?? (async () => ({})),
  });
}

const BASE_URL = 'http://localhost:9090';

describe('fetchStatus: discriminante {ok} never-throws (D-07, TUI-05/TUI-06)', () => {
  it('ok: payload válido → { ok:true, data }', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ sessions: [{}], count: 1 }),
    });
    const result = await fetchStatus(BASE_URL, fetchFn);
    assert.equal(result.ok, true);
    assert.equal(result.data.count, 1);
    assert.ok(Array.isArray(result.data.sessions));
    assert.equal(result.data.sessions.length, 1);
  });

  it('HTTP no-ok: 500 → { ok:false } con error que contiene "500"', async () => {
    const fetchFn = makeFetch({ status: 500, ok: false });
    const result = await fetchStatus(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.match(result.error, /500/);
  });

  it('JSON corrupto: json() lanza SyntaxError → { ok:false } (no propaga)', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    const result = await fetchStatus(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });

  it('throw (ECONNREFUSED): fetchFn lanza → { ok:false } con "ECONNREFUSED"', async () => {
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    // @ts-ignore — fetchFn matches the shape we care about.
    const result = await fetchStatus(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.match(result.error, /ECONNREFUSED/);
  });

  it('bad shape: 200 sin sessions array → { ok:false, error:"bad shape" }', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ count: 3 }),
    });
    const result = await fetchStatus(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'bad shape');
  });
});
