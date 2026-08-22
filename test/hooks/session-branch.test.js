// @ts-check
//
// test/hooks/session-branch.test.js — KODO-30: la rama de la sesión y el path del worktree.
//
// Dos hechos que el cierre de una sesión daba por sabidos y no lo estaban:
//
//   1. DÓNDE vive el worktree. `worktree_path` se persistía como `.bg-shell/<sid>`, una
//      convención que Claude Code no materializa nunca (crea `.claude/worktrees/<sid>`).
//   2. QUÉ RAMA es la de la sesión. Solo se podía leer del worktree — y para cuando corre
//      SessionEnd, Claude Code ya ha borrado el suyo si la sesión cerró limpia.
//
// La consecuencia era un `worktree.cleanup.error{phase:status}` en cada cierre, ramas ya
// mergeadas huérfanas en el repo, y una cola de integración que no encolaba nada.
//
// Todo por DI: `gitFn`, `existsFn` y `updateSessionFn` son stubs, así que estos casos NO
// tocan git de verdad NI el `~/.kodo/state.json` del operador.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANAGER_SOURCE_PATH = join(__dirname, '..', '..', 'src', 'session', 'manager.js');
const DISPATCHER_SOURCE_PATH = join(__dirname, '..', '..', 'src', 'triggers', 'dispatcher.js');

// NO importar stop.js estáticamente: arrastra state.js → config.js, que calcula KODO_DIR al
// module-load. Se carga dinámicamente DESPUÉS de aislar HOME (mismo patrón que stop.test.js).
let persistSessionBranch;
let computeRealWorktreePath;
let computeWorktreePath;
let resolveEffectiveWorktree;

let tmpHome;
let origHome;

before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-session-branch-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  ({ persistSessionBranch } = await import('../../src/hooks/stop.js'));
  ({ computeRealWorktreePath, computeWorktreePath } = await import('../../src/session/state.js'));
  ({ resolveEffectiveWorktree } = await import('../../src/hooks/terminal-cleanup.js'));
});

after(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

const PROJECT = '/repo/kodo';
const SID = 'sess-30';

function makeSession(overrides = {}) {
  return {
    session_id: SID,
    task_id: 'task-30',
    task_ref: 'KODO-30',
    project_path: PROJECT,
    worktree_path: `${PROJECT}/.claude/worktrees/${SID}`,
    ...overrides,
  };
}

/** Espía de `updateSession` con la forma de retorno real (`{ ok: true }`). */
function makeUpdateSpy() {
  const calls = [];
  const updateSessionFn = (taskId, updates) => {
    calls.push({ taskId, updates });
    return { ok: true };
  };
  return { updateSessionFn, calls };
}

describe('KODO-30: persistSessionBranch — sellar la rama mientras el worktree existe', () => {
  it('PERSISTE la rama leída del worktree', async () => {
    const { updateSessionFn, calls } = makeUpdateSpy();
    const branch = await persistSessionBranch(makeSession(), {
      gitFn: () => 'feat/kodo-30-cleanup\n',
      existsFn: () => true,
      updateSessionFn,
    });

    assert.equal(branch, 'feat/kodo-30-cleanup');
    assert.deepEqual(calls, [{ taskId: 'task-30', updates: { branch: 'feat/kodo-30-cleanup' } }]);
  });

  it('LEE del worktree, no del repo principal (`-C <wt>` en args)', async () => {
    const seen = [];
    await persistSessionBranch(makeSession(), {
      gitFn: (cwd, args) => { seen.push({ cwd, args }); return 'feat/x'; },
      existsFn: () => true,
      updateSessionFn: () => ({ ok: true }),
    });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].cwd, PROJECT);
    assert.deepEqual(seen[0].args, ['-C', `${PROJECT}/.claude/worktrees/${SID}`, 'branch', '--show-current']);
  });

  it('NO escribe cuando la rama no ha cambiado (un turno normal no toca state.json)', async () => {
    const { updateSessionFn, calls } = makeUpdateSpy();
    const branch = await persistSessionBranch(makeSession({ branch: 'feat/ya-sellada' }), {
      gitFn: () => 'feat/ya-sellada',
      existsFn: () => true,
      updateSessionFn,
    });

    assert.equal(branch, null);
    assert.deepEqual(calls, [], 'sin cambio, sin escritura');
  });

  it('DETACHED HEAD: git devuelve vacío → conserva el valor previo en vez de machacarlo', async () => {
    const { updateSessionFn, calls } = makeUpdateSpy();
    const branch = await persistSessionBranch(makeSession({ branch: 'feat/buena' }), {
      gitFn: () => '',
      existsFn: () => true,
      updateSessionFn,
    });

    assert.equal(branch, null);
    assert.deepEqual(calls, [], 'un valor viejo correcto vale más que uno nuevo vacío');
  });

  it('WORKTREE AUSENTE: no consulta git ni escribe (nada que sellar)', async () => {
    const { updateSessionFn, calls } = makeUpdateSpy();
    let gitCalled = false;
    const branch = await persistSessionBranch(makeSession(), {
      gitFn: () => { gitCalled = true; return 'feat/x'; },
      existsFn: () => false,
      updateSessionFn,
    });

    assert.equal(branch, null);
    assert.equal(gitCalled, false);
    assert.deepEqual(calls, []);
  });

  it('SIN worktree_path (sesión adoptada / proyecto no-git): no-op', async () => {
    const { updateSessionFn, calls } = makeUpdateSpy();
    const branch = await persistSessionBranch(makeSession({ worktree_path: undefined }), {
      gitFn: () => 'main',
      existsFn: () => true,
      updateSessionFn,
    });

    assert.equal(branch, null);
    assert.deepEqual(calls, [], 'la captura ya lee del propio repo en ese caso');
  });

  it('NEVER-THROWS: un gitFn que lanza no propaga (un hook jamás crashea Claude Code)', async () => {
    let branch;
    await assert.doesNotReject(async () => {
      branch = await persistSessionBranch(makeSession(), {
        gitFn: () => { throw new Error('fatal: not a git repository'); },
        existsFn: () => true,
        updateSessionFn: () => ({ ok: true }),
      });
    });
    assert.equal(branch, null);
  });

  it('SESIÓN LEGACY con `.bg-shell` persistido: sella desde el worktree REAL', async () => {
    // Compatibilidad: `resolveEffectiveWorktree` repara el path de las sesiones anteriores
    // a KODO-30, y esta función usa EXACTAMENTE esa resolución — dos criterios distintos
    // de «cuál es el worktree de esta sesión» sellarían la rama de otro directorio.
    const legacy = makeSession({ worktree_path: `${PROJECT}/.bg-shell/${SID}` });
    const real = `${PROJECT}/.claude/worktrees/${SID}`;
    const seen = [];
    const { updateSessionFn, calls } = makeUpdateSpy();

    await persistSessionBranch(legacy, {
      gitFn: (cwd, args) => { seen.push(args); return 'feat/legacy'; },
      existsFn: (p) => p === real, // solo el real existe
      updateSessionFn,
    });

    assert.ok(seen[0].includes(real), `debe leer del worktree real, leyó: ${seen[0].join(' ')}`);
    assert.equal(calls[0].updates.branch, 'feat/legacy');
  });
});

describe('KODO-30: el path persistido apunta al worktree que Claude Code crea', () => {
  it('el carril de ESCRITURA (manager) usa computeRealWorktreePath, nunca el legacy', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /computeRealWorktreePath\(\s*projectPath\s*,\s*sessionId\s*\)/.test(source),
      'manager.js debe computar el path con computeRealWorktreePath',
    );
    assert.ok(
      !/\bcomputeWorktreePath\s*\(/.test(source),
      'manager.js NO debe invocar el helper legacy computeWorktreePath (.bg-shell)',
    );
  });

  it('el collision-check del dispatcher comprueba el directorio real', () => {
    const source = readFileSync(DISPATCHER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /computeRealWorktreePath\(\s*dispatchProjectPath\s*,\s*dispatchSessionId\s*\)/.test(source),
      'el dispatcher debe comprobar la colisión sobre .claude/worktrees/<sid>',
    );
    assert.ok(
      !/\bcomputeWorktreePath\s*\(/.test(source),
      'con .bg-shell el check no podía dar positivo jamás',
    );
  });

  it('un worktree_path ya real atraviesa resolveEffectiveWorktree sin cambios', () => {
    const real = computeRealWorktreePath(PROJECT, SID);
    const session = makeSession({ worktree_path: real });
    assert.equal(resolveEffectiveWorktree(session, () => true), real);
    // Y también cuando el directorio ya no existe: no hay nada mejor que devolver, y es
    // el camino `already_gone` de cleanupWorktree quien decide a partir de ahí.
    assert.equal(resolveEffectiveWorktree(session, () => false), real);
  });

  it('computeWorktreePath sigue existiendo como COMPATIBILIDAD (escaneo de huérfanos legacy)', () => {
    // gsd/doctor.js tiene que seguir encontrando los `.bg-shell/<sid>` que dejaron las
    // sesiones anteriores al cambio. El helper no se borra; solo deja de escribirse.
    assert.equal(computeWorktreePath(PROJECT, SID), `${PROJECT}/.bg-shell/${SID}`);
    assert.notEqual(computeWorktreePath(PROJECT, SID), computeRealWorktreePath(PROJECT, SID));
  });
});
