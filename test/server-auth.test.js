// @ts-check
//
// test/server-auth.test.js — Phase 69 Plan 02, Task 1 + Task 3 (NET-02, D-04/D-05).
//
// Integration test over a REAL ephemeral-port managed server (mirror of the harness
// in server-managed.test.js: DI seam `_loadConfig`/`_provider`, HOME isolation,
// getFreePort, dynamic-import-with-cachebust). Drives real `fetch` against
// http://127.0.0.1:<port> and asserts the default-deny bearer guard:
//   - the API rail (/status, /logs, /comments, DELETE /sessions) requires a bearer;
//   - the two HTML routes (`/`, `/dashboard`) accept a ?token= query param ONLY;
//   - /health stays open, /webhook keeps its own HMAC (never bearer-gated);
//   - 401 bodies are neutral {error:'unauthorized'} and never leak the HTML shell.
//
// A known KODO_API_TOKEN is seeded in env BEFORE importing server.js so the startup
// getOrCreateApiToken() returns a deterministic value (no CSPRNG, no .env write).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-deadbeef-0123456789abcdef';

/** Free ephemeral port (reserve then release). */
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

/** Minimal config the DI seam injects — provider plane, offline, bound loopback. */
function fakeConfig(port) {
  return {
    provider: 'plane',
    providers: { plane: { projects: [] } },
    server: { port, bind: '127.0.0.1', idle_threshold_min: 5, stuck_threshold_min: 30 },
  };
}

// Fake provider: fully offline. verifySignature:false so a bad-signature webhook
// resolves via the HMAC lane (401 'Invalid signature'), distinct from the bearer
// 401 'unauthorized' — that distinction is what proves /webhook is NOT bearer-gated.
const fakeProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
  verifySignature: () => false,
  parseTriggerEvent: () => null,
};

describe('server bearer guard (NET-02, D-04/D-05)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let handle;
  /** @type {string} */ let base;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-auth-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    saved = {
      HOME: process.env.HOME,
      KODO_API_TOKEN: process.env.KODO_API_TOKEN,
      KODO_DEV: process.env.KODO_DEV,
      PLANE_WEBHOOK_SECRET: process.env.PLANE_WEBHOOK_SECRET,
      KODO_WEBHOOK_SECRET_PLANE: process.env.KODO_WEBHOOK_SECRET_PLANE,
    };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN; // deterministic bearer, no CSPRNG/.env write
    delete process.env.KODO_DEV;
    delete process.env.PLANE_WEBHOOK_SECRET;
    delete process.env.KODO_WEBHOOK_SECRET_PLANE;

    const port = await getFreePort();
    const mod = await import(`../src/server.js?auth-${Date.now()}`);
    handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => fakeConfig(port), _provider: fakeProvider,
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

  it('GET /status without an Authorization header → 401 neutral body', async () => {
    const res = await fetch(`${base}/status`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /status with a wrong bearer → 401', async () => {
    const res = await fetch(`${base}/status`, { headers: { Authorization: 'Bearer nope' } });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /status with the correct bearer → 200 with the status shape', async () => {
    const res = await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions), 'sessions array present');
  });

  it('DELETE /sessions/:id without a bearer → 401 (never reaches the dismiss handler)', async () => {
    const res = await fetch(`${base}/sessions/abc`, { method: 'DELETE' });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /health → 200 with NO Authorization header (open route)', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('POST /webhook is NOT bearer-gated — a no-auth request reaches HMAC (not the bearer 401)', async () => {
    const res = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const body = await res.json();
    // Reached the webhook HMAC lane: bad/missing signature → 'Invalid signature',
    // NEVER the default-deny bearer body 'unauthorized'. This is what proves the
    // request crossed the guard into the webhook branch (open route).
    assert.notDeepEqual(body, { error: 'unauthorized' });
    assert.deepEqual(body, { error: 'Invalid signature' });
  });

  it('GET /?token=<correct> → 200 text/html (the dashboard shell)', async () => {
    const res = await fetch(`${base}/?token=${TOKEN}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /<!DOCTYPE html>/);
  });

  it('GET / with no token → 401 neutral body and NO HTML shell leaked', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.doesNotMatch(text, /<!DOCTYPE html>/);
    assert.deepEqual(JSON.parse(text), { error: 'unauthorized' });
  });

  it('GET / with a wrong ?token= → 401 and NO HTML shell', async () => {
    const res = await fetch(`${base}/?token=wrong`);
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.doesNotMatch(text, /<!DOCTYPE html>/);
  });

  it('GET /status?token=<correct> (query, not header) → still 401 — query tokens are HTML-route only', async () => {
    const res = await fetch(`${base}/status?token=${TOKEN}`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });
});
