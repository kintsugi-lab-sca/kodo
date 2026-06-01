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

import { reconcileTick, runReconcileTick } from '../../src/session/reconcile.js';

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
    assert.deepEqual(debounceStore.get('workspace:1'), { pending_state: 'idle', tick_count: 1 });

    // Tick 2: mismo target → tick_count 2 → aplica.
    const r2 = reconcileTick(r1.state, liveRefs, { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'idle', 'tick 2: aplica idle');
    assert.equal(r2.state.sessions.t1.tab_alive, true);
    assert.equal(debounceStore.has('workspace:1'), false, 'debounce entry eliminada tras aplicar');
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
    assert.deepEqual(debounceStore.get('workspace:1'), { pending_state: 'idle', tick_count: 1 });

    // Tick 2: needs_input flip → target needs-input ≠ idle → RESET a count 1.
    const r2 = reconcileTick(r1.state, [{ workspace_ref: 'workspace:1', alive: true, needs_input: true }], { debounceStore, tick: 2, now: NOW });
    assert.equal(r2.state.sessions.t1.state, 'running', 'aún running — target cambió, reset');
    assert.deepEqual(debounceStore.get('workspace:1'), { pending_state: 'needs-input', tick_count: 1 });

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
    assert.equal(debounceStore.has('workspace:2'), false, 't2 estable NO genera debounce entry');
    // t1 en debounce.
    assert.deepEqual(debounceStore.get('workspace:1'), { pending_state: 'idle', tick_count: 1 });

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

    // Tick 1: debounce (no persiste — sin cambios).
    await runReconcileTick({ host, loadState: () => state, saveState: (s) => { saved = s; }, debounceStore, tick: 1, now: () => NOW, logger });
    assert.equal(saved, null, 'tick 1: sin cambios, no persiste');

    // Tick 2: aplica idle → persiste.
    let state2 = state;
    await runReconcileTick({ host, loadState: () => state2, saveState: (s) => { saved = s; state2 = s; }, debounceStore, tick: 2, now: () => NOW, logger });
    assert.ok(saved, 'tick 2: persiste el cambio');
    assert.equal(saved.sessions.t1.state, 'idle');

    // Emitió host.list_workspaces.ok + host.reconcile.tick.
    assert.ok(events.find((e) => e.msg === 'host.list_workspaces.ok'), 'emite host.list_workspaces.ok');
    assert.ok(events.find((e) => e.msg === 'host.reconcile.tick'), 'emite host.reconcile.tick');
  });

  it('host throws → fail event + skip (never-throws, no persiste)', async () => {
    const state = { schema_version: 3, sessions: { t1: session() }, history: [] };
    let saved = null;
    const host = { listWorkspaces: async () => { throw Object.assign(new Error('cmux down'), { code: 'ENOENT' }); } };
    const { logger, events } = makeLogger();

    await runReconcileTick({ host, loadState: () => state, saveState: (s) => { saved = s; }, debounceStore: new Map(), tick: 1, now: () => NOW, logger });

    assert.equal(saved, null, 'host fail → no persiste');
    const fail = events.find((e) => e.msg === 'host.list_workspaces.fail');
    assert.ok(fail, 'emite host.list_workspaces.fail');
    assert.equal(fail.fields.code, 'ENOENT');
  });
});
