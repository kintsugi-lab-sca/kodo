// @ts-check
//
// test/cli/polling.test.js — Phase 26 polling CLI tests.
//
// Plan 26-01 (Wave 0): unit fixtures para parseGitHubRemote / detectOriginRepo.
// Plan 26-02 (Wave 2): integration spawnSync + handler-level Windows test para
//   runPollingStartCli / runPollingStopCli / runPollingStatusCli (CFG-03 / D-09..15).
//
// Patrón mirror test/skill-sync.test.js:18-79 (spawnSync HOME-isolated + NO_COLOR=1
// + timeout 10s) + test/skill-sync.test.js:346-353 (--json byte-determinism regex).
//

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, chmodSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGitHubRemote, detectOriginRepo } from '../../src/cli/polling.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

describe('parseGitHubRemote', () => {
  /** @type {Array<[string, ({owner: string, repo: string} | null)]>} */
  const FIXTURES = [
    ['git@github.com:owner/repo.git',               { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo',                { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo.git',            { owner: 'owner', repo: 'repo' }],
    ['https://gitlab.com/owner/repo.git',            null],
    ['',                                              null],
    ['https://github.enterprise.example.com/o/r',     null],
  ];

  for (const [url, expected] of FIXTURES) {
    const label = url === '' ? '(empty)' : url;
    it(`parses ${label}`, () => {
      assert.deepEqual(parseGitHubRemote(url), expected);
    });
  }
});

describe('detectOriginRepo', () => {
  it('returns parsed remote when execGitRemote returns a github SSH url', () => {
    const exec = () => 'git@github.com:klab/kodo.git\n';
    assert.deepEqual(detectOriginRepo(exec), { owner: 'klab', repo: 'kodo' });
  });

  it('returns parsed remote when execGitRemote returns a github HTTPS url', () => {
    const exec = () => 'https://github.com/klab/kodo\n';
    assert.deepEqual(detectOriginRepo(exec), { owner: 'klab', repo: 'kodo' });
  });

  it('returns null when execGitRemote returns a non-github url', () => {
    const exec = () => 'https://gitlab.com/foo/bar.git\n';
    assert.equal(detectOriginRepo(exec), null);
  });

  it('fail-open: returns null when execGitRemote throws (Pitfall #6)', () => {
    const exec = () => { throw new Error('not a git repo'); };
    assert.equal(detectOriginRepo(exec), null);
  });

  it('returns null when execGitRemote returns empty string', () => {
    const exec = () => '';
    assert.equal(detectOriginRepo(exec), null);
  });
});

// ─── Phase 26 Plan 26-02 (CFG-03 / D-09..15): daemon CLI integration ────────────
//
// Helpers HOME-isolated + spawnSync (timeout 10s DoS guard) mirror
// test/skill-sync.test.js:38-79.

/**
 * Siembra `~/.kodo/config.json` con `providers.github.repos = [{owner:'foo',repo:'bar'}]`
 * + `~/.kodo/.env` con `GITHUB_TOKEN=fake_token_for_test`.
 *
 * @param {{ repos?: Array<{owner: string, repo: string}>, hasToken?: boolean }} [opts]
 */
function makeFixture(opts = {}) {
  const repos = opts.repos ?? [{ owner: 'foo', repo: 'bar' }];
  const hasToken = opts.hasToken !== false;
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-polling-home-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  writeFileSync(
    join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify({
      provider: 'github',
      providers: {
        github: {
          api_key_env: 'GITHUB_TOKEN',
          repos,
          poll_interval: 60,
        },
      },
    }, null, 2),
    'utf-8',
  );
  if (hasToken) {
    writeFileSync(join(tmpHome, '.kodo', '.env'), 'GITHUB_TOKEN=fake_token_for_test\n', 'utf-8');
  }
  return tmpHome;
}

/**
 * Escribe un PID file fake con `started_at` siempre presente (W-4 LOCKED).
 *
 * @param {{ tmpHome: string, pid?: number, repos?: string[] }} opts
 */
function writeFakePidFile({ tmpHome, pid = process.pid, repos = ['foo/bar'] }) {
  const pidPath = join(tmpHome, '.kodo', 'polling.pid');
  writeFileSync(
    pidPath,
    JSON.stringify({
      pid,
      started_at: new Date().toISOString(),
      repos,
    }, null, 2) + '\n',
    'utf-8',
  );
  chmodSync(pidPath, 0o600);
  return pidPath;
}

/**
 * Invoca `bin/kodo polling [args]` con HOME aislado + NO_COLOR=1 + timeout 10s.
 *
 * @param {{ tmpHome: string, args: string[] }} opts
 */
function runCli({ tmpHome, args }) {
  return spawnSync(
    process.execPath,
    [KODO_BIN, 'polling', ...args],
    {
      env: {
        ...process.env,
        HOME: tmpHome,
        NO_COLOR: '1',
        // Scrub GITHUB_TOKEN del environment del padre para que sólo el .env del fixture decida.
        GITHUB_TOKEN: '',
      },
      encoding: 'utf-8',
      timeout: 10000,
    },
  );
}

describe('kodo polling start (CFG-03 / D-09..15)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('caso 1 — D-14 start sin config (repos vacío) → exit 2 + stderr canonical', () => {
    _tmpHome = makeFixture({ repos: [] });
    const result = runCli({ tmpHome: _tmpHome, args: ['start'] });
    assert.equal(result.status, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /providers\.github\.repos is empty/);
  });

  it('caso 1b — D-14 start sin GITHUB_TOKEN → exit 2 + stderr canonical', () => {
    _tmpHome = makeFixture({ hasToken: false });
    const result = runCli({ tmpHome: _tmpHome, args: ['start'] });
    assert.equal(result.status, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /GITHUB_TOKEN not set/);
  });

  it('caso 2 — --no-daemon SIGINT exits 0 (foreground happy + cleanup)', async () => {
    _tmpHome = makeFixture();
    const { spawn } = await import('node:child_process');
    const child = spawn(
      process.execPath,
      [KODO_BIN, 'polling', 'start', '--no-daemon'],
      {
        env: { ...process.env, HOME: _tmpHome, NO_COLOR: '1', GITHUB_TOKEN: '' },
        stdio: 'pipe',
      },
    );
    // Dar tiempo a montar startPolling + writePidFile + handlers.
    await new Promise((resolve) => setTimeout(resolve, 700));
    child.kill('SIGINT');
    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
    });
    assert.equal(exitCode, 0, 'SIGINT → clean exit 0');
    // PID file removido tras cleanup.
    assert.equal(existsSync(join(_tmpHome, '.kodo', 'polling.pid')), false);
  });

  it('caso 3 — start daemon writes PID file ≤2s + padre exit 0 + shape correcto', async () => {
    _tmpHome = makeFixture();
    const result = runCli({ tmpHome: _tmpHome, args: ['start'] });
    try {
      assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
      const pidPath = join(_tmpHome, '.kodo', 'polling.pid');
      assert.equal(existsSync(pidPath), true, 'PID file debe existir post-start');
      const payload = JSON.parse(readFileSync(pidPath, 'utf-8'));
      assert.equal(typeof payload.pid, 'number');
      assert.equal(typeof payload.started_at, 'string');
      assert.ok(Array.isArray(payload.repos), 'repos debe ser array');
      assert.equal(payload.repos[0], 'foo/bar', 'repos shape "owner/repo"');
      // chmod 0o600 (token-adjacent metadata; Security V14).
      const mode = statSync(pidPath).mode & 0o777;
      assert.equal(mode, 0o600, `PID file mode debe ser 0o600, got 0o${mode.toString(8)}`);
    } finally {
      // Cleanup: matar el daemon spawneado.
      try {
        const pidPath = join(_tmpHome, '.kodo', 'polling.pid');
        if (existsSync(pidPath)) {
          const { pid } = JSON.parse(readFileSync(pidPath, 'utf-8'));
          try { process.kill(pid, 'SIGTERM'); } catch {}
        }
      } catch {}
    }
  });

  it('caso 4 — D-14 start con PID file vivo → exit 1 + stderr "already running"', () => {
    _tmpHome = makeFixture();
    writeFakePidFile({ tmpHome: _tmpHome, pid: process.pid });
    const result = runCli({ tmpHome: _tmpHome, args: ['start'] });
    assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /already running/i);
  });
});

describe('kodo polling status (CFG-03 / D-13 / D-21)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('caso 5 — D-13 status idle (sin PID file) → exit 0 + stdout match /idle/', () => {
    _tmpHome = makeFixture();
    const result = runCli({ tmpHome: _tmpHome, args: ['status'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /idle/);
  });

  it('caso 6 — D-13 status running (PID file con process.pid vivo) → exit 0 + match pid', () => {
    _tmpHome = makeFixture();
    // W-4 LOCKED: fake PID file con started_at + chmod 0o600.
    writeFakePidFile({ tmpHome: _tmpHome, pid: process.pid });
    const result = runCli({ tmpHome: _tmpHome, args: ['status'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /running/);
    assert.match(result.stdout, new RegExp(`pid:\\s*${process.pid}`));
  });

  it('caso 7 — D-13 status --json stale PID → idle exit 0 (NO crash)', () => {
    _tmpHome = makeFixture();
    // PID 999999 muy probablemente muerto (Linux PID range 32-bit; Mac default 99999).
    writeFakePidFile({ tmpHome: _tmpHome, pid: 999999 });
    const result = runCli({ tmpHome: _tmpHome, args: ['status', '--json'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /idle/);
  });

  it('caso 8 — D-21 status --json idle byte-deterministic regex literal', () => {
    _tmpHome = makeFixture();
    const result = runCli({ tmpHome: _tmpHome, args: ['status', '--json'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(
      result.stdout,
      /^\{"status":"idle","pid":null,"started_at":null,"repos":null\}\n$/,
    );
    // NO ANSI escapes leak (LOG-12 + DX-06 invariante).
    assert.equal(/\x1b\[/.test(result.stdout), false);
  });

  it('caso 9 — D-21 status --json running byte-deterministic (W-3 regex literal)', () => {
    _tmpHome = makeFixture();
    writeFakePidFile({ tmpHome: _tmpHome, pid: process.pid });
    const result = runCli({ tmpHome: _tmpHome, args: ['status', '--json'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    // W-3 LOCKED: regex literal del fixture sembrado (NO permissive [^\]]*).
    assert.match(
      result.stdout,
      /^\{"status":"running","pid":\d+,"started_at":"[^"]+","repos":\["foo\/bar"\]\}\n$/,
    );
    // NO ANSI escapes leak.
    assert.equal(/\x1b\[/.test(result.stdout), false);
  });

  it('caso 12 — D-21 status --json 4 keys consistency idle vs running (Pitfall #10)', () => {
    _tmpHome = makeFixture();
    // Idle: las 4 keys con null
    const idle = runCli({ tmpHome: _tmpHome, args: ['status', '--json'] });
    const idleParsed = JSON.parse(idle.stdout);
    assert.deepEqual(Object.keys(idleParsed).sort(), ['pid', 'repos', 'started_at', 'status']);
    assert.equal(idleParsed.status, 'idle');
    assert.equal(idleParsed.pid, null);
    assert.equal(idleParsed.started_at, null);
    assert.equal(idleParsed.repos, null);
    // Running: mismas 4 keys, valores no-null.
    writeFakePidFile({ tmpHome: _tmpHome, pid: process.pid });
    const running = runCli({ tmpHome: _tmpHome, args: ['status', '--json'] });
    const runningParsed = JSON.parse(running.stdout);
    assert.deepEqual(Object.keys(runningParsed).sort(), ['pid', 'repos', 'started_at', 'status']);
    assert.equal(runningParsed.status, 'running');
    assert.equal(typeof runningParsed.pid, 'number');
  });
});

describe('kodo polling stop (CFG-03 / D-12 / D-14)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('caso 10 — D-14 stop sin PID file → exit 3 + stderr canonical', () => {
    _tmpHome = makeFixture();
    const result = runCli({ tmpHome: _tmpHome, args: ['stop'] });
    assert.equal(result.status, 3, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /no polling daemon running/);
  });

  it('caso 11 — stop sends SIGTERM and removes PID file (happy path)', async () => {
    _tmpHome = makeFixture();
    const { spawn } = await import('node:child_process');
    const child = spawn(
      process.execPath,
      [KODO_BIN, 'polling', 'start', '--no-daemon'],
      {
        env: { ...process.env, HOME: _tmpHome, NO_COLOR: '1', GITHUB_TOKEN: '' },
        stdio: 'pipe',
        detached: false,
      },
    );
    // Esperar a que el child escriba el PID file.
    const pidPath = join(_tmpHome, '.kodo', 'polling.pid');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (existsSync(pidPath)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(existsSync(pidPath), true, 'PID file debe escribirse antes del stop');
    // Stop via CLI.
    const result = runCli({ tmpHome: _tmpHome, args: ['stop'] });
    try {
      assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
      assert.equal(existsSync(pidPath), false, 'PID file debe borrarse post-stop');
    } finally {
      // Asegurar que el child está muerto.
      try { child.kill('SIGKILL'); } catch {}
      await new Promise((resolve) => child.on('exit', resolve));
    }
  });

  it('caso 13 — D-14 stop con PID stale (ESRCH) → exit 0 + borra PID file', () => {
    _tmpHome = makeFixture();
    // PID 999999 muy probablemente muerto.
    writeFakePidFile({ tmpHome: _tmpHome, pid: 999999 });
    const result = runCli({ tmpHome: _tmpHome, args: ['stop'] });
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.equal(
      existsSync(join(_tmpHome, '.kodo', 'polling.pid')),
      false,
      'PID file stale debe ser cleanup en stop',
    );
  });
});

describe('runPollingStartCli — Windows fallback (W-2 LOCKED / Pitfall #8)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('caso 14 — Windows daemon emits warn "Windows daemon unsupported" o "use --no-daemon"', async () => {
    _tmpHome = makeFixture();
    // Setear HOME para que loadConfig encuentre el fixture; GITHUB_TOKEN propagado por .env loader.
    const prevHome = process.env.HOME;
    const prevToken = process.env.GITHUB_TOKEN;
    process.env.HOME = _tmpHome;
    delete process.env.GITHUB_TOKEN; // forzar lectura del .env del fixture
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      // Re-import dinámico para garantizar lectura fresca de KODO_DIR/.env tras HOME override.
      const mod = await import(`../../src/cli/polling.js?win-test-${Date.now()}`);
      /** @type {string[]} */
      const errs = [];
      /** @type {string[]} */
      const outs = [];
      const code = await mod.runPollingStartCli(
        { noDaemon: false, json: false },
        {
          writeFn: (s) => outs.push(s),
          errFn: (s) => errs.push(s),
        },
      );
      // a) stderr contiene la guidance canonical.
      assert.match(
        errs.join(''),
        /Windows daemon unsupported|use --no-daemon/i,
        `stderr expected guidance; got: ${errs.join('') || '(empty)'}`,
      );
      // b) Exit code aceptable: 0 (fallback automático) o 1 (refuse-with-guidance).
      //    Variante del executor (Plan 26-02): refuse-with-guidance → exit 1.
      assert.ok(code === 0 || code === 1, `windows path returned ${code}`);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevToken;
    }
  });
});
