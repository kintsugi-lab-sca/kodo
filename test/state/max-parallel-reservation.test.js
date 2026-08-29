// @ts-check
//
// test/state/max-parallel-reservation.test.js — KODO-55.
//
// El gate de `max_parallel` era un TOCTOU. `launchWorkItem` contaba las sesiones
// vivas con un `listSessions().filter(isSchedulable)` suelto y la entrada no
// aparecía en `state.json` hasta el `addSession` PRE-spawn, varios segundos más
// tarde (`provider.updateTaskState`, creación del worktree, workspace del host).
// Cada lanzamiento que arrancaba dentro de esa ventana leía el estado ANTERIOR,
// veía hueco y pasaba. Observado el 28-ago: con `claude.max_parallel = 5` entraron
// 12 sesiones en 62 s (KODO-42…54, una cada ~5 s), todas por el mismo agujero.
//
// El arreglo es reservar el slot EN LA MISMA sección crítica que lo cuenta. Este
// fichero lo mide donde único se puede medir: con procesos de verdad peleando por
// un `state.json` de verdad.
//
// Tres garantías:
//
//   (1) CARRERA REAL — 8 procesos reservan a la vez contra `max_parallel = 3`.
//       Exactamente 3 reservan y 5 reciben «Max parallel sessions (3) reached».
//       El estado final tiene 3 placeholders, ni uno más.
//
//   (2) LIBERAR DEVUELVE EL SLOT — un lanzamiento que falla TRAS reservar no deja
//       placeholder, y el siguiente entra. Es la contrapartida de (1): un gate que
//       no libera convierte cada fallo en una fuga de capacidad permanente.
//
//   (3) LA RESERVA VENCIDA NO RETIENE — un placeholder huérfano (el proceso que
//       lanzaba murió) deja de contar y se poda. Cubre el caso en que nadie va a
//       llamar al release nunca.
//
// Por qué el sujeto es `reserveLaunchSlot` y no `launchWorkItem` entero: la cola de
// `launchWorkItem` necesita un provider y un host VIVOS (round-trips a Plane y a
// cmux) que no son stubbeables a través de una frontera de proceso, y el repo evita
// `mock.module` a propósito (test/dashboard-poll.test.js:9). Toda la sección crítica
// del arreglo —contar y escribir bajo el mismo lock— vive en el gate, así que la
// carrera lo ejercita íntegro. El escenario (2) sí atraviesa `launchWorkItem` real.
//
// HOME-isolation: state.js calcula KODO_DIR (vía config.js) desde homedir() al
// module-load. La carrera corre en procesos hijo con HOME aislado por env; los
// escenarios in-process fijan `process.env.HOME` ANTES del primer import dinámico y
// NUNCA importan estáticamente los módulos bajo prueba — un import estático
// resolvería contra el ~/.kodo REAL del operador. Scaffold espejo de
// test/state/migration-concurrency.test.js.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');

const STATE_REL = ['.kodo', 'state.json'];
const CONFIG_REL = ['.kodo', 'config.json'];

/** Sesión de trabajo viva — la que YA ocupaba un slot antes de KODO-55. */
function runningSession(id) {
  return {
    workspace_ref: 'workspace:' + id,
    session_id: 'sess-' + id,
    task_id: 'task-' + id,
    task_ref: 'KL-' + id,
    provider: 'test',
    project_id: 'p1',
    summary: 'sesión viva ' + id,
    status: 'running',
    started_at: new Date().toISOString(),
    project_path: '/dev/kodo',
  };
}

describe('gate de max_parallel — reserva bajo lock (KODO-55)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-slot-race-'));
    mkdirSync(join(sandbox, '.kodo'), { recursive: true });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** Siembra un state.json v3 con las sesiones dadas (ya keyed por task_id). */
  function seedState(sessions = {}) {
    writeFileSync(
      join(sandbox, ...STATE_REL),
      JSON.stringify({ schema_version: 3, sessions, history: [] }, null, 2) + '\n',
    );
  }

  /** Lee el state.json del sandbox. */
  function readState() {
    return JSON.parse(readFileSync(join(sandbox, ...STATE_REL), 'utf-8'));
  }

  /** Las entradas del state que son RESERVAS (`status: 'launching'`). */
  function reservations() {
    return Object.entries(readState().sessions).filter(([, s]) => s.status === 'launching');
  }

  /** Lanza un hijo del harness con el HOME del sandbox. Resuelve con su stdout. */
  function spawnChild(argv) {
    const child = spawn(process.execPath, [CHILD, ...argv], {
      stdio: ['ignore', 'pipe', 'inherit'],
      // HOME aislado: el KODO_DIR del hijo resuelve al sandbox, NUNCA al ~/.kodo real.
      env: { ...process.env, HOME: sandbox },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    const done = new Promise((resolve) =>
      child.on('close', () => resolve(out.trim().split('\n').pop().trim())),
    );
    return { child, done };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // (1) CARRERA REAL — 8 reservas concurrentes contra max_parallel = 3.
  // ─────────────────────────────────────────────────────────────────────────
  it('8 reservas en paralelo con max_parallel = 3 → exactamente 3 pasan y 5 se rechazan', async () => {
    const N = 8;
    const MAX = 3;
    seedState({});

    const goFile = join(sandbox, 'go');
    // Todos spawneados ANTES de liberar la barrera: el arranque del proceso y el
    // import ESM en frío quedan fuera de la ventana de contención.
    const pending = [];
    for (let i = 0; i < N; i++) {
      pending.push(
        spawnChild(['--kind', 'reserve', '--idx', String(i), '--max', String(MAX), '--barrier', goFile]),
      );
    }

    const all = Promise.all(pending.map((p) => p.done));
    writeFileSync(goFile, '1');
    const verdicts = await all;

    assert.equal(
      verdicts.filter((v) => v === 'failed').length,
      0,
      `ningún hijo debe fallar por un motivo distinto al gate; got: ${verdicts.join(',')}`,
    );
    assert.equal(
      verdicts.filter((v) => v === 'reserved').length,
      MAX,
      `exactamente ${MAX} reservas deben pasar el gate; got: ${verdicts.join(',')}`,
    );
    assert.equal(
      verdicts.filter((v) => v === 'rejected').length,
      N - MAX,
      `los otros ${N - MAX} deben recibir «Max parallel sessions (${MAX}) reached»; got: ${verdicts.join(',')}`,
    );

    // Y el disco lo confirma: el veredicto de los hijos no basta si el estado final
    // tuviera 8 placeholders (dos ganadores pisándose bajo la misma clave darían el
    // mismo recuento de veredictos).
    assert.equal(
      reservations().length,
      MAX,
      `el state final debe tener exactamente ${MAX} reservas: ${JSON.stringify(readState().sessions)}`,
    );
    // Publicación atómica: ningún `.tmp.*` huérfano tras la carrera.
    assert.deepEqual(
      readdirSync(join(sandbox, '.kodo')).filter((f) => f.startsWith('state.json.tmp.')),
      [],
      'no debe quedar residuo .tmp',
    );
  });

  it('las sesiones YA vivas consumen slots de la carrera', async () => {
    // Mismo escenario, pero con 2 de los 3 slots ya ocupados por sesiones running:
    // solo 1 reserva puede entrar. Cierra la puerta a un gate que contara únicamente
    // las reservas y se olvidara de las sesiones reales.
    const N = 6;
    const MAX = 3;
    seedState({ 'task-a': runningSession('a'), 'task-b': runningSession('b') });

    const goFile = join(sandbox, 'go');
    const pending = [];
    for (let i = 0; i < N; i++) {
      pending.push(
        spawnChild(['--kind', 'reserve', '--idx', String(i), '--max', String(MAX), '--barrier', goFile]),
      );
    }
    const all = Promise.all(pending.map((p) => p.done));
    writeFileSync(goFile, '1');
    const verdicts = await all;

    assert.equal(
      verdicts.filter((v) => v === 'reserved').length,
      1,
      `con 2/3 slots ya ocupados solo cabe 1 reserva; got: ${verdicts.join(',')}`,
    );
    assert.equal(reservations().length, 1);
    // Las sesiones vivas siguen intactas — reservar no puede tocarlas.
    const state = readState();
    assert.equal(state.sessions['task-a'].status, 'running');
    assert.equal(state.sessions['task-b'].status, 'running');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (2) y (3) — escenarios in-process con HOME aislado.
//
// `process.env.HOME` se fija ANTES del primer import dinámico: `config.js` evalúa
// `join(homedir(), '.kodo')` al module-load, y `node --test` da un proceso por
// FICHERO de test, así que ningún otro test ha podido cargar ya el módulo aquí.
// ───────────────────────────────────────────────────────────────────────────
describe('liberación de la reserva (KODO-55)', () => {
  let sandbox;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-slot-release-'));
    mkdirSync(join(sandbox, '.kodo'), { recursive: true });
    process.env.HOME = sandbox;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('un launch que falla tras reservar deja 0 placeholders y el siguiente entra', async () => {
    // `max_parallel = 1` para que la fuga sea inmediatamente observable: si la reserva
    // del launch fallido sobreviviera, el segundo intento se estrellaría contra el gate
    // en vez de contra el provider.
    writeFileSync(
      join(sandbox, ...CONFIG_REL),
      JSON.stringify({ claude: { max_parallel: 1 } }, null, 2) + '\n',
    );

    const { launchWorkItem } = await import('../../src/session/manager.js');
    const { loadState } = await import('../../src/session/state.js');

    // El lanzamiento revienta DESPUÉS de reservar: el gate ya pasó y el fallo llega en
    // la resolución del provider (sin credenciales ni proyecto mapeado en el sandbox).
    await assert.rejects(
      () => launchWorkItem('KL-1'),
      (err) => !/Max parallel sessions/.test(String(err?.message)),
      'el fallo debe venir de la cola del launch, no del gate — si no, el escenario no prueba nada',
    );

    const after = Object.values(loadState().sessions).filter((s) => s.status === 'launching');
    assert.deepEqual(after, [], `el launch fallido dejó un slot fantasma: ${JSON.stringify(after)}`);

    // Y el slot está de vuelta: el siguiente intento vuelve a pasar el gate y a morir
    // en el provider (nunca en «Max parallel sessions»).
    await assert.rejects(
      () => launchWorkItem('KL-2'),
      (err) => !/Max parallel sessions/.test(String(err?.message)),
      'el slot no volvió al pool: el segundo launch chocó con el gate',
    );
    assert.deepEqual(
      Object.values(loadState().sessions).filter((s) => s.status === 'launching'),
      [],
    );
  });

  it('una reserva vencida deja de contar y se poda en el siguiente intento', async () => {
    const { reserveSessionSlot, LAUNCH_RESERVATION_TTL_MS, loadState } = await import(
      '../../src/session/state.js'
    );

    const t0 = Date.parse('2026-08-28T19:00:00.000Z');
    const stale = {
      workspace_ref: '',
      session_id: '',
      task_id: '',
      task_ref: 'KL-huerfana',
      provider: 'test',
      project_id: '',
      summary: 'reserva huérfana',
      status: 'launching',
      started_at: new Date(t0).toISOString(),
      project_path: '',
    };

    // Con max_parallel = 1, la reserva huérfana ocupa el único slot mientras esté viva.
    const blocked = reserveSessionSlot('launching:a', stale, { maxParallel: 1, now: t0 });
    assert.equal(blocked.ok, true, 'la primera reserva entra en el hueco libre');
    const denied = reserveSessionSlot('launching:b', { ...stale, task_ref: 'KL-2' }, {
      maxParallel: 1,
      now: t0 + 1000,
    });
    assert.equal(denied.ok, false, 'una reserva viva SÍ retiene el slot');
    assert.equal(denied.reason, 'max-parallel');

    // Pasado el TTL deja de contar Y se poda en la misma sección crítica.
    const after = reserveSessionSlot('launching:b', { ...stale, task_ref: 'KL-2' }, {
      maxParallel: 1,
      now: t0 + LAUNCH_RESERVATION_TTL_MS + 1,
    });
    assert.equal(after.ok, true, 'una reserva vencida no puede retener el slot');
    const keys = Object.keys(loadState().sessions);
    assert.deepEqual(keys, ['launching:b'], `la huérfana debe haberse podado; keys=${keys.join(',')}`);
  });

  it('releaseSessionSlot NUNCA borra una sesión real', async () => {
    // La guarda que hace seguro llamar al release en el `finally` del camino de ÉXITO,
    // cuando `addSession` ya escribió el registro real bajo otra clave... o bajo la
    // misma, si alguna vez convergen.
    const { releaseSessionSlot, addSession, loadState } = await import('../../src/session/state.js');

    addSession('task-viva', /** @type {any} */ (runningSession('viva')));
    const r = releaseSessionSlot('task-viva');
    assert.equal(r.ok, true);
    assert.equal(r.released, false, 'una sesión running NO es una reserva liberable');
    assert.ok(loadState().sessions['task-viva'], 'la sesión real sigue en el state');

    // Idempotente sobre una clave inexistente.
    const noop = releaseSessionSlot('launching:no-existe');
    assert.deepEqual(noop, { ok: true, released: false });
  });
});
