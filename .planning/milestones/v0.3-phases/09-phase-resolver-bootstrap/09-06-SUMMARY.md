---
phase: 09
plan: 06
subsystem: gsd/dispatch + cli
tags: [gap-closure, dispatcher, hook, cli, exit-codes, pattern-mapper]
gap_closure: true
dependency_graph:
  requires: [09-04, 09-05]
  provides:
    - dispatcher como fuente única de gsd.bootstrap (completa pattern-mapper #3)
    - exit codes runGsdInspect conformes a D-19 literal
  affects:
    - src/hooks/session-start.js (bloque eliminado)
    - test/session-start.test.js (aserción invertida)
    - src/cli/gsd-inspect.js (exit code 2 → 1 en rama config error)
    - test/gsd-inspect-cli.test.js (test nuevo)
tech_stack:
  added: []
  patterns:
    - pattern-mapper #3 extendido a gsd.bootstrap (antes sólo gsd.phase.resolved)
    - exit code differentiation: config error (1) vs fetch failure (2)
key_files:
  created: []
  modified:
    - src/hooks/session-start.js
    - test/session-start.test.js
    - src/cli/gsd-inspect.js
    - test/gsd-inspect-cli.test.js
decisions:
  - Single source of truth para gsd.bootstrap = dispatcher (completa D-14)
  - Exit code 1 cubre tanto verdict error del resolver como config error del mapping de proyecto — no se inventa un código 3 porque semánticamente ambos son errores no transient
metrics:
  duration: ~8min
  tasks: 3
  files_modified: 4
  loc_net: "+12 / -25 = -13 net (eliminación de duplicado pesa más que el test nuevo)"
  tests_added: 1
  tests_inverted: 1
  completed_date: 2026-04-21
commits:
  - 9b77da6 fix(09-06): eliminar bloque duplicado gsdBootstrap del hook session-start
  - 7dabb33 test(09-06): invertir aserción gsdBootstrap a anti-regresión
  - 75e0eb0 fix(09-06): clarificar exit codes de kodo gsd inspect (D-19)
---

# Phase 9 Plan 06: Gap-Closure (GAP-01 + HI-02) Summary

Gap-closure final de Phase 9 — elimina doble emisión NDJSON de `gsd.bootstrap` (hook + dispatcher) y clarifica que exit code 2 de `kodo gsd inspect` queda reservado exclusivamente a fetch failure (D-19 literal), no a config error.

## Objetivos

1. **GAP-01 / HI-01 (BLOCKING):** el dispatcher (`src/triggers/dispatcher.js:200`) y el hook (`src/hooks/session-start.js:196`) emitían ambos `gsd.bootstrap` por cada dispatch bootstrap → dos entradas NDJSON por evento, `kodo logs --event gsd.bootstrap --count` doblaría. Pattern-mapper #3 ya se aplicó a `gsd.phase.resolved` en 09-04; aquí se completa para `gsd.bootstrap`.

2. **HI-02 (non-blocking, cheap-fix):** `runGsdInspect` retornaba exit code 2 tanto para `provider.getTask` throw (fetch failure, transient) como para `resolveProjectPathFn` throw (config error, semántico permanente). D-19 reserva `2` exclusivamente para fetch failure — scripts con retry-on-2 reintentaban infinitamente errores de config.

## Tasks

### Task 1 — GAP-01 src (commit `9b77da6`)

Eliminado el bloque `if (session.gsd && !session.phase_id) { ... gsdBootstrap(log, { project_path: session.project_path }); }` (antes líneas 188-200 de `src/hooks/session-start.js`). Añadido comentario de 3 líneas documentando la invariante "dispatcher es fuente única".

**Evidencia:**
- `grep -cE "gsdBootstrap|'gsd\.bootstrap'" src/hooks/session-start.js` = **0** (antes: 2).
- `node --check src/hooks/session-start.js` exit 0.
- `buildGsdContext` intacto (grep count = 3: 1 export + 2 referencias en main/JSDoc).
- Archivo: 219 → 204 LOC (-15 net).

### Task 2 — GAP-01 test (commit `7dabb33`)

El test `'Phase 9: still invokes gsdBootstrap from hook for bootstrap sessions'` afirmaba activamente el bug (pedía que el hook siguiera emitiendo). Reemplazado por un anti-regresión estructuralmente análogo al existente de `gsdPhaseResolved` (líneas 134-154 del mismo archivo): mismo strip de comentarios, misma regex (`/gsdBootstrap\s*\(/`), misma `assert.ok(!invocationRe.test(stripped))`.

**Evidencia:**
- `grep -c "does NOT emit gsd.bootstrap from hook" test/session-start.test.js` = **1**.
- `grep -c "still invokes gsdBootstrap" test/session-start.test.js` = **0**.
- `node --test test/session-start.test.js` → **12 pass / 0 fail**.

### Task 3 — HI-02 src+test (commit `75e0eb0`)

Cuatro cambios coordinados en `src/cli/gsd-inspect.js` + 1 test nuevo en `test/gsd-inspect-cli.test.js`:

1. **Catch de `resolveProjectPathFn`:** `return 2` → `return 1`. Bloque anterior (líneas 69-76) reemplazado con comentario explicativo que documenta el contrato D-19 inline.
2. **JSDoc `@returns`:** expandido de una línea genérica a tres líneas que nombran cada código (0=phase|bootstrap, 1=verdict error OR config error, 2=fetch failure).
3. **Header comentario línea 11:** `Exit code 0 si phase|bootstrap, 1 si error (D-19)` → `Exit codes (D-19): 0=phase|bootstrap, 1=verdict error OR config error, 2=provider fetch failure (transient)`.
4. **Test nuevo:** `'09-06: resolveProjectPath throw returns exit code 1 (config error ≠ fetch failure, D-19)'` con DI stub que lanza desde `resolveProjectPathFn` y asserta `exitCode === 1`.

**Evidencia:**
- `grep -c "return 2;" src/cli/gsd-inspect.js` = **1** (sólo el catch de `provider.getTask`).
- `grep -c "config error (project mapping missing)" src/cli/gsd-inspect.js` = **1** (JSDoc).
- `grep -c "09-06: resolveProjectPath throw" test/gsd-inspect-cli.test.js` = **1**.
- `node --test test/gsd-inspect-cli.test.js` → **10 pass / 0 fail** (antes 9).

## Verificación cross-file

### GAP-01 closed — invariantes grep

```
grep -cE "gsdBootstrap|'gsd\.bootstrap'" src/hooks/session-start.js   = 0  ✓
grep -c  "gsdBootstrap"                  src/triggers/dispatcher.js    = 0  ✓ (usa log.info directo)
grep -c  "log\.info.*gsd\.bootstrap"     src/triggers/dispatcher.js    = 1  ✓ (fuente única)
grep -c  "does NOT emit gsd.bootstrap"   test/session-start.test.js    = 1  ✓
grep -c  "still invokes gsdBootstrap"    test/session-start.test.js    = 0  ✓ (test invertido)
```

### HI-02 closed — exit-code contract

```
grep -c "return 2;" src/cli/gsd-inspect.js                             = 1  ✓ (solo fetch failure)
grep -c "09-06: resolveProjectPath throw" test/gsd-inspect-cli.test.js = 1  ✓
```

### Suites Phase 9 — regresión cero

```
node --test test/dispatcher.test.js         → pass/fail OK (sin regresión)
node --test test/gsd-context.test.js        → pass/fail OK
node --test test/session-start.test.js      → 12 pass / 0 fail
node --test test/gsd-inspect-cli.test.js    → 10 pass / 0 fail (nuevo test incluido)
node --test test/*.test.js (full suite)     → 272 pass / 1 skip / 0 fail (273 total)
```

La suite global crece en +1 test respecto al baseline de 09-05 (que era 272) → consistente con el test nuevo añadido en Task 3. Cero tests eliminados netos (Task 2 reemplaza 1 test por otro, Task 3 añade 1).

## Impacto operacional

**Antes de 09-06:**
- `kodo logs --event gsd.bootstrap --count` → `2N` (donde N = número real de dispatches bootstrap).
- `kodo gsd inspect KL-XXX` con project mapping ausente → exit 2, scripts CI con `retry-on-2` entraban en loop infinito.

**Después de 09-06:**
- `kodo logs --event gsd.bootstrap --count` → `N` exacto (fuente única = dispatcher).
- `kodo gsd inspect KL-XXX` con project mapping ausente → exit 1 (error permanente, no reintentar).
- `kodo gsd inspect KL-XXX` con `provider.getTask` throw → exit 2 (transient, reintenta legítimamente).

## Deviations from Plan

**Ninguna que requiera documentación material.** Los tres tasks ejecutaron exactamente los edits especificados. Una observación menor:

- **Acceptance criterio con grep literal `return 1;` ≥ 2** (plan Task 3): al revisar, el conteo real es `1` porque el return final del handler usa el ternario `return verdict.action === 'error' ? 1 : 0;` (línea 102) — el literal `return 1;` no matchea expresiones ternarias. **No es un defecto funcional:** los dos paths que retornan 1 (resolver verdict error + config error) están cubiertos por los tests `'exits 1 when verdict is error (no-match)'`, `'exits 1 on multi-match'` y el nuevo `'09-06: resolveProjectPath throw returns exit code 1'`. El criterio textual del plan era una aproximación de grep; el comportamiento es correcto y está verificado dinámicamente.

## Pattern-mapper #3 — estado final

| Evento | Emisor antes | Emisor ahora | Status |
| ------ | ------------ | ------------ | ------ |
| `gsd.phase.resolved` | hook + dispatcher | dispatcher (único) | Cerrado en 09-04 |
| `gsd.bootstrap` | hook + dispatcher | dispatcher (único) | Cerrado en 09-06 |
| `session.start` | hook (único) | hook (único) | OK — no aplica |

Invariante **D-14** ("single source per dispatch event") completamente satisfecha.

## Scope explícitamente deferido

- **ME-01 / ME-02 / ME-03** (issues MEDIUM del code review): transferidos a Phase 10 planning — son mejoras estructurales (p. ej., DI del logger), no bloquean verificación Phase 9.
- **LO-01..LO-04** (issues LOW del code review): backlog indefinido — son cosméticos / quality-of-life, ninguno afecta correctness ni D-contracts.

## Re-verificación Phase 9

Tras este plan, `/gsd-verify-phase 09` debe cerrar los 8/8 must-haves:

1. Resolver 1:1 exact match (D-04) — Phase 9-03
2. Discriminated union verdict (D-02) — Phase 9-03
3. Dispatcher wiring tras acquireGsdLock (pattern-mapper #2) — Phase 9-04
4. Threading brief/phase_id via launchWorkItem — Phase 9-04
5. Brief rendering en buildGsdContext — Phase 9-04
6. Single-source `gsd.phase.resolved` emit — Phase 9-04
7. **Single-source `gsd.bootstrap` emit — 09-06 (ESTA ejecución)**
8. `kodo gsd inspect` read-only CLI con exit codes D-19 literales — Phase 9-05 + **09-06**

## Self-Check: PASSED

- Commit `9b77da6` existe en git log: ✓
- Commit `7dabb33` existe en git log: ✓
- Commit `75e0eb0` existe en git log: ✓
- `src/hooks/session-start.js` modificado (sin bloque duplicado): ✓
- `test/session-start.test.js` modificado (aserción invertida): ✓
- `src/cli/gsd-inspect.js` modificado (return 1 en config error): ✓
- `test/gsd-inspect-cli.test.js` modificado (test nuevo añadido): ✓
- `.planning/phases/09-phase-resolver-bootstrap/09-06-SUMMARY.md` creado: ✓
- Suite completa `node --test test/*.test.js` → 272 pass / 1 skip / 0 fail: ✓
