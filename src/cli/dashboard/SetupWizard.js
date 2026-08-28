// @ts-check
//
// src/cli/dashboard/SetupWizard.js — KODO-40 (extracción de App.js).
//
// Wizard de onboarding first-run (`mode:'setup'`, 4 pasos lineales) + su copy literal-estable.
//
// Extraído VERBATIM de App.js (Phase 68 Plan 02) sin cambio semántico: era la primera rama del
// `useInput` monolítico y aquí es una función que recibe un `ctx` con el estado y los setters que
// ya usaba por closure. App.js re-exporta todas las constantes, así que SessionTable.js y el test
// `test/dashboard/app-setup.test.js` siguen importándolas de App.js.
//
// Pitfall 11 / PERSIST-04: el VALOR de la API key (paso 4/4) jamás sale de `ctx.buffer` — ni a argv,
// ni a console/logger, ni a config.json (`onSaveConfig`), ni al overlay-snapshot. Solo a
// `onSaveApiKey` (→ writeEnvVar, escritura EN-PROCESO). El render enmascara vía `ctx.setMaskValue`.
// El bloque PERSIST-04 de `test/config-env-writer.test.js` hace grep source-level sobre ESTE fichero.

import { setByPath } from '../../config-validate.js';
import { API_KEY_INVALID } from './ConfigEditor.js';

// Phase 68 Plan 02 (SETUP-01/02, D-04/D-05/D-06/D-08/D-12/D-13): copy literal-estable del MODO SETUP
// (onboarding first-run, pantalla guiada lineal de 4 pasos). EXPORTADAS para que tests y
// SessionTable.js las importen y asseren equality sin duplicar strings (mismo patrón CONFIG_*/
// API_KEY_*/PROJECTS_*). Español. NUNCA incluyen el valor del secreto ni el nombre de la env var en
// ninguna cadena user-facing (Pitfall 11). El literal de SETUP_COMPLETE_RESTART preserva D-08 (SC#4).
export const SETUP_OVERLAY_TITLE = 'configuración inicial de kodo';
export const SETUP_INTRO = 'Bienvenido a kodo. Configura tu provider para empezar.';
export const SETUP_STEP_PROVIDER = 'paso 1/4 · provider';
export const SETUP_STEP_BASE_URL = 'paso 2/4 · base_url';
export const SETUP_STEP_WORKSPACE = 'paso 3/4 · workspace_slug';
export const SETUP_STEP_APIKEY = 'paso 4/4 · API key';
export const SETUP_PROVIDER_LABEL = 'provider activo';
export const SETUP_PROVIDER_HINT = '↑/↓ para elegir · Enter para confirmar';
export const SETUP_GITHUB_REDIRECT = 'GitHub se configura con `kodo config` — el asistente guiado cubre solo Plane';
export const SETUP_BASE_URL_LABEL = 'base_url';
export const SETUP_WORKSPACE_LABEL = 'workspace_slug';
export const SETUP_COMPLETE_RESTART = 'config guardada — reinicia kodo (`kodo up`) para aplicar';
export const SETUP_WEBHOOK_NOTE = 'nota: el webhook secret del provider se configura por fuera del asistente';
export const SETUP_NO_RAWMODE = 'Terminal no interactiva — usa `kodo config` para completar la configuración inicial';
export const SETUP_INVALID = 'valor inválido (no puede estar vacío ni contener espacios, # o =)';
export const SETUP_SAVE_FAILED = '[!] no se pudo guardar — el archivo previo quedó intacto';

// Phase 68 Plan 02 (D-05/D-06): los dos providers ofrecidos por el guiado. `plane` continúa el
// wizard estructural; `github` se remite a `kodo config` (D-06) — cero gate estructural en el guiado.
export const SETUP_PROVIDERS = ['plane', 'github'];

/**
 * Phase 68 Plan 02 (SETUP-01/02, D-04/D-05/D-06/D-08): SUB-MÁQUINA del modo setup (wizard lineal
 * de 4 pasos, first-run). En App.js se despacha ANTES del resto de mode-gates — el setup es un modo
 * terminal sin tabla debajo. never-throws: Esc cierra a list SIN escribir; en apikey limpia
 * buffer+máscara (el secreto no persiste en memoria, Pitfall 6). Los saves estructurales usan
 * structuredClone (configSnapshot)+setByPath+onSaveConfig (molde config-edit); el apikey reusa
 * LITERAL el flujo de Phase 67 (onSaveApiKey → writeEnvVar in-proceso). El text-input usa substring
 * puro (anti-ReDoS).
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export async function handleSetupInput(input, key, ctx) {
  // Fail-open defensivo: el efecto de montaje ya congeló configSnapshot, pero si por timing aún
  // es null se clona uno fresco (never-throws — un save sobre un clon nuevo es idéntico).
  const snap = ctx.configSnapshot ?? structuredClone(ctx.loadConfigFn());
  if (key.escape) {
    // Cancela el guiado sin escribir. En apikey limpia el secreto de memoria (Pitfall 6).
    if (ctx.setupStep === 'apikey') {
      ctx.setBuffer('');
      ctx.setMaskValue(false);
    }
    ctx.setConfigEditError(null);
    ctx.setMode('list');
    return;
  }
  // Paso 1/4 — selector de provider (D-05/D-06): ↑/↓ clamp sin wrap, Enter confirma.
  if (ctx.setupStep === 'provider') {
    if (key.upArrow) {
      ctx.setProviderCursor((/** @type {number} */ i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      ctx.setProviderCursor((/** @type {number} */ i) => Math.min(SETUP_PROVIDERS.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const chosen = SETUP_PROVIDERS[ctx.providerCursor];
      if (chosen === 'github') {
        // D-06: github se remite a `kodo config`; NO continúa el guiado ni escribe estructurales.
        // El aviso va en focusError/footerColor (transitorio, ya de vuelta en el paso provider).
        ctx.setFocusError(SETUP_GITHUB_REDIRECT);
        ctx.setFooterColor('yellow');
        return;
      }
      // plane: guarda provider y avanza a base_url (deep-clone ANTES de mutar — Pitfall 1).
      const next = structuredClone(snap);
      setByPath(next, 'provider', 'plane');
      try {
        const result = await ctx.onSaveConfig(next);
        if (!result || result.ok !== false) {
          ctx.setConfigSnapshot(next);
          ctx.setConfigEditError(null);
          ctx.setBuffer('');
          ctx.setCursor(0);
          ctx.setSetupStep('base_url');
        } else {
          ctx.setConfigEditError(SETUP_SAVE_FAILED);
        }
      } catch {
        ctx.setConfigEditError(SETUP_SAVE_FAILED); // never-throws de respaldo
      }
      return;
    }
    return; // traga el resto mientras elige el provider
  }
  // Pasos 2/4 y 3/4 — base_url / workspace_slug (text-input controlado, molde config-edit).
  if (ctx.setupStep === 'base_url' || ctx.setupStep === 'workspace_slug') {
    if (key.leftArrow) {
      ctx.setCursor((/** @type {number} */ c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      ctx.setCursor((/** @type {number} */ c) => Math.min(ctx.buffer.length, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (ctx.cursor > 0) {
        ctx.setBuffer((/** @type {string} */ b) => b.slice(0, ctx.cursor - 1) + b.slice(ctx.cursor));
        ctx.setCursor((/** @type {number} */ c) => c - 1);
      }
      return;
    }
    if (key.return) {
      // Validación no-vacío + sin espacios/#/= (substring puro — jamás compila regex del input).
      if (ctx.buffer.length === 0 || ctx.buffer.includes(' ') || ctx.buffer.includes('#') || ctx.buffer.includes('=')) {
        ctx.setConfigEditError(SETUP_INVALID);
        return;
      }
      const path = ctx.setupStep === 'base_url' ? 'providers.plane.base_url' : 'providers.plane.workspace_slug';
      const nextStep = ctx.setupStep === 'base_url' ? 'workspace_slug' : 'apikey';
      const next = structuredClone(snap);
      setByPath(next, path, ctx.buffer);
      try {
        const result = await ctx.onSaveConfig(next);
        if (!result || result.ok !== false) {
          ctx.setConfigSnapshot(next);
          ctx.setConfigEditError(null);
          ctx.setBuffer('');
          ctx.setCursor(0);
          if (nextStep === 'apikey') ctx.setMaskValue(true); // el paso 4/4 enmascara la entrada (D-11)
          ctx.setSetupStep(nextStep);
        } else {
          ctx.setConfigEditError(SETUP_SAVE_FAILED);
        }
      } catch {
        ctx.setConfigEditError(SETUP_SAVE_FAILED); // never-throws de respaldo
      }
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      ctx.setBuffer((/** @type {string} */ b) => b.slice(0, ctx.cursor) + input + b.slice(ctx.cursor));
      ctx.setCursor((/** @type {number} */ c) => c + input.length);
      return;
    }
    return; // traga el resto (teclas de control no mapeadas)
  }
  // Paso 4/4 — API key (campo enmascarado — reuso LITERAL de Phase 67, D-11/Pitfall 11). El
  // buffer guarda el VALOR REAL en memoria; solo la pintura se enmascara (renderSetupOverlay).
  if (ctx.setupStep === 'apikey') {
    if (key.leftArrow) {
      ctx.setCursor((/** @type {number} */ c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      ctx.setCursor((/** @type {number} */ c) => Math.min(ctx.buffer.length, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      if (ctx.cursor > 0) {
        ctx.setBuffer((/** @type {string} */ b) => b.slice(0, ctx.cursor - 1) + b.slice(ctx.cursor));
        ctx.setCursor((/** @type {number} */ c) => c - 1);
      }
      return;
    }
    if (key.return) {
      if (ctx.buffer.length === 0) {
        ctx.setConfigEditError(API_KEY_INVALID);
        return;
      }
      const apiKeyEnv = snap?.providers?.plane?.api_key_env;
      try {
        const result = await ctx.onSaveApiKey(apiKeyEnv, ctx.buffer);
        if (!result || result.ok !== false) {
          // Éxito (D-08/Pitfall 6): limpia buffer+máscara (el secreto no persiste en memoria) y
          // pasa al estado terminal 'complete' → aviso de reinicio honesto (SETUP_COMPLETE_RESTART
          // + SETUP_WEBHOOK_NOTE). D-09: NO se re-invoca loadEnvFile para reconfirmar la key recién
          // escrita — la confirmación se apoya en el process.env in-proceso (onSaveApiKey, index.js).
          ctx.setBuffer('');
          ctx.setMaskValue(false);
          ctx.setConfigEditError(null);
          ctx.setSetupStep('complete');
        } else {
          ctx.setConfigEditError(SETUP_SAVE_FAILED);
        }
      } catch {
        ctx.setConfigEditError(SETUP_SAVE_FAILED); // never-throws de respaldo
      }
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      ctx.setBuffer((/** @type {string} */ b) => b.slice(0, ctx.cursor) + input + b.slice(ctx.cursor));
      ctx.setCursor((/** @type {number} */ c) => c + input.length);
      return;
    }
    return; // traga el resto (teclas de control no mapeadas)
  }
  // Paso terminal 'complete' (D-08): cualquier tecla cierra el guiado a list (Esc ya cubierto).
  ctx.setMode('list');
}
