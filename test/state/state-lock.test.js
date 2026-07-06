// @ts-check
//
// test/state/state-lock.test.js — Phase 70 Plan 01 (D-01/D-03/D-08).
//
// UNIT coverage for the advisory-lock primitive src/session/state-lock.js.
// No child processes here — pure in-process contract checks. HOME-isolated
// (mkdtempSync + dynamic import POST-HOME) so nothing can touch the real
// ~/.kodo; all lock paths live in an isolated tmpdir sandbox.
//
// Contract asserted:
//   (1) acquireLock on a free path → { token } and a lockfile with {pid,acquired_at,token}.
//   (2) a second acquireLock(retries:0) while held by a live owner → null.
//   (3) releaseLock is ownership-checked: wrong token = no-op; right token unlinks.
//   (4) after release the path is free again.
//   (5) a lock whose stored pid is guaranteed-dead is stolen on next acquire.
//   (6) retry-exhaustion (live foreign holder, fresh) → withFileLock returns
//       { ok:false } WITHOUT throwing and emits a warn.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let sandbox;
let origHome;
let acquireLock;
let releaseLock;
let withFileLock;

const DEAD_PID = 2 ** 31 - 1; // guaranteed not to map to a live process

describe('state-lock primitive (D-01/D-03/D-08)', () => {
  before(async () => {
    origHome = process.env.HOME;
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-state-lock-'));
    process.env.HOME = sandbox;
    // Dynamic import POST-HOME (mirror save-state-atomic.test.js). state-lock.js
    // takes explicit paths, but we keep the discipline so no import can leak to
    // the real ~/.kodo through a transitive module.
    const mod = await import('../../src/session/state-lock.js');
    acquireLock = mod.acquireLock;
    releaseLock = mod.releaseLock;
    withFileLock = mod.withFileLock;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  let n = 0;
  /** A fresh lock path per test (no cross-test contamination). */
  function freshLockPath() {
    return join(sandbox, `lock-${n++}.lock`);
  }

  // ------------------------------------------------------------------
  it('acquires a free path and writes {pid,acquired_at,token}', () => {
    const p = freshLockPath();
    const got = acquireLock(p, { retries: 0 });
    assert.ok(got && got.token, 'returns a truthy token');
    assert.ok(existsSync(p), 'lockfile now exists');
    const held = JSON.parse(readFileSync(p, 'utf-8'));
    assert.equal(held.pid, process.pid, 'stores our pid');
    assert.equal(held.token, got.token, 'stores our token');
    assert.ok(Number.isFinite(held.acquired_at), 'stores a numeric acquired_at');
  });

  // ------------------------------------------------------------------
  it('a second acquire(retries:0) while held by a live owner → null', () => {
    const p = freshLockPath();
    const first = acquireLock(p, { retries: 0 });
    assert.ok(first && first.token, 'first acquire wins');
    const second = acquireLock(p, { retries: 0 });
    assert.equal(second, null, 'second is blocked (holder alive + fresh)');
  });

  // ------------------------------------------------------------------
  it('releaseLock is ownership-checked (wrong token = no-op)', () => {
    const p = freshLockPath();
    const got = acquireLock(p, { retries: 0 });
    assert.ok(got && got.token);

    releaseLock(p, 'not-the-owner-token');
    assert.ok(existsSync(p), 'wrong token does not remove the lock');

    releaseLock(p, got.token);
    assert.ok(!existsSync(p), 'owning token removes the lock');
  });

  // ------------------------------------------------------------------
  it('after release the path is free again (re-acquirable)', () => {
    const p = freshLockPath();
    const a = acquireLock(p, { retries: 0 });
    assert.ok(a && a.token);
    releaseLock(p, a.token);
    const b = acquireLock(p, { retries: 0 });
    assert.ok(b && b.token, 're-acquire after release succeeds');
  });

  // ------------------------------------------------------------------
  it('steals a lock whose stored pid is guaranteed-dead', () => {
    const p = freshLockPath();
    writeFileSync(
      p,
      JSON.stringify({ pid: DEAD_PID, acquired_at: Date.now(), token: 'ghost' }),
    );
    const got = acquireLock(p, { retries: 0 });
    assert.ok(got && got.token, 'dead-pid lock is stolen');
    const held = JSON.parse(readFileSync(p, 'utf-8'));
    assert.equal(held.token, got.token, 'lock now holds our token (stolen via tmp+rename)');
  });

  // ------------------------------------------------------------------
  it('steals a lock whose acquired_at exceeds the TTL', () => {
    const p = freshLockPath();
    writeFileSync(
      p,
      JSON.stringify({ pid: process.pid, acquired_at: Date.now() - 60_000, token: 'old' }),
    );
    const got = acquireLock(p, { retries: 0, ttlMs: 10 });
    assert.ok(got && got.token, 'TTL-expired lock is stolen even if pid alive');
  });

  // ------------------------------------------------------------------
  it('retry-exhaustion → withFileLock { ok:false } + warn, never throws', () => {
    const p = freshLockPath();
    // Live foreign holder, fresh acquired_at → never stale within the window.
    writeFileSync(
      p,
      JSON.stringify({ pid: process.pid, acquired_at: Date.now(), token: 'foreign' }),
    );

    const warns = [];
    const logger = { warn: (event, meta) => warns.push({ event, meta }) };

    let threw = false;
    let result;
    try {
      result = withFileLock(p, () => 'SHOULD-NOT-RUN', {
        retries: 1,
        backoffMs: 1,
        ttlMs: 10_000,
        logger,
      });
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'withFileLock never throws on lock timeout');
    assert.equal(result.ok, false, 'returns fail-safe { ok:false }');
    assert.equal(result.reason, 'lock-timeout', 'reason is lock-timeout');
    assert.ok(
      warns.some((w) => w.event === 'lock.timeout'),
      'emits a lock.timeout warn (D-03)',
    );
  });
});
