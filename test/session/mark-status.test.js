// @ts-check
//
// test/session/mark-status.test.js — Phase 30-02 LIFE-02 SC#2/SC#3 coverage.
//
// Cubre el refactor de `markSessionStatus(taskId, nextStatus, reason, logger, sessionId?)`
// con falsy-taskId guard observable + return shape discriminada determinística.
//
// 4 escenarios SC#3 ROADMAP:
//   1. success path (task_id válido + sesión activa)
//      → result === {ok: true, from: 'running', to: 'done'}
//      → NO warn event (state.transition preservado en logger child)
//   2. null task_id
//      → result === {ok: false, reason: 'missing-task-id'}
//      → warn byte-exact `'markSessionStatus: missing task_id'` con keys {session_id, status, reason}
//   3. undefined task_id + sin 5º arg → fallback D-07 session_id='unknown'
//   4. empty string task_id + 5º arg explícito 'sess-empty'
//
// HOME-isolation scaffold mismo patrón que test/session-of-resolver.test.js
// (mkdtempSync + override HOME + dynamic import POST-HOME para que KODO_DIR
// del módulo state.js resuelva al tmpdir aislado).
//
// fakeLogger memSink: copia verbatim de test/stop-state-transition.test.js#70-80.
// child() retorna el mismo logger → eventos sobreviven a logger.child(...) chains.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let markSessionStatus;
let addSession;

/**
 * Fake logger memSink — mismo patrón que test/stop-state-transition.test.js:70-80.
 * child() retorna el mismo logger para que events sobrevivan a chains .child(...).
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

describe('LIFE-02 — markSessionStatus falsy task_id observability', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-life02-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME — KODO_DIR del módulo state.js se calcula al
    // module-load. Importar después de fijar HOME garantiza que el state.json
    // del tmpdir aislado es el que markSessionStatus mutará.
    const managerMod = await import('../../src/session/manager.js');
    markSessionStatus = managerMod.markSessionStatus;
    const stateMod = await import('../../src/session/state.js');
    addSession = stateMod.addSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    // Reset state.json a vacío para aislamiento cross-test
    writeFileSync(
      join(tmpHome, '.kodo', 'state.json'),
      JSON.stringify({ schema_version: 2, sessions: {} }) + '\n',
    );
  });

  // -------------------------------------------------------------------------
  // Escenario 1: success path — task_id presente + sesión activa
  // -------------------------------------------------------------------------
  it('returns {ok:true, from, to} when task_id present and session exists', () => {
    const taskId = 'task-life02-success';
    const session = {
      session_id: 'sess-life02-success',
      task_id: taskId,
      task_ref: 'KL-success',
      gsd: false,
      status: 'running',
      provider: 'plane',
      project_id: 'p1',
      project_path: tmpHome,
      workspace_ref: 'workspace:success',
      started_at: new Date().toISOString(),
      summary: 'life02 success path',
    };
    addSession(taskId, session);

    const { logger, events } = makeLogger();
    // Phase 38 D-12: 'done' es input deprecated → el shim lo mapea a 'idle' y emite
    // un warn 'markSessionStatus.deprecated'. La transición observable es to:'idle'.
    const result = markSessionStatus(taskId, 'done', 'review-gate', logger, 'sess-life02-success');

    assert.deepEqual(result, { ok: true, from: 'running', to: 'idle' });

    // El único warn esperado es el del shim deprecated (NO el falsy-guard).
    const warns = events.filter((e) => e.level === 'warn');
    assert.equal(warns.length, 1, `expected 1 deprecated-shim warn; got ${warns.length}`);
    assert.equal(warns[0].msg, 'markSessionStatus.deprecated');

    // state.transition event preservado en el logger child (success path)
    // — el evento se emite via stateTransition() helper, captured como info
    const transitions = events.filter((e) => e.msg === 'state.transition');
    assert.equal(transitions.length, 1, 'state.transition should be emitted on success path');
  });

  // -------------------------------------------------------------------------
  // Escenario 2: null task_id → warn + {ok:false}
  // -------------------------------------------------------------------------
  it('warns + returns {ok:false} when task_id is null', () => {
    const { logger, events } = makeLogger();
    const result = markSessionStatus(null, 'done', 'session-stop', logger, 'sess-abc');

    assert.deepEqual(result, { ok: false, reason: 'missing-task-id' });

    const warns = events.filter((e) => e.level === 'warn');
    assert.equal(warns.length, 1, `expected 1 warn; got ${warns.length}`);

    // Byte-exact literal SC#2 ROADMAP
    assert.equal(warns[0].msg, 'markSessionStatus: missing task_id');

    // Keys locked SC#2: {session_id, status, reason}
    assert.deepEqual(warns[0].fields, {
      session_id: 'sess-abc',
      status: 'done',
      reason: 'session-stop',
    });
  });

  // -------------------------------------------------------------------------
  // Escenario 3: undefined task_id + sin 5º arg → fallback D-07
  // -------------------------------------------------------------------------
  it('warns with session_id "unknown" when task_id is undefined and no 5th arg', () => {
    const { logger, events } = makeLogger();
    const result = markSessionStatus(undefined, 'done', 'reason', logger);

    assert.deepEqual(result, { ok: false, reason: 'missing-task-id' });

    const warns = events.filter((e) => e.level === 'warn');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].msg, 'markSessionStatus: missing task_id');

    // D-07 fallback: cuando 5º arg ausente, warn registra session_id: 'unknown'
    assert.deepEqual(warns[0].fields, {
      session_id: 'unknown',
      status: 'done',
      reason: 'reason',
    });
  });

  // -------------------------------------------------------------------------
  // Escenario 4: empty string task_id + 5º arg explícito
  // -------------------------------------------------------------------------
  it('warns + returns {ok:false} when task_id is empty string', () => {
    const { logger, events } = makeLogger();
    const result = markSessionStatus('', 'review', 'gate-passed', logger, 'sess-empty');

    assert.deepEqual(result, { ok: false, reason: 'missing-task-id' });

    const warns = events.filter((e) => e.level === 'warn');
    assert.equal(warns.length, 1);
    assert.equal(warns[0].msg, 'markSessionStatus: missing task_id');
    assert.equal(warns[0].fields.session_id, 'sess-empty');
    assert.equal(warns[0].fields.status, 'review');
    assert.equal(warns[0].fields.reason, 'gate-passed');
  });

  // -------------------------------------------------------------------------
  // Phase 38 SC#3: compat shim 'done' → 'idle' (D-12)
  // -------------------------------------------------------------------------
  it("Phase 38: 'done' es shim-mapped a 'idle' con warn DEPRECATED", () => {
    const taskId = 'task-shim-done';
    addSession(taskId, {
      session_id: 'sess-shim-done',
      task_id: taskId,
      task_ref: 'KL-shim',
      gsd: false,
      status: 'running',
      provider: 'plane',
      project_id: 'p1',
      project_path: tmpHome,
      workspace_ref: 'workspace:shim',
      started_at: new Date().toISOString(),
      summary: 'shim done path',
    });

    const { logger, events } = makeLogger();
    const result = markSessionStatus(taskId, 'done', 'session-stop:lock-released', logger, 'sess-shim-done');

    // El shim mapea ANTES de persistir: la transición observable es to:'idle'.
    assert.equal(result.ok, true);
    assert.equal(result.to, 'idle', "'done' shim-mapped a 'idle'");

    const deprecated = events.find((e) => e.msg === 'markSessionStatus.deprecated');
    assert.ok(deprecated, "debe emitir warn 'markSessionStatus.deprecated'");
    assert.equal(deprecated.level, 'warn');
    assert.equal(deprecated.fields.input_status, 'done');
    assert.equal(deprecated.fields.mapped_to, 'idle');
    assert.equal(deprecated.fields.session_id, 'sess-shim-done');
  });

  it("Phase 38 SC#3 negative: 'idle' directo NO dispara el shim warn", () => {
    const taskId = 'task-idle-direct';
    addSession(taskId, {
      session_id: 'sess-idle-direct',
      task_id: taskId,
      task_ref: 'KL-idle',
      gsd: false,
      status: 'running',
      provider: 'plane',
      project_id: 'p1',
      project_path: tmpHome,
      workspace_ref: 'workspace:idle',
      started_at: new Date().toISOString(),
      summary: 'idle direct path',
    });

    const { logger, events } = makeLogger();
    const result = markSessionStatus(taskId, 'idle', 'session-stop:lock-released', logger, 'sess-idle-direct');

    assert.equal(result.ok, true);
    assert.equal(result.to, 'idle');
    const deprecated = events.filter((e) => e.msg === 'markSessionStatus.deprecated');
    assert.equal(deprecated.length, 0, "el shim solo dispara con 'done', no con 'idle' directo");
  });
});
