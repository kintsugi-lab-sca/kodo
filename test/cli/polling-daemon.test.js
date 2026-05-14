// @ts-check
//
// test/cli/polling-daemon.test.js — Plan 26-02 Wave 0 unit tests para src/cli/polling-daemon.js.
//
// Cubre:
//   1. writePidFile atomic (tmp+rename) + chmod 0o600 (Security V14 / T-26-02).
//   2. readPidFile fail-open ante JSON corrupto (Pitfall #5 mirror loadStateCache).
//   3. readPidFile defensive shape check (PID injection mitigation T-26-02).
//
// Patrón mirror test/skill-sync.test.js:93-130 (afterEach + mkdtempSync + statSync).
// El módulo importa KODO_DIR de src/config.js (Pitfall #11) — para test HOME-isolation,
// usamos dynamic import después de setear process.env.HOME.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('polling-daemon: writePidFile / readPidFile / removePidFile', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  /** @type {string | undefined} */
  let _prevHome;

  afterEach(() => {
    if (_prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = _prevHome;
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
    _prevHome = undefined;
  });

  it('writePidFile escribe atomic con chmod 0o600 + tmp file ausente post-rename', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-write-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?write-test-${Date.now()}`);
    mod.writePidFile({
      pid: 42,
      started_at: '2026-05-14T19:00:00.000Z',
      repos: ['a/b'],
    });
    const pidPath = mod.PID_PATH;
    assert.equal(existsSync(pidPath), true, 'PID file debe existir');
    const mode = statSync(pidPath).mode & 0o777;
    assert.equal(mode, 0o600, `mode esperado 0o600, got 0o${mode.toString(8)}`);
    assert.equal(existsSync(pidPath + '.tmp'), false, 'tmp file debe estar ausente post-rename');
    const parsed = JSON.parse(readFileSync(pidPath, 'utf-8'));
    assert.equal(parsed.pid, 42);
    assert.equal(parsed.started_at, '2026-05-14T19:00:00.000Z');
    assert.deepEqual(parsed.repos, ['a/b']);
  });

  it('readPidFile fail-open: JSON corrupto → null (NO throw)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-corrupt-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?corrupt-test-${Date.now()}`);
    writeFileSync(mod.PID_PATH, 'not valid json {{{\n', 'utf-8');
    const result = mod.readPidFile();
    assert.equal(result, null, 'JSON corrupto → null');
  });

  it('readPidFile defensive shape check: pid no-number → null (Security V14 PID injection)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-shape-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?shape-test-${Date.now()}`);
    writeFileSync(
      mod.PID_PATH,
      JSON.stringify({ pid: 'malicious; rm -rf', started_at: 'x', repos: [] }) + '\n',
      'utf-8',
    );
    const result = mod.readPidFile();
    assert.equal(result, null, 'pid no-number → null');
  });

  it('readPidFile ausente: existsSync false → null (no throw)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-absent-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?absent-test-${Date.now()}`);
    assert.equal(mod.readPidFile(), null);
  });

  it('removePidFile idempotente: PID ausente → no throw', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-remove-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?remove-test-${Date.now()}`);
    mod.removePidFile();
    mod.writePidFile({ pid: 1, started_at: 'now', repos: [] });
    assert.equal(existsSync(mod.PID_PATH), true);
    mod.removePidFile();
    assert.equal(existsSync(mod.PID_PATH), false);
    mod.removePidFile();
  });
});
