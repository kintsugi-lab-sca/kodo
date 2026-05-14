---
phase: 26-config-wizard-cli-integration
plan: 02
subsystem: cli
tags: [cli, daemon, pid-file, polling, exit-codes, cross-platform]

# Dependency graph
requires:
  - phase: 26-config-wizard-cli-integration
    plan: 01
    provides: configureGithubProvider, parseGitHubRemote, detectOriginRepo (Plan 26-01 helpers en src/cli/polling.js extendido aquí)
  - phase: 25-polling-trigger-channel
    provides: startPolling({provider, repos, intervalSec}) — invocado via dynamic import en --no-daemon branch
  - phase: 24-githubprovider-normalizer-registry
    provides: getProvider('github') factory — invocado via dynamic import en --no-daemon branch
  - phase: 23-githubclient-auth-foundation
    provides: getProviderApiKey('github') / ~/.kodo/.env loader transitivamente via loadConfig
provides:
  - runPollingStartCli(opts, deps?) — daemon (default) o foreground (--no-daemon) con exit codes D-14
  - runPollingStopCli(opts, deps?) — SIGTERM + 5s wait + SIGKILL fallback + cleanup PID file
  - runPollingStatusCli(opts, deps?) — idle|running con --json byte-deterministic D-21
  - src/cli/polling-daemon.js: writePidFile/readPidFile/removePidFile/getPidPath/PID_PATH (PID file lifecycle)
  - kodo polling parent + start/stop/status subcomandos registrados en src/cli.js
affects: [26-03 orchestrator --polling integration (consume helpers de polling.js + polling-daemon.js)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Primer daemon CLI del repo (kodo polling start) — spawn detached + unref + atomic PID file lifecycle"
    - "Lazy import strategy W-6 LOCKED para Phase 25 startPolling (parent handler no paga coste si solo es status/stop)"
    - "getPidPath() lazy resolver homedir() — workaround Pitfall #11 cache ESM de src/config.js"
    - "Refuse-with-guidance Windows variant W-2 (Pitfall #8) con canonical stderr message"

key-files:
  created:
    - src/cli/polling-daemon.js
    - test/cli/polling-daemon.test.js
  modified:
    - src/cli/polling.js (extiende Plan 26-01 con 3 handlers + helper resolveKodoBin + runForegroundPolling)
    - src/cli.js (registra kodo polling parent + 3 subcomandos mirror kodo gsd/kodo skill)
    - test/cli/polling.test.js (extiende Plan 26-01 con 15 casos integration + Windows in-process)

key-decisions:
  - "Windows variant W-2: refuse-with-guidance (exit 1) — más explícito que fallback-to-foreground porque el operador eligió `kodo polling start` esperando daemon; el test caso 14 acepta ambas variantes pero documenté la elección."
  - "configFn injection: el handler resuelve api_key_env desde la config injectada (default 'GITHUB_TOKEN' fallback) + consulta process.env directamente en lugar de llamar getProviderApiKey — necesario para test Windows in-process porque getProviderApiKey internamente llama loadConfig() cacheado en ESM y no respeta HOME override."
  - "getPidPath() lazy en src/cli/polling-daemon.js: en lugar de `const PID_PATH = join(KODO_DIR, 'polling.pid')` import-time (que cachea homedir original), el módulo expone getPidPath() que computa homedir() en cada llamada. PID_PATH se mantiene como alias deprecated con Symbol.toPrimitive para uso legacy. Workaround Pitfall #11 sin tener que invalidar la cache ESM de src/config.js."
  - "Lazy imports W-6 LOCKED estricto: `await import('../triggers/polling.js')` y `await import('../providers/registry.js')` DENTRO de `runForegroundPolling()` (el --no-daemon branch). El parent `runPollingStartCli` NO paga el coste de cargar Phase 25 si solo se ejecuta status o stop."
  - "Pre-flight check Pitfall #3 en padre: readPidFile + isPidAlive ANTES del spawn detached para evitar race condition de doble daemon. Stale PID file (file present pero PID muerto) → removePidFile + procede."

patterns-established:
  - "Pattern A (color isolation D-20): runPollingStatusCli usa createFormatter(process.stdout) en TTY branch; --json branch lo evita explícitamente para preservar byte-determinism DX-06"
  - "Pattern D (SIGINT/SIGTERM cleanup): runForegroundPolling registra cleanup handler que invoca handle.stop() + removePidFile() + process.exit(0); idempotente (try/catch envuelve stop)"
  - "Pattern E (isPidAlive reuse): src/cli/polling.js importa isPidAlive de ../gsd/lock.js (8 callsites: 2 en start pre-flight, 3 en stop wait loop, 1 en status liveness). NO duplicado en polling-daemon.js (correcto: el módulo daemon es pure FS-I/O sin liveness checks — separación de concerns)"
  - "Pattern B exit-code-deterministic (D-14 LOCKED): 0 ok / 1 already-running o Windows daemon refuse / 2 no-config / 3 no-daemon para stop. Verificado verbatim por test names casos 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13"

requirements-completed: [CFG-03]

# Metrics
duration: ~20min
completed: 2026-05-14
---

# Phase 26 Plan 02: `kodo polling start/stop/status` daemon + PID lifecycle + exit codes Summary

**Daemon CLI `kodo polling` con spawn detached + atomic PID file (0o600) + exit codes deterministas + --json byte-deterministic + Windows refuse-with-guidance. Establece el primer daemon pattern del repo.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-14T17:53:21Z
- **Completed:** 2026-05-14T18:13:19Z (approx)
- **Tasks:** 3 (all type=auto tdd=true)
- **Files modified:** 3 modified + 2 created = 5 total

## Accomplishments

- **CFG-03 cerrado**: `kodo polling start/stop/status` daemon con exit codes deterministas (D-14: 0 ok / 1 already-running / 2 no-config / 3 no-daemon stop) y D-13 (status siempre 0). 15/15 casos integration GREEN incluyendo W-2 Windows guard + W-3 regex literal + W-4 fake PID con started_at.
- **Primer daemon pattern del repo**: spawn detached + child.unref() (Pitfall #2 crítico) + atomic tmp+rename PID file (mirror saveStateCache Phase 25) + chmod 0o600 PRE-rename (Security V14 token-adjacent metadata).
- **--json byte-deterministic** (D-21 / DX-06 / Pitfall #10): regex literal `^\{"status":"running","pid":\d+,"started_at":"[^"]+","repos":\["foo\/bar"\]\}\n$` verificado para running; idle siempre con 4 keys null (NO 3 keys omitidos). Sin createFormatter en --json branch — bytes idénticos TTY/no-TTY.
- **Lazy import strategy W-6 LOCKED**: `await import('../triggers/polling.js')` DENTRO de runForegroundPolling() — el parent `start/stop/status` handler no carga Phase 25 (≥100 LOC + transitive registry deps) si solo se invoca status o stop. Grep verificado: 0 static imports de triggers/polling.js, 2 lazy imports await import.
- **Cross-platform fallback W-2** (Pitfall #8): Windows daemon path emite stderr canonical `Error: Windows daemon unsupported. Use \`kodo polling start --no-daemon\` instead.` + exit 1 (refuse-with-guidance variant elegido). El path `--no-daemon` es cross-platform funcional.
- **Source-hygiene W-7 LOCKED**: polling-daemon.js cero literales `ghp_/github_pat_`; cero refs a `GITHUB_TOKEN/api_key` en código non-comment (verificado via grep refinado del plan).
- **Color isolation D-20 LOCKED Pattern A**: cero imports directos de picocolors en polling.js y polling-daemon.js; status handler usa createFormatter(process.stdout) para TTY branch.
- **isPidAlive reuse Pattern E**: importado de `../gsd/lock.js:67` en polling.js (8 callsites); NO duplicado en polling-daemon.js (separación de concerns: daemon module es pure FS-I/O).
- **Suite verde**: 756 tests, 755 pass, 0 fail, 1 skipped (heredado pre-plan). Baseline 736 + 20 nuevos casos = 756 (15 integration polling + 5 unit daemon).

## Task Commits

1. **Task 1: Wave 0 RED state (test scaffolds)** — `f461b9b` (test)
2. **Task 2: src/cli/polling-daemon.js (PID lifecycle GREEN)** — `997aab2` (feat)
3. **Task 3: 3 handlers CLI + kodo polling subcommands (GREEN)** — `d75e9dc` (feat)

## Files Created/Modified

- **CREATED** `src/cli/polling-daemon.js` (114 líneas) — exports `writePidFile`, `readPidFile`, `removePidFile`, `getPidPath`, `PID_PATH` (lazy alias). Atomic write con chmod 0o600 PRE-rename; readPidFile fail-open con defensive shape check (T-26-02 PID injection mitigation: typeof pid === 'number' / started_at === 'string' → null).
- **CREATED** `test/cli/polling-daemon.test.js` (107 líneas) — 5 casos unit: writePidFile atomic + chmod 0o600 + tmp ausente post-rename; readPidFile JSON corrupto → null; defensive shape check; existsSync false → null; removePidFile idempotente.
- **MODIFIED** `src/cli/polling.js` (extiende Plan 26-01 con 3 handlers nuevos + helpers): `runPollingStartCli`, `runPollingStopCli`, `runPollingStatusCli`, `resolveKodoBin` (helper), `runForegroundPolling` (helper privado). 4 imports estáticos nuevos: `spawn` de `node:child_process`, `fileURLToPath` de `node:url`, `dirname/join` de `node:path`, `sleep` (timers/promises). 4 imports locales nuevos: `createFormatter` de `./format.js`, `isPidAlive` de `../gsd/lock.js`, `loadConfig` de `../config.js`, `writePidFile/readPidFile/removePidFile/getPidPath` de `./polling-daemon.js`. Lazy imports W-6 LOCKED: `startPolling` y `initRegistry/getProvider` via `await import(...)` dentro de runForegroundPolling.
- **MODIFIED** `src/cli.js` — añade bloque `kodo polling <subcmd>` (parent + 3 subcomandos start/stop/status) mirror el patrón `kodo gsd <sub>` líneas 241-275 y `kodo skill <sub>` líneas 277-296. NO ensureConfig() — el handler start tiene su propio gate D-14 exit 2 para config missing. Commander `--no-daemon` se exposes como `opts.daemon === false`; mapeado al handler como `noDaemon: opts.daemon === false`.
- **MODIFIED** `test/cli/polling.test.js` (extiende Plan 26-01 con 15 casos integration + helpers): suite "kodo polling start" (casos 1, 1b, 2, 3, 4); suite "kodo polling status" (casos 5, 6, 7, 8, 9, 12); suite "kodo polling stop" (casos 10, 11, 13); suite "runPollingStartCli — Windows fallback W-2" (caso 14 in-process con Object.defineProperty platform + configFn DI injection). Helpers: `makeFixture({repos?, hasToken?})`, `writeFakePidFile({tmpHome, pid?, repos?})` (W-4 LOCKED — siempre incluye started_at + chmod 0o600), `runCli({tmpHome, args})` (NO_COLOR=1 + timeout 10s DoS guard). afterEach() limpia tmpHome con rmSync.

## Decisions Made

- **Windows variant W-2 ELEGIDA: refuse-with-guidance (exit 1)** — opcional alternativa fallback-to-foreground (exit 0) también aceptable per caso 14. Elegí refuse-with-guidance porque:
  1. El operador invocó `kodo polling start` explícitamente esperando daemon mode.
  2. Auto-fallback silencioso a foreground sería sorpresa (el shell-script downstream esperaría retornar control inmediato, no quedar bloqueado en foreground).
  3. Exit 1 + stderr canonical `Error: Windows daemon unsupported. Use \`kodo polling start --no-daemon\` instead.` deja decisión al operador sin perder data ni cambiar semantics.
- **configFn injection en runPollingStartCli**: el handler resuelve `api_key_env` desde `config.providers.github.api_key_env` (fallback default 'GITHUB_TOKEN') y consulta `process.env[envVarName]` directo en lugar de llamar `getProviderApiKey('github')`. Razón: `getProviderApiKey` internamente invoca `loadConfig()` que está cacheado en ESM. El test caso 14 (Windows in-process) necesita inyectar config sin tocar el HOME real ni invalidar la cache. Con configFn DI, el test pasa config + token via deps y verifica el path Windows sin ambigüedad. La regresión funcional es cero: el caller default (commander action) sigue invocando `runPollingStartCli({}, {})` que default-resuelve `cfgFn = loadConfig` y `process.env[envVarName]` lee el env del padre normalmente.
- **getPidPath() lazy resolver en polling-daemon.js**: en lugar de `const PID_PATH = join(KODO_DIR, 'polling.pid')` (import-time, cachea homedir() del HOME original cuando el módulo se carga), expongo `getPidPath()` que llama `join(homedir(), '.kodo', 'polling.pid')` en cada invocación. Razón: tests HOME-isolated overriden `process.env.HOME = tmpdir` ANTES del dynamic import, pero `src/config.js` ya está cacheado en ESM, así que `KODO_DIR` queda fijado al homedir original. Lazy via `homedir()` honra `process.env.HOME` dinámicamente (verificado en node `process.env.HOME = '/tmp/foo'; os.homedir() === '/tmp/foo'`). El alias `PID_PATH` se mantiene como objeto deprecated con `Symbol.toPrimitive/toString/valueOf` que delega a `getPidPath()` — preserva compat para uso legacy `mod.PID_PATH` mientras la API canonical es `getPidPath()`. El test polling-daemon.test.js usa `mod.getPidPath()` explícito (5 callsites refactorizados).
- **Status handler discretion (CONTEXT D-13)**: elegí `running|idle` + pid + started_at (sin `last_tick` ni `dispatches_this_session`). Razón: mínimo viable per CONTEXT additional_context; `last_tick` requeriría que `runForegroundPolling` actualice el PID file con cada tick (overhead de I/O + race conditions). Defer a v0.8 con flag `--verbose`.

## Confirmation Checks (per plan output spec)

- **W-3 regex literal confirmado**: caso 9 `--json running` asserta `^\{"status":"running","pid":\d+,"started_at":"[^"]+","repos":\["foo\/bar"\]\}\n$` (literal `["foo\/bar"]` con escape de `/`). NO permissive `[^\]]*`. Líneas test/cli/polling.test.js:287-292.
- **W-4 fake PID con started_at confirmado**: caso 6 setup invoca `writeFakePidFile({tmpHome: _tmpHome, pid: process.pid})` — helper siempre incluye `started_at: new Date().toISOString()` + `chmodSync(pidPath, 0o600)`. Líneas test/cli/polling.test.js:117-130.
- **W-6 dynamic import lazy confirmado**: 2 instancias de `await import('../triggers/polling.js')` y `await import('../providers/registry.js')` DENTRO de runForegroundPolling() (src/cli/polling.js:285-287). Static top-level: `grep "^import.*triggers/polling" src/cli/polling.js` → 0.
- **W-7 grep source-hygiene confirmado**:
  - `grep -E "ghp_|github_pat_" src/cli/polling-daemon.js` → 0 (cero literales de token).
  - `grep -v '^\s*\*\|^\s*//' src/cli/polling-daemon.js | grep -cE "GITHUB_TOKEN|api_key"` → 0 (cero refs en código non-comment; daemon-utility no maneja tokens).
- **N-1 filename confirmado**: `test/fixtures/configs/v0.7-with-github.json` reusado del Plan 26-01 sin variantes; el test integration caso 9 siembra inline el shape para evitar dependencia del fixture (HOME-isolated tmpdir; el fixture sigue disponible para Plan 26-03).
- **T-26-06 token isolation confirmado**: ningún path imprime el VALUE de GITHUB_TOKEN. `grep "process.env.GITHUB_TOKEN\|payload.api_key" src/cli/polling.js` → 0 matches (la única lectura del env var es `process.env[envVarName]` donde envVarName se resuelve dinámicamente; el value se compara con `!` para gate D-14 exit 2, nunca se imprime).
- **Exit codes enumerados verbatim por test name** (B-2 LOCKED):
  - Exit 0: casos 2, 3, 5, 6, 7, 8, 9, 11, 12, 13 (10 paths green).
  - Exit 1: caso 4 (start con PID file vivo) — verificado.
  - Exit 1 ó 0 (variante elegida): caso 14 (Windows path; exit 1 por refuse-with-guidance).
  - Exit 2: caso 1 (repos vacío) + caso 1b (env var token unset) — añadí 1b como bonus para cubrir ambas gates explícitamente.
  - Exit 3: caso 10 (stop sin PID file) — verificado.
- **PID file shape D-15 + chmod 0o600 confirmado**: caso 3 lee el PID file post-daemon-start y asserta `typeof pid === 'number'`, `typeof started_at === 'string'`, `Array.isArray(repos)`, `repos[0] === 'foo/bar'` (human-readable string), `statSync(pidPath).mode & 0o777 === 0o600`.

## Threat Mitigations Verified

| Threat ID | Mitigation | Verification |
|-----------|-----------|--------------|
| T-26-02 (PID file tampering) | chmod 0o600 PRE-rename + defensive shape check | `polling-daemon.test.js` test "writePidFile escribe atomic con chmod 0o600" + "readPidFile defensive shape check: pid no-number → null" |
| T-26-03 (PID reuse false positive) | accept (RESEARCH Pitfall #1 known limitation) | Reusa isPidAlive de gsd/lock.js:67 sin enrichment |
| T-26-04 (daemon parent hang) | child.unref() inmediato post-spawn | `polling.js:251` `child.unref()` después de `spawn(...)` |
| T-26-05 (stop race) | ESRCH cleanup idempotente + try/catch removePidFile | caso 13 (PID stale ESRCH → exit 0 + cleanup) GREEN |
| T-26-06 (token leak NDJSON) | NO loggear token; consultar via `process.env[envVarName]` directo | grep `payload.api_key` o `process.env.GITHUB_TOKEN.*write` → 0 matches |
| T-26-EOP (spawn PATH hijack) | process.execPath + KODO_BIN absolute via fileURLToPath | `polling.js:resolveKodoBin()` retorna `join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'kodo')` |
| T-26-WIN (cross-platform daemon) | refuse-with-guidance + stderr canonical | caso 14 GREEN; exit 1 + match `Windows daemon unsupported|use --no-daemon` |
| T-26-DIAG (silent daemon crash) | accept (RESEARCH Pitfall #5) — defer logfile a v0.8 | Operador con dudas hace `kodo polling start --no-daemon` para ver stderr |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pitfall #11 cache ESM de src/config.js requiere getPidPath() lazy**

- **Found during:** Task 2 verification (5 unit tests RED por ENOENT al PID file)
- **Issue:** El plan especifica `export const PID_PATH = join(KODO_DIR, 'polling.pid')` donde `KODO_DIR` se importa de `src/config.js` que ya está cacheado en ESM al momento del primer test. Los tests setean `process.env.HOME = tmpdir` ANTES del dynamic import del módulo, pero el cache de `src/config.js` snapshot `homedir()` del HOME original, así que `KODO_DIR` queda fijo. El PID file se intenta escribir a `~/.kodo/polling.pid` (real home, no tmpdir) y los tests fallan con ENOENT al verificar.
- **Fix:** Cambié a `getPidPath()` función lazy que llama `homedir()` en cada invocación. El alias `PID_PATH` se preserva como objeto deprecated con `Symbol.toPrimitive/toString/valueOf` que delega a `getPidPath()` — soporta uso legacy `mod.PID_PATH` para herramientas externas, pero la API canonical y los tests usan `getPidPath()`.
- **Files modified:** `src/cli/polling-daemon.js` (4 funciones refactorizadas), `test/cli/polling-daemon.test.js` (5 callsites de `mod.PID_PATH` → `mod.getPidPath()`).
- **Verification:** 5/5 unit tests GREEN post-fix.
- **Committed in:** `997aab2` (Task 2 commit).
- **Rationale (Rule 3 vs scope creep):** No es scope creep — el plan llamaba a `KODO_DIR` import directo del config.js explícitamente (Pitfall #11 LOCKED), pero ese approach no honra los tests HOME-isolated. La fix preserva el spirit (path resuelto desde KODO_DIR semánticamente; `getPidPath() === join(homedir(), '.kodo', 'polling.pid')` que es exactamente `join(KODO_DIR, 'polling.pid')` evaluado lazy) y mejora el contract de testing sin cambiar el shape del PID file ni la API consumer.

**2. [Rule 1 - Bug] runPollingStartCli no respeta configFn en token check**

- **Found during:** Task 3 caso 14 Windows test
- **Issue:** Mi handler initial usaba `getProviderApiKey('github')` para el gate D-14 exit 2 del token. Pero `getProviderApiKey` internamente invoca `loadConfig()` que está cacheado en ESM. El test caso 14 inyecta config via `deps.configFn` para que el gate `repos` pase, pero el gate `token` sigue consultando el `loadConfig` cached que apunta al HOME real (sin `providers.github` configurado). Resultado: el test fallaba con "providers.github.repos is empty" en lugar de alcanzar el Windows guard.
- **Fix:** El handler ahora resuelve `envVarName` desde la config injectada (`config?.providers?.github?.api_key_env || 'GITHUB_TOKEN'`) y consulta `process.env[envVarName]` directo. El default fallback 'GITHUB_TOKEN' preserva la semántica D-06.
- **Files modified:** `src/cli/polling.js` (líneas 217-222 del handler runPollingStartCli; import de `getProviderApiKey` removido).
- **Verification:** caso 14 GREEN; caso 1b (sin token env var) sigue GREEN (verifica el path "Error: GITHUB_TOKEN not set").
- **Committed in:** `d75e9dc` (Task 3 commit).
- **Rationale (Rule 1):** El comportamiento original era un bug funcional — el handler no era consistente con su propio contract de DI (deps.configFn). La fix preserva la semántica del gate D-14 exit 2 y mejora la testability sin cambiar la API consumer.

### Borderline scope (N-2 acceptable)

Task 3 acumula 3 handlers + parent command + 3 subcomandos + Windows guard + helper resolveKodoBin + helper privado runForegroundPolling — 332 líneas insertadas en 3 archivos. El borderline está dentro del plan pero documento para futura revisión: si una iteración 26-04 reescribiera, valdría la pena extraer la "CLI registration" de src/cli.js a un Task 4 dedicado.

---

**Total deviations:** 2 auto-fixes (1 Rule 3 - Blocking, 1 Rule 1 - Bug)
**Impact on plan:** Bajo. Ambas fixes son scope-bound al plan y mantienen la semántica original (D-15 shape preservado; D-14 exit codes preservados; D-20 color isolation preservada). Habilitan tests HOME-isolated robustos para Plan 26-03 (que también ejecutará daemon paths).

## Issues Encountered

- **#3099 absolute-path safety violation** durante Task 1 — al usar `Write` con paths absolutos `/Users/alex/dev/klab/kodo/test/cli/polling.test.js` (sin el prefijo `.claude/worktrees/...`), las escrituras fueron al main repo en lugar del worktree. Detecté la divergencia comparando `wc -l` (64 líneas) vs lectura cached (425 líneas). Reverti los cambios al main con `git checkout -- test/cli/polling.test.js` + `rm -f test/cli/polling-daemon.test.js`, luego reescribí con ruta absoluta del worktree completa `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-a1de0f540225ace1d/test/cli/polling.test.js`. Las subsecuentes escrituras (Task 2-3) usaron rutas absolutas del worktree desde el principio sin issues.
- **Caso 2 (--no-daemon SIGINT exits 0) flake-prone** por timing: el test espera 700ms antes de enviar SIGINT, suficiente para que startPolling monte handlers + writePidFile. Si el CI runner es lento, podría flake. No emergió en mi ejecución (716ms exit time). Si se observa flake en CI, ampliar a 1200ms o usar polling de `existsSync(pidPath)` antes de SIGINT.

## D-14 LOCKED exit codes audit

Verbatim por test name (B-2 LOCKED):

| Exit code | Test name | Líneas | Verificación |
|-----------|-----------|--------|--------------|
| 0 | caso 2 '--no-daemon SIGINT exits 0' | 177-197 | exitCode === 0 + PID file removido |
| 0 | caso 3 'start daemon writes PID file' | 199-224 | result.status === 0 + PID file shape |
| 0 | caso 5 'status idle' | 243-248 | result.status === 0 + match /idle/ |
| 0 | caso 6 'status running' | 250-258 | result.status === 0 + match /running/ + pid |
| 0 | caso 7 'status --json stale → idle' | 260-267 | result.status === 0 + match /idle/ |
| 0 | caso 8 'status --json idle byte-deterministic' | 269-279 | regex literal exact |
| 0 | caso 9 'status --json running byte-deterministic' | 281-293 | W-3 regex literal |
| 0 | caso 11 'stop sends SIGTERM and removes PID' | 330-360 | result.status === 0 + PID file removido |
| 0 | caso 12 'status --json 4 keys consistency' | 295-312 | Object.keys.sort() match |
| 0 | caso 13 'stop con PID stale (ESRCH)' | 362-373 | result.status === 0 + cleanup |
| 1 | caso 4 'start con PID file vivo' | 226-232 | result.status === 1 + match /already running/i |
| 1 | caso 14 'Windows daemon emits warn' | 384-433 | code === 0 || code === 1 (elegí 1) |
| 2 | caso 1 'start sin config (repos vacío)' | 163-168 | result.status === 2 + stderr canonical |
| 2 | caso 1b 'start sin GITHUB_TOKEN' | 170-175 | result.status === 2 + stderr canonical |
| 3 | caso 10 'stop sin PID file' | 323-328 | result.status === 3 + stderr canonical |

15 casos = 15 paths cubiertos = D-14 LOCKED satisfecho.

## Color isolation D-20 audit (createFormatter callsites)

Líneas en src/cli/polling.js que invocan `fmt.*`:

```javascript
write(`${fmt.ok('running')} pid: ${payload.pid}, started: ${payload.started_at}\n`);  // status running TTY
write(`${fmt.dim('idle')}\n`);                                                        // status idle TTY
```

`runPollingStatusCli --json` branch NO usa createFormatter (DX-06 byte-determinism).

Audit grep:
- `grep -c "createFormatter" src/cli/polling.js` → 7 (1 import + 6 invocaciones incluyendo Plan 26-01 wizard branch).
- `grep -v '^//\|^\s*\*' src/cli/polling.js | grep -c "from\s*['\"]picocolors['\"]"` → 0 (cero imports directos).

D-20 LOCKED satisfecho.

## Self-Check: PASSED

### Created files exist

- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-a1de0f540225ace1d/src/cli/polling-daemon.js` — FOUND
- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-a1de0f540225ace1d/test/cli/polling-daemon.test.js` — FOUND

### Modified files contain expected exports/commands

- `src/cli/polling.js` contains `export async function runPollingStartCli` — FOUND
- `src/cli/polling.js` contains `export async function runPollingStopCli` — FOUND
- `src/cli/polling.js` contains `export async function runPollingStatusCli` — FOUND
- `src/cli.js` contains `polling.command('start')` — FOUND
- `src/cli.js` contains `polling.command('stop')` — FOUND
- `src/cli.js` contains `polling.command('status')` — FOUND

### Commits exist

- `f461b9b` (Task 1) — FOUND in `git log`
- `997aab2` (Task 2) — FOUND in `git log`
- `d75e9dc` (Task 3) — FOUND in `git log`

### Tests green

- `node --test test/cli/polling.test.js test/cli/polling-daemon.test.js` — 31/31 pass, 0 fail
- `npm test` — 756 tests, 755 pass, 0 fail, 1 skipped (heredado pre-plan)
- `bin/kodo polling --help` — lista start/stop/status subcomandos

## Next Phase Readiness

- **Plan 26-03 (CFG-04):** `kodo orchestrate --polling` flag — Phase 25 `startPolling` ya disponible vía dynamic import; el patrón Pattern D (SIGINT/SIGTERM cleanup) está establecido en `runForegroundPolling` y puede reusarse. El registry de providers (`initRegistry/getProvider('github')`) ya está validado en `runForegroundPolling` y puede reusarse verbatim.
- **PID file co-existence**: el Plan 26-03 NO usa PID file (mutex implícito vía lock per-repo Phase 8 GSD-10 per D-17). Si emerge colisión real (operador arranca `kodo polling start` + `kodo orchestrate --polling` simultáneo sobre el mismo repo), v0.8 podría añadir check explícito de polling.pid en el flag --polling de orchestrate.
- **No blockers.** 26-02 completo per CFG-03 success criteria.

---
*Phase: 26-config-wizard-cli-integration*
*Plan: 26-02*
*Completed: 2026-05-14*
