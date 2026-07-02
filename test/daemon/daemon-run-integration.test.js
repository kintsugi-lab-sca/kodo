// @ts-check
//
// test/daemon/daemon-run-integration.test.js — Phase 65 Plan 04 (UP-04 / D-02 / SC1).
//
// Prueba de PROCESO-completo del entrypoint interno `kodo daemon run`: la ÚNICA
// evidencia que sólo un child real puede dar — que el daemon BLOQUEA en foreground
// (escribe kodo.pid y NO se auto-detacha) y que SIGTERM lo tumba limpio (exit 0 ≤5s +
// kodo.pid removido). Ejercita el stack completo Wave 1→3 end to end (server compuesto
// + runDaemon funnel + PID primitives name-parametrizadas).
//
// Molde spawn HOME-isolated mirror de test/cli/polling.test.js:12-27 + :177-197
// (spawn foreground, delay, kill, esperar 'exit'). getPidPath('kodo') resuelve a
// join(homedir(),'.kodo','kodo.pid') (polling-daemon.js:58) — bajo HOME=tmpHome el
// child lo escribe en tmpHome/.kodo/kodo.pid, así que computamos ese path directo
// en el parent (mismo patrón que polling.test.js que usa join(_tmpHome,...) directo).
//
// Provider: **github**. Su init() es un no-op completo (D-19, providers/github/
// provider.js:118) → startServer({managed}) resuelve OFFLINE sin tocar red. plane, en
// cambio, hace un init() de red (warm cache, 56 líneas) — por eso elegimos github.
// github es pull-based → runDaemon arranca ADEMÁS el polling in-process (D-06); su
// first tick es fail-open (github provider never-throws) así que no tumba el daemon.
// KODO_DEV=1 limpia el gate managed de webhook-secret (server.js:427).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

/**
 * Reserva un puerto TCP libre efímero y lo devuelve (cerrando el listener). El
 * daemon compuesto hace `server.listen(config.server.port)`; sembrar un puerto
 * libre evita EADDRINUSE con un kodo real en :9090 (default) que, bajo managed,
 * haría teardown(1) y jamás escribiría kodo.pid (falso RED).
 *
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

/**
 * Siembra un HOME aislado con `~/.kodo/config.json` (provider github, puerto libre
 * inyectado) + `~/.kodo/.env` con un GITHUB_TOKEN fake. github.init() es no-op →
 * el server compuesto arranca offline.
 *
 * @param {number} port
 * @returns {string} tmpHome
 */
function makeFixture(port) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-daemon-run-home-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  writeFileSync(
    join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify({
      provider: 'github',
      server: { port },
      providers: {
        github: {
          api_key_env: 'GITHUB_TOKEN',
          repos: [{ owner: 'foo', repo: 'bar' }],
          poll_interval: 60,
        },
      },
    }, null, 2),
    'utf-8',
  );
  writeFileSync(join(tmpHome, '.kodo', '.env'), 'GITHUB_TOKEN=fake_token_for_test\n', 'utf-8');
  return tmpHome;
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

describe('kodo daemon run — foreground supervisable (UP-04 / SC1)', () => {
  /** @type {string | undefined} */
  let _tmpHome;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let _child;

  afterEach(async () => {
    // Teardown SIEMPRE: matar el child (aunque una assertion haya fallado) + limpiar tmp.
    if (_child && _child.exitCode === null && _child.signalCode === null) {
      try { _child.kill('SIGKILL'); } catch { /* ya muerto */ }
      try { await new Promise((r) => _child?.on('exit', r)); } catch { /* noop */ }
    }
    _child = undefined;
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('spawns bin/kodo daemon run → kodo.pid escrito, child vivo (foreground), SIGTERM→exit 0 ≤5s + kodo.pid removido', async () => {
    const port = await findFreePort();
    _tmpHome = makeFixture(port);
    // getPidPath('kodo') bajo HOME=tmpHome == este path (polling-daemon.js:58).
    const pidPath = join(_tmpHome, '.kodo', 'kodo.pid');

    _child = spawn(
      process.execPath,
      [KODO_BIN, 'daemon', 'run'],
      {
        env: {
          ...process.env,
          HOME: _tmpHome,
          KODO_DEV: '1',      // limpia el gate managed de webhook-secret (server.js:427)
          NO_COLOR: '1',
          GITHUB_TOKEN: '',   // scrub del parent: sólo el .env del fixture decide
        },
        stdio: 'pipe',
      },
    );

    // Capturar salida del child para diagnóstico si algo falla.
    let stderr = '';
    _child.stderr?.on('data', (d) => { stderr += d.toString(); });

    // Guard: si el child muere ANTES de escribir el PID (p.ej. teardown(1) por
    // EADDRINUSE o un throw), lo detectamos como early-exit en vez de colgar el poll.
    let earlyExit = /** @type {number | null | undefined} */ (undefined);
    _child.on('exit', (code) => { earlyExit = code; });

    // Poll ≤3s a que aparezca kodo.pid (el foreground funnel lo escribió).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (existsSync(pidPath)) break;
      if (earlyExit !== undefined) {
        assert.fail(`child salió (code ${earlyExit}) antes de escribir kodo.pid.\nstderr:\n${stderr}`);
      }
      await sleep(50);
    }
    assert.equal(existsSync(pidPath), true, `kodo.pid debe existir tras el arranque.\nstderr:\n${stderr}`);

    // El child debe seguir VIVO tras un delay corto: foreground BLOQUEA, NO se
    // auto-detacha ni auto-sale (UP-04 — sin spawn/unref en la action).
    await sleep(300);
    assert.equal(_child.exitCode, null, `child debe seguir vivo (exitCode null); foreground blocks.\nstderr:\n${stderr}`);
    assert.equal(_child.signalCode, null, 'child no debe haber recibido señal aún');

    // SIGTERM → exit limpio ≤5s.
    _child.kill('SIGTERM');
    const exitCode = await new Promise((res) => {
      const t = setTimeout(() => res('TIMEOUT'), 5000);
      _child?.on('exit', (code, signal) => {
        clearTimeout(t);
        res(code !== null ? code : signal);
      });
    });
    // run.js es dueño del exit: SIGTERM → teardown(0) → exit 0 (clean).
    assert.equal(exitCode, 0, `SIGTERM debe producir exit 0 ≤5s (got ${exitCode}).\nstderr:\n${stderr}`);
    // kodo.pid removido por el teardown single-owner (removePidFile('kodo')).
    assert.equal(existsSync(pidPath), false, 'kodo.pid debe borrarse tras el teardown SIGTERM');
  });
});
