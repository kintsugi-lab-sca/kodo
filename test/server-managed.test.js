// @ts-check
//
// test/server-managed.test.js — Phase 65 Plan 02, Task 2 (UP-04).
//
// Covers the four gated points of startServer({ managed:true }) (D-03 + the 4th
// point surfaced by RESEARCH — the self-cleanup handlers):
//   (1) misconfig (no webhook secret) → throws { code:'KODO_SETUP_REQUIRED' }  (NOT process.exit)
//   (2) port collision → rejects { code:'EADDRINUSE' } via server.on('error')  (no uncaught throw)
//   (3) writes NO ~/.kodo/server.pid                                           (daemon owns kodo.pid)
//   (4) installs NO self SIGTERM/SIGINT handlers                               (run.js owns exit, D-05)
//   + returns { server, stopReconcile } so run.js can compose the teardown.
//
// TESTABILITY (load-bearing, why managed exists): the legacy path fails misconfig
// with process.exit(1) (server.js:407) — un-unit-testable because it kills the
// `node --test` runner (integration/exit-code only, see kodo-start-regression.test.js).
// Managed THROWS a discriminated error instead → assert.rejects makes it a unit test.
//
// DI seam (mirror config.js:233 isReportToProviderEnabled(_loadConfig)): we inject
// `_loadConfig` (a fake config, no ~/.kodo read) and `_provider` (a fake whose init()
// resolves offline) so the managed unit runs with NO network hit in provider.init()
// (server.js:367). HOME is still isolated so the "no server.pid" assertion is real.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** Minimal config the DI seam injects — provider plane, projects:[] (offline), port. */
function fakeConfig(port) {
  return {
    provider: 'plane',
    providers: { plane: { projects: [] } },
    server: { port, idle_threshold_min: 5, stuck_threshold_min: 30 },
  };
}

// Fake provider: init() resolves offline; getTaskState stubbed (never called in these tests).
const fakeProvider = { init: async () => {}, getTaskState: async () => null };

describe('startServer({ managed }) — UP-04', () => {
  /** @type {string} */ let tmpHome;
  /** @type {string | undefined} */ let prevHome;
  /** @type {Record<string, string | undefined>} */ let savedEnv;
  /** @type {any} */ let mod;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-managed-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    prevHome = process.env.HOME;
    process.env.HOME = tmpHome; // BEFORE importing server.js (PID_PATH is load-time)

    // Scrub any real webhook secret / dev bypass so the misconfig path fires.
    savedEnv = {
      KODO_DEV: process.env.KODO_DEV,
      PLANE_WEBHOOK_SECRET: process.env.PLANE_WEBHOOK_SECRET,
      KODO_WEBHOOK_SECRET_PLANE: process.env.KODO_WEBHOOK_SECRET_PLANE,
    };
    delete process.env.KODO_DEV;
    delete process.env.PLANE_WEBHOOK_SECRET;
    delete process.env.KODO_WEBHOOK_SECRET_PLANE;

    mod = await import(`../src/server.js?managed-${Date.now()}`);
  });

  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('(1) missing secret → throws KODO_SETUP_REQUIRED without process.exit', async () => {
    const port = await getFreePort();
    await assert.rejects(
      () => mod.startServer({
        managed: true, port,
        _loadConfig: () => fakeConfig(port), _provider: fakeProvider,
      }),
      (e) => /** @type {any} */ (e).code === 'KODO_SETUP_REQUIRED',
    );
  });

  it('(2) port already bound → rejects EADDRINUSE via server.on(error)', async () => {
    const port = await getFreePort();
    const blocker = createServer();
    // Bind on 127.0.0.1 to match server.listen(port, host) in server.js — since
    // Phase 69 (NET-01) the server binds to config.server.bind ?? '127.0.0.1' (the
    // fakeConfig omits bind → loopback). A loopback blocker collides deterministically
    // with the server's loopback bind (a 0.0.0.0 blocker would not clash on macOS).
    await new Promise((r) => blocker.listen(port, '127.0.0.1', () => r(undefined)));
    try {
      await assert.rejects(
        () => mod.startServer({
          managed: true, insecure: true, port,
          _loadConfig: () => fakeConfig(port), _provider: fakeProvider,
        }),
        (e) => /** @type {any} */ (e).code === 'EADDRINUSE',
      );
    } finally {
      await new Promise((r) => blocker.close(() => r(undefined)));
    }
  });

  it('(3+4) happy path → { server, stopReconcile }, no server.pid, no self signal handlers', async () => {
    const port = await getFreePort();
    const sigBefore = {
      SIGTERM: process.listeners('SIGTERM').length,
      SIGINT: process.listeners('SIGINT').length,
    };
    const handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => fakeConfig(port), _provider: fakeProvider,
    });
    try {
      assert.equal(typeof handle, 'object', 'managed returns an object handle');
      assert.ok(handle.server && typeof handle.server.close === 'function', 'handle.server has .close()');
      assert.equal(typeof handle.stopReconcile, 'function', 'handle.stopReconcile is a function');
      assert.equal(
        existsSync(join(tmpHome, '.kodo', 'server.pid')), false,
        'managed must NOT write server.pid',
      );
      assert.equal(process.listeners('SIGTERM').length, sigBefore.SIGTERM, 'no self SIGTERM handler installed');
      assert.equal(process.listeners('SIGINT').length, sigBefore.SIGINT, 'no self SIGINT handler installed');
    } finally {
      try { handle.stopReconcile(); } catch {}
      await new Promise((r) => handle.server.close(() => r(undefined)));
    }
  });
});
