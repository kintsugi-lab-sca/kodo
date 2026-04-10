// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOP_SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'stop.js');

/** @type {import('../src/hooks/stop.js')['postClosingActions']} */
let postClosingActions;

/**
 * Build a minimal fake provider whose addComment/updateTaskState record calls.
 * @param {{ failComment?: boolean, failState?: boolean }} [opts]
 */
function createFakeProvider(opts = {}) {
  const calls = {
    addComment: /** @type {Array<{task: any, text: string}>} */ ([]),
    updateTaskState: /** @type {Array<{task: any, state: string}>} */ ([]),
  };
  const provider = {
    async addComment(task, text) {
      calls.addComment.push({ task, text });
      if (opts.failComment) throw new Error('comment failed');
    },
    async updateTaskState(task, state) {
      calls.updateTaskState.push({ task, state });
      if (opts.failState) throw new Error('state failed');
    },
  };
  return { provider, calls };
}

function makeSession(overrides = {}) {
  return {
    workspace_ref: 'workspace:42',
    session_id: 'sess-uuid',
    task_id: 'task-uuid-42',
    task_ref: 'KL-42',
    provider: 'test',
    project_id: 'proj-uuid',
    summary: 'Fix login bug',
    status: /** @type {const} */ ('running'),
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    project_path: '/tmp/proj',
    ...overrides,
  };
}

const MOCK_CONFIG = {
  provider: 'test',
  providers: {
    test: { states: { trigger: 'In Progress', review: 'In Review', done: 'Done' } },
  },
};

describe('stop hook — postClosingActions', () => {
  beforeEach(async () => {
    ({ postClosingActions } = await import('../src/hooks/stop.js'));
  });

  it('calls provider.addComment with Markdown content (no HTML tags)', async () => {
    const { provider, calls } = createFakeProvider();
    const session = makeSession();
    await postClosingActions(session, MOCK_CONFIG, provider, 'line1\nline2');

    assert.equal(calls.addComment.length, 1);
    const { task, text } = calls.addComment[0];
    assert.equal(task.id, 'task-uuid-42');
    assert.equal(task.ref, 'KL-42');
    assert.equal(task.projectId, 'proj-uuid');

    // Markdown format — no HTML tags
    assert.ok(!text.includes('<h3>'), 'should not contain <h3>');
    assert.ok(!text.includes('<pre>'), 'should not contain <pre>');
    assert.ok(!text.includes('<p>'), 'should not contain <p>');
    // Contains Markdown heading and code fence
    assert.ok(text.includes('###'), 'should contain ### heading');
    assert.ok(text.includes('```'), 'should contain code fence');
    assert.ok(text.includes('line1'), 'should contain screen contents');
  });

  it('calls provider.updateTaskState with review state from config', async () => {
    const { provider, calls } = createFakeProvider();
    const session = makeSession();
    await postClosingActions(session, MOCK_CONFIG, provider, '');

    assert.equal(calls.updateTaskState.length, 1);
    assert.equal(calls.updateTaskState[0].state, 'In Review');
    assert.equal(calls.updateTaskState[0].task.id, 'task-uuid-42');
  });

  it('constructs minimal TaskItem from session fields (no extra API call)', async () => {
    const { provider, calls } = createFakeProvider();
    const session = makeSession();
    await postClosingActions(session, MOCK_CONFIG, provider, '');

    const task = calls.addComment[0].task;
    assert.equal(task.id, session.task_id);
    assert.equal(task.ref, session.task_ref);
    assert.equal(task.projectId, session.project_id);
    assert.equal(task.title, session.summary);
    assert.deepEqual(task.labels, []);
    assert.equal(task.description, '');
    assert.equal(task.priority, null);
  });

  it('updateTaskState still executes when addComment throws (independent try-catch)', async () => {
    const { provider, calls } = createFakeProvider({ failComment: true });
    const session = makeSession();
    await postClosingActions(session, MOCK_CONFIG, provider, 'screen');

    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.updateTaskState.length, 1, 'updateTaskState must run after addComment throws');
  });

  it('does not throw when updateTaskState fails (defensive)', async () => {
    const { provider } = createFakeProvider({ failState: true });
    const session = makeSession();
    // Must not reject
    await postClosingActions(session, MOCK_CONFIG, provider, 'screen');
  });

  it('resolves provider-specific state config from session.provider', async () => {
    const { provider, calls } = createFakeProvider();
    const session = makeSession({ provider: 'github' });
    const config = {
      provider: 'test',
      providers: {
        github: { states: { trigger: 'open', review: 'needs-review', done: 'closed' } },
        test: { states: { trigger: 'Todo', review: 'Review', done: 'Done' } },
      },
    };
    await postClosingActions(session, config, provider, '');

    assert.equal(calls.updateTaskState[0].state, 'needs-review');
  });

  it('stop.js source does not import PlaneClient', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('PlaneClient'), 'stop.js must not import PlaneClient');
    assert.ok(!source.includes("from '../plane/client.js'"), 'must not import from plane/client');
  });

  it('stop.js source has no escapeHtml helper', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('escapeHtml'), 'escapeHtml should be removed');
  });
});
