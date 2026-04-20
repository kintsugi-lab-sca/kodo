// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  acquireGsdLock,
  releaseGsdLock,
  readLock,
  isPidAlive,
  LOCK_FILE,
  DEFAULT_TTL_HOURS,
} from '../src/gsd/lock.js';

/**
 * @param {Partial<{ session_id: string, task_id: string, task_ref: string }>} [overrides]
 */
function makeSessionInfo(overrides = {}) {
  return {
    session_id: 'sess-abc',
    task_id: 'uuid-123',
    task_ref: 'KL-42',
    ...overrides,
  };
}

/**
 * Write a lock file with custom content directly (bypassing acquire) so tests
 * can simulate stale/concurrent/corrupt scenarios.
 *
 * @param {string} projectPath
 * @param {object} content
 */
function writeLockDirect(projectPath, content) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, '.kodo.lock'), JSON.stringify(content, null, 2) + '\n');
}

describe('gsd lock — acquireGsdLock', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates lock file when none exists', () => {
    const result = acquireGsdLock(tmpDir, makeSessionInfo());

    assert.equal(result.acquired, true);

    const lockPath = join(tmpDir, LOCK_FILE);
    assert.equal(existsSync(lockPath), true);

    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    assert.equal(lock.session_id, 'sess-abc');
    assert.equal(lock.task_id, 'uuid-123');
    assert.equal(lock.task_ref, 'KL-42');
    assert.equal(lock.pid, process.pid);
    assert.equal(typeof lock.acquired_at, 'string');
    assert.match(lock.acquired_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(lock.ttl_hours, DEFAULT_TTL_HOURS);
  });

  it('rejects acquire when holder PID is alive and TTL is valid', () => {
    writeLockDirect(tmpDir, {
      session_id: 'sess-original',
      task_id: 'uuid-original',
      task_ref: 'KL-1',
      pid: process.pid, // current process — guaranteed alive
      acquired_at: new Date().toISOString(),
      ttl_hours: DEFAULT_TTL_HOURS,
    });

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-other' }));

    assert.equal(result.acquired, false);
    if (result.acquired === false) {
      assert.equal(result.holder.session_id, 'sess-original');
      assert.equal(result.holder.task_ref, 'KL-1');
    }
  });

  it('steals lock when holder PID is dead', () => {
    writeLockDirect(tmpDir, {
      session_id: 'sess-dead',
      task_id: 'uuid-dead',
      task_ref: 'KL-99',
      pid: 99999999, // implausibly high — assume not assigned
      acquired_at: new Date().toISOString(),
      ttl_hours: DEFAULT_TTL_HOURS,
    });

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-new' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-new');
    assert.equal(lock.pid, process.pid);
  });

  it('steals lock when TTL has expired (PID alive)', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600_000).toISOString();
    writeLockDirect(tmpDir, {
      session_id: 'sess-stale',
      task_id: 'uuid-stale',
      task_ref: 'KL-OLD',
      pid: process.pid, // alive, but TTL exceeded
      acquired_at: fiveHoursAgo,
      ttl_hours: 4,
    });

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-fresh' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-fresh');
  });

  it('steals lock when file contains corrupt JSON', () => {
    const planning = join(tmpDir, '.planning');
    mkdirSync(planning, { recursive: true });
    writeFileSync(join(planning, '.kodo.lock'), '{not valid json');

    const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-recover' }));

    assert.equal(result.acquired, true);

    const lock = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(lock.session_id, 'sess-recover');
  });

  it('creates .planning/ directory if absent', () => {
    // tmpDir intentionally has no .planning subdir
    assert.equal(existsSync(join(tmpDir, '.planning')), false);

    const result = acquireGsdLock(tmpDir, makeSessionInfo());

    assert.equal(result.acquired, true);
    assert.equal(existsSync(join(tmpDir, '.planning')), true);
    assert.equal(existsSync(join(tmpDir, LOCK_FILE)), true);
  });
});

describe('gsd lock — releaseGsdLock', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes lock when session_id matches', () => {
    writeLockDirect(tmpDir, {
      session_id: 'sess-mine',
      task_id: 'uuid-1',
      task_ref: 'KL-1',
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      ttl_hours: DEFAULT_TTL_HOURS,
    });
    assert.equal(existsSync(join(tmpDir, LOCK_FILE)), true);

    releaseGsdLock(tmpDir, 'sess-mine');

    assert.equal(existsSync(join(tmpDir, LOCK_FILE)), false);
  });

  it('keeps lock when session_id does not match (another session owns it)', () => {
    const original = {
      session_id: 'sess-original',
      task_id: 'uuid-1',
      task_ref: 'KL-1',
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      ttl_hours: DEFAULT_TTL_HOURS,
    };
    writeLockDirect(tmpDir, original);

    releaseGsdLock(tmpDir, 'sess-other');

    assert.equal(existsSync(join(tmpDir, LOCK_FILE)), true);
    const after = JSON.parse(readFileSync(join(tmpDir, LOCK_FILE), 'utf-8'));
    assert.equal(after.session_id, 'sess-original');
  });

  it('is a no-op when lock file is absent', () => {
    assert.equal(existsSync(join(tmpDir, LOCK_FILE)), false);

    // Should not throw.
    assert.doesNotThrow(() => releaseGsdLock(tmpDir, 'sess-anything'));
  });

  it('removes corrupt lock file regardless of session_id', () => {
    const planning = join(tmpDir, '.planning');
    mkdirSync(planning, { recursive: true });
    writeFileSync(join(planning, '.kodo.lock'), 'totally invalid');

    releaseGsdLock(tmpDir, 'sess-anything');

    assert.equal(existsSync(join(tmpDir, LOCK_FILE)), false);
  });
});

describe('gsd lock — readLock', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kodo-lock-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no lock file exists', () => {
    const result = readLock(tmpDir);
    assert.equal(result, null);
  });

  it('returns parsed content when lock exists', () => {
    const content = {
      session_id: 'sess-read',
      task_id: 'uuid-read',
      task_ref: 'KL-7',
      pid: 12345,
      acquired_at: '2026-04-20T10:00:00.000Z',
      ttl_hours: 4,
    };
    writeLockDirect(tmpDir, content);

    const result = readLock(tmpDir);
    assert.deepEqual(result, content);
  });

  it('returns null when lock file is corrupt', () => {
    const planning = join(tmpDir, '.planning');
    mkdirSync(planning, { recursive: true });
    writeFileSync(join(planning, '.kodo.lock'), '{broken');

    const result = readLock(tmpDir);
    assert.equal(result, null);
  });
});

describe('gsd lock — isPidAlive', () => {
  it('returns true for the current process PID', () => {
    assert.equal(isPidAlive(process.pid), true);
  });

  it('returns false for an implausibly high PID (no such process)', () => {
    assert.equal(isPidAlive(99999999), false);
  });
});
