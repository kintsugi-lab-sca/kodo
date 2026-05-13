---
phase: 18-worktree-runtime-wiring
reviewed: 2026-05-12T09:06:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/orchestrator/launch.js
  - src/session/manager.js
  - src/session/state.js
  - src/triggers/dispatcher.js
  - test/dispatcher.test.js
  - test/gsd-concurrency.test.js
  - test/manager.test.js
  - test/orchestrator-launch-isolation.test.js
  - test/state.test.js
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-05-12T09:06:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 18 cabela `--worktree <sessionId>` en `launchWorkItem`, persiste `worktree_path` PRE-spawn en `SessionRecord` y añade el canonical error `worktree_collision` en el dispatcher. La arquitectura general respeta los invariantes WT-03 (lock NUNCA toca worktree) y D-06 (orchestrator exento). La cobertura de tests es alta y las decisiones D-01..D-06b están bien documentadas in-file.

Sin embargo, la revisión adversaria detecta **2 BLOCKERS y 5 WARNINGS** que comprometen el contrato del nuevo collision-check, además de pequeñas inconsistencias de robustez:

- **BLOCKER CR-01**: el path `stale_relaunch` del dispatcher threadea `gsdSessionId` (null en non-GSD) en lugar del `dispatchSessionId` validado por el collision-check. Consecuencia: una sesión non-GSD que cae en `stale_relaunch` saltea el contrato fail-fast — `launchWorkItem` generará un UUID FRESH internamente y computará un worktree path que NUNCA pasó por `existsSyncFn`. Rompe el invariante de Plan 03.
- **BLOCKER CR-02**: el reorden D-03 documenta explícitamente que un fallo en `cmux.send` deja un `SessionRecord 'running'` huérfano, pero el catch WR-01 del dispatcher (líneas 346-360 y 386-396) NO limpia el record. El comentario en `dispatcher.js` admite el huérfano ("queda un SessionRecord 'running' huérfano… el stop hook lo limpia en el siguiente ciclo"), pero el stop hook fail-open de cleanup llega en Phase 19. Hasta entonces, este huérfano envenena la cuota `max_parallel` y el guard `session-already-active`.

Warnings: doble `resolveProjectPathFn` (línea 128 + 171), uso de `console.log` para un error canonical (debería ser stderr), TOCTOU window aceptado pero no instrumentado, `existsSyncFn` con falsos negativos en EACCES no testeado, y `stripComments` naive en `gsd-concurrency.test.js`.

## Critical Issues

### CR-01: stale_relaunch path bypasses Phase 18 collision-check for non-GSD sessions

**File:** `src/triggers/dispatcher.js:338`
**Issue:**

En el bloque `stale_relaunch` (línea 318-364), `launchOpts.sessionId` se threadea con `gsdSessionId`, NO con `dispatchSessionId`. Para sesiones GSD esto es correcto (gsdSessionId === dispatchSessionId por línea 167). Pero para sesiones **non-GSD** que caen por la rama stale-relaunch:

1. `gsdSessionId` permanece `null` (línea 124).
2. El bloque collision-check (líneas 167-191) generó un `dispatchSessionId` fresh y validó que `<projectPath>/.bg-shell/<dispatchSessionId>` NO existe.
3. La rama stale_relaunch usa `gsdSessionId` (línea 338) — `null` en non-GSD — por lo que `launchWorkItem` cae en `opts.sessionId || randomUUID()` (manager.js:215) y genera un **UUID DIFERENTE** del validado.
4. `launchWorkItem` luego invoca `computeWorktreePath(projectPath, sessionId)` con la nueva UUID **sin validar colisión**.

Consecuencia: el contrato D-05 fail-fast canonical se rompe en non-GSD stale relaunches — si el path `<projectPath>/.bg-shell/<freshUuid>` colisiona, `claude --worktree` fallará en runtime con un error opaco en lugar del canonical `worktree_collision`. Worse, el `worktree_path` persistido en `SessionRecord` será **distinto** al que el dispatcher logueó/validó.

El path "5. Launch" (línea 366-399) en cambio threadea correctamente `dispatchSessionId` (línea 377). La asimetría entre ambas ramas es el bug.

Ni `test/dispatcher.test.js` ni `test/gsd-concurrency.test.js` testean **non-GSD stale_relaunch con collision check**. El test "resolver runs BEFORE session-already-active guard" (dispatcher.test.js:606) cubre stale_relaunch para GSD, no para non-GSD.

**Fix:**
```javascript
// Línea 338, dentro del bloque stale_relaunch:
...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
```

Replicar el mismo idiom de la línea 377 (path "Launch"). Considerar extraer un helper `buildLaunchOpts({ opts, kodoConfig, dispatchSessionId, gsdPhaseId, gsdBrief })` para evitar la duplicación del shape entre ambas ramas — fuente del bug.

Añadir test:
```javascript
it('Phase 18 D-05: non-GSD stale_relaunch threads dispatchSessionId (NOT gsdSessionId)', async () => {
  // makeDeps con listSessionsFn returning stale session + non-GSD task + existsSyncFn collision-free.
  // Assert: launchCalledWith.sessionId === captured dispatchSessionId (UUID v4, no null/undefined).
});
```

---

### CR-02: PRE-spawn reorder leaves orphan SessionRecord on cmux.send failure — no cleanup in WR-01 catch

**File:** `src/session/manager.js:252-255` + `src/triggers/dispatcher.js:347-360, 386-396`
**Issue:**

El reorden D-03 (`addSession` ANTES de `cmux.send`) está aplicado en `launchWorkItem`. El comentario en líneas 244-251 admite el trade-off: si `cmux.send` falla tras `addSession`, queda un `SessionRecord 'running'` huérfano. El plan delega cleanup al "siguiente ciclo del stop hook" — pero:

1. El stop hook fail-open de cleanup (Phase 19) **no existe todavía** (out-of-scope explícito en CONTEXT.md líneas 17-20).
2. El catch WR-01 del dispatcher (línea 347-360 stale_relaunch + 386-396 launch) **solo libera el lock GSD**. No invoca `removeSessionFn(task.id)` ni similar.
3. La cuota `max_parallel` (manager.js:170-176) cuenta sesiones por `status === 'running'`. Un huérfano persistente envenena la cuota — eventualmente todas las dispatches retornan `Max parallel sessions… reached`.
4. El guard `session-already-active` (dispatcher.js:316-322) también lo retorna `already_active`, bloqueando re-dispatch legítimo del mismo task hasta que el operador limpie manualmente con `kodo logs` o edite state.json.

Las observaciones del plan ("mismo modo que crashes post-spawn — no es nueva superficie") son técnicamente ciertas para *crashes*, pero el **fallo de `cmux.send`** es un caso predecible y manejable (cmux unavailable, EPIPE, timeout) que ahora SIEMPRE deja huérfano — antes del reorden D-03 NO dejaba record en este modo de fallo. Es regresión de robustez.

Test que no captura el bug: `test/gsd-concurrency.test.js:266` ("WR-01: launchWorkItem throws after acquire → lock is released → second task can launch") sólo verifica release del lock, no verifica state.json clean.

**Fix:**

En el catch WR-01 del dispatcher, tras release del lock, limpiar el record huérfano:

```javascript
// dispatcher.js líneas 347-360 (stale_relaunch) y 386-396 (launch):
} catch (err) {
  if (gsdSessionId && gsdProjectPath) {
    try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {/* idempotent */}
  }
  // Phase 18 D-03 reorder: addSession may have run before cmux.send threw.
  // Clean up orphan SessionRecord so max_parallel / already_active guards stay accurate.
  try { removeSessionFn(task.id); } catch {/* idempotent */}
  throw err;
}
```

Alternativa más quirúrgica (Rule 3): mover el cleanup a `launchWorkItem` mismo con un try/catch local alrededor de `cmux.send`:

```javascript
addSession(task.id, session);
try {
  await cmux.send({ workspace: workspaceRef, text: claudeCmd });
} catch (err) {
  // Phase 18 D-03 reorder cleanup: rollback SessionRecord persisted PRE-spawn.
  try { removeSessionFn(task.id); } catch {/* idempotent */}
  throw err;
}
```

Añadir test en `test/gsd-concurrency.test.js`:
```javascript
it('Phase 18 D-03 cleanup: cmux.send failure does NOT leak SessionRecord', async () => {
  // launchWorkItemFn throws AFTER addSession; assert state.sessions[task.id] === undefined.
});
```

## Warnings

### WR-01: `resolveProjectPathFn` is invoked TWICE for non-GSD paths

**File:** `src/triggers/dispatcher.js:171` + `src/session/manager.js:187`
**Issue:**

En el flujo non-GSD:
1. Línea 171: `dispatchProjectPath = resolveProjectPathFn(task)` — para computar worktree path en collision-check.
2. Línea 383 → `launchWorkItem` → línea 187: `resolveTaskAndLaunchContext({ provider, identifier, projects })` → resuelve el path DE NUEVO internamente.

`resolveProjectPath` es una función pura sobre `loadProjects()`, pero `loadProjects()` lee `~/.kodo/projects.json` desde disco (config humano) en cada llamada. En non-GSD el path se resuelve 2 veces; en GSD se resuelve hasta 3 veces (línea 128, 171 (skipped por `if (!gsdMode)`), y dentro de `launchWorkItem`).

Riesgos:
- Inconsistencia: si el config se edita entre la resolución del dispatcher y la del manager, `dispatchProjectPath` (validado por collision-check) ≠ `projectPath` (usado en launchWorkItem). El path validado pierde garantía.
- I/O duplicado en hot path. No es performance v1 (out of scope), pero la **consistencia** sí es correctness.

**Fix:**

Threadear `projectPath` resuelto a `launchWorkItem` vía `opts.projectPath`:
```javascript
const launchOpts = {
  ...(dispatchSessionId ? { sessionId: dispatchSessionId } : {}),
  ...(dispatchProjectPath ? { projectPath: dispatchProjectPath } : {}),
  // ...
};
```

Y en `launchWorkItem` (manager.js:163):
```javascript
const { task, projectPath: resolvedProjectPath, ... } = await resolveTaskAndLaunchContext(...);
const projectPath = opts.projectPath || resolvedProjectPath; // dispatcher single-source-of-truth
```

Esto cierra la ventana de inconsistencia y elimina el I/O duplicado. Alternativa minimalista: aceptar la double-resolution explícitamente y documentarlo inline (Regla 1 — declarar la asunción).

---

### WR-02: `worktree_collision` canonical error uses `console.log`, not stderr

**File:** `src/triggers/dispatcher.js:188`
**Issue:**

El comentario del plan (línea 152) y la sección "Stderr canonical bytes" del summary describen el mensaje como "stderr canonical". El código real emite por `console.log` (stdout), NO `console.error` (stderr):

```javascript
console.log(`[kodo:dispatch] worktree_collision — ${task.ref} blocked by existing worktree at ${worktreePath}`);
```

Esto coincide con el patrón existente (`gsd_locked` en línea 141, `resolver_failed` en línea 273 también usan `console.log`). Convención interna del módulo, no bug nuevo. PERO:

1. El test `test/dispatcher.test.js:921-948` ("stderr canonical bytes…") captura `console.log`, no stderr — el nombre del test es engañoso. Si un futuro reviewer decide migrar a stderr, el test seguirá pasando o fallará por motivo equivocado.
2. Si el operador combina `kodo dispatch … > out.log 2> err.log`, los canonicals quedan mezclados con output normal. Para forensic-grade observability (precedente Phase 16) deberían ir a stderr.

**Fix:**

Opción A (consistencia con módulo, recomendada): renombrar el test y comentarios para usar "stdout canonical" / "trace line" en lugar de "stderr".

Opción B (corrección semántica): migrar TODOS los canonicals del dispatcher a `console.error` en una pasada (out of scope Phase 18; abrir como tech-debt v0.6).

No bloqueante, pero la divergencia entre nombre del test y comportamiento real es un foot-gun.

---

### WR-03: TOCTOU window between `existsSyncFn` and `cmux.send` aceptado pero no instrumentado

**File:** `src/triggers/dispatcher.js:177-191`
**Issue:**

Entre `existsSyncFn(worktreePath)` (línea 179) y `cmux.send` de `launchWorkItem` (manager.js:255) hay una ventana ms-scale donde:
- Otro proceso puede crear `<projectPath>/.bg-shell/<sessionId>/` (poco probable: UUID v4 122 bits).
- El dispatcher mismo, en concurrent dispatches con DOS sessionIds distintos PERO con `existsSyncFn` que devuelve `false` para ambos en paralelo (esperado, son UUIDs distintos), procede a `cmux.send` para ambos. Sin colisión real.

El threat model T-18-07 (Plan 03) acepta esta ventana. Pero no hay observabilidad: si `claude --worktree` falla al crear el worktree porque el dir apareció entre check y create, kodo no loguea explícitamente el TOCTOU.

**Fix:**

Documentar en el comentario inline (líneas 147-166) la ventana TOCTOU y que el síntoma es un fallo en cmux.send (no en collision-check). Opcionalmente añadir un log en el catch de WR-01 cuando se detecta `worktreePath`-related error en `err.message`. No bloqueante.

---

### WR-04: `existsSyncFn` swallows EACCES silently — collision-check returns false negative

**File:** `src/triggers/dispatcher.js:179`
**Issue:**

`existsSync` (Node) retorna `false` ante TODOS los errores, incluyendo `EACCES` (permisos), `ENOTDIR`, `EIO`. Si `<projectPath>` tiene permisos rotos (chmod 000 en parent dir, FUSE filesystem disconnected), `existsSyncFn` retorna `false`, el dispatcher procede a launch, y `claude --worktree` falla con un error opaco que NO el canonical `worktree_collision`.

El plan declara T-18-10 con esta mitigación: "el catch outer del server libera el lock GSD". Pero:
1. El catch outer está en líneas 386-396 (path "Launch"), no en el collision check. Si `existsSyncFn` retorna false negative, NO hay lock leak (no se acquiere otro), pero sí hay UX rota (el operador ve un error de cmux, no un canonical `worktree_collision`).
2. Ningún test simula `existsSyncFn: () => { throw new Error('EACCES'); }` para ver el comportamiento. Los tests usan `() => true` o `() => false` siempre.

**Fix:**

Wrap `existsSyncFn` con try/catch que distingue "no existe" de "no se puede verificar":

```javascript
let pathExists = false;
let probeError = null;
try {
  pathExists = existsSyncFn(worktreePath);
} catch (err) {
  probeError = err;
}
if (probeError) {
  console.log(`[kodo:dispatch] worktree_probe_failed — ${task.ref}: ${probeError.message}`);
  // proceed: let claude --worktree fail with its own error if path is truly broken.
}
if (pathExists) {
  // ...canonical worktree_collision return
}
```

Alternativa: documentar el false-negative en el comentario inline.

---

### WR-05: `stripComments` helper en tests es naive y puede dar falsos positivos

**File:** `test/gsd-concurrency.test.js:494-500` + `test/orchestrator-launch-isolation.test.js:29-35`
**Issue:**

```javascript
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

Problemas:
1. No maneja strings con `//` (ej. `const url = 'http://example.com';`) — el filtro line-comment NO se aplica porque la línea no `startsWith('//')`, pero un cambio futuro `// const url = 'http://...'` sí lo filtraría OK; el riesgo real es al revés: un literal `'//worktree'` dentro de un string sobrevive al filtro. Hoy no aplica al codebase pero es trampa latente.
2. No maneja template literals con `/* */` interpolados.
3. Si alguien introduce `releaseGsdLockFn(/* worktree */ ...)` el regex de comentario block lo elimina ANTES del filtro line, dejando `releaseGsdLockFn( ...)` — pasa el assert, pero la INTENCIÓN del comentario "worktree" estaba dentro. False negative del assert.

Pragmático para esta phase, pero el comentario "patrón Phase 16 LOG-13" sugiere reutilización futura — vale la pena un comentario in-file aclarando los límites.

**Fix:**

Añadir comentario explicando el alcance:
```javascript
// NOTE: naive stripper — does not handle strings containing `//` or block
// comments inline with code. Adequate for current source files (no such
// patterns). For broader use, consider acorn-based AST stripping.
```

O extraer a `test/_helpers/strip-comments.js` para evitar duplicación entre los dos test files.

## Info

### IN-01: Comentario in-file en `launch.js` cita literal una línea runtime — fragilidad documental

**File:** `src/orchestrator/launch.js:87`
**Issue:** El comentario D-06 cita literal `\`cwd: process.cwd()\`` apuntando a la línea 72. Si la línea 72 se renombra o se mueve (refactor inocente), el comentario queda obsoleto silenciosamente. El test `orchestrator-launch-isolation.test.js:48-55` verifica que SOME línea tenga `cwd: process.cwd()` (regex over el source completo), pero no verifica que la cita del comentario apunte a la línea correcta.

**Fix:** Aceptable como está; alternativa de mayor robustez es citar el invariante por nombre ("véase Phase 999.1 D-05 § cwd-constraint") en lugar de citar el código literal. Decisión del autor.

---

### IN-02: JSDoc en `state.js` línea 29 — comentario inline ENORME en el typedef

**File:** `src/session/state.js:29`
**Issue:** El comentario del campo `worktree_path?` ocupa una sola línea de ~300 caracteres con toda la justificación D-03c. Rompe el flujo visual del typedef y dificulta diff-reading. Otros campos del mismo typedef tienen comentarios cortos + decisión-id.

**Fix:** Romper en múltiples líneas siguiendo el patrón de `gsd_mode?`:
```javascript
*   // Phase 18 (D-03c): aditivo opcional, mismo patrón que gsd_mode (Phase 11 D-08).
*   // Path determinístico <projectPath>/.bg-shell/<sessionId> computado por
*   // computeWorktreePath. Legacy v0.5 sessions: leen como undefined.
*   worktree_path?: string,
```

---

### IN-03: `state.history` field is added implicitly in `removeSession`, never declared in typedef

**File:** `src/session/state.js:131` + `:32` (typedef `State`)
**Issue:** El typedef `State` declara `{ schema_version, sessions }` solamente. Pero `removeSession` (línea 131) muta `state.history` sin que esté en el typedef. `listHistory` (línea 144-147) también lo lee con runtime guard. `@ts-check` no falla porque no hay declaración estricta. No es bug nuevo de Phase 18, pero el review notó la divergencia mientras leía el archivo modificado.

**Fix:** Out of scope Phase 18. Anotar como tech-debt: añadir `history?: Array<Session & { ended_at: string }>` al typedef `State`.

---

### IN-04: `test/state.test.js` mezcla 2 describes con conventions divergentes

**File:** `test/state.test.js:1-117`
**Issue:** El primer `describe('state store')` (líneas 15-85) usa raw I/O sobre `TEST_STATE` (tmpdir hardcoded a `Date.now()` — colisión potencial en CI paralelo aunque improbable) y tiene un cleanup test `it('cleanup', ...)` (línea 82) que es un anti-pattern (debería ser `afterAll`). El segundo `describe('computeWorktreePath')` (líneas 87-117) sigue Phase 16 conventions (pure-function asserts). La diferencia de calidad es visible.

**Fix:** Out of scope Phase 18 (los tests del primer describe son v0.x heredados). Anotar como tech-debt: migrar `describe('state store')` a `mkdtempSync` + `afterEach(rmSync)` patrón (mismo idiom que `gsd-concurrency.test.js`).

---

_Reviewed: 2026-05-12T09:06:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
