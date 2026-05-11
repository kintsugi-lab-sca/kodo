---
phase: 16-log-09-debt-cleanup
reviewed: 2026-05-06T13:41:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/gsd/verify.js
  - src/hooks/stop.js
  - src/triggers/dispatcher.js
  - test/dispatcher-isolation.test.js
  - test/gsd-verify-integration.test.js
  - test/stop-state-transition.test.js
  - test/stop.test.js
findings:
  critical: 2
  warning: 8
  info: 4
  total: 14
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-05-06T13:41:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 16 cierra LOG-13/14/15 con cambios mecánicos pequeños (1 import + 4 sustituciones en `dispatcher.js`, 1 invocación en `verify.js`, 1 bloque + refactor light en `stop.js`) y 3 archivos de test nuevos/extendidos. La lógica core respeta las decisiones LOCKED del CONTEXT (D-04 fixed `'done'`, D-07 solo en rama GSD, D-08 PRE-release, D-11 dentro del try OK). Los 30 tests verdes confirman el cableado runtime.

Sin embargo, la revisión adversarial localiza dos defectos **BLOCKER** que comprometen invariantes del sistema en producción: (a) `verify.js` deja huérfano el evento `orchestrator.review` si `markSessionStatus` lanza por error de filesystem, rompiendo el contrato D-17 ("orchestratorReview emitido UNA SOLA VEZ, al final, en TODAS las ramas"); (b) los tests SC#5 polucionan el `~/.kodo/state.json` real del desarrollador, con riesgo de colisión / orphans si el proceso muere antes del cleanup. Adicionalmente, ocho **WARNING** señalan duplicación de creación de logger, gaps de cobertura (Test 4 D-04 no valida `from`, Test 27 no espía `markSessionStatus`), shadowing de child bindings que el test no captura, y un patrón de catch-todo que oscurece bugs futuros.

## Critical Issues

### CR-01: verify.js — `markSessionStatus` rompe el contrato D-17 si lanza (orchestrator.review jamás se emite)

**File:** `src/gsd/verify.js:246`
**Issue:** La invocación `markSessionStatus(session.task_id, 'review', 'gate-passed', log)` está DENTRO del try-OK de `updateTaskState` (línea 237-252) y NO está envuelta en un catch local. `markSessionStatus` ejecuta `updateSession` (state.js:130) que llama a `saveState` → `writeFileSync(STATE_PATH, ...)`. Si el filesystem lanza (`EACCES`, `ENOSPC`, `EROFS`, dispositivo lleno), o si `loadState` corrompe state.json, el throw burbujea por `finalize()` y SALTA la línea 282 `orchestratorReview(log, ...)`.

Esto viola explícitamente el invariante documentado en la cabecera de `verify.js` línea 16:
> "orchestratorReview emitido UNA SOLA VEZ, al final, en TODAS las ramas (D-17)."

El threat model en 16-02-PLAN.md (T-16-09) lo justifica con "fallar early es preferible", pero esa justificación es errónea: en este punto la cadena Plane ya completó (comment posted + state transitioned to "In review"). Plane queda diciendo "review" pero el orquestador NUNCA recibe `orchestrator.review`, así que NO actúa sobre el verdict. El sistema queda en split-brain.

Riesgo concreto: una sesión que pasa el gate, es comentada en Plane, y transicionada a "In review", pero por un error transitorio de fs (state.json read-only por un sec, NFS hiccup) NO se emite `orchestrator.review` → el orchestrator nunca aprueba la fase → se requiere intervención manual. Esto es un fallo silencioso de un side-effect ya completado upstream.

**Fix:** Envolver la invocación en try/catch silencioso, alineado con el patrón ya usado en `stop.js:179-193` para markSessionStatus:
```javascript
try {
  await provider.updateTaskState(task, reviewState);
  transitioned = true;
  // silent — never block orchestratorReview emission on logger/state failure
  try {
    markSessionStatus(session.task_id, 'review', 'gate-passed', log);
  } catch {
    // state.transition is observability-only — orchestratorReview below
    // is the contractual signal the orchestrator consumes (D-17 invariant).
  }
} catch (err) {
  planeApiCallFailed(log, {
    step: 'updateTaskState',
    error: /** @type {Error} */ (err).message,
  });
}
```
Alternativa: documentar en el threat model y en la cabecera de verify.js que D-17 está condicionado a "state.json escribible" — pero degrada el invariante.

### CR-02: stop-state-transition.test.js poluciona `~/.kodo/state.json` real del desarrollador

**File:** `test/stop-state-transition.test.js:33,73,90-266`
**Issue:** El archivo importa `addSession`, `removeSession`, `getSession` desde `../src/session/state.js` y los invoca directamente sobre el state.json real (`KODO_DIR/state.json`) del desarrollador. Cada test escribe entries con `task_id = 'kodo-test-stop-*'` y depende de un `try/finally` + `afterEach` para limpiar.

Defectos:

1. **Race con sesiones reales:** Si el desarrollador está corriendo `npm test` con sesiones kodo activas, las entries `kodo-test-stop-*` aparecen en el state.json en paralelo a entries reales. La operación `addSession` lee el state.json completo, añade su entry, y reescribe → hay carrera con un `addSession`/`removeSession`/`updateSession` concurrente lanzado por un trigger productivo (puede sobreescribir el state real con la versión leída antes). `saveState` no usa file locking ni atomic rename.

2. **Orphans en crashes:** Si el proceso muere por SIGKILL, OOM, panic de Node, machine reboot, o si el test asserta y se lanza ANTES del bloque `finally`/`afterEach` (caso: `assert.ok(transition, ...)` falla → throw burbujea, finally corre, OK; pero si afterEach también lanza, la sesión queda). Las entries `kodo-test-stop-*` quedarían persistidas indefinidamente, contaminando `kodo session ls`.

3. **CI noise:** En CI compartido (mismo HOME entre jobs paralelos), dos jobs corriendo este test concurrentemente pueden encontrar la misma entry. La aleatorización de `task_id` no se usa (son strings literales `kodo-test-stop-full-1` etc.).

4. **Fragilidad ante migración de schema:** `loadState` invoca `migrateStateIfNeeded` que potencialmente rescribe state.json con backup. Los tests no controlan el schema actual del state.json del desarrollador — un schema_version mismatch puede producir backups en cada run.

**Fix:** Usar un tmpdir + override de `KODO_DIR` por test (mismo patrón que `gsd-verify-integration.test.js` que ya usa `mkdtempSync`). Opciones:

A) Inyectar el state-store en `markSessionStatus` (cambio de API):
```javascript
export function markSessionStatus(taskId, nextStatus, reason, logger, deps = {}) {
  const listSessionsFn = deps.listSessionsFn || listSessions;
  const updateSessionFn = deps.updateSessionFn || updateSession;
  // ...
}
```

B) Override `process.env.KODO_HOME` (o lo que sea que `KODO_DIR` resuelve) por test:
```javascript
beforeEach(() => {
  origKodoHome = process.env.KODO_HOME;
  process.env.KODO_HOME = mkdtempSync(join(tmpdir(), 'kodo-test-stop-'));
  // re-import / reset cached config
});
afterEach(() => {
  rmSync(process.env.KODO_HOME, { recursive: true, force: true });
  if (origKodoHome) process.env.KODO_HOME = origKodoHome; else delete process.env.KODO_HOME;
});
```
(Requiere que `KODO_DIR` se resuelva fresh por load, no se cachee al import.)

C) Mantener el patrón actual pero garantizar nombres únicos: `task_id: 'kodo-test-stop-' + randomUUID()` para evitar colisiones cross-job.

Cualquiera de las tres es preferible al estado actual. Sin fix, los tests son frágiles en CI y peligrosos para el desarrollador.

## Warnings

### WR-01: stop.js — Doble creación de logger (sessionEnd + markSessionStatus) duplica side-effects en producción

**File:** `src/hooks/stop.js:150-167, 179-193`
**Issue:** El bloque `sessionEnd` (línea 150-167) y el bloque `markSessionStatus` (línea 179-193) crean cada uno su propio logger:
```javascript
const log = (deps && deps.loggerFactory) ? deps.loggerFactory({...}) : await (async () => {
  const { createLogger } = await import('../logger.js');
  return createLogger({...}).child({...});
})();
```

En el path productivo (sin `deps.loggerFactory`), esto invoca `createLogger` DOS veces para la misma sesión, abriendo dos NDJSON file handles consecutivos al mismo archivo. Si `createLogger` cachea por sessionId (no consultado, pero plausible), no es problema; si no cachea, es un fd extra + posible interleave de writes.

Fix: hoistear el logger una sola vez al entrar a `runStopHook` (después del `findSessionFn` exitoso) y reusarlo en ambos bloques:
```javascript
let log;
try {
  log = (deps && deps.loggerFactory)
    ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
    : await (async () => {
        const { createLogger } = await import('../logger.js');
        return createLogger({...}).child({...});
      })();
} catch {
  log = null;
}

// ... use `log` in both sessionEnd and markSessionStatus blocks, with null-guards
```

### WR-02: stop.js — Catch-todo silencia errores de programación en `markSessionStatus`

**File:** `src/hooks/stop.js:191-193`
**Issue:** El `try { ... } catch {}` envuelve TANTO la creación del logger COMO la invocación `markSessionStatus`. El propósito documentado (D-09) es "never block lock release on logger failure", pero el ámbito del catch es más amplio que ese propósito: incluye también:
- Errores de programación en `markSessionStatus` (TypeError si firma cambia, ReferenceError, etc.)
- Errores de filesystem en `saveState` (EACCES escribiendo state.json)
- Errores de redacción del logger child

En producción, un bug introducido en una refactorización de `manager.js` que rompa `markSessionStatus` será silenciado en stop.js — los logs jamás capturarán el fallo, pero el evento `state.transition` no se emitirá. Los tests SC#5 cogerían el bug porque assertan emisión, pero en producción no hay observabilidad.

Fix: log estructurado al stderr (no NDJSON, dado que estamos en error path del logger) cuando el catch dispare:
```javascript
} catch (err) {
  // silent for the lock-release flow, but surface the error to stderr
  // so that systemic logger/state failures are observable (otherwise the
  // catch silently swallows TypeErrors / EACCES from saveState).
  console.error(`[kodo:stop] markSessionStatus failed (silent): ${err?.message || err}`);
}
```

Alternativa: separar dos try/catch — uno para logger creation, otro para markSessionStatus, cada uno con su mensaje al stderr. El comportamiento "never block" se preserva sin perder observabilidad.

### WR-03: verify.js — Logger threading triplica child bindings (component override)

**File:** `src/gsd/verify.js:86-92, 105`
**Issue:** El default `loggerFactory` retorna un logger ya bound a `{component: 'gsd'}` (línea 92). Línea 105 hace `.child({task_id: session.task_id})` → bindings = `{component:'gsd', task_id:...}`. Después `markSessionStatus` (línea 246) hace internamente `logger.child({component: 'session', task_id: taskId})` → bindings finales = `{component:'session', task_id:taskId}`.

El binding `component: 'gsd'` se sobrescribe correctamente a `'session'` si la implementación del logger child mergea (asumido por el patrón pino). Pero el test memSink en `gsd-verify-integration.test.js:73-83` usa `child: () => logger` (self-return), por lo que NO valida que el merge funcione: si el logger real shadow-ea bindings de forma distinta a la asumida, los tests pasan pero producción emite `state.transition` con `component: 'gsd'` (incorrecto).

Fix: el test debería capturar el binding stack para validar el contrato, ej.:
```javascript
function makeLogger() {
  const events = [];
  let bindings = {};
  const make = (b) => ({
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f, bindings: { ...b } }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f, bindings: { ...b } }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f, bindings: { ...b } }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f, bindings: { ...b } }),
    child: (extra) => make({ ...b, ...extra }),
  });
  return { logger: make({}), events };
}
```
Después assertar: `transition.bindings.component === 'session'`. El defecto está en la cobertura de tests, no en la lógica del runtime — por eso WARNING, no BLOCKER.

### WR-04: stop-state-transition.test.js — Test 4 (D-04 invariante) no valida `from`, solo `to`

**File:** `test/stop-state-transition.test.js:259-262`
**Issue:** El comentario del test (líneas 216-218) declara que el test es mandatory porque "si un implementer infiere modo y emite 'review' para quick (violando D-04), este test cae". Pero el assertion solo verifica `transition.fields.to === 'done'`. NO verifica que `from` corresponda al status persistido (full → 'review', quick → 'running').

Si una refactorización futura hace `markSessionStatus(taskId, 'done', ...)` con un `from` derivado incorrectamente (ej. hardcoded a 'running' siempre), Tests 1 y 2 lo capturan, pero Test 4 (que itera sobre ambos modos) NO. Test 4 es estructuralmente débil — solo aporta valor sobre `to`.

Fix: añadir assert de `from` paramétrico:
```javascript
const expectedFrom = session.gsd_mode === 'full' ? 'review' : 'running';
assert.equal(transition.fields.from, expectedFrom,
  `D-04 invariant: from debe ser ${expectedFrom} para modo ${session.gsd_mode}`);
```

### WR-05: gsd-verify-integration.test.js T27 — No valida que markSessionStatus se invoque ANTES del throw

**File:** `test/gsd-verify-integration.test.js:346-394`
**Issue:** El test "centinela del orden D-11" (líneas 347-350) afirma asegurar que `markSessionStatus` está DENTRO del try de `updateTaskState`. La aserción es `transition === undefined`, que también pasaría si:
- Alguien refactoriza eliminando `markSessionStatus` por completo (regresión silenciosa).
- `markSessionStatus` se invoca pero el logger memSink no captura por algún error de child binding.
- `markSessionStatus` se invoca DESPUÉS del try (afuera) — pero porque está afuera del try y `updateTaskState` lanzó, sí se ejecutaría, sí emitiría `state.transition`, y entonces el test caería. Cubre solo este caso.

El test NO cubre el caso "alguien borra `markSessionStatus` por accidente" (regresión a Phase 15 anterior). El test pass-branch (T20) sí lo cubre, así que la cobertura combinada sí detecta. Aceptable, pero el test "centinela" no es tan exhaustivo como el comentario sugiere.

Fix: añadir un spy explícito sobre `markSessionStatus` (requiere DI o module mock):
```javascript
// Importar markSessionStatus a través del deps en verify.js (cambio de API)
// para poder espiarlo en el test. Si no, dejar el comentario aclarando que
// el test cubre order, no presence — T20 cubre presence.
```

Severidad WARNING, no BLOCKER, porque T20 cubre el caso "presence".

### WR-06: dispatcher.js — Doble import del mismo módulo (eager `EVENTS` + dynamic `gsdPhaseResolved/gsdBootstrap`)

**File:** `src/triggers/dispatcher.js:12, 232`
**Issue:** Línea 12: `import { EVENTS } from '../logger-events.js'` (eager). Línea 232: `const { gsdPhaseResolved, gsdBootstrap } = await import('../logger-events.js');` (dynamic en el try-block matched-true).

Inconsistente: el módulo ya está cargado (Node deduplica con cache), así que el dynamic import no añade lazy-loading real — solo desestructura. Mismo módulo, dos sintaxis. Si la motivación del eager `EVENTS` fue "single source if constant changes" (D-02), la misma lógica aplica a los helpers — debieron migrar al import eager.

Fix: consolidar al top:
```javascript
import { EVENTS, gsdPhaseResolved, gsdBootstrap } from '../logger-events.js';
```
Y eliminar el dynamic import de línea 232. El comentario `// silent — never crash dispatch on logger failure` (línea 259) sigue vigente para los catches alrededor de `log.info()`.

Trade-off: el dynamic import era seguramente una herencia del patrón "lazy load logger.js" (línea 231). Pero `logger-events.js` no es `logger.js` — el primero es pure transform sin side-effects, ya garantizado por LOG-12 invariant; el segundo abre file handles. La razón para el dynamic import desaparece. Solo `createLogger` debería seguir siendo dynamic.

### WR-07: stop.js — Catch del bloque `markSessionStatus` no distingue logger fail vs lookup-not-found

**File:** `src/hooks/stop.js:189-193`
**Issue:** `markSessionStatus(taskId, ...)` invoca `listSessions().find((s) => s.task_id === taskId || s.task_ref === taskId)`. Si la sesión no se encuentra (race con cleanup, desalineación de task_id, state.json corrupto), `current` es `undefined`, `fromStatus` cae a `'unknown'`. `updateSession(taskId, ...)` (manager.js:302) entonces NO escribe (línea 132: `if (state.sessions[taskId])`) — silencioso no-op.

El logger emite `state.transition` con `from: 'unknown'` aún así. En producción esto enmascara: una sesión que llega a stop pero no está en state.json emite un evento "fantasma" sin mutación real. El test memSink no detecta esto (la sesión SÍ está persistida via `addSession`).

Fix: si `markSessionStatus` no encuentra la sesión, no emitir el evento o usar un nivel `warn`:
```javascript
export function markSessionStatus(taskId, nextStatus, reason, logger) {
  const current = listSessions().find((s) => s.task_id === taskId || s.task_ref === taskId);
  if (!current) {
    if (logger) logger.warn('state.transition.skipped', { reason: 'session-not-found', task_id: taskId });
    return;
  }
  const fromStatus = current.status;
  updateSession(taskId, { status: nextStatus });
  if (logger) {
    const log = logger.child({ component: 'session', task_id: taskId });
    stateTransition(log, { from: fromStatus, to: nextStatus, reason });
  }
}
```
(El cambio vive en `manager.js:299-307`, técnicamente fuera del scope de Phase 16, pero es el callsite que Phase 16 introduce el problema observable. Documentar como deuda WARNING.)

### WR-08: dispatcher-isolation.test.js — `stripComments` no captura comentarios inline

**File:** `test/dispatcher-isolation.test.js:24-30`
**Issue:** El helper filtra líneas que **empiezan** con `//` o `*`, pero NO captura comentarios inline en el medio de una línea de código. Ejemplo:
```javascript
const evt = 'gsd.phase.resolved'; // documenting the literal
```
El filtro mantiene esta línea (no empieza con `//`), y `stripped.includes("'gsd.phase.resolved'")` retorna `true` → test falla. Pero la intención del test es "no literales en código" — y aquí SÍ hay literal en código (no es comment).

Sin embargo, el test también atrapa el caso legítimo:
```javascript
log.info('gsd.phase.resolved', {...}); // literal must not appear
```
que es el caso que el test BUSCA detectar. Así que el comportamiento es correcto en intent. El issue es que el helper se nombra "comment-aware" pero solo estripa comentarios full-line — el contributor que añada `// comment con 'gsd.phase.resolved'` al final de una línea de código verá el test fallar incomprensiblemente con el mensaje "must not contain literal".

Fix: el helper o la documentación deben aclarar que solo full-line comments están permitidos. Ajuste de comment al helper:
```javascript
/**
 * Strip block comments + FULL-LINE comments + JSDoc continuation lines.
 * NOTE: inline comments at end of code lines are NOT stripped — if you
 * mention 'gsd.phase.resolved' in an inline comment, the test will fail.
 * This is intentional: full-line comments are documentation; inline
 * comments next to code are reviewable as code.
 */
```

Alternativa: extender el regex para borrar `//.*$` por línea (también stripea inline). Riesgo: regexp puede tropezar con `//` dentro de strings (`'http://...'`) — necesita parser real. Documentar limitation es más simple.

## Info

### IN-01: stop.js — Refactor `runStopHook` no inyecta `releaseGsdLock` ni `handleOrchestratorStop`

**File:** `src/hooks/stop.js:97-222`
**Issue:** El refactor light DI (W-4) inyecta `findSessionFn`, `removeSessionFn`, `cmux`, `loggerFactory`. NO inyecta `releaseGsdLock` ni `handleOrchestratorStop`. La justificación en 16-03-PLAN.md es razonable (lazy import + catch local + tests no asertan), pero deja el test SC#5 dependiendo de que `releaseGsdLock` falle en cada caso (visible en stdout: `Error releasing GSD lock: ENOENT: ...`). Los `console.error` ensucian la salida del test runner.

**Fix:** silenciar el output del catch local cuando se está en test, o inyectar releaseGsdLockFn como deps opcional. Como mínimo, capturar stderr en los tests. No es BLOCKER ni WARNING — es Info de calidad.

### IN-02: dispatcher.js — No hay test que valide el shape exacto del payload tras la migración EVENTS.*

**File:** `src/triggers/dispatcher.js:184-191, 211-218`
**Issue:** El test `dispatcher-isolation.test.js` afirma absence de literales y presence del import. NO valida que el payload runtime (`event:` key + `matched`/`code`/`tolerated`/`mode`/`task_ref`/`error_code`/`detail`) se mantenga byte-a-byte. Esto se hace en `test/dispatcher.test.js` (no leído aquí) — debería verificarse que ese test cubre las 4 variantes con el shape post-migración. Si solo cubre matched-true (helper path), las variantes matched-false migradas no tienen test runtime.

**Fix:** confirmar que `test/dispatcher.test.js` ejercita los 4 callsites runtime (info no-match-tolerated + warn fail-closed con sus campos heterogéneos). Si no, añadir tests.

### IN-03: verify.js — Comentario línea 240-245 cita "header line 26" sin autoreferenciar

**File:** `src/gsd/verify.js:240-245`
**Issue:** El comentario menciona "El reason 'gate-passed' espeja el verdict legacy mapping del header (line 26)". El número de línea (26) puede invalidarse en futuras refactorizaciones. Mejor referenciar el comentario por contenido:
```javascript
// El reason 'gate-passed' espeja el verdict legacy mapping documentado en
// la cabecera de este archivo (sección "Legacy verdict mapping"): pass +
// side-effects OK → 'approved' (reason: 'gate-passed').
```

### IN-04: stop.js — Comentario "mirrors session.end pattern line 116" tiene número incorrecto

**File:** `src/hooks/stop.js:175, 192`
**Issue:** Los comentarios D-08/D-09 referencian "line 116" como ubicación del patrón session.end. En el archivo actual, sessionEnd vive en líneas 150-167 (no 116). El número de línea cambió tras el refactor `runStopHook`. Igual que IN-03, referenciar por contenido en lugar de offset:
```javascript
// Mirrors the session.end emit-BEFORE-mutation pattern in this same function
// (sessionEnd emitted before removeSession).
```

---

## Verification

Tests run during review:
```
node --test test/dispatcher-isolation.test.js test/gsd-verify-integration.test.js test/stop-state-transition.test.js test/stop.test.js
→ tests 30, pass 30, fail 0
```

Tests pasan, pero los issues clasificados arriba NO están cubiertos por la suite. CR-01 requiere un test de fault-injection (`updateSession` lanza), CR-02 requiere análisis estático de imports al state real.

---

_Reviewed: 2026-05-06T13:41:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution Log

**Iteration 1 — 2026-05-06T15:11:00Z (BLOCKER scope only)**

| ID    | Status | Commit    | Files                                     |
| ----- | ------ | --------- | ----------------------------------------- |
| CR-01 | fixed  | `68de9ca` | `src/gsd/verify.js`                       |
| CR-02 | fixed  | `97218d9` | `test/stop-state-transition.test.js`      |

### CR-01 — `verify.js` `markSessionStatus` rompe contrato D-17 si lanza

Aplicado el wrap try/catch local sugerido en el Fix de la review. La
invocación a `markSessionStatus(session.task_id, 'review', 'gate-passed', log)`
queda envuelta en un catch silencioso, alineado con el patrón usado en
`stop.js:179-193`. Justificación documentada inline (CR-01 fix comment):
state.transition es observability-only; orchestratorReview es el signal
contractual del orquestador, así que un fallo de filesystem en
`updateSession` (EACCES, ENOSPC, NFS hiccup) NO debe abortar la emisión.
Adicionalmente, en el mismo comentario se reescribió la cita "header line 26"
por una referencia por contenido (sección "Legacy verdict mapping"), lo
que de paso resuelve IN-03 (cita por número de línea en comentario). IN-03
NO se marca como fixed en esta iteración — el cambio cae como subproducto;
si se requiere tracking explícito, repórtese en una próxima review.

### CR-02 — `stop-state-transition.test.js` poluciona `~/.kodo/state.json`

Aplicada la opción B del Fix (override `HOME` por suite, mkdtempSync +
cleanup en after). Mismo patrón usado por
`test/gsd-verify-integration.test.js`. La importación de
`../src/session/state.js` se migró de eager (top-level `import`) a
dynamic dentro del setup `before`, asegurando que el `KODO_DIR` se
evalúe DESPUÉS del override de `HOME`. Los imports transitivos
(stop.js → manager.js → state.js) heredan el mismo módulo cacheado vía
ESM module cache, así que el `markSessionStatus` interno escribe sobre
el `state.json` del tmpdir, no sobre el real.

`getSession` se quitó del import ya que no se usaba en el cuerpo de los
tests (alcance limpio para evitar dead imports tras el refactor a
dynamic).

### Verificación

- `node --check src/gsd/verify.js` → SYNTAX OK.
- `node --check test/stop-state-transition.test.js` → SYNTAX OK.
- Suite Phase 16 (`dispatcher-isolation` + `gsd-verify-integration` +
  `stop-state-transition` + `stop`): **30 pass / 0 fail**.
- `npm test` (suite completa): **503 pass / 0 fail / 1 skipped**.
- Inspección post-run de `~/.kodo/state.json`: NO hay nuevas entries
  `kodo-test-stop-*` activas tras el run con el fix; la contaminación
  histórica residual (50 entries en `state.history` con `ended_at`
  anterior al fix) sobrevive como deuda diagnóstica del periodo previo
  pero no se incrementa con runs futuros.

### Fuera de scope esta iteración

- **Warnings** (WR-01 a WR-08): pendientes para una iteración posterior.
- **Info** (IN-01 a IN-04): pendientes para una iteración posterior.

_Fixed: 2026-05-06T15:11:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
