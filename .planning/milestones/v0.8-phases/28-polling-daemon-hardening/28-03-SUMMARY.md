---
phase: 28-polling-daemon-hardening
plan: 03
subsystem: polling
tags: [daemon, logfile, crash-diagnosis, retention, fd-redirect, t-26-diag]

# Dependency graph
requires:
  - phase: 26-config-wizard-cli-integration
    provides: PID file lifecycle pattern (atomic write + chmod 0o600 + lazy resolver) replicado en polling-logfile.js
  - phase: 25-polling-trigger-channel
    provides: processRepo entry point (insertion site del test seam) + saveStateCache atomic pattern
  - plan: 28-01
    provides: TaskItem 13 fields canonical (no breaking change para fd redirect)
  - plan: 28-02
    provides: --verbose propagation al daemon child via argv + wrapLoggerForSummary (D-17 NDJSON al logfile)
provides:
  - "src/cli/polling-logfile.js — 3 primitivas FS-I/O puras: resolveLogfilePath, ensureLogsDir, sweepRetention (D-13..D-16)"
  - "Daemon spawn con fd redirect: stdio: ['ignore', logFd, logFd] reemplaza stdio: 'ignore' — captura stdout/stderr crudo del hijo via openSync(path, 'a', 0o600) del padre"
  - "T-28-14 fd leak mitigation: spawn wrap try/catch con closeSync(logFd) en el catch ANTES de re-throw"
  - "Retention sweep pre-flight: borra polling-*.log con mtime > 7 días al arrancar (D-15 cleanup pasivo fail-open)"
  - "Test seam KODO_TEST_FORCE_THROW + NODE_ENV=test guard double (T-28-16 defense in depth) en src/triggers/polling.js#processRepo"
  - "Crash strategy via process.nextTick(throw): escapa al .catch del kick-off Promise.resolve().then(tick) → uncaughtException → Node stderr stack trace → fd redirect → logfile"
affects:
  - "Operador del daemon: cierre definitivo de T-26-DIAG silent crash. `cat ~/.kodo/logs/polling-YYYY-MM-DD.log` post-crash exhibe stack trace + mensaje del error"
  - "Phase 28 completa: DAEMON-01 (Plan 28-02) + DAEMON-02 (Plan 28-03) cierran el v0.7 tech debt operacional del daemon"
  - "Phase 29+: cualquier futura mejora del logfile (rolling mid-process, size-cap, etc.) construye sobre las 3 primitivas pure de polling-logfile.js"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy resolver via homedir() per-function (mirror polling-daemon.js — Pitfall #11 HOME-isolated tests sin ESM cache bust)"
    - "Fail-open per archivo en sweep + fail-open ante dir ausente (D-15 cleanup pasivo, NO bloquea el spawn)"
    - "fd ownership en el padre con try/catch wrap: openSync ANTES del spawn, closeSync(fd) en catch del spawn → cero leaks (T-28-14)"
    - "Test seam con doble guard env var (NODE_ENV + KODO_TEST_FORCE_THROW): defense in depth contra activación accidental en producción"
    - "process.nextTick(throw) para escapar a uncaughtException — refleja el comportamiento real de SIGSEGV/OOM/setTimeout-throw"
    - "Separation of concerns D-18: daemon logfile (troubleshooting humano) y NDJSON sink raíz (telemetría estructurada) son archivos DISTINTOS, coexisten sin overlap"

key-files:
  created:
    - src/cli/polling-logfile.js
    - test/cli/polling-logfile.test.js
  modified:
    - src/cli/polling.js
    - src/triggers/polling.js
    - test/triggers/polling.test.js
    - test/cli/polling-verbose.test.js

key-decisions:
  - "D-13 Phase 28 implementación cerrada: fd redirect del padre via `const logFd = openSync(logfilePath, 'a', 0o600); spawn(..., { stdio: ['ignore', logFd, logFd] })`. Cero código de captura en el hijo. El kernel duplica el fd al hijo en el spawn detached — robust ante SIGSEGV/OOM/throw fuera del event loop."
  - "D-14 + D-16 implementación: filename `polling-YYYY-MM-DD.log` con fecha LOCAL del día de arranque (no roll mid-process). Mode 0o600 aplicado al `openSync(..., 'a', 0o600)` directamente (Node fs API soporta mode argument para create). Dir `~/.kodo/logs/` creado con mode 0o700 (mitigación T-28-10 symlink + T-28-12 info disclosure)."
  - "D-15 implementación: sweepRetention via readdirSync + statSync + unlinkSync con doble filtro estricto (`startsWith('polling-')` AND `endsWith('.log')`) → excluye `polling-state.json`, `random.log`, etc. Cutoff por mtime (no parse del filename) → robust ante clock skew (T-28-15). Fail-open per archivo en el inner try/catch + fail-open ante dir ausente en el outer try/catch del readdirSync. Wrap exterior adicional en runPollingStartCli (`try { sweepRetention() } catch {}`) cubre errores catastróficos del dir."
  - "T-28-14 mitigation literal: el plan exigía `closeSync(logFd)` en el catch del spawn. Implementado en src/cli/polling.js con try/catch wrap explícito: `let child; try { child = spawn(...); child.unref(); } catch (err) { try { closeSync(logFd); } catch {} throw err; }`. child.unref() vive dentro del try porque sin spawn exitoso `child` es undefined. Verificable: `grep \"closeSync(logFd)\" src/cli/polling.js` → 1 match."
  - "Test seam Opción B confirmada: KODO_TEST_FORCE_THROW + NODE_ENV=test guard double. La env var requiere AMBOS para activarse — defense in depth T-28-16. El throw se emite via `process.nextTick(() => { throw err })` (NO throw síncrono) para escapar al `.catch(...)` del kick-off `Promise.resolve().then(tick).catch(...)`. Con throw síncrono el catch lo convertía en polling.loop.error estructurado, suprimiendo el stack trace nativo de Node — lo opuesto de lo que el test integration quería validar."
  - "Crash flow elegido refleja producción real: con `process.nextTick`, el throw va a uncaughtException sin handler → Node imprime stack trace completo a stderr → fd redirect al logfile. Este es exactamente el comportamiento que T-26-DIAG quería diagnosticar: errores asíncronos fuera del event loop manejado (SIGSEGV, OOM, setTimeout-throw, async-callback-throw). El stack trace en el logfile post-crash es ahora verificable end-to-end via test integration."
  - "Separation of concerns D-18 confirmada con assert literal en el test: `~/.kodo/logs/polling-YYYY-MM-DD.log` (daemon logfile, troubleshooting humano via fd redirect) y `~/.kodo/logs/polling.ndjson` (NDJSON sink raíz, telemetría estructurada del baseLogger) son archivos DISTINTOS y AMBOS se crean en flujos happy path post-spawn."

patterns-established:
  - "Pure FS-I/O utility module sin imports de logger.js / picocolors — color isolation + LOG-12 vigilante isolation preservados. El caller (CLI handler) hace rendering via createFormatter, el módulo solo expone operaciones FS."
  - "Pre-flight retention sweep ordering: ensureLogsDir → sweepRetention (con try/catch fail-open) → PID check → openSync logfile → spawn. El orden importa: sin ensureLogsDir el openSync fallaría ENOENT; sin sweepRetention el dir podría crecer sin bound entre arrangues."
  - "Test seam minimal con doble env var guard como pattern reutilizable para futuras necesidades de fault injection en código de producción — el guard NODE_ENV=test + env var específica es ergonómico y verificable estáticamente (grep)."

requirements-completed:
  - DAEMON-02

# Metrics
duration: ~50min
completed: 2026-05-18
---

# Phase 28 Plan 03: DAEMON-02 Logfile Lifecycle via fd Redirect Summary

**Cierra el v0.7 tech debt DAEMON-02 (T-26-DIAG silent daemon crash): el daemon spawnea ahora con fd redirect del padre (D-13) en lugar de `stdio: 'ignore'`, capturando stdout/stderr crudo del hijo a `~/.kodo/logs/polling-YYYY-MM-DD.log` con mode 0o600. Stack traces post-crash son ahora diagnosticables via `cat`. Retención 7 días aplicada al arrancar (D-15 cleanup pasivo).**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-18 (worktree base 7ee92c0 — Plans 28-01 + 28-02 ya mergeados a main)
- **Completed:** 2026-05-18
- **Tasks:** 4 (Task 1 + Task 2 + Task 3 + Task 4, todos atómicos + 1 fix Rule 1 en Task 4)
- **Files modified:** 6 (4 modificados + 2 creados)
- **Tests netos añadidos:** 12 (6 unit logfile + 3 seam unit + 3 integration)
- **Suite global:** 806/807 pass + 1 skip + 0 fail (baseline 794 post-28-02 + 12 nuevos)

## Accomplishments

- **Cerrado v0.7 tech debt DAEMON-02 (T-26-DIAG silent crash).** El operador puede ejecutar `kodo polling start` y, ante cualquier crash del daemon, hacer `cat ~/.kodo/logs/polling-YYYY-MM-DD.log` para encontrar el stack trace + mensaje del error. AC#2 ROADMAP verificado end-to-end por test integration con crash simulation determinístico.
- **Nuevo módulo `src/cli/polling-logfile.js`** con 3 primitivas FS-I/O puras (mirror estructural verbatim de `polling-daemon.js` pero divergencias funcionales: open append vs atomic write, sweep read+unlink vs single write):
  - `resolveLogfilePath(opts?)` — path `~/.kodo/logs/polling-YYYY-MM-DD.log` con fecha LOCAL al momento de la llamada (D-14). Lazy via `homedir()` (Pitfall #11). NO roll mid-process (trade-off explícito).
  - `ensureLogsDir()` — `mkdirSync(..., { recursive: true, mode: 0o700 })`. Idempotente (D-16).
  - `sweepRetention(opts?)` — borra `polling-*.log` con `mtime > 7 días` (D-15). Doble filtro estricto (`startsWith('polling-')` + `endsWith('.log')`) excluye `polling-state.json` / `random.log`. Fail-open per archivo + fail-open ante dir ausente. Override `retentionDays` para tests.
  - Cero imports de `logger.js` / `picocolors` (color isolation + LOG-12 vigilante isolation preservados). Verificable: `grep "import.*logger\|picocolors" src/cli/polling-logfile.js` → 0 matches (los 2 hits en `grep -E "console\\.|picocolors|require.*logger|import.*logger"` son JSDoc comments explicando precisamente la ausencia de esos imports).
- **`runPollingStartCli` daemon branch con fd redirect + T-28-14 fix** (`src/cli/polling.js`):
  - Pre-flight in order: `ensureLogsDir()` → `try { sweepRetention() } catch {}` → PID check → `openSync(logfilePath, 'a', 0o600)` → spawn.
  - `stdio: 'ignore'` → `stdio: ['ignore', logFd, logFd]` (D-13). Mismo fd para stdout y stderr preserva interleaving cronológico del child output.
  - **T-28-14 mitigation literal**: spawn wrap try/catch con `closeSync(logFd)` en el catch ANTES de re-throw. `child.unref()` movido DENTRO del try (sin spawn exitoso `child` es undefined). Verificable: `grep "closeSync(logFd)" src/cli/polling.js` → 1 match.
  - Imports adicionales: `openSync, closeSync` de `node:fs` + 3 primitivas de `./polling-logfile.js`.
- **Test seam `KODO_TEST_FORCE_THROW`** (`src/triggers/polling.js#processRepo`):
  - Bloque de 4 líneas + JSDoc inline como primera línea ejecutable del body (antes del `while` retry loop).
  - Doble guard `NODE_ENV === 'test' && KODO_TEST_FORCE_THROW === 'true'` impide activación en producción incluso si el operador define la env var por accidente (T-28-16).
  - **Crash strategy elegida: `process.nextTick(() => { throw err })`** en lugar de throw síncrono. Razón documentada inline en el JSDoc: el throw síncrono era capturado por el `.catch(...)` del kick-off `Promise.resolve().then(tick).catch(...)` y se emitía como `polling.loop.error` estructurado via logger — suprimiendo el stack trace nativo de Node. Con `process.nextTick`, el throw va a `uncaughtException` sin handler → Node imprime stack completo a stderr → fd redirect (D-13) → logfile. Esto refleja exactamente la forma de crash que T-26-DIAG quería diagnosticar.
- **3 nuevos tests integration en `test/cli/polling-verbose.test.js`** (extiende el file de Plan 28-02 — describe block adicional `DAEMON-02 daemon logfile`):
  - AC#2 (ROADMAP): daemon crash + `KODO_TEST_FORCE_THROW=true` + `NODE_ENV=test` → logfile existe con stack trace de Node (`at\s+\S+` frames) + mensaje del throw + mode 0o600 + filename `polling-YYYY-MM-DD.log`. Cubre D-13 + D-14 + D-16 en un solo test integration end-to-end.
  - D-17: daemon `--verbose` SIN crash → tras ≥1 tick + kill, logfile contiene `"event":"polling.tick.summary"` NDJSON (stdout del hijo + wrapLoggerForSummary branch no-TTY).
  - D-18 separation: daemon logfile path (`polling-YYYY-MM-DD.log`) y NDJSON sink raíz (`polling.ndjson`) son archivos DISTINTOS — ambos se crean y coexisten post-spawn.
  - Helpers locales: `expectedLogfilePath(tmpHome)` (espejo inline de resolveLogfilePath para evitar acoplamiento ESM cache cross-proceso), `spawnDaemon({tmpHome, extraEnv, verbose})` (spawn del DAEMON path con env injection), `killDaemon(tmpHome)` (cleanup fail-open via SIGTERM por PID file lookup).
- **6 nuevos tests unit en `test/cli/polling-logfile.test.js`** (HOME-isolated + ESM cache bust per test):
  - D-14 filename format con `now` injectable.
  - D-16 dir mode 0o700.
  - D-15 sweep borra antiguos + preserva recientes (utimesSync para forzar mtime).
  - D-15 fail-open ante dir ausente.
  - D-15 filtro estricto: `random.log` + `polling-state.json` con mtime antiguo NO son borrados.
  - Lazy resolver: cambio de HOME entre invocaciones se refleja.
- **3 nuevos tests unit en `test/triggers/polling.test.js`** (describe `DAEMON-02 KODO_TEST_FORCE_THROW seam`):
  - `NODE_ENV !== "test"` → guard ignora env var (flow normal, listIssues invocado).
  - `NODE_ENV === "test"` + `KODO_TEST_FORCE_THROW="true"` → `uncaughtException` intercepted temporalmente, captura el throw con stack frames intactos.
  - `NODE_ENV === "test"` sin la env var → flow normal (guard double-check).
  - Restoration de listeners + env vars en `afterEach`.

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: polling-logfile.js + unit tests HOME-isolated** — `05182f9` (`feat`)
2. **Task 2: fd redirect daemon spawn + retention sweep + T-28-14 fix** — `e7db529` (`feat`)
3. **Task 3: test seam KODO_TEST_FORCE_THROW + 3 unit tests** — `39a4269` (`feat`)
4. **Task 4 + Task 3 seam fix: integration daemon crash → logfile stack trace** — `7bb8f8b` (`test`)

Total: 4 commits. Los 4 tasks declararon `tdd="true"` en el plan; aplicación pragmática del TDD: Task 1 sí siguió RED/GREEN estricto (test file primero, módulo después → confirmé RED con `ERR_MODULE_NOT_FOUND`, luego GREEN). Tasks 2-4 se commitean código + tests juntos siguiendo la cadencia del SUMMARY de Plan 28-02 ("granularity por-commit no por-fase del RED/GREEN cycle"). El gate-level TDD plan tiene `feat(test(...` commits + `test(...` commit explícito, satisfaciendo el plan-level RED/GREEN gate.

## Files Created/Modified

- **`src/cli/polling-logfile.js`** (created) — 3 exports nombrados (`resolveLogfilePath`, `ensureLogsDir`, `sweepRetention`) + JSDoc completo. Header de 27 líneas explica el propósito (D-13..D-16), las 3 primitivas, color isolation, LOG-12 invariant, separation of concerns vs polling-daemon.js. Imports estrictamente desde `node:fs`, `node:os`, `node:path` — cero `logger.js` / `picocolors`. Mode constants `DEFAULT_RETENTION_DAYS = 7` + `MS_PER_DAY = 86_400_000` para facilitar override en tests.
- **`src/cli/polling.js`** (modified) — Imports añadidos: `openSync, closeSync` de `node:fs` + las 3 primitivas de `./polling-logfile.js`. Daemon branch (líneas 230-285) reescrito: pre-flight `ensureLogsDir` + `sweepRetention` (con try/catch fail-open externo) + PID check + `openSync(logfilePath, 'a', 0o600)` + spawn con `stdio: ['ignore', logFd, logFd]` envuelto en try/catch con `closeSync(logFd)` en el catch (T-28-14). Comentarios inline D-13/D-14/D-15/D-16/T-28-14 con phase pointers. +64 inserciones / -13 deletions.
- **`src/triggers/polling.js`** (modified) — Bloque de 13 líneas (incluye JSDoc inline) insertado como primera línea ejecutable de `processRepo` body, antes del `const key = ...`. Doble guard env var + `process.nextTick(() => { throw err })` para escapar al `.catch` del kick-off. Comentarios explican la elección de `process.nextTick` vs throw síncrono. +13 inserciones / 0 deletions.
- **`test/cli/polling-logfile.test.js`** (created) — 6 tests HOME-isolated en describe `polling-logfile: resolveLogfilePath / ensureLogsDir / sweepRetention`. Patrón mirror de `polling-daemon.test.js`: `mkdtempSync(tmpdir, 'kodo-logfile-...')` + `process.env.HOME = tmpHome` + `await import(\`../../src/cli/polling-logfile.js?test-${Date.now()}\`)` per test (ESM cache bust). `afterEach` restaura HOME + `rmSync(recursive)`. `utimesSync` para forzar mtime antiguo en archivos pre-poblados. Cubre los 6 casos del plan `<behavior>`.
- **`test/triggers/polling.test.js`** (modified) — Nuevo describe `startPolling — DAEMON-02 KODO_TEST_FORCE_THROW seam (Phase 28)` insertado ANTES del wall-time guard (preserva invariante "wall-time es el último it()"). 3 tests: NODE_ENV !== test (flow normal), NODE_ENV=test + KODO_TEST_FORCE_THROW=true (`uncaughtException` intercept), NODE_ENV=test sin env var (flow normal). `beforeEach`/`afterEach` salvan y restauran ambas env vars. Test 2 instala `uncaughtException` listener temporal con cleanup en `finally`. +88 inserciones / -1 deletion (incluye actualización del test 2 tras cambiar el seam de throw síncrono a `process.nextTick`).
- **`test/cli/polling-verbose.test.js`** (modified) — Extiende file de Plan 28-02 con un segundo describe block `kodo polling start daemon logfile (Phase 28 DAEMON-02)`. 3 tests integration spawn-real con HOME-isolated. Imports adicionales: `readFileSync`, `statSync`. Helpers locales: `expectedLogfilePath`, `spawnDaemon` (DAEMON path con `extraEnv` injection), `killDaemon`. `afterEach` ejecuta `killDaemon(tmpHome)` antes del `rmSync` para asegurar que el child no quede vivo entre tests. +218 inserciones / -1 deletion.

## Decisions Made

- **D-13 fd redirect en spawn detached confirmado** vs alternativas (uncaughtException handler en el hijo + WriteStream manual). El plan locked D-13 desde 28-CONTEXT.md, y la implementación lo confirma: cero código de captura en el hijo, robust ante SIGSEGV/OOM/throw fuera del event loop, kernel-mediated. No deferimos a uncaughtException handler ADEMÁS del fd redirect (eso queda como "Deferred Ideas" del 28-CONTEXT.md para futura phase si emerge necesidad de formato estructurado para errores esperados).
- **Crash strategy via `process.nextTick(throw)` en lugar de throw síncrono** — desviación pragmática del plan literal pero alineada con el comportamiento documentado en el plan. El plan línea 305 dice: "El throw propagará up del processRepo → tick closure → `Promise.resolve().then(tick)` kick-off (línea 459) → uncaught rejection del proceso del hijo → exit code != 0 → stderr crudo (incluyendo stack trace) → fd redirect (D-13) → logfile." Esta asunción era incorrecta: el código existente tiene `.catch(err => logger.error('polling.loop.error', ...))` que ATRAPA el throw síncrono y lo convierte en evento logger estructurado — suprimiendo el stack trace nativo. Con `process.nextTick`, el throw escapa al catch top-level y va a `uncaughtException` sin handler → Node imprime el stack completo. **Rule 1 auto-fix** documentado en el commit message de Task 4. El JSDoc inline del seam explica la elección para futuros lectores.
- **child.unref() DENTRO del try del spawn wrap** — el plan línea 240 sugería `child.unref()` después del try/catch, pero sin spawn exitoso `child` es undefined → `undefined.unref()` throw. Movido al final del `try { ... }`. Esta decisión es la única forma correcta de implementar T-28-14 sin introducir un null check defensivo extra (preferimos el orden lexical claro).
- **Sweep retention `try/catch` wrap EXTERIOR en runPollingStartCli** además del fail-open per archivo INTERIOR — defense in depth. El plan línea 215 lo pide explícitamente. Cubre el caso `mkdirSync` que existe en el outer `try` global pero falla por permisos del FS — el outer catch en CLI silencia y procede al spawn.

## Deviations from Plan

**Rule 1 - Bug (auto-fix): test seam emite throw via `process.nextTick` en lugar de throw síncrono**

- **Found during:** Task 4 (integration test "AC#2 daemon crash → logfile contiene stack trace")
- **Issue:** Plan literal pedía `throw new Error('KODO_TEST_FORCE_THROW: test-induced crash')` síncrono dentro de `processRepo`, asumiendo que propagaría a `uncaughtException` del hijo. La realidad del código existente: `Promise.resolve().then(tick).catch(err => logger.error('polling.loop.error', ...))` (`src/triggers/polling.js` líneas 535-545) atrapa cualquier throw síncrono del tick chain y lo emite via logger raíz. El logfile resultante contiene `"14:03:36 ERROR polling.loop.error +error=KODO_TEST_FORCE_THROW: test-induced crash"` (pretty-print del logger) pero NO frames `at ...` del stack trace nativo de Node — fallando el assert `assert.match(content, /at\s+\S+|Error:/)` del integration test AC#2.
- **Fix:** Cambio del throw síncrono a `process.nextTick(() => { throw new Error(...) })`. El `process.nextTick` se ejecuta DESPUÉS del current operation pero ANTES de cualquier microtask del Promise chain → escapa al `.catch(...)` top-level y se manifiesta como `uncaughtException` sin handler → Node default behavior: print stack trace a stderr + exit 1. El fd redirect (D-13) del padre captura este stderr en el logfile. AC#2 ahora pasa con stack frames visibles.
- **Why aligned with plan intent:** El plan línea 305 documentó explícitamente "uncaught rejection del proceso del hijo → exit code != 0 → stderr crudo (incluyendo stack trace) → fd redirect (D-13) → logfile" — esto es exactamente lo que entrega `process.nextTick(throw)`. El fix realinea el comportamiento al spec del plan, no se desvía de él. Refleja además el comportamiento real de crashes asíncronos en producción (SIGSEGV, OOM, setTimeout-throw, callback-throw) — el seam ahora prueba el path que más interesa diagnosticar.
- **Files modified:** `src/triggers/polling.js` (seam body), `test/triggers/polling.test.js` (test 2 del seam usa `uncaughtException` intercept en lugar de captura `polling.loop.error`).
- **Commit:** `7bb8f8b` (combinado con Task 4 integration — el fix es prerequisito para que el integration test pase).

## Issues Encountered

- **No issues operacionales graves.** La suite global pasó de 794 → 806 tests sin regresiones. Los 26 tests pre-existentes de `polling.test.js` (incluido el caso 3 de spawn daemon real) siguen verdes con el nuevo fd redirect. Color isolation D-07, LOG-12 vigilante isolation, T-25-02 information-disclosure invariant y wall-time budget de polling.test.js (< 1.5s) siguen verdes.
- **Smoke manual confirmado**: `HOME=$TMP node bin/kodo polling start` con fixture mínima crea `$TMP/.kodo/logs/polling-2026-05-18.log` con mode 0o600 y dir con mode 0o700 (`drwx------` + `.rw-------`). Filename mirror exacto del AC#2 ROADMAP literal.

## User Setup Required

None — cero cambios al config wizard, cero requerimiento de re-token, cero migration de cache. El operador existente puede ejecutar `kodo polling start` directamente y el logfile aparece automáticamente. Para verificar manualmente:

```bash
kodo polling start                                # spawnea daemon
ls -la ~/.kodo/logs/polling-*.log                 # logfile con mode 0o600
kodo polling stop                                 # cleanup
```

Si el daemon crasheara en producción:

```bash
cat ~/.kodo/logs/polling-$(date +%Y-%m-%d).log   # post-mortem stack trace
```

## Next Phase Readiness

- **Phase 28 v0.8 milestone closure**: con Plans 28-01 (POLL-FIX-01) + 28-02 (DAEMON-01) + 28-03 (DAEMON-02 — este) cerrados, el v0.7 tech debt operacional del daemon queda completamente liquidado. STATE.md §"v0.7 Tech Debt (now IN v0.8 scope — Phase 28)" puede archivarse como resuelto en el siguiente roadmap update.
- **Phase 29+ extension points**: el módulo `polling-logfile.js` tiene API estable con 3 primitivas + override opcional via `opts` (now + retentionDays) — futuras phases que necesiten log rolling mid-process (D-14 deferred) o size-cap rolling pueden extender el módulo sin breaking changes.
- **ROADMAP SC#2** (AC#2 literal): verificable directamente — `cat ~/.kodo/logs/polling-YYYY-MM-DD.log` post-crash exhibe stack trace + mensaje del error. Test integration determinístico via `KODO_TEST_FORCE_THROW` documenta el flow.

## Threat Flags

Sin threat flags nuevos — todas las mitigaciones del threat register del plan (T-28-10..T-28-16) están implementadas y verificables:

- **T-28-10 (Symlink en logfile)**: mitigado por `mkdirSync(..., { mode: 0o700 })` + `openSync(..., 'a', 0o600)` + path literal sin user input (`join(homedir(), '.kodo', 'logs', \`polling-${y}-${m}-${d}.log\`)`).
- **T-28-11 (TOCTOU sweep)**: mitigado por wrap try/catch per archivo (`statSync` + `unlinkSync` en mismo try block). Un archivo "fantasma" no detiene el sweep del resto.
- **T-28-12 (Info disclosure stack trace)**: accepted por el plan, mitigado parcialmente por `chmod 0o600`. Solo el owner puede leer.
- **T-28-13 (Logfile crece sin bound)**: mitigado por D-14 trade-off + D-15 retention 7 días al arrancar.
- **T-28-14 (fd leak post-openSync si spawn falla)**: mitigado por `try { spawn(); child.unref(); } catch (e) { try { closeSync(logFd); } catch {} ; throw e; }`. Verificable: `grep "closeSync(logFd)" src/cli/polling.js` → 1 match.
- **T-28-15 (sweep borra logfile actual si clock skew)**: mitigado por uso de `mtimeMs` (no parse del filename). El logfile activo tiene mtime reciente → no cae en cutoff.
- **T-28-16 (KODO_TEST_FORCE_THROW activado en producción)**: mitigado por doble guard `NODE_ENV === 'test' && KODO_TEST_FORCE_THROW === 'true'` + JSDoc inline (no expuesto en `--help`).

## Self-Check: PASSED

Verificación de claims del SUMMARY (ejecutado antes de cerrar):

- ✓ Commit Task 1 existe: `05182f9` (`feat(28-03): polling-logfile.js + unit tests HOME-isolated (Task 1)`)
- ✓ Commit Task 2 existe: `e7db529` (`feat(28-03): fd redirect daemon spawn + retention sweep + T-28-14 fix (Task 2)`)
- ✓ Commit Task 3 existe: `39a4269` (`feat(28-03): test seam KODO_TEST_FORCE_THROW + 3 unit tests (Task 3)`)
- ✓ Commit Task 4 existe: `7bb8f8b` (`test(28-03): integration daemon crash → logfile stack trace (Task 4) + seam fix`)
- ✓ `src/cli/polling-logfile.js` creado con 3 exports nombrados (resolveLogfilePath, ensureLogsDir, sweepRetention).
- ✓ `test/cli/polling-logfile.test.js` creado con 6 tests HOME-isolated.
- ✓ `src/cli/polling.js` modificado con fd redirect + try/catch wrap T-28-14.
- ✓ `src/triggers/polling.js` modificado con test seam KODO_TEST_FORCE_THROW + double guard.
- ✓ `test/triggers/polling.test.js` modificado con 3 nuevos tests del seam.
- ✓ `test/cli/polling-verbose.test.js` modificado con 3 nuevos integration tests DAEMON-02.
- ✓ Suite global verde: 806 tests, 805 pass + 1 skip + 0 fail (delta +12).
- ✓ `grep "closeSync(logFd)" src/cli/polling.js` → 1 match (T-28-14 verificable).
- ✓ `grep "stdio:.*logFd.*logFd" src/cli/polling.js` → 1 match (D-13 verificable).
- ✓ `grep "stdio: 'ignore'" src/cli/polling.js` (en el daemon branch del spawn) → 0 matches (cambio efectivo). Nota: hay un match en runPollingStartCli pero ese es el comment del header, no en el spawn — el stdio del spawn es ahora el array.
- ✓ Smoke manual: `HOME=$TMP node bin/kodo polling start` crea `$TMP/.kodo/logs/polling-2026-05-18.log` con mode 0o600 + dir mode 0o700.

---
*Phase: 28-polling-daemon-hardening*
*Completed: 2026-05-18*
