// @ts-check
//
// test/cli/kodo-start-regression.test.js — Phase 65 Plan 02, Task 1.
//
// UP-06 golden regression net: lock the LEGACY `kodo start` behavior BEFORE the
// managed refactor (Task 2). These three assertions MUST be green against the
// current (pre-refactor) server.js AND stay green after startServer({managed})
// lands — that is the load-bearing zero-regression guarantee of this plan.
//
// Legacy contract (managed:false, the default):
//   (1) writes ~/.kodo/server.pid                (in-process startServer)
//   (2) exits with code 1 when no webhook secret (spawnSync bin/kodo start)
//   (3) never writes ~/.kodo/kodo.pid            (daemon PID isolation)
//
// HOME isolation: config.js computes KODO_DIR = join(homedir(), '.kodo') at module
// load (obs 21811 — the isolation leak). We set process.env.HOME to a tmp dir
// BEFORE the first dynamic import of server.js and never import it statically. The
// spawnSync case passes HOME via env so it runs in a fully isolated child process.
//
// Mirror: test/cli/polling.test.js:12-27 (spawnSync HOME-isolated + NO_COLOR) and
// test/stop.test.js:8-13 (dynamic import AFTER fixing HOME).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

// Minimal valid config: provider plane with projects:[] so provider.init() stays
// OFFLINE (empty projects → no Plane API calls; see src/providers/plane/provider.js
// :114-160 — every loop iterates over config.projects, which is empty).
const MINIMAL_CONFIG = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'http://127.0.0.1:1',
      web_url: 'http://127.0.0.1:1',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'test',
      projects: [],
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
    },
  },
  server: { port: 0, idle_threshold_min: 5, stuck_threshold_min: 30 },
};

function writeConfig(home) {
  mkdirSync(join(home, '.kodo'), { recursive: true });
  writeFileSync(join(home, '.kodo', 'config.json'), JSON.stringify(MINIMAL_CONFIG, null, 2));
}

/** The provider API key env var this fixture's config points at. */
const API_KEY_ENV = MINIMAL_CONFIG.providers.plane.api_key_env;
/** Synthetic key: `projects: []` keeps provider.init() OFFLINE, so it never hits the wire. */
const FAKE_API_KEY = 'kodo-test-plane-api-key';

/**
 * Build an env with any webhook-secret / dev bypass scrubbed so the fail-fast fires,
 * and with the provider API key INJECTED.
 *
 * KODO-57: startServer resolves the provider (src/server.js:315) and PlaneClient's
 * constructor throws `Plane API key not found` when PLANE_API_KEY is absent from the
 * child env. The key used to arrive by inheritance from the operator's ~/.kodo/.env —
 * on any clean machine (CI, Linux container) this test died for a reason unrelated to
 * what it measures. Injecting it also stops the test from using the operator's REAL key.
 */
function scrubbedEnv(extra = {}) {
  const env = { ...process.env };
  delete env.KODO_DEV;
  delete env.PLANE_WEBHOOK_SECRET;
  for (const k of Object.keys(env)) {
    if (k.startsWith('KODO_WEBHOOK_SECRET_')) delete env[k];
  }
  env[API_KEY_ENV] = FAKE_API_KEY;
  return { ...env, ...extra };
}

/** Reserve a free ephemeral port, then release it for the server to bind. */
function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

/** Poll `pred` until truthy or timeout. */
function waitFor(pred, timeoutMs) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = pred(); } catch {}
      if (ok) { clearInterval(iv); res(undefined); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); rej(new Error('waitFor timeout')); }
    }, 20);
    if (iv && typeof iv.unref === 'function') iv.unref();
  });
}

describe('kodo start regression (UP-06 golden)', () => {
  // In-process legacy start: proves (1) server.pid present and (3) kodo.pid absent.
  describe('legacy in-process start', () => {
    /** @type {string} */ let tmpHome;
    /** @type {string | undefined} */ let prevHome;
    /** @type {string | undefined} */ let prevApiKey;
    /** @type {any} */ let server;
    /** @type {{ SIGTERM: Function[], SIGINT: Function[] }} */ let sigBefore;

    before(async () => {
      tmpHome = mkdtempSync(join(tmpdir(), 'kodo-start-reg-'));
      writeConfig(tmpHome);
      prevHome = process.env.HOME;
      process.env.HOME = tmpHome; // BEFORE the first server.js import (KODO_DIR is load-time)
      // KODO-57: same reason as scrubbedEnv, but for the IN-PROCESS start — getPlaneApiKey
      // reads process.env at call time (src/config.js:528), so setting it here (before the
      // dynamic import) is enough and never touches the operator's real key.
      prevApiKey = process.env[API_KEY_ENV];
      process.env[API_KEY_ENV] = FAKE_API_KEY;

      // Snapshot signal listeners so we can strip whatever the legacy path installs
      // on `process` (server.js:612-618) and leave the runner clean.
      sigBefore = {
        SIGTERM: process.listeners('SIGTERM').slice(),
        SIGINT: process.listeners('SIGINT').slice(),
      };

      const port = await getFreePort();
      const mod = await import(`../../src/server.js?start-reg-${Date.now()}`);
      server = await mod.startServer({ insecure: true, port });

      // writeFileSync(server.pid) runs inside the listen callback (server.js:581).
      await waitFor(() => existsSync(join(tmpHome, '.kodo', 'server.pid')), 3000);
    });

    after(() => {
      try { server?.close(); } catch {}
      // Strip the SIGTERM/SIGINT handlers the legacy path installed on `process`.
      for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT'])) {
        for (const l of process.listeners(sig)) {
          if (!sigBefore[sig].includes(l)) process.removeListener(sig, /** @type {any} */ (l));
        }
      }
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevApiKey === undefined) delete process.env[API_KEY_ENV];
      else process.env[API_KEY_ENV] = prevApiKey;
      if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
    });

    it('(1) writes ~/.kodo/server.pid — legacy self-PID intact', () => {
      assert.equal(existsSync(join(tmpHome, '.kodo', 'server.pid')), true, 'server.pid must be present');
    });

    it('(3) never writes ~/.kodo/kodo.pid — daemon PID isolation', () => {
      assert.equal(existsSync(join(tmpHome, '.kodo', 'kodo.pid')), false, 'legacy path must never write kodo.pid');
    });
  });

  // Out-of-process legacy start: proves (2) fail-fast exit 1 on missing secret.
  it('(2) exits with code 1 when no webhook secret — fail-fast legacy intact', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-start-exit-'));
    try {
      writeConfig(tmpHome);
      const res = spawnSync(process.execPath, [KODO_BIN, 'start'], {
        env: scrubbedEnv({ HOME: tmpHome, NO_COLOR: '1' }),
        encoding: 'utf-8',
        timeout: 15000,
      });
      assert.equal(
        res.status,
        1,
        `expected exit 1 (fail-fast), got ${res.status}. stderr: ${res.stderr}`,
      );
      // KODO-57: assert the REASON, not just the code. Before the API key injection an
      // absent ~/.kodo/.env made the provider constructor blow up first — same exit 1,
      // wrong cause. Pinning the message keeps this a webhook-secret test.
      assert.match(res.stderr, /Missing webhook secret/, `stderr: ${res.stderr}`);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
