// @ts-check
//
// test/stop-state-transition.test.js — Phase 16 LOG-15 SC#5 coverage.
//
// Cubre la cadena `stop hook → markSessionStatus → state.transition` en los
// tres regímenes definidos por el plan:
//
//   1. full mode  — session.status='review' (post-verify) + lock release
//                  → emits state.transition from='review' to='done' (D-05).
//   2. quick mode — session.status='running' (no verify) + lock release
//                  → emits state.transition from='running' to='done'.
//   3. non-GSD    — session.gsd=false → NO state.transition (D-07). El resto
//                   del flujo (removeSession) sí ejecuta — sanity check.
//   4. D-04 invariante MANDATORY (N-2): full y quick emiten `to='done'` fijo.
//
// El test usa el export `runStopHook(input, deps)` con DI completa (W-4):
//   findSessionFn, removeSessionFn, cmux, loggerFactory.
//
// Logger memSink mismo patrón que test/gsd-verify-integration.test.js:73-83.
//
// Deviation Rule 1: markSessionStatus en src/session/manager.js lee el `from`
// status desde listSessions() (state.json real). Para que los asserts sobre
// `from='review'`/`from='running'` funcionen sin pollutar state.json del
// usuario, los tests escriben la session real con addSession() y limpian con
// removeSession() en try/finally garantizado. Los task_id usan prefijo
// 'kodo-test-stop-' para detectar cualquier leak. El runStopHook recibe
// findSessionFn/removeSessionFn injectados (los spies) para que el flujo de
// runStopHook sea testeable, pero markSessionStatus interno usa state real
// (que el test ha poblado).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { addSession, removeSession, getSession } from '../src/session/state.js';

/**
 * Fake logger memSink — same pattern as test/gsd-verify-integration.test.js:73-83.
 * child() returns the same logger so events array survives .child(...) calls
 * (markSessionStatus interno hace `logger.child({component:'session', task_id})`).
 */
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

/**
 * Cmux stub — evita conexión a cmuxd real durante tests (W-4).
 * El flow de stop.js invoca setColor + notify + listWorkspaces + send tanto en
 * GSD como no-GSD. Sin stub los tests intentarían conectar al daemon real.
 */
function makeCmuxStub() {
  const calls = [];
  return {
    stub: {
      setColor: async (args) => { calls.push({ method: 'setColor', args }); },
      notify: async (args) => { calls.push({ method: 'notify', args }); },
      listWorkspaces: async () => { calls.push({ method: 'listWorkspaces' }); return ''; },
      send: async (args) => { calls.push({ method: 'send', args }); },
    },
    calls,
  };
}

/** Persist a synthetic session into state.json so markSessionStatus reads
 *  the correct `from` status. Returns a cleanup function. */
function persistSession(session) {
  addSession(session.task_id, session);
  return () => {
    try { removeSession(session.task_id); } catch {}
  };
}

describe('SC#5 LOG-15: stop hook state.transition coverage', () => {
  // Track all task_ids written to state.json so we always clean up,
  // even if a test throws before its local cleanup runs.
  const writtenTaskIds = [];
  afterEach(() => {
    while (writtenTaskIds.length > 0) {
      const tid = writtenTaskIds.pop();
      try { removeSession(tid); } catch {}
    }
  });

  it('full mode: session.status="review" + lock release → emits state.transition from=review to=done (D-05)', async () => {
    const session = {
      session_id: 's-full-1',
      task_id: 'kodo-test-stop-full-1',
      task_ref: 'KL-full-1',
      gsd: true,
      gsd_mode: 'full',
      status: 'review',
      project_path: '/tmp/repo-full',
      provider: 'plane',
      project_id: 'p-full',
      workspace_ref: 'workspace:1',
      started_at: new Date().toISOString(),
      summary: 'test session full',
    };
    writtenTaskIds.push(session.task_id);
    const cleanup = persistSession(session);
    try {
      const { logger, events } = makeLogger();
      const { stub: cmuxStub } = makeCmuxStub();
      const findSessionFn = ({ sessionId }) =>
        sessionId === session.session_id ? { id: session.task_id, session } : null;
      const removeSessionCalls = [];
      const removeSessionFn = (id) => removeSessionCalls.push(id);

      const { runStopHook } = await import('../src/hooks/stop.js');
      await runStopHook(
        { session_id: session.session_id, cwd: '/tmp/repo-full' },
        {
          findSessionFn,
          removeSessionFn,
          cmux: cmuxStub,
          loggerFactory: () => logger,
        },
      );

      const transition = events.find((e) => e.fields?.event === 'state.transition');
      assert.ok(transition, 'full mode debe emitir state.transition');
      assert.equal(transition.fields.from, 'review', 'D-05: from debe ser el status previo (review post-verify)');
      assert.equal(transition.fields.to, 'done', 'D-04: to fixed a "done"');
      assert.equal(transition.fields.reason, 'session-stop:lock-released', 'D-06: reason canónico');
      assert.deepEqual(removeSessionCalls, [session.task_id], 'removeSession se ejecutó (sanity)');
    } finally {
      cleanup();
    }
  });

  it('quick mode: session.status="running" + lock release → emits state.transition from=running to=done', async () => {
    const session = {
      session_id: 's-quick-1',
      task_id: 'kodo-test-stop-quick-1',
      task_ref: 'KL-quick-1',
      gsd: true,
      gsd_mode: 'quick',
      status: 'running',
      project_path: '/tmp/repo-quick',
      provider: 'plane',
      project_id: 'p-quick',
      workspace_ref: 'workspace:2',
      started_at: new Date().toISOString(),
      summary: 'test session quick',
    };
    writtenTaskIds.push(session.task_id);
    const cleanup = persistSession(session);
    try {
      const { logger, events } = makeLogger();
      const { stub: cmuxStub } = makeCmuxStub();
      const findSessionFn = ({ sessionId }) =>
        sessionId === session.session_id ? { id: session.task_id, session } : null;
      const removeSessionCalls = [];
      const removeSessionFn = (id) => removeSessionCalls.push(id);

      const { runStopHook } = await import('../src/hooks/stop.js');
      await runStopHook(
        { session_id: session.session_id, cwd: '/tmp/repo-quick' },
        { findSessionFn, removeSessionFn, cmux: cmuxStub, loggerFactory: () => logger },
      );

      const transition = events.find((e) => e.fields?.event === 'state.transition');
      assert.ok(transition, 'quick mode debe emitir state.transition');
      assert.equal(transition.fields.from, 'running', 'from debe ser el status previo (running — quick no pasa por verify)');
      assert.equal(transition.fields.to, 'done', 'D-04: to fixed a "done" (mismo para ambos modos)');
      assert.equal(transition.fields.reason, 'session-stop:lock-released', 'D-06: reason canónico');
    } finally {
      cleanup();
    }
  });

  it('non-GSD: session.gsd=false → does NOT emit state.transition (D-07)', async () => {
    const session = {
      session_id: 's-nogsd-1',
      task_id: 'kodo-test-stop-nogsd-1',
      task_ref: 'KL-nogsd-1',
      gsd: false,
      status: 'running',
      project_path: '/tmp/repo-nogsd',
      provider: 'plane',
      project_id: 'p-nogsd',
      workspace_ref: 'workspace:3',
      started_at: new Date().toISOString(),
      summary: 'test session no-gsd',
    };
    writtenTaskIds.push(session.task_id);
    const cleanup = persistSession(session);
    try {
      const { logger, events } = makeLogger();
      const { stub: cmuxStub } = makeCmuxStub();
      const findSessionFn = ({ sessionId }) =>
        sessionId === session.session_id ? { id: session.task_id, session } : null;
      const removeSessionCalls = [];
      const removeSessionFn = (id) => removeSessionCalls.push(id);

      const { runStopHook } = await import('../src/hooks/stop.js');
      await runStopHook(
        { session_id: session.session_id, cwd: '/tmp/repo-nogsd' },
        { findSessionFn, removeSessionFn, cmux: cmuxStub, loggerFactory: () => logger },
      );

      const transition = events.find((e) => e.fields?.event === 'state.transition');
      assert.equal(transition, undefined, 'D-07: non-GSD no debe emitir state.transition (solo dentro de if (session.gsd))');
      assert.deepEqual(removeSessionCalls, [session.task_id], 'removeSession sí se ejecuta (la sesión se limpia normal — solo el state.transition no aparece)');
    } finally {
      cleanup();
    }
  });

  // N-2 MANDATORY: D-04 es LOCKED. Este test cierra drift futuro — si un
  // implementer infiere modo y emite 'review' para quick (violando D-04),
  // este test cae con assertion message específico citando D-04.
  it('D-04 invariante MANDATORY: ambos modos full y quick emiten to="done" (no se infiere modo)', async () => {
    const fullSession = {
      session_id: 's-d04-full',
      task_id: 'kodo-test-stop-d04-full',
      task_ref: 'KL-d04-full',
      gsd: true, gsd_mode: 'full', status: 'review',
      project_path: '/tmp/d04-full', provider: 'plane',
      project_id: 'p-d04-full',
      workspace_ref: 'workspace:4',
      started_at: new Date().toISOString(),
      summary: 'd04 full',
    };
    const quickSession = {
      session_id: 's-d04-quick',
      task_id: 'kodo-test-stop-d04-quick',
      task_ref: 'KL-d04-quick',
      gsd: true, gsd_mode: 'quick', status: 'running',
      project_path: '/tmp/d04-quick', provider: 'plane',
      project_id: 'p-d04-quick',
      workspace_ref: 'workspace:5',
      started_at: new Date().toISOString(),
      summary: 'd04 quick',
    };

    const { runStopHook } = await import('../src/hooks/stop.js');

    for (const session of [fullSession, quickSession]) {
      writtenTaskIds.push(session.task_id);
      const cleanup = persistSession(session);
      try {
        const { logger, events } = makeLogger();
        const { stub: cmuxStub } = makeCmuxStub();
        const findSessionFn = ({ sessionId }) =>
          sessionId === session.session_id ? { id: session.task_id, session } : null;
        const removeSessionFn = () => {};
        await runStopHook(
          { session_id: session.session_id, cwd: session.project_path },
          { findSessionFn, removeSessionFn, cmux: cmuxStub, loggerFactory: () => logger },
        );
        const transition = events.find((e) => e.fields?.event === 'state.transition');
        assert.ok(transition, `D-04 invariante: modo ${session.gsd_mode} debe emitir state.transition`);
        assert.equal(transition.fields.to, 'done',
          `D-04 LOCKED: to debe ser 'done' fijo (modo ${session.gsd_mode}) — D-04 prohíbe inferir modo`);
      } finally {
        cleanup();
      }
    }
  });
});
