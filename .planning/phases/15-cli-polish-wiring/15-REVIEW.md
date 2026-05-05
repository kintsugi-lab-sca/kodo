---
phase: 15-cli-polish-wiring
reviewed: 2026-05-05T14:58:18Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/logger.js
  - src/logs/reader.js
  - src/check.js
  - src/cli/gsd-inspect.js
  - src/cli/gsd-verify.js
  - src/gsd/verify.js
  - test/logger.test.js
  - test/logs-reader.test.js
  - test/logger-exports.test.js
  - test/check.test.js
  - test/gsd-inspect-cli.test.js
  - test/gsd-verify-integration.test.js
  - test/gsd-verify-cli-handler.test.js
  - test/format-isolation.test.js
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-05-05T14:58:18Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

El cableado de Phase 15 (5 callsites enrutados al helper `src/cli/format.js`) está correctamente implementado y respeta los invariantes críticos enunciados en el prompt:

- **LOG-12**: `src/cli/format.js` no importa `src/logger.js` (verificado por test/format-isolation.test.js#82-95 con walker transitivo de imports). El helper sólo importa `picocolors`.
- **D-07 single-source-of-color**: el test source-hygiene confirma que sólo `src/cli/format.js` importa `picocolors`. Los 5 callsites de Phase 15 importan exclusivamente desde `format.js`.
- **D-19 / Pitfall #6 Opción A**: exit codes de `gsd-verify` (0/1/2) y `gsd-inspect` (0/1/2) cubiertos por tests dedicados; `Exit: N` en stdout coincide byte-a-byte con el `return` del handler en human mode (D-13). Suprimido en `--json`.
- **Pitfall #2 Phase 10**: `result.plane.comment_body` se expone como string ya generado por `verify.js`; el CLI consume un slice — no re-renderiza. Tests T24/T25 (gsd-verify-integration) garantizan determinismo byte-a-byte entre invocaciones y ante Plane unreachable. `REND1` (gsd-verify-cli-handler) bloquea regresiones por re-import de `renderComment`.
- **SC#1 / SC#2**: `formatLine` con `useColor=false` mantiene shape pre-Phase-15 (`HH:MM:SS LEVEL [comp] msg`) — verificado golden-byte en `logger.test.js#103-139`. `--json` en `logs/reader.js` hace bypass total del formatter — verificado en `logs-reader.test.js#103-140` incluso con `FORCE_COLOR=1` + `isTTY=true`.

Los hallazgos son de severidad media a baja: dos warnings sobre la robustez del clasificador transient/internal y la creación per-call del formatter en `formatLine`, más cinco notas de calidad/consistencia.

## Warnings

### WR-01: Regex `TRANSIENT_PATTERNS` puede clasificar errores internos como transient

**File:** `src/cli/gsd-verify.js:41`
**Issue:** El patrón `/provider.*fetch|fetch.*failed|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i` es lo bastante laxo como para producir falsos positivos. Mensajes que mencionen las palabras `network`, `fetch`, `ECONNREFUSED`, etc. en cualquier parte del string (incluso como contexto descriptivo, no como causa real) son clasificados como exit 2 (transient/retryable). Ejemplos de colisión real:

- `"network config invalid for provider plane"` → coincide con `network` → exit 2 cuando debería ser exit 1.
- `"failed to write fetch cache to disk"` → coincide con `fetch.*failed` → exit 2.
- Cualquier `Error: <wrapping message> ECONNREFUSED 127.0.0.1`, donde la causa raíz es interna (cliente Plane mal configurado vs red caída): difícil distinguir.

Operadores que usan retry-on-2 (caso de uso explícito en el comentario de la función) gastan ciclos en errores no recuperables.

**Fix:** Anclar el regex a comienzo de string o usar prefijos discriminantes:
```js
// Opción A — prefijar con códigos discriminantes inequívocos:
const TRANSIENT_PATTERNS = /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo)\b|provider fetch failed/i;

// Opción B — distinguir por tipo de error (preferible si el provider lanza errores tagueados):
function isTransient(err) {
  if (err && typeof err === 'object' && err.code) {
    return ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code);
  }
  return /provider fetch failed|getaddrinfo (ENOTFOUND|EAI_AGAIN)/i.test(String(err?.message || err));
}
```

Idealmente el provider debería tagear los errores con `err.code` o subclase, y la CLI clasifica por tipo, no por substring matching del `.message`.

---

### WR-02: `formatLine` instancia un `createFormatter` nuevo en cada invocación con `useColor=true`

**File:** `src/logger.js:126`
**Issue:** En la rama TTY+color, cada llamada a `formatLine` ejecuta `createFormatter({ isTTY: true }, {})`, que a su vez llama `_resolveUseColor` y `createColors(useColor)` de picocolors. Esto se invoca en `maybeMirrorToStderr` para cada `warn`/`error`/`info`/`debug` que mirroreado. En sesiones largas con bursts de logs (e.g., dispatcher con múltiples sesiones reportando), son cientos/miles de allocaciones de objetos formatter idénticos. Adicionalmente, hay un riesgo sutil: el comentario de líneas 119-125 explica que se inyecta `{ isTTY: true }` y `{}` para que el resultado sea determinista — pero el código reasume implícitamente que el resultado de `_resolveUseColor` es `true`. Si alguien refactoriza la precedencia en `format.js` (por ejemplo, añade soporte para una nueva env var sensible al `process.env` real), ese contrato se rompe silenciosamente porque `formatLine` pasa `{}` y NO el `process.env` real.

Aunque performance está fuera del scope v1, este es también un *correctness footgun*: el contrato "useColor pasado por el caller equivale a useColor del formatter interno" es frágil porque depende de que `_resolveUseColor` siga interpretando `{ isTTY: true }, {}` como `true`.

**Fix:** Cachear el formatter por logger (no por llamada) y resolver el level method con un dispatch table inmutable:
```js
// En createLogger(...), cerca de la línea 263:
const useColor = _resolveUseColor(process.stderr);
const fmt = useColor ? createFormatter({ isTTY: true }, {}) : null;
const levelMethods = fmt
  ? { debug: fmt.debug, info: fmt.info, warn: fmt.warn, error: fmt.error }
  : null;

// Pasar `fmt`/`levelMethods` a formatLine (o exportar formatLine como factory bound):
function maybeMirrorToStderr(level, record) {
  // ...
  process.stderr.write(formatLine(record, { useColor, fmt }) + '\n');
}

// En formatLine, recibir fmt opcionalmente:
export function formatLine(record, { useColor, fmt }) {
  if (!useColor) { /* rama plana — sin cambios */ }
  const f = fmt || createFormatter({ isTTY: true }, {});
  // ... usar f en lugar del fmt local.
}
```

Esto aporta dos cosas: (1) elimina la creación per-call, (2) hace explícito que `formatLine` puede recibir el formatter ya construido por el caller — el "source unification" de useColor se cierra al 100% en el call-site (logger / reader), no se duplica dentro de `formatLine`.

## Info

### IN-01: Constantes ANSI muertas en `src/logger.js`

**File:** `src/logger.js:43-53`
**Issue:** Tras Phase 15, la rama TTY de `formatLine` usa `createFormatter`. Las constantes `ANSI_GRAY` y `ANSI_CYAN` ya no se referencian fuera de `COLOR_BY_LEVEL`. `ANSI_YELLOW` tampoco se referencia fuera de ese map. Sólo `ANSI_RED` sigue vivo (usado en línea 312 para el error de write-failed) y `ANSI_RESET` (usado en línea 312 + exportado para backwards-compat). `COLOR_BY_LEVEL` permanece sólo porque `test/logger-exports.test.js#17-23` aserta que está exportado.

Esta es deuda técnica conocida: el test todavía protege la export, pero el map ya no es la fuente de color en runtime — es decorativo. La doc en `format.js:159` lo reconoce: "mapping mirrors src/logger.js:37 COLOR_BY_LEVEL" — el mapping ahora vive en dos lugares (la duplicación que D-07 supuestamente eliminó persiste en forma de constante exportada).

**Fix:** Bien (a) eliminar `COLOR_BY_LEVEL` y `ANSI_GRAY`/`ANSI_CYAN`/`ANSI_YELLOW`, ajustar el test de exports, y dejar sólo `ANSI_RED` + `ANSI_RESET` para el error path; (b) o conservarlos sólo si hay consumidores externos confirmados (no detectados en este review). Recomendado: deprecar el export en JSDoc y plan de eliminación en próxima fase.

---

### IN-02: Inconsistencia en error path de `writeNdjson` — usa raw ANSI

**File:** `src/logger.js:312`
**Issue:** La línea `process.stderr.write(`${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n`);` es la ÚNICA referencia a raw ANSI en el código de runtime de Phase 15 (excluyendo la rama plana de `formatLine` que no usa ANSI). Por D-07 single-source-of-color, debería ir a través de `createFormatter`.

Sin embargo, este es un fallback ejecutado cuando `appendFileSync` falla (filesystem corrupto, permisos, disk full). En ese contexto, levantar otra dependencia (`createFormatter`) puede fallar también. El raw ANSI es defensa en profundidad.

**Fix:** Documentar el porqué del raw ANSI en este sitio (un comentario), o usar el formatter ya cacheado (si se aplica WR-02) y asumir que si falló el filesystem el formatter probablemente sigue vivo:
```js
// L312 — comentario sugerido:
// Raw ANSI deliberado: estamos en el error path del write a disco; minimizamos
// dependencias. Si createFormatter fallara aquí, perderíamos también el aviso.
process.stderr.write(`${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n`);
```

---

### IN-03: `runCheck()` y `checkPendingTasks` instancian dos formatters distintos

**File:** `src/check.js:30,63`
**Issue:** `runCheck()` crea `fmt = createFormatter(process.stdout)` en línea 63 y luego invoca `checkPendingTasks({...})` en líneas 95-99 sin pasar `formatterFn`. Dentro de `checkPendingTasks` (línea 30) se construye un segundo formatter por defecto. Funcionalmente equivalente, pero inconsistente con la DI de Phase 15 (Pattern: caller injecta el formatter).

**Fix:** Pasar el formatter local desde `runCheck` para mantener una sola instancia por ciclo:
```js
// src/check.js:95-99
const pendingResult = await checkPendingTasks({
  config,
  runningCount: running.length,
  getProviderFn: getProvider,
  formatterFn: () => fmt,  // ← reusa la instancia local de runCheck
});
```

---

### IN-04: Comentario "lazy" en `gsd-verify.js:62-64` es ligeramente impreciso

**File:** `src/cli/gsd-verify.js:62-64`
**Issue:** El comentario dice *"Resolvemos lazy para evitar tocar process.stdout durante el import"*. Estrictamente, no es lazy en el sentido tradicional — el formatter se construye inmediatamente al entrar a `runGsdVerifyCli` (línea 64: `(deps.formatterFn || (() => createFormatter(process.stdout)))()`), no diferido hasta el primer write. El beneficio real es evitar la ejecución durante *module load time* (top-level), no durante la llamada.

**Fix:** Reemplazar "lazy" por "deferred to call-time":
```js
// Plan 15-04 Task 2 (DX-04): formatterFn DI siguiendo el molde de
// runVerifyFn/writeFn/errFn. La construcción del formatter se difiere a
// call-time (no module-load) para evitar tocar process.stdout durante el
// import — relevante en tests que stuban isTTY antes de cargar el módulo.
const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
```

---

### IN-05: `gsd inspect` con verdict bootstrap y roadmap=FAIL exit 0 puede sorprender

**File:** `src/cli/gsd-inspect.js:155-167`
**Issue:** El test `'Test 4: roadmap missing → roadmap section shows ✗ FAIL'` (gsd-inspect-cli.test.js#183-201) confirma el comportamiento intencional: cuando `verdict.action === 'bootstrap'` y `hasPlanning === false`, la sección `roadmap` muestra `✗ FAIL` pero el exitCode global es 0. La semántica visual es "una de cuatro secciones falló pero el handler salió OK".

Esto puede confundir a operadores acostumbrados a "exit code refleja salud agregada". Es válido en este contexto (bootstrap implica que `.planning/PROJECT.md` aún no existe — eso es el estado esperado, no un error), pero no es obvio sin leer el plan.

**Fix:** Añadir comentario explicativo en `renderHuman` o en el header de docstring de `runGsdInspect`:
```js
// renderHuman, antes de la sección roadmap (línea 157):
// roadmap puede mostrar FAIL aunque exitCode=0: en verdict bootstrap, la
// ausencia de .planning/PROJECT.md es el estado esperado (será creado por
// /gsd-new-project). El FAIL es informativo, no un fallo del gate.
write(`roadmap: ${hasPlanning ? fmt.ok('OK') : fmt.fail('FAIL')}\n`);
```

---

_Reviewed: 2026-05-05T14:58:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
