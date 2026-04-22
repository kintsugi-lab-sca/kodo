// @ts-check
//
// test/gsd-verify-integration.test.js — Tests E2E con filesystem real.
//
// Cubre Plan 10-02 Sub-concern I:
//   - Crea tmpdir/.planning/phases/10-foo/10-VERIFICATION.md real.
//   - Ejercita el path discovery (readdirSync + prefix-match) E2E sin mocks de fs.
//   - Usa providers + loggers mock para aislar side-effects de red.
//
// Escenarios:
//   - T20: VERIFICATION.md pass → addComment + updateTaskState + orchestratorReview(approved).
//   - T21: VERIFICATION.md con gaps_count=2 → fail + addComment + NO transition.
//   - T22: status desconocido → malformed, addComment con warn.
//   - T23: sin directorio de fase → missing.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGsdVerify } from '../src/gsd/verify.js';

describe('runGsdVerify — integración con filesystem real (.planning/ sintético)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'kodo-verify-'));
    mkdirSync(join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate'), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeSession() {
    return {
      session_id: 'sess-int',
      task_id: 'task-int',
      task_ref: 'KL-99',
      provider: 'plane',
      project_id: 'proj-int',
      project_path: tmpRoot,
      summary: 'Orchestrator gate',
      status: 'review',
      started_at: new Date().toISOString(),
      workspace_ref: 'workspace:1',
      gsd: true,
      phase_id: '10',
    };
  }

  function makeProviderMock() {
    const calls = { getTask: [], addComment: [], updateTaskState: [] };
    return {
      provider: {
        getTask: async (ref) => {
          calls.getTask.push(ref);
          return { id: 'task-int', ref, title: 'T', projectId: 'proj-int' };
        },
        addComment: async (task, md) => {
          calls.addComment.push({ task, md });
        },
        updateTaskState: async (task, state) => {
          calls.updateTaskState.push({ task, state });
        },
      },
      calls,
    };
  }

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

  function makeDeps(session) {
    const { provider, calls } = makeProviderMock();
    const { logger, events } = makeLogger();
    return {
      deps: {
        findSessionFn: () => session,
        getProviderFn: async () => provider,
        loadConfigFn: () => ({
          provider: 'plane',
          providers: { plane: { states: { review: 'In review' } } },
        }),
        loggerFactory: () => logger,
      },
      calls,
      events,
    };
  }

  it('T20 E2E: VERIFICATION.md pass → addComment + updateTaskState + orchestratorReview(approved)', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
        '',
        '# Body ignorado',
      ].join('\n'),
    );
    const session = makeSession();
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'pass');
    assert.equal(result.verdict.must_haves, 8);
    assert.equal(result.plane.commented, true);
    assert.equal(result.plane.transitioned, true);
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /✅ Phase 10/);
    assert.equal(calls.updateTaskState.length, 1);
    assert.equal(calls.updateTaskState[0].state, 'In review');
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review);
    assert.equal(review.fields.verdict, 'approved');
  });

  it('T21 E2E: VERIFICATION.md con gaps_count=2 → fail + addComment + NO transition', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 2',
        '---',
      ].join('\n'),
    );
    const session = makeSession();
    const { deps, calls } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'fail');
    assert.equal(result.verdict.reason, 'gaps-found');
    assert.match(result.verdict.detail, /gaps_count=2/);
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /❌ Phase 10 bloqueada/);
    assert.match(calls.addComment[0].md, /gaps_count=2/);
    assert.equal(calls.updateTaskState.length, 0);
  });

  it('T22 E2E: VERIFICATION.md con status desconocido → malformed, comentario warn', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: in_progress',
        'must_haves_total: 8',
        'must_haves_verified: 5',
        'gaps_count: 3',
        '---',
      ].join('\n'),
    );
    const session = makeSession();
    const { deps, calls } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'malformed');
    assert.match(result.verdict.detail, /in_progress/);
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /⚠️/);
    assert.equal(calls.updateTaskState.length, 0);
  });

  it('T23 E2E: sin directorio de fase → missing', async () => {
    // Eliminar el directorio 10-* pero mantener .planning/phases/
    rmSync(join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate'), {
      recursive: true,
    });
    const session = makeSession();
    const { deps, calls } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'missing');
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /⚠️ VERIFICATION.md no encontrado/);
    assert.equal(calls.updateTaskState.length, 0);
  });
});
