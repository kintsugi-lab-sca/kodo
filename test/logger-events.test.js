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
 * HOME se fija en un tmp ANTES de cualquier dynamic import (los módulos resuelven
 * KODO_DIR en tiempo de load). Todas las tests comparten el mismo HOME; cada
 * test usa un `session_id` distinto para aislar su archivo NDJSON.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeTmpHome, readAllLines } from './helpers/logger-fixtures.js';

// Fijar HOME ANTES de cargar logger/logger-events. Shared HOME, per-test session_ids.
const fixture = makeTmpHome({ sessionId: '_bootstrap', label: 'events' });
after(() => fixture.cleanup());

const { createLogger } = await import('../src/logger.js');
const {
  EVENTS,
  sessionStart,
  sessionEnd,
  stateTransition,
  orchestratorReview,
  gsdPhaseResolved,
  gsdBootstrap,
  planeApiCall,
  planeApiCallFailed,
} = await import('../src/logger-events.js');

function logPathFor(sessionId) {
  return join(fixture.homeDir, '.kodo', 'logs', `${sessionId}.ndjson`);
}

describe('LOG-09: logger-events taxonomy (8 helpers)', () => {
  it('EVENTS is frozen and contains the 8 canonical types', () => {
    assert.equal(Object.isFrozen(EVENTS), true);
    const types = Object.values(EVENTS).sort();
    assert.deepEqual(types, [
      'gsd.bootstrap',
      'gsd.phase.resolved',
      'orchestrator.review',
      'plane.api.call',
      'plane.api.call.failed',
      'session.end',
      'session.start',
      'state.transition',
    ]);
  });

  it('sessionStart emits all 6 D-10 contract fields', () => {
    const sessionId = 'sess-ev-start';
    const log = createLogger({ sessionId, minLevel: 'info' });
    sessionStart(log, {
      session_id: sessionId,
      task_id: 'KL-42',
      provider: 'plane',
      project_path: '/tmp/kodo-demo',
      transcript_path: '/tmp/fake.jsonl',
      started_at: '2026-04-16T10:00:00.000Z',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.SESSION_START);
    for (const f of [
      'session_id',
      'task_id',
      'provider',
      'project_path',
      'transcript_path',
      'started_at',
    ]) {
      assert.ok(f in line, `session.start missing required field: ${f}`);
    }
  });

  it('sessionStart without transcript_path auto-resolves via resolveTranscriptPath', () => {
    const sessionId = 'sess-ev-fallback';
    const log = createLogger({ sessionId, minLevel: 'info' });
    sessionStart(log, {
      session_id: sessionId,
      task_id: null,
      provider: 'plane',
      project_path: '/tmp/kodo-demo',
      started_at: '2026-04-16T10:00:00.000Z',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.match(
      line.transcript_path,
      /\/\.claude\/projects\/-tmp-kodo-demo\/sess-ev-fallback\.jsonl$/,
    );
  });

  it('sessionEnd emits event=session.end + status/ended_at', () => {
    const sessionId = 'sess-ev-end';
    const log = createLogger({ sessionId, minLevel: 'info' });
    sessionEnd(log, {
      session_id: sessionId,
      status: 'done',
      ended_at: '2026-04-16T10:05:00.000Z',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.SESSION_END);
    assert.equal(line.status, 'done');
    assert.equal(line.ended_at, '2026-04-16T10:05:00.000Z');
  });

  it('stateTransition emits event=state.transition + from/to/reason', () => {
    const sessionId = 'sess-ev-st';
    const log = createLogger({ sessionId, minLevel: 'info' });
    stateTransition(log, { from: 'running', to: 'review', reason: 'claude_exit' });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.STATE_TRANSITION);
    assert.equal(line.from, 'running');
    assert.equal(line.to, 'review');
    assert.equal(line.reason, 'claude_exit');
  });

  it('orchestratorReview emits event=orchestrator.review + phase_id/verdict/reason', () => {
    const sessionId = 'sess-ev-or';
    const log = createLogger({ sessionId, minLevel: 'info' });
    orchestratorReview(log, {
      phase_id: '07-kodo-logs-cli',
      verdict: 'blocked',
      reason: 'VERIFICATION.md missing',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.ORCHESTRATOR_REVIEW);
    assert.equal(line.phase_id, '07-kodo-logs-cli');
    assert.equal(line.verdict, 'blocked');
    assert.equal(line.reason, 'VERIFICATION.md missing');
  });

  it('gsdPhaseResolved emits event=gsd.phase.resolved + phase_id/match_heading + mode (Phase 11 D-05)', () => {
    const sessionId = 'sess-ev-gpr';
    const log = createLogger({ sessionId, minLevel: 'info' });
    gsdPhaseResolved(log, {
      phase_id: '07-kodo-logs-cli',
      match_heading: 'Phase 7: kodo logs CLI + Event Taxonomy',
      mode: 'full',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.GSD_PHASE_RESOLVED);
    assert.equal(line.phase_id, '07-kodo-logs-cli');
    assert.equal(line.match_heading, 'Phase 7: kodo logs CLI + Event Taxonomy');
    assert.equal(line.mode, 'full');
  });

  it('gsdPhaseResolved emits mode=quick when quick session matches a phase (Phase 11 D-05)', () => {
    const sessionId = 'sess-ev-gpr-q';
    const log = createLogger({ sessionId, minLevel: 'info' });
    gsdPhaseResolved(log, {
      phase_id: '11-quick-mode-recognition-persistence',
      match_heading: 'Phase 11: Quick Mode Recognition & Persistence',
      mode: 'quick',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.mode, 'quick');
    assert.equal(line.phase_id, '11-quick-mode-recognition-persistence');
  });

  it('gsdBootstrap emits event=gsd.bootstrap + project_path + brief_empty + mode (Phase 11 D-07)', () => {
    const sessionId = 'sess-ev-gb';
    const log = createLogger({ sessionId, minLevel: 'info' });
    gsdBootstrap(log, { project_path: '/tmp/kodo-demo', brief_empty: false, mode: 'full' });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.GSD_BOOTSTRAP);
    assert.equal(line.project_path, '/tmp/kodo-demo');
    assert.equal(line.brief_empty, false);
    assert.equal(line.mode, 'full');
  });

  it('gsdBootstrap emits brief_empty=true + mode=quick when quick session bootstraps (Phase 11 D-07)', () => {
    const sessionId = 'sess-ev-gb-q';
    const log = createLogger({ sessionId, minLevel: 'info' });
    gsdBootstrap(log, { project_path: '/tmp/kodo-demo-q', brief_empty: true, mode: 'quick' });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.brief_empty, true);
    assert.equal(line.mode, 'quick');
  });

  it('planeApiCall emits event=plane.api.call + method/path/status/duration_ms', () => {
    const sessionId = 'sess-ev-pac';
    const log = createLogger({ sessionId, minLevel: 'info' });
    planeApiCall(log, {
      method: 'GET',
      path: '/work-items/KL-42/',
      status: 200,
      duration_ms: 142,
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.PLANE_API_CALL);
    assert.equal(line.method, 'GET');
    assert.equal(line.path, '/work-items/KL-42/');
    assert.equal(line.status, 200);
    assert.equal(line.duration_ms, 142);
  });

  it('planeApiCallFailed emits event=plane.api.call.failed + step/error at error level', () => {
    const sessionId = 'sess-ev-pacf';
    const log = createLogger({ sessionId, minLevel: 'info' });
    planeApiCallFailed(log, { step: 'getTask', error: 'ECONNREFUSED' });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.PLANE_API_CALL_FAILED);
    assert.equal(line.level, 'error');
    assert.equal(line.step, 'getTask');
    assert.equal(line.error, 'ECONNREFUSED');
  });
});
