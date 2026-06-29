---
status: complete
phase: 64-editor-de-proyectos-en-el-dashboard
source: [64-VERIFICATION.md]
started: 2026-06-29T16:32:50Z
updated: 2026-06-29T16:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Lista en vivo real del provider (PROJ-01)
expected: Pulsar `m` muestra la lista real del provider con estado de mapeo; sin secretos visibles.
result: pass

### 2. Edición y validación de ruta en TTY real (PROJ-02)
expected: |
  ↑/↓ a un proyecto, Enter → edición con cursor visible; backspace y ←/→ a mitad de string
  funcionan. Ruta existente → guarda + aviso de reinicio + la fila muestra la ruta. Ruta
  inexistente → footer rojo, NO se escribe, sigue editando.
result: pass

### 3. Degradación real con provider caído (PROJ-05)
expected: |
  Sin conexión o con API key inválida, relanzar y pulsar `m` → `projects-error` (panel rojo)
  con retry (`r`) / salir (`Esc`); el dashboard NO crashea y `~/.kodo/projects.json` queda INTACTO.
result: pass

### 4. Quitar mapeo + sub-overlay de módulos + persistencia (PROJ-03/PROJ-04 + PERSIST)
expected: |
  Sobre una fila mapeada pulsar `x` → vuelve a `[sin mapear]` + aviso de reinicio. Sobre un
  proyecto de Plane pulsar `m` (módulos) → sub-overlay; mapear la ruta de un módulo real → se
  guarda. GitHub / sin módulos → footer "este provider no tiene módulos", sin crash. `cat
  ~/.kodo/projects.json` → la entrada tiene la forma correcta (string o `{default, modules}`),
  JSON bien formado, las demás entradas intactas. Reiniciar `kodo server` y confirmar que el
  nuevo mapeo se aplica (aviso de reinicio efectivo, PERSIST-03).
result: pass
note: projects.json confirmado — forma dual preservada (entradas string + objeto coexisten), JSON bien formado.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
