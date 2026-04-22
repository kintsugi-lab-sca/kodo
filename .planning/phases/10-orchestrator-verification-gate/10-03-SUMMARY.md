---
phase: 10-orchestrator-verification-gate
plan: 03
subsystem: cli
tags: [gsd, cli, commander, thin-handler, exit-codes, discriminated-union, tdd, zero-deps]

# Dependency graph
requires:
  - phase: 10-orchestrator-verification-gate
    plan: 02
    provides: "runGsdVerify({ sessionId }, deps?) returning { verdict, plane, session } — verification gate orchestration"
  - phase: 09-phase-resolver-bootstrap
    provides: "Thin CLI handler pattern (src/cli/gsd-inspect.js + src/cli.js subcommand registration under `gsd` group)"

provides:
  - "runGsdVerifyCli({ sessionId, json? }, deps?): Promise<number> — thin CLI handler, exit codes per Pitfall #6 Opción A"
  - "kodo gsd verify <session-id> [--json] — user-facing command invocable from shell, scriptable via --json"
  - "TRANSIENT_PATTERNS regex distinguishing transient (exit 2) vs internal (exit 1) errors by message match"
  - "renderHuman exhaustive switch over the 4 verdict actions (pass/fail/missing/malformed) with Plane side-effect status line"

affects: [10-04-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin CLI handler: argv → delegation → render → exit code; zero business logic (clone of src/cli/gsd-inspect.js structure)"
    - "Exit code mapping via TRANSIENT_PATTERNS regex match on error.message (Pitfall #6, Opción A)"
    - "Static-grep assertions for src/cli.js wiring (CLI1..CLI4) instead of spawnSync to avoid CI flakiness"
    - "JSDoc header documents Pitfalls #6 and #7 explicitly so reviewers don't add defensive deduplication"

key-files:
  created:
    - "src/cli/gsd-verify.js (116 lines) — thin CLI handler with TRANSIENT_PATTERNS, renderHuman switch, JSON mode"
    - "test/gsd-verify-cli-handler.test.js (402 lines) — 22 tests: 18 handler + 4 static CLI wiring"
  modified:
    - "src/cli.js — registered `gsd verify <session-id>` subcommand after existing `gsd inspect` (16 lines added)"

key-decisions:
  - "TRANSIENT_PATTERNS regex extended beyond plan suggestion: added `fetch.*failed` and `getaddrinfo` alongside `provider.*fetch|ECONNREFUSED|ETIMEDOUT|network`. Rationale: Plane client errors surface as `request failed: ECONNREFUSED`, `fetch failed: ECONNREFUSED`, and DNS resolution failures as `getaddrinfo ENOTFOUND` — capturing all three avoids false-negative exit-1 classifications on genuine network issues."
  - "Added test C7d (`state.json not readable`) to explicitly verify that internal errors NOT matching TRANSIENT_PATTERNS map to exit 1. This guards against regression if the regex is accidentally over-broadened to match internal conditions."
  - "Static CLI1..CLI4 assertions placed in the same test file (not a separate file) to keep the wiring contract collocated with the handler test — exceeds 14+ test threshold (22 total) and simplifies test run invocation."
  - "Description string in src/cli.js includes `(idempotent — duplicates accepted, CONTEXT Deferred)` verbatim to satisfy the CLI4 static grep AND doc Pitfall #7 inline for `kodo gsd verify --help` consumers."
  - "Chose NOT to add `--dry-run` flag (mentioned in CONTEXT §Deferred as optional scope). Plan 10-03 doesn't require it and the existing `src/gsd/verify.js` from Plan 10-02 doesn't expose a no-side-effects mode; adding it would have required Plan 10-02 surgery, out of scope here."

patterns-established:
  - "Thin CLI handler pattern (argv → delegation → render → exit): clone of gsd-inspect.js structure but with delegation to module (src/gsd/verify.js) instead of composing resolver + brief + buildGsdContext inline"
  - "Static grep over spawnSync for CLI wiring assertions: faster, deterministic, survives parallel test runs without port/proc cleanup concerns"
  - "Error-message-based exit-code classification: single regex literal (TRANSIENT_PATTERNS) with multiple alternatives; explicit default to exit 1 ensures the test for 'state.json not readable' path is correct by construction"

requirements-completed: [GSD-05, GSD-06]

# Metrics
duration: 3min
completed: 2026-04-22
---

# Phase 10 Plan 03: `kodo gsd verify <session-id>` CLI Wiring Summary

**Implementa el thin CLI handler `runGsdVerifyCli` en `src/cli/gsd-verify.js` y registra el subcomando `kodo gsd verify <session-id>` en `src/cli.js`. La capa CLI delega 100% en `runGsdVerify` de Plan 10-02 — cero lógica de negocio en el handler. Exit codes 0/1/2 alineados con `gsd-inspect.js` (Pitfall #6 Opción A): 0 para cualquier verdict, 1 para errores internos, 2 para errores transient (matching regex sobre `error.message`). 22 tests pasan al 100%: 18 del handler (exit codes, JSON/human output, DI) + 4 estáticos del wiring en cli.js (CLI1..CLI4).**

## Performance

- **Duration:** ~3 min (RED suite + GREEN handler + cli.js wiring + acceptance verification)
- **Started:** 2026-04-22T14:39:45Z (Wave 3 parallel execution)
- **Tasks:** 2 (Task 1 handler + tests, Task 2 cli.js wiring — single RED/GREEN cycle)
- **Files:** 2 created, 1 modified

## Accomplishments

- `runGsdVerifyCli({ sessionId, json? }, deps?): Promise<number>` — thin handler 100% compatible con el DI pattern de `gsd-inspect.js`. Fallbacks por defecto (`deps.writeFn || process.stdout.write`, `deps.runVerifyFn || runGsdVerify`) permiten tests sin filesystem ni red.
- **Exit codes (Pitfall #6, Opción A):**
  - `0` — Gate corrió entregando cualquier verdict (pass/fail/missing/malformed). Tests C1..C4.
  - `1` — Error interno (session not found, is not GSD, state.json no legible, etc). Tests C5, C6, C7d.
  - `2` — Error transient (provider fetch, ECONNREFUSED, ETIMEDOUT, network, getaddrinfo). Tests C7, C7b, C7c.
- **`TRANSIENT_PATTERNS` regex literal** `/provider.*fetch|fetch.*failed|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i` — match sobre `error.message` para clasificar transient vs interno. El handler NO reimplementa lógica del verify: delega a `runGsdVerify` y mapea la excepción.
- **`renderHuman` exhaustive switch** sobre las 4 ramas del Verdict:
  - `pass` → action/phase_id/must_haves.
  - `fail` → action/phase_id/reason/detail.
  - `missing` → action/phase_id (sin detail, verificado explícitamente por C10.missing).
  - `malformed` → action/phase_id/detail.
  - Línea final `Plane: commented=<bool> transitioned=<bool>` — test C11.
- **`--json` scriptable output:** `JSON.stringify(result, null, 2)` produce output parseable con `jq`. Sin `--json` el output es texto humano, explícitamente no parseable como JSON (C9 asserta `assert.throws(() => JSON.parse(...))`).
- **`src/cli.js` wiring:** `.command('verify <session-id>')` registrado DESPUÉS del bloque `gsd inspect`, ANTES de `program.parse()`. La descripción incluye `(idempotent — duplicates accepted, CONTEXT Deferred)` verbatim — satisface CLI4 static grep y documenta Pitfall #7 inline para `kodo gsd verify --help`.
- **Full project regression: 361 pass, 0 fail, 1 skip (pre-existing).** Ningún test existente se rompió.

## Task Commits

Ciclo TDD aplicado como un único RED/GREEN pair porque Tasks 1 y 2 comparten el archivo de test:

1. **RED commit — failing test suite** — `e963168` (test): 22 tests en `test/gsd-verify-cli-handler.test.js`. Fallan con `ERR_MODULE_NOT_FOUND` porque `src/cli/gsd-verify.js` no existe.
2. **GREEN commit (Task 1) — handler implementation** — `8e4eae6` (feat): `src/cli/gsd-verify.js` (116 lines). 18/22 tests pasan (handler logic); los 4 static tests CLI1..CLI4 siguen fallando porque `src/cli.js` aún no está modificado.
3. **GREEN commit (Task 2) — cli.js wiring** — `1e620a7` (feat): 16 líneas añadidas a `src/cli.js` (bloque `.command('verify <session-id>')` después de `gsd inspect`). 22/22 tests pasan. `program.parse()` sigue siendo único al final del archivo.

## Files Created/Modified

- `src/cli/gsd-verify.js` (created, 116 lines) — Thin CLI handler. Exports: `runGsdVerifyCli` (named). Imports: `runGsdVerify` from `../gsd/verify.js` (solo esta import, zero stdlib I/O directo). JSDoc typedefs `RunGsdVerifyCliOpts` y `RunGsdVerifyCliDeps` para DI. Comentario header documenta Pitfalls #6 (exit codes Opción A) y #7 (idempotencia deferida).
- `test/gsd-verify-cli-handler.test.js` (created, 402 lines) — 22 tests distribuidos en 5 `describe` suites:
  - **Exit codes (Pitfall #6):** C1..C4 (pass/fail/missing/malformed → 0), C5/C6 (session errors → 1), C7/C7b/C7c (transient → 2), C7d (generic internal → 1).
  - **Output format:** C8 (JSON parseable), C9 (human no parseable).
  - **renderHuman exhaustivo:** C10.pass/fail/missing/malformed + C11 (Plane status line).
  - **DI determinismo:** C12 (runVerifyFn invocado exactamente 1 vez con sessionId correcto).
  - **Static wiring:** CLI1..CLI4 (`.command`, dynamic import, `runGsdVerifyCli` identifier, idempotency doc in description).
- `src/cli.js` (modified, +16 lines) — Nuevo bloque `gsd.command('verify <session-id>')` insertado entre el bloque existente `gsd inspect` y `program.parse()`. Patrón idéntico al de `inspect`: `ensureConfig()` → dynamic import del handler → `process.exit(code)` → catch-all con `console.error` + `process.exit(1)`.

## Decisions Made

- **TRANSIENT_PATTERNS regex ampliado respecto al plan:** el plan sugería `/provider.*fetch|ECONNREFUSED|ETIMEDOUT|network/i`. Añadí `fetch.*failed` (porque los errores reales del cliente Plane surfacen como `fetch failed: ECONNREFUSED`) y `getaddrinfo` (DNS ENOTFOUND en entornos con Tailscale/WARP — relevante para el entorno de dev per MEMORY.md). Alternativa rechazada: pattern más estricto — introduciría falsos negativos classificando errores transient como internal.
- **C7d añadido más allá del plan:** el plan especificaba 3 tests transient (C7) sin contraparte. Añadí un test explícito (`state.json not readable`) que verifica que un error NO matching TRANSIENT_PATTERNS retorna exit 1. Cost: +8 lines de test. Benefit: guard contra regresiones si alguien ensancha accidentalmente la regex a patterns que capturen errores internos.
- **Un solo archivo de test para handler + wiring estático:** el plan permite ambos bajo el literal "APPEND al archivo creado en Task 1". Decisión: un solo file (`test/gsd-verify-cli-handler.test.js`) con 5 describe blocks. Simplifica invocation (`node --test test/gsd-verify-cli-handler.test.js`) y mantiene el contrato CLI ↔ handler collocado.
- **NO --dry-run flag:** CONTEXT §Deferred lo menciona como optional. Plan 10-03 no lo requiere. Añadirlo habría requerido modificar `runGsdVerify` (Plan 10-02) para aceptar un flag no-side-effects, fuera de scope para este plan. Backlog.
- **Descripción del comando CLI en inglés + castellano mixto ("idempotent — duplicates accepted, CONTEXT Deferred"):** el resto de descripciones en `src/cli.js` están en inglés (`"Dry-run the phase resolver..."`, `"Emit structured verdict as JSON..."`). Mantuve inglés para consistencia, pero conservé la palabra "idempotent" (no "idempotente") porque es el match token para CLI4 y alinea con el término técnico estándar.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] TRANSIENT_PATTERNS regex plan-suggested era incompleta**
- **Found during:** Task 1 GREEN implementation, al revisar los modos en que el cliente Plane surface errores.
- **Issue:** El plan sugería `/provider.*fetch|ECONNREFUSED|ETIMEDOUT|network/i`. Los errores reales del cliente Plane/fetch pueden aparecer como `fetch failed: ECONNREFUSED` (sin "provider" prefix) o `getaddrinfo ENOTFOUND` (DNS). Ambos son transient pero no match el regex original.
- **Fix:** Añadir alternativas `fetch.*failed` y `getaddrinfo` al literal regex. Tests C7 (`provider fetch failed`), C7b (`ETIMEDOUT`), C7c (`network unreachable`) ya cubrían el caso happy; C7d (`state.json not readable`) protege contra sobre-matching.
- **Files modified:** `src/cli/gsd-verify.js` línea 35 (TRANSIENT_PATTERNS literal).
- **Verification:** 7 tests de exit code pasan (C1..C7d con la regex ampliada).
- **Committed in:** `8e4eae6` (GREEN handler commit — la regex fue ampliada antes del commit inicial, no en un segundo commit).

---

**Total deviations:** 1 auto-fixed (Rule 2 defensive hardening). Ningún checkpoint. Ninguna decisión arquitectónica.
**Impacto en plan:** Cero scope creep. La ampliación de TRANSIENT_PATTERNS es alineamiento defensivo con el shape real de errores del cliente Plane/fetch.

## Issues Encountered

Ninguno. El `<action>` skeleton del plan era directamente aplicable gracias al patrón espejo con `gsd-inspect.js`. El único ajuste fue la ampliación de TRANSIENT_PATTERNS (Deviation #1).

## Deferred Issues

Ninguno. Plan 10-03 terminó completo con 22/22 tests passing y 16/16 acceptance criteria satisfechos (10 de Task 1 + 6 de Task 2).

## TDD Gate Compliance

- **RED gate:** `e963168` `test(10-03): add failing tests for gsd verify CLI handler` — 22 tests fallan con `ERR_MODULE_NOT_FOUND` porque `src/cli/gsd-verify.js` no existe al momento del commit.
- **GREEN gate (Task 1):** `8e4eae6` `feat(10-03): implement runGsdVerifyCli thin handler` — 18/22 tests pasan (tests del handler). Los 4 estáticos CLI1..CLI4 siguen fallando porque `src/cli.js` aún no modificado.
- **GREEN gate (Task 2):** `1e620a7` `feat(10-03): register kodo gsd verify <session-id> subcommand` — 22/22 tests pasan. Full regression: 361 pass, 0 fail, 1 skip.
- **REFACTOR gate:** no requerido — el handler es idiomático (thin delegation, regex literal hoisted, switch exhaustivo, JSDoc completo) y no necesitó cleanup pass.

## User Setup Required

Ninguno. El subcomando `kodo gsd verify <session-id>` está disponible inmediatamente tras `npm link` o invocación directa del binario `bin/kodo`. Los defaults funcionan contra la instalación real (findSession + getProvider + loadConfig via `runGsdVerify` de Plan 10-02).

## Next Phase Readiness

- **Plan 10-04** (integration tests con prompt.md + stop.js extendido) puede ya:
  - Invocar el CLI end-to-end vía `spawnSync('node', ['bin/kodo', 'gsd', 'verify', '<session-id>'])` para tests de humo (alternativa al DI pattern).
  - Asumir exit codes estables: 0/1/2 según Pitfall #6 Opción A.
  - Asumir `--json` como formato scriptable para parsing con `JSON.parse`.
- El orquestador Claude (src/orchestrator/prompt.md, Plan 10-04) puede ya referenciar `kodo gsd verify <session-id>` con la garantía de que existe, tiene `--help` descriptivo (incluyendo idempotencia documentada), y retorna exit codes deterministas.

## Self-Check: PASSED

- `src/cli/gsd-verify.js` exists — FOUND
- `test/gsd-verify-cli-handler.test.js` exists — FOUND
- `src/cli.js` modified (gsd verify block) — FOUND (line 260 onwards)
- Commit `e963168` (test RED) — FOUND in `git log --oneline`
- Commit `8e4eae6` (feat Task 1 GREEN) — FOUND in `git log --oneline`
- Commit `1e620a7` (feat Task 2 GREEN) — FOUND in `git log --oneline`
- `node --test test/gsd-verify-cli-handler.test.js` exits 0, `pass 22 fail 0`
- `node --test test/*.test.js` exits 0, `pass 361 fail 0 skipped 1` (no regressions from Wave 2 baseline)
- All 16 acceptance criteria from Task 1/2 satisfied:
  - Task 1 (10): runGsdVerifyCli exported, TRANSIENT_PATTERNS/ECONNREFUSED present, case 'pass'/'malformed' present, Pitfall #6/#7 documented, 22 it() tests (>= 10 threshold), code==1 and code==2 assertions, JSON.parse(stdout) check.
  - Task 2 (6): .command('verify <session-id>') literal present, import('./cli/gsd-verify.js') literal present, runGsdVerifyCli identifier present, idempotent|duplicates accepted regex match, program.parse() count == 1, all 22 tests pass.
- Zero new runtime dependencies (only imports: `runGsdVerify` from `../gsd/verify.js` in handler; `node:fs` + handler in tests).
- Pitfalls #6 and #7 explicitly resolved in code (grep + test evidence above).
- Exit codes 0/1/2 tested individually with regex-matching error messages (C1..C7d).
- Static CLI wiring tested without spawnSync (readFileSync + string.includes) → determinista, rápido, sin flakiness de CI.

---

## Known Stubs

Ninguno. El módulo es fully functional. El único potencial `// @ts-check` warning sería el uso de `any` en JSDoc (`/** @type {any} */`) pero es idiomático en kodo (ver `gsd-inspect.js` para el mismo patrón).

## Threat Flags

Ninguna superficie nueva introducida. El CLI handler es puro argv → delegación → stdout/stderr write → exit code; no abre sockets, no lee filesystem fuera de lo que `runGsdVerify` (Plan 10-02) orquesta. Los 5 threats del threat_model del plan (T-10-03-01..05) se mantienen en disposition `accept`/`mitigate`:
- T-10-03-03 (JSON injection via stringify): mitigate — `JSON.stringify(result, null, 2)` sanitiza automáticamente; tests C8/C9 verifican outputs válidos.
- T-10-03-02 (TRANSIENT_PATTERNS regex bypass): accept — si un error interno con mensaje "network" matchea accidentalmente, retorna exit 2 en vez de 1; el operador ve el mensaje en stderr y puede distinguir. Zero privilege escalation.

---
*Phase: 10-orchestrator-verification-gate*
*Plan: 03*
*Completed: 2026-04-22*
