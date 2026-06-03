---
phase: 28-polling-daemon-hardening
plan: 01
subsystem: polling
tags: [polling, normalize, taskitem, provider-only-path, contract-matrix, github, plane]

# Dependency graph
requires:
  - phase: 24-githubprovider-normalizer-registry
    provides: D-18 leak guard original (11 fields) — reformulado por D-01 Phase 28
  - phase: 25-polling-trigger-channel
    provides: shouldDispatch + cursor cache shape + first-tick skip T-25-04
  - phase: 27-cross-provider-contract-matrix
    provides: assertTaskItemShape + 7 × 2 = 14 contract cases baseline
provides:
  - TaskItem canónico de 13 campos (updated_at + created_at REQUIRED)
  - normalizeIssue / normalizeWorkItem emiten timestamps simétricos
  - shouldDispatch(task, prev) opera sobre task.updated_at real en ambos paths
  - Contract matrix Phase 27 extendido a 9 × 2 = 18 cases
  - Leak guard reformulado "EXACTAMENTE 13 canonical TaskItem keys"
affects:
  - 28-02-DAEMON-01 (--verbose summary line consumirá los timestamps si emerge necesidad)
  - 28-03-DAEMON-02 (logfile lifecycle — no direct dependency, pero misma fase)
  - cualquier futuro consumer de getProvider('<x>').listPendingTasks() + shouldDispatch

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-provider symmetric normalizers (D-02 GitHub + D-03 Plane paridad)"
    - "TaskItem 13-field canonical contract (D-01, overrides D-18 Phase 24)"
    - "Closed taxonomy leak guard test (zero leaks, exact field count assertion)"

key-files:
  created: []
  modified:
    - src/interface.js
    - src/providers/github/normalize.js
    - src/providers/plane/normalize.js
    - src/triggers/polling.js
    - test/providers/github/normalize.test.js
    - test/providers/contract.test.js
    - test/triggers/polling.test.js

key-decisions:
  - "D-01 Phase 28: TaskItem canónico 11 → 13 fields. updated_at + created_at REQUIRED (string ISO 8601). NO opcional, NO null/undefined. Overrides D-18 leak guard Phase 24."
  - "D-02 Phase 28: normalizeIssue (GitHub) emite issue.updated_at + issue.created_at passthrough literal. Sin transformación, sin guard defensivo — GitHub REST API spec garantiza ISO 8601 UTC siempre presente para Issues."
  - "D-03 Phase 28: normalizeWorkItem (Plane) emite workItem.updated_at + workItem.created_at passthrough, paridad cross-provider. Sin guard `|| ''` — fail-loud downstream preferido sobre enmascarar undefined."
  - "D-04 Phase 28: assertTaskItemShape (contract matrix) gana 2 type asserts core. 7 × 2 = 14 cases iniciales pasan a 9 × 2 = 18 effective asserts dentro del mismo helper compartido. CERO it() top-level añadido (Pitfall #3 preservado)."
  - "D-05 Phase 28: shouldDispatch parameter renamed `issue → task` (semantic dualidad: raw issue path client / TaskItem path provider). Body idéntico — string compare sobre updated_at. Call site (línea 297) preserva `issue` como nombre del for-loop local en path client."
  - "D-06 Phase 28: extractMaxUpdatedAt en path provider-only lee task.updated_at correctamente (no undefined). Path client raw sigue leyendo issue.updated_at sin normalización intermedia."

patterns-established:
  - "Cross-provider mirror normalizer pattern: cualquier extensión al TaskItem canónico DEBE propagarse simétricamente a GitHub + Plane normalizers, validado por contract matrix Phase 27."
  - "TaskItem leak guard reformulación: cambios al typedef requieren update simultáneo de CANONICAL_KEYS (github/normalize.test.js) + CANONICAL_TASK_ITEM_KEYS (contract.test.js) — single source of truth no-DRY justificado por aislamiento de cada test file."

requirements-completed:
  - POLL-FIX-01

# Metrics
duration: ~25min
completed: 2026-05-18
---

# Phase 28 Plan 01: POLL-FIX-01 TaskItem timestamps Summary

**TaskItem canónico extendido de 11 → 13 fields (updated_at + created_at REQUIRED); normalizeIssue/normalizeWorkItem emiten timestamps simétricos; shouldDispatch en path provider-only evalúa contra task.updated_at real (no undefined); contract matrix Phase 27 extendido a 18 effective asserts.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-18 (worktree base d3a5167)
- **Completed:** 2026-05-18T13:38:30Z
- **Tasks:** 3 (Task 1 + Task 2 + Task 3, todos atómicos)
- **Files modified:** 7

## Accomplishments

- Cerrado el v0.7 tech debt POLL-FIX-01: `getProvider('<x>').listPendingTasks()` + `shouldDispatch(task)` ahora evalúa contra timestamps reales en ambos providers, sin importar el path.
- TaskItem typedef (`src/interface.js`) extendido a 13 campos canónicos con `updated_at`/`created_at` REQUIRED — D-01 Phase 28 override de D-18 leak guard Phase 24.
- normalizeIssue (`src/providers/github/normalize.js`) y normalizeWorkItem (`src/providers/plane/normalize.js`) emiten passthrough literal de los timestamps raw del payload — paridad cross-provider sin guard defensivo (D-02/D-03).
- shouldDispatch (`src/triggers/polling.js:172`) renombrado al parámetro formal `task`; el call site (línea 297) preserva la variable local `issue` del for-loop (descripción semántica raw issue path client). Cero cambio funcional en el body — string compare idéntico.
- Contract matrix Phase 27 (`test/providers/contract.test.js`) blinda los 2 nuevos type asserts core dentro de `assertTaskItemShape`, recorriendo `[plane, github]` × 9 asserts (antes 7). Leak guard test reformulado a "EXACTAMENTE 13 canonical TaskItem keys" en ambos lugares (github normalize test + contract test).
- 3 nuevos tests añadidos al describe `startPolling — POLL-FIX-01 provider-only path` en `test/triggers/polling.test.js` blindan: dispatch positivo, dispatch negativo (paridad client path), y maxUpdatedAt accumulator.

## Task Commits

Each task was committed atomically:

1. **Task 1: TaskItem 13 fields + normalizers simétricos** — `51c6dec` (feat)
2. **Task 2: Tests normalize + contract matrix actualizados a 13 fields** — `9c5678f` (test)
3. **Task 3: shouldDispatch + processRepo provider-only GREEN + test polling caso provider-only** — `17eb350` (fix)

_Nota: TDD aplicado pragmáticamente — el plan declaró `tdd="true"` en los 3 tasks pero la naturaleza del cambio es aditiva sobre un shape inmutable (`TaskItem` typedef). Task 1 (código) precede Task 2 (tests) por dependencia técnica (los tests del leak guard rompen con 11 keys hasta que se actualizan); cada task se commitea atómicamente igual._

## Files Created/Modified

- `src/interface.js` — TaskItem typedef gana `updated_at: string` + `created_at: string` REQUIRED (D-01 Phase 28).
- `src/providers/github/normalize.js` — normalizeIssue añade 2 properties al return shape (D-02). JSDoc + comentario líneas 19/73-78 actualizados a "13 canonical fields".
- `src/providers/plane/normalize.js` — normalizeWorkItem añade 2 properties simétricas (D-03 paridad).
- `src/triggers/polling.js` — shouldDispatch parameter rename `issue → task` (D-05). Body idéntico, comportamiento idéntico. JSDoc actualizado.
- `test/providers/github/normalize.test.js` — CANONICAL_KEYS extendido a 13; primer test añade 2 asserts passthrough literal; leak guard test mensaje reformulado.
- `test/providers/contract.test.js` — CANONICAL_TASK_ITEM_KEYS extendido a 13; `assertTaskItemShape` añade 2 type asserts (D-04); header JSDoc actualizado.
- `test/triggers/polling.test.js` — nuevo describe block `startPolling — POLL-FIX-01 provider-only path` con 3 tests (D-05 dispatch positivo, paridad negativa, D-06 cursor advance).

## Decisions Made

Todas las decisiones D-01..D-06 ya estaban locked en `28-CONTEXT.md`. Ejecución estricta del plan sin deviaciones de criterio. Detalle:

- **TDD orden invertido pragmáticamente:** el plan declara los 3 tasks con `tdd="true"` pero la naturaleza del cambio (extensión aditiva del typedef) hace que los tests del leak guard rompan transitoriamente entre Task 1 (código) y Task 2 (tests). El plan acepta explícitamente esta secuencia: "los tests actuales se actualizan en Task 2; este task NO debe romper tests que aún tienen CANONICAL_KEYS con 11 — por eso Task 2 corrige los tests inmediatamente después". Atomicidad por commit preservada.
- **Comentario header de contract.test.js (líneas 1-29) actualizado a `9 asserts × 2 providers = 18 cases`:** el plan menciona el bookkeeping pero no especifica si tocar el header. Se actualizó para mantener coherencia con D-04 y prevenir confusión futura del lector.
- **test/normalize.test.js (Plane normalizer test) NO requirió cambios:** verificado con `grep` — no usa CANONICAL_KEYS ni leak guard count. Sólo asserts individuales que no introducen regresión con el campo añadido. Acceptance criteria de Task 2 línea 220 explícitamente predice este caso ("verificar con grep antes y actualizar igual si aplica").

## Deviations from Plan

None - plan executed exactly as written.

Todas las decisiones D-01..D-06 estaban locked en el CONTEXT.md y el patterns-map proporcionó código copy-paste para los 7 archivos modificados. Cero ambigüedad en el camino crítico.

## Issues Encountered

- **Leak guard transitoriamente rojo entre commits:** después de Task 1 (`feat`), el test `D-18 leak guard: result has EXACTLY 11 canonical TaskItem keys` falla porque el normalizer ahora emite 13 keys. El plan acepta explícitamente esta secuencia (los tests se corrigen en Task 2). El estado transitorio dura un solo commit y no impacta el invariante "cada task commitea atómicamente con build verde a su nivel" porque cada commit refleja un cambio coherente (Task 1 = código bajo nuevo contrato, Task 2 = tests bajo nuevo contrato).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROADMAP Success Criterion 3 verificable: cualquier consumer del provider-only path obtiene timestamps reales (D-05 blindado por test "TaskItem.updated_at > cursor dispara dispatch").
- Plan 28-02 (DAEMON-01 `--verbose`) no depende directamente de este cambio — los timestamps no son consumidos en el summary line. Si emerge necesidad de exponer `min(updated_at)` o `max(updated_at)` en `polling.tick.summary`, los datos están disponibles canónicamente en el TaskItem.
- Plan 28-03 (DAEMON-02 logfile lifecycle) totalmente independiente. Sin blockers cruzados.
- Suite global verde a 781 tests (780 pass + 1 skip + 0 fail), wall-time budget preservado bajo 1.5s para `test/triggers/polling.test.js`.

## Threat Flags

Sin threat flags nuevos. Las mitigaciones T-28-01..T-28-04 del threat model siguen siendo válidas:
- T-28-02 (Information disclosure leak guard) mitigado por el assert `Object.keys(result).length === 13` en `test/providers/github/normalize.test.js` y por el subset/required check en `test/providers/contract.test.js#assertTaskItemShape`.
- T-28-04 (Repudiation first-tick skip) preservado en `shouldDispatch` line 173 — `if (!prev.last_updated_at) return false;`.

## Self-Check: PASSED

Verificación de claims del SUMMARY:

- ✓ Commit Task 1 existe: `51c6dec`
- ✓ Commit Task 2 existe: `9c5678f`
- ✓ Commit Task 3 existe: `17eb350`
- ✓ `src/interface.js` modificado (TaskItem 13 fields).
- ✓ `src/providers/github/normalize.js` modificado (normalizeIssue + JSDoc).
- ✓ `src/providers/plane/normalize.js` modificado (normalizeWorkItem paridad).
- ✓ `src/triggers/polling.js` modificado (shouldDispatch param rename).
- ✓ `test/providers/github/normalize.test.js` modificado (13 keys + 2 asserts passthrough).
- ✓ `test/providers/contract.test.js` modificado (13 keys + 2 type asserts).
- ✓ `test/triggers/polling.test.js` modificado (nuevo describe POLL-FIX-01 con 3 tests).
- ✓ Suite global verde: 781 tests, 780 pass + 1 skip + 0 fail (baseline 778 + 3 nuevos).

---
*Phase: 28-polling-daemon-hardening*
*Completed: 2026-05-18*
