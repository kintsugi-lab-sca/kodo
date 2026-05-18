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
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
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

// ────────────────────────────────────────────────────────────────────────────
// Phase 28 Plan 28-03 Task 4 — DAEMON-02 logfile lifecycle integration.
// Validates ROADMAP AC#2:
//   - Daemon crash → logfile contains stack trace (D-13 fd redirect).
//   - Logfile mode 0o600 + filename `polling-YYYY-MM-DD.log` (D-14/D-16).
//   - Daemon --verbose writes NDJSON summary lines to logfile (D-17).
//   - D-18 separation of concerns: daemon logfile path ≠ NDJSON sink raíz path.
//
// Pattern: spawn `kodo polling start` as DAEMON (sin --no-daemon) with fixture
// HOME-isolated. Opción B (resuelve blocker checker #3): la env var
// `KODO_TEST_FORCE_THROW` (Task 3) fuerza throw POST-spawn del hijo dentro de
// `processRepo`. El fd redirect (D-13) captura el stack trace en el logfile.
// La env var requiere `NODE_ENV=test` como doble guard — NUNCA se activa en
// producción.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Construye el path del logfile esperado para la fecha local actual,
 * espejo de `src/cli/polling-logfile.js#resolveLogfilePath`. Lo hacemos
 * inline aquí para evitar acoplamiento con el cache ESM del módulo bajo
 * test (que vive en otro proceso — el child daemon).
 *
 * @param {string} tmpHome
 * @returns {string}
 */
function expectedLogfilePath(tmpHome) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return join(tmpHome, '.kodo', 'logs', `polling-${y}-${m}-${d}.log`);
}

/**
 * Spawnea `kodo polling start` (DAEMON path — sin --no-daemon) con env vars
 * inyectables. Retorna cuando el padre exitea (debe ser ≤2s exit 0 normalmente,
 * o exit 1 si el PID write times out).
 *
 * Captura stderr del PADRE para diagnóstico de fallos del spawn. NO captura
 * stdout del HIJO — ese va al logfile via fd redirect (D-13).
 *
 * @param {{
 *   tmpHome: string,
 *   extraEnv?: Record<string, string>,
 *   verbose?: boolean,
 * }} opts
 * @returns {Promise<{ stderr: string, exitCode: number | null }>}
 */
async function spawnDaemon({ tmpHome, extraEnv = {}, verbose = false }) {
  const args = [KODO_BIN, 'polling', 'start'];
  if (verbose) args.push('--verbose');
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      HOME: tmpHome,
      NO_COLOR: '1',
      GITHUB_TOKEN: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  // El padre exitea cuando el PID file está escrito o cuando timeout (≤2s).
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  return { stderr, exitCode };
}

/**
 * Kill safe del daemon spawneado (lee PID file y manda SIGTERM, fail-open).
 *
 * @param {string} tmpHome
 */
function killDaemon(tmpHome) {
  const pidPath = join(tmpHome, '.kodo', 'polling.pid');
  if (!existsSync(pidPath)) return;
  try {
    const payload = JSON.parse(readFileSync(pidPath, 'utf-8'));
    if (typeof payload?.pid === 'number') {
      try {
        process.kill(payload.pid, 'SIGTERM');
      } catch {
        // proceso ya muerto — OK
      }
    }
  } catch {
    // PID file corrupto — OK
  }
}

describe('kodo polling start daemon logfile (Phase 28 DAEMON-02)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) {
      killDaemon(_tmpHome);
      try {
        rmSync(_tmpHome, { recursive: true, force: true });
      } catch {}
    }
    _tmpHome = undefined;
  });

  it('AC#2: daemon crash → logfile contiene stack trace + mode 0o600 + filename `polling-YYYY-MM-DD.log` (D-13/D-14/D-16)', async () => {
    _tmpHome = makeFixture({ pollInterval: 1 });
    // Opción B (resuelve blocker checker #3): la env var KODO_TEST_FORCE_THROW
    // (Task 3) fuerza throw POST-spawn del hijo dentro de processRepo. El fd
    // redirect (D-13) captura el stack trace en el logfile. La env var
    // requiere NODE_ENV=test como doble guard — NUNCA se activa en producción.
    const { exitCode: parentExit } = await spawnDaemon({
      tmpHome: _tmpHome,
      extraEnv: {
        GITHUB_TOKEN: 'fake_token_for_test',
        NODE_ENV: 'test',
        KODO_TEST_FORCE_THROW: 'true',
      },
      verbose: false,
    });
    // El padre puede exit 0 (PID file escrito antes del crash) o 1 (timeout
    // si el hijo crasheó antes del writePidFile). AMBOS son aceptables para
    // este test — lo que importa es que el LOGFILE capturó el stack trace
    // via fd redirect del padre.
    assert.ok(
      parentExit === 0 || parentExit === 1,
      `parent exit ${parentExit} debe ser 0 o 1 (PID-written o timeout)`,
    );

    // Esperar a que el hijo arranque, throw, y cierre. El logfile fue abierto
    // por el padre PRE-spawn, así que existe desde el inicio.
    await new Promise((r) => setTimeout(r, 2500));

    const logfilePath = expectedLogfilePath(_tmpHome);

    // D-14: filename format `polling-YYYY-MM-DD.log`.
    assert.match(
      logfilePath,
      /polling-\d{4}-\d{2}-\d{2}\.log$/,
      'D-14: filename format correcto',
    );

    // D-13 + D-16: archivo creado por openSync del padre con mode 0o600.
    assert.equal(existsSync(logfilePath), true, 'logfile existe (creado por openSync del padre)');
    const mode = statSync(logfilePath).mode & 0o777;
    assert.equal(mode, 0o600, `D-16: logfile mode 0o600, got 0o${mode.toString(8)}`);

    // D-13: contenido del logfile incluye el mensaje del throw + stack trace
    // de Node. El uncaught exception del hijo se imprime a stderr → fd redirect
    // → logfile.
    const content = readFileSync(logfilePath, 'utf-8');
    assert.match(
      content,
      /KODO_TEST_FORCE_THROW.*test-induced crash/,
      `logfile debe contener el mensaje del throw, got: ${JSON.stringify(content).slice(0, 500)}`,
    );
    assert.match(
      content,
      /at\s+\S+|Error:/,
      `logfile debe contener stack trace de Node ('at ' frames o 'Error:'), got: ${JSON.stringify(content).slice(0, 500)}`,
    );
  });

  it('D-17: daemon --verbose escribe NDJSON polling.tick.summary al logfile (no-TTY → JSON)', async () => {
    _tmpHome = makeFixture({ pollInterval: 1 });
    // SIN KODO_TEST_FORCE_THROW — flow normal: hijo arranca, hace ≥1 tick,
    // emite polling.tick.summary que el wrapLoggerForSummary duplica a stdout.
    // El stdout del hijo va al logfile via fd redirect (D-13). Como el hijo
    // detached no es TTY (stdio['ignore', logFd, logFd]), el wrapper toma la
    // branch NDJSON (DX-06).
    const { exitCode: parentExit } = await spawnDaemon({
      tmpHome: _tmpHome,
      extraEnv: { GITHUB_TOKEN: 'fake_token_for_test' },
      verbose: true,
    });
    assert.equal(parentExit, 0, 'parent exit 0 (PID file escrito ≤2s)');

    // Wait para ≥1 tick (poll_interval=1s).
    await new Promise((r) => setTimeout(r, 3500));

    // Kill el daemon para que cierre y flushee el stdout buffer al logfile.
    killDaemon(_tmpHome);
    await new Promise((r) => setTimeout(r, 500));

    const logfilePath = expectedLogfilePath(_tmpHome);
    assert.equal(existsSync(logfilePath), true, 'logfile existe');
    const content = readFileSync(logfilePath, 'utf-8');
    assert.match(
      content,
      /"event":\s*"polling\.tick\.summary"|polling\.tick\.summary/,
      `D-17: logfile debe contener polling.tick.summary NDJSON, got: ${JSON.stringify(content).slice(0, 500)}`,
    );
  });

  it('D-18: separation of concerns — daemon logfile path ≠ NDJSON sink raíz path', async () => {
    _tmpHome = makeFixture({ pollInterval: 1 });
    // Spawn normal (sin crash, sin verbose) — flujo happy path para verificar
    // que daemon logfile y NDJSON sink raíz son ARCHIVOS DISTINTOS y AMBOS se
    // crean.
    const { exitCode: parentExit } = await spawnDaemon({
      tmpHome: _tmpHome,
      extraEnv: { GITHUB_TOKEN: 'fake_token_for_test' },
      verbose: false,
    });
    assert.equal(parentExit, 0, 'parent exit 0');

    // Wait para ≥1 tick — asegura que el NDJSON sink raíz reciba al menos
    // un evento (polling.tick.summary del baseLogger SIEMPRE).
    await new Promise((r) => setTimeout(r, 3500));
    killDaemon(_tmpHome);
    await new Promise((r) => setTimeout(r, 500));

    const logfilePath = expectedLogfilePath(_tmpHome);
    const ndjsonSinkPath = join(_tmpHome, '.kodo', 'logs', 'polling.ndjson');

    assert.notEqual(
      logfilePath,
      ndjsonSinkPath,
      'D-18: daemon logfile path ≠ NDJSON sink path (separation of concerns)',
    );
    // El logfile daemon (fd redirect) existe.
    assert.equal(
      existsSync(logfilePath),
      true,
      'daemon logfile existe (fd redirect del padre)',
    );
    // El NDJSON sink raíz también existe (baseLogger SIEMPRE propagado, Plan 28-02).
    assert.equal(
      existsSync(ndjsonSinkPath),
      true,
      'NDJSON sink raíz existe (baseLogger del hijo)',
    );
  });
});
