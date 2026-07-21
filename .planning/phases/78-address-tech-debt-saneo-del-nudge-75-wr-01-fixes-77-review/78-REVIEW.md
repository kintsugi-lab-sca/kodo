---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
reviewed: 2026-07-21T23:42:49Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/hooks/stop.js
  - src/host/cmux.js
  - src/session/manager.js
  - test/manager.test.js
  - test/session/group-resolve.test.js
  - test/stop.test.js
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 78: Informe de Code Review

**Reviewed:** 2026-07-21T23:42:49Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Revisión adversarial de los cambios de la Phase 78 (tech debt): saneo de los 3 campos LLM
del nudge del orquestador vía `stripControlChars` en `buildStopNudgeText` (`src/hooks/stop.js`)
y hardening de `deriveExpectedGroupName`/`resolveWorkspaceGroup`/`launchWorkItem`
(`src/session/manager.js`), más JSDoc en `src/host/cmux.js` y el endurecimiento de tests.

El núcleo de los cambios de la fase es **correcto y bien probado**. `stripControlChars`
es pura, coacciona con `String(s)` (never-throws sobre `null`/`undefined`/no-string), y el
guard `typeof next === 'string' && next.length > 0` protege la no-regresión byte-idéntica
(D-09); los goldens de los tres modos se verifican explícitamente. Las funciones puras de
resolución de grupo (`deriveExpectedGroupName`, `resolveWorkspaceGroup`,
`newWorkspaceWithGroupFallback`) son defensivas, con guardas de entrada degenerada y
validación de shape canónico del ref (`/^workspace_group:\d+$/`) que bloquea la forja de
líneas de log.

El hallazgo principal es una **omisión de cobertura**: la Phase 78 saneó el nudge
(`buildStopNudgeText`) pero dejó SIN sanear un segundo path paralelo en el MISMO archivo
(`launchWorkItem`) que envía `task.ref`/`task.title` al terminal del orquestador vía
`host._legacy.send` — exactamente el mismo modelo de amenaza (inyección de escapes de
terminal desde datos de provider no confiables) que la fase declara estar cerrando.

## Warnings

### WR-01: El nudge de "Nueva sesión lanzada" al orquestador NO sanea `task.ref`/`task.title` (mismo vector que 75/WR-01, path paralelo sin cubrir)

**File:** `src/session/manager.js:516-524`
**Issue:**
La Phase 78 (T-78-01) saneó los campos LLM del nudge en `buildStopNudgeText` porque
"`task_ref/summary` cruzan de datos no confiables (LLM / state.json hand-editable) al
terminal del orquestador vía `cmuxClient.send`" (comentario en `stop.js:50-56`). Pero
`launchWorkItem` tiene un SEGUNDO envío al terminal del orquestador que interpola los
mismos campos de provider SIN pasar por `stripControlChars`:

```js
const workspaces = await host._legacy.listWorkspaces();
const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
if (orchMatch) {
  await host._legacy.send({
    workspace: orchMatch[1],
    text: `Nueva sesión lanzada: ${task.ref} (${task.title}) en ${workspaceRef}. Path: ${projectPath}\\n`,
  });
}
```

`task.ref` y `task.title` provienen de `provider.getTask()` (Plane/GitHub) — la misma
fuente no confiable que la fase declara peligrosa. Un título de tarea con una secuencia
CSI/OSC (p.ej. OSC-52 = escritura al portapapeles del operador, o CSI para manipular la
pantalla) se inyecta directo al terminal del orquestador vía `send` (keystrokes crudos, sin
sanear en el passthrough de `cmux/client.js`). El fix de la fase queda incompleto: cierra el
carril del nudge de cierre pero deja abierto el carril del nudge de lanzamiento, que tiene
idéntico impacto sobre el mismo terminal.

**Fix:** Aplicar `stripControlChars` a los tres campos interpolados, en simetría con
`buildStopNudgeText` (importar el helper ya usado en `stop.js`):

```js
import { stripControlChars } from '../cli/format.js';
// ...
text: `Nueva sesión lanzada: ${stripControlChars(task.ref)} (${stripControlChars(task.title)}) en ${workspaceRef}. Path: ${stripControlChars(projectPath)}\\n`,
```

## Info

### IN-01: Shadowing de `result` en `runStopHook`

**File:** `src/hooks/stop.js:212`
**Issue:** El `const result = markSessionStatus(...)` (línea 212) shadowea el `let result =
findSessionFn(...)` del scope externo (línea 156). El outer `result` ya no se usa tras el
destructuring de la línea 180, así que no hay bug funcional, pero el reuso del nombre dentro
de un bloque anidado es confuso y dispararía `no-shadow` en lint.
**Fix:** Renombrar la variable interna a algo específico, p.ej. `const markResult =
markSessionStatus(...)` y `if (!markResult?.ok)`.

### IN-02: `stripControlChars` preserva `\n`/`\t` crudos — un salto de línea embebido en `task_ref`/`summary`/`next` llega intacto al `send`

**File:** `src/cli/format.js:80-87` (consumido por `src/hooks/stop.js:56,79`)
**Issue:** `stripControlChars` neutraliza CSI/OSC/C0/C1/DEL/CR pero PRESERVA `\t` (`\x09`) y
`\n` (`\x0a`) deliberadamente. En el contexto del nudge, el texto se envía vía `cmux send`,
que interpreta `\n` como Enter. Un `task.title`/`summary` con un salto de línea real
(inhabitual pero posible en datos de provider hand-editables) partiría el nudge en dos
"comandos" tecleados en el terminal del orquestador. No es el vector de escape que la fase
ataca, y el riesgo es bajo (los títulos rara vez contienen `\n`), pero el saneo no lo
contempla para el contexto de una sola línea.
**Fix:** Si el nudge debe ser mono-línea, colapsar whitespace vertical en el punto de
composición (p.ej. `.replace(/[\r\n]+/g, ' ')` tras `stripControlChars`), o documentar
explícitamente que `\n` es aceptable en este carril.

### IN-03: Título de test contradictorio con su propia aserción (comentario obsoleto tras el fix IN-01 de trim)

**File:** `test/session/group-resolve.test.js:145`
**Issue:** El nombre del test dice `"ref = 'KODO-9 ' (trailing space) → 'KODO' (hoy devuelve
'KODO-9 ' porque /-\d+$/ no matchea con el espacio)"`, pero la aserción correctamente espera
`'KODO'` (el comportamiento nuevo tras el trim IN-01). El paréntesis "(hoy devuelve 'KODO-9
')" describe el comportamiento VIEJO/roto y quedó como residuo tras el fix, contradiciendo lo
que el test realmente valida. La aserción es correcta; solo el título engaña a quien lo lea.
**Fix:** Borrar el paréntesis obsoleto del título: `"ref = 'KODO-9 ' (trailing space) →
'KODO' (el trim IN-01 recupera el grupo)"`.

---

_Reviewed: 2026-07-21T23:42:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
