// @ts-check
//
// test/hooks/session-end.test.js — Tests del hook SessionEnd (Phase 58, LIFE-03).
//
// SessionEnd hace el cleanup terminal DESTRUCTIVO al cierre real de la sesión:
// typed session.end event → lock release backstop → performTerminalCleanup
// (worktree + promptFile + removeSession). Idempotente (guard source==='history')
// y never-throws. La cobertura de worktree vive en stop-worktree-cleanup.test.js
// (re-apuntado a runSessionEndHook); aquí cubrimos la ruta sin worktree + guards.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSessionEndHook } from '../../src/hooks/session-end.js';
import { sessionBackstopReview, EVENTS } from '../../src/logger-events.js';

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

function makeSession(overrides = {}) {
  return {
    session_id: 's-end-1',
    task_id: 'kodo-end-1',
    task_ref: 'KL-end-1',
    provider: 'plane',
    project_id: 'p-1',
    project_path: '/tmp/repo-end',
    summary: 'test session end',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:end-1',
    gsd: false,
    ...overrides,
  };
}

describe('runSessionEndHook — cleanup terminal (LIFE-03)', () => {
  it('sesión viva (no worktree): emite session.end + remueve la sesión', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
      },
    );
    const end = events.find((e) => e.fields?.event === 'session.end');
    assert.ok(end, 'debe emitir el typed session.end event');
    assert.equal(end.fields.status, 'done', 'session.end status=done');
    assert.deepEqual(removed, [session.task_id], 'removeSession llamado con el id');
  });

  it('idempotencia: source==="history" → no-op (no remueve, no emite session.end)', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        // Simula una sesión ya archivada (Stop espurio, SessionEnd previo, doctor).
        findSessionFn: () => ({ id: session.task_id, session, source: 'history' }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
      },
    );
    assert.deepEqual(removed, [], 'NO remueve una sesión ya archivada');
    assert.equal(events.filter((e) => e.fields?.event === 'session.end').length, 0, 'NO emite session.end');
  });

  it('sin sesión tracked → no-op silencioso (sesión ad-hoc/orquestador)', async () => {
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: 'unknown', cwd: '/tmp/elsewhere' },
      {
        findSessionFn: () => null,
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
      },
    );
    assert.deepEqual(removed, [], 'nada que remover');
    assert.equal(events.length, 0, 'no emite eventos');
  });

  it('never-throws: un removeSessionFn que lanza NO crashea el hook', async () => {
    const session = makeSession();
    const { logger } = makeLogger();
    await assert.doesNotReject(
      runSessionEndHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          findSessionFn: () => ({ id: session.task_id, session }),
          removeSessionFn: () => { throw new Error('state.json locked'); },
          loggerFactory: () => logger,
        },
      ),
      'el hook nunca debe rechazar (never-throws / fail-open)',
    );
  });
});

describe('sessionBackstopReview — evento NDJSON del backstop (DELIV-04, T-25-02)', () => {
  it('emite SOLO {event, session_id, task_id, from, to} y descarta campos extra', () => {
    const { logger, events } = makeLogger();
    sessionBackstopReview(logger, {
      session_id: 's-1',
      task_id: 'kodo-1',
      from: 'in_progress',
      to: 'In review',
      // Campos de contenido que NUNCA deben filtrarse al sink NDJSON (guardrail T-25-02).
      title: 'SECRETO — no debe filtrarse',
      description: 'tampoco esto',
    });
    assert.equal(events.length, 1, 'emite exactamente un record');
    const rec = events[0];
    assert.equal(rec.level, 'info', 'nivel info');
    assert.equal(rec.msg, EVENTS.SESSION_BACKSTOP_REVIEW, 'msg = clave del evento');
    assert.deepEqual(
      rec.fields,
      {
        event: 'session.backstop.review',
        session_id: 's-1',
        task_id: 'kodo-1',
        from: 'in_progress',
        to: 'In review',
      },
      'record contiene exactamente los 4 campos + event, nada más',
    );
    assert.ok(!('title' in rec.fields), 'no filtra title');
    assert.ok(!('description' in rec.fields), 'no filtra description');
  });
});

describe('session-end.js source hygiene', () => {
  it('no importa PlaneClient ni el registry de providers (cleanup mecánico)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'hooks', 'session-end.js'),
      'utf-8',
    );
    assert.ok(!src.includes('PlaneClient'), 'no debe importar PlaneClient');
    assert.ok(!src.includes('initRegistry'), 'no debe inicializar el registry');
    assert.ok(src.includes('performTerminalCleanup'), 'usa el helper compartido performTerminalCleanup');
  });
});
