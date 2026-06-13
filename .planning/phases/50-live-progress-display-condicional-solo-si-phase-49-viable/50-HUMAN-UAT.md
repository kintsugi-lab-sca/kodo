---
status: partial
phase: 50-live-progress-display-condicional-solo-si-phase-49-viable
source: [50-VERIFICATION.md]
started: 2026-06-13T07:33:45Z
updated: 2026-06-13T07:33:45Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Columna `prog` en vivo en la TUI
expected: Con una sesión activa que usa TaskCreate, el dashboard muestra la columna condicional `prog` con `N/M` correcto; la columna aparece solo cuando alguna sesión reporta progreso y recupera el ancho cuando ninguna (mold `deriveAnyGsd`). Estados degradados honestos: `—` sin progreso, `?` + keep-last-good en fallo transiente, `N/M✓` al completar. Cero color (solo `dim`).
result: [pending]

### 2. installHooks no-clobber en settings.json multi-herramienta real
expected: `installHooks()` registra `TaskCreated`/`TaskCompleted` en un `~/.claude/settings.json` real con hooks de terceros (gsd/codeisland/orca) sin clobber de SessionStart/Stop ni de los hooks ajenos; `uninstall` los limpia sin tocar el resto.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
