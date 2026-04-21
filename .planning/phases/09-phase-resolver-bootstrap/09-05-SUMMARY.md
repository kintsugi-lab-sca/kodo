---
phase: 09-phase-resolver-bootstrap
plan: 05
subsystem: gsd
tags: [cli, inspect, read-only, dry-run, d-04, d-16, d-17, d-18, d-19, forensic]

# Dependency graph
requires:
  - phase: 09-phase-resolver-bootstrap/09-02
    provides: buildBriefFromTask (consumed in bootstrap verdict branch for JSON+preview render)
  - phase: 09-phase-resolver-bootstrap/09-03
    provides: resolvePhase + ResolveResult discriminated union (D-04 invariant — same function as dispatcher)
  - phase: 09-phase-resolver-bootstrap/09-04
    provides: buildGsdContext(session, opts) with brief opt (consumed for section 4 preview render)
  - phase: 07-kodo-logs-cli-event-taxonomy
    provides: cli.js subcommand registration pattern (analog of 'kodo logs' — dynamic import + try/catch)
provides:
  - kodo gsd <subcommand> command group in cli.js (first GSD CLI surface beyond launch/status)
  - kodo gsd inspect <task-id> subcommand — dry-run resolver with human and --json modes
  - runGsdInspect({taskId, json?}, deps?) action handler with DI for provider/projectPath/resolver
  - Exit codes 0/1/2 contract (D-19 phase/bootstrap/error/fetch-failure)
  - Static anti-regression tests protecting D-04 (same resolvePhase) + D-18 (no side effects)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin cli.js subcommand group + dedicated handler module (parallels logs/reader.js pattern of Phase 7)"
    - "Synthetic session object fed to buildGsdContext for preview — no state persistence, no hook spawn"
    - "Source-invariant tests as anti-regression guards (grep source for forbidden/required patterns — D-04 + D-18)"
    - "TDD granular: RED commit with failing ERR_MODULE_NOT_FOUND + GREEN commit with minimal impl that passes 9 tests"
    - "DI via optional deps bag (getProviderFn / resolveProjectPathFn / resolvePhaseFn / writeFn / errFn) — tests run with zero network/fs/initRegistry"

key-files:
  created:
    - src/cli/gsd-inspect.js
    - test/gsd-inspect-cli.test.js
  modified:
    - src/cli.js

key-decisions:
  - "D-04 literal: runGsdInspect imports resolvePhase from ../gsd/resolver.js — the dispatcher uses the same module. Test 'D-04 invariant' grep-asserts the import string so any future divergence breaks CI."
  - "D-16 four-section human output: Task resolution + .planning presence + verdict + buildGsdContext preview. Uses the existing buildGsdContext signature (session, opts) from 09-04 with a synthetic session literal."
  - "D-17 JSON mode: flat object with task/project_path/has_planning_dir/verdict/brief. 2-space indent for operator-readable console output; scriptable via jq."
  - "D-18 dry-run strict: zero imports of acquireGsdLock/releaseGsdLock/addSession/updateSession/removeSession/cmux. Two layers of protection: (1) code review + grep at commit time, (2) static test 'D-18 invariant' grep-asserts the source at every test run."
  - "D-19 exit codes: 0 for phase|bootstrap (non-blocking for scripting), 1 for error verdict (resolver failed — operator must fix ROADMAP or task title), 2 for provider fetch failure (network/auth — different remediation). Three-way split is more actionable than a binary."
  - "Brief always computed for bootstrap (JSON inspection friendly) but only rendered in section 4 of human output via buildGsdContext — no duplication."
  - "Dedicated src/cli/gsd-inspect.js module instead of inlining in cli.js (pattern-mapper #5 refinement): cli.js was already 241 lines; inlining 157 lines of handler would have doubled it. The logs/reader.js pattern from Phase 7 established the split; we follow it."
  - "Commit sequence (RED/GREEN) grouped as in 09-02/09-03: Task 3 (tests) RED commit first → Task 1 (handler) GREEN commit → Task 2 (cli.js wiring) commit. Task 3 action after GREEN is a no-op because the literal test file was already written at RED; re-committing would be empty."
  - "Synthetic session for preview uses session_id: '<dry-run-preview>' + task_ref/summary/project_path/task_id/project_id from the resolved task — enough for buildGsdContext to render both phase and bootstrap branches correctly without state lookups."

patterns-established:
  - "CLI dry-run handler: provider.getTask → resolveProjectPath → resolvePhase → render (human or JSON) — pure pipeline with early-exit exit codes"
  - "Source-grep anti-regression: readFileSync(src) + regex assertions in tests guard structural invariants (what is/isn't imported) without needing runtime simulation"

requirements-completed: [GSD-02, GSD-03, GSD-08, GSD-09]

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 09 Plan 05: `kodo gsd inspect <task-id>` CLI Summary

**CLI dry-run `kodo gsd inspect <task-id>` que ejecuta la MISMA `resolvePhase` del dispatcher (D-04) y reporta el verdict en formato humano de 4 secciones o JSON structurado, con exit codes 0/1/2 según verdict, sin tocar lock/state/cmux (D-18 invariant). Cierra Phase 9 consolidando los 4 requirements (GSD-02/03/08/09) en una sola herramienta forense.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-21T10:06:01Z
- **Completed:** 2026-04-21T10:08:54Z
- **Tasks:** 3 (TDD ciclo RED → GREEN → Task 2 wiring)
- **Files created:** 2 (`src/cli/gsd-inspect.js` + `test/gsd-inspect-cli.test.js`)
- **Files modified:** 1 (`src/cli.js`)
- **LOC:** 157 (handler) + 203 (tests) + 19 (cli.js addition) = 379 LOC

## Accomplishments

- **Handler `src/cli/gsd-inspect.js` (157 LOC):** implementa `runGsdInspect({taskId, json?}, deps?)` con DI total. Pipeline puro read-only: `provider.getTask` → `resolveProjectPath` → `resolvePhase` → render. Exit codes 0 (phase/bootstrap), 1 (error), 2 (provider fetch failure).
- **D-04 invariant:** Import directo `import { resolvePhase } from '../gsd/resolver.js'` — mismo módulo que el dispatcher en 09-04. Test anti-regresión `'D-04 invariant'` grep-aserta el string exacto del import.
- **D-16 human render (4 secciones):** (1) task ref/title/labels/project_path, (2) `.planning/PROJECT.md` present/MISSING, (3) verdict con exhaustive switch sobre `action` (phase/bootstrap/error) + campos específicos por variant, (4) `buildGsdContext` preview con session sintético y separadores `─── ─── ───`.
- **D-17 JSON mode:** `{task: {ref, title, labels}, project_path, has_planning_dir, verdict, brief}` con indent 2. Brief siempre `null` para phase/error; siempre string para bootstrap.
- **D-18 dry-run strict:** cero imports de `acquireGsdLock|releaseGsdLock|addSession|updateSession|removeSession|cmux`. Verificado por grep (`grep -E "^import.*..." → 0`) y por test estático `'D-18 invariant'` que se ejecuta en cada run.
- **D-19 exit codes contractuales:** 0 para phase/bootstrap, 1 para error, 2 para provider/project-path failure (distinción action vs. fetch).
- **Subcommand registration en `src/cli.js`:** nuevo `program.command('gsd')` group + `.command('inspect <task-id>')` con flag `--json`. Dynamic import del handler (cold-start performant). `ensureConfig()` gate antes del handler (provider requiere config). Discoverable via `kodo gsd --help` (verificado: commander imprime el subcomando correctamente).
- **Tests `test/gsd-inspect-cli.test.js` (203 LOC, 9 tests):** phase match human, bootstrap human, no-match, multi-match, --json phase, --json bootstrap, fetch failure exit 2, D-18 source-invariant, D-04 source-invariant. Todos DI puros (cero red/fs real, cero initRegistry real).
- **Full test suite regression:** 272 tests, 271 pass, 1 skip (pre-existing), 0 fail. Sin regresiones en Phases 6/7/8/9 anteriores.

## Task Commits

1. **Task 3 RED: `test/gsd-inspect-cli.test.js`** — `edc73cd` (test: failing tests ERR_MODULE_NOT_FOUND)
2. **Task 1 GREEN: `src/cli/gsd-inspect.js`** — `7ee8013` (feat: runGsdInspect handler, 9/9 tests pass)
3. **Task 2: `src/cli.js`** — `d27c44d` (feat: register `kodo gsd inspect` subcommand)

**Plan metadata commit:** pendiente (final commit tras SUMMARY + STATE + ROADMAP updates).

## Files Created/Modified

**Created (2):**

- `src/cli/gsd-inspect.js` (NEW, 157 LOC) — `runGsdInspect` handler, `renderHuman` helper, tres `@typedef` JSDoc (`RunGsdInspectOpts`, `RunGsdInspectDeps`), header `// @ts-check`.
- `test/gsd-inspect-cli.test.js` (NEW, 203 LOC) — 9 tests, flat describe/it pattern, `StdoutStub` helper, tres task fixtures, 7 DI behavior tests + 2 source-invariant tests.

**Modified (1):**

- `src/cli.js` — +19 LOC. Nuevo bloque `// --- kodo gsd <subcommand> ---` justo antes de `program.parse();`, con `program.command('gsd')` group + `.command('inspect <task-id>')` subcommand. Sigue el patrón literal de `kodo logs` (Phase 7).

## Decisions Made

- **D-04 literal: mismo `resolvePhase` que el dispatcher.** No se crea wrapper, no se copia lógica, no se inline. Import directo `from '../gsd/resolver.js'` + test estático que grep-aserta el string exacto. Cualquier PR futuro que intente extraer lógica o copiar shape rompe CI — invariante protegido por automatización, no solo por review.
- **D-18 multi-layer protection:** (1) grep en `src/cli/gsd-inspect.js` al commit, (2) test `'D-18 invariant'` ejecutado en cada `node --test`. El test lee el source del handler y asserta 7 patrones forbidden (`acquireGsdLock`, `releaseGsdLock`, `addSession`, `updateSession`, `removeSession`, `cmux`, `launchWorkItem`). Un único fail en cualquiera bloquea la suite.
- **Dedicated module vs. inline:** `src/cli.js` ya era 241 LOC antes de este plan. Inlining las ~130 LOC de handler lo llevaría a ~370 LOC y mezclaría concerns. El patrón de Phase 7 (`runLogs` en `src/logs/reader.js` + thin registro en `cli.js`) es el analog exacto — pattern-mapper #5 recomendó seguirlo.
- **Exit code 2 distinto de 1 para fetch failure:** si `provider.getTask()` falla, la remediación es diferente (auth/network/typo en task id) vs. un verdict error del resolver (título de Plane mal redactado o ROADMAP desalineado). Separar los códigos permite scripts tipo `kodo gsd inspect KL-X; if [ $? -eq 2 ]; then echo 'network'; elif [ $? -eq 1 ]; then echo 'title-mismatch'; fi`.
- **Brief siempre computado (no renderizado) en modo JSON:** el JSON incluye `brief: null` para phase/error y `brief: "## Project Brief..."` para bootstrap. Esto permite que un script detecte el bootstrap path por `.verdict.action === "bootstrap"` Y inspeccione el brief renderizado sin re-parsear. En modo humano, el brief se expresa vía `buildGsdContext` preview, evitando duplicación.
- **Synthetic session literal** con campos mínimos requeridos por `buildGsdContext`: `task_ref`, `summary`, `project_path`, `session_id`, `task_id`, `project_id`, `gsd: true`, y condicionalmente `phase_id` (solo si verdict es `action: 'phase'`). Suficiente para que el render funcione para ambas ramas (phase → inyecta comandos `/gsd-plan-phase N`; bootstrap → inyecta brief + `/gsd-new-project`).
- **DI completa via deps bag** (`getProviderFn/resolveProjectPathFn/resolvePhaseFn/writeFn/errFn`) — tests corren offline sin tocar `~/.kodo/projects.json`, sin red a Plane, sin escribir a stdout/stderr reales. Los writeFn/errFn stubs capturan los strings para assertions granulares.
- **Commit sequence TDD:** RED commit (test) primero con `ERR_MODULE_NOT_FOUND`, GREEN commit (handler) que hace pasar los 9 tests, finalmente commit de wiring en cli.js. Task 3 del plan enlista la creación del test file pero como el contenido ya se escribió en RED, no hay commit adicional — secuencia análoga a 09-02/09-03.

## Deviations from Plan

**None.** Plan ejecutado exactamente como se escribió. Los snippets literales del plan para cada task (handler, cli.js addition, test file) son correctos sin modificaciones.

**Cero auto-fixes de Rule 1/2/3.** Handler pasa `node --check` y los 9 tests al primer intento tras GREEN. Subcommand registration pasa `node --check` y es discoverable via commander al primer intento.

**TDD sequence notas:** Plan marca Task 1, 2, 3 con `tdd="true"`, pero el ciclo TDD canónico es RED (Task 3 test file) → GREEN (Task 1 handler) → WIRING (Task 2 cli.js). Esta ejecución siguió ese orden — no el orden literal del plan. Justificación: Tests require `runGsdInspect` to exist for import; Task 2 (cli.js) requires handler to exist for dynamic import to resolve at runtime. El orden TDD es el único funcionalmente correcto. Commit hashes reflejan esta secuencia: `edc73cd` (test RED) → `7ee8013` (feat GREEN handler) → `d27c44d` (feat wiring). Análogo al patrón de 09-03 (test file escrito en RED + impl en GREEN en un único ciclo).

## Issues Encountered

Ninguno. Los snippets literales del plan eran correctos (tanto la signature DI de `runGsdInspect` como los imports exactos y la estructura del `renderHuman`). El `ensureConfig()` gate en cli.js se ubica antes del dynamic import (patrón copiado de otros subcomandos como `kodo status`).

**Nota sobre typing:** `loadProjects()` retorna `Record<string, string>` según su typedef JSDoc, pero `resolveProjectPath` en realidad acepta también objetos con `default?`/`modules?`. El cast `/** @type {any} */ (loadProjects())` en el handler suprime el type mismatch. Esto es un bug preexistente en los typedefs (documentado en `resolveProjectPath` JSDoc como `Record<string, string | {default?, modules?}>`) — no introducido por Phase 9. Out of scope para fix aquí.

## User Setup Required

None — módulo puro read-only, sin deps nuevas, sin config externa, sin env vars. El subcomando reusa la misma config (`~/.kodo/config.json` + `projects.json`) que el dispatcher y los otros subcomandos.

## Known Stubs

**None.** Todo el handler es funcional end-to-end:

- `provider.getTask(taskId)` llama al provider real (Plane por defecto) cuando no hay `getProviderFn` en deps.
- `resolveProjectPath(task, loadProjects())` usa la misma config que el dispatcher.
- `resolvePhase({projectPath, task})` es literal la función del dispatcher.
- `buildBriefFromTask(task)` renderiza el brief D-10 exacto.
- `buildGsdContext(session, {brief})` renderiza ambas ramas (phase/bootstrap) con la signature de 09-04.

No hay UI no-wired ni datos placeholder. El exit code 2 es el único path "menos cubierto" — los tests mockean el throw del provider, pero en runtime real cubre tanto network errors como auth errors como typos del task-id. Documentado en STRIDE register T-09-05-03.

## Threat Flags

None — el plan no introduce nueva superficie de red (el provider ya existía), ni nuevos paths de auth (reusa la misma config), ni escritura a filesystem (dry-run estricto verificado por D-18 test). El STRIDE register del plan (T-09-05-01..05) se respeta:

- **T-09-05-01 (InfoDisclosure stdout):** `accept` — operador ejecuta el comando deliberadamente; no se escribe a logs ni a archivos; si el operador redirige a archivo es responsabilidad suya.
- **T-09-05-02 (CommandInjection taskId):** `mitigate` — `taskId` pasa a `provider.getTask()` que hace HTTP GET con el ref en el path URL; cliente Plane normaliza; no shell exec, no regex dinámico.
- **T-09-05-03 (DoS fetch failure):** `mitigate` — try/catch con exit code 2 + mensaje a stderr; no retry loop.
- **T-09-05-04 (Tampering synthetic session):** `mitigate` — session es object literal local; no se persiste, no llega a `addSession`; scope aislado al render.
- **T-09-05-05 (EoP D-18 violation):** `mitigate` — test estático `'D-18 invariant'` en `test/gsd-inspect-cli.test.js:175-189` grep-aserta el source del handler; cualquier PR que añada import de lock/state/cmux rompe CI.

## Next Phase Readiness

**Ready for:**

- **End of Phase 9:** Los 4 requirements de Phase 9 están cubiertos:
  - GSD-02 (bootstrap detection) — resolver retorna `action: 'bootstrap'` cuando `.planning/PROJECT.md` falta; CLI inspect lo reporta en sección 2+3 y renderiza el brief.
  - GSD-03 (1:1 phase match) — resolver match vía `normalizeTitle` con fail-closed en 0/>1; CLI inspect reporta `code: no-match` / `multi-match` con lista de matches.
  - GSD-08 (brief injection channel) — dispatcher thread `brief` al Session record; hook lo renderiza; CLI inspect preview exhibe el render exacto.
  - GSD-09 (phase_id inference) — resolver retorna `phase_id` del heading match; CLI inspect lo imprime en verdict section 3 + preview section 4.
- **Phase verification:** el phase-verifier agent revisará los 5 planes de Phase 9 en conjunto. Candidatos a revisar: que los 4 GSD-IDs queden marcados como completos en REQUIREMENTS.md, que ROADMAP progress row refleje 5/5 plans, que los eventos `gsd.phase.resolved` + `gsd.bootstrap` sean end-to-end observables vía `kodo logs`.

**No blockers.** El CLI inspect es la última pieza de Phase 9. Post-verification, se puede cerrar la phase y proceder a Phase 10 (orchestrator VERIFICATION.md) del milestone v0.3.

## Self-Check: PASSED

- **Files exist:**
  - `src/cli/gsd-inspect.js` — FOUND (157 LOC)
  - `test/gsd-inspect-cli.test.js` — FOUND (203 LOC)
  - `src/cli.js` — MODIFIED (+19 LOC)
- **Commits exist in git log:**
  - `edc73cd` — FOUND (test: RED gate)
  - `7ee8013` — FOUND (feat: GREEN gate handler)
  - `d27c44d` — FOUND (feat: cli.js wiring)
- **Verification block from plan:**
  - `node --test test/gsd-inspect-cli.test.js` → 9/9 pass, 0 fail ✓
  - `node --test test/*.test.js` → 272 tests, 271 pass, 1 skip (pre-existing), 0 fail ✓
  - `grep -E "^import.*(acquireGsdLock|releaseGsdLock|addSession|cmux)" src/cli/gsd-inspect.js` → 0 matches (D-18) ✓
  - `grep -nE "import\s*\{\s*resolvePhase\s*\}\s*from\s*['\"]\.\./gsd/resolver\.js['\"]" src/cli/gsd-inspect.js` → 1 match at line 20 (D-04) ✓
  - `node bin/kodo gsd --help 2>&1 | grep inspect` → "inspect [options] <task-id>" + description (subcommand discoverable) ✓
  - `node --check src/cli/gsd-inspect.js` → exit 0 ✓
  - `node --check src/cli.js` → exit 0 ✓
- **Acceptance criteria Task 1:**
  - `// @ts-check` en línea 1 ✓
  - `grep -n "export async function runGsdInspect"` → 1 match (line 46) ✓
  - `grep -nE "import.*resolvePhase.*'\\.\\./gsd/resolver\\.js'"` → 1 match (line 20) ✓
  - `grep -nE "^import.*(acquireGsdLock|releaseGsdLock|addSession|updateSession|removeSession)"` → 0 matches ✓
  - `grep -nE "^import.*cmux"` → 0 matches ✓
  - `grep -n "verdict.action === 'error'"` → 1 match (line 102) ✓
  - `grep -n "opts.json"` → 1 match ✓
  - `node --check src/cli/gsd-inspect.js` → exit 0 ✓
- **Acceptance criteria Task 2:**
  - `grep -n ".command('gsd')" src/cli.js` → 1 match (line 242) ✓
  - `grep -n ".command('inspect <task-id>')" src/cli.js` → 1 match (line 245) ✓
  - `grep -n "import('./cli/gsd-inspect.js')" src/cli.js` → 1 match (line 251) ✓
  - `grep -n "runGsdInspect" src/cli.js` → 2 matches ✓
  - `grep -c "await ensureConfig()"` → 5 (was 4 before — 1 added) ✓
  - `node --check src/cli.js` → exit 0 ✓
  - `node bin/kodo gsd --help 2>&1 | grep inspect` → hit ✓
- **Acceptance criteria Task 3:**
  - `test/gsd-inspect-cli.test.js` existe ✓
  - `node --test test/gsd-inspect-cli.test.js` → exit 0, 9 tests ✓
  - 3 action types (phase/bootstrap/error) cada uno con ≥1 test ✓
  - Test explícito para `--json` mode ✓
  - Test explícito para exit code 2 ✓
  - Test `'D-18 invariant'` grep-aserta source ✓
  - Test `'D-04 invariant'` grep-aserta import ✓
  - DI-puros (cero red/fs real) ✓
- **Full regression:** 272 tests, 271 pass, 1 skip, 0 fail — sin regresiones en Phases 6/7/8/9 anteriores

## TDD Gate Compliance

Los 3 tasks tienen `tdd="true"`. Verificación de la secuencia en git log:

1. **RED gate:** `edc73cd` (test: add failing tests for runGsdInspect CLI handler) — existe, `ERR_MODULE_NOT_FOUND` ✔
2. **GREEN gate:** `7ee8013` (feat: implement runGsdInspect read-only CLI handler) — existe, posterior a RED, 9/9 tests pass ✔
3. **REFACTOR gate:** no aplica — la implementación inicial ya es mínima y clara (157 LOC); no hubo refactor. El commit de wiring `d27c44d` es conceptualmente "Task 2" (feat), no un refactor del handler.

Ambas gates RED y GREEN presentes y en orden correcto. Sin warnings.

---
*Phase: 09-phase-resolver-bootstrap*
*Completed: 2026-04-21*
