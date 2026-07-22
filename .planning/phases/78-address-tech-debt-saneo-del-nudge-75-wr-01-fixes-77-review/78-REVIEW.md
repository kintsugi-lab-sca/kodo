---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
reviewed: 2026-07-22T07:54:38Z
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
  info: 5
  total: 6
status: issues_found
---

# Phase 78: Informe de Code Review (2º pase — post-fix)

**Reviewed:** 2026-07-22T07:54:38Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Segundo pase de revisión de la Phase 78 tras el commit de corrección `17a706c`.

**Veredicto del fix WR-01 (VERIFICADO — correcto y completo para la amenaza identificada):**
El commit `17a706c` envuelve `task.ref`, `task.title` y `projectPath` con `stripControlChars`
antes de interpolarlos en el texto que `launchWorkItem` teclea al terminal del orquestador vía
`host._legacy.send` (`src/session/manager.js:523`). El import se añade desde el carril canónico
`../cli/format.js`, simétrico con `buildStopNudgeText`. La regresión-guard por inspección de
fuente en `test/manager.test.js:828-850` cubre tanto la presencia del saneo como la ausencia del
patrón crudo. `workspaceRef` (el otro campo interpolado) proviene de cmux (`workspace:N`, dato
confiable) y no requiere saneo. **Los únicos carriles de keystroke con contenido no confiable en
`launchWorkItem` quedan cubiertos**: el `send` de la línea 507 teclea `claudeCmd`, que por diseño
solo referencia el prompt vía `"$(cat …)"` (ASCII, sin contenido de tarea inline).

**Re-evaluación de los 3 Info del 1er pase:** los tres SIGUEN PRESENTES en el código actual y se
arrastran con su numeración original (IN-01, IN-02, IN-03).

**Hallazgo nuevo del 2º pase:** la reutilización del saneador del carril de *render* en el carril
de *keystroke* deja un residuo de inyección por salto de línea (`\n` → Enter). Ver WR-02. No es un
defecto introducido por `17a706c` per se, sino una incompletitud que el propio fix hace más
visible al aplicar `stripControlChars` al carril `send`.

Ningún BLOCKER. El fix es apto para shipear; WR-02 es una mejora de robustez recomendada.

## Narrative Findings (AI reviewer)

## Warnings

### WR-02: `stripControlChars` preserva `\n` — que en el carril `cmux send` es una pulsación Enter (residuo de inyección al orquestador)

**File:** `src/cli/format.js:73-86` (helper) · `src/session/manager.js:523` · `src/hooks/stop.js:56,79`
**Issue:**
`stripControlChars` fue diseñado para el carril de **render** del dashboard (Ink), donde preservar
`\n`/`\t` es deliberado e inofensivo (docstring en `format.js:73-74`). El fix WR-01 lo reutiliza
ahora en el carril de **keystroke** (`host._legacy.send`), donde la semántica de `\n` es distinta:
el propio código documenta que *"`cmux send` inyecta el comando como PULSACIONES de teclado, e
interpreta `\n`/`\r`/`\t` como Enter/Tab"* (`manager.js:575-577`, comentarios de `stop.js`).
Consecuencia:

- `stripControlChars` elimina CR (`\x0d`) pero **conserva LF (`\x0a`)** y **no toca** la secuencia
  literal de dos caracteres `\` + `n` (0x5C 0x6E, ASCII imprimible).
- Un campo no confiable (`task.title`, `task.ref`, `projectPath`, o el `next` LLM-persistido) que
  contenga un salto de línea real O el texto literal `\n` sobrevive al saneo y, al teclearse,
  produce un **Enter** en el terminal del orquestador (una sesión Claude autónoma). Eso permite
  enviar prematuramente el mensaje parcial e inyectar una línea adicional bajo control del atacante
  en el input del orquestador — exactamente el tipo de efecto de control que WR-01 pretendía
  neutralizar.

El fix reduce la superficie (CSI/OSC/C0/C1/DEL/CR quedan inertes) pero no la cierra para el vector
newline. Explotabilidad realista: baja-media (un título de tarea Plane o un `NEXT:` con `\n`
embebido), pero el orquestador ACTÚA sobre estos nudges, así que una inyección de salto de línea
tiene efecto observable.

**Fix:** introducir una variante específica del carril de keystroke que además elimine `\n`
(y `\t`), en lugar de reutilizar el saneador de render. P. ej.:

```js
// src/cli/format.js
export function stripControlChars(s) { /* … render rail: preserva \n \t … */ }

/** Carril de keystroke (cmux send): además neutraliza \n/\t (Enter/Tab). */
export function stripForKeystroke(s) {
  return stripControlChars(s).replace(/[\r\n\t]/g, ' ').replace(/\\[rnt]/g, ' ');
}
```

y usar `stripForKeystroke` en `manager.js:523`, `stop.js:56` y `stop.js:79`. Alternativa mínima
aceptable: documentar y aceptar explícitamente el residuo si se decide que estos campos nunca
contendrán saltos de línea (pero entonces conviene validarlo en el borde del provider).

## Info

### IN-01 (arrastrado): shadowing de `result` en `stop.js`

**File:** `src/hooks/stop.js:156,212`
**Issue:** `let result = findSessionFn(...)` (scope de función, línea 156) queda sombreado por
`const result = markSessionStatus(...)` dentro del `try` de la línea 205 (línea 212). No hay bug
funcional — los usos del `result` externo terminan en la línea 180 (`const { id, session } = result`)
y el `const` interno vive en su propio bloque — pero el nombre reutilizado dificulta la lectura.
Sigue presente idéntico al 1er pase. Nota adicional: en ese mismo destructuring, `id` se
desestructura pero no se usa después (`session` sí).
**Fix:** renombrar el interno (`const markResult = markSessionStatus(...)` / `if (!markResult?.ok)`)
y omitir `id` del destructuring (`const { session } = result;`).

### IN-02 (arrastrado): `stripControlChars` preserva `\n`/`\t` por diseño (carril de render)

**File:** `src/cli/format.js:73-86`
**Issue:** observación original del 1er pase: el saneador conserva `\t` (`\x09`) y `\n` (`\x0a`).
Para el carril de render del dashboard esto es correcto y deliberado (permite texto multilínea).
Sigue presente. En el 2º pase esta preservación adquiere una consecuencia nueva al reutilizar el
helper en el carril de keystroke — ver WR-02, que es el hallazgo accionable derivado.
**Fix:** ninguno en el carril de render (comportamiento deseado). La acción vive en WR-02.

### IN-03 (arrastrado): título de test obsoleto que describe el comportamiento PRE-fix

**File:** `test/session/group-resolve.test.js:145`
**Issue:** el título reza `"ref = 'KODO-9 ' (trailing space) → 'KODO' (hoy devuelve 'KODO-9 '
porque /-\d+$/ no matchea con el espacio)"`. El paréntesis describe el comportamiento ANTES del
fix del `trim` (IN-01 de Phase 77), pero la aserción ya verifica `=== 'KODO'`. El título se
contradice con lo que el test comprueba y confunde a quien lo lea. Sigue presente.
**Fix:** actualizar el título a algo como `"ref = 'KODO-9 ' (trailing space) → 'KODO' (el trim del
ref evita que el espacio de borde rompa el strip de -dígitos)"`.

### IN-04 (nuevo): campos de tarea no confiables aún llegan a cmux en crudo en carriles NO-keystroke

**File:** `src/session/manager.js:427,510-514`
**Issue:** el fix WR-01 saneó el carril de keystroke (`send`), pero `task.title` sigue fluyendo sin
sanear a dos sinks adyacentes: (1) el **nombre del workspace** `workspaceName = ${prefix}:
${truncate(task.title,40)}` que se pasa como arg CLI a `newWorkspace` (línea 427), y (2) el **body
de la notificación** `Lanzada sesión para: ${task.title}` (línea 513). Ninguno es carril de
keystroke (arg CLI y notificación de SO, no pulsaciones), así que el riesgo es sensiblemente menor
que WR-01/WR-02, pero completan el modelo de amenaza: contenido de tarea no confiable alcanza cmux
por rutas no saneadas.
**Fix:** por consistencia, envolver `task.title` con el saneador de render también en
`workspaceName` y en el `body` del `notify` (aquí basta el saneador de render — no son carriles de
keystroke).

### IN-05 (nuevo): `listWorkspaces` puede lanzar pese a su contrato "never-throws" (input malformado a nivel de elemento)

**File:** `src/host/cmux.js:207-222`
**Issue:** `listWorkspaces` está documentado como *never-throws* (`cmux.js:163`), pero el
`.map`/`.some` de las líneas 207-222 viven FUERA del `try/catch` de parseo (que cierra en la línea
205). Si `JSON.parse(...).workspaces` o `.notifications` contuvieran un elemento `null`/primitivo,
`w.ref` (208) o `n.workspace_ref` (210) lanzarían y la excepción escaparía del método, violando el
contrato. Probabilidad real: baja — cmux es un binario local confiable y sus arrays son objetos
bien formados — de ahí la clasificación Info y no Warning. Pre-existente, no introducido por esta
fase, pero es un hueco de robustez frente al patrón defensivo que el resto del módulo sí aplica
(`normalizeSurface` chequea `!raw`).
**Fix:** guardar a nivel de elemento, p. ej. `notifications.some((n) => n && n.workspace_ref ===
ref && …)` y `workspaces.map((w) => { if (!w) return null; … })` filtrando nulos, o envolver el
`.map` dentro del `try` existente.

---

_Reviewed: 2026-07-22T07:54:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
