// @ts-check
//
// test/gsd-verify-cli.test.js — Tests unitarios CLI para src/gsd/verify.js.
//
// Cubre Plan 10-02:
//   - Sub-concern A: DI + resolución de sesión (T1, T2, T3).
//   - Sub-concern B: Descubrimiento de VERIFICATION.md (T4, T5, T6) — Pitfall #3.
//   - Sub-concern C: Verdict + side-effects Plane (T7..T10).
//   - Sub-concern D: Fail-open Plane (T18, T18b, T19, T19b) — D-17.
//   - Sub-concern E: Idempotencia (T11) — Pitfall #7.
//   - Sub-concern F: orchestratorReview mapping (T12..T16) — Pitfall #2.
//   - Sub-concern G: NO plane.api.call duplicado (T17) — Pitfall #5.
//   - Sub-concern H: Hoisted provider (T17b).
//
// Zero filesystem, zero red. Todos los side-effects inyectados via DI.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runGsdVerify } from '../src/gsd/verify.js';

// --- Fixtures ---

const validPassFrontmatter = [
  '---',
  'status: passed',
  'must_haves_total: 5',
  'must_haves_verified: 5',
  'gaps_count: 0',
  '---',
].join('\n');

const gapsFrontmatter = [
  '---',
  'status: passed',
  'must_haves_total: 5',
  'must_haves_verified: 5',
  'gaps_count: 2',
  '---',
].join('\n');

const malformedFrontmatter = [
  '---',
  'status: in_progress',
  'must_haves_total: 5',
  'must_haves_verified: 5',
  'gaps_count: 0',
  '---',
].join('\n');

// --- Mock factories ---

function makeSession(overrides = {}) {
  return {
    session_id: 'sess-1',
    task_id: 'task-uuid',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'proj-1',
    project_path: '/tmp/fake-project',
    summary: 'Implement orchestrator gate',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:1',
    gsd: true,
    phase_id: '10',
    ...overrides,
  };
}

function makeProviderMock(overrides = {}) {
  const calls = { getTask: [], addComment: [], updateTaskState: [] };
  const provider = {
    getTask:
      overrides.getTask ||
      (async (ref) => {
        calls.getTask.push(ref);
        return { id: 'task-uuid', ref, title: 'T', projectId: 'proj-1' };
      }),
    addComment:
      overrides.addComment ||
      (async (task, md) => {
        calls.addComment.push({ task, md });
      }),
    updateTaskState:
      overrides.updateTaskState ||
      (async (task, state) => {
        calls.updateTaskState.push({ task, state });
      }),
  };
  return { provider, calls };
}

function makeLoggerMock() {
  const events = [];
  const logger = {
    info: (msg, fields) => events.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => events.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => events.push({ level: 'error', msg, fields }),
    debug: (msg, fields) => events.push({ level: 'debug', msg, fields }),
    child: () => logger,
  };
  return { logger, events };
}

function makeConfig(overrides = {}) {
  return {
    provider: 'plane',
    providers: {
      plane: { states: { trigger: 'In Progress', review: 'In review', done: 'Done' } },
    },
    ...overrides,
  };
}

/**
 * Construye un set de deps predeterminado. Overrides permiten:
 *   - session: la SessionRecord a devolver desde findSessionFn.
 *   - verificationMd: el contenido del archivo (null = archivo no existe).
 *   - phaseExists: si el directorio .planning/phases existe.
 *   - extraDeps: deps adicionales/override (getProviderFn, readdirFn, etc).
 */
function makeDeps({ session, verificationMd, phaseExists = true, extraDeps = {} }) {
  const { provider, calls } = makeProviderMock();
  const { logger, events } = makeLoggerMock();

  // Spy sobre getProviderFn para contar invocaciones (Sub-concern H).
  let getProviderCalls = 0;
  const defaultGetProviderFn = async () => {
    getProviderCalls++;
    return provider;
  };

  const defaultExistsFn = (p) => {
    if (p.endsWith('phases')) return phaseExists;
    if (p.endsWith('VERIFICATION.md')) return verificationMd !== null;
    return true;
  };

  const defaultReaddirFn = () => (phaseExists ? ['10-foo', '09-bar'] : []);
  const defaultReadFileFn = () => verificationMd;

  const deps = {
    findSessionFn: () => session,
    getProviderFn: extraDeps.getProviderFn || defaultGetProviderFn,
    loadConfigFn: extraDeps.loadConfigFn || (() => makeConfig()),
    existsFn: extraDeps.existsFn || defaultExistsFn,
    readdirFn: extraDeps.readdirFn || defaultReaddirFn,
    readFileFn: extraDeps.readFileFn || defaultReadFileFn,
    loggerFactory: extraDeps.loggerFactory || (() => logger),
  };

  return {
    deps,
    calls,
    events,
    getProviderCalls: () => getProviderCalls,
  };
}

// --- Tests ---

describe('runGsdVerify — DI + session resolution', () => {
  it('T1: throws cuando session-id no encontrado', async () => {
    await assert.rejects(
      () => runGsdVerify({ sessionId: 'nope' }, { findSessionFn: () => undefined }),
      /session not found: nope/,
    );
  });

  it('T2: throws cuando session.gsd === false', async () => {
    const session = makeSession({ gsd: false });
    await assert.rejects(
      () => runGsdVerify({ sessionId: 'sess-1' }, { findSessionFn: () => session }),
      /session is not GSD/,
    );
  });

  it('T3: session sin phase_id → malformed, no filesystem (Pitfall #4)', async () => {
    const session = makeSession({ phase_id: undefined });
    const { deps, calls } = makeDeps({ session, verificationMd: null });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'malformed');
    assert.match(result.verdict.detail, /no phase_id/);
    assert.equal(calls.addComment.length, 1, 'addComment se llama igual (comentario de malformed)');
    assert.equal(calls.updateTaskState.length, 0);
  });
});

describe('runGsdVerify — VERIFICATION.md discovery (Pitfall #3)', () => {
  it('T4: archivo no existe → missing', async () => {
    const session = makeSession();
    const { deps, calls } = makeDeps({ session, verificationMd: null, phaseExists: true });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'missing');
    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.updateTaskState.length, 0);
  });

  it('T5: no hay directorio de fase → missing', async () => {
    const session = makeSession();
    const { deps } = makeDeps({ session, verificationMd: null, phaseExists: false });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'missing');
  });

  it('T6: prefix-match exacto: "03" NO matchea "30-other" (Pitfall #3)', async () => {
    const session = makeSession({ phase_id: '03' });
    let readPath;
    const { deps } = makeDeps({
      session,
      verificationMd: validPassFrontmatter,
      extraDeps: {
        readdirFn: () => ['30-other', '03-foundation'],
        existsFn: (p) => {
          if (p.endsWith('phases')) return true;
          if (p.includes('03-foundation') && p.endsWith('VERIFICATION.md')) return true;
          if (p.endsWith('VERIFICATION.md')) return false;
          return true;
        },
        readFileFn: (p) => {
          readPath = p;
          return validPassFrontmatter;
        },
      },
    });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'pass', `prefix match debería encontrar 03-foundation (verdict=${result.verdict.action})`);
    assert.match(readPath, /03-foundation/);
    assert.ok(!readPath.includes('30-other'));
  });
});

describe('runGsdVerify — verdict → Plane side-effects', () => {
  it('T7: pass → addComment 1x + updateTaskState 1x con config.providers[plane].states.review (Pitfall #1)', async () => {
    const session = makeSession();
    const { deps, calls } = makeDeps({ session, verificationMd: validPassFrontmatter });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'pass');
    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.updateTaskState.length, 1);
    assert.equal(calls.updateTaskState[0].state, 'In review'); // Pitfall #1: providers[plane].states.review
    assert.match(calls.addComment[0].md, /✅ Phase 10/);
    assert.equal(result.plane.commented, true);
    assert.equal(result.plane.transitioned, true);
  });

  it('T8: fail → addComment 1x, updateTaskState 0x (D-12)', async () => {
    const session = makeSession();
    const { deps, calls } = makeDeps({ session, verificationMd: gapsFrontmatter });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'fail');
    assert.equal(result.verdict.reason, 'gaps-found');
    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.updateTaskState.length, 0);
    assert.match(calls.addComment[0].md, /❌ Phase 10 bloqueada/);
  });

  it('T9: missing → addComment 1x, updateTaskState 0x', async () => {
    const session = makeSession();
    const { deps, calls } = makeDeps({ session, verificationMd: null });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'missing');
    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.updateTaskState.length, 0);
    assert.match(calls.addComment[0].md, /⚠️/);
  });

  it('T10: malformed → addComment 1x, updateTaskState 0x', async () => {
    const session = makeSession();
    const { deps, calls } = makeDeps({ session, verificationMd: malformedFrontmatter });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'malformed');
    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.updateTaskState.length, 0);
    assert.match(calls.addComment[0].md, /⚠️/);
  });
});

describe('runGsdVerify — idempotencia (Pitfall #7)', () => {
  it('T11: dos invocaciones → addComment 2x (no dedup)', async () => {
    const session = makeSession();
    const { deps, calls } = makeDeps({ session, verificationMd: validPassFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(calls.addComment.length, 2);
    assert.equal(calls.addComment[0].md, calls.addComment[1].md, 'idénticos byte-a-byte (sin timestamp en la plantilla)');
  });
});

describe('runGsdVerify — orchestratorReview mapping (Pitfall #2)', () => {
  it('T12: pass → orchestratorReview { verdict: "approved", reason: "gate-passed" }', async () => {
    const session = makeSession();
    const { deps, events } = makeDeps({ session, verificationMd: validPassFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review, 'orchestrator.review emitted');
    assert.equal(review.fields.verdict, 'approved');
    assert.equal(review.fields.reason, 'gate-passed');
    assert.equal(review.fields.phase_id, '10');
  });

  it('T13: fail gaps-found → verdict blocked, reason incluye "gaps-found"', async () => {
    const session = makeSession();
    const { deps, events } = makeDeps({ session, verificationMd: gapsFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review);
    assert.equal(review.fields.verdict, 'blocked');
    assert.match(review.fields.reason, /gaps-found/);
  });

  it('T14: missing → verdict blocked, reason "missing"', async () => {
    const session = makeSession();
    const { deps, events } = makeDeps({ session, verificationMd: null });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review);
    assert.equal(review.fields.verdict, 'blocked');
    assert.equal(review.fields.reason, 'missing');
  });

  it('T15: malformed → verdict blocked, reason incluye "malformed"', async () => {
    const session = makeSession();
    const { deps, events } = makeDeps({ session, verificationMd: malformedFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review);
    assert.equal(review.fields.verdict, 'blocked');
    assert.match(review.fields.reason, /malformed/);
  });

  it('T16: orchestratorReview emitido EXACTAMENTE 1 vez por run', async () => {
    const session = makeSession();
    const { deps, events } = makeDeps({ session, verificationMd: validPassFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    const reviews = events.filter((e) => e.msg === 'orchestrator.review');
    assert.equal(reviews.length, 1);
  });
});

describe('runGsdVerify — NO plane.api.call duplicado (Pitfall #5)', () => {
  it('T17: events NO contienen plane.api.call (success) emitido por verify.js', async () => {
    const session = makeSession();
    const { deps, events } = makeDeps({ session, verificationMd: validPassFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    const planeSuccess = events.filter((e) => e.msg === 'plane.api.call');
    assert.equal(planeSuccess.length, 0, 'verify.js does NOT emit plane.api.call');
  });

  it('T17b: getProviderFn se invoca EXACTAMENTE 1 vez por runGsdVerify (hoisted provider)', async () => {
    const session = makeSession();
    const { deps, getProviderCalls } = makeDeps({ session, verificationMd: validPassFrontmatter });
    await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(getProviderCalls(), 1, 'finalize debe hoistear provider, no llamarlo 3 veces');
  });
});

describe('runGsdVerify — fail-open Plane (D-17)', () => {
  it('T18: getTask lanza → addComment NO invocado, orchestratorReview emitido con blocked+plane-unreachable', async () => {
    const session = makeSession();
    const brokenProvider = {
      getTask: async () => {
        throw new Error('plane 500 getTask');
      },
      addComment: async () => {
        throw new Error('should not be called');
      },
      updateTaskState: async () => {
        throw new Error('should not be called');
      },
    };
    const { deps, events } = makeDeps({
      session,
      verificationMd: validPassFrontmatter,
      extraDeps: { getProviderFn: async () => brokenProvider },
    });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.plane.commented, false);
    assert.equal(result.plane.transitioned, false);
    const getTaskFail = events.find(
      (e) => e.msg === 'plane.api.call.failed' && e.fields && e.fields.step === 'getTask',
    );
    assert.ok(getTaskFail, 'plane.api.call.failed{step:getTask} emitido');
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review, 'review emitido a pesar del fallo');
    assert.equal(review.fields.verdict, 'blocked');
    assert.match(review.fields.reason, /plane-unreachable/);
  });

  it('T18b: getTask lanza (verdict pass) → transitioned=false, commented=false, review=blocked', async () => {
    const session = makeSession();
    const brokenProvider = {
      getTask: async () => {
        throw new Error('ECONNREFUSED');
      },
      addComment: async () => {},
      updateTaskState: async () => {},
    };
    const { deps, events } = makeDeps({
      session,
      verificationMd: validPassFrontmatter,
      extraDeps: { getProviderFn: async () => brokenProvider },
    });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.verdict.action, 'pass'); // verdict local sigue siendo pass
    assert.equal(result.plane.commented, false);
    assert.equal(result.plane.transitioned, false);
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review);
    assert.equal(review.fields.verdict, 'blocked', 'degrade a blocked porque side-effects no completaron');
    assert.match(review.fields.reason, /plane-unreachable/);
  });

  it('T19: addComment lanza (getTask OK, verdict pass) → updateTaskState NO invocado, review emitido', async () => {
    const session = makeSession();
    const calls = { updateTaskState: [] };
    const brokenProvider = {
      getTask: async () => ({ id: 'task-uuid', ref: 'KL-42', title: 'T', projectId: 'proj-1' }),
      addComment: async () => {
        throw new Error('plane 500 addComment');
      },
      updateTaskState: async (t, s) => {
        calls.updateTaskState.push({ t, s });
      },
    };
    const { deps, events } = makeDeps({
      session,
      verificationMd: validPassFrontmatter,
      extraDeps: { getProviderFn: async () => brokenProvider },
    });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.plane.commented, false);
    assert.equal(result.plane.transitioned, false);
    assert.equal(calls.updateTaskState.length, 0, 'no transicionamos si no comentamos');
    const addFail = events.find(
      (e) => e.msg === 'plane.api.call.failed' && e.fields && e.fields.step === 'addComment',
    );
    assert.ok(addFail);
  });

  it('T19b: updateTaskState lanza (pass, addComment OK) → commented=true, transitioned=false, review=approved', async () => {
    const session = makeSession();
    const brokenProvider = {
      getTask: async () => ({ id: 'task-uuid', ref: 'KL-42', title: 'T', projectId: 'proj-1' }),
      addComment: async () => {},
      updateTaskState: async () => {
        throw new Error('plane 500 updateTaskState');
      },
    };
    const { deps, events } = makeDeps({
      session,
      verificationMd: validPassFrontmatter,
      extraDeps: { getProviderFn: async () => brokenProvider },
    });
    const result = await runGsdVerify({ sessionId: 'sess-1' }, deps);
    assert.equal(result.plane.commented, true);
    assert.equal(result.plane.transitioned, false);
    const review = events.find((e) => e.msg === 'orchestrator.review');
    assert.ok(review);
    assert.equal(
      review.fields.verdict,
      'approved',
      'el verdict local es pass y addComment OK → approved (updateTaskState fallo es transient)',
    );
    const updFail = events.find(
      (e) => e.msg === 'plane.api.call.failed' && e.fields && e.fields.step === 'updateTaskState',
    );
    assert.ok(updFail);
  });
});
