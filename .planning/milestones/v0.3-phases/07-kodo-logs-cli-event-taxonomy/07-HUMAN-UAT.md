---
status: partial
phase: 07-kodo-logs-cli-event-taxonomy
source: [07-VERIFICATION.md]
started: 2026-04-16T13:27:00Z
updated: 2026-04-16T13:27:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live `--follow` tail behaviour
expected: `kodo logs <real-session-id> --follow` muestra el dump completo y luego hace tail live de líneas NDJSON nuevas conforme se escriben; `Ctrl+C` sale limpiamente con `unwatchFile`.
result: [pending]

### 2. `session.start` real con todos los campos D-10
expected: Al arrancar una tarea Plane trackeada por kodo, la primera línea de `~/.kodo/logs/<session-id>.ndjson` es un record `session.start` con los 6 campos D-10: `session_id`, `plane_task_id`, `provider`, `project_path`, `transcript_path`, `started_at`. `transcript_path` apunta al JSONL real de Claude Code.
result: [pending]

### 3. `--session-of` end-to-end con sesión real
expected: Tras completarse una sesión real, `kodo logs --session-of <plane-task-id>` resuelve correctamente vía state.json (paso 1) o escaneo de head-line (paso 2) e imprime el log completo.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
