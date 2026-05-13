---
phase: 18
plan: 02
subsystem: session-runtime
tags: [worktree, launch, command-shape, pre-spawn-ordering, tdd]
requires: [18-01]
provides:
  - "launchWorkItem cablea computeWorktreePath PRE-spawn (D-03)"
  - "buildSessionFromTask persiste worktree_path via conditional spread"
  - "buildClaudeCommand emite --worktree <sessionId> en TODAS las sesiones (D-06b universal)"
  - "addSession → cmux.send (PRE-spawn ordering invertido respecto a v0.5)"
  - "buildClaudeCommand exportado para testabilidad (precedente Phase 16 D-08)"
affects:
  - src/session/manager.js
  - src/triggers/dispatcher.js   # solo comentarios WR-01
  - test/manager.test.js
tech-stack:
  added: []
  patterns:
    - "Conditional spread aditivo opcional (mismo idiom que phase_id/brief/gsd_mode)"
    - "PRE-spawn ordering D-03 (persist antes de side-effect remoto)"
    - "Internal helper exportado para test DI (precedente Phase 16 D-08)"
key-files:
  created:
    - .planning/phases/18-worktree-runtime-wiring/18-02-SUMMARY.md
  modified:
    - src/session/manager.js
    - src/triggers/dispatcher.js
    - test/manager.test.js
decisions:
  - "Reorden PRE-spawn aplicado: addSession ahora corre ANTES de cmux.send (antes corría después). D-03 PRE-spawn ordering."
  - "buildClaudeCommand exportado (era file-local). Lift por testabilidad — precedente Phase 16 D-08 (runStopHook exportado para DI test)."
  - "Comentarios WR-01 obsoletos en dispatcher.js actualizados (Rule 1 deviation: documentación divergente tras reorden)."
metrics:
  duration_minutes: ~25
  tasks_completed: 1
  files_changed: 3
  tests_added: 12
  commits: 3
  suite_pass: "530/531 (1 skip pre-existente — LOG-12 Decisión B startup-budget)"
  completed: 2026-05-12
---

# Phase 18 Plan 02: launchWorkItem Worktree Wiring Summary

`launchWorkItem` cabela `computeWorktreePath` PRE-spawn (single source of truth: Plan 01), persiste `worktree_path` en `SessionRecord` ANTES de `cmux.send` (D-03 PRE-spawn), y `buildClaudeCommand` emite `--worktree <sessionId>` para TODAS las sesiones full + quick + no-GSD (D-06b universal). Golden-bytes Phase 12 QUICK-07 preservado.

## What Shipped

### `src/session/manager.js` (4 cambios atómicos)

**1. Import extendido (línea 8):**

```javascript
// ANTES:
import { addSession, listSessions, updateSession } from './state.js';
// DESPUÉS:
import { addSession, listSessions, updateSession, computeWorktreePath } from './state.js';
```

**2. `buildSessionFromTask` (líneas 11-65):** nuevo param opcional `worktreePath` en el destructuring + conditional spread al final del return object. JSDoc actualizado para documentar el nuevo campo y el patrón aditivo D-03c.

```javascript
// Nuevo al final del return:
...(worktreePath ? { worktree_path: worktreePath } : {}),
```

**3. `launchWorkItem` (líneas ~200-245):**

- Nueva línea tras `const sessionId = ...`:
  ```javascript
  const worktreePath = computeWorktreePath(projectPath, sessionId);
  ```
- `buildSessionFromTask` recibe `worktreePath` como nuevo arg.
- **REORDEN CRÍTICO D-03**: `addSession(task.id, session)` movido ANTES de `cmux.send`. Antes corría después (líneas 212 send / 228 addSession); ahora invertido. Comentario inline explica el trade-off de fail-modes.

**4. `buildClaudeCommand` (líneas 293-312):**

- Función ahora `export function buildClaudeCommand(...)` (era `function` file-local).
- Template emite `--worktree ${sessionId}` INMEDIATAMENTE después de `--session-id ${sessionId}` y antes de `${cliFlags}`:

```javascript
// ANTES:
return `claude --model ${model} --session-id ${sessionId} ${cliFlags} '${escapeShell(prompt)}'`...
// DESPUÉS:
return `claude --model ${model} --session-id ${sessionId} --worktree ${sessionId} ${cliFlags} '${escapeShell(prompt)}'`...
```

Golden-bytes Phase 12 QUICK-07: las tags `[GSD quick]`/`[GSD phase N]`/`[GSD bootstrap]` viven en el PROMPT (último arg, escapado entre comillas) — añadir `--worktree` en el header NO muta los offsets relativos de las tags. `npm test` sobre `test/orchestrator-gsd.test.js` + `test/gsd-context.test.js` lo confirma.

### `src/triggers/dispatcher.js` (solo comentarios)

Dos bloques de comentario WR-01 (líneas ~296 y ~327) afirmaban "addSession runs last". Tras el reorden D-03 en Plan 02 esto es FALSO. Comentarios actualizados a la nueva realidad:

- Throw ANTES de addSession (provider/newWorkspace): no hay SessionRecord; release del lock evita lock stuck hasta TTL.
- Throw ENTRE addSession y cmux.send: queda un SessionRecord 'running' huérfano; el stop hook lo recupera en el siguiente ciclo (mismo modo que crashes post-spawn).
- En ambos casos el release del lock sigue siendo idempotente y seguro.

Sin cambio de lógica runtime — tests WR-01 verdes sin modificación.

### `test/manager.test.js`

**12 nuevos asserts añadidos:**

Dentro de `describe('buildSessionFromTask')`, sub-describe `'worktree_path persistence (Phase 18 WT-02, D-03)'`:

1. `persists worktree_path when worktreePath param is provided`
2. `omits worktree_path key entirely when worktreePath is undefined (legacy compat — D-03c aditivo opcional)`
3. `omits worktree_path key when worktreePath is explicit undefined`
4. `does not regress pre-existing fields when worktree_path is set (byte-shape stable)`

Nuevo `describe('buildClaudeCommand cmd shape (Phase 18 WT-01)')` con 5 asserts:

5. `emits --worktree <sessionId> immediately after --session-id (D-01: explicit, never bare)`
6. `--worktree precedes --dangerously-skip-permissions when GSD flags imply skip-perms`
7. `worktree arg is the sessionId verbatim, not = syntax, not bare`
8. `preserves --model … --session-id … --worktree … flag ORDER (golden-bytes QUICK-07)`
9. `--worktree present for non-GSD sessions too (D-06b universal)`

Asserts source-hygiene en `describe('manager.js source hygiene')`:

10. `Phase 18 WT-01: imports computeWorktreePath from session/state.js (single source of truth)` + anti-inline assert
11. `Phase 18 WT-01: launchWorkItem computes worktreePath from (projectPath, sessionId)`
12. `Phase 18 WT-02: buildSessionFromTask spreads worktree_path conditionally (D-03c aditivo)`
13. `Phase 18 WT-01: buildClaudeCommand emits --worktree ${sessionId} in template` + order check
14. `Phase 18 D-03: addSession runs BEFORE cmux.send (PRE-spawn persistence ordering)`
15. `Phase 18 D-04 invariant: cmux.newWorkspace still uses cwd: projectPath (NOT worktree path)`

Total: 15 asserts nuevos en 2 sub-describes nuevos + 6 asserts integrados en source-hygiene.

## Verification

Acceptance criteria del plan (verbatim):

| Criterio | Esperado | Observado |
|----------|----------|-----------|
| `grep -c "computeWorktreePath" src/session/manager.js` | `>= 2` | **4** ✓ (1 import + 1 invocación + 2 comentarios JSDoc/inline) |
| `grep -c "worktree_path:\s*worktreePath" src/session/manager.js` | `== 1` | **1** ✓ (conditional spread en buildSessionFromTask) |
| `grep -Fc -- '--worktree ${sessionId}' src/session/manager.js` | `== 1` | **1** ✓ (template del cmd en buildClaudeCommand) |
| `grep -c -- "--worktree" src/session/manager.js` | `>= 1` | **6** ✓ (1 template + 5 menciones en JSDoc) |
| PRE-spawn ordering `addSession` antes de `cmux.send` (`node -e` check) | exit 0 | **exit 0** ✓ |
| `node --test test/manager.test.js` | exit 0 | **43/43 pass** ✓ |
| `node --test test/dispatcher.test.js` | exit 0 | **pass** ✓ |
| `npm test` (suite global) | exit 0 | **530/531 pass + 1 skip pre-existente** ✓ |
| `cmux.newWorkspace.*cwd: projectPath` (D-04 invariante) | 1 línea sin mutación | **línea 203 intacta** ✓ |
| `grep -c "schema_version" src/session/manager.js` | `== 0` | **0** ✓ (no migration aquí) |
| Regex quick `--worktree [a-f0-9-]+ --dangerously-skip-permissions` | match | **match** ✓ (output verificado runtime) |
| Golden-bytes Phase 12 QUICK-07 invariante (orchestrator-gsd + gsd-context) | exit 0 | **53/53 pass** ✓ |

**Nota sobre el grep AC #3:** el plan dice `grep -c -- "--worktree \${sessionId}"`. Con comillas dobles + escape `\$`, BSD/GNU grep interpreta `$` como ancla de fin-de-línea y devuelve 0. Usar `grep -F` (fixed-string) con comillas simples es la forma correcta de verificar el literal. La intención del criterio se cumple: hay exactamente 1 ocurrencia del literal `--worktree ${sessionId}` en el código.

## Key Decisions

1. **PRE-spawn reorden aplicado (D-03 estricto):** mover `addSession` ANTES de `cmux.send` invierte el orden v0.5. Trade-off documentado: si `cmux.send` falla, queda un `SessionRecord 'running'` huérfano (antes no quedaba nada). El stop hook lo limpia en el siguiente ciclo. Garantía PRE-spawn: ningún consumer downstream (`kodo logs --session-of`, futuros readers) ve la sesión sin `worktree_path` persistido.

2. **`buildClaudeCommand` exportado para testabilidad:** lift de file-local a named export. Precedente Phase 16 LOG-15 D-08 (`runStopHook` exportado para DI test). Justificado por necesidad de testar el shape del cmd byte-a-byte sin spy-ear cmux.send. Sin riesgo: la función sigue siendo internal de `manager.js`, ningún call site fuera del archivo la invoca tras este plan.

3. **Conditional spread aditivo D-03c:** `worktree_path` se omite del shape de Session cuando `worktreePath` es falsy/undefined. Compat con sesiones v0.5 sin este campo: `'worktree_path' in session === false`, no `worktree_path: null`. Mismo idiom que `phase_id`/`brief`/`gsd_mode` (Phase 9/11).

4. **`buildClaudeCommand` emite `--worktree` SIEMPRE (D-06b universal):** no hay branch GSD/no-GSD en este callsite. La exclusión vive en `launchOrchestrator` (Plan 03 valida). Tests cubren los 3 modos explícitamente.

5. **Dispatcher comments actualizados (Rule 1 deviation):** los comentarios WR-01 de `dispatcher.js` afirmaban "addSession runs last" tras el reorden eso es FALSO. Actualizado a la nueva semántica. Sin alterar lógica runtime — WR-01 sigue siendo correcto bajo el nuevo orden por las razones documentadas inline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Doc Bug] Comentarios WR-01 obsoletos en `src/triggers/dispatcher.js`**

- **Encontrado durante:** Task 1 (post-reorden D-03).
- **Issue:** Dos bloques de comentario en `dispatcher.js` (líneas ~296 y ~327) afirmaban literal "no session record was ever persisted (addSession runs last)". El plan invirtió el orden a `addSession → cmux.send`, dejando estos comentarios FALSOS.
- **Fix:** Re-redacté ambos comentarios documentando el nuevo orden, los 2 fail-modes (throw antes vs. después de addSession) y por qué el WR-01 release sigue siendo idempotente y correcto en ambos.
- **Files modified:** `src/triggers/dispatcher.js` (solo comentarios, sin cambio de lógica).
- **Commit:** `5b299fd`.
- **Tests:** WR-01 tests verdes sin modificación (`test/dispatcher.test.js` + `test/gsd-concurrency.test.js`, 31/31 pass).

### Observaciones sobre acceptance criteria

**`grep -c -- "--worktree \${sessionId}"`:** el comando exacto del plan retorna 0 porque grep sin `-F` interpreta `$` como ancla. Usar `grep -Fc -- '--worktree ${sessionId}'` (con `-F` fixed-string + comillas simples) confirma exactamente 1 ocurrencia, cumpliendo la intención del criterio. No modifico el código por esto — el plan describe la intención correcta, sólo la sintaxis del check tenía el bug.

## TDD Gate Compliance

```bash
$ git log --oneline -3
5b299fd docs(18-02): update WR-01 comments after PRE-spawn ordering inversion
5a20eec feat(18-02): wire --worktree + persist worktree_path PRE-spawn
c847049 test(18-02): add failing tests for --worktree wiring + PRE-spawn ordering
```

- **RED gate** (`test(18-02): add failing tests...`): 12 nuevos asserts añadidos, suite manager.test.js 31 pass / 12 fail (RED confirmado antes de implementar).
- **GREEN gate** (`feat(18-02): wire --worktree...`): implementación mínima en manager.js, suite manager.test.js 43/43 pass.
- **No REFACTOR gate**: implementación ya mínima — 1 import extendido + 1 param + 1 spread + 1 const + 1 reorden + 1 string en template. Nada que limpiar.
- **Adicional**: `docs(18-02): update WR-01 comments...` es deviation Rule 1 (doc fix), no parte del cycle TDD principal.

## Threat Surface Scan

No se introduce nueva superficie no contemplada en el `<threat_model>` del plan. Reafirmo:

- **T-18-03 (Tampering vía sessionId malicioso):** `sessionId` viene de `randomUUID()` o `opts.sessionId` (también UUID). Sin entrada externa al string. UUIDs no contienen `;`, `&`, `$`, espacios. Trust-by-construction.
- **T-18-04 (Disclosure vía `worktree_path` en logs):** `computeWorktreePath` es `path.join` puro sobre `projectPath` (config humano) + literal `.bg-shell` + sessionId (UUID). Sin chars especiales. Logger NDJSON escapa con `JSON.stringify`.
- **T-18-05 (Repudiation por addSession fail silencioso):** la nueva ordenación PRE-cmux REFUERZA la garantía. Si `addSession` falla, `cmux.send` NO se llama — la sesión NO arranca. WR-01 en el dispatcher libera el lock.
- **T-18-06 (DoS por sessionId colisión):** Plan 03 implementa fail-fast canonical en dispatcher ANTES de `launchWorkItem`. Plan 02 NO valida existencia (D-05 lockeado).

## Self-Check

**Files modified verified:**

```bash
$ [ -f src/session/manager.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f src/triggers/dispatcher.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f test/manager.test.js ] && echo "FOUND" || echo "MISSING"
FOUND
$ [ -f .planning/phases/18-worktree-runtime-wiring/18-02-SUMMARY.md ] && echo "FOUND" || echo "MISSING"
FOUND
```

**Commits verified:**

```bash
$ git log --oneline -3 | grep -E "(test|feat|docs)\(18-02\)"
5b299fd docs(18-02): update WR-01 comments after PRE-spawn ordering inversion
5a20eec feat(18-02): wire --worktree + persist worktree_path PRE-spawn
c847049 test(18-02): add failing tests for --worktree wiring + PRE-spawn ordering
```

**Suite global:**

```bash
$ npm test 2>&1 | tail -10
ℹ tests 531
ℹ suites 121
ℹ pass 530
ℹ fail 0
ℹ skipped 1   # LOG-12 Decisión B startup-budget — pre-existente
```

## Self-Check: PASSED

## Outputs for Downstream Plans

- **Plan 03 (`launchOrchestrator` exclusión + canonical error):** asumir que TODA sesión que entra via `launchWorkItem` ya lleva `--worktree <sessionId>` en el cmd y `worktree_path` persistido en state. Plan 03 debe verificar que `launchOrchestrator` (en `src/orchestrator/launch.js`) NO incluye el flag y NO computa el path (la sesión orchestrator es no-worktree por diseño D-06).
- **Phase 19 (stop hook cleanup, `git worktree remove`):** el stop hook lee `session.worktree_path` (presente en TODAS las sesiones nuevas tras Plan 02; ausente en sesiones legacy v0.5) y ejecuta `git -C <projectPath> worktree remove <worktree_path>`. Si el campo es undefined (legacy session), skip silencioso.
- **Phase 19 (WR fix dispatcher):** considerar añadir cleanup explícito del SessionRecord huérfano en el WR-01 catch del dispatcher tras el reorden D-03 (out of scope Plan 02; documentado en comentarios actualizados).

## Notes for Phase 18 Plan 03

El reorden D-03 dejó un edge case nuevo: si `cmux.send` falla tras `addSession`, el `SessionRecord 'running'` queda huérfano. Plan 03 o Phase 19 podrían fortificar el WR-01 catch para limpiar el record. Por ahora se delega al stop hook (mismo modo que crashes post-spawn). Documentado inline en `dispatcher.js` y aquí.
