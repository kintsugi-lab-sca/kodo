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

import { fetchStatus, fetchComments, fetchLogs } from '../src/cli/dashboard/client.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 39 Plan 01 (TUI-15): fetchComments — matriz D-07 con 404 DISCRIMINABLE.
//   La diferencia crítica con fetchStatus: App.js (Plan 02) debe distinguir 404
//   ("task not found", overlay vacío honesto) de 5xx/red ("error fetching
//   comments"). Por eso el fallo HTTP DEBE incluir `code` ('not-found' | 'http' |
//   'network'). Vacío (`comments:[]`) NO es error — es estado de UI.
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchComments: discriminante {ok,code} never-throws (D-07, TUI-15)', () => {
  it('ok: 200 con comments → { ok:true, data:{comments} }', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ comments: [{ body: 'hola' }] }),
    });
    const result = await fetchComments(BASE_URL, 'tid-1', fetchFn);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.comments));
    assert.equal(result.data.comments.length, 1);
  });

  it('empty: 200 con comments:[] → { ok:true } (vacío NO es error)', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ comments: [] }),
    });
    const result = await fetchComments(BASE_URL, 'tid-1', fetchFn);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.comments, []);
  });

  it('404: → { ok:false, code:"not-found", status:404 } (discriminable de 5xx)', async () => {
    const fetchFn = makeFetch({ status: 404, ok: false });
    const result = await fetchComments(BASE_URL, 'tid-missing', fetchFn);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not-found');
    assert.equal(result.status, 404);
  });

  it('500: → { ok:false, code:"http", status:500 } (NO confundible con 404)', async () => {
    const fetchFn = makeFetch({ status: 500, ok: false });
    const result = await fetchComments(BASE_URL, 'tid-1', fetchFn);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'http');
    assert.equal(result.status, 500);
    assert.match(result.error, /500/);
  });

  it('ECONNREFUSED: fetchFn lanza → { ok:false, code:"network" }', async () => {
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    // @ts-ignore — fetchFn matches the shape we care about.
    const result = await fetchComments(BASE_URL, 'tid-1', fetchFn);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'network');
    assert.match(result.error, /ECONNREFUSED/);
  });

  it('JSON corrupto: json() lanza → { ok:false } (no propaga)', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    const result = await fetchComments(BASE_URL, 'tid-1', fetchFn);
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });

  it('bad shape: 200 sin comments array → { ok:false, error:"bad shape" }', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ notComments: 3 }),
    });
    const result = await fetchComments(BASE_URL, 'tid-1', fetchFn);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'bad shape');
  });

  it('encodeURIComponent: el task_id va encoded en el path (T-39-01)', async () => {
    let captured = '';
    const fetchFn = async (/** @type {string} */ url) => {
      captured = url;
      return { status: 200, ok: true, json: async () => ({ comments: [] }) };
    };
    // @ts-ignore — shape mínima.
    await fetchComments(BASE_URL, 'a/b c#1', fetchFn);
    assert.match(captured, /\/comments\/a%2Fb%20c%231$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 39 Plan 01 (TUI-16): fetchLogs — buffer crudo never-throws, sin discriminante
//   de status (no hay 404 semántico — /logs siempre existe). El grep es un paso
//   SEPARADO en select.js#grepLogs.
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchLogs: buffer crudo never-throws (D-07, TUI-16)', () => {
  it('ok: 200 con logs → { ok:true, data:{logs} }', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ logs: [{ ts: 't', level: 'info', msg: 'x' }] }),
    });
    const result = await fetchLogs(BASE_URL, fetchFn);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.logs));
    assert.equal(result.data.logs.length, 1);
  });

  it('bad shape: 200 sin logs array → { ok:false, error:"bad shape" }', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => ({ notLogs: true }),
    });
    const result = await fetchLogs(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'bad shape');
  });

  it('500: → { ok:false } con error que contiene "500"', async () => {
    const fetchFn = makeFetch({ status: 500, ok: false });
    const result = await fetchLogs(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.match(result.error, /500/);
  });

  it('network: fetchFn lanza → { ok:false } (no propaga)', async () => {
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    // @ts-ignore — shape mínima.
    const result = await fetchLogs(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.match(result.error, /ECONNREFUSED/);
  });

  it('JSON corrupto: json() lanza → { ok:false } (no propaga)', async () => {
    const fetchFn = makeFetch({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('boom');
      },
    });
    const result = await fetchLogs(BASE_URL, fetchFn);
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });
});
