---
phase: 55-contrato-hostprovider-describesurface-cmux
plan: 01
subsystem: host-adapter
tags: [cmux, host-provider, surface-discovery, typeof-detected, fail-open, fixture-lock]
requires:
  - "src/host/cmux.js createCmuxHost (run DI, molde listWorkspaces)"
  - "src/host/interface.js (HOST_METHODS, getHost factory)"
  - "cmux CLI 0.64.16 (tree --all --json, surface resume show --json)"
provides:
  - "src/host/cmux.js listAgentSurfaces() — método OPCIONAL typeof-detected (FUERA de HOST_METHODS)"
  - "src/host/cmux.js normalizeSurface(raw) — helper puro D-02/D-05"
  - "src/host/interface.js @typedef AgentSurface (camelCase)"
  - "fixtures golden cmux 0.64.16: surface-tree.json + surface-resume-show.json"
affects:
  - "Phase 56 (DETECT-02): consumer hace typeof-detection + set-difference vs state.json"
tech-stack:
  added: []
  patterns:
    - "never-throws + logger inyectado + enumeración 2-pasos (tree → fan-out resume show)"
    - "typeof-detected optional method FUERA del contrato congelado"
    - "fixture-lock vía run DI con ruteo por argv (--surface ref)"
key-files:
  created:
    - "test/fixtures/cmux/surface-tree.json"
    - "test/fixtures/cmux/surface-resume-show.json"
  modified:
    - "src/host/interface.js"
    - "src/host/cmux.js"
    - "test/host/contract.test.js"
decisions:
  - "D-01: listAgentSurfaces() (enumeración → array), 2 pasos (tree → fan-out resume show)"
  - "D-02: shape camelCase {workspaceRef, cwd, sessionId, kind}; sessionId ← resume_binding.checkpoint_id"
  - "D-03: FUERA de HOST_METHODS (congelado en 4); detectado por typeof; NullHost lo deja AUSENTE"
  - "D-04: fixtures golden de cmux 0.64.16 (build 96), captura real del binario"
  - "D-05: never-throws fila-a-fila; try/catch DENTRO del bucle de fan-out"
  - "D-06: set-difference difere al consumer (Phase 56); adopt.js/reconcile.js intactos"
metrics:
  duration: "~25 min"
  completed: "2026-06-16"
  tasks: 3
  files_created: 2
  files_modified: 3
---

# Phase 55 Plan 01: Contrato `listAgentSurfaces()` (cmux) Summary

`listAgentSurfaces()` añadido a CmuxHost como método OPCIONAL typeof-detected (FUERA de HOST_METHODS, congelado en 4) que enumera las sesiones-agente ad-hoc de cmux 0.64.16 en dos pasos (`tree --all --json` → fan-out `surface resume show --json --surface <ref>`) y las devuelve como datos host-agnósticos `{ workspaceRef, cwd, sessionId, kind }`, never-throws y fail-open fila-a-fila. Implementa DETECT-01 íntegro.

## What Was Built

- **`normalizeSurface(raw)`** (scope de módulo, puro): mapea la salida cruda de `resume show` → `AgentSurface | null`. Devuelve `null` ante `cleared:true`, `resume_binding` ausente/null, `source != 'agent-hook'`, o `checkpoint_id`/`cwd` no-string (T-55-01). Mapeo D-02: `sessionId ← resume_binding.checkpoint_id`, `cwd ← resume_binding.cwd`, `kind ← resume_binding.kind`, `workspaceRef ← workspace_ref`. NO filtra por `kind` (D-05 — el consumer decide).
- **`extractSurfaceRefs(treeJson)`** (scope de módulo, puro): paso-1 de la enumeración; recorre `windows[].workspaces[].panes[].surface_refs[]` (+ fallback `panes[].surfaces[].ref`), defensivo ante claves ausentes, dedup por ref.
- **`listAgentSurfaces()`** (dentro de `createCmuxHost`): enumeración 2-pasos espejando el molde never-throws de `listWorkspaces`. Fallo del paso-1 (tree exec/parse) → `[]`. El try/catch del fan-out va DENTRO del bucle (fila-a-fila, Pitfall 3): un `resume show` individual que falla hace `continue`, jamás `return`. Añadido al objeto retornado (`_legacy` intacto).
- **`@typedef AgentSurface`** en `interface.js` (camelCase consciente D-02, alineado con `adoptSession`). `HOST_METHODS` sin cambios.
- **Fixtures golden** capturadas del binario real cmux **0.64.16 (96)** (NO 0.64.15, Pitfall 2): `surface-tree.json` (paso-1, 4 surface_refs) y `surface-resume-show.json` (mapa surfaceRef→show con los 4 casos D-05: adoptable, sin resume_binding, cleared:true, source≠agent-hook).
- **Tests** (`contract.test.js`): ambos routers de fixtures extendidos (ruteo por `--surface <ref>`); nuevo `describe('CmuxHost — listAgentSurfaces (DETECT-01)')` con asserts campo a campo, omisión D-05, fail-open tree→[], fila-a-fila skip, y test de typeof-degradación (null host no implementa el método).

## Fixture capture (D-04)

Capturada en vivo desde esta misma surface cmux (`kind:claude source:agent-hook`). `cmux --version` → `cmux 0.64.16 (96) [5321becb6]`. Capturas literales:
- `cmux tree --all --json --id-format both` → base de `surface-tree.json` (ampliado a 4 surface_refs).
- `cmux surface resume show --json --surface surface:1` → caso adoptable verbatim (checkpoint_id `c1c3ed6d-...`, cwd `/Users/alex/dev/klab/kodo`, kind `claude`, source `agent-hook`).
- `cmux surface resume show --json --surface surface:2` → caso real `resume_binding: null`.
- `cmux surface resume show --json --surface <UUID-cerrado>` → `Error: not_found` exit 1 (verifica la rama fila-a-fila).

Los casos `cleared:true` (surface:3) y `source:'environment'` (surface:4) derivan del mismo shape; `source:'environment'` es un valor real observado en `~/.cmuxterm/claude-hook-sessions.json` (`launchCommand.source`).

## Verification

- `node --test 'test/host/'*.test.js` → **48 pass / 0 fail**.
- `node --test test/host/contract.test.js` → 22 pass / 0 fail (incluye el golden DETECT-01).
- `node --test test/host/cmux-isolation.test.js` (walker SC#5) → 4 pass / 0 fail (verde sin tocar).
- Suite completa `node --test $(find test -name '*.test.js')` → **1382 pass / 0 fail** (1 test skipped no relacionado; `# fail 0`).
- `grep -c 'AgentSurface' src/host/interface.js` = 3 (≥1 ✓).
- `grep -v '^//' src/host/cmux.js | grep -c 'listAgentSurfaces'` = 3 (≥2 ✓).
- HOST_METHODS sigue exactamente `['listWorkspaces','selectWorkspace','isAlive','needsInput']` (assert verde).
- `adopt.js` / `reconcile.js` NO modificados (regla transversal LOCKED preservada).

## Deviations from Plan

### Aclaración de verificación (no es un cambio de código)

**1. [Aclaración] `grep -c "logger.js" src/host/cmux.js` devuelve 1, no 0**
- **Encontrado durante:** verificación de Task 2.
- **Detalle:** El acceptance criterion literal pide `grep -c "logger.js" == 0`. El único match es el comentario PRE-EXISTENTE de la línea 9 (`// NO importa src/logger.js (LOG-12)...`), no un import. No hay ningún `import ... from '...logger...'` en el archivo (verificado: `grep -E "^\s*import .* from .*logger" → 0`). El requisito sustantivo de LOG-12 (no importar el logger; inyectarlo vía `opts.logger`) se cumple íntegro. No se modificó el comentario (Regla 3 — cambio quirúrgico; no tocar lo que no está roto).

**2. [Aclaración] `node --test test/host/` (dir bare) reporta fail 1 en Node 22**
- **Encontrado durante:** verificación de Task 3.
- **Detalle:** El comando de verify del plan usa `node --test test/host/`; en Node v22.22.3 esa forma trata la ruta como un módulo a cargar (`Cannot find module .../test/host`), no como directorio a recorrer — es un artefacto de invocación, NO un fallo de código. La forma correcta `node --test 'test/host/'*.test.js` da 48/48 verde, y la suite completa (`find test -name '*.test.js'`) da `# fail 0`. No requiere cambio de código.

### Decisión de NullHost (Claude's Discretion D-03)

`createNullHost` se deja SIN stub de `listAgentSurfaces` (ausente) para documentar la rama de degradación que el consumer (Phase 56) ejercerá vía `typeof`. Añadido el test `typeof getHost('null').listAgentSurfaces !== 'function'`.

## Known Stubs

Ninguno. `listAgentSurfaces()` está completamente cableado a la enumeración 2-pasos sobre el `run` DI; no hay valores hardcodeados ni placeholders. El método devuelve `[]` solo por fail-open de diseño (D-05), no por stub.

## Self-Check: PASSED

- FOUND: test/fixtures/cmux/surface-tree.json
- FOUND: test/fixtures/cmux/surface-resume-show.json
- FOUND: src/host/interface.js (AgentSurface typedef)
- FOUND: src/host/cmux.js (listAgentSurfaces + normalizeSurface)
- FOUND: test/host/contract.test.js (golden describe DETECT-01)
- FOUND commit 45044f3 (Task 1: fixtures + typedef)
- FOUND commit 8b306ab (Task 2 RED: failing tests)
- FOUND commit a3922aa (Task 2 GREEN: implementación)
