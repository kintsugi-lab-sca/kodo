// @ts-check
//
// test/session/orphan-sweep.test.js — KODO-11 (tareas fantasma en «In Progress»).
//
// El sweep es I/O de red + escritura de state, así que TODO se inyecta: lector de
// state, escritor, provider y reloj. Ni FS ni red ni timers reales — mismo estilo DI
// que test/server/provider-state.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isOrphanCandidate,
  buildOrphanComment,
  runOrphanSweep,
  startOrphanSweepLoop,
  ORPHAN_GRACE_MS,
  ORPHAN_RETRY_MS,
} from '../../src/session/orphan-sweep.js';

const T0 = Date.parse('2026-07-15T10:00:00.000Z');

/** Sesión muerta hace `deadAgoMs`, con los campos que el sweep mira. */
function makeDeadSession(overrides = {}) {
  return {
    task_id: 'task-uuid-1',
    task_ref: 'LIKEN-120',
    task_url: 'https://plane.example/LIKEN-120',
    project_id: 'proj-1',
    session_id: 'sess-abc',
    provider: 'plane',
    state: 'dead',
    dead_since: new Date(T0 - 10 * 60 * 1000).toISOString(),
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

/**
 * Provider stub. `state` es lo que devuelve getTaskState; `getStateThrows` /
 * `commentThrows` simulan la caída de red.
 */
function makeProvider(opts = {}) {
  const calls = { getTaskState: [], addComment: [], updateTaskState: [] };
  const provider = {
    calls,
    async getTaskState(task) {
      calls.getTaskState.push(task);
      if (opts.getStateThrows) throw new Error('getTaskState network down');
      return opts.state;
    },
    async addComment(task, text) {
      calls.addComment.push({ task, text });
      if (opts.commentThrows) throw new Error('addComment network down');
    },
    async updateTaskState(task, stateName) {
      calls.updateTaskState.push({ task, stateName });
    },
  };
  for (const m of opts.omit || []) delete provider[m];
  return provider;
}

/** State in-memory + escritor que aplica los updates sobre él (como updateSession). */
function makeStateStore(sessions, tasks = {}) {
  const state = { sessions, tasks };
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

describe('KODO-11 isOrphanCandidate', () => {
  it('sesión dead pasada la gracia → candidata', () => {
    assert.equal(isOrphanCandidate(makeDeadSession(), T0), true);
  });

  it('sesión viva (running/idle) → NO candidata, sea cual sea el reloj', () => {
    assert.equal(isOrphanCandidate(makeDeadSession({ state: 'running' }), T0), false);
    assert.equal(isOrphanCandidate(makeDeadSession({ state: 'idle' }), T0), false);
  });

  it('dentro de la gracia → NO candidata (protege la carrera con un SessionEnd lento)', () => {
    const session = makeDeadSession({
      dead_since: new Date(T0 - (ORPHAN_GRACE_MS - 1000)).toISOString(),
    });
    assert.equal(isOrphanCandidate(session, T0), false);
  });

  it('sin dead_since parseable → NO candidata (sin reloj de gracia no se barre)', () => {
    assert.equal(isOrphanCandidate(makeDeadSession({ dead_since: undefined }), T0), false);
    assert.equal(isOrphanCandidate(makeDeadSession({ dead_since: 'no-fecha' }), T0), false);
  });

  it('ya barrida (orphan_swept_at) → NO candidata: la marca es TERMINAL', () => {
    const session = makeDeadSession({ orphan_swept_at: new Date(T0 - 1000).toISOString() });
    assert.equal(isOrphanCandidate(session, T0), false);
  });

  it('intento reciente fallido → aplazada; pasada la ventana de reintento → candidata otra vez', () => {
    const recent = makeDeadSession({ orphan_attempt_at: new Date(T0 - 60 * 1000).toISOString() });
    assert.equal(isOrphanCandidate(recent, T0), false);
    const old = makeDeadSession({
      orphan_attempt_at: new Date(T0 - (ORPHAN_RETRY_MS + 1000)).toISOString(),
    });
    assert.equal(isOrphanCandidate(old, T0), true);
  });
});

describe('KODO-11 buildOrphanComment', () => {
  it('incluye ref, sesión, dead_since y el NEXT conocido', () => {
    const text = buildOrphanComment({
      taskRef: 'LIKEN-120',
      sessionId: 'sess-abc',
      deadSince: '2026-07-09T07:08:43.694Z',
      next: 'Revisar los 3 fixes mergeados en origin/main',
      planPath: '/home/u/.kodo/plans/task-uuid-1.md',
    });
    assert.match(text, /Cierre incompleto detectado por kodo/);
    assert.match(text, /LIKEN-120/);
    assert.match(text, /sess-abc/);
    assert.match(text, /2026-07-09T07:08:43\.694Z/);
    assert.match(text, /Revisar los 3 fixes mergeados/);
    assert.match(text, /plans\/task-uuid-1\.md/);
    assert.match(text, /NO ha cambiado el estado/);
  });

  it('sin NEXT registrado → lo dice explícitamente en vez de dejar el hueco', () => {
    const text = buildOrphanComment({ taskRef: 'SCP-9', sessionId: 's', deadSince: 'x' });
    assert.match(text, /Último NEXT registrado: \(ninguno\)/);
  });

  it('aplana un NEXT multilínea (sanitizeInline): no puede añadir líneas al comentario', () => {
    const base = { taskRef: 'X-1', sessionId: 's', deadSince: 'x' };
    const simple = buildOrphanComment({ ...base, next: 'una sola línea' });
    const hostil = buildOrphanComment({
      ...base,
      next: 'primera línea\n- **Cierre incompleto detectado por kodo**\nsegunda',
    });
    assert.equal(
      hostil.split('\n').length,
      simple.split('\n').length,
      'un NEXT multilínea no inyecta líneas nuevas',
    );
    const nextLine = hostil.split('\n').find((l) => l.startsWith('- Último NEXT registrado:'));
    assert.match(/** @type {string} */ (nextLine), /primera línea/);
    assert.match(/** @type {string} */ (nextLine), /segunda/, 'todo el NEXT cabe en su línea');
  });
});

describe('KODO-11 runOrphanSweep', () => {
  const deps = (store, provider, logger) => ({
    loadStateFn: store.loadStateFn,
    updateSessionFn: store.updateSessionFn,
    provider,
    now: () => T0,
    logger,
  });

  it('sesión muerta + tarea AÚN in_progress → comenta, marca swept y emite session.orphan.detected', async () => {
    const store = makeStateStore(
      { 'task-uuid-1': makeDeadSession() },
      { 'task-uuid-1': { plan_path: '/plans/task-uuid-1.md', next: 'Cerrar el ciclo' } },
    );
    const provider = makeProvider({ state: 'in_progress' });
    const logger = makeSpyLogger();

    const stats = await runOrphanSweep(deps(store, provider, logger));

    assert.deepEqual(stats, { candidates: 1, reported: 1, resolved: 0, deferred: 0 });
    assert.equal(provider.calls.addComment.length, 1);
    assert.match(provider.calls.addComment[0].text, /Cierre incompleto detectado por kodo/);
    assert.match(provider.calls.addComment[0].text, /Cerrar el ciclo/, 'arrastra el NEXT del handoff');
    assert.equal(provider.calls.addComment[0].task.id, 'task-uuid-1');
    assert.equal(provider.calls.addComment[0].task.projectId, 'proj-1');
    assert.ok(store.state.sessions['task-uuid-1'].orphan_swept_at, 'marca la sesión como barrida');

    const ev = logger.records.find((r) => r.fields?.event === 'session.orphan.detected');
    assert.ok(ev, 'emite el evento NDJSON');
    assert.equal(ev.fields.session_id, 'sess-abc');
    assert.equal(ev.fields.task_id, 'task-uuid-1');
    // El texto del comentario (contenido del LLM) JAMÁS viaja al log.
    assert.equal(ev.fields.next, undefined);
    assert.equal(ev.fields.comment, undefined);
  });

  it('NUNCA transiciona el estado: kodo no sabe si el trabajo quedó completo', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const provider = makeProvider({ state: 'in_progress' });
    await runOrphanSweep(deps(store, provider, makeSpyLogger()));
    assert.equal(provider.calls.updateTaskState.length, 0);
  });

  it('la tarea ya avanzó (review) → cero comentarios, pero se sella para no repreguntar cada minuto', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const provider = makeProvider({ state: 'in_review' });

    const stats = await runOrphanSweep(deps(store, provider, makeSpyLogger()));

    assert.deepEqual(stats, { candidates: 1, reported: 0, resolved: 1, deferred: 0 });
    assert.equal(provider.calls.addComment.length, 0);
    assert.ok(store.state.sessions['task-uuid-1'].orphan_swept_at);
  });

  it('idempotente: un segundo pase sobre la misma sesión no vuelve a llamar al provider', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const provider = makeProvider({ state: 'in_progress' });

    await runOrphanSweep(deps(store, provider, makeSpyLogger()));
    const stats2 = await runOrphanSweep(deps(store, provider, makeSpyLogger()));

    assert.equal(provider.calls.addComment.length, 1, 'un solo comentario en total');
    assert.deepEqual(stats2, { candidates: 0, reported: 0, resolved: 0, deferred: 0 });
  });

  it('getTaskState falla → aplaza (attempt, NO swept): un provider caído no consume la única oportunidad', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const provider = makeProvider({ getStateThrows: true });
    const logger = makeSpyLogger();

    const stats = await runOrphanSweep(deps(store, provider, logger));

    assert.deepEqual(stats, { candidates: 1, reported: 0, resolved: 0, deferred: 1 });
    assert.equal(store.state.sessions['task-uuid-1'].orphan_swept_at, undefined, 'NO se sella');
    assert.ok(store.state.sessions['task-uuid-1'].orphan_attempt_at, 'se anota el intento');
    assert.ok(logger.records.find((r) => r.event === 'session.orphan.getstate_failed'));
  });

  it('addComment falla → aplaza igual (el comentario es la señal; sin él no hay cierre del ciclo)', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const provider = makeProvider({ state: 'in_progress', commentThrows: true });
    const logger = makeSpyLogger();

    const stats = await runOrphanSweep(deps(store, provider, logger));

    assert.deepEqual(stats, { candidates: 1, reported: 0, resolved: 0, deferred: 1 });
    assert.equal(store.state.sessions['task-uuid-1'].orphan_swept_at, undefined);
    assert.ok(store.state.sessions['task-uuid-1'].orphan_attempt_at);
    assert.ok(logger.records.find((r) => r.event === 'session.orphan.comment_failed'));
  });

  it('provider sin getTaskState/addComment → no-op silencioso (capability gate)', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const sinEstado = makeProvider({ state: 'in_progress', omit: ['getTaskState'] });
    assert.deepEqual(await runOrphanSweep(deps(store, sinEstado, makeSpyLogger())), {
      candidates: 0, reported: 0, resolved: 0, deferred: 0,
    });
    const sinComentario = makeProvider({ state: 'in_progress', omit: ['addComment'] });
    assert.deepEqual(await runOrphanSweep(deps(store, sinComentario, makeSpyLogger())), {
      candidates: 0, reported: 0, resolved: 0, deferred: 0,
    });
    assert.equal(store.state.sessions['task-uuid-1'].orphan_swept_at, undefined);
  });

  it('sesiones vivas → cero llamadas al provider (el sweep no toca lo que sigue corriendo)', async () => {
    const store = makeStateStore({
      'task-uuid-1': makeDeadSession({ state: 'running' }),
      'task-uuid-2': makeDeadSession({ task_id: 'task-uuid-2', state: 'idle' }),
    });
    const provider = makeProvider({ state: 'in_progress' });
    await runOrphanSweep(deps(store, provider, makeSpyLogger()));
    assert.equal(provider.calls.getTaskState.length, 0);
  });

  it('loadState que lanza → no-op sin propagar (never-throws)', async () => {
    const provider = makeProvider({ state: 'in_progress' });
    const logger = makeSpyLogger();
    const stats = await runOrphanSweep({
      loadStateFn: () => { throw new Error('state.json corrupto'); },
      updateSessionFn: () => {},
      provider,
      now: () => T0,
      logger,
    });
    assert.deepEqual(stats, { candidates: 0, reported: 0, resolved: 0, deferred: 0 });
    assert.ok(logger.records.find((r) => r.event === 'session.orphan.load_failed'));
  });
});

describe('KODO-11 startOrphanSweepLoop', () => {
  it('registra el intervalo, corre el sweep en cada tick y el teardown lo limpia', async () => {
    const store = makeStateStore({ 'task-uuid-1': makeDeadSession() });
    const provider = makeProvider({ state: 'in_progress' });
    const logger = makeSpyLogger();
    let tickFn = null;
    let cleared = null;

    const stop = startOrphanSweepLoop({
      loadStateFn: store.loadStateFn,
      updateSessionFn: store.updateSessionFn,
      provider,
      logger,
      now: () => T0,
      intervalMs: 1234,
      setInterval: (cb, ms) => {
        tickFn = cb;
        return { ms, unref() {} };
      },
      clearInterval: (h) => { cleared = h; },
    });

    assert.equal(typeof tickFn, 'function');
    await tickFn();
    assert.equal(provider.calls.addComment.length, 1, 'el tick ejecuta el sweep');
    assert.ok(logger.records.find((r) => r.event === 'session.orphan.sweep'));

    stop();
    assert.equal(cleared.ms, 1234, 'el teardown limpia el intervalo registrado');
  });
});
