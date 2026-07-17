// @ts-check
//
// test/server/status-pending.test.js — Phase 76 Plan 02 (ORCH-05 / ORCH-06).
//
// Contract test for the /status pending seam. It exercises the resolver→payload
// boundary WITHOUT booting the HTTP server — the same reason provider-state was
// extracted (the /status handler has no test harness). It asserts:
//   1. buildPendingStatusFields shapes both freshness branches (Pitfall 4: pending_count
//      always === pending.length; both fields ALWAYS present, fresh and stale).
//   2. A source-guard of convergence (D-09): server.js consumes the shared module
//      (imports from ./tasks/pending.js, calls pendingResolver.resolve() and
//      buildPendingStatusFields(...)) instead of re-implementing fetch/freshness inline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildPendingStatusFields } from '../../src/tasks/pending.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SOURCE_PATH = join(__dirname, '..', '..', 'src', 'server.js');

describe('Phase 76 Plan 02: /status pending contract (buildPendingStatusFields seam)', () => {
  it('fresh branch: maps tasks, both fields present, pending_count === pending.length', () => {
    const fields = buildPendingStatusFields({
      tasks: [{ ref: 'KL-1', title: 't', url: 'u', state: 's', projectName: 'p' }],
      fetched_at: '2026-07-17T00:00:00.000Z',
      stale: false,
    });

    assert.equal(fields.pending_stale, false);
    assert.equal(fields.pending_fetched_at, '2026-07-17T00:00:00.000Z');
    assert.equal(fields.pending_count, 1);
    assert.equal(fields.pending.length, 1);
    assert.equal(fields.pending_count, fields.pending.length, 'pending_count must equal pending.length (Pitfall 4)');
    // Task shape preserved verbatim (Assumption A1).
    assert.deepEqual(fields.pending[0], { ref: 'KL-1', title: 't', url: 'u', state: 's', projectName: 'p' });
  });

  it('stale/cold branch: empty tasks → stale:true, fetched_at:null, count 0, count === length', () => {
    const fields = buildPendingStatusFields({ tasks: [], fetched_at: null, stale: true });

    assert.equal(fields.pending_stale, true);
    assert.equal(fields.pending_fetched_at, null);
    assert.equal(fields.pending_count, 0);
    assert.equal(fields.pending.length, 0);
    assert.equal(fields.pending_count, fields.pending.length, 'pending_count must equal pending.length (Pitfall 4)');
  });

  it('both freshness fields are ALWAYS present in the payload (fresh and stale)', () => {
    const fresh = buildPendingStatusFields({ tasks: [], fetched_at: '2026-07-17T00:00:00.000Z', stale: false });
    const stale = buildPendingStatusFields({ tasks: [], fetched_at: null, stale: true });

    assert.ok('pending_stale' in fresh, 'pending_stale must be present on fresh branch');
    assert.ok('pending_fetched_at' in fresh, 'pending_fetched_at must be present on fresh branch');
    assert.ok('pending_stale' in stale, 'pending_stale must be present on stale branch');
    assert.ok('pending_fetched_at' in stale, 'pending_fetched_at must be present on stale branch');
  });
});

describe('Phase 76 Plan 02: /status convergence source-guard (D-09)', () => {
  it('server.js imports createPendingResolver/buildPendingStatusFields from ./tasks/pending.js', () => {
    const source = readFileSync(SERVER_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /from ['"]\.\/tasks\/pending\.js['"]/,
      'server.js must import from ./tasks/pending.js (convergence, not inline logic)',
    );
    assert.match(source, /createPendingResolver/, 'server.js must reference createPendingResolver');
    assert.match(source, /buildPendingStatusFields/, 'server.js must reference buildPendingStatusFields');
  });

  it('server.js consumes the resolver: calls pendingResolver.resolve() and buildPendingStatusFields(', () => {
    const source = readFileSync(SERVER_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /pendingResolver\.resolve\(\)/,
      'server.js must call pendingResolver.resolve() (converged fetch path, not inline cache)',
    );
    assert.match(
      source,
      /buildPendingStatusFields\(/,
      'server.js must call buildPendingStatusFields(...) to shape the payload',
    );
  });

  it('server.js no longer declares a module-level pendingCache (inline lane removed, D-09)', () => {
    const source = readFileSync(SERVER_SOURCE_PATH, 'utf-8');
    assert.doesNotMatch(
      source,
      /let\s+pendingCache\s*=/,
      'server.js must NOT keep the module-level pendingCache — the cache lives in the resolver closure',
    );
  });
});
