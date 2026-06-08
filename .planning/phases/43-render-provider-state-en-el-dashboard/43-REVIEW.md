---
phase: 43-render-provider-state-en-el-dashboard
reviewed: 2026-06-08T09:50:00+02:00
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/format.js
  - src/cli/dashboard/select.js
  - src/cli/dashboard/SessionTable.js
  - test/dashboard-filter.test.js
  - test/dashboard-format.test.js
  - test/dashboard-select.test.js
  - test/dashboard-table.test.js
  - test/dashboard/app-focus.test.js
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 43: Code Review Report

**Reviewed:** 2026-06-08T09:50:00+02:00
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 43 añade la columna `task` (eje `provider_state`) a la tabla del dashboard y el prefijo de filtro `ps:` como eje separado de `s:`. La implementación cumple los invariantes de aislamiento de color (cero `picocolors` en todo el árbol de `src/cli/dashboard/`), anti-ReDoS (`String.includes` en toda la capa de derive, sin `new RegExp` sobre input de usuario) y separación de ejes (`ps:` distinto de `s:`). Los tests puros de Phase 43 pasan íntegramente.

Se encontraron tres warnings y dos info. El más importante (WR-01) es un bug latente en `taskCell`: un `provider_state` con valor `''` (cadena vacía) renderiza una celda en blanco sin dim, en vez del `'—'` de fallback documentado para datos ausentes. No se encontraron blockers.

---

## Warnings

### WR-01: `taskCell` no cubre `provider_state === ''` — celda en blanco sin fallback

**File:** `src/cli/dashboard/format.js:207`
**Issue:** La guarda de fallback es `raw == null ? '—' : raw`. `null` y `undefined` retornan `'—'` (sin dim), pero una cadena vacía `''` pasa el check y se devuelve `{ text: '', dim: false }`. El servidor (`provider-state.js`) almacena verbatim lo que retorna el adaptador; si éste retorna `''` (caso de borde del normalizador), la celda queda en blanco —ni el `'—'` del caso unsupported, ni el `'?'` del fetch-failed, ni ningún fallback visible. No crashea, pero es silenciosamente incorrecto y diverge de la especificación ("fallback seguro `'—'` si `provider_state` es null/undefined").

**Fix:**
```js
// format.js:207 — extender la guarda de fallback a cadena vacía
const raw = session.provider_state;
return { text: (raw == null || raw === '') ? '—' : raw, dim: false };
```

---

### WR-02: Tests TUI-07/08/09/10/11/12 en `dashboard-table.test.js` no llaman `unmount()` — event loop leak entre tests

**File:** `test/dashboard-table.test.js:164,182,193,208,225,240,258,387,421,435,458,479,504,549,569`
**Issue:** Dieciséis tests de integración con ink renderizan `App` (con `usePoll` interno que programa `setTimeout` recursivos) pero no llaman `unmount()` al terminar. Los tests PSTATE-05 (líneas 324, 346, 358) y los de overlay (699, 728) sí lo hacen correctamente. El comentario en `app-focus.test.js:113` documenta explícitamente que `unmount()` es necesario para cancelar el loop de polling. El resultado es que cada test deja un timer activo que puede interferir con el orden de ejecución de tests posteriores en el mismo proceso, producir falsos positivos por renders solapados, y en Node ≥18 puede evitar que el proceso termine limpiamente si `--test` no fuerza el exit.

**Fix:** Añadir `unmount()` al final de cada test afectado, siguiendo el patrón de las secciones PSTATE-05 y overlay:
```js
// Patrón a aplicar en cada it() afectado:
const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
// ...
// Al final del test:
// (destructure unmount al render) 
const { lastFrame, unmount } = render(...);
await drain();
const frame = lastFrame();
// ... asserts ...
unmount();
```

---

### WR-03: El JSDoc de `mapDismissResult` describe el check de `'moved-dirty'` de forma ambigua

**File:** `src/cli/dashboard/select.js:251`
**Issue:** El comentario dice `"actions contiene 'moved-dirty'"` sin especificar que se comprueba el campo `result` (y no el campo `type`). El servidor emite `{ type: 'worktree', result: 'moved-dirty' }`, por lo que `a.result === 'moved-dirty'` es correcto. Pero el doc redactado como "actions contiene 'moved-dirty'" induce a leer que se busca el literal en cualquier campo, lo que haría confuso el mantenimiento si el servidor añadiera un `type: 'moved-dirty'` en el futuro.

**Fix:**
```js
// select.js:251 — especificar el campo en el comentario
 *   - `actions` contiene `{ result: 'moved-dirty' }` → `{kind:'dirty', color:'yellow'}` (worktree preservado).
```

---

## Info

### IN-01: No hay test de integración de render para el filtro `ps:` (cobertura solo en capa pura)

**File:** `test/dashboard-table.test.js`
**Issue:** El filtro `ps:` está correctamente cubierto en la capa pura (`test/dashboard-select.test.js` PSTATE-06: parsing, substring, null-miss, anti-ReDoS). Sin embargo, no existe ningún test de integración que abra el modo filtro en el componente `App`, escriba `ps:in_review`, y verifique que las filas correctas aparecen/desaparecen en el frame renderizado. El gap no afecta la corrección actual (la capa pura es exhaustiva), pero no ejercita el camino completo `stdin.write('ps:in_review')` → `parseFilter` → `applyFilter` → `SessionTable` → `lastFrame`.

**Fix:** Añadir un test en el bloque `TUI-12` de `dashboard-table.test.js` usando `FIXTURE_PSTATE` (que ya tiene 3 reason-states), escribiendo `ps:in_review` en el filtro y verificando que solo `PS-1` aparece.

---

### IN-02: `taskCell` devuelve `{ text: '—', dim: false }` para `provider_state_reason` desconocida (forward-compat silenciosa)

**File:** `src/cli/dashboard/format.js:202-207`
**Issue:** Si el servidor añade en el futuro un cuarto `provider_state_reason` (por ejemplo `'rate-limited'` o `'timeout'`), `taskCell` cae al bloque `ok` y muestra `provider_state` verbatim sin `dim`. Esto puede ser confusing UX: una razón de degradación se mostraría con el mismo aspecto que un valor ok. No es un bug ahora (el servidor solo emite `null`, `'unsupported'`, `'fetch-failed'`), pero el diseño no es forward-safe.

**Fix:** Opcional — añadir un `else` explícito que trate cualquier reason no reconocida como degradada:
```js
// format.js — añadir rama de seguridad para reasons futuras
if (reason != null) return { text: '?', dim: true }; // reason desconocida → degradada con '?'
```
Nota: este cambio sería un tradeoff; el enfoque actual es más conservador (muestra datos). Discutir con el equipo antes de aplicar.

---

_Reviewed: 2026-06-08T09:50:00+02:00_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
