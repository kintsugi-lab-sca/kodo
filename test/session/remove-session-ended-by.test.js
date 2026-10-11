// @ts-check
//
// test/session/remove-session-ended-by.test.js — KODO-103.
//
// `removeSession(taskId, logger, { endedBy })` marca la entrada de history como cierre
// deliberado (`ended_by`), que es lo que `reconcileTick` mira para NO rescatarla mientras
// el workspace de cmux siga abierto. Sin `endedBy` la entrada queda como antes.
//
// HOME-isolation: `src/session/state.js` fija KODO_DIR en module-load → dynamic import
// DESPUÉS de fijar HOME (mismo scaffold que test/session/find-session.test.js).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let addSession;
let removeSession;
let statePath;

describe('removeSession — marca ended_by (KODO-103)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-ended-by-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    statePath = join(tmpHome, '.kodo', 'state.json');
    const stateMod = await import('../../src/session/state.js');
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    writeFileSync(statePath, JSON.stringify({ schema_version: 3, sessions: {}, history: [] }) + '\n');
  });

  const session = (taskId) => ({
    session_id: `sess-${taskId}`,
    task_id: taskId,
    task_ref: 'KODO-103',
    status: 'idle',
    workspace_ref: 'workspace:1',
    project_path: '/dev/kodo',
  });
  const history = () => JSON.parse(readFileSync(statePath, 'utf-8')).history;

  it('con endedBy → la entrada de history lleva ended_by', () => {
    addSession('t1', session('t1'));
    const r = removeSession('t1', undefined, { endedBy: 'session-end' });
    assert.equal(r.ok, true);
    assert.equal(history()[0].ended_by, 'session-end');
    assert.ok(history()[0].ended_at);
  });

  it('sin endedBy → la entrada no lleva ended_by (sigue siendo rescatable)', () => {
    addSession('t2', session('t2'));
    removeSession('t2');
    assert.equal('ended_by' in history()[0], false);
  });
});
