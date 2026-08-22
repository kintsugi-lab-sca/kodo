// @ts-check
// Phase 41 Plan 01: cobertura DIRECTA del helper extraído cleanupWorktree.
// Espejo del test contractual stop-worktree-cleanup.test.js pero contra el
// helper aislado (sin pasar por runStopHook). Cubre clean/dirty/error/prune,
// el return estructurado per-item, y el invariante never-throws.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupWorktree } from '../src/hooks/worktree-cleanup.js';

function makeMemLogger() {
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

function makeGitFnStub(handler) {
  const calls = [];
  const gitFn = (cwd, args) => {
    calls.push({ cwd, args });
    return handler(cwd, args) ?? '';
  };
  return { gitFn, calls };
}

const PROJECT = '/tmp/project';
const WT = '/tmp/project/.claude/worktrees/sess-helper-test';
const SESSION_ID = 'sess-helper-test';

// KODO-30: `WT` es un path SINTÉTICO — nunca se crea en disco, todo el git está stubeado.
// El probe de existencia del helper bifurca a `already_gone` cuando el directorio no está,
// así que estos tests declaran su premisa explícitamente: «el worktree existe». Los tests
// del camino `already_gone` viven en su propio describe y usan `WT_GONE`.
const WT_EXISTS = () => true;
const WT_GONE = () => false;

describe('Phase 41 Plan 01: cleanupWorktree helper — direct unit', () => {
  it('CLEAN: removes worktree + deletes branch + emits cleanup.ok, returns {removed, branch_deleted}', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-helper-test';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0'; // KODO-21: rama totalmente mergeada
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    assert.deepEqual(result, { removed: true, moved_to: null, branch_deleted: true, already_gone: false });

    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'must emit worktree.cleanup.ok');
    assert.equal(ok.level, 'info');
    assert.equal(ok.fields.branch_deleted, true);
    assert.equal(ok.fields.worktree_path, WT);

    // Orden: branch --show-current → status --porcelain → remove → branch -D → prune
    const branchReadIdx = calls.findIndex((c) => c.args.includes('--show-current'));
    const statusIdx = calls.findIndex((c) => c.args.includes('--porcelain'));
    const removeIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    const branchDelIdx = calls.findIndex((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    const pruneIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'prune');
    assert.ok(branchReadIdx >= 0 && statusIdx > branchReadIdx, 'branch read BEFORE status (Pitfall #2)');
    assert.ok(removeIdx > statusIdx, 'remove after status');
    assert.ok(branchDelIdx > removeIdx, 'branch -D after remove');
    assert.ok(pruneIdx > branchDelIdx, 'prune oportunista al final (D-04)');

    // remove NUNCA lleva --force
    const removeCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    assert.ok(!removeCall.args.includes('--force'), 'remove must NOT use --force');
  });

  it('DIRTY: move to .dirty + emit cleanup.dirty, branch preserved, returns {moved_to}', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-helper-test';
      if (args.includes('--porcelain')) return 'M file.txt\n?? new.txt\n';
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    assert.equal(result.removed, false);
    assert.equal(result.branch_deleted, false);
    assert.equal(result.moved_to, `${WT}.dirty`);

    const dirty = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
    assert.ok(dirty, 'must emit worktree.cleanup.dirty');
    assert.equal(dirty.level, 'warn');
    assert.equal(dirty.fields.moved_to, `${WT}.dirty`);
    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.equal(branchDel, undefined, 'branch must be PRESERVED when dirty (D-02)');
  });

  it('ERROR on remove: gitFn throws → emits cleanup.error{phase:remove}, fail-open, returns removed:false', async () => {
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-helper-test';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('EBUSY: rmdir failed');
      return '';
    };

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    assert.equal(result.removed, false);
    const err = events.find((e) => e.fields?.event === 'worktree.cleanup.error');
    assert.ok(err, 'must emit worktree.cleanup.error');
    assert.equal(err.level, 'error');
    assert.equal(err.fields.phase, 'remove');
    assert.match(err.fields.reason, /EBUSY/);
  });

  it('STATUS read failure: throws → cleanup.error{phase:status}, skip remove/move, still prune', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) throw new Error('git status failed');
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    assert.deepEqual(result, { removed: false, moved_to: null, branch_deleted: false, already_gone: false });
    const statusErr = events.find(
      (e) => e.fields?.event === 'worktree.cleanup.error' && e.fields?.phase === 'status',
    );
    assert.ok(statusErr, 'must emit cleanup.error{phase:status}');
    // No remove/move, but prune still runs
    assert.equal(calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'remove'), undefined);
    assert.equal(calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move'), undefined);
    assert.ok(calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'prune'), 'prune still runs');
  });

  it('PRUNE failure: throws → cleanup.error{phase:prune}, never throws to caller', async () => {
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'worktree' && args[1] === 'prune') throw new Error('prune locked');
      return '';
    };

    await assert.doesNotReject(() => cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    }));
    const pruneErr = events.find(
      (e) => e.fields?.event === 'worktree.cleanup.error' && e.fields?.phase === 'prune',
    );
    assert.ok(pruneErr, 'must emit cleanup.error{phase:prune}');
  });

  it('BRANCH-D FAILURE: branch -D throws → cleanup.ok with branch_deleted=false (Pitfall #3)', async () => {
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0'; // KODO-21: rama mergeada → se intenta el borrado
      if (args[0] === 'branch' && args[1] === '-D') throw new Error('cannot delete branch in use');
      return '';
    };

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    assert.equal(result.removed, true);
    assert.equal(result.branch_deleted, false);
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'cleanup.ok must still be emitted');
    assert.equal(ok.fields.branch_deleted, false);
    const err = events.find((e) => e.fields?.event === 'worktree.cleanup.error');
    assert.equal(err, undefined, 'no cleanup.error for branch -D failure (warn-only)');
  });

  it('TARGET COLLISION: <wt>.dirty already exists → suffixed path (Pitfall #1)', async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-helper-collision-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    mkdirSync(wt, { recursive: true });
    mkdirSync(dirty, { recursive: true });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n';
      return '';
    });
    try {
      const result = await cleanupWorktree({
        project: tmpBase, worktree: wt, sessionId: 'sess-x', gitFn, logger,
      });
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      assert.ok(moveCall, 'must call worktree move');
      const target = moveCall.args[moveCall.args.length - 1];
      assert.notEqual(target, dirty, 'target must NOT be the colliding path');
      assert.ok(target.startsWith(`${wt}.dirty-`), 'must use suffixed variant');
      assert.equal(result.moved_to, target);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('DANGLING SYMLINK: <wt>.dirty is a symlink to nonexistent → suffixed (CR-03)', async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-helper-dangling-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    const nonexistent = join(tmpBase, 'nonexistent-target');
    mkdirSync(wt, { recursive: true });
    symlinkSync(nonexistent, dirty);
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n';
      return '';
    });
    try {
      await cleanupWorktree({ project: tmpBase, worktree: wt, sessionId: 'sess-x', gitFn, logger });
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      const target = moveCall.args[moveCall.args.length - 1];
      assert.ok(target.startsWith(`${wt}.dirty-`), `expected suffixed, got ${target}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('REGULAR FILE: <wt>.dirty is a plain file → suffixed (CR-03)', async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-helper-regfile-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    mkdirSync(wt, { recursive: true });
    writeFileSync(dirty, 'blocking file');
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n';
      return '';
    });
    try {
      await cleanupWorktree({ project: tmpBase, worktree: wt, sessionId: 'sess-x', gitFn, logger });
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      const target = moveCall.args[moveCall.args.length - 1];
      assert.ok(target.startsWith(`${wt}.dirty-`), `expected suffixed, got ${target}`);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  // ── KODO-21: el trabajo commiteado NUNCA se pierde al cerrar la sesión ──────
  it('UNMERGED: rama con commits fuera de main → NO borra + emite worktree.branch.kept', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'worktree-sess-unmerged';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '5\n'; // 5 commits que solo viven aquí
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    // El worktree SÍ se remueve; lo que se conserva es la rama.
    assert.equal(result.removed, true);
    assert.equal(result.branch_deleted, false);

    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.equal(branchDel, undefined, 'branch -D must NOT run when the branch has unmerged commits');

    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.level, 'warn');
    assert.equal(kept.fields.branch, 'worktree-sess-unmerged');
    assert.equal(kept.fields.unmerged_commits, 5);
    assert.equal(kept.fields.reason, null);
    assert.equal(kept.fields.worktree_path, WT);

    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'cleanup.ok sigue emitiéndose (el worktree se saneó)');
    assert.equal(ok.fields.branch_deleted, false);
  });

  it('MERGE CHECK SHAPE: rev-list usa --exclude=<nombre corto> ANTES de --branches', async () => {
    // Congela la forma exacta del comando: con `--exclude=refs/heads/<rama>` git
    // NO aplica el filtro y el conteo sale siempre 0 → el guard se evaporaría en
    // silencio y volveríamos a borrar trabajo. Verificado contra git 2.51.
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'worktree-sess-shape';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0';
      return '';
    });

    await cleanupWorktree({ project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS });

    const revList = calls.find((c) => c.args[0] === 'rev-list');
    assert.ok(revList, 'must run the merge check before deleting the branch');
    assert.ok(revList.args.includes('--exclude=worktree-sess-shape'), 'exclude must use the SHORT branch name');
    assert.ok(
      !revList.args.includes('--exclude=refs/heads/worktree-sess-shape'),
      'the refs/heads/ form does not filter — it would silently defeat the guard',
    );
    assert.ok(
      revList.args.indexOf('--exclude=worktree-sess-shape') < revList.args.indexOf('--branches'),
      '--exclude solo aplica al siguiente --branches; debe ir ANTES',
    );
    assert.ok(revList.args.includes('--remotes'), 'remotes cuentan como destino válido del trabajo');
    // El repo principal es el cwd: el worktree ya no existe cuando esto corre.
    assert.equal(revList.cwd, PROJECT);
  });

  it('MERGE CHECK UNVERIFIABLE: rev-list falla → conserva la rama (fail-safe)', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'worktree-sess-broken';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') throw new Error('fatal: bad revision');
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });

    assert.equal(result.branch_deleted, false);
    assert.equal(
      calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'),
      undefined,
      'ante la duda NUNCA se borra',
    );
    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.fields.unmerged_commits, null);
    assert.match(kept.fields.reason, /bad revision/);
  });

  it('MERGE CHECK GARBAGE: rev-list devuelve algo no numérico → conserva la rama', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'worktree-sess-garbage';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return 'warning: something odd\n';
      return '';
    });

    await cleanupWorktree({ project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS });

    assert.equal(calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'), undefined);
    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.fields.unmerged_commits, null);
  });

  it('NEVER THROWS: branch read failure is swallowed (returns structured result)', async () => {
    const { logger } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) throw new Error('detached / no branch');
      if (args.includes('--porcelain')) return '';
      return '';
    };
    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_EXISTS,
    });
    // branch read failed → branchName null → remove ok, branch -D skipped
    assert.equal(result.removed, true);
    assert.equal(result.branch_deleted, false);
  });
});

// ── KODO-30: el worktree ya no existe cuando corre el cleanup ────────────────
//
// Síntoma que cierra esta cobertura (2026-08-22, cierres de ITCLIP-81/82): Claude Code
// borra el worktree al salir de una sesión `--worktree` limpia, así que el hook SessionEnd
// se encontraba el directorio ausente. El `status --porcelain` fallaba, `isDirty` quedaba
// en null y no se ejecutaba ni `worktree remove` ni `branch -D`: un
// `worktree.cleanup.error{phase:status}` en cada cierre normal y ramas ya mergeadas
// huérfanas en el repo.
describe('KODO-30: cleanupWorktree cuando el worktree ya no existe', () => {
  it('RAMA MERGEADA: prune + branch -D, cleanup.ok{already_gone}, SIN cleanup.error', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args[0] === 'rev-list') return '0'; // gate KODO-21: todo mergeado
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT,
      worktree: WT,
      sessionId: SESSION_ID,
      gitFn,
      logger,
      branch: 'feat/itclip-81-piezas-prototipo',
      existsFn: WT_GONE,
    });

    assert.deepEqual(result, {
      removed: false, moved_to: null, branch_deleted: true, already_gone: true,
    });

    // El síntoma exacto que se corrige: NINGÚN cleanup.error.
    assert.equal(
      events.find((e) => e.fields?.event === 'worktree.cleanup.error'),
      undefined,
      'un worktree ya borrado NO es un error de cleanup',
    );
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'must emit worktree.cleanup.ok');
    assert.equal(ok.fields.already_gone, true);
    assert.equal(ok.fields.branch_deleted, true);

    // La rama mergeada SÍ se borra — es la mitad «rama huérfana» del bug.
    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.ok(branchDel, 'must delete the merged branch');
    assert.equal(branchDel.args[2], 'feat/itclip-81-piezas-prototipo');

    // Sin árbol no se pregunta por el árbol: ni status ni remove ni move.
    assert.equal(calls.find((c) => c.args.includes('--porcelain')), undefined, 'no status');
    assert.equal(calls.find((c) => c.args.includes('--show-current')), undefined, 'no branch read');
    assert.equal(calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'remove'), undefined);
    assert.equal(calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move'), undefined);
  });

  it('ORDEN: prune corre ANTES de branch -D (git suelta la rama del worktree huérfano)', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => (args[0] === 'rev-list' ? '0' : ''));

    await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/x', existsFn: WT_GONE,
    });

    const pruneIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'prune');
    const branchDelIdx = calls.findIndex((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.ok(pruneIdx >= 0, 'must prune');
    assert.ok(branchDelIdx > pruneIdx, 'prune ANTES del branch -D (si no, git la ve checked-out)');
  });

  it('RAMA NO MERGEADA: la conserva + emite worktree.branch.kept (gate KODO-21 intacto)', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args[0] === 'rev-list') return '5\n'; // 5 commits que solo viven aquí
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/con-trabajo', existsFn: WT_GONE,
    });

    assert.equal(result.branch_deleted, false);
    assert.equal(result.already_gone, true);
    assert.equal(
      calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'),
      undefined,
      'el trabajo commiteado JAMÁS se pierde por cerrar la sesión',
    );
    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.fields.branch, 'feat/con-trabajo');
    assert.equal(kept.fields.unmerged_commits, 5);
  });

  it('MERGE NO VERIFICABLE: rev-list falla → conserva la rama (fail-safe)', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args[0] === 'rev-list') throw new Error('fatal: bad revision');
      return '';
    });

    await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/incierta', existsFn: WT_GONE,
    });

    assert.equal(calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'), undefined);
    const kept = events.find((e) => e.fields?.event === 'worktree.branch.kept');
    assert.ok(kept, 'must emit worktree.branch.kept');
    assert.equal(kept.fields.unmerged_commits, null);
  });

  it('SIN RAMA PERSISTIDA: no toca ninguna rama, cierra con cleanup.ok{already_gone}', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub(() => '');

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger, existsFn: WT_GONE,
    });

    assert.equal(result.already_gone, true);
    assert.equal(result.branch_deleted, false);
    // Ni siquiera se pregunta por el merge: no hay rama sobre la que preguntar.
    assert.equal(calls.find((c) => c.args[0] === 'rev-list'), undefined, 'no merge check');
    assert.equal(calls.find((c) => c.args[0] === 'branch'), undefined, 'no branch command');
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'cierra igual, sin error');
    assert.equal(ok.fields.already_gone, true);
  });

  it('PRUNE falla → cleanup.error{phase:prune}, never-throws, y la rama se decide igual', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args[0] === 'worktree' && args[1] === 'prune') throw new Error('prune locked');
      if (args[0] === 'rev-list') return '0';
      return '';
    });

    await assert.doesNotReject(() => cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/y', existsFn: WT_GONE,
    }));

    const err = events.find(
      (e) => e.fields?.event === 'worktree.cleanup.error' && e.fields?.phase === 'prune',
    );
    assert.ok(err, 'must emit cleanup.error{phase:prune}');
    assert.ok(calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'), 'la rama se decide igual');
  });

  it('PROBE QUE LANZA: ante la duda NO se toma el atajo — corre el camino normal', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'feat/z';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0';
      return '';
    });
    const explodingProbe = () => { throw new Error('EACCES'); };

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/persistida', existsFn: explodingProbe,
    });

    assert.equal(result.already_gone, false, 'un probe roto NO significa "ya no existe"');
    assert.ok(calls.find((c) => c.args.includes('--porcelain')), 'sí lee el status');
    assert.equal(result.removed, true);
  });

  it('WORKTREE VIVO pero git mudo: la rama persistida cubre el branch read que lanza', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) throw new Error('fatal: not a git repository');
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'rev-list') return '0';
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/persistida', existsFn: WT_EXISTS,
    });

    assert.equal(result.branch_deleted, true);
    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.equal(branchDel.args[2], 'feat/persistida');
  });

  it('DETACHED REAL: --show-current devuelve vacío → NO se sustituye por la persistida', async () => {
    const { logger } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return ''; // detached HEAD deliberado
      if (args.includes('--porcelain')) return '';
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
      branch: 'feat/persistida', existsFn: WT_EXISTS,
    });

    assert.equal(result.removed, true, 'el worktree limpio se remueve igual');
    assert.equal(result.branch_deleted, false);
    assert.equal(
      calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D'),
      undefined,
      'git dijo "ninguna rama" y se respeta — el vacío no es un fallo de lectura',
    );
  });
});
