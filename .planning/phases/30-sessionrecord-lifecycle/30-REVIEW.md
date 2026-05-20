---
phase: 30-sessionrecord-lifecycle
reviewed: 2026-05-20T13:46:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/session/state.js
  - src/session/manager.js
  - src/gsd/verify.js
  - src/hooks/stop.js
  - test/session/find-session.test.js
  - test/session/mark-status.test.js
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-05-20T13:46:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

La fase entrega dos refactors quirúrgicos limpios: `findSession` ahora escanea
`state.history` con shape discriminado `{id, session, source}` y
`markSessionStatus` adquiere un falsy-guard observable + return shape
determinístico. Los 8 tests nuevos pasan localmente y los callsites (`verify.js`,
`stop.js`) se actualizaron con el 5º argumento `session.session_id`.

Dicho eso, hay un **bug crítico de comportamiento** que escapa al scope
declarado del phase y que el doble-scan introduce de forma sutil: con
`findSession` ahora devolviendo también entradas de `history`, el `stop hook`
re-procesará sesiones ya archivadas y volverá a ejecutar cleanup completo
(cmux color, worktree remove, lock release, removeSession sobre un id que ya no
está en `state.sessions`). Esto es exactamente el tipo de drift que la fase
quería prevenir y queda invisible para los callers — ninguno mira
`result.source`.

Además hay un acoplamiento estructural entre tests y conducta del producto
(success path emite `state.transition` como nivel `info`, pero el test lo
filtra por `msg === 'state.transition'` — la byte-exactness no está realmente
verificada) y varios issues de robustez/calidad menores listados abajo.

## Critical Issues

### CR-01: `findSession` history-scan rompe la idempotencia del stop hook

**File:** `src/hooks/stop.js:132-220` (rama "session found") interactuando con
`src/session/state.js:208-253` (nuevo doble-scan)
**Issue:**
Antes de Phase 30, `findSession` solo escaneaba `state.sessions`. Si el stop
hook se invocaba dos veces (Claude Code lo dispara más de una vez en algunos
escenarios — restart, reload, hook re-instalación, race entre cmux y Claude),
la segunda invocación devolvía `null` y el hook hacía return temprano (línea
134-145). Idempotencia natural.

Tras LIFE-01, `findSession({ sessionId, cwd })` ahora encuentra la sesión también
si fue archivada. La segunda invocación del stop hook procesará entonces:

- `cmuxClient.setColor(...)` — workspace puede ya no existir o estar
  reasignado (color basura).
- `markSessionStatus(session.task_id, 'done', ...)` — `updateSession` no-op
  porque `state.sessions[taskId]` ya no existe, **pero** `listSessions().find` no
  matcheará nada → `fromStatus = 'unknown'`. Se emitirá un
  `state.transition { from: 'unknown', to: 'done' }` por una sesión que ya
  estaba 'done'.
- `sessionEnd(log, ...)` — segundo `session.end` para la misma sesión.
- Si `session.gsd && session.project_path` con lock vivo de OTRA sesión
  (raro pero no imposible si el path se reutilizó), `releaseGsdLock` puede
  liberar lock ajeno (la idempotencia depende de `verifies session_id`, pero
  el comentario línea 211 lo asume sin verificar aquí).
- **Worktree cleanup completo** sobre `session.worktree_path` — `git status`,
  `git worktree remove`, `branch -D`, `prune`. Si el path ya fue removido y
  re-creado por otra sesión, los efectos secundarios son destructivos.
- `removeSessionFn(id)` con `id = session.task_id` — no-op (delete sobre key
  ausente) pero el log dice `Session ${task_ref} removed from state` como si
  hubiera pasado algo (línea 383).
- Notificación al orquestador via `buildStopNudgeText` — segundo nudge
  espurio.

Esto NO está cubierto por ningún test de la fase. El driver original (ROMAN-132)
quería que `kodo gsd verify` y `kodo logs --session-of` resolvieran sesiones
archivadas — esos son flujos READ. El stop hook es WRITE/side-effects pesados
y no debería reaccionar a entradas de history.

**Fix:**
Discriminar por `result.source` en stop.js (y session-start.js por simetría):

```js
let result = findSessionFn({ sessionId, cwd });
if (!result) { /* orchestrator branch */ return; }
// Phase 30 LIFE-01: descartar entradas de history — el stop hook ya hizo
// cleanup cuando esa sesión transicionó a history. Re-procesar es destructivo
// (workspace puede ya no existir, worktree puede ser de otra sesión).
if (result.source === 'history') {
  console.error(`[kodo:stop] Session ${result.session.task_ref} already archived — skip`);
  return;
}
const { id, session } = result;
```

Y test correspondiente: invocar `runStopHook` dos veces con el mismo
`session_id` y verificar que la segunda llamada no emite `worktree.cleanup.*`
ni `state.transition`.

**Alternativa**: dejar `findSession` con doble-scan pero añadir parámetro
`{ activeOnly: true }` que limite a `state.sessions`. Stop hook y session-start
opt-in al active-only; `verify.js` y `kodo logs --session-of` mantienen el
fallback a history.

## Warnings

### WR-01: El test "success path" no verifica byte-exactness del evento `state.transition`

**File:** `test/session/mark-status.test.js:111-114`
**Issue:**
El test filtra eventos por `msg === 'state.transition'`, pero el helper
`stateTransition` en `src/logger-events.js:145-152` llama
`logger.info(EVENTS.STATE_TRANSITION, { event, from, to, reason })`. El primer
parámetro del logger es el mensaje (que efectivamente es la string
`'state.transition'`), pero el SC#2 ROADMAP y la observabilidad real dependen
de `event` / `from` / `to` / `reason` en el payload. El test solo asserta
`transitions.length === 1` y no inspecciona los campos. Si alguien cambia el
helper a `logger.info('session.state.changed', ...)` o invierte `from`/`to`,
el test sigue verde.

**Fix:**
Añadir assertions sobre los campos del único event encontrado:

```js
assert.equal(transitions[0].fields.from, 'running');
assert.equal(transitions[0].fields.to, 'done');
assert.equal(transitions[0].fields.reason, 'review-gate');
```

### WR-02: `markSessionStatus` success path retorna `{ok: true}` aunque la sesión no exista realmente

**File:** `src/session/manager.js:386-397`
**Issue:**
Cuando `taskId` es truthy pero la sesión NO existe en `state.sessions`
(p.ej. sesión archivada o id nunca registrado), el código:

1. `current = undefined` → `fromStatus = 'unknown'`.
2. `updateSession(taskId, ...)` → no-op silencioso (manager.js#160 hace
   `if (state.sessions[taskId])`).
3. Si hay logger, emite `state.transition { from: 'unknown', to: <next>, reason }`.
4. Retorna **`{ok: true, from: 'unknown', to: <next>}`** — falsamente
   declarando éxito.

El return shape discriminado tiene un valor central: que el caller pueda
distinguir éxito de fracaso. Retornar `ok: true` para un no-op silencioso
oculta drift exactamente del tipo que el phase intenta eliminar. Un caller
futuro que destructure `{ok}` se quedará tranquilo cuando en realidad
state.json no cambió.

Está documentado en el comentario `pitfall #3 de PATTERNS.md — out of scope
para Phase 30`, pero el shape `{ok: true, from: 'unknown', ...}` es
explícitamente engañoso. Mejor cualquiera de estas dos:

**Fix A (recomendado)**: introducir un tercer caso en el discriminated union:

```js
const current = listSessions().find((s) => s.task_id === taskId || s.task_ref === taskId);
if (!current) {
  if (logger) {
    logger.warn('markSessionStatus: session not found', {
      task_id: taskId, status: nextStatus, reason,
    });
  }
  return { ok: false, reason: 'session-not-found' };
}
const fromStatus = current.status;
updateSession(taskId, { status: nextStatus });
// ... rest unchanged
return { ok: true, from: fromStatus, to: nextStatus };
```

**Fix B**: si scope del phase prohibe ampliar el shape, al menos NO emitir
`state.transition` cuando `fromStatus === 'unknown'` (evita ruido) y
documentar el caso en JSDoc de forma visible (no solo en comentarios internos).

### WR-03: `migrateState` descarta `history` silenciosamente al migrar v1→v2

**File:** `src/session/state.js:46-52`
**Issue:**
La función `migrateState` retorna `{ schema_version: 2, sessions: {} }` —
no preserva `history`. Esto siempre ha sido así pero ahora que `history` es
parte del modelo de datos canónico (Phase 30 lo documenta en el typedef
`State`), un user con state v1 y campo `history` (improbable pero posible si
alguien restauró desde backup) perderá las sesiones archivadas en silencio.

Más relevante: `migrateState` siempre tira `sessions` también. La función
parece pensada para "resetear" cuando hay schema viejo, no para migrar. La
JSDoc literal dice "Migra un state object del schema v1 al v2" — el cuerpo
no migra, descarta.

**Fix:**
Si v1 nunca existió (lookup en historia git), eliminar `migrateState` y
`migrateStateIfNeeded`. Si v1 existió alguna vez, preservar lo que se pueda:

```js
export function migrateState(rawState) {
  if (rawState.schema_version === 2) return rawState;
  return {
    schema_version: 2,
    sessions: rawState.sessions || {},
    ...(Array.isArray(rawState.history) ? { history: rawState.history } : {}),
  };
}
```

### WR-04: `loadState` no defensea contra `state.history` corrupto

**File:** `src/session/state.js:97-105`
**Issue:**
`loadState` parsea JSON sin validar la forma. Si state.json en disco tiene
`{"schema_version":2, "sessions":{}, "history": "corrupted"}` (string en vez
de array — drift por edición manual o concurrent write), `findSession` hace
`Array.isArray(state.history) ? ... : []` y se salva, pero `removeSession`
hace:

```js
if (!Array.isArray(state.history)) state.history = [];
state.history.unshift({...});
```

Sobreescribe silenciosamente el `history` corrupto. OK para forward progress,
pero pierde data sin warn. Por consistencia con el resto del codebase (logger
events para state mutations), debería emitir al menos un `console.error`.

**Fix:**
Sumar warn antes del reset, o validar shape en `loadState` y resetear con
warn explícito:

```js
if (state.history !== undefined && !Array.isArray(state.history)) {
  console.error('[kodo] state.history corrupted (not an array) — resetting');
  delete state.history;
}
```

## Info

### IN-01: Faltan tests para lookup por `workspaceRef` y `cwd` sobre `state.history`

**File:** `test/session/find-session.test.js:75-192`
**Issue:**
D-04 explícitamente bloquea que las 3 lookup keys (`sessionId`, `workspaceRef`,
`cwd`) operan idénticas sobre history. El test file solo cubre `sessionId`.
Si un caller futuro usa `findSession({cwd})` esperando match en history (ej:
session-start.js#203 lo hace ya), no hay regression test que lo respalde.

El plan 30-01 reconoce esto explícitamente en `<action>` ("NO añadir
assertions sobre workspaceRef o cwd lookups en history") pero el costo de
añadir 2 tests más es mínimo y la garantía de D-04 quedaría verificada.

**Fix:**
Añadir dos `it()` cortos que ejerciten history scan por `workspaceRef` y `cwd`.

### IN-02: Comentario de línea 251 en plan-30-02 confunde shape de `Session` archivada

**File:** `src/session/state.js:35`
**Issue:**
El typedef nuevo dice `history?: Array<Session & { ended_at: string }>`. Esto
es ergonómico pero técnicamente imprecisó: `Session.status` puede ser
`'running'|'done'|'error'|'review'` y una entry de history no necesariamente
está en estado terminal (removeSession se llama sin transicionar status —
ver stop.js#382 que llama removeSession después de markSessionStatus, pero
la garantía no es estructural). Lo veo más como nota documental que un bug,
pero el shape sugiere que history entries siempre están terminadas, lo cual
no se enforza.

**Fix:**
Bien documentar la garantía implícita ("history entries are written by
removeSession after status transition"), bien introducir un tipo distinto:

```js
@typedef {Session & { ended_at: string }} ArchivedSession
@typedef {{ ..., history?: ArchivedSession[] }} State
```

### IN-03: Mensaje de log en stop.js#383 es engañoso cuando `removeSession` es no-op

**File:** `src/hooks/stop.js:382-383`
**Issue:**
`removeSessionFn(id)` se llama sin importar si la sesión está en `state.sessions`.
La función internamente hace `delete state.sessions[taskId]` siempre. Si
la entry ya no estaba (CR-01 segundo trigger, race con health monitor,
manual cleanup), el log dice "Session XX removed from state" pero state.json
no cambió en esa key. Confunde diagnostico.

**Fix:**
Devolver booleano desde `removeSession` o chequear `state.sessions[taskId]`
antes del call y logear apropiadamente.

### IN-04: Typo en JSDoc + `priorities` debería ser `prioritizes`

**File:** `test/session/find-session.test.js:150`
**Issue:**
`it('priorities sessions over history when entry exists in both', ...)` —
"priorities" como verbo no existe; el verbo es "prioritizes". Cosmético.
Aparece también en la sección de comentarios.

**Fix:**
Renombrar a `prioritizes sessions over history when entry exists in both`.

---

_Reviewed: 2026-05-20T13:46:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
