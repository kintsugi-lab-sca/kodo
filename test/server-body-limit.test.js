// @ts-check
//
// test/server-body-limit.test.js — Phase 69 Plan 02, Task 2 (NET-03, D-06, Pitfall 4).
//
// readBody caps the request body at MAX_BODY_BYTES (1 MB). An oversized body is
// rejected with 413 BEFORE the webhook HMAC runs (an attacker cannot force megabytes
// of buffering behind auth). A body within the cap is preserved BYTE-IDENTICAL — the
// verifySignature HMAC (computed over the raw bytes) still matches after the refactor.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-body-0123456789abcdef';
const SECRET = 'webhook-secret-under-test';

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

function sign(rawBody) {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

describe('server body limit (NET-03, D-06)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let handle;
  /** @type {string} */ let base;
  let verifyCalls = 0;

  const spyProvider = {
    init: async () => {},
    listPendingTasks: async () => [],
    getTaskState: async () => null,
    verifySignature(rawBody, headers) {
      verifyCalls++;
      const sig = headers['x-plane-signature'];
      return typeof sig === 'string' && sig === sign(rawBody);
    },
    parseTriggerEvent: () => null, // ignored event → handler returns 200 { ok, ignored }
  };

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-body-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    saved = { HOME: process.env.HOME, KODO_API_TOKEN: process.env.KODO_API_TOKEN };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN;
    const port = await getFreePort();
    const config = {
      provider: 'plane',
      providers: { plane: { projects: [] } },
      server: { port, bind: '127.0.0.1' },
    };
    const mod = await import(`../src/server.js?body-${Date.now()}`);
    handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => config, _provider: spyProvider,
    });
    base = `http://127.0.0.1:${port}`;
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

  it('a >1 MB POST /webhook → 413, emitted BEFORE HMAC (verifySignature never runs)', async () => {
    const before = verifyCalls;
    const big = 'x'.repeat(2 * 1024 * 1024); // 2 MB
    const res = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-plane-signature': 'whatever' },
      body: big,
    });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'payload too large' });
    assert.equal(verifyCalls, before, 'verifySignature must NOT run for an oversized body (pre-HMAC 413)');
  });

  it('a ≤1 MB webhook body with a valid HMAC still verifies (byte-identical readBody)', async () => {
    const body = JSON.stringify({ event: 'noop', payload: { a: 1 } });
    const res = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-plane-signature': sign(body) },
      body,
    });
    assert.equal(res.status, 200, 'valid HMAC over a preserved body → handler runs');
    const json = await res.json();
    assert.equal(json.ok, true);
  });
});
