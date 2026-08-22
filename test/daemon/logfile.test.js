// @ts-check
//
// test/daemon/logfile.test.js — KODO-28.
//
// Cubre las dos mitades del fix "el daemon descarta stdout/stderr":
//
//   1. `src/daemon/logfile.js` — el logfile en sí: path, permisos, rotación por
//      tamaño y degradación never-throws.
//   2. El cableado en `startDaemon` — que el spawn detached recibe ESE fd como
//      stdout Y stderr por defecto, en vez del `'ignore'` que mandaba todo a
//      /dev/null desde a01de1d.
//
// HOME se aísla a un tmpdir ANTES de cargar los módulos: `resolveDaemonLogPath`
// resuelve `homedir()` lazy en cada llamada, pero `ensureLogsDir` (reusado de
// polling-logfile.js) también, así que el aislamiento cubre ambos.

import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HOME = join(tmpdir(), `kodo-daemon-logfile-${Date.now()}-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = HOME;

after(() => {
  process.env.HOME = ORIGINAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

const {
  DAEMON_LOG_MAX_BYTES,
  resolveDaemonLogPath,
  rotateIfLarge,
  openDaemonLog,
  closeDaemonLog,
} = await import('../../src/daemon/logfile.js');
const { startDaemon } = await import('../../src/daemon/lifecycle.js');

const LOG_PATH = join(HOME, '.kodo', 'logs', 'daemon.log');

describe('KODO-28: src/daemon/logfile.js', () => {
  before(() => {
    rmSync(join(HOME, '.kodo'), { recursive: true, force: true });
  });

  it('resolveDaemonLogPath apunta a ~/.kodo/logs/daemon.log (lazy sobre HOME)', () => {
    assert.equal(resolveDaemonLogPath(), LOG_PATH);
  });

  it('openDaemonLog crea el dir 0o700, el fichero 0o600, y devuelve un fd escribible en append', () => {
    const fd = openDaemonLog();
    assert.equal(typeof fd, 'number', 'debe devolver un fd, no null');
    assert.equal(existsSync(LOG_PATH), true);
    // 0o700 en el dir, 0o600 en el fichero (D-16 de polling: el logfile puede
    // llevar stack traces con paths y fragmentos de config).
    assert.equal(statSync(join(HOME, '.kodo', 'logs')).mode & 0o777, 0o700);
    assert.equal(statSync(LOG_PATH).mode & 0o777, 0o600);
    closeDaemonLog(fd);
  });

  it('append: una segunda apertura NO trunca lo ya escrito', () => {
    writeFileSync(LOG_PATH, 'primera linea\n');
    const fd = openDaemonLog();
    closeDaemonLog(fd);
    assert.equal(readFileSync(LOG_PATH, 'utf-8'), 'primera linea\n');
  });

  it('rotateIfLarge: por debajo del techo no rota', () => {
    writeFileSync(LOG_PATH, 'x'.repeat(10));
    assert.equal(rotateIfLarge({ maxBytes: 1024 }), false);
    assert.equal(existsSync(`${LOG_PATH}.1`), false);
  });

  it('rotateIfLarge: al alcanzar el techo mueve a .1 y deja el activo vacío tras reabrir', () => {
    rmSync(`${LOG_PATH}.1`, { force: true });
    writeFileSync(LOG_PATH, 'y'.repeat(200));
    assert.equal(rotateIfLarge({ maxBytes: 100 }), true);
    assert.equal(readFileSync(`${LOG_PATH}.1`, 'utf-8'), 'y'.repeat(200));
    assert.equal(existsSync(LOG_PATH), false, 'el activo desaparece hasta la próxima apertura');
    const fd = openDaemonLog();
    closeDaemonLog(fd);
    assert.equal(readFileSync(LOG_PATH, 'utf-8'), '', 'el activo renace vacío');
  });

  it('rotateIfLarge conserva UNA sola generación (el .1 previo se sobrescribe)', () => {
    writeFileSync(`${LOG_PATH}.1`, 'generacion vieja');
    writeFileSync(LOG_PATH, 'z'.repeat(200));
    rotateIfLarge({ maxBytes: 100 });
    assert.equal(readFileSync(`${LOG_PATH}.1`, 'utf-8'), 'z'.repeat(200));
    assert.equal(existsSync(`${LOG_PATH}.2`), false, 'no se acumulan generaciones');
  });

  it('rotateIfLarge es fail-open ante fichero ausente (primer arranque)', () => {
    rmSync(LOG_PATH, { force: true });
    assert.equal(rotateIfLarge({ maxBytes: 1 }), false, 'ENOENT no debe lanzar');
  });

  it('openDaemonLog degrada a null (never-throws) si el path no se puede abrir', () => {
    // Un DIRECTORIO en el sitio del fichero: openSync(..., "a") da EISDIR.
    const dirAsFile = join(HOME, '.kodo', 'logs', 'daemon-as-dir.log');
    mkdirSync(dirAsFile, { recursive: true });
    assert.equal(openDaemonLog({ path: dirAsFile }), null);
  });

  it('closeDaemonLog es idempotente y tolera null / doble cierre', () => {
    closeDaemonLog(null);
    closeDaemonLog(undefined);
    const fd = openDaemonLog();
    closeDaemonLog(fd);
    closeDaemonLog(fd); // EBADF tragado
  });

  it('DAEMON_LOG_MAX_BYTES es el techo documentado (5 MiB)', () => {
    assert.equal(DAEMON_LOG_MAX_BYTES, 5 * 1024 * 1024);
  });
});

describe('KODO-28: startDaemon cablea el logfile como stdout+stderr del hijo', () => {
  /** Fake child con unref() rastreable. */
  function makeFakeChild() {
    const child = { unref_called: 0, unref() { child.unref_called += 1; } };
    return child;
  }

  /** now() monotónico que avanza `step` ms por llamada. */
  function makeClock(step = 10000) {
    let t = 0;
    return () => { const v = t; t += step; return v; };
  }

  /**
   * @param {object} extraDeps
   * @returns {Promise<{ res: any, stdio: any }>}
   */
  async function runStart(extraDeps) {
    let stdio = null;
    let readCall = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'darwin',
      _readPidFile: () => { readCall += 1; return readCall === 1 ? null : { pid: 456, started_at: 'x' }; },
      _isPidAlive: (pid) => pid === 456,
      _removePidFile: () => {},
      _spawn: (_exec, _argv, o) => { stdio = o.stdio; return makeFakeChild(); },
      _now: makeClock(),
      _sleep: async () => {},
      _kodoBin: '/abs/bin/kodo',
      _execPath: '/usr/bin/node',
      ...extraDeps,
    });
    return { res, stdio };
  }

  it('REGRESIÓN a01de1d: sin _logFd, stdout y stderr YA NO son "ignore"', async () => {
    const { res, stdio } = await runStart({ _openDaemonLog: () => 42, _closeDaemonLog: () => {} });
    assert.equal(res.started, true);
    assert.deepEqual(stdio, ['ignore', 42, 42], 'stdin ignore; stdout y stderr al fd del logfile');
    assert.notEqual(stdio[1], 'ignore', 'el bug original era exactamente este "ignore"');
  });

  it('mismo fd en stdout y stderr — preserva el interleaving cronológico', async () => {
    const { stdio } = await runStart({ _openDaemonLog: () => 7, _closeDaemonLog: () => {} });
    assert.equal(stdio[1], stdio[2]);
  });

  it('cierra el fd del padre tras el spawn (sin leak por cada `kodo up`)', async () => {
    const closed = [];
    await runStart({ _openDaemonLog: () => 42, _closeDaemonLog: (fd) => closed.push(fd) });
    assert.deepEqual(closed, [42], 'el hijo ya tiene su copia duplicada por el kernel');
  });

  it('apertura fallida (null) degrada a "ignore" — nunca bloquea el arranque', async () => {
    const { res, stdio } = await runStart({ _openDaemonLog: () => null, _closeDaemonLog: () => {} });
    assert.equal(res.started, true, 'el daemon arranca igual');
    assert.deepEqual(stdio, ['ignore', 'ignore', 'ignore'], 'exactamente el comportamiento pre-KODO-28');
  });

  it('_logFd inyectado GANA sobre la apertura por defecto, y el padre NO lo cierra', async () => {
    let opened = 0;
    const closed = [];
    const { stdio } = await runStart({
      _logFd: 99,
      _openDaemonLog: () => { opened += 1; return 42; },
      _closeDaemonLog: (fd) => closed.push(fd),
    });
    assert.deepEqual(stdio, ['ignore', 99, 99]);
    assert.equal(opened, 0, 'no debe abrir un logfile que el caller no pidió');
    assert.deepEqual(closed, [null], 'no es dueño del fd inyectado: no lo cierra');
  });

  it('_logFd:"ignore" sigue siendo la forma explícita de pedir /dev/null', async () => {
    const { stdio } = await runStart({ _logFd: 'ignore', _openDaemonLog: () => 42 });
    assert.deepEqual(stdio, ['ignore', 'ignore', 'ignore']);
  });

  it('un short-circuit already-running NO abre el logfile', async () => {
    let opened = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'darwin',
      _readPidFile: () => ({ pid: 123, started_at: 'x' }),
      _isPidAlive: () => true,
      _removePidFile: () => {},
      _spawn: () => makeFakeChild(),
      _openDaemonLog: () => { opened += 1; return 42; },
      _closeDaemonLog: () => {},
    });
    assert.equal(res.alreadyRunning, true);
    assert.equal(opened, 0, 'la apertura es lazy, justo antes del spawn');
  });

  it('win32 refuse-with-guidance NO abre el logfile', async () => {
    let opened = 0;
    const res = await startDaemon('kodo', ['daemon', 'run'], {
      _platform: 'win32',
      _openDaemonLog: () => { opened += 1; return 42; },
      _closeDaemonLog: () => {},
    });
    assert.equal(res.unsupported, true);
    assert.equal(opened, 0);
  });

  it('si el spawn lanza, el fd del padre se cierra igual (no hay leak)', async () => {
    const closed = [];
    await assert.rejects(
      () => startDaemon('kodo', ['daemon', 'run'], {
        _platform: 'darwin',
        _readPidFile: () => null,
        _isPidAlive: () => false,
        _removePidFile: () => {},
        _spawn: () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); },
        _now: makeClock(),
        _sleep: async () => {},
        _kodoBin: '/abs/bin/kodo',
        _openDaemonLog: () => 42,
        _closeDaemonLog: (fd) => closed.push(fd),
      }),
      /spawn ENOENT/,
    );
    assert.deepEqual(closed, [42], 'el finally cierra el fd aunque el spawn haya lanzado');
  });
});
