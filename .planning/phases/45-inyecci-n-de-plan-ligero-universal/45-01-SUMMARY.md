---
phase: 45-inyecci-n-de-plan-ligero-universal
plan: 01
subsystem: infra
tags: [session-start-hook, kodo-dir, plan-injection, gsd, quick-mode, golden-bytes]

# Dependency graph
requires:
  - phase: 20-anti-push-fantasma
    provides: "Patrón append-al-final preservando golden bytes (HOOK-02) en buildSessionContext y buildGsdContext"
  - phase: 12-quick-mode-bifurcation
    provides: "Rama mode === 'quick' de buildGsdContext (getSessionMode) donde se inyecta la instrucción EN"
provides:
  - "Inyección de instrucción de plan ligero ES en buildSessionContext (non-GSD)"
  - "Inyección de instrucción de plan ligero EN en la rama quick de buildGsdContext"
  - "Ruta resuelta ~/.kodo/plans/<task_id>.md vía join(KODO_DIR, 'plans', `${task_id}.md`), correlación por task_id"
affects: [46-captura-persistencia-plan-no-gsd, overlay-plan-ligero, plan.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-al-final preservando golden bytes (HOOK-02): la instrucción nueva no altera bytes previos"
    - "Inyección DENTRO del if quick (antes del bloque común) para preservar D-04 common-block invariance"
    - "Ruta computada con join(KODO_DIR, ...) — hook puro sin I/O, la sesión escribe el fichero en runtime (D-03)"

key-files:
  created:
    - .planning/phases/45-inyecci-n-de-plan-ligero-universal/45-01-SUMMARY.md
  modified:
    - src/hooks/session-start.js
    - test/session-start.test.js
    - test/gsd-context.test.js

key-decisions:
  - "Imports separados: `import { join } from 'node:path'` y `import { KODO_DIR } from '../config.js'` (líneas independientes), cumpliendo el acceptance grep exacto del plan"
  - "Instrucción ES como elementos finales del array return[] de buildSessionContext; instrucción EN como últimos args del lines.push() DENTRO del if quick"
  - "Ruta resuelta (homedir expandido + task_id real), nunca el literal <task_id> ni concat de process.env.HOME — tests computan el path con el mismo KODO_DIR importado (Pitfall 3 caching)"
  - "Sin I/O en el hook (D-03): solo emite el string; la sesión de Claude escribe ~/.kodo/plans/<task_id>.md en runtime"
  - "Sin defensa `?? 'unknown'` sobre task_id (Pitfall 1): se confía en el invariante de findSession; ensuciar golden-bytes sería over-engineering"

patterns-established:
  - "Plan ligero universal: cualquier sesión (non-GSD ES o quick EN) recibe una sola línea imperativa que dirige a escribir un plan corto a una ruta kodo-controlada correlacionada por task_id"
  - "Latest-wins (D-06): escribir al empezar → un re-dispatch de la misma task sobrescribe ~/.kodo/plans/<task_id>.md"

requirements-completed: [PLAN-03]

# Metrics
duration: 14min
completed: 2026-06-10
---

# Phase 45 Plan 01: Inyección de plan ligero universal Summary

**buildSessionContext (ES) y la rama quick de buildGsdContext (EN) inyectan una instrucción de una línea que dirige a la sesión a escribir un plan corto en `~/.kodo/plans/<task_id>.md` (ruta resuelta vía KODO_DIR), preservando golden-bytes y la D-04 common-block invariance.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-10T08:09:00Z
- **Completed:** 2026-06-10T08:23:00Z
- **Tasks:** 2 (ambas TDD)
- **Files modified:** 3

## Accomplishments
- Instrucción ES de plan ligero inyectada al final de `buildSessionContext` (sesiones non-GSD), tras el bloque Anti-push-fantasma, sin alterar bytes previos (HOOK-02).
- Instrucción EN equivalente inyectada DENTRO del `if (mode === 'quick')` de `buildGsdContext`, antes del bloque común `## No automatic push`, preservando la D-04 common-block invariance (las 3 ramas convergen en un tail byte-idéntico).
- Ruta resuelta bajo `KODO_DIR` vía `join(KODO_DIR, 'plans', \`${task_id}.md\`)` — sin literal `<task_id>`, sin I/O en el hook (D-03). La escritura del fichero la resuelve la sesión en runtime.
- Ramas phase y bootstrap byte-idénticas (D-04); suite completa verde sin regresiones (1252 pass / 1 skip).

## Task Commits

Cada task se commiteó atómicamente siguiendo el ciclo TDD (RED → GREEN):

1. **Task 1 (RED): tests ES en buildSessionContext** - `818a870` (test)
2. **Task 1 (GREEN): instrucción ES + imports join/KODO_DIR** - `bf7fe06` (feat)
3. **Task 2 (RED): tests EN rama quick + exclusiones/invariancia** - `d8b02e9` (test)
4. **Task 2 (GREEN): instrucción EN en la rama quick** - `9c7ede4` (feat)

**Plan metadata:** (final docs commit — ver completion)

_Sin fase REFACTOR: el código resultante es mínimo y claro (una línea por sitio)._

## Files Created/Modified
- `src/hooks/session-start.js` - Imports `join` (node:path) y `KODO_DIR` (../config.js); instrucción ES al final de `buildSessionContext`; instrucción EN dentro del `if (mode === 'quick')` de `buildGsdContext`.
- `test/session-start.test.js` - Import de `KODO_DIR`; 5 casos non-GSD (presencia ES, ruta resuelta, sin literal, golden-bytes HOOK-02, complementariedad D-09).
- `test/gsd-context.test.js` - Imports de `join` y `KODO_DIR`; describe PLAN-03 con 5 casos (presencia quick, ruta resuelta, exclusión phase, exclusión bootstrap, invariancia del bloque común).

## Decisions Made
- **Imports separados en dos líneas** (`join` de node:path y `KODO_DIR` de ../config.js) para satisfacer el acceptance grep exacto `import { KODO_DIR } from '../config.js'`, en vez de combinar con `loadConfig` en un solo import.
- **Tests computan la ruta con el mismo `KODO_DIR` importado**, nunca hardcodeando HOME — `KODO_DIR` está cacheado al import (Pitfall 3), así que recalcularlo con `process.env.HOME` produciría mismatches en entornos de test aislados.
- **Sin defensa `?? 'unknown'` sobre `task_id`** (Pitfall 1): se confía en el invariante de `findSession` (`main()` hace `exit(0)` sin sesión); añadir defensa ensuciaría los golden-bytes innecesariamente.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Un grep de verificación de scope produjo un falso positivo (matcheó el comentario nuevo que menciona el header `## No automatic push`); el diff confirmó que solo se tocó la rama quick — las ramas phase/bootstrap y el bloque común quedan byte-idénticos.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PLAN-03 cerrado: el artefacto `~/.kodo/plans/<task_id>.md` queda especificado por contrato (markdown plano D-05, correlación por nombre de fichero) para que Phase 46 (overlay del plan ligero) lo lea vía `plan.js` con `String.includes` anti-ReDoS.
- El hook no escribe el fichero ni añade endpoints — la superficie de producción es un string-builder puro. Phase 46 puede consumir el artefacto sin dependencias de hooks/rutas no documentados de Claude Code.

## Self-Check: PASSED

- FOUND: src/hooks/session-start.js, test/session-start.test.js, test/gsd-context.test.js, 45-01-SUMMARY.md
- FOUND commits: 818a870 (test), bf7fe06 (feat), d8b02e9 (test), 9c7ede4 (feat)

---
*Phase: 45-inyecci-n-de-plan-ligero-universal*
*Completed: 2026-06-10*
