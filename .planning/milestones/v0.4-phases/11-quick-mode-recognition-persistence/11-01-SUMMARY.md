---
phase: 11-quick-mode-recognition-persistence
plan: 01
status: complete
completed: 2026-04-28
files_modified:
  - src/labels.js
key_files:
  created: []
  modified:
    - src/labels.js
---

## Resumen

Añadido el helper puro `getSessionMode(session)` a `src/labels.js` (líneas 60-85), que devuelve el modo GSD (`'full' | 'quick' | null`) de una sesión persistida en `state.json`.

La regla D-08 ("legacy `gsd:true` sin `gsd_mode` == `full`") queda centralizada en este único callsite vía `session.gsd_mode || 'full'`. Defensivo ante `null`/`undefined`/`{}`/`{gsd:false}` (devuelve `null` sin lanzar).

El commit incluye también la WIP previa de `getGsdMode` (líneas 53-58, helper hermano para flags de label) — ambos helpers viven juntos como taxonomía única de modos GSD.

## Cambios

| Símbolo | Localización | Tipo |
|---|---|---|
| `getGsdMode(flags)` | `src/labels.js:53-58` | export nuevo (WIP previa) |
| `getSessionMode(session)` | `src/labels.js:82-85` | export nuevo (este plan) |

## Verificación

- `node --check src/labels.js` → exit 0
- `grep -c "export function (parseKodoLabels|getGsdMode|getSessionMode)" src/labels.js` → 3 funciones exportadas
- `grep -c "^import" src/labels.js` → 0 (helper puro, sin imports)
- Bloque `<verify>` automated del plan: imprime `OK` con los 8 casos (quick, full, legacy, empty, null, undefined, gsd:false, sin campo)
- `node --test test/labels.test.js` → 10/10 tests pasan (sin regresión sobre `parseKodoLabels`)

## Hand-off

- **Phase 12 (hooks SessionStart/Stop)**: pueden importar `getSessionMode` desde `../labels.js` junto a `parseKodoLabels`/`getGsdMode` en una sola línea: `import { parseKodoLabels, getGsdMode, getSessionMode } from '../labels.js';`. La regla D-08 ya queda absorbida — no replicar el `|| 'full'` en cada hook.
- **Phase 13 (tests QUICK-08)**: `getSessionMode` es testeable aislado contra el typedef `Session` de `src/session/state.js`. Los 7 casos del bloque `<behavior>` del plan son los fixtures sugeridos.
- **Plan 11-02 (Wave 1, paralelo)**: persiste `gsd_mode` en sesiones nuevas vía `buildSessionFromTask`. El helper `getSessionMode` cubre tanto sesiones nuevas (con `gsd_mode` explícito) como legacy (sin campo, fallback a `'full'`).
