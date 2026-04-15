---
phase: 06
plan: 04
subsystem: structured-logger-foundation
tags: [logging, isolation, performance, testing, log-12]
dependency_graph:
  requires:
    - "test/check-isolation.test.js (Plan 06-01 stub)"
    - "test/startup-budget.test.js (Plan 06-01 stub)"
    - "src/logger.js (Plan 06-02) — target del walker, sanity del test"
    - "src/logger-noop.js (Plan 06-02) — whitelist explícita en el grafo"
    - ".planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md (Plan 06-01 pre-phase)"
  provides:
    - "test/check-isolation.test.js: 4 it() endurecidos (sanity + noop zero-imports + violators + whitelist)"
    - "test/startup-budget.test.js: it.skip() con Decisión B documentada + mock preservado"
    - ".planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md: sección Post-phase measurement"
  affects:
    - "Cualquier refactor futuro que cree dependencia transitiva check.js → logger.js rompe el test de grafo"
    - "`npm test` ahora reporta 139 pass + 1 skip (era 138 pass antes del plan)"
tech_stack:
  added: []
  patterns:
    - "Walker transitivo ESM con regex dual (import-from + import-bare)"
    - "Smoke negativo verificado: inyectar import './logger.js' rompe test con mensaje informativo"
    - "it.skip() como demotion explícita con comentario de razón (vs eliminar el archivo)"
key_files:
  created: []
  modified:
    - test/check-isolation.test.js (43 → 109 LoC; +66)
    - test/startup-budget.test.js (34 → 65 LoC; +31 pero 100 % comentario/skip)
    - .planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md (+67 LoC)
decisions:
  - "Priorizar Decisión B (06-CONTEXT.md) sobre plan original — startup-budget.test.js demoted a it.skip()"
  - "Regex dual IMPORT_FROM_RE + IMPORT_BARE_RE — el walker de Wave 0 ignoraba side-effect imports (`import './logger.js';`), que es la forma más corta de romper LOG-12"
  - "Helper extractImports(src) DRY para los 3 call-sites del walker y de las assertions del noop"
  - "Preservar código mock del test skipped (no borrarlo) para reactivación post refactor de check.js"
  - "3 runs en post-phase measurement (vs 10 en baseline) — suficiente para confirmar que la distribución bimodal se mantiene; 10 runs hubiesen tardado >11 min sin añadir señal"
metrics:
  duration: ~12min (incluye 3 runs de medición ~4min + hardening + smoke negativo + SUMMARY)
  completed: 2026-04-15
requirements: [LOG-12]
---

# Phase 06 Plan 04: Isolation Hardening & Startup Baseline Post-Phase Summary

Endurecidos los dos tests guardianes de LOG-12 tras la introducción de `src/logger.js` en Plans 02-03. El test de grafo (`check-isolation.test.js`) pasa de 2 a 4 `it()` con sanity checks, whitelist explícita del noop y detección de side-effect imports. El test de presupuesto de arranque (`startup-budget.test.js`) se demotizó a `it.skip()` con Decisión B documentada (06-CONTEXT.md). Post-phase measurement registrada: distribución bimodal sin regresión.

## Tasks Completed

| Task | Name                                                                                   | Commit    | Files                                                                 |
| ---- | -------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------- |
| 4.1  | Endurecer test/check-isolation.test.js con aserciones post-logger                      | `b8c90ab` | test/check-isolation.test.js                                          |
| 4.2  | Demotar startup-budget.test.js a it.skip() + registrar Post-phase measurement baseline | `97e666e` | test/startup-budget.test.js, STARTUP-BASELINE.md                      |

## What Was Built

### Task 4.1 — Hardened `test/check-isolation.test.js`

**De 2 → 4 `it()`:**

1. **Sanity: `src/logger.js` exists** — el test sólo es significativo si el archivo prohibido existe. Si alguien borra `logger.js`, el test falla explícitamente en vez de pasar trivialmente.

2. **`src/logger-noop.js` exists and has zero imports** — consolida la garantía de Plan 02 Task 2.1. Si alguien añade `import` al noop, se rompe aquí antes de que se llegue al walker.

3. **`kodo check` does not import `src/logger.js` transitively** — aserción principal con regex `/\/logger\.js$/` que distingue `logger.js` (prohibido) de `logger-noop.js` (permitido) sin ambigüedad. El mensaje de error imprime violators + **grafo completo** desde `check.js` relativo al repo — facilita debugging.

4. **`logger-noop.js` is allowed in the check.js graph (explicit whitelist)** — meta-test que documenta la distinción clara entre los dos archivos y re-valida que el noop sigue siendo zero-imports cuando se alcanza transitivamente.

**Mejoras técnicas:**

- **Regex dual** (`IMPORT_FROM_RE` + `IMPORT_BARE_RE`): el walker de Wave 0 usaba un único regex con grupo opcional `(?:[\s\S]*?from\s+)?` que en la práctica no matcheaba side-effect imports (`import './logger.js';` sin `from`). Verificado con `node -e` — el grupo lazy prefería no consumir y el engine fallaba. **Esto era una fuga silenciosa**: la forma más corta de colar logger.js al grafo (un `import './logger.js'` al top de `check.js`) no rompía el test. El regex dual lo cierra.

- **Helper `extractImports(src)`** — unifica los 3 call-sites (walker, noop assertion en test 2, noop re-check en test 4).

- **Smoke negativo ejecutado manualmente** (ver Verification abajo) — confirmado que inyectar `import './logger.js';` al top de `src/check.js` rompe el test con el mensaje correcto.

### Task 4.2 — Demote `test/startup-budget.test.js` + Post-phase baseline

**Decisión B aplicada** (06-CONTEXT.md sección "Aislamiento del vigilante (LOG-12)"):

- `startup-budget.test.js` → `it.skip()` con header comentado explicando razón (baseline bimodal, distribución dominada por I/O de red + cmux spawn, threshold mecánico es ruido).
- Código de medición real **preservado como comentario** para reactivación futura post-refactor de `check.js` (separando status snapshot de act on status).
- `THRESHOLD_MS` **NO se recalibra** — subirlo enmascara regresiones reales.
- Canal fiable de LOG-12: únicamente `check-isolation.test.js` endurecido en Task 4.1.
- `test/helpers/startup-baseline.js` preservado para invocación manual.

**Post-phase measurement** añadida a `STARTUP-BASELINE.md`:

| Metric    | Pre-phase  | Post-phase | Delta    | Status                             |
| --------- | ---------- | ---------- | -------- | ---------------------------------- |
| median_ms | 65 759.20  | 6 206.62   | −90.6 %  | within noise — distribución bimodal |
| min_ms    |  6 158.79  | 5 881.20   | −4.5 %   | stable                              |
| max_ms    | 68 067.71  | 65 273.20  | −4.1 %   | stable                              |

El delta del median −90 % **NO es mejora**; es ruido de la distribución bimodal con muestra de 3. Min y max se mantienen estables (dispersión ~11× en ambos), confirmando que Plans 02-03 no degradaron el arranque (consistente con el walker del grafo).

## Verification

### Automated

| Suite                                      | Command                                                                                     | Result                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| LOG-12 isolation (4 it hardened)           | `node --test test/check-isolation.test.js`                                                  | **PASS 4/4**                              |
| LOG-12 startup budget (demoted)            | `node --test test/startup-budget.test.js`                                                   | **PASS 0/0 + SKIP 1/1** (intencional)     |
| Phase 06 full suite                        | `node --test test/logger.test.js test/logger-redaction.test.js test/check-isolation.test.js test/startup-budget.test.js` | **16 pass + 1 skip + 0 fail**        |
| Full repo suite                            | `npm test`                                                                                  | **139 pass + 1 skip + 0 fail** (de 138 pre-plan → +2 new assertions − 1 demoted) |

### Smoke negative (walker correctness)

Ejecutado manualmente durante Task 4.1:

```bash
$ printf "import './logger.js';\n" | cat - src/check.js > /tmp/new && mv /tmp/new src/check.js
$ node --test test/check-isolation.test.js
✖ kodo check does not import src/logger.js transitively
  AssertionError: check.js transitively imports src/logger.js via:
    src/logger.js
  Full graph from check.js:
    src/check.js
    src/config.js
    src/session/state.js
    ...
    src/logger.js
    src/logger-noop.js
```

El mensaje imprime violators + grafo completo. Test restaurado tras el smoke.

### Acceptance criteria del plan

- [x] `node --test test/check-isolation.test.js` → 4 it() verdes
- [x] Grep `function\s+walkImports` → 1 match (`test/check-isolation.test.js:30`)
- [x] Regex `/\/logger\.js$/` presente (línea `violators` del test 3)
- [x] Mensaje de error incluye "Full graph" (verificado por smoke negativo)
- [x] Grep `existsSync.*logger\.js` → match (sanity check línea 44)
- [x] STARTUP-BASELINE.md tiene `## Post-phase measurement`
- [x] `THRESHOLD_MS` coherente con decisión (caso: test skipped, no recalibración)
- [x] Suite completa del phase en verde (LOG-01..LOG-04, LOG-08, LOG-12 cerrados)

## Deviations from Plan

### 1. [Rule 3 — Blocker fix] Regex dual para side-effect imports

**Found during:** Task 4.1 smoke negativo

**Issue:** El regex heredado del Wave 0 (`/^\s*(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm`) no matcheaba `import './logger.js';` (side-effect import sin binding). Verificado aislado: `node -e "const re = ...; console.log([...\"import './logger.js';\".matchAll(re)].map(m => m[1]))"` → `[]`. El grupo opcional `(?:...)?` lazy prefiere no consumir, pero el engine no reconcilia con el resto de la alternativa. Esto **es una fuga silenciosa**: la forma más corta de colar logger.js al grafo pasaría inadvertida.

**Fix:** Split en dos regex explícitos (`IMPORT_FROM_RE` para import-with-binding + `IMPORT_BARE_RE` para side-effect) + helper `extractImports(src)` que concatena los matches. Verificado con smoke negativo: la inyección ahora rompe el test.

**Files modified:** `test/check-isolation.test.js`
**Commit:** `b8c90ab`

### 2. Plan original vs Decisión B — priorizado 06-CONTEXT.md

El plan 06-04 original (Task 4.2) asumía que `startup-budget.test.js` seguiría siendo un guardián real y describía un decision tree para recalibrar `THRESHOLD_MS`. Las orchestrator_notes + `06-CONTEXT.md` sección "Aislamiento del vigilante (LOG-12)" recogen la Decisión B (2026-04-15): el test se demotiza a informativo/no-bloqueante porque la distribución bimodal `[6s, 68s]` hace que cualquier threshold sea ruido de red, no señal de regresión de imports.

**Acción:** Priorizada la decisión consolidada sobre el plan original. En vez de recalibrar, el test se convirtió a `it.skip()` con header explicativo completo y código mock preservado para reactivación post-refactor. El helper `test/helpers/startup-baseline.js` queda como canal de invocación manual. Documentado explícitamente en este SUMMARY y en STARTUP-BASELINE.md sección Decision.

## Known Stubs

Ninguno. El test `it.skip()` es una decisión arquitectónica documentada, no un stub — el comentario del header lo explica y el código mock preserva la implementación para reactivación futura sin rework.

## Threat Flags

Ninguno. El plan no introduce nueva superficie de seguridad. Threats T-6-04-01..T-6-04-06 del threat_model del plan:

- T-6-04-01 (dynamic import bypass): aceptado — el repo no usa `import()`.
- T-6-04-02 (walker fuera de src/): mitigado — walker solo sigue specifiers `.`.
- T-6-04-03 (ciclos infinitos): mitigado — `visited` Set corta ciclos.
- T-6-04-04 (THRESHOLD_MS manipulado): **mitigado extra** por Decisión B — el test está skipped, no hay threshold que subir.
- T-6-04-05 (paths en error msg): aceptado — paths locales del repo, no PII.
- T-6-04-06 (flakiness CI): **mitigado** por demotion — el test no puede ser flaky si está skipped.

## Phase 06 Closure Pointers

Plans previos del phase (para el orquestador):

- **06-01-SUMMARY.md** — Wave 0 infrastructure (test stubs, helpers, baseline). Requirements: LOG-01..LOG-04, LOG-08, LOG-12 stubs.
- **06-02-SUMMARY.md** — Logger factory (`createLogger` + NDJSON + stderr mirror). Requirements: LOG-01, LOG-02, LOG-03, LOG-04. Commits: `2ecffd6`, `7050672`.
- **06-03-SUMMARY.md** — Secret redaction (`redact()` deep-walk + SENSITIVE_KEYS + JWT_RE/BEARERY_RE). Requirements: LOG-08. Commit: `4dde829`.
- **06-04-SUMMARY.md** (éste) — Isolation hardening + startup-budget demotion + post-phase baseline. Requirements: LOG-12. Commits: `b8c90ab`, `97e666e`.

**Final state:** 139 pass + 1 skip (intencional) + 0 fail. Phase 06 covers LOG-01, LOG-02, LOG-03, LOG-04, LOG-08, LOG-12 — todas con tests verdes (excepto LOG-12 startup-budget demotizado por Decisión B, sustituido por el test de grafo que es más fiable).

## Self-Check: PASSED

- FOUND: test/check-isolation.test.js (modificado, 4 it)
- FOUND: test/startup-budget.test.js (modificado, it.skip + header)
- FOUND: .planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md (sección Post-phase measurement)
- FOUND: .planning/phases/06-structured-logger-foundation/06-04-SUMMARY.md (este archivo)
- FOUND: commit `b8c90ab` en `git log --oneline`
- FOUND: commit `97e666e` en `git log --oneline`
- `npm test` → 139 pass + 1 skip + 0 fail (verificado)
- Smoke negativo ejecutado y test restaurado (no queda artefacto temporal)
