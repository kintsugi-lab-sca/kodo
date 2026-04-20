// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANAGER_SOURCE_PATH = join(__dirname, '..', 'src', 'session', 'manager.js');

/** @type {import('../src/session/manager.js')['buildSessionFromTask']} */
let buildSessionFromTask;
/** @type {import('../src/session/manager.js')['resolveProjectPath']} */
let resolveProjectPath;
/** @type {import('../src/session/manager.js')['deriveModuleName']} */
let deriveModuleName;
/** @type {import('../src/session/manager.js')['resolveTaskAndLaunchContext']} */
let resolveTaskAndLaunchContext;

/** @returns {import('../src/interface.js').TaskItem} */
function makeTask(overrides = {}) {
  return {
    id: 'uuid-task',
    ref: 'KL-42',
    title: 'Fix login bug',
    description: 'Some markdown description',
    labels: ['kodo', 'kodo:sonnet'],
    projectId: 'proj-uuid',
    projectName: 'Kodo Lab',
    groups: ['auth-module'],
    url: 'https://example.com/KL-42',
    priority: 'medium',
    ...overrides,
  };
}

describe('manager — pure helpers', () => {
  beforeEach(async () => {
    ({
      buildSessionFromTask,
      resolveProjectPath,
      deriveModuleName,
      resolveTaskAndLaunchContext,
    } = await import('../src/session/manager.js'));
  });

  describe('buildSessionFromTask', () => {
    it('saves generic task fields (task_id, task_ref, provider, project_id)', () => {
      const task = makeTask();
      const session = buildSessionFromTask({
        task,
        providerName: 'test',
        projectPath: '/tmp/proj',
        workspaceRef: 'workspace:42',
        sessionId: 'sess-uuid',
      });

      assert.equal(session.task_id, 'uuid-task');
      assert.equal(session.task_ref, 'KL-42');
      assert.equal(session.provider, 'test');
      assert.equal(session.project_id, 'proj-uuid');
      assert.equal(session.summary, 'Fix login bug');
      assert.equal(session.workspace_ref, 'workspace:42');
      assert.equal(session.session_id, 'sess-uuid');
      assert.equal(session.project_path, '/tmp/proj');
      assert.equal(session.status, 'running');
      assert.ok(session.started_at, 'should set started_at');
    });

    it('does not include legacy plane_id / plane_identifier fields', () => {
      const task = makeTask();
      const session = buildSessionFromTask({
        task,
        providerName: 'test',
        projectPath: '/tmp/proj',
        workspaceRef: 'workspace:42',
        sessionId: 'sess-uuid',
      });
      assert.equal(/** @type {any} */ (session).plane_id, undefined);
      assert.equal(/** @type {any} */ (session).plane_identifier, undefined);
    });

    describe('GSD flag propagation (D-12)', () => {
      it('sets gsd: true when flags include gsd', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd'],
        });
        assert.equal(session.gsd, true);
      });

      it('omits gsd field when flags do not include gsd', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['yolo'],
        });
        assert.equal(session.gsd, undefined);
      });

      it('omits gsd field when flags is undefined', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
        });
        assert.equal(session.gsd, undefined);
      });
    });
  });

  describe('resolveProjectPath', () => {
    it('returns path from loadProjects() matching task.projectId', () => {
      const task = makeTask({ projectId: 'proj-uuid' });
      const path = resolveProjectPath(task, { 'proj-uuid': '/tmp/proj' });
      assert.equal(path, '/tmp/proj');
    });

    it('throws with helpful message when no path mapped', () => {
      const task = makeTask({ projectId: 'missing-proj' });
      assert.throws(
        () => resolveProjectPath(task, {}),
        { message: /No local path mapped/ },
      );
    });

    it('resolves module path from object entry', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: ['FVF'] });
      const projects = { 'proj-uuid': { default: '/tmp/proj', modules: { FVF: '/tmp/proj/fvf' } } };
      assert.equal(resolveProjectPath(task, projects), '/tmp/proj/fvf');
    });

    it('falls back to default when module not in map', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: ['unknown-mod'] });
      const projects = { 'proj-uuid': { default: '/tmp/proj', modules: { FVF: '/tmp/proj/fvf' } } };
      assert.equal(resolveProjectPath(task, projects), '/tmp/proj');
    });

    it('falls back to default when task has no module', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: [] });
      const projects = { 'proj-uuid': { default: '/tmp/proj', modules: { FVF: '/tmp/proj/fvf' } } };
      assert.equal(resolveProjectPath(task, projects), '/tmp/proj');
    });

    it('throws when object entry has no default and module not found', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: ['unknown'] });
      const projects = { 'proj-uuid': { modules: { FVF: '/tmp/proj/fvf' } } };
      assert.throws(
        () => resolveProjectPath(task, projects),
        { message: /No path for module/ },
      );
    });
  });

  describe('deriveModuleName', () => {
    it('returns first group when present', () => {
      const task = makeTask({ groups: ['auth-module', 'extras'] });
      assert.equal(deriveModuleName(task), 'auth-module');
    });

    it('returns null when no groups', () => {
      const task = makeTask({ groups: [] });
      assert.equal(deriveModuleName(task), null);
    });
  });

  describe('resolveTaskAndLaunchContext', () => {
    it('calls provider.init() and provider.getTask() with identifier', async () => {
      const calls = { init: 0, getTask: /** @type {string[]} */ ([]) };
      const provider = {
        async init() {
          calls.init++;
        },
        async getTask(ref) {
          calls.getTask.push(ref);
          return makeTask({ ref });
        },
      };

      const result = await resolveTaskAndLaunchContext({
        provider,
        identifier: 'KL-42',
        projects: { 'proj-uuid': '/tmp/proj' },
      });

      assert.equal(calls.init, 1, 'provider.init() must be called');
      assert.deepEqual(calls.getTask, ['KL-42']);
      assert.equal(result.task.ref, 'KL-42');
      assert.equal(result.projectPath, '/tmp/proj');
      assert.equal(result.moduleName, 'auth-module');
    });

    it('parses labels via parseKodoLabels receiving {name} objects', async () => {
      const provider = {
        async init() {},
        async getTask() {
          return makeTask({ labels: ['kodo', 'kodo:sonnet', 'kodo:yolo'] });
        },
      };

      const result = await resolveTaskAndLaunchContext({
        provider,
        identifier: 'KL-42',
        projects: { 'proj-uuid': '/tmp/proj' },
      });

      assert.equal(result.model, 'sonnet', 'model should come from kodo:sonnet label');
      assert.ok(result.flags.includes('yolo'), 'flags should include yolo');
    });

    it('uses task.description directly (no stripHtml)', async () => {
      const provider = {
        async init() {},
        async getTask() {
          return makeTask({ description: 'Plain markdown description' });
        },
      };

      const result = await resolveTaskAndLaunchContext({
        provider,
        identifier: 'KL-42',
        projects: { 'proj-uuid': '/tmp/proj' },
      });
      assert.equal(result.description, 'Plain markdown description');
    });
  });
});

describe('manager.js source hygiene', () => {
  it('does not import PlaneClient', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('PlaneClient'), 'manager.js must not import PlaneClient');
    assert.ok(!source.includes("from '../plane/client.js'"), 'must not import plane/client');
  });

  it('imports getProvider from providers/registry', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /getProvider.*from ['"]\.\.\/providers\/registry\.js['"]/.test(source),
      'manager.js must import getProvider from providers/registry',
    );
  });

  it('does not use legacy plane_id / plane_identifier on sessions', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(!/\bplane_id\b/.test(source), 'plane_id should be replaced with task_id');
    assert.ok(!/\bplane_identifier\b/.test(source), 'plane_identifier should be replaced with task_ref');
  });

  it('does not call stripHtml on task description', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('stripHtml'), 'stripHtml no longer needed — description is Markdown');
  });
});
