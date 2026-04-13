import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `kodo-test-${Date.now()}`);
const TEST_STATE = join(TEST_DIR, 'state.json');

const readState = () => JSON.parse(readFileSync(TEST_STATE, 'utf-8'));
const writeState = (state) => writeFileSync(TEST_STATE, JSON.stringify(state));

describe('state store', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeState({ sessions: {} });
  });

  it('reads empty state', () => {
    const state = readState();
    assert.deepEqual(state.sessions, {});
  });

  it('adds and retrieves session', () => {
    const session = {
      workspace_ref: 'workspace:1',
      session_id: 'test-uuid',
      plane_id: 'plane-123',
      task_ref: 'KL-42',
      project_id: 'proj-1',
      summary: 'Test task',
      status: 'running',
      started_at: new Date().toISOString(),
      project_path: '/tmp/test',
    };

    const state = readState();
    state.sessions['plane-123'] = session;
    writeState(state);

    const loaded = readState();
    assert.equal(loaded.sessions['plane-123'].task_ref, 'KL-42');
    assert.equal(loaded.sessions['plane-123'].status, 'running');
  });

  it('removes session', () => {
    writeState({
      sessions: {
        'plane-123': { task_ref: 'KL-42', status: 'running' },
        'plane-456': { task_ref: 'KL-55', status: 'running' },
      },
    });

    const state = readState();
    delete state.sessions['plane-123'];
    writeState(state);

    const loaded = readState();
    assert.equal(Object.keys(loaded.sessions).length, 1);
    assert.equal(loaded.sessions['plane-456'].task_ref, 'KL-55');
  });

  it('finds session by field', () => {
    writeState({
      sessions: {
        'p1': { task_ref: 'KL-42', project_path: '/dev/foo', workspace_ref: 'workspace:1' },
        'p2': { task_ref: 'KL-55', project_path: '/dev/bar', workspace_ref: 'workspace:2' },
      },
    });

    const state = readState();
    const found = Object.entries(state.sessions).find(
      ([, s]) => s.project_path === '/dev/bar'
    );
    assert.ok(found);
    assert.equal(found[1].task_ref, 'KL-55');
  });

  // Cleanup
  it('cleanup', () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });
});
