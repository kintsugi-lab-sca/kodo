// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Build a fake TaskProvider with sensible defaults.
 * @param {Partial<import('../src/interface.js').TaskProvider>} overrides
 */
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({
      id: 'task-uuid-1',
      ref: 'KL-42',
      title: 'Test task',
      description: 'desc',
      labels: ['kodo'],
      projectId: 'proj-1',
      projectName: 'Test Project',
      groups: [],
      url: 'https://example.com/KL-42',
      priority: 'medium',
    }),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
    ...overrides,
  };
}

// --- Mocking infrastructure ---

/** @type {import('../src/interface.js').TaskProvider} */
let fakeProvider;
let launchWorkItemCalls = /** @type {any[]} */ ([]);
let launchWorkItemResult = /** @type {any} */ ({
  workspace_ref: 'workspace:1',
  session_id: 'sess-1',
  task_id: 'task-uuid-1',
  task_ref: 'KL-42',
  provider: 'test',
  project_id: 'proj-1',
  summary: 'Test task',
  status: 'running',
  started_at: new Date().toISOString(),
  project_path: '/tmp/test',
});
let listSessionsResult = /** @type {any[]} */ ([]);
let listWorkspacesResult = '';
let removeSessionCalls = /** @type {string[]} */ ([]);

// We'll test via a wrapper module that accepts dependencies (DI pattern)
// matching the project's established pattern from Phase 03.

/**
 * Inline implementation of dispatchTrigger logic for testing.
 * The real module will be created in the GREEN phase.
 * For now, we import and test it directly.
 */

describe('dispatchTrigger', () => {
  beforeEach(() => {
    fakeProvider = createFakeProvider();
    launchWorkItemCalls = [];
    listSessionsResult = [];
    listWorkspacesResult = '';
    removeSessionCalls = [];
  });

  it('Test 1: valid TriggerEvent + kodo label -> calls launchWorkItem, returns launched', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const event = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => fakeProvider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => listSessionsResult,
      listWorkspacesFn: async () => listWorkspacesResult,
      removeSessionFn: (id) => { removeSessionCalls.push(id); },
    });

    assert.equal(result.action, 'launched');
    assert.ok(result.session);
    assert.equal(launchWorkItemCalls.length, 1);
    assert.equal(launchWorkItemCalls[0].ref, 'KL-42');
  });

  it('Test 2: task WITHOUT kodo label -> returns ignored, does NOT call launchWorkItem', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const noKodoProvider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-2',
        ref: 'KL-99',
        title: 'No kodo task',
        description: '',
        labels: ['bug', 'frontend'],
        projectId: 'proj-1',
        projectName: 'Test Project',
        groups: [],
        url: 'https://example.com/KL-99',
        priority: 'low',
      }),
    });

    const event = { taskRef: 'KL-99', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => noKodoProvider,
      launchWorkItemFn: async () => { launchWorkItemCalls.push({}); return launchWorkItemResult; },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
    });

    assert.equal(result.action, 'ignored');
    assert.equal(launchWorkItemCalls.length, 0);
  });

  it('Test 3: force=true bypasses label check -> launches even without kodo label', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const noKodoProvider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-3',
        ref: 'KL-50',
        title: 'Force launch',
        description: '',
        labels: ['bug'],
        projectId: 'proj-1',
        projectName: 'Test Project',
        groups: [],
        url: 'https://example.com/KL-50',
        priority: 'medium',
      }),
    });

    const event = { taskRef: 'KL-50', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, { force: true }, {
      getProviderFn: () => noKodoProvider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
    });

    assert.equal(result.action, 'launched');
    assert.equal(launchWorkItemCalls.length, 1);
  });

  it('Test 4: action=manual still checks labels by default (requires kodo label)', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const noKodoProvider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-4',
        ref: 'KL-60',
        title: 'Manual no label',
        description: '',
        labels: ['enhancement'],
        projectId: 'proj-1',
        projectName: 'Test Project',
        groups: [],
        url: 'https://example.com/KL-60',
        priority: 'none',
      }),
    });

    const event = { taskRef: 'KL-60', action: 'manual', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => noKodoProvider,
      launchWorkItemFn: async () => { launchWorkItemCalls.push({}); return launchWorkItemResult; },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
    });

    assert.equal(result.action, 'ignored');
    assert.equal(launchWorkItemCalls.length, 0);
  });

  it('Test 5: session already active + workspace alive -> returns already_active', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const event = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => fakeProvider,
      launchWorkItemFn: async () => { launchWorkItemCalls.push({}); return launchWorkItemResult; },
      listSessionsFn: () => [
        { task_id: 'task-uuid-1', workspace_ref: 'workspace:5', status: 'running' },
      ],
      listWorkspacesFn: async () => 'workspace:5  some-title\nworkspace:6  other',
      removeSessionFn: () => {},
    });

    assert.equal(result.action, 'already_active');
    assert.equal(launchWorkItemCalls.length, 0);
  });

  it('Test 6: session exists but workspace gone -> removes stale session, relaunches', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const event = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => fakeProvider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => [
        { task_id: 'task-uuid-1', workspace_ref: 'workspace:5', status: 'running' },
      ],
      listWorkspacesFn: async () => 'workspace:99  unrelated',
      removeSessionFn: (id) => { removeSessionCalls.push(id); },
    });

    assert.equal(result.action, 'stale_relaunch');
    assert.ok(result.session);
    assert.equal(removeSessionCalls.length, 1);
    assert.equal(removeSessionCalls[0], 'task-uuid-1');
    assert.equal(launchWorkItemCalls.length, 1);
  });

  it('Test 7: model and flags from kodoConfig labels are forwarded to launchWorkItem opts', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const labelProvider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-5',
        ref: 'KL-70',
        title: 'Label test',
        description: '',
        labels: ['kodo:sonnet', 'kodo:yolo'],
        projectId: 'proj-1',
        projectName: 'Test Project',
        groups: [],
        url: 'https://example.com/KL-70',
        priority: 'medium',
      }),
    });

    const event = { taskRef: 'KL-70', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => labelProvider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
    });

    assert.equal(result.action, 'launched');
    assert.equal(launchWorkItemCalls[0].opts.model, 'sonnet');
    assert.ok(launchWorkItemCalls[0].opts.flags.includes('yolo'));
  });

  it('Test 8: model override from opts takes precedence over label-derived model', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');

    const labelProvider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-6',
        ref: 'KL-80',
        title: 'Override test',
        description: '',
        labels: ['kodo:sonnet'],
        projectId: 'proj-1',
        projectName: 'Test Project',
        groups: [],
        url: 'https://example.com/KL-80',
        priority: 'medium',
      }),
    });

    const event = { taskRef: 'KL-80', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, { model: 'haiku' }, {
      getProviderFn: () => labelProvider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
    });

    assert.equal(result.action, 'launched');
    assert.equal(launchWorkItemCalls[0].opts.model, 'haiku');
  });
});
