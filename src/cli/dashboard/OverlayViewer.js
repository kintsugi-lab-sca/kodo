// @ts-check
//
// src/cli/dashboard/OverlayViewer.js — KODO-40 (extracción de App.js).
//
// Sub-máquina de teclado del `mode:'overlay'` (los overlays de LECTURA: comentarios `c`,
// logs por sesión `l`, log general `L` y plan GSD `p`) + su copy literal-estable.
//
// Extraído VERBATIM de App.js (Phase 39/44/46/75) sin cambio semántico: los handlers eran
// ramas del `useInput` monolítico y aquí son funciones que reciben un `ctx` con el estado y
// los setters que ya usaban por closure. App.js re-exporta todas las constantes de este
// módulo, así que `SessionTable.js` y los tests `dashboard-*` siguen importándolas de App.js.
//
// El RENDER de estos overlays NO vive aquí — vive en SessionTable.js (renderOverlay), igual
// que antes. Este módulo es la mitad de INTERACCIÓN.

import { fetchComments, fetchLogs } from './client.js';
import { grepLogs } from './select.js';
import { stripControlChars } from '../sanitize.js';
import { readPlan } from './plan.js';
import { resolvePhase } from '../../gsd/resolver.js';
import { handleAdoptPickerInput } from './AdoptPicker.js';

// Phase 39 D-07/D-04: copy literal-estable de los dos overlays auxiliares (comentarios + logs).
// EXPORTADAS para que los tests las importen y asseren equality sin duplicar strings (mismo patrón
// que FOCUS_ERR_*). SessionTable.js (Task 2) también las importa para matar el drift
// code/render. OVERLAY_LOGS_LABEL es LOAD-BEARING (D-04, SC#3): declara honestamente que el grep
// corre sobre un buffer compartido sin session_id — no es cosmética.
export const OVERLAY_COMMENTS_EMPTY = 'no comments yet';
export const OVERLAY_COMMENTS_NOT_FOUND = 'task not found';
export const OVERLAY_COMMENTS_ERROR = 'error fetching comments';
// D-08 (TUI-15): mensaje DISTINTO de OVERLAY_COMMENTS_EMPTY. Cuando el server señala
// `supported:false`, el provider no implementa listComments (estado permanente) — no es
// que la tarea no tenga comentarios aún. Literal-estable, redundancia textual (legible bajo
// NO_COLOR, no depende del color para distinguirse del caso vacío).
export const OVERLAY_COMMENTS_UNSUPPORTED = 'comments not supported by this provider';
export const OVERLAY_LOGS_EMPTY = 'no log lines match this session';
export const OVERLAY_LOGS_ERROR = 'error fetching logs';
export const OVERLAY_LOGS_LABEL = 'grep of shared buffer — may include other sessions';
// Vista de log GENERAL (`L`): el buffer compartido COMPLETO, sin grep por sesión — para
// debug del daemon (webhooks, dispatch, lifecycle). La etiqueta es honesta igual que la de
// `l`: declara que es el buffer compartido con TODOS los eventos (no filtrado).
export const OVERLAY_LOGS_ALL_LABEL = 'shared buffer — all daemon events (newest first)';
export const OVERLAY_LOGS_ALL_EMPTY = 'no log lines in buffer yet';

// Phase 44 D-07 (PLAN-02): copy literal-estable del overlay de plan GSD (`p`), espejo léxico de
// OVERLAY_COMMENTS_*. EXPORTADAS para que tests y SessionTable.js las importen sin duplicar strings
// (mismo patrón que OVERLAY_COMMENTS_*). El contrato es "DISTINTA por caso" + "honesta" (D-07): el
// operador distingue de un vistazo "no es GSD / no hay fase" de "la fase aún no tiene PLAN.md" de
// "es quick pero aún no escribió su plan" de "hubo un error leyendo". Las tres primeras son
// informativas (dim); ERROR es un fallo real (rojo).
// Redundancia textual: legibles bajo NO_COLOR, no dependen del color para distinguirse.
//
// Phase 46 D-04 (PLAN-04): cuarto caso — sesión quick/non-GSD cuyo artefacto de plan ligero
// (`~/.kodo/plans/<task_id>.md`) aún no existe (ENOENT). Es NORMAL y esperado (latest-wins: la
// sesión puede no haber corrido la instrucción todavía), NO un fallo → dim, no rojo. DISTINTA de
// NO_PHASE ("no es GSD") y de NO_PLAN ("fase sin PLAN.md", GSD-specific que mentiría sobre quick).
export const OVERLAY_PLAN_NO_PHASE = 'not a GSD session / no phase resolved';
export const OVERLAY_PLAN_NO_PLAN = 'phase has no PLAN.md yet';
export const OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet';
export const OVERLAY_PLAN_ERROR = 'error reading plan';

// Phase 39 D-06: altura del viewport del body scrollable del overlay. ÚNICA fuente de verdad —
// SessionTable.js la importa para el slice del render y App.js la usa para el clamp de scrollOffset
// (sin esto, el clamp y el render divergen: WR-01). El snapshot congelado se sliceа
// [scrollOffset, scrollOffset+VIEWPORT) → el render nunca pinta miles de líneas (mitiga T-39-04).
export const OVERLAY_VIEWPORT = 18;

/**
 * Phase 39 (TUI-15/TUI-16 — D-05/D-06): SUB-MODO overlay. En App.js se despacha ANTES del mode-gate
 * de filtro: mientras un overlay está abierto, ↑/↓ SCROLLEAN el contenido (no navegan filas) y Esc
 * cierra restaurando mode:'list' SIN tocar selectedTaskId (cursor preservado GRATIS — resolveSelection
 * re-deriva la misma fila al volver). Cualquier otra tecla se traga (early return) mientras se lee.
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx - estado + setters del dashboard (ver App.js `buildInputCtx`).
 */
export async function handleOverlayInput(input, key, ctx) {
  if (key.escape) {
    ctx.overlayReqRef.current++; // CR-01: invalida cualquier apertura `c`/`l` aún en vuelo
    ctx.setMode('list');
    ctx.setOverlayKind(null);
    return;
  }
  // Phase 56 D-03/D-04/Pitfall 3: SUB-MODO picker de adopt. Diverge del overlay c/l/p de
  // lectura: ↑/↓ mueven un CURSOR seleccionable sobre adoptable[] (no scroll); `a` ARMA el
  // adopt de la surface bajo el cursor. Vive en AdoptPicker.js (KODO-40).
  if (ctx.overlaySnapshot && ctx.overlaySnapshot.kind === 'adopt') {
    await handleAdoptPickerInput(input, key, ctx);
    return;
  }
  if (key.upArrow) {
    ctx.setScrollOffset((/** @type {number} */ o) => Math.max(0, o - 1));
    return;
  }
  if (key.downArrow) {
    // Clamp superior: el último scroll deja el viewport LLENO (no una sola línea). WR-01: usar
    // `lines.length - OVERLAY_VIEWPORT` (el mismo VIEWPORT del slice de SessionTable), no `- 1`.
    const max = ctx.overlaySnapshot
      ? Math.max(0, ctx.overlaySnapshot.lines.length - OVERLAY_VIEWPORT)
      : 0;
    ctx.setScrollOffset((/** @type {number} */ o) => Math.min(max, o + 1));
    return;
  }
  return; // traga el resto mientras el operador lee el overlay
}

/**
 * TUI-15/SC#1: overlay de comentarios de la fila seleccionada (resueltos por task_id, D-02).
 * fetchComments es never-throws (Plan 39-01): mapeamos su discriminante a un snapshot CONGELADO.
 *
 * @param {any} row - fila seleccionada de la tabla (no-op arriba si no hay).
 * @param {any} ctx
 */
export async function openCommentsOverlay(row, ctx) {
  const reqId = ++ctx.overlayReqRef.current; // CR-01: marca esta apertura
  const res = await fetchComments(ctx.baseUrl, row.task_id, ctx.fetchFn);
  if (ctx.overlayReqRef.current !== reqId) return; // CR-01: cerrada/superada durante el await
  let status;
  /** @type {string[]} */
  let lines = [];
  if (res.ok) {
    // D-08: `supported === false` (server señala que el provider no implementa listComments)
    // gana sobre la lógica ok/empty — es un estado PERMANENTE, distinto de "sin comentarios aún".
    if (res.data.supported === false) {
      status = 'unsupported';
    } else {
      const comments = res.data.comments;
      if (comments.length > 0) {
        status = 'ok';
        // Proyección a strings: prefijo de autor opcional + cuerpo (body|text|message); si no hay
        // ningún campo de texto reconocido, JSON de respaldo (never-throws sobre shapes raras).
        // HYG-07/M4 (T-72-12/T-72-13): el contenido externo NO confiable
        // (comentarios de Plane) pasa por stripControlChars antes del <Text> —
        // neutraliza OSC-52/escape injection. Las TRES ramas (fallback JSON incluido)
        // se sanean. WR-03: task_ref/summary del provider tienen el mismo vector y se
        // sanean en su punto de proyección (enriched map en App.js) — éste NO es el único.
        lines = comments.map((/** @type {any} */ c) => {
          const body = c.body ?? c.text ?? c.message;
          if (body == null) return stripControlChars(JSON.stringify(c));
          return stripControlChars(c.author ? `${c.author}: ${body}` : String(body));
        });
      } else {
        status = 'empty';
      }
    }
  } else if (res.code === 'not-found') {
    status = 'not-found';
  } else {
    status = 'error';
  }
  // D-05: snapshot congelado al abrir. NO se toca selectedTaskId (cursor GRATIS al volver, D-06).
  ctx.setOverlaySnapshot({ kind: 'comments', taskRef: row.task_ref ?? '', status, lines });
  ctx.setOverlayKind('comments');
  ctx.setScrollOffset(0);
  ctx.setMode('overlay');
}

/**
 * TUI-16/SC#2: overlay de logs por grep substring (task_ref/workspace_ref) sobre el buffer
 * compartido de /logs. fetchLogs never-throws; grepLogs es el filtro puro anti-ReDoS (Plan 39-01).
 *
 * @param {any} row
 * @param {any} ctx
 */
export async function openLogsOverlay(row, ctx) {
  const reqId = ++ctx.overlayReqRef.current; // CR-01: marca esta apertura
  const res = await fetchLogs(ctx.baseUrl, ctx.fetchFn);
  if (ctx.overlayReqRef.current !== reqId) return; // CR-01: cerrada/superada durante el await
  let status;
  /** @type {string[]} */
  let lines = [];
  if (res.ok) {
    const matched = grepLogs(res.data.logs, {
      task_ref: row.task_ref,
      workspace_ref: row.workspace_ref,
    });
    status = matched.length ? 'ok' : 'empty';
    // Proyección: `[ts] level  msg` (los campos ausentes se omiten sin romper el render).
    lines = matched.map((/** @type {any} */ e) =>
      `${e.ts ? `${e.ts} ` : ''}${e.level ? `${e.level} ` : ''}${e.msg ?? ''}`.trim(),
    );
  } else {
    status = 'error';
  }
  // D-05: snapshot congelado. D-06: selectedTaskId intacto.
  ctx.setOverlaySnapshot({ kind: 'logs', taskRef: row.task_ref ?? '', status, lines });
  ctx.setOverlayKind('logs');
  ctx.setScrollOffset(0);
  ctx.setMode('overlay');
}

/**
 * Vista de log GENERAL (`L`): el buffer compartido COMPLETO, sin grep por sesión (espejo de `l`,
 * para debug del daemon: webhooks/dispatch/lifecycle). NO requiere fila seleccionada.
 * Mismo guard CR-01 anti-reapertura-obsoleta que `l` (fetch async).
 *
 * @param {any} ctx
 */
export async function openLogsAllOverlay(ctx) {
  const reqId = ++ctx.overlayReqRef.current;
  const res = await fetchLogs(ctx.baseUrl, ctx.fetchFn);
  if (ctx.overlayReqRef.current !== reqId) return; // cerrada/superada durante el await
  let status;
  /** @type {string[]} */
  let lines = [];
  if (res.ok) {
    // SIN grep: se proyectan TODAS las líneas del buffer (newest-first, como lo sirve /logs).
    lines = res.data.logs.map((/** @type {any} */ e) =>
      `${e.ts ? `${e.ts} ` : ''}${e.level ? `${e.level} ` : ''}${e.msg ?? ''}`.trim(),
    );
    status = lines.length ? 'ok' : 'empty';
  } else {
    status = 'error';
  }
  ctx.setOverlaySnapshot({ kind: 'logs-all', taskRef: '', status, lines });
  ctx.setOverlayKind('logs-all');
  ctx.setScrollOffset(0);
  ctx.setMode('overlay');
}

/**
 * Phase 44 PLAN-01/PLAN-02 (D-02/D-05): overlay del/los PLAN.md de la fase GSD de la fila
 * seleccionada (resuelta por task_id, D-02). CUARTO consumidor del mode:'overlay' junto a c/l.
 *
 * DIVERGENCIA CRÍTICA respecto a c/l (Pitfall 1 / RESEARCH:203-205): readPlan es SÍNCRONO —
 * NO hay await window. setOverlaySnapshot/setMode corren en el MISMO tick que el keypress, así
 * que NO existe carrera de "reapertura obsoleta": la apertura es ATÓMICA. Por eso este handler
 * NO captura `const reqId = ++overlayReqRef.current` ni hace el check post-await `if
 * (overlayReqRef.current !== reqId) return` de c/l — sería código muerto y engañoso. La rama de
 * cierre con Esc (mode:'overlay') ya incrementa overlayReqRef para invalidar OTRAS aperturas
 * c/l aún en vuelo; aquí no se toca. readPlan es never-throws (D-05): sin try/catch necesario.
 *
 * @param {any} row
 * @param {any} ctx
 */
export function openPlanOverlay(row, ctx) {
  const res = readPlan(row, { resolvePhaseFn: resolvePhase });
  // D-05: snapshot congelado al abrir. NO se toca selectedTaskId (cursor GRATIS al volver, D-06).
  // Phase 75 (D-07): threadea `render` verbatim del resultado — SessionTable ramifica por él
  // (markdown → mini-renderer del carril light; plain/ausente → <Text> plano GSD byte-idéntico).
  ctx.setOverlaySnapshot({ kind: 'plan', taskRef: row.task_ref ?? '', status: res.status, lines: res.lines, render: res.render });
  ctx.setOverlayKind('plan');
  ctx.setScrollOffset(0);
  ctx.setMode('overlay');
}
