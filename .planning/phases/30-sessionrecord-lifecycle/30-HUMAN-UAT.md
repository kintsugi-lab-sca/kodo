---
status: partial
phase: 30-sessionrecord-lifecycle
source: [30-VERIFICATION.md]
started: 2026-05-20T13:50:00Z
updated: 2026-05-20T13:50:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. `kodo gsd verify <session-id>` para sesión archivada (SC#1 READ flow #1)

expected: Retorna SessionRecord histórico (NO 'session not found'). Verify gate corre contra el VERIFICATION.md ya escrito antes de archivar. Postea comentario en el provider y transiciona el task si verdict pass. Exit 0.

result: [pending]

steps:
1. Lanzar una sesión GSD (`kodo dispatch <task-ref>` o `kodo launch <ref>`).
2. Dejar que el agente complete una phase (escriba VERIFICATION.md en el worktree).
3. Forzar el stop hook (cerrar la sesión claude o `kodo session stop <id>`) — esto mueve el SessionRecord a `state.history`.
4. Verificar con `cat ~/.kodo/state.json` que `sessions: {}` (vacío) y `history: [...]` contiene la sesión.
5. Ejecutar `kodo gsd verify <session-id>`.

why_human: Los tests unitarios LIFE-01 confirman que `findSession()` retorna match desde `state.history`. PERO no hay test E2E que ejecute la cadena completa `runGsdVerify → finalize → provider.getTask → addComment → updateTaskState` con sesión archivada. La cadena downstream podría fallar de forma no obvia (sesión history podría no tener `phase_id` resuelto si el agente nunca lo escribió antes de terminar, o `worktree_path` podría apuntar a directorio ya cleaneado por el stop hook).

### 2. `kodo logs --session-of <task-id>` para sesión archivada (SC#1 READ flow #2)

expected: Retorna logs del NDJSON file de la sesión cerrada (head-line `session.start` + cuerpo). Exit 0. Comportamiento idéntico al de sesiones vivas.

result: [pending]

steps:
1. Tras los pasos 1-4 del test #1, ejecutar `kodo logs --session-of <task-id>` (donde `<task-id>` es el task_ref humano tipo `KL-42`).

why_human: SUMMARY 30-01 documenta que `src/logs/session-lookup.js` quedó intacto (Option A) y cita cobertura indirecta via step-2 NDJSON head-line scan. El step-1 (`state.sessions` lookup directo) NO usa `findSession()` — no se beneficia de LIFE-01. Confirmar manualmente que el operator path completo cierra el desync ROMAN-132 para este CLI.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

(empty — pending human testing)
