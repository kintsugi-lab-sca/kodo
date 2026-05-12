---
phase: 21-skill-sync-cli-auto-sync
plan: 02
subsystem: skill-sync
tags: [auto-sync, orchestrator, fail-open, ndjson, cwd-preservation, kodo-root-override]
dependency_graph:
  requires:
    - phase: 21-skill-sync-cli-auto-sync (Plan 01)
      provides: "syncSkill (pure), skillSyncAuto/Error helpers, EVENTS.SKILL_SYNC_AUTO[_ERROR]"
    - phase: 999.1-skill-kodo-orchestrate-al-repo
      provides: "D-04/D-05/D-06 cwd=repo invariant (preserved by Phase 21 — no modification)"
    - phase: 19-worktree-cleanup-integration
      provides: "D-03 fail-open + D-10 NDJSON event helpers patrón (reusado literalmente)"
  provides:
    - "launchOrchestrator auto-sync hook fail-open before cmux.listWorkspaces() (SKILL-02)"
    - "KODO_ROOT_FOR_SKILL = process.env.KODO_ROOT || process.cwd() (mismo patrón src/hooks/stop.js:20)"
    - "skill.sync.auto NDJSON emission on drift (status='ok'); silence on noop (D-03b)"
    - "skill.sync.auto.error NDJSON emission + console.error outer-catch fail-open"
    - "5 in-process tests (memSink DI) — A/B/C auto-sync + D source-hygiene + E SKILL-03 invariante"
  affects:
    - "Phase 22+ (cualquier feature que toque launchOrchestrator hereda el hook como side-effect previo)"
    - "future kodo skill diff/list (D-08 SoSoT module ya cubre el grafo de callsites; nuevos consumers añadirían a la lista D-08b)"
tech-stack:
  added: []
  patterns:
    - "Outer try/catch fail-open con console.error (Phase 19 D-03 patrón — mirror de stop.js:359-362)"
    - "KODO_ROOT env override para test isolation (Pattern C — Phase 999.1 D-16 patrón)"
    - "Caller-decides event emission per status (D-08 SoSoT: syncSkill puro, caller emite)"
    - "in-process DI test con memSink (Pattern §makeMemSink — mirror test/gsd-verify-integration.test.js:91-101)"
    - "Insertion ANTES de cmux.listWorkspaces (no antes de newWorkspace) para cubrir refresh path"
key-files:
  created:
    - "test/orchestrator-auto-sync.test.js (198 LOC) — 5 tests A/B/C/D/E in-process DI"
  modified:
    - "src/orchestrator/launch.js (+38 LOC) — 3 imports + 1 constante + 28 LOC bloque auto-sync"
key-decisions:
  - "D-03 implemented: outer try/catch fail-open con console.error (defense in depth); orchestrator NO crashea si syncSkill throw"
  - "D-03b implemented: silencio total en noop — solo emit en status='ok' o 'error', NO en 'noop' (evita ruido por launch)"
  - "D-05c implemented: auto-sync NUNCA pasa prune; verificable por grep negativo (0 matches de `syncSkill([^)]*prune:\\s*true`)"
  - "D-08b implemented: cross-callsite source-hygiene — exactamente 2 importers de syncSkill (CLI + launch); blindado por Test D"
  - "D-10 implemented: SKILL-03 invariante — bloque NO modifica process.cwd() ni args de cmux.newWorkspace; NO lee ~/.claude/skills/.../skill.md (Test E regex negativos)"
  - "Insertion point: entre L40 y L42 (ANTES de cmux.listWorkspaces L45), NO antes de cmux.newWorkspace L70 — cubre tanto first-launch como refresh-existing path"
patterns-established:
  - "Auto-sync hook fail-open: inner try/catch per-status branch + outer try/catch defense in depth (Phase 19 D-03 mold)"
  - "KODO_ROOT_FOR_SKILL: env override que defaultea a process.cwd() (test isolation via spawnSync env)"
  - "Test source-hygiene cross-callsite: grep -rl + assert.deepEqual sobre sorted importers (mirror test/dispatcher-isolation.test.js)"
  - "Test SKILL invariant: regex negativos sobre stripComments(source) para asegurar paths prohibidos no aparecen en runtime code"
requirements-completed: [SKILL-02, SKILL-03]
metrics:
  duration_minutes: 18
  tasks_completed: 2
  files_touched: 2
  loc_added: 236
  tests_added: 5
  completed_date: "2026-05-12"
---

# Phase 21 Plan 02: Auto-Sync Hook in launchOrchestrator Summary

**Auto-sync fail-open block en `launchOrchestrator` (entre L40 y L42, ANTES de `cmux.listWorkspaces()`) consumiendo el módulo `syncSkill` de Plan 01 con emit de `skill.sync.auto` / `skill.sync.auto.error` y silencio en noop (D-03b) — Phase 21 cierra al 100% SKILL-01..04.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-12T21:51:00Z (approx)
- **Completed:** 2026-05-12T22:09:21Z
- **Tasks:** 2 (Task 1 RED test file + Task 2 GREEN launch.js wiring)
- **Files modified:** 2 (1 created + 1 modified)

## Accomplishments

- **SKILL-02 satisfied** — `kodo orchestrate` ejecuta `syncSkill` automáticamente antes del primer side-effect cmux; drift → emit `skill.sync.auto` con `{source, dest, files_changed}`; sync error → `skill.sync.auto.error` + continuar (fail-open D-03); noop → silencio total (D-03b).
- **SKILL-03 satisfied** — la Constraint cwd=repo (Phase 999.1 D-04..D-06) queda preservada por construcción: el bloque NO modifica `process.cwd()` ni los args de `cmux.newWorkspace({ cwd: process.cwd() })`. Test E lo blinda con regex negativos sobre `stripComments(launch.js)`.
- **D-08b source-hygiene cabled** — exactamente 2 importers de `syncSkill` en `src/` (CLI handler + orchestrator launch). Test D ejerce `grep -rl from.*skill/sync src/` y rechaza cualquier tercer importer.
- **5 tests nuevos** in-process (memSink DI, no spawn) cubren los 3 branches del auto-sync (A/B/C) + cross-callsite (D) + invariante SKILL-03 (E). Suite global pasa de 603 → 608 pass / 0 fail / 1 skip.

## Task Commits

Each task was committed atomically (TDD RED → GREEN cycle):

1. **Task 1: RED — test/orchestrator-auto-sync.test.js (5 tests A..E)** — `2fe3a14` (test)
2. **Task 2: GREEN — wire auto-sync block in launchOrchestrator** — `def9dd7` (feat)

_Note: This is a `type: execute` plan with `tdd="true"` per-task (Task 1 = RED, Task 2 = GREEN). No REFACTOR commit was needed — the literal block from PATTERNS §src/orchestrator/launch.js was minimal already._

## Files Created/Modified

- `test/orchestrator-auto-sync.test.js` (created, 198 LOC) — 5 tests:
  - **A** drift detected → emit `skill.sync.auto` (info, `files_changed:2`).
  - **B** noop → 0 records de `skill.sync.*` (D-03b silencio).
  - **C** sync error (chmod 0o000 sobre `skill.md`) → emit `skill.sync.auto.error` (error level, `error` truthy).
  - **D** source-hygiene cross-callsite — `grep -rl from.*skill/sync src/` → exactamente `[src/cli/skill-sync.js, src/orchestrator/launch.js]`.
  - **E** SKILL-03 invariante — regex negativos confirman `launch.js` NO lee `.claude/skills/.../skill.md` ni `homedir() + skill.md`; regex positivo confirma `syncSkill(` presente.
- `src/orchestrator/launch.js` (modified, +38 LOC):
  - +3 imports: `homedir` (node:os), `syncSkill` (../skill/sync.js), `skillSyncAuto, skillSyncAutoError` (../logger-events.js).
  - +1 constante: `KODO_ROOT_FOR_SKILL = process.env.KODO_ROOT || process.cwd()` (Pattern C — mirror `src/hooks/stop.js:20`).
  - +28 LOC bloque auto-sync (try/inner-status-branch/catch-outer) entre L40 y L42 ORIGINAL — ahora en líneas ~46-73.

## Decisions Made

Solo se implementaron decisiones ya documentadas en `21-CONTEXT.md` (D-01..D-10). Ninguna decisión nueva tomada durante ejecución; el plan literal de Task 2 (PATTERNS §src/orchestrator/launch.js) fue suficiente.

Decisiones materializadas como código verificable por grep:

| Decisión | Implementación | Verificable por |
|----------|----------------|-----------------|
| D-03 | Outer try/catch + console.error fail-open | `grep -cE '\[kodo:orchestrator\] skill sync failed'` → 1 |
| D-03b | Solo emit en ok/error, NO en noop | Test B asserta 0 records de `skill.sync.*` en doble-run |
| D-05c | Auto-sync NUNCA pasa prune | `grep -cE 'syncSkill\([^)]*prune:\s*true'` → 0 |
| D-08 | syncSkill puro, caller emite | El bloque inspecciona `skillResult.status` y emite manualmente |
| D-08b | Exactamente 2 importers de syncSkill | Test D `grep -rl from.*skill/sync src/` → 2 archivos sorted |
| D-10 | cwd=repo preservada (Phase 999.1) | Test E regex negativos sobre `stripComments(launch.js)` |
| Phase 18 D-06 | Comentario `--worktree EXCLUIDO` byte-identical | `grep -c 'Phase 18 D-06: launchOrchestrator EXCLUIDO de --worktree'` → 1 |

## Deviations from Plan

**None** — plan ejecutado exactamente como escrito. Los 2 tasks corrieron sin ajustes de scope, sin auto-fixes de Rule 1/2/3, sin Rule 4 (no architectural changes).

**Nota sobre Test C setup:** El plan de Task 1 prescribe `chmodSync(dest, 0o500)` para forzar EACCES. Ese setup falla en macOS (POSIX permite sobreescribir archivos existentes aunque el dir parent esté `0o500`, mientras los archivos individuales sean writable) — driver documentado en `21-01-SUMMARY.md` §Deviation 1 durante Plan 01. Aplicamos directamente el ajuste ya validado por Plan 01: `chmodSync(join(dest, 'skill.md'), 0o000)` sobre el archivo concreto, lo que asegura que `readFileSync(destAbs)` para hash compare lance EACCES y `syncSkill` retorne `status='error'`. **NO es una desviación de Plan 02** — es la continuación literal del fix de Plan 01, ya integrado al cuerpo del plan via PATTERNS y RESEARCH; documentado aquí para trazabilidad.

## Issues Encountered

**Branch state al inicio:** El worktree branch arrancó en `b3f09ed` (pre-Phase-18) en lugar del base esperado `6960e0b`. El bloque `worktree_branch_check` prescribe `git reset --hard $base` si `merge-base != base`, pero la guarda con `[ ... ] && { ... }` no propagó correctamente el reset. Resolución: ejecuté `git reset --hard 6960e0b...` manualmente, lo que restauró el árbol con phase 21 dir presente. **No es bug del plan** — es interacción worktree harness vs. base assertion guard; el reset fue exitoso y el flujo continuó normalmente. Sin impacto sobre los criterios de éxito.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Plan tests | `node --test test/orchestrator-auto-sync.test.js` | 5 pass / 0 fail |
| Cross-callsite suite | `node --test test/orchestrator-launch-isolation.test.js test/orchestrator-auto-sync.test.js test/skill-sync.test.js test/logger-events.test.js` | 44 pass / 0 fail |
| Global regression | `npm test` | 608 pass / 0 fail / 1 skipped (+5 vs Plan 01 baseline 603) |
| Phase 18 D-06 byte-identical | `grep -c 'Phase 18 D-06: launchOrchestrator EXCLUIDO de --worktree' src/orchestrator/launch.js` | 1 |
| syncSkill 2 importers | `grep -rl from.*skill/sync src/` | 2 (cli/skill-sync.js + orchestrator/launch.js) |
| Auto-sync NO prune | `grep -cE 'syncSkill\([^)]*prune:\s*true' src/orchestrator/launch.js` | 0 |
| cwd preserved | `grep -cE 'process\.cwd\(\)' src/orchestrator/launch.js` | 5 (incl. cmux.newWorkspace + KODO_ROOT fallback) |
| process.chdir absent | `grep -c 'process.chdir' src/orchestrator/launch.js` | 0 |
| Source canonical untouched | `git diff 6960e0b HEAD -- .claude/skills/kodo-orchestrate/` | empty |
| Forbidden paths untouched | `git diff 6960e0b HEAD -- .planning/STATE.md .planning/ROADMAP.md .planning/REQUIREMENTS.md src/skill/sync.js src/cli/skill-sync.js` | empty |

### Requirements coverage

- **SKILL-02** satisfied: `launchOrchestrator` ejecuta `syncSkill` ANTES de `cmux.listWorkspaces()` (línea 45 original, ahora 81 tras inserción); drift detectado emite `skill.sync.auto` (Test A); noop silencioso (Test B); error emite `skill.sync.auto.error` + continúa fail-open (Test C). Outer try/catch defense in depth con `console.error` (D-03 invariante).
- **SKILL-03** satisfied: el bloque NO modifica `process.cwd()` ni los args de `cmux.newWorkspace({ cwd: process.cwd() })` (línea 72 original); orchestrator NO lee `~/.claude/skills/kodo-orchestrate/skill.md` (Test E regex negativos sobre stripComments). La skill canonical sigue siendo la del repo por cwd auto-load (Phase 999.1 D-04/D-05/D-06 intacto).

## Phase 21 Closure

Tras Plan 02, **todas las requirements de Phase 21 quedan complete**:

| Req | Plan | Estado |
|-----|------|--------|
| SKILL-01 | Plan 01 | ✓ — `kodo skill sync` CLI con 4 exit codes |
| SKILL-02 | **Plan 02** | ✓ — auto-sync en launchOrchestrator + 2 events NDJSON |
| SKILL-03 | **Plan 02** | ✓ — Constraint cwd=repo preservada (verificable Test E) |
| SKILL-04 | Plan 01 | ✓ — 4 escenarios spawn real con stderr canonical |

**Drift residual operacional:** El symlink legacy en `~/.claude/skills/kodo-orchestrate` (driver del usuario actual — Phase 999.1 residuo) será resuelto en la PRIMERA ejecución real de `kodo orchestrate` o `kodo skill sync` tras merge a main (D-04 idempotente, verificado por Plan 01 Test §legacy-symlink). NO requiere acción manual.

## Self-Check: PASSED

- `test/orchestrator-auto-sync.test.js` — FOUND (`[ -f ... ]` confirmado).
- `src/orchestrator/launch.js` — modified (+38 LOC, diff stat verificado).
- Commit `2fe3a14` — FOUND in `git log --oneline -5`.
- Commit `def9dd7` — FOUND in `git log --oneline -5`.
- Plan tests: 5/5 pass; global suite: 608 pass / 0 fail / 1 skipped.
- Forbidden paths: `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.claude/skills/kodo-orchestrate/`, `src/skill/sync.js`, `src/cli/skill-sync.js` — all empty `git diff 6960e0b HEAD -- ...`.
- Phase 18 D-06 comment: 1 match (preserved byte-identical).
- D-08b cross-callsite: exactly 2 importers (`src/cli/skill-sync.js` + `src/orchestrator/launch.js`).
- D-10 cwd preservation: `process.chdir` absent; `cwd: process.cwd()` preserved on cmux.newWorkspace.

## Next Phase Readiness

- **Phase 21 = COMPLETE**. SKILL-01..04 al 100%. ROADMAP §Phase 21 puede marcarse `done` por el orquestador.
- Hook auto-sync queda activo: cada `kodo orchestrate` ejecutará `syncSkill` fail-open. Operacionalmente NO requiere docs nuevos para el usuario — el comportamiento es invisible salvo NDJSON.
- Phase 22 (tech debt v0.5 closure) puede arrancar sin blockers de Phase 21.

---
*Phase: 21-skill-sync-cli-auto-sync*
*Plan: 02*
*Completed: 2026-05-12*
