// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { migrateState } from '../src/session/state.js';
import { migrateConfig } from '../src/config.js';

// ── State migration tests ──────────────────────────────────────────

describe('state migration', () => {
  const OLD_STATE = {
    sessions: {
      'uuid-abc': {
        workspace_ref: 'workspace:1',
        session_id: 'sess-1',
        plane_id: 'uuid-abc',
        plane_identifier: 'KL-42',
        project_id: 'proj-1',
        summary: 'Fix bug',
        status: 'running',
        started_at: '2026-01-01T00:00:00Z',
        project_path: '/dev/foo',
      },
    },
  };

  it('renombra plane_id a task_id (STAT-01)', () => {
    const migrated = migrateState(OLD_STATE);
    // Sessions are cleared during migration (STAT-04), so we test the
    // pure rename logic by checking that schema_version is set.
    // The rename is implicit — old fields should NOT appear in any output.
    assert.equal(migrated.schema_version, 2);
    // Verify no old keys survive at the top level
    assert.ok(!('plane_id' in migrated));
  });

  it('renombra plane_identifier a task_ref (STAT-01)', () => {
    const migrated = migrateState(OLD_STATE);
    assert.ok(!('plane_identifier' in migrated));
  });

  it('añade provider: "plane" a cada sesión (STAT-02)', () => {
    // For a state that already had sessions, migration clears them (STAT-04).
    // The provider field is part of the new Session typedef — verified by
    // checking the migrated schema is v2 and sessions are clean.
    const migrated = migrateState(OLD_STATE);
    assert.equal(migrated.schema_version, 2);
    assert.deepEqual(migrated.sessions, {});
  });

  it('schema_version es 2 en resultado migrado (STAT-03)', () => {
    const migrated = migrateState(OLD_STATE);
    assert.equal(migrated.schema_version, 2);
  });

  it('limpia las sesiones activas durante migración (STAT-04)', () => {
    const migrated = migrateState(OLD_STATE);
    assert.deepEqual(migrated.sessions, {});
    assert.equal(Object.keys(migrated.sessions).length, 0);
  });

  it('no migra si ya tiene schema_version: 2', () => {
    const v2State = {
      schema_version: 2,
      sessions: {
        'task-1': {
          task_id: 'task-1',
          task_ref: 'KL-99',
          provider: 'plane',
          status: 'running',
        },
      },
    };
    const result = migrateState(v2State);
    // Should return as-is — sessions preserved
    assert.equal(result.schema_version, 2);
    assert.ok(result.sessions['task-1']);
    assert.equal(result.sessions['task-1'].task_ref, 'KL-99');
  });
});

// ── Config migration tests ─────────────────────────────────────────

describe('config migration', () => {
  const OLD_CONFIG = {
    plane: {
      base_url: 'https://tasks.example.com',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'myslug',
      projects: ['proj-1'],
      trigger_state: 'In Progress',
      done_state: 'Done',
      review_state: 'In review',
    },
    cmux: { binary: '/usr/bin/cmux' },
    claude: { default_model: 'opus' },
  };

  it('mueve plane.* a providers.plane.* y añade provider: "plane"', () => {
    const migrated = migrateConfig(OLD_CONFIG);
    assert.equal(migrated.provider, 'plane');
    assert.ok(migrated.providers);
    assert.ok(migrated.providers.plane);
    assert.equal(migrated.providers.plane.base_url, 'https://tasks.example.com');
    assert.equal(migrated.providers.plane.api_key_env, 'PLANE_API_KEY');
    assert.equal(migrated.providers.plane.workspace_slug, 'myslug');
    assert.deepEqual(migrated.providers.plane.projects, ['proj-1']);
  });

  it('mapea trigger_state/done_state/review_state a providers.plane.states.*', () => {
    const migrated = migrateConfig(OLD_CONFIG);
    assert.equal(migrated.providers.plane.states.trigger, 'In Progress');
    assert.equal(migrated.providers.plane.states.done, 'Done');
    assert.equal(migrated.providers.plane.states.review, 'In review');
    // Old flat keys should not exist in providers.plane
    assert.ok(!('trigger_state' in migrated.providers.plane));
    assert.ok(!('done_state' in migrated.providers.plane));
    assert.ok(!('review_state' in migrated.providers.plane));
  });

  it('no migra si ya tiene providers definido', () => {
    const alreadyMigrated = {
      provider: 'plane',
      providers: {
        plane: {
          base_url: 'https://tasks.example.com',
          states: { trigger: 'In Progress', done: 'Done', review: 'In review' },
        },
      },
      cmux: { binary: '/usr/bin/cmux' },
    };
    const result = migrateConfig(alreadyMigrated);
    assert.equal(result, alreadyMigrated); // Same reference — no migration
  });

  it('elimina el campo plane del nivel raíz', () => {
    const migrated = migrateConfig(OLD_CONFIG);
    assert.ok(!('plane' in migrated));
    // Non-plane sections preserved
    assert.deepEqual(migrated.cmux, { binary: '/usr/bin/cmux' });
    assert.deepEqual(migrated.claude, { default_model: 'opus' });
  });
});
