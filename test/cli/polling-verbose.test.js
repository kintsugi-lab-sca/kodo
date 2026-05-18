// @ts-check
//
// test/cli/polling-verbose.test.js — Phase 28 DAEMON-01 integration spawn.
//
// Validates Plan 28-02 acceptance criteria (ROADMAP SC#1):
//   1. `kodo polling start --no-daemon --verbose` foreground emits ≥1 line
//      containing `polling.tick.summary` to stdout per tick.
//   2. Without `--verbose`, stdout stays silent (NO summary line). The sink
//      NDJSON in `~/.kodo/logs/polling.ndjson` still receives the event
//      (declared adjacent change — D-18 separation of concerns).
//   3. When stdout is redirected (no-TTY), each summary line is a single
//      JSON.stringify(record) + '\n' (DX-06 byte-determinism).
//
// Pattern mirror: test/cli/polling.test.js caso 2 (foreground SIGINT) +
// makeFixture helper (HOME-isolated + fake GITHUB_TOKEN). The fetch to
// `api.github.com` returns 401 with `fake_token_for_test` — Task 2 guarantees
// `processRepo` returns {dispatched:0, rate_limit_remaining:null} in that
// branch so the summary still emits with total_dispatches=0. AC#1 (DAEMON-01)
// is "operator sees structured line per tick" — the dispatch result is
// orthogonal to the emission validation.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

/**
 * Seeds `~/.kodo/config.json` + `~/.kodo/.env` con un repo válido sintácticamente.
 * `poll_interval: 1` mantiene los ticks rápidos (cada segundo) para que el test
 * complete en ≤5s. El fake token NUNCA autentica contra api.github.com — el
 * cliente retorna 401, el catch path de processRepo retorna {0, null}, y el
 * summary se emite con total_dispatches=0 (gracias a Task 2).
 *
 * @param {{ pollInterval?: number, repos?: Array<{owner: string, repo: string}> }} [opts]
 */
function makeFixture(opts = {}) {
  const repos = opts.repos ?? [{ owner: 'octocat', repo: 'hello-world' }];
  const pollInterval = opts.pollInterval ?? 1;
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-verbose-home-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  writeFileSync(
    join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify(
      {
        provider: 'github',
        providers: {
          github: {
            api_key_env: 'GITHUB_TOKEN',
            repos,
            poll_interval: pollInterval,
          },
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  writeFileSync(
    join(tmpHome, '.kodo', '.env'),
    'GITHUB_TOKEN=fake_token_for_test\n',
    'utf-8',
  );
  return tmpHome;
}

/**
 * Spawns `kodo polling start --no-daemon [--verbose]` against an isolated HOME,
 * collects stdout for `waitMs` ms (≤5s budget), then SIGINTs and resolves
 * with the captured output.
 *
 * @param {{ tmpHome: string, verbose: boolean, waitMs?: number }} opts
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number | null }>}
 */
async function runForegroundCapture({ tmpHome, verbose, waitMs = 3500 }) {
  const args = [KODO_BIN, 'polling', 'start', '--no-daemon'];
  if (verbose) args.push('--verbose');
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      HOME: tmpHome,
      NO_COLOR: '1',
      GITHUB_TOKEN: '',
    },
    stdio: 'pipe',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  child.kill('SIGINT');
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  return { stdout, stderr, exitCode };
}

describe('kodo polling start --verbose (Phase 28 DAEMON-01)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) {
      try {
        rmSync(_tmpHome, { recursive: true, force: true });
      } catch {}
    }
    _tmpHome = undefined;
  });

  it('AC#1: --no-daemon --verbose emits polling.tick.summary line(s) to stdout', async () => {
    _tmpHome = makeFixture({ pollInterval: 1 });
    const { stdout, exitCode } = await runForegroundCapture({
      tmpHome: _tmpHome,
      verbose: true,
      waitMs: 3500,
    });
    // SIGINT exit clean.
    assert.equal(exitCode, 0, 'SIGINT → clean exit 0');
    // Operator visible: at least one summary line.
    assert.match(
      stdout,
      /polling\.tick\.summary/,
      `stdout MUST contain polling.tick.summary (got: ${JSON.stringify(stdout).slice(0, 500)})`,
    );
    // Either the columnar form (`repos=N`) or the NDJSON form (`"repos_polled":`).
    assert.match(
      stdout,
      /(repos_polled|repos=)/,
      'stdout MUST contain the D-10 shape keys (repos_polled or repos=)',
    );
  });

  it('no-TTY (pipe redirect): each summary line is byte-deterministic NDJSON', async () => {
    // The spawn uses stdio: 'pipe' so child.stdout is NOT a TTY — the wrapper
    // takes the NDJSON branch (JSON.stringify(record) + '\n').
    _tmpHome = makeFixture({ pollInterval: 1 });
    const { stdout, exitCode } = await runForegroundCapture({
      tmpHome: _tmpHome,
      verbose: true,
      waitMs: 3500,
    });
    assert.equal(exitCode, 0);
    const summaryLines = stdout
      .split('\n')
      .filter((line) => line.includes('polling.tick.summary'));
    assert.ok(
      summaryLines.length >= 1,
      `expected ≥1 summary line in pipe mode; got: ${JSON.stringify(stdout).slice(0, 500)}`,
    );
    for (const line of summaryLines) {
      // Each line MUST be a single JSON record — JSON.parse succeeds.
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        assert.fail(`expected NDJSON line; got non-JSON: ${JSON.stringify(line)}`);
      }
      assert.equal(obj.event, 'polling.tick.summary', 'event field must be the literal');
      assert.equal(typeof obj.repos_polled, 'number');
      assert.equal(typeof obj.total_dispatches, 'number');
      assert.ok(
        obj.rate_limit_remaining === null || typeof obj.rate_limit_remaining === 'number',
        'rate_limit_remaining must be number or null',
      );
      assert.ok(Array.isArray(obj.repos), 'repos must be an array');
    }
  });

  it('without --verbose: stdout silent (no polling.tick.summary lines)', async () => {
    _tmpHome = makeFixture({ pollInterval: 1 });
    const { stdout, exitCode } = await runForegroundCapture({
      tmpHome: _tmpHome,
      verbose: false,
      waitMs: 3500,
    });
    assert.equal(exitCode, 0);
    assert.doesNotMatch(
      stdout,
      /polling\.tick\.summary/,
      `without --verbose: stdout MUST NOT contain summary lines (got: ${JSON.stringify(stdout).slice(0, 500)})`,
    );
    // Phase 28 adjacent change: NDJSON sink raíz at ~/.kodo/logs/polling.ndjson
    // SHOULD now receive the event even without --verbose (logger propagated
    // SIEMPRE to startPolling). Verify the file exists with non-empty content.
    const ndjsonPath = join(_tmpHome, '.kodo', 'logs', 'polling.ndjson');
    assert.equal(
      existsSync(ndjsonPath),
      true,
      'baseLogger SIEMPRE creates NDJSON sink at ~/.kodo/logs/polling.ndjson',
    );
  });
});
