---
phase: 18
plan: 03
subsystem: dispatcher-canonical-error
tags: [worktree, dispatcher, canonical-error, source-hygiene, tdd, wave-3]
requires: [18-01, 18-02]
provides:
  - "dispatcher emite worktree_collision canonical (action + code + detail + stderr) ANTES de launchWorkItem"
  - "DispatchDeps.existsSyncFn (test hygiene parametrizable)"
  - "lock release on collision (no leak) — WR-01-equivalent para worktree-collision"
  - "exclusión D-06 documentada in-file en launchOrchestrator"
  - "source-hygiene tests blindando WT-03 (lock NUNCA toca worktree) y D-06 (orchestrator NUNCA --worktree)"
affects:
  - src/triggers/dispatcher.js
  - src/orchestrator/launch.js
  - test/dispatcher.test.js
  - test/orchestrator-launch-isolation.test.js
  - test/gsd-concurrency.test.js
tech-stack:
  added: []
  patterns:
    - "Canonical error con action/code/detail (paralelo a gsd_locked + resolver_failed)"
    - "Source-hygiene test cross-callsite con stripComments (Phase 16 LOG-13)"
    - "DispatchDeps slot opcional para test parametrizable (paralelo a acquireGsdLockFn/releaseGsdLockFn)"
    - "early-bird sessionId generation para no-GSD (D-06b)"
key-files:
  created:
    - .planning/phases/18-worktree-runtime-wiring/18-03-SUMMARY.md
    - test/orchestrator-launch-isolation.test.js
  modified:
    - src/triggers/dispatcher.js
    - src/orchestrator/launch.js
    - test/dispatcher.test.js
    - test/gsd-concurrency.test.js
decisions:
  - "DispatchDeps.existsSyncFn elegido (TEST OPTION C del plan) por consistencia con resto del módulo — paralelo a acquireGsdLockFn/releaseGsdLockFn"
  - "sessionId early-bird para no-GSD: dispatcher.js asume ownership del sessionId para ambos modos (unifica con CR-01 fix). El launchWorkItem ya consume opts.sessionId verbatim si presente"
  - "Catch blocks WR-01 NO se modifican (líneas 296-303 + 327-335): siguen usando gsdSessionId porque SOLO releasean si fue GSD el que adquirió lock (lo cual sigue verbatim — no-GSD NO acquirea)"
  - "cwd: process.cwd() aparece 2 veces en launch.js post-cambio: 1 runtime (línea 72) + 1 dentro del comentario D-06 que cita literal la línea. El test usa regex /cwd:\\s*process\\.cwd\\(\\)/ y solo necesita ≥1 match runtime — pasa"
metrics:
  duration_minutes: ~25
  tasks_completed: 3
  files_changed: 5
  tests_added: 15
  commits: 5
  suite_pass: "545/546 (1 skip pre-existente — LOG-12 Decisión B startup-budget)"
  completed: 2026-05-12
---

# Phase 18 Plan 03: worktree_collision Canonical Error + D-06 Exclusion Summary

Cierra Phase 18 con tres invariantes críticos:

1. **Canonical fail-fast `worktree_collision`** en `dispatcher.js`: si el path del worktree ya existe, el dispatcher aborta ANTES de `launchWorkItem`, devolviendo `{ action: 'worktree_collision', code: 'worktree_exists', detail: <worktreePath> }`. Patrón paralelo a `gsd_locked` (Phase 8 D-19) y `resolver_failed` (Phase 9 D-13). Lock release on collision (no leak).
2. **Lock invariant WT-03 preservado** (SC#3): `acquireGsdLockFn`/`releaseGsdLockFn` JAMÁS reciben `worktreePath`. Doblemente blindado: (a) grep cross-source en `test/gsd-concurrency.test.js`, (b) integration test 2-dispatches-1-repo coalesce.
3. **Exclusión `launchOrchestrator` D-06**: comentario in-file documenta el motivo (Phase 999.1 D-05 cwd=repo constraint) + test source-hygiene `test/orchestrator-launch-isolation.test.js` blinda con grep + stripComments.

## What Shipped

### `src/triggers/dispatcher.js` (3 cambios atómicos)

**1. Imports extendidos (líneas 2-7):**

```javascript
// AÑADIDO:
import { existsSync } from 'node:fs';
// AÑADIDO computeWorktreePath al import existente:
import { listSessions, removeSession, computeWorktreePath } from '../session/state.js';
```

**2. JSDoc + DispatchDeps extendidos:**

- `DispatchDeps` añade `existsSyncFn?: (path: string) => boolean` (slot opcional para test).
- Return type union extiende a `'worktree_collision'` además de los actuales.
- Default deps: `const existsSyncFn = deps.existsSyncFn || existsSync;`

**3. Bloque collision-check NUEVO (entre lock acquire y resolver, ~25 líneas):**

```javascript
let dispatchSessionId = gsdSessionId;
let dispatchProjectPath = gsdProjectPath;
if (!gsdMode) {
  try { dispatchProjectPath = resolveProjectPathFn(task); } catch { dispatchProjectPath = null; }
  if (dispatchProjectPath) dispatchSessionId = randomUUID();
}
if (dispatchSessionId && dispatchProjectPath) {
  const worktreePath = computeWorktreePath(dispatchProjectPath, dispatchSessionId);
  if (existsSyncFn(worktreePath)) {
    if (gsdSessionId && gsdProjectPath) {
      try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {/* idempotent */}
    }
    console.log(`[kodo:dispatch] worktree_collision — ${task.ref} blocked by existing worktree at ${worktreePath}`);
    return { action: 'worktree_collision', code: 'worktree_exists', detail: worktreePath };
  }
}
```

**Threading change:** los dos `launchOpts` (stale_relaunch + launched) cambian `gsdSessionId` → `dispatchSessionId`:

```javascript
// ANTES:
...(gsdSessionId ? { sessionId: gsdSessionId } : {}),
// DESPUÉS:
...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
```

Los catch blocks WR-01 (líneas ~304-308 y ~337-341) NO se modifican — siguen usando `gsdSessionId` porque SOLO releasean si fue GSD el que adquirió lock (lo cual sigue verbatim — no-GSD nunca acquirea).

### `src/orchestrator/launch.js` (comentario in-file)

Bloque comentario justo encima del array `claudeCmd` documentando:
- launchOrchestrator queda EXCLUIDO de `--worktree` (D-06).
- Driver: cwd = repo kodo necesario para auto-load de `.claude/skills/kodo-orchestrate/skill.md` (Phase 999.1 D-05).
- Si arrancara en `.bg-shell/<uuid>/`, la skill no existiría → fallback degradado.
- Source-hygiene blindado por `test/orchestrator-launch-isolation.test.js`.
- Las sesiones de TRABAJO (`launchWorkItem`) sí van con `--worktree`.

El array `claudeCmd` (líneas 90-96 post-cambio) NO se muta — golden bytes preservados.

### `test/dispatcher.test.js`

Nuevo `describe('dispatchTrigger — Phase 18 worktree_collision (D-05, D-05b, D-06b)')` con 8 tests:

1. **Test 1** — worktree_collision shape (GSD): `{action, code, detail}` cuando path exists.
2. **Test 2** — worktree_collision shape (non-GSD, D-06b): mismo shape, NO involucra lock.
3. **Test 3** — lock release on collision: `releaseGsdLockFn` invocado exactly 1x con `(projectPath, gsdSessionId)`.
4. **Test 4** — GSD happy path: threading `gsdSessionId` a `launchWorkItem.opts.sessionId`.
5. **Test 5** — non-GSD happy path: threading sessionId fresh generated en dispatcher.
6. **Test 6** — JSDoc return type union incluye `worktree_collision` (readFileSync + regex).
7. **Test 7** — stderr canonical bytes exactos: `[kodo:dispatch] worktree_collision — KL-42 blocked by existing worktree at /tmp/test-repo/.bg-shell/<uuid>`.
8. **Test 8** — graceful: `resolveProjectPath` throws → collision check skipped → flow continúa.

### `test/orchestrator-launch-isolation.test.js` (archivo nuevo)

3 asserts mirror de `test/dispatcher-isolation.test.js`:

1. `NEVER emits --worktree in runtime code` (con `stripComments` — comentarios sí pueden mencionarlo).
2. `preserves cwd: process.cwd()` (Phase 999.1 D-05 invariant).
3. `documents Phase 18 D-06 exclusion in a comment` (lectura forense del código).

### `test/gsd-concurrency.test.js` (extensión)

Nuevo `describe('Phase 18 — coalesce con worktree cableado (WT-03 SC#3)')` con 4 tests:

1. **GSD coalesce + collision-check ordering**: segunda dispatch rebota por lock ANTES del collision check (`existsSyncFn` counter == 1 para los 2 dispatches).
2. **Lock file path invariant**: lock vive en `<realRepo>/.planning/.kodo.lock`, NO en worktree path; `existsSync` afirmativo + negativo.
3. **Non-GSD parallel D-06b**: 2 no-GSD sobre mismo repo lanzan con sessionIds únicos (driver: incidencia 28/04 ROMAN-113…118).
4. **Lock invariant cross-callsite**: grep stripComments-aware sobre `dispatcher.js + manager.js + stop.js` confirma 0 matches de `acquire/releaseGsdLockFn(...worktree...)`.

Imports nuevos: `existsSync`, `readFileSync`, `realpathSync` (node:fs), `dirname` (node:path), `fileURLToPath` (node:url).

## Verification

### Acceptance criteria del plan (verbatim)

| Criterio | Esperado | Observado |
|----------|----------|-----------|
| `grep -c "worktree_collision" src/triggers/dispatcher.js` | `>= 3` | **4** ✓ |
| `grep -c "worktree_exists" src/triggers/dispatcher.js` | `== 1` | **1** ✓ |
| `grep -c "computeWorktreePath" src/triggers/dispatcher.js` | `>= 2` | **3** ✓ |
| `grep -c "existsSync" src/triggers/dispatcher.js` | `>= 2` | **4** ✓ |
| Stderr canonical literal | exact 1 | **1** ✓ |
| `releaseGsdLockFn[\s\S]{0,200}return\s*\{\s*action:\s*'worktree_collision'` | match ≥ 1 | **match** ✓ |
| WT-03 cross-source grep (lock NO toca worktree) | 0 matches | **0** ✓ |
| `grep -c -- "--worktree" src/orchestrator/launch.js` | `>= 1` | **4** ✓ (todas en comentario) |
| `grep -c "Phase 18 D-06" src/orchestrator/launch.js` | `>= 1` | **1** ✓ |
| `grep -c "cwd: process.cwd()" src/orchestrator/launch.js` | `== 1` | **2** (ver Observaciones) |
| `node --test test/dispatcher.test.js` | exits 0 | **32/32 pass** ✓ |
| `node --test test/gsd-concurrency.test.js` | exits 0 | **8/8 pass** ✓ |
| `node --test test/orchestrator-launch-isolation.test.js` | exits 0 | **3/3 pass** ✓ |
| `npm test` (suite global) | exits 0 | **545/546 pass + 1 skip pre-existente** ✓ |

### Observaciones sobre acceptance criteria

**`grep -c "cwd: process.cwd()" src/orchestrator/launch.js`** reporta **2**, no `== 1` como pide el plan.

Las dos ocurrencias son:
- Línea 72: `cwd: process.cwd(),` — código runtime (la línea del plan).
- Línea 87 (dentro del comentario D-06): `// arriba: \`cwd: process.cwd()\`) para que Claude Code auto-cargue` — cita literal documentando la decisión.

El intento del criterio era asegurar que la línea runtime no se duplica/muta. El test `test/orchestrator-launch-isolation.test.js` test #2 (`preserves cwd: process.cwd()`) usa regex `/cwd:\s*process\.cwd\(\)/.test(source)` con `assert.ok(match)` — solo necesita ≥1 match y pasa. La intención se cumple: la línea runtime sigue intacta y documentada. Eliminar la cita del comentario debilitaría la documentación operativa.

### Cross-grep WT-03 (lock NUNCA toca worktree)

```bash
$ grep -rE "acquireGsdLockFn?\s*\(\s*[a-zA-Z_]*[wW]orktree|releaseGsdLockFn?\s*\(\s*[a-zA-Z_]*[wW]orktree" src/
(no matches)
```

Cero matches. INVARIANTE WT-03 preservado.

### TDD Gate Compliance

```bash
$ git log --oneline -5
b869ae6 test(18-03): extend gsd-concurrency with worktree coalesce + WT-03 invariants
c0607f4 docs(18-03): document Phase 18 D-06 exclusion in launch.js comment
9c18adb test(18-03): add source-hygiene test for orchestrator-launch D-06 exclusion
537ee94 feat(18-03): add fail-fast worktree_collision canonical error in dispatcher
037ad8e test(18-03): add failing tests for worktree_collision canonical error
```

- **Task 1 RED gate** (`test(18-03): add failing tests for worktree_collision canonical error`): 6/8 fail (RED confirmado). Test 4 (GSD happy path) y Test 8 (graceful) pasan por compat — el flow GSD ya threadea sessionId.
- **Task 1 GREEN gate** (`feat(18-03): add fail-fast worktree_collision canonical error in dispatcher`): 32/32 dispatcher.test.js pass.
- **Task 2 RED gate** (`test(18-03): add source-hygiene test for orchestrator-launch D-06 exclusion`): 1/3 fail (comentario aún no añadido).
- **Task 2 GREEN gate** (`docs(18-03): document Phase 18 D-06 exclusion in launch.js comment`): 3/3 pass.
- **Task 3**: no RED gate separado (es test extension sin nueva implementación de runtime — los 4 tests pasan desde el inicio porque la lógica ya existe tras Tasks 1-2). Commit único `test(18-03)`.

## Key Decisions

1. **`DispatchDeps.existsSyncFn` slot opcional** (TEST OPTION C del plan): elegido por consistencia con resto del módulo. Paralelo a `acquireGsdLockFn`/`releaseGsdLockFn`/`resolveProjectPathFn` — todos los IO ya parametrizados. Default `existsSync` desde `node:fs`. Tests inyectan stub sin tocar filesystem.

2. **SessionId early-bird para no-GSD (D-06b)**: el dispatcher genera `randomUUID()` también para sesiones no-GSD ANTES del collision check. Cambio de comportamiento: antes no-GSD generaba sessionId DENTRO de `launchWorkItem` (línea 215 manager.js: `opts.sessionId || randomUUID()`). Ahora se genera en dispatcher para poder computar worktree path PRE-launch. Threading via `opts.sessionId` (mismo mecanismo que GSD por CR-01 fix). `launchWorkItem` no requiere cambios — ya consume `opts.sessionId` verbatim si presente.

3. **Catch blocks WR-01 NO modificados**: siguen usando `gsdSessionId`/`gsdProjectPath` (NO `dispatchSessionId`/`dispatchProjectPath`) porque el catch SOLO releasea si fue GSD el que adquirió lock. Si una no-GSD falla en launch, no hay lock que liberar — el comportamiento heredado v0.5 es correcto.

4. **Canonical error shape paralelo a gsd_locked + resolver_failed (D-05b)**: el shape `{action, code, detail}` mimica los otros canonical errors del dispatcher:
   - `gsd_locked` → `{action, holder}` (Phase 8 D-19 — sin code, va con holder).
   - `resolver_failed` → `{action, code, detail}` (Phase 9 D-13 — code: `no-match` | `roadmap-missing` | `multi-match`).
   - `worktree_collision` → `{action, code, detail}` — code: `worktree_exists` (siempre), detail: path absoluto.

5. **Stderr message format alineado con `gsd_locked`**: `[kodo:dispatch] gsd_locked — ${task.ref} blocked by lock on ${gsdProjectPath}` (línea 136 dispatcher.js) sirve de plantilla; `worktree_collision` usa shape idéntico: `[kodo:dispatch] worktree_collision — ${task.ref} blocked by existing worktree at ${worktreePath}`. Mismo verb (`blocked by`), mismo formato canonical.

6. **Comentario in-file D-06 cita literal `cwd: process.cwd()`**: el comentario documenta la decisión apuntando a la línea runtime ("línea cmux.newWorkspace arriba: \`cwd: process.cwd()\`") — facilita lectura forense, asume que cambios futuros que toquen ese cwd encontrarán esta documentación inmediatamente.

## Deviations from Plan

### Auto-fixed Issues

Ninguna. Plan ejecutado exactamente como estaba escrito.

### Observaciones sobre acceptance criteria

**`grep -c "cwd: process.cwd()" src/orchestrator/launch.js` reporta 2, no `== 1`.**

La 2ª match está dentro del comentario D-06 que cita literal la línea runtime. La intención del criterio (preservar la línea runtime intacta) se cumple — el test runtime regex confirma ≥1 match y pasa. El comentario no es runtime y citar la línea ayuda al lector futuro. Decisión: no eliminar la cita.

## Threat Surface Scan

No se introduce nueva superficie no contemplada en el `<threat_model>` del plan. Reafirmo:

- **T-18-05 (Tampering — lock con worktreePath)**: mitigado por test `lock invariant cross-callsite` (Task 3). Falla loud si futura PR introduce `acquireGsdLockFn(worktree...` o `releaseGsdLockFn(worktree...`. Cross-source scan + stripComments.
- **T-18-06 (Bypass — `--worktree` añadido al orchestrator)**: mitigado por `test/orchestrator-launch-isolation.test.js` + comentario in-file educativo.
- **T-18-07 (TOCTOU entre `existsSync` y `cmux.send`)**: aceptado en el plan — window ms-scale + UUIDs v4 122 bits de entropía. `inFlight` Set cubre dispatches concurrentes del propio kodo.
- **T-18-08 (Disclosure path absoluto en stderr/return)**: aceptado en el plan — mismo modelo que `gsd_locked` con `holder.task_ref`. Path contiene `<projectPath>` (config humano, no secreto) + UUID (random).
- **T-18-09 (DoS pre-creando UUIDs)**: aceptado — 122 bits de espacio.
- **T-18-10 (existsSync EACCES exception)**: mitigado — Node.js `existsSync` retorna `false` ante errores de permisos. Si en OS exótico throws, el catch outer del server libera el lock GSD (no leak).

## Self-Check

**Files modified verified:**

```bash
$ [ -f src/triggers/dispatcher.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f src/orchestrator/launch.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f test/dispatcher.test.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f test/orchestrator-launch-isolation.test.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f test/gsd-concurrency.test.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f .planning/phases/18-worktree-runtime-wiring/18-03-SUMMARY.md ] && echo "FOUND" || echo "MISSING"
FOUND
```

**Commits verified:**

```bash
$ git log --oneline -5 | grep -E "(test|feat|docs)\(18-03\)"
b869ae6 test(18-03): extend gsd-concurrency with worktree coalesce + WT-03 invariants
c0607f4 docs(18-03): document Phase 18 D-06 exclusion in launch.js comment
9c18adb test(18-03): add source-hygiene test for orchestrator-launch D-06 exclusion
537ee94 feat(18-03): add fail-fast worktree_collision canonical error in dispatcher
037ad8e test(18-03): add failing tests for worktree_collision canonical error
```

**Suite global:**

```bash
$ npm test 2>&1 | tail -8
ℹ tests 546
ℹ suites 124
ℹ pass 545
ℹ fail 0
ℹ skipped 1   # LOG-12 Decisión B startup-budget — pre-existente
```

## Self-Check: PASSED

## Outputs for Downstream Plans

- **Phase 19 (stop hook cleanup)**: el stop hook puede asumir que `session.worktree_path` está presente en TODA sesión post-Phase 18 (full + quick + no-GSD). El `git worktree remove <path>` no necesita comprobación de existencia (Plan 03 fail-fast garantiza que si la sesión arrancó, el path es único). Sesiones legacy v0.5 sin `worktree_path` → skip silencioso.
- **Phase 19 (lock + worktree interaction)**: WT-03 invariant preservado — Phase 19 cleanup del worktree puede operar libremente sin tocar el lock per-repo. El lock vive en `<projectPath>/.planning/.kodo.lock` y el worktree en `<projectPath>/.bg-shell/<sessionId>/`. Misma raíz, distinto subdir, ningún cruce.
- **Phase 20+ (HOOK-01 universal)**: las tags GSD viven en el prompt (último arg). El header del cmd ya contiene `--worktree <sessionId>` en posición fija (Plan 02). Phase 20 operará sobre `buildSessionContext`, no sobre el header — golden bytes preservados.

## Notes for Phase 19

El edge case que el reorden D-03 introdujo en Plan 02 (cmux.send fallando tras `addSession` deja un `SessionRecord 'running'` huérfano) sigue documentado en los comentarios actualizados de `dispatcher.js`. Phase 19 podría fortificar el WR-01 catch para limpiar el record. Por ahora se delega al stop hook (mismo modo que crashes post-spawn).

El collision check fail-fast (Plan 03) reduce drásticamente la probabilidad de que un worktree-collision derive en lock leak: solo ocurre si `existsSyncFn` retorna `true` ANTES del launch — la rama tiene release explícito.
