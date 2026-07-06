// @ts-check
//
// test/server-malformed-request.test.js — Phase 69 code review fixes (CR-01).
//
// CR-01: a malformed request target (absolute-form with a bad authority, e.g.
// `GET http://[ HTTP/1.1`) made the unguarded `new URL(req.url, …)` throw
// synchronously inside the async handler → unhandled rejection → the whole
// long-lived daemon died, PRE-auth. The fix answers a neutral 400 and the server
// must stay alive for the next request. fetch/undici refuse to emit an invalid
// request target, so the malformed request goes out over a raw TCP socket.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-malformed-0123456789ab';

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

/** Send raw bytes over a TCP socket and collect the full response. */
function rawRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('raw request timeout')); });
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

const fakeProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
};

describe('server malformed request target (CR-01)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let handle;
  /** @type {number} */ let port;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-malformed-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    saved = { HOME: process.env.HOME, KODO_API_TOKEN: process.env.KODO_API_TOKEN };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN;
    port = await getFreePort();
    const config = {
      provider: 'plane',
      providers: { plane: { projects: [] } },
      server: { port, bind: '127.0.0.1' },
    };
    const mod = await import(`../src/server.js?malformed-${Date.now()}`);
    handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => config, _provider: fakeProvider,
    });
  });

  after(async () => {
    try { handle?.stopReconcile(); } catch {}
    if (handle?.server) await new Promise((r) => handle.server.close(() => r(undefined)));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a request target that WHATWG-URL rejects → neutral 400, daemon survives', async () => {
    const response = await rawRequest(
      port,
      'GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
    );
    assert.match(response, /^HTTP\/1\.1 400 /, 'malformed target must answer 400, not crash');
    assert.match(response, /\{"error":"bad request"\}/, 'neutral body, no err detail');

    // The daemon must still be alive and serving after the malformed request.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200, 'server must survive the malformed request');
    const body = await health.json();
    assert.equal(body.status, 'ok');
  });
});
