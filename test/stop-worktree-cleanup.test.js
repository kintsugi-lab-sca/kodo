// @ts-check
// Phase 19 WT-04: worktree cleanup en stop hook (fail-open).
// Cobertura mixta unit (gitFn stub) + E2E smoke (git real con tmpdir).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStopHook } from '../src/hooks/stop.js';

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

function makeSession(overrides = {}) {
  return {
    session_id: 'sess-wt-clean-test',
    task_id: 'task-1',
    task_ref: 'KL-99',
    provider: 'plane',
    project_id: 'proj-1',
    project_path: '/tmp/project',
    worktree_path: '/tmp/project/.bg-shell/sess-wt-clean-test',
    summary: 'Test',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:1',
    gsd: false,
    ...overrides,
  };
}

function makeStubCmux() {
  return {
    setColor: async () => {},
    notify: async () => {},
    listWorkspaces: async () => '',
    send: async () => {},
  };
}

function makeGitFnStub(handler) {
  const calls = [];
  const gitFn = (cwd, args) => {
    calls.push({ cwd, args });
    return handler(cwd, args) ?? '';
  };
  return { gitFn, calls };
}

describe('Phase 19 WT-04: worktree cleanup — unit (gitFn stub)', () => {
  it('CLEAN: removes worktree + deletes branch + emits cleanup.ok with branch_deleted=true', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return '';
      return '';
    });
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'must emit worktree.cleanup.ok');
    assert.equal(ok.level, 'info');
    assert.equal(ok.fields.branch_deleted, true);
    assert.equal(ok.fields.worktree_path, session.worktree_path);

    // Orden de calls: branch --show-current → status --porcelain → worktree remove → branch -D → prune
    const branchReadIdx = calls.findIndex((c) => c.args.includes('--show-current'));
    const statusIdx = calls.findIndex((c) => c.args.includes('--porcelain'));
    const removeIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'remove');
    const branchDelIdx = calls.findIndex((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    const pruneIdx = calls.findIndex((c) => c.args[0] === 'worktree' && c.args[1] === 'prune');
    assert.ok(branchReadIdx >= 0 && statusIdx > branchReadIdx, 'branch read BEFORE status (Pitfall #2)');
    assert.ok(removeIdx > statusIdx, 'remove after status');
    assert.ok(branchDelIdx > removeIdx, 'branch -D after remove');
    assert.ok(pruneIdx > branchDelIdx, 'prune oportunista al final (D-04)');
  });

  it('DIRTY: dirty status → move to .dirty/ + emit cleanup.dirty (D-02), branch preserved', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return 'M file.txt\n?? new.txt\n';
      return '';
    });
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    const dirty = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
    assert.ok(dirty, 'must emit worktree.cleanup.dirty');
    assert.equal(dirty.level, 'warn');
    assert.equal(dirty.fields.moved_to, `${session.worktree_path}.dirty`);
    const branchDel = calls.find((c) => c.args[0] === 'branch' && c.args[1] === '-D');
    assert.equal(branchDel, undefined, 'branch must be PRESERVED when dirty (D-02)');
  });

  it('ERROR on remove: gitFn throws → emits cleanup.error{phase:remove} + fail-open', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'kodo-sess-wt-clean-test';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('EBUSY: rmdir failed');
      return '';
    };
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );

    const err = events.find((e) => e.fields?.event === 'worktree.cleanup.error');
    assert.ok(err, 'must emit worktree.cleanup.error');
    assert.equal(err.level, 'error');
    assert.equal(err.fields.phase, 'remove');
    assert.match(err.fields.reason, /EBUSY/);
  });

  it('TARGET COLLISION: <wt>.dirty already exists → suffixed path (Pitfall #1)', async () => {
    // Crear tmp real para que existsSync devuelva true en el target canónico
    const tmpBase = mkdtempSync(join(tmpdir(), 'kodo-collision-'));
    const wt = join(tmpBase, 'wt');
    const dirty = `${wt}.dirty`;
    mkdirSync(wt, { recursive: true });
    mkdirSync(dirty, { recursive: true }); // pre-existing collision target
    const session = makeSession({ worktree_path: wt });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub((cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return 'M something\n'; // dirty
      return '';
    });
    try {
      await runStopHook(
        { session_id: session.session_id, cwd: session.project_path },
        {
          findSessionFn: () => ({ id: session.task_id, session }),
          removeSessionFn: () => {},
          cmux: makeStubCmux(),
          loggerFactory: () => logger,
          gitFn,
        },
      );
      const moveCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'move');
      assert.ok(moveCall, 'must call worktree move');
      const target = moveCall.args[3] ?? moveCall.args[moveCall.args.length - 1];
      assert.notEqual(target, dirty, 'target must NOT be the colliding path');
      assert.match(target, new RegExp(`^${wt.replace(/\//g, '\\/')}\\.dirty-`), 'must use suffixed variant');
      const dirtyEv = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
      assert.equal(dirtyEv?.fields?.moved_to, target);
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('LEGACY v0.5: no worktree_path → cleanup skipped silently (D-09)', async () => {
    const session = makeSession({ worktree_path: undefined });
    const { logger, events } = makeMemLogger();
    const { gitFn, calls } = makeGitFnStub(() => '');
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    assert.equal(calls.length, 0, 'gitFn must NOT be called for legacy v0.5 (D-09 silent)');
    const cleanupEvents = events.filter((e) => String(e.fields?.event || '').startsWith('worktree.cleanup.'));
    assert.equal(cleanupEvents.length, 0, 'no worktree.cleanup.* events for legacy (silent)');
  });

  it('BRANCH-D FAILURE: branch -D throws → cleanup.ok with branch_deleted=false (Pitfall #3 fail-open)', async () => {
    const session = makeSession();
    const { logger, events } = makeMemLogger();
    const gitFn = (cwd, args) => {
      if (args.includes('--show-current')) return 'sess-x';
      if (args.includes('--porcelain')) return '';
      if (args[0] === 'branch' && args[1] === '-D') throw new Error('cannot delete branch in use');
      return '';
    };
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        gitFn,
      },
    );
    const ok = events.find((e) => e.fields?.event === 'worktree.cleanup.ok');
    assert.ok(ok, 'cleanup.ok must still be emitted');
    assert.equal(ok.fields.branch_deleted, false);
    const err = events.find((e) => e.fields?.event === 'worktree.cleanup.error');
    assert.equal(err, undefined, 'no cleanup.error for branch -D failure (warn-only per Pitfall #3)');
  });
});

describe('Phase 19 WT-04: worktree cleanup — E2E smoke (git real)', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'kodo-wt-e2e-'));
  });

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  function makeIsolatedRepoWithWorktree(branchName = 'kodo-sess-e2e') {
    const repo = join(tmpBase, 'repo');
    mkdirSync(repo, { recursive: true });
    const opts = { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
    execSync('git init -q', opts);
    execSync('git config user.email "test@kodo.local"', opts);
    execSync('git config user.name "kodo test"', opts);
    execSync('git config commit.gpgsign false', opts);
    writeFileSync(join(repo, 'seed.txt'), 'seed');
    execSync('git add -A && git commit -q -m "seed"', opts);
    const wt = join(repo, '.bg-shell', 'sess-e2e');
    execSync(`git worktree add -b ${branchName} ${wt}`, opts);
    return { repo, wt, branchName };
  }

  it('E2E CLEAN: worktree removed + branch deleted on disk', async () => {
    const { repo, wt, branchName } = makeIsolatedRepoWithWorktree();
    const session = makeSession({ project_path: repo, worktree_path: wt, session_id: 'sess-e2e' });
    const { logger, events } = makeMemLogger();
    await runStopHook(
      { session_id: session.session_id, cwd: repo },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
        // gitFn default (execFileSync real)
      },
    );
    assert.equal(existsSync(wt), false, 'worktree dir must be removed');
    const branches = execSync('git branch', { cwd: repo, encoding: 'utf-8' });
    assert.ok(!branches.includes(branchName), `branch ${branchName} must be deleted`);
    assert.ok(events.find((e) => e.fields?.event === 'worktree.cleanup.ok'), 'cleanup.ok emitted');
  });

  it('E2E DIRTY: worktree moved to .dirty/ + branch preserved', async () => {
    const { repo, wt, branchName } = makeIsolatedRepoWithWorktree('kodo-sess-dirty');
    appendFileSync(join(wt, 'seed.txt'), 'uncommitted change');
    const session = makeSession({
      project_path: repo,
      worktree_path: wt,
      session_id: 'sess-e2e-dirty',
    });
    const { logger, events } = makeMemLogger();
    await runStopHook(
      { session_id: session.session_id, cwd: repo },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: () => {},
        cmux: makeStubCmux(),
        loggerFactory: () => logger,
      },
    );
    const dirtyEv = events.find((e) => e.fields?.event === 'worktree.cleanup.dirty');
    assert.ok(dirtyEv, 'cleanup.dirty emitted');
    assert.equal(existsSync(dirtyEv.fields.moved_to), true, 'moved_to path exists on disk');
    const branches = execSync('git branch', { cwd: repo, encoding: 'utf-8' });
    assert.ok(branches.includes(branchName), `branch ${branchName} preserved`);
  });
});
