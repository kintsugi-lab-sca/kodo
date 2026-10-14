// @ts-check
//
// test/hooks/session-resume-reopen.test.js — KODO-100.
//
// Una sesión cerrada (SessionEnd → `removeSession` → `state.history`) que el operador
// reanuda a mano con `claude --resume` vuelve a `state.sessions` en el SessionStart con
// `source=resume`, casando SOLO por `session_id` exacto. Se ejecuta el hook como proceso
// (`main()` no se exporta) con `$HOME` en un tmpdir, igual que bb-session-rebind.test.js.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rereadWorkspace } from '../../src/hooks/session-start.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dirname, '..', '..', 'src', 'hooks', 'session-start.js');
const STATE_MOD = join(__dirname, '..', '..', 'src', 'session', 'state.js');

const SID = 'af516964-0000-4000-8000-000000000001';
const OTHER_SID = 'bbbbbbbb-0000-4000-8000-000000000002';
const PROJECT = '/dev/clipping';
const BASE = 'a'.repeat(40);

let home;

function session(overrides = {}) {
  return {
    workspace_ref: 'workspace:7',
    workspace_id: 'ws-uuid-7',
    session_id: SID,
    task_id: 'task-169',
    task_ref: 'ITCLIP-169',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Tarea de clipping',
    status: 'running',
    started_at: '2026-09-17T14:00:00.000Z',
    project_path: PROJECT,
    worktree_path: `${PROJECT}/.claude/worktrees/${SID}`,
    host: 'cmux',
    state: 'running',
    base_commit: BASE,
    ...overrides,
  };
}

function writeState(sessions, history = []) {
  writeFileSync(
    join(home, '.kodo', 'state.json'),
    JSON.stringify({ schema_version: 3, sessions, history }, null, 2),
  );
}

function readState() {
  return JSON.parse(readFileSync(join(home, '.kodo', 'state.json'), 'utf-8'));
}

function cleanEnv() {
  const env = { ...process.env, HOME: home };
  // La suite puede correr DENTRO de cmux o de bb: su entorno no debe filtrarse al hook.
  delete env.CMUX_WORKSPACE_ID;
  delete env.BB_THREAD_ID;
  return env;
}

/** Cierre real: el mismo `removeSession` con `endedBy` que corre SessionEnd. */
function closeViaRemoveSession(taskId) {
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `const { removeSession } = await import(${JSON.stringify(STATE_MOD)}); removeSession(${JSON.stringify(taskId)}, undefined, { endedBy: 'session-end' });`,
  ], { env: cleanEnv() });
}

function runHook(input) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env: cleanEnv(),
  });
}

describe('KODO-100 — resume de una sesión cerrada', () => {
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-resume-reopen-'));
    mkdirSync(join(home, '.kodo'), { recursive: true });
  });

  after(() => rmSync(home, { recursive: true, force: true }));

  beforeEach(() => writeState({}));

  it('SessionEnd + SessionStart(resume) con el mismo session_id la devuelve a sessions', () => {
    writeState({ 'task-169': session() });
    closeViaRemoveSession('task-169');
    assert.equal(readState().history[0].session_id, SID, 'precondición: archivada');
    assert.equal(readState().history[0].ended_by, 'session-end');

    const res = runHook({ session_id: SID, source: 'resume', cwd: session().worktree_path });
    assert.equal(res.status, 0, res.stderr);
    assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /ITCLIP-169/);

    const st = readState();
    const s = st.sessions['task-169'];
    assert.ok(s, 'vuelve a sessions');
    assert.equal(s.session_id, SID);
    assert.equal(s.task_ref, 'ITCLIP-169');
    assert.equal(s.worktree_path, session().worktree_path);
    assert.equal(s.workspace_ref, 'workspace:7');
    assert.equal(s.base_commit, BASE, 'la base sellada al lanzar no se toca');
    assert.equal(s.state, 'idle');
    assert.equal(s.alive, true);
    assert.equal(s.process_alive, false, 'el pgrep por session-id no casa --resume');
    assert.equal(s.process_dead_since, null, 'sin reloj de muerte: el reconcile no la mata');
    assert.equal(s.ended_at, undefined);
    assert.equal(s.ended_by, undefined, 'sin la marca de cierre deliberado');
    assert.equal(st.history.length, 0, 'sale de history');

    const ev = st.orchestrator_inbox.find((e) => e.kind === 'session-resumed');
    assert.ok(ev, 'evento en la bandeja');
    assert.equal(ev.task_ref, 'ITCLIP-169');
    assert.equal(ev.session_id, SID);
    assert.match(ev.text, /Review/);
  });

  it('nunca casa por cwd: otra entrada de history del mismo repo no se reabre', () => {
    writeState({}, [{ ...session(), ended_at: '2026-09-17T16:32:00.000Z', ended_by: 'session-end' }]);
    const res = runHook({ session_id: OTHER_SID, source: 'resume', cwd: PROJECT });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), '', 'sin match por identidad: silencio');
    const st = readState();
    assert.deepEqual(st.sessions, {});
    assert.equal(st.history.length, 1);
    assert.equal(st.orchestrator_inbox, undefined);
  });

  it('sin source=resume no reabre (un startup con id archivado no es reanudación)', () => {
    writeState({}, [{ ...session(), ended_at: '2026-09-17T16:32:00.000Z' }]);
    runHook({ session_id: SID, source: 'startup' });
    const st = readState();
    assert.deepEqual(st.sessions, {});
    assert.equal(st.history.length, 1);
  });

  it('la tarea ya tiene OTRA sesión en sessions: no la pisa, solo deja evento', () => {
    const live = session({ session_id: OTHER_SID, worktree_path: `${PROJECT}/.claude/worktrees/${OTHER_SID}` });
    writeState({ 'task-169': live }, [{ ...session(), ended_at: '2026-09-17T16:32:00.000Z' }]);
    const res = runHook({ session_id: SID, source: 'resume' });
    assert.equal(res.status, 0, res.stderr);
    const st = readState();
    assert.deepEqual(st.sessions['task-169'], live, 'la sesión viva intacta');
    assert.equal(st.history.length, 1, 'la archivada se queda en history');
    const ev = st.orchestrator_inbox.find((e) => e.kind === 'session-resumed');
    assert.ok(ev);
    assert.match(ev.text, /NO vuelve a sesiones/);
  });

  it('resume de una sesión VIVA en sessions: no cambia nada', () => {
    const live = session();
    writeState({ 'task-169': live });
    const before = readFileSync(join(home, '.kodo', 'state.json'), 'utf-8');
    const res = runHook({ session_id: SID, source: 'resume', cwd: __dirname });
    assert.equal(res.status, 0, res.stderr);
    assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /ITCLIP-169/);
    assert.equal(readFileSync(join(home, '.kodo', 'state.json'), 'utf-8'), before, 'state.json byte-idéntico');
  });

  it('sealBaseCommit una sola vez: el primer arranque sella, el resume no la reescribe', () => {
    writeState({ 'task-169': session({ base_commit: undefined }) });
    runHook({ session_id: SID, source: 'startup', cwd: __dirname });
    const sealed = readState().sessions['task-169'].base_commit;
    assert.match(sealed, /^[0-9a-f]{40}$/);
    // HEAD del cwd distinto para el resume: si resellara, cambiaría.
    const st = readState();
    st.sessions['task-169'].base_commit = BASE;
    writeFileSync(join(home, '.kodo', 'state.json'), JSON.stringify(st));
    runHook({ session_id: SID, source: 'resume', cwd: __dirname });
    assert.equal(readState().sessions['task-169'].base_commit, BASE);
  });
});

describe('KODO-100 — rereadWorkspace', () => {
  const tree = JSON.stringify({
    windows: [{ workspaces: [{ id: 'ws-uuid-9', ref: 'workspace:9', title: 'ITCLIP-169 …' }] }],
  });
  const listTreeFn = async () => tree;

  it('mismo CMUX_WORKSPACE_ID: no relee nada', async () => {
    const out = await rereadWorkspace(session(), {
      env: { CMUX_WORKSPACE_ID: 'ws-uuid-7' },
      listTreeFn: async () => { throw new Error('no debe consultarse'); },
    });
    assert.deepEqual(out, {});
  });

  it('reanudada en otra tab: ref e id del árbol actual', async () => {
    const out = await rereadWorkspace(session(), { env: { CMUX_WORKSPACE_ID: 'ws-uuid-9' }, listTreeFn });
    assert.deepEqual(out, { workspace_ref: 'workspace:9', workspace_id: 'ws-uuid-9' });
  });

  it('id que no está en el árbol, o host no cmux: conserva lo persistido', async () => {
    assert.deepEqual(await rereadWorkspace(session(), { env: { CMUX_WORKSPACE_ID: 'nope' }, listTreeFn }), {});
    assert.deepEqual(
      await rereadWorkspace(session({ host: 'orca' }), { env: { CMUX_WORKSPACE_ID: 'ws-uuid-9' }, listTreeFn }),
      {},
    );
  });
});
