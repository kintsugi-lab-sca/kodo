---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
fixed_at: 2026-07-22T00:00:00Z
review_path: .planning/phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 78: Informe de Fix de Code Review

**Fixed at:** 2026-07-22
**Source review:** .planning/phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-REVIEW.md
**Iteration:** 1

**Resumen:**
- Hallazgos en scope (critical_warning): 1
- Corregidos: 1
- Omitidos: 0

Los 3 hallazgos Info (IN-01, IN-02, IN-03) quedaron fuera del scope `critical_warning` y no se tocaron.

## Issues corregidos

### WR-01: El nudge de "Nueva sesión lanzada" al orquestador NO sanea `task.ref`/`task.title`

**Files modified:** `src/session/manager.js`, `test/manager.test.js`
**Commit:** 17a706c
**Applied fix:**
Se aplicó `stripControlChars` a los tres campos derivados de provider no confiable
(`task.ref`, `task.title`, `projectPath`) interpolados en el texto que `launchWorkItem`
envía al terminal del orquestador vía `host._legacy.send` (`src/session/manager.js:517-529`).
El fix es simétrico al ya establecido en `buildStopNudgeText` (`src/hooks/stop.js`, commit
fd9bcb2): se importó el helper canónico desde `../cli/format.js`, respetando el invariante
de cmux-isolation (`manager.js` NO importa `src/cmux/client.js` directo; `format.js` solo
depende de `picocolors`).

Se añadió un guard de regresión en `test/manager.test.js` siguiendo el patrón de
inspección de fuente ya usado para `launchWorkItem` (que hace I/O real de cmux/provider y no
se ejecuta en test): verifica el import de `stripControlChars` desde `../cli/format.js`, que
los tres campos van envueltos en el `send` del nudge, y una aserción negativa de que
`task.ref` crudo no reaparece.

**Verificación:**
- Tier 1: relectura del bloque modificado — fix presente y código intacto.
- Tier 2: `node -c` OK sobre `manager.js` y `manager.test.js`.
- Tests: `test/manager.test.js` 60/60 (incluye el nuevo guard), `test/stop.test.js` 30/30,
  `test/orchestrator-launch-isolation.test.js` 3/3, y el walker de cmux-isolation
  `test/host/cmux-isolation.test.js` 4/4 (sigue verde).

---

_Fixed: 2026-07-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
