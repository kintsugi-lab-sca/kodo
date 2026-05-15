# Phase 26: Config Wizard + CLI Integration - Research

**Researched:** 2026-05-14
**Domain:** CLI ergonomics — interactive wizard extension + Node.js daemon pattern (spawn/detached) + PID-file lifecycle + orchestrator wiring
**Confidence:** HIGH (todo el delta vive en código del repo; el único patrón nuevo — daemon `spawn detached + unref` — está documentado en Node docs y replica `src/server.js` SIGINT cleanup precedent).

## Summary

Phase 26 cierra el milestone v0.7 wireando lo que ya está shipeado (`GitHubClient` Phase 23, `GitHubProvider` Phase 24, `startPolling()` Phase 25) a la superficie CLI que el operador toca. No hay riesgo de research-bound novedad: las 24 decisiones de `26-CONTEXT.md` están locked y el delta es estrictamente aditivo. El planner sólo necesita:

1. Extender `interactiveConfig()` (`src/cli.js:344`) con una rama `selectedProvider === 'github'` que reusa el helper `ask` ya construido.
2. Añadir tres subcomandos `kodo polling {start,stop,status}` con el patrón canónico `kodo gsd <sub>` / `kodo skill <sub>` (`src/cli.js:241,277`).
3. Añadir un flag `--polling` a `kodo orchestrate` que invoca `startPolling({...})` en-proceso con SIGINT cleanup análogo a `src/server.js:490-495`.
4. Sembrar el schema `providers.github` **sólo cuando el wizard lo escribe** — NO modificar `DEFAULT_CONFIG` (D-08; preserva CFG-02 zero-breaking-change).

**Primary recommendation:** Construir el daemon como `spawn(process.execPath, [bin/kodo, 'polling', 'start', '--no-daemon'], { detached: true, stdio: 'ignore' }) + child.unref()`. El proceso hijo escribe `~/.kodo/polling.pid` (tmp + rename atómico, JSON shape `{pid, started_at, repos}`) y registra SIGTERM/SIGINT cleanup. La distinción daemon vs no-daemon vive exclusivamente en el padre — el path `--no-daemon` es el código real; daemon es sólo "fork-me-then-exit". Esta simetría elimina el problema clásico de detached-Node-daemons donde foreground y background divergen en code paths.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wizard — `kodo config` con provider: github**
- **D-01:** Extender `availableProviders` en `interactiveConfig` (`src/cli.js:355`) de `['plane']` a `['plane', 'github']`. Reusar lista numerada + Enter selecciona default `1`.
- **D-02:** Para `provider: github`, pedir `GITHUB_TOKEN` como env var (`api_key_env`, default `GITHUB_TOKEN`) — espejo Plane. NO escribir el token a `config.json`; sugerir `export GITHUB_TOKEN=...` si no está set (Phase 23 ya lee `~/.kodo/.env`).
- **D-03:** Auto-detect repos via `git remote get-url origin`. Regex: `github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?(?:/|$)`. Si parsea: prompt `Detectado: <owner>/<repo> — ¿añadir? [S/n]`.
- **D-04:** Tras auto-detect, permitir add manual uno-a-uno con prompt `Repo (owner/repo, Enter para terminar): `. Validar: exactamente un `/`.
- **D-05:** Resumen final antes de `saveConfig`: lista repos + `poll_interval` + `Guardar? [S/n]`.

**Schema extension — `~/.kodo/config.json`**
- **D-06:** Shape default `providers.github = { api_key_env: 'GITHUB_TOKEN', repos: [], poll_interval: 60, mcp_hint: 'GitHub MCP server', states: { review: 'closed' } }`. `repos` es array de `{owner, repo}` objects (alineado con `startPolling.opts.repos`).
- **D-07:** `loadConfig` ya migra v1→v2 (Plane). Phase 26 NO añade migración. Configs v0.6 sin `providers.github` cargan idéntico.
- **D-08:** `DEFAULT_CONFIG` en `src/config.js` NO se modifica. Default `providers.github` se aplica sólo en runtime dentro de `interactiveConfig` cuando el usuario elige `github`.

**Daemon CLI — `kodo polling start/stop/status`**
- **D-09:** Comando padre `kodo polling` con 3 subcomandos. NO flags directos en `kodo` raíz.
- **D-10:** `kodo polling start` default daemon — `spawn` desorbitado (`detached: true`, `stdio: 'ignore'`, `unref()`); el hijo escribe PID file atómico; padre exit `0` tras confirmar PID file escrito (timeout 2s).
- **D-11:** `kodo polling start --no-daemon` — foreground; llama directo a `startPolling({...})`; SIGINT/SIGTERM cancelan vía `stop()`.
- **D-12:** `kodo polling stop` — lee PID file, envía `SIGTERM`, espera 5s, si vivo → `SIGKILL`; borra PID file. Sin PID file → exit `3`.
- **D-13:** `kodo polling status` — lee PID file, verifica proceso vivo con `process.kill(pid, 0)` (reusar `isPidAlive` de `src/gsd/lock.js:67`); si vivo → `running (pid: N, started: ISO)`; si no → `idle`. Exit `0` siempre.
- **D-14:** Exit codes: `0` ok, `1` ya corriendo, `2` no config, `3` stop sin daemon vivo.
- **D-15:** PID file shape: `{ pid, started_at, repos: ["owner/repo", ...] }` JSON. Atomic tmp+rename.

**Orchestrator wiring — `kodo orchestrate --polling`**
- **D-16:** `kodo orchestrate` acepta `--polling`. Valida `providers.github.repos` no vacío y `GITHUB_TOKEN` set, arranca `startPolling({...})` integrado.
- **D-17:** **Mutex implícito vía lock per-repo Phase 8 GSD-10** — RESOLVES Open Q CFG-04. Documentar en `--help` del flag. Razón: simplicity-first + lock per-repo ya provee la propiedad esencial.
- **D-18:** `--polling` captura SIGINT/SIGTERM y llama `stop()` antes de exit.
- **D-19:** Sin `--polling`, `kodo orchestrate` comportamiento idéntico (zero breaking change).

**Color & format**
- **D-20:** Wizard + `kodo polling status` consumen `createFormatter(stream)` de `src/cli/format.js`. NO `picocolors` directo.
- **D-21:** `kodo polling status --json` byte-determinista (DX-06).

**Testing strategy**
- **D-22:** Tests offline. Wizard: stub `readline`. Daemon: spawn niño en fixture y verificar PID file + exit codes.
- **D-23:** Fixture `test/fixtures/configs/v0.6-no-github.json` verifica `loadConfig` lee sin error.
- **D-24:** Test `kodo orchestrate --polling` SIGINT cleanup — assert no timers pendientes.

### Claude's Discretion
- Estructura interna del git-remote parser (regex inline vs función dedicada).
- Si wizard ofrece reordenar/eliminar repos (UX nicety; mínimo viable add-only).
- Si `kodo polling status` muestra info adicional (`last_tick`, `dispatches_this_session`).

### Deferred Ideas (OUT OF SCOPE)
- Multi-token rotation, web UI / dashboard polling, mutex explícito daemon ↔ orchestrator, `kodo polling restart`, `kodo polling tail`, auto-detect múltiples remotes.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | `kodo config` reconoce `provider: github`, pide `GITHUB_TOKEN`, auto-detect repos | Wizard scaffolding existe (`interactiveConfig` `src/cli.js:344`); git remote parser nuevo (Code Example #5); Phase 23 `getProviderApiKey('github')` reusa `~/.kodo/.env` |
| CFG-02 | `~/.kodo/config.json` schema extendido `providers.github`; configs v0.6 cargan idéntico | D-07/D-08: NO migration, NO modificar `DEFAULT_CONFIG`; fixture v0.6 prueba zero-breaking-change |
| CFG-03 | `kodo polling start/stop/status` daemon + exit codes deterministas | Patrón daemon Node.js `spawn detached + unref + PID file`; precedent `src/server.js:490-495` SIGINT cleanup; `isPidAlive` existe en `src/gsd/lock.js:67` |
| CFG-04 | `kodo orchestrator --polling` integrado; mutex implícito | `startPolling({...}) → {stop}` API ya shipeada Phase 25; lock per-repo Phase 8 GSD-10 provee mutex |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wizard interactivo (`kodo config`) | CLI handler (`src/cli.js`) | Config persistence (`src/config.js`) | Stdin/stdout en proceso CLI; `saveConfig` ya provee la escritura atómica |
| Git remote parsing | CLI handler | — | Pure function; sin I/O excepto `child_process.execSync('git remote get-url origin')` ejecutado en wizard |
| Token storage | Filesystem (`~/.kodo/.env`) | — | Phase 23 establece — NO en `config.json` (security domain); wizard sugiere `export`, no escribe |
| Schema persistence | Config layer (`src/config.js`) | — | `saveConfig({ provider: 'github', providers: { ..., github: {...} } })` |
| `kodo polling start` daemon launch | CLI parent process | OS process tree (detached child) | Node `child_process.spawn` con `detached: true`; el padre exit tras confirmar PID file |
| `kodo polling start --no-daemon` | CLI process directo | `startPolling()` Phase 25 | Sin fork; el proceso CLI **es** el daemon |
| PID file lifecycle | Filesystem (`~/.kodo/polling.pid`) | — | Atomic tmp+rename (espejo Phase 25 state cache); cleanup en SIGTERM/SIGINT handler |
| `kodo polling status` liveness check | CLI handler | `process.kill(pid, 0)` POSIX | Reusar `isPidAlive` de `src/gsd/lock.js:67` (NO duplicar) |
| `kodo orchestrate --polling` integration | CLI orchestrator handler | `startPolling()` Phase 25 (in-process) | Tasca async paralela al `launchOrchestrator`; mutex implícito vía lock per-repo Phase 8 |
| Output formatting | `createFormatter(stream)` de `src/cli/format.js` | — | Invariante v0.5 color isolation; `--json` byte-determinismo DX-06 |

### System Architecture Diagram

```
┌──────────────────── kodo CLI (operator entry) ──────────────────┐
│                                                                  │
│  kodo config ──────► interactiveConfig() ──► saveConfig()       │
│                       │                                          │
│                       ├─► [provider:github branch]              │
│                       │     ├── ask GITHUB_TOKEN env var name   │
│                       │     ├── execSync `git remote get-url`   │
│                       │     ├── parseGitHubRemote(url)          │
│                       │     ├── confirm `add detected? [S/n]`   │
│                       │     ├── prompt add more (manual loop)   │
│                       │     └── summary → confirm → save        │
│                       │                                          │
│                       └─► saveConfig({providers.github={...}})  │
│                                                                  │
│  kodo polling start ──┬──[default]──► spawn(child, detached=t)  │
│                       │                    │                     │
│                       │                    └──► writePidFile()  │
│                       │                                          │
│                       └──[--no-daemon]──► startPolling()        │
│                                              │                   │
│                                              └─► SIGINT→stop()  │
│                                                                  │
│  kodo polling stop ──► readPidFile() ──► kill(pid, SIGTERM)    │
│                                                                  │
│  kodo polling status ──► readPidFile() ──► isPidAlive(pid)     │
│                                                                  │
│  kodo orchestrate ────┬──[default]──────► launchOrchestrator()  │
│                       │                                          │
│                       └──[--polling]────► launchOrchestrator()  │
│                                            + startPolling()     │
│                                              (in-process)       │
│                                              + SIGINT→stop()   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───── ~/.kodo/ ────────┐
                  │  .env (GITHUB_TOKEN)  │  ◄── Phase 23
                  │  config.json          │  ◄── Phase 26 extends
                  │  polling-state.json   │  ◄── Phase 25
                  │  polling.pid (NEW)    │  ◄── Phase 26
                  └───────────────────────┘
```

## File Inventory

### CREATE
| Path | Purpose | Approx LOC |
|------|---------|-----------|
| `src/cli/polling.js` | Action handlers para `polling start/stop/status` + helper `parseGitHubRemote` (export para tests) | ~250 |
| `src/cli/polling-daemon.js` | Helpers `writePidFile`, `readPidFile`, `removePidFile`, `PID_PATH` const | ~80 |
| `test/cli/polling.test.js` | Tests offline para los 3 subcomandos + exit codes + `--json` byte-determinismo | ~400 |
| `test/cli/polling-daemon.test.js` | Tests unit para PID file atomic write + read + remove | ~150 |
| `test/cli/wizard-github.test.js` | Tests para wizard branch `provider:github` (scripted readline) | ~300 |
| `test/cli/orchestrate-polling.test.js` | Test SIGINT cleanup para `kodo orchestrate --polling` | ~100 |
| `test/fixtures/configs/v0.6-no-github.json` | Config fixture v0.6 (sin `providers.github`) — verifica zero-breaking-change | ~30 |
| `test/fixtures/configs/v0.7-github.json` | Config fixture v0.7 (con `providers.github`) — verifica load idempotente | ~40 |

### MODIFY
| Path | Change | Approx LOC delta |
|------|--------|-----------------|
| `src/cli.js` | (1) extender `interactiveConfig` con rama `github` (`:355` + branch al final ~ línea 525); (2) registrar `kodo polling` parent + 3 subcomandos; (3) añadir flag `--polling` a `kodo orchestrate` + SIGINT handler | +200 |
| `src/config.js` | Añadir helper exportado `getDefaultGithubProviderConfig()` (factory para shape D-06) — opcional pero recomendado para que el wizard NO inline el shape | +15 |
| `test/migration.test.js` | Añadir `describe('config v0.6 → v0.7 zero-breaking-change')` con el fixture v0.6 | +30 |

### DELETE
Ninguno. Phase 26 es estrictamente aditivo (CFG-02 invariante).

### NO TOUCH (explicit)
- `bin/kodo` (thin shim — Commander parsea desde `src/cli.js`).
- `src/triggers/polling.js` (Phase 25 API ya definitiva).
- `src/providers/github/*` (Phase 23/24).
- `src/labels.js` (invariante v0.2).
- `test/check-isolation.test.js` (los handlers viven en `src/cli.js` y `src/cli/polling.js`, ambos fuera del grafo de `check.js` — no nueva fila requerida).

## Code Examples

### Example 1 — Wizard scripted-readline test pattern

Patrón canonical: stub `readline.createInterface` via DI (no monkeypatch global). Si `interactiveConfig` es difícil de DI-zar tal como está hoy, refactorizar la rama `github` a un helper exportado `configureGithubProvider({ ask, providerConfig })` que recibe `ask` como dependencia.

```javascript
// test/cli/wizard-github.test.js — scripted answers pattern
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { configureGithubProvider } from '../../src/cli.js'; // export añadido por Phase 26

describe('wizard provider:github branch', () => {
  it('auto-detect + confirm + save (happy path)', async () => {
    const answers = [
      'GITHUB_TOKEN\n',     // env var (default accepted)
      's\n',                // confirm auto-detected klab/kodo
      '\n',                 // Enter terminate manual add loop
      'S\n',                // confirm save summary
    ];
    let i = 0;
    const ask = (_q) => Promise.resolve(answers[i++].trim());
    const execGitRemote = () => 'git@github.com:klab/kodo.git\n';

    const providerConfig = {};
    await configureGithubProvider({ ask, providerConfig, execGitRemote });

    assert.deepEqual(providerConfig.repos, [{ owner: 'klab', repo: 'kodo' }]);
    assert.equal(providerConfig.api_key_env, 'GITHUB_TOKEN');
    assert.equal(providerConfig.poll_interval, 60);
    assert.equal(providerConfig.mcp_hint, 'GitHub MCP server');
    assert.deepEqual(providerConfig.states, { review: 'closed' });
    assert.equal(i, answers.length, 'all scripted answers consumed');
  });

  it('reject auto-detected repo, add manual one', async () => {
    const ask = scriptedAsk(['GITHUB_TOKEN\n', 'n\n', 'foo/bar\n', '\n', 'S\n']);
    const providerConfig = {};
    await configureGithubProvider({
      ask, providerConfig,
      execGitRemote: () => 'https://github.com/klab/kodo\n',
    });
    assert.deepEqual(providerConfig.repos, [{ owner: 'foo', repo: 'bar' }]);
  });

  it('manual entry rejects invalid (no slash)', async () => {
    const ask = scriptedAsk([
      'GITHUB_TOKEN\n', 'n\n',     // skip auto-detect
      'invalidrepo\n',              // missing slash → retry
      'owner/repo\n', '\n', 'S\n',  // valid then terminate
    ]);
    const providerConfig = {};
    await configureGithubProvider({ ask, providerConfig, execGitRemote: () => '' });
    assert.deepEqual(providerConfig.repos, [{ owner: 'owner', repo: 'repo' }]);
  });
});

function scriptedAsk(answers) {
  let i = 0;
  return (_q) => Promise.resolve((answers[i++] || '').trim());
}
```

Alternativa: spawnSync sobre `bin/kodo config` con `input:` strings — mismo patrón que `test/skill-sync.test.js:69-79` (HOME aislado + NO_COLOR=1). Más caro pero exhibe el wizard de extremo a extremo.

### Example 2 — Spawn detached daemon entry point

Patrón canonical Node.js para daemon UNIX. Crítico: el padre debe `child.unref()` **inmediatamente** tras spawn — si no, el padre no puede salir hasta que el hijo termine.

```javascript
// src/cli/polling.js — daemon spawn pattern (D-10)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { PID_PATH } from './polling-daemon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_BIN = join(__dirname, '..', '..', 'bin', 'kodo');

/**
 * Daemon launcher — spawn the kodo CLI itself in --no-daemon mode,
 * detached from the parent process group.
 *
 * Critical pattern:
 *   1. detached: true        — child gets its own process group
 *   2. stdio: 'ignore'       — drop stdin/out/err so parent can exit
 *   3. child.unref()         — remove from parent's event loop ref count
 *   4. wait for PID file     — bounded by timeout (D-10: 2s)
 *
 * @returns {Promise<{ pid: number, started_at: string, repos: string[] }>}
 */
export async function startDaemon() {
  // Pre-flight: PID file already exists with live process → exit 1.
  if (existsSync(PID_PATH)) {
    const existing = JSON.parse(readFileSync(PID_PATH, 'utf-8'));
    if (isPidAlive(existing.pid)) {
      return { alreadyRunning: true, ...existing };
    }
    // Stale PID file — remove before fork.
    try { unlinkSync(PID_PATH); } catch {}
  }

  const child = spawn(
    process.execPath,                              // /usr/local/bin/node
    [KODO_BIN, 'polling', 'start', '--no-daemon'],
    {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    },
  );
  child.unref();  // critical — parent can now exit

  // Wait for child to write PID file (bounded — D-10: 2s).
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (existsSync(PID_PATH)) {
      try {
        const payload = JSON.parse(readFileSync(PID_PATH, 'utf-8'));
        if (isPidAlive(payload.pid)) return payload;
      } catch { /* mid-rename — retry */ }
    }
    await sleep(50);
  }
  throw new Error('daemon failed to write PID file within 2s');
}
```

**Pitfall:** `child_process.fork()` (Node-specific IPC fork) NO sirve aquí — fork mantiene un IPC channel con el padre, lo que IMPIDE que el padre salga. Usar `spawn` con `process.execPath` + path absoluto a `bin/kodo`.

### Example 3 — PID file atomic write/read (espejo Phase 25 state cache)

```javascript
// src/cli/polling-daemon.js — PID file lifecycle
import { writeFileSync, readFileSync, renameSync, unlinkSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { KODO_DIR } from '../config.js';

export const PID_PATH = join(KODO_DIR, 'polling.pid');

/**
 * @typedef {{
 *   pid: number,
 *   started_at: string,    // ISO 8601
 *   repos: string[],       // ["owner/repo", ...] human-readable
 * }} PidFilePayload
 */

/**
 * Write the polling PID file atomically (tmp + rename, POSIX-only).
 * Pattern mirrors src/triggers/polling.js:149-154 saveStateCache.
 *
 * Permissions 0o600 (Security V6 — token-adjacent metadata; only owner reads).
 *
 * @param {PidFilePayload} payload
 */
export function writePidFile(payload) {
  mkdirSync(dirname(PID_PATH), { recursive: true });
  const tmp = PID_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  chmodSync(tmp, 0o600);  // before rename — concurrent reads see 0600 immediately
  renameSync(tmp, PID_PATH);
}

/** @returns {PidFilePayload | null} */
export function readPidFile() {
  if (!existsSync(PID_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(PID_PATH, 'utf-8'));
    // Defensive: required shape check.
    if (typeof parsed?.pid !== 'number' || typeof parsed?.started_at !== 'string') return null;
    return parsed;
  } catch {
    return null;  // fail-open like loadStateCache
  }
}

export function removePidFile() {
  try { unlinkSync(PID_PATH); } catch { /* may not exist */ }
}
```

### Example 4 — `kodo orchestrate --polling` SIGINT cleanup pattern

```javascript
// src/cli.js — orchestrate command, --polling branch (CFG-04 / D-18)
program
  .command('orchestrate')
  .description('Launch the orchestrator Claude session')
  .option('--polling', 'Arranca polling integrado en el orchestrator. NO usar con `kodo polling start` simultáneo sobre el mismo repo (mutex implícito vía lock per-repo Phase 8 GSD-10).')
  .action(async (opts) => {
    try {
      const { launchOrchestrator } = await import('./orchestrator/launch.js');
      const result = await launchOrchestrator();

      /** @type {{ stop: () => void } | null} */
      let pollingHandle = null;

      if (opts.polling) {
        // Validate config — fail-fast with exit 2 (CFG-03 contract).
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
        const provider = getProvider('github');

        pollingHandle = startPolling({
          provider,
          repos,
          intervalSec: config.providers.github.poll_interval || 60,
          // NO logger pass-through here — orchestrate doesn't own NDJSON sink;
          // polling.js falls back to console.error which is acceptable for
          // operator-facing integrated mode.
        });

        // D-18: SIGINT/SIGTERM cleanup — stop polling BEFORE process exit.
        const cleanup = () => {
          if (pollingHandle) pollingHandle.stop();
          process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      }

      // ... existing output logic for `result` ...
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Note:** Diverge del patrón `src/server.js:490-495` (que hace `unlinkSync(PID_PATH)` antes de exit). En `--polling` no hay PID file porque vive en el mismo proceso que el orchestrator — el cleanup sólo necesita cancelar el timer pendiente vía `stop()`.

### Example 5 — Git remote parser

```javascript
// src/cli/polling.js — git remote parser (D-03)
import { execSync } from 'node:child_process';

/**
 * Parse a GitHub remote URL to {owner, repo}. Supports the three common forms:
 *   1. `git@github.com:owner/repo.git`     (SSH)
 *   2. `https://github.com/owner/repo`     (HTTPS sin .git)
 *   3. `https://github.com/owner/repo.git` (HTTPS con .git)
 *
 * Returns null if the URL is not a github.com remote (e.g. enterprise GitHub,
 * GitLab, or a non-git URL). Caller decides UX (skip auto-detect → manual prompt).
 *
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitHubRemote(url) {
  // Permissive regex: anchors on github.com hostname, allows `:` (SSH) or `/` (HTTPS).
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/|\s|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Attempt git remote auto-detect from CWD. Returns null if not a git repo or
 * no `origin` remote, or remote is not github.com.
 *
 * Caller wraps this with the `s/n` confirmation prompt (D-03).
 *
 * @param {() => string} [exec]  // injectable for tests
 * @returns {{ owner: string, repo: string } | null}
 */
export function detectOriginRepo(exec) {
  const e = exec || (() => execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  try {
    const url = e().trim();
    return parseGitHubRemote(url);
  } catch {
    return null;  // not a git repo, no origin, or git not installed
  }
}
```

Test fixtures (3 URL formats — verbatim per CONTEXT additional_context):
```javascript
const FIXTURES = [
  ['git@github.com:owner/repo.git',          { owner: 'owner', repo: 'repo' }],
  ['https://github.com/owner/repo',          { owner: 'owner', repo: 'repo' }],
  ['https://github.com/owner/repo.git',      { owner: 'owner', repo: 'repo' }],
  ['https://gitlab.com/owner/repo.git',      null],
  ['',                                        null],
  ['https://github.enterprise.example.com/o/r', null],  // hostname mismatch
];
```

## Pitfalls

### 1. `process.kill(pid, 0)` con PID reusado
**Goes wrong:** Tras un crash, el OS puede reciclar el PID. `process.kill(<old_pid>, 0)` retorna `true` aunque el proceso vivo ahora sea, p.ej., `vim` no kodo. `kodo polling status` reportaría `running` y `kodo polling stop` mataría un proceso ajeno.

**Mitigation:**
- D-15 — el PID file incluye `started_at`; en `stop`, antes de `kill(pid, SIGTERM)`, leer `/proc/<pid>/stat` (Linux) o `ps -o lstart= -p <pid>` (macOS) y comparar contra `started_at`. Si diverge > 5s, considerar PID file stale y borrar sin matar.
- Alternativa Karpathy-simple (recomendada para v0.7): aceptar el riesgo. La probabilidad real en un Mac/Linux dev box es trivial (PID space 32-bit, segundos entre crash y rearranque); documentar como known limitation y revisar si emerge en operación. Reusar `isPidAlive` de `src/gsd/lock.js:67` sin enrichment.

### 2. `child.unref()` olvidado tras spawn detached
**Goes wrong:** `kodo polling start` (padre) NUNCA exitea. Quien escribe el comando ve la terminal "colgada" hasta `Ctrl-C`, momento en que el SIGINT propaga al hijo (porque eran el mismo process group hasta `detached: true` los separó — pero sin `unref()` el padre sigue refencing el child handle).

**Mitigation:** Acceptance test explícito — `spawnSync` el daemon-spawn handler con `timeout: 5000`; si exitcode != 0 cuando exceede timeout, fallar loud. Cubre D-10.

### 3. PID file race condition (write-then-check)
**Goes wrong:** El daemon (hijo) hace `existsSync(PID_PATH)` antes de `writePidFile`. Si dos `kodo polling start` arrancan en paralelo, ambos pasan el check (PID file no existe), ambos hacen fork, ambos escriben — última gana, primer daemon huérfano sin PID file.

**Mitigation:** El check de "ya corriendo" ocurre en el **padre** antes del spawn (Example 2). El hijo (no-daemon) escribe el PID file SIN check — si dos hijos arrancaron (race padre), el segundo simplemente overwrites; el primero queda huérfano pero su loop sigue dispatch idempotente vía lock per-repo (D-17). Fix completo requiere lockfile separado del PID file (overkill v0.7).

### 4. SIGINT no propaga al hijo desorbitado
**Goes wrong:** `Ctrl-C` en el terminal de `kodo polling start` (foreground del padre, antes de detached unref) **antes** de que el hijo escriba el PID file → el padre exit pero el hijo queda corriendo sin que `kodo polling stop` pueda encontrarlo (no PID file).

**Mitigation:** En el padre, registrar `SIGINT` handler que verifique PID file y, si ausente, mate al child explícitamente vía `child.pid` capturado en closure. Si el child ya escribió el PID file y se separó, el padre ya hizo `unref()` y SIGINT al padre no afecta al hijo (correcto comportamiento).

### 5. Daemon crash silencioso (stdio:'ignore')
**Goes wrong:** El hijo lanza una excepción en `startPolling()` (p.ej. `provider.init()` falla por `GITHUB_TOKEN` revocado). Con `stdio: 'ignore'`, el error se va a `/dev/null` y el operador no tiene cómo diagnosticar.

**Mitigation:** En el hijo (`--no-daemon` path), capturar `process.on('uncaughtException', ...)` y escribir a `~/.kodo/polling.err.log` antes de exit. El log es advisory — operadores con dudas hacen `cat ~/.kodo/polling.err.log`. Alternativa más simple: redirigir `stdout`/`stderr` del child a `~/.kodo/polling.log` via `fs.openSync` + `stdio: ['ignore', logFd, logFd]`. Verificar que no rompe el byte-determinismo de `--json`.

### 6. `git remote get-url origin` lanza excepción si no es repo
**Goes wrong:** Usuario ejecuta `kodo config` desde `~/Documents` (no git repo). `execSync` lanza `Command failed: git remote ...` y crashea el wizard.

**Mitigation:** D-03 — `detectOriginRepo()` (Example 5) wrappea `execSync` en try/catch; retorna `null`. Wizard cae al manual prompt. Acceptance: test con `execGitRemote: () => { throw new Error('not a git repo'); }` debe completar el flow sin crash.

### 7. `chmod 0o600` no aplica en macOS si dest exists
**Goes wrong:** Si el PID file ya existe con `0o644`, `renameSync(tmp, path)` preserva los permisos del tmp (que sí son 0o600 por nuestro chmod previo). PERO si el filesystem es exFAT/NTFS (no nativo POSIX en macOS), `chmod` es no-op y los permisos quedan default (typically world-readable).

**Mitigation:** kodo target es Mac/Linux con `~/` en APFS/ext4 — el caso exFAT es teórico. Documentar en Security Domain y aceptar. Si emerge: switch a `~/.kodo/` permissions check at startup (`stat ~/.kodo` → assert dir 0o700; si no, chmod + warn).

### 8. `child.detached + stdio:'ignore'` no funciona idéntico en Windows
**Goes wrong:** Phase 26 prioriza darwin/linux (D-22 implícito). En Windows, `detached: true` crea una nueva ventana de consola en lugar de desligar — el padre puede salir pero el daemon abre una terminal visible. Además, `process.kill(pid, 'SIGTERM')` en Windows es no-op (no hay SIGTERM real; Node lo traduce a `TerminateProcess`).

**Mitigation:** Documentar en `--help` que `kodo polling start` daemon mode es Mac/Linux only. Detectar `process.platform === 'win32'` y emitir warn + sugerir `--no-daemon`. Mantener `--no-daemon` path funcional cross-platform (foreground loop con Ctrl-C).

### 9. Wizard re-entra recursivamente tras error (existing pattern bug)
**Goes wrong:** El patrón actual `src/cli.js:517-520` hace `return interactiveConfig()` en retry — esto re-arranca **todo** el wizard, perdiendo selecciones previas. Si Phase 26 hereda el patrón, el usuario que ya configuró Plane y elige reintentar tras un error en la rama github vuelve al step 1 (selección provider).

**Mitigation:** No regresar al wizard completo desde la rama `github`. Si hay error en la validación (p.ej. `GITHUB_TOKEN` no set), imprimir instrucciones (`export GITHUB_TOKEN=...; kodo config`) y `rl.close(); return;`. Mismo patrón que el actual `src/cli.js:383-386` cuando Plane key no está set.

### 10. `--json` shape distinto entre `running` e `idle` rompe parseo
**Goes wrong:** `kodo polling status --json` cuando `idle` retorna `{"status":"idle"}` (3 campos null omitted). Cuando `running` retorna `{"status":"running","pid":1234,"started_at":"...","repos":[...]}`. Parsers downstream (jq pipelines, dashboards) deben handle keys ausentes.

**Mitigation:** D-21 — fix shape: SIEMPRE emitir las 4 keys, con `null` cuando idle. Specifies CONTEXT additional_context:
```json
{"status":"running"|"idle","pid":N|null,"started_at":"<iso>"|null,"repos":[{"owner","repo"}]|null}
```
Acceptance: test compara bytes contra fixture; ambas variantes con mismas keys.

### 11. CONFIG_PATH inconsistente entre wizard write y daemon read
**Goes wrong:** Phase 25 importa `KODO_DIR` de `../config.js` y construye `polling-state.json` ahí. Si Phase 26 mueve constantes a `src/cli/polling-daemon.js` y re-define `KODO_DIR` localmente (e.g. con un `homedir()` distinto), tests con HOME aislado fallan asymmetrically.

**Mitigation:** `src/cli/polling-daemon.js` imports `KODO_DIR` from `src/config.js` (canonical). Mirror `src/triggers/polling.js:73`. Acceptance test: process.env.HOME override propaga a PID_PATH.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (stdlib) + `node:assert/strict` |
| Config file | None (`package.json scripts.test` runs `node --test`) |
| Quick run command | `node --test test/cli/polling.test.js test/cli/wizard-github.test.js` |
| Full suite command | `npm test` |
| Estimated runtime | <2s quick; ~8-10s full suite (post-Phase-26: ~735 tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| CFG-01 | Wizard branch `github` ejecuta sin crash con scripted answers | unit | `node --test test/cli/wizard-github.test.js -g "happy path"` | W0 NEW |
| CFG-01 | `parseGitHubRemote` reconoce 3 URL formats (SSH, HTTPS, HTTPS.git) | unit | `node --test test/cli/polling.test.js -g "parseGitHubRemote"` | W0 NEW |
| CFG-01 | `parseGitHubRemote` retorna `null` para gitlab/enterprise/empty | unit | `node --test test/cli/polling.test.js -g "parseGitHubRemote rejects"` | W0 NEW |
| CFG-01 | `detectOriginRepo` survive `git: command not found` (execSync throw) | unit | `node --test test/cli/polling.test.js -g "detectOriginRepo fail-open"` | W0 NEW |
| CFG-01 | Wizard reject invalid repo (no slash) re-prompts | unit | `node --test test/cli/wizard-github.test.js -g "rejects invalid"` | W0 NEW |
| CFG-01 | Wizard reject auto-detect, manual entry succeeds | unit | `node --test test/cli/wizard-github.test.js -g "manual entry"` | W0 NEW |
| CFG-01 | Wizard NO escribe `GITHUB_TOKEN` value a `config.json` (security) | unit | `node --test test/cli/wizard-github.test.js -g "token never persisted"` | W0 NEW |
| CFG-02 | `loadConfig` lee fixture v0.6 sin error y sin inyectar `providers.github` | unit | `node --test test/migration.test.js -g "v0.6 zero-breaking"` | W0 NEW fixture |
| CFG-02 | `loadConfig` lee fixture v0.7 idempotente (segundo load === primero) | unit | `node --test test/migration.test.js -g "v0.7 idempotent"` | W0 NEW fixture |
| CFG-02 | `DEFAULT_CONFIG` NO contiene `providers.github` (D-08) | unit | `node --test test/migration.test.js -g "DEFAULT_CONFIG sin github"` | W0 |
| CFG-03 | `kodo polling start` (sin config) exit 2 + stderr canonical | integration | `spawnSync kodo polling start` con `HOME=tmpdir` | W0 NEW |
| CFG-03 | `kodo polling start --no-daemon` arranca y SIGINT detiene cleanly | integration | `spawn ... { detached:true }; setTimeout(kill,500)` | W0 NEW |
| CFG-03 | `kodo polling start` (daemon) escribe PID file ≤2s, padre exit 0 | integration | `spawnSync` + poll PID_PATH | W0 NEW |
| CFG-03 | `kodo polling start` con PID file vivo → exit 1 + msg "already running" | integration | spawn dos veces | W0 NEW |
| CFG-03 | `kodo polling status` (sin PID file) → `idle` exit 0 | integration | spawnSync | W0 NEW |
| CFG-03 | `kodo polling status` (con PID file + proceso vivo) → `running` exit 0 | integration | spawnSync + fake PID file con `process.pid` | W0 NEW |
| CFG-03 | `kodo polling status` (PID file stale, process dead) → `idle` exit 0 | integration | fake PID file con PID inexistente | W0 NEW |
| CFG-03 | `kodo polling status --json` byte-determinístico (idle) | integration | spawnSync + regex bytes | W0 NEW |
| CFG-03 | `kodo polling status --json` byte-determinístico (running) | integration | spawnSync + regex bytes | W0 NEW |
| CFG-03 | `kodo polling stop` (sin PID file) → exit 3 + stderr canonical | integration | spawnSync | W0 NEW |
| CFG-03 | `kodo polling stop` envía SIGTERM y borra PID file | integration | spawn `--no-daemon` luego stop | W0 NEW |
| CFG-03 | `writePidFile` atomic (tmp existe → rename → original ausente) | unit | unit con fs spies | W0 NEW |
| CFG-03 | `readPidFile` fail-open (corrupted JSON → null) | unit | escribir basura → assert null | W0 NEW |
| CFG-04 | `kodo orchestrate --polling` sin `repos` → exit 2 | integration | spawnSync con fixture v0.6 | W0 NEW |
| CFG-04 | `kodo orchestrate --polling` sin `GITHUB_TOKEN` → exit 2 | integration | spawnSync con env scrubbed | W0 NEW |
| CFG-04 | `kodo orchestrate --polling` arranca `startPolling` (assert mock invoked) | unit (in-process) | DI `startPollingFn` spy | W0 NEW |
| CFG-04 | `kodo orchestrate --polling` SIGINT llama `stop()` antes de exit | integration | spawn + kill + assert clean exit | W0 NEW |

### Sampling Rate
- **Per task commit:** `node --test test/cli/polling.test.js test/cli/wizard-github.test.js test/cli/polling-daemon.test.js test/cli/orchestrate-polling.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work` (baseline 715 + ~25 new = ~740 pass, 0 fail).

### Wave 0 Gaps
- [ ] `test/cli/polling.test.js` — covers CFG-03 (15+ cases) + helpers `parseGitHubRemote`, `detectOriginRepo`
- [ ] `test/cli/polling-daemon.test.js` — covers PID file write/read/remove atomicity
- [ ] `test/cli/wizard-github.test.js` — covers CFG-01 (scripted readline; ≥6 cases)
- [ ] `test/cli/orchestrate-polling.test.js` — covers CFG-04 (4 cases incl. SIGINT cleanup)
- [ ] `test/cli/` — directory does NOT exist; planner creates
- [ ] `test/fixtures/configs/` — directory does NOT exist; planner creates
- [ ] `test/fixtures/configs/v0.6-no-github.json` — config sin `providers.github`
- [ ] `test/fixtures/configs/v0.7-github.json` — config con `providers.github` poblado

### Mock Strategies

**Stdin mocking (wizard):** DI `ask` function. NO usar `readline` global override. Pattern: refactorizar la rama `github` de `interactiveConfig` a un helper `configureGithubProvider({ ask, execGitRemote, providerConfig })` exportado. Tests pasan `ask` que retorna `Promise.resolve(scripted_answer)`.

**Clock mocking (orchestrate SIGINT):** No requerido — el SIGINT cleanup es síncrono respecto del handler. Tests usan `setTimeout(() => process.kill(child.pid, 'SIGINT'), 200)` en wall-clock real (sub-300ms test).

**FS mocking (PID file):** NO mock. Usar `mkdtempSync` + `HOME` override (patrón `test/skill-sync.test.js:38-54`). El PID file vive en `~/.kodo/polling.pid`; setear `HOME=tmpdir` aísla cada test.

**SIGINT capture (daemon tests):** `spawn` el child real con `detached: true`; tras assert PID file escrito, hacer `process.kill(child.pid, 'SIGTERM')` y `child.on('exit', resolve)`. Bounded timeout 3s.

**Byte-determinism `--json`:** mismo patrón que `test/skill-sync.test.js:346-353` — `spawnSync` con `NO_COLOR=1`, assert `result.stdout` con regex exacto + `/\x1b\[/.test(stdout) === false`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes (token handling) | `GITHUB_TOKEN` via env var lookup; nunca persistido a `config.json` (D-02) |
| V3 Session Management | no | N/A — no sessions in CLI |
| V4 Access Control | partial | PID file `0o600` (only owner reads); polling daemon corre como user que lo arrancó |
| V5 Input Validation | yes | Wizard valida `owner/repo` shape (exactamente un `/`); `parseGitHubRemote` regex anchored on `github.com` |
| V6 Cryptography | yes | No hand-roll — `GITHUB_TOKEN` se delega a HTTPS standard (Phase 23 GitHubClient); nada cifrado en disk en Phase 26 |
| V7 Error Handling | yes | Error messages NO leak token value; exit codes deterministas (CFG-03) |
| V14 Configuration | yes | `~/.kodo/.env` y `~/.kodo/polling.pid` con permisos restrictivos |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leak to `config.json` (world-readable) | Information Disclosure | D-02: NEVER write token to config; wizard only suggests `export` |
| Token leak to NDJSON logs | Information Disclosure | T-25-02 invariant (Phase 25): polling.dispatch NDJSON excludes `issue.body` / token; Phase 26 daemon redirige stdio a logfile con `0o600` |
| PID file world-writable → DoS via PID injection | Tampering | `0o600` permissions on `polling.pid` + `readPidFile` defensive shape check (`typeof pid === 'number'`) |
| Wizard accepts malicious repo name (e.g. `../../../etc/passwd`) | Injection | Validar `repo` against `/^[A-Za-z0-9._-]+$/` después de split por `/` (NO en CONTEXT.md; recomendar añadir como discreción Claude) |
| `execSync('git remote get-url origin')` shell injection | Injection | NO shell — `execSync` without shell option doesn't pass through `/bin/sh`; argv array form |
| Daemon spawn arbitrary code via PATH hijack | Elevation of Privilege | Use `process.execPath` (absolute path to Node) + absolute path to `bin/kodo` — no PATH lookup |
| Stale daemon survives `kodo polling stop` and re-dispatches | DoS / Tampering | D-12: SIGTERM → 5s wait → SIGKILL; PID file removed post-kill |
| GitHub token rotation breaks daemon silently | Availability | Pitfall #5: error log at `~/.kodo/polling.err.log`; `kodo polling status` could show last error in v0.8 (defer) |

### Token Storage Specifics
- **NO escribir `GITHUB_TOKEN` value a ningún archivo en Phase 26.** El wizard solo:
  1. Lee `process.env[providerConfig.api_key_env]` (default `GITHUB_TOKEN`).
  2. Si no está set, imprime `Configura la variable: export GITHUB_TOKEN=...` y exits.
  3. Persiste **solo el env var name** en `providers.github.api_key_env` — nunca el value.
- Phase 23 establece que `~/.kodo/.env` carga via `loadEnvFile()` (`src/config.js:11-30`); el operador es libre de añadir `GITHUB_TOKEN=ghp_xxx` manualmente — kodo lo lee pero NO lo escribe.
- PID file (`~/.kodo/polling.pid`) NO contiene token (shape D-15 limited a `pid`, `started_at`, `repos`). Verificación por test source-hygiene: `grep -c "GITHUB_TOKEN\|api_key\|token" src/cli/polling-daemon.js` === 0.

### File Permissions
| File | Mode | Rationale |
|------|------|-----------|
| `~/.kodo/config.json` | 0o644 default (Node) | No secrets; OK world-readable |
| `~/.kodo/.env` | 0o600 (Phase 23 convention) | Contains token |
| `~/.kodo/polling.pid` | **0o600 (NEW)** | Token-adjacent metadata; defensive depth |
| `~/.kodo/polling.err.log` (if added) | 0o600 | May contain stack traces with redacted token fragments |

## Open Questions (RESOLVED)

**RESOLVED: CFG-04 mutex (daemon ↔ orchestrator integrated)**
- Resolution: D-17 — mutex implícito vía lock per-repo Phase 8 GSD-10. Documentado en `--polling` `--help` text.

**RESOLVED: Wizard test pattern**
- Resolution: Refactorizar rama `github` de `interactiveConfig` a helper exportado `configureGithubProvider({ ask, execGitRemote, providerConfig })`. Tests inyectan `ask` (DI). Patrón mirror el actual `test/skill-sync.test.js` para integration via spawnSync. No precedent of stdin-mock para wizard existe en el repo — Phase 26 lo establece.

**RESOLVED: Wizard re-entry on error**
- Resolution: Pitfall #9 — NO recursión a `interactiveConfig()` desde la rama github. Imprimir mensaje y exit-early (mirror `src/cli.js:383-386`).

**RESOLVED: PID file shape**
- Resolution: D-15 — `{ pid, started_at, repos: ["owner/repo", ...] }` (repos human-readable, no objects). Facilita `kodo polling status` informativo.

**RESOLVED: Status `--json` shape consistency (idle vs running)**
- Resolution: Pitfall #10 — siempre emitir las 4 keys; `null` cuando idle. Spec en CONTEXT additional_context.

**RESOLVED: Cross-platform daemon support**
- Resolution: Pitfall #8 — Phase 26 prioriza darwin/linux; Windows daemon mode emite warn y sugiere `--no-daemon`. `--no-daemon` path cross-platform.

**RESOLVED: Daemon stderr/stdout handling (stdio:'ignore' diagnostics gap)**
- Resolution: Pitfall #5 — redirigir stdout/stderr del child a `~/.kodo/polling.log` via `fs.openSync` + `stdio: ['ignore', logFd, logFd]`. Permisos `0o600`. Tests `--json` mantienen byte-determinismo porque corren con `--no-daemon` (sin redirect).

**RESOLVED: Where does `getDefaultGithubProviderConfig()` live**
- Resolution: Exported from `src/config.js` (NO inline en `src/cli.js`). Razón: simetría con `DEFAULT_CONFIG` ya ahí; testeable via `import { getDefaultGithubProviderConfig } from '../src/config.js'`.

**RESOLVED: Should `kodo orchestrate --polling` use the daemon path internally?**
- Resolution: NO. D-16 spec dice explícitamente "integrado en el mismo proceso del orchestrator (sin daemon separado)". `--polling` invoca `startPolling()` directamente in-process — el flag NO spawn fork.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 (`child_process.spawn` + globalThis.fetch) | All Phase 26 | ✓ (project baseline) | per package.json | — |
| `git` CLI | Wizard auto-detect (D-03) | ✓ (assumed dev env) | any | Pitfall #6: try/catch → manual prompt |
| POSIX signals (SIGTERM, SIGINT) | Daemon stop / orchestrate cleanup | ✓ (darwin/linux) | — | Pitfall #8: Windows degrades to `--no-daemon` |
| `process.kill(pid, 0)` for liveness check | `kodo polling status` | ✓ POSIX | — | Reuse `isPidAlive` `src/gsd/lock.js:67` |
| `fs.renameSync` atomic | PID file + state cache | ✓ POSIX | — | Phase 25 establishes Mac/Linux-only |

**Missing dependencies with no fallback:** None. Phase 26 sólo depende de Node stdlib + git (advisory).

## Project Constraints (from CLAUDE.md)

CLAUDE.md global vive en `~/.claude/CLAUDE.md` (no en repo). Directives aplicables:

- **Karpathy Rule 1 (Piensa antes de codificar):** Cada D-XX de CONTEXT.md declara assumptions explícitas. Researcher tagged claims con `[VERIFIED]` / `[ASSUMED]`.
- **Karpathy Rule 2 (Simplicidad primero):** D-17 mutex implícito vía lock per-repo es la elección simple. NO añadir lockfile separado en v0.7.
- **Karpathy Rule 3 (Cambios quirúrgicos):** File Inventory respeta — `DEFAULT_CONFIG` NO touched (D-08); `bin/kodo` NO touched; `src/triggers/polling.js` NO touched. Wizard branch extiende, no reescribe.
- **Karpathy Rule 4 (Goal-directed):** Criterios de éxito locked en ROADMAP §"Phase 26" 4 SC. Validation Architecture map 1:1.
- **Response language:** Spanish (CONTEXT additional_context).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `interactiveConfig` puede DI-zarse extrayendo la rama github a un helper sin romper Plane | Code Example #1 | Si Plane tests fallan tras refactor, Phase 26 expande scope a touch Plane wizard (Rule 3 violación). Mitigation: refactor mínimo — solo extract rama nueva, NO mover código Plane existente. |
| A2 | `spawn + detached: true + unref()` funciona idéntico en macOS 14+ y Linux 5.x mainstream | Code Example #2, Pitfall #8 | Si macOS bug emerge, fallback `--no-daemon`. Verificable empíricamente en CI Mac runner. [ASSUMED based on Node.js docs] |
| A3 | `chmod 0o600` antes de rename preserva mode tras rename en APFS/ext4 | Code Example #3, Security V14 | Si no preserva, switch a `chmodSync(PID_PATH, 0o600)` post-rename con catch. [ASSUMED — POSIX spec dice rename preserva metadata; verificar test] |
| A4 | Test runtime con HOME aislado + spawn child no leak entre tests | Validation Architecture | Si leak, tests flaky. Pattern probado en `test/skill-sync.test.js`. [VERIFIED: pattern existe Phase 21] |
| A5 | El operador no ejecuta `kodo config` desde un repo con `origin` apuntando a un fork (e.g. `myuser/kodo` en vez de upstream `klab/kodo`) | Code Example #5 | Wizard auto-detecta el fork, no el upstream. Mitigación UX: D-03 prompt `[S/n]` permite rechazar y entrar manual. [ASSUMED — known limitation, deferred según CONTEXT Deferred Ideas "auto-detect múltiples remotes"] |
| A6 | `process.execPath` siempre devuelve un path absoluto resolvable por el child | Code Example #2 | Si Node arranca por symlink raro, podría fallar. [VERIFIED: Node docs garantiza absolute path] |
| A7 | El child spawned con `detached: true + stdio: 'ignore'` puede escribir a `~/.kodo/polling.pid` sin permission denied | Code Example #3 | Si HOME no es writable (raro), child no escribe PID file y padre timeout 2s → throw. Mitigación: padre detecta y emite error claro. [VERIFIED por test] |
| A8 | `node:timers/promises.setTimeout` está disponible en Node 20+ | Code Example #2 | [VERIFIED — stable since Node 16] |

## Sources

### Primary (HIGH confidence — verified from source)
- `src/cli.js:19-63` — `kodo config` command structure + opts handling
- `src/cli.js:126-141` — `kodo orchestrate` command (target para `--polling` flag)
- `src/cli.js:241-275` — `kodo gsd <sub>` subcommand pattern
- `src/cli.js:277-296` — `kodo skill <sub>` subcommand pattern
- `src/cli.js:344-524` — `interactiveConfig()` full body (Plane branch para mirror)
- `src/config.js:1-176` — `DEFAULT_CONFIG`, `migrateConfig`, `loadConfig`, `saveConfig`, `getProviderApiKey`, `loadEnvFile`
- `src/cli/format.js:114-178` — `createFormatter(stream, env)` API
- `src/cli/skill-sync.js:1-112` — CLI handler pattern (exit codes, `--json` byte-determinismo, `createFormatter` consumption)
- `src/triggers/polling.js:415-478` — `startPolling({...}) → {stop}` canonical signature
- `src/triggers/polling.js:149-154` — `saveStateCache` atomic tmp+rename pattern (espejo para PID file)
- `src/server.js:482-495` — PID file write + SIGINT/SIGTERM cleanup precedent
- `src/server.js:503-523` — `stopServer()` PID kill + cleanup pattern
- `src/gsd/lock.js:54-74` — `isPidAlive(pid)` reusable helper
- `test/skill-sync.test.js:18-385` — full pattern reference: HOME-isolated fixtures + spawnSync child + `--json` bytes assertion + source-hygiene grep
- `test/migration.test.js:82-143` — config migration test pattern (fixture + assert no key leaks)
- `.planning/phases/23-githubclient-auth-foundation/23-02-SUMMARY.md` — `getProviderApiKey('github')` via `~/.kodo/.env` (NO config.json) confirmation
- `.planning/phases/25-polling-trigger-channel/25-02-SUMMARY.md` — `startPolling` final signature + clock-mock + atomic write patterns
- `.planning/phases/25-polling-trigger-channel/25-VALIDATION.md` — validation architecture template (consumed for Phase 26)
- `.planning/STATE.md:67-78` — Critical Invariants v0.7 (cwd=repo, lock per-repo, color isolation, --json byte-determinismo, worktree always-on, HOOK-01)
- `.planning/REQUIREMENTS.md:26-31` — CFG-01..04 verbatim
- `.planning/ROADMAP.md:65-74` — Phase 26 4 success criteria

### Secondary (MEDIUM confidence)
- Node.js child_process docs (`detached`, `unref`, `stdio: 'ignore'`) — well-established pattern; no version-specific gotcha for Node 20+
- POSIX rename(2) semantics — atomic on same filesystem; cross-filesystem requires copy+unlink (not our case; `~/.kodo/polling.pid` and `~/.kodo/polling.pid.tmp` always co-located)
- `process.kill(pid, 0)` permission semantics — kernel returns EPERM for cross-user PID checks; `isPidAlive` returns `true` for EPERM (conservatively alive) per `src/gsd/lock.js:72`

### Tertiary (LOW confidence — flagged)
- None. Phase 26 delta es mecánico — sin ambigüedad de novedad técnica.

## Metadata

**Confidence breakdown:**
- File inventory: HIGH — todos los paths verificados contra repo actual
- Code patterns: HIGH — todos los patterns existen en código verificable (Phase 21 + Phase 25 + `src/server.js`)
- Pitfalls: HIGH — 9/11 son patrones conocidos Node.js; 2/11 (Pitfall #1 PID reuse, Pitfall #7 chmod cross-filesystem) son ASSUMED low-prob edge cases
- Security: HIGH — Phase 23 establece el token NOT-in-config invariant; Phase 26 lo extiende sin relajar
- Validation: HIGH — pattern existing en `test/skill-sync.test.js` para todos los test types

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 días — Phase 26 surface area estable, no fast-moving deps)

## RESEARCH COMPLETE

**Phase:** 26 — config-wizard-cli-integration
**Confidence:** HIGH

### Key Findings
- Phase 26 es estrictamente aditivo: zero modification a `DEFAULT_CONFIG`, `src/triggers/polling.js`, `bin/kodo`, `src/labels.js`. CFG-02 invariante preservada por construcción.
- El daemon pattern (`spawn detached + unref + PID file atomic`) es novel en el repo pero sigue precedent `src/server.js:482-495` + `src/triggers/polling.js:149-154` (atomic write). Riesgo de novedad mínimo.
- `interactiveConfig` debe refactor mínimo: extraer rama `github` a helper exportado `configureGithubProvider({ ask, execGitRemote, providerConfig })` para enabling scripted-readline tests sin tocar la rama Plane (Karpathy Rule 3).
- `isPidAlive` ya existe en `src/gsd/lock.js:67` — Phase 26 lo reusa, NO duplica.
- 11 pitfalls catalogadas; 6 con mitigation locked a un D-ID, 5 con mitigation técnica nueva (Pitfalls #5, #7, #8, #10, #11) que el planner debe codificar en acceptance tests.
- 28+ test cases mapeados a CFG-01..04 con framework existing (`node --test` + `spawnSync` HOME-isolated). Wave 0 crea `test/cli/`, `test/fixtures/configs/`, 4 archivos test, 2 fixture configs.

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| File Inventory | HIGH | Paths verificados; deltas calculados con surgical-changes filter |
| Code Examples | HIGH | 4/5 derivados directamente de patrones existing; #2 (spawn detached) standard Node.js docs |
| Pitfalls | HIGH | 9/11 verificados; 2/11 marcados ASSUMED con mitigation propuesta |
| Validation | HIGH | Pattern + commands verificados en `test/skill-sync.test.js` y `test/migration.test.js` |
| Security | HIGH | Phase 23 establishes token storage invariant; Phase 26 extends |
| Open Questions | RESOLVED 8/8 | Todas las gray areas tienen resolution con cita a D-ID o Pitfall # |

### Open Questions
All resolved (see § "Open Questions (RESOLVED)"). Phase 26 no introduce blockers nuevos.

### Ready for Planning
Research complete. Planner puede ahora producir:
- `26-01-PLAN.md` — Wizard branch + helper `configureGithubProvider` + `parseGitHubRemote` + fixture configs + 2 test files (CFG-01, CFG-02)
- `26-02-PLAN.md` — `src/cli/polling.js` + `src/cli/polling-daemon.js` + 3 subcomandos + 2 test files (CFG-03)
- `26-03-PLAN.md` — `kodo orchestrate --polling` flag + SIGINT cleanup + 1 test file (CFG-04)

3 plans naturales por requirement clusters; el planner puede consolidar a 2 si CFG-02 (fixture-only) folds into CFG-01.

---
*Phase: 26-config-wizard-cli-integration*
*Research conducted: 2026-05-14 via /gsd-research-phase 26*
