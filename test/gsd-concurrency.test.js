// @ts-check
//
// Integration test: Two concurrent GSD tasks targeting the same repo.
// Uses real lock files on disk (tmpdir) but DI for everything else.
// Validates ROADMAP Success Criterion 3: "Dos webhooks Plane que resuelven
// al mismo realpath de repo no arrancan sesiones GSD concurrentes."
//
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireGsdLock, releaseGsdLock } from '../src/gsd/lock.js';

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

  it('after lock release, second task can acquire', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const task1 = makeGsdTask('task-uuid-C', 'KL-60');
    const task2 = makeGsdTask('task-uuid-D', 'KL-61');

    // First task acquires lock
    const result1 = await dispatchTrigger(
      { taskRef: 'KL-60', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task1),
        launchWorkItemFn: async () => ({ ...fakeLaunchResult, task_id: task1.id }),
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );
    assert.equal(result1.action, 'launched');

    // Release lock (simulating stop hook)
    releaseGsdLock(repoDir, `pending-${task1.id}`);

    // Second task should now succeed
    const result2 = await dispatchTrigger(
      { taskRef: 'KL-61', action: 'state_change', provider: 'test', raw: {} },
      {},
      {
        getProviderFn: () => createFakeProvider(task2),
        launchWorkItemFn: async () => ({ ...fakeLaunchResult, task_id: task2.id }),
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (path, info) => acquireGsdLock(path, info),
        resolveProjectPathFn: () => repoDir,
      },
    );
    assert.equal(result2.action, 'launched', 'second task should launch after lock release');
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
});
