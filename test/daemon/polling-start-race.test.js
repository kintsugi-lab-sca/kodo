// @ts-check
//
// test/daemon/polling-start-race.test.js — Phase 70 Plan 04 (CONC-06 / D-12).
//
// INTEGRATION: N real child processes race `startDaemon('kodo', ...)` against
// the SAME isolated ~/.kodo (HOME=sandbox), released together via a `go`
// barrier. The O_EXCL start-lock (state-lock.js, reused from Plan 01) must let
// exactly ONE child perform the detached spawn — the others see the start-lock
// held (`already_starting`) or acquire it after release and find the daemon
// already running (`already_running`). Either way: exactly ONE spawn.
//
// Each child injects a `_spawn` that appends one line to `spawns.log` and writes
// a live PID file, so the aggregate assertion is "exactly one spawn line" +
// "exactly one `started` verdict" — never which child wins (non-deterministic).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');

let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-polling-race-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawn `count` children, each running startDaemon against HOME=sandbox, and
 * release them via the `go` barrier. Resolves with the trimmed stdout verdicts.
 * @param {number} count
 * @returns {Promise<string[]>}
 */
function racePollingStarts(count) {
  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'polling', '--sandbox', sandbox, '--barrier', goFile],
      { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HOME: sandbox } },
    );
    child.stdout.on('data', (d) => {
      outputs[i] += d.toString();
    });
    children.push(child);
  }

  const done = Promise.all(
    children.map((c) => new Promise((resolve) => c.on('close', resolve))),
  );

  // All children are spawned and waiting on the barrier — release them together.
  writeFileSync(goFile, '1');

  return done.then(() => outputs.map((o) => o.trim()));
}

/** Count the real spawn decisions recorded by the injected `_spawn`. */
function spawnCount() {
  const log = join(sandbox, 'spawns.log');
  if (!existsSync(log)) return 0;
  return readFileSync(log, 'utf-8').split('\n').filter(Boolean).length;
}

describe('polling start race — N real processes → exactly one daemon (CONC-06/D-12)', () => {
  it('2 concurrent starts → exactly one spawn', async () => {
    const verdicts = await racePollingStarts(2);
    assert.equal(
      spawnCount(),
      1,
      `exactly one child must spawn the daemon; verdicts: ${verdicts.join(',')}`,
    );
    const started = verdicts.filter((v) => v === 'started').length;
    assert.equal(started, 1, `exactly one 'started' verdict; got: ${verdicts.join(',')}`);
    // The loser is a clean success — already_starting (blocked) or already_running.
    for (const v of verdicts) {
      assert.ok(
        ['started', 'already_starting', 'already_running'].includes(v),
        `unexpected verdict '${v}'`,
      );
    }
  });

  it('5 concurrent starts → exactly one spawn', async () => {
    const verdicts = await racePollingStarts(5);
    assert.equal(
      spawnCount(),
      1,
      `exactly one child must spawn the daemon; verdicts: ${verdicts.join(',')}`,
    );
    const started = verdicts.filter((v) => v === 'started').length;
    assert.equal(started, 1, `exactly one 'started' verdict; got: ${verdicts.join(',')}`);
  });
});
