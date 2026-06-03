---
phase: 35-datos-cliente-http-polling
reviewed: 2026-05-27T16:35:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/client.js
  - src/cli/dashboard/index.js
  - src/cli/dashboard/usePoll.js
  - test/dashboard-baseurl.test.js
  - test/dashboard-client.test.js
  - test/dashboard-poll.test.js
  - test/dashboard-render.test.js
  - test/dashboard-status-line.test.js
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 35: Code Review Report

**Reviewed:** 2026-05-27T16:35:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Slice de datos del dashboard (cliente HTTP never-throws + loop de polling self-scheduling + cableado de la status line viva). El diseño es sólido: el invariante "no crash" está bien anclado estructuralmente en `client.js` (D-07), el single-flight y el backoff están correctamente implementados en `runPollLoop` (verificado contra el analog `startPolling` de `polling.js`), y el keep-last-good de `App.js` deriva el estado de render de forma pura. Los 26 tests de la suite pasan (incluido el walker de color-isolation).

**Veredicto de las dos desviaciones flagged:**

1. **35-04 — import eager de `DEFAULT_CONFIG` (`index.js:27`):** ACEPTABLE. Verificado que `src/config.js` solo depende de `node:fs`/`node:path`/`node:os` — no arrastra `ink` ni `picocolors`. El walker `test/format-isolation.test.js:199-220` confirma cero picocolors bajo `src/cli/dashboard/**` (pasa). `loadConfig` (el I/O de disco) sigue siendo lazy dentro de `runDashboard`. La color-isolation está preservada y el arranque del CLI no se encarece. La desviación habilita un helper `resolveBaseUrl` puro y testeable — buen tradeoff.

2. **35-03 — prop `now` inyectable en `App` (`App.js:70`):** ACEPTABLE. Amplía la superficie de inyección del componente, pero `now` es un reloj de solo lectura con default `Date.now` y no introduce estado mutable compartido. Es coherente con el resto de props de clock que ya se inyectaban a `usePoll`. La alternativa (timer real de 1s) habría violado D-08 explícitamente. Decisión de testabilidad correcta.

No se hallaron BLOCKERS. Los 3 WARNINGS son robustez (un unhandled-rejection latente que el analog SÍ protege, y dos huecos de validación de shape). Los INFO son higiene.

## Warnings

### WR-01: El kick-off de `runPollLoop` no protege contra rechazos del tick (divergencia del analog)

**File:** `src/cli/dashboard/usePoll.js:150` (y `113-147`)
**Issue:** El kick-off es `Promise.resolve().then(tick)` SIN `.catch(...)`. El analog directo (`src/triggers/polling.js:557-568`) del que se copió este patrón SÍ encadena un `.catch()` que loguea el error del loop precisamente porque el tick puede rechazar. Aquí la divergencia abre dos vías de rechazo no manejado:

- Solo `await fn(localAc.signal)` está dentro del `try/finally` (líneas 122-127). Las llamadas a `onResult(result)` (línea 131) y a `schedule(tick, interval)` (línea 146) quedan FUERA del try. `onResult` es, en runtime, el callback de `App` que dispara varios `setState` (`App.js:101-117`) — si React o un setState lanzara, la promesa del tick rechaza y, al no haber `.catch`, genera un `UnhandledPromiseRejection`.
- El re-arme recursivo (`timer = schedule(tick, interval)`) propaga el mismo riesgo en cada tick subsiguiente, no solo en el kick-off.

Esto contradice el espíritu del invariante "no crash" de TUI-06: el cliente nunca lanza, pero el loop que lo orquesta sí puede emitir un rejection no observado. El analog lo trató como load-bearing.

**Fix:**
```js
// Kick-off inmediato vía microtask (no real timer), igual que polling.js:557-559.
Promise.resolve()
  .then(tick)
  .catch(() => {
    // El loop nunca debe emitir un unhandled rejection (cf. polling.js:560-568).
    // El tick es defensivo, pero onResult/schedule viven fuera del try — belt-and-suspenders.
  });
```
Y/o mover `onResult(result)` dentro de un `try` para que un fallo de render no rompa el loop ni deje un rejection colgando.

### WR-02: `fetchStatus` valida `sessions` pero no `count` — el contador puede renderizar basura

**File:** `src/cli/dashboard/client.js:52` + `src/cli/dashboard/App.js:105`
**Issue:** El cliente solo valida `Array.isArray(data.sessions)` antes de emitir `{ok:true, data}`. En `App.js:105`, `setLastGoodCount(result.data.count ?? result.data.sessions.length)` confía en `data.count`. Si el server (o un proxy/HTML intermedio que devuelva JSON válido con shape distinta) entrega `{ sessions: [], count: "12" }` o `count: null`-pero-presente-como-NaN, el `??` solo cubre `null`/`undefined`: un `count: "muchos"` pasaría tal cual y la status line mostraría `"muchos sessions"` o `"NaN sessions"`. La "shape mínima" valida la rama que NO se usa por defecto para el contador y deja sin validar la que SÍ se usa.

**Fix:** Validar que `count`, cuando esté presente, sea un entero no-negativo, o derivar el contador siempre desde `sessions.length` (que ya está garantizado como array):
```js
// client.js — endurecer la shape mínima:
if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' };
if (data.count != null && !Number.isInteger(data.count)) return { ok: false, error: 'bad shape' };
return { ok: true, data };
```
o, más simple, en App preferir `sessions.length` como fuente canónica (D-01 las declara equivalentes) y usar `count` solo como fallback validado.

### WR-03: `res.json()` sobre un cuerpo `null`/no-objeto produce un `error` engañoso

**File:** `src/cli/dashboard/client.js:51-52`
**Issue:** `const data = await res.json()` puede resolver a `null` (un body literal `null` es JSON válido) o a un primitivo/array. La línea 52 hace `data.sessions`; si `data` es `null`, eso lanza `TypeError: Cannot read properties of null (reading 'sessions')`, que el catch degrada a `{ok:false, error: "Cannot read properties of null..."}`. Funcionalmente no crashea (bien), pero el `error` resultante es un mensaje de runtime interno en vez del `'bad shape'` canónico que el resto del código y los tests esperan para payloads malformados. Inconsistencia de clasificación de error (un body `null` y un body `{count:3}` sin sessions deberían colapsar al mismo `'bad shape'`, pero hoy dan errores distintos).

**Fix:** Guardar que `data` sea un objeto antes de leer `.sessions`:
```js
const data = await res.json();
if (data == null || typeof data !== 'object' || !Array.isArray(data.sessions)) {
  return { ok: false, error: 'bad shape' };
}
return { ok: true, data };
```

## Info

### IN-01: `lastError` es estado muerto (escrito, nunca leído)

**File:** `src/cli/dashboard/App.js:96, 111`
**Issue:** `const [lastError, setLastError] = useState(...)` está marcado con `// eslint-disable-next-line no-unused-vars` porque `lastError` se setea (`setLastError(result.error ?? null)` / `setLastError(null)`) pero NUNCA se lee para render ni para nada. Es un `useState` completo (con su re-render asociado en cada cambio) que no produce salida observable. O bien se cablea a la UI (mostrar el `error` en el banner stale sería útil para el operador), o se elimina para reducir ruido y un re-render innecesario.
**Fix:** Eliminar el par `lastError`/`setLastError` si no se va a renderizar, o usarlo en el nodo stale (`...retrying… (${lastError})`). El comentario eslint-disable delata que es deuda consciente — conviene cerrarla en lugar de silenciarla.

### IN-02: Comentario de cabecera de `usePoll.js` describe un teardown más simple del que el código implementa

**File:** `src/cli/dashboard/usePoll.js:24`
**Issue:** El comentario dice "Sin tick-id guard — el cancelled flag + cancel + abort bastan para no hacer setState tras unmount". Es correcto para el camino feliz, pero la afirmación "bastan" depende de que `onResult` esté protegido por el guard `if (cancelled) return` (línea 129), lo cual es cierto SOLO porque no hay `await` entre ese guard y el `onResult`. Es una invariante frágil no documentada: si un futuro mantenedor inserta un `await` entre la línea 129 y la 131, el guard deja de cubrir y reaparece el setState-tras-unmount. Vale la pena un comentario inline en la línea 129 advirtiendo "no introducir await entre este guard y onResult".
**Fix:** Añadir comentario de invariante en `usePoll.js:129`:
```js
if (cancelled) return; // no reportar ni re-armar si se desmontó durante el await.
// INVARIANTE: no insertar ningún `await` entre este guard y onResult — rompería la
// garantía de "no setState tras unmount" (el guard es síncrono respecto al cleanup).
```

### IN-03: Número mágico `5000` (timeout de abort) duplicado entre constante y comentarios

**File:** `src/cli/dashboard/usePoll.js:51, 119`
**Issue:** `TICK_TIMEOUT_MS = 5000` está bien extraído como constante y se usa en la línea 119 (`scheduleTimeout(() => localAc.abort(), TICK_TIMEOUT_MS)`). No es un magic number en el código — bien. La nota es menor: el valor `5000`/`5s` aparece hardcodeado en varios comentarios y JSDoc (`@property ... timeout de abort (5s, D-05)`, líneas 70, 96-97) que quedarían desincronizados si la constante cambiara. Higiene de docs, sin impacto funcional.
**Fix:** Opcional — referir a `TICK_TIMEOUT_MS` en el texto en vez de repetir "5s", o aceptar el riesgo (cambio improbable).

### IN-04: `App.js:140` — el fallback `(lastAttemptAt ?? lastGoodAt)` enmascara un estado imposible en vez de afirmarlo

**File:** `src/cli/dashboard/App.js:140`
**Issue:** `const ageSec = Math.round(((lastAttemptAt ?? lastGoodAt) - lastGoodAt) / 1000)`. Para llegar a esta rama se requiere `lastGoodAt != null` y `!connected`; dado que `setLastAttemptAt(t)` se ejecuta en CADA `onResult` (éxito o fallo) y `lastGoodAt` solo se setea dentro de un `onResult` exitoso, es imposible tener `lastGoodAt != null && lastAttemptAt == null`. El `?? lastGoodAt` es, por tanto, defensa contra un estado inalcanzable que produce silenciosamente `ageSec = 0` si la invariante se rompiera, en vez de fallar visible. No es un bug (el resultado `0s ago` es inocuo), pero es ruido que sugiere una incertidumbre sobre el modelo de estado que no existe.
**Fix:** Opcional — dejar como está (defensa barata e inocua) o simplificar a `lastAttemptAt - lastGoodAt` confiando en la invariante. No accionable como defecto.

---

_Reviewed: 2026-05-27T16:35:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
