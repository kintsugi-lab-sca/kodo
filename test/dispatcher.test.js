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

describe('dispatchTrigger — GSD lock guard (D-08)', () => {
  beforeEach(() => {
    launchWorkItemCalls = [];
  });

  it('returns gsd_locked when lock is held by another session', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const provider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-2',
        ref: 'KL-99',
        title: 'GSD task',
        description: '',
        labels: ['kodo', 'kodo:gsd'],
        projectId: 'proj-1',
        projectName: 'Test',
        groups: [],
        url: 'https://example.com/KL-99',
        priority: 'medium',
        state: 'Todo',
      }),
    });
    const event = { taskRef: 'KL-99', action: 'state_change', provider: 'test', raw: {} };
    const holder = { session_id: 'sess-other', task_ref: 'KL-50' };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => provider,
      launchWorkItemFn: async () => { launchWorkItemCalls.push({}); return launchWorkItemResult; },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => ({ acquired: false, holder }),
      resolveProjectPathFn: () => '/tmp/test-repo',
    });
    assert.equal(result.action, 'gsd_locked');
    assert.deepEqual(result.holder, holder);
    assert.equal(launchWorkItemCalls.length, 0, 'launch must not happen when locked');
  });

  it('proceeds to launch when lock is acquired', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const provider = createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-3',
        ref: 'KL-100',
        title: 'GSD task',
        description: '',
        labels: ['kodo', 'kodo:gsd'],
        projectId: 'proj-1',
        projectName: 'Test',
        groups: [],
        url: 'https://example.com/KL-100',
        priority: 'medium',
        state: 'Todo',
      }),
    });
    const event = { taskRef: 'KL-100', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => provider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => ({ acquired: true }),
      resolveProjectPathFn: () => '/tmp/test-repo',
    });
    assert.equal(result.action, 'launched');
    assert.equal(launchWorkItemCalls.length, 1);
  });

  it('skips lock guard for non-GSD tasks', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let lockCalled = false;
    const provider = createFakeProvider();
    const event = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => provider,
      launchWorkItemFn: async (ref, opts) => {
        launchWorkItemCalls.push({ ref, opts });
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => { lockCalled = true; return { acquired: true }; },
      resolveProjectPathFn: () => '/tmp/test-repo',
    });
    assert.equal(lockCalled, false, 'lock should not be called for non-GSD tasks');
    assert.equal(result.action, 'launched');
  });
});

describe('dispatchTrigger — CR-01 regression (session_id identity end-to-end)', () => {
  const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function gsdProvider() {
    return createFakeProvider({
      getTask: async () => ({
        id: 'task-uuid-CR01',
        ref: 'KL-501',
        title: 'GSD CR-01 test',
        description: '',
        labels: ['kodo', 'kodo:gsd'],
        projectId: 'proj-1',
        projectName: 'Test',
        groups: [],
        url: 'https://example.com/KL-501',
        priority: 'medium',
        state: 'Todo',
      }),
    });
  }

  beforeEach(() => {
    launchWorkItemCalls = [];
  });

  it('D-1: acquireGsdLockFn receives a UUID v4 session_id, never `pending-...`', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let capturedLockInfo = null;
    const event = { taskRef: 'KL-501', action: 'state_change', provider: 'test', raw: {} };
    await dispatchTrigger(event, {}, {
      getProviderFn: () => gsdProvider(),
      launchWorkItemFn: async () => launchWorkItemResult,
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: (_path, info) => { capturedLockInfo = info; return { acquired: true }; },
      resolveProjectPathFn: () => '/tmp/test-cr01',
    });
    assert.ok(capturedLockInfo, 'acquireGsdLockFn must be called');
    assert.match(capturedLockInfo.session_id, uuidV4Re, 'lock session_id must be a UUID v4');
    assert.ok(
      !capturedLockInfo.session_id.startsWith('pending-'),
      'synthetic pending-* ID must be gone',
    );
  });

  it('D-2: sessionId passed to acquireGsdLockFn === opts.sessionId passed to launchWorkItemFn', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let lockSessionId = null;
    let launchSessionId = null;
    const event = { taskRef: 'KL-501', action: 'state_change', provider: 'test', raw: {} };
    await dispatchTrigger(event, {}, {
      getProviderFn: () => gsdProvider(),
      launchWorkItemFn: async (_ref, opts) => {
        launchSessionId = opts.sessionId;
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: (_path, info) => { lockSessionId = info.session_id; return { acquired: true }; },
      resolveProjectPathFn: () => '/tmp/test-cr01',
    });
    assert.ok(lockSessionId, 'lock session_id captured');
    assert.ok(launchSessionId, 'launch opts.sessionId captured');
    assert.equal(
      lockSessionId,
      launchSessionId,
      'acquire and launch must share the same sessionId (CR-01 fix)',
    );
  });

  it('D-3 (WR-01): if launchWorkItemFn throws, releaseGsdLockFn is called with the acquire sessionId, error propagates', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let lockSessionId = null;
    let releaseArgs = null;
    const event = { taskRef: 'KL-501', action: 'state_change', provider: 'test', raw: {} };
    await assert.rejects(
      () => dispatchTrigger(event, {}, {
        getProviderFn: () => gsdProvider(),
        launchWorkItemFn: async () => { throw new Error('launch boom'); },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: (_path, info) => { lockSessionId = info.session_id; return { acquired: true }; },
        releaseGsdLockFn: (path, sid) => { releaseArgs = { path, sid }; },
        resolveProjectPathFn: () => '/tmp/test-cr01',
      }),
      /launch boom/,
    );
    assert.ok(releaseArgs, 'releaseGsdLockFn must be called on launch error');
    assert.equal(releaseArgs.path, '/tmp/test-cr01');
    assert.equal(
      releaseArgs.sid,
      lockSessionId,
      'release must use the same sessionId that was used to acquire',
    );
  });

  it('D-4 (WR-01 negative): non-GSD task — releaseGsdLockFn is NOT called even if launch throws', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let releaseCalled = false;
    const event = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };
    await assert.rejects(
      () => dispatchTrigger(event, {}, {
        getProviderFn: () => createFakeProvider(),  // labels: ['kodo'] only, no 'kodo:gsd'
        launchWorkItemFn: async () => { throw new Error('launch boom'); },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: () => ({ acquired: true }),  // should not be called, but safe default
        releaseGsdLockFn: () => { releaseCalled = true; },
        resolveProjectPathFn: () => '/tmp/test-nonGSD',
      }),
      /launch boom/,
    );
    assert.equal(releaseCalled, false, 'non-GSD path must not touch releaseGsdLockFn');
  });
});

describe('dispatchTrigger — Phase 9 resolver integration', () => {
  const baseTask = {
    id: 'task-uuid-9-1',
    ref: 'KL-42',
    title: 'Phase Resolver + Bootstrap',
    description: 'Some description',
    labels: ['kodo', 'kodo:gsd'],
    state: 'In Progress',
    projectId: 'proj-1',
    projectName: 'Test',
    groups: [],
    url: 'https://example.com/KL-42',
    priority: 'medium',
  };
  const baseEvent = { provider: 'test', taskRef: 'KL-42', action: 'state_change', raw: {} };

  function makeDeps({ verdict, acquireResult = { acquired: true }, launchResult = { session_id: 'sess-1' }, task = baseTask }) {
    const inspectState = { releaseCalled: false, launchCalledWith: null };
    return {
      getProviderFn: () => ({
        getTask: async () => task,
        init: async () => {},
        updateTaskState: async () => {},
        addComment: async () => {},
        listPendingTasks: async () => [],
        parseTriggerEvent: () => null,
        verifySignature: () => true,
        resolveRef: async () => '',
      }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      acquireGsdLockFn: () => acquireResult,
      releaseGsdLockFn: () => { inspectState.releaseCalled = true; },
      resolvePhaseFn: () => verdict,
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      launchWorkItemFn: async (_ref, opts) => { inspectState.launchCalledWith = opts; return launchResult; },
      _inspect: () => inspectState,
    };
  }

  it('threads phase_id to launchOpts when resolver returns action=phase', async () => {
    const deps = makeDeps({
      verdict: { action: 'phase', phase_id: '9', match_heading: '### Phase 9: Phase Resolver + Bootstrap', match_reason: 'exact' },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'launched');
    const { launchCalledWith } = deps._inspect();
    assert.equal(launchCalledWith.phase_id, '9');
    assert.equal(launchCalledWith.brief, undefined);
  });

  it('threads brief to launchOpts when resolver returns action=bootstrap', async () => {
    const deps = makeDeps({
      verdict: { action: 'bootstrap', reason: 'no-planning-dir' },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    await dispatchTrigger(baseEvent, {}, deps);
    const { launchCalledWith } = deps._inspect();
    assert.ok(launchCalledWith.brief, 'brief should be present');
    assert.ok(launchCalledWith.brief.startsWith('## Project Brief'));
    assert.equal(launchCalledWith.phase_id, undefined);
  });

  it('releases lock and returns resolver_failed on action=error (no-match)', async () => {
    const deps = makeDeps({
      verdict: { action: 'error', code: 'no-match' },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'resolver_failed');
    assert.equal(result.code, 'no-match');
    const { releaseCalled, launchCalledWith } = deps._inspect();
    assert.equal(releaseCalled, true, 'lock must be released on resolver error (D-13)');
    assert.equal(launchCalledWith, null, 'launch must NOT be called on resolver error');
  });

  it('releases lock and returns resolver_failed on multi-match with detail', async () => {
    const deps = makeDeps({
      verdict: { action: 'error', code: 'multi-match', matches: ['Phase 1: Foo', 'Phase 2: Foo'] },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'resolver_failed');
    assert.equal(result.code, 'multi-match');
    const { releaseCalled } = deps._inspect();
    assert.equal(releaseCalled, true);
  });

  it('resolver runs BEFORE session-already-active guard (pattern-mapper #2)', async () => {
    // Simulate an existing session AND a successful resolver match. The
    // existing-session path should still thread phase_id through launchOpts
    // (stale_relaunch). Use listSessionsFn returning a session whose workspace
    // is no longer present (stale) to force stale_relaunch path.
    const deps = makeDeps({
      verdict: { action: 'phase', phase_id: '9', match_heading: '### Phase 9', match_reason: 'x' },
    });
    deps.listSessionsFn = () => [{ task_id: 'task-uuid-9-1', workspace_ref: 'workspace:gone' }];
    deps.listWorkspacesFn = async () => ''; // empty workspace list → stale
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'stale_relaunch');
    const { launchCalledWith } = deps._inspect();
    assert.equal(launchCalledWith.phase_id, '9', 'stale relaunch must still receive phase_id');
  });

  it('does NOT call resolver for non-GSD tasks', async () => {
    const nonGsdTask = { ...baseTask, labels: ['kodo'] /* no kodo:gsd */ };
    let resolverCalled = false;
    const deps = makeDeps({
      verdict: { action: 'phase', phase_id: '9', match_heading: 'x', match_reason: 'x' },
      task: nonGsdTask,
    });
    deps.resolvePhaseFn = () => {
      resolverCalled = true;
      return { action: 'phase', phase_id: '9', match_heading: 'x', match_reason: 'x' };
    };
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(resolverCalled, false, 'resolver must not run for non-GSD tasks');
  });
});

describe('dispatchTrigger — QUICK-08 — quick mode resolver tolerance', () => {
  const baseTask = {
    id: 'task-uuid-quick-1',
    ref: 'KL-42',
    title: 'Quick mode test',
    description: 'Some description',
    labels: ['kodo', 'kodo:gsd-quick'],  // propagates gsdMode === 'quick' via parseKodoLabels + getGsdMode
    state: 'In Progress',
    projectId: 'proj-1',
    projectName: 'Test',
    groups: [],
    url: 'https://example.com/KL-42',
    priority: 'medium',
  };
  const baseEvent = { provider: 'test', taskRef: 'KL-42', action: 'state_change', raw: {} };

  function makeQuickDeps({ verdict, acquireResult = { acquired: true }, launchResult = { session_id: 'sess-quick' }, task = baseTask }) {
    const inspectState = { releaseCalled: false, launchCalledWith: null };
    return {
      getProviderFn: () => ({
        getTask: async () => task,
        init: async () => {},
        updateTaskState: async () => {},
        addComment: async () => {},
        listPendingTasks: async () => [],
        parseTriggerEvent: () => null,
        verifySignature: () => true,
        resolveRef: async () => '',
      }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      acquireGsdLockFn: () => acquireResult,
      releaseGsdLockFn: () => { inspectState.releaseCalled = true; },
      resolvePhaseFn: () => verdict,
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      launchWorkItemFn: async (_ref, opts) => { inspectState.launchCalledWith = opts; return launchResult; },
      _inspect: () => inspectState,
    };
  }

  it('QUICK-08: quick + verdict phase → discards phase_id (Phase 11 D-03, dispatcher.js:157-159)', async () => {
    // Quick is phase-agnostic: even when the resolver matches a phase, the
    // session is not bound to it. Dispatcher emits gsd.phase.resolved with
    // phase_id (forensic — D-05 Phase 11) but does NOT thread it to launchOpts.
    const deps = makeQuickDeps({
      verdict: { action: 'phase', phase_id: '9', match_heading: '### Phase 9: Foo', match_reason: 'exact' },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'launched');
    const { launchCalledWith } = deps._inspect();
    assert.ok(launchCalledWith, 'launch must have been invoked');
    assert.equal(
      launchCalledWith.phase_id,
      undefined,
      'quick mode discards phase_id even when resolver returned a phase match',
    );
    assert.equal(launchCalledWith.brief, undefined, 'no brief on quick + match path');
  });

  it('QUICK-08: quick + verdict error no-match → tolerated, continues to launch (Phase 11 D-06)', async () => {
    // Phase 11 D-06: quick + no-match is not a fatal error. Dispatcher emits
    // info log gsd.phase.resolved {matched:false, code:'no-match', tolerated:true,
    // mode:'quick'} and continues to launch. roadmap-missing and multi-match
    // remain fail-closed.
    const deps = makeQuickDeps({
      verdict: { action: 'error', code: 'no-match' },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'launched', 'quick + no-match must NOT abort — continues to launch');
    const { launchCalledWith, releaseCalled } = deps._inspect();
    assert.ok(launchCalledWith, 'launch must have been invoked despite no-match');
    assert.equal(launchCalledWith.phase_id, undefined, 'no phase_id when resolver did not match');
    assert.equal(launchCalledWith.brief, undefined, 'no brief on quick + no-match path');
    assert.equal(
      releaseCalled,
      false,
      'lock must NOT be released early — it stays held until session ends (Stop hook releases)',
    );
  });

  it('QUICK-08: quick + verdict error roadmap-missing → fail-closed, releases lock', async () => {
    // Phase 11 D-13 carry-forward: quick tolerates ONLY no-match. roadmap-missing
    // and multi-match remain data-quality errors that abort with lock release.
    const deps = makeQuickDeps({
      verdict: { action: 'error', code: 'roadmap-missing', detail: 'no .planning/ROADMAP.md' },
    });
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const result = await dispatchTrigger(baseEvent, {}, deps);
    assert.equal(result.action, 'resolver_failed');
    assert.equal(result.code, 'roadmap-missing');
    const { launchCalledWith, releaseCalled } = deps._inspect();
    assert.equal(launchCalledWith, null, 'launch must NOT be invoked on fail-closed verdict');
    assert.equal(releaseCalled, true, 'lock must be released on fail-closed (Phase 11 D-13)');
  });
});

describe('dispatchTrigger — Phase 18 worktree_collision (D-05, D-05b, D-06b)', () => {
  const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function gsdTask() {
    return {
      id: 'task-uuid-WT',
      ref: 'KL-42',
      title: 'Worktree collision test',
      description: '',
      labels: ['kodo', 'kodo:gsd'],
      projectId: 'proj-1',
      projectName: 'Test',
      groups: [],
      url: 'https://example.com/KL-42',
      priority: 'medium',
      state: 'Todo',
    };
  }

  function nonGsdTask() {
    return {
      id: 'task-uuid-WT-2',
      ref: 'KL-42',
      title: 'Worktree collision test (non-GSD)',
      description: '',
      labels: ['kodo'],
      projectId: 'proj-1',
      projectName: 'Test',
      groups: [],
      url: 'https://example.com/KL-42',
      priority: 'medium',
      state: 'Todo',
    };
  }

  function makeFakeProvider(task) {
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

  const baseEvent = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };

  it('Test 1 — worktree_collision shape (GSD): returns {action, code, detail} when path exists', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchCalled = false;
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(gsdTask()),
      launchWorkItemFn: async () => { launchCalled = true; return launchWorkItemResult; },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => ({ acquired: true }),
      releaseGsdLockFn: () => {},
      resolveProjectPathFn: () => '/tmp/test-repo',
      existsSyncFn: () => true,
    });
    assert.equal(result.action, 'worktree_collision');
    assert.equal(result.code, 'worktree_exists');
    assert.ok(result.detail, 'detail must be populated with worktree path');
    assert.match(result.detail, /\/tmp\/test-repo\/\.bg-shell\/[a-f0-9-]+$/);
    assert.equal(launchCalled, false, 'launchWorkItemFn must NOT be invoked on collision');
  });

  it('Test 2 — worktree_collision shape (non-GSD, D-06b): returns same shape, no lock involved', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchCalled = false;
    let lockCalled = false;
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(nonGsdTask()),
      launchWorkItemFn: async () => { launchCalled = true; return launchWorkItemResult; },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => { lockCalled = true; return { acquired: true }; },
      releaseGsdLockFn: () => {},
      resolveProjectPathFn: () => '/tmp/test-repo',
      existsSyncFn: () => true,
    });
    assert.equal(result.action, 'worktree_collision');
    assert.equal(result.code, 'worktree_exists');
    assert.ok(result.detail);
    assert.equal(launchCalled, false);
    assert.equal(lockCalled, false, 'non-GSD must NOT acquire lock');
  });

  it('Test 3 — lock release on collision (GSD): releaseGsdLockFn invoked exactly once before return', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let releaseArgs = null;
    let releaseCount = 0;
    let capturedLockSessionId = null;
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(gsdTask()),
      launchWorkItemFn: async () => launchWorkItemResult,
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: (_path, info) => {
        capturedLockSessionId = info.session_id;
        return { acquired: true };
      },
      releaseGsdLockFn: (path, sid) => {
        releaseCount++;
        releaseArgs = { path, sid };
      },
      resolveProjectPathFn: () => '/tmp/test-repo',
      existsSyncFn: () => true,
    });
    assert.equal(result.action, 'worktree_collision');
    assert.equal(releaseCount, 1, 'release must be called exactly once on collision');
    assert.equal(releaseArgs.path, '/tmp/test-repo', 'release receives projectPath (NOT worktreePath) — WT-03 invariant');
    assert.equal(releaseArgs.sid, capturedLockSessionId, 'release receives the gsdSessionId used to acquire');
    assert.match(releaseArgs.sid, uuidV4Re);
  });

  it('Test 4 — no collision (GSD happy path): threads gsdSessionId to launchWorkItemFn', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchSessionId = null;
    let lockSessionId = null;
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(gsdTask()),
      launchWorkItemFn: async (_ref, opts) => {
        launchSessionId = opts.sessionId;
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: (_path, info) => {
        lockSessionId = info.session_id;
        return { acquired: true };
      },
      releaseGsdLockFn: () => {},
      resolveProjectPathFn: () => '/tmp/test-repo',
      existsSyncFn: () => false,
    });
    assert.equal(result.action, 'launched');
    assert.match(launchSessionId, uuidV4Re);
    assert.equal(launchSessionId, lockSessionId, 'GSD: threaded sessionId must match the lock sessionId');
  });

  it('Test 5 — no collision (non-GSD happy path): threads a freshly-generated sessionId', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchSessionId = null;
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(nonGsdTask()),
      launchWorkItemFn: async (_ref, opts) => {
        launchSessionId = opts.sessionId;
        return launchWorkItemResult;
      },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => ({ acquired: true }),
      releaseGsdLockFn: () => {},
      resolveProjectPathFn: () => '/tmp/test-repo',
      existsSyncFn: () => false,
    });
    assert.equal(result.action, 'launched');
    assert.ok(launchSessionId, 'non-GSD must now thread a sessionId (Phase 18)');
    assert.match(launchSessionId, uuidV4Re);
  });

  it('Test 6 — return type union includes worktree_collision (JSDoc audit)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'src', 'triggers', 'dispatcher.js'), 'utf-8');
    assert.ok(
      /@returns[\s\S]{0,400}worktree_collision/.test(src),
      'dispatchTrigger @returns union must include worktree_collision',
    );
  });

  it('Test 7 — stderr canonical bytes: [kodo:dispatch] worktree_collision — KL-42 blocked by existing worktree at <path>', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const originalLog = console.log;
    const captured = [];
    console.log = (...args) => { captured.push(args.join(' ')); };
    try {
      await dispatchTrigger(baseEvent, {}, {
        getProviderFn: () => makeFakeProvider(gsdTask()),
        launchWorkItemFn: async () => launchWorkItemResult,
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: () => ({ acquired: true }),
        releaseGsdLockFn: () => {},
        resolveProjectPathFn: () => '/tmp/test-repo',
        existsSyncFn: () => true,
      });
    } finally {
      console.log = originalLog;
    }
    const collisionLine = captured.find((l) => l.includes('worktree_collision'));
    assert.ok(collisionLine, 'must emit a worktree_collision stderr line');
    assert.match(
      collisionLine,
      /^\[kodo:dispatch\] worktree_collision — KL-42 blocked by existing worktree at \/tmp\/test-repo\/\.bg-shell\/[a-f0-9-]+$/,
      `canonical stderr shape mismatch — got: ${collisionLine}`,
    );
  });

  it('CR-01: non-GSD stale_relaunch threads dispatchSessionId (NOT gsdSessionId/null)', async () => {
    // Phase 18 review fix CR-01: el bloque stale_relaunch threadeaba
    // gsdSessionId — null en non-GSD — saltándose el collision-check.
    // Tras el fix debe threadear dispatchSessionId (UUID v4 validado por
    // collision-check, no null).
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchSessionId = 'NOT_SET';
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(nonGsdTask()),
      launchWorkItemFn: async (_ref, opts) => {
        launchSessionId = opts.sessionId;
        return launchWorkItemResult;
      },
      // Existing session whose workspace is gone → stale_relaunch path.
      listSessionsFn: () => [
        { task_id: 'task-uuid-WT-2', workspace_ref: 'workspace:gone', status: 'running' },
      ],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => ({ acquired: true }),
      releaseGsdLockFn: () => {},
      resolveProjectPathFn: () => '/tmp/test-repo',
      // existsSync returns false → collision-free → flow continues to stale_relaunch.
      existsSyncFn: () => false,
    });
    assert.equal(result.action, 'stale_relaunch');
    assert.ok(launchSessionId, 'stale_relaunch must thread a sessionId (NOT undefined)');
    assert.notEqual(launchSessionId, null, 'stale_relaunch must NOT thread null gsdSessionId');
    assert.match(
      launchSessionId,
      uuidV4Re,
      'stale_relaunch must thread the dispatchSessionId UUID validated by collision-check',
    );
  });

  it('Test 8 — graceful: when resolveProjectPathFn throws, collision check is skipped (heredado v0.5)', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchCalled = false;
    let existsSyncCalled = false;
    // resolveProjectPath throws → dispatchProjectPath null → skip collision check
    // → flow continues; launchWorkItem will fail later with its own error.
    await assert.rejects(
      () => dispatchTrigger(baseEvent, {}, {
        getProviderFn: () => makeFakeProvider(nonGsdTask()),
        launchWorkItemFn: async () => { launchCalled = true; throw new Error('downstream launch error'); },
        listSessionsFn: () => [],
        listWorkspacesFn: async () => '',
        removeSessionFn: () => {},
        acquireGsdLockFn: () => ({ acquired: true }),
        releaseGsdLockFn: () => {},
        resolveProjectPathFn: () => { throw new Error('no path mapped'); },
        existsSyncFn: () => { existsSyncCalled = true; return true; },
      }),
      /downstream launch error/,
    );
    assert.equal(existsSyncCalled, false, 'existsSyncFn must NOT be called when resolveProjectPath throws');
    assert.equal(launchCalled, true, 'flow must continue to launchWorkItem (which fails with its own error)');
  });
});
