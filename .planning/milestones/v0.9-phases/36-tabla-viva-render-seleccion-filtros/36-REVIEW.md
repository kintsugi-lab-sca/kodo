---
phase: 36-tabla-viva-render-seleccion-filtros
reviewed: 2026-05-28T10:35:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/SessionTable.js
  - src/cli/dashboard/format.js
  - src/cli/dashboard/select.js
  - test/dashboard-filter.test.js
  - test/dashboard-format.test.js
  - test/dashboard-select.test.js
  - test/dashboard-status-line.test.js
  - test/dashboard-table.test.js
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 36: Code Review Report

**Reviewed:** 2026-05-28T10:35:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Revisión adversarial de la tabla viva del dashboard TUI (ink@6 + react@19, sin JSX). Las invariantes duras de la fase se verificaron una a una:

- **Color-isolation:** confirmada. Cero `picocolors`, cero ANSI literal, cero import de `src/cli/format.js` bajo `src/cli/dashboard/**`. El walker `test/format-isolation.test.js` y `test/check-isolation.test.js` pasan. Todo el color sale de props `<Text color>` / `dimColor` / `inverse`. OK.
- **Anti-ReDoS:** confirmada. `applyFilter` usa `String.includes` exclusivamente; no existe `new RegExp` con input del operador. El único uso de regex es `query.split(/\s+/)` sobre un literal estático en `parseFilter` (no compila input). El test de `.*` literal pasa. OK.
- **D-03 field-mapping grounding:** confirmada. No hay campos literales `repo`/`phase`/`mode`; todo se deriva (`deriveRepo`, `phaseMode`, `formatAge(elapsed_min)`). Coincide con el schema de `src/session/state.js` y el enriquecido de `src/server.js:379-383`. OK.
- **Esc modal-scoped:** confirmada. Cancela en modo filtro (App.js:175), ignorado deliberadamente en modo lista (App.js:218). OK.
- **Selección por identidad:** implementada con `selectedTaskId`, PERO tiene un defecto de pérdida de identidad cuando el filtro vacía la lista completa (ver CR-01).

Las tres desviaciones del executor se evaluaron y se consideran correctas:
1. **36-01 (parse case-insensitive de prefijos):** `parseFilter` baja el prefijo y el valor a minúsculas; `R:KODO` → `repo:'kodo'`. Test cubierto. OK.
2. **36-02 (migración de 3 aserciones a contadores):** las aserciones de resiliencia TUI-06 (keep-last-good `3 sessions`/`2 sessions`, `server caído`/`retrying`, `waiting for server` sin contador, supervivencia del frame ante JSON corrupto) están preservadas en `dashboard-status-line.test.js`. El live ahora afirma `● live` + `task_ref` (tabla montada) en vez de `N sessions`. La resiliencia no se debilitó. OK.
3. **36-03 (retirado `new RegExp` literal de comentarios):** verificado por grep; no quedan menciones de `new RegExp` en el código fuente del dashboard. OK.

Los 52 tests de las suites del dashboard pasan en verde. Sin embargo, el verde **no prueba corrección**: el hallazgo CR-01 cae en un agujero de cobertura concreto (los tests de D-16 solo ejercitan el camino donde el filtro CONSERVA la fila seleccionada, nunca el camino donde la oculta por completo y luego se limpia).

## Critical Issues

### CR-01: Pérdida permanente del cursor cuando el filtro oculta TODA la lista (viola D-16)

**File:** `src/cli/dashboard/App.js:226-229`

**Issue:**
El `useEffect` de write-back sobreescribe `selectedTaskId` con `sel.taskId` siempre que difieran, **incluyendo el caso en que `sel.taskId === null`**. Cuando el operador teclea un filtro que no matchea ninguna fila (`no sessions match`), `resolveSelection` devuelve `{ index:-1, taskId:null }` (select.js:66) y este efecto ejecuta `setSelectedTaskId(null)`, **destruyendo la identidad guardada**. Al limpiar el filtro (Esc), la lista completa vuelve pero `selectedTaskId` ya es `null`, así que `resolveSelection` cae al fallback de clamp con `prevIndex` y el cursor salta a otra fila en vez de volver a la sesión donde estaba.

Traza reproducible (verificada fuera de React con las funciones puras):
```
selectedTaskId = 'b' (fila inferior seleccionada)
→ filtro 'r:zzzznomatch' → filtered = []
→ resolveSelection([], 'b', 1) = { index:-1, taskId:null }
→ useEffect: prevIndexRef = 0; setSelectedTaskId(null)   ← identidad perdida
→ Esc limpia el filtro → lista completa, selectedTaskId === null, prevIndex 0
→ resolveSelection(full, null, 0) = { index:0, taskId:'a' }   ← cursor saltó a 'a', NO volvió a 'b'
```
Esto contradice directamente la promesa de D-16 ("El cursor se preserva por identidad") citada en el propio comentario de App.js:47. El test de D-16 (`dashboard-select.test.js:85-112`) solo prueba el filtro `s:running` que CONSERVA la fila `b`, y el test de `no sessions match` (`dashboard-table.test.js:386-404`) nunca limpia el filtro para verificar el retorno del cursor — por eso el bug pasa desapercibido en verde.

**Fix:**
No pisar la identidad cuando la selección resuelta es nula (lista vacía / filtro sin match). Preservar el último `selectedTaskId` válido para que sobreviva al ciclo filtrar→limpiar:
```js
useEffect(() => {
  prevIndexRef.current = sel.index >= 0 ? sel.index : prevIndexRef.current;
  // Solo escribir cuando hay una fila resuelta real; NUNCA pisar con null
  // (el filtro que oculta todo no debe borrar la identidad — D-16).
  if (sel.taskId != null && selectedTaskId !== sel.taskId) {
    setSelectedTaskId(sel.taskId);
  }
}, [sel.index, sel.taskId, selectedTaskId]);
```
Añadir además un test que cubra el agujero: seleccionar `b`, aplicar un filtro sin match (`no sessions match`), cancelar con Esc, y afirmar que el gutter `›` vuelve a `KL-2`/`b` y no a `KL-1`/`a`.

## Warnings

### WR-01: `sortSessions` produce orden no determinista con `started_at` no parseable (rompe la garantía anti-flicker de D-04)

**File:** `src/cli/dashboard/select.js:41-48`

**Issue:**
El comparador hace `new Date(a.started_at ?? 0).getTime()`. El fallback `?? 0` solo cubre `null`/`undefined`; un `started_at` que sea un string **no parseable** (sesión legacy o dato corrupto del server) produce `NaN`. Entonces `ta !== tb` evalúa `true` (porque `NaN !== cualquier-valor`), el comparador retorna `tb - ta = NaN`, y un comparador que devuelve `NaN` deja el orden **indefinido/no determinista** — anulando justamente el tiebreak explícito por `task_id` que D-04 introdujo para que dos polls no intercambien filas (la clase de bug ROMAN-132 trasladada a la UI). El server confía en que `started_at` es válido (`src/server.js:382` también haría `NaN` en `elapsed_min`), así que un solo registro con timestamp corrupto degrada el orden de toda la tabla y reintroduce flicker entre polls.

```
new Date('not-a-date').getTime()  → NaN
NaN !== <ts válido>               → true  (entra a la rama DESC)
tb - NaN                          → NaN   → orden indefinido, tiebreak nunca se aplica
```

**Fix:**
Normalizar el timestamp a un número finito antes de comparar, cayendo al tiebreak por `task_id` cuando no sea válido:
```js
export function sortSessions(rows) {
  const ts = (r) => {
    const t = new Date(r.started_at ?? 0).getTime();
    return Number.isFinite(t) ? t : 0; // timestamp inválido → epoch, deja que mande el tiebreak
  };
  return [...rows].sort((a, b) => {
    const ta = ts(a);
    const tb = ts(b);
    if (ta !== tb) return tb - ta;
    const ka = a.task_id ?? '';
    const kb = b.task_id ?? '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
```

### WR-02: `countByStatus` no contempla el estado `idle` que el server puede emitir; `done` se cuenta pero nunca se muestra como derivado

**File:** `src/cli/dashboard/select.js:131-137` y `src/cli/dashboard/format.js:91-98`

**Issue:**
El schema de `Session` (`src/session/state.js:20`) declara `status: 'running'|'done'|'error'|'review'`, pero `src/server.js:200` deriva un `displayStatus = 'idle'` para sesiones running con `elapsed_min > 30`. Ese `displayStatus` se usa solo en el HTML del server y NO se serializa en `/status` (que envía `s.status` crudo vía `...s`), así que hoy el cliente nunca ve `idle`. Aun así, la capa de derive es frágil ante cualquier estado fuera del set conocido: `countByStatus` los ignora silenciosamente (no hay categoría "otros") y `statusColor`/`statusLabel` los rinden sin color y sin marca. Si el server llegara a propagar `idle` (o un estado futuro), el operador vería filas sin representar en los contadores del header — discrepancia silenciosa entre la suma de contadores y el número de filas visibles.

Esto no es un crash y hoy no se dispara, pero es una suposición de acoplamiento no declarada entre `select.js` y el set de status del server. Conviene al menos documentar el contrato o añadir un contador `other`/passthrough.

**Fix:**
Decisión mínima: documentar explícitamente que `countByStatus` solo cuenta el set cerrado `{running, review, done, error, zombie}` y que cualquier otro status se omite a propósito. Si se quiere robustez, añadir un passthrough:
```js
// status desconocido: rendir tal cual en la celda (ya lo hace statusLabel),
// pero contarlo para que el header no mienta sobre el total de filas.
```
Como mínimo, alinear el JSDoc de `select.js` para que el acoplamiento al set de status del server sea explícito.

### WR-03: `formatAge` no normaliza `elapsed_min` no entero — produce etiquetas rotas tipo `1h3.5m`

**File:** `src/cli/dashboard/format.js:55-61`

**Issue:**
`formatAge` asume que `elapsed_min` es entero. El server lo computa con `Math.floor(...)` (`src/server.js:382`), así que hoy llega entero, pero la función no defiende ese contrato: `formatAge(5.7)` → `'5.7m'` y `formatAge(63.5)` → `'1h3.5m'` (el `%` sobre un float deja el decimal). Es otra suposición de acoplamiento no declarada al `Math.floor` del server; cualquier cambio ahí (o un consumidor de test que pase un float) rompe el formato de la celda `age`.

```
formatAge(5.7)  → '5.7m'
formatAge(63.5) → '1h3.5m'
```

**Fix:**
Normalizar la entrada al inicio de la función para que sea autocontenida:
```js
export function formatAge(elapsedMin) {
  if (elapsedMin == null || elapsedMin < 0) return '—';
  const min = Math.floor(elapsedMin); // autocontenido: no depender del floor del server
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
```

## Info

### IN-01: `lastError` es estado muerto — se escribe pero nunca se lee

**File:** `src/cli/dashboard/App.js:108-109, 134, 140`

**Issue:**
`lastError` se setea en `onResult` (líneas 134/140) pero su valor nunca se lee en el render ni en ninguna derivación; está marcado con `// eslint-disable-next-line no-unused-vars` para silenciar el linter. Es estado que provoca un setState (y por tanto un re-render) sin efecto observable. Si la intención es exponerlo en una fase futura, conviene un comentario que lo declare; si no, eliminar el estado y los dos `setLastError` reduce re-renders y ruido.

**Fix:** O bien renderizar `lastError` (p. ej. en el banner stale), o eliminar `lastError`/`setLastError` y los dos call-sites. No dejar estado muerto con el disable-comment como única justificación.

### IN-02: Inconsistencia comentario/código en el footer de hints

**File:** `src/cli/dashboard/App.js:18, 251`

**Issue:**
El comentario de cabecera (línea 18) describe el footer como `footer hint 'q quit' (abajo) — conservado de Phase 34`, pero el código renderiza `'↑↓ move · / filter · q quit'` (línea 251). El comentario quedó desactualizado tras añadir navegación y filtro en Plan 03. Documentación que miente sobre el código.

**Fix:** Actualizar el comentario de la línea 18 para reflejar el footer real (`↑↓ move · / filter · q quit`).

### IN-03: `cell({ truncate: false })` para `age` es redundante pero inofensivo

**File:** `src/cli/dashboard/SessionTable.js:194`

**Issue:**
La celda `age` pasa `truncate: false` explícito; el ancho `COLS.age = 7` siempre alberga el valor máximo posible de `formatAge` (`'1h3m'`, `'120h'`... el peor caso realista cabe), así que el truncado nunca se activaría de todos modos. No es un bug; es una decisión defensiva. Se anota solo por completitud — no requiere acción salvo que se quiera homogeneizar el estilo con las demás celdas truncables.

**Fix:** Ninguno requerido. Opcionalmente documentar por qué `age` y `status` no truncan (el `(zombie)` y la edad son load-bearing) en una sola línea junto a `COLS`.

---

_Reviewed: 2026-05-28T10:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
