// @ts-check
//
// src/cli/dashboard/ConfigEditor.js — KODO-40 (extracción de App.js).
//
// Editor de configuración in-dashboard (tecla `e`) + su copy literal-estable:
//   - `openConfigEditor` — apertura desde mode:'list' (snapshot congelado, Pitfall 1).
//   - `handleConfigInput` — mode:'config' (lista de campos navegable, valor read-only).
//   - `handleConfigEditInput` — mode:'config-edit' (text-input controlado + save).
//
// Extraído VERBATIM de App.js (Phase 63/67) sin cambio semántico: eran ramas del `useInput`
// monolítico y aquí son funciones que reciben un `ctx` con el estado y los setters que ya usaban
// por closure. App.js re-exporta todas las constantes, así que SessionTable.js y los tests
// `dashboard-config` / `dashboard-mask` siguen importándolas de App.js.
//
// Pitfall 11 (PERSIST-04): el VALOR de la API key jamás sale de `ctx.buffer` — ni a argv, ni a
// console/logger, ni a config.json (onSaveConfig), ni al overlay-snapshot. Solo a `onSaveApiKey`
// (→ writeEnvVar, escritura EN-PROCESO). El render enmascara vía `ctx.setMaskValue(true)`.

import { getEditableFields, validateField, getByPath, setByPath } from '../../config-validate.js';

// Phase 63 D-10/D-12/UX-01 (Plan 02): copy literal-estable del editor de config. EXPORTADAS para que
// los tests y SessionTable.js las importen y asseren equality sin duplicar strings (mismo patrón que
// OVERLAY_* / DISMISS_* / ADOPT_*). La LITERAL copy es el contrato (UI-SPEC §Copywriting, español).
//
// CONFIG_OVERLAY_TITLE: cabecera del overlay de configuración (UX-01/D-02).
// CONFIG_SAVED_RESTART (ámbar/yellow, PERSIST-03/D-10): aviso transitorio tras guardar con éxito —
//   los procesos vivos (server/daemon) no recargan en caliente, hay que reiniciarlos para aplicar.
// CONFIG_SAVE_FAILED (rojo, UX-04/D-12): la escritura falló; el config.json previo queda intacto
//   (never-throws, PERSIST-05). Va en configEditError (estado dedicado), no en focusError (Pitfall 2).
export const CONFIG_OVERLAY_TITLE = 'configuración de kodo';
export const CONFIG_SAVED_RESTART = 'guardado — reinicia el server/daemon para aplicar los cambios';
export const CONFIG_SAVE_FAILED = '[!] no se pudo guardar la config — el archivo previo quedó intacto';

// Phase 67 Plan 02 (SETUP-03/04 — masked API-key field, D-05/D-06/D-07/D-09). Copy literal-estable
// EXPORTADA para que tests y SessionTable.js la importen y asseren equality sin duplicar strings
// (mismo patrón CONFIG_*/PROJECTS_*). La API key vive en un renglón DEDICADO del overlay de config
// (append tras los 12 campos de getEditableFields — los secretos NUNCA entran a config.json ni a
// getEditableFields; PERSIST-04 intacto). El renglón enruta el save a `onSaveApiKey` → `writeEnvVar`.
//   - API_KEY_LABEL: etiqueta del renglón (NUNCA el nombre de la env var ni el valor — Pitfall 11).
//   - API_KEY_CONFIGURED / API_KEY_UNSET: indicador de PRESENCIA (D-09) — jamás el valor.
//   - API_KEY_SAVED_RESTART (ámbar): aviso transitorio tras guardar — sin hot-reload, hay que reiniciar.
//   - API_KEY_SAVE_FAILED (rojo): writeEnvVar devolvió false (fallo I/O) — el .env previo quedó intacto.
//   - API_KEY_INVALID (rojo): la key/valor no pasó validateEnvKey/validateEnvValue (Pitfall 14).
//   - API_KEY_NO_RAWMODE (dim): degradación non-TTY (Pitfall 16) — never-throws, no cuelga el first-run.
export const API_KEY_LABEL = 'API key del provider';
export const API_KEY_CONFIGURED = '[configurado]';
export const API_KEY_UNSET = '[sin configurar]';
export const API_KEY_SAVED_RESTART = 'API key guardada — reinicia el server/daemon para aplicar';
export const API_KEY_SAVE_FAILED = '[!] no se pudo guardar la API key — el .env previo quedó intacto';
export const API_KEY_INVALID = 'API key inválida (no puede estar vacía ni contener espacios, # o =)';
export const API_KEY_NO_RAWMODE = 'Usa `kodo config` para editar la API key';

// Default INERTE de loadConfigFn para los tests del módulo sin DI (el runtime real inyecta `loadConfig`
// de src/config.js, y los tests de integración inyectan su propio fixture). Shape mínimo que satisface
// getEditableFields (provider + los 12 paths editables) — sin secretos. NO es la fuente de verdad de
// runtime, solo evita un crash si App se renderiza sin la prop.
export const DEFAULT_EDITOR_CONFIG = {
  provider: 'plane',
  providers: { plane: { states: { trigger: 'In Progress', review: 'In review', done: 'Done' } } },
  cmux: { colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' } },
  claude: { default_model: 'opus', orchestrator_model: 'fable', max_parallel: 3 },
  server: { idle_threshold_min: 5, stuck_threshold_min: 30 },
};

/**
 * Phase 63 Plan 02 D-02/UX-01: abre el editor de config SIN salir del dashboard. Pitfall 1:
 * deep-clone OBLIGATORIO — `loadConfig` sin fichero devuelve `{...DEFAULT_CONFIG}` (spread
 * superficial), así que mutar campos anidados aliasearía el DEFAULT_CONFIG del módulo. El
 * structuredClone congela un snapshot propio del editor. NO se toca selectedTaskId (UX-03 gratis:
 * resolveSelection re-deriva la misma fila al volver). fieldCursor a 0, error limpio.
 *
 * @param {any} ctx
 */
export function openConfigEditor(ctx) {
  ctx.setConfigSnapshot(structuredClone(ctx.loadConfigFn()));
  ctx.setFieldCursor(0);
  ctx.setConfigEditError(null);
  ctx.setMode('config');
}

/**
 * Phase 63 Plan 02 (D-03): SUB-MODO config (lista de campos navegable, valor read-only). En App.js
 * se despacha ENTRE el bloque confirm y el de filter (espejo del orden D-03 "antes del mode-gate de
 * filtro"). Esc → list SIN tocar selectedTaskId (UX-03). ↑/↓ mueven fieldCursor con clamp sin wrap
 * (molde adoptCursor). Enter → precarga el valor del campo en el buffer y entra a config-edit.
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export function handleConfigInput(input, key, ctx) {
  const fields = getEditableFields(ctx.configSnapshot);
  if (key.escape) {
    ctx.setMode('list'); // UX-03: selectedTaskId intacto → el cursor de la tabla se conserva
    return;
  }
  if (key.upArrow) {
    ctx.setFieldCursor((/** @type {number} */ i) => Math.max(0, i - 1));
    return;
  }
  if (key.downArrow) {
    // Phase 67 Plan 02: el clamp sube a `fields.length` (NO length-1) para alcanzar el renglón
    // APPEND de la API key (índice = fields.length, fuera de getEditableFields — PERSIST-04).
    ctx.setFieldCursor((/** @type {number} */ i) => Math.min(fields.length, i + 1));
    return;
  }
  if (key.return) {
    // Phase 67 Plan 02 (SETUP-03, D-05/D-06/Pitfall 6/11): el renglón de API key (índice
    // fields.length) entra a config-edit ENMASCARADO con el buffer VACÍO — jamás se precarga el
    // secreto (ni se lee ni se pinta el valor actual). maskValue=true activa la pintura `•`.
    if (ctx.fieldCursor === fields.length) {
      ctx.resetTextInput(); // NUNCA precargar el secreto (Pitfall 6/11)
      ctx.setMaskValue(true);
      ctx.setConfigEditError(null);
      ctx.setMode('config-edit');
      return;
    }
    // Campo normal: precarga el valor ACTUAL (D-05). String(...) porque positiveInt es number en
    // el snapshot — el buffer es siempre texto. cursor al final ("append natural"). maskValue a
    // false por si venía colgado de una edición previa de la API key.
    const field = fields[ctx.fieldCursor];
    if (!field) return;
    const current = String(getByPath(ctx.configSnapshot, field.path) ?? '');
    ctx.loadTextInput(current);
    ctx.setMaskValue(false);
    ctx.setConfigEditError(null);
    ctx.setMode('config-edit');
    return;
  }
  return; // traga el resto mientras navega la lista
}

/**
 * Phase 63 Plan 02 (D-01/D-05, RESEARCH Pattern 1): SUB-MODO config-edit (text-input controlado).
 * Esc cancela SIN guardar (vuelve a config). ←/→ mueven el cursor con clamp. backspace||delete
 * borra el char anterior al cursor (ambos juntos — Pitfall 3, muchos terminales mandan delete).
 * Char imprimible se INSERTA en `cursor` (NO append ciego). Enter valida → inválido pinta el
 * error (estado dedicado, sigue en config-edit) → válido guarda sobre un deep-clone y avisa.
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export async function handleConfigEditInput(input, key, ctx) {
  const fields = getEditableFields(ctx.configSnapshot);
  const field = fields[ctx.fieldCursor];
  // Phase 67 Plan 02: el renglón de API key es el APPEND en el índice fields.length (field
  // undefined ahí — se enruta antes del guard `!field`).
  const isApiKeyRow = ctx.fieldCursor === fields.length;
  if (key.escape) {
    // Phase 67 Plan 02 (Pitfall 6): al cancelar la edición de la API key, limpia el buffer y el
    // flag de máscara — el secreto tecleado no debe quedar en memoria ni reaparecer en scrollback.
    if (isApiKeyRow) {
      ctx.resetTextInput();
      ctx.setMaskValue(false);
    }
    ctx.setMode('config'); // cancela sin guardar (D-05)
    return;
  }
  if (key.leftArrow) {
    ctx.moveCursor(-1);
    return;
  }
  if (key.rightArrow) {
    ctx.moveCursor(1);
    return;
  }
  if (key.backspace || key.delete) {
    ctx.deleteBeforeCursor();
    return;
  }
  if (key.return) {
    // Phase 67 Plan 02 (SETUP-03, D-05/Pitfall 11): guardar la API key. Escritura EN-PROCESO vía
    // el callback DI `onSaveApiKey` → `writeEnvVar` (jamás shell-out). NO se duplica la validación
    // aquí: `writeEnvVar` valida (Pitfall 14) y el wrapper never-throws colapsa cualquier fallo a
    // {ok:false} — solo se hace un guard trivial de buffer vacío para no lanzar un save inútil.
    if (isApiKeyRow) {
      if (ctx.buffer.length === 0) {
        ctx.setConfigEditError(API_KEY_INVALID);
        return;
      }
      const provider = ctx.configSnapshot?.provider;
      const apiKeyEnv = ctx.configSnapshot?.providers?.[provider]?.api_key_env;
      try {
        const result = await ctx.onSaveApiKey(apiKeyEnv, ctx.buffer);
        if (!result || result.ok !== false) {
          // Éxito (D-06/Pitfall 6): limpia el buffer + la máscara (el secreto no persiste en
          // memoria), aviso de reinicio transitorio (sin hot-reload) y de vuelta a config. El
          // indicador [configurado] se recalcula solo (isApiKeyConfiguredFn lee process.env, que
          // el wrapper actualizó).
          ctx.resetTextInput();
          ctx.setMaskValue(false);
          ctx.setConfigEditError(null);
          ctx.setFocusError(API_KEY_SAVED_RESTART);
          ctx.setFooterColor('yellow');
          ctx.setMode('config');
        } else {
          // writeEnvVar devolvió false (fallo I/O) o input inválido → el .env previo quedó intacto.
          // En configEditError (NO focusError) para que siga visible mientras se reintenta (Pitfall 2).
          ctx.setConfigEditError(API_KEY_SAVE_FAILED);
        }
      } catch {
        ctx.setConfigEditError(API_KEY_SAVE_FAILED); // never-throws de respaldo (defensa en profundidad)
      }
      return;
    }
    if (!field) {
      ctx.setMode('config');
      return;
    }
    // Validación PURA never-throws (src/config-validate.js). Un inválido NUNCA alcanza el disco
    // (CFG-05/D-05): se guarda en configEditError (estado dedicado, Pitfall 2) y se sigue en
    // config-edit — la siguiente tecla edita, no se gasta limpiando el error.
    const res = validateField(field, ctx.buffer);
    if (!res.ok) {
      ctx.setConfigEditError(res.error);
      return;
    }
    // Pitfall 1: deep-clone ANTES de mutar — setByPath escribe sobre el clon, jamás el snapshot
    // congelado ni DEFAULT_CONFIG. onSaveConfig es never-throws (D-10 contract); el try/catch es
    // defensa en profundidad (si lanzara, el panel ink sigue montado — UX-04/D-12).
    const next = structuredClone(ctx.configSnapshot);
    setByPath(next, field.path, res.value);
    try {
      const result = await ctx.onSaveConfig(next);
      if (!result || result.ok !== false) {
        // Éxito: el snapshot adopta el valor guardado; aviso de reinicio transitorio (PERSIST-03/
        // D-10). El aviso va en focusError/footerColor (transitorio, ya de vuelta en config) — el
        // clear-on-any-input lo descarta con la próxima tecla, comportamiento deseado.
        ctx.setConfigSnapshot(next);
        ctx.setConfigEditError(null);
        ctx.setFocusError(CONFIG_SAVED_RESTART);
        ctx.setFooterColor('yellow');
        ctx.setMode('config');
      } else {
        // Escritura fallida (PERSIST-05: el config previo quedó intacto). En configEditError (NO
        // focusError) → sigue visible mientras el operador sigue en el editor (UX-04/D-12).
        ctx.setConfigEditError(CONFIG_SAVE_FAILED);
      }
    } catch {
      ctx.setConfigEditError(CONFIG_SAVE_FAILED); // never-throws de respaldo (defensa en profundidad)
    }
    return;
  }
  // Char imprimible: inserta en la posición del cursor (NO append ciego — RESEARCH Pattern 1).
  if (input && !key.ctrl && !key.meta) {
    ctx.insertAtCursor(input);
    return;
  }
  return; // traga el resto (teclas de control no mapeadas)
}
