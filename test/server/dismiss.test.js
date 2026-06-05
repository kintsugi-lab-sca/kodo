// @ts-check
//
// test/server/dismiss.test.js — Phase 42 Plan 01 (DISMISS-01, DISMISS-04).
//
// Unit tests for the pure, DI-driven dismiss handler. The destructive DELETE
// /sessions/{id} logic is extracted out of server.js (mirroring Phase 40's
// provider-state.js precedent) precisely so the 409 TOCTOU guard, the
// DoctorResult→actions[] translation, the fix:true lock, and the never-throws
// collapse are testable WITHOUT booting the HTTP server.
//
// DI style mirrors test/server/provider-state.test.js: inject a fake `loadState`
// (controls the fresh `alive` re-read for the 409 guard) and an `executeFn` spy
// (captures its args + call count), plus a spy logger that captures emitted events.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDismissHandler, translateToActions } from '../../src/server/dismiss.js';

/** A DoctorResult with every counter at zero (mirror doctor.js emptyResult). */
function emptyResult() {
  return {
    worktrees: { removed: 0, moved: 0, pruned: 0, skipped: 0 },
    zombies: { removed: 0 },
    locks: { stolen: 0, kept: 0 },
    logs: { unlinked: 0 },
    errors: [],
  };
}

/**
 * Spy logger compatible with the logger-events helpers (sessionDismissed calls
 * `logger.info`). Captures every emitted record.
 */
function makeSpyLogger() {
  const records = [];
  const capture = (level) => (event, fields) => records.push({ level, event, fields });
  return {
    records,
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    child() { return this; },
  };
}

describe('Phase 42 Plan 01: translateToActions (DISMISS-01 / DRIFT #1)', () => {
  it('removed worktree + removed state → [{worktree,removed},{state,removed}]', () => {
    const r = emptyResult();
    r.worktrees.removed = 1;
    r.zombies.removed = 1;
    const actions = translateToActions(r);
    assert.deepEqual(actions, [
      { type: 'worktree', result: 'removed' },
      { type: 'state', result: 'removed' },
    ]);
  });

  it('moved worktree → {type:worktree, result:moved-dirty} (fires DISMISS_PARTIAL_DIRTY)', () => {
    const r = emptyResult();
    r.worktrees.moved = 1;
    const actions = translateToActions(r);
    assert.deepEqual(actions, [{ type: 'worktree', result: 'moved-dirty' }]);
  });

  it('pruned worktree → {type:worktree, result:pruned}', () => {
    const r = emptyResult();
    r.worktrees.pruned = 1;
    assert.deepEqual(translateToActions(r), [{ type: 'worktree', result: 'pruned' }]);
  });

  it('locks.stolen → {lock,removed}; locks.kept → {lock,kept}', () => {
    const r = emptyResult();
    r.locks.stolen = 1;
    r.locks.kept = 1;
    assert.deepEqual(translateToActions(r), [
      { type: 'lock', result: 'removed' },
      { type: 'lock', result: 'kept' },
    ]);
  });

  it('non-empty errors[] → one {type:<category>, result:error} per element', () => {
    const r = emptyResult();
    r.worktrees.removed = 1;
    r.errors = [
      { category: 'worktree', target: '/wt', reason: 'EACCES' },
      { category: 'lock', target: '/lock', reason: 'EBUSY' },
    ];
    const actions = translateToActions(r);
    assert.deepEqual(actions, [
      { type: 'worktree', result: 'removed' },
      { type: 'worktree', result: 'error' },
      { type: 'lock', result: 'error' },
    ]);
  });

  it('worktrees.skipped does NOT emit an action (guard hit, not a mutation)', () => {
    const r = emptyResult();
    r.worktrees.skipped = 1;
    assert.deepEqual(translateToActions(r), []);
  });

  it('all-zero DoctorResult → [] (byte-deterministic empty)', () => {
    assert.deepEqual(translateToActions(emptyResult()), []);
  });
});

describe('Phase 42 Plan 01: createDismissHandler (DISMISS-01, DISMISS-04)', () => {
  it('409 TOCTOU: session revived (alive===true) between arm and confirm → 409, executeFn NEVER called', async () => {
    // Source: RESEARCH §"TOCTOU determinista" — loadState flips alive to true
    // before the DELETE arrives; the server re-reads fresh state (D-07/D-08, SC#3).
    let alive = false; // state at arm time (dead)
    const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive } } });
    let executed = false;
    const executeFn = async () => { executed = true; return emptyResult(); };
    const dismiss = createDismissHandler({ loadState, executeFn });

    alive = true; // ← session revives BEFORE the DELETE (server re-reads fresh)
    const { status, body } = await dismiss('T-1');
    assert.equal(status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'alive');
    assert.equal(executed, false, 'execute MUST NEVER run on a live session (SC#3)');
  });

  it('dead session → calls executeFn({}, {taskId, fix:true}) exactly once and returns 200 + actions[]', async () => {
    // Anti-Pitfall #2: fix:true is MANDATORY or execute is a silent no-op.
    const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive: false } } });
    const calls = [];
    const executeFn = async (deps, opts) => {
      calls.push({ deps, opts });
      const r = emptyResult();
      r.worktrees.removed = 1;
      r.zombies.removed = 1;
      return r;
    };
    const dismiss = createDismissHandler({ loadState, executeFn });

    const { status, body } = await dismiss('T-1');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.removed, 'T-1');
    assert.deepEqual(body.actions, [
      { type: 'worktree', result: 'removed' },
      { type: 'state', result: 'removed' },
    ]);
    assert.equal(calls.length, 1, 'executeFn called exactly once');
    assert.deepEqual(calls[0].opts, { taskId: 'T-1', fix: true }, 'fix:true is locked (DRIFT #2)');
    assert.deepEqual(calls[0].deps, {}, 'real deps defaulted inside doctor (empty deps object passed)');
  });

  it('unknown taskId (no fresh session) → not a 409 guard, proceeds to execute with fix:true', async () => {
    // A session that is already gone from state.json (or never existed) is NOT alive,
    // so the guard does not fire — execute runs (and is a harmless no-op for that id).
    const loadState = () => ({ sessions: {} });
    let opts;
    const executeFn = async (_deps, o) => { opts = o; return emptyResult(); };
    const dismiss = createDismissHandler({ loadState, executeFn });

    const { status, body } = await dismiss('GONE');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(opts, { taskId: 'GONE', fix: true });
  });

  it('never-throws: executeFn that rejects → {status:500, body:{ok:false, error}}, no throw escapes', async () => {
    const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive: false } } });
    const executeFn = async () => { throw new Error('boom'); };
    const dismiss = createDismissHandler({ loadState, executeFn });

    const { status, body } = await dismiss('T-1');
    assert.equal(status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'boom');
  });

  it('never-throws: loadState that throws → {status:500, body:{ok:false, error}}, no throw escapes', async () => {
    const loadState = () => { throw new Error('state read failed'); };
    let executed = false;
    const executeFn = async () => { executed = true; return emptyResult(); };
    const dismiss = createDismissHandler({ loadState, executeFn });

    const { status, body } = await dismiss('T-1');
    assert.equal(status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'state read failed');
    assert.equal(executed, false, 'a thrown loadState must short-circuit before execute');
  });

  it('emits SESSION_DISMISSED aggregate event with {task_id, actions_count} on success', async () => {
    const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive: false } } });
    const executeFn = async () => {
      const r = emptyResult();
      r.worktrees.removed = 1;
      r.zombies.removed = 1;
      return r;
    };
    const logger = makeSpyLogger();
    const dismiss = createDismissHandler({ loadState, executeFn, logger });

    await dismiss('T-1');
    const dismissed = logger.records.filter((r) => r.event === 'session.dismissed');
    assert.equal(dismissed.length, 1, 'exactly one aggregate event');
    assert.equal(dismissed[0].level, 'info');
    assert.equal(dismissed[0].fields.task_id, 'T-1');
    assert.equal(dismissed[0].fields.actions_count, 2);
  });

  it('does NOT emit SESSION_DISMISSED on a 409 guard hit (nothing was mutated)', async () => {
    const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive: true } } });
    const executeFn = async () => emptyResult();
    const logger = makeSpyLogger();
    const dismiss = createDismissHandler({ loadState, executeFn, logger });

    await dismiss('T-1');
    assert.equal(
      logger.records.filter((r) => r.event === 'session.dismissed').length,
      0,
      '409 guard must not log a dismiss (no mutation happened)',
    );
  });

  it('logger is optional — handler works without one injected', async () => {
    const loadState = () => ({ sessions: { 'T-1': { task_id: 'T-1', alive: false } } });
    const executeFn = async () => emptyResult();
    const dismiss = createDismissHandler({ loadState, executeFn }); // no logger
    const { status } = await dismiss('T-1');
    assert.equal(status, 200);
  });
});
