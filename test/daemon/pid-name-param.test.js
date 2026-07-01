// @ts-check
//
// test/daemon/pid-name-param.test.js — Plan 65-01 Task 1.
//
// Prueba la generalización aditiva del módulo PID `src/cli/polling-daemon.js`:
// cada primitiva acepta un parámetro TRAILING opcional `name` (default 'polling').
// El daemon kodo usará `'kodo'` → ~/.kodo/kodo.pid, distinto de server.pid y
// polling.pid (D-04 back-compat).
//
// Cubre:
//   1. getPidPath('kodo') === ~/.kodo/kodo.pid ; getPidPath() === ~/.kodo/polling.pid
//   2. writePidFile(payload, 'kodo') atomic + chmod 0o600 + tmp ausente post-rename
//   3. readPidFile('kodo') sobre payload {pid, started_at, kind:'daemon'} (sin repos)
//      pasa el shape-check; pid no-number → null
//   4. removePidFile('kodo') idempotente (no throw si el archivo no existe)
//   5. Path distinction (kodo.pid ≠ polling.pid) es testeable sin tocar HOME
//
// Patrón mirror test/cli/polling-daemon.test.js (mkdtempSync + process.env.HOME +
// dynamic import cachebust DESPUÉS de setear HOME + statSync mode & 0o777).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, statSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

describe('polling-daemon: name param (default polling, additive)', () => {
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

  it('getPidPath(name) resuelve <name>.pid; default sigue siendo polling.pid (back-compat)', async () => {
    // Path distinction es una función pura de homedir() + name — testeable sin tocar HOME.
    const mod = await import(`../../src/cli/polling-daemon.js?name-path-${Date.now()}`);
    assert.equal(mod.getPidPath('kodo'), join(homedir(), '.kodo', 'kodo.pid'));
    assert.equal(mod.getPidPath(), join(homedir(), '.kodo', 'polling.pid'), 'zero-arg → polling.pid (back-compat)');
    assert.equal(mod.getPidPath('polling'), join(homedir(), '.kodo', 'polling.pid'));
    // kodo.pid distinto de polling.pid y de server.pid
    assert.notEqual(mod.getPidPath('kodo'), mod.getPidPath('polling'));
    assert.notEqual(mod.getPidPath('kodo'), join(homedir(), '.kodo', 'server.pid'));
  });

  it("writePidFile(payload, 'kodo') escribe kodo.pid atomic + chmod 0o600 + tmp ausente", async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-name-write-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?name-write-${Date.now()}`);
    mod.writePidFile({
      pid: 7,
      started_at: '2026-07-02T00:00:00.000Z',
      kind: 'daemon',
    }, 'kodo');
    const pidPath = mod.getPidPath('kodo');
    assert.equal(pidPath, join(_tmpHome, '.kodo', 'kodo.pid'), 'path resuelve al HOME isolado');
    assert.equal(existsSync(pidPath), true, 'kodo.pid debe existir');
    const mode = statSync(pidPath).mode & 0o777;
    assert.equal(mode, 0o600, `mode esperado 0o600, got 0o${mode.toString(8)}`);
    assert.equal(existsSync(pidPath + '.tmp'), false, 'tmp file debe estar ausente post-rename');
    // polling.pid NO debe existir — path distinction real en disco
    assert.equal(existsSync(mod.getPidPath()), false, 'polling.pid no debe haberse escrito');
  });

  it("readPidFile('kodo') acepta payload daemon {pid, started_at, kind} sin repos (shape-check pasa)", async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-name-read-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?name-read-${Date.now()}`);
    const payload = { pid: 7, started_at: '2026-07-02T00:00:00.000Z', kind: 'daemon' };
    mod.writePidFile(payload, 'kodo');
    const result = mod.readPidFile('kodo');
    assert.deepEqual(result, payload, 'daemon payload (sin repos) sobrevive el shape-check');
  });

  it("readPidFile('kodo') defensive: pid no-number → null (T-65-02)", async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-name-shape-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?name-shape-${Date.now()}`);
    writeFileSync(
      mod.getPidPath('kodo'),
      JSON.stringify({ pid: 'nope', started_at: 'x', kind: 'daemon' }) + '\n',
      'utf-8',
    );
    assert.equal(mod.readPidFile('kodo'), null, 'pid no-number → null');
  });

  it("removePidFile('kodo') idempotente: ausente → no throw; presente → borra solo kodo.pid", async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-name-remove-'));
    mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-daemon.js?name-remove-${Date.now()}`);
    mod.removePidFile('kodo'); // ausente → no throw
    mod.writePidFile({ pid: 1, started_at: 'now', kind: 'daemon' }, 'kodo');
    mod.writePidFile({ pid: 2, started_at: 'now', repos: [] }); // polling.pid
    assert.equal(existsSync(mod.getPidPath('kodo')), true);
    mod.removePidFile('kodo');
    assert.equal(existsSync(mod.getPidPath('kodo')), false, 'kodo.pid borrado');
    assert.equal(existsSync(mod.getPidPath()), true, 'polling.pid intacto (path isolation)');
    mod.removePidFile('kodo'); // segundo remove → no throw
  });
});
