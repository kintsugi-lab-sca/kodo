// @ts-check
//
// test/state/state-writers-concurrency.test.js — Phase 70 Plan 02 (CONC-01, D-02).
//
// Two guarantees for `withStateLock`:
//
//   (1) INTEGRATION — N real child processes each addSession a DIFFERENT task
//       against ONE isolated state.json, released together via a `go` barrier.
//       Asserts ZERO lost writes: the final state contains all N sessions. This
//       is RED before Task 2 (mutators load→mutate→save OUTSIDE any lock, so
//       concurrent writers clobber each other — last-write-wins) and GREEN once
//       every mutator funnels through withStateLock (re-read fresh under the
//       O_EXCL lock before mutate+save).
//
//   (2) UNIT — withStateLock re-reads state FRESH inside the acquired lock
//       (not before): the callback receives on-disk content written after the
//       call site was set up, and the lock file exists on disk during the
//       callback and is gone after. Proves the anti-clobber load-under-lock
//       ordering (D-02).
//
// HOME-isolation: state.js computes KODO_DIR (via config.js) from homedir() at
// module-load. Child writers get an isolated HOME via the spawn env (so their
// KODO_DIR resolves to the sandbox); the in-process unit test sets HOME BEFORE a
// dynamic import. NEVER a static import of state.js (would leak to the real
// ~/.kodo). Scaffold mirrors save-state-atomic.test.js + state-lock-concurrency.test.js.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');

const STATE_REL = ['.kodo', 'state.json'];

/** v3-shaped empty state seed. */
function seedV3() {
  return { schema_version: 3, sessions: {}, history: [] };
}

// ───────────────────────────────────────────────────────────────────────────
// (1) INTEGRATION — N real writer processes, zero lost writes.
// ───────────────────────────────────────────────────────────────────────────
describe('state writers concurrency — N real processes (CONC-01, D-02)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-writers-race-'));
    mkdirSync(join(sandbox, '.kodo'), { recursive: true });
    // Seed an EMPTY v3 state.json in the isolated ~/.kodo.
    writeFileSync(join(sandbox, ...STATE_REL), JSON.stringify(seedV3(), null, 2) + '\n');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /**
   * Spawn N writer children (each adding task-<i>), release them via the `go`
   * barrier, and resolve with the array of their stdout verdicts.
   * @param {number} count
   * @returns {Promise<string[]>}
   */
  function raceWriters(count) {
    const goFile = join(sandbox, 'go');
    const children = [];
    const outputs = new Array(count).fill('');

    for (let i = 0; i < count; i++) {
      const child = spawn(
        process.execPath,
        [CHILD, '--kind', 'writer', '--idx', String(i), '--barrier', goFile],
        {
          stdio: ['ignore', 'pipe', 'inherit'],
          // Isolated HOME so the child's KODO_DIR resolves to the sandbox —
          // NEVER the real ~/.kodo.
          env: { ...process.env, HOME: sandbox },
        },
      );
      child.stdout.on('data', (d) => {
        outputs[i] += d.toString();
      });
      children.push(child);
    }

    const done = Promise.all(
      children.map((c) => new Promise((resolve) => c.on('close', resolve))),
    );

    // All children spawned and waiting on the barrier — release them together.
    writeFileSync(goFile, '1');

    return done.then(() => outputs.map((o) => o.trim()));
  }

  it('10 writers each add a different session → zero lost writes', async () => {
    const N = 10;
    const verdicts = await raceWriters(N);

    // Every writer reported success.
    assert.equal(
      verdicts.filter((v) => v === 'written').length,
      N,
      `all ${N} writers must report written; got: ${verdicts.join(',')}`,
    );

    // The final state must contain ALL N sessions — no writer's addSession was
    // clobbered by a concurrent load→mutate→save.
    const finalState = JSON.parse(readFileSync(join(sandbox, ...STATE_REL), 'utf-8'));
    const keys = Object.keys(finalState.sessions);
    assert.equal(
      keys.length,
      N,
      `expected ${N} sessions, found ${keys.length}: ${keys.join(',')}`,
    );
    for (let i = 0; i < N; i++) {
      assert.ok(
        finalState.sessions['task-' + i],
        `session task-${i} must survive the race (lost write = clobbered)`,
      );
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (2) UNIT — withStateLock re-reads fresh state UNDER the lock (D-02).
// ───────────────────────────────────────────────────────────────────────────
describe('withStateLock re-reads fresh state under the lock (D-02)', () => {
  let tmpHome;
  let origHome;
  let withStateLock;
  let STATE_PATH;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-withlock-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME so STATE_PATH resolves to the isolated tmpdir.
    const mod = await import('../../src/session/state.js');
    withStateLock = mod.withStateLock;
    STATE_PATH = mod.STATE_PATH;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('callback receives freshly-loaded on-disk state, with the lock held', () => {
    const lockPath = STATE_PATH + '.lock';
    // Write a state.json with a `seed` session DIRECTLY to disk — withStateLock
    // must re-read THIS content inside the lock (proving it does not use a stale
    // pre-lock snapshot).
    const seeded = seedV3();
    seeded.sessions.seed = { session_id: 'seed', status: 'running' };
    writeFileSync(STATE_PATH, JSON.stringify(seeded, null, 2) + '\n');

    let sawSeedUnderLock = false;
    let lockHeldDuringCallback = false;

    const result = withStateLock((state) => {
      // Fresh read: the seeded session (written to disk above) is visible.
      sawSeedUnderLock = !!state.sessions.seed;
      // Under lock: the O_EXCL lock file exists on disk during the callback.
      lockHeldDuringCallback = existsSyncSafe(lockPath);
      state.sessions.added = { session_id: 'added', status: 'running' };
    });

    assert.equal(result.ok, true, 'withStateLock should succeed');
    assert.ok(sawSeedUnderLock, 'callback must see the freshly-loaded seed session (read under lock)');
    assert.ok(lockHeldDuringCallback, 'lock file must exist on disk during the callback');

    // Released after: lock file gone, and the mutation persisted alongside seed.
    assert.ok(!existsSyncSafe(lockPath), 'lock file must be released after withStateLock');
    const onDisk = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    assert.ok(onDisk.sessions.seed, 'seed session preserved');
    assert.ok(onDisk.sessions.added, 'mutation persisted');
  });
});

/** existsSync without importing at top (kept local to the unit block). */
function existsSyncSafe(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
