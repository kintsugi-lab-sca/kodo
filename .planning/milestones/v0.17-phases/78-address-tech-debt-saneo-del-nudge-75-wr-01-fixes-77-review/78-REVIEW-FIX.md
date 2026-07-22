---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
fixed_at: 2026-07-22T09:06:31Z
review_path: .planning/phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-REVIEW.md
iteration: 3
findings_in_scope: 6
fixed: 4
skipped: 2
status: partial
---

# Phase 78: Informe de Fix de Code Review

**Fixed at:** 2026-07-22T09:06:31Z
**Source review:** `.planning/phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-REVIEW.md`
**Iteration:** 3

**Resumen:**
- Hallazgos en scope (`all`): 6
- Corregidos: 4 (IN-01, IN-03, IN-04, IN-05)
- Omitidos: 2 (WR-02 ya resuelto en pasada previa; IN-02 resuelto-por-WR-02, sin acción)

Esta pasada opera con scope `all`, así que entran los 5 Info además del WR-02. El WR-02 ya
fue corregido en el commit `2ce37f2` (pasada anterior) y se verificó presente y correcto en
el código actual; no se re-aplica. IN-02 es una observación cuya única acción accionable
vivía en WR-02 (ya cerrado), por lo que se marca resuelto-por-WR-02 sin cambio de código. El
trabajo real de esta pasada son IN-01, IN-03, IN-04 e IN-05.

## Fixed Issues

### IN-01: shadowing de `result` en `stop.js`

**Files modified:** `src/hooks/stop.js`
**Commit:** `fd2dec6`
**Applied fix:** La `const result = markSessionStatus(...)` interna (dentro del `try` de la
línea ~210) sombreaba la `let result` externa (scope de función, lookup de sesión). Se renombra
la interna a `markResult` (y sus dos usos `!markResult?.ok` / `markResult?.reason`). Además, en
el destructuring `const { id, session } = result;` se omite `id`, que no se usaba después →
`const { session } = result;`. Cambio puramente de legibilidad, sin efecto funcional. Los tests
existentes de `stop.test.js` bastan como cobertura.

### IN-03: título de test obsoleto que describe el comportamiento PRE-fix

**Files modified:** `test/session/group-resolve.test.js`
**Commit:** `0a8667a`
**Applied fix:** El título del test en la línea 145 describía en su paréntesis el comportamiento
ANTES del fix del trim (Phase 77), contradiciendo la aserción que ya verifica `=== 'KODO'`. Se
actualiza el paréntesis a "el trim del ref evita que el espacio de borde rompa el strip de
-dígitos", alineado con el comportamiento post-fix. Cambio de solo-texto en el título.

### IN-04: campos de tarea no confiables llegaban a cmux en crudo en carriles NO-keystroke

**Files modified:** `src/session/manager.js`, `test/manager.test.js`
**Commit:** `e1bdb01`
**Applied fix:** `task.title` (contenido no confiable LLM/Plane) fluía sin sanear a dos sinks
no-keystroke: el nombre de workspace (`workspaceName`, arg CLI de `newWorkspace`) y el body de
la notificación de SO. Se envuelve `task.title` con `stripControlChars` (saneador de RENDER —
neutraliza CSI/OSC/C0/C1/DEL/CR sin colapsar `\n`/`\t`, correcto por no ser carriles de
keystroke). En `workspaceName` el saneo se aplica ANTES de `truncate` para que el recorte mida
texto limpio. Se añade `stripControlChars` al import ya existente de `../cli/format.js`.
Regresión añadida en `test/manager.test.js` (positiva + negativa para ambos sinks). Además se
acotó el guard negativo WR-02 (que era source-wide y prohibía `stripControlChars(task.title)`)
al propio send del carril de keystroke — de lo contrario el nuevo uso legítimo de render lo
rompía.

### IN-05: `listWorkspaces` podía lanzar pese a su contrato "never-throws"

**Files modified:** `src/host/cmux.js`, `test/host/contract.test.js`
**Commit:** `b0fecf7`
**Applied fix:** El `.map`/`.some` de `listWorkspaces` (líneas ~207-222) vive FUERA del
`try/catch` de parseo pese al contrato never-throws. Un elemento `null`/primitivo en
`workspaces` o `notifications` haría lanzar `w.ref` / `n.workspace_ref`, escapando la excepción.
Se añade guarda a nivel de elemento: `if (!w) return null` + `.filter((info) => info !== null)`
en el `.map`, y `n && n.workspace_ref === ...` en el `.some` — mismo patrón defensivo que
`normalizeSurface`. Regresión añadida en `test/host/contract.test.js` inyectando elementos null
en ambos arrays y verificando `doesNotReject` + filtrado correcto.

## Skipped Issues

### WR-02: `stripControlChars` preserva `\n` en el carril `cmux send`

**File:** `src/cli/format.js:73-86` · `src/session/manager.js:523` · `src/hooks/stop.js:56,79`
**Reason:** Ya resuelto en una pasada previa (commit `2ce37f2`), anterior a este REVIEW.md.
Verificado contra el código actual: existe `stripForKeystroke` en `src/cli/format.js` (colapsa
`\n`/`\r`/`\t` reales y su forma de escape literal a espacio), y está conmutado en los tres
sinks de keystroke — `manager.js:523` (nudge "Nueva sesión lanzada") y `stop.js:59,83`
(`buildStopNudgeText`). Cubierto por los tests de regresión existentes. No se re-aplica.
**Original issue:** el saneador de render preserva `\n`, que en el carril de keystroke sería un
Enter espurio inyectado al terminal del orquestador.

### IN-02: `stripControlChars` preserva `\n`/`\t` por diseño (carril de render)

**File:** `src/cli/format.js:73-86`
**Reason:** Sin acción accionable propia. El review lo marca explícitamente como "ninguna [acción]
en el carril de render (comportamiento deseado); la acción vive en WR-02". El vector de keystroke
que le daba consecuencia ya está cerrado por `stripForKeystroke` (WR-02, commit `2ce37f2`). La
preservación de `\n`/`\t` en el carril de render (Ink, texto multilínea) es correcta y deliberada.
Resuelto-por-WR-02, sin cambio de código.
**Original issue:** observación de que el saneador conserva `\t`/`\n`, con consecuencia derivada
en el carril de keystroke.

---

_Fixed: 2026-07-22T09:06:31Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
