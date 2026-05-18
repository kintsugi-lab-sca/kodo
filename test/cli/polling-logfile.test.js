// @ts-check
//
// test/cli/polling-logfile.test.js — Phase 28 Plan 28-03 Task 1 unit tests para
// src/cli/polling-logfile.js.
//
// Cubre:
//   1. resolveLogfilePath filename format `polling-YYYY-MM-DD.log` con fecha
//      LOCAL inyectada (D-14 — NO roll mid-process).
//   2. ensureLogsDir crea `~/.kodo/logs/` con mode 0o700 (D-16).
//   3. sweepRetention borra archivos con mtime > 7 días (D-15).
//   4. sweepRetention fail-open ante dir ausente (D-15 cleanup pasivo).
//   5. sweepRetention NO toca archivos que no matchean `polling-*.log`.
//   6. resolveLogfilePath lazy resolver: cambio de HOME entre llamadas se refleja
//      (Pitfall #11 — HOME-isolated tests sin ESM cache bust).
//
// Patrón mirror test/cli/polling-daemon.test.js — afterEach restaura HOME +
// mkdtempSync + ESM cache bust via `?test-${Date.now()}` query.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('polling-logfile: resolveLogfilePath / ensureLogsDir / sweepRetention', () => {
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

  it('resolveLogfilePath: filename `polling-YYYY-MM-DD.log` con fecha LOCAL inyectada (D-14)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-logfile-resolve-'));
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-logfile.js?resolve-${Date.now()}`);
    // Fecha LOCAL sin `Z` para evitar UTC shift cross-timezone:
    // new Date('2026-05-18T12:00:00') interpreta como fecha local;
    // getFullYear/getMonth/getDate retornan los valores locales.
    const path = mod.resolveLogfilePath({ now: () => new Date('2026-05-18T12:00:00') });
    assert.match(
      path,
      /polling-2026-05-18\.log$/,
      `path debe terminar en polling-2026-05-18.log, got: ${path}`,
    );
    // Sanity check: el path está bajo el tmpHome
    assert.ok(
      path.startsWith(_tmpHome),
      `path debe estar bajo tmpHome (${_tmpHome}), got: ${path}`,
    );
    assert.ok(
      path.includes('.kodo'),
      `path debe contener .kodo, got: ${path}`,
    );
    assert.ok(
      path.includes('logs'),
      `path debe contener logs, got: ${path}`,
    );
  });

  it('ensureLogsDir: crea `~/.kodo/logs/` con mode 0o700 (D-16)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-logfile-ensure-'));
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-logfile.js?ensure-${Date.now()}`);
    const logsDir = join(_tmpHome, '.kodo', 'logs');
    assert.equal(existsSync(logsDir), false, 'precondición: dir no existe');
    mod.ensureLogsDir();
    assert.equal(existsSync(logsDir), true, 'dir creado');
    const mode = statSync(logsDir).mode & 0o777;
    assert.equal(mode, 0o700, `mode esperado 0o700, got 0o${mode.toString(8)}`);
    // Idempotente — segunda llamada no throw
    mod.ensureLogsDir();
    assert.equal(existsSync(logsDir), true);
  });

  it('sweepRetention: borra polling-*.log con mtime > 7 días, preserva los recientes (D-15)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-logfile-sweep-'));
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const logsDir = join(_tmpHome, '.kodo', 'logs');
    mkdirSync(logsDir, { recursive: true, mode: 0o700 });

    const mod = await import(`../../src/cli/polling-logfile.js?sweep-${Date.now()}`);

    // Pre-poblar 3 archivos antiguos (mtime > 7 días) + 2 recientes.
    const nowSec = Math.floor(Date.now() / 1000);
    const eightDaysAgoSec = nowSec - 8 * 86400;
    const oneDayAgoSec = nowSec - 86400;

    const oldFiles = [
      'polling-2026-04-01.log',
      'polling-2026-04-15.log',
      'polling-2026-05-01.log',
    ];
    const freshFiles = [
      'polling-2026-05-17.log',
      'polling-2026-05-18.log',
    ];

    for (const name of oldFiles) {
      const full = join(logsDir, name);
      writeFileSync(full, 'old content\n');
      // Setear mtime a hace 8 días
      utimesSync(full, eightDaysAgoSec, eightDaysAgoSec);
    }
    for (const name of freshFiles) {
      const full = join(logsDir, name);
      writeFileSync(full, 'fresh content\n');
      utimesSync(full, oneDayAgoSec, oneDayAgoSec);
    }

    mod.sweepRetention();

    for (const name of oldFiles) {
      assert.equal(
        existsSync(join(logsDir, name)),
        false,
        `archivo antiguo ${name} debe haber sido borrado`,
      );
    }
    for (const name of freshFiles) {
      assert.equal(
        existsSync(join(logsDir, name)),
        true,
        `archivo reciente ${name} debe persistir`,
      );
    }
  });

  it('sweepRetention: fail-open cuando el directorio no existe (D-15)', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-logfile-failopen-'));
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    // NO crear `~/.kodo/logs/` — el sweep debe retornar limpio sin throw.
    const mod = await import(`../../src/cli/polling-logfile.js?failopen-${Date.now()}`);
    // Si throw, el test falla con la excepción.
    mod.sweepRetention();
    // Sanity: el dir sigue sin existir post-sweep (no auto-creation).
    assert.equal(
      existsSync(join(_tmpHome, '.kodo', 'logs')),
      false,
      'sweepRetention NO debe crear el directorio si no existe',
    );
  });

  it('sweepRetention: NO toca archivos que no matchean `polling-*.log`', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-logfile-filter-'));
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const logsDir = join(_tmpHome, '.kodo', 'logs');
    mkdirSync(logsDir, { recursive: true, mode: 0o700 });

    const mod = await import(`../../src/cli/polling-logfile.js?filter-${Date.now()}`);

    const nowSec = Math.floor(Date.now() / 1000);
    const eightDaysAgoSec = nowSec - 8 * 86400;

    // 2 archivos non-polling con mtime antiguo — NO deben ser borrados.
    const protectedFiles = [
      'random.log',           // matchea `.log` pero no `polling-`
      'polling-state.json',   // matchea `polling-` pero no `.log`
    ];
    // 1 archivo polling-*.log antiguo — SÍ debe ser borrado.
    const targetFile = 'polling-2026-04-01.log';

    for (const name of [...protectedFiles, targetFile]) {
      const full = join(logsDir, name);
      writeFileSync(full, 'content\n');
      utimesSync(full, eightDaysAgoSec, eightDaysAgoSec);
    }

    mod.sweepRetention();

    for (const name of protectedFiles) {
      assert.equal(
        existsSync(join(logsDir, name)),
        true,
        `archivo non-polling ${name} debe persistir (filtro estricto)`,
      );
    }
    assert.equal(
      existsSync(join(logsDir, targetFile)),
      false,
      `archivo polling-*.log antiguo debe haber sido borrado`,
    );
  });

  it('resolveLogfilePath: lazy resolver — cambio de HOME entre llamadas se refleja', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-logfile-lazy-a-'));
    _prevHome = process.env.HOME;
    process.env.HOME = _tmpHome;
    const mod = await import(`../../src/cli/polling-logfile.js?lazy-${Date.now()}`);
    const fixedNow = () => new Date('2026-05-18T12:00:00');
    const pathA = mod.resolveLogfilePath({ now: fixedNow });
    assert.ok(pathA.startsWith(_tmpHome), `pathA debe estar bajo tmpHomeA: ${pathA}`);

    // Cambiar HOME a un tmpdir distinto.
    const tmpHomeB = mkdtempSync(join(tmpdir(), 'kodo-logfile-lazy-b-'));
    process.env.HOME = tmpHomeB;
    try {
      const pathB = mod.resolveLogfilePath({ now: fixedNow });
      assert.ok(
        pathB.startsWith(tmpHomeB),
        `pathB debe estar bajo tmpHomeB (${tmpHomeB}), got: ${pathB}`,
      );
      assert.notEqual(pathA, pathB, 'pathA y pathB difieren (lazy resolver)');
    } finally {
      rmSync(tmpHomeB, { recursive: true, force: true });
    }
  });
});
