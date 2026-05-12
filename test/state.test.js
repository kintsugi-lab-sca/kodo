import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { computeWorktreePath } from '../src/session/state.js';

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

describe('computeWorktreePath', () => {
  it('returns the canonical <projectPath>/.bg-shell/<sessionId> shape', () => {
    assert.equal(
      computeWorktreePath('/repo', 'abc-123-uuid'),
      '/repo/.bg-shell/abc-123-uuid',
    );
  });

  it('is deterministic: same inputs produce byte-identical output', () => {
    const a = computeWorktreePath('/repo', 'abc');
    const b = computeWorktreePath('/repo', 'abc');
    assert.equal(a, b);
  });

  it('handles real UUIDs without escaping', () => {
    const id = randomUUID(); // /^[a-f0-9-]+$/i — safe path segment
    const out = computeWorktreePath('/Users/alex/dev/klab/kodo', id);
    assert.equal(out, `/Users/alex/dev/klab/kodo/.bg-shell/${id}`);
    assert.ok(!out.includes('..'), 'no traversal'); // T-18-01 mitigation
  });

  it('does NOT resolve symlinks (no realpathSync)', () => {
    // /tmp en macOS es symlink a /private/tmp. Si el helper hiciera
    // realpathSync, el primer segmento cambiaría a /private/tmp.
    // Verificamos sin filesystem real: el output debe preservar el
    // projectPath literal del input.
    const out = computeWorktreePath('/tmp/foo', 'abc');
    assert.equal(out, '/tmp/foo/.bg-shell/abc');
    assert.ok(!out.startsWith('/private/'), 'must NOT collapse symlink');
  });
});
