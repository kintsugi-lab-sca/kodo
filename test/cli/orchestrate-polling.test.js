// @ts-check
//
// test/cli/orchestrate-polling.test.js — Phase 26 Plan 03 (CFG-04 / D-16..19).
//
// Cobertura ≥4 casos:
//   1. `kodo orchestrate --polling` sin `providers.github.repos` → exit 2 (integration spawnSync).
//   2. `kodo orchestrate --polling` sin `GITHUB_TOKEN` set → exit 2 (integration spawnSync).
//   3. SIGINT cleanup: `kodo orchestrate --polling` exit 0 limpio tras SIGINT (integration spawn).
//   4. `runOrchestratePollingSetup` invoca `startPolling` con args correctos (DI spy in-process —
//      B-3 LOCKED, NO integration NDJSON variant).
//   5. `kodo orchestrate --help` cita el mutex implícito D-17 (regex en stdout).
//
// Patrón mirror test/cli/polling.test.js (Plan 26-02 makeFixture + runCli) +
// test/skill-sync.test.js:69-79 (spawn child con timeout) + RESEARCH §Code Example 4.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

// ─── Fixture helpers (HOME-isolated) ─────────────────────────────────────────

/**
 * Siembra `~/.kodo/config.json` con `providers.github` y opcionalmente `~/.kodo/.env`.
 *
 * @param {{ repos?: Array<{owner: string, repo: string}>, hasToken?: boolean }} [opts]
 * @returns {string} tmpHome path (caller debe rmSync(recursive,force) en afterEach).
 */
function makeFixture(opts = {}) {
  const repos = opts.repos ?? [{ owner: 'foo', repo: 'bar' }];
  const hasToken = opts.hasToken !== false;
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-orch-poll-home-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  writeFileSync(
    join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify({
      provider: 'github',
      providers: {
        github: {
          api_key_env: 'GITHUB_TOKEN',
          repos,
          poll_interval: 60,
        },
      },
    }, null, 2),
    'utf-8',
  );
  if (hasToken) {
    writeFileSync(join(tmpHome, '.kodo', '.env'), 'GITHUB_TOKEN=fake_token_for_test\n', 'utf-8');
  }
  return tmpHome;
}

/**
 * Invoca `bin/kodo orchestrate [args]` via spawnSync con HOME aislado + GITHUB_TOKEN scrubbed.
 *
 * @param {{ tmpHome: string, args?: string[], scrubToken?: boolean, timeoutMs?: number }} opts
 */
function runOrchestrateSync({ tmpHome, args = [], scrubToken = false, timeoutMs = 5000 }) {
  /** @type {Record<string, string>} */
  const env = {
    ...process.env,
    HOME: tmpHome,
    NO_COLOR: '1',
  };
  if (scrubToken) {
    // El parent puede tener GITHUB_TOKEN set (CI o dev shell). Scrub explícitamente
    // para que el gate de token del helper solo dependa del .env del fixture.
    env.GITHUB_TOKEN = '';
  }
  return spawnSync(
    process.execPath,
    [KODO_BIN, 'orchestrate', ...args],
    {
      env,
      encoding: 'utf-8',
      timeout: timeoutMs,
    },
  );
}

// ─── Casos 1-2: validation gates D-14 exit 2 ─────────────────────────────────

describe('kodo orchestrate --polling — validation gates (CFG-04)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('CFG-04 caso 1: sin repos → exit 2 + stderr canonical', () => {
    _tmpHome = makeFixture({ repos: [] });
    const result = runOrchestrateSync({ tmpHome: _tmpHome, args: ['--polling'] });
    assert.equal(result.status, 2, `expected exit 2, got ${result.status}; stderr: ${result.stderr}`);
    assert.match(result.stderr, /providers\.github\.repos is empty/);
  });

  it('CFG-04 caso 2: sin GITHUB_TOKEN → exit 2 + stderr canonical', () => {
    _tmpHome = makeFixture({ hasToken: false });
    const result = runOrchestrateSync({
      tmpHome: _tmpHome,
      args: ['--polling'],
      scrubToken: true,
    });
    assert.equal(result.status, 2, `expected exit 2, got ${result.status}; stderr: ${result.stderr}`);
    assert.match(result.stderr, /GITHUB_TOKEN not set/);
  });
});

// ─── Caso 3: SIGINT cleanup (D-18 / T-26-04) ─────────────────────────────────

describe('kodo orchestrate --polling — SIGINT cleanup (D-18)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('CFG-04 caso 3: SIGINT → exit 0 (no timer huérfano, no hang)', async () => {
    _tmpHome = makeFixture();
    const child = spawn(
      process.execPath,
      [KODO_BIN, 'orchestrate', '--polling'],
      {
        env: {
          ...process.env,
          HOME: _tmpHome,
          NO_COLOR: '1',
          // GITHUB_TOKEN viene del fixture .env via loadEnvFile.
        },
        stdio: 'pipe',
      },
    );

    // Espera 500ms para dar tiempo a montar el polling timer + SIGINT handler.
    await sleep(500);
    if (typeof child.pid === 'number') {
      process.kill(child.pid, 'SIGINT');
    }

    // Bound el exit con Promise.race contra timeout 3s para evitar hang del test.
    const exitCode = await Promise.race([
      new Promise((resolve) => child.on('exit', (code) => resolve(code))),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('SIGINT cleanup hang > 3s')), 3000)),
    ]);

    assert.equal(exitCode, 0, `SIGINT should exit 0 (got ${exitCode})`);
  });
});

// ─── Caso 4: DI spy in-process (B-3 LOCKED) ──────────────────────────────────

describe('runOrchestratePollingSetup — DI spy in-process (B-3 LOCKED)', () => {
  it('CFG-04 caso 4: invokes startPolling with correct args (provider, repos, intervalSec)', async () => {
    // Import dinámico: en RED este import falla (módulo no existe aún).
    const { runOrchestratePollingSetup } = await import('../../src/cli/orchestrate.js');

    let callCount = 0;
    /** @type {any} */
    let capturedArgs = null;
    /** @type {(args: any) => { stop: () => void }} */
    const startPollingFn = (args) => {
      callCount++;
      capturedArgs = args;
      return { stop: () => {} };
    };
    const configLoader = () => ({
      providers: {
        github: {
          api_key_env: 'GITHUB_TOKEN',
          repos: [{ owner: 'foo', repo: 'bar' }],
          poll_interval: 60,
        },
      },
    });
    const getProviderApiKeyFn = () => 'fake-token';
    const initRegistryFn = async () => {};
    const getProviderFn = (name) => ({ name, init: async () => {} });

    const handle = await runOrchestratePollingSetup(
      { polling: true },
      { startPollingFn, configLoader, getProviderApiKeyFn, initRegistryFn, getProviderFn },
    );

    assert.equal(callCount, 1, 'startPollingFn should be called exactly once');
    assert.ok(capturedArgs, 'capturedArgs must be set');
    assert.equal(capturedArgs.repos.length, 1);
    assert.deepEqual(capturedArgs.repos[0], { owner: 'foo', repo: 'bar' });
    assert.equal(capturedArgs.intervalSec, 60);
    assert.ok(capturedArgs.provider, 'provider must be passed in args');
    assert.equal(capturedArgs.provider.name, 'github');
    assert.ok(handle && typeof handle.stop === 'function', 'returned handle has stop()');
  });

  it('CFG-04 caso 4b: opts.polling=false → returns null (zero breaking change D-19)', async () => {
    const { runOrchestratePollingSetup } = await import('../../src/cli/orchestrate.js');
    let callCount = 0;
    const startPollingFn = () => { callCount++; return { stop: () => {} }; };
    const result = await runOrchestratePollingSetup(
      { polling: false },
      { startPollingFn, configLoader: () => ({}), getProviderApiKeyFn: () => 't', initRegistryFn: async () => {}, getProviderFn: () => ({}) },
    );
    assert.equal(result, null);
    assert.equal(callCount, 0, 'startPollingFn must NOT be called when polling=false');
  });

  it('CFG-04 caso 4c: helper throws con exitCode=2 cuando repos vacío', async () => {
    const { runOrchestratePollingSetup } = await import('../../src/cli/orchestrate.js');
    const configLoader = () => ({ providers: { github: { repos: [] } } });
    await assert.rejects(
      () => runOrchestratePollingSetup(
        { polling: true },
        { startPollingFn: () => ({ stop: () => {} }), configLoader, getProviderApiKeyFn: () => 't', initRegistryFn: async () => {}, getProviderFn: () => ({}) },
      ),
      (err) => {
        assert.match(err.message, /providers\.github\.repos is empty/);
        assert.equal(/** @type {any} */ (err).exitCode, 2);
        return true;
      },
    );
  });

  it('CFG-04 caso 4d: helper throws con exitCode=2 cuando token no set', async () => {
    const { runOrchestratePollingSetup } = await import('../../src/cli/orchestrate.js');
    const configLoader = () => ({ providers: { github: { repos: [{ owner: 'foo', repo: 'bar' }] } } });
    await assert.rejects(
      () => runOrchestratePollingSetup(
        { polling: true },
        { startPollingFn: () => ({ stop: () => {} }), configLoader, getProviderApiKeyFn: () => undefined, initRegistryFn: async () => {}, getProviderFn: () => ({}) },
      ),
      (err) => {
        assert.match(err.message, /GITHUB_TOKEN not set/);
        assert.equal(/** @type {any} */ (err).exitCode, 2);
        return true;
      },
    );
  });
});

// ─── Caso 5: --help mutex doc (D-17) ─────────────────────────────────────────

describe('kodo orchestrate --help — mutex implícito doc (D-17)', () => {
  it('CFG-04 caso 5: --help cita "mutex implícito" o "lock per-repo"', () => {
    const result = spawnSync(
      process.execPath,
      [KODO_BIN, 'orchestrate', '--help'],
      { encoding: 'utf-8', timeout: 5000 },
    );
    assert.equal(result.status, 0, `--help should exit 0; stderr: ${result.stderr}`);
    assert.match(result.stdout, /--polling/, '--help must list --polling flag');
    assert.match(
      result.stdout,
      /mutex implícito|lock per-repo/,
      `--help must cite mutex/lock per-repo; got stdout:\n${result.stdout}`,
    );
  });
});
