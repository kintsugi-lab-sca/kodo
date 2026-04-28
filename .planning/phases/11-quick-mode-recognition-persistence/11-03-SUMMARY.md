---
phase: 11-quick-mode-recognition-persistence
plan: 03
status: complete
completed: 2026-04-28
files_modified:
  - src/logger-events.js
  - src/triggers/dispatcher.js
  - test/logger-events.test.js
key_files:
  created: []
  modified:
    - src/logger-events.js
    - src/triggers/dispatcher.js
    - test/logger-events.test.js
---

## Resumen

Cierra el control-plane de telemetría QUICK-01 / QUICK-02. El dispatcher emite ahora el campo `mode: 'full'|'quick'` en los 4 callsites GSD (success, bootstrap, fail-closed warn, tolerated info). El literal `log.info('gsd.bootstrap', ...)` queda lifted al helper `gsdBootstrap`, completando la migración a la taxonomía cerrada (D-14). Las firmas tipadas de `gsdPhaseResolved` y `gsdBootstrap` aceptan `mode` como required field. Los tests cubren ambos modos para ambos helpers.

## Cambios

### `src/logger-events.js`

| Helper | Nueva firma | Cambio |
|---|---|---|
| `gsdPhaseResolved` | `{ phase_id, match_heading, mode }` | Añade `mode: fields.mode` al payload (D-05) |
| `gsdBootstrap` | `{ project_path, brief_empty, mode }` | Añade `brief_empty` (reconcilia el shape que el dispatcher emitía literalmente en Phase 9) y `mode` (D-07) |

JSDoc en español documentando las decisiones D-05/D-07/D-14.

### `src/triggers/dispatcher.js`

Cuatro callsites GSD ahora distinguen modo:

| Callsite | Línea aprox | NDJSON shape final |
|---|---|---|
| Success match | 230-238 | `gsd.phase.resolved` info, `phase_id`, `match_heading`, **`mode`** |
| Bootstrap | 239-248 | `gsd.bootstrap` info (vía `gsdBootstrap` helper, no literal), `project_path`, `brief_empty`, **`mode`** |
| Fail-closed warn | 195-203 | `gsd.phase.resolved` warn, `matched:false`, `error_code`, `detail`, `task_ref`, **`mode`** |
| **Tolerated info (nuevo)** | 169-187 | `gsd.phase.resolved` info, `matched:false`, `code:'no-match'`, `tolerated:true`, **`mode:'quick'`**, `task_ref` |

Dynamic import extendido (línea 219): `{ gsdPhaseResolved, gsdBootstrap } = await import('../logger-events.js')`.

Divergencia intencional `error_code` (warn fail-closed) vs `code` + `tolerated:true` (info tolerated):
- `error_code` significa "fail-closed, dispatch abortó"
- `code` + `tolerated:true` significa "condición tolerada, dispatch continuó"
- Reconciliar a un solo nombre rompería esa diferencia semántica que `kodo logs` puede explotar para distinguir incidentes reales de condiciones esperadas en quick mode.

### `test/logger-events.test.js`

Bloque LOG-09 ampliado de 2 → 4 tests para los helpers GSD:
- `gsdPhaseResolved` × `mode='full'` (test extendido)
- `gsdPhaseResolved` × `mode='quick'` (test nuevo)
- `gsdBootstrap` × `brief_empty=false`, `mode='full'` (test extendido)
- `gsdBootstrap` × `brief_empty=true`, `mode='quick'` (test nuevo)

Total: 12/12 tests del archivo verde (incluyendo los 4 nuevos).

## Verificación

- `node --check src/logger-events.js` → exit 0
- `node --check src/triggers/dispatcher.js` → exit 0
- `node --check test/logger-events.test.js` → exit 0
- `node --test test/logger-events.test.js` → 12/12 pasan
- `node --test test/dispatcher.test.js` → 21/21 pasan
- **Suite completa `node --test`** → 372 pass, 0 fail, 1 skip (245s)

Greps acceptance criteria del Task 2:
- `mode: (gsdMode|'quick'|'full')` en dispatcher → 4 ocurrencias (los 4 callsites)
- `log.info('gsd.bootstrap'` literal → 0 (lifted al helper)
- `tolerated: true` → 1 ocurrencia (info emit nuevo)
- `code: 'no-match'` → 1 ocurrencia (info emit; warn conserva `error_code`)
- `matched: false` → 2 ocurrencias (1 info tolerated + 1 warn fail-closed)

## Hand-off

- **Phase 12 (hooks SessionStart/Stop)**: todos los eventos GSD del dispatcher distinguen modo en NDJSON. Los hooks pueden filtrar `kodo logs --event-type gsd.phase.resolved --json | jq 'select(.mode=="quick")'` para reconstruir comportamiento por modo. La taxonomía cerrada `EVENTS` (8 tipos) sigue intacta.
- **Phase 13 (tests QUICK-08)**: `test/dispatcher.test.js` necesita matriz `quick × {match, no-match, roadmap-missing, multi-match, bootstrap}` con assertions sobre `mode` y la divergencia `code` vs `error_code`. `test/manager.test.js` ya cubre `quick × {flags variants}` (Plan 02).
- **D-14 invariante preservado**: el dispatcher sigue siendo la única fuente de `gsd.phase.resolved` y `gsd.bootstrap`. Ningún otro módulo emite estos eventos. El lift `log.info('gsd.bootstrap', ...)` → `gsdBootstrap(...)` cierra la última grieta de Phase 9.
