---
phase: 80-carril-orquestador-reconciliaci-n-documental
plan: 02
subsystem: docs
tags: [kodo-orchestrate, prompt-template, sidebar-doctor, reconciliation, v0.17]

# Dependency graph
requires:
  - phase: 80-carril-orquestador-reconciliaci-n-documental (plan 01)
    provides: carril piggyback del sidebar doctor in-process en runCheckAndAct (ORCH-07)
  - phase: 79
    provides: motor sidebar-doctor (scan/execute, missing_group advisory)
  - phase: 74-77
    provides: handoff+NEXT:, superficie dashboard/nudge, pending_stale/pending_fetched_at, --group
provides:
  - skill.md canónica reconciliada — § Higiene del sidebar + flujo 5 de diagnóstico + § Estado vivo de la tarea con las 4 features v0.17
  - prompt.md fallback reconciliado — mención concisa del carril + reflejo conciso de las 4 features, referencia a la skill
affects: [orquestador LLM, futuras fases que editen skill/prompt del orquestador]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reparto documental asimétrico (D-09): skill canónica con detalle, prompt fallback conciso que referencia la skill"
    - "Disciplina anti-deriva HYG-08 (D-11): reconciliación quirúrgica features↔docs sin prometer features borradas"

key-files:
  created: []
  modified:
    - .claude/skills/kodo-orchestrate/skill.md
    - src/orchestrator/prompt.md

key-decisions:
  - "Ubicación: § Higiene del sidebar y § Estado vivo de la tarea tras § Diagnóstico; flujo 5 dentro de § Diagnóstico (numeración 1-4 intacta)"
  - "76 (pending_stale/pending_fetched_at) reflejado en § Estado vivo, no en § Higiene, por ser conteo y no gestión de grupos"

patterns-established:
  - "Asimetría de jerarquía skill↔prompt preservada: el prompt enumera y remite, no duplica el detalle (D-09)"

requirements-completed: [ORCH-08]

coverage:
  - id: D1
    description: "skill.md canónica menciona kodo sidebar doctor, § higiene del sidebar, flujo 5 de diagnóstico y refleja las 4 features v0.17 con detalle, sin prometer features borradas"
    requirement: "ORCH-08"
    verification:
      - kind: automated
        ref: "grep -q 'kodo sidebar doctor' && 'NEXT:' && 'pending_stale' && '--group' en skill.md → OK"
        status: pass
      - kind: manual_procedural
        ref: "checklist anti-deriva D-11 (VERIFICATION): missing_group advisory, sin nudge de refresh, carril no-trigger"
        status: unknown
    human_judgment: true
    rationale: "La fidelidad features↔docs (missing_group como advisory, sin prometer el nudge de refresh eliminado, asimetría D-09) es una auditoría de juicio manual por diseño (D-11, precedente HYG-08) — no un test automático de docs"
  - id: D2
    description: "prompt.md fallback menciona concisamente el carril del sidebar + referencia a la skill + refleja las 4 features v0.17, con el bloque reporting y los placeholders intactos (D-12)"
    requirement: "ORCH-08"
    verification:
      - kind: automated
        ref: "grep de tokens (sidebar doctor/NEXT:/pending_stale/--group) + marcadores BEGIN/END reporting + 3 placeholders {{provider}}/{{provider_name}}/{{mcp_tool}} → ALL_OK; git diff sin cambios dentro del bloque reporting"
        status: pass
      - kind: unit
        ref: "test/prompt.test.js test/prompt-file.test.js test/launch.test.js test/orchestrator-auto-sync.test.js → 36 pass / 0 fail (REPORT-03 gating incluido)"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-23
status: complete
---

# Phase 80 Plan 02: Reconciliación documental del orquestador (ORCH-08) Summary

**El skill `kodo-orchestrate` (canónico) y `src/orchestrator/prompt.md` (fallback degradado) dejan de estar desfasados: mencionan `kodo sidebar doctor`, la higiene automática del sidebar y las 4 features v0.17 (handoff+`NEXT:`, superficie dashboard/nudge, `pending_stale`/`pending_fetched_at`, `--group`), sin prometer features borradas y con el bloque reporting intacto.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-23T20:05:50Z
- **Completed:** 2026-07-23T20:08:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- **skill.md canónica (detalle, D-09):** nueva § "Higiene del sidebar" (carril automático 0-token en `kodo check`, sidebar NO-trigger con consistencia eventual, `kodo sidebar doctor` dry-run como diagnóstico, allowlist no-destructivo `loose→add`/`empty→ungroup`, `missing_group` advisory, launch path byte-idéntico + `--group` de Phase 77); nuevo flujo 5 en § Diagnóstico copiando la forma síntoma→comando; nueva § "Estado vivo de la tarea" con las 4 features v0.17 detalladas.
- **prompt.md fallback (conciso, D-09):** mención concisa del carril del sidebar + referencia explícita a la skill en § Loop de supervisión; reflejo enumerado de las 4 features v0.17 deferiendo el detalle a la skill.
- **D-12 preservado:** cero cambios dentro del bloque `<!-- BEGIN/END reporting -->` y los 3 placeholders `{{provider}}`/`{{provider_name}}`/`{{mcp_tool}}` presentes; 36 tests de prompt/launch/gating verdes.

## Task Commits

Cada tarea se committeó atómicamente:

1. **Task 1: skill.md canónica — § higiene + flujo 5 + 4 features v0.17 (detalle)** - `4b25013` (docs)
2. **Task 2: prompt.md fallback — mención concisa + referencia + features v0.17** - `8100e8d` (docs)

## Files Created/Modified
- `.claude/skills/kodo-orchestrate/skill.md` - +79/-1 líneas: § Higiene del sidebar, flujo 5 de diagnóstico, § Estado vivo de la tarea (v0.17). `## Adopción asistida` y sus mandatos shell-seguros sin tocar.
- `src/orchestrator/prompt.md` - +4 líneas en § Loop de supervisión (higiene del sidebar + estado vivo v0.17 concisos). Bloque reporting y placeholders intactos.

## Decisions Made
- **Ubicación jerárquica:** las dos secciones nuevas (§ Higiene del sidebar, § Estado vivo de la tarea) van tras § Diagnóstico; el flujo 5 vive dentro de § Diagnóstico preservando la numeración 1-4.
- **Feature 76 (pending) en § Estado vivo, no en § Higiene:** `pending_stale`/`pending_fetched_at` es frescura del conteo, no gestión de grupos — encaja con el resto del estado vivo v0.17.
- **Cross-reference sin duplicar:** el prompt enumera las features y remite a la skill; no se replicó el detalle (asimetría D-09 preservada).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. `syncSkill` auto-propaga la skill editada a `~/.claude/skills/` en el próximo `launchOrchestrator` (mecanismo existente; sin paso manual de copia).

## Next Phase Readiness
- ORCH-08 completo → cierra Phase 80 (ORCH-07 lo entregó el plan 80-01). Milestone v0.18 "Higiene del sidebar de cmux" listo para su gate de fase (`/gsd-verify-work`), que debe correr el checklist manual anti-deriva D-11 (fidelidad features↔docs: `missing_group` advisory, sin nudge de refresh, carril no-trigger, asimetría D-09, bloque reporting intacto).
- Sin blockers.

## Self-Check: PASSED

- FOUND: `.planning/phases/80-carril-orquestador-reconciliaci-n-documental/80-02-SUMMARY.md`
- FOUND commit: `4b25013` (Task 1 — skill.md)
- FOUND commit: `8100e8d` (Task 2 — prompt.md)
- Automated grep: OK (skill.md) / ALL_OK (prompt.md); reporting block sin cambios.
- Tests: 36 pass / 0 fail (prompt/launch/gating).

---
*Phase: 80-carril-orquestador-reconciliaci-n-documental*
*Completed: 2026-07-23*
