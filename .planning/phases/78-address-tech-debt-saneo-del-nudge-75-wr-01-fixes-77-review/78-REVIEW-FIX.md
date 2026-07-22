---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
fixed_at: 2026-07-22T00:00:00Z
review_path: .planning/phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 78: Informe de Fix de Code Review

**Fixed at:** 2026-07-22
**Source review:** `.planning/phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-REVIEW.md`
**Iteration:** 2

**Resumen:**
- Hallazgos en scope (critical_warning): 1
- Corregidos: 1
- Omitidos: 0

Solo WR-02 está en el scope `critical_warning`. Los cinco Info (IN-01..IN-05) quedan
fuera de scope y NO se han tocado.

## Fixed Issues

### WR-02: `stripControlChars` preserva `\n` — que en el carril `cmux send` es una pulsación Enter (residuo de inyección al orquestador)

**Files modified:** `src/cli/format.js`, `src/session/manager.js`, `src/hooks/stop.js`, `test/dashboard-format.test.js`, `test/manager.test.js`, `test/stop.test.js`
**Commit:** `2ce37f2`

**Applied fix:**

Se introdujo una función hermana PURA `stripForKeystroke` junto a `stripControlChars`
en `src/cli/format.js` (misma hoja, mismo carril de import — se respeta la color-isolation,
cero deps nuevas, y `manager.js` NO importa `src/cmux/client.js`). Parte del saneo de
control-chars de `stripControlChars` y ADEMÁS colapsa a un espacio tanto los `\n`/`\r`/`\t`
REALES como su forma de escape LITERAL (`\` + `n`/`r`/`t`), que en el carril de keystroke
(`cmux send`) se interpretarían como Enter/Tab.

Se conmutó el saneador SOLO en los carriles de keystroke (verificados contra el sink real):

- `src/session/manager.js:523` — el nudge "Nueva sesión lanzada" al terminal del
  orquestador (`host._legacy.send`): `task.ref`, `task.title` y `projectPath`.
- `src/hooks/stop.js:56` — `buildStopNudgeText` (`session.task_ref`, `session.summary`).
- `src/hooks/stop.js:82` — `buildStopNudgeText` (el `next` LLM-persistido).

Se verificó que el output de `buildStopNudgeText` alimenta un `cmuxClient.send` (carril de
keystroke) en `src/hooks/session-end.js:254-258`, confirmando que stop.js está en el mismo
vector que WR-02 cubre. El `\n` terminador intencional (el Enter que envía el nudge) vive
FUERA de la llamada de saneo de campos y se conserva intacto.

Los carriles de RENDER (`src/cli/dashboard/App.js`, `src/cli/dashboard/markdown.js`) siguen
usando `stripControlChars` sin cambios — la preservación de `\n`/`\t` es el contrato de ese
carril (los goldens del dashboard dependen de ella).

**Verificación:**

- Sintaxis: `node -c` OK en los tres fuentes.
- `node --test test/manager.test.js test/stop.test.js test/dashboard-format.test.js` → 148 pass, 0 fail.
- Walker de aislamiento: `test/host/cmux-isolation.test.js` → 4 pass, 0 fail.
- Regresión con DIENTES añadida para el vector newline: se probó revirtiendo el fix
  (haciendo `stripForKeystroke` equivalente a `stripControlChars`) y los tests WR-02 fallan
  (5 fail), confirmando que capturan el residuo de inyección. Con el fix, verdes.
- No-regresión D-09: sobre ASCII limpio `stripForKeystroke` es la identidad → goldens
  byte-idénticos preservados (test explícito en stop.test.js y dashboard-format.test.js).

## Skipped Issues

Ninguno en scope. Los Info IN-01..IN-05 quedan fuera del scope `critical_warning` por diseño.

---

_Fixed: 2026-07-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
