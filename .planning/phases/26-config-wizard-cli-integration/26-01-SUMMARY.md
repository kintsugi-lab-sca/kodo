---
phase: 26-config-wizard-cli-integration
plan: 01
subsystem: cli
tags: [cli, wizard, config, github, migration]

# Dependency graph
requires:
  - phase: 23-githubclient-auth-foundation
    provides: getProviderApiKey('github') provider-agnostic read from ~/.kodo/.env
  - phase: 24-githubprovider-normalizer-registry
    provides: getProvider('github') factory available for runtime config validation
  - phase: 25-polling-trigger-channel
    provides: startPolling({provider, repos, intervalSec}) signature consumed by 26-03 --polling integration
provides:
  - configureGithubProvider({ask,execGitRemote?,providerConfig}) — wizard branch DI-zable
  - parseGitHubRemote(url) — pure regex parser, 3 github URL formats
  - detectOriginRepo(exec?) — auto-detect git remote, fail-open Pitfall #6
  - getDefaultGithubProviderConfig() — factory shape D-06 (NOT in DEFAULT_CONFIG)
  - kodo config wizard supports provider: github (D-01..D-06)
affects: [26-02 polling daemon CLI, 26-03 orchestrator --polling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "wizard branch DI helper exportable (configureGithubProvider) — first kodo wizard module DI-zable"
    - "test fixtures de config v0.6/v0.7 en test/fixtures/configs/ — canonical naming v0.X-with-FEATURE.json (N-1)"
    - "test/cli/ subdirectory established — first kodo tests off top-level"

key-files:
  created:
    - src/cli/polling.js
    - test/cli/polling.test.js
    - test/cli/wizard-github.test.js
    - test/fixtures/configs/v0.6-no-github.json
    - test/fixtures/configs/v0.7-with-github.json
  modified:
    - src/cli.js
    - src/config.js
    - test/migration.test.js
    - package.json

key-decisions:
  - "Wizard ask helper re-pregunta env var name (uses providerConfig.api_key_env preserved from pre-existing gate at src/cli.js:378) — UX redundancy aceptada (Karpathy Rule 3 surgical, NO modificar la lógica genérica provider-agnostic)"
  - "Regex inline en parseGitHubRemote (Claude's Discretion CONTEXT) — pattern verbatim per 26-PATTERNS líneas 175-200"
  - "Loop manual add usa `continue` ante input inválido (NO recursión Pitfall #9 / Pattern H); break en Enter vacío"
  - "package.json test script refactor a `find` (Rule 3 auto-fix): glob `test/**/*.test.js` con sh NO recursa subdirs, mi plan introdujo `test/cli/` por primera vez"

patterns-established:
  - "Pattern A (color isolation D-20 LOCKED): wizard branch github usa createFormatter, cero console.log raw user-facing — primer kodo CLI surface en aplicar esto a un branch wizard"
  - "Pattern H (early-return wizard, NO recursión): rama github exit-early con rl.close() + return tras saveConfig o cancel"
  - "Pattern Scripted-readline DI (RESEARCH §Example 1): primer kodo test usando ask scripted en lugar de monkeypatch readline global"

requirements-completed: [CFG-01, CFG-02]

# Metrics
duration: ~12min
completed: 2026-05-14
---

# Phase 26 Plan 01: Wizard `provider: github` + config schema + migration tests Summary

**Wizard branch `kodo config → github` con auto-detect de origin, schema providers.github runtime-only (D-08), y fixtures + tests demostrando CFG-02 zero-breaking-change.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-14T17:35:00Z (approx)
- **Completed:** 2026-05-14T17:46:19Z
- **Tasks:** 3 (all type=auto tdd=true)
- **Files modified:** 4 modified + 5 created = 9 total

## Accomplishments

- Wizard `kodo config` ahora ofrece `github` como provider (D-01) y persiste el shape D-06 cuando el operador lo elige; configs v0.6 cargan sin tocar (CFG-02 invariante demostrado por fixture test).
- `configureGithubProvider` extraído a `src/cli/polling.js` como helper DI-zable (RESEARCH §Example 1) — habilita scripted-readline tests sin monkeypatch global, primer kodo wizard module DI-zable.
- D-20 LOCKED color isolation respetado verbatim: cero `console.log/error` raw en la rama github, todos los outputs user-facing via `fmt.cyan/.dim/.warn/.ok` envueltos en `process.stdout.write` (verificado por acceptance grep).
- D-08 invariant verificado: `DEFAULT_CONFIG.providers` NO contiene `github`. Factory `getDefaultGithubProviderConfig()` es lo único que materializa el shape D-06 — invocado SOLO desde la rama github cuando el wizard lo necesita.
- 17 casos nuevos GREEN (6 parseGitHubRemote + 5 detectOriginRepo + 6 configureGithubProvider) + 3 migration tests (CFG-02 v0.6, CFG-02 v0.7 idempotente, D-08 invariante).

## Task Commits

1. **Task 1: Wave 0 fixtures + scaffolds RED** - `6fa20c3` (feat)
2. **Task 2: parseGitHubRemote + detectOriginRepo + configureGithubProvider helpers GREEN** - `8e70f4f` (feat)
3. **Task 3: getDefaultGithubProviderConfig + wizard branch github wiring (D-20 LOCKED)** - `3f25bfd` (feat)

## Files Created/Modified

- `test/fixtures/configs/v0.6-no-github.json` — Plane-only fixture demostrando que configs pre-Phase-26 cargan idénticas (CFG-02 invariante).
- `test/fixtures/configs/v0.7-with-github.json` — config fixture poblada con `providers.github` shape D-06 verbatim (N-1 canonical filename, NO `v0.7-github.json`).
- `test/cli/polling.test.js` — unit tests para parseGitHubRemote (6 fixtures) + detectOriginRepo (5 casos incluyendo fail-open Pitfall #6).
- `test/cli/wizard-github.test.js` — 6 casos scripted-readline para configureGithubProvider (happy path, invalid repo retry, manual entry, reject auto-detect, token security T-26-01, fail-open).
- `test/migration.test.js` — extendido con `describe('config v0.6 → v0.7 zero-breaking-change (Phase 26)')` (3 casos).
- `src/cli/polling.js` — NEW: exports parseGitHubRemote, detectOriginRepo, configureGithubProvider. Cero imports de picocolors (Pattern A invariante). Daemon CLI handlers (runPollingStartCli/StopCli/StatusCli) deferred to Plan 26-02.
- `src/config.js` — ADD: `export function getDefaultGithubProviderConfig()`. DEFAULT_CONFIG sin tocar (D-08).
- `src/cli.js` — extend `interactiveConfig`: (a) `availableProviders = ['plane', 'github']` D-01; (b) new branch `if (selectedProvider === 'github')` con dynamic imports, D-08 runtime-only inject, configureGithubProvider llamada, D-05 resumen final via fmt.*, Pattern H early-return.
- `package.json` — fix test script glob para recursar `test/cli/` (Rule 3 auto-fix; deviation documentada abajo).

## Decisions Made

- **Regex inline en parseGitHubRemote** (Claude's Discretion per CONTEXT.md): mantenida la regex verbatim del 26-PATTERNS líneas 175-200 (sin abstracción nueva); las clases de caracteres `[^/]+` y `[^/.\s]+?` mitigan T-26-INJ (CONTEXT threat model).
- **Wizard manual add loop `continue` en input inválido** (no warning explícito al operador): mínimo viable per CONTEXT additional_context. El operador re-entra el prompt; si quiere bail-out hace Enter vacío.
- **Branch github exit-early tras saveConfig** (Pattern H per 26-PATTERNS): `rl.close(); return;` sin caer al bloque Plane projects listing — Pitfall #9 (NO recursión a interactiveConfig).
- **api_key_env duplicate prompt aceptado**: el gate API key existing en `src/cli.js:376-388` ya pregunta env var name PROVIDER-AGNOSTIC. La rama github vuelve a preguntar dentro de `configureGithubProvider`. UX-wise redundante pero correcto (Karpathy Rule 3 — no toco el gate genérico; el caller preserva el valor pre-capturado al copiarlo a `config.providers.github.api_key_env` antes de invocar el helper).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] package.json test script fixed to recurse into test/cli/**

- **Found during:** Task 3 verification (after wiring wizard branch)
- **Issue:** El script `"test": "node --test test/**/*.test.js"` falla con sh-globbing — `**` no recursa subdirs en sh, por lo que `npm test` solo corre los top-level test files (17 tests, todos los míos por casualidad) en lugar de los 634 reales. Este es un bug latente preexistente que mi plan surface-d al ser el primer plan con tests en `test/cli/`. Sin la fix, los tests Plan 26-02/26-03 también quedarían fuera de `npm test`, comprometiendo el invariante de CI.
- **Fix:** Cambié el script a `"test": "node --test $(find test -name '*.test.js' -type f)"`. Single-line, sin nuevas dependencias, equivalente semánticamente al glob recursivo original.
- **Files modified:** `package.json` (1 línea)
- **Verification:** `npm test` ahora reporta `tests 634, pass 633, fail 0, skipped 1` (vs `tests 17` antes); todos los tests CFG-01 + CFG-02 aparecen explícitamente en el log.
- **Committed in:** `3f25bfd` (Task 3 commit — junto con el wizard branch)
- **Rationale (Rule 3 vs scope creep):** No es scope creep — sin esta fix, mi propia verification step `npm test ≥ 718 pass, 0 fail` no se puede satisfacer, y el plan 26-02 también quedaría afectado. Es un blocker directo causado por la introducción de `test/cli/`.

---

**Total deviations:** 1 auto-fix (Rule 3 - Blocking)
**Impact on plan:** Mínimo. Una sola línea de `package.json`. Habilita la verificación de Phase 26 isolated y full suite via `npm test`. No scope creep.

## Issues Encountered

- **package.json sh-glob bug** — descubierto en Task 3 final verification. Resuelto via Rule 3 auto-fix (documentado arriba). Sin él, el comando `npm test` del verification block del plan habría reportado 17 tests en lugar de 634, ocultando posibles regresiones.

## D-20 LOCKED audit (createFormatter callsites en branch github)

Líneas literales que llaman `fmt.*` dentro del bloque `if (selectedProvider === 'github')`:

```
process.stdout.write('\n  ' + fmt.cyan('Resumen:') + '\n');
process.stdout.write('    ' + fmt.dim('- ') + r.owner + '/' + r.repo + '\n');
process.stdout.write('  ' + fmt.dim('poll_interval: ') + config.providers.github.poll_interval + 's\n');
process.stdout.write('  ' + fmt.warn('Abortado sin guardar.') + '\n');
process.stdout.write('  ' + fmt.ok('Configuracion guardada en ~/.kodo/') + '\n');
```

Audit grep results:
- `awk '/selectedProvider === .github./,/^  }$/' src/cli.js | grep -c "createFormatter"` → `2` (import + invocación, ≥1 required).
- `awk '/selectedProvider === .github./,/^  }$/' src/cli.js | grep -E "console\.(log|error)" | grep -v "^\s*//"` → 0 líneas (cero `console.log/error` raw).

D-20 LOCKED satisfecho.

## N-1 audit (filename canonical)

- `ls test/fixtures/configs/v0.7-with-github.json` → existe (canonical).
- `ls test/fixtures/configs/v0.7-github.json` → no existe (legacy variant correctly absent).

## Plane branch untouched audit (Karpathy Rule 3)

Comando: `git diff HEAD~3..HEAD -- src/cli.js | grep -E "^[+-]" | grep -E "(plane|workspace_slug|base_url|listProjects|Workspace slug|Base URL)"`

Result: **una única línea cambiada** — `availableProviders = ['plane']` → `['plane', 'github']` (cambio mandatorio D-01). El bloque `if (selectedProvider === 'plane')` (líneas 391-400 originales) y el bloque de listado de proyectos (líneas 407-512) NO tocados.

## Self-Check: PASSED

### Created files exist

- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-aee68869471e4b8d5/test/fixtures/configs/v0.6-no-github.json` — FOUND
- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-aee68869471e4b8d5/test/fixtures/configs/v0.7-with-github.json` — FOUND
- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-aee68869471e4b8d5/test/cli/polling.test.js` — FOUND
- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-aee68869471e4b8d5/test/cli/wizard-github.test.js` — FOUND
- `/Users/alex/dev/klab/kodo/.claude/worktrees/agent-aee68869471e4b8d5/src/cli/polling.js` — FOUND

### Commits exist

- `6fa20c3` (Task 1) — FOUND in `git log`
- `8e70f4f` (Task 2) — FOUND in `git log`
- `3f25bfd` (Task 3) — FOUND in `git log`

## Next Phase Readiness

- **Plan 26-02 (CFG-03):** `src/cli/polling.js` ya creado — Plan 26-02 lo extenderá con los handlers daemon (`runPollingStartCli`, `runPollingStopCli`, `runPollingStatusCli`) y `src/cli/polling-daemon.js` nuevo. Test infra (`test/cli/`) y `npm test` recursion fix ya listas.
- **Plan 26-03 (CFG-04):** `kodo orchestrate --polling` + SIGINT cleanup. Phase 25 `startPolling` ya disponible; Phase 24 `getProvider('github')` ya disponible.
- **No blockers.**

---
*Phase: 26-config-wizard-cli-integration*
*Plan: 26-01*
*Completed: 2026-05-14*
