// @ts-check
//
// test/session/live-work-session.test.js — KODO-88.
//
// El hook Stop escribe `markSessionStatus(task_id, 'idle', 'session-stop:lock-released')`
// al final de CADA turno (src/hooks/stop.js:336, Phase 38 D-12). `markSessionStatus` solo
// toca `status`: `state` y `alive` los escribe únicamente `reconcileTick`. Así que toda
// sesión viva que haya cerrado un turno lleva `status: 'idle'` — y los cuatro consumidores
// que filtraban `status === 'running'` la leían como inexistente:
//
//   - `kodo check` imprimía «Sessions: 0 running» con dos sesiones vivas delante,
//   - `isSchedulable` contaba 0 slots ocupados y dejaba lanzar por encima de `max_parallel`
//     (fuga de capacidad, no un número mal pintado),
//   - `checkHealth` no inspeccionaba ninguna de ellas (stuck/gone invisibles),
//   - `buildContextSummary` decía «Sesiones activas: 0/3» en el prompt del orquestador.
//
// Este fichero fija el predicado único (`isLiveWorkSession`) y los cuatro consumidores.
//
// HOME-isolation: `state.js` congela KODO_DIR (vía `config.js`) desde `homedir()` al
// module-load. NINGÚN módulo bajo prueba se importa estáticamente aquí — todos entran por
// import DINÁMICO dentro del `before`, DESPUÉS de fijar `process.env.HOME` al sandbox.
// Mismo patrón que test/stop-state-transition.test.js.
//
// El host: `checkHealth` no admite DI, así que el sandbox apunta `cmux.binary` a un script
// falso. Se ejercita el camino real (execFile → `workspace list` / `read-screen`) sin tocar
// el cmux del operador.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Refs de workspace que el cmux falso reporta como VIVOS. */
const LIVE_WORKSPACES = ['workspace:live-1', 'workspace:live-2', 'workspace:live-3'];

const FAKE_CMUX = `#!/bin/sh
case "$1" in
  workspace)   ${LIVE_WORKSPACES.map((w) => `echo "${w}"`).join('; ')} ;;
  read-screen) echo "escribiendo tests" ;;
  *)           echo "" ;;
esac
`;

let tmpHome;
let origHome;

// Resueltos en `before`, post-HOME.
let isLiveWorkSession;
let isSchedulable;
let reserveSessionSlot;
let runCheck;
let checkHealth;
let buildContextSummary;

/** Sesión sintética con los campos que leen el predicado y sus consumidores. */
function session(id, overrides = {}) {
  return {
    workspace_ref: 'workspace:' + id,
    workspace_id: null,
    session_id: 'sess-' + id,
    task_id: 'task-' + id,
    task_ref: 'KODO-' + id,
    provider: 'kodo-test-void',
    project_id: 'p1',
    summary: 'sesión ' + id,
    status: 'idle',      // lo que el hook Stop deja tras el PRIMER turno
    state: 'idle',
    alive: true,
    started_at: new Date().toISOString(),
    project_path: '/dev/kodo',
    ...overrides,
  };
}

/** Escribe el state.json v3 del sandbox con las sesiones dadas (keyed por task_id). */
function seedState(sessions) {
  const byId = {};
  for (const s of sessions) byId[s.task_id] = s;
  writeFileSync(
    join(tmpHome, '.kodo', 'state.json'),
    JSON.stringify({ schema_version: 3, sessions: byId, history: [] }, null, 2) + '\n',
  );
}

before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-live-session-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const fakeCmux = join(tmpHome, 'fake-cmux');
  writeFileSync(fakeCmux, FAKE_CMUX);
  chmodSync(fakeCmux, 0o755);

  writeFileSync(
    join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify({
      // Provider inexistente A PROPÓSITO: `getProvider` lanza, `checkPendingTasks` lo
      // atrapa y el test jamás sale a la red del provider real.
      provider: 'kodo-test-void',
      host: 'cmux',
      cmux: { binary: fakeCmux },
      claude: { max_parallel: 3 },
    }, null, 2) + '\n',
  );

  seedState([]);
  process.env.HOME = tmpHome;

  ({ isLiveWorkSession, isSchedulable, reserveSessionSlot } = await import('../../src/session/state.js'));
  ({ runCheck } = await import('../../src/check.js'));
  ({ checkHealth } = await import('../../src/session/health.js'));
  ({ buildContextSummary } = await import('../../src/orchestrator/launch.js'));
});

after(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => seedState([]));

describe('isLiveWorkSession — el predicado único (KODO-88)', () => {
  it('status:idle + alive:true → SÍ es una sesión de trabajo viva', () => {
    assert.equal(isLiveWorkSession(session('1')), true);
  });

  it('status:running + alive:true → sigue siendo viva (sin regresión)', () => {
    assert.equal(isLiveWorkSession(session('2', { status: 'running', state: 'running' })), true);
  });

  it('status:idle + alive:false (zombi) → NO viva: la TAB murió, el slot se libera', () => {
    assert.equal(isLiveWorkSession(session('3', { alive: false })), false);
  });

  it('legacy sin campo `alive` → SÍ viva (`!== false`, no `=== true`)', () => {
    const legacy = session('4');
    delete legacy.alive;
    assert.equal(isLiveWorkSession(legacy), true);
  });

  it('outcomes (done/error/review) y la reserva `launching` → NO vivas', () => {
    for (const status of ['done', 'error', 'review', 'launching']) {
      assert.equal(isLiveWorkSession(session('5', { status })), false, `status ${status}`);
    }
  });

  it('isSchedulable = viva ∪ reserva launching', () => {
    assert.equal(isSchedulable(session('6')), true, 'idle+alive ocupa slot');
    assert.equal(isSchedulable(session('7', { status: 'launching' })), true, 'la reserva ocupa slot');
    assert.equal(isSchedulable(session('8', { status: 'launching', alive: false })), false);
    assert.equal(isSchedulable(session('9', { status: 'review' })), false);
  });
});

describe('reserveSessionSlot — tres sesiones idle vivas llenan max_parallel=3', () => {
  it('la cuarta se rechaza con reason max-parallel', () => {
    seedState([
      session('a', { workspace_ref: LIVE_WORKSPACES[0] }),
      session('b', { workspace_ref: LIVE_WORKSPACES[1] }),
      session('c', { workspace_ref: LIVE_WORKSPACES[2] }),
    ]);

    const r = reserveSessionSlot(
      'launching:cuarta',
      session('d', { status: 'launching' }),
      { maxParallel: 3 },
    );

    assert.equal(r.ok, false, 'con 3 sesiones idle vivas NO queda hueco');
    assert.equal(r.reason, 'max-parallel');
    assert.deepEqual(
      [...r.active].sort(),
      ['KODO-a', 'KODO-b', 'KODO-c'],
      'el rechazo debe nombrar las tres sesiones idle que ocupan los slots',
    );
  });

  it('con una de las tres muerta (alive:false) sí entra la cuarta', () => {
    seedState([
      session('a'),
      session('b'),
      session('c', { alive: false, state: 'dead' }),
    ]);

    const r = reserveSessionSlot(
      'launching:cuarta',
      session('d', { status: 'launching' }),
      { maxParallel: 3 },
    );

    assert.equal(r.ok, true, 'el zombi no retiene su slot (KODO-55 intacto)');
  });
});

describe('runCheck — las sesiones idle se cuentan como running', () => {
  it('dos sesiones vivas tras su primer turno → «Sessions: 2 running»', async () => {
    seedState([
      session('85', { workspace_ref: LIVE_WORKSPACES[0] }),
      session('87', { workspace_ref: LIVE_WORKSPACES[1] }),
    ]);

    const { summary } = await runCheck();

    assert.match(summary, /Sessions: 2 running, 0 in review/);
  });

  it('la sesión muerta no se cuenta', async () => {
    seedState([
      session('85', { workspace_ref: LIVE_WORKSPACES[0] }),
      session('87', { workspace_ref: LIVE_WORKSPACES[1], alive: false, state: 'dead' }),
    ]);

    const { summary } = await runCheck();

    assert.match(summary, /Sessions: 1 running/);
  });
});

describe('checkHealth — las sesiones idle se inspeccionan', () => {
  it('una sesión idle con su workspace vivo produce reporte (no queda fuera del barrido)', async () => {
    seedState([session('85', { workspace_ref: LIVE_WORKSPACES[0] })]);

    const reports = await checkHealth();

    assert.equal(reports.length, 1, 'la sesión idle debe entrar en el barrido de salud');
    assert.equal(reports[0].ref, 'KODO-85');
    assert.equal(reports[0].health, 'healthy');
  });

  it('una sesión idle cuyo workspace ya no existe se detecta como gone', async () => {
    seedState([session('85', { workspace_ref: 'workspace:desaparecido' })]);

    const reports = await checkHealth();

    assert.equal(reports.length, 1);
    assert.equal(reports[0].health, 'gone', 'antes de KODO-88 esta sesión era invisible para stuck/gone');
  });

  it('la reserva `launching` sigue fuera del barrido (no tiene workspace que mirar)', async () => {
    seedState([session('res', { status: 'launching', workspace_ref: '' })]);

    assert.deepEqual(await checkHealth(), []);
  });
});

describe('buildContextSummary — el prompt del orquestador ve las sesiones idle', () => {
  it('tres sesiones idle vivas con max_parallel=3 → «Sesiones activas: 3/3»', () => {
    const summary = buildContextSummary(
      [session('a'), session('b'), session('c')],
      { claude: { max_parallel: 3 } },
    );

    assert.match(summary, /Sesiones activas: 3\/3/);
    assert.ok(!summary.includes('No hay sesiones corriendo.'));
  });
});
