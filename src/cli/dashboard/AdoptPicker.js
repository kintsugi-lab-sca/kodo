// @ts-check
//
// src/cli/dashboard/AdoptPicker.js — KODO-40 (extracción de App.js).
//
// Carril completo de ADOPCIÓN de surfaces ad-hoc (tecla `a`) + su copy literal-estable:
//   1. apertura del picker (`openAdoptPicker`, desde mode:'list'),
//   2. navegación/armado dentro del picker (`handleAdoptPickerInput`, sub-modo de mode:'overlay'),
//   3. estado transitorio de derivación (`handleDerivingInput`, mode:'deriving'),
//   4. rama ADOPT del double-confirm (`handleAdoptConfirmInput`, mode:'confirm' con armedSessionId).
//
// Extraído VERBATIM de App.js (Phase 56/62) sin cambio semántico: eran ramas del `useInput`
// monolítico y aquí son funciones que reciben un `ctx` con el estado y los setters que ya usaban
// por closure. App.js re-exporta todas las constantes, así que SessionTable.js y los tests
// `dashboard-*` / `app-adopt` / `app-derive` siguen importándolas de App.js.

import { computeAdoptable, resolveProjectId } from './select.js';

// Phase 56 D-03/D-05/D-07 (DETECT-02): copy literal-estable del flujo adopt (tecla `a`).
// EXPORTADAS para que los tests las importen y asseren equality sin duplicar strings (mismo
// patrón que FOCUS_ERR_* / DISMISS_* / OPEN_*). La LITERAL copy es el contrato (UI-SPEC
// §Copywriting); los nombres son guía.
//
// ADOPT_NONE (informativo, no error): el host no soporta listAgentSurfaces o no hay surfaces
//   adoptables → footer informativo, mode SIGUE en list (NO abre picker, D-02/D-03). Sin `[!]`.
// ADOPT_CONFIRM (cyan): armed prompt PERSISTENTE del double-confirm (espejo léxico de
//   DISMISS_CONFIRM, armado por sessionId — D-04). Se deriva de mode==='confirm' + armedSessionId
//   (NO de focusError), así el clear-on-any-input no consume el segundo `a` (Pitfall 2/4).
// ADOPT_OK (verde): éxito transitorio, clona la forma de OPEN_OK (ellipsis de un char `…`, sin `[!]`).
// ADOPT_NO_PROJECT (rojo, D-05): el reverse-lookup cwd→projectId falló (none/ambiguous) → NO se
//   shellea; falla ruidoso hacia el escape-hatch del CLI (echo del cwd al TTY local, T-56-08 accept).
// ADOPT_ERR_ENOENT / adoptErrFailed (rojo): errores reales del shell de `kodo adopt` (espejo OPEN_*).
export const ADOPT_NONE = 'no adoptable sessions found';
/** @param {string} ref */
export const ADOPT_CONFIRM = (ref) => `adopt ${ref}? press a again · Esc cancel`;
/** @param {string} ref */
export const ADOPT_OK = (ref) => `adopted ${ref}…`;
// ADOPT_ALREADY (ámbar/yellow, 56-03): el núcleo devolvió ALREADY_ADOPTED — `kodo adopt` sale 0
// (idempotente por diseño) pero NO crea fila nueva. Distinto del verde ADOPT_OK para que el
// footer no mienta ("no ha hecho nada" UAT blocker). Sin `[!]`: no es un error, es un no-op.
/** @param {string} ref */
export const ADOPT_ALREADY = (ref) => `already adopted ${ref}`;
/** @param {string} cwd */
export const ADOPT_NO_PROJECT = (cwd) =>
  `[!] no/ambiguous project for ${cwd} — use kodo adopt --project <id>`;
export const ADOPT_ERR_ENOENT = '[!] kodo not found — press any key';
/** @param {number|string} code */
export const adoptErrFailed = (code) => `[!] adopt failed (code ${code}) — press any key`;

// Phase 62 D-08/D-09 (ORCH-02): copy literal-estable del flujo derive-then-confirm de la tecla `a`.
// EXPORTADAS para que los tests las importen y asseren equality sin duplicar strings (mismo patrón
// que ADOPT_* de Phase 56). La LITERAL copy es el contrato (UI-SPEC §Copywriting, español); los
// nombres son guía. Mezcla consciente de idioma (las ADOPT_* de Phase 56 quedan en inglés, las
// nuevas en español — aceptado por UI-SPEC).
//
// DERIVE_PROGRESS (dimColor, spinner NEUTRAL): estado transitorio `mode==='deriving'` mientras
//   onDerive corre. dimColor (NO cyan, reservado al prompt armado). Ellipsis `…` (un char, NO `...`).
// ADOPT_DERIVED_CONFIRM (cyan): confirm CON propuesta derivada (espejo léxico de ADOPT_CONFIRM, pero
//   precedido de las líneas título:/desc: en SessionTable). Se deriva de mode==='confirm' +
//   armedSessionId + armedSurface.title presente.
// ADOPT_DERIVED_CONFIRM_FALLBACK (cyan): confirm DEGRADADO (fail-open T4) — onDerive resolvió {} o
//   sin title → NO se renderizan líneas título:/desc:; el copy avisa "(título por defecto)". NO rojo.
export const DERIVE_PROGRESS = 'derivando título…';
/** @param {string} ref */
export const ADOPT_DERIVED_CONFIRM = (ref) => `adoptar ${ref}? pulsa a de nuevo · Esc cancela`;
/** @param {string} ref */
export const ADOPT_DERIVED_CONFIRM_FALLBACK = (ref) =>
  `adoptar ${ref} (título por defecto)? pulsa a de nuevo · Esc cancela`;

/**
 * Phase 56 D-01/D-02/D-03 (DETECT-02): handler de adopt en mode:'list'. Descubre surfaces ad-hoc
 * ON-DEMAND (NO poll loop) vía onAdoptDiscover (typeof-gated upstream en index.js, fail-open a []),
 * diffea contra el snapshot vivo de /status (computeAdoptable, keyeado por sessionId — D-02) y abre
 * el picker overlay con las adoptables. Vacío/unsupported → footer ADOPT_NONE y mode SIGUE en list
 * (NO abre overlay, D-03). Mold del `o` handler (async never-throws) + del `c`/`l` reqId-guard
 * alrededor del await (CR-01: una apertura encolada/Esc invalida la post-await).
 *
 * @param {any} ctx
 */
export async function openAdoptPicker(ctx) {
  const reqId = ++ctx.overlayReqRef.current; // CR-01: marca esta apertura
  const surfaces = (await ctx.onAdoptDiscover?.()) ?? [];
  if (ctx.overlayReqRef.current !== reqId) return; // CR-01: cerrada/superada durante el await
  const adoptable = computeAdoptable(surfaces, ctx.sessions);
  if (adoptable.length === 0) {
    // D-02/D-03: set adoptable vacío / host sin soporte → footer informativo, NO abre picker.
    ctx.setFocusError(ADOPT_NONE);
    ctx.setFooterColor('yellow');
    return;
  }
  // D-03: abre el picker congelado con el cursor en 0. El poll sigue corriendo por debajo
  // (snapshot congelado en overlaySnapshot.adoptable, mold c/l/p).
  ctx.setOverlaySnapshot({ kind: 'adopt', taskRef: '', status: 'ok', lines: [], adoptable });
  ctx.setAdoptCursor(0);
  ctx.setOverlayKind('adopt');
  ctx.setMode('overlay');
}

/**
 * Phase 56 D-03/D-04/Pitfall 3: SUB-MODO picker de adopt (dentro de mode:'overlay', despachado por
 * OverlayViewer cuando overlaySnapshot.kind === 'adopt'). Diverge del overlay c/l/p de lectura:
 * ↑/↓ mueven un CURSOR seleccionable sobre adoptable[] (no scroll); `a` ARMA el adopt de la surface
 * bajo el cursor (resuelve projectId; none/ambiguous → ADOPT_NO_PROJECT + cierra picker, no arma).
 * Cualquier otra tecla se traga mientras se elige.
 *
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export async function handleAdoptPickerInput(input, key, ctx) {
  const adoptable = ctx.overlaySnapshot.adoptable ?? [];
  if (key.upArrow) {
    ctx.setAdoptCursor((/** @type {number} */ i) => Math.max(0, i - 1)); // clamp [0,len-1] sin wrap (molde resolveSelection)
    return;
  }
  if (key.downArrow) {
    ctx.setAdoptCursor((/** @type {number} */ i) => Math.min(adoptable.length - 1, i + 1));
    return;
  }
  if (input === 'a') {
    // Arma el adopt de la surface bajo el cursor. D-05: el reverse-lookup cwd→projectId es el
    // ÚNICO punto que puede impedir el shell — none/ambiguous → footer ADOPT_NO_PROJECT (rojo)
    // + cierra el picker, NUNCA arma (cero onAdopt). Match único → arma por sessionId (D-04) y
    // stashea el payload resuelto para el confirm.
    const surface = adoptable[ctx.adoptCursor];
    if (!surface) {
      ctx.overlayReqRef.current++;
      ctx.setMode('list');
      ctx.setOverlayKind(null);
      return;
    }
    const r = resolveProjectId(surface.cwd, ctx.projects);
    if ('error' in r) {
      ctx.setFocusError(ADOPT_NO_PROJECT(surface.cwd));
      ctx.setFooterColor('red');
      ctx.overlayReqRef.current++; // cierra el picker
      ctx.setMode('list');
      ctx.setOverlayKind(null);
      return;
    }
    // Match único: arma el confirm por IDENTIDAD (sessionId) + stashea el payload. NO se setea
    // footer al entrar en confirm/deriving (Pitfall 4): el copy se DERIVA de mode+armedSurface
    // en SessionTable, así el clear-on-any-input no consume el segundo `a`.
    ctx.setArmedSessionId(surface.sessionId);
    ctx.setOverlayKind(null);
    // Phase 62 D-08 (ORCH-02): derive-then-confirm. Entre el armado y el confirm se interpone
    // el estado transitorio 'deriving': armamos el payload BASE (con el title de la surface
    // como fallback), entramos en 'deriving' (spinner DERIVE_PROGRESS), y await onDerive. El
    // handler ya es async (usa await onAdopt en el confirm) → el await es legal. onDerive es
    // never-throws (Plan 01 contract / D-11): el try/catch fail-open a {} es defensa en
    // profundidad (el contrato es que NUNCA lanza, pero si lo hiciera el panel sigue montado).
    ctx.setArmedSurface({
      workspaceRef: surface.workspaceRef,
      cwd: surface.cwd,
      sessionId: surface.sessionId,
      projectId: r.projectId,
      // Phase 56-06: el título auto-derivado de cmux (← AgentSurface.title) es el FALLBACK del
      // título derivado (T4 fail-open conserva surface.title). Ausente → onAdopt lo omite.
      title: surface.title,
    });
    ctx.setMode('deriving');
    // Phase 62 D-09/T5: token de generación (reusa overlayReqRef, espejo del CR-01 de c/l).
    // Esc en deriving avanza el ref → el resultado tardío se descarta tras el await.
    const reqId = ++ctx.overlayReqRef.current;
    /** @type {{ title?: string, description?: string }} */
    let derived = {};
    try {
      derived = (await ctx.onDerive?.({ cwd: surface.cwd, sessionId: surface.sessionId })) ?? {};
    } catch {
      derived = {}; // never-throws / fail-open (D-11): defensa en profundidad
    }
    // T5: si overlayReqRef avanzó durante el await (Esc en deriving u otra apertura), esta
    // derivación quedó OBSOLETA → se descarta sin reabrir el confirm.
    if (ctx.overlayReqRef.current !== reqId) return;
    // Fusión: el {title, description} derivado entra en armedSurface. T4 fail-open conserva
    // surface.title cuando derived.title es undefined; description undefined cuando no hay.
    ctx.setArmedSurface({
      workspaceRef: surface.workspaceRef,
      cwd: surface.cwd,
      sessionId: surface.sessionId,
      projectId: r.projectId,
      title: derived.title ?? surface.title,
      description: derived.description,
    });
    ctx.setMode('confirm');
    return;
  }
  return; // traga el resto mientras el operador elige en el picker
}

/**
 * Phase 62 D-09 (ORCH-02): SUB-MODO deriving. En App.js se despacha ANTES del confirm: mientras
 * onDerive está en vuelo el footer muestra el spinner DERIVE_PROGRESS (derivado de mode==='deriving'
 * en SessionTable). Esc CANCELA e invalida la derivación en vuelo (avanza overlayReqRef → el
 * resultado tardío se descarta tras el await, T5) y vuelve a list, limpiando el armado. Una segunda
 * `a` (o cualquier otra tecla) se TRAGA: NO encola un segundo onDerive (la derivación ya está
 * corriendo). El poll de /status sigue por debajo (T-62-09: no bloquea el panel).
 *
 * @param {any} key
 * @param {any} ctx
 */
export function handleDerivingInput(key, ctx) {
  if (key.escape) {
    ctx.overlayReqRef.current++; // T5: invalida la derivación en vuelo (resultado tardío descartado)
    ctx.setArmedSessionId(null);
    ctx.setArmedSurface(null);
    ctx.setMode('list');
    return;
  }
  return; // traga el resto (incl. `a`) mientras la derivación está en vuelo
}

/**
 * Phase 56 Pitfall 2 (DETECT-02): rama ADOPT del mode:'confirm'. El confirm tiene DOS consumidores
 * que esperan teclas distintas (dismiss=`d`, adopt=`a`); App.js rutea por cuál armed-id está set —
 * armedSessionId != null → este handler (solo `a` ejecuta; cualquier otra tecla, incl. `d`/Esc,
 * cancela). El dismiss arma por task_id; el adopt por sessionId — estados disjuntos.
 *
 * @param {string} input
 * @param {any} ctx
 */
export async function handleAdoptConfirmInput(input, ctx) {
  if (input === 'a') {
    // Segundo `a` → ejecuta. onAdopt es never-throws (Plan 01 contract / D-07) → el `await`
    // es legal sin try/catch (ningún throw llega a React, el panel ink sigue montado). El `?.`
    // cubre el contexto degradado sin onAdopt (tests del módulo sin DI). WR guard: si por bug
    // de estado armedSurface es null, aborta silenciosamente.
    if (!ctx.armedSurface) {
      ctx.setArmedSessionId(null);
      ctx.setMode('list');
      return;
    }
    const ref = ctx.armedSurface.workspaceRef;
    const result = await ctx.onAdopt?.(ctx.armedSurface);
    if (result?.code === 'ALREADY_ADOPTED') {
      // 56-03: `kodo adopt` salió 0 pero el discriminante --json es un no-op idempotente
      // (la sesión ya estaba adoptada). NO es éxito (no se crea fila) ni error — footer
      // ámbar distinto, para no mostrar el verde engañoso "adopted" del UAT blocker. Va
      // ANTES del check de éxito genérico (result.ok !== false) para no caer en verde.
      ctx.setFocusError(ADOPT_ALREADY(ref));
      ctx.setFooterColor('yellow');
    } else if (!result || result.ok !== false) {
      // Éxito (o contexto degradado sin onAdopt): footer verde transitorio (D-07). REF =
      // workspaceRef (el identificador legible de la surface ad-hoc, no hay task_ref aún).
      ctx.setFocusError(ADOPT_OK(ref));
      ctx.setFooterColor('green');
    } else if (result.code === 'ENOENT') {
      ctx.setFocusError(ADOPT_ERR_ENOENT);
      ctx.setFooterColor('red');
    } else {
      // NON_ZERO_EXIT (`detail` = exit code 1/2 de kodo adopt) o SPAWN_ERROR (`detail` =
      // Error.message). El dashboard NO reinterpreta la semántica — muestra el código (D-07).
      const n = result.detail ?? 'unknown';
      ctx.setFocusError(adoptErrFailed(n));
      ctx.setFooterColor('red');
    }
    ctx.setArmedSessionId(null);
    ctx.setArmedSurface(null);
    ctx.setMode('list');
    return;
  }
  // Cualquier otra tecla (Esc, `d`, etc.) cancela el adopt. Sin mensaje, sin timer (D-04).
  ctx.setArmedSessionId(null);
  ctx.setArmedSurface(null);
  ctx.setMode('list');
}
