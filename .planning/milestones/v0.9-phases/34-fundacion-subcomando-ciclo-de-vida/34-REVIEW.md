---
phase: 34-fundacion-subcomando-ciclo-de-vida
reviewed: 2026-05-27T08:33:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/cli.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/index.js
  - test/dashboard-non-tty.test.js
  - test/dashboard-render.test.js
  - test/format-isolation.test.js
  - package.json
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 34: Code Review Report

**Reviewed:** 2026-05-27T08:33:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Se revisó la fundación del subcomando `kodo dashboard` (ink@6 + react@19) con foco en los puntos
señalados: corrección del ciclo de vida / raw-mode, orden del guard non-TTY, fugas de listeners y
si el test `dashboard-render.test.js` se debilitó para pasar.

Conclusiones sobre los focos prioritarios:

- **Test `dashboard-render.test.js` NO fue debilitado.** El `git log` del rango confirma que el
  archivo se creó completo en el commit `9e38d57` (Wave 0, antes de implementar) y no recibió
  ediciones posteriores. La aserción q→exit sigue siendo de comportamiento observable (compara el
  conteo de frames de unmount tras `q` contra una tecla ignorada `x`). Una regresión a
  `process.exit` o un binding roto eliminaría el frame extra y el test fallaría. La aserción es
  significativa. Detalle menor de robustez en IN-03.
- **Orden del guard non-TTY: correcto** (D-03/D-04). Corre antes de cualquier `await import('ink')`
  y antes de `render()`. Usa `process.exit(1)` porque aún no hay terminal de ink que restaurar.
- **SIGTERM / fuga de listeners: sin fuga.** Se usa `process.once('SIGTERM', ...)` y se hace
  `removeListener` tras `waitUntilExit()`. En el path de SIGTERM el `once` ya se auto-removió
  (el `removeListener` posterior es no-op inofensivo); en el path de `q`/Ctrl-C el `removeListener`
  limpia correctamente el listener pendiente. No hay acumulación entre invocaciones.

El defecto de mayor impacto encontrado es un crash potencial en la resolución de `baseUrl` cuando el
config carece de la sección `server` (configs v1 migradas), detallado en WR-01.

## Warnings

### WR-01: `loadConfig().server.port` puede lanzar TypeError con configs v1 migrados

**File:** `src/cli/dashboard/index.js:49`
**Issue:** La resolución del default de `baseUrl` accede a `loadConfig().server.port` sin guardia.
`loadConfig()` solo aplica el shallow-merge con `DEFAULT_CONFIG` cuando el archivo NO existe o el
parse falla (`src/config.js:122,127`). Para un config existente y válido, devuelve el objeto parseado
(o el resultado de `migrateConfig`) tal cual. `migrateConfig` (`src/config.js:82-102`) reconstruye el
objeto desde cero y **NO incluye la clave `server`**, por lo que un usuario que venía del schema v1
tendrá un config persistido sin `server`. En ese caso `loadConfig().server` es `undefined` y
`.port` lanza `TypeError: Cannot read properties of undefined (reading 'port')`. Como el subcomando
`dashboard` no pasa por `ensureConfig()` (D-07), el crash ocurre justo después del guard non-TTY, con
la terminal ya en modo interactivo pero antes del `render()`, dejando un stack trace crudo en pantalla.

Nota: el mismo patrón sin guardia existe en `src/server.js:335` y `src/session/health.js:73`, así que
el riesgo es preexistente y compartido — no es introducido por esta fase. Pero este es un path de
entrada nuevo y conviene blindarlo.
**Fix:**
```js
// Optional chaining + fallback al default conocido (9090):
const { loadConfig, DEFAULT_CONFIG } = await import('../../config.js');
const cfg = loadConfig();
const port = cfg.server?.port ?? DEFAULT_CONFIG.server.port;
const baseUrl = url ?? `http://localhost:${port}`;
```

### WR-02: el guard non-TTY ignora `deps.stdout` para escribir y salir, rompiendo su propia DI

**File:** `src/cli/dashboard/index.js:42-45`
**Issue:** La función acepta `deps.stdout`/`deps.stdin` inyectables "para testabilidad" (JSDoc
líneas 31-34) y el guard LEE de los inyectados (`stdout.isTTY`, `stdin.isTTY`). Pero al rechazar,
escribe a `process.stderr` global y llama `process.exit(1)` global — ignorando por completo la
inyección. Resultado: el camino más importante de testear unitariamente (el guard) NO es testeable
vía DI; el único test que lo cubre es el de subproceso (`dashboard-non-tty.test.js`), que es mucho
más lento y frágil. La DI declarada es engañosa: sugiere una capacidad de aislamiento que no existe.
**Fix:** O bien aceptar también `stderr`/`exit` inyectables y usarlos, o eliminar la fachada de DI y
documentar que el guard depende de globales por diseño. Mínimo consistente:
```js
const { stdout = process.stdout, stdin = process.stdin,
        stderr = process.stderr, exit = process.exit, url } = deps;
if (!stdout.isTTY || !stdin.isTTY) {
  stderr.write(NON_TTY_MSG + '\n');
  exit(1);
}
```

### WR-03: SIGTERM no fija un exit code distinto de 0 — termina como salida limpia

**File:** `src/cli/dashboard/index.js:63-73`
**Issue:** En el path SIGTERM, `onSigterm` llama `app.unmount()` (sin error), `waitUntilExit()`
resuelve normalmente y la ejecución cae en `process.exitCode = 0`. Un proceso terminado por SIGTERM
reportando exit 0 es semánticamente incorrecto: rompe a cualquier supervisor (systemd, un wrapper de
shell, `kodo polling`/orquestador) que distinga "salió solo" de "fue terminado". La convención POSIX
para terminación por señal es 128+15 = 143. D-10 especifica el cleanup de terminal vía `unmount()`,
pero no exige (ni prohíbe) exit 0; aquí el código colapsa silenciosamente ambos casos.
**Fix:** marcar el origen de la salida y fijar el code acorde:
```js
let viaSigterm = false;
const onSigterm = () => { viaSigterm = true; app.unmount(); };
process.once('SIGTERM', onSigterm);
await app.waitUntilExit();
process.removeListener('SIGTERM', onSigterm);
process.exitCode = viaSigterm ? 143 : 0;
```
Si por contrato de fase la salida 0 es deliberada incluso bajo SIGTERM, dejarlo documentado
explícitamente en el código (un comentario "// exit 0 intencional bajo SIGTERM, ver D-10") para que
no se lea como descuido.

## Info

### IN-01: el parámetro `baseUrl` de `App` se recibe pero no se consume — sin marca de "intencional"

**File:** `src/cli/dashboard/App.js:36`
**Issue:** `App({ baseUrl })` desestructura `baseUrl` y nunca lo usa (el cuerpo es el placeholder
estático `starting…`, D-02). Esto es correcto por diseño de fase, pero un linter (`no-unused-vars`)
lo marcaría y un lector futuro no distingue "olvido" de "reservado para Phase 36". El JSDoc lo
explica, pero el binding queda inerte.
**Fix:** o renombrar a `_baseUrl` (convención de "intencionalmente no usado"), o añadir un comentario
inline `// baseUrl: reservado Phase 36 (datos reales), no consumido en Phase 34`. Trivial.

### IN-02: `index.js` importa `createElement` de forma redundante respecto a `App.js`

**File:** `src/cli/dashboard/index.js:54,57`
**Issue:** No es un bug, pero `index.js` hace `const { createElement } = await import('react')`
únicamente para construir `createElement(App, { baseUrl })`. Es correcto y necesario; lo señalo solo
para confirmar que el lazy-import de react/ink/App está bien aislado al path del subcomando (objetivo
de arranque ligero del CLI — verificado, sin import estático de ink fuera del subcomando).
**Fix:** ninguno requerido; observación de validación positiva del diseño lazy-import.

### IN-03: el test q→exit depende de un `setTimeout(80)` fijo — flaky bajo carga de CI

**File:** `test/dashboard-render.test.js:49,71-75`
**Issue:** La aserción de unmount se apoya en `tick()` = `setTimeout(r, 80)` para dar tiempo a ink a
procesar el keystroke y emitir el frame de desmonte. 80 ms es un valor mágico; en CI cargado el
desmonte podría no haberse propagado y el test fallaría intermitentemente (falso negativo). La
aserción en sí es válida y no fue debilitada (ver Summary), pero el timing fijo es frágil.
**Fix:** reemplazar el sleep fijo por un poll con deadline (p. ej. esperar hasta que
`quitting.frames.length > beforeQuit` con timeout de ~1s y reintentos cortos), o usar el
`waitUntilExit` real si se migra a `render()` de ink. Bajo el harness actual, un poll-until con
deadline es la mejora mínima.

### IN-04: `version` en package.json (0.1.0) inconsistente con el milestone v0.9 en curso

**File:** `package.json:3`
**Issue:** `"version": "0.1.0"` mientras el contexto del proyecto y los commits hablan de milestones
v0.5–v0.9. `kodo --version` (cli.js:15 lee `pkg.version`) reportaría `0.1.0`, lo que confunde en
soporte/diagnóstico. Fuera del alcance estricto de Phase 34, pero observable en un archivo tocado por
esta fase.
**Fix:** alinear `version` con el milestone real antes de cualquier release/tag. No bloquea Phase 34.

---

_Reviewed: 2026-05-27T08:33:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
