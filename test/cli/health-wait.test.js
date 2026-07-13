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
import { readFileSync } from 'node:fs';
import { waitForHealth } from '../../src/cli/up.js';
import * as health from '../../src/session/health.js';

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

// HYG-03 (M18): el loop de health (startHealthLoop/stopHealthLoop/runHealthCheck +
// healthInterval module-level) era dead code — cero importadores. Se borró. Las
// funciones VIVAS que consume check.js (checkHealth/actOnHealth) siguen intactas.
// Verificación por IMPORT (no grep de fichero), para no colisionar con el `--url`
// VIVO del dashboard ni con menciones en comentarios.
describe('HYG-03 — src/session/health.js sin el loop de health muerto', () => {
  it('startHealthLoop/stopHealthLoop/runHealthCheck ya no se exportan', () => {
    assert.equal(typeof health.startHealthLoop, 'undefined');
    assert.equal(typeof health.stopHealthLoop, 'undefined');
    assert.equal(typeof health.runHealthCheck, 'undefined');
  });

  it('checkHealth/actOnHealth siguen exportadas (las usa check.js)', () => {
    assert.equal(typeof health.checkHealth, 'function');
    assert.equal(typeof health.actOnHealth, 'function');
  });
});

// HYG-02 (A9): el flag `kodo up --url` era código muerto (runUp resuelve baseUrl
// config-driven vía resolveBaseUrl, nunca leyó deps.url). Se borró. El `--url` de
// `kodo dashboard` es un flag VIVO (runDashboard lo consume) y NO se toca.
// Verificación estructural sobre el source del CLI, acotada a cada bloque de comando
// (importar cli.js ejecutaría program.parse() con los argv del test runner).
describe('HYG-02 — `kodo up` sin la option --url (dashboard la conserva)', () => {
  const source = readFileSync(new URL('../../src/cli.js', import.meta.url), 'utf-8');
  /** Extrae el bloque de un comando: desde `.command('<name>')` hasta el siguiente `.command(`. */
  const commandBlock = (name) => {
    const start = source.indexOf(`.command('${name}')`);
    assert.notEqual(start, -1, `bloque de comando '${name}' no encontrado`);
    const next = source.indexOf('.command(', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  };

  it('el bloque del comando `up` no declara la option --url', () => {
    assert.ok(!/--url/.test(commandBlock('up')), '`kodo up` no debe exponer --url (código muerto)');
  });

  it('el bloque del comando `up` invoca runUp() sin argumentos', () => {
    assert.ok(/runUp\(\)/.test(commandBlock('up')), 'runUp se invoca sin { url }');
    assert.ok(!/runUp\(\{/.test(commandBlock('up')), 'runUp no recibe objeto de deps con url');
  });

  it('el comando `dashboard` SÍ conserva la option --url (flag vivo)', () => {
    assert.ok(/--url/.test(commandBlock('dashboard')), '`kodo dashboard --url` es un flag vivo, no se toca');
  });
});

// HYG-02 (comportamiento): pasar `{ url: 'x' }` a runUp NO cambia el baseUrl
// resuelto — sigue siendo config-driven vía resolveBaseUrl (deps.url no se lee).
describe('HYG-02 — runUp ignora cualquier `url` en sus deps (baseUrl config-driven)', () => {
  it('un `url` inyectado en deps no llega al dashboard; se usa resolveBaseUrl', async () => {
    const { runUp } = await import('../../src/cli/up.js');
    const dashboardCalls = [];
    await runUp({
      _platform: 'darwin',
      _loadConfig: () => ({ server: { port: 9090 } }),
      _resolveBaseUrl: () => 'http://localhost:9090',
      _needsSetup: () => false,
      _statusDaemon: () => ({ status: 'running', pid: 42 }),
      _probePort: async () => true,
      _waitForHealth: async () => true,
      _runDashboard: async (d) => { dashboardCalls.push(d); },
      _stderr: { write: () => {} },
      // Propiedad ruido: si runUp leyera deps.url, el baseUrl cambiaría — no debe.
      url: 'http://malicioso:1',
    });
    assert.equal(dashboardCalls.length, 1);
    assert.deepEqual(dashboardCalls[0], { url: 'http://localhost:9090' });
  });
});
