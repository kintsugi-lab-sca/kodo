# Phase 26: Config Wizard + CLI Integration — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 11 (8 CREATE + 3 MODIFY)
**Analogs found:** 11 / 11 (100% — todo el delta vive sobre patrones existentes)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/polling.js` (CREATE) | CLI handler | request-response (start/stop/status) + pure helper (parser) | `src/cli/skill-sync.js` (exit codes + DI) · `src/server.js:482-523` (PID lifecycle) | exact (CLI handler) + role-match (PID) |
| `src/cli/polling-daemon.js` (CREATE) | utility (PID file lifecycle) | file-I/O (atomic tmp+rename) | `src/triggers/polling.js:149-154` (saveStateCache) | exact (atomic write pattern) |
| `test/cli/polling.test.js` (CREATE) | test (integration spawnSync + unit) | request-response | `test/skill-sync.test.js:18-79,346-353` | exact (spawnSync HOME-isolated + `--json` bytes) |
| `test/cli/polling-daemon.test.js` (CREATE) | test (unit) | file-I/O | `test/skill-sync.test.js:93-130` (afterEach + tmpdir) | role-match (FS unit) |
| `test/cli/wizard-github.test.js` (CREATE) | test (unit DI) | request-response | RESEARCH §Example 1 (scripted-readline) — patrón nuevo; `test/skill-sync.test.js` para spawnSync flavor | role-match (no precedent stdin-mock) |
| `test/cli/orchestrate-polling.test.js` (CREATE) | test (integration spawn + SIGINT) | event-driven | `test/skill-sync.test.js:69-79` (spawn child timeout) | role-match (signal cleanup nuevo) |
| `test/fixtures/configs/v0.6-no-github.json` (CREATE) | fixture (config) | static JSON | `src/config.js:32-67` DEFAULT_CONFIG shape | exact (mirror shape sin `providers.github`) |
| `test/fixtures/configs/v0.7-github.json` (CREATE) | fixture (config) | static JSON | RESEARCH §D-06 shape | exact (D-06 verbatim) |
| `src/cli.js` (MODIFY) | CLI registrar + wizard | request-response | `src/cli.js:241-275` (gsd subcmd) · `src/cli.js:344-525` (interactiveConfig Plane branch) · `src/cli.js:126-141` (orchestrate) | exact (todos los puntos extender) |
| `src/config.js` (MODIFY) | helper export | pure factory | `src/config.js:32-67` DEFAULT_CONFIG | exact (factory analogous) |
| `test/migration.test.js` (MODIFY) | test (unit) | fixture-driven | `test/migration.test.js:82-143` (config migration suite) | exact (extender suite) |

## Pattern Assignments

### `src/cli/polling.js` (CLI handler + helpers `parseGitHubRemote` + `detectOriginRepo` + `startDaemon`)

**Primary analog:** `src/cli/skill-sync.js` (exit-code-deterministic CLI handler con DI + `--json` byte-determinismo)
**Secondary analog:** `src/server.js:482-523` (PID file write + SIGTERM kill + ESRCH cleanup)
**Tertiary analog:** `src/gsd/lock.js:67-74` (reusar `isPidAlive` — NO duplicar)

**Imports pattern** (mirror `src/cli/skill-sync.js:1-19`):
```javascript
// @ts-check
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFormatter } from './format.js';
import { isPidAlive } from '../gsd/lock.js';
import { writePidFile, readPidFile, removePidFile, PID_PATH } from './polling-daemon.js';
```

**Exit-code-deterministic CLI handler signature** (mirror `src/cli/skill-sync.js:40-84`):
```javascript
/**
 * @param {{ noDaemon?: boolean, json?: boolean }} opts
 * @param {{ startPollingFn?, formatterFn?, writeFn?, errFn?, configFn? }} [deps]
 * @returns {Promise<number>}  // exit code D-14: 0 ok / 1 already-running / 2 no-config / 3 no-daemon
 */
export async function runPollingStartCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  // Gate D-14 exit 2: stderr canonical message exacto (mirror skill-sync:53)
  const config = (deps.configFn || loadConfig)();
  const repos = config.providers?.github?.repos || [];
  if (repos.length === 0) {
    err('Error: providers.github.repos is empty. Run `kodo config` first.\n');
    return 2;
  }
  if (!getProviderApiKey('github')) {
    err('Error: GITHUB_TOKEN not set. Export it or add to ~/.kodo/.env.\n');
    return 2;
  }
  // ... daemon vs --no-daemon branch
}
```

**Daemon spawn pattern** (RESEARCH §Example 2 verbatim; pitfall #2/#4):
```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_BIN = join(__dirname, '..', '..', 'bin', 'kodo');

// Pre-flight: PID file vivo → exit 1 (mirror src/server.js:504 idempotencia)
const existing = readPidFile();
if (existing && isPidAlive(existing.pid)) {
  err(`Error: polling daemon already running (pid ${existing.pid}).\n`);
  return 1;
}
if (existing) removePidFile(); // stale PID file — limpia y procede

const child = spawn(
  process.execPath,                                  // A6: garantizado absolute
  [KODO_BIN, 'polling', 'start', '--no-daemon'],
  { detached: true, stdio: 'ignore', env: process.env },
);
child.unref();  // PITFALL #2 crítico — sin esto el padre cuelga

// Bounded wait — D-10 timeout 2s (mirror clock-mock Phase 25)
const deadline = Date.now() + 2000;
while (Date.now() < deadline) {
  const payload = readPidFile();
  if (payload && isPidAlive(payload.pid)) return 0;
  await sleep(50);
}
err('Error: daemon failed to write PID file within 2s\n');
return 1;
```

**Foreground `--no-daemon` path** (mirror `src/server.js:490-495` SIGINT cleanup):
```javascript
const handle = startPolling({ provider, repos, intervalSec });
writePidFile({
  pid: process.pid,
  started_at: new Date().toISOString(),
  repos: repos.map((r) => `${r.owner}/${r.repo}`),  // D-15 human-readable
});
const cleanup = () => {
  handle.stop();
  removePidFile();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
// Block forever — startPolling tiene su propio timer loop.
await new Promise(() => {});
```

**Stop pattern** (mirror `src/server.js:503-523`):
```javascript
export async function runPollingStopCli(opts, deps = {}) {
  const payload = (deps.readPidFn || readPidFile)();
  if (!payload) {
    err('Error: no polling daemon running\n');
    return 3;  // D-14
  }
  try {
    process.kill(payload.pid, 'SIGTERM');
    // D-12: 5s wait, luego SIGKILL
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isPidAlive(payload.pid)) await sleep(100);
    if (isPidAlive(payload.pid)) process.kill(payload.pid, 'SIGKILL');
    removePidFile();
    return 0;
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException}*/(e).code === 'ESRCH') {
      removePidFile();  // mirror server.js:516-519 stale cleanup
      return 0;
    }
    throw e;
  }
}
```

**Status `--json` byte-determinism** (mirror `src/cli/skill-sync.js:70-82` + Pitfall #10):
```javascript
export async function runPollingStatusCli(opts, deps = {}) {
  const payload = (deps.readPidFn || readPidFile)();
  const alive = payload && isPidAlive(payload.pid);
  // D-21 + Pitfall #10: SIEMPRE las 4 keys (null cuando idle).
  /** @type {Record<string, any>} */
  const json = {
    status: alive ? 'running' : 'idle',
    pid: alive ? payload.pid : null,
    started_at: alive ? payload.started_at : null,
    repos: alive ? payload.repos : null,
  };
  if (opts.json === true) {
    write(JSON.stringify(json) + '\n');  // single-line, NO_COLOR-safe via createFormatter NO usado en --json
  } else {
    const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
    if (alive) {
      write(`${fmt.ok(`running`)} pid: ${payload.pid}, started: ${payload.started_at}\n`);
    } else {
      write(`${fmt.dim('idle')}\n`);
    }
  }
  return 0;  // D-13: status query nunca falla
}
```

**Git remote parser** (RESEARCH §Example 5 verbatim — D-03):
```javascript
/**
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitHubRemote(url) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/|\s|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * @param {() => string} [exec]
 * @returns {{ owner: string, repo: string } | null}
 */
export function detectOriginRepo(exec) {
  const e = exec || (() => execSync('git remote get-url origin',
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  try {
    return parseGitHubRemote(e().trim());
  } catch {
    return null;  // pitfall #6: not a git repo / git not installed
  }
}
```

**Wizard helper extraction** (mirror Plane branch `src/cli.js:391-400` shape; export para tests — Open Q resolution):
```javascript
/**
 * @param {{
 *   ask: (q: string) => Promise<string>,
 *   execGitRemote?: () => string,
 *   providerConfig: object,
 * }} deps
 */
export async function configureGithubProvider({ ask, execGitRemote, providerConfig }) {
  // API key env var name (NO escribir token — D-02 security)
  const defaultEnv = providerConfig.api_key_env || 'GITHUB_TOKEN';
  const envName = await ask(`  Variable de entorno para API key [${defaultEnv}]: `);
  providerConfig.api_key_env = envName.trim() || defaultEnv;

  // D-03: auto-detect origin
  providerConfig.repos = providerConfig.repos || [];
  const detected = detectOriginRepo(execGitRemote);
  if (detected) {
    const yes = await ask(`  Detectado: ${detected.owner}/${detected.repo} — ¿añadir? [S/n]: `);
    if (yes.trim() === '' || yes.trim().toLowerCase() === 's') {
      providerConfig.repos.push(detected);
    }
  }

  // D-04: manual add loop con validación "exactamente un /"
  while (true) {
    const input = await ask('  Repo (owner/repo, Enter para terminar): ');
    if (input.trim() === '') break;
    const parts = input.trim().split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      // (NO recursión — Pitfall #9; just retry el while loop)
      continue;
    }
    providerConfig.repos.push({ owner: parts[0], repo: parts[1] });
  }

  // D-06 shape defaults (poll_interval/mcp_hint/states inyectados ahora)
  providerConfig.poll_interval = providerConfig.poll_interval || 60;
  providerConfig.mcp_hint = providerConfig.mcp_hint || 'GitHub MCP server';
  providerConfig.states = providerConfig.states || { review: 'closed' };
}
```

---

### `src/cli/polling-daemon.js` (PID file utility)

**Primary analog:** `src/triggers/polling.js:149-154` (`saveStateCache` — atomic tmp+rename)
**Constraint:** Import `KODO_DIR` desde `../config.js` (Pitfall #11 — NO redefinir).

**Imports pattern** (mirror `src/triggers/polling.js:1-15`):
```javascript
// @ts-check
import {
  writeFileSync, readFileSync, renameSync, unlinkSync,
  mkdirSync, existsSync, chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { KODO_DIR } from '../config.js';

export const PID_PATH = join(KODO_DIR, 'polling.pid');
```

**Atomic tmp+rename pattern** (RESEARCH §Example 3; mirror `src/triggers/polling.js:149-154`):
```javascript
/**
 * @typedef {{ pid: number, started_at: string, repos: string[] }} PidFilePayload
 * @param {PidFilePayload} payload
 */
export function writePidFile(payload) {
  mkdirSync(dirname(PID_PATH), { recursive: true });
  const tmp = PID_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  chmodSync(tmp, 0o600);  // PRE-rename (Security V14 — token-adjacent metadata)
  renameSync(tmp, PID_PATH);  // POSIX-atomic (mismo FS)
}
```

**Read fail-open** (mirror `src/triggers/polling.js:loadStateCache` — corrupt → empty):
```javascript
/** @returns {PidFilePayload | null} */
export function readPidFile() {
  if (!existsSync(PID_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(PID_PATH, 'utf-8'));
    // Defensive shape check (Security: PID file world-writable mitigation)
    if (typeof parsed?.pid !== 'number' || typeof parsed?.started_at !== 'string') return null;
    return parsed;
  } catch {
    return null;  // fail-open mirror loadStateCache
  }
}

export function removePidFile() {
  try { unlinkSync(PID_PATH); } catch { /* may not exist */ }
}
```

---

### `src/cli.js` (MODIFY — extender en 3 puntos quirúrgicos)

**Analog (#1) — registrar `kodo polling` parent + 3 subcomandos** (mirror `src/cli.js:241-275` gsd subcmd verbatim):
```javascript
// --- kodo polling <subcommand> ---
const polling = program.command('polling').description('GitHub polling daemon (start/stop/status)');

polling
  .command('start')
  .description('Start polling daemon (default: detached background)')
  .option('--no-daemon', 'Run in foreground; SIGINT/SIGTERM cancel cleanly')
  .option('--json', 'Emit structured result as JSON')
  .action(async (opts) => {
    try {
      await ensureConfig();
      const { runPollingStartCli } = await import('./cli/polling.js');
      const code = await runPollingStartCli({ noDaemon: opts.noDaemon, json: opts.json });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

polling
  .command('stop')
  .description('Stop polling daemon via PID file')
  .action(async () => {
    try {
      const { runPollingStopCli } = await import('./cli/polling.js');
      process.exit(await runPollingStopCli({}));
    } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
  });

polling
  .command('status')
  .description('Show polling daemon status (running|idle)')
  .option('--json', 'Emit structured result as JSON')
  .action(async (opts) => {
    try {
      const { runPollingStatusCli } = await import('./cli/polling.js');
      process.exit(await runPollingStatusCli({ json: opts.json }));
    } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
  });
```

**Analog (#2) — extender `interactiveConfig` con rama github** (insertar entre `:363` y `:368`, mirror existing branch structure `:391-400` Plane):
```javascript
// src/cli.js:355 — extender availableProviders
const availableProviders = ['plane', 'github'];  // D-01

// ... entre :386 (apiKey OK) y :391 (Plane branch), añadir:
if (selectedProvider === 'github') {
  // Delegado a helper exportado (DI-zable para tests — Pitfall A1)
  const { configureGithubProvider } = await import('./cli/polling.js');
  await configureGithubProvider({ ask, providerConfig });

  // D-05 resumen final
  console.log('\n  Resumen:');
  for (const r of providerConfig.repos) console.log(`    - ${r.owner}/${r.repo}`);
  console.log(`  poll_interval: ${providerConfig.poll_interval}s`);
  const ok = await ask('\n  Guardar? [S/n]: ');
  if (ok.trim() !== '' && ok.trim().toLowerCase() !== 's') {
    console.log('  Abortado sin guardar.\n');
    rl.close();
    return;
  }
  saveConfig(config);
  console.log('  ✓ Configuracion guardada en ~/.kodo/\n');
  rl.close();
  return;  // EARLY-RETURN — Pitfall #9: NO caer al Plane projects listing
}
```

**Analog (#3) — flag `--polling` en `kodo orchestrate`** (RESEARCH §Example 4; mirror `src/cli.js:126-141` + `src/server.js:490-495` SIGINT cleanup):
```javascript
// src/cli.js:126 — extender orchestrate
program
  .command('orchestrate')
  .description('Launch the orchestrator Claude session')
  .option('--polling', 'Arranca polling integrado. NO usar con `kodo polling start` simultáneo sobre el mismo repo (mutex implícito vía lock per-repo Phase 8 GSD-10).')
  .action(async (opts) => {
    try {
      const { launchOrchestrator } = await import('./orchestrator/launch.js');
      const result = await launchOrchestrator();

      /** @type {{ stop: () => void } | null} */
      let pollingHandle = null;
      if (opts.polling) {
        const { loadConfig, getProviderApiKey } = await import('./config.js');
        const config = loadConfig();
        const repos = config.providers?.github?.repos || [];
        if (repos.length === 0) {
          console.error('Error: providers.github.repos is empty. Run `kodo config` first.');
          process.exit(2);
        }
        if (!getProviderApiKey('github')) {
          console.error('Error: GITHUB_TOKEN not set. Export it or add to ~/.kodo/.env.');
          process.exit(2);
        }
        const { startPolling } = await import('./triggers/polling.js');
        const { initRegistry, getProvider } = await import('./providers/registry.js');
        await initRegistry();
        pollingHandle = startPolling({
          provider: getProvider('github'),
          repos,
          intervalSec: config.providers.github.poll_interval || 60,
        });
        // D-18: SIGINT/SIGTERM cleanup — mirror src/server.js:490-495 sin PID file
        const cleanup = () => { if (pollingHandle) pollingHandle.stop(); process.exit(0); };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      }
      // ... existing output existing/launched logic preserved
    } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
  });
```

---

### `src/config.js` (MODIFY — añadir factory `getDefaultGithubProviderConfig`)

**Analog:** `src/config.js:32-67` DEFAULT_CONFIG (NO modificar; añadir factory aparte — D-08).

**Pattern to add** (single function, exported; mirror shape D-06):
```javascript
/**
 * Factory para el shape default de `providers.github`. NO se inyecta en
 * DEFAULT_CONFIG (D-08 — preserva CFG-02 zero-breaking-change para configs v0.6).
 * El wizard llama este factory cuando el operador elige github.
 *
 * @returns {{
 *   api_key_env: string,
 *   repos: Array<{owner: string, repo: string}>,
 *   poll_interval: number,
 *   mcp_hint: string,
 *   states: { review: string },
 * }}
 */
export function getDefaultGithubProviderConfig() {
  return {
    api_key_env: 'GITHUB_TOKEN',
    repos: [],
    poll_interval: 60,
    mcp_hint: 'GitHub MCP server',
    states: { review: 'closed' },
  };
}
```

---

### `test/cli/polling.test.js`

**Primary analog:** `test/skill-sync.test.js:18-79` (spawnSync HOME-isolated boilerplate) + `:346-353` (`--json` byte-determinism)

**Imports + fixture pattern** (verbatim mirror `test/skill-sync.test.js:18-54`):
```javascript
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGitHubRemote, detectOriginRepo } from '../../src/cli/polling.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-polling-home-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  // Sembrar config v0.7 con providers.github.repos válido
  writeFileSync(
    join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify({
      provider: 'github',
      providers: {
        github: { api_key_env: 'GITHUB_TOKEN', repos: [{owner:'foo',repo:'bar'}], poll_interval: 60 },
      },
    }, null, 2),
  );
  writeFileSync(join(tmpHome, '.kodo', '.env'), 'GITHUB_TOKEN=fake_token_for_test\n');
  return { tmpHome };
}
```

**Spawn child with timeout** (mirror `test/skill-sync.test.js:68-79`):
```javascript
function runCli({ tmpHome, args = [] }) {
  return spawnSync(
    process.execPath,
    [KODO_BIN, 'polling', ...args],
    {
      env: { ...process.env, HOME: tmpHome, NO_COLOR: '1' },
      encoding: 'utf-8',
      timeout: 10000,  // DoS mitigation
    },
  );
}
```

**`--json` byte-determinism assertion** (verbatim mirror `test/skill-sync.test.js:346-353`):
```javascript
it('D-21 status --json byte-deterministic idle (4 keys con null)', () => {
  const { tmpHome } = makeFixture();
  try {
    const result = runCli({ tmpHome, args: ['status', '--json'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout,
      /^\{"status":"idle","pid":null,"started_at":null,"repos":null\}\n$/);
    assert.equal(/\x1b\[/.test(result.stdout), false);  // NO ANSI leak
  } finally { rmSync(tmpHome, { recursive: true, force: true }); }
});
```

**Exit-code assertion** (mirror `test/skill-sync.test.js:320-326`):
```javascript
it('D-14 start sin config → exit 2 + stderr canonical', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-polling-noconfig-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  // NO config.json → ensureConfig dispara wizard (que fallará sin stdin) — usar config sin repos
  writeFileSync(join(tmpHome, '.kodo', 'config.json'),
    JSON.stringify({ provider: 'github', providers: { github: { repos: [] }}}));
  try {
    const result = runCli({ tmpHome, args: ['start'] });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Error: providers\.github\.repos is empty/);
  } finally { rmSync(tmpHome, { recursive: true, force: true }); }
});
```

**parseGitHubRemote unit fixtures** (RESEARCH §Example 5 verbatim):
```javascript
describe('parseGitHubRemote', () => {
  const FIXTURES = [
    ['git@github.com:owner/repo.git',          { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo',          { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo.git',      { owner: 'owner', repo: 'repo' }],
    ['https://gitlab.com/owner/repo.git',      null],
    ['',                                        null],
  ];
  for (const [url, expected] of FIXTURES) {
    it(`parses ${url || '(empty)'}`, () => {
      assert.deepEqual(parseGitHubRemote(url), expected);
    });
  }
});
```

---

### `test/cli/polling-daemon.test.js`

**Analog:** `test/skill-sync.test.js:93-130` (afterEach + mkdtempSync + lstatSync verifications)

**Atomic write assertion** (mirror polling.js saveStateCache test convention):
```javascript
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('writePidFile / readPidFile', () => {
  let tmpHome;
  afterEach(() => { if (tmpHome) rmSync(tmpHome, { recursive: true, force: true }); });

  it('writePidFile escribe atomic con 0o600 permisos', () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-'));
    process.env.HOME = tmpHome;
    // re-import after HOME override
    delete require.cache; // ESM equivalent: dynamic import
    // ...invocar writePidFile y assert statSync().mode & 0o777 === 0o600
  });

  it('readPidFile fail-open: corrupted JSON → null', () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-corrupt-'));
    // ...escribir basura, assert readPidFile() === null
  });

  it('readPidFile shape check: missing pid field → null', () => {
    // Defensive — Security V14 (PID injection)
  });
});
```

---

### `test/cli/wizard-github.test.js`

**Analog:** RESEARCH §Example 1 verbatim (DI `ask` function — no precedent stdin-mock en repo)
**NO usar:** monkeypatch global de `readline`. Patrón establecido nuevo.

**Scripted-readline pattern** (RESEARCH §Example 1):
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configureGithubProvider } from '../../src/cli/polling.js';

function scriptedAsk(answers) {
  let i = 0;
  return (_q) => Promise.resolve((answers[i++] || '').trim());
}

describe('configureGithubProvider (wizard branch DI)', () => {
  it('happy path: auto-detect + confirm + save', async () => {
    const ask = scriptedAsk(['GITHUB_TOKEN\n', 's\n', '\n']);
    const execGitRemote = () => 'git@github.com:klab/kodo.git\n';
    const providerConfig = {};
    await configureGithubProvider({ ask, providerConfig, execGitRemote });
    assert.deepEqual(providerConfig.repos, [{ owner: 'klab', repo: 'kodo' }]);
    assert.equal(providerConfig.api_key_env, 'GITHUB_TOKEN');
    assert.equal(providerConfig.poll_interval, 60);
  });

  it('rejects invalid repo (no slash) → re-prompts', async () => {
    const ask = scriptedAsk([
      'GITHUB_TOKEN\n', 'n\n',
      'invalidrepo\n',  // missing slash → retry (NO recursión — Pitfall #9)
      'owner/repo\n', '\n',
    ]);
    const providerConfig = {};
    await configureGithubProvider({ ask, providerConfig, execGitRemote: () => '' });
    assert.deepEqual(providerConfig.repos, [{ owner: 'owner', repo: 'repo' }]);
  });

  it('token nunca persistido a providerConfig (security D-02)', async () => {
    const ask = scriptedAsk(['GITHUB_TOKEN\n', '\n']);  // skip auto-detect (empty exec)
    const providerConfig = {};
    await configureGithubProvider({ ask, providerConfig, execGitRemote: () => '' });
    const serialized = JSON.stringify(providerConfig);
    assert.equal(/ghp_|github_pat_/.test(serialized), false);  // sin token literal
    // Solo el NAME del env var, NO el value
    assert.equal(providerConfig.api_key_env, 'GITHUB_TOKEN');
    assert.equal('GITHUB_TOKEN' in providerConfig, false);  // NO key llamada `GITHUB_TOKEN`
  });
});
```

---

### `test/cli/orchestrate-polling.test.js`

**Analog:** `test/skill-sync.test.js:69-79` (spawn child + timeout) + RESEARCH §Validation Architecture "SIGINT capture"

**SIGINT cleanup integration test**:
```javascript
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

it('CFG-04: SIGINT detiene polling cleanly (no timers huérfanos)', async () => {
  const { tmpHome } = makeFixture(); // con providers.github.repos válido
  const child = spawn(
    process.execPath,
    [KODO_BIN, 'orchestrate', '--polling'],
    { env: { ...process.env, HOME: tmpHome, NO_COLOR: '1' }, stdio: 'pipe' },
  );
  await sleep(500);  // dar tiempo a montar polling timer
  process.kill(child.pid, 'SIGINT');
  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(exitCode, 0, 'SIGINT debe exit 0 tras stop() cleanup');
});

it('CFG-04: sin repos → exit 2', async () => {
  const tmpHome = makeFixtureWithEmptyRepos();
  const result = spawnSync(
    process.execPath, [KODO_BIN, 'orchestrate', '--polling'],
    { env: { ...process.env, HOME: tmpHome }, encoding: 'utf-8', timeout: 5000 },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /providers\.github\.repos is empty/);
});
```

---

### `test/fixtures/configs/v0.6-no-github.json`

**Analog:** `src/config.js:32-67` DEFAULT_CONFIG (shape v0.6 verbatim — solo Plane).

**Content** (D-23 — verifica CFG-02 zero-breaking-change):
```json
{
  "provider": "plane",
  "providers": {
    "plane": {
      "base_url": "https://tasks.kintsugi-lab.com",
      "api_key_env": "PLANE_API_KEY",
      "workspace_slug": "klab",
      "projects": [{"id": "abc", "identifier": "KL", "name": "klab"}],
      "states": { "trigger": "In Progress", "review": "In review", "done": "Done" }
    }
  },
  "cmux": { "binary": "/Applications/cmux.app/Contents/Resources/bin/cmux" },
  "claude": { "default_model": "opus", "max_parallel": 3 },
  "server": { "port": 9090 }
}
```

### `test/fixtures/configs/v0.7-github.json`

**Analog:** RESEARCH §D-06 verbatim.

```json
{
  "provider": "github",
  "providers": {
    "github": {
      "api_key_env": "GITHUB_TOKEN",
      "repos": [{"owner": "klab", "repo": "kodo"}],
      "poll_interval": 60,
      "mcp_hint": "GitHub MCP server",
      "states": { "review": "closed" }
    }
  },
  "cmux": { "binary": "/Applications/cmux.app/Contents/Resources/bin/cmux" },
  "claude": { "default_model": "opus", "max_parallel": 3 },
  "server": { "port": 9090 }
}
```

---

### `test/migration.test.js` (MODIFY)

**Analog:** `test/migration.test.js:82-143` (config migration suite — extender, no reescribir).

**Pattern to add** (mirror exacto del style local + carga via JSON.parse de fixture):
```javascript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'configs');

describe('config v0.6 → v0.7 zero-breaking-change (Phase 26)', () => {
  it('CFG-02: fixture v0.6 (sin providers.github) carga idéntica via migrateConfig', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'v0.6-no-github.json'), 'utf-8'));
    const result = migrateConfig(raw);
    // Ya tiene providers.plane → return tal cual (line 83 short-circuit)
    assert.equal(result, raw, 'mismo reference — sin migration');
    // NO se inyecta providers.github (D-07/D-08 invariante)
    assert.equal('github' in (result.providers || {}), false);
  });

  it('CFG-02: fixture v0.7 carga idempotente (segundo migrate === primero)', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'v0.7-github.json'), 'utf-8'));
    const once = migrateConfig(raw);
    const twice = migrateConfig(once);
    assert.equal(once, twice);
    assert.deepEqual(once.providers.github.repos, [{ owner: 'klab', repo: 'kodo' }]);
  });

  it('D-08 DEFAULT_CONFIG NO contiene providers.github', async () => {
    const { DEFAULT_CONFIG } = await import('../src/config.js');
    assert.equal('github' in (DEFAULT_CONFIG.providers || {}), false);
  });
});
```

## Shared Patterns

### Pattern A — Color isolation (todas las CLI surfaces nuevas)
**Source:** `src/cli/format.js:114-178` (createFormatter factory)
**Source enforcement:** `test/skill-sync.test.js:369-384` (source-hygiene grep)
**Apply to:** `src/cli/polling.js`, `src/cli/polling-daemon.js`
**Excerpt** (verbatim style guard):
```javascript
import { createFormatter } from './format.js';
// NEVER: import * as pc from 'picocolors';  // FORBIDDEN
const fmt = createFormatter(process.stdout);
write(`${fmt.ok('running')} pid: ${payload.pid}`);
```
**Source-hygiene test contract** (mirror `test/skill-sync.test.js:374-380`):
```javascript
const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'polling.js'), 'utf-8');
assert.equal(/from\s+['"]picocolors['"]/.test(stripComments(cliHandler)), false,
  'src/cli/polling.js no debe importar picocolors — solo createFormatter');
```

### Pattern B — Exit-code-deterministic CLI handler con DI
**Source:** `src/cli/skill-sync.js:40-84`
**Apply to:** los 3 handlers de polling.js (`runPollingStartCli`, `runPollingStopCli`, `runPollingStatusCli`) + `configureGithubProvider`
**Excerpt:**
```javascript
/** @returns {Promise<number>} exit code per Dxx contract */
export async function runXxxCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  // ... gate checks → return 2 / 3
  // ... main path → return 0
  // ... try/catch FS → return 1
}
```
**Stderr message contract** (verbatim style — mirror `src/cli/skill-sync.js:53`):
```
Error: <human-readable reason>\n
```

### Pattern C — Atomic tmp+rename file write
**Source:** `src/triggers/polling.js:149-154` (saveStateCache)
**Apply to:** `src/cli/polling-daemon.js` (writePidFile)
**Excerpt:**
```javascript
mkdirSync(dirname(path), { recursive: true });
const tmp = path + '.tmp';
writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
chmodSync(tmp, 0o600);  // PID file: token-adjacent
renameSync(tmp, path);  // POSIX-atomic (same FS)
```

### Pattern D — SIGINT/SIGTERM cleanup
**Source:** `src/server.js:490-495`
**Apply to:** `src/cli/polling.js` (`--no-daemon` path) + `src/cli.js` (`orchestrate --polling` action)
**Excerpt:**
```javascript
const cleanup = () => {
  try { /* polling.stop() | unlinkSync(PID_PATH) */ } catch {}
  process.exit(0);
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
```

### Pattern E — `isPidAlive` reuse (NO duplicar)
**Source:** `src/gsd/lock.js:67-74`
**Apply to:** `src/cli/polling.js` (start pre-flight, stop wait loop, status liveness)
**Excerpt:**
```javascript
import { isPidAlive } from '../gsd/lock.js';
if (isPidAlive(payload.pid)) { /* alive — running */ }
// POSIX semantics: ESRCH → dead; EPERM → conservatively alive
```

### Pattern F — Spawn child HOME-isolated (tests integration)
**Source:** `test/skill-sync.test.js:68-79`
**Apply to:** `test/cli/polling.test.js`, `test/cli/orchestrate-polling.test.js`
**Excerpt:**
```javascript
spawnSync(process.execPath, [KODO_BIN, 'polling', ...args], {
  env: { ...process.env, HOME: tmpHome, NO_COLOR: '1' },
  encoding: 'utf-8',
  timeout: 10000,  // DoS guard
});
```

### Pattern G — `--json` byte-determinism assertion
**Source:** `test/skill-sync.test.js:346-353`
**Apply to:** `test/cli/polling.test.js` (status --json), todos los new CLI handlers con `--json`
**Excerpt:**
```javascript
assert.match(result.stdout, /^\{"status":"idle","pid":null,"started_at":null,"repos":null\}\n$/);
assert.equal(/\x1b\[/.test(result.stdout), false);  // NO ANSI leak (LOG-12 + DX-06)
```

### Pattern H — Early-return en wizard branch (NO recursión)
**Source:** `src/cli.js:383-386` (Plane apiKey missing — clean return)
**Apply to:** `src/cli/polling.js::configureGithubProvider` + rama github en `interactiveConfig`
**Anti-pattern guard (Pitfall #9):** NUNCA `return interactiveConfig()` desde la rama github.

## No Analog Found

Ningún archivo cae en este bucket. Phase 26 es 100% pattern-covered:
- Daemon spawn (Example 2) — pattern Node.js stdlib documentado, no novel para el repo (extiende `src/server.js` PID convention).
- Scripted-readline test (Example 1) — pattern NUEVO para el repo pero estructura DI estándar; el planner debe codificarlo y futuros wizards lo reusarán.
- `getDefaultGithubProviderConfig` — factory pattern trivial (mirror DEFAULT_CONFIG style).

## Metadata

**Analog search scope:**
- `src/cli/` (todos los handlers existentes)
- `src/cli.js` (todos los comandos registrados)
- `src/config.js` (DEFAULT_CONFIG + migration)
- `src/triggers/polling.js` (Phase 25 atomic write + startPolling signature)
- `src/server.js` (PID lifecycle + SIGINT cleanup)
- `src/gsd/lock.js` (isPidAlive reusable)
- `test/skill-sync.test.js` (canonical CLI integration test pattern)
- `test/migration.test.js` (config migration test pattern)

**Files scanned:** 8 source + 2 test = 10 archivos análogos, todos verificados con line numbers concretos.

**Pattern extraction date:** 2026-05-14

---

## PATTERN MAPPING COMPLETE

**Phase:** 26 - Config Wizard + CLI Integration
**Files classified:** 11
**Analogs found:** 11 / 11 (100% coverage)

### Coverage
- Files with exact analog: 9 (CLI handlers, atomic write, fixtures, migration test extension, color/exit-code patterns)
- Files with role-match analog: 2 (wizard DI test sin precedent stdin-mock; orchestrate SIGINT test extiende spawn-timeout pattern)
- Files with no analog: 0

### Key Patterns Identified
1. **CLI handler contract (Pattern B):** los 3 nuevos handlers `runPollingStartCli/StopCli/StatusCli` siguen verbatim la firma + exit-code switch + DI deps de `src/cli/skill-sync.js:40-84` (gate → return 2 → main → return 0 → catch → return 1, con `writeFn/errFn/formatterFn` inyectables).
2. **Atomic file write (Pattern C):** PID file lifecycle reusa exacto el patrón `tmp + chmod 0o600 + renameSync` de `src/triggers/polling.js:149-154` (saveStateCache). `KODO_DIR` import desde `src/config.js` (Pitfall #11).
3. **Color isolation (Pattern A):** todos los nuevos handlers consumen `createFormatter(stream)` de `src/cli/format.js`; cero imports directos de picocolors; source-hygiene grep mirror `test/skill-sync.test.js:374-380`.
4. **SIGINT cleanup (Pattern D):** mirror exacto `src/server.js:490-495` para `--no-daemon` y `orchestrate --polling`; sólo cambia el "qué se limpia" (PID file vs `polling.stop()`).
5. **isPidAlive reuse (Pattern E):** `src/gsd/lock.js:67-74` ya provee la primitiva — Phase 26 importa, NO duplica (3 callsites: pre-flight start, stop wait loop, status liveness).
6. **Test pattern (Patterns F+G):** spawnSync HOME-isolated + NO_COLOR=1 + timeout 10s + regex `^...\n$` para `--json` bytes (mirror verbatim `test/skill-sync.test.js`). Wizard tests usan DI `ask` (pattern NUEVO documentado en RESEARCH §Example 1).
7. **Wizard extension (Plane parity):** `interactiveConfig` se extiende mirror `src/cli.js:391-400` (Plane branch); rama github vive en `src/cli/polling.js::configureGithubProvider` (DI-zable) y se invoca desde un único punto de extensión.
8. **Zero-breaking-change schema (D-07/D-08):** `migrateConfig` short-circuit en `src/config.js:83` (`if (rawConfig.providers) return rawConfig`) cubre v0.6 → v0.7 sin código nuevo; sólo el wizard inyecta `providers.github` cuando el usuario lo elige.

### File Created
`/Users/alex/dev/klab/kodo/.planning/phases/26-config-wizard-cli-integration/26-PATTERNS.md`

### Ready for Planning
Pattern mapping completo. El planner puede ahora referenciar:
- Análogo + line numbers concretos para cada uno de los 11 archivos.
- 8 cross-cutting shared patterns (A-H) aplicables a múltiples plans.
- Excerpts directos para mirror — el planner no necesita re-derivar shape ni convenciones.
- Mapeo natural a 3 plans según RESEARCH §"Ready for Planning":
  - **Plan 01 (CFG-01 + CFG-02):** wizard branch + `configureGithubProvider` + `parseGitHubRemote` + 2 fixtures + 2 test files + `getDefaultGithubProviderConfig` factory.
  - **Plan 02 (CFG-03):** `src/cli/polling.js` (start/stop/status) + `src/cli/polling-daemon.js` + 2 test files (incl. spawn detached integration).
  - **Plan 03 (CFG-04):** `kodo orchestrate --polling` flag + SIGINT cleanup + 1 test file.
