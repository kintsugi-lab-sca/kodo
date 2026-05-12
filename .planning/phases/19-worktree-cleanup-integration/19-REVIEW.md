---
phase: 19-worktree-cleanup-integration
reviewed: 2026-05-12T13:35:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/logger-events.js
  - src/hooks/stop.js
  - src/gsd/verify.js
  - test/logger-events.test.js
  - test/stop-worktree-cleanup.test.js
  - test/gsd-verify-integration.test.js
  - test/stop.test.js
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-05-12T13:35:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 19 cablea el worktree cleanup fail-open dentro de `stop.js` (WT-04), reapunta `verify.js` para leer `VERIFICATION.md` desde el worktree con fallback a `project_path` (WT-06) y extiende `logger-events.js` con 3 helpers NDJSON (`worktree.cleanup.{ok,dirty,error}`).

El review revela **3 bugs BLOCKER** en el orden de operaciones del stop hook que rompen el contrato WT-06 end-to-end, **6 WARNING** en robustez/contrato del cleanup y verify, y **4 INFO** sobre brittleness en tests. La taxonomía de eventos y los helpers en `logger-events.js` están limpios — la deuda se concentra en `stop.js` y `verify.js`.

Los problemas críticos son arquitecturales: el cleanup destruye el worktree (y la sesión del state) ANTES de que el nudge al orquestador permita ejecutar `kodo gsd verify <session-id>`. La promesa WT-06 ("verify lee del worktree") sólo se sostiene en el flujo `/gsd-verify-work` invocado por el agente DENTRO de la sesión, no en el flujo orchestrator-led que el propio nudge sugiere.

## Critical Issues

### CR-01: Cleanup destruye el worktree antes de que el orquestador pueda invocar `kodo gsd verify` → WT-06 roto

**File:** `src/hooks/stop.js:217-356` (cleanup) vs `src/hooks/stop.js:362-371` (nudge) vs `src/gsd/verify.js:133` (phasesRoot)
**Issue:**
El orden en `runStopHook` es: (1) `markSessionStatus('done')` → (2) `releaseGsdLock` → (3) `worktree cleanup` (línea 217-356) → (4) `removeSessionFn(id)` (línea 358) → (5) notificar al orquestador con texto que sugiere `kodo gsd verify <session-id>` (línea 362-371). El texto del nudge para sesiones GSD `full` (definido en `buildStopNudgeText`, línea 50) dice literalmente: `Ejecuta \`kodo gsd verify ${session.session_id}\``.

Pero cuando el orquestador ejecuta ese comando:
1. `verify.js:106` llama `findSessionFn({sessionId})` que invoca `findSession` de `src/session/state.js:180`. `findSession` solo busca en `state.sessions`, **NO** en `state.history`. La sesión fue movida a `history` por `removeSession` (línea 358 de stop.js → `src/session/state.js:127-141`), así que `findSession` devuelve `null` y `verify.js:107` lanza `"session not found: <sessionId>"`.
2. Incluso si la sesión fuera recuperable, `verify.js:133` resuelve `phasesRoot = session.worktree_path ?? session.project_path`. El cleanup ya eliminó (clean path) o movió a `.dirty` (dirty path) el worktree. `existsFn(phasesRoot)` → false → verdict `'missing'`. El comentario en Plane diría "VERIFICATION.md no encontrado" aunque la fase esté completa.

Esto es un **doble fallo en cadena**: sin la sesión en `state.sessions` el verify ni siquiera arranca; con la sesión recuperable, el worktree ya no existe. WT-06 sólo funciona cuando `/gsd-verify-work` se ejecuta DENTRO de la sesión Claude Code antes del stop hook — el camino orchestrator-led que el propio nudge anuncia está roto.

**Fix:** Reordenar o desacoplar. Tres opciones:

```javascript
// Opción A: cleanup DESPUÉS del nudge al orquestador
// Mueve líneas 210-356 (cleanup block) a DESPUÉS del bloque "Notify orchestrator"
// (líneas 362-371). El orquestador recibe el nudge mientras el worktree y la
// sesión aún viven; cuando el orquestador invoca verify, todo está intacto.
// Riesgo: el cleanup compite con otra invocación de Claude Code dentro del wt.
// Mitigación: el agente ya terminó (stop hook), nadie escribe al wt.

// Opción B: verify lee de history como fallback
// src/session/state.js findSession() — buscar también en state.history cuando
// no haya match en state.sessions. Y mover el cleanup A UN STOP-DELAYED job
// (cmux notification que dispara cleanup tras N segundos).

// Opción C (más simple, recomendada): no eliminar el worktree clean en stop hook
// Phase 19 D-04 dice "prune oportunista al final". Cambiar la semántica: stop
// hook NUNCA elimina worktree; solo emite worktree.cleanup.* metadata. El
// orquestador (post-verify) decide cuándo borrar. Esto preserva WT-06 sin
// reordenar, a costa de basura en disco hasta el next prune.
```

El test `test/stop-worktree-cleanup.test.js` E2E CLEAN (líneas 262-280) confirma que el worktree y la rama se borran inmediatamente — el contrato actual está en flagrante contradicción con el flujo orchestrator-led que documenta el ROADMAP.

---

### CR-02: `runStopHook` puede ejecutar `markSessionStatus` y `removeSession` sin que la sesión esté ya cerrada en estado terminal — race condition con cleanup

**File:** `src/hooks/stop.js:186-208` (markSessionStatus 'done' + releaseGsdLock) vs `src/hooks/stop.js:358` (removeSession)
**Issue:**
La línea 197 hace `markSessionStatus(session.task_id, 'done', 'session-stop:lock-released', log)`. Pero esto está dentro del bloque `if (session.gsd)` (línea 179). Para sesiones **no-GSD**, no se marca `done` antes de `removeSessionFn(id)` (línea 358). La sesión se archiva a history con el `status` previo (`review` según el fixture), NO con `done`. El logger nunca emite `state.transition` con `to:'done'` para sesiones no-GSD; sin embargo el `sessionEnd` helper (línea 168-173) emite con `status: session.status` que es el status PRE-removal (`review` u otro), no `done`.

Esto significa que `session.end` para sesiones no-GSD emite `status: 'review'` (o cualquier valor previo) en lugar del estado terminal real. El consumer downstream (e.g. analytics que cuente sesiones completadas) verá `status: 'review'` para sesiones que efectivamente terminaron. Hay inconsistencia entre el observable `session.end` y la realidad (sesión archivada).

Adicional: si el branch `if (session.gsd)` lanza después de `markSessionStatus` pero antes de `releaseGsdLock`, la sesión queda con `status: 'done'` pero el lock sigue tomado (el catch defensivo en línea 205-207 sólo loguea). Race aceptable porque `releaseGsdLock` es idempotente, pero merece un test que cubra el caso.

**Fix:**
```javascript
// Mover markSessionStatus FUERA del if (session.gsd) para que todas las sesiones
// transiten a 'done' antes de session.end y removeSession:
try {
  const log = buildLog(session, deps);
  const { markSessionStatus } = await import('../session/manager.js');
  markSessionStatus(session.task_id, 'done', 'session-stop', log);
} catch { /* silent — never block stop hook */ }

// Luego emitir session.end con el status YA actualizado:
sessionEnd(log, {
  session_id: session.session_id,
  task_id: session.task_id,
  status: 'done',  // o leer session.status freshly tras markSessionStatus
  ended_at: new Date().toISOString(),
});
```

---

### CR-03: `worktree move` con path absoluto + `-C <project>` puede fallar — el target relativo no se computa contra el CWD esperado

**File:** `src/hooks/stop.js:311`
**Issue:**
Línea 311 invoca `gitFn(project, ['worktree', 'move', wt, target])`. El default `gitFn` (línea 105-108) lo expande a `git -C <project> worktree move <wt> <target>`. `wt` y `target` son ambos absolutos (porque `target = \`${wt}.dirty\``, línea 304), así que git debería resolverlos correctamente.

Pero hay un caso patológico no cubierto: si `target` ya existe y NO es un directorio vacío (e.g. existsync devolvió true pero es un archivo regular o tiene contenido residual de una corrida anterior), git `worktree move` **fallará** con un error específico. El código maneja eso entrando al fallback de `renameSync + git worktree repair` (línea 318-319). Pero `renameSync` falla en POSIX si el destination existe como directorio no-vacío (ENOTEMPTY), y el catch externo simplemente emite `worktree.cleanup.error{phase:'move'}` y abandona. El worktree dirty se queda **en su sitio original**, accesible al usuario para inspección.

El problema real es que `existsSync(target)` (línea 305) **NO distingue entre `.dirty` que sea un worktree previo vs un archivo regular vs un symlink roto**. El reemplazo `target = \`${wt}.dirty-${Date.now()}\`` (línea 306) sólo dispara cuando existe; pero si `target` es un symlink colgante (e.g. apuntando a un worktree borrado), `existsSync` devolverá false (Node `fs.existsSync` sigue symlinks), `worktree move` intentará escribir, y fallará confusamente.

**Fix:**
```javascript
// Usar lstatSync para detectar symlinks y archivos no-directorio:
import { lstatSync } from 'node:fs';
let target = `${wt}.dirty`;
try {
  const stat = lstatSync(target);
  // Existe (regular file, dir, symlink): siempre forzar variante con timestamp
  target = `${wt}.dirty-${Date.now()}`;
} catch (err) {
  // ENOENT: target libre, OK seguir con `${wt}.dirty`
  if (err.code !== 'ENOENT') {
    // EACCES u otro: ir directamente al fallback timestamp
    target = `${wt}.dirty-${Date.now()}`;
  }
}
```

---

## Warnings

### WR-01: `gitFn` default ignora errores stderr de git — log silenciado en CLEAN path

**File:** `src/hooks/stop.js:105-108`
**Issue:**
El `gitFn` default usa `execFileSync` con `{ encoding: 'utf-8' }` sin `stdio: ['ignore', 'pipe', 'pipe']`. Por defecto `execFileSync` HEREDA stdio del padre cuando se omite, así que stderr de git escapa al stderr del padre. Eso podría ser intencional (visible en logs de Claude Code) pero contamina la salida del hook con mensajes git crípticos. Más importante: cuando git escribe a stderr y exit code != 0, el Error.message contiene a veces sólo "Command failed" sin el stderr capturado.

**Fix:**
```javascript
const gitFn = deps.gitFn || (async (cwd, args) => {
  const { execFileSync } = await import('node:child_process');
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    // Surface stderr para diagnósticos
    err.message = `${err.message} (stderr: ${err.stderr?.toString().trim() || 'none'})`;
    throw err;
  }
});
```

---

### WR-02: `existsFn(phasesRoot)` salta el error mapping de `readdirFn` para sesiones con worktree borrado

**File:** `src/gsd/verify.js:133-186`
**Issue:**
Línea 133 hace `phasesRoot = join(session.worktree_path ?? session.project_path, '.planning', 'phases')`. Si `worktree_path` apunta a un directorio borrado, `existsFn(phasesRoot)` devuelve false → verdict `'missing'` (línea 137-138). Pero "missing" es un mensaje de Plane confuso: el VERIFICATION.md PODRÍA existir en `project_path`, sólo que el código miró al worktree primero.

El fallback a `project_path` ES silent (D-09), pero sólo aplica cuando `worktree_path` es `null/undefined`. Si está definido pero apunta a un path inexistente, NO hay fallback. Esto contradice el intent de D-09: "sesiones legacy v0.5 sin `worktree_path` siguen leyendo del project_path silently" — pero las sesiones v0.6+ post-cleanup también pierden el worktree, y deberían tener el mismo fallback.

**Fix:**
```javascript
// Resolver phasesRoot con fallback transparente cuando worktree no existe:
let phasesRoot;
if (session.worktree_path) {
  const wtPhases = join(session.worktree_path, '.planning', 'phases');
  phasesRoot = existsFn(wtPhases) ? wtPhases : join(session.project_path, '.planning', 'phases');
} else {
  phasesRoot = join(session.project_path, '.planning', 'phases');
}
```

Pero ojo: esto es una curita encima de CR-01. La solución arquitectural real es no destruir el worktree antes del verify.

---

### WR-03: `markSessionStatus` post-`releaseGsdLock` puede fallar silenciosamente y dejar state inconsistente

**File:** `src/hooks/stop.js:186-208`
**Issue:**
Línea 197 invoca `markSessionStatus(session.task_id, 'done', 'session-stop:lock-released', log)` ANTES de `releaseGsdLock` (línea 204). El try/catch en línea 198-200 silencia cualquier fallo de `markSessionStatus`. Si `markSessionStatus` lanza (e.g. EACCES en state.json), el lock se libera de todos modos. Resultado: sesión sigue con status `running` en state.json, lock libre, archivada a history en `removeSessionFn` con status incorrecto.

El comentario en línea 199 dice "silent — never block lock release on logger failure" — pero `markSessionStatus` NO es logger, es escritura a state.json. Confundir las dos categorías de fallo lleva a swallow de bugs reales (e.g. state.json corrupto).

**Fix:**
```javascript
try {
  markSessionStatus(session.task_id, 'done', 'session-stop:lock-released', log);
} catch (err) {
  // Log explícito en stderr para diagnóstico — no es failure silencioso.
  console.error(`[kodo:stop] markSessionStatus failed: ${err.message}`);
}
```

---

### WR-04: `handleOrchestratorStop` puede arrastrar staging de sesiones paralelas en main repo

**File:** `src/hooks/stop.js:413-416`
**Issue:**
Línea 413 ejecuta `git -c commit.gpgsign=false add .claude/skills/ && git -c commit.gpgsign=false commit -m "..."`. Aunque el `git add` está scoped a `.claude/skills/`, esto se ejecuta con `cwd: KODO_ROOT` (línea 414). Si otra sesión Claude Code (e.g. corriendo `/gsd-bootstrap` u otro flujo) tiene archivos staged que tocan `.claude/skills/`, el `git commit` los enrolla en el commit del orquestador.

La memoria del usuario explícitamente advierte sobre este patrón ("sin worktree, prohibido `git add -A` / `commit -a`; arrastra staging de otra sesión"). Aunque aquí el `add` está scoped, el `commit` sin path filter agarra **todo** lo staged.

**Fix:**
```javascript
// Pasar paths explícitos al commit para acotar:
execSync(
  `git -c commit.gpgsign=false commit .claude/skills/ -m "skill: orchestrator learnings ${date}"`,
  { cwd: KODO_ROOT, encoding: 'utf-8' }
);
// Nota: `git commit <pathspec>` commits only those paths (bypasses staging).
// Esto evita arrastre — pero también ignora staging intencional. Trade-off explícito.
```

---

### WR-05: La taxonomía `EVENTS` no está exhaustivamente tipada vs la implementación en runtime — TypeScript JSDoc se desincroniza fácil

**File:** `src/logger-events.js:22-47`
**Issue:**
El JSDoc `@type {Readonly<{...}>}` para `EVENTS` enumera los 11 tipos literales. Si un día alguien añade un evento nuevo en el `Object.freeze({...})` y olvida actualizar el `@type {...}`, TypeScript-en-JSDoc no detecta la divergencia (porque `Object.freeze` devuelve `Readonly<T>` inferido). El test contractual línea 47-64 sí lo cubre, pero a costa de mantener una lista paralela. Tres lugares para sincronizar: JSDoc type, `Object.freeze` literal, test assertion.

No es bug runtime — es deuda estructural. WARNING porque facilita romper la taxonomía sin que CI lo note.

**Fix:**
Generar el JSDoc type desde el literal usando `typeof EVENTS`:
```javascript
export const EVENTS = Object.freeze({
  SESSION_START: 'session.start',
  // ...
});
/** @typedef {typeof EVENTS[keyof typeof EVENTS]} EventName */
```

---

### WR-06: `worktreeCleanupError` con `phase: 'branch'` documentado en JSDoc pero nunca emitido — discrepancia contractual

**File:** `src/logger-events.js:255` vs `src/hooks/stop.js:282-291`
**Issue:**
El JSDoc de `worktreeCleanupError` (línea 252-258) lista `phase: 'status' | 'remove' | 'move' | 'branch' | 'prune'`. Pero en `stop.js:282-291`, cuando `git branch -D` falla, el código emite `console.error` (línea 290) y crea un `worktreeCleanupOk` con `branch_deleted: false` (línea 293-297). **NUNCA** se emite `worktree.cleanup.error{phase:'branch'}`.

El test `test/stop-worktree-cleanup.test.js:209-233` ("BRANCH-D FAILURE") confirma este comportamiento explícitamente: `assert.equal(err, undefined, 'no cleanup.error for branch -D failure (warn-only per Pitfall #3)')`. Es decir, el contrato real es: emitir `cleanup.ok{branch_deleted:false}` y nada más. El JSDoc miente: `'branch'` jamás aparece en producción.

**Fix:** Eliminar `'branch'` del union en la JSDoc, o documentar explícitamente que está reservado para futuras extensiones pero NO se emite hoy:
```javascript
/**
 * @param {{
 *   ...
 *   phase: 'status' | 'remove' | 'move' | 'prune',  // 'branch' NO se emite — fail-open vía warn (Pitfall #3)
 *   ...
 * }} fields
 */
```

---

## Info

### IN-01: `test/logger-events.test.js:111-115` — `sessionEnd` test no pasa `task_id`, viola el contrato del helper

**File:** `test/logger-events.test.js:111-115`
**Issue:**
El JSDoc de `sessionEnd` (en `src/logger-events.js:103-110`) declara `task_id: string | null` como REQUERIDO. El test omite el campo. En runtime esto resulta en `task_id: undefined` en el NDJSON output (porque `fields.task_id` es `undefined` y el helper lo asigna directo). El test no verifica `task_id` así que pasa, pero el evento emitido viola el contrato D-10.

**Fix:**
```javascript
sessionEnd(log, {
  session_id: sessionId,
  task_id: null,  // explicit null para sesiones sin task
  status: 'done',
  ended_at: '2026-04-16T10:05:00.000Z',
});
// Y añadir: assert.equal(line.task_id, null);
```

---

### IN-02: Comentario inconsistente — header de `logger-events.test.js` dice "los 7 helpers" pero hay 11

**File:** `test/logger-events.test.js:4-9`
**Issue:**
El bloque de comentario inicial dice "Los 7 helpers (sessionStart, sessionEnd, ...)" pero el test ya cubre 11 helpers (3 nuevos worktree.cleanup.* añadidos en Phase 19). El comentario quedó stale.

**Fix:** Actualizar el header:
```javascript
* Valida:
*  - EVENTS está frozen y contiene los 11 tipos canónicos.
*  - Los 11 helpers emiten una línea NDJSON con el `event` correcto...
```

---

### IN-03: `test/stop-worktree-cleanup.test.js:182` — regex con escape redundante

**File:** `test/stop-worktree-cleanup.test.js:182`
**Issue:**
La línea construye `new RegExp(\`^${wt.replace(/\//g, '\\/')}\\.dirty-\`)`. El `\\/` no es necesario en un RegExp constructor — `/` no requiere escape ahí. Funciona pero es ruido. Más grave: si `wt` contiene otros metacharacters de regex (e.g. `.`, `+`, `(`, `)`), el match será incorrecto. El `tmpdir()` raramente los emite, pero el patrón es frágil.

**Fix:**
```javascript
// Usar startsWith en vez de regex:
assert.ok(
  target.startsWith(`${wt}.dirty-`),
  `target must use suffixed variant, got: ${target}`,
);
```

---

### IN-04: `test/stop-worktree-cleanup.test.js:54-58` — handler stub silencia errores de retorno no-string

**File:** `test/stop-worktree-cleanup.test.js:52-59`
**Issue:**
`makeGitFnStub` devuelve `handler(cwd, args) ?? ''`. Si un handler accidentalmente retorna un objeto u otro tipo, el stub lo propaga al code-under-test que hace `(out || '').trim()` (stop.js:245). Si `out` es un objeto, `.trim()` lanza `TypeError`. Defensa débil que esconde fallos de fixture.

**Fix:**
```javascript
const gitFn = (cwd, args) => {
  calls.push({ cwd, args });
  const r = handler(cwd, args);
  if (r === undefined || r === null) return '';
  if (typeof r !== 'string') throw new TypeError(`gitFn stub must return string, got ${typeof r}`);
  return r;
};
```

---

_Reviewed: 2026-05-12T13:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
