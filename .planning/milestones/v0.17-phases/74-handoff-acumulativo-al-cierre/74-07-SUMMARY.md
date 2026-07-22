---
phase: 74-handoff-acumulativo-al-cierre
plan: 07
subsystem: infra
tags: [hooks, doctor, cli, settings, drift-detection, node-test]

# Dependency graph
requires:
  - phase: 58-ciclo-de-vida-de-sesion
    provides: "SessionEnd hook (LIFE-03) + install.js con los 3 hooks canónicos"
  - phase: 72-higiene
    provides: "match por-ruta canónica /src/hooks/<file> (B9) en lugar del substring 'kodo'"
provides:
  - "checkHookRegistration(settings): detector PURO never-throws de deriva instalación↔settings"
  - "KODO_HOOKS: única fuente de verdad del mapeo evento→file de los 3 hooks canónicos"
  - "sección hooks en `kodo doctor`: reporta la deriva como ERROR con exit 1 y sugiere `kodo install`"
affects: [74-08, cierre-milestone-v017]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Detector puro (never-throws, cero I/O) + mitad CLI que hace la lectura — espejo de config-doctor.js"
    - "Constante canónica única (KODO_HOOKS) compartida por installHooks/uninstallHooks y el doctor"

key-files:
  created: []
  modified:
    - src/hooks/install.js
    - src/cli/doctor.js
    - test/hooks/install.test.js
    - test/cli/doctor.test.js

key-decisions:
  - "KODO_HOOK_FILES pasa a DERIVARSE de KODO_HOOKS (map al campo file) — una sola verdad, comportamiento byte-idéntico"
  - "La sección hooks del doctor está SIEMPRE activa (no opt-in): la invisibilidad fue la causa raíz de G-74-4"
  - "settings ilegible degrada a WARN sin forzar exit 1 — no se afirma deriva sobre lo que no se pudo leer"
  - "NO se añade --fix a `kodo doctor` (rompería su contrato read-only): el remedio es `kodo install`"

patterns-established:
  - "Chequeo POR-EVENTO y POR-FILE (commandMatchesFile contra el file específico de KODO_HOOKS[event]) en vez de match laxo — evita el falso verde de G-74-4"
  - "Tests herméticos vía readSettingsFn inyectado con CLEAN_SETTINGS por defecto en makeSink — dejan de depender del ~/.claude real"

requirements-completed: [LIVE-04]

coverage:
  - id: D1
    description: "checkHookRegistration: checker PURO never-throws que reporta por-evento qué hooks kodo faltan/están registrados (raíz de G-74-4: SessionEnd ausente con SessionStart/Stop presentes)"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "test/hooks/install.test.js#install.js — checkHookRegistration (deriva instalación↔settings, G-74-4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "KODO_HOOKS como única fuente de verdad: KODO_HOOK_FILES deriva de ella; installHooks/uninstallHooks siguen byte-idénticos (Tests 1..6b verdes sin cambios)"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "test/hooks/install.test.js#install.js — registro de SessionStart/Stop (Phase 50.1, DG-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "`kodo doctor` reporta la deriva instalación↔settings como ERROR con exit 1 y sugiere `kodo install`; hooks limpios cuando los 3 están; WARN sin false-positive si settings ilegible"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "test/cli/doctor.test.js#runDoctor: sección hooks (deriva instalación↔settings, G-74-4)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Verificación en vivo: `node bin/kodo doctor` en el entorno del operador HOY detecta el SessionEnd ausente real y sale con exit 1 (prueba del bucle de cierre del gap G-74-4)"
    verification:
      - kind: manual_procedural
        ref: "node bin/kodo doctor -> sección hooks 'ERROR hook SessionEnd (session-end.js) NO registrado' + exit 1"
        status: pass
    human_judgment: true
    rationale: "Depende del ~/.claude/settings.json REAL del operador; no determinista/automatizable. La registración real la hace el Plan 74-08."

# Metrics
duration: 18min
completed: 2026-07-21
status: complete
---

# Phase 74 Plan 07: Detección de deriva instalación↔settings en `kodo doctor` Summary

**`kodo doctor` aprende a detectar la clase de fallo silencioso de G-74-4: el checker PURO `checkHookRegistration` cruza `~/.claude/settings.json` contra `KODO_HOOKS` por-evento y reporta cualquier hook kodo ausente como ERROR con exit 1, sugiriendo `kodo install`.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-07-21
- **Tasks:** 2 (ambas TDD)
- **Files modified:** 4

## Accomplishments
- `checkHookRegistration(settings)` — función PURA, never-throws, POR-EVENTO en `install.js`: reporta `{registered, missing}` de los 3 hooks canónicos sin hacer I/O. Detecta el escenario exacto de G-74-4 (SessionEnd ausente mientras SessionStart/Stop presentes).
- `KODO_HOOKS` como única fuente de verdad del mapeo evento→file; `KODO_HOOK_FILES` ahora deriva de ella. `installHooks`/`uninstallHooks` quedan byte-idénticos (helper `commandMatchesFile` factorizado, reusado por `isKodoHookCommand`).
- Sección `hooks` en `kodo doctor` SIEMPRE activa: lee settings (never-throws → objeto|null), consume el checker, lo mete en el exit code y en el payload `--json`, y sugiere `kodo install` como remedio (nunca editar settings a mano).
- Smoke en vivo: `node bin/kodo doctor` HOY detecta el SessionEnd ausente real y sale con exit 1 — el detector ve el gap G-74-4 real.

## Task Commits

TDD (RED → GREEN por tarea):

1. **Task 1 (test): checkHookRegistration** - `88bcf72` (test)
2. **Task 1 (impl): checkHookRegistration + KODO_HOOKS** - `74ddaa5` (feat)
3. **Task 2 (test): sección hooks en doctor** - `818fb2c` (test)
4. **Task 2 (impl): wire hook-drift en runDoctor** - `aeabb8f` (feat)

## Files Created/Modified
- `src/hooks/install.js` - `KODO_HOOKS` (nueva fuente de verdad), `commandMatchesFile`, `checkHookRegistration` (puro); `KODO_HOOK_FILES` derivado.
- `src/cli/doctor.js` - `readSettingsFn` dep + `defaultReadSettings`; sección hooks en `runDoctor`/`renderHuman`; `hooks` en el payload `--json`; contribución al exit code.
- `test/hooks/install.test.js` - describe nuevo para `checkHookRegistration` (8 casos: 3 limpios, G-74-4, ajeno, wrong-event, Windows, never-throws malformado).
- `test/cli/doctor.test.js` - `CLEAN_SETTINGS` por defecto en `makeSink` (herméticos) + describe de la sección hooks (5 casos).

## Decisions Made
- **KODO_HOOK_FILES deriva de KODO_HOOKS** en vez de duplicar la lista — no puede haber dos verdades sobre cuáles son los hooks canónicos.
- **Sección hooks SIEMPRE activa, no opt-in** — un flag que nadie pasa no habría prevenido la clase de fallo (la invisibilidad fue la raíz).
- **settings ilegible → WARN, nunca exit 1 forzado** — el doctor no afirma deriva sobre lo que no pudo leer (never-throws, sin false-positive acoplado al entorno).
- **Sin `--fix` en `kodo doctor`** — se preserva su contrato read-only; el remedio es el `kodo install` idempotente existente.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Los 43 casos de la suite de verificación (`install.test.js` + `doctor.test.js` + `config-doctor.test.js`) pasan; los Tests 1..6b existentes de install siguen verdes sin cambios; cero dependencias npm nuevas; exactamente 4 ficheros tocados.

## User Setup Required
None - no external service configuration required. (La registración real del hook SessionEnd en `~/.claude/settings.json` y la verificación en vivo son el checkpoint del operador del Plan 74-08.)

## Next Phase Readiness
- Plan 74-08 (registración real + verificación en vivo del cierre) puede consumir directamente el detector: tras `kodo install`, `node bin/kodo doctor` debe reportar los 3 hooks limpios y `state.tasks` poblarse en un cierre real.
- El detector es ahora un gate ejecutable (exit 1) — reutilizable por CI/operador para vigilar esta clase de deriva de forma permanente.

---
*Phase: 74-handoff-acumulativo-al-cierre*
*Completed: 2026-07-21*

## Self-Check: PASSED
- Todos los ficheros creados/modificados existen en disco (4 + SUMMARY).
- Los 4 commits de tarea (88bcf72, 74ddaa5, 818fb2c, aeabb8f) existen en git.
