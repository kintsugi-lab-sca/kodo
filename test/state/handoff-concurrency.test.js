// @ts-check
//
// test/state/handoff-concurrency.test.js — Phase 74 Plan 05 (LIVE-04, D-08).
//
// The two concurrency guarantees the handoff rests on, proven with REAL child
// PROCESSES. Promises on a single event loop would prove nothing here: the lock
// is advisory and cross-process, so only real processes competing for the same
// files demonstrate the property.
//
//   (1) RACE 1 — LIVE-04 / SC#4: N children each close a DIFFERENT task against
//       ONE isolated state.json, released together via the `go` barrier. Asserts
//       ZERO lost writes: all N entries present in state.tasks. This is the
//       `withStateLock` guarantee (fresh load INSIDE the lock) applied to the new
//       `tasks` key.
//
//   (2) RACE 2 — D-08 / the lost update: N children close the SAME task, so they
//       all read-modify-write the SAME plan file. Asserts every block survives.
//       An atomic temp+rename ALONE does NOT prevent this (both writers read the
//       same bytes, both append their own block, the last rename wins and one
//       block vanishes) — which is the entire reason withFileLock exists.
//
// Assert on the AGGREGATE, never on who wins (analog: state-writers-concurrency
// .test.js:111-131). The property is "zero lost writes" / "all N blocks present",
// not any particular order — an order assert would be flaky by construction.
//
// HOME-isolation: config.js:11 evaluates join(homedir(), '.kodo') at module-load,
// so every child gets an isolated HOME via the spawn env and dynamic-imports
// session-end.js only AFTER that (RESEARCH §Pitfall 6). `hasSessionHandoff` is
// the ONLY static import allowed here: it is a pure leaf with no fs and resolves
// no path at module-load, so it cannot break HOME isolation.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasSessionHandoff } from '../../src/session/handoff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');

const STATE_REL = ['.kodo', 'state.json'];
const PLANS_REL = ['.kodo', 'plans'];

const HEADING_PREFIX = '## Handoff ';

// Each child may wait up to ~160ms per lock (state-lock.js:34-36 → 8 retries ×
// 20ms) and takes two locks (plan + state) → ~320ms, plus node boot per process.
const RACE_TIMEOUT_MS = 30_000;

/** v3-shaped empty state seed (analog: state-writers-concurrency.test.js:47). */
function seedV3() {
  return { schema_version: 3, sessions: {}, history: [] };
}

/** Count handoff blocks in a plan markdown by their heading. */
function countBlocks(md) {
  return md.split('\n').filter((l) => l.startsWith(HEADING_PREFIX)).length;
}

describe('handoff concurrency — real processes (LIVE-04, D-08)', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-handoff-race-'));
    mkdirSync(join(sandbox, '.kodo'), { recursive: true });
    // Seed an EXPLICIT v3 state.json. Without this, loadState():257 returns the
    // v2 shape for a missing file, saveState would write a v2 file WITH `tasks`,
    // and the next loadState would run migrateStateV2toV3 — whose exhaustive
    // rebuild (:139-143) DROPS `tasks`. The test would then fail for a reason it
    // is not measuring (RESEARCH §Pitfall 5). Verified empirically: running the
    // child with no seed writes `"schema_version": 2` with `tasks` alongside.
    writeFileSync(join(sandbox, ...STATE_REL), JSON.stringify(seedV3(), null, 2) + '\n');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /**
   * Spawn `count` handoff children and release them together via the `go`
   * barrier. `taskFor(i)` picks each child's --task, which is what selects the
   * race: distinct → state.json; identical → one plan file.
   *
   * The go-file is written only after every child has actually been spawned (the
   * 'spawn' event), so the children contend instead of politely queueing behind
   * each other's boot. Without a barrier that really forces overlap the test
   * would pass even if the lock did not exist — i.e. it would prove nothing.
   *
   * @param {number} count
   * @param {(i: number) => string} taskFor
   * @returns {Promise<string[]>} each child's stdout verdict
   */
  function raceHandoffs(count, taskFor) {
    const goFile = join(sandbox, 'go');
    const children = [];
    const outputs = new Array(count).fill('');
    const spawned = [];

    for (let i = 0; i < count; i++) {
      const child = spawn(
        process.execPath,
        [
          CHILD,
          '--kind', 'handoff',
          '--idx', String(i),
          '--task', taskFor(i),
          '--barrier', goFile,
        ],
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
      spawned.push(new Promise((resolve) => child.on('spawn', resolve)));
      children.push(child);
    }

    const done = Promise.all(
      children.map((c) => new Promise((resolve) => c.on('close', resolve))),
    );

    // Every child is up and spinning on the barrier — release them all at once.
    return Promise.all(spawned)
      .then(() => {
        writeFileSync(goFile, '1');
        return done;
      })
      .then(() => outputs.map((o) => o.trim()));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RACE 1 — N different tasks → zero lost writes in state.tasks (LIVE-04).
  // ─────────────────────────────────────────────────────────────────────────
  describe('race 1 — N closes of DIFFERENT tasks (LIVE-04, SC#4)', () => {
    const N = 5;

    it('5 children each close a different task → all 5 entries in state.tasks', async () => {
      const verdicts = await raceHandoffs(N, (i) => 'task-' + i);

      assert.equal(
        verdicts.filter((v) => v === 'written').length,
        N,
        `all ${N} children must report written; got: ${verdicts.join(',')}`,
      );

      const finalState = JSON.parse(readFileSync(join(sandbox, ...STATE_REL), 'utf-8'));
      const keys = Object.keys(finalState.tasks || {});
      assert.equal(
        keys.length,
        N,
        `expected ${N} entries in state.tasks, found ${keys.length}: ${keys.join(',')}`,
      );
      for (let i = 0; i < N; i++) {
        assert.ok(
          finalState.tasks['task-' + i],
          `state.tasks['task-${i}'] must survive the race (lost write = clobbered)`,
        );
      }
    });

    it('5 children → 5 plan files, each carrying its handoff block', async () => {
      await raceHandoffs(N, (i) => 'task-' + i);

      for (let i = 0; i < N; i++) {
        const planPath = join(sandbox, ...PLANS_REL, `task-${i}.md`);
        assert.ok(existsSync(planPath), `plan file for task-${i} must exist`);
        const md = readFileSync(planPath, 'utf-8');
        assert.equal(countBlocks(md), 1, `task-${i} must carry exactly one handoff block`);
        assert.ok(
          hasSessionHandoff(md, 'sess-' + i),
          `task-${i}'s block must be attributable to sess-${i}`,
        );
      }
    });

    it('state.json stays schema_version 3 with sessions/history intact', async () => {
      await raceHandoffs(N, (i) => 'task-' + i);

      const finalState = JSON.parse(readFileSync(join(sandbox, ...STATE_REL), 'utf-8'));
      // The additive key does not destroy anything — nor trip the v2 migration.
      assert.equal(finalState.schema_version, 3, 'schema_version must stay 3');
      assert.deepEqual(finalState.sessions, {}, 'sessions must survive untouched');
      assert.deepEqual(finalState.history, [], 'history must survive untouched');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // RACE 2 — N closes of the SAME task → zero lost update (D-08).
  // ─────────────────────────────────────────────────────────────────────────
  describe('race 2 — N closes of the SAME task (D-08, the lost update)', () => {
    const SHARED = 'shared-task';
    const planPath = () => join(sandbox, ...PLANS_REL, `${SHARED}.md`);

    it('2 children write the same plan → BOTH blocks present, zero lost update', async () => {
      const verdicts = await raceHandoffs(2, () => SHARED);

      assert.equal(
        verdicts.filter((v) => v === 'written').length,
        2,
        `both children must report written; got: ${verdicts.join(',')}`,
      );

      const md = readFileSync(planPath(), 'utf-8');
      assert.equal(
        countBlocks(md),
        2,
        'both handoff blocks must survive — one missing = the lost update D-08 exists to prevent',
      );
    });

    it('the two surviving blocks belong to the two DIFFERENT sessions', async () => {
      await raceHandoffs(2, () => SHARED);

      const md = readFileSync(planPath(), 'utf-8');
      assert.ok(hasSessionHandoff(md, 'sess-0'), "sess-0's block must be present");
      assert.ok(hasSessionHandoff(md, 'sess-1'), "sess-1's block must be present");
    });

    it('escalated: 4 children write the same plan → all 4 blocks, all 4 sessions', async () => {
      const N = 4;
      const verdicts = await raceHandoffs(N, () => SHARED);

      assert.equal(
        verdicts.filter((v) => v === 'written').length,
        N,
        `all ${N} children must report written; got: ${verdicts.join(',')}`,
      );

      const md = readFileSync(planPath(), 'utf-8');
      assert.equal(countBlocks(md), N, `all ${N} blocks must survive the race`);
      for (let i = 0; i < N; i++) {
        assert.ok(hasSessionHandoff(md, 'sess-' + i), `sess-${i}'s block must be present`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hygiene — withFileLock's finally releases; the temp+rename leaves nothing.
  // ─────────────────────────────────────────────────────────────────────────
  describe('hygiene — no residue after the races', () => {
    it('leaves no .tmp. and no orphan .lock in the plans dir', async () => {
      await raceHandoffs(4, () => 'shared-task');

      const entries = readdirSync(join(sandbox, ...PLANS_REL));
      assert.deepEqual(
        entries.filter((e) => e.includes('.tmp.')),
        [],
        'no temp file may survive (writeHandoff rms its tmp on failure, renames on success)',
      );
      assert.deepEqual(
        entries.filter((e) => e.endsWith('.lock')),
        [],
        "no orphan lockfile may survive (withFileLock's finally releases)",
      );
    });
  });
});
