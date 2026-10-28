// @ts-check
//
// test/session/pending-question.test.js — KODO-108: `kodo ask` y su ciclo de vida.
//
// Lo que este fichero congela:
//   - `kodo ask` persiste `pending_question: { text, at }` en la sesión resuelta;
//   - fuera de una sesión de kodo sale con 1 y un mensaje que lo dice;
//   - el hook Stop del MISMO turno NO borra la pregunta, y UserPromptSubmit SÍ;
//   - fail-open: un host que lanza o un estado que no se puede escribir no lanzan nunca.
//
// El ciclo completo corre contra un `state.json` REAL en un HOME temporal (mismo patrón que
// test/stop-state-transition.test.js): state.js fija KODO_DIR al import-time, así que los
// imports son dinámicos y van DESPUÉS de fijar HOME.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = '/repo/kodo';
const WORKTREE = '/repo/kodo/.claude/worktrees/sess-108';
const BRANCH = 'feat/ask';
const AT = new Date('2026-10-28T10:00:00.000Z');

const SESSION = {
  workspace_ref: 'workspace:7',
  session_id: 'sess-108',
  task_id: 'uuid-108',
  task_ref: 'KODO-108',
  provider: 'plane',
  project_id: 'p1',
  summary: 'kodo ask',
  status: 'running',
  started_at: '2026-10-28T09:00:00.000Z',
  project_path: PROJECT,
  worktree_path: WORKTREE,
  branch: BRANCH,
};

/** git de un worktree de sesión sano. */
function sessionGit({ toplevel = WORKTREE, common = `${PROJECT}/.git`, branch = BRANCH } = {}) {
  return (_cwd, args) => {
    const a = args.join(' ');
    if (a.includes('--git-common-dir')) return common;
    if (a === 'rev-parse --show-toplevel') return toplevel;
    if (a === 'branch --show-current') return branch;
    if (a === 'rev-parse HEAD') return 'a'.repeat(40);
    return '';
  };
}

function io() {
  const out = [];
  const errs = [];
  return { out, errs, writeFn: (s) => out.push(s), errFn: (s) => errs.push(s) };
}

describe('pending-question: núcleo puro', () => {
  let mod;
  before(async () => { mod = await import('../../src/session/pending-question.js'); });

  it('normalizeQuestion: una línea, sin control chars, acotada; vacío y no-string → ""', () => {
    assert.equal(mod.normalizeQuestion('  ¿Seguimos\ncon\tX?  '), '¿Seguimos con X?');
    assert.equal(mod.normalizeQuestion('a\x1b[31mb\x07'), 'ab');
    assert.equal(mod.normalizeQuestion('   '), '');
    assert.equal(mod.normalizeQuestion(undefined), '');
    const long = mod.normalizeQuestion('x'.repeat(2000));
    assert.equal(long.length, mod.QUESTION_MAX);
    assert.ok(long.endsWith('…'));
  });

  it('sidebarDescription: sin pregunta reproduce la marca de launch; con pregunta la muestra', () => {
    assert.equal(mod.sidebarDescription(SESSION, null), '⬢ KODO-108 · kodo ask');
    assert.equal(mod.sidebarDescription(SESSION, '¿Borro la rama?'), '⬢ KODO-108 · ❓ ¿Borro la rama?');
  });

  it('setPendingQuestion / clearPendingQuestion: lock que lanza → { ok:false }, nunca throw', () => {
    const boom = () => { throw new Error('disk full'); };
    const s = mod.setPendingQuestion('uuid-108', 'q', { withStateLockFn: boom });
    assert.equal(s.ok, false);
    const c = mod.clearPendingQuestion('uuid-108', { withStateLockFn: boom });
    assert.equal(c.ok, false);
  });

  it('setPendingQuestion: lock-timeout se propaga como { ok:false, reason }', () => {
    const r = mod.setPendingQuestion('uuid-108', 'q', { withStateLockFn: () => ({ ok: false, reason: 'lock-timeout' }) });
    assert.deepEqual(r, { ok: false, reason: 'lock-timeout' });
  });
});

describe('kodo ask: handler (DI, sin disco)', () => {
  let runAskCli;
  before(async () => { ({ runAskCli } = await import('../../src/cli/ask.js')); });

  const loadState = () => ({ schema_version: 3, sessions: { 'uuid-108': SESSION }, history: [] });

  it('fuera de una sesión de kodo → exit 1 con mensaje claro, y no escribe nada', async () => {
    const h = io();
    let writes = 0;
    const code = await runAskCli(['¿seguimos?'], {
      ...h,
      cwdFn: () => '/tmp/otro',
      gitFn: sessionGit({ toplevel: '/tmp/otro', common: '/tmp/otro/.git', branch: 'main' }),
      loadStateFn: loadState,
      setQuestionFn: () => { writes++; return { ok: true, value: { text: '', at: '' } }; },
      setDescriptionFn: async () => { writes++; },
    });
    assert.equal(code, 1);
    assert.equal(writes, 0);
    assert.match(h.errs.join(''), /no pertenece a ninguna sesión de kodo/);
  });

  it('fuera de un repo git → exit 1, mismo mensaje', async () => {
    const h = io();
    const code = await runAskCli(['¿seguimos?'], {
      ...h,
      cwdFn: () => '/tmp',
      gitFn: () => { throw new Error('not a git repository'); },
      loadStateFn: loadState,
    });
    assert.equal(code, 1);
    assert.match(h.errs.join(''), /no pertenece a ninguna sesión de kodo/);
  });

  it('pregunta vacía → exit 2', async () => {
    const h = io();
    assert.equal(await runAskCli(['  '], { ...h }), 2);
  });

  it('dentro de la sesión: persiste el texto unido y refleja la pregunta en el sidebar', async () => {
    const h = io();
    const sets = [];
    const descs = [];
    const code = await runAskCli(['¿Borro', 'la', 'rama?'], {
      ...h,
      cwdFn: () => WORKTREE,
      gitFn: sessionGit(),
      loadStateFn: loadState,
      setQuestionFn: (id, text) => { sets.push({ id, text }); return { ok: true, value: { text, at: AT.toISOString() } }; },
      setDescriptionFn: async (o) => { descs.push(o); },
    });
    assert.equal(code, 0);
    assert.deepEqual(sets, [{ id: 'uuid-108', text: '¿Borro la rama?' }]);
    assert.deepEqual(descs, [{ workspace: 'workspace:7', description: '⬢ KODO-108 · ❓ ¿Borro la rama?' }]);
  });

  it('fail-open: el host lanza → exit 0 (la pregunta ya está en el estado) con aviso', async () => {
    const h = io();
    const code = await runAskCli(['¿seguimos?'], {
      ...h,
      cwdFn: () => WORKTREE,
      gitFn: sessionGit(),
      loadStateFn: loadState,
      setQuestionFn: (_id, text) => ({ ok: true, value: { text, at: AT.toISOString() } }),
      setDescriptionFn: async () => { throw new Error('socket closed'); },
    });
    assert.equal(code, 0);
    assert.match(h.errs.join(''), /sidebar no se pudo actualizar/);
  });

  it('fail-open: el estado no se puede escribir → exit 1 con aviso, sin lanzar ni tocar el host', async () => {
    const h = io();
    let hostCalls = 0;
    const code = await runAskCli(['¿seguimos?'], {
      ...h,
      cwdFn: () => WORKTREE,
      gitFn: sessionGit(),
      loadStateFn: loadState,
      setQuestionFn: () => ({ ok: false, reason: 'lock-timeout' }),
      setDescriptionFn: async () => { hostCalls++; },
    });
    assert.equal(code, 1);
    assert.equal(hostCalls, 0);
    assert.match(h.errs.join(''), /no se pudo guardar la pregunta \(lock-timeout\)/);
  });
});

describe('ciclo de vida contra state.json real (HOME temporal)', () => {
  const ORIGINAL_HOME = process.env.HOME;
  let tmpHome;
  let state;
  let runAskCli;
  let runStopHook;
  let runUserPromptHook;

  const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger; } };

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-ask-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    state = await import('../../src/session/state.js');
    ({ runAskCli } = await import('../../src/cli/ask.js'));
    ({ runStopHook } = await import('../../src/hooks/stop.js'));
    ({ runUserPromptHook } = await import('../../src/hooks/user-prompt.js'));
  });

  after(() => {
    process.env.HOME = ORIGINAL_HOME;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('ask persiste → Stop del mismo turno NO la borra → UserPromptSubmit SÍ, y restaura el sidebar', async () => {
    state.addSession('uuid-108', { ...SESSION });
    const descs = [];
    const setDescriptionFn = async (o) => { descs.push(o); };

    const h = io();
    const code = await runAskCli(['¿Borro la rama vieja?'], {
      ...h,
      cwdFn: () => WORKTREE,
      gitFn: sessionGit(),
      nowFn: () => AT,
      setDescriptionFn,
    });
    assert.equal(code, 0, h.errs.join(''));
    assert.deepEqual(state.getSession('uuid-108').pending_question, {
      text: '¿Borro la rama vieja?',
      at: AT.toISOString(),
    });

    // Stop del MISMO turno: marca idle, sella rama… y deja la pregunta en paz.
    await runStopHook({ session_id: 'sess-108', cwd: WORKTREE }, {
      loggerFactory: () => silentLogger,
      existsFn: () => false,
      gitFn: () => '',
    });
    const afterStop = state.getSession('uuid-108');
    assert.equal(afterStop.status, 'idle', 'el Stop sí corrió');
    assert.equal(afterStop.pending_question?.text, '¿Borro la rama vieja?', 'Stop NO limpia la pregunta');

    // El humano responde: la sesión vuelve a trabajar.
    const r = await runUserPromptHook({ session_id: 'sess-108' }, { setDescriptionFn });
    assert.deepEqual(r, { cleared: true });
    assert.equal(state.getSession('uuid-108').pending_question, undefined);
    assert.deepEqual(descs, [
      { workspace: 'workspace:7', description: '⬢ KODO-108 · ❓ ¿Borro la rama vieja?' },
      { workspace: 'workspace:7', description: '⬢ KODO-108 · kodo ask' },
    ]);

    // Prompt siguiente sin pregunta: no-op, no toca el host.
    const again = await runUserPromptHook({ session_id: 'sess-108' }, { setDescriptionFn });
    assert.deepEqual(again, { cleared: false });
    assert.equal(descs.length, 2);
    state.removeSession('uuid-108');
  });

  it('UserPromptSubmit: session_id ajeno o ausente → no-op; host que lanza → limpia igual', async () => {
    state.addSession('uuid-108', { ...SESSION, pending_question: { text: 'q', at: AT.toISOString() } });
    assert.deepEqual(await runUserPromptHook({ session_id: 'otra' }), { cleared: false });
    assert.deepEqual(await runUserPromptHook({}), { cleared: false });
    assert.equal(state.getSession('uuid-108').pending_question?.text, 'q');

    const r = await runUserPromptHook({ session_id: 'sess-108' }, {
      setDescriptionFn: async () => { throw new Error('host caído'); },
    });
    assert.deepEqual(r, { cleared: true });
    assert.equal(state.getSession('uuid-108').pending_question, undefined);
    state.removeSession('uuid-108');
  });
});
