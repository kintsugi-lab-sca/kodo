---
phase: 72-higiene-dx-y-verdad-documental
plan: 01
subsystem: infra
tags: [hooks, stop, session-end, orchestrator, cmux, git, auto-commit, lifecycle]

# Dependency graph
requires:
  - phase: 71-fiabilidad-de-entrega-y-backstop
    provides: "runReviewBackstop (DELIV-04) en session-end.js — slot reservado tras el backstop para los efectos de cierre"
  - phase: 58-sessionrecord-lifecycle
    provides: "split Stop→idle / SessionEnd→cleanup terminal (performTerminalCleanup)"
provides:
  - "Gate KODO_ORCHESTRATOR=1 en handleOrchestratorStop — el auto-commit de la skill solo corre en la sesión orquestadora"
  - "Pathspec restringido a .claude/skills/kodo-orchestrate/ en add y commit del auto-commit (cero commits fantasma)"
  - "Inyección de KODO_ORCHESTRATOR=1 en el command string de launchOrchestrator"
  - "Efectos de cierre (setColor/notify/nudge) movidos de runStopHook a runSessionEndHook, tras el backstop, cada uno never-throws"
affects: [73-debounce-nudge-orchestrator, HYG-08-readme-delta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate por env-var marcadora inyectada como prefijo del command string (no spawn env) — cmux.send"
    - "Efectos cosméticos al cierre REAL (SessionEnd) en vez de fin-de-turno (Stop)"

key-files:
  created: []
  modified:
    - src/hooks/stop.js
    - src/orchestrator/launch.js
    - src/hooks/session-end.js
    - test/hooks/stop-idempotency.test.js
    - test/hooks/session-end.test.js
    - test/skill-auto-commit.test.js

key-decisions:
  - "El commit del auto-commit lleva `-m` ANTES del `-- <pathspec>` (git trata todo tras `--` como pathspec) — corregido respecto al ejemplo de RESEARCH/PATTERNS que ponía `-- pathspec -m`"
  - "KODO_ROOT se fija a nivel de módulo en el test HYG-01 (no en before) porque session-end.js ahora importa stop.js transitivamente y lo carga antes de que before() pueda override-ar KODO_ROOT"
  - "buildStopNudgeText se importa estáticamente en session-end.js (no lazy) siguiendo el plan; el nudge inline reusa el mismo match /(workspace:\\d+)\\s+kodo-orchestrator/ en vez de acoplar findOrchestratorRef de launch.js"

patterns-established:
  - "Env-var marcadora de rol inyectada por prefijo del command string enviado por cmux.send (Pattern 3 RESEARCH)"
  - "Cada efecto de cierre en su propio try/catch (never-throws individual) tras performTerminalCleanup"

requirements-completed: [HYG-01, HYG-04]

coverage:
  - id: D1
    description: "handleOrchestratorStop auto-commitea la skill SOLO con KODO_ORCHESTRATOR=1; sin la var hace skip silencioso con log (cero commits fantasma)"
    requirement: "HYG-01"
    verification:
      - kind: unit
        ref: "test/hooks/stop-idempotency.test.js#HYG-01 orchestrator auto-commit gate"
        status: pass
      - kind: unit
        ref: "test/skill-auto-commit.test.js#D-16: handleOrchestratorStop auto-commit (A/B/C)"
        status: pass
    human_judgment: false
  - id: D2
    description: "El auto-commit restringe el pathspec a .claude/skills/kodo-orchestrate/ en add y commit; nunca arrastra staged ajeno del dev"
    requirement: "HYG-01"
    verification:
      - kind: unit
        ref: "test/hooks/stop-idempotency.test.js#con KODO_ORCHESTRATOR=1 → alcanza el auto-commit (solo el subdir de la skill)"
        status: pass
    human_judgment: false
  - id: D3
    description: "launchOrchestrator inyecta KODO_ORCHESTRATOR=1 como prefijo del claudeCmd enviado por cmux.send"
    requirement: "HYG-01"
    verification:
      - kind: other
        ref: "grep -c 'KODO_ORCHESTRATOR=1' src/orchestrator/launch.js == 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "Los efectos de cierre (setColor review, notify, nudge) disparan en runSessionEndHook tras el backstop DELIV-04, cada uno never-throws; runStopHook ya no los emite"
    requirement: "HYG-04"
    verification:
      - kind: unit
        ref: "test/hooks/session-end.test.js#efectos de cierre HYG-04 (color/notify/nudge)"
        status: pass
      - kind: unit
        ref: "test/stop-state-transition.test.js (Stop conserva markSessionStatus idle + releaseGsdLock, sin efectos cmux)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Propagación empírica de KODO_ORCHESTRATOR=1 desde el shell del workspace cmux al proceso del hook (A2 / Open Question #1, confianza MEDIA)"
    requirement: "HYG-01"
    verification: []
    human_judgment: true
    rationale: "Requiere lanzar el orquestador real (kodo orchestrate) en cmux+claude y comprobar process.env.KODO_ORCHESTRATOR en el hook. El modo de fallo es SEGURO por diseño (sin var → skip); confirmación diferida a la verificación de fase / dogfooding."

# Metrics
duration: 15min
completed: 2026-07-13
status: complete
---

# Phase 72 Plan 01: Gate del auto-commit del orquestador + efectos de cierre a SessionEnd (HYG-01/HYG-04) Summary

**El auto-commit de aprendizajes del orquestador queda gated por `KODO_ORCHESTRATOR=1` con pathspec al subdir de la skill (cero commits fantasma), y los efectos cosméticos de cierre (color review, notify, nudge) se disparan una sola vez al cierre real en `SessionEnd` tras el backstop DELIV-04.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-13T11:18:36Z
- **Completed:** 2026-07-13T11:33:46Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- **HYG-01:** `handleOrchestratorStop` ahora exige `KODO_ORCHESTRATOR === '1'` (gate D-06 que cubre todo el bloque add+commit) y restringe el pathspec a `.claude/skills/kodo-orchestrate/` en `git add`, `git commit` y `git status`. `launchOrchestrator` inyecta el marcador como prefijo del command string enviado por `cmux.send`.
- **HYG-04:** los tres efectos de cierre (`setColor(review)`, `notify` de cierre, nudge al orquestador con `buildStopNudgeText`) se movieron de `runStopHook` a `runSessionEndHook`, insertados DESPUÉS de `performTerminalCleanup`, cada uno en su propio try/catch (never-throws individual). `Stop` conserva solo el estado ligero: `markSessionStatus('idle')` + `releaseGsdLock`.
- `buildStopNudgeText` permanece exportada en `stop.js` (la importan tests y ahora `session-end.js` para el nudge movido).
- Guardrails actualizados en el mismo commit: nuevo bloque de gate en `stop-idempotency.test.js`, tests de efectos post-backstop en `session-end.test.js`, y el canon spawnSync `skill-auto-commit.test.js` (A/B con marcador + nueva C sin marcador).

## Task Commits

Each task was committed atomically:

1. **Task 1: HYG-01 gate + pathspec + inyección** - `a3b7166` (feat)
2. **Task 2: HYG-04 mover efectos de cierre a SessionEnd** - `4364aea` (feat)

## Files Created/Modified
- `src/hooks/stop.js` - Gate `KODO_ORCHESTRATOR` + pathspec del auto-commit; eliminados los tres efectos de cierre de `runStopHook`; `cmuxClient` local removido (ya no se usa); import de `colorForStatus` removido.
- `src/orchestrator/launch.js` - Prefijo `KODO_ORCHESTRATOR=1` como primer elemento del array `claudeCmd`.
- `src/hooks/session-end.js` - Imports de `cmux`/`colorForStatus`/`buildStopNudgeText`; `deps.cmux` inyectable (default lazy); tres efectos de cierre insertados tras `performTerminalCleanup`.
- `test/hooks/stop-idempotency.test.js` - Nuevo describe HYG-01 (gate abierto/cerrado con repo git tmp) + comentarios de idempotencia actualizados.
- `test/hooks/session-end.test.js` - `makeCmuxStub` + inyección de stub en todos los tests que alcanzan el cleanup; nuevo describe de efectos HYG-04 (orden post-backstop + never-throws).
- `test/skill-auto-commit.test.js` - Canon spawnSync actualizado: inyecta el marcador (A/B) y añade el caso C (skip sin marcador).

## Decisions Made
- **Orden `-m` antes de `-- <pathspec>` en el commit:** el ejemplo de RESEARCH/PATTERNS proponía `git commit -- .claude/skills/kodo-orchestrate/ -m "…"`, que git interpreta con `-m` y el mensaje como pathspecs (error "ruta no concordó"). Se corrigió a `git commit -m "…" -- .claude/skills/kodo-orchestrate/`. Add y commit conservan el pathspec (criterio de éxito #1).
- **KODO_ROOT a nivel de módulo en el test HYG-01:** al importar `session-end.js` ahora se carga `stop.js` transitivamente (por `buildStopNudgeText`), congelando `KODO_ROOT` antes de que un `before()` pudiera override-arlo. El override se fija en la evaluación del fichero (antes de que ningún test ejecute su import dinámico).
- **Nudge inline en session-end.js:** se reusó el match `/(workspace:\d+)\s+kodo-orchestrator/` inline (copia fiel del código original de `stop.js`) en vez de importar `findOrchestratorRef` de `launch.js`, para no acoplar `session-end.js` a `launch.js` (config/skill-sync).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Orden de `-m`/`--` en el comando de commit del auto-commit**
- **Found during:** Task 1 (HYG-01)
- **Issue:** El comando de commit propuesto (`git commit -- <pathspec> -m "<msg>"`) es inválido: tras `--` git trata `-m` y el mensaje como rutas → el commit fallaba con "ruta especificada '-m' no concordó".
- **Fix:** Reordenado a `git commit -m "<msg>" -- <pathspec>`, conservando el pathspec en add y commit.
- **Files modified:** src/hooks/stop.js
- **Verification:** El test HYG-01 con `KODO_ORCHESTRATOR=1` crea exactamente un commit que toca solo `.claude/skills/kodo-orchestrate/skill.md`.
- **Committed in:** a3b7166 (Task 1 commit)

**2. [Rule 3 - Blocking] Guardrail canónico `skill-auto-commit.test.js` roto por el gate**
- **Found during:** Task 2 (verificación de suite completa)
- **Issue:** El test spawnSync `D-16` ejercita `handleOrchestratorStop` SIN `KODO_ORCHESTRATOR=1`; el nuevo gate hacía fallar los casos A (esperaba commit) y B (esperaba "no skill changes"). El plan solo listaba `stop.test.js`/`stop-state-transition.test.js` como guardrails a tocar, pero este otro guardrail también depende del comportamiento.
- **Fix:** `runStopHookChild` inyecta `KODO_ORCHESTRATOR=1` por defecto (sesión orquestadora); nuevo caso C ejercita el skip sin el marcador. Comentario de cabecera actualizado (Phase 72 HYG-01).
- **Files modified:** test/skill-auto-commit.test.js
- **Verification:** `node --test test/skill-auto-commit.test.js` → 3/3 pass.
- **Committed in:** 4364aea (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking guardrail)
**Impact on plan:** Ambos auto-fixes necesarios para correctitud (el commit no funcionaba) y para no dejar un guardrail rojo. Sin scope creep — solo se tocaron ficheros del área de los hooks de cierre.

## Issues Encountered
- **Fragilidad de orden de carga de módulos en tests:** `session-end.js` importando `stop.js` cambió el orden de evaluación y expuso que el override de `KODO_ROOT` en `before()` llegaba tarde. Resuelto fijando el override a nivel de módulo. Documentado como decisión.
- **Suite completa:** 6 fallos residuales en tests de concurrencia/timing (`gsd-lock-race`, `state-lock-concurrency`, `polling-verbose`, `app-setup`) — PRE-EXISTENTES y flaky bajo carga paralela (pasan en aislamiento y en el baseline `ac149eb`). Fuera del alcance de este plan (no tocan `stop.js`/`session-end.js`/`launch.js`/`gsd/lock.js`). Los 4 ficheros guardrail del plan + el canon spawnSync pasan al 100%.

## User Setup Required
None - no external service configuration required. (La env var `KODO_ORCHESTRATOR=1` la inyecta `launchOrchestrator` automáticamente; se documentará en el README como parte de HYG-08.)

## Next Phase Readiness
- HYG-01 y HYG-04 cerrados. `SessionEnd` ya concentra tanto el backstop DELIV-04 como los efectos de cierre — Phase 73 (debounce del nudge) puede construir sobre este callsite unificado.
- **Verificación empírica pendiente (D5):** confirmar en dogfooding que `process.env.KODO_ORCHESTRATOR === '1'` llega al proceso del hook al lanzar el orquestador real. Modo de fallo seguro (sin var → skip). Fallback disponible: marcador en fichero vía `persistOrchestratorRef` si la propagación shell fallara.

## Self-Check: PASSED

- Files modified (6/6 FOUND): src/hooks/stop.js, src/orchestrator/launch.js, src/hooks/session-end.js, test/hooks/stop-idempotency.test.js, test/hooks/session-end.test.js, test/skill-auto-commit.test.js
- Commits (2/2 FOUND): a3b7166, 4364aea
- Guardrail suite: `node --test test/hooks/session-end.test.js test/hooks/stop-idempotency.test.js test/stop.test.js test/stop-state-transition.test.js` → 48/48 pass; `test/skill-auto-commit.test.js` → 3/3 pass

---
*Phase: 72-higiene-dx-y-verdad-documental*
*Completed: 2026-07-13*
