// @ts-check
//
// test/gsd-lock-race.test.js — Phase 70 Plan 01, THE Criterion 1 headline.
//
// INTEGRATION: two (and five) real child processes race acquireGsdLock against
// the SAME repo with a shared `go` barrier. Exactly one must print `acquired` —
// the audit's literal success criterion for the atomic (flag:'wx') create path.
// Asserts on the AGGREGATE, never on which child wins. Sandbox per test.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, 'helpers', 'lock-race-child.mjs');

let sandbox;
let repoDir;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-gsd-race-'));
  repoDir = join(sandbox, 'repo');
  // A bare repo dir is enough — acquireGsdLock creates .planning/ itself.
  writeFileSync(join(sandbox, '.keep'), '');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Spawn N children racing acquireGsdLock for `repoDir`, release via `go`,
 * resolve with stdout verdicts.
 * @param {number} count
 * @returns {Promise<string[]>}
 */
function raceGsdChildren(count) {
  mkdirSync(repoDir, { recursive: true });
  const goFile = join(sandbox, 'go');
  const children = [];
  const outputs = new Array(count).fill('');

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'gsd', '--repo', repoDir, '--barrier', goFile],
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
  writeFileSync(goFile, '1');
  return done.then(() => outputs.map((o) => o.trim()));
}

describe('gsd lock race — real processes (Criterion 1)', () => {
  it('2 concurrent processes → exactly one acquired', async () => {
    const verdicts = await raceGsdChildren(2);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one process must acquire; got: ${verdicts.join(',')}`,
    );
  });

  it('5 concurrent processes → exactly one acquired', async () => {
    const verdicts = await raceGsdChildren(5);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(
      acquired,
      1,
      `exactly one process must acquire; got: ${verdicts.join(',')}`,
    );
  });
});
