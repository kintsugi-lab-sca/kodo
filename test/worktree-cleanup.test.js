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
const WT = '/tmp/project/.bg-shell/sess-helper-test';
const SESSION_ID = 'sess-helper-test';

describe('Phase 41 Plan 01: cleanupWorktree helper — direct unit', () => {
  it('CLEAN: removes worktree + deletes branch + emits cleanup.ok, returns {removed, branch_deleted}', async () => {
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-helper-test';
      if (args.includes('--porcelain')) return '';
      return '';
    });

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(result, { removed: true, moved_to: null, branch_deleted: true });

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
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
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
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
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
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
    });

    assert.deepEqual(result, { removed: false, moved_to: null, branch_deleted: false });
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
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
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
      if (args[0] === 'branch' && args[1] === '-D') throw new Error('cannot delete branch in use');
      return '';
    };

    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
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

  it('NEVER THROWS: branch read failure is swallowed (returns structured result)', async () => {
    const { logger } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) throw new Error('detached / no branch');
      if (args.includes('--porcelain')) return '';
      return '';
    };
    const result = await cleanupWorktree({
      project: PROJECT, worktree: WT, sessionId: SESSION_ID, gitFn, logger,
    });
    // branch read failed → branchName null → remove ok, branch -D skipped
    assert.equal(result.removed, true);
    assert.equal(result.branch_deleted, false);
  });
});
