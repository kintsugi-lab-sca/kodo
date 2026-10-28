// @ts-check
//
// test/session/send-back.test.js — KODO-109.
//
// Devolver una tarea en revisión: el núcleo (`sendBackTask`) comenta, persiste el feedback en
// `state.tasks[task_id].send_back` y mueve la tarea; la siguiente sesión lo recibe en su contexto
// de arranque (hook SessionStart como proceso) y una segunda ya no.
//
// HOME-isolation: state.js deriva STATE_PATH de `homedir()` en module-load, así que TODO import de
// src/ va dinámico DESPUÉS de fijar `process.env.HOME` (mismo molde que handoff-state.test.js).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dirname, '..', '..', 'src', 'hooks', 'session-start.js');

const SID = 'c0ffee00-0000-4000-8000-000000000109';
const TASK_ID = 'task-109';

let home;
let origHome;
/** @type {any} */ let state;
/** @type {any} */ let sendBack;
/** @type {any} */ let sessionEnd;

const CONFIG = {
  provider: 'plane',
  providers: { plane: { states: { trigger: 'In Progress', review: 'In review', done: 'Done' } } },
};

function statePath() {
  return join(home, '.kodo', 'state.json');
}

function writeState(extra = {}) {
  writeFileSync(statePath(), JSON.stringify({ schema_version: 3, sessions: {}, history: [], ...extra }, null, 2));
}

function readState() {
  return JSON.parse(readFileSync(statePath(), 'utf-8'));
}

/** Provider falso que registra las llamadas y, en el move, mira qué hay en disco en ese instante. */
function fakeProvider({ taskState = 'In review', failComment = false, failMove = false } = {}) {
  const calls = { comments: [], moves: [], sendBackAtMove: undefined };
  return {
    calls,
    async getTask(ref) {
      return { id: TASK_ID, projectId: 'proj-1', ref, state: taskState };
    },
    async addComment(task, body) {
      if (failComment) throw new Error('503 comment');
      calls.comments.push({ task, body });
    },
    async updateTaskState(task, stateName) {
      calls.sendBackAtMove = readState().tasks?.[TASK_ID]?.send_back;
      if (failMove) throw new Error('503 move');
      calls.moves.push({ task, stateName });
    },
  };
}

function session(overrides = {}) {
  return {
    workspace_ref: 'workspace:9',
    session_id: SID,
    task_id: TASK_ID,
    task_ref: 'KODO-109',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Devolver con feedback',
    status: 'running',
    started_at: '2026-10-28T09:00:00.000Z',
    project_path: '/dev/kodo',
    host: 'cmux',
    state: 'running',
    base_commit: 'a'.repeat(40),
    ...overrides,
  };
}

function runHook() {
  const env = { ...process.env, HOME: home };
  delete env.CMUX_WORKSPACE_ID;
  delete env.BB_THREAD_ID;
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: SID, source: 'startup', cwd: '/dev/kodo' }),
    encoding: 'utf-8',
    env,
  });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
}

describe('KODO-109 — send back', () => {
  before(async () => {
    origHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'kodo-send-back-'));
    mkdirSync(join(home, '.kodo'), { recursive: true });
    process.env.HOME = home;
    state = await import('../../src/session/state.js');
    sendBack = await import('../../src/session/send-back.js');
    sessionEnd = await import('../../src/hooks/session-end.js');
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => writeState());

  describe('sendBackTask', () => {
    it('comenta «Devuelto:» en HTML crudo, persiste el feedback ANTES de mover y mueve al trigger', async () => {
      const provider = fakeProvider();
      const r = await sendBack.sendBackTask(
        { ref: 'KODO-109', text: 'Falta el test de <rollback>\ny el caso & vacío' },
        { provider, config: CONFIG, setSendBackFn: state.setTaskSendBack, now: () => new Date('2026-10-28T10:00:00.000Z') },
      );
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(provider.calls.comments.length, 1);
      assert.equal(
        provider.calls.comments[0].body,
        '<p><strong>Devuelto:</strong> Falta el test de &lt;rollback&gt;<br>y el caso &amp; vacío</p>',
      );
      assert.deepEqual(provider.calls.moves.map((m) => m.stateName), ['In Progress']);
      const expected = { text: 'Falta el test de <rollback>\ny el caso & vacío', at: '2026-10-28T10:00:00.000Z' };
      assert.deepEqual(provider.calls.sendBackAtMove, expected, 'el feedback ya está en disco cuando el move relanza');
      assert.deepEqual(readState().tasks[TASK_ID].send_back, expected);
    });

    it('conserva el puntero de handoff de la tarea', async () => {
      writeState({ tasks: { [TASK_ID]: { plan_path: '/p.md', next: 'seguir', updated_at: 'x' } } });
      const r = await sendBack.sendBackTask(
        { ref: 'KODO-109', text: 'arregla X' },
        { provider: fakeProvider(), config: CONFIG, setSendBackFn: state.setTaskSendBack },
      );
      assert.equal(r.ok, true);
      const t = readState().tasks[TASK_ID];
      assert.equal(t.plan_path, '/p.md');
      assert.equal(t.next, 'seguir');
      assert.equal(t.send_back.text, 'arregla X');
    });

    it('si el comentario falla: error, ni persiste ni mueve', async () => {
      const provider = fakeProvider({ failComment: true });
      const r = await sendBack.sendBackTask(
        { ref: 'KODO-109', text: 'x' },
        { provider, config: CONFIG, setSendBackFn: state.setTaskSendBack },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'COMMENT_FAILED');
      assert.equal(provider.calls.moves.length, 0);
      assert.equal(readState().tasks?.[TASK_ID], undefined);
    });

    it('si el move falla: error y el feedback se retira (no queda huérfano sin la tarea movida)', async () => {
      writeState({ tasks: { [TASK_ID]: { plan_path: '/p.md', next: null, updated_at: 'x' } } });
      const provider = fakeProvider({ failMove: true });
      const r = await sendBack.sendBackTask(
        { ref: 'KODO-109', text: 'x' },
        { provider, config: CONFIG, setSendBackFn: state.setTaskSendBack },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'MOVE_FAILED');
      assert.match(r.detail, /503 move/);
      assert.deepEqual(readState().tasks[TASK_ID], { plan_path: '/p.md', next: null, updated_at: 'x' });
    });

    it('rechaza una tarea que no está en revisión sin tocar nada', async () => {
      const provider = fakeProvider({ taskState: 'In Progress' });
      const r = await sendBack.sendBackTask(
        { ref: 'KODO-109', text: 'x' },
        { provider, config: CONFIG, setSendBackFn: state.setTaskSendBack },
      );
      assert.equal(r.code, 'NOT_IN_REVIEW');
      assert.equal(provider.calls.comments.length, 0);
      assert.equal(provider.calls.moves.length, 0);
    });

    it('rechaza feedback vacío', async () => {
      const r = await sendBack.sendBackTask(
        { ref: 'KODO-109', text: '   ' },
        { provider: fakeProvider(), config: CONFIG, setSendBackFn: state.setTaskSendBack },
      );
      assert.equal(r.code, 'INVALID_INPUT');
    });
  });

  describe('state', () => {
    it('upsertTaskHandoff conserva un send_back pendiente', () => {
      writeState({ tasks: { [TASK_ID]: { plan_path: '/p.md', next: null, updated_at: 'x', send_back: { text: 'fb', at: 'y' } } } });
      const r = state.upsertTaskHandoff(TASK_ID, { plan_path: '/p.md', next: 'nuevo' });
      assert.equal(r.ok, true);
      assert.deepEqual(readState().tasks[TASK_ID].send_back, { text: 'fb', at: 'y' });
      assert.equal(readState().tasks[TASK_ID].next, 'nuevo');
    });

    it('takeTaskSendBack sin nada pendiente no reescribe state.json', () => {
      const before = statSync(statePath()).mtimeMs;
      const raw = readFileSync(statePath(), 'utf-8');
      assert.equal(state.takeTaskSendBack(TASK_ID), null);
      assert.equal(readFileSync(statePath(), 'utf-8'), raw);
      assert.equal(statSync(statePath()).mtimeMs, before);
    });
  });

  describe('contexto de arranque (hook SessionStart)', () => {
    it('la siguiente sesión recibe el feedback y una segunda ya no', () => {
      writeState({
        sessions: { [TASK_ID]: session() },
        tasks: { [TASK_ID]: { plan_path: '/p.md', next: null, updated_at: 'x', send_back: { text: 'Falta el rollback\nen el move', at: '2026-10-28T10:00:00.000Z' } } },
      });

      const first = runHook();
      assert.match(first, /## Feedback de la revisión: atiéndelo antes que nada/);
      assert.match(first, /> Falta el rollback\n> en el move/);
      assert.ok(
        first.indexOf('## Feedback de la revisión') < first.indexOf('## Tu responsabilidad'),
        'el feedback va antes del flujo',
      );
      assert.deepEqual(readState().tasks[TASK_ID], { plan_path: '/p.md', next: null, updated_at: 'x' }, 'consumido, el handoff intacto');

      const second = runHook();
      assert.doesNotMatch(second, /Feedback de la revisión/);
    });

    it('sesión GSD: la misma sección', () => {
      writeState({
        sessions: { [TASK_ID]: session({ gsd: true, phase_id: '3' }) },
        tasks: { [TASK_ID]: { send_back: { text: 'revisa la fase', at: 'z' } } },
      });
      const ctx = runHook();
      assert.match(ctx, /## Feedback de la revisión: atiéndelo antes que nada/);
      assert.match(ctx, /> revisa la fase/);
      assert.equal(readState().tasks?.[TASK_ID], undefined, 'la entrada que solo tenía el feedback desaparece');
    });

    it('sin feedback, el contexto es byte-idéntico al de siempre', async () => {
      const { buildSessionContext } = await import('../../src/session/context.js');
      const s = /** @type {any} */ (session());
      assert.equal(buildSessionContext(s, CONFIG, { sendBack: null }), buildSessionContext(s, CONFIG));
    });
  });

  describe('backstop de SessionEnd', () => {
    function backstopArgs(hasSendBack) {
      const moves = [];
      const provider = {
        getTaskState: async () => 'in_progress',
        updateTaskState: async (_t, s) => moves.push(s),
        addComment: async () => {},
      };
      const log = { info() {}, warn() {}, error() {}, debug() {} };
      return {
        moves,
        args: {
          session: session(),
          input: { reason: 'prompt_input_exit' },
          provider,
          config: CONFIG,
          log,
          markPendingCommentFn: () => ({ ok: true }),
          hasSendBackFn: () => hasSendBack,
        },
      };
    }

    it('no vuelve a mover a review una tarea devuelta con el feedback pendiente', async () => {
      const { moves, args } = backstopArgs(true);
      await sessionEnd.runReviewBackstop(args);
      assert.deepEqual(moves, []);
    });

    it('sin devolución pendiente, el backstop sigue moviendo a review', async () => {
      const { moves, args } = backstopArgs(false);
      await sessionEnd.runReviewBackstop(args);
      assert.deepEqual(moves, ['In review']);
    });
  });
});
