// @ts-check
//
// test/gsd-lock-guard.test.js — Phase 82 Plan 01.
//
// Targeted unit tests for the steal-guard states of `stealLock`, exercised
// SOLELY through the public API (`acquireGsdLock`) + on-disk seeding. No private
// helpers are imported or exported (D-08): the guard is observed by seeding the
// sibling guard file (`.kodo.lock.steal-guard`) and a stale lock, then asserting
// on the API result and the final on-disk state.
//
// These four cases are DETERMINISTIC by design (single in-process caller against
// seeded files). The concurrent property "two breakers of the SAME orphan guard →
// exactly one ends up owning" (Assumption A1) is NOT covered here — an in-process
// unit test cannot exercise real concurrency without flakiness. That property is
// covered by the real-process race harness (`test/gsd-lock-race.test.js`, CR-01,
// N=5) plus the stress loop of Plan 82-02.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { acquireGsdLock, LOCK_FILE, DEFAULT_TTL_HOURS } from '../src/gsd/lock.js';

const LOCK_BASENAME = '.kodo.lock';
const GUARD_BASENAME = '.kodo.lock.steal-guard';

// Implausibly high PID, matching the dead-PID convention in gsd-lock.test.js:99.
const DEAD_PID = 99999999;

/**
 * @param {Partial<{ session_id: string, task_id: string, task_ref: string }>} [overrides]
 */
function makeSessionInfo(overrides = {}) {
  return {
    session_id: 'sess-guard',
    task_id: 'uuid-guard',
    task_ref: 'KL-82',
    ...overrides,
  };
}

/**
 * Seed a lock file directly on disk (bypassing acquire), mirroring
 * `writeLockDirect` from test/gsd-lock.test.js.
 *
 * @param {string} projectPath
 * @param {object} content
 */
function writeLockDirect(projectPath, content) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, LOCK_BASENAME), JSON.stringify(content, null, 2) + '\n');
}

/**
 * Seed the sibling steal-guard file directly on disk with a chosen owner.
 * Analogous to `writeLockDirect`, targeting `.kodo.lock.steal-guard`.
 *
 * @param {string} projectPath
 * @param {{ pid: number, ts: number }} guard
 */
function writeGuardDirect(projectPath, guard) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, GUARD_BASENAME), JSON.stringify(guard));
}

/** Seed a provably-stale lock owned by a dead PID. */
function writeStaleDeadLock(projectPath) {
  writeLockDirect(projectPath, {
    session_id: 'crashed',
    task_id: 'uuid-crashed',
    task_ref: 'KL-crashed',
    pid: DEAD_PID,
    acquired_at: new Date().toISOString(),
    ttl_hours: DEFAULT_TTL_HOURS,
  });
}

/** List the basenames present in `<projectPath>/.planning`. */
function planningEntries(projectPath) {
  const planning = join(projectPath, '.planning');
  return existsSync(planning) ? readdirSync(planning) : [];
}

describe('gsd lock — steal-guard states (via public API + seeding)', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-lock-guard-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('(a) orphan guard (dead PID) + stale lock → steals; no guard/tmp residue', () => {
    writeGuardDirect(tmpDir, { pid: DEAD_PID, ts: Date.now() });
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-a' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-a');
    assert.equal(lock.pid, process.pid);

    // Orphan guard broken and cleaned; no tmp/steal residue left behind.
    const entries = planningEntries(tmpDir);
    assert.ok(!entries.includes(GUARD_BASENAME), `guard should be gone; got: ${entries}`);
    assert.ok(
      !entries.some((e) => e.includes('.tmp.') || e.includes('.steal.')),
      `no tmp/steal residue; got: ${entries}`,
    );
    // Exactly one lock file.
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
  });

  it('(b) live+fresh guard + stale lock → does not steal past a valid guard', () => {
    // process.pid is guaranteed alive; a fresh ts keeps the guard within any
    // seconds-order threshold → deterministically NOT breakable.
    writeGuardDirect(tmpDir, { pid: process.pid, ts: Date.now() });
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-b' }));

    assert.equal(result.acquired, false);

    // The valid guard is left intact (never broken).
    assert.ok(existsSync(join(tmpDir, '.planning', GUARD_BASENAME)));

    // Lock state stays consistent: exactly one lock file, unchanged owner.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'crashed');
  });

  it('(c) live but very old guard + stale lock → broken by age, steals', () => {
    // pid alive, but ts one hour in the past → well past any seconds-order
    // threshold, agnostic to the exact value the implementer chooses.
    writeGuardDirect(tmpDir, { pid: process.pid, ts: Date.now() - 3600_000 });
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-c' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-c');
    assert.equal(lock.pid, process.pid);

    // Exactly one lock file of the caller; stale guard cleaned up.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.includes(GUARD_BASENAME), `stale guard should be gone; got: ${entries}`);
  });

  it('(d) simulated crash mid-steal (orphan guard + stale lock + residual tmp) → consistent', () => {
    writeGuardDirect(tmpDir, { pid: DEAD_PID, ts: Date.now() });
    writeStaleDeadLock(tmpDir);
    // A residual tmp left by a crashed stealer.
    writeFileSync(
      join(tmpDir, '.planning', `${LOCK_BASENAME}.tmp.${DEAD_PID}.orphan`),
      '{"partial":true}',
    );

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-d' }));

    assert.equal(result.acquired, true);

    // Recovered to a consistent state: exactly one lock file, owned by the caller.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-d');
    assert.equal(lock.pid, process.pid);
  });

  it('(e) present but empty/unparseable RECENT guard + stale lock → NOT broken', () => {
    // Regression for the guard-level briefly-empty window: a guard that fails to
    // parse must NOT be treated as stale merely for being unparseable — a fresh
    // writer mid-publish would be broken, re-opening the double-acquire. A recent
    // unparseable guard (fresh mtime) is respected; it is broken only once it ages.
    const guardPath = join(tmpDir, '.planning', GUARD_BASENAME);
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
    writeFileSync(guardPath, ''); // empty → unparseable; mtime = now (recent)
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-e' }));

    assert.equal(result.acquired, false);

    // The recent unparseable guard is left intact (never broken).
    assert.ok(existsSync(guardPath), 'recent unparseable guard must not be broken');

    // Lock state stays consistent: exactly one lock file, unchanged stale owner.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'crashed');
  });

  it('(f) present but unparseable AGED guard + stale lock → broken by mtime, steals', () => {
    const guardPath = join(tmpDir, '.planning', GUARD_BASENAME);
    mkdirSync(join(tmpDir, '.planning'), { recursive: true });
    writeFileSync(guardPath, '{partial'); // unparseable
    // Backdate mtime one hour → well past any seconds-order threshold.
    const past = new Date(Date.now() - 3600_000);
    utimesSync(guardPath, past, past);
    writeStaleDeadLock(tmpDir);

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-f' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-f');
    assert.equal(lock.pid, process.pid);

    // Aged unparseable guard cleaned up; exactly one lock file of the caller.
    const entries = planningEntries(tmpDir);
    assert.equal(entries.filter((e) => e === LOCK_BASENAME).length, 1);
    assert.ok(!entries.includes(GUARD_BASENAME), `aged guard should be gone; got: ${entries}`);
  });
});
