// @ts-check
/**
 * LOG-09 + LOG-10 (D-10) contract tests.
 *
 * Valida:
 *  - EVENTS está frozen y contiene los 7 tipos canónicos.
 *  - Los 7 helpers (sessionStart, sessionEnd, stateTransition, orchestratorReview,
 *    gsdPhaseResolved, gsdBootstrap, planeApiCall) emiten una línea NDJSON con el
 *    `event` correcto y los campos del contrato.
 *  - D-10: `sessionStart` emite las 6 campos obligatorios; sin `transcript_path`
 *    se auto-resuelve via `resolveTranscriptPath(project_path, session_id)`.
 *
 * Dynamic imports de `../src/logger-events.js` — el módulo no existe todavía
 * (lo crea Plan 07-02). Este test file falla con ERR_MODULE_NOT_FOUND hasta
 * que la implementación aterrice. Comportamiento Nyquist esperado.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTmpHome, readAllLines } from './helpers/logger-fixtures.js';

describe('LOG-09: logger-events taxonomy (7 helpers)', () => {
  it('EVENTS is frozen and contains the 7 canonical types', async () => {
    const { EVENTS } = await import('../src/logger-events.js');
    assert.equal(Object.isFrozen(EVENTS), true);
    const types = Object.values(EVENTS).sort();
    assert.deepEqual(types, [
      'gsd.bootstrap',
      'gsd.phase.resolved',
      'orchestrator.review',
      'plane.api.call',
      'session.end',
      'session.start',
      'state.transition',
    ]);
  });

  it('sessionStart emits all 6 D-10 contract fields', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-start', label: 'events-start' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { sessionStart, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-start', minLevel: 'info' });
    sessionStart(log, {
      session_id: 'sess-ev-start',
      plane_task_id: 'KL-42',
      provider: 'plane',
      project_path: '/tmp/kodo-demo',
      transcript_path: '/tmp/fake.jsonl',
      started_at: '2026-04-16T10:00:00.000Z',
    });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.SESSION_START);
    for (const f of [
      'session_id',
      'plane_task_id',
      'provider',
      'project_path',
      'transcript_path',
      'started_at',
    ]) {
      assert.ok(f in line, `session.start missing required field: ${f}`);
    }
  });

  it('sessionStart without transcript_path auto-resolves via resolveTranscriptPath', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-fallback', label: 'events-fb' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { sessionStart } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-fallback', minLevel: 'info' });
    sessionStart(log, {
      session_id: 'sess-ev-fallback',
      plane_task_id: null,
      provider: 'plane',
      project_path: '/tmp/kodo-demo',
      started_at: '2026-04-16T10:00:00.000Z',
    });
    const line = readAllLines(fx.logPath).pop();
    assert.match(
      line.transcript_path,
      /\/\.claude\/projects\/-tmp-kodo-demo\/sess-ev-fallback\.jsonl$/,
    );
  });

  it('sessionEnd emits event=session.end + status/ended_at', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-end', label: 'events-end' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { sessionEnd, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-end', minLevel: 'info' });
    sessionEnd(log, {
      session_id: 'sess-ev-end',
      status: 'done',
      ended_at: '2026-04-16T10:05:00.000Z',
    });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.SESSION_END);
    assert.equal(line.status, 'done');
    assert.equal(line.ended_at, '2026-04-16T10:05:00.000Z');
  });

  it('stateTransition emits event=state.transition + from/to/reason', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-st', label: 'events-st' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { stateTransition, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-st', minLevel: 'info' });
    stateTransition(log, { from: 'running', to: 'review', reason: 'claude_exit' });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.STATE_TRANSITION);
    assert.equal(line.from, 'running');
    assert.equal(line.to, 'review');
    assert.equal(line.reason, 'claude_exit');
  });

  it('orchestratorReview emits event=orchestrator.review + phase_id/verdict/reason', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-or', label: 'events-or' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { orchestratorReview, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-or', minLevel: 'info' });
    orchestratorReview(log, {
      phase_id: '07-kodo-logs-cli',
      verdict: 'blocked',
      reason: 'VERIFICATION.md missing',
    });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.ORCHESTRATOR_REVIEW);
    assert.equal(line.phase_id, '07-kodo-logs-cli');
    assert.equal(line.verdict, 'blocked');
    assert.equal(line.reason, 'VERIFICATION.md missing');
  });

  it('gsdPhaseResolved emits event=gsd.phase.resolved + phase_id/match_heading', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-gpr', label: 'events-gpr' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { gsdPhaseResolved, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-gpr', minLevel: 'info' });
    gsdPhaseResolved(log, {
      phase_id: '07-kodo-logs-cli',
      match_heading: 'Phase 7: kodo logs CLI + Event Taxonomy',
    });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.GSD_PHASE_RESOLVED);
    assert.equal(line.phase_id, '07-kodo-logs-cli');
    assert.equal(line.match_heading, 'Phase 7: kodo logs CLI + Event Taxonomy');
  });

  it('gsdBootstrap emits event=gsd.bootstrap + project_path', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-gb', label: 'events-gb' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { gsdBootstrap, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-gb', minLevel: 'info' });
    gsdBootstrap(log, { project_path: '/tmp/kodo-demo' });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.GSD_BOOTSTRAP);
    assert.equal(line.project_path, '/tmp/kodo-demo');
  });

  it('planeApiCall emits event=plane.api.call + method/path/status/duration_ms', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-ev-pac', label: 'events-pac' });
    after(() => fx.cleanup());
    const { createLogger } = await import('../src/logger.js');
    const { planeApiCall, EVENTS } = await import('../src/logger-events.js');
    const log = createLogger({ sessionId: 'sess-ev-pac', minLevel: 'info' });
    planeApiCall(log, {
      method: 'GET',
      path: '/work-items/KL-42/',
      status: 200,
      duration_ms: 142,
    });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.PLANE_API_CALL);
    assert.equal(line.method, 'GET');
    assert.equal(line.path, '/work-items/KL-42/');
    assert.equal(line.status, 200);
    assert.equal(line.duration_ms, 142);
  });
});
