---
phase: 31-phase-21-22-advisory-cleanup
plan: 03
subsystem: testing
tags: [orchestrator, launch, di, spawn, ndjson, advisory, integration-test, cmux-stub]

# Dependency graph
requires:
  - phase: 17-uat-automation
    provides: CR-02 pattern (HOME override + dynamic imports for module-cache isolation)
  - phase: 21-orchestrator-launch
    provides: launchOrchestrator + applyReportingGate + Phase 18 D-06 source-hygiene
provides:
  - launchOrchestrator opts.spawnFn DI hook (Opción A — Lifecycle Simulator Hook)
  - Integration test validando observables post-launch reales (state.json + NDJSON)
  - cmux stub pattern via shim binary node ejecutable (zero-touch sobre cmux real)
affects: [phase-32+, phase-orchestrator-evolution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lifecycle Simulator Hook (Opción A) — DI hook opcional invocado post-cmux.send/notify pre-return; default undefined preserva byte-exact behavior"
    - "cmux stub vía shim binary node ejecutable: `${_tmpHome}/bin/cmux` + config.cmux.binary apuntando al shim"
    - "Subprocess `node -e <inlineScript>` con HOME=tmpHome para eludir module-cache freeze del parent test runner"

key-files:
  created:
    - .planning/phases/31-phase-21-22-advisory-cleanup/31-03-SUMMARY.md
  modified:
    - src/orchestrator/launch.js
    - test/launch.test.js

key-decisions:
  - "Opción A (Lifecycle Simulator Hook) sobre B (test fixture externo) y C (defer a v0.9): preserva intent SC#3 (validar observables reales) + back-compat byte-exact + sin refactor cmux"
  - "Subprocess `node -e` con HOME=tmpHome en lugar de in-process: el `import { applyReportingGate }` static al top de test/launch.test.js congeló config.js con HOME real → la única vía limpia para HOME isolation es subprocess fresh"
  - "Shim cmux node ejecutable (no bash) + chmod 0o755 + config.cmux.binary apuntando al shim absolute. Node es portable; el repo ya depende de él"
  - "Receipt marker `__ADVISORY03_RECEIPT__<json>` en stdout del subprocess para que el parent assertee spawnFn invocation count + payload sin necesidad de pasar objetos JS cross-process"

patterns-established:
  - "DI hook NULL + if-guard (default undefined → producción no carga la dependencia): tercer caso post-31-01 (onConsoleWarn) y 31-02 (cleanupFn)"
  - "Test integration vía subprocess `node -e`: fresh module cache + HOME override desde entrypoint; canónico para tests que necesitan eludir cache freeze del parent runner"
  - "cmux shim binary: 30 LOC node script + chmod + config.json apuntando — sustituye cmux real sin tocar src/cmux/client.js"

requirements-completed: [ADVISORY-03]

# Metrics
duration: ~30min
completed: 2026-05-21
---

# Phase 31 Plan 03: ADVISORY-03 — launchOrchestrator spawnFn DI + integration test Summary

**Lifecycle Simulator Hook (Opción A) añadido a launchOrchestrator con integration test validando state.json + NDJSON head-line observables post-launch sin invocar claude ni cmux reales.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-21T09:25:00Z
- **Completed:** 2026-05-21T09:57:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `launchOrchestrator` ahora acepta `opts.spawnFn` opcional como DI hook (default `undefined` → no-op invariante para callers de producción).
- En producción (callers existentes `bin/kodo orchestrate`), el comportamiento es byte-exact pre-Phase-31: cmux.newWorkspace + setColor + send + notify — el lifecycle real lo hace claude binary dentro del cmux workspace.
- Cuando `opts.spawnFn` se provee, se invoca DESPUÉS de cmux.send/notify y ANTES del return, recibiendo `{ workspaceRef, sessionId, projectPath, kodoDir, taskRef }`.
- Nuevo describe `'launchOrchestrator real spawn observables (ADVISORY-03)'` en `test/launch.test.js` con 2 tests:
  1. **SC#3 integration test**: ejecuta `launchOrchestrator` dentro de un subprocess `node -e` con HOME aislado; el spawnFn DI inyectado invoca `addSession` + `sessionStart` simulando el lifecycle downstream. Valida los 3 niveles de observables (spawnFn payload, state.json mutado, NDJSON head-line con `event=session.start` + `transcript_path` populated).
  2. **Source-hygiene blinda Opción A invariante**: `src/orchestrator/launch.js` NO importa `node:child_process`.
- cmux real NUNCA invocado: stub via shim node ejecutable en `${_tmpHome}/bin/cmux` + `${_tmpHome}/.kodo/config.json` con `cmux.binary` apuntando al shim absolute.
- `~/.kodo/` del usuario NO mutado por el test (verificado: mtime de `~/.kodo/state.json` no cambió tras correr el test).

## Task Commits

Cada tarea fue committeada atómicamente:

1. **Task 1: Añadir spawnFn DI hook a launchOrchestrator** — `f6269d1` (feat)
2. **Task 2: Añadir describe 'launchOrchestrator real spawn observables' a test/launch.test.js** — `cfbfca9` (test)

## Files Created/Modified

- `src/orchestrator/launch.js` — JSDoc extendido con `opts.spawnFn`, invocación `if (opts.spawnFn) await opts.spawnFn(ctx)` post-cmux.send/notify pre-return en branch new-workspace, comentario in-file Opción A. +46 / -1 líneas. (Líneas modificadas: 62-90 JSDoc, 220-243 invocación.)
- `test/launch.test.js` — Nuevos imports estáticos (`before, after`, `spawn`, `mkdtempSync`, `mkdirSync`, `rmSync`, `writeFileSync`, `chmodSync`, `existsSync`, `tmpdir`, `dirname`, `join`, `resolve`, `fileURLToPath`, `pathToFileURL`), constantes top-level (`__dirname`, `REPO`), helper `runInlineNode`, y nuevo describe `'launchOrchestrator real spawn observables (ADVISORY-03)'` con 2 tests integration. +308 / -2 líneas. (Líneas añadidas: 1-50 imports + helper, 180-486 describe.)
- `.planning/phases/31-phase-21-22-advisory-cleanup/31-03-SUMMARY.md` — Este documento.

## Decisions Made

- **Opción A sobre B y C** (Lifecycle Simulator Hook): preserva intent del SC#3 (validar observables reales post-lifecycle), mantiene patrón DI ya establecido en 31-01/31-02 (NULL + if-guard), default `undefined` preserva back-compat byte-exact, NO requiere refactor de cmux client.
- **Subprocess `node -e` sobre in-process**: el archivo test/launch.test.js tiene `import { applyReportingGate } from '../src/orchestrator/launch.js'` static al top, lo que carga `config.js` con HOME real al evaluar el módulo y congela `KODO_DIR` en cache. Las llamadas posteriores a `loadConfig()` desde el módulo cacheado leerían `~/.kodo` del usuario aunque el test resetee `process.env.HOME`. La única vía limpia es ejecutar `launchOrchestrator` en un subprocess fresh con `HOME=_tmpHome` desde el entrypoint. Esto es exactamente el patrón canónico de `test/session-start-event.test.js` para hooks.
- **Shim cmux como script node ejecutable**: shebang `#!/usr/bin/env node` + chmod 0o755. Node es portable (no bash-dependent) y el repo ya depende de él. El shim responde a `new-workspace` con `"OK workspace:99"` (satisface el regex `/(workspace:\d+)/` de cmux/client.js), a `list-workspaces` con string vacío (NO entra en branch "ya existe orchestrator"), y a las demás subcommands con exit 0 sin output.
- **Receipt marker en stdout del subprocess** (`__ADVISORY03_RECEIPT__<json>\n`): permite al parent assertee `spawnFn` invocation count + payload sin necesidad de IPC o transfer de objetos JS cross-process. Pattern simple + robusto.

## Deviations from Plan

**None.** El plan se ejecutó exactamente como escrito, con una clarificación técnica documentada in-summary:

El plan describe dos opciones para resolver el cache-freeze del parent test runner:
1. "Sí imports estáticos de cosas que NO tocan homedir" + "Dynamic imports DESPUÉS de fijar HOME"
2. "Si emerge contaminación, mover ese import también a dynamic dentro de los nuevos describe blocks suite, dejando los existing describes intactos"

Al validar empíricamente, descubrí que el `import { applyReportingGate }` static al top del archivo (línea 5 pre-existente) carga `config.js` y congela `KODO_DIR` antes de cualquier `before()` del nuevo describe. El plan documenta esto explícitamente en `<interfaces>`: "Si emerge contaminación, mover ese import también a dynamic dentro de los nuevos describe blocks suite, dejando los existing describes intactos."

Implementé la **opción más limpia**: ejecutar `launchOrchestrator` dentro de un subprocess `node -e` con `HOME=_tmpHome` desde el entrypoint, eludiendo completamente el problema de cache. Esto:
- Preserva los existing describes intactos (zero modificación a LG1-LG8 + LH1-LH3).
- NO requiere convertir el import static a dynamic.
- Es el patrón canónico ya establecido por `test/session-start-event.test.js` para tests integration de hooks.
- El plan mencionaba esta estrategia en `<patterns>` ("Real spawn helper: `realSpawn(process.execPath, ['-e', script], {...})`"), aunque el `<action>` la describía como complemento al spawnFn, no como reemplazo del in-process invoke.

Esto NO es un deviation rule fix (Rule 1-3): es la implementación de una opción documentada en el propio plan. Documento aquí para trazabilidad.

## Issues Encountered

**Module cache freeze del parent test runner**: el `import { applyReportingGate }` static al top de `test/launch.test.js` carga `config.js` con HOME del operador real al evaluar el módulo. `KODO_DIR = join(homedir(), '.kodo')` se computa al module load time y queda inmutable. Esto invalida el plan de fijar `process.env.HOME = _tmpHome` en un `before()` del describe ADVISORY-03 y luego invocar `launchOrchestrator` in-process: las llamadas a `loadConfig()` desde el módulo cacheado leerían `~/.kodo` del usuario.

**Resolución**: ejecutar `launchOrchestrator` en un subprocess `node -e` con `HOME=_tmpHome` desde el entrypoint. Cada subprocess tiene su propio module cache que se inicializa limpio con `HOME=_tmpHome` → `KODO_DIR=_tmpHome/.kodo` → todos los reads/writes redirigen al tmpdir. Verificado empíricamente: 16 tests del archivo pasan, suite global 890/890 (1 skip pre-existente, 0 fails), `~/.kodo/state.json` del usuario NO mutado.

## Verification Results

### Acceptance criteria Task 1 (src/orchestrator/launch.js)

- `grep -c "spawnFn" src/orchestrator/launch.js` → **7** (≥2 ✓)
- `grep -c "child_process" src/orchestrator/launch.js` → **0** ✓
- `grep -E "if \(opts\.spawnFn\)" src/orchestrator/launch.js | wc -l` → **1** ✓
- `grep -c "Opción A" src/orchestrator/launch.js` → **2** (≥1 ✓)
- `grep -v '^\s*[/*]' src/orchestrator/launch.js | grep -c -- '--worktree'` → **0** ✓ (runtime hygiene preservada)
- `grep -c "skill.sync.auto" src/orchestrator/launch.js` → **1** ✓ (auto-sync block intocado)

### Acceptance criteria Task 2 (test/launch.test.js)

- `grep -c "launchOrchestrator real spawn observables" test/launch.test.js` → **1** (exacto ✓)
- `grep -c "spawnFn" test/launch.test.js` → **13** (≥3 ✓)
- `grep -c "session.start" test/launch.test.js` → **3** (≥2 ✓)
- `grep -c "transcript_path" test/launch.test.js` → **4** (≥2 ✓)

### Test counts

- **Pre-Plan-31-03** (post-31-02): test/launch.test.js + test/orchestrator-launch-isolation.test.js → 14 tests pass, 0 fail.
- **Post-Plan-31-03**: test/launch.test.js + test/orchestrator-launch-isolation.test.js → **16 tests pass, 0 fail** (+2 ADVISORY-03).
- **Suite global**: 890 tests, 889 pass, 1 skip pre-existente, 0 fail. (Baseline plan-spec ≥890 ✓.)

### Invariantes preservados

- Auto-sync block (`launch.js` líneas ~87-110): intocado, `skillSyncAuto` + `skillSyncAutoError` refs preservados.
- Runtime `--worktree`: ausente del código runtime de `launch.js` (solo en comentarios) → `test/orchestrator-launch-isolation.test.js` sigue pasando.
- `cwd: process.cwd()` preservado en `cmux.newWorkspace` (Phase 18 D-06 / Phase 999.1 D-05).
- Phase 18 D-06 comment preservado en el source.
- `child_process` NO importado por `src/orchestrator/launch.js` (Opción A invariante blindado por nuevo source-hygiene test).
- `~/.kodo/state.json` del usuario NO mutado por el test (mtime preservado).
- Tests pre-existentes (LG1-LG8 + LH1-LH3 + D-06 source-hygiene 3 tests) sin cambio de bytes en lógica de assert.

### cmux stub strategy

**Estrategia adoptada**: shim binary node ejecutable + config.cmux.binary override. **Por qué**:

- **Opción rechazada — env var override en cmux/client.js**: requeriría refactor de `src/cmux/client.js` (añadir un `if (process.env.KODO_CMUX_FAKE)` shortcircuit), violando el constraint "Phase 31 NO refactoriza cmux" del CONTEXT.md.
- **Opción rechazada — mock socket / IPC**: complejidad innecesaria; `cmux/client.js` usa `execFile(getCmuxBinary(), args)` y `getCmuxBinary()` lee `loadConfig().cmux.binary` → simplemente apuntar `cmux.binary` al shim resuelve todo.
- **Adoptada — shim binary**: 30 LOC node script + chmod + config.json apuntando. Cero modificaciones a `src/cmux/client.js`. El shim:
  - `new-workspace` → `console.log('OK workspace:99')` (satisface regex `/(workspace:\d+)/` de cmux/client.js línea 38)
  - `list-workspaces` → `process.stdout.write('')` (string vacío → `launchOrchestrator` NO entra en rama "already exists" línea 121-130, preserva flow new-workspace)
  - `send`, `workspace-action`, `notify` → `process.exit(0)` sin output
  - Implementado como script `#!/usr/bin/env node` con `chmodSync(path, 0o755)`.

### Integration test confirmation (no fallback unit-only)

El test integration SE EJECUTA y PASA: `node --test test/launch.test.js` → exit code 0, 13 tests pass del archivo (11 pre-existentes + 2 nuevos ADVISORY-03). Los 3 niveles de observables están verificados:

1. **spawnFn payload** (Assertion 1): receipt marker parseado del stdout del subprocess; `spawnCalls.length === 1`; `taskRef === 'kodo-orchestrator'`; `workspaceRef`/`sessionId` no-empty; `kodoDir === join(_tmpHome, '.kodo')`.
2. **state.json mutado** (Assertion 2): `state.sessions['TEST-ADVISORY-03']` presente; `session_id === 'test-advisory-03-uuid'`; `task_ref === 'kodo-orchestrator'`; `status === 'running'`.
3. **NDJSON head-line** (Assertion 3): `${_tmpHome}/.kodo/logs/test-advisory-03-uuid.ndjson` existe; primera línea parseable JSON con `event === 'session.start'`, `task_id === 'TEST-ADVISORY-03'`, `session_id === 'test-advisory-03-uuid'`, `transcript_path` string no-empty.

## Next Phase Readiness

Phase 21 WR-06 ("test launchOrchestrator real, no mockSpawn-only") cerrado. ADVISORY-03 cumplido per ROADMAP SC#4 (deferred section → 0 items para Phase 31). Phase 32+ puede confiar en que:

- Cualquier evolución downstream del lifecycle simulator (e.g., 2do hook post-listWorkspaces) puede inyectarse vía nuevo DI field opt-in del shape `opts.{nombre}Fn`.
- El cmux stub pattern documentado (shim binary node + config.cmux.binary override) está disponible para tests integration futuros que requieran ejecutar `launchOrchestrator` o cualquier flow que invoque `cmux.*` sin tocar cmux real.
- El patrón "subprocess `node -e` para HOME isolation cuando el parent runner congela module cache" está documentado y replicable (CR-02 evolution path).

## Self-Check: PASSED

- src/orchestrator/launch.js modificado: **FOUND** (commit f6269d1)
- test/launch.test.js modificado: **FOUND** (commit cfbfca9)
- .planning/phases/31-phase-21-22-advisory-cleanup/31-03-SUMMARY.md creado: **FOUND** (este archivo, pre-commit)
- Commit f6269d1: **FOUND** en git log
- Commit cfbfca9: **FOUND** en git log

---
*Phase: 31-phase-21-22-advisory-cleanup*
*Completed: 2026-05-21*
