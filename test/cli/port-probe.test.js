// @ts-check
//
// test/cli/port-probe.test.js — Plan 66-01 Task 1 (UP-03).
//
// Prueba `probePortInUse` de src/cli/up.js: la sonda node:net que distingue
// puerto-ocupado (connect ok o error != ECONNREFUSED → conservador true) de
// puerto-libre (ECONNREFUSED → false, timeout → false never-hang). Es la señal
// SECUNDARIA de idempotencia de `kodo up` (la PID-alive de statusDaemon es la
// primaria) — protege contra colisionar con un `kodo start` legacy (Pitfall 3).
//
// Las ramas puerto-ocupado (server real efímero) y puerto-libre (ECONNREFUSED
// real) usan el módulo net real; las ramas timeout y error-no-ECONNREFUSED se
// conducen por DI (deps._net) con un fake socket que nunca emite / emite el
// error inyectado — sin sockets reales ni esperas largas.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { probePortInUse } from '../../src/cli/up.js';

/** Abre un server efímero que escucha en un puerto libre; devuelve {port, close}. */
function listenEphemeral() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ port, close: () => new Promise((r) => server.close(() => r(undefined))) });
    });
  });
}

/** Fake net cuyo connect() devuelve un socket que jamás emite connect ni error. */
function makeSilentNet() {
  return {
    connect() {
      return {
        on() { return this; },
        destroy() {},
      };
    },
  };
}

/** Fake net cuyo connect() emite un 'error' con el code inyectado en el próximo tick. */
function makeErrorNet(code) {
  return {
    connect() {
      const handlers = {};
      const sock = {
        on(ev, fn) { handlers[ev] = fn; return sock; },
        destroy() {},
      };
      queueMicrotask(() => handlers.error?.(Object.assign(new Error(code), { code })));
      return sock;
    },
  };
}

describe('probePortInUse', () => {
  it('puerto con server escuchando → true (ocupado)', async () => {
    const { port, close } = await listenEphemeral();
    try {
      assert.equal(await probePortInUse(port), true);
    } finally {
      await close();
    }
  });

  it('puerto sin nadie escuchando → false (ECONNREFUSED = libre)', async () => {
    // Reserva y cierra un puerto para obtener uno casi seguro libre.
    const { port, close } = await listenEphemeral();
    await close();
    assert.equal(await probePortInUse(port), false);
  });

  it('rama timeout (socket nunca emite) → false (never-hang)', async () => {
    const t0 = Date.now();
    const res = await probePortInUse(9999, '127.0.0.1', 20, { _net: makeSilentNet() });
    assert.equal(res, false);
    assert.ok(Date.now() - t0 < 500, 'debe resolver por timeout, no colgar');
  });

  it('error != ECONNREFUSED (EHOSTUNREACH) → true (conservador)', async () => {
    const res = await probePortInUse(9999, '127.0.0.1', 500, { _net: makeErrorNet('EHOSTUNREACH') });
    assert.equal(res, true);
  });

  it('error ECONNREFUSED inyectado → false (libre)', async () => {
    const res = await probePortInUse(9999, '127.0.0.1', 500, { _net: makeErrorNet('ECONNREFUSED') });
    assert.equal(res, false);
  });
});
