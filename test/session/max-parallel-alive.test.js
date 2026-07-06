// @ts-check
//
// test/session/max-parallel-alive.test.js — Phase 70 Plan 03 Task 3 (CONC-03 / D-05 / D-06b).
//
// El gate de max_parallel (src/session/manager.js) cuenta un slot solo cuando
// `isSchedulable(s)` — es decir `status === 'running' && alive !== false`. Un zombi
// que reconcile marcó `alive:false` libera su slot (audit A4: la fuga de capacidad
// más dañina — un slot retenido hasta 30 días).
//
// D-06b / Pitfall 2 (CRÍTICO): `alive` se deriva de la liveness de la TAB del
// workspace de cmux (reconcileTick), NO del PID del proceso Claude. Un `kill -9` que
// mata SOLO el proceso pero deja la TAB viva produce `alive:true` → el gate lo SIGUE
// contando (correcto). Por eso el zombi de este test se produce por MUERTE DE TAB
// (el workspace_ref desaparece de listWorkspaces → reconcile deriva alive:false),
// no por un bare kill del proceso. Se ejercita la derivación REAL vía reconcileTick,
// y además se documenta el caso kill-9 (tab viva) que NO debe liberar el slot.
//
// Ambos sujetos (isSchedulable, reconcileTick) son puros/inyectables → sin FS ni HOME.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSchedulable } from '../../src/session/manager.js';
import { reconcileTick } from '../../src/session/reconcile.js';

/** Session record mínima con los campos que lee el gate + los que usa reconcile. */
function runningSession(taskId, ref, overrides = {}) {
  return {
    workspace_ref: ref,
    session_id: 'sess-' + taskId,
    task_id: taskId,
    task_ref: 'KL-' + taskId,
    provider: 'plane',
    status: 'running',   // outcome (lo lee el gate)
    state: 'running',    // liveness (lo escribe reconcile)
    process_alive: true,
    alive: true,         // liveness agregada (lo lee el gate)
    started_at: '2026-07-06T10:00:00.000Z',
    project_path: '/dev/kodo',
    ...overrides,
  };
}

describe('isSchedulable — gate de max_parallel (CONC-03 / D-05)', () => {
  it('running + alive:true → cuenta (ocupa slot)', () => {
    assert.equal(isSchedulable(runningSession('1', 'workspace:1')), true);
  });

  it('running + alive:false (zombi) → NO cuenta (libera slot)', () => {
    assert.equal(isSchedulable(runningSession('2', 'workspace:2', { alive: false })), false);
  });

  it('legacy sin campo alive → SÍ cuenta (no regresión, `!== false` no `=== true`)', () => {
    const legacy = runningSession('3', 'workspace:3');
    delete legacy.alive;
    assert.equal(isSchedulable(legacy), true, 'sesiones pre-v0.9 sin `alive` siguen contando');
  });

  it('status !== running (done/review/error) → NO cuenta', () => {
    assert.equal(isSchedulable(runningSession('4', 'workspace:4', { status: 'done' })), false);
    assert.equal(isSchedulable(runningSession('5', 'workspace:5', { status: 'review' })), false);
  });
});

describe('gate simulation — el zombi libera el slot (D-05)', () => {
  it('1 running+alive + 1 zombi(alive:false), max_parallel=2 → un launch se admite', () => {
    const sessions = [
      runningSession('a', 'workspace:1'),                     // vivo → cuenta
      runningSession('b', 'workspace:2', { alive: false }),   // zombi → NO cuenta
    ];
    const active = sessions.filter(isSchedulable);
    const MAX_PARALLEL = 2;
    assert.equal(active.length, 1, 'el zombi no ocupa slot; solo 1 sesión viva cuenta');
    assert.ok(active.length < MAX_PARALLEL, 'hay hueco → launchWorkItem admitiría una nueva sesión');
  });

  it('2 running+alive, max_parallel=2 → gate lleno (sin zombi que engañe)', () => {
    const sessions = [
      runningSession('a', 'workspace:1'),
      runningSession('b', 'workspace:2'),
    ];
    const active = sessions.filter(isSchedulable);
    assert.equal(active.length, 2, 'dos sesiones vivas llenan el gate');
    assert.ok(active.length >= 2, 'sin hueco → launchWorkItem lanzaría "Max parallel reached"');
  });
});

// ---------------------------------------------------------------------------
// D-06b / Pitfall 2: alive:false debe venir de la MUERTE DE TAB, no de kill -9.
//
// Se conduce la derivación REAL de `alive` vía reconcileTick: el workspace_ref del
// zombi DESAPARECE de listWorkspaces (la tab de cmux murió) → live=undefined →
// deriveTarget='dead' → tras DEBOUNCE_TICKS (2) transición a state:'dead' con
// alive:false. Entonces isSchedulable lo excluye y el slot queda libre.
// ---------------------------------------------------------------------------
describe('D-06b: reconcile deriva alive:false por muerte de TAB → libera slot', () => {
  it('workspace_ref ausente en listWorkspaces (tab muerta) → alive:false tras debounce → excluido', () => {
    let state = {
      schema_version: 3,
      sessions: {
        keep: runningSession('keep', 'workspace:1'),  // tab VIVA
        zomb: runningSession('zomb', 'workspace:2'),  // tab MORIRÁ
      },
      history: [],
    };
    const debounceStore = new Map();
    // liveRefs OMITE workspace:2 (su tab murió). workspace:1 sigue vivo.
    // title:null → liveForSession casa por presencia del ref (adapter sin title).
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, title: null }];

    // DEBOUNCE_TICKS = 2: hacen falta 2 ticks consecutivos con target='dead' para aplicar.
    for (let tick = 1; tick <= 2; tick++) {
      ({ state } = reconcileTick(state, liveRefs, {
        debounceStore,
        tick,
        now: Date.parse('2026-07-06T12:00:00.000Z') + tick * 2500,
        logger: { warn() {} },
      }));
    }

    const keep = state.sessions.keep;
    const zomb = state.sessions.zomb;
    assert.equal(zomb.state, 'dead', 'la tab muerta transiciona a state:dead (derivación real)');
    assert.equal(zomb.alive, false, 'reconcile (único escritor) derivó alive:false por muerte de TAB');
    assert.equal(keep.alive, true, 'la tab viva mantiene alive:true');

    // El gate ahora excluye al zombi y cuenta solo la sesión viva.
    const active = Object.values(state.sessions).filter(isSchedulable);
    assert.equal(active.length, 1, 'tras la muerte de tab el zombi libera su slot');
    assert.deepEqual(active.map((s) => s.task_id), ['keep']);
  });

  it('kill -9 al proceso pero TAB VIVA → alive sigue true → el gate lo SIGUE contando (correcto)', () => {
    // Documenta el contraejemplo de D-06b: matar el proceso Claude (process_alive
    // pasaría a false) pero con la TAB aún presente en listWorkspaces produce
    // target='idle' (live.alive && !process_alive) → alive:true. NO libera slot.
    let state = {
      schema_version: 3,
      sessions: {
        proc_dead: runningSession('procdead', 'workspace:1', { process_alive: false }),
      },
      history: [],
    };
    const debounceStore = new Map();
    // La tab SIGUE viva (presente en listWorkspaces) aunque el proceso murió.
    const liveRefs = [{ workspace_ref: 'workspace:1', alive: true, title: null }];

    for (let tick = 1; tick <= 2; tick++) {
      ({ state } = reconcileTick(state, liveRefs, {
        debounceStore,
        tick,
        now: Date.parse('2026-07-06T12:00:00.000Z') + tick * 2500,
        logger: { warn() {} },
      }));
    }

    const s = state.sessions.proc_dead;
    assert.notEqual(s.state, 'dead', 'tab viva → NO es dead (idle/needs-input), aunque el proceso murió');
    assert.equal(s.alive, true, 'alive se deriva de la TAB, no del PID → sigue true');
    assert.equal(isSchedulable(s), true, 'el gate SIGUE contando la sesión con tab viva (un kill -9 no libera slot)');
  });
});
