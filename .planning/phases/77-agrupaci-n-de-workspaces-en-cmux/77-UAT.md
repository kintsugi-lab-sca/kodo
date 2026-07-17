---
status: complete
phase: 77-agrupaci-n-de-workspaces-en-cmux
source: [77-01-SUMMARY.md, 77-02-SUMMARY.md]
started: 2026-07-17T07:21:19Z
updated: 2026-07-17T07:28:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Confirmación de deliverables auto-cubiertos (77-01)
expected: Los 3 deliverables del Plan 01 quedan cubiertos por sus tests (D1 unit `test/cmux/client-args.test.js`, D2/D3 walker `test/host/cmux-isolation.test.js`), sin checkpoint manual propio — el operador confirma la lista.
result: pass

### 2. deriveExpectedGroupName por path resuelto (77-02 D1)
expected: Deriva `IDENTIFIER` con path==default y `IDENTIFIER/Módulo` con path propio; task.ref degenerado → null (unit `test/session/group-resolve.test.js`, pass)
result: pass
source: automated
coverage_id: D1

### 3. resolveWorkspaceGroup matching NFC first-wins (77-02 D2)
expected: Match nombre→ref NFC+lowercase+trim, first-wins en empate, never-throws con JSON malformado (unit, pass)
result: pass
source: automated
coverage_id: D2

### 4. Retry único sin --group ante TOCTOU (77-02 D3)
expected: Fallo con --group → exactamente un reintento sin --group; fallo sin --group → no reintenta; fallo del retry → propaga (unit, pass)
result: pass
source: automated
coverage_id: D3

### 5. Aterrizaje e2e: el workspace cae dentro del grupo en la sidebar (77-02 D4)
expected: Con la app cmux viva y un grupo cuyo nombre matchee (p. ej. `Kodo` o `SCRIBBA`), lanzar una tarea de ese proyecto → el workspace nuevo aparece DENTRO del grupo en la sidebar (y en `cmux workspace-group list --json` → member_workspace_refs). El launch resuelve el grupo en fresco, sin persistir refs ni ejecutar verbos de gestión.
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]

## Notes

- Cobertura #1602: 6/7 deliverables auto-cubiertos (77-01 completo + 77-02 D1-D3); D4 cae a checkpoint humano.
- Error de formato en 77-02-SUMMARY coverage D4: `kind: source-hygiene` no es un kind válido (unit/integration/e2e/automated_ui/manual_procedural/other) — fail-safe aplicado: D4 se presenta como checkpoint humano. Arreglable editando el SUMMARY (cosmético).
- Sin cold-start smoke test: ningún fichero tocado matchea los patrones de arranque (server/app/index/db/migrations).
