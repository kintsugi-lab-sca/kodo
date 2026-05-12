// @ts-check
//
// Integration test: Two concurrent GSD tasks targeting the same repo.
// Uses real lock files on disk (tmpdir) but DI for everything else.
// Validates ROADMAP Success Criterion 3: "Dos webhooks Plane que resuelven
// al mismo realpath de repo no arrancan sesiones GSD concurrentes."
//
// Phase 18 (SC#3 WT-03): se extiende con 4 asserts que validan que el lock
// per-repo SIGUE viviendo en `<projectPath>/.planning/.kodo.lock` y NUNCA
// dentro del worktree. Coalescencia preservada con --worktree cableado.
//
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireGsdLock, releaseGsdLock, readLock } from '../src/gsd/lock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Shared tmp dir simulating a repo with .planning/ */
let repoDir;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'kodo-concurrency-'));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

function makeGsdTask(id, ref) {
  return {
    id,
    ref,
    title: `GSD task ${ref}`,
    description: '',
    labels: ['kodo', 'kodo:gsd'],
    projectId: 'proj-1',
    projectName: 'Test Project',
    groups: [],
    url: `https://example.com/${ref}`,
    priority: 'medium',
    state: 'Todo',
  };
}

function createFakeProvider(task) {
  return {
    init: async () => {},
    getTask: async () => task,
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
  };
}

const fakeLaunchResult = {
  workspace_ref: 'workspace:1',
  session_id: 'sess-1',
  task_id: 'task-1',
  task_ref: 'KL-42',
  provider: 'test',
  project_id: 'proj-1',
  summary: 'Test task',
  status: 'running',
  started_at: new Date().toISOString(),
  project_path: '/tmp/test',
};

describe('GSD concurrency — integration (Success Criterion 3)', () => {

  it('first GSD task acquires lock, second is rejected with gsd_locked', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = makeGsdTask('task-uuid-A', 'KL-50');
    const task2 = makeGsdTask('task-uuid-B', 'KL-51');

    // Dispatch first task — should acquire lock and launch
    const result1 = await dispatchTrigger(
      { taskRef: 'KL-50', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task1),
        launchWorkItemFn: async () => ({ ...fakeLaunchResult, task_id: task1.id, task_ref: task1.ref }),
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );

    assert.equal(result1.action, 'launched', 'first task should launch successfully');

    // Dispatch second task on SAME repo — should be rejected
    const result2 = await dispatchTrigger(
      { taskRef: 'KL-51', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task2),
        launchWorkItemFn: async () => ({ ...fakeLaunchResult, task_id: task2.id, task_ref: task2.ref }),
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );

    assert.equal(result2.action, 'gsd_locked', 'second task should be rejected');
    assert.ok(result2.holder, 'result should include holder info');
    assert.equal(result2.holder.task_ref, 'KL-50', 'holder should be first task');
  });

  it('round-trip: dispatcher acquires with UUID → stop-hook-style release with that UUID → second dispatch launches (CR-01 regression)', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = makeGsdTask('task-uuid-C', 'KL-60');
    const task2 = makeGsdTask('task-uuid-D', 'KL-61');

    // Capture the sessionId that the dispatcher uses with acquireGsdLock.
    // In the FIXED dispatcher this is a randomUUID generated before acquire,
    // and the SAME value is passed to launchWorkItemFn via opts.sessionId.
    let capturedLockSessionId = null;
    let capturedLaunchSessionId = null;

    const result1 = await dispatchTrigger(
      { taskRef: 'KL-60', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task1),
        launchWorkItemFn: async (_ref, opts) => {
          capturedLaunchSessionId = opts.sessionId;
          return {
            ...fakeLaunchResult,
            task_id: task1.id,
            session_id: opts.sessionId,  // simulate manager.js persisting opts.sessionId
          };
        },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => {
          capturedLockSessionId = info.session_id;
          return acquireGsdLock(path, info);
        },
        resolveProjectPathFn: () => repoDir,
      },
    );
    assert.equal(result1.action, 'launched');
    assert.ok(capturedLockSessionId, 'dispatcher must have called acquireGsdLockFn');
    assert.ok(capturedLaunchSessionId, 'dispatcher must have called launchWorkItemFn with opts.sessionId');
    assert.equal(
      capturedLockSessionId,
      capturedLaunchSessionId,
      'CR-01 fix: acquire and launch must share the same sessionId',
    );

    // UUID v4 shape: acquire sessionId must be a UUID, never the old synthetic prefix.
    const SYNTHETIC_PREFIX = 'pend' + 'ing-';
    const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(
      capturedLockSessionId,
      uuidV4Re,
      'lock session_id must be a UUID, not a synthetic prefix',
    );

    // The on-disk lock content must also carry the UUID (defensive — ensures
    // acquireGsdLock persisted what the dispatcher passed).
    const lockOnDisk = readLock(repoDir);
    assert.ok(lockOnDisk, 'lock file must exist after dispatch');
    assert.equal(lockOnDisk.session_id, capturedLockSessionId);
    assert.match(lockOnDisk.session_id, uuidV4Re);
    assert.ok(
      !lockOnDisk.session_id.startsWith(SYNTHETIC_PREFIX),
      'on-disk lock must not contain the old synthetic prefix',
    );

    // Simulate what src/hooks/stop.js does when the GSD session ends:
    //   releaseGsdLock(session.project_path, session.session_id)
    // session.session_id in production is the UUID returned by launchWorkItem.
    // Here we use the same UUID the dispatcher threaded into opts.sessionId.
    releaseGsdLock(repoDir, capturedLaunchSessionId);

    // Lock file must be gone after the authentic release round-trip.
    assert.equal(
      readLock(repoDir),
      null,
      'lock file must be deleted by releaseGsdLock — if this fails, CR-01 is back',
    );

    // Second task should now succeed — no manual release, no TTL wait.
    const result2 = await dispatchTrigger(
      { taskRef: 'KL-61', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task2),
        launchWorkItemFn: async (_ref, opts) => ({
          ...fakeLaunchResult,
          task_id: task2.id,
          session_id: opts.sessionId,
        }),
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );
    assert.equal(
      result2.action,
      'launched',
      'second task must launch after authentic round-trip',
    );
  });

  it('non-GSD tasks on same repo are not affected by lock', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const gsdTask = makeGsdTask('task-uuid-E', 'KL-70');
    const normalTask = {
      ...makeGsdTask('task-uuid-F', 'KL-71'),
      labels: ['kodo'],  // no kodo:gsd label
    };

    // GSD task acquires lock
    await dispatchTrigger(
      { taskRef: 'KL-70', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(gsdTask),
        launchWorkItemFn: async () => fakeLaunchResult,
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );

    // Non-GSD task on same repo should still launch (lock guard skipped)
    let lockCalled = false;
    const result = await dispatchTrigger(
      { taskRef: 'KL-71', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(normalTask),
        launchWorkItemFn: async () => fakeLaunchResult,
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: () => { lockCalled = true; return { acquired: true }; },
        resolveProjectPathFn: () => repoDir,
      },
    );

    assert.equal(lockCalled, false, 'lock guard should not fire for non-GSD tasks');
    assert.equal(result.action, 'launched');
  });

  it('WR-01: launchWorkItem throws after acquire → lock is released → second task can launch', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = makeGsdTask('task-uuid-WR01-A', 'KL-80');
    const task2 = makeGsdTask('task-uuid-WR01-B', 'KL-81');

    // First dispatch acquires the lock, then launchWorkItem explodes.
    // The dispatcher must release the lock before re-throwing.
    await assert.rejects(
      () => dispatchTrigger(
        { taskRef: 'KL-80', action: 'state_change', provider: 'test', raw: {} },
        {},
        {
          getProviderFn: () => createFakeProvider(task1),
          launchWorkItemFn: async () => { throw new Error('cmux unavailable'); },
          listSessionsFn: () => [],
          listWorkspacesFn: async () => '',
          removeSessionFn: () => {},
          acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
          resolveProjectPathFn: () => repoDir,
        },
      ),
      /cmux unavailable/,
    );

    // Lock must be gone despite the launch failure.
    assert.equal(
      readLock(repoDir),
      null,
      'WR-01: lock must be released when launchWorkItem throws',
    );

    // Confirm the repo is dispatchable again.
    const result2 = await dispatchTrigger(
      { taskRef: 'KL-81', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task2),
        launchWorkItemFn: async (_ref, opts) => ({
          ...fakeLaunchResult,
          task_id: task2.id,
          session_id: opts.sessionId,
        }),
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );
    assert.equal(result2.action, 'launched');
  });
});

describe('Phase 18 — coalesce con worktree cableado (WT-03 SC#3)', () => {
  let repoDir2;

  beforeEach(() => {
    repoDir2 = mkdtempSync(join(tmpdir(), 'kodo-coalesce-wt-'));
  });

  afterEach(() => {
    rmSync(repoDir2, { recursive: true, force: true });
  });

  it('GSD coalesce: second dispatch gets gsd_locked BEFORE worktree check', async () => {
    // Invariante: el orden en dispatcher es lock acquire → collision check
    // → resolver. La segunda dispatch sobre la misma repo rebota por el lock
    // ANTES de tocar existsSync(worktreePath). Worktree path no llega a
    // computarse en la rama rejected (lockResult.acquired === false return
    // early).
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = makeGsdTask('task-uuid-WT-1', 'KL-200');
    const task2 = makeGsdTask('task-uuid-WT-2', 'KL-201');

    let existsSyncCallCount = 0;

    const result1 = await dispatchTrigger(
      { taskRef: 'KL-200', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task1),
        launchWorkItemFn: async () => fakeLaunchResult,
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir2,
        existsSyncFn: (p) => { existsSyncCallCount++; return false; },
      },
    );
    assert.equal(result1.action, 'launched');
    // First dispatch went through the collision check once.
    assert.equal(existsSyncCallCount, 1, 'first dispatch must hit existsSync exactly once');

    const result2 = await dispatchTrigger(
      { taskRef: 'KL-201', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task2),
        launchWorkItemFn: async () => fakeLaunchResult,
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir2,
        existsSyncFn: (p) => { existsSyncCallCount++; return false; },
      },
    );
    assert.equal(result2.action, 'gsd_locked', 'second dispatch must be rejected by lock');
    assert.ok(result2.holder);
    assert.equal(result2.holder.task_ref, 'KL-200');
    // The second dispatch must NOT have reached the collision check — lock
    // rejection returns early. existsSyncCallCount must still be 1.
    assert.equal(
      existsSyncCallCount,
      1,
      'second dispatch must NOT reach existsSync — lock rejection precedes collision check',
    );
  });

  it('lock file vive en projectPath/.planning/.kodo.lock, NO en worktree (WT-03 SC#3)', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = makeGsdTask('task-uuid-WT-LOCK', 'KL-300');
    let capturedSessionId = null;

    await dispatchTrigger(
      { taskRef: 'KL-300', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task1),
        launchWorkItemFn: async (_ref, opts) => {
          capturedSessionId = opts.sessionId;
          return { ...fakeLaunchResult, session_id: opts.sessionId };
        },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir2,
      },
    );

    // El lock file vive en el repo principal, no en el worktree.
    // realpath para colapsar /tmp → /private/tmp en macOS (Pitfall 3 Phase 8).
    const realRepo = realpathSync(repoDir2);
    const lockPath = join(realRepo, '.planning', '.kodo.lock');
    assert.ok(existsSync(lockPath), `Lock debe vivir en ${lockPath}`);

    const lockContent = JSON.parse(readFileSync(lockPath, 'utf-8'));
    assert.equal(lockContent.session_id, capturedSessionId, 'lock session_id == launch sessionId');
    assert.match(lockContent.session_id, /^[a-f0-9-]+$/);

    // NUNCA debe existir un lock dentro del worktree.
    const worktreePath = join(realRepo, '.bg-shell', lockContent.session_id);
    const wrongLockPath = join(worktreePath, '.planning', '.kodo.lock');
    assert.ok(
      !existsSync(wrongLockPath),
      `Lock NUNCA debe vivir dentro del worktree (${wrongLockPath})`,
    );
  });

  it('no-GSD parallel sobre mismo repo: ambos dispatches launchean con sessionIds distintos (D-06b)', async () => {
    // Driver: incidencia 28/04 ROMAN-113…118. Worktrees distintos por
    // session-id permiten paralelismo sin contención (cada uno aislado).
    // Antes de Phase 18, dos no-GSD compartían cwd=projectPath y `git add -A`
    // arrastraba staging entre sesiones. Ahora cada una corre en su worktree.
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = { ...makeGsdTask('task-uuid-WT-P1', 'KL-400'), labels: ['kodo'] };
    const task2 = { ...makeGsdTask('task-uuid-WT-P2', 'KL-401'), labels: ['kodo'] };

    let session1Id = null;
    let session2Id = null;

    const r1 = await dispatchTrigger(
      { taskRef: 'KL-400', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task1),
        launchWorkItemFn: async (_ref, opts) => {
          session1Id = opts.sessionId;
          return { ...fakeLaunchResult, task_id: task1.id, session_id: opts.sessionId };
        },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        // no acquireGsdLockFn override — non-GSD does not touch lock
        resolveProjectPathFn: () => repoDir2,
      },
    );

    const r2 = await dispatchTrigger(
      { taskRef: 'KL-401', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task2),
        launchWorkItemFn: async (_ref, opts) => {
          session2Id = opts.sessionId;
          return { ...fakeLaunchResult, task_id: task2.id, session_id: opts.sessionId };
        },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        resolveProjectPathFn: () => repoDir2,
      },
    );

    assert.equal(r1.action, 'launched', 'non-GSD task 1 must launch');
    assert.equal(r2.action, 'launched', 'non-GSD task 2 must launch (paralelo permitido — D-06b)');
    assert.ok(session1Id, 'task 1 must have a sessionId threaded by dispatcher');
    assert.ok(session2Id, 'task 2 must have a sessionId threaded by dispatcher');
    assert.notEqual(session1Id, session2Id, 'sessionIds must be unique — worktrees aislados');
  });

  it('lock invariant cross-callsite: NUNCA se pasa worktreePath a acquireGsdLock/releaseGsdLock', () => {
    // Source-hygiene cross-source. Patrón Phase 16 LOG-13 dispatcher-isolation.
    // Asegura que ningún callsite pasa un nombre que contenga "worktree" al
    // lock. WT-03 invariant doblemente blindado (este test + integration above).
    const sources = [
      join(__dirname, '..', 'src', 'triggers', 'dispatcher.js'),
      join(__dirname, '..', 'src', 'session', 'manager.js'),
      join(__dirname, '..', 'src', 'hooks', 'stop.js'),
    ];

    // WR-05 (review): naive comment stripper. Adecuado para los source
    // files actuales — NO maneja strings con `//`, template literals con
    // block-comments, ni comentarios block inline-con-código (p.ej.
    // `fn(<block>note<block> x)`). Si el codebase evoluciona y aparecen
    // tales patrones, considerar AST-based stripping (acorn). Por ahora la
    // simplicidad gana: este test detecta el WT-03 violation que importa.
    /** @param {string} src */
    function stripComments(src) {
      return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
    }

    for (const f of sources) {
      const src = readFileSync(f, 'utf-8');
      const stripped = stripComments(src);
      assert.ok(
        !/acquireGsdLockFn?\s*\([^)]*worktree/i.test(stripped),
        `${f} pasa worktree* a acquireGsdLock — VIOLA WT-03 SC#3`,
      );
      assert.ok(
        !/releaseGsdLockFn?\s*\([^)]*worktree/i.test(stripped),
        `${f} pasa worktree* a releaseGsdLock — VIOLA WT-03 SC#3`,
      );
    }
  });
});
