---
status: partial
phase: 19-worktree-cleanup-integration
source: [19-VERIFICATION.md]
started: 2026-05-12T17:32:00+02:00
updated: 2026-05-12T17:32:00+02:00
---

## Current Test

[awaiting human testing]

## Tests

### 1. Smoke orchestrator-led verify
expected: Arrancar `kodo orchestrator`, lanzar una sesión GSD full con `kodo run <task>`, dejar que termine. El nudge llega al orchestrator y `kodo gsd verify <session-id>` ejecutado por el orchestrator NO falla con `session not found`. El verify localiza el VERIFICATION.md y comenta en Plane; exit code 0.
result: [pending]

### 2. Smoke dirty-state en repo real
expected: Ejecutar una sesión que deje `working tree dirty`, dejar que stop hook corra. `<wt>.dirty/` existe en disco con los cambios del usuario, `git worktree list` lo lista, la branch sigue viva, accesible para inspección manual.
result: [pending]

### 3. Smoke legacy v0.5
expected: Cargar una sesión con `worktree_path: undefined` (state.json antiguo de v0.5). Stop hook no toca git y verify lee del project_path silently. Sin eventos `worktree.cleanup.*`; sin warn de fallback en logs.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
