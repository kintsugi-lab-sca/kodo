---
phase: 42-dismiss-tui-read-write-server-amplification
reviewed: 2026-06-05T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/server/dismiss.js
  - src/server.js
  - src/cli/dashboard/client.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/select.js
  - src/cli/dashboard/SessionTable.js
  - src/logger-events.js
  - test/server/dismiss.test.js
  - test/server-dismiss-e2e.test.js
  - test/dashboard-client.test.js
  - test/dashboard/app-dismiss.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 42: Code Review Report

**Reviewed:** 2026-06-05
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

La fase entrega la primera mutación destructiva desde la TUI: `d` + confirmación `d` despacha `DELETE /sessions/{id}`, que delega en `doctor.execute({taskId, fix:true})` a través del módulo puro `dismiss.js`. La arquitectura es sólida: el patrón DI de Phase 40 se espeja correctamente, los tres landmines (DRIFT #1 counter→actions[], DRIFT #2 fix:true, Pitfall 6 findSession) están todos lockeados y documentados, la máquina de estados `mode:'confirm'` implementa el orden de precedencia correcto (confirmLine deriva de `mode`, no de `focusError`), y el never-throws de punta a punta está preservado.

No hay blockers de correctitud en los caminos críticos (no se puede descartar una sesión viva, no hay doble-archive, el TOCTOU está cerrado server-side). Los hallazgos identificados son dos advertencias sobre comportamiento observable en edge cases reales y una tercera sobre la robustez del URL routing, más tres items informativos de cobertura/deuda.

## Critical Issues

Ninguno.

## Warnings

### WR-01: `dismissSession` pasa `armedTaskId` tipado como `string | null` a un parámetro `string`

**File:** `src/cli/dashboard/App.js:328`
**Issue:** El estado `armedTaskId` es `string | null` (línea 195). La rama `mode === 'confirm'` solo se alcanza después de haber seteado `armedTaskId` a un `task_id` real (línea 473), por lo que en la práctica `armedTaskId !== null` cuando se invoca `dismissSession`. Sin embargo, la llamada en línea 328 pasa `armedTaskId` directamente sin ninguna aserción ni guard explícito. Si por algún bug futuro el estado se desincroniza (por ejemplo, una doble-llamada a `setArmedTaskId(null)` antes de que el render pueda crear una nueva closure), el resultado sería `dismissSession(baseUrl, null, fetchFn)`, que haría `encodeURIComponent(null)` y generaría la URL `/sessions/null` — un DELETE silenciosamente incorrecto que el servidor no encontraría (la sesión no existe bajo esa key) pero que respondería 200 con `actions:[]`, pintando "dismissed null" en el footer.

**Fix:**
```js
// App.js:328 — añadir guard explícito antes del await
if (!armedTaskId) {
  setArmedTaskRef(null);
  setMode('list');
  return;
}
const res = await dismissSession(baseUrl, armedTaskId, fetchFn);
```
Este guard es defensivo (no cubre un camino hoy alcanzable), pero el costo es cero y cierra la discrepancia de tipos.

---

### WR-02: El handler `DELETE /sessions/` en `server.js` no valida que el segmento de URL no esté vacío después del prefijo

**File:** `src/server.js:506-517`
**Issue:** La condición `req.url?.startsWith('/sessions/')` es verdadera para la URL exacta `/sessions/` (con barra final pero sin ID). En ese caso, `req.url.slice('/sessions/'.length)` produce la cadena vacía `""`, y `decodeURIComponent("")` produce `""`. El dismiss handler recibe `taskId = ""` y llama `loadState().sessions[""]`. Si esa clave no existe, el guard 409 no se activa y se llama `executeFn({}, { taskId: "", fix: true })`. `doctor.execute` con `taskId: ""` hace una búsqueda de worktree por session vacía: el comportamiento depende de la implementación de doctor (Phase 41), pero en el mejor caso es un no-op que responde `{ok:true, actions:[]}` — feedback confuso para el operador. El path `/sessions/` (sin ID) no es alcanzable desde el cliente TUI (que usa `encodeURIComponent(task_id)` siempre), pero sí desde `curl`, el dashboard HTML (`deleteSession` en línea 165), o un cliente externo.

**Fix:**
```js
// server.js — dentro del handler DELETE, después de extraer taskId
const taskId = decodeURIComponent(req.url.slice('/sessions/'.length));
if (!taskId) {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'missing session id' }));
  return;
}
```

---

### WR-03: `sessionDismissed` (el único helper nuevo de Phase 42 en `logger-events.js`) no tiene ningún test de contrato en `test/logger-events.test.js`

**File:** `test/logger-events.test.js`
**Issue:** El test de taxonomía verifica que `SESSION_DISMISSED` existe en el registro EVENTS (correcto, test añadido). Sin embargo, `sessionDismissed(logger, {task_id, actions_count})` — el helper que emite el evento con los campos contractuales — no tiene ningún test de emisión (a diferencia de todos los otros helpers: `sessionStart`, `sessionEnd`, `worktreeCleanupOk`, `doctorFixWorktree`, `pollingTick`, etc., cada uno tiene su propio `it(...)` que verifica los campos). La cobertura funcional del helper solo existe indirectamente a través del spy de `test/server/dismiss.test.js:191-208` (que verifica `event === 'session.dismissed'` y los campos `task_id`/`actions_count`). Si `sessionDismissed` emitiera un campo con el nombre incorrecto, el spy del test unitario lo detectaría, pero no hay test explícito que verifique la integración real de escritura en el NDJSON bajo una logger instance real (como sí tienen `sessionStart`, etc.).

**Fix:** Añadir en `test/logger-events.test.js` un test que llame `sessionDismissed(log, { task_id: 'KL-42', actions_count: 3 })`, lea la línea emitida y aserte `line.event === EVENTS.SESSION_DISMISSED`, `line.task_id === 'KL-42'` y `line.actions_count === 3`.

---

## Info

### IN-01: `removeSession` es un import muerto en `src/server.js` tras la amplificación del DELETE

**File:** `src/server.js:7`
**Issue:** La importación `{ ..., removeSession, ... }` de `session/state.js` está presente pero `removeSession` ya no se usa en ningún punto del módulo. La Plan 01 Summary explica explícitamente que se dejó intencionalmente ("si queda sin uso después de este cambio, dejar el import, no perseguir cleanup no relacionado"). El proyecto no tiene linter configurado (`npm test` es el único gate), así que es inerte. Sin embargo, para el próximo revisor o para cuando se active lint, es un falso positivo en cualquier análisis estático.

**Fix:** Eliminar `removeSession` de la lista de imports en la línea 7 cuando no haya otro cambio de alcance que lo requiera.

---

### IN-02: Los tests de `app-dismiss.test.js` no cubren `DISMISS_PARTIAL_WARN` ni `DISMISS_ERR` en el render del footer

**File:** `test/dashboard/app-dismiss.test.js`
**Issue:** El test cubre `DISMISS_OK` (caso limpio), `DISMISS_PARTIAL_DIRTY` (worktree movido), `DISMISS_GUARD_ALIVE` (guard TUI) y la cancelación. Los casos `DISMISS_PARTIAL_WARN` (sub-error fail-open: `result:'error'` en actions[]) y `DISMISS_ERR` (fallo HTTP/red del DELETE, `ok:false`) no tienen cobertura de render en la suite de integración TUI. El mapeo en sí está testeado de forma pura en `select-dismiss.test.js` (correcto), pero la integración end-to-end `actions[error] → footer amarillo` y `{ok:false} → footer rojo` no tienen test de render.

**Fix:** Añadir dos casos en `app-dismiss.test.js`:
1. `deleteBody` retorna `{ ok: true, actions: [{ type: 'lock', result: 'error' }] }` → frame contiene `DISMISS_PARTIAL_WARN('KL-2')`.
2. `deleteBody` retorna `{ ok: false, status: 500, json: () => ({ error: 'HTTP 500' }) }` → frame contiene `DISMISS_ERR('HTTP 500')`.

---

### IN-03: El test de la e2e seam aserta `{ kind: 'ok', color: 'green' }` con `deepEqual`, pero `mapDismissResult` en el caso ok no incluye `reason` — la aserción se rompería si se añadiera `reason` en el camino feliz

**File:** `test/server-dismiss-e2e.test.js:100`
**Issue:** `assert.deepEqual(mapped, { kind: 'ok', color: 'green' })` requiere coincidencia exacta de propiedades. `mapDismissResult` actualmente retorna `{ kind: 'ok', color: 'green' }` sin `reason` en el camino limpio (correcto). Pero si en el futuro el tipo `{kind, color, reason?}` se popula con `reason: undefined` en el caso ok (un cambio cosmético probable), el `deepEqual` fallaría con un error confuso (`expected { kind: 'ok', color: 'green' }` vs `{ kind: 'ok', color: 'green', reason: undefined }`). Es un frágil de test menor.

**Fix:** Cambiar a `assert.equal(mapped.kind, 'ok'); assert.equal(mapped.color, 'green');` para ser robusto frente a campos adicionales opcionales, alineándose con el estilo del test (d) que ya usa `assert.equal` campo a campo.

---

_Reviewed: 2026-06-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
