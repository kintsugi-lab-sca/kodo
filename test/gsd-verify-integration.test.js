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
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGsdVerify, renderComment } from '../src/gsd/verify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERIFY_SOURCE_PATH = resolve(__dirname, '..', 'src', 'gsd', 'verify.js');

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

  // Phase 19 D-06: sesión v0.6+ con worktree_path → phasesRoot resuelve allí.
  function makeSessionWithWorktree(tmpWorktree) {
    return {
      ...makeSession(),
      worktree_path: tmpWorktree,
    };
  }

  // Phase 19 D-09: sesión legacy v0.5 sin worktree_path → fallback silent a project_path.
  function makeLegacySession() {
    return makeSession();
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
    // Phase 16 LOG-14 SC#2: pass branch emite state.transition con from/to/reason canónicos.
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.ok(transition, 'pass + Plane OK debe emitir state.transition');
    assert.equal(transition.level, 'info');
    assert.equal(transition.fields.to, 'review');
    assert.equal(transition.fields.reason, 'gate-passed');
    // from depende del session.status previo (fixture: 'review'); el test confirma
    // que el campo existe y NO está vacío.
    assert.ok(typeof transition.fields.from === 'string' && transition.fields.from.length > 0);
    // Plan 15-04 Task 1: result.plane.comment_body expuesto, byte-idéntico al md posteado.
    assert.equal(typeof result.plane.comment_body, 'string');
    assert.match(result.plane.comment_body, /^\[kodo:gsd\] ✅ Phase 10 verificada/);
    assert.equal(
      result.plane.comment_body,
      calls.addComment[0].md,
      'comment_body debe ser byte-idéntico al markdown que recibe addComment',
    );
    // Byte-equality contra renderComment importado directamente:
    const expectedMd = renderComment(result.verdict, 'Orchestrator gate');
    assert.equal(result.plane.comment_body, expectedMd, 'byte-equality con renderComment(verdict, phaseName)');
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
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'fail');
    assert.equal(result.verdict.reason, 'gaps-found');
    assert.match(result.verdict.detail, /gaps_count=2/);
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /❌ Phase 10 bloqueada/);
    assert.match(calls.addComment[0].md, /gaps_count=2/);
    assert.equal(calls.updateTaskState.length, 0);
    // Plan 15-04 Task 1: result.plane.comment_body expuesto en fail.
    assert.equal(typeof result.plane.comment_body, 'string');
    assert.match(result.plane.comment_body, /^\[kodo:gsd\] ❌ Phase 10 bloqueada/);
    assert.equal(result.plane.comment_body, calls.addComment[0].md);
    // Phase 16 LOG-14 SC#3: soft-fail (gaps-found) NO emite state.transition.
    // B-1: assertion message menciona 'soft-fail' explícitamente para distinguirlo
    // del hard-fail (status-failed) testeado en otro caso.
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.equal(
      transition,
      undefined,
      'soft-fail (gaps-found) must NOT emit state.transition — verdict.action !== "pass"',
    );
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
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'malformed');
    assert.match(result.verdict.detail, /in_progress/);
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /⚠️/);
    assert.equal(calls.updateTaskState.length, 0);
    // Plan 15-04 Task 1: result.plane.comment_body expuesto en malformed (con phase_id).
    assert.equal(typeof result.plane.comment_body, 'string');
    assert.match(result.plane.comment_body, /^\[kodo:gsd\] ⚠️ VERIFICATION\.md presente pero inválido/);
    assert.equal(result.plane.comment_body, calls.addComment[0].md);
    // Phase 16 LOG-14 SC#3: malformed NO emite state.transition.
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.equal(transition, undefined, 'malformed branch must NOT emit state.transition');
  });

  it('T23 E2E: sin directorio de fase → missing', async () => {
    // Eliminar el directorio 10-* pero mantener .planning/phases/
    rmSync(join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate'), {
      recursive: true,
    });
    const session = makeSession();
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'missing');
    assert.equal(calls.addComment.length, 1);
    assert.match(calls.addComment[0].md, /⚠️ VERIFICATION.md no encontrado/);
    assert.equal(calls.updateTaskState.length, 0);
    // Plan 15-04 Task 1: result.plane.comment_body expuesto en missing.
    assert.equal(typeof result.plane.comment_body, 'string');
    assert.match(result.plane.comment_body, /^\[kodo:gsd\] ⚠️ VERIFICATION\.md no encontrado/);
    assert.equal(result.plane.comment_body, calls.addComment[0].md);
    // Phase 16 LOG-14 SC#3: missing NO emite state.transition.
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.equal(transition, undefined, 'missing branch must NOT emit state.transition');
  });

  it('T24 E2E (Plan 15-04 Task 1): comment_body expuesto aún cuando getTask falla (Plane unreachable)', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
      ].join('\n'),
    );
    const session = makeSession();
    const { logger, events } = makeLogger();
    const brokenProvider = {
      getTask: async () => {
        throw new Error('plane unreachable');
      },
      addComment: async () => {},
      updateTaskState: async () => {},
    };
    const deps = {
      findSessionFn: () => session,
      getProviderFn: async () => brokenProvider,
      loadConfigFn: () => ({
        provider: 'plane',
        providers: { plane: { states: { review: 'In review' } } },
      }),
      loggerFactory: () => logger,
    };
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.plane.commented, false);
    assert.equal(result.plane.transitioned, false);
    // El markdown se computa en finalize ANTES de getTask, así que debe estar expuesto.
    assert.equal(typeof result.plane.comment_body, 'string');
    assert.match(result.plane.comment_body, /^\[kodo:gsd\] ✅ Phase 10 verificada/);
    const expectedMd = renderComment(result.verdict, 'Orchestrator gate');
    assert.equal(result.plane.comment_body, expectedMd, 'byte-equality preservada incluso si Plane no responde');
    // Phase 16 LOG-14 SC#3: pass + getTask fail NO emite state.transition
    // (markSessionStatus skipped — no entra al if (task) block).
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.equal(
      transition,
      undefined,
      'pass + getTask fail must NOT emit state.transition (markSessionStatus skipped — no entra al if (task) block)',
    );
    // Sanity: planeApiCallFailed sí se emitió en step 'getTask'
    const apiFailed = events.find(
      (e) => e.fields?.event === 'plane.api.call.failed' && e.fields.step === 'getTask',
    );
    assert.ok(apiFailed, 'planeApiCallFailed should fire on getTask error');
  });

  it('T25 E2E (Plan 15-04 Task 1): comment_body byte-idéntico entre dos invocaciones (idempotencia)', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
      ].join('\n'),
    );
    const session = makeSession();
    const { deps } = makeDeps(session);
    const r1 = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    const r2 = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(
      r1.plane.comment_body,
      r2.plane.comment_body,
      'comment_body debe ser byte-idéntico entre invocaciones (no timestamp en plantilla)',
    );
  });

  it('T26 SC#3 LOG-14: fail hard (status-failed) → NO state.transition emitted', async () => {
    // VERIFICATION.md fixture con status: failed (hard-fail explícito).
    // B-1: este test es mandatory — distingue hard-fail (status-failed) del
    // soft-fail (gaps-found) testeado en T21. ROADMAP §Phase 16 SC#3 demanda
    // la distinción literalmente.
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: failed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
      ].join('\n'),
    );
    const session = makeSession();
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'fail');
    assert.equal(result.verdict.reason, 'status-failed');
    assert.equal(calls.updateTaskState.length, 0);
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.equal(
      transition,
      undefined,
      'hard-fail (status-failed) must NOT emit state.transition — verdict.action !== "pass"',
    );
  });

  /**
   * WR-05 Phase 16 — Test scope claration:
   * Este test cubre ORDER (markSessionStatus emite ANTES del throw de updateTaskState).
   * NO cubre PRESENCE (que markSessionStatus se invoca en el pass branch del verify).
   * El test T20 ("pass + Plane OK → state.transition emitted") cubre presence.
   *
   * Si un refactor mueve markSessionStatus DESPUÉS del try/catch del updateTaskState,
   * T27 fallaría loud (transition !== undefined) — el contrato pre-throw permanece blindado.
   *
   * DI explícito de markSessionStatus para spy literal cambia signature pública de
   * runGsdVerify y es out of scope (Phase 22 D-04b: refactors puros no requieren spy nuevo).
   */
  it('T27 SC#3 LOG-14: pass + updateTaskState fails → NO state.transition emitted', async () => {
    // Centinela del orden D-11: markSessionStatus está DENTRO del try de
    // updateTaskState; si updateTaskState lanza, el throw aborta antes de
    // que markSessionStatus se invoque. Si alguien refactoriza moviendo la
    // línea afuera del try, este test cae con assertion message específico.
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
      ].join('\n'),
    );
    const session = makeSession();
    const { logger, events } = makeLogger();
    const provider = {
      getTask: async (ref) => ({ id: 'task-int', ref, title: 'T', projectId: 'proj-int' }),
      addComment: async () => {},
      updateTaskState: async () => {
        throw new Error('Plane state transition rejected');
      },
    };
    const deps = {
      findSessionFn: () => session,
      getProviderFn: async () => provider,
      loadConfigFn: () => ({
        provider: 'plane',
        providers: { plane: { states: { review: 'In review' } } },
      }),
      loggerFactory: () => logger,
    };
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.plane.commented, true);
    assert.equal(result.plane.transitioned, false);
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.equal(
      transition,
      undefined,
      'pass + updateTaskState fail must NOT emit state.transition (markSessionStatus is INSIDE the updateTaskState try; throw aborts before invocation — D-11 order)',
    );
    // Sanity: planeApiCallFailed sí se emitió en step 'updateTaskState'.
    const apiFailed = events.find(
      (e) => e.fields?.event === 'plane.api.call.failed' && e.fields.step === 'updateTaskState',
    );
    assert.ok(apiFailed, 'planeApiCallFailed should fire on updateTaskState error');
  });

  it('Phase 19 D-06: verify reads VERIFICATION.md from worktree_path when present', async () => {
    // Sembrar VERIFICATION.md SOLO en el worktree (no en project_path / tmpRoot).
    const wt = mkdtempSync(join(tmpdir(), 'kodo-verify-wt-'));
    try {
      const phaseDir = join(wt, '.planning', 'phases', '10-test');
      mkdirSync(phaseDir, { recursive: true });
      writeFileSync(
        join(phaseDir, '10-VERIFICATION.md'),
        [
          '---',
          'status: passed',
          'must_haves_total: 4',
          'must_haves_verified: 4',
          'gaps_count: 0',
          '---',
          '',
          '# Phase 10 — Worktree read',
        ].join('\n'),
      );
      const session = makeSessionWithWorktree(wt);
      const { deps } = makeDeps(session);
      const result = await runGsdVerify({ sessionId: session.session_id }, deps);
      assert.equal(result.verdict.action, 'pass', 'must read VERIFICATION.md from worktree');
      assert.equal(result.verdict.must_haves, 4);
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it('Phase 19 D-09: legacy session without worktree_path falls back to project_path silently', async () => {
    // Sembrar VERIFICATION.md SOLO en project_path (tmpRoot); la sesión NO tiene worktree_path.
    // beforeEach() ya creó el dir 10-orchestrator-verification-gate; reusamos.
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 4',
        'must_haves_verified: 4',
        'gaps_count: 0',
        '---',
        '',
        '# Legacy OK',
      ].join('\n'),
    );
    const session = makeLegacySession();
    assert.equal(session.worktree_path, undefined, 'precondition: legacy session has no worktree_path');
    const { deps, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: session.session_id }, deps);
    assert.equal(result.verdict.action, 'pass', 'must fall back to project_path');
    const warns = events.filter((e) => e.level === 'warn' && /fallback|worktree/i.test(String(e.msg || '')));
    assert.equal(warns.length, 0, 'no warn-level events for fallback (D-09 silent)');
  });

  it('Phase 19 D-06 source-hygiene: verify.js resolves phasesRoot with worktree_path nullish coalescing', () => {
    const source = readFileSync(VERIFY_SOURCE_PATH, 'utf-8');
    assert.ok(
      /session\.worktree_path\s*\?\?\s*session\.project_path/.test(source),
      'phasesRoot must use session.worktree_path ?? session.project_path (D-06 + D-09 fallback)',
    );
  });

  // Phase 33-03 LIFE-02-FOLLOWUP (Bloque C): el callsite de markSessionStatus en
  // la rama pass consume el return discriminado {ok, reason}. Cuando ok === false
  // (task_id falsy → 'missing-task-id'), verify.js emite log.warn observable
  // 'markSessionStatus.skipped' con {reason, session_id} y continúa (cero throws).
  // Para forzar ok:false sin mockear markSessionStatus, la sesión lleva task_id ''
  // (falsy) — el early-return de markSessionStatus (manager.js#371) NO toca
  // state.json. task_ref sigue presente para que getTask del provider mock retorne
  // un task y se llegue a la rama pass + updateTaskState donde vive el callsite.
  it('Phase 33-03: markSessionStatus ok===false → emite markSessionStatus.skipped con {reason, session_id}', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
      ].join('\n'),
    );
    const session = { ...makeSession(), task_id: '' };
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    // Sanity: llegamos a la rama pass + Plane OK (donde vive el callsite).
    assert.equal(result.verdict.action, 'pass');
    assert.equal(calls.updateTaskState.length, 1);
    const skipped = events.find((e) => e.msg === 'markSessionStatus.skipped');
    assert.ok(skipped, 'debe emitir markSessionStatus.skipped cuando ok === false');
    assert.equal(skipped.level, 'warn', 'markSessionStatus.skipped es nivel warn');
    assert.equal(skipped.fields.reason, 'missing-task-id', 'payload reason del union discriminado');
    assert.equal(skipped.fields.session_id, session.session_id, 'payload session_id en scope local');
  });

  it('Phase 33-03: markSessionStatus ok===true → NO emite markSessionStatus.skipped (no-regresión happy path)', async () => {
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-orchestrator-verification-gate', '10-VERIFICATION.md'),
      [
        '---',
        'status: passed',
        'must_haves_total: 8',
        'must_haves_verified: 8',
        'gaps_count: 0',
        '---',
      ].join('\n'),
    );
    const session = makeSession(); // task_id 'task-int' (truthy) → ok:true
    const { deps, calls, events } = makeDeps(session);
    const result = await runGsdVerify({ sessionId: 'sess-int' }, deps);
    assert.equal(result.verdict.action, 'pass');
    assert.equal(calls.updateTaskState.length, 1);
    const skipped = events.find((e) => e.msg === 'markSessionStatus.skipped');
    assert.equal(skipped, undefined, 'happy path (ok===true) NO debe emitir markSessionStatus.skipped');
  });
});
