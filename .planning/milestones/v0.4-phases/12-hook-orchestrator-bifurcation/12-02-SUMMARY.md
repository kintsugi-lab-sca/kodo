---
phase: 12-hook-orchestrator-bifurcation
plan: 02
subsystem: hooks
tags: [hooks, stop, quick-mode, nudge, orchestrator]

# Dependency graph
requires:
  - phase: 11-quick-mode-recognition-persistence
    provides: getSessionMode helper en src/labels.js (consumed as first downstream consumer in stop.js)
  - phase: 10-orchestrator-gsd-integration
    provides: buildStopNudgeText con bloque GSD (`kodo gsd verify <session-id>`) preservado verbatim en case 'full'
provides:
  - buildStopNudgeText con switch exhaustivo sobre getSessionMode(session)
  - case 'quick' que NO sugiere `kodo gsd verify` (CLI no soporta quick) y pide revisión manual
  - case 'full' que preserva el texto Phase 10 D-04 verbatim
  - case default que preserva el texto no-GSD original
affects: [phase-13-test-coverage-matrix]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Switch exhaustivo sobre getSessionMode() — primer callsite (D-07 Phase 12). Phase 13 testeará 4 estados sobre este patrón."
    - "Helper en labels.js + consumer downstream (stop.js es el primer consumer de labels.js desde hooks)"

key-files:
  created: []
  modified:
    - src/hooks/stop.js

key-decisions:
  - "Switch sobre helper getSessionMode(session) en lugar de inline session.gsd_mode || 'full' — DRY, prohibido por Phase 11 D-09/D-10"
  - "Case 'full' con braces { } por const phaseLabel — los otros dos cases retornan directamente sin braces"
  - "Lock release block (líneas 137-144 post-cambio) NO modificado — session.gsd === true cubre quick por D-04 Phase 11"
  - "Escape literal \\\\n preservado en los 3 returns — cmux.send lo interpreta como Enter (D-04 Phase 10)"

patterns-established:
  - "Switch exhaustivo sobre helper de modo: case 'quick' / case 'full' / default — analog estructural en src/triggers/dispatcher.js:153 (switch sobre resolverVerdict.action)"
  - "getSessionMode(session) como única vía de lectura del modo en cualquier consumer — nunca session.gsd_mode inline"

requirements-completed: [QUICK-06]

# Metrics
duration: 2min
completed: 2026-04-28
---

# Phase 12 Plan 02: Stop hook nudge bifurcation Summary

**buildStopNudgeText refactorizado a switch exhaustivo sobre getSessionMode(session) — sesiones quick reciben "revisión manual" en lugar de `kodo gsd verify`, sin tocar el lock release.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-28T19:56:30Z
- **Completed:** 2026-04-28T19:58:13Z
- **Tasks:** 2
- **Files modified:** 1 (src/hooks/stop.js)

## Accomplishments

- `src/hooks/stop.js` ahora importa `getSessionMode` desde `../labels.js` (línea 15) — primer consumer de `labels.js` desde este archivo
- `buildStopNudgeText` (líneas 40-56) refactorizada de `if (session.gsd) { … }` a `switch (getSessionMode(session)) { … }` exhaustivo
- Case `'quick'` (línea 44): texto ES nuevo que no menciona `kodo gsd verify` y pide revisión manual — cumple QUICK-06 y success criterion 2 de Phase 12
- Case `'full'` (línea 47): texto Phase 10 D-04 preservado verbatim, con phase_id ternary para fallback "bootstrap"
- Case `default` (línea 52): texto no-GSD original preservado verbatim
- JSDoc actualizado para describir las 3 ramas (líneas 25-39)
- Bloque de lock release (líneas 137-144 con `if (session.gsd) { releaseGsdLock(...) }`) **NO** modificado — verificado por grep y diff

## Task Commits

Cada task se committeó atómicamente con `--no-verify` (parallel executor en worktree):

1. **Task 1: Importar getSessionMode en stop.js** — `f6387c7` (feat)
2. **Task 2: Refactorizar buildStopNudgeText a switch exhaustivo (D-07, D-08, D-09)** — `3c26950` (refactor)

**Plan metadata:** pending (este SUMMARY se commitea al final)

## Files Created/Modified

- `src/hooks/stop.js` — Añadido import `getSessionMode` desde `../labels.js` (línea 15) y refactorizado `buildStopNudgeText` (líneas 40-56) para usar `switch` exhaustivo con tres ramas (`'quick'`, `'full'`, `default`).

## Hand-off para Phase 13

`test/stop.test.js` puede importar `buildStopNudgeText` y assert los 4 estados:

1. **quick** → `buildStopNudgeText({ gsd:true, gsd_mode:'quick', task_ref:'TASK-X', summary:'…', session_id:'s1' })` debe contener `"GSD quick (one-shot, sin VERIFICATION.md)"` y `"Revísala manualmente"`, **NO** debe contener `"kodo gsd verify"`.
2. **full + phase** → `{ gsd:true, gsd_mode:'full', phase_id:'7', session_id:'s2' }` debe contener `"kodo gsd verify s2"` y `"fase 7"`.
3. **full + bootstrap** → `{ gsd:true, gsd_mode:'full', session_id:'s3' }` (sin phase_id) debe contener `"kodo gsd verify s3"` y `"bootstrap"`.
4. **legacy (gsd:true sin gsd_mode)** → `{ gsd:true, phase_id:'3', session_id:'s4' }` se trata como full (D-08 Phase 11) → mismo assert que #2/#3.
5. **no-GSD (default)** → `{ gsd:false }` debe contener `"Revisa el resultado y decide"`, **NO** debe contener `"kodo gsd"` ni `"one-shot"`.

Los 5 cases ya están cubiertos por el bloque `<verify automated>` del PLAN.md, ejecutado y `OK` durante este plan.

## Texto verbatim del case quick

```
La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review. Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\n
```

(El `\n` final es escape literal — dos caracteres en el código fuente. `cmux.send` lo interpreta como Enter, igual que en los otros dos cases.)

## Confirmación de invariantes preservadas

- **Lock release intacto**: `git diff HEAD~2 HEAD -- src/hooks/stop.js` muestra cambios sólo en imports + JSDoc + cuerpo de `buildStopNudgeText`. El bloque `if (session.gsd) { … releaseGsdLock(…) }` (líneas 137-144 post-cambio, originalmente 127-134) NO aparece en el diff. Verificado adicionalmente con `grep -A 8 "if (session.gsd)" src/hooks/stop.js | grep -q "releaseGsdLock"` → exit 0.
- **Escape literal `\\n` en los 3 returns**: `node -e "const s=...; const m=s.match(/\\\\n\`;/g); ..."` devuelve `matches: 3`.
- **Switch counts correctos**: 2 cases (`grep -c "case '"`) + 1 default (`grep -c "default:"`) = 3 ramas.
- **Imports = 6** (5 originales + 1 nuevo).
- **node --check** y `node -e "import('./src/hooks/stop.js')…"` ambos exit 0.
- **Idioma ES preservado** (D-16 Phase 10) en los 3 returns.

## Decisions Made

Ninguna decisión nueva. El plan se ejecutó al pie de la letra de las decisiones D-07, D-08, D-09 y D-10 ya documentadas en `12-CONTEXT.md`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/hooks/stop.js` listo para ser cubierto por la matriz de tests de Phase 13 (los 4 estados de label en este punto de la cadena).
- El switch exhaustivo introducido aquí es el patrón canónico (D-07, S4 en PATTERNS.md) que Phase 12 plans 01 (session-start) y 03 (orchestrator launch + prompt.md) replicarán/consumirán.
- No hay blockers ni concerns para Phase 13.

## Self-Check: PASSED

- File exists: `src/hooks/stop.js` — FOUND
- Commit Task 1 (`f6387c7`) — FOUND in `git log --oneline --all`
- Commit Task 2 (`3c26950`) — FOUND in `git log --oneline --all`
- Lock release block intact (verified by grep + diff) — PASS
- All acceptance criteria from PLAN.md verified passing — PASS

---
*Phase: 12-hook-orchestrator-bifurcation*
*Plan: 02*
*Completed: 2026-04-28*
