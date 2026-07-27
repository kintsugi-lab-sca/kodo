---
phase: 85-saneo-de-deuda-nyquist-retroactivo
plan: 02
subsystem: testing
tags: [observability, stderr, log-12, source-hygiene-guard, import-graph, node-test, dependency-injection]

# Dependency graph
requires:
  - phase: 80-carril-orquestador-reconciliacion-documental
    provides: el piggyback ORCH-07 de `runCheckAndAct` (gate D-03, orden D-05, fail-open) y su review con los 3 warnings
  - phase: 79-sidebar-doctor
    provides: `scan()` / `execute()` del doctor del sidebar y el typedef `SidebarResult` con su campo `errors`
  - phase: 84
    provides: el molde de guard source-hygiene con `stripComments` (`test/skill-sync.test.js:815-842`)
provides:
  - "Línea de observabilidad por stderr con el conteo de acciones fallidas del doctor del sidebar (`[kodo:check] Sidebar: N acción(es) fallida(s) (fail-open)`)"
  - "Cobertura de test del piggyback ORCH-07: conteo `applied = added + ungrouped`, rama de advisories y canal de la línea de fallos en sus dos mitades"
  - "Guard LOG-12 con mordida real sobre `import()` dinámico de loggers prohibidos, y el comentario del fichero diciendo la verdad sobre el alcance de los guards"
affects: [check.js, sidebar-doctor, LOG-12, observabilidad CLI, futuros guards de aislamiento]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard source-grep sobre la salida de `walkImports` sin modificar el walker (refuerzo aditivo)"
    - "Captura de stdout/stderr en dos arrays separados en tests DI (el orden cross-canal no es contractual)"

key-files:
  created: []
  modified:
    - src/check.js
    - test/check.test.js
    - test/check-isolation.test.js

key-decisions:
  - "D-07 aplicado: la línea de fallos sale por `errorFn` (stderr), nunca por `logFn` — resuelve la contradicción entre la prosa de WR-01 y su propio snippet a favor de `errorFn`"
  - "D-08 aplicado: Test F escrito y commiteado en ROJO antes del fix; el fix no se mergea sin él"
  - "D-09 aplicado en sus dos mitades: comentario honesto + source-grep; `walkImports` intacto para no poner rojos dos guards vecinos"
  - "Sin ramificación singular/plural en la línea nueva: `acción(es) fallida(s)` por coherencia con la hermana `acción(es) aplicadas` ya establecida en el fichero"
  - "Solo el conteo entero cruza a stderr: `target`/`reason`/`category` son refs de workspace del operador y el canal es automático (T-85-02-02)"

patterns-established:
  - "Refuerzo aditivo de guards: cuando un walker tiene un punto ciego, se añade un grep sobre la lista que ya devuelve en lugar de ampliar el walker (evita rojos espurios en guards vecinos)"
  - "Verificación de mordida obligatoria: un guard nuevo no se da por cumplido sin inyectar una violación, confirmar el rojo y revertir"

requirements-completed: [DEBT-07]

coverage:
  - id: D1
    description: "WR-01 — `kodo check` emite por stderr el conteo de acciones fallidas del doctor del sidebar, con fail-open y gate intactos"
    requirement: DEBT-07
    verification:
      - kind: unit
        ref: "test/check.test.js#Test F: gate ON + advisories + fallos por-item — las 3 líneas salen por su canal (WR-01/WR-02)"
        status: pass
      - kind: unit
        ref: "test/check.test.js#Test G: gate ON sin fallos — errors vacío o ausente NO emite ninguna línea por errorFn (WR-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-02 — el describe ORCH-07 asevera el conteo `applied = added + ungrouped`, la rama de advisories y el canal de la línea de fallos en sus dos mitades"
    requirement: DEBT-07
    verification:
      - kind: unit
        ref: "node --test test/check.test.js (24 → 26 tests, 0 fail)"
        status: pass
    human_judgment: false
  - id: D3
    description: "WR-03 — comentario honesto sobre `import()` dinámico + guard source-grep con mordida demostrada, `walkImports` sin modificar"
    requirement: DEBT-07
    verification:
      - kind: unit
        ref: "test/check-isolation.test.js#ningún fichero del grafo de check.js hace import() DINÁMICO de un logger prohibido (WR-03)"
        status: pass
      - kind: other
        ref: "verificación de mordida: printf import('./logger.js') >> src/labels.js → guard RC=1 → git checkout -- src/labels.js"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-27
status: complete
---

# Phase 85 Plan 02: Los 3 warnings de 80-REVIEW Summary

**El piggyback del sidebar deja de fundir «nada que arreglar» con «cmux caído»: emite el conteo de fallos por stderr, con test que lo dictó en rojo, y el guard LOG-12 pasa de decorativo a tener mordida demostrada sobre `import()` dinámico.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-27T10:54:23Z
- **Completed:** 2026-07-27T10:57:09Z
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments

- **WR-01 RESUELTO.** `src/check.js` calcula `const failed = (r.errors || []).length` y, si hay fallos, emite por `errorFn` la línea `[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`. Colocada entre la línea de aplicadas y la rama `hasAdvisories`, de modo que las dos líneas derivadas de `r` (execute) quedan juntas y la de advisories — derivada de `report` (scan) — queda separada. 13 líneas insertadas, **cero eliminadas**: las 3 líneas existentes, el `catch`, el gate y el exit code están intactos.
- **WR-02 RESUELTO.** El `describe` ORCH-07 pasa de 6 a 8 casos. Test F cruza por fin `needsOrchestrator: true` con `hasAdvisories: true` — la combinación que ninguno de los 6 previos alcanzaba — y congela los tres literales con **tres números distintos por diseño** (`applied = 3`, `failed = 2`, `advisories = 1`), con `created: 0` deliberado para que la regresión concreta que WR-02 nombra (usar `r.created` al calcular `applied`) se detecte. Test G asevera la rama de silencio, que hasta ahora nadie cubría porque los casos A/D pasan `errorFn: () => {}` y descartan el output.
- **WR-03 RESUELTO en sus dos mitades.** La premisa falsa («el repo no usa `import()` dinámico») y su atribución a `06-RESEARCH A3` han desaparecido de las dos ocurrencias. El texto nuevo declara el alcance real: los guards describen el grafo de **MODULE-LOAD** de `kodo check`, no alcanzabilidad en runtime — `check.js:103` llama `initRegistry()`, que carga `providers/{plane,github}/provider.js` con `await import()` pese a que su guard de prohibición sigue verde. Y el guard nuevo hace source-grep sobre la lista que `walkImports` ya devuelve, con `stripComments` antes del match.
- **Mordida del guard verificada empíricamente**, no asumida (ver §Verificación de mordida).
- **Suite completa: 2590 tests, 2589 pass, 0 fail, 1 skipped** (baseline 2587/2586; +3 por los dos tests nuevos y el guard).

## Task Commits

1. **Task 1 (85-02-01): WR-01 + WR-02 RED — Test F y Test G** — `60458a4` (test)
2. **Task 2 (85-02-02): WR-01 GREEN — la línea de fallos por `errorFn`** — `c50d5b0` (feat)
3. **Task 3 (85-02-03): WR-03 — comentario honesto + guard con mordida** — `4abacbc` (test)

## Files Created/Modified

- `src/check.js` — la rama `if (failed > 0) errorFn(...)` dentro del `try` del piggyback, con el comentario de porqué (canal stderr, fail-open sin cambios, el resultado jamás re-entra al gate). +13 / −0.
- `test/check.test.js` — Test F y Test G al final del `describe` ORCH-07, con `logs` y `errs` en arrays separados. +93 / −0; el rango `:320-440` preexistente sin una sola línea tocada.
- `test/check-isolation.test.js` — `stripComments` copiado verbatim con su línea de procedencia, `DYNAMIC_LOGGER_IMPORT_RE` / `LOGGER_ALLOWLIST_RE` constantes, el `it()` del guard WR-03 con su comentario de porqué, y los dos comentarios mentirosos reescritos. +66 / −2 (las 2 eliminaciones son exactamente las dos líneas de la premisa falsa).

## Disposición individual de los 3 warnings de 80-REVIEW

| Warning | Disposición | Evidencia |
|---|---|---|
| **WR-01** — el piggyback nunca inspecciona `r.errors` | **RESUELTO** (no re-aceptado) | `c50d5b0`; `grep -cF 'acción(es) fallida(s) (fail-open)' src/check.js` = 1; `grep -c 'logFn(.*fallida'` = 0 |
| **WR-02** — cero asserts sobre las 3 líneas del piggyback | **RESUELTO** (no re-aceptado) | `60458a4`; Test F y Test G verdes tras el fix |
| **WR-03** — comentario falso + guard decorativo | **RESUELTO** (no re-aceptado) | `4abacbc`; `grep -c '06-RESEARCH A3'` = 0; mordida confirmada |

**`IN-01` queda FUERA de este plan por D-10** — está clasificado *info* en el propio 80-REVIEW y el criterio literal de DEBT-07 habla de «los 3 warnings». Se re-registra como diferido en el plan 85-05.

## Verificación de mordida (WR-03)

Ejecutada tal como el criterio de aceptación la prescribe, con revert incondicional:

```
printf "\nawait import('./logger.js');\n" >> src/labels.js
node --test test/check-isolation.test.js   # RC=1
git checkout -- src/labels.js
```

- **RC = 1** con la violación inyectada — el guard se pone ROJO.
- El mensaje de fallo imprime el camino exacto: `src/labels.js → import('./logger.js')`.
- `git diff --exit-code src/labels.js` sale 0 tras el revert: el árbol quedó limpio.

**A HEAD el guard sale VERDE**, con el único hit siendo `src/session/state.js → import('../logger-events.js')`, que la allowlist acepta — exactamente el veredicto que RESEARCH §Sonda 1 había verificado antes de escribir el assert. **No hubo ningún hallazgo LOG-12 que escalar**, y por tanto ninguna presión de debilitar la regex ni de ampliar la allowlist.

## Decisions Made

- **Canal `errorFn` para la línea nueva.** La prosa de WR-01 dice «emitirlo por `logFn`» pero su propio snippet de fix usa `errorFn`; D-07 ya había resuelto la contradicción a favor de `errorFn` y así se implementó. Un fallo escrito en el canal del éxito sigue siendo invisible en un pipe.
- **`stripComments` antes del match, no después.** Sin él el guard sale rojo a HEAD con 13 falsos positivos, 5 apuntando literalmente a `../logger.js` — todos imports de TIPO en JSDoc borrados en runtime. Aceptar ese rojo habría forzado a debilitar el assert después.
- **10.ª copia verbatim de `stripComments`**, con su línea de procedencia, en vez de extraer a un módulo compartido: `test/helpers/` aloja fixtures y procesos hijo, no helpers de aserción, y el repo ya tomó esta decisión nueve veces.
- **Test G cubre dos escenarios en un solo `it()`** (`errors: []` y `errors` ausente) porque ambos aseveran la misma invariante — el silencio — y el segundo es el que congela el guard `|| []` defensivo.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. El estado RED del Test F fue exactamente el previsto (falla el tercer assert, `errs: []`), y el cuarto assert — el negativo de canal — pasaba en rojo por vacuidad, tal como el plan anticipaba. El guard WR-03 salió verde a la primera tras `stripComments`, confirmando la sonda de RESEARCH.

## Fences respetados

- `test/format-isolation.test.js` — `git diff --exit-code` sale 0 (**D-18**), ni siquiera para copiar el patrón.
- `src/gsd/lock.js` — sin tocar (**D-19**).
- `.planning/codebase/TESTING.md` — sin tocar (**D-20**).
- `walkImports`, `extractImports`, `IMPORT_FROM_RE`, `IMPORT_BARE_RE` — sin modificar: `git diff -U0 | grep '^-' | grep -cE '...'` devuelve 0. Los guards vecinos de `github/provider.js` y `github/normalize.js` siguen verdes.
- `IN-01` de 80-REVIEW — fuera por **D-10**, diferido al plan 85-05.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

DEBT-07 queda cerrado. Los planes restantes de la fase (85-03 en adelante: DEBT-05, DEBT-06 y los 6 backfills NYQ) no dependen de nada de este plan; el 85-05 debe registrar `IN-01` como diferido con su razón (D-10). El baseline de suite para los planes siguientes es **2590 tests / 2589 pass / 0 fail / 1 skipped**.

## Self-Check: PASSED

- Commits verificados en `git log`: `60458a4`, `c50d5b0`, `4abacbc` — los 3 existen.
- Ficheros verificados en disco: `src/check.js`, `test/check.test.js`, `test/check-isolation.test.js`, `85-02-SUMMARY.md` — los 4 existen.

---
*Phase: 85-saneo-de-deuda-nyquist-retroactivo*
*Completed: 2026-07-27*
