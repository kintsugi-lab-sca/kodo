// @ts-check
//
// test/cli/health-wait.test.js — Plan 66-01 Task 2 (UP-01).
//
// Prueba `waitForHealth` de src/cli/up.js: el readiness gate never-throws sobre
// `GET {baseUrl}/health`. Espeja el never-throws de fetchStatus (client.js:49-60):
// reintenta ante ECONNREFUSED durante el boot, resuelve true al primer 200, y es
// BOUNDED por timeout (resuelve false sin colgar aunque /health falle siempre).
//
// TODO se conduce por DI (deps._fetch/_now/_sleep) con clock monotónico + sleep
// no-op → sin esperas reales ni red.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForHealth } from '../../src/cli/up.js';

/** now() monotónico que avanza `step` ms por llamada — dispara el deadline. */
function makeClock(step = 5000) {
  let t = 0;
  return () => { const v = t; t += step; return v; };
}

describe('waitForHealth', () => {
  it('200 en la 1ª llamada → true inmediato', async () => {
    let calls = 0;
    const res = await waitForHealth('http://x', {}, {
      _fetch: async () => { calls += 1; return { ok: true }; },
      _now: makeClock(),
      _sleep: async () => {},
    });
    assert.equal(res, true);
    assert.equal(calls, 1);
  });

  it('ECONNREFUSED ×2 y luego 200 → reintenta, never-throws, true', async () => {
    let calls = 0;
    const res = await waitForHealth('http://x', {}, {
      _fetch: async () => {
        calls += 1;
        if (calls <= 2) throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
        return { ok: true };
      },
      // clock que no avanza hasta el deadline (10000) en 3 lecturas.
      _now: makeClock(100),
      _sleep: async () => {},
    });
    assert.equal(res, true);
    assert.equal(calls, 3);
  });

  it('fetch lanza siempre hasta el deadline → false (bounded, no cuelga)', async () => {
    const res = await waitForHealth('http://x', { timeoutMs: 10000 }, {
      _fetch: async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); },
      _now: makeClock(5000), // 0, 5000, 10000 → corta al 3er check
      _sleep: async () => {},
    });
    assert.equal(res, false);
  });

  it('HTTP no-200 repetido hasta el deadline → false', async () => {
    let calls = 0;
    const res = await waitForHealth('http://x', { timeoutMs: 10000 }, {
      _fetch: async () => { calls += 1; return { ok: false, status: 503 }; },
      _now: makeClock(5000),
      _sleep: async () => {},
    });
    assert.equal(res, false);
    assert.ok(calls >= 1);
  });
});
