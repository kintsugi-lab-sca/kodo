// @ts-check
//
// test/state/state-lock-concurrency.test.js — Phase 70 Plan 01.
//
// INTEGRATION: N real child processes race for ONE state lock path with a
// shared `go` barrier. Each child uses retries:0 (pure contention snapshot),
// so exactly one must print `acquired`. Asserts on the AGGREGATE, never on
// which child wins (non-deterministic). Sandbox per test via mkdtempSync.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');

let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-state-race-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawn N children racing for `lockPath`, release them via the `go` barrier,
 * and resolve with the array of their stdout verdicts.
 * @param {number} count
 * @param {string} lockPath
 * @returns {Promise<string[]>}
 */
function raceStateChildren(count, lockPath) {
  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'state', '--lock', lockPath, '--barrier', goFile],
      { stdio: ['ignore', 'pipe', 'inherit'] },
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

describe('state-lock concurrency — N real processes (Criterion 1 analog)', () => {
  it('8 children racing one lock → exactly one acquired', async () => {
    const lockPath = join(sandbox, 'state.json.lock');
    const verdicts = await raceStateChildren(8, lockPath);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one child must acquire; got verdicts: ${verdicts.join(',')}`,
    );
  });
});
