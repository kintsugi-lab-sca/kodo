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
  githubApiCall,
  githubApiCallFailed,
  worktreeCleanupOk,
  worktreeCleanupDirty,
  worktreeCleanupError,
  skillSyncAuto,
  skillSyncAutoError,
  pollingTick,
  pollingDispatch,
  pollingError,
  pollingTickSummary,
} = await import('../src/logger-events.js');

function logPathFor(sessionId) {
  return join(fixture.homeDir, '.kodo', 'logs', `${sessionId}.ndjson`);
}

describe('logger-events taxonomy (Phase 7 LOG-09 + Phase 19 worktree cleanup + Phase 21 skill sync + Phase 23 github client + Phase 25 polling trigger channel + Phase 28 polling.tick.summary)', () => {
  it('EVENTS is frozen and contains the 23 canonical types (Phase 38 grew 20 → 23: host.* reconciliation)', () => {
    assert.equal(Object.isFrozen(EVENTS), true);
    const types = Object.values(EVENTS).sort();
    assert.deepEqual(types, [
      'github.api.call',
      'github.api.call.failed',
      'gsd.bootstrap',
      'gsd.phase.resolved',
      'host.list_workspaces.fail',
      'host.list_workspaces.ok',
      'host.reconcile.tick',
      'orchestrator.review',
      'plane.api.call',
      'plane.api.call.failed',
      'polling.dispatch',
      'polling.error',
      'polling.tick',
      'polling.tick.summary',
      'session.end',
      'session.start',
      'skill.sync.auto',
      'skill.sync.auto.error',
      'state.migration.v2_to_v3',
      'state.transition',
      'worktree.cleanup.dirty',
      'worktree.cleanup.error',
      'worktree.cleanup.ok',
    ]);
    assert.equal(Object.keys(EVENTS).length, 23, 'EVENTS key count must equal 23 post-Phase-38');
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

  // ─── Phase 23 D-15/D-16: github api call helpers ─────────────────────────

  it('githubApiCall emits at info level when rate_limit_remaining >= 100', () => {
    const sessionId = 'sess-ev-ghac-info';
    const log = createLogger({ sessionId, minLevel: 'info' });
    githubApiCall(log, {
      method: 'GET',
      path: '/repos/octocat/hello-world/issues/42',
      status: 200,
      duration_ms: 123,
      rate_limit_remaining: 4998,
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.GITHUB_API_CALL);
    assert.equal(line.level, 'info');
    assert.equal(line.method, 'GET');
    assert.equal(line.path, '/repos/octocat/hello-world/issues/42');
    assert.equal(line.status, 200);
    assert.equal(line.duration_ms, 123);
    assert.equal(line.rate_limit_remaining, 4998);
  });

  it('githubApiCall emits at warn level when rate_limit_remaining < 100 (D-16 threshold)', () => {
    const sessionId = 'sess-ev-ghac-warn';
    const log = createLogger({ sessionId, minLevel: 'info' });
    githubApiCall(log, {
      method: 'GET',
      path: '/repos/octocat/hello-world/issues',
      status: 200,
      duration_ms: 80,
      rate_limit_remaining: 50,
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.GITHUB_API_CALL);
    assert.equal(line.level, 'warn');
    assert.equal(line.rate_limit_remaining, 50);
  });

  it('githubApiCallFailed emits event=github.api.call.failed + method/path/status/error at error level', () => {
    const sessionId = 'sess-ev-ghacf';
    const log = createLogger({ sessionId, minLevel: 'info' });
    githubApiCallFailed(log, {
      method: 'GET',
      path: '/repos/octocat/hello-world/issues/42',
      status: 404,
      error: 'Not Found',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.GITHUB_API_CALL_FAILED);
    assert.equal(line.level, 'error');
    assert.equal(line.method, 'GET');
    assert.equal(line.path, '/repos/octocat/hello-world/issues/42');
    assert.equal(line.status, 404);
    assert.equal(line.error, 'Not Found');
  });

  it('worktreeCleanupOk emits event=worktree.cleanup.ok at info level', () => {
    const sessionId = 'sess-ev-wtok';
    const log = createLogger({ sessionId, minLevel: 'info' });
    worktreeCleanupOk(log, {
      session_id: sessionId,
      worktree_path: '/tmp/wt',
      branch_deleted: true,
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.WORKTREE_CLEANUP_OK);
    assert.equal(line.level, 'info');
    assert.equal(line.session_id, sessionId);
    assert.equal(line.worktree_path, '/tmp/wt');
    assert.equal(line.branch_deleted, true);
  });

  it('worktreeCleanupDirty emits event=worktree.cleanup.dirty at warn level with moved_to', () => {
    const sessionId = 'sess-ev-wtdirty';
    const log = createLogger({ sessionId, minLevel: 'info' });
    worktreeCleanupDirty(log, {
      session_id: sessionId,
      worktree_path: '/tmp/wt',
      moved_to: '/tmp/wt.dirty',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.WORKTREE_CLEANUP_DIRTY);
    assert.equal(line.level, 'warn');
    assert.equal(line.session_id, sessionId);
    assert.equal(line.worktree_path, '/tmp/wt');
    assert.equal(line.moved_to, '/tmp/wt.dirty');
  });

  it('worktreeCleanupError emits event=worktree.cleanup.error at error level with phase+reason', () => {
    const sessionId = 'sess-ev-wterr';
    const log = createLogger({ sessionId, minLevel: 'info' });
    worktreeCleanupError(log, {
      session_id: sessionId,
      worktree_path: '/tmp/wt',
      phase: 'remove',
      reason: 'EBUSY: rmdir failed',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.WORKTREE_CLEANUP_ERROR);
    assert.equal(line.level, 'error');
    assert.equal(line.session_id, sessionId);
    assert.equal(line.worktree_path, '/tmp/wt');
    assert.equal(line.phase, 'remove');
    assert.equal(line.reason, 'EBUSY: rmdir failed');
  });

  // ─── Phase 21 D-09: skill sync auto helpers ──────────────────────────────

  it('EVENTS.SKILL_SYNC_AUTO === "skill.sync.auto"', () => {
    assert.equal(EVENTS.SKILL_SYNC_AUTO, 'skill.sync.auto');
  });

  it('EVENTS.SKILL_SYNC_AUTO_ERROR === "skill.sync.auto.error"', () => {
    assert.equal(EVENTS.SKILL_SYNC_AUTO_ERROR, 'skill.sync.auto.error');
  });

  it('skillSyncAuto emits event=skill.sync.auto at info level with source/dest/files_changed', () => {
    const sessionId = 'sess-ev-ssauto';
    const log = createLogger({ sessionId, minLevel: 'info' });
    skillSyncAuto(log, {
      source: '/repo/.claude/skills/kodo-orchestrate',
      dest: '/home/user/.claude/skills/kodo-orchestrate',
      files_changed: 3,
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.SKILL_SYNC_AUTO);
    assert.equal(line.level, 'info');
    assert.equal(line.source, '/repo/.claude/skills/kodo-orchestrate');
    assert.equal(line.dest, '/home/user/.claude/skills/kodo-orchestrate');
    assert.equal(line.files_changed, 3);
  });

  it('skillSyncAutoError emits event=skill.sync.auto.error at error level with source/dest/error', () => {
    const sessionId = 'sess-ev-ssauto-err';
    const log = createLogger({ sessionId, minLevel: 'info' });
    skillSyncAutoError(log, {
      source: '/repo/.claude/skills/kodo-orchestrate',
      dest: '/home/user/.claude/skills/kodo-orchestrate',
      error: 'EACCES: permission denied',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.SKILL_SYNC_AUTO_ERROR);
    assert.equal(line.level, 'error');
    assert.equal(line.source, '/repo/.claude/skills/kodo-orchestrate');
    assert.equal(line.dest, '/home/user/.claude/skills/kodo-orchestrate');
    assert.equal(line.error, 'EACCES: permission denied');
  });

  it('No SKILL_SYNC_AUTO_NOOP event (D-03b — silence on no-drift to avoid noise)', () => {
    // @ts-expect-error — assert undefined to guard the contract literally.
    assert.equal(EVENTS.SKILL_SYNC_AUTO_NOOP, undefined);
    const keys = Object.keys(EVENTS);
    assert.equal(keys.includes('SKILL_SYNC_AUTO_NOOP'), false);
    // Y tampoco hay literal 'skill.sync.auto.noop' en los valores.
    assert.equal(Object.values(EVENTS).includes('skill.sync.auto.noop'), false);
  });

  // ─── Phase 25 TEST-02: polling trigger channel helpers ───────────────────

  it('pollingTick emits event=polling.tick at info level with {owner, repo, status, dispatched}', () => {
    const sessionId = 'sess-ev-pollev-tick';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingTick(log, { owner: 'octocat', repo: 'hello', status: 200, dispatched: 3 });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.POLLING_TICK);
    assert.equal(line.level, 'info');
    assert.equal(line.owner, 'octocat');
    assert.equal(line.repo, 'hello');
    assert.equal(line.status, 200);
    assert.equal(line.dispatched, 3);
    // first_tick key MUST be absent when not provided (truthy-spread guard).
    assert.equal('first_tick' in line, false);
  });

  it('pollingTick includes first_tick:true when set; omits the key otherwise', () => {
    const sessionId = 'sess-ev-pollev-tick-first';
    const log = createLogger({ sessionId, minLevel: 'info' });
    // First tick → first_tick:true on the record.
    pollingTick(log, {
      owner: 'octocat',
      repo: 'hello',
      status: 200,
      dispatched: 0,
      first_tick: true,
    });
    // Second tick without first_tick → key must be absent.
    pollingTick(log, { owner: 'octocat', repo: 'hello', status: 304, dispatched: 0 });
    const lines = readAllLines(logPathFor(sessionId));
    const [first, second] = lines.slice(-2);
    assert.equal(first.first_tick, true);
    assert.equal('first_tick' in second, false);
  });

  it('pollingDispatch emits event=polling.dispatch at info level with {owner, repo, ref, pattern}', () => {
    const sessionId = 'sess-ev-pollev-dispatch';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingDispatch(log, {
      owner: 'octocat',
      repo: 'hello',
      ref: 'octocat/hello#42',
      pattern: 'a-new',
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.POLLING_DISPATCH);
    assert.equal(line.level, 'info');
    assert.equal(line.owner, 'octocat');
    assert.equal(line.repo, 'hello');
    assert.equal(line.ref, 'octocat/hello#42');
    assert.equal(line.pattern, 'a-new');
  });

  it('pollingDispatch does NOT leak user content (T-25-02 invariant: whitelist-only payload)', () => {
    // T-25-02: invariante de seguridad — polling.dispatch NDJSON NO debe filtrar
    // contenido de usuario. Cualquier campo extra que el caller pase (issueBody,
    // title, raw) tiene que ser descartado silenciosamente por el helper.
    const sessionId = 'sess-ev-pollev-dispatch-redaction';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingDispatch(
      log,
      /** @type {any} */ ({
        owner: 'octocat',
        repo: 'hello',
        ref: 'octocat/hello#42',
        pattern: 'b-updated',
        // Campos hostiles que NO deben aparecer en el NDJSON:
        issueBody: 'super-secret-token: ghp_xxxxxxxxxxxxxxxxxxxx',
        title: 'leaky title',
        raw: { token: 'xxx', body: 'pii' },
        body: 'should not appear',
      }),
    );
    const line = readAllLines(logPathFor(sessionId)).pop();
    // Whitelist asserted: only the 4 identification fields + the structural
    // (event, level, time) fields of the logger record.
    assert.equal(line.event, EVENTS.POLLING_DISPATCH);
    assert.equal(line.owner, 'octocat');
    assert.equal(line.repo, 'hello');
    assert.equal(line.ref, 'octocat/hello#42');
    assert.equal(line.pattern, 'b-updated');
    for (const forbidden of ['issueBody', 'title', 'raw', 'body']) {
      assert.equal(
        forbidden in line,
        false,
        `T-25-02 violation: pollingDispatch leaked '${forbidden}' into NDJSON`,
      );
    }
  });

  it('pollingError emits event=polling.error at warn level with {owner, repo, status, attempt}', () => {
    const sessionId = 'sess-ev-pollev-error-warn';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingError(log, { owner: 'octocat', repo: 'hello', status: 429, attempt: 2 });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.POLLING_ERROR);
    assert.equal(line.level, 'warn');
    assert.equal(line.owner, 'octocat');
    assert.equal(line.repo, 'hello');
    assert.equal(line.status, 429);
    assert.equal(line.attempt, 2);
    // error key MUST be absent when not provided (truthy-spread guard).
    assert.equal('error' in line, false);
  });

  it('pollingError includes error field only when provided', () => {
    const sessionId = 'sess-ev-pollev-error-no-error-field';
    const log = createLogger({ sessionId, minLevel: 'info' });
    // Sin `error` → key ausente.
    pollingError(log, { owner: 'octocat', repo: 'hello', status: 500, attempt: 1 });
    // Con `error` → key presente con el valor exacto.
    pollingError(log, {
      owner: 'octocat',
      repo: 'hello',
      status: 429,
      attempt: 3,
      error: 'rate limited',
    });
    const lines = readAllLines(logPathFor(sessionId));
    const [withoutErr, withErr] = lines.slice(-2);
    assert.equal('error' in withoutErr, false);
    assert.equal(withErr.error, 'rate limited');
  });

  // ─── Phase 28 D-10: polling.tick.summary cross-repo aggregate helper ─────

  it('EVENTS.POLLING_TICK_SUMMARY === "polling.tick.summary" (Phase 28 D-10)', () => {
    assert.equal(EVENTS.POLLING_TICK_SUMMARY, 'polling.tick.summary');
  });

  it('pollingTickSummary emits event=polling.tick.summary at info level with the 4 D-10 fields', () => {
    const sessionId = 'sess-ev-pollev-summary';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingTickSummary(log, {
      repos_polled: 2,
      total_dispatches: 5,
      rate_limit_remaining: 4823,
      repos: ['octocat/r1', 'octocat/r2'],
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.POLLING_TICK_SUMMARY);
    assert.equal(line.level, 'info');
    assert.equal(line.repos_polled, 2);
    assert.equal(line.total_dispatches, 5);
    assert.equal(line.rate_limit_remaining, 4823);
    assert.deepEqual(line.repos, ['octocat/r1', 'octocat/r2']);
  });

  it('pollingTickSummary preserves rate_limit_remaining=null (D-12 null fallback)', () => {
    const sessionId = 'sess-ev-pollev-summary-null';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingTickSummary(log, {
      repos_polled: 1,
      total_dispatches: 0,
      rate_limit_remaining: null,
      repos: ['octocat/r1'],
    });
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.rate_limit_remaining, null);
    assert.equal(line.event, EVENTS.POLLING_TICK_SUMMARY);
  });

  it('pollingTickSummary does NOT leak user content (T-25-02 invariant: whitelist-only payload)', () => {
    // T-25-02 mirror del test pollingDispatch (líneas 449-484): si el caller
    // pasa campos hostiles, el helper NO debe propagarlos al NDJSON. Whitelist
    // explícito field-by-field, NO spread.
    const sessionId = 'sess-ev-pollev-summary-redaction';
    const log = createLogger({ sessionId, minLevel: 'info' });
    pollingTickSummary(
      log,
      /** @type {any} */ ({
        repos_polled: 1,
        total_dispatches: 0,
        rate_limit_remaining: 5000,
        repos: ['octocat/r1'],
        // Campos hostiles que NO deben aparecer en el NDJSON:
        body: 'super-secret-token: ghp_xxxxxxxxxxxxxxxxxxxx',
        title: 'leaky title',
        raw: { token: 'xxx', body: 'pii' },
        payload: { sensitive: 'data' },
      }),
    );
    const line = readAllLines(logPathFor(sessionId)).pop();
    assert.equal(line.event, EVENTS.POLLING_TICK_SUMMARY);
    assert.equal(line.repos_polled, 1);
    assert.equal(line.total_dispatches, 0);
    assert.equal(line.rate_limit_remaining, 5000);
    assert.deepEqual(line.repos, ['octocat/r1']);
    for (const forbidden of ['body', 'title', 'raw', 'payload']) {
      assert.equal(
        forbidden in line,
        false,
        `T-25-02 violation: pollingTickSummary leaked '${forbidden}' into NDJSON`,
      );
    }
  });
});
