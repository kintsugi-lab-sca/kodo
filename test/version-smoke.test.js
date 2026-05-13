import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

// Read the canonical version from package.json so this test stays in sync
// if/when version bumps.
const PKG_VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')).version;

describe('Phase 14 SC#4: kodo --version smoke (post picocolors install)', () => {
  it('node bin/kodo --version exits 0, prints version, no stderr', () => {
    const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {
      cwd: REPO,
      encoding: 'utf-8',
      timeout: 10_000, // WR-01 Phase 14 — fail-fast si el bin cuelga (CI hygiene)
      // No env override — we want to test the install in its real shape.
    });
    assert.equal(
      result.status,
      0,
      `kodo --version exited with status ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
    assert.equal(
      result.stdout.trim(),
      PKG_VERSION,
      `kodo --version stdout was ${JSON.stringify(result.stdout.trim())}, expected ${JSON.stringify(PKG_VERSION)}`,
    );
    assert.equal(
      result.stderr.trim(),
      '',
      `kodo --version emitted unexpected stderr (Phase 14 picocolors install must not warn):\n${result.stderr}`,
    );
  });
});
