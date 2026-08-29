// @ts-check
//
// test/cli/status-unified.test.js — Plan 66-02 Task 2 (UP-05, D-04, DX-06).
//
// Prueba `runStatusUnified` de src/cli/stop-status.js: status DAEMON-FIRST con
// `--json` byte-DETERMINISTA. Verifica que:
//   - running + json → stdout EXACTO `{"status":"running","pid":123}\n` (byte-comparado).
//   - idle + json → stdout EXACTO `{"status":"idle","pid":null}\n`.
//   - Las 2 keys {status, pid} presentes SIEMPRE, mismo orden, sin ANSI en la rama json.
//   - Rama TTY (json:false) escribe legible; retorna 0 en ambas ramas.
// La comparación del --json es con `===` (byte-exacto), NO assert.match — el
// determinismo es el contrato (Pitfall #10). TODO por DI, sin daemon real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStatusUnified } from '../../src/cli/stop-status.js';

/** Deps base: statusDaemon inyectable + captura de stdout. */
function makeDeps(overrides = {}) {
  const calls = { out: [] };
  const deps = {
    _statusDaemon: () => ({ status: 'running', pid: 123 }),
    _write: (s) => { calls.out.push(s); },
    // stream no-TTY → createFormatter no colorea (bytes limpios en la rama TTY del test).
    _stdout: { isTTY: false },
    // KODO-26: sin este stub el handler leería la cola del `~/.kodo/state.json` REAL y la salida
    // del test dependería de cuántas ramas tenga sin integrar quien corra `npm test`.
    _listQueue: () => [],
    // KODO-63: mismo argumento que `_listQueue`, un carril más abajo. `unitState` hace su
    // guard contra `process.platform`, así que en un Linux con `kodo.service` instalado —el
    // estado NORMAL de un operador tras KODO-59— el handler añadía su línea `systemd: …` y
    // el caso «ni una línea de más» dependía de si la máquina tenía kodo instalado. Los
    // casos que SÍ prueban esa línea la inyectan por `overrides`.
    _unitState: () => ({ installed: false, active: null, enabled: null }),
    _now: () => new Date('2026-08-20T13:00:00.000Z'),
    ...overrides,
  };
  return { deps, calls };
}

/** Entrada pendiente mínima para los casos de la cola. */
function queueEntry(overrides = {}) {
  return {
    task_ref: 'KODO-26',
    branch: 'worktree-abc',
    suggested: 'merge',
    commits_ahead: 3,
    status: 'pending',
    created_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('runStatusUnified', () => {
  it('running + json:true → stdout EXACTO {"status":"running","pid":123}\\n (byte-comparado)', async () => {
    const { deps, calls } = makeDeps();
    const code = await runStatusUnified({ json: true }, deps);
    assert.equal(code, 0);
    assert.equal(calls.out.length, 1);
    assert.equal(calls.out[0], '{"status":"running","pid":123}\n');
  });

  it('idle + json:true → stdout EXACTO {"status":"idle","pid":null}\\n', async () => {
    const { deps, calls } = makeDeps({
      _statusDaemon: () => ({ status: 'idle', pid: null }),
    });
    const code = await runStatusUnified({ json: true }, deps);
    assert.equal(code, 0);
    assert.equal(calls.out[0], '{"status":"idle","pid":null}\n');
  });

  it('json: keys {status, pid} SIEMPRE presentes, mismo orden, sin ANSI', async () => {
    const { deps, calls } = makeDeps();
    await runStatusUnified({ json: true }, deps);
    const line = calls.out[0];
    // Sin secuencias ANSI (ESC).
    assert.ok(!/\x1b\[/.test(line), 'la rama json no debe contener ANSI');
    const parsed = JSON.parse(line);
    assert.deepEqual(Object.keys(parsed), ['status', 'pid'], 'orden y presencia de keys fijos');
  });

  it('TTY (json:false) running → escribe legible con pid; retorna 0', async () => {
    const { deps, calls } = makeDeps();
    const code = await runStatusUnified({}, deps);
    assert.equal(code, 0);
    assert.ok(calls.out.some((s) => /running/.test(s)));
    assert.ok(calls.out.some((s) => /pid: 123/.test(s)));
  });

  it('TTY (json:false) idle → escribe stopped; retorna 0', async () => {
    const { deps, calls } = makeDeps({
      _statusDaemon: () => ({ status: 'idle', pid: null }),
    });
    const code = await runStatusUnified({}, deps);
    assert.equal(code, 0);
    assert.ok(calls.out.some((s) => /stopped/.test(s)));
  });
});

// ── KODO-26: la cola de integración en la rama humana ───────────────────────────────────
describe('runStatusUnified — cola de integración', () => {
  it('con entradas pendientes pinta el bloque tras la línea del daemon', async () => {
    const { deps, calls } = makeDeps({
      _listQueue: () => [queueEntry(), queueEntry({ task_ref: 'KODO-30', branch: 'rama-b', suggested: 'ff', commits_ahead: 1 })],
    });
    const code = await runStatusUnified({}, deps);
    const text = calls.out.join('');

    assert.equal(code, 0);
    assert.match(text, /cola de integración: 2/);
    assert.match(text, /KODO-26\s+worktree-abc\s+commits: 3\s+→ merge\s+\(3h\)/, 'la edad se pinta junto a la sugerencia');
    assert.match(text, /KODO-30\s+rama-b\s+commits: 1\s+→ ff/);
    assert.ok(text.indexOf('running') < text.indexOf('cola de integración'), 'el daemon va primero');
  });

  it('cola vacía → COLAPSA: ni una línea de más', async () => {
    const { deps, calls } = makeDeps();
    await runStatusUnified({}, deps);
    assert.equal(calls.out.join(''), '✓ running pid: 123\n', 'salida byte-idéntica a la previa a KODO-26');
  });

  it('commits_ahead null se pinta como ? (no verificable, no cero)', async () => {
    const { deps, calls } = makeDeps({ _listQueue: () => [queueEntry({ commits_ahead: null })] });
    await runStatusUnified({}, deps);
    assert.match(calls.out.join(''), /commits: \?/);
  });

  it('un store que revienta NO rompe el status (fail-open, D-13)', async () => {
    const { deps, calls } = makeDeps({ _listQueue: () => { throw new Error('boom'); } });
    const code = await runStatusUnified({}, deps);
    assert.equal(code, 0);
    assert.match(calls.out.join(''), /running/, 'el estado del daemon sí se reportó');
  });

  it('la rama --json NO gana claves: el contrato DX-06 sigue congelado en {status, pid}', async () => {
    const { deps, calls } = makeDeps({ _listQueue: () => [queueEntry()] });
    await runStatusUnified({ json: true }, deps);
    assert.equal(calls.out.length, 1, 'una sola línea, sin bloque de cola');
    assert.equal(calls.out[0], '{"status":"running","pid":123}\n');
  });
});
