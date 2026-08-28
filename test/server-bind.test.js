// @ts-check
//
// test/server-bind.test.js — Phase 69 Plan 02, Task 2 (NET-01, T-69-01).
//
// The server must bind to loopback by default and honor config.server.bind as an
// explicit opt-in to expose on another interface. We assert the RESOLVED bind host
// directly via server.address().address after a real listen on an ephemeral port.
//
// KODO-45 añade la contraparte visible de ese opt-in: arrancar con un bind wildcard
// (`0.0.0.0` / `::`) emite un `console.warn` en los logs de arranque. Se comprueba
// contra el ring buffer que el propio módulo expone (`getLogBuffer`), que es donde
// aterriza todo lo que pasa por el console parcheado del server.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-bind-0123456789abcdef';

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

const fakeProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
};

describe('server bind host (NET-01, T-69-01)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let mod;
  /** @type {any[]} */ const openHandles = [];

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-bind-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    saved = { HOME: process.env.HOME, KODO_API_TOKEN: process.env.KODO_API_TOKEN };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN;
    mod = await import(`../src/server.js?bind-${Date.now()}`);
  });

  after(async () => {
    for (const h of openHandles) {
      try { h.stopReconcile(); } catch {}
      if (h.server) await new Promise((r) => h.server.close(() => r(undefined)));
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  /** Start a managed server with the given config.server override. */
  async function start(serverCfg) {
    const port = await getFreePort();
    const config = {
      provider: 'plane',
      providers: { plane: { projects: [] } },
      server: { port, ...serverCfg },
    };
    const handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => config, _provider: fakeProvider,
    });
    openHandles.push(handle);
    return handle;
  }

  it('binds to 127.0.0.1 by default when config.server.bind is absent', async () => {
    const handle = await start({ /* no bind */ });
    assert.equal(handle.server.address().address, '127.0.0.1');
  });

  it('binds to the configured host when config.server.bind is set', async () => {
    const handle = await start({ bind: '0.0.0.0' });
    assert.equal(handle.server.address().address, '0.0.0.0');
  });

  // WR-04 (code review fix): `listen(port, '')` binds ALL interfaces (0.0.0.0) —
  // an empty-string bind (easy config typo) must resolve to loopback, not slip
  // through the `??` fallback and silently defeat NET-01.
  it('binds to 127.0.0.1 when config.server.bind is an empty string', async () => {
    const handle = await start({ bind: '' });
    assert.equal(handle.server.address().address, '127.0.0.1');
  });

  it('binds to 127.0.0.1 when config.server.bind is whitespace-only', async () => {
    const handle = await start({ bind: '   ' });
    assert.equal(handle.server.address().address, '127.0.0.1');
  });

  // --- KODO-45: aviso visible al arrancar con un bind wildcard ---

  /** Avisos de bind acumulados en el ring buffer del server (`console.warn` parcheado). */
  function bindWarnings() {
    return mod.getLogBuffer().filter((l) => l.level === 'warn' && l.msg.includes('server.bind='));
  }

  it('no avisa nada cuando el bind es loopback (el default seguro no molesta)', async () => {
    const before = bindWarnings().length;
    await start({ bind: '127.0.0.1' });
    assert.equal(bindWarnings().length, before, 'un bind cerrado no debe emitir aviso');
  });

  it('avisa por console.warn al arrancar con bind 0.0.0.0', async () => {
    const before = bindWarnings().length;
    await start({ bind: '0.0.0.0' });
    const emitted = bindWarnings();
    assert.equal(emitted.length, before + 1, 'un bind wildcard emite exactamente un aviso');
    const msg = emitted[0].msg; // getLogBuffer devuelve el más reciente primero
    assert.match(msg, /0\.0\.0\.0/, 'el aviso nombra el bind concreto');
    assert.match(msg, /TODAS las interfaces/, 'el aviso dice qué implica');
    assert.match(msg, /ACL|firewall/, 'el aviso dice qué hacer al respecto');
  });

  it('wildcardBindWarning es puro: solo los wildcards producen texto', () => {
    assert.equal(mod.wildcardBindWarning('127.0.0.1'), null);
    assert.equal(mod.wildcardBindWarning('::1'), null, 'el loopback IPv6 no es un wildcard');
    assert.equal(mod.wildcardBindWarning('100.64.1.2'), null, 'una IP concreta de Tailscale tampoco');
    assert.match(String(mod.wildcardBindWarning('0.0.0.0')), /0\.0\.0\.0/);
    assert.match(String(mod.wildcardBindWarning('::')), /TODAS las interfaces/);
  });
});
