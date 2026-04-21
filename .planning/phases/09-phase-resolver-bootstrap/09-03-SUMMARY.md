---
phase: 09-phase-resolver-bootstrap
plan: 03
subsystem: gsd
tags: [resolver, discriminated-union, orchestration, tdd, d-02, d-06, d-13]

# Dependency graph
requires:
  - phase: 09-phase-resolver-bootstrap/09-01
    provides: parseRoadmap + normalizeTitle (pure parser consumed via import from ./roadmap.js)
  - phase: 08-gsd-label-session-plumbing
    provides: src/gsd/lock.js analog (shape de discriminated union @typedef AcquireResult → ResolveResult)
provides:
  - resolvePhase({projectPath, task}) → ResolveResult (discriminated union PhaseVerdict | BootstrapVerdict | ErrorVerdict)
  - Three @typedef exports: PhaseVerdict, BootstrapVerdict, ErrorVerdict, plus union ResolveResult
  - Strict 1:1 title match semantics with fail-closed verdict on 0/>1 matches (D-13)
  - GSD-02 strict presence guard (bootstrap when PROJECT.md absent, short-circuits before reading ROADMAP)
affects: [09-04-dispatcher-wiring, 09-05-cli-inspect]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated union via JSDoc @typedef (analog de AcquireResult en src/gsd/lock.js:48)"
    - "Orquestación read-only: existsSync + readFileSync síncronos, sin realpathSync ni escrituras"
    - "Zero acoplamiento: resolver no importa logger/state/dispatcher; solo node:fs, node:path y ./roadmap.js"
    - "TDD atómico por task: commit RED con tests fallando (ERR_MODULE_NOT_FOUND), commit GREEN con implementación que pasa los 11 tests"

key-files:
  created:
    - src/gsd/resolver.js
    - test/gsd-resolver.test.js
  modified: []

key-decisions:
  - "D-02 verdict literal: exactly 3 actions (phase | bootstrap | error) con los 3 códigos de error (no-match | multi-match | roadmap-missing) — cierra exhaustive switch aguas abajo"
  - "D-06 match target: normalizeTitle(task.title) === normalizeTitle(phase.title) — NO el heading completo; el test 'matches against title only' asserta ambos lados (title matches, heading form falla)"
  - "D-13 fail-closed: 0 matches y >1 matches retornan error verdict; solo el caller (dispatcher 09-04) tiene contexto para liberar lock y retornar resolver_failed"
  - "GSD-02 strict guard: si falta PROJECT.md, NO se abre ROADMAP.md — evita que un repo half-init (solo ROADMAP) rompa el shortcut"
  - "Sin realpathSync: lock.js usa realpath para colapsar symlinks en `/tmp`, pero resolver solo lee dos archivos por path construido — duplicar realpath es caro e inconsistente (pattern-mapper note)"
  - "Tests de integración con tmpDir real (mkdtempSync + rmSync) — cero mocks, cero DI; el resolver NO tiene dependencias inyectables porque filesystem IS el contract"

patterns-established:
  - "Discriminated union ResolveResult: PhaseVerdict | BootstrapVerdict | ErrorVerdict — consumers en 09-04 y 09-05 usarán switch(verdict.action) exhaustivo"
  - "Integration tests puros con mkdtempSync: sin módulos-de-test mockeados, el fixture ES la estructura de .planning/"

requirements-completed: [GSD-02, GSD-03]

# Metrics
duration: 2min
completed: 2026-04-21
---

# Phase 09 Plan 03: Resolver Discriminated Union Summary

**Orquestación pura `src/gsd/resolver.js` con `resolvePhase({projectPath, task})` que devuelve `PhaseVerdict | BootstrapVerdict | ErrorVerdict` — combina GSD-02 strict guard, parser de 09-01 y match 1:1 estricto fail-closed, validado por 11 tests de integración con fixtures tmpDir.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-21T09:45:23Z
- **Completed:** 2026-04-21T09:47:33Z
- **Tasks:** 2 (TDD: RED + GREEN como commits atómicos para Task 1; Task 2 cubierto por el test file ya creado en RED gate)
- **Files created:** 2 (ambos nuevos)

## Accomplishments

- `src/gsd/resolver.js` (80 LOC) implementa `resolvePhase` con discriminated union de 3 verdicts (phase / bootstrap / error) y 3 códigos de error (no-match / multi-match / roadmap-missing). Cero acoplamiento: solo imports `node:fs`, `node:path`, y `./roadmap.js` (reuso de `parseRoadmap` + `normalizeTitle` del plan 09-01).
- GSD-02 strict guard implementado como short-circuit: si `.planning/PROJECT.md` falta, retorna bootstrap SIN abrir ROADMAP.md — evita que un repo half-init rompa el flujo.
- D-13 fail-closed semantics: `roadmap-missing` (PROJECT presente pero ROADMAP ausente), `no-match` (0 fases matchean), `multi-match` (≥2 fases matchean con lista `["Phase N: title", ...]`) retornan error verdict. El dispatcher (09-04) liberará lock y retornará `resolver_failed`.
- D-06 enforced en tests: match solo contra `phase.title`, NO contra el heading completo. El test asserta que `'Foo'` matchea pero `'Phase 7: Foo'` NO.
- D-07 strict normalization: `normalizeTitle` aplicado a AMBOS lados del match (task.title + phase.title). Tolerante a whitespace y case; estricto en puntuación.
- Zero realpathSync: el dispatcher ya resuelve projectPath; duplicar realpath aquí sería inconsistente y caro. Documentado en el header JSDoc.
- 11 tests de integración con `mkdtempSync` + `rmSync` cubren los 5 estados del verdict + edge cases: bootstrap con .planning/ half-init, ROADMAP vacío, headings `#` y `####` ignorados, case/whitespace tolerance, puntuación estricta, D-06 title-only.
- **Full test suite regression check:** 251 tests, 250 pass, 1 skip (pre-existing), 0 fail. Sin regresiones.

## Task Commits

1. **Task 1 RED: `test/gsd-resolver.test.js`** — `7145cf1` (test: failing tests, ERR_MODULE_NOT_FOUND)
2. **Task 1 GREEN: `src/gsd/resolver.js`** — `a612c41` (feat: resolvePhase implementation, 11/11 tests pass)

**Plan metadata commit:** (pending — final commit tras este SUMMARY + STATE + ROADMAP updates)

**Nota sobre orden TDD:** El plan lista Task 1 (resolver.js) antes de Task 2 (test file), pero ambos con `tdd="true"`. TDD canónico exige que los tests se escriban PRIMERO y fallen (RED), luego la implementación (GREEN). Ejecuté ambas tasks en un ciclo RED→GREEN único: el test file completo (11 tests del plan) se escribió y commiteó en RED; la implementación del resolver en GREEN. El test file de Task 2 es idéntico al del RED gate porque el plan ya contiene el contenido literal — no hay fragmentación artificial entre "test mínimo" y "test completo". Análogo al patrón usado en 09-02.

## Files Created/Modified

- `src/gsd/resolver.js` (NEW, 80 LOC) — `resolvePhase`, 4 typedefs JSDoc (`PhaseVerdict`, `BootstrapVerdict`, `ErrorVerdict`, `ResolveResult`), header `// @ts-check`
- `test/gsd-resolver.test.js` (NEW, 148 LOC) — 11 tests con `node:test` + `assert/strict`, `mkdtempSync`/`rmSync` fixtures, helper `writePlanning`

## Decisions Made

- **D-02 verdict shape literal del CONTEXT respetado sin modificación:** Los 3 typedefs cierran exactamente con `action: 'phase'|'bootstrap'|'error'` y los 3 códigos de error `'no-match'|'multi-match'|'roadmap-missing'`. Cualquier consumer puede hacer `switch(verdict.action)` + `switch(verdict.code)` exhaustivo. Esto aísla al resolver de decisiones downstream (liberar lock, emitir eventos, exit codes del CLI).
- **D-06 title-only match enforced en tests con ambos sides:** El test explícito asserta que `'Foo'` matchea `## Phase 7: Foo` (title-only) Y que `'Phase 7: Foo'` NO matchea (heading form rechazada). Esto previene que un consumidor confunda `task.title` con el heading completo.
- **D-07 normalization on BOTH sides del match:** `matches = phases.filter((p) => normalizeTitle(p.title) === needle)`. Aplicar normalización solo a un lado llevaría a falsos negativos (e.g. phase con capitalización distinta). El plan lo marca como invariante.
- **Sin DI (`resolvePhaseFn` queda para 09-04):** El resolver es pure orchestration sobre filesystem; testearlo con mocks añadiría abstracción sin beneficio. Los tests usan fixtures tmpDir reales. El DI (`resolvePhaseFn`) entra en escena solo en el dispatcher (09-04) para que `test/dispatcher.test.js` pueda inyectar un verdict sin escribir ROADMAPs.
- **Zero `realpathSync`:** documentado como invariante en el header JSDoc. El dispatcher (Phase 8) ya resolvió projectPath vía `resolveProjectPath`; duplicar realpath aquí sería inconsistente con ese contract y caro. Grep confirma 0 uses.
- **No bump a `src/session/state.js` ni a dispatcher:** El plan 09-03 es pure orchestration aislada. Wiring al dispatcher y al CLI son planes 09-04 y 09-05 respectivamente. La verdict shape está congelada aquí para que ambos consumidores la usen sin divergencias.

## Deviations from Plan

**None.** Plan ejecutado exactamente como se escribió. El snippet literal del `<action>` de Task 1 es correcto (contrastando con 09-01, donde hubo que fixear un regex en el action).

**Cero auto-fixes de Rule 1/2/3.** El módulo importa exactamente lo listado en `<interfaces>` (parseRoadmap + normalizeTitle), usa exactamente los typedefs de `<behavior>`, y los 11 tests pasan en el primer intento tras GREEN.

## Issues Encountered

Ninguno. El pattern-mapper de 09-PATTERNS.md proporcionó el snippet de `src/gsd/lock.js` (header + shape discriminated union), y los decisions D-02/D-06/D-07/D-13 del CONTEXT eran inequívocos. La separación entre Task 1 (resolver.js) y Task 2 (test file) se resolvió naturalmente con un ciclo TDD único: el test commit (RED) consume el contenido literal del plan de Task 2.

## User Setup Required

None — módulo puro read-only, sin deps nuevas, sin config externa, sin env vars.

## Known Stubs

**None.** Todo lo implementado tiene comportamiento completo y tests que lo cubren:

- El verdict `multi-match` emite la lista `matches: ["Phase N: title", ...]` que el CLI inspect (09-05) renderizará para debugging.
- El verdict `roadmap-missing` incluye `detail` con el path absoluto para que el dispatcher pueda loggear el fallo con contexto.
- El campo `match_reason: 'exact title match (normalized)'` es textual y estable — consumers pueden usarlo para UX sin parsear.

No hay UI no-wired ni datos placeholder. El resolver es un contract cerrado — las decisiones de qué hacer con cada verdict viven en 09-04 (dispatcher) y 09-05 (CLI).

## Next Phase Readiness

**Ready for:**

- **Plan 09-04 (dispatcher wiring):** importa `resolvePhase` desde `../gsd/resolver.js`. Usa `switch(verdict.action)`:
  - `'phase'` → thread `verdict.phase_id` a `launchOpts.phase_id`.
  - `'bootstrap'` → thread `gsdBrief = buildBriefFromTask(task)` (de 09-02) a `launchOpts.brief`.
  - `'error'` → liberar lock (`releaseGsdLockFn`), retornar `{ action: 'resolver_failed', code: verdict.code, detail: verdict.detail }`.
- **Plan 09-05 (CLI `kodo gsd inspect`):** importa `resolvePhase` y renderiza el verdict con formatters humano/JSON. Exit codes: 0 para `phase`|`bootstrap`, 1 para `error` (D-19). Dry-run: NO lock, NO state, NO cmux (D-18) — el resolver ya es read-only por diseño.

**No blockers.** El contract del discriminated union está congelado con 4 typedefs exportables. Ambos consumidores pueden proceder en paralelo (wave 3 de la phase).

## Self-Check: PASSED

- **Files exist:**
  - `src/gsd/resolver.js` — FOUND (80 LOC)
  - `test/gsd-resolver.test.js` — FOUND (148 LOC)
  - `.planning/phases/09-phase-resolver-bootstrap/09-03-SUMMARY.md` — FOUND (este archivo)
- **Commits exist in git log:**
  - `7145cf1` — FOUND (test: RED gate)
  - `a612c41` — FOUND (feat: GREEN gate)
- **Verification block from plan:**
  - `node --test test/gsd-resolver.test.js test/gsd-roadmap.test.js` → 24 pass, 0 fail
  - `node --check src/gsd/resolver.js` → exit 0
  - `grep -E "realpathSync|writeFileSync|unlinkSync" src/gsd/resolver.js` → 0 matches
  - `grep -nE "import.*from '\\./roadmap\\.js'" src/gsd/resolver.js` → 1 match
- **Acceptance criteria Task 1:**
  - `grep -n "export function resolvePhase" src/gsd/resolver.js` → 1 match ✓
  - `grep -n "from './roadmap.js'" src/gsd/resolver.js` → 1 match ✓
  - `grep -E "realpathSync" src/gsd/resolver.js` → 0 matches ✓
  - `grep -E "import.*src/session|logger|dispatcher" src/gsd/resolver.js` → 0 matches ✓
  - 4 typedefs (`PhaseVerdict`, `BootstrapVerdict`, `ErrorVerdict`, `ResolveResult`) presentes ✓
  - `node --check src/gsd/resolver.js` → exit 0 ✓
- **Acceptance criteria Task 2:**
  - `test/gsd-resolver.test.js` existe ✓
  - `node --test test/gsd-resolver.test.js` → 11 pass, 0 fail ✓
  - 11 tests ejecutados (≥ 11 exigidos) ✓
  - `mkdtempSync`/`rmSync` con `beforeEach`/`afterEach` ✓
  - Tests sin mocks (integración real) — `grep -E "mock|stub|spy"` → 0 matches ✓
  - Test D-06 asserta ambos casos (`'Foo'` matchea, `'Phase 7: Foo'` NO) ✓
- **Full test suite regression:** 251 tests, 250 pass, 1 skip (pre-existing), 0 fail

## TDD Gate Compliance

Task 1 y Task 2 tienen `tdd="true"`. Verificación de la secuencia en git log:

1. **RED gate:** `7145cf1` (test: failing tests ERR_MODULE_NOT_FOUND) — existe ✔
2. **GREEN gate:** `a612c41` (feat: implementation) — existe, posterior a RED ✔
3. **REFACTOR gate:** no aplica — la implementación inicial ya es mínima y clara (80 LOC); no hubo refactor.

Ambas gates presentes en orden correcto. Sin warnings.

---
*Phase: 09-phase-resolver-bootstrap*
*Completed: 2026-04-21*
