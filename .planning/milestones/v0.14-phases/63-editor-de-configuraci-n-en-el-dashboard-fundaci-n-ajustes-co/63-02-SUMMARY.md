---
phase: 63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co
plan: 02
subsystem: dashboard-tui
tags: [ink, text-input, config-editor, modes-machine, validation]
requires:
  - "src/config-validate.js: getEditableFields/validateField/getByPath/setByPath (Plan 01)"
provides:
  - "src/cli/dashboard/App.js: modos config/config-edit + text-input controlado (buffer+cursor) + validación/guardado por DI (loadConfigFn/onSaveConfig)"
  - "src/cli/dashboard/App.js: constantes CONFIG_OVERLAY_TITLE/CONFIG_SAVED_RESTART/CONFIG_SAVE_FAILED"
  - "src/cli/dashboard/SessionTable.js: renderConfigOverlay (lista de campos + cursor + footer de validación)"
affects:
  - "Plan 03 (cableado real index.js: inyectará loadConfig/saveConfig en App por props DI)"
  - "Phase 64 editor de proyectos (reusará el text-input + el overlay)"
tech-stack:
  added: []
  patterns:
    - "Text-input controlado in-house {buffer,cursor} con inserción en cursor (no append) + cursor por <Text inverse>"
    - "Sub-modos config/config-edit gateados ANTES del filter-mode (mold overlay/picker)"
    - "Error de validación en estado DEDICADO (configEditError, no focusError) para no perder teclas con clear-on-any-input"
    - "Edición sobre structuredClone del snapshot congelado (deep-clone, nunca aliasa DEFAULT_CONFIG)"
key-files:
  created:
    - test/dashboard-config.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - test/dashboard/app-focus.test.js
decisions:
  - "El aviso de reinicio (PERSIST-03) va en focusError/footerColor (transitorio, ya de vuelta en config); el error de validación/escritura va en configEditError (dedicado, persistente mientras se edita)"
  - "renderConfigOverlay pinta su propio footer de estado porque el early-return del overlay evita el errorLine normal de la tabla"
  - "drain() del test de config se endurece a 6 ciclos: ink re-suscribe el handler de useInput un render tarde tras una transición de modo"
metrics:
  duration_min: 15
  completed: 2026-06-29
  tasks: 3
  files: 4
status: complete
---

# Phase 63 Plan 02: Editor UI de configuración (modos config/config-edit + text-input) Summary

La 2ª ruptura consciente de "TUI read-only": el operador pulsa `e`, navega los 11 campos editables, edita con cursor/backspace/←→ sobre un `structuredClone` del snapshot congelado, un inválido se rechaza con footer rojo sin escribir y sin perder teclas, un válido guarda vía `onSaveConfig` (DI) y muestra el aviso de reinicio, Esc preserva la selección por `task_id`, y una escritura fallida deja el panel ink montado — todo sin exponer API keys, ensamblando los moldes maduros del dashboard (filter-mode, overlay/picker, focusError/footerColor) con el único componente nuevo: el text-input con cursor.

## What Was Built

- **`src/cli/dashboard/App.js` (modificado, quirúrgico):**
  - Import de `getEditableFields/validateField/getByPath/setByPath` de `../../config-validate.js` (Plan 01).
  - Props DI nuevas `loadConfigFn` (lee el snapshot al abrir) y `onSaveConfig` (escribe never-throws), con defaults inertes para tests del módulo (espejo de `onAdopt`/`onDerive`).
  - Estado nuevo: `configSnapshot` (clon congelado, D-04), `fieldCursor`, `buffer`, `cursor`, `configEditError` (estado DEDICADO, no `focusError` — Pitfall 2).
  - Handler `e` en `mode:'list'` → `setConfigSnapshot(structuredClone(loadConfigFn()))` (Pitfall 1: deep-clone OBLIGATORIO), `setMode('config')`, sin tocar `selectedTaskId` (UX-03 gratis).
  - Rama `mode:'config'` insertada ENTRE el bloque `confirm` y `filter` (orden D-03): Esc→list (selección intacta), ↑/↓ mueven `fieldCursor` con clamp sin wrap, Enter precarga el valor del campo en `buffer` y entra a `config-edit`.
  - Rama `mode:'config-edit'` (RESEARCH Pattern 1): Esc cancela sin guardar; ←/→ clamp del cursor; backspace||delete (ambos juntos, Pitfall 3) borran el char anterior; char imprimible se INSERTA en `cursor` (no append ciego); Enter → `validateField` → inválido pinta `configEditError` y sigue editando, válido → `setByPath(structuredClone(snapshot), path, value)` + `await onSaveConfig` + aviso de reinicio.
  - Constantes EXPORTADAS `CONFIG_OVERLAY_TITLE`, `CONFIG_SAVED_RESTART`, `CONFIG_SAVE_FAILED` (mold OVERLAY_*/ADOPT_*).
  - Footer de hints extendido con `· e config`.
- **`src/cli/dashboard/SessionTable.js` (modificado, quirúrgico):**
  - `renderConfigOverlay(snapshot, fieldCursor, mode, buffer, cursor, configEditError, focusError, footerColor)`: cabecera + lista de `getEditableFields` (label + valor read-only, fila activa resaltada); en `config-edit` la fila activa pinta el text-input con el char bajo el cursor invertido (`<Text inverse>` — color-isolation intacta); footer con `configEditError` (rojo) o el aviso de reinicio (`footerColor`).
  - Props nuevas `configSnapshot/fieldCursor/buffer/cursor/configEditError` + early-return `(mode==='config'||'config-edit') && configSnapshot`.
- **`test/dashboard-config.test.js` (nuevo):** 7 sub-tests de integración (render + stdin.write + lastFrame + unmount) cubriendo UX-01..04, CFG-05-UI, PERSIST-03/04 por DI (`loadConfigFn`/`onSaveConfig`), sin tocar `~/.kodo/` real.

## How to Verify

```bash
node --test test/dashboard-config.test.js   # 7 pass (los 6 comportamientos + PERSIST-04)
npm test                                      # 1601 pass, 0 fail, 1 skip (sin regresión)
node --test test/format-isolation.test.js     # color-isolation intacta (cursor = <Text inverse>)
```

## Key Decisions

- **Dos canales de footer en el editor:** el aviso de reinicio (PERSIST-03/D-10) va en `focusError`/`footerColor` (transitorio, ya de vuelta en `config` — el clear-on-any-input lo descarta con la próxima tecla, comportamiento deseado); el error de validación/escritura va en `configEditError` (estado DEDICADO, Pitfall 2) para que el clear-on-any-input NO consuma la siguiente tecla mientras el operador corrige.
- **`renderConfigOverlay` pinta su propio footer de estado** porque el early-return del overlay evita el `errorLine` normal de la tabla — sin esto, el aviso de reinicio/validación no se vería en modo config.
- **`drain()` del test de config a 6 ciclos:** ink re-suscribe el handler de `useInput` un render TARDE respecto al cambio de estado; con el drain de 2 (suficiente para overlays read-only) la primera tecla tras una transición de modo se descartaba. La implementación es correcta (verificado: con suficientes ciclos `opus8`→`opus`→`opuXs`); un terminal real tiene latencia humana de sobra entre teclas.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Aserción frágil del footer en `app-focus.test.js`**
- **Found during:** Task 3 (verificación `npm test`).
- **Issue:** el hint del footer se extendió con `· e config` (Task 2), lo que desplazó `q quit`; el test Phase 37 asertaba `/a adopt · q quit/` como contiguo (la misma fragilidad que el comentario de Phase 56 ya anticipaba).
- **Fix:** la aserción ahora valida `/a adopt · e config · q quit/` (el nuevo sufijo del hint restaurado), preservando la intención del test (el footer normal volvió tras limpiar `focusError`).
- **Files modified:** `test/dashboard/app-focus.test.js`
- **Commit:** 28a5cc8

## Threat Surface

Mitigaciones del `<threat_model>` aplicadas y verificadas por test:
- **T-63-03** (Information Disclosure): `renderConfigOverlay` itera SOLO `getEditableFields` (restringida por construcción) → ningún `api_key_env`/`base_url`/`workspace_slug` se renderiza (PERSIST-04, asertado en el test "el overlay NUNCA muestra ...").
- **T-63-08** (DoS): `configEditError` es estado dedicado (no `focusError`) → la edición no pierde teclas (asertado: tras un inválido, la siguiente tecla sigue editando); `onSaveConfig` envuelto en try/catch defensivo → el panel ink sigue montado ante escritura fallida (UX-04).
- **T-63-09** (Tampering): deep-clone OBLIGATORIO (`structuredClone`) antes de mutar tanto el snapshot al abrir como al guardar → jamás se contamina `DEFAULT_CONFIG` del módulo (Pitfall 1).
- **T-63-SC** (Tampering): cero dependencias nuevas (text-input in-house, D-01) — sin superficie de cadena de suministro. `package.json` intacto.

Sin superficie de seguridad nueva fuera del threat model.

## Self-Check: PASSED

- FOUND: test/dashboard-config.test.js
- FOUND (modificado): src/cli/dashboard/App.js (mode === 'config-edit')
- FOUND (modificado): src/cli/dashboard/SessionTable.js (renderConfigOverlay)
- Commits verificados: f9cdd84 (RED), 1566613 (App.js), 28a5cc8 (SessionTable + fix)
- `node --test test/dashboard-config.test.js`: 7 pass; `npm test`: 1601 pass / 0 fail.
- Color-isolation confirmada: cero import de picocolors en App.js/SessionTable.js; cursor por `<Text inverse>`.
