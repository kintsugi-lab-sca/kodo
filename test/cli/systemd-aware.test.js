// @ts-check
//
// test/cli/systemd-aware.test.js — KODO-59 (F3 del port a Linux).
//
// Los tres comandos de ciclo de vida cuando systemd es el dueño del daemon en Linux. Dos de
// los tres NO son cosméticos, y son el motivo de que este fichero exista:
//
//   - `kodo stop` con la unidad ACTIVA: `Restart=always` hace que un SIGTERM al PID
//     REINICIE el daemon. El stop del molde de siempre reportaría `stopped` con el daemon
//     vivo — una MENTIRA, no una degradación. Tiene que ir por `systemctl --user stop`.
//   - `kodo up` con la unidad INSTALADA pero parada: spawnear un daemon detached crea un
//     proceso que systemd no conoce; el siguiente `systemctl --user start` muere con
//     EADDRINUSE contra el daemon del propio operador.
//   - `kodo status`: informativo, pero la rama `--json` NO puede moverse (DX-06).
//
// El complemento imprescindible de cada caso es su NEGATIVO: sin unidad instalada, los tres
// comandos tienen que comportarse EXACTAMENTE igual que antes de KODO-59.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStopUnified, runStatusUnified } from '../../src/cli/stop-status.js';
import { runUp } from '../../src/cli/up.js';

/** Estado de unidad listo para inyectar. */
const NO_UNIT = { installed: false, active: null, enabled: null };
const ACTIVE = { installed: true, active: 'active', enabled: 'enabled' };
const INACTIVE = { installed: true, active: 'inactive', enabled: 'enabled' };

describe('kodo stop — consciente de systemd', () => {
  it('unidad ACTIVA → para la unidad y NO manda señales al PID (Restart=always lo reviviría)', async () => {
    const out = [];
    let stopDaemonCalls = 0;
    const code = await runStopUnified({}, {
      _unitState: () => ACTIVE,
      _systemctlStop: () => ({ ok: true }),
      _stopDaemon: async () => { stopDaemonCalls++; return { stopped: true, pid: 1 }; },
      _write: (s) => out.push(s),
      _err: () => {},
      _fmt: { ok: (s) => s, warn: (s) => s, dim: (s) => s },
    });
    assert.equal(code, 0);
    assert.equal(stopDaemonCalls, 0, 'un SIGTERM aquí solo consigue que systemd lo reinicie');
    assert.match(out.join(''), /stopped.*systemd/);
  });

  it('unidad ACTIVATING → también va por systemd (arrancando sigue siendo suyo)', async () => {
    let stopDaemonCalls = 0;
    const code = await runStopUnified({}, {
      _unitState: () => ({ installed: true, active: 'activating', enabled: 'enabled' }),
      _systemctlStop: () => ({ ok: true }),
      _stopDaemon: async () => { stopDaemonCalls++; return { stopped: true }; },
      _write: () => {}, _err: () => {},
      _fmt: { ok: (s) => s, warn: (s) => s, dim: (s) => s },
    });
    assert.equal(code, 0);
    assert.equal(stopDaemonCalls, 0);
  });

  it('systemctl stop falla → exit 1 y lo dice; no finge éxito ni cae al camino de señales', async () => {
    const err = [];
    let stopDaemonCalls = 0;
    const code = await runStopUnified({}, {
      _unitState: () => ACTIVE,
      _systemctlStop: () => ({ ok: false, message: 'Interactive authentication required' }),
      _stopDaemon: async () => { stopDaemonCalls++; return { stopped: true }; },
      _write: () => {},
      _err: (s) => err.push(s),
      _fmt: { ok: (s) => s, warn: (s) => s, dim: (s) => s },
    });
    assert.equal(code, 1);
    assert.equal(stopDaemonCalls, 0);
    assert.match(err.join(''), /Interactive authentication required/);
  });

  it('unidad INSTALADA pero parada → camino de siempre (el daemon vivo no es de systemd)', async () => {
    const out = [];
    let stopDaemonCalls = 0;
    const code = await runStopUnified({}, {
      _unitState: () => INACTIVE,
      _systemctlStop: () => { throw new Error('no debería llamarse'); },
      _stopDaemon: async () => { stopDaemonCalls++; return { stopped: true, pid: 4242 }; },
      _write: (s) => out.push(s),
      _err: () => {},
      _fmt: { ok: (s) => s, warn: (s) => s, dim: (s) => s },
    });
    assert.equal(code, 0);
    assert.equal(stopDaemonCalls, 1);
    assert.match(out.join(''), /stopped pid: 4242/);
  });

  it('SIN unidad → comportamiento idéntico al de antes de KODO-59', async () => {
    const out = [];
    const code = await runStopUnified({}, {
      _unitState: () => NO_UNIT,
      _stopDaemon: async () => ({ stopped: true, pid: 7 }),
      _write: (s) => out.push(s),
      _err: () => {},
      _fmt: { ok: (s) => s, warn: (s) => s, dim: (s) => s },
    });
    assert.equal(code, 0);
    assert.equal(out.join(''), 'stopped pid: 7\n');
  });
});

describe('kodo status — consciente de systemd', () => {
  it('unidad activa → añade la línea de systemd DESPUÉS del estado del daemon', async () => {
    const out = [];
    const code = await runStatusUnified({}, {
      _statusDaemon: () => ({ status: 'running', pid: 99 }),
      _unitState: () => ACTIVE,
      _write: (s) => out.push(s),
      _stdout: { isTTY: false },
      _listQueue: () => [],
    });
    assert.equal(code, 0);
    const lines = out.join('').trim().split('\n');
    assert.match(lines[0], /running pid: 99/);
    assert.match(lines[1], /systemd:.*active.*\(enabled\).*kodo\.service/);
  });

  it('unidad failed → se ve como failed (es la diferencia entre «parado» y «se cayó»)', async () => {
    const out = [];
    await runStatusUnified({}, {
      _statusDaemon: () => ({ status: 'idle', pid: null }),
      _unitState: () => ({ installed: true, active: 'failed', enabled: 'enabled' }),
      _write: (s) => out.push(s),
      _stdout: { isTTY: false },
      _listQueue: () => [],
    });
    assert.match(out.join(''), /systemd:.*failed/);
  });

  it('sin unidad → ni una palabra de systemd', async () => {
    const out = [];
    await runStatusUnified({}, {
      _statusDaemon: () => ({ status: 'idle', pid: null }),
      _unitState: () => NO_UNIT,
      _write: (s) => out.push(s),
      _stdout: { isTTY: false },
      _listQueue: () => [],
    });
    assert.equal(out.join(''), 'stopped\n');
  });

  it('--json NO se mueve: sigue siendo byte-exacto {status,pid} aunque haya unidad (DX-06)', async () => {
    const out = [];
    const code = await runStatusUnified({ json: true }, {
      _statusDaemon: () => ({ status: 'running', pid: 123 }),
      _unitState: () => ACTIVE,
      _write: (s) => out.push(s),
      _listQueue: () => [],
    });
    assert.equal(code, 0);
    assert.equal(out.join(''), '{"status":"running","pid":123}\n');
  });

  it('un unitState que lanza NO tumba el status (D-13: una consulta nunca falla)', async () => {
    const out = [];
    const code = await runStatusUnified({}, {
      _statusDaemon: () => ({ status: 'running', pid: 5 }),
      _unitState: () => { throw new Error('systemctl explotó'); },
      _write: (s) => out.push(s),
      _stdout: { isTTY: false },
      _listQueue: () => [],
    });
    assert.equal(code, 0);
    assert.match(out.join(''), /running pid: 5/);
  });
});

describe('kodo up — consciente de systemd', () => {
  /**
   * Deps mínimas de un `up` con daemon frío y puerto libre. `startResult` es lo que devuelve
   * el `systemctl --user start` falso; los contadores viven en `calls`.
   */
  function makeUpDeps(overrides = {}, startResult = { ok: true }) {
    const calls = { startDaemon: 0, systemctlStart: 0, dashboard: 0, err: [] };
    const deps = {
      _platform: 'linux',
      _loadConfig: () => ({ server: { port: 9090 } }),
      _needsSetup: () => false,
      _resolveBaseUrl: () => 'http://localhost:9090',
      _statusDaemon: () => ({ status: 'idle', pid: null }),
      _probePort: async () => false,
      _startDaemon: async () => { calls.startDaemon++; return { ok: true, started: true }; },
      _systemctlStart: () => { calls.systemctlStart++; return startResult; },
      _waitForHealth: async () => true,
      _runDashboard: async () => { calls.dashboard++; },
      _stderr: { write: (s) => calls.err.push(s) },
      ...overrides,
    };
    return { deps, calls };
  }

  it('unidad instalada + daemon frío → arranca la UNIDAD, no un daemon detached', async () => {
    const { deps, calls } = makeUpDeps({ _unitState: () => INACTIVE });
    await runUp(deps);
    assert.equal(calls.systemctlStart, 1);
    assert.equal(calls.startDaemon, 0, 'un detached aquí sería un daemon que systemd no conoce');
    assert.equal(calls.dashboard, 1, 'el visor se engancha igual');
  });

  it('systemctl start falla → avisa y NO cae al detached (evita el split-brain)', async () => {
    const { deps, calls } = makeUpDeps(
      { _unitState: () => INACTIVE },
      { ok: false, message: 'Unit kodo.service not found' },
    );
    await runUp(deps);
    assert.equal(calls.startDaemon, 0);
    assert.equal(calls.dashboard, 0);
    assert.match(calls.err.join(''), /Unit kodo\.service not found/);
  });

  it('SIN unidad → arranque detached de siempre', async () => {
    const { deps, calls } = makeUpDeps({
      _unitState: () => NO_UNIT,
      _systemctlStart: () => { throw new Error('no debería llamarse'); },
    });
    await runUp(deps);
    assert.equal(calls.startDaemon, 1);
    assert.equal(calls.dashboard, 1);
  });

  it('daemon YA corriendo bajo systemd → ni start ni spawn: attach directo', async () => {
    const { deps, calls } = makeUpDeps({
      _statusDaemon: () => ({ status: 'running', pid: 321 }),
      _unitState: () => ACTIVE,
      _systemctlStart: () => { throw new Error('no debería llamarse'); },
    });
    await runUp(deps);
    assert.equal(calls.startDaemon, 0);
    assert.equal(calls.dashboard, 1);
  });
});
