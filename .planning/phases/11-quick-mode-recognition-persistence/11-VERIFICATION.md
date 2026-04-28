---
phase: 11-quick-mode-recognition-persistence
status: passed
verified: 2026-04-28
verifier: inline-orchestrator
must_haves_score: 4/4
plans_complete: 3/3
test_suite: 372 pass / 0 fail / 1 skip
requirement_ids: [QUICK-01, QUICK-02, QUICK-03, QUICK-04]
---

## Goal

Una task etiquetada `kodo:gsd-quick` es reconocida como sesión GSD por toda la ruta de arranque y persiste `gsd_mode='quick'` en `SessionRecord` con el mismo contrato de skip-permissions que `kodo:gsd`.

## Success Criteria

### SC-1: Persistencia del modo
**Truth**: Una task con `kodo:gsd-quick` (sólo, o junto a `kodo:gsd`) produce sesión con `gsd: true` y `gsd_mode: 'quick'`; sólo `kodo:gsd` persiste `gsd_mode: 'full'`.

**Evidencia**:
- `src/session/manager.js:30-31` deriva `const gsdMode = getGsdMode(flags)`
- `src/session/manager.js:47-52` spread atómico `...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {})`
- Validación dinámica:
  - `flags:['gsd-quick']` → `{gsd:true, gsd_mode:'quick'}` ✓
  - `flags:['gsd']` → `{gsd:true, gsd_mode:'full'}` ✓
  - `flags:['gsd','gsd-quick']` → `{gsd:true, gsd_mode:'quick'}` (precedencia D-01) ✓
- Plan 11-02 cubierto.

**Status**: ✓ PASSED

### SC-2: Lock per-repo compartido entre modos
**Truth**: La sesión quick adquiere el mismo per-repo lock que la sesión full — dos tareas (`kodo:gsd` + `kodo:gsd-quick`) sobre el mismo repo no arrancan procesos concurrentes.

**Evidencia**:
- `src/triggers/dispatcher.js:120` guard `if (gsdMode) { ... }` reemplaza el viejo `kodoConfig.flags.includes('gsd')`. El lock se adquiere para cualquier modo GSD reconocido (full o quick).
- `getGsdMode` está centralizado en `src/labels.js:53-58` — un solo punto de derivación.
- Plan 11-03 commit incluyó esta WIP del dispatcher.

**Status**: ✓ PASSED

### SC-3: Resolver semántica divergente por modo
**Truth**: `phase` para quick → `phase_id` NO se persiste; `error code:'no-match'` para quick continúa; `roadmap-missing` y `multi-match` siguen abortando.

**Evidencia**:
- `src/triggers/dispatcher.js:157-159` discard de `phase_id` salvo `gsdMode === 'full'`
- `src/triggers/dispatcher.js:169` tolerancia `gsdMode === 'quick' && code === 'no-match'` con `break` (continúa al launch)
- `src/triggers/dispatcher.js:170-187` info emit `tolerated:true` antes del break (D-06: rastro forense, no silencio)
- `src/triggers/dispatcher.js:217-225` fail-closed para roadmap-missing/multi-match: release lock + return `action:'resolver_failed'`
- `test/dispatcher.test.js`: 21/21 pasan (incluyendo los Phase 9 que cubren `phase`/`bootstrap`/`error`)

**Status**: ✓ PASSED

### SC-4: skip-permissions extendido a quick
**Truth**: El comando claude lanzado por `kodo:gsd-quick` incluye `--dangerously-skip-permissions` (mismo contrato que `kodo:gsd` desde commit `004995c`).

**Evidencia**:
- `src/session/manager.js:270` `const skipPerms = kodoFlags.includes('yolo') || getGsdMode(kodoFlags) !== null`
- Test source-hygiene actualizado en `test/manager.test.js:297-326`:
  - Verifica el nuevo predicado `getGsdMode(kodoFlags) !== null`
  - Blinda contra regresión del literal viejo `kodoFlags.includes('gsd')`
  - Blinda el orden short-circuit `yolo` primero
- Por construcción: `getGsdMode(['gsd-quick']) === 'quick' !== null`, así que `skipPerms === true` para quick.

**Status**: ✓ PASSED

## Requirement Traceability

| Req ID | Plan(s) | Status |
|---|---|---|
| QUICK-01 (telemetría success/failure con mode) | 11-03 | ✓ resolved |
| QUICK-02 (telemetría bootstrap con mode + lift gsd.bootstrap) | 11-03 | ✓ resolved |
| QUICK-03 (persistencia gsd_mode en buildSessionFromTask) | 11-01, 11-02 | ✓ resolved |
| QUICK-04 (skipPerms unificado vía getGsdMode) | 11-02 | ✓ resolved |

## Test Suite

```
node --test
ℹ tests 373
ℹ pass 372
ℹ fail 0
ℹ skipped 1
ℹ duration_ms 245007
```

Suite completa verde tras los tres planes. Sin regresión.

Cobertura por archivo modificado:
- `test/labels.test.js`: 10/10 (sin cambios; los nuevos tests de `getGsdMode`/`getSessionMode` llegan en Phase 13 QUICK-08)
- `test/manager.test.js`: 23/23 (1 source-hygiene actualizado para reflejar el refactor D-01)
- `test/dispatcher.test.js`: 21/21 (sin cambios; matriz quick × verdict variants llega en Phase 13)
- `test/logger-events.test.js`: 12/12 (4 nuevos/extendidos para `mode` en ambos helpers)

## Decisions honored

D-01 (precedencia gsd-quick > gsd), D-02 (comentario generalizado), D-03 (derivación local), D-04 (spread atómico gsd+gsd_mode), D-05 (mode en gsd.phase.resolved success), D-06 (info emit tolerated en quick+no-match), D-07 (mode en gsd.bootstrap), D-08 (legacy `gsd:true == 'full'`), D-09 (helper getSessionMode en labels.js), D-10 (sesiones nuevas siempre persisten gsd_mode), D-14 (dispatcher = única fuente de gsd.* events).

## Hand-off

- **Phase 12**: hooks SessionStart/Stop pueden importar `{ parseKodoLabels, getGsdMode, getSessionMode } from '../labels.js'` y leer `getSessionMode(session)` para ramificar prompts. Toda la telemetría del dispatcher distingue modo, así que `kodo logs --json | jq 'select(.mode=="quick")'` es operativo.
- **Phase 13**: matrices de tests pendientes (QUICK-08): `labels.test.js × 4 estados`, `manager.test.js × 4 estados`, `dispatcher.test.js × 5 verdict variants en quick`, `session-start.test.js × rama quick de buildGsdContext`.

## Notas operativas

La fase se ejecutó en modo inline secuencial (sin worktrees, sin agentes spawneados) sobre una WIP previa del working tree que cubría parcialmente los planes 11-02 (helper `getGsdMode`, typedef `gsd_mode`) y 11-03 (rama quick/full + tolerancia no-match en dispatcher). La WIP se incorporó en los commits correspondientes; no quedó código huérfano.
