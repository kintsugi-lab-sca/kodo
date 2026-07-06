// @ts-check
//
// test/dispatcher-dedup-crossproc.test.js — Phase 70 Plan 04 (CONC-08 / D-13).
//
// INTEGRATION: N real child processes call dispatchTrigger for the SAME non-GSD
// task_id against ONE isolated ~/.kodo (HOME=sandbox), released together via a
// `go` barrier. The per-task_id dedup lock (`~/.kodo/locks/dispatch-<id>.lock`,
// reused from the Plan-01 primitive) must let exactly ONE child reach
// launchWorkItem — the others return `already_active` without launching. This is
// the cross-process mirror of the in-process `inFlight` guard (audit M17).
//
// Each winner appends one line to `launches.log`; the aggregate assertion is
// "exactly one launch line" + "exactly one `launched` verdict" — never which
// child wins (non-deterministic).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, 'helpers', 'lock-race-child.mjs');

let sandbox;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-dispatch-race-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawn `count` children, each dispatching the SAME `taskId`, and release them
 * via the `go` barrier. Resolves with the trimmed stdout verdicts.
 * @param {number} count
 * @param {string} taskId
 * @returns {Promise<string[]>}
 */
function raceDispatch(count, taskId) {
  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'dispatch', '--sandbox', sandbox, '--task', taskId, '--hold', '500', '--barrier', goFile],
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

/** Count the real launches recorded by the stubbed launchWorkItemFn. */
function launchCount() {
  const log = join(sandbox, 'launches.log');
  if (!existsSync(log)) return 0;
  return readFileSync(log, 'utf-8').split('\n').filter(Boolean).length;
}

describe('dispatch dedup cross-process — same non-GSD task_id → one launch (CONC-08/D-13)', () => {
  it('2 processes, same task_id → exactly one launch', async () => {
    const verdicts = await raceDispatch(2, 'task-alpha');
    assert.equal(
      launchCount(),
      1,
      `exactly one launch expected; verdicts: ${verdicts.join(',')}`,
    );
    const launched = verdicts.filter((v) => v === 'launched').length;
    const alreadyActive = verdicts.filter((v) => v === 'already_active').length;
    assert.equal(launched, 1, `exactly one 'launched'; got: ${verdicts.join(',')}`);
    assert.equal(alreadyActive, 1, `the loser must be 'already_active'; got: ${verdicts.join(',')}`);
  });

  it('5 processes, same task_id → exactly one launch', async () => {
    const verdicts = await raceDispatch(5, 'task-beta');
    assert.equal(
      launchCount(),
      1,
      `exactly one launch expected; verdicts: ${verdicts.join(',')}`,
    );
    const launched = verdicts.filter((v) => v === 'launched').length;
    assert.equal(launched, 1, `exactly one 'launched'; got: ${verdicts.join(',')}`);
    for (const v of verdicts) {
      assert.ok(
        ['launched', 'already_active'].includes(v),
        `unexpected verdict '${v}'`,
      );
    }
  });
});
