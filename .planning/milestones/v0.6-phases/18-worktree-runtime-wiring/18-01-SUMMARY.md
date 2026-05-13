---
phase: 18
plan: 01
subsystem: session-state
tags: [worktree, helper, typedef, foundational, tdd]
requires: [WT-02-base]
provides:
  - computeWorktreePath(projectPath, sessionId) named export
  - Session.worktree_path?: string typedef field
affects: [src/session/state.js]
tech-stack:
  added: []
  patterns:
    - "Pure path-builder helper (no I/O), simétrico a STATE_PATH constant"
    - "Additive optional typedef field (mismo patrón que Phase 11 D-08 gsd_mode, Phase 9 phase_id/brief)"
    - "NO schema_version bump — legacy sessions read field as undefined"
key-files:
  created:
    - .planning/phases/18-worktree-runtime-wiring/18-01-SUMMARY.md
  modified:
    - src/session/state.js
    - test/state.test.js
decisions:
  - "Helper factored into src/session/state.js (Claude's Discretion) — Phase 19 stop hook consumirá para `git worktree remove`"
  - "Helper NO usa realpathSync (D-04 invariante) — distinto de src/gsd/lock.js#lockPathFor que sí colapsa symlinks. El worktree path es destino físico literal, el lock path es key normalizado"
  - "Helper definido entre migrateState y migrateStateIfNeeded para agrupar 'helpers puros sin I/O' antes de los I/O-bound"
metrics:
  duration_minutes: ~5
  tasks_completed: 1
  files_changed: 2
  tests_added: 4
  suite_pass: "515/516 (1 skip pre-existente)"
  completed: 2026-05-12
---

# Phase 18 Plan 01: Helper computeWorktreePath + Session.worktree_path Summary

Helper puro `computeWorktreePath(projectPath, sessionId)` exportado en `src/session/state.js` con typedef `Session.worktree_path?` aditivo opcional — base contractual para Plan 02 (`launchWorkItem` cableado) y Phase 19 (`git worktree remove` en stop hook).

## What Shipped

### `src/session/state.js`

**Named export `computeWorktreePath`** (líneas 50–71, entre `migrateState` y `migrateStateIfNeeded`):

```javascript
export function computeWorktreePath(projectPath, sessionId) {
  return join(projectPath, '.bg-shell', sessionId);
}
```

- Pure: NO `realpathSync`, NO `mkdirSync`, NO `existsSync`, solo `path.join` (ya importado en línea 3).
- Determinístico: mismo `(projectPath, sessionId)` siempre devuelve el mismo string byte-idéntico.
- Sin trailing slash, sin normalize artificial.
- JSDoc completo con `@param` + `@returns` + nota explícita "Phase 19 consumirá este helper para `git worktree remove <worktreePath>` en el stop hook (WT-04). Mantener la firma estable."

**Typedef `Session` extension** (línea 29, último campo antes del cierre):

```javascript
*   worktree_path?: string,    // Phase 18 (D-03c, aditivo opcional — mismo patrón que gsd_mode Phase 11 D-08). Path determinístico derivado del session-id (`<projectPath>/.bg-shell/<sessionId>`) computado por computeWorktreePath. Sesiones legacy v0.5 sin este campo se leen como undefined; consumers downstream deben tolerar falsy. NO bump de schema_version.
```

- Aditivo opcional (precedent Phase 11 D-08 `gsd_mode`, Phase 9 `phase_id` / `brief`).
- `schema_version` permanece en `2` (no bump).
- Sesiones legacy v0.5 sin este campo leen `worktree_path` como `undefined`; consumers downstream toleran falsy.

### `test/state.test.js`

**Nuevo `describe('computeWorktreePath', ...)` con 4 asserts:**

1. **Shape canónico:** `computeWorktreePath('/repo', 'abc-123-uuid')` → `'/repo/.bg-shell/abc-123-uuid'` (sin trailing slash).
2. **Determinismo:** dos llamadas consecutivas devuelven strings byte-idénticos.
3. **UUID-safe:** `randomUUID()` produce path sin escapes; defense-in-depth assert `!out.includes('..')` (mitigación T-18-01).
4. **NO realpathSync:** `computeWorktreePath('/tmp/foo', 'abc')` → `'/tmp/foo/.bg-shell/abc'` (NO `/private/tmp/...`); el output preserva el `projectPath` literal del input.

Import añadido: `import { computeWorktreePath } from '../src/session/state.js'` y `import { randomUUID } from 'node:crypto'` en cabecera.

## Verification

Acceptance criteria del plan:

| Criterio | Esperado | Observado |
|----------|----------|-----------|
| `grep -c "export function computeWorktreePath" src/session/state.js` | `== 1` | **1** ✓ |
| `grep -c "worktree_path?:" src/session/state.js` | `>= 1` | **1** ✓ |
| `grep -c "schema_version: 3\|schema_version === 3"` | `== 0` | **0** ✓ |
| `grep -c "import.*realpathSync" src/session/state.js` | `== 0` | **0** ✓ (mención en JSDoc comment, no import — ver Deviations) |
| `grep -c "from 'node:path'" src/session/state.js` | `== 1` | **1** ✓ |
| `node --test test/state.test.js` | exits 0 | **22/22 pass** ✓ |
| `node --test test/migration.test.js` | exits 0 | **pass** ✓ |
| `npm test` (suite global) | exits 0 | **515/516 pass + 1 skip pre-existente** ✓ |
| `node -e "import('./src/session/state.js').then(m => console.log(typeof m.computeWorktreePath))"` | `function` | **function** ✓ |

## Key Decisions

1. **Helper factorizado (Claude's Discretion):** vive en `src/session/state.js` junto a `STATE_PATH` y `Session` typedef. Phase 19 lo consumirá para `git worktree remove`; mantenerlo inline en `launchWorkItem` (Plan 02) habría forzado duplicar el `join(projectPath, '.bg-shell', sessionId)` o importar desde `manager.js`.
2. **NO realpathSync (D-04):** asimétrico vs `src/gsd/lock.js#lockPathFor` (que sí usa `realpathSync` para colapsar symlinks). Justificación: el lock identifica el repo como "key" y necesita normalización para coalescer; el worktree path es un destino físico literal que se crea/destruye. Si el caller pasa `/tmp/foo` y macOS lo resuelve a `/private/tmp/foo`, eso es responsabilidad del caller.
3. **Posición del helper:** entre `migrateState` (línea 41) y `migrateStateIfNeeded` (línea 53), agrupando "helpers puros sin I/O" antes de los I/O-bound.
4. **NO schema_version bump (D-03c):** `worktree_path` es aditivo opcional, mismo patrón que `gsd_mode` (Phase 11 D-08), `phase_id` y `brief` (Phase 9). Compat backward con sesiones v0.5.

## Deviations from Plan

### Auto-fixed Issues

Ninguna. Plan ejecutado exactamente como estaba escrito.

### Observaciones sobre criterios de aceptación

**`grep -c "realpathSync" src/session/state.js` reporta 1, no 0 como pide el plan.**

La única ocurrencia es la mención dentro del JSDoc del helper:

```
 * Pure function: NO realpathSync, NO mkdirSync, NO existsSync — solo `path.join`.
```

El plan dice literal: "helper NO importa realpathSync — D-04 invariante". El intento del criterio es asegurar que el helper no use la función:

- `grep -c "import.*realpathSync" src/session/state.js` → **0** (no import) ✓
- `grep -cE "realpathSync\s*\(" src/session/state.js` → **0** (no call) ✓

La mención en comentario es defensiva (documenta explícitamente el invariante) y refuerza la decisión D-04 para futuros readers. Cumple el espíritu del criterio. No modifico el comentario porque eliminarlo debilitaría la documentación operativa.

## Threat Surface Scan

No se introduce nueva superficie no contemplada en el `<threat_model>` del plan. El plan ya cubre:

- T-18-01 (Tampering vía sessionId malicioso): `randomUUID()` upstream + defense-in-depth assert `!out.includes('..')` en test 3.
- T-18-02 (Information Disclosure vía logger): mitigado por `JSON.stringify` del logger NDJSON; no se persiste/loggea desde este plan (solo añade la signatura).
- T-18-03 (Disclosure vía `state.json` perms): same model que `project_path` ya persistido, no introduce regresión.

## Self-Check: PASSED

**Files created/modified verified:**

```bash
$ [ -f src/session/state.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f test/state.test.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f .planning/phases/18-worktree-runtime-wiring/18-01-SUMMARY.md ] && echo "FOUND" || echo "MISSING"
FOUND
```

**Commits verified:**

```bash
$ git log --oneline -2
05168c7 feat(18-01): add computeWorktreePath helper + Session.worktree_path
0e34069 test(18-01): add failing tests for computeWorktreePath helper
```

**TDD Gate Compliance:** RED (`test(18-01)`) commit precedes GREEN (`feat(18-01)`) commit ✓. No REFACTOR commit needed (implementation was 1-liner, no cleanup required).

## Outputs for Downstream Plans

- **Plan 02 (`launchWorkItem` cableado):** importa `{ computeWorktreePath }` desde `'../session/state.js'`, llama `computeWorktreePath(projectPath, sessionId)` PRE-spawn (D-03) y persiste el resultado en `SessionRecord.worktree_path` via conditional spread en `buildSessionFromTask`.
- **Phase 19 (stop hook cleanup):** importa el mismo helper para `git worktree remove <computeWorktreePath(projectPath, sessionId)>` (WT-04). La firma es estable.
- **Plan 02 NO necesita tocar `src/session/state.js`** de nuevo — el contrato base ya está cerrado en este plan.
