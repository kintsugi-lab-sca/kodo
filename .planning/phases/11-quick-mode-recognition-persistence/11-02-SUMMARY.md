---
phase: 11-quick-mode-recognition-persistence
plan: 02
status: complete
completed: 2026-04-28
files_modified:
  - src/session/manager.js
  - src/session/state.js
  - test/manager.test.js
key_files:
  created: []
  modified:
    - src/session/manager.js
    - src/session/state.js
    - test/manager.test.js
---

## Resumen

Cierra el data-plane de QUICK-03 / QUICK-04 dentro del session manager. El manager ahora deriva el modo GSD localmente vía `getGsdMode(flags)` y persiste `gsd_mode` junto a `gsd:true` en cada sesión nueva. `buildClaudeCommand` deriva `skipPerms` del mismo helper en lugar del literal `flags.includes('gsd')`, extendiendo el contrato del commit `004995c` a `kodo:gsd-quick` con un solo punto de cambio futuro.

## Cambios

### `src/session/manager.js`

| Zona | Línea(s) | Cambio |
|---|---|---|
| Import | 5 | `import { parseKodoLabels, getGsdMode } from '../labels.js';` |
| `buildSessionFromTask` body | 28-31 | Nueva línea `const gsdMode = getGsdMode(flags);` con comentario D-03 |
| `buildSessionFromTask` spread | 47-52 | Reemplaza `...(flags?.includes('gsd') ? { gsd: true } : {})` por `...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {})` (D-03/D-04) |
| `buildClaudeCommand` skipPerms | 264-268 | Reemplaza `kodoFlags.includes('yolo') \|\| kodoFlags.includes('gsd')` por `kodoFlags.includes('yolo') \|\| getGsdMode(kodoFlags) !== null` (D-01/D-02) |

### `src/session/state.js`

Typedef `Session` ampliado en JSDoc (línea 26) con `gsd_mode?: 'full'|'quick'`. WIP previa, commiteada junto a Plan 02 porque manager.js es quien persiste el campo.

### `test/manager.test.js`

Test source-hygiene `kodo:gsd implies --dangerously-skip-permissions` (Phase 8 commit 004995c) actualizado para reflejar el nuevo contrato:
- Verifica `getGsdMode(kodoFlags) !== null` en lugar del literal viejo
- Blinda que el literal viejo NO regrese (regresión de D-01)
- Blinda el orden short-circuit `yolo || getGsdMode` (`<specifics>` Phase 11)

## Verificación

Validación dinámica con fixtures `node -e "..."` cubrió 5 casos de `buildSessionFromTask`:

| Input flags | Expected `gsd` | Expected `gsd_mode` | Resultado |
|---|---|---|---|
| `['gsd-quick']` | `true` | `'quick'` | OK |
| `['gsd']` | `true` | `'full'` | OK |
| `['gsd','gsd-quick']` | `true` | `'quick'` (precedencia) | OK |
| `[]` | omitido | omitido | OK |
| `undefined` | omitido | omitido | OK |

Suite tests:
- `node --test test/manager.test.js` → 23/23 pasan
- `node --test test/labels.test.js` → 10/10 pasan
- `node --test test/dispatcher.test.js` → 21/21 pasan
- `node --check src/session/manager.js` → exit 0

Greps acceptance criteria:
- `flags?.includes('gsd')` en manager.js → 0 ocurrencias (eliminado)
- `kodoFlags.includes('gsd')` en manager.js → 0 ocurrencias (eliminado)
- `...(phaseId ? { phase_id: phaseId } : {})` → 1 (intacto)
- `...(brief ? { brief } : {})` → 1 (intacto)
- Firma `buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, flags, phaseId, brief })` → intacta (D-03 explícito)

## Hand-off

- **Phase 12 (hooks SessionStart/Stop)**: pueden leer `session.gsd_mode` directamente desde `state.json` o usar `getSessionMode(session)` (Plan 01) para aplicar el fallback legacy `'full'`. Sesiones nuevas tienen `gsd_mode` explícito; sesiones legacy con `gsd:true` sin `gsd_mode` son leídas como `'full'` por el helper.
- **Plan 11-03 (Wave 1, paralelo)**: este plan cierra el data-plane (persistencia); Plan 03 cierra el control-plane (telemetría). Los dos cierres se observan independientemente — manager persiste, dispatcher emite eventos con `mode`.
- **Phase 13 (tests QUICK-08)**: añadir matriz `quick × {flags variants}` para `buildSessionFromTask` y `buildClaudeCommand` siguiendo los 6 cases del bloque `<behavior>` del plan.
