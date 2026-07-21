---
status: diagnosed
phase: 74-handoff-acumulativo-al-cierre
source: [74-01-SUMMARY.md, 74-02-SUMMARY.md, 74-03-SUMMARY.md, 74-04-SUMMARY.md, 74-05-SUMMARY.md, 74-06-SUMMARY.md]
started: 2026-07-20T09:25:42Z
updated: 2026-07-21T00:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cierre real con /exit escribe el handoff (LIVE-01/SC#1)
expected: Lanza una sesión kodo real contra una tarea y ciérrala con /exit. Abre ~/.kodo/plans/<task_id>.md: el fichero contiene un bloque `## Handoff <fecha-hora>` con **Hecho:** y **Pendiente:** (y **NEXT:** si el LLM lo escribió), aterrizado al cierre de la sesión. [Check manual #1 de 74-VERIFICATION.md]
result: pass

### 2. Segunda sesión acumula sin pisar (LIVE-02)
expected: Cierra una segunda sesión sobre la MISMA tarea. El plan ~/.kodo/plans/<task_id>.md tiene ahora DOS bloques `## Handoff`: el de la primera sesión sigue íntegro (no fue sobrescrito) y el nuevo se añadió al final.
result: pass

### 3. Backstop mecánico distinguible a simple vista (LIVE-03/SC#3)
expected: Provoca un cierre donde el LLM NO escribe su bloque de handoff (p. ej. /clear o un cierre inmediato). El bloque que aparece en el plan lleva el heading terminado en `— automático` (author=auto), sin línea **NEXT:**, y se distingue a simple vista de un bloque redactado por el LLM. [Check manual #2 de 74-VERIFICATION.md]
result: pass

### 4. state.json refleja puntero + NEXT tras el cierre (LIVE-04 end-to-end)
expected: Tras un cierre real, ~/.kodo/state.json contiene state.tasks[<task_id>] con plan_path apuntando a ~/.kodo/plans/<task_id>.md y next con el NEXT: de una línea (o null si ninguna sesión lo dejó nunca). Un cierre mecánico posterior NO borra un NEXT real previo.
result: issue
reported: "no existe esa clave en ningún sitio dentro de /Users/alex/.kodo/state.json"
severity: major

### 5. La instrucción de arranque pide preservar-y-appendear (LIVE-02, productor)
expected: Al arrancar una sesión kodo nueva, el contexto inyectado instruye "Si el fichero ya existe, NO lo sobrescribas: añade tu plan al final" y entrega el formato exacto del bloque de handoff con el session_id real de la sesión interpolado (marcador `kodo:handoff v=1 session=<id>`), no un placeholder.
result: issue
reported: "ROMAN-174 noha hecho nada parecido (gsd-quick"
severity: major

### 6. Un NEXT: real sobrevive a un cierre mecánico posterior (WR-02 / LIVE-04)
expected: Un NEXT: real de una sesión anterior sobrevive a un cierre mecánico posterior de la misma tarea (WR-02 / LIVE-04)
result: pass
source: automated
coverage_id: D1

### 7. Un NEXT: nuevo y no nulo sigue pisando al previo
expected: Un NEXT: nuevo y no nulo sigue pisando al previo — el fix no degenera en «el primero gana»
result: pass
source: automated
coverage_id: D2

### 8. El merge no reintroduce lost-update bajo carrera cross-process (T-74-16)
expected: El merge no reintroduce lost-update bajo carrera cross-process (T-74-16)
result: pass
source: automated
coverage_id: D3

## Summary

total: 8
passed: 6
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-74-4
  truth: "Tras un cierre real, ~/.kodo/state.json contiene state.tasks[<task_id>] con plan_path y next (LIVE-04 end-to-end)"
  status: failed
  reason: "User reported: no existe esa clave en ningún sitio dentro de /Users/alex/.kodo/state.json"
  severity: major
  test: 4
  root_cause: "El hook SessionEnd de kodo no está registrado en ~/.claude/settings.json (solo SessionStart y Stop lo están). writeHandoff → upsertTaskHandoff nunca se ejecuta en cierres reales: cero telemetría handoff_saved/failed de sesiones reales, cero bloques author=auto en ~26 planes, state.tasks siempre vacío. El código de la Phase 74 es correcto; es un gap de registro/instalación (install.js declara los 3 hooks pero el registro real quedó incompleto)."
  artifacts:
    - path: "~/.claude/settings.json"
      issue: "hooks.SessionEnd sin la entrada 'node <repo>/src/hooks/session-end.js'"
    - path: "src/hooks/install.js"
      issue: "instalador correcto e idempotente, pero nunca re-ejecutado tras añadir SessionEnd (Phase 58 LIFE-03)"
  missing:
    - "Registrar el hook SessionEnd de kodo en ~/.claude/settings.json (re-ejecutar install.js o equivalente)"
    - "kodo doctor: verificar presencia de los 3 hooks registrados vs KODO_HOOK_FILES (drift instalación↔settings)"
    - "Verificación post-fix: cierre real → state.tasks poblado + telemetría state.task.handoff_saved"
  debug_session: ".planning/debug/state-tasks-missing-live04.md"
- gap_id: G-74-5
  truth: "Al arrancar una sesión kodo (rama gsd-quick), el contexto instruye preservar-y-appendear el plan y entrega el formato de handoff con el session_id resuelto (LIVE-02)"
  status: resolved
  reason: "User reported: ROMAN-174 noha hecho nada parecido (gsd-quick"
  severity: major
  test: 5
  root_cause: "No es un bug: observación prematura. La sesión real de ROMAN-174 (e1cc7e31, 2026-07-20 14:39–14:48) cerró DESPUÉS del reporte y cumplió LIVE-02 de punta a punta: plan preservado y bloque '## Handoff … author=llm' appendeado con el formato exacto y el session_id interpolado (~/.kodo/plans/a09d786f-….md). Los planes se nombran por work item UUID, no por task_ref, lo que dificulta la verificación manual. El residuo real (sin backstop si el LLM no escribe) pertenece a G-74-4."
  resolved_by: "evidencia en ~/.kodo/plans/a09d786f-3c5f-4a3f-a18f-a98015b4878b.md (no requiere fix de código)"
  resolved_at: 2026-07-21
  artifacts: []
  missing: []
  debug_session: ".planning/debug/gsd-quick-handoff-instruction-roman174.md"
