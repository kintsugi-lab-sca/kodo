// @ts-check
//
// src/cli/polling.js — Phase 26 polling CLI handlers + wizard branch helper.
//
// Exports:
//   Plan 26-01 (wizard + parser helpers):
//     - parseGitHubRemote(url) — pure regex parser para 3 URL formats github (SSH, HTTPS, HTTPS.git)
//     - detectOriginRepo(exec?) — auto-detect del git remote origin, fail-open ante errores
//     - configureGithubProvider({ ask, execGitRemote?, providerConfig }) — wizard branch DI-zable
//
//   Plan 26-02 (daemon CLI handlers — CFG-03 / D-09..15 / D-14 exit codes):
//     - runPollingStartCli(opts, deps?) — daemon (default) o foreground (--no-daemon)
//     - runPollingStopCli(opts, deps?) — SIGTERM + 5s wait + SIGKILL fallback
//     - runPollingStatusCli(opts, deps?) — idle|running con --json byte-deterministic
//
// Color isolation (D-20 / Pattern A invariante v0.5): NO importar `picocolors` aquí.
// El status handler usa `createFormatter` desde `./format.js`. El `--json` branch
// NO usa formatter (byte-determinism DX-06 / D-21).
//
// Import strategy (W-6 LOCKED): `startPolling` y el registry de providers se cargan
// VIA `await import('../triggers/polling.js')` LAZY dentro del `--no-daemon`
// branch — el parent `start/stop/status` handler no debe pagar el coste de Phase 25
// si solo se ejecuta status o stop.

import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { createFormatter } from './format.js';
import { isPidAlive } from '../gsd/lock.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { EVENTS } from '../logger-events.js';
import {
  writePidFile,
  readPidFile,
  removePidFile,
  getPidPath,
} from './polling-daemon.js';

/**
 * Parsea una URL de remote git de GitHub a `{owner, repo}`.
 *
 * Soporta los 3 formatos comunes:
 *   1. `git@github.com:owner/repo.git`     (SSH)
 *   2. `https://github.com/owner/repo`     (HTTPS sin .git)
 *   3. `https://github.com/owner/repo.git` (HTTPS con .git)
 *
 * Retorna `null` para hostnames no-github (gitlab, enterprise.github.com), URLs vacías,
 * o cualquier string que no matchee. El caller decide UX (skip auto-detect → manual prompt).
 *
 * Regex anchored en `github.com[:/]` para mitigar T-26-INJ (URLs maliciosas):
 *   - `[^/]+` para owner — no permite `/` dentro del owner.
 *   - `[^/.\s]+?` para repo — lazy, no permite `/`, `.`, ni whitespace.
 *   - `(?:\.git)?` opcional — strip si presente.
 *   - `(?:\/|\s|$)` lookahead — debe terminar al final, en whitespace, o en otro `/`.
 *
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitHubRemote(url) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/|\s|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Intenta auto-detectar el repo desde `git remote get-url origin` en el cwd actual.
 *
 * Retorna `null` si:
 *   - cwd no es un repo git, o
 *   - no hay remote `origin`, o
 *   - git no está instalado, o
 *   - el remote no es github.com (gitlab, enterprise, etc.)
 *
 * Pitfall #6 — fail-open: cualquier throw de `execSync` se traga y devuelve `null`.
 * El caller cae al manual prompt sin crash.
 *
 * Seguridad (T-26-SHELL): `execSync` se invoca con una string literal SIN args
 * controlados por el operador — no hay shell interpolation. `stdio: ['ignore','pipe','ignore']`
 * silencia stderr para evitar leaks accidentales.
 *
 * @param {() => string} [exec] — injectable para tests
 * @returns {{ owner: string, repo: string } | null}
 */
export function detectOriginRepo(exec) {
  const e = exec || (() => execSync('git remote get-url origin',
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  try {
    return parseGitHubRemote(e().trim());
  } catch {
    return null;
  }
}

/**
 * Wizard branch `provider: github` (D-01..D-06) — DI-zable para tests.
 *
 * Muta `providerConfig` in-place con el shape D-06 verbatim:
 *   {
 *     api_key_env: string,            // nombre de env var, default 'GITHUB_TOKEN'
 *     repos: Array<{owner, repo}>,    // ≥0 repos
 *     poll_interval: number,          // default 60
 *     mcp_hint: string,               // default 'GitHub MCP server'
 *     states: { review: string },     // default { review: 'closed' }
 *   }
 *
 * Pasos (mirror D-02..D-05):
 *   1. Pregunta nombre de env var (NO el value — T-26-01 security invariant).
 *   2. Auto-detect repo origin via `detectOriginRepo`; ofrece añadirlo.
 *   3. Loop manual add: parse `owner/repo`; valida exactamente un `/` no vacío.
 *      Input inválido → `continue` el while (NO recursión — Pitfall #9 / Pattern H).
 *   4. Aplica defaults D-06 si las claves no están presentes.
 *
 * Este helper NO escribe a stdout — el caller (rama github en `src/cli.js`) hace
 * el resumen final via `createFormatter` (D-20 LOCKED color isolation).
 *
 * @param {{
 *   ask: (q: string) => Promise<string>,
 *   execGitRemote?: () => string,
 *   providerConfig: Record<string, any>,
 * }} deps
 * @returns {Promise<void>}
 */
export async function configureGithubProvider({ ask, execGitRemote, providerConfig }) {
  // D-02: API key env var name. NO escribimos el VALUE del token (T-26-01).
  const defaultEnv = providerConfig.api_key_env || 'GITHUB_TOKEN';
  const envNameRaw = await ask(`  Variable de entorno para API key [${defaultEnv}]: `);
  const envName = envNameRaw.trim();
  providerConfig.api_key_env = envName || defaultEnv;

  providerConfig.repos = providerConfig.repos || [];

  // D-03: auto-detect origin
  const detected = detectOriginRepo(execGitRemote);
  if (detected) {
    const yesRaw = await ask(`  Detectado: ${detected.owner}/${detected.repo} — ¿añadir? [S/n]: `);
    const yes = yesRaw.trim().toLowerCase();
    if (yes === '' || yes === 's') {
      providerConfig.repos.push(detected);
    }
  }

  // D-04: manual add loop con validación "exactamente un /"
  // NO recursión (Pitfall #9): continue ante input inválido, break en Enter vacío.
  while (true) {
    const inputRaw = await ask('  Repo (owner/repo, Enter para terminar): ');
    const input = inputRaw.trim();
    if (input === '') break;
    const parts = input.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      continue;
    }
    providerConfig.repos.push({ owner: parts[0], repo: parts[1] });
  }

  // D-06 shape defaults (poll_interval/mcp_hint/states inyectados ahora)
  providerConfig.poll_interval = providerConfig.poll_interval || 60;
  providerConfig.mcp_hint = providerConfig.mcp_hint || 'GitHub MCP server';
  providerConfig.states = providerConfig.states || { review: 'closed' };
}

// ─── Plan 26-02 (CFG-03 / D-09..15): daemon CLI handlers ───────────────────────

/**
 * Resuelve el path absoluto al binario `bin/kodo` desde `src/cli/polling.js`.
 *
 * Usado en el daemon spawn para garantizar A6 (elevation-of-privilege mitigation:
 * cero PATH lookup; `process.execPath` + KODO_BIN absoluto + argv array form).
 *
 * @returns {string}
 */
function resolveKodoBin() {
  // src/cli/polling.js → ../../bin/kodo
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'kodo');
}

/**
 * @typedef {{ noDaemon?: boolean, json?: boolean, verbose?: boolean }} PollingStartCliOpts
 *
 * @typedef {{
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   configFn?: () => any,
 * }} PollingCliDeps
 */

/**
 * Handler de `kodo polling start` — daemon (default) o foreground (--no-daemon).
 *
 * Exit codes (D-14 LOCKED):
 *   - 0: daemon spawned + PID file written ≤2s; o --no-daemon SIGINT clean exit.
 *   - 1: PID file vivo (already running); o daemon spawn timeout; o Windows daemon refuse.
 *   - 2: gate config missing (repos vacío o GITHUB_TOKEN no set).
 *
 * Cross-platform (W-2 LOCKED / Pitfall #8): el daemon path emite warn
 * "Windows daemon unsupported. Use `--no-daemon` instead." + exit 1 cuando
 * `process.platform === 'win32'` (refuse-with-guidance variant). El path
 * `--no-daemon` es cross-platform.
 *
 * @param {PollingStartCliOpts} opts
 * @param {PollingCliDeps} [deps]
 * @returns {Promise<number>} exit code
 */
export async function runPollingStartCli(opts, deps = {}) {
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const cfgFn = deps.configFn || loadConfig;

  // Gate D-14 exit 2: config missing o token missing.
  const config = cfgFn();
  const reposRaw = config?.providers?.github?.repos || [];
  if (reposRaw.length === 0) {
    err('Error: providers.github.repos is empty. Run `kodo config` first.\n');
    return 2;
  }
  // Resolver el env var name desde la config injectada (NO loadConfig cached).
  // Default 'GITHUB_TOKEN' si la config no define api_key_env (mirror D-06 default).
  const envVarName = config?.providers?.github?.api_key_env || 'GITHUB_TOKEN';
  if (!process.env[envVarName]) {
    err(`Error: ${envVarName} not set. Export it or add to ~/.kodo/.env.\n`);
    return 2;
  }

  // --no-daemon (foreground) path — cross-platform.
  if (opts.noDaemon === true) {
    return runForegroundPolling({ config, reposRaw, verbose: opts.verbose === true });
  }

  // Daemon path — Windows refuse-with-guidance FIRST (W-2 LOCKED / Pitfall #8).
  if (process.platform === 'win32') {
    err('Error: Windows daemon unsupported. Use `kodo polling start --no-daemon` instead.\n');
    return 1;
  }

  // Pre-flight Pitfall #3: check en padre antes del spawn (NO en hijo).
  const existing = readPidFile();
  if (existing && isPidAlive(existing.pid)) {
    err(`Error: polling daemon already running (pid ${existing.pid}).\n`);
    return 1;
  }
  if (existing) {
    // stale PID file (file present pero proceso muerto) — limpia y procede.
    removePidFile();
  }

  // Spawn detached child con argv absolute (Security T-26-EOP elevation mitigation).
  // Phase 28 D-07: propagate --verbose to the daemon child so its summary lines
  // surface in the logfile (via fd redirect, owned by Plan 28-03 / D-13).
  const KODO_BIN = resolveKodoBin();
  const child = spawn(
    process.execPath,
    [
      KODO_BIN,
      'polling',
      'start',
      '--no-daemon',
      ...(opts.verbose === true ? ['--verbose'] : []),
    ],
    { detached: true, stdio: 'ignore', env: process.env },
  );
  child.unref(); // Pitfall #2 crítico — sin esto el padre cuelga.

  // Bounded wait D-10 timeout 2s: poll PID file + isPidAlive.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const payload = readPidFile();
    if (payload && isPidAlive(payload.pid)) return 0;
    await sleep(50);
  }
  err('Error: daemon failed to write PID file within 2s.\n');
  return 1;
}

/**
 * Branch `--no-daemon` — foreground polling con SIGINT/SIGTERM cleanup (Pattern D).
 *
 * Lazy imports (W-6 LOCKED): `startPolling` y `providers/registry` se cargan
 * via `await import(...)` para que el parent module no pague el coste si solo
 * se llama `status` o `stop`.
 *
 * Phase 28 D-07/D-09 changes:
 *   - `createLogger` se construye SIEMPRE (BLOCKER #1 fix de la phase: pre-28
 *     foreground NO propagaba logger → polling.tick / polling.dispatch nunca
 *     llegaban al sink NDJSON raíz). Cambio adyacente acceptable declarado en
 *     el plan 28-02 objective: el sink raíz `~/.kodo/logs/<session>.ndjson` es
 *     el diseñado para telemetría estructurada (D-18 Phase 28 separation of
 *     concerns), así que propagar logger en foreground es desiderable.
 *   - Cuando `verbose === true`, wrapeamos el logger con un proxy que duplica
 *     `polling.tick.summary` a `process.stdout`: TTY → columnar humano via
 *     `createFormatter` (D-09), no-TTY → NDJSON byte-determinístico (DX-06).
 *   - Cualquier otro evento que pase por logger.info (polling.tick per-repo,
 *     polling.dispatch) sigue al sink NDJSON sin tocar stdout — el operador
 *     foreground solo ve la summary line por tick, mantenemos signal:noise.
 *
 * @param {{ config: any, reposRaw: Array<{owner: string, repo: string}>, verbose?: boolean }} ctx
 * @returns {Promise<number>}
 */
async function runForegroundPolling({ config, reposRaw, verbose = false }) {
  // W-6 LOCKED — lazy import dentro del branch foreground.
  const { startPolling } = await import('../triggers/polling.js');
  const { initRegistry, getProvider } = await import('../providers/registry.js');
  await initRegistry();
  const provider = getProvider('github');

  // Phase 28 D-07: SIEMPRE construir baseLogger para propagar telemetría al
  // sink NDJSON raíz, independientemente de --verbose. Pre-Phase-28 foreground
  // ejecutaba startPolling SIN logger, perdiendo polling.tick / polling.dispatch
  // / polling.tick.summary del archivo de telemetría diseñado para recogerlos.
  const baseLogger = createLogger({ sessionId: 'polling', minLevel: 'info' });
  const logger = verbose
    ? wrapLoggerForSummary(baseLogger, createFormatter(process.stdout), process.stdout)
    : baseLogger;

  const handle = startPolling({
    provider,
    repos: reposRaw,
    intervalSec: config?.providers?.github?.poll_interval || 60,
    logger,
  });

  // Write PID file (D-15 shape: human-readable "owner/repo" strings).
  writePidFile({
    pid: process.pid,
    started_at: new Date().toISOString(),
    repos: reposRaw.map((r) => `${r.owner}/${r.repo}`),
  });

  // SIGINT/SIGTERM cleanup (Pattern D — mirror src/server.js:490-495).
  const cleanup = () => {
    try { handle.stop(); } catch { /* idempotent */ }
    removePidFile();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Block forever — startPolling tiene su propio timer loop.
  await new Promise(() => {});
  return 0; // unreachable; satisfaces TS contract.
}

/**
 * Logger wrapper para `--verbose`: delega todo al baseLogger Y duplica
 * `polling.tick.summary` al stream provisto. Mirror del patrón "tap" de
 * Phase 16 `markSessionStatus` — interceptamos solo el evento específico,
 * el resto pasa transparente.
 *
 * Rendering:
 *   - TTY (`stream.isTTY === true` y NO `KODO_JSON`/`KODO_VERBOSE_JSON` env)
 *     → línea columnar humana via `createFormatter`. Mirror del patrón D-09
 *     Phase 14: `dim(timestamp) · cyan(event) · key=value · key=value · ...`.
 *   - No-TTY o `--json` → NDJSON byte-determinístico (`JSON.stringify(record) + '\n'`).
 *     Preserva DX-06 invariant (mismos bytes TTY/no-TTY cuando `--json`).
 *
 * Color isolation D-07 (Phase 14): el rendering pasa por `createFormatter`
 * provisto por el caller — NO importamos `picocolors` aquí. El test guard
 * `test/format-isolation.test.js` blinda esto.
 *
 * @param {import('../logger.js').Logger} baseLogger
 * @param {import('./format.js').Formatter} fmt
 * @param {NodeJS.WriteStream} stream
 * @returns {import('../logger.js').Logger}
 */
function wrapLoggerForSummary(baseLogger, fmt, stream) {
  /** @type {import('../logger.js').Logger} */
  const wrapped = {
    info(msg, ctx) {
      baseLogger.info(msg, ctx);
      if (msg === EVENTS.POLLING_TICK_SUMMARY) {
        const record = ctx || {};
        // No-TTY → NDJSON byte-determinístico (DX-06).
        // TTY + no --json → columnar humano via createFormatter (D-09).
        const isTTY = Boolean(stream && stream.isTTY);
        const useJsonOverride = process.env.KODO_JSON === '1';
        if (isTTY && !useJsonOverride) {
          const ts = new Date().toISOString();
          const rl =
            record.rate_limit_remaining == null ? '—' : String(record.rate_limit_remaining);
          const line =
            fmt.dim(ts) +
            ' · ' +
            fmt.cyan(EVENTS.POLLING_TICK_SUMMARY) +
            ' · repos=' +
            String(record.repos_polled) +
            ' · dispatched=' +
            String(record.total_dispatches) +
            ' · rl=' +
            rl +
            '\n';
          stream.write(line);
        } else {
          // NDJSON: stringify SOLO los 4 fields D-10 + el event tag para que el
          // consumer pueda parsear sin ambigüedad. NO incluimos `level` ni `timestamp`
          // del logger record (esos viven en el sink NDJSON raíz).
          const payload = {
            event: EVENTS.POLLING_TICK_SUMMARY,
            repos_polled: record.repos_polled,
            total_dispatches: record.total_dispatches,
            rate_limit_remaining: record.rate_limit_remaining,
            repos: record.repos,
          };
          stream.write(JSON.stringify(payload) + '\n');
        }
      }
    },
    warn(msg, ctx) {
      baseLogger.warn(msg, ctx);
    },
    error(msg, ctx) {
      baseLogger.error(msg, ctx);
    },
    debug(msg, ctx) {
      baseLogger.debug(msg, ctx);
    },
    child(bindings) {
      // Child loggers delegan al baseLogger.child (sin tap — child no debería
      // estar en el path crítico de polling.tick.summary, pero por consistencia
      // de la interfaz Logger lo exponemos).
      return baseLogger.child(bindings);
    },
  };
  return wrapped;
}

/**
 * Handler de `kodo polling stop`.
 *
 * Exit codes (D-14 LOCKED):
 *   - 0: stop exitoso (SIGTERM o stale cleanup).
 *   - 3: no daemon vivo (PID file ausente).
 *
 * D-12: envía SIGTERM, espera hasta 5s con isPidAlive loop, si vivo → SIGKILL,
 * cleanup PID file. ESRCH (proceso ya muerto) → cleanup + exit 0 (mirror
 * src/server.js:516-519 stale cleanup).
 *
 * @param {{ json?: boolean }} _opts
 * @param {PollingCliDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runPollingStopCli(_opts, deps = {}) {
  const err = deps.errFn || ((s) => process.stderr.write(s));

  const payload = readPidFile();
  if (!payload) {
    err('Error: no polling daemon running.\n');
    return 3;
  }

  try {
    process.kill(payload.pid, 'SIGTERM');
    // D-12: 5s wait, luego SIGKILL fallback.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isPidAlive(payload.pid)) {
      await sleep(100);
    }
    if (isPidAlive(payload.pid)) {
      try { process.kill(payload.pid, 'SIGKILL'); } catch { /* race: died between checks */ }
    }
    removePidFile();
    return 0;
  } catch (e) {
    // ESRCH = proceso ya estaba muerto → stale cleanup, exit 0.
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ESRCH') {
      removePidFile();
      return 0;
    }
    throw e;
  }
}

/**
 * Handler de `kodo polling status`.
 *
 * Exit code (D-13 LOCKED): SIEMPRE 0 — status query nunca falla.
 *
 * Output:
 *   - `--json`: byte-deterministic single-line JSON con 4 keys SIEMPRE
 *     (Pitfall #10 / D-21): `{status, pid, started_at, repos}`. Null cuando idle.
 *     NO usa createFormatter (DX-06 invariant — bytes idénticos TTY/no-TTY).
 *   - TTY (default): legible con colores via createFormatter (D-20 LOCKED).
 *
 * @param {{ json?: boolean }} opts
 * @param {PollingCliDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runPollingStatusCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));

  const payload = readPidFile();
  const alive = payload != null && isPidAlive(payload.pid);

  if (opts.json === true) {
    // D-21 / Pitfall #10: SIEMPRE las 4 keys, null cuando idle.
    /** @type {Record<string, any>} */
    const json = {
      status: alive ? 'running' : 'idle',
      pid: alive ? payload.pid : null,
      started_at: alive ? payload.started_at : null,
      repos: alive ? payload.repos : null,
    };
    write(JSON.stringify(json) + '\n');
  } else {
    // D-20 LOCKED: createFormatter para output coloreado TTY-aware.
    const fmt = createFormatter(process.stdout);
    if (alive) {
      write(`${fmt.ok('running')} pid: ${payload.pid}, started: ${payload.started_at}\n`);
    } else {
      write(`${fmt.dim('idle')}\n`);
    }
  }
  return 0;
}
