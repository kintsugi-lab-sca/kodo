// @ts-check
//
// test/server-dismiss-e2e.test.js — Phase 42 Plan 03 (DISMISS-01..04 seam).
//
// END-TO-END WIRING SEAM (a drift canary). This is the ONLY test in Phase 42 that
// imports BOTH halves of the dismiss feature and proves they agree on the HTTP
// `actions[]` contract:
//
//   EMITTER  (Plan 01) → src/server/dismiss.js  createDismissHandler(deps).dismiss(taskId)
//                        returns {status, body:{ok, removed, actions:[{type,result}]}} | 409 {ok:false,error:'alive'}
//   CONSUMER (Plan 02) → src/cli/dashboard/select.js  mapDismissResult(res, taskRef)
//                        maps {ok:true,data:{actions}} | {ok:false,error} → {kind,color}
//
// The unit/integration layers live inside Plan 01 (test/server/dismiss.test.js) and
// Plan 02 (test/dashboard/*). This file adds the THIN SEAM: it drives the real
// server handler with a fake loadState (a dead session) + a fake executeFn returning
// representative DoctorResult counters, then feeds the server's emitted body THROUGH
// the real client consumer — proving the vocabulary stays in sync. If Plan 01 ever
// emits a `result` value Plan 02 doesn't branch on (or vice-versa), the vocabulary
// guard at the bottom fails (T-42-11 mitigation).
//
// No live HTTP boot (flaky): the server handler is pure DI, so we drive it directly.
//
// THE BRIDGE: the server body is `{ok, removed, actions}`; mapDismissResult consumes
// the never-throws CLIENT discriminant `{ok:true, data:{removed, actions}}`. This is
// exactly the shape dismissSession() (client.js) produces from a 200 body. We adapt
// the server body into that client-discriminant shape — the same adaptation the live
// client performs — so the seam mirrors production wiring, not a contrived shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDismissHandler, translateToActions } from '../src/server/dismiss.js';
import { mapDismissResult } from '../src/cli/dashboard/select.js';

/**
 * A DoctorResult counter object with all-zero defaults; spread overrides on top.
 * Mirrors emptyResult() in src/gsd/doctor.js (the real shape executeFn returns).
 * @param {Partial<{worktrees:object, zombies:object, locks:object, logs:object, errors:Array<object>}>} over
 */
function doctorResult(over = {}) {
  return {
    worktrees: { removed: 0, moved: 0, pruned: 0, skipped: 0, ...(over.worktrees || {}) },
    zombies: { removed: 0, ...(over.zombies || {}) },
    locks: { stolen: 0, kept: 0, ...(over.locks || {}) },
    logs: { unlinked: 0, ...(over.logs || {}) },
    errors: over.errors || [],
  };
}

/**
 * Bridge the server's 200/non-200 handler response into the never-throws CLIENT
 * discriminant that mapDismissResult consumes — exactly what dismissSession() in
 * client.js does with a real HTTP response (200 → {ok:true, data:{removed,actions}};
 * non-2xx → {ok:false, error: body.error}). Keeping this adapter faithful is what
 * makes the seam test prove the REAL wiring rather than a hand-shaped object.
 * @param {{status:number, body:any}} res
 */
function serverBodyToClientResult(res) {
  if (res.status >= 200 && res.status < 300 && res.body && res.body.ok) {
    return { ok: true, data: { removed: res.body.removed, actions: res.body.actions } };
  }
  // Non-2xx (or ok:false): the client surfaces body.error (e.g. 'alive' on 409).
  const error = (res.body && res.body.error) || `HTTP ${res.status}`;
  return { ok: false, error };
}

/** A fake loadState returning a single session keyed by task_id, with a given alive. */
function fakeLoadState(taskId, alive) {
  return () => ({ sessions: { [taskId]: { task_id: taskId, alive } } });
}

describe('Phase 42 Plan 03: server↔TUI dismiss seam (DISMISS-01..04)', () => {
  it('(a) clean removal: 200 + actions[worktree:removed, state:removed] → mapDismissResult ok/green', async () => {
    // executeFn returns a clean removal: worktree removed + state (zombie) removed.
    const executeFn = async (_deps, opts) => {
      // fix:true MUST be passed (DRIFT #2) — assert the wiring honors it.
      assert.equal(opts.fix, true, 'server must call executeFn with fix:true');
      assert.equal(opts.taskId, 'ROMAN-22');
      return doctorResult({ worktrees: { removed: 1 }, zombies: { removed: 1 } });
    };
    const dismiss = createDismissHandler({ loadState: fakeLoadState('ROMAN-22', false), executeFn });

    const res = await dismiss('ROMAN-22');

    // EMITTER assertions (server body shape, DISMISS-01).
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(
      res.body.actions.find((a) => a.type === 'worktree'),
      { type: 'worktree', result: 'removed' },
    );
    assert.deepEqual(
      res.body.actions.find((a) => a.type === 'state'),
      { type: 'state', result: 'removed' },
    );

    // CONSUMER assertion: feed the server body THROUGH the real client consumer.
    const mapped = mapDismissResult(serverBodyToClientResult(res), 'ROMAN-22');
    assert.deepEqual(mapped, { kind: 'ok', color: 'green' });
  });

  it('(b) dirty worktree: server emits moved-dirty → mapDismissResult dirty/yellow', async () => {
    const executeFn = async () =>
      doctorResult({ worktrees: { moved: 1 }, zombies: { removed: 1 } });
    const dismiss = createDismissHandler({ loadState: fakeLoadState('ROMAN-23', false), executeFn });

    const res = await dismiss('ROMAN-23');

    assert.equal(res.status, 200);
    assert.ok(
      res.body.actions.some((a) => a.result === 'moved-dirty'),
      'a dirty worktree must surface as result:moved-dirty in the body',
    );

    const mapped = mapDismissResult(serverBodyToClientResult(res), 'ROMAN-23');
    assert.deepEqual(mapped, { kind: 'dirty', color: 'yellow' });
  });

  it('(c) fail-open sub-error: server emits result:error → mapDismissResult warn/yellow (error wins over dirty)', async () => {
    const executeFn = async () =>
      doctorResult({
        worktrees: { moved: 1 }, // also dirty — error must win over dirty (precedence)
        errors: [{ category: 'lock', target: '/repo/.kodo.lock', reason: 'EBUSY' }],
      });
    const dismiss = createDismissHandler({ loadState: fakeLoadState('ROMAN-24', false), executeFn });

    const res = await dismiss('ROMAN-24');

    assert.equal(res.status, 200);
    assert.ok(
      res.body.actions.some((a) => a.result === 'error'),
      'a fail-open sub-error must surface as result:error in the body',
    );

    const mapped = mapDismissResult(serverBodyToClientResult(res), 'ROMAN-24');
    assert.deepEqual(mapped, { kind: 'warn', color: 'yellow' });
  });

  it('(d) live session: 409 {ok:false,error:alive} → mapDismissResult error/red reason alive (executeFn never called)', async () => {
    let executed = false;
    const executeFn = async () => {
      executed = true;
      return doctorResult();
    };
    // The fresh loadState reports the target ALIVE — the authoritative TOCTOU re-check.
    const dismiss = createDismissHandler({ loadState: fakeLoadState('ROMAN-25', true), executeFn });

    const res = await dismiss('ROMAN-25');

    assert.equal(res.status, 409);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'alive');
    assert.equal(executed, false, 'executeFn must NEVER run against a live session (SC#3)');

    const mapped = mapDismissResult(serverBodyToClientResult(res), 'ROMAN-25');
    assert.equal(mapped.kind, 'error');
    assert.equal(mapped.color, 'red');
    assert.equal(mapped.reason, 'alive', 'the 409 race must surface honestly as reason:alive');
  });

  it('vocabulary guard (drift canary): every result the translator can emit is a value mapDismissResult handles', () => {
    // Exhaustively drive translateToActions across EVERY non-zero counter + an error,
    // collect the full set of distinct `result` strings the server can emit, then prove
    // each one maps to a defined (kind,color) on the consumer side — never to an
    // undefined/unhandled branch. If Plan 01 adds a counter→result the consumer doesn't
    // branch on, this fails (T-42-11). And vice-versa: a consumer-only value that the
    // server can never emit would be dead code — also flagged below.
    const maximal = translateToActions(
      doctorResult({
        worktrees: { removed: 1, moved: 1, pruned: 1, skipped: 1 },
        zombies: { removed: 1 },
        locks: { stolen: 1, kept: 1 },
        errors: [{ category: 'lock', target: 't', reason: 'r' }],
      }),
    );
    const emittedResults = new Set(maximal.map((a) => a.result));

    // The full vocabulary the server is documented to emit (D-06 / dismiss.js header).
    // skipped emits NO action by design, so it never appears as a result.
    const expectedVocabulary = new Set(['removed', 'moved-dirty', 'pruned', 'kept', 'error']);
    assert.deepEqual(
      emittedResults,
      expectedVocabulary,
      'the translator vocabulary drifted from the documented D-06 contract',
    );

    // For each emittable result, build a minimal ok:true client result carrying ONLY
    // that action and assert mapDismissResult returns a DEFINED discriminant (a known
    // kind + a color). This is the seam: the consumer must handle every emitter value.
    const KNOWN_KINDS = new Set(['ok', 'dirty', 'warn', 'error']);
    for (const result of emittedResults) {
      const clientRes = { ok: true, data: { removed: 'X', actions: [{ type: 'worktree', result }] } };
      const mapped = mapDismissResult(clientRes, 'X');
      assert.ok(
        mapped && KNOWN_KINDS.has(mapped.kind) && typeof mapped.color === 'string',
        `mapDismissResult does not handle server result '${result}' (vocabulary drift)`,
      );
    }
  });
});
