// @ts-check
//
// test/session/reconcile-lock.test.js — Phase 70 Plan 02 (CONC-01, Pitfall 1).
//
// runReconcileTick's save participates in the SAME state lock as the mutators
// (D-04), but MUST NOT hold the lock across the host async I/O (listWorkspaces /
// pgrep). Two proofs:
//
//   (1) LOCK-FREE DURING SNAPSHOT — a host whose listWorkspaces asserts the real
//       state lock file does NOT exist at snapshot time (the lock is only taken
//       after the host poll returns). Snapshot-outside / apply-inside (Pitfall 1).
//
//   (2) LOCK-HELD DURING SAVE — a saveState spy that records whether the lock
//       file exists at the moment of the save; it must be TRUE. And reconcile
//       still transitions a dead session to `idle` (existing state-machine
//       behavior preserved; `alive` stays reconcileTick-only).
//
// The lock is REAL (state.js runUnderStateLock over STATE_LOCK_PATH); HOME is
// isolated so the lock file lands in the sandbox, never the real ~/.kodo. State
// I/O is faked in-memory (loadState/saveState injected) so we observe the real
// lock file lifecycle around a controlled derivation.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let runReconcileTick;
let runUnderStateLock;
let LOCK_PATH;

const NOW = Date.parse('2026-07-06T12:00:00.000Z');

/** Minimal running session (mirror of reconciliation.test.js session()). */
function session(overrides = {}) {
  return {
    workspace_ref: 'workspace:1',
    session_id: 'sess-muerto',
    task_id: 't1',
    task_ref: 'KL-1',
    provider: 'plane',
    project_id: 'p1',
    summary: 's',
    status: 'running',
    started_at: '2026-07-06T10:00:00.000Z',
    project_path: '/dev/kodo',
    state: 'running',
    process_alive: true,
    tab_alive: true,
    needs_input: false,
    last_seen_alive: null,
    ...overrides,
  };
}

describe('runReconcileTick — same lock, never held across host I/O (Pitfall 1)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-reconcile-lock-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME so STATE_PATH/STATE_LOCK_PATH resolve to the sandbox.
    const stateMod = await import('../../src/session/state.js');
    runUnderStateLock = stateMod.runUnderStateLock;
    LOCK_PATH = stateMod.STATE_PATH + '.lock';
    const recMod = await import('../../src/session/reconcile.js');
    runReconcileTick = recMod.runReconcileTick;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('lock is FREE during host snapshot and HELD during the save; dead session → idle', async () => {
    let cur = {
      schema_version: 3,
      sessions: { t1: session() },
      history: [],
    };

    let lockFreeDuringSnapshot = null;
    let lockHeldDuringSave = null;
    let saveCount = 0;

    // Host snapshot runs OUTSIDE the lock → the lock file must not exist yet.
    const host = {
      listWorkspaces: async () => {
        lockFreeDuringSnapshot = !existsSync(LOCK_PATH);
        return [{ workspace_ref: 'workspace:1', alive: true, needs_input: false }];
      },
    };
    // pgrep finds nothing → process dead → process_alive derives to false → idle.
    const pgrep = () => '';
    const loadState = () => cur;
    const saveState = (s) => {
      saveCount++;
      lockHeldDuringSave = existsSync(LOCK_PATH);
      cur = s;
    };

    const debounceStore = new Map();
    // Two ticks: debounce 2-tick then apply the running→idle transition.
    for (let t = 1; t <= 2; t++) {
      await runReconcileTick({
        host,
        loadState,
        saveState,
        withStateLock: runUnderStateLock,
        debounceStore,
        tick: t,
        now: () => NOW,
        pgrep,
      });
    }

    assert.equal(lockFreeDuringSnapshot, true, 'lock file must NOT exist during host snapshot (Pitfall 1)');
    assert.ok(saveCount >= 1, 'the transition must have persisted at least once');
    assert.equal(lockHeldDuringSave, true, 'lock file must exist during the save (save under lock)');

    // State-machine preserved: dead process + live tab → idle, session not lost.
    assert.equal(cur.sessions.t1.state, 'idle', 'dead process + live tab → idle (session preserved)');
    assert.equal(cur.sessions.t1.process_alive, false, 'process_alive derived to false');
    assert.equal(cur.sessions.t1.tab_alive, true, 'tab stays alive');

    // Lock released after the tick — no residue.
    assert.ok(!existsSync(LOCK_PATH), 'lock file released after the tick');
  });

  it('no `await` is held inside the withStateLock callback (source guard)', async () => {
    // Structural guard mirroring the Pitfall-1 acceptance criterion: the
    // runLocked(() => { ... }) callback must be synchronous (no await inside),
    // so the lock is never held across async host I/O.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('../../src/session/reconcile.js', import.meta.url)),
      'utf-8',
    );
    // Extract the runLocked(() => { ... }) block and assert it contains no `await`.
    const start = src.indexOf('runLocked(() => {');
    assert.ok(start !== -1, 'runReconcileTick must apply its save via runLocked(() => { ... })');
    // Find the matching close by scanning to the `});` that ends the callback.
    const tail = src.slice(start);
    const end = tail.indexOf('\n  });');
    assert.ok(end !== -1, 'runLocked callback must be a well-formed block');
    const block = tail.slice(0, end);
    assert.ok(!/\bawait\b/.test(block), 'no `await` may appear inside the withStateLock callback (Pitfall 1)');
  });
});
