---
phase: 17-phase-7-uat-automation
reviewed: 2026-05-10T16:25:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - test/logs-follow-integration.test.js
  - test/session-of-resolver.test.js
  - test/session-start-event.test.js
findings:
  critical: 2
  warning: 7
  info: 4
  total: 13
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-05-10T16:25:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Tres tests de integración E2E para automatizar UATs 1, 2 y 3 de Phase 7. Spawnean
subprocesos reales (`bin/kodo` y `src/hooks/session-start.js`), aíslan HOME via
`mkdtempSync`, y assertan contratos contra los helpers (`EVENTS.SESSION_START`,
`runLogs`, `followFile`, `resolveSessionIdFromTaskId`).

La intención y el patrón de aislamiento son correctos. Sin embargo, hay **dos
BLOCKERS** que debilitan o invalidan partes de la cobertura prometida:

1. **UAT-01 — el predicate puede dar falsos positivos sobre la
   propia stderr del child** porque `awaitLine` se subscribe a un único stream
   pero acumula bytes brutos sin distinguir su origen — y, peor, el match
   `seq=1` es prefijo de `seq=10/11/...` (irrelevante con seq∈{1,2,3} pero
   fragiliza la regla — ver CR-02 para el problema real con la **falta de
   stderr drain antes del setTimeout(350)**).
2. **UAT-02 — el comentario de cobertura es engañoso**: el hook resuelve la
   sesión por `session_id` (state.js:159-163), no por `cwd`, así que el
   `project_path: tmpHome` y el `cwd: tmpHome` no ejercitan la rama
   "cwd fallback" que el comentario afirma cubrir.

Además, varios warnings sobre robustez frente a env-vars heredadas,
mensajes `console.log` del migrador de `state.json`, y limpieza incorrecta del
listener de `process.on('SIGINT')` cuando el test termina sin disparar el
handler.

## Critical Issues

### CR-01: UAT-01 — `child.stdout` puede perder los primeros bytes durante el sleep de startup (race en flowing-mode)

**File:** `test/logs-follow-integration.test.js:185-194`

**Issue:** El test adjunta listener a `child.stderr` (línea 185-187) **antes**
del `setTimeout(350)`, pero **NO adjunta listener a `child.stdout`** hasta el
primer `awaitLine` (línea 213). Cuando el child es spawneado con `stdio:
['ignore','pipe','pipe']`, el `child.stderr.on('data', ...)` pone stderr en
flowing mode. **`child.stdout` permanece sin consumer durante 350 ms + el
intervalo hasta el primer `awaitLine`.**

En este caso concreto el archivo NDJSON está vacío en startup (`writeFileSync(logFile, '')`)
así que `followFile` no emite nada en el dump-0 inicial — pero esto es
**accidental al setup**: si en el futuro alguien parametriza el test con
"archivo pre-poblado", o si `bin/kodo` empezara a emitir un banner inicial por
stdout (tipo "tailing X..."), esos bytes se acumularían en el buffer interno
hasta que algún `on('data')` reanudase el stream. Si superan el `highWaterMark`
(por defecto 16 KiB), las escrituras del child bloquean — `appendFileSync` no
se ve afectado, pero el comportamiento de `kodo logs --follow` sí (el child
quedaría bloqueado en `process.stdout.write`).

Además, **`awaitLine` adjunta `on('data')` en cada invocación y lo desadjunta
en `cleanup()`** (líneas 104-108). Entre `awaitLine` y `awaitLine`, **el stream
vuelve a paused** (no quedan listeners de 'data'). Bytes que lleguen entre
batches durante esa ventana sin listener caen al buffer interno; al adjuntar
el siguiente listener vuelven a fluir, **pero también pueden coalescer
batch N y N+1 en el mismo chunk**, lo cual el test sí maneja (predicate por
línea). En la práctica el patrón funciona porque el sleep entre batches
es 250 ms ≥ FOLLOW_INTERVAL_MS, pero la fragilidad es real.

**Fix:** Adjuntar el sink de stdout una sola vez al spawn (igual que stderr) y
usar un buffer compartido + waiter pattern:

```javascript
let stdoutBuf = '';
const waiters = []; // {predicate, resolve, reject, timer}
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString('utf8');
  const lines = stdoutBuf.split('\n');
  stdoutBuf = lines.pop() ?? '';
  for (const line of lines) {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(line)) {
        clearTimeout(waiters[i].timer);
        waiters[i].resolve(line);
        waiters.splice(i, 1);
      }
    }
  }
});

function awaitLine(predicate, timeoutMs, description) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.findIndex(w => w.predicate === predicate);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new Error(`awaitLine timeout (${timeoutMs}ms): ${description} buf=${JSON.stringify(stdoutBuf)}`));
    }, timeoutMs);
    waiters.push({ predicate, resolve, reject, timer });
  });
}
```

Esto elimina la ventana paused, hace el stream consumer único y deja el match
unificado contra el buffer global.

---

### CR-02: UAT-02 — el comentario afirma cobertura por `cwd fallback` que el código nunca ejecuta

**File:** `test/session-start-event.test.js:110, 115-117`

**Issue:** El comentario línea 110 dice
`project_path: tmpHome,                // child cwd = tmpHome → findSession matchea via cwd fallback`
pero el stdin payload que se escribe (líneas 131-135) **incluye `session_id`**:

```javascript
const stdinPayload = JSON.stringify({
  session_id: session.session_id,
  transcript_path: fakeTranscriptPath,
  cwd: tmpHome,
});
```

Y el hook llama `findSession({ sessionId, cwd })` (src/hooks/session-start.js:175).
**`findSession` en `src/session/state.js:158-163` PRIORIZA el match por
`session_id`**:

```javascript
if (query.sessionId) {
  for (const [id, session] of Object.entries(sessions)) {
    if (session.session_id === query.sessionId) return { id, session };
  }
}
// Fall back to workspace ref or cwd
```

Como hay un session_id válido en la state, el match por `cwd` **NUNCA se
evalúa**. La rama "cwd fallback" no está siendo cubierta por este test, en
contra de lo que afirma el comentario.

Esto importa porque el test es la **única automatización del UAT-02**: si
mañana se rompe el matcher por cwd (e.g. alguien cambia `project_path` a
`workspace_ref` por accidente en el iterator) este test seguiría pasando en
verde, dejando un hueco de cobertura silencioso.

**Fix:** Si la intención es cubrir el path por session_id, corregir el
comentario y eliminar el ruido de `cwd: tmpHome` y `project_path: tmpHome`. Si
la intención era el cwd fallback, **omitir `session_id` del stdin** (el hook
construye `findSession({ sessionId: undefined, cwd })` → cae al loop de
fallback) y mantener `project_path: tmpHome`. Recomiendo:

```javascript
// Ramo claro — testea el path session_id (preferred match):
const stdinPayload = JSON.stringify({
  session_id: session.session_id,
  transcript_path: fakeTranscriptPath,
});
// Y borrar el campo `cwd` del payload + el comentario engañoso de la línea 110.
```

O añadir un segundo `it(...)` que cubra explícitamente el fallback por cwd
(omitiendo session_id del stdin).

## Warnings

### WR-01: UAT-01 — el cleanup ignora SIGKILL si el child ya murió pero deja el listener `process.on('SIGINT')` adherido al runner del test

**File:** `test/logs-follow-integration.test.js:243-245`

**Issue:** `followFile` (src/logs/follow.js:67) registra `process.on('SIGINT', ...)`
en el child. **No es problema en el child** porque el child muere. **Es problema
si alguien refactoriza `followFile` para registrar el handler en el padre** o si
el test pasa a importar `followFile` directamente (lo cual no se hace ahora,
pero el comentario de la línea 7 advierte explícitamente "NO importa
`followFile`"). El test cumple esa restricción — pero la guard de finally
(`child.exitCode === null && child.signalCode === null`) es falible:
en macOS, tras `SIGINT` el child puede terminar con `exitCode=0` Y
`signalCode=null` (porque el handler llamó `process.exit(0)`), por lo que
SIGKILL no se dispara. OK. Pero **si SIGINT se ignora** (por ejemplo en CI sin
TTY donde Node SIGINT puede comportarse diferente), `waitForExit(child, 2000)`
rechaza, **se entra al finally**, y la guard SIGKILLs. **Sin embargo, el reject
de `waitForExit` ya hizo `child.off('exit', onExit)`** (línea 137) — pero el
test no captura el error del waitForExit; el `await` lo propaga al runner como
fallo, y luego se ejecuta el finally. OK, el orden es correcto.

**Fix (defensivo):** Capturar el reject de waitForExit explícitamente para
emitir un mensaje accionable cuando SIGINT no convirtió:

```javascript
let exitErr = null;
child.kill('SIGINT');
const exitInfo = await waitForExit(child, 2000).catch((e) => { exitErr = e; return null; });
if (exitErr) {
  // Diagnóstico antes de matar:
  process.stderr.write(`[debug] child stderr: ${stderr}\n`);
  child.kill('SIGKILL');
  throw exitErr;
}
assert.equal(exitInfo.code, 0, ...);
```

---

### WR-02: UAT-01 — `seq=1` es sustring de `seq=10` (predicate frágil bajo cualquier extensión futura)

**File:** `test/logs-follow-integration.test.js:215`

**Issue:**
```javascript
(line) => line.includes('event=test.batch') && line.includes('seq=' + seq)
```
Si en el futuro alguien sube `batches` a 10+ elementos, `seq=1` matchea también
`seq=10`, `seq=11`, etc. — el `awaitLine(seq=1)` resolvería con la línea de
seq=10, falseando el orden estricto que el test promete probar (D-05).

**Fix:** Anclar el match con un terminador no-dígito o usar una regex:

```javascript
(line) => /event=test\.batch/.test(line) && new RegExp(`seq=${seq}(?!\\d)`).test(line)
```

O cambiar el sentinel a `{event:'test.batch', seq:'b' + N}` (string) — la
serialización inline emite `seq=b1`, no ambiguo.

---

### WR-03: UAT-01 — el sentinel se appendea como NDJSON sin `level` ni `msg` ni `timestamp` ISO completo, dejando que `formatLine` emita "UNDEFINED" y "undefined" en stdout

**File:** `test/logs-follow-integration.test.js:204-208`

**Issue:** El sentinel:
```javascript
JSON.stringify({ event: 'test.batch', seq: seq, timestamp: new Date().toISOString() })
```
**no incluye `level` ni `msg`**. `runLogs` invoca `formatLine(rec, {useColor})`
que en la rama no-color produce:
```
${time} ${lvl}${comp} ${rec.msg}${ctx}
```
con `lvl = String(undefined).toUpperCase() === 'UNDEFINED'` y
`rec.msg === undefined → "undefined"`. La línea real emitida es algo como:
```
16:25:00 UNDEFINED undefined +event=test.batch seq=1
```

Funciona porque el predicate solo busca `event=test.batch` y `seq=N`, pero el
test queda dependiente de que `formatLine` jamás filtre/skipée records sin
`msg`/`level`. Hoy no lo hace, pero **es razonable que un futuro hardening
del formatter rechace records mal-formed**. Si eso pasa, este test rompe sin
señal clara de qué cambió.

**Fix:** Hacer el sentinel un record bien-formed (más cercano a un record real
emitido por `createLogger`):

```javascript
const sentinel = JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'info',
  msg: 'uat-batch',
  event: 'test.batch',
  seq: seq,
});
```

Esto desacopla el test del comportamiento undefined-defaulting de `formatLine`.

---

### WR-04: UAT-02 — hereda `KODO_LOG_LEVEL` (y otras env vars) del runner, introduciendo flake en CI

**File:** `test/session-start-event.test.js:122-125`

**Issue:** `env: { ...process.env, HOME: tmpHome }` propaga **todas** las env
vars del runner. El hook usa `process.env.KODO_LOG_LEVEL` (src/hooks/session-start.js:196).
Si un dev tiene `KODO_LOG_LEVEL=warn` exportado en su shell, el logger del child
filtra los `info`-level → **no escribe `session.start` al NDJSON** (porque
sessionStart usa `logger.info`). El test entonces falla en `assert.fail("D-10
fail-loud: hook did not emit session.start NDJSON file...")` con un mensaje que
**no apunta a la causa real** (env var heredada).

**Fix:** Filtrar env vars de manera explícita:

```javascript
const childEnv = {
  PATH: process.env.PATH,
  HOME: tmpHome,
  // Forzar nivel debug para no perder session.start si el shell del dev
  // tiene un override más estricto:
  KODO_LOG_LEVEL: 'debug',
};
const child = spawn(process.execPath, [HOOK_PATH], {
  cwd: tmpHome,
  env: childEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

Aplica también a UAT-01 (línea 178) y UAT-03 (línea 67) por la misma razón.

---

### WR-05: UAT-03 — `migrateStateIfNeeded` puede emitir `console.log("[kodo] State migrado...")` al stdout del child y contaminar las assertions

**File:** `test/session-of-resolver.test.js:128-131`

**Issue:** `afterEach` reescribe `state.json` con `schema_version: 2` (línea 129).
**Pero el primer test (`step-1 hit`) llama `addSession` ANTES** — y `addSession`
internamente llama `loadState` → `migrateStateIfNeeded`. Como el state.json no
existe aún en el primer test, `migrateStateIfNeeded` retorna pronto (línea 54
de state.js). OK.

Sin embargo, en cualquier escenario futuro donde **la suite ejecute por
segunda vez** (e.g. con `--watch`) o donde otro test pre-cree un state.json con
schema_version distinto, `migrateStateIfNeeded` ejecuta
`console.log('[kodo] State migrado a schema_version 2 ...')` (state.js:65).
**Eso es `console.log` del child**, va a `process.stdout`. El test
asserta `result.stdout` con `/body-uat03-step1/`. **Si el log del migrador se
inyecta antes del body, el match de `/body-/` sigue pasando.** OK. Pero el
test 4 (state-points-to-missing-log) asserta `result.stderr` exclusivamente y
no detecta contaminación del stdout — la salud del state.json no está
garantizada por estos tests.

**Fix:** En el `before()`, pre-crear el state.json sintético con
`schema_version: 2` para evitar cualquier camino de migración:

```javascript
before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-uat-session-of-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  // Pre-empt migrateStateIfNeeded:
  writeFileSync(
    join(tmpHome, '.kodo', 'state.json'),
    JSON.stringify({ schema_version: 2, sessions: {} }) + '\n',
  );
  const stateMod = await import('../src/session/state.js');
  addSession = stateMod.addSession;
});
```

---

### WR-06: UAT-03 — `runSessionOf` no inspecciona `result.error`; un `spawnSync` que falla por timeout/ENOENT pasa desapercibido

**File:** `test/session-of-resolver.test.js:61-72, 169-181`

**Issue:** `spawnSync` con `timeout: 5000` (T-17-03-03) puede devolver
`result.status === null` y `result.error` con un `Error` (e.g. si el timeout
golpea, el proceso es matado con SIGTERM). El test asserta:

```javascript
assert.equal(result.status, 0, `step-1 hit should exit 0. status=${result.status} stderr=${result.stderr}`);
```

Si `status === null` (timeout), el assert falla con `null !== 0` pero sin
mencionar el timeout — el dev tiene que ir a ver `result.error` manualmente.

**Fix:** Añadir guard explícito en `runSessionOf`:

```javascript
function runSessionOf(taskId) {
  const r = spawnSync(/* ... */);
  if (r.error) {
    throw new Error(`spawnSync failed for taskId=${taskId}: ${r.error.message} (signal=${r.signal})`);
  }
  return r;
}
```

---

### WR-07: UAT-03 — la regex `/No log file at /` no ancla, falsos positivos posibles si el mensaje cambia a `"... No log file at all ..."` u otra variante

**File:** `test/session-of-resolver.test.js:272`

**Issue:** `assert.match(result.stderr, /No log file at /)` matchea cualquier
sustring que contenga la frase. Si en el futuro el mensaje cambia a
`"warn: No log file at /tmp/foo (try --create)"`, el match sigue pasando aunque
la severidad/contrato cambió. El propio test 3 (línea 230) hace lo mismo con
`/No session found for task /`.

**Fix:** Anclar al inicio de línea:

```javascript
assert.match(result.stderr, /^No log file at /m, '...');
```

Y construir el path esperado completo para verificar:

```javascript
const expectedPath = join(tmpHome, '.kodo', 'logs', sessionId + '.ndjson');
assert.ok(
  result.stderr.includes(`No log file at ${expectedPath}`),
  `stderr should contain canonical path. stderr=${result.stderr}`,
);
```

## Info

### IN-01: UAT-01 — comentario "líneas 67-70" del SIGINT handler puede des-sincronizarse del código fuente

**File:** `test/logs-follow-integration.test.js:21, 230-232`

**Issue:** Los comentarios referencian "src/logs/follow.js:67-70" como
ubicación del handler SIGINT. Si alguien refactoriza `follow.js`, el comentario
queda mintiendo. Es un anti-pattern habitual en docs in-code.

**Fix:** En vez del número de línea, hacer match por símbolo:
"el handler `process.on('SIGINT', ...)` registrado por `followFile`".

---

### IN-02: UAT-02 — comentario "líneas 184-186" / "188-208" del hook se acopla a line numbers del fuente

**File:** `test/session-start-event.test.js:99-101, 172, 200`

**Issue:** Mismo problema que IN-01. Múltiples referencias de tipo "líneas
N-M" en `src/hooks/session-start.js` y `src/logger.js`. Cuando esas líneas se
muevan, el comentario se vuelve ruido.

**Fix:** Eliminar referencias numéricas; describir por nombres de
funciones/símbolos.

---

### IN-03: UAT-03 — código duplicado entre escenarios

**File:** `test/session-of-resolver.test.js:142-167, 240-256`

**Issue:** Construcción del objeto `session` (con campos `task_ref`, `gsd:
false`, `status: 'running'`, `provider: 'plane'`, etc.) se duplica entre tests.
Pequeñas mutaciones futuras (por ejemplo añadir un campo nuevo a la `Session`
typedef en state.js) requieren editar N copias.

**Fix:** Helper `makeSession({ sessionId, taskId, summary })` que devuelva el
objeto completo con defaults razonables.

---

### IN-04: UAT-01 — uso de `process.execPath` con argv `[KODO_BIN, ...]` asume que `bin/kodo` es ESM-importable directamente con node, no via shebang

**File:** `test/logs-follow-integration.test.js:175-180`

**Issue:** `spawn(process.execPath, [KODO_BIN, 'logs', ...])` invoca `node
/path/to/bin/kodo logs ...`. Esto funciona porque `bin/kodo` es probablemente
un script JS con shebang ignorable cuando es invocado por node directo. Si el
binario alguna vez se compila a otro formato (e.g. SEA, pkg, o un binario
nativo), este patrón rompe silenciosamente: node lee el binario como JS y
falla con SyntaxError. Lo mismo aplica a UAT-03 línea 64.

**Fix:** Si `bin/kodo` siempre será JS, OK como está. Si en algún momento se
plantea binarizar, usar `spawn(KODO_BIN, [...args])` (asumiendo ejecutable +x +
shebang).

---

_Reviewed: 2026-05-10T16:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
