// @ts-check
//
// test/session/auto-dismiss.test.js — KODO-83 (auto-dismiss de filas dead).
//
// El barrido es I/O de red (provider) + I/O de git (worktree) + una mutación destructiva
// delegada, así que TODO se inyecta: lector de state, escritor, provider, git, probe de
// existencia, dismiss y reloj. Ni FS ni red ni timers reales — mismo estilo DI que
// test/session/orphan-sweep.test.js.
//
// Lo que esta suite pinea es la REGLA, que es lo único que no puede cambiar sin que
// alguien pierda trabajo: las tres condiciones se exigen a la vez, y toda rama de duda
// (provider caído, git mudo, dismiss sin 200) deja la fila donde estaba.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAutoDismissCandidate,
  isClosedTaskState,
  worktreePathsFor,
  inspectWorktrees,
  runAutoDismissSweep,
  AUTO_DISMISS_GRACE_MS,
  AUTO_DISMISS_RETRY_MS,
} from '../../src/session/auto-dismiss.js';
import { startOrphanSweepLoop } from '../../src/session/orphan-sweep.js';

const T0 = Date.parse('2026-09-03T10:00:00.000Z');
const now = () => T0;

/** Sesión dead que cumple la condición 1, con los campos que el barrido mira. */
function makeDeadSession(overrides = {}) {
  return {
    task_id: 'task-uuid-1',
    task_ref: 'KODO-78',
    task_url: 'https://plane.example/KODO-78',
    project_id: 'proj-1',
    project_path: '/repo',
    session_id: 'sess-abc',
    provider: 'plane',
    state: 'dead',
    process_alive: false,
    dead_since: new Date(T0 - 30 * 60 * 1000).toISOString(),
    worktree_path: '/repo/.claude/worktrees/sess-abc',
    ...overrides,
  };
}

function makeSpyLogger() {
  const records = [];
  const capture = (level) => (event, fields) => records.push({ level, event, fields });
  return {
    records,
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
  };
}

/** Provider stub. `state` es lo que devuelve getTaskState; `throws` simula red caída. */
function makeProvider(opts = {}) {
  const calls = { getTaskState: [] };
  const provider = {
    calls,
    async getTaskState(task) {
      calls.getTaskState.push(task);
      if (opts.throws) throw new Error('getTaskState network down');
      return opts.state ?? 'done';
    },
  };
  for (const m of opts.omit || []) delete provider[m];
  return provider;
}

/**
 * Mundo de ficheros y git in-memory.
 *   `present`: paths que existen.
 *   `dirty`:   paths cuyo `status --porcelain` devuelve algo.
 *   `gitThrows`: paths sobre los que git lanza.
 */
function makeWorld({ present = [], dirty = [], gitThrows = [] } = {}) {
  const calls = { exists: [], git: [] };
  return {
    calls,
    existsFn(path) {
      calls.exists.push(path);
      return present.includes(path);
    },
    gitFn(cwd, args) {
      calls.git.push({ cwd, args });
      if (gitThrows.includes(cwd)) throw new Error('fatal: not a git repository');
      return dirty.includes(cwd) ? ' M src/app.js' : '';
    },
  };
}

/** State in-memory + escritor que aplica los updates sobre él (como updateSession). */
function makeStateStore(sessions) {
  const state = { sessions };
  const updates = [];
  return {
    state,
    updates,
    loadStateFn: () => state,
    updateSessionFn: (taskId, patch) => {
      updates.push({ taskId, patch });
      if (state.sessions[taskId]) Object.assign(state.sessions[taskId], patch);
      return { ok: true };
    },
  };
}

/** Dismiss stub: registra las llamadas y devuelve lo que se le diga. */
function makeDismiss(res = { status: 200, body: { ok: true, actions: [{ type: 'state', result: 'removed' }] } }) {
  const calls = [];
  const fn = async (taskId) => {
    calls.push(taskId);
    if (res instanceof Error) throw res;
    return res;
  };
  fn.calls = calls;
  return fn;
}

/** El montaje feliz: sesión dead, tarea done, worktree ausente. */
function makeHappyDeps(overrides = {}) {
  const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
  const world = makeWorld({ present: [] });
  const provider = makeProvider({ state: 'done' });
  const dismissFn = makeDismiss();
  return {
    store,
    world,
    provider,
    dismissFn,
    deps: {
      loadStateFn: store.loadStateFn,
      updateSessionFn: store.updateSessionFn,
      dismissFn,
      provider,
      now,
      gitFn: world.gitFn,
      existsFn: world.existsFn,
      logger: makeSpyLogger(),
      ...overrides,
    },
  };
}

describe('isAutoDismissCandidate — condición 1 (proceso muerto)', () => {
  it('acepta una sesión dead con process_alive false pasada la gracia', () => {
    assert.equal(isAutoDismissCandidate(makeDeadSession(), T0), true);
  });

  it('rechaza una sesión que no está dead', () => {
    for (const state of ['running', 'idle', 'needs-input', 'closed', 'review', 'error']) {
      assert.equal(isAutoDismissCandidate(makeDeadSession({ state }), T0), false, state);
    }
  });

  it('rechaza si process_alive no es EXACTAMENTE false', () => {
    // `undefined` es «nadie lo ha observado» (sesión legacy sin migrar), no «está
    // muerto»: tratarlo como falsy pondría todas las entradas viejas en la cola de
    // borrado de worktrees.
    assert.equal(isAutoDismissCandidate(makeDeadSession({ process_alive: undefined }), T0), false);
    assert.equal(isAutoDismissCandidate(makeDeadSession({ process_alive: true }), T0), false);
  });

  it('rechaza dentro de la gracia y acepta justo al cumplirse', () => {
    const dentro = makeDeadSession({
      dead_since: new Date(T0 - AUTO_DISMISS_GRACE_MS + 1000).toISOString(),
    });
    const justo = makeDeadSession({
      dead_since: new Date(T0 - AUTO_DISMISS_GRACE_MS).toISOString(),
    });
    assert.equal(isAutoDismissCandidate(dentro, T0), false);
    assert.equal(isAutoDismissCandidate(justo, T0), true);
  });

  it('rechaza sin dead_since parseable (no hay reloj de gracia)', () => {
    assert.equal(isAutoDismissCandidate(makeDeadSession({ dead_since: undefined }), T0), false);
    assert.equal(isAutoDismissCandidate(makeDeadSession({ dead_since: 'ayer' }), T0), false);
  });

  it('rechaza sin task_id', () => {
    assert.equal(isAutoDismissCandidate(makeDeadSession({ task_id: '' }), T0), false);
  });

  it('respeta el backoff de auto_dismiss_attempt_at y vuelve a aceptar al vencer', () => {
    const reciente = makeDeadSession({
      auto_dismiss_attempt_at: new Date(T0 - AUTO_DISMISS_RETRY_MS + 1000).toISOString(),
    });
    const vencido = makeDeadSession({
      auto_dismiss_attempt_at: new Date(T0 - AUTO_DISMISS_RETRY_MS).toISOString(),
    });
    assert.equal(isAutoDismissCandidate(reciente, T0), false);
    assert.equal(isAutoDismissCandidate(vencido, T0), true);
  });
});

describe('isClosedTaskState — condición 2 (tarea cerrada)', () => {
  it('solo `done` cuenta como cerrado', () => {
    assert.equal(isClosedTaskState('done'), true);
    for (const s of ['in_progress', 'in_review', 'blocked', 'unknown', '', null, undefined]) {
      assert.equal(isClosedTaskState(/** @type {any} */ (s)), false, String(s));
    }
  });
});

describe('worktreePathsFor', () => {
  it('cubre el path persistido, el legacy .bg-shell y el real .claude/worktrees', () => {
    const paths = worktreePathsFor(makeDeadSession({ worktree_path: '/repo/.bg-shell/sess-abc' }));
    assert.deepEqual(paths, [
      '/repo/.bg-shell/sess-abc',
      '/repo/.claude/worktrees/sess-abc',
    ]);
  });

  it('deduplica cuando worktree_path ya es el path real', () => {
    const paths = worktreePathsFor(makeDeadSession());
    assert.deepEqual(paths, [
      '/repo/.claude/worktrees/sess-abc',
      '/repo/.bg-shell/sess-abc',
    ]);
  });

  it('tolera una sesión sin project_path ni session_id', () => {
    assert.deepEqual(worktreePathsFor(/** @type {any} */ ({})), []);
  });
});

describe('inspectWorktrees — condición 3 (worktree ausente o limpio)', () => {
  it('ningún path existe → absent, sin preguntar a git', async () => {
    const world = makeWorld({ present: [] });
    const v = await inspectWorktrees({ paths: ['/a', '/b'], ...world });
    assert.deepEqual(v, { status: 'absent', path: null });
    assert.equal(world.calls.git.length, 0);
  });

  it('existe y git no reporta nada → clean', async () => {
    const world = makeWorld({ present: ['/a'] });
    const v = await inspectWorktrees({ paths: ['/a', '/b'], ...world });
    assert.deepEqual(v, { status: 'clean', path: '/a' });
    assert.deepEqual(world.calls.git, [{ cwd: '/a', args: ['status', '--porcelain'] }]);
  });

  it('existe y git reporta cambios → dirty, y corta sin mirar el resto', async () => {
    const world = makeWorld({ present: ['/a', '/b'], dirty: ['/a'] });
    const v = await inspectWorktrees({ paths: ['/a', '/b'], ...world });
    assert.deepEqual(v, { status: 'dirty', path: '/a' });
    assert.equal(world.calls.git.length, 1);
  });

  it('un worktree limpio no tapa a otro sucio', async () => {
    const world = makeWorld({ present: ['/a', '/b'], dirty: ['/b'] });
    const v = await inspectWorktrees({ paths: ['/a', '/b'], ...world });
    assert.equal(v.status, 'dirty');
    assert.equal(v.path, '/b');
  });

  it('git lanza → unknown (no se puede afirmar que esté limpio)', async () => {
    const world = makeWorld({ present: ['/a'], gitThrows: ['/a'] });
    const v = await inspectWorktrees({ paths: ['/a'], ...world });
    assert.deepEqual(v, { status: 'unknown', path: '/a' });
  });

  it('el probe de existencia que lanza se lee como PRESENTE, no como ausente', async () => {
    // Un EACCES o un FUSE caído no autorizan a borrar: se asume presente y decide git.
    const calls = [];
    const v = await inspectWorktrees({
      paths: ['/a'],
      existsFn: () => {
        throw new Error('EACCES');
      },
      gitFn: (cwd, args) => {
        calls.push({ cwd, args });
        return ' M src/app.js';
      },
    });
    assert.deepEqual(v, { status: 'dirty', path: '/a' });
    assert.equal(calls.length, 1);
  });
});

describe('runAutoDismissSweep — las tres condiciones juntas', () => {
  it('las tres se cumplen → descarta, con traza y sin marca de backoff', async () => {
    const { deps, dismissFn, provider, store } = makeHappyDeps();
    const stats = await runAutoDismissSweep(deps);

    assert.deepEqual(stats, { candidates: 1, dismissed: 1, kept: 0, deferred: 0 });
    assert.deepEqual(dismissFn.calls, ['task-uuid-1']);
    assert.equal(provider.calls.getTaskState.length, 1);
    // La entrada desaparece con el dismiss: marcar el backoff sobraría.
    assert.deepEqual(store.updates, []);

    const evt = deps.logger.records.find((r) => r.event === 'session.auto_dismissed');
    assert.ok(evt, 'falta el evento session.auto_dismissed');
    assert.equal(evt.fields.task_id, 'task-uuid-1');
    assert.equal(evt.fields.task_state, 'done');
    assert.equal(evt.fields.worktree, 'absent');
    assert.equal(evt.fields.actions_count, 1);
  });

  it('worktree limpio también descarta', async () => {
    const world = makeWorld({ present: ['/repo/.claude/worktrees/sess-abc'] });
    const { deps, dismissFn } = makeHappyDeps({ gitFn: world.gitFn, existsFn: world.existsFn });
    const stats = await runAutoDismissSweep(deps);
    assert.equal(stats.dismissed, 1);
    assert.deepEqual(dismissFn.calls, ['task-uuid-1']);
  });

  it('worktree SUCIO → no se toca, y ni siquiera se pregunta al provider', async () => {
    const world = makeWorld({
      present: ['/repo/.claude/worktrees/sess-abc'],
      dirty: ['/repo/.claude/worktrees/sess-abc'],
    });
    const { deps, dismissFn, provider, store } = makeHappyDeps({
      gitFn: world.gitFn,
      existsFn: world.existsFn,
    });
    const stats = await runAutoDismissSweep(deps);

    assert.deepEqual(stats, { candidates: 1, dismissed: 0, kept: 1, deferred: 0 });
    assert.deepEqual(dismissFn.calls, []);
    assert.equal(provider.calls.getTaskState.length, 0, 'la condición local corta antes de la red');
    assert.equal(store.updates.length, 1);
    assert.ok(store.updates[0].patch.auto_dismiss_attempt_at);
  });

  it('tarea todavía abierta → no se toca', async () => {
    for (const state of ['in_progress', 'in_review', 'blocked', 'unknown']) {
      const { deps, dismissFn } = makeHappyDeps({ provider: makeProvider({ state }) });
      const stats = await runAutoDismissSweep(deps);
      assert.deepEqual(
        stats,
        { candidates: 1, dismissed: 0, kept: 1, deferred: 0 },
        `estado ${state}`,
      );
      assert.deepEqual(dismissFn.calls, []);
    }
  });

  it('provider CAÍDO → no descarta nada y aplaza', async () => {
    const { deps, dismissFn, store } = makeHappyDeps({ provider: makeProvider({ throws: true }) });
    const stats = await runAutoDismissSweep(deps);

    assert.deepEqual(stats, { candidates: 1, dismissed: 0, kept: 0, deferred: 1 });
    assert.deepEqual(dismissFn.calls, []);
    assert.ok(store.updates[0].patch.auto_dismiss_attempt_at, 'aplaza el reintento');
    assert.ok(deps.logger.records.some((r) => r.event === 'session.auto_dismiss.getstate_failed'));
  });

  it('git mudo sobre un worktree presente → no descarta nada y aplaza', async () => {
    const world = makeWorld({
      present: ['/repo/.claude/worktrees/sess-abc'],
      gitThrows: ['/repo/.claude/worktrees/sess-abc'],
    });
    const { deps, dismissFn } = makeHappyDeps({ gitFn: world.gitFn, existsFn: world.existsFn });
    const stats = await runAutoDismissSweep(deps);

    assert.deepEqual(stats, { candidates: 1, dismissed: 0, kept: 0, deferred: 1 });
    assert.deepEqual(dismissFn.calls, []);
  });

  it('un dismiss que no devuelve 200 NO cuenta como descarte', async () => {
    for (const res of [{ status: 409, body: { ok: false } }, { status: 500, body: {} }, null]) {
      const { deps } = makeHappyDeps({ dismissFn: makeDismiss(res) });
      const stats = await runAutoDismissSweep(deps);
      assert.deepEqual(
        stats,
        { candidates: 1, dismissed: 0, kept: 0, deferred: 1 },
        `status ${res?.status}`,
      );
      assert.ok(!deps.logger.records.some((r) => r.event === 'session.auto_dismissed'));
    }
  });

  it('un dismiss que LANZA no tumba el barrido', async () => {
    const { deps } = makeHappyDeps({ dismissFn: makeDismiss(new Error('doctor exploded')) });
    const stats = await runAutoDismissSweep(deps);
    assert.deepEqual(stats, { candidates: 1, dismissed: 0, kept: 0, deferred: 1 });
  });

  it('una sesión que no es candidata no gasta ni git ni red', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession({ state: 'running', process_alive: true }) });
    const world = makeWorld({ present: [] });
    const provider = makeProvider();
    const dismissFn = makeDismiss();
    const stats = await runAutoDismissSweep({
      loadStateFn: store.loadStateFn,
      updateSessionFn: store.updateSessionFn,
      dismissFn,
      provider,
      now,
      gitFn: world.gitFn,
      existsFn: world.existsFn,
    });
    assert.deepEqual(stats, { candidates: 0, dismissed: 0, kept: 0, deferred: 0 });
    assert.equal(world.calls.exists.length, 0);
    assert.equal(provider.calls.getTaskState.length, 0);
    assert.deepEqual(dismissFn.calls, []);
  });

  it('varias sesiones: descarta las que cumplen y deja las que no', async () => {
    const store = makeStateStore({
      limpia: makeDeadSession({ task_id: 'limpia', session_id: 's1', worktree_path: '/wt/limpia' }),
      sucia: makeDeadSession({ task_id: 'sucia', session_id: 's2', worktree_path: '/wt/sucia' }),
      viva: makeDeadSession({ task_id: 'viva', session_id: 's3', state: 'running', process_alive: true }),
    });
    const world = makeWorld({ present: ['/wt/sucia'], dirty: ['/wt/sucia'] });
    const dismissFn = makeDismiss();
    const stats = await runAutoDismissSweep({
      loadStateFn: store.loadStateFn,
      updateSessionFn: store.updateSessionFn,
      dismissFn,
      provider: makeProvider({ state: 'done' }),
      now,
      gitFn: world.gitFn,
      existsFn: world.existsFn,
    });
    assert.deepEqual(stats, { candidates: 2, dismissed: 1, kept: 1, deferred: 0 });
    assert.deepEqual(dismissFn.calls, ['limpia']);
  });
});

describe('runAutoDismissSweep — gates y never-throws', () => {
  it('sin dismissFn es un no-op silencioso', async () => {
    const { deps, provider } = makeHappyDeps({ dismissFn: undefined });
    const stats = await runAutoDismissSweep(deps);
    assert.deepEqual(stats, { candidates: 0, dismissed: 0, kept: 0, deferred: 0 });
    assert.equal(provider.calls.getTaskState.length, 0);
  });

  it('un provider sin getTaskState es un no-op silencioso', async () => {
    const { deps, dismissFn } = makeHappyDeps({ provider: makeProvider({ omit: ['getTaskState'] }) });
    const stats = await runAutoDismissSweep(deps);
    assert.deepEqual(stats, { candidates: 0, dismissed: 0, kept: 0, deferred: 0 });
    assert.deepEqual(dismissFn.calls, []);
  });

  it('un loadState que lanza degrada a stats en cero, sin propagar', async () => {
    const { deps } = makeHappyDeps({
      loadStateFn: () => {
        throw new Error('state.json corrupto');
      },
    });
    const stats = await runAutoDismissSweep(deps);
    assert.deepEqual(stats, { candidates: 0, dismissed: 0, kept: 0, deferred: 0 });
    assert.ok(deps.logger.records.some((r) => r.event === 'session.auto_dismiss.load_failed'));
  });

  it('sin updateSessionFn funciona igual, solo pierde el backoff', async () => {
    const { deps, dismissFn } = makeHappyDeps({ updateSessionFn: undefined });
    const stats = await runAutoDismissSweep(deps);
    assert.equal(stats.dismissed, 1);
    assert.deepEqual(dismissFn.calls, ['task-uuid-1']);
  });

  it('sin logger no lanza', async () => {
    const { deps } = makeHappyDeps({ logger: undefined });
    const stats = await runAutoDismissSweep(deps);
    assert.equal(stats.dismissed, 1);
  });
});

describe('startOrphanSweepLoop — el tercer barrido del tick', () => {
  /** Timer stub: guarda el callback para dispararlo a mano. */
  function makeTimer() {
    let cb = null;
    return {
      setInterval: (fn) => {
        cb = fn;
        return { unref() {} };
      },
      clearInterval: () => {},
      tick: () => cb(),
    };
  }

  it('corre el auto-dismiss cuando se inyecta dismissFn', async () => {
    const timer = makeTimer();
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const world = makeWorld({ present: [] });
    const dismissFn = makeDismiss();
    const logger = makeSpyLogger();

    startOrphanSweepLoop({
      loadStateFn: store.loadStateFn,
      updateSessionFn: store.updateSessionFn,
      dismissFn,
      provider: makeProvider({ state: 'done' }),
      gitFn: world.gitFn,
      existsFn: world.existsFn,
      now,
      logger,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await timer.tick();

    assert.deepEqual(dismissFn.calls, ['task-uuid-1']);
    const sweep = logger.records.find((r) => r.event === 'session.auto_dismiss.sweep');
    assert.ok(sweep, 'falta el resumen del barrido');
    assert.equal(sweep.level, 'info', 'con candidatas el resumen va a info');
    assert.equal(sweep.fields.dismissed, 1);
  });

  it('sin dismissFn el loop se comporta como antes de KODO-83', async () => {
    const timer = makeTimer();
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const logger = makeSpyLogger();

    startOrphanSweepLoop({
      loadStateFn: store.loadStateFn,
      updateSessionFn: store.updateSessionFn,
      provider: makeProvider({ state: 'done' }),
      now,
      logger,
      setInterval: timer.setInterval,
      clearInterval: timer.clearInterval,
    });
    await timer.tick();

    assert.ok(!logger.records.some((r) => r.event === 'session.auto_dismiss.sweep'));
  });
});
