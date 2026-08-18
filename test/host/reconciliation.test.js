// @ts-check
//
// test/host/reconciliation.test.js — Phase 38 Plan 04 Wave 0 RED (TUI-20 / SC#4).
//
// Cubre reconcileTick: función PURA (host snapshot ya consultado por el caller,
// NO invoca host.listWorkspaces adentro) que aplica las transiciones del ciclo
// de vida v3 con debouncing 2-tick (R-2), rescate desde history (D-07 step 3,
// cierra ROMAN-151/152) y sellado a closed (D-07 step 4).
//
// Estilo: describe + fixtures inline + sin async beforeEach (idiom de
// test/migration.test.js). reconcileTick(state, liveRefs, {debounceStore, tick,
// now, logger}) → {state, events:{rescued, sealed, transitioned, total}}.
//
// DESVIACIÓN ARQUITECTÓNICA (documentada en 38-04-SUMMARY): el plan ubicaba
// reconcileTick en src/cli/dashboard/polling.js y lo cableaba en el dashboard.
// Pero el dashboard es un cliente HTTP read-only de GET /status; el server es
// el único escritor de state.json. reconcileTick vive en src/session/reconcile.js
// (cohesión con la capa de estado) y se cablea en el server (único escritor).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileTick,
  runReconcileTick,
  isSessionProcessAlive,
  titleIdentifiesSession,
  isProcessDeadBeyondGrace,
  PROCESS_DEAD_GRACE_MS,
} from '../../src/session/reconcile.js';
import { isOrphanCandidate, ORPHAN_GRACE_MS } from '../../src/session/orphan-sweep.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-05-31T12:00:00.000Z');

/** Logger memSink mínimo. */
function makeLogger() {
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,
  };
  return { logger, events };
}

function session(overrides = {}) {
  return {
    workspace_ref: 'workspace:1',
    session_id: 'sess-1',
    task_id: 't1',
    task_ref: 'KL-1',
    provider: 'plane',
    project_id: 'p1',
    summary: 's',
    status: 'running',
    started_at: '2026-05-31T10:00:00.000Z',
    project_path: '/dev/kodo',
    state: 'running',
    process_alive: true,
    tab_alive: true,
    needs_input: false,
    last_seen_alive: null,
    ...overrides,
  };
}

describe('reconcileTick — transiciones + debouncing 2-tick (D-07 / R-2)', () => {
  // F1 — running → idle con debouncing
  it('F1: running→idle aplica SOLO al 2º tick consecutivo', () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ process_alive: false }) }, // proceso murió
      history: [],
    };
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }];
    const debounceStore = new Map();

    // Tick 1: target idle (live + !process_alive + !needs_input) ≠ running → debounce, NO aplica.
    const r1 = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    assert.equal(r1.state.sessions.t1.state, 'running', 'tick 1: aún running (debouncing)');
    assert.deepEqual(debounceStore.get('t1'), { pending_state: 'idle', tick_count: 1 });

    // Tick 2: mismo target → tick_count 2 → aplica.
    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'idle', 'tick 2: aplica idle');
    assert.equal(r2.state.sessions.t1.tab_alive, true);
    assert.equal(debounceStore.has('t1'), false, 'debounce entry eliminada tras aplicar');
  });

  // F2 — flicker prevention: target cambia → reset del contador
  it('F2: si el target cambia entre ticks, el contador se resetea (anti-flicker)', () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ process_alive: false }) },
      history: [],
    };
    const debounceStore = new Map();

    // Tick 1: idle pending (count 1).
    const r1 = reconcileTick(state, [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }], { debounceStore, tick: 1, now: NOW });
    assert.deepEqual(debounceStore.get('t1'), { pending_state: 'idle', tick_count: 1 });

    // Tick 2: needs_input flip → target needs-input ≠ idle → RESET a count 1.
    const r2 = reconcileTick(r1.state, [{ workspace_ref: 'workspace:1', alive: true, needs_input: true }], { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'running', 'aún running — target cambió, reset');
    assert.deepEqual(debounceStore.get('t1'), { pending_state: 'needs-input', tick_count: 1 });

    // Tick 3: needs-input estable → count 2 → aplica.
    const r3 = reconcileTick(r2.state, [{ workspace_ref: 'workspace:1', alive: true, needs_input: true }], { debounceStore, tick: 3, now: NOW });
    assert.equal(r3.state.sessions.t1.state, 'needs-input', 'tick 3: aplica needs-input');
  });

  // F3 — rescate desde history (cierra ROMAN-151/152)
  it('F3: rescata desde history una session cuya tab sigue viva (D-07 step 3)', () => {
    const state = {
      schema_version: 3,
      sessions: {},
      history: [
        {
          workspace_ref: 'workspace:5',
          session_id: 'sess-h1',
          task_id: 'h1',
          task_ref: 'KL-5',
          provider: 'plane',
          project_id: 'p1',
          summary: 'rescatable',
          status: 'idle',
          started_at: '2026-05-29T10:00:00.000Z',
          project_path: '/dev/kodo',
          ended_at: '2026-05-29T11:00:00.000Z', // < 30 días
        },
      ],
    };
    const liveRefs = [{ workspace_ref: 'workspace:5', alive: true, needs_input: false }];

    const r = reconcileTick(state, liveRefs, { debounceStore: new Map(), tick: 1, now: NOW });

    assert.ok(r.state.sessions.h1, 'h1 rescatada a sessions');
    assert.equal(r.state.sessions.h1.state, 'idle');
    assert.equal(r.state.sessions.h1.tab_alive, true);
    assert.equal(r.state.history.find((h) => h.task_id === 'h1'), undefined, 'h1 ya NO está en history');
    assert.equal(r.events.rescued, 1);
  });

  // F4 — sellado a closed
  it('F4: sella a closed una session dead > 30 días y la mueve a history (D-07 step 4)', () => {
    const oldDead = NOW - 40 * DAY_MS;
    const state = {
      schema_version: 3,
      sessions: {
        dead1: session({
          task_id: 'dead1',
          workspace_ref: 'workspace:9',
          state: 'dead',
          process_alive: false,
          tab_alive: false,
          dead_since: new Date(oldDead).toISOString(),
        }),
      },
      history: [],
    };
    const liveRefs = []; // tab no presente

    const r = reconcileTick(state, liveRefs, { debounceStore: new Map(), tick: 1, now: NOW });

    assert.equal(r.state.sessions.dead1, undefined, 'dead1 ya no está en sessions');
    const sealed = r.state.history.find((h) => h.task_id === 'dead1');
    assert.ok(sealed, 'dead1 movida a history');
    assert.equal(sealed.state, 'closed', 'closed es terminal (D-04)');
    assert.equal(r.events.sealed, 1);
  });

  // F5 — host fail never-throws
  it('F5: liveRefs === null → skip tick, retorna el mismo state, loggea warn', () => {
    const state = { schema_version: 3, sessions: { t1: session() }, history: [] };
    const { logger, events } = makeLogger();

    const r = reconcileTick(state, null, { debounceStore: new Map(), tick: 1, now: NOW, logger });

    assert.equal(r.state, state, 'mismo state (skip, sin cambios)');
    assert.equal(r.events.transitioned, 0);
    const warn = events.find((e) => e.level === 'warn');
    assert.ok(warn, 'emite warn al skipear por host fail');
  });

  // F6 — debouncing per workspace_ref independiente
  it('F6: el debouncing de un ref no interfiere con otra session estable', () => {
    const state = {
      schema_version: 3,
      sessions: {
        t1: session({ task_id: 't1', workspace_ref: 'workspace:1', process_alive: false }), // → idle
        t2: session({ task_id: 't2', workspace_ref: 'workspace:2', process_alive: true }),  // estable running
      },
      history: [],
    };
    const liveRefs = [
      { workspace_ref: 'workspace:1', alive: true, needs_input: false },
      { workspace_ref: 'workspace:2', alive: true, needs_input: false },
    ];
    const debounceStore = new Map();

    const r1 = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    // t2 estable running: no entra al debounceStore.
    assert.equal(r1.state.sessions.t2.state, 'running');
    assert.equal(debounceStore.has('t2'), false, 't2 estable NO genera debounce entry');
    // t1 en debounce.
    assert.deepEqual(debounceStore.get('t1'), { pending_state: 'idle', tick_count: 1 });

    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'idle', 't1 aplica al 2º tick');
    assert.equal(r2.state.sessions.t2.state, 'running', 't2 sigue estable, sin interferencia');
  });
});

describe('runReconcileTick — tick con I/O (DI host/loadState/saveState)', () => {
  it('host OK + cambio → consulta host, reconcilia y persiste', async () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ process_alive: false }) },
      history: [],
    };
    let saved = null;
    const host = { listWorkspaces: async () => [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }] };
    const debounceStore = new Map();
    const { logger, events } = makeLogger();
    // pgrep fake: el proceso de la sesión está MUERTO → process_alive se deriva a false.
    const pgrep = () => '';

    // Tick 1: debounce (no persiste — sin cambios).
    await runReconcileTick({ host, loadState: () => state, saveState: (s) => { saved = s; }, debounceStore, tick: 1, now: () => NOW, logger, pgrep });
    assert.equal(saved, null, 'tick 1: sin cambios, no persiste');

    // Tick 2: aplica idle → persiste.
    let state2 = state;
    await runReconcileTick({ host, loadState: () => state2, saveState: (s) => { saved = s; state2 = s; }, debounceStore, tick: 2, now: () => NOW, logger, pgrep });
    assert.ok(saved, 'tick 2: persiste el cambio');
    assert.equal(saved.sessions.t1.state, 'idle');

    // Emitió host.list_workspaces.ok (debug) + host.reconcile.tick.
    // Tick 1 (debounce, sin persistir) → debug; tick 2 (aplica idle, persiste) → info.
    // Miramos el ÚLTIMO tick (el de tick 2, que sí cambió estado).
    const listOk = events.find((e) => e.msg === 'host.list_workspaces.ok');
    const tickEvents = events.filter((e) => e.msg === 'host.reconcile.tick');
    const lastTick = tickEvents[tickEvents.length - 1];
    assert.ok(listOk, 'emite host.list_workspaces.ok');
    assert.equal(listOk.level, 'debug', 'host.list_workspaces.ok a nivel debug (LOG-hygiene: heartbeat no infla el NDJSON)');
    assert.ok(lastTick, 'emite host.reconcile.tick');
    assert.equal(lastTick.level, 'info', 'tick que persiste cambio → info');
  });

  it('tick idle (sin rescued/sealed/transitioned) emite host.reconcile.tick a nivel debug (LOG-hygiene)', async () => {
    // Sin sesiones → reconcileTick no rescata/sella/transiciona nada. El heartbeat idle
    // NO debe emitirse a info (era la causa del bloat de reconcile.ndjson: ~info cada 2.5s).
    const state = { schema_version: 3, sessions: {}, history: [] };
    const host = { listWorkspaces: async () => [] };
    const { logger, events } = makeLogger();
    await runReconcileTick({ host, loadState: () => state, saveState: () => {}, debounceStore: new Map(), tick: 1, now: () => NOW, logger, pgrep: () => '' });

    const tickEv = events.find((e) => e.msg === 'host.reconcile.tick');
    const listOk = events.find((e) => e.msg === 'host.list_workspaces.ok');
    assert.ok(tickEv, 'emite host.reconcile.tick');
    assert.equal(tickEv.level, 'debug', 'tick idle → debug (no info)');
    assert.deepEqual(
      { rescued: tickEv.fields.rescued, sealed: tickEv.fields.sealed, transitioned: tickEv.fields.transitioned },
      { rescued: 0, sealed: 0, transitioned: 0 },
      'el tick idle no tuvo acción',
    );
    assert.ok(listOk, 'emite host.list_workspaces.ok');
    assert.equal(listOk.level, 'debug', 'list_workspaces.ok a nivel debug también en idle');
  });

  it('host throws → fail event + skip (never-throws, no persiste)', async () => {
    const state = { schema_version: 3, sessions: { t1: session() }, history: [] };
    let saved = null;
    const host = { listWorkspaces: async () => { throw Object.assign(new Error('cmux down'), { code: 'ENOENT' }); } };
    const { logger, events } = makeLogger();

    await runReconcileTick({ host, loadState: () => state, saveState: (s) => { saved = s; }, debounceStore: new Map(), tick: 1, now: () => NOW, logger, pgrep: () => '' });

    assert.equal(saved, null, 'host fail → no persiste');
    const fail = events.find((e) => e.msg === 'host.list_workspaces.fail');
    assert.ok(fail, 'emite host.list_workspaces.fail');
    assert.equal(fail.fields.code, 'ENOENT');
  });
});

describe('isSessionProcessAlive — derivación de process_alive por session_id', () => {
  it('pgrep retorna PIDs → proceso vivo (true)', () => {
    const pgrep = (sid) => { assert.match(sid, /2731b953/); return '63893\n'; };
    assert.equal(isSessionProcessAlive('2731b953-548f', pgrep), true);
  });

  it('pgrep retorna vacío → proceso muerto (false)', () => {
    assert.equal(isSessionProcessAlive('dead-sess', () => ''), false);
  });

  it('pgrep lanza (p.ej. exit 1 = sin match) → fail-safe: proceso muerto (false)', () => {
    // pgrep sale con código 1 cuando no hay match → execFileSync lanza. Tratamos
    // "lanza por no-match" como muerto. Cualquier otro error también → muerto
    // (conservador hacia idle es seguro: el peor caso es marcar idle algo vivo,
    //  que el siguiente tick corrige cuando pgrep vuelva a encontrarlo).
    assert.equal(isSessionProcessAlive('x', () => { throw new Error('no match'); }), false);
  });
});

describe('runReconcileTick — deriva process_alive del proceso real (cierra gap Plan 04)', () => {
  it('proceso VIVO + tab viva → mantiene running (no transiciona a idle)', async () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ session_id: 'sess-vivo', state: 'running', process_alive: true }) },
      history: [],
    };
    let saved = null;
    const host = { listWorkspaces: async () => [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }] };
    const debounceStore = new Map();
    // pgrep encuentra el proceso → vivo.
    const pgrep = () => '999\n';

    for (let t = 1; t <= 3; t++) {
      await runReconcileTick({ host, loadState: () => (saved ?? state), saveState: (s) => { saved = s; }, debounceStore, tick: t, now: () => NOW, pgrep });
    }
    // Sigue running: proceso vivo, nunca debe transicionar a idle.
    assert.equal((saved ?? state).sessions.t1.state, 'running');
  });

  it('proceso MUERTO + tab viva → deriva process_alive:false → transiciona a idle (Escenario A / ROMAN-151-152)', async () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ session_id: 'sess-muerto', state: 'running', process_alive: true }) },
      history: [],
    };
    let cur = state;
    const host = { listWorkspaces: async () => [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }] };
    const debounceStore = new Map();
    // pgrep NO encuentra el proceso → muerto. El reconciliador debe derivar
    // process_alive:false y, tras debouncing 2-tick, transicionar a idle.
    const pgrep = () => '';

    for (let t = 1; t <= 2; t++) {
      await runReconcileTick({ host, loadState: () => cur, saveState: (s) => { cur = s; }, debounceStore, tick: t, now: () => NOW, pgrep });
    }
    assert.equal(cur.sessions.t1.state, 'idle', 'proceso muerto + tab viva → idle (la sesión NO se pierde)');
    assert.equal(cur.sessions.t1.process_alive, false, 'process_alive derivado a false');
    assert.equal(cur.sessions.t1.tab_alive, true, 'tab sigue viva');
  });
});

describe('sesión zombi: proceso muerto sostenido + tab viva → dead (KODO-15)', () => {
  const beyond = new Date(NOW - PROCESS_DEAD_GRACE_MS - 1000).toISOString();
  const within = new Date(NOW - 30 * 1000).toISOString();
  const liveTab = [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }];

  it('isProcessDeadBeyondGrace: solo true con reloj parseable y vencido', () => {
    assert.equal(isProcessDeadBeyondGrace({ process_alive: false, process_dead_since: beyond }, NOW), true);
    assert.equal(isProcessDeadBeyondGrace({ process_alive: false, process_dead_since: within }, NOW), false);
    assert.equal(isProcessDeadBeyondGrace({ process_alive: false, process_dead_since: null }, NOW), false);
    assert.equal(isProcessDeadBeyondGrace({ process_alive: false, process_dead_since: 'basura' }, NOW), false);
    // Proceso vivo: el reloj (stale) no manda.
    assert.equal(isProcessDeadBeyondGrace({ process_alive: true, process_dead_since: beyond }, NOW), false);
  });

  it('reloj vencido + tab viva → dead al 2º tick, con dead_since y tab_alive:true', () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ state: 'idle', process_alive: false, process_dead_since: beyond }) },
      history: [],
    };
    const debounceStore = new Map();

    const r1 = reconcileTick(state, liveTab, { debounceStore, tick: 1, now: NOW });
    assert.equal(r1.state.sessions.t1.state, 'idle', 'tick 1: aún idle (debouncing hacia dead)');

    const r2 = reconcileTick(r1.state, liveTab, { debounceStore, tick: 2, now: NOW });
    const s = r2.state.sessions.t1;
    assert.equal(s.state, 'dead', 'tick 2: zombi → dead aunque la tab siga abierta');
    assert.ok(s.dead_since, 'dead_since fijado — es lo que consume el orphan sweep');
    assert.equal(s.tab_alive, true, 'la tab sigue viva: el hecho no se falsea');
    assert.equal(s.alive, false, 'el agregado de compat refleja la muerte');
  });

  it('dentro de la ventana de gracia → sigue idle (un tick suelto de pgrep no mata nada)', () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ state: 'idle', process_alive: false, process_dead_since: within }) },
      history: [],
    };
    const debounceStore = new Map();
    const r1 = reconcileTick(state, liveTab, { debounceStore, tick: 1, now: NOW });
    const r2 = reconcileTick(r1.state, liveTab, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'idle', 'la gracia protege del flapping de la detección');
  });

  it('SIN reloj (proceso nunca observado vivo: adoptada / reanudada con --resume) → idle indefinido', () => {
    // Su `process_alive:false` es un falso negativo del pgrep (la cmdline no lleva
    // `--session-id`), NO una muerte. Matarla generaría un comentario de cierre
    // incompleto sobre una sesión que está trabajando.
    const state = {
      schema_version: 3,
      sessions: { t1: session({ state: 'idle', process_alive: false }) },
      history: [],
    };
    const debounceStore = new Map();
    let cur = state;
    for (let t = 1; t <= 6; t++) {
      cur = reconcileTick(cur, liveTab, { debounceStore, tick: t, now: NOW + t * 60 * 60 * 1000 }).state;
    }
    assert.equal(cur.sessions.t1.state, 'idle', 'sin muerte observada no hay transición a dead');
  });

  it('el reloj vencido gana a needs_input (una notificación sin proceso detrás es residuo)', () => {
    const state = {
      schema_version: 3,
      sessions: { t1: session({ state: 'idle', process_alive: false, process_dead_since: beyond }) },
      history: [],
    };
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, needs_input: true }];
    const debounceStore = new Map();
    const r1 = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'dead', 'dead, no needs-input');
  });

  it('el rescate desde history limpia el reloj heredado (no regresa a dead al tick siguiente)', () => {
    const state = {
      schema_version: 3,
      sessions: {},
      history: [
        {
          ...session({ task_id: 'h1', task_ref: 'KL-5', workspace_ref: 'workspace:1', state: 'dead', process_alive: false, process_dead_since: beyond }),
          ended_at: new Date(NOW - 1000).toISOString(),
        },
      ],
    };
    const debounceStore = new Map();
    const r1 = reconcileTick(state, liveTab, { debounceStore, tick: 1, now: NOW });
    assert.equal(r1.state.sessions.h1.state, 'idle', 'rescatada');
    assert.equal(r1.state.sessions.h1.process_dead_since, null, 'reloj reiniciado al revivir');

    const r2 = reconcileTick(r1.state, liveTab, { debounceStore, tick: 2, now: NOW });
    const r3 = reconcileTick(r2.state, liveTab, { debounceStore, tick: 3, now: NOW });
    assert.equal(r3.state.sessions.h1.state, 'idle', 'sigue viva: el rescate no regresa');
  });
});

describe('runReconcileTick — reloj process_dead_since (KODO-15)', () => {
  const host = { listWorkspaces: async () => [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }] };

  // NOTA sobre los 2 ticks: el refresco de `process_alive` (y con él el sello del
  // reloj) solo llega a disco en el tick que ADEMÁS persiste algo — la optimización
  // de no-write descarta el clon del tick que se queda en debounce y lo recalcula al
  // siguiente. El desfase es de un tick (~2.5 s) frente a una gracia de 2 min.

  it('fija el reloj en la transición OBSERVADA vivo→muerto y no lo re-arranca en cada tick', async () => {
    let cur = {
      schema_version: 3,
      sessions: { t1: session({ session_id: 'sess-kill', state: 'running', process_alive: true }) },
      history: [],
    };
    const debounceStore = new Map();
    let clock = NOW;
    const run = (t) => runReconcileTick({
      host, loadState: () => cur, saveState: (s) => { cur = s; }, debounceStore, tick: t, now: () => clock, pgrep: () => '',
    });

    await run(1);
    await run(2);
    const stamped = cur.sessions.t1.process_dead_since;
    assert.ok(stamped, 'muerte observada → reloj sellado');
    assert.equal(cur.sessions.t1.process_alive, false);

    clock += 60 * 1000; // el reloj NO puede reiniciarse solo porque el proceso siga muerto
    await run(3);
    assert.equal(cur.sessions.t1.process_dead_since, stamped, 'el reloj corre, no se re-sella');
  });

  it('el proceso reaparece → limpia el reloj (nada de muerte diferida)', async () => {
    let cur = {
      schema_version: 3,
      sessions: { t1: session({ session_id: 'sess-flap', state: 'running', process_alive: true }) },
      history: [],
    };
    const debounceStore = new Map();
    let procAlive = false;
    const run = (t) => runReconcileTick({
      host, loadState: () => cur, saveState: (s) => { cur = s; }, debounceStore, tick: t, now: () => NOW, pgrep: () => (procAlive ? '4321\n' : ''),
    });

    await run(1);
    await run(2);
    assert.ok(cur.sessions.t1.process_dead_since, 'pgrep dejó de ver el proceso → reloj sellado');

    procAlive = true;
    await run(3);
    await run(4);
    assert.equal(cur.sessions.t1.process_dead_since, null, 'proceso de vuelta → reloj limpio');
    assert.equal(cur.sessions.t1.process_alive, true);
    assert.equal(cur.sessions.t1.state, 'running', 'y la sesión vuelve a running');
  });

  it('sesión cuyo proceso NUNCA se observó vivo → no se le sella reloj', async () => {
    let cur = {
      schema_version: 3,
      // Nace sin `process_alive` (buildSessionFromTask / buildSessionFromAdoption lo omiten:
      // es campo reconcile-owned) y el pgrep no la encuentra nunca.
      sessions: { t1: { ...session({ session_id: 'sess-adoptada', state: 'running' }), process_alive: undefined } },
      history: [],
    };
    const debounceStore = new Map();
    const run = (t) => runReconcileTick({
      host, loadState: () => cur, saveState: (s) => { cur = s; }, debounceStore, tick: t, now: () => NOW, pgrep: () => '',
    });

    await run(1);
    await run(2);
    assert.equal(cur.sessions.t1.process_dead_since ?? null, null, 'sin muerte observada, sin reloj');
    assert.equal(cur.sessions.t1.state, 'idle', 'degrada a idle como siempre, nunca a dead');
  });

  it('E2E: kill -9 con la tab abierta → dead → el orphan sweep la ve como candidata', async () => {
    let cur = {
      schema_version: 3,
      sessions: { t1: session({ session_id: 'sess-zombi', task_id: 't1', state: 'running', process_alive: true }) },
      history: [],
    };
    const debounceStore = new Map();
    let clock = NOW;
    let procAlive = true;
    const run = (t) => runReconcileTick({
      host, loadState: () => cur, saveState: (s) => { cur = s; }, debounceStore, tick: t, now: () => clock, pgrep: () => (procAlive ? '777\n' : ''),
    });

    await run(1);
    assert.equal(cur.sessions.t1.state, 'running', 'sesión sana');

    procAlive = false; // kill -9, la tab de cmux sigue abierta
    await run(2);
    await run(3);
    assert.equal(cur.sessions.t1.state, 'idle', 'primero degrada a idle (dentro de la gracia)');

    clock += PROCESS_DEAD_GRACE_MS + 1000;
    await run(4);
    await run(5);
    assert.equal(cur.sessions.t1.state, 'dead', 'gracia vencida → dead pese a la tab viva');
    assert.ok(cur.sessions.t1.dead_since, 'dead_since: la señal que consume el sweep');

    // El barrido de huérfanas (KODO-11) la recoge igual que en el caso de tab cerrada.
    assert.equal(isOrphanCandidate(cur.sessions.t1, clock), false, 'aún dentro de la gracia del sweep');
    assert.equal(isOrphanCandidate(cur.sessions.t1, clock + ORPHAN_GRACE_MS + 1000), true, 'pasada su gracia, es candidata');
  });
});

describe('titleIdentifiesSession — token con límite de palabra (anti-prefijo, anti-ReDoS)', () => {
  it('casa el task_ref al inicio del título', () => {
    assert.equal(titleIdentifiesSession('ROMAN-170 [FVF]: Nueva página', 'ROMAN-170'), true);
  });
  it('NO casa por prefijo: "ROMAN-17" no identifica "ROMAN-170"', () => {
    assert.equal(titleIdentifiesSession('ROMAN-170 [FVF]: …', 'ROMAN-17'), false);
    assert.equal(titleIdentifiesSession('ROMAN-1700 [X]', 'ROMAN-170'), false);
  });
  it('casa rodeado de separadores no-alfanuméricos', () => {
    assert.equal(titleIdentifiesSession('[KL-42] build', 'KL-42'), true);
    assert.equal(titleIdentifiesSession('fix KL-42: stuff', 'KL-42'), true);
  });
  it('título o task_ref ausente → false', () => {
    assert.equal(titleIdentifiesSession(undefined, 'KL-1'), false);
    assert.equal(titleIdentifiesSession('KL-1 foo', undefined), false);
  });
  it('anti-ReDoS: un título patológico resuelve al instante (String.includes, no RegExp)', () => {
    assert.equal(titleIdentifiesSession('a'.repeat(100000) + '!', 'ROMAN-170'), false);
  });
});

describe('reconcileTick — guard de identidad sobre workspace_ref reciclado (cmux reusa workspace:N)', () => {
  // El escenario real (2026-06-08): ROMAN-160 cerrada conserva workspace_ref=workspace:4;
  // cmux reasignó workspace:4 a ROMAN-170 (viva). Sin guard, 160 heredaba el alive de 170.
  it('ref vivo pero con título de OTRA sesión → la sesión va a dead (no hereda alive)', () => {
    const ghost = session({
      task_id: 't160', task_ref: 'ROMAN-160', workspace_ref: 'workspace:4',
      state: 'idle', process_alive: false,
    });
    const state = { schema_version: 3, sessions: { t160: ghost }, history: [] };
    // workspace:4 está vivo, pero su título es el de ROMAN-170, no el de 160.
    const liveRefs = [{ workspace_ref: 'workspace:4', alive: true, needs_input: false, title: 'ROMAN-170 [FVF]: Nueva página' }];
    const debounceStore = new Map();

    const r1 = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    assert.equal(r1.state.sessions.t160.state, 'idle', 'tick 1: aún idle (debouncing hacia dead)');
    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t160.state, 'dead', 'tick 2: ref reciclado → dead (ya no de polizón sobre 170)');
  });

  it('ref vivo con título que SÍ identifica a la sesión → permanece viva (idle)', () => {
    const live160 = session({
      task_id: 't160', task_ref: 'ROMAN-160', workspace_ref: 'workspace:4',
      state: 'idle', process_alive: false,
    });
    const state = { schema_version: 3, sessions: { t160: live160 }, history: [] };
    const liveRefs = [{ workspace_ref: 'workspace:4', alive: true, needs_input: false, title: 'ROMAN-160 [OptiAI]: algo' }];
    const debounceStore = new Map();

    const r1 = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t160.state, 'idle', 'título casa → sigue idle (viva)');
  });

  it('compat: liveRef sin título → comportamiento previo (presencia = match, sigue viva)', () => {
    const s = session({ task_ref: 'KL-1', workspace_ref: 'workspace:1', state: 'idle', process_alive: false });
    const state = { schema_version: 3, sessions: { t1: s }, history: [] };
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }]; // sin title
    const debounceStore = new Map();
    const r1 = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'idle', 'sin título no cambia el comportamiento (sigue viva)');
  });

  it('rescate desde history NO revive una entry si su ref reciclado pertenece a otra sesión', () => {
    const ended = {
      ...session({ task_id: 't160', task_ref: 'ROMAN-160', workspace_ref: 'workspace:4', state: 'dead' }),
      ended_at: new Date(NOW - 1000).toISOString(),
    };
    const state = { schema_version: 3, sessions: {}, history: [ended] };
    const liveRefs = [{ workspace_ref: 'workspace:4', alive: true, needs_input: false, title: 'ROMAN-170 [FVF]: otra' }];
    const debounceStore = new Map();
    const r = reconcileTick(state, liveRefs, { debounceStore, tick: 1, now: NOW });
    assert.equal(r.state.sessions.t160, undefined, 'NO revive: el ref vivo es de ROMAN-170, no de 160');
    assert.equal(r.state.history.length, 1, 'la entry permanece en history');
    assert.equal(r.events.rescued, 0, 'rescued=0');
  });
});
