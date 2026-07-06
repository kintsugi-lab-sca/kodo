// @ts-check
//
// test/server-bind.test.js — Phase 69 Plan 02, Task 2 (NET-01, T-69-01).
//
// The server must bind to loopback by default and honor config.server.bind as an
// explicit opt-in to expose on another interface. We assert the RESOLVED bind host
// directly via server.address().address after a real listen on an ephemeral port.

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
});
