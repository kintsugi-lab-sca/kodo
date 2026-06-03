---
phase: 39-paneles-auxiliares-comentarios-logs
reviewed: 2026-06-02T12:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/SessionTable.js
  - src/cli/dashboard/client.js
  - src/cli/dashboard/select.js
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: resolved
resolution:
  resolved: 2026-06-02T12:45:00Z
  fixed:
    - "CR-01: guard de generación (overlayReqRef) en handlers c/l + invalidación en Esc"
    - "WR-01: clamp de scroll usa OVERLAY_VIEWPORT (movido a App.js como única fuente de verdad)"
    - "WR-02: tests de scroll ↑/↓, clamp y race condition añadidos (dashboard-overlay.test.js)"
  deferred:
    - "IN-01: dependencia circular App↔SessionTable (preexistente, funcional)"
    - "IN-02: JSDoc de mode/hostError en SessionTable"
    - "IN-03: JSON.stringify fallback en comentarios sin campo de texto"
  suite: "1067 pass / 0 fail / 1 skipped"
---

# Phase 39: Code Review Report

**Reviewed:** 2026-06-02T12:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Se revisaron los cuatro archivos modificados en esta fase: los dos clientes HTTP never-throws
(`fetchComments`/`fetchLogs`), el helper puro `grepLogs`, y los componentes React
`App.js`/`SessionTable.js` que implementan el modo `overlay`.

La capa de datos (`client.js`, `select.js`) está bien construida: el patrón never-throws es
correcto, `encodeURIComponent` se aplica donde corresponde, y `grepLogs` cumple el contrato
anti-ReDoS con `String.includes`. Los tests de esas capas son sólidos.

El problema principal está en los handlers async de `App.js`: tras el `await fetchComments`/
`await fetchLogs`, el código llama `setMode('overlay')` de forma incondicional, sin verificar si
el modo actual sigue siendo `'list'`. Si el usuario presiona Esc antes de que la respuesta llegue,
el modo vuelve a `'overlay'` al resolverse la promise — comportamiento incorrecto observable en
cualquier entorno donde la latencia no sea cero. La demo con timers Node confirma el defecto.

Adicionalmente, el scroll clamp permite `scrollOffset = lines.length - 1`, lo que deja la última
línea sola en la parte superior del viewport en buffers largos (la ventana de 18 líneas queda
casi vacía). Los tests de scroll (listados en el acceptance criteria del plan) no se implementaron.

---

## Critical Issues

### CR-01: Race condition — Esc antes de que resuelva el fetch re-abre el overlay

**File:** `src/cli/dashboard/App.js:342-345` (handler `c`); `src/cli/dashboard/App.js:371-374` (handler `l`)

**Issue:** Los handlers `c` y `l` son `async`. Tras el `await fetchComments(...)` / `await fetchLogs(...)`,
el código llama `setMode('overlay')` de forma incondicional. Si el usuario presiona Esc mientras la
request está en vuelo — posible cuando el server tiene cualquier latencia no-cero — el Esc handler
ejecuta `setMode('list')`, pero cuando la promise resuelve el handler post-`await` aplica
`setMode('overlay')` de nuevo, forzando al usuario de regreso al overlay que ya cerró.

El patrón se verificó con un script Node (ver análisis): tras un timeout de 50ms, el modo que el
usuario cerró con Esc vuelve a `'overlay'` cuando la promise resuelve. En localhost la ventana es
pequeña pero el defecto es real; en entornos con latencia (tunel SSH, servidor lento) es fácilmente
reproducible.

Mismo defecto en el handler `l` (líneas 371-374).

**Fix:** Leer el modo actual desde una `ref` sincronizada (no desde el closure) y hacer early-return
si ya no es `'list'` después del await:

```js
// Añadir junto a los otros refs (línea ~175 de App.js):
const modeRef = useRef(mode);
useEffect(() => { modeRef.current = mode; }, [mode]);

// En el handler 'c' (y análogo en 'l'), después del await:
const res = await fetchComments(baseUrl, row.task_id, fetchFn);
if (modeRef.current !== 'list') return; // Esc ya cerró; no re-abrir
// ... resto del mapeo + setState
```

Alternativamente, usar un `AbortController` para cancelar la request pendiente cuando Esc se
presiona (patrón más limpio si se quiere cancelación real de red):

```js
// Al abrir: crear un ref con AbortController
const overlayAbortRef = useRef(null);

// En 'c'/'l' handler:
overlayAbortRef.current?.abort();
const ctrl = new AbortController();
overlayAbortRef.current = ctrl;
const res = await fetchComments(baseUrl, row.task_id, fetchFn, ctrl.signal);
if (ctrl.signal.aborted) return; // ya fue cancelado por Esc

// En Esc handler:
overlayAbortRef.current?.abort();
overlayAbortRef.current = null;
setMode('list');
setOverlayKind(null);
```

---

## Warnings

### WR-01: Scroll clamp permite `scrollOffset = lines.length - 1` — última línea sola en el tope del viewport

**File:** `src/cli/dashboard/App.js:272`

**Issue:** El clamp del `downArrow` en modo overlay es:

```js
const max = overlaySnapshot ? Math.max(0, overlaySnapshot.lines.length - 1) : 0;
setScrollOffset((o) => Math.min(max, o + 1));
```

Con `lines.length = 20` y `OVERLAY_VIEWPORT = 18`, `max = 19`. El usuario puede llevar
`scrollOffset` hasta 19, con lo que `SessionTable` renderiza `lines.slice(19, 37)` — solo 1 línea
visible de 18 posibles. Para ver la última línea en la parte inferior del viewport el usuario tendría
que dejar `scrollOffset = 2` (20 − 18). El viewport queda casi vacío cuando se llega al final,
dando una sensación de contenido perdido.

El clamp correcto es `max(0, lines.length - OVERLAY_VIEWPORT)` para que la última ventana llena
sea el tope del scroll:

```js
// App.js línea 272 — reemplazar:
const max = overlaySnapshot
  ? Math.max(0, overlaySnapshot.lines.length - OVERLAY_VIEWPORT)
  : 0;
```

`OVERLAY_VIEWPORT` (18) está definido en `SessionTable.js`; para no duplicar la constante,
exportarla desde `SessionTable.js` o moverla a un módulo compartido, o bien recalcularla con un
valor local equivalente en `App.js`.

### WR-02: Ausencia de tests para el sub-modo de scroll (↑/↓) en el overlay

**File:** `test/dashboard-overlay.test.js`

**Issue:** El plan (39-02-PLAN.md, acceptance criteria Task 1) exige tests de scroll:
`"exits 0 con: ... scroll renderizados"`. El SUMMARY afirma "Self-Check: PASSED", pero ninguno
de los 9 tests existentes ejercita `↑`/`↓` en modo overlay ni verifica que `scrollOffset`
cambia el contenido visible. Esto deja sin cobertura el sub-modo D-06 y el clamp (incluyendo
el over-scroll descrito en WR-01, que pasaría desapercibido).

**Fix:** Añadir tests para el scroll. Ejemplo usando la secuencia arrow keys del harness:

```js
it('↓ en overlay de logs avanza el scrollOffset (contenido se mueve)', async () => {
  const logs = Array.from({ length: 25 }, (_, i) =>
    ({ ts: `t${i}`, level: 'info', msg: `KL-1 line ${i}` })
  );
  const clock = makeFakeClock();
  const fetchFn = makeRouter({ logs: () => okResponse({ logs }) });
  const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
  try {
    await drain();
    stdin.write('l');
    await drain();
    const frameBefore = lastFrame();
    stdin.write('\x1b[B'); // ↓
    await drain();
    const frameAfter = lastFrame();
    // La primera línea visible debe cambiar
    assert.notEqual(frameBefore, frameAfter, 'scroll ↓ debe cambiar el viewport');
  } finally {
    unmount();
  }
});
```

---

## Info

### IN-01: Dependencia circular App.js ↔ SessionTable.js — frágil aunque funcional

**File:** `src/cli/dashboard/SessionTable.js:27-33`, `src/cli/dashboard/App.js:67`

**Issue:** `App.js` importa `SessionTable.js` y `SessionTable.js` importa constantes `OVERLAY_*`
de `App.js`. Es un ciclo ESM. Funciona en runtime porque las constantes string son consumidas
dentro de `renderOverlay()` (no en tiempo de evaluación del módulo), y el SUMMARY lo documenta
como verificado. Sin embargo, el ciclo es frágil: si en una fase futura se añade código de nivel
de módulo en `SessionTable.js` que consuma una exportación de `App.js` antes de que `App.js`
termine de evaluarse, fallará con un error de TDZ (Temporal Dead Zone) difícil de diagnosticar.

**Fix:** Mover las constantes `OVERLAY_*` a un módulo separado `src/cli/dashboard/overlayConst.js`
(o similar) que ni `App.js` ni `SessionTable.js` importen entre sí. Ambos importarían de ese
módulo sin ciclo.

```js
// src/cli/dashboard/overlayConst.js
export const OVERLAY_COMMENTS_EMPTY = 'no comments yet';
export const OVERLAY_COMMENTS_NOT_FOUND = 'task not found';
// ...etc
```

Mientras el ciclo no se rompa, este es un riesgo latente de mantenimiento, no un bug activo.

### IN-02: JSDoc de `SessionTable` desactualizado — mode tipo y `hostError` faltante

**File:** `src/cli/dashboard/SessionTable.js:175, 188`

**Issue:** La anotación `@param {'list'|'filter'} [props.mode]` no incluye `'overlay'`,
que es el valor más relevante para el comportamiento nuevo de Phase 39. Además, `hostError`
se usa en la función (línea 200, 239) pero no tiene `@param` en el JSDoc del componente.

**Fix:**
```js
// Línea 175 — actualizar tipo:
 * @param {'list'|'filter'|'overlay'} [props.mode]
// Añadir antes de overlayKind:
 * @param {string|null} [props.hostError] - Phase 38 D-06: footer-error del WorkspaceHost.
```

### IN-03: Fallback `JSON.stringify(c)` expone el objeto completo de comentario en el TUI

**File:** `src/cli/dashboard/App.js:330`

**Issue:** Cuando un comentario no tiene ninguno de los campos `body`/`text`/`message`, la
proyección hace `JSON.stringify(c)` y muestra el objeto completo en el overlay. Dependiendo del
shape del servidor, esto podría exponer campos internos (IDs, metadatos, tokens de paginación)
directamente en la terminal.

```js
lines = comments.map((c) => {
  const body = c.body ?? c.text ?? c.message;
  if (body == null) return JSON.stringify(c);  // <- expone el objeto completo
  return c.author ? `${c.author}: ${body}` : String(body);
});
```

El riesgo es bajo (dashboard local, datos del propio operador), pero el fallback es innecesariamente
permisivo. Un fallback más seguro sería `'[sin texto]'` o simplemente omitir la entrada.

**Fix:**
```js
if (body == null) return '[sin texto]'; // o: return null; y filtrar nulls después
```

---

_Reviewed: 2026-06-02T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
