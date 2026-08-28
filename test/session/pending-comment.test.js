// @ts-check
//
// test/session/pending-comment.test.js — KODO-36 (backstop de comentarios).
//
// La mitad PURA de la fase: el lector `listPendingComments` y el barrido
// `runPendingCommentSweep`, con lector, escritores, provider y reloj INYECTADOS — ni FS ni
// red ni timers reales, mismo estilo DI que orphan-sweep.test.js. La persistencia real del
// marcador (`markPendingComment` y compañía contra un state.json de verdad) vive en
// test/state/pending-comment-state.test.js, que sí necesita aislar HOME.
//
// El criterio de éxito de la tarea vive en «doble tick no duplica el comentario».

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runPendingCommentSweep,
  startOrphanSweepLoop,
  ORPHAN_RETRY_MS,
} from '../../src/session/orphan-sweep.js';
import {
  listPendingComments,
  PENDING_COMMENT_MAX_ATTEMPTS,
} from '../../src/session/pending-comment.js';

const T0 = Date.parse('2026-08-28T10:00:00.000Z');

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

/** Marcador con los campos que el barrido mira. */
function makePending(overrides = {}) {
  return {
    task_id: 'task-uuid-36',
    project_id: 'proj-1',
    task_url: 'https://plane.example/KODO-36',
    task_ref: 'KODO-36',
    session_id: 'sess-xyz',
    text: '🤖 Cierre automático de kodo: …',
    created_at: new Date(T0 - 60 * 1000).toISOString(),
    attempts: 0,
    attempt_at: null,
    ...overrides,
  };
}

/**
 * State in-memory + los DOS escritores del marcador aplicados sobre él (espejo exacto de
 * lo que `deferPendingComment`/`clearPendingComment` hacen en disco).
 */
function makeStore(pending = {}) {
  const state = { sessions: {}, pending_comments: pending };
  const writes = [];
  return {
    state,
    writes,
    loadStateFn: () => state,
    deferPendingFn: (taskId, at) => {
      writes.push({ op: 'defer', taskId });
      const e = state.pending_comments[taskId];
      if (e) {
        e.attempts = (e.attempts || 0) + 1;
        e.attempt_at = new Date(at).toISOString();
      }
    },
    clearPendingFn: (taskId) => {
      writes.push({ op: 'clear', taskId });
      delete state.pending_comments[taskId];
    },
  };
}

function makeProvider(opts = {}) {
  const calls = { addComment: [] };
  const provider = {
    calls,
    async addComment(task, text) {
      calls.addComment.push({ task, text });
      if (opts.commentThrows) throw new Error('addComment network down');
    },
  };
  for (const m of opts.omit || []) delete provider[m];
  return provider;
}

describe('KODO-36 — listPendingComments (lector puro, guard defensivo)', () => {
  it('un state previo a KODO-36 se lee como cero pendientes', () => {
    assert.deepEqual(listPendingComments({ schema_version: 3, sessions: {} }), []);
    assert.deepEqual(listPendingComments(null), []);
    assert.deepEqual(listPendingComments({ pending_comments: [] }), []);
  });

  it('descarta entradas corruptas sin task_id o sin texto', () => {
    const entries = listPendingComments({
      pending_comments: {
        ok: makePending({ task_id: 'ok' }),
        broken: { task_id: 'broken' }, // sin `text`
        alsoBroken: { text: 'huérfano' }, // sin `task_id`
      },
    });
    assert.deepEqual(
      entries.map((e) => e.task_id),
      ['ok'],
    );
  });
});

describe('KODO-36 — runPendingCommentSweep', () => {
  it('publica el marcador y lo limpia (el ciclo feliz)', async () => {
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider();
    const logger = makeSpyLogger();

    const stats = await runPendingCommentSweep({
      ...store,
      provider,
      now: () => T0,
      logger,
    });

    assert.deepEqual(stats, { pending: 1, posted: 1, deferred: 0, abandoned: 0 });
    assert.equal(provider.calls.addComment.length, 1);
    // Shape combinado {id, projectId, url, ref} — el mismo que consumen los providers.
    assert.deepEqual(provider.calls.addComment[0].task, {
      id: 'task-uuid-36',
      projectId: 'proj-1',
      url: 'https://plane.example/KODO-36',
      ref: 'KODO-36',
    });
    assert.equal(provider.calls.addComment[0].text, '🤖 Cierre automático de kodo: …');
    assert.equal(store.state.pending_comments['task-uuid-36'], undefined);
    assert.ok(logger.records.some((r) => r.event === 'session.pending_comment.posted'));
  });

  it('DOBLE TICK: el comentario se publica EXACTAMENTE una vez', async () => {
    // El criterio de éxito de KODO-36. El segundo tick corre sobre el MISMO state que el
    // primero dejó — que es justo lo que hace el loop del server cada 60 s.
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider();

    const deps = { ...store, provider, now: () => T0, logger: makeSpyLogger() };
    const first = await runPendingCommentSweep(deps);
    const second = await runPendingCommentSweep(deps);

    assert.deepEqual(first, { pending: 1, posted: 1, deferred: 0, abandoned: 0 });
    assert.deepEqual(second, { pending: 0, posted: 0, deferred: 0, abandoned: 0 });
    assert.equal(provider.calls.addComment.length, 1, 'NO se duplicó el comentario');
  });

  it('provider caído: aplaza en vez de perder el marcador', async () => {
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider({ commentThrows: true });
    const logger = makeSpyLogger();

    const stats = await runPendingCommentSweep({ ...store, provider, now: () => T0, logger });

    assert.deepEqual(stats, { pending: 1, posted: 0, deferred: 1, abandoned: 0 });
    const entry = store.state.pending_comments['task-uuid-36'];
    assert.ok(entry, 'el marcador SIGUE ahí — perderlo es el bug que esta fase cierra');
    assert.equal(entry.attempts, 1);
    assert.equal(entry.attempt_at, new Date(T0).toISOString());
    const warn = logger.records.find((r) => r.event === 'session.pending_comment.retry_failed');
    assert.ok(warn);
    // El TEXTO del comentario nunca se loguea (contenido derivado del LLM, T-71-18).
    assert.equal(JSON.stringify(warn.fields).includes('Cierre automático'), false);
  });

  it('respeta la ventana de reintento tras un fallo, y reintenta al vencerla', async () => {
    const recent = makePending({ attempts: 1, attempt_at: new Date(T0 - 60 * 1000).toISOString() });
    const store = makeStore({ 'task-uuid-36': recent });
    const provider = makeProvider();

    const tooSoon = await runPendingCommentSweep({
      ...store,
      provider,
      now: () => T0,
      logger: makeSpyLogger(),
    });
    assert.deepEqual(tooSoon, { pending: 0, posted: 0, deferred: 0, abandoned: 0 });
    assert.equal(provider.calls.addComment.length, 0);

    const later = await runPendingCommentSweep({
      ...store,
      provider,
      now: () => T0 + ORPHAN_RETRY_MS,
      logger: makeSpyLogger(),
    });
    assert.deepEqual(later, { pending: 1, posted: 1, deferred: 0, abandoned: 0 });
    assert.equal(provider.calls.addComment.length, 1);
  });

  it('un marcador recién creado (attempt_at null) NO espera la ventana', async () => {
    const store = makeStore({ 'task-uuid-36': makePending({ attempt_at: null }) });
    const provider = makeProvider();

    const stats = await runPendingCommentSweep({
      ...store,
      provider,
      now: () => T0,
      logger: makeSpyLogger(),
    });

    assert.equal(stats.posted, 1);
  });

  it('abandona ruidosamente al agotar PENDING_COMMENT_MAX_ATTEMPTS', async () => {
    const exhausted = makePending({
      attempts: PENDING_COMMENT_MAX_ATTEMPTS - 1,
      attempt_at: new Date(T0 - ORPHAN_RETRY_MS - 1000).toISOString(),
    });
    const store = makeStore({ 'task-uuid-36': exhausted });
    const provider = makeProvider({ commentThrows: true });
    const logger = makeSpyLogger();

    const stats = await runPendingCommentSweep({ ...store, provider, now: () => T0, logger });

    assert.deepEqual(stats, { pending: 1, posted: 0, deferred: 0, abandoned: 1 });
    assert.equal(store.state.pending_comments['task-uuid-36'], undefined);
    const warn = logger.records.find((r) => r.event === 'session.pending_comment.abandoned');
    assert.ok(warn, 'el abandono deja traza — el comentario se pierde, el humano se entera');
    assert.equal(warn.fields.attempts, PENDING_COMMENT_MAX_ATTEMPTS);
  });

  it('provider sin addComment → no-op silencioso (capability gate)', async () => {
    const store = makeStore({ 'task-uuid-36': makePending() });
    const stats = await runPendingCommentSweep({
      ...store,
      provider: makeProvider({ omit: ['addComment'] }),
      now: () => T0,
      logger: makeSpyLogger(),
    });
    assert.deepEqual(stats, { pending: 0, posted: 0, deferred: 0, abandoned: 0 });
    assert.ok(store.state.pending_comments['task-uuid-36'], 'y el marcador se conserva');
  });

  it('un loadState que lanza degrada a no-op con warn', async () => {
    const logger = makeSpyLogger();
    const stats = await runPendingCommentSweep({
      loadStateFn: () => {
        throw new Error('state.json ilegible');
      },
      deferPendingFn: () => {},
      clearPendingFn: () => {},
      provider: makeProvider(),
      now: () => T0,
      logger,
    });
    assert.deepEqual(stats, { pending: 0, posted: 0, deferred: 0, abandoned: 0 });
    assert.ok(logger.records.some((r) => r.event === 'session.pending_comment.load_failed'));
  });

  it('varios marcadores: un fallo no bloquea a los demás', async () => {
    const store = makeStore({
      a: makePending({ task_id: 'a', task_ref: 'A-1' }),
      b: makePending({ task_id: 'b', task_ref: 'B-1' }),
    });
    const provider = {
      calls: { addComment: [] },
      async addComment(task, text) {
        provider.calls.addComment.push({ task, text });
        if (task.id === 'a') throw new Error('solo A falla');
      },
    };

    const stats = await runPendingCommentSweep({
      ...store,
      provider,
      now: () => T0,
      logger: makeSpyLogger(),
    });

    assert.deepEqual(stats, { pending: 2, posted: 1, deferred: 1, abandoned: 0 });
    assert.ok(store.state.pending_comments.a, 'A queda pendiente');
    assert.equal(store.state.pending_comments.b, undefined, 'B se publicó y se limpió');
  });
});

describe('KODO-36 — cableado en startOrphanSweepLoop', () => {
  /** Arranca el loop con timers inyectados y devuelve la función del tick. */
  function loopCon(deps) {
    let tickFn = null;
    const stop = startOrphanSweepLoop({
      now: () => T0,
      intervalMs: 1234,
      setInterval: (cb) => {
        tickFn = cb;
        return { unref() {} };
      },
      clearInterval: () => {},
      ...deps,
    });
    return { tick: () => tickFn(), stop };
  }

  it('un mismo tick corre los DOS barridos: huérfanas y comentarios pendientes', async () => {
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider();

    const { tick } = loopCon({
      loadStateFn: store.loadStateFn,
      updateSessionFn: () => {},
      deferPendingFn: store.deferPendingFn,
      clearPendingFn: store.clearPendingFn,
      provider,
      logger: makeSpyLogger(),
    });
    await tick();

    assert.equal(provider.calls.addComment.length, 1, 'el barrido de pendientes corrió en el tick');
    assert.equal(store.state.pending_comments['task-uuid-36'], undefined, 'y limpió el marcador');
  });

  it('DOBLE TICK del loop: el comentario sigue publicándose una sola vez', async () => {
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider();

    const { tick } = loopCon({
      loadStateFn: store.loadStateFn,
      updateSessionFn: () => {},
      deferPendingFn: store.deferPendingFn,
      clearPendingFn: store.clearPendingFn,
      provider,
      logger: makeSpyLogger(),
    });
    await tick();
    await tick();

    assert.equal(provider.calls.addComment.length, 1, 'NO se duplicó entre ticks del loop');
  });

  it('sin los escritores inyectados el segundo barrido se apaga: el loop se comporta como antes de KODO-36', async () => {
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider();

    const { tick } = loopCon({
      loadStateFn: store.loadStateFn,
      updateSessionFn: () => {},
      provider,
      logger: makeSpyLogger(),
    });
    await tick();

    assert.equal(provider.calls.addComment.length, 0);
    assert.ok(store.state.pending_comments['task-uuid-36'], 'el marcador se conserva intacto');
  });

  it('un barrido de pendientes que revienta no deja el single-flight bloqueado', async () => {
    // Si `running` se quedara en true, el loop moriría en silencio tras el primer fallo.
    const store = makeStore({ 'task-uuid-36': makePending() });
    const provider = makeProvider();
    const logger = makeSpyLogger();

    const { tick } = loopCon({
      loadStateFn: store.loadStateFn,
      updateSessionFn: () => {},
      deferPendingFn: store.deferPendingFn,
      clearPendingFn: () => {
        throw new Error('clear revienta');
      },
      provider,
      logger,
    });

    await assert.doesNotReject(tick(), 'el tick nunca propaga');
    assert.ok(logger.records.some((r) => r.event === 'session.pending_comment.sweep_error'));

    // Segundo tick: si el single-flight hubiera quedado bloqueado, esto sería un no-op.
    provider.calls.addComment.length = 0;
    await tick();
    assert.equal(provider.calls.addComment.length, 1, 'el loop sigue vivo tras el fallo');
  });
});
