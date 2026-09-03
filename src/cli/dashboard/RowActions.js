// @ts-check
//
// src/cli/dashboard/RowActions.js — KODO-40 (extracción de App.js).
//
// Acciones del modo LISTA sobre la fila seleccionada (y sobre el orquestador) + su copy
// literal-estable. Las cinco comparten forma: invocan un runner never-throws inyectado por DI y
// mapean su discriminado `{ok, code, detail}` al footer transitorio (texto en `focusError`, matiz
// en `footerColor`), que el clear-on-any-input descarta con la siguiente tecla — sin timers.
//
//   Enter → `focusRow`            (cmux select-workspace; guard alive===false)
//   `o`   → `openRow`             (abre la task URL en el manager; guard no-URL)
//   `O`   → `focusOrchestrator`   (resolve-only + focus; no requiere fila)
//   `d`   → `armDismiss`          (guard INVERSO alive===true; arma el double-confirm)
//   `d`   → `handleDismissConfirmInput` (rama DISMISS del mode:'confirm')
//
// Extraído VERBATIM de App.js (Phase 37/42/48 + tecla `O`) sin cambio semántico: eran ramas del
// `useInput` monolítico y aquí son funciones que reciben un `ctx` con el estado y los setters que
// ya usaban por closure. App.js re-exporta todas las constantes, así que SessionTable.js y los
// tests `app-focus` / `app-open` / `app-dismiss` siguen importándolas de App.js.

import { dismissSession, openOrchestrator } from './client.js';
import { mapDismissResult } from './select.js';

// Phase 37 D-05: mensajes literal-estables del footer-error rojo. Constantes EXPORTADAS
// para que los tests las importen y asseren equality sin duplicar strings (espejo del
// patrón Phase 34 NON_TTY_MSG). Cualquier cambio aquí rompe los tests automáticamente —
// elimina drift entre código y assert.
export const FOCUS_ERR_ZOMBIE = '[!] workspace gone (alive=false) — press any key';
export const FOCUS_ERR_ENOENT = '[!] cmux not found in PATH — press any key';
/**
 * Mensaje paramétrico cuando `runFocus` resuelve con NON_ZERO_EXIT o SPAWN_ERROR. `code`
 * viene de `result.detail` (number en NON_ZERO_EXIT, string/undefined en SPAWN_ERROR);
 * cuando es undefined, el handler pasa la string `'unknown'`.
 * @param {number|string} code
 */
export const focusErrFailed = (code) => `[!] cmux focus failed (code ${code}) — press any key`;

// Phase 42 D-02/D-04/D-09 (DISMISS-02/03/04): copy literal-estable del flujo de dismiss.
// EXPORTADAS para que los tests las importen y asseren equality sin duplicar strings (mismo
// patrón que FOCUS_ERR_* / OVERLAY_*). SessionTable.js las importa para matar el drift
// code/render. La LITERAL copy es el contrato (UI-SPEC §Copywriting); los nombres son guía.
//
// DISMISS_GUARD_ALIVE (red) es el guard INVERSO del Enter (alive===true): `d` jamás descarta
// una sesión viva (DISMISS-04, SC#2). DISMISS_CONFIRM (cyan) es el armed prompt PERSISTENTE
// (no transitorio, D-03: no hay timer que limpiar). El resto son mensajes transitorios del
// footer (clear-on-any-input, D-12), con el matiz derivado de actions[] (D-09), no de un color.
export const DISMISS_GUARD_ALIVE = '[!] session is alive — only dead sessions can be dismissed';
/** @param {string} taskRef */
export const DISMISS_CONFIRM = (taskRef) => `dismiss ${taskRef}? press d again · Esc cancel`;
/** @param {string} taskRef */
export const DISMISS_OK = (taskRef) => `dismissed ${taskRef}`;
/** @param {string} taskRef */
export const DISMISS_PARTIAL_DIRTY = (taskRef) => `dismissed ${taskRef} — worktree preserved (.dirty)`;
/** @param {string} taskRef */
export const DISMISS_PARTIAL_WARN = (taskRef) => `dismissed ${taskRef} — completed with warnings`;
/** @param {string|number} reason */
export const DISMISS_ERR = (reason) => `[!] dismiss failed (${reason}) — press any key`;

// Phase 48 D-01/D-02/D-05 (OPEN-01/02/03): copy literal-estable del flujo open-in-manager (`o`).
// EXPORTADAS para que los tests las importen y asseren equality sin duplicar strings (mismo
// patrón que FOCUS_ERR_* / DISMISS_*). El éxito (OPEN_OK) clona la forma de DISMISS_OK: verde,
// con ref, SIN prefijo `[!]` — el `o` no produce otro cambio visible en la TUI, así que un
// footer verde transitorio confirma el lanzamiento (D-01/D-02, diverge del silencio de focus.js).
//
// OPEN_ERR_NO_URL es LOCKED (D-05 / SC#2): es la fila sin task_url, un NO-OP benigno (no un
// error). Por eso NO lleva `[!]` ni `— press any key` — es deliberadamente bare. NO "arreglar"
// para que matchee el formato de error: la copy es el contrato (UI-SPEC §Copywriting).
//
// El resto (ENOENT / BAD_PROTOCOL / openErrFailed) son errores reales → formato `[!] … — press
// any key`, espejo de FOCUS_ERR_*. OPEN_OK usa el ellipsis de un solo carácter `…` (no `...`).
/** @param {string} ref */
export const OPEN_OK = (ref) => `opening ${ref}…`;
export const OPEN_ERR_NO_URL = 'no task URL for this session';
export const OPEN_ERR_ENOENT = '[!] open not found in PATH — press any key';
export const OPEN_ERR_BAD_PROTOCOL = '[!] refused non-http(s) URL — press any key';
/** @param {number|string} code */
export const openErrFailed = (code) => `[!] open failed (code ${code}) — press any key`;

// Tecla `O`: ENFOCAR el orquestador (workspace cmux `kodo-orchestrator`). Copy literal-estable,
// mismo patrón que OPEN_* / FOCUS_*. Contrato resolve-only: el server NO lanza el orquestador
// (el daemon no tiene TTY / cmux fiable), solo resuelve su ref. Por eso hay tres desenlaces:
//   ORCH_OK       (verde) — ref resuelto → enfocado.
//   ORCH_NOT_RUNNING (rojo) — el orquestador no corre → hint accionable `kodo orchestrate`.
//   ORCH_ERR      (rojo, `[!]`) — la red/HTTP falló (reason honesto en el footer).
export const ORCH_OK = 'opening orchestrator…';
export const ORCH_NOT_RUNNING = 'orchestrator not running — run: kodo orchestrate';
/** @param {string} reason */
export const ORCH_ERR = (reason) => `[!] orchestrator failed (${reason}) — press any key`;

/**
 * Phase 37 D-02 + D-06: handler de Enter — guard alive===false + invocación never-throws de
 * onFocus + mapeo del discriminated union a los mensajes literal-estables D-05.
 *
 * NOTA de comportamiento preservada VERBATIM: este handler NO toca `footerColor` (a diferencia de
 * `o`/`O`/`d`). El footer hereda el color que hubiera — así estaba desde Phase 37.
 *
 * @param {any} row - fila seleccionada (el caller ya garantizó que no es null).
 * @param {any} ctx
 */
export async function focusRow(row, ctx) {
  if (row.alive === false) {
    // D-02: cero invocación de cmux sobre workspaces muertos. La marca textual
    // `(zombie)` ya pinta el estado (Phase 36 D-09); este mensaje confirma el
    // rechazo en el footer para que el operador vea por qué Enter no hizo nada.
    ctx.setFocusError(FOCUS_ERR_ZOMBIE);
    return;
  }
  // D-06: runFocus es never-throws (Plan 01 D-01 contract) — siempre resuelve con
  // el discriminado, jamás una excepción. El `?.` cubre el caso donde el caller no
  // inyectó onFocus (tests del módulo sin DI, contexto degradado).
  const result = await ctx.onFocus?.(row.workspace_ref);
  if (result && !result.ok) {
    if (result.code === 'ENOENT') {
      ctx.setFocusError(FOCUS_ERR_ENOENT);
    } else {
      // NON_ZERO_EXIT (`detail` = code numérico de exit) o SPAWN_ERROR
      // (`detail` = string del Error.message). En ambos casos, el operador ve
      // la pista útil (`code N` o `code unknown`) en el footer.
      const n = result.detail ?? 'unknown';
      ctx.setFocusError(focusErrFailed(n));
    }
  }
}

/**
 * Phase 48 D-01/D-02/D-04/D-05 (OPEN-01/02/03): handler open-in-manager. Lee `row.task_url` (ya
 * persistido al lanzar — NO fetch, distinto de c/l). DIVERGENCIAS respecto al Enter handler:
 *   - SIN guard alive (D-04): `o` funciona sobre alive/zombie/dismissed por igual.
 *   - El ÚNICO guard es no-URL (D-05): sin task_url → footer BARE `no task URL for this session`
 *     (no `[!]`, no `— press any key`) y onOpen NUNCA se invoca (open jamás recibe un arg
 *     falsy/basura). Es un no-op benigno, no un error.
 *   - En éxito: footer VERDE transitorio OPEN_OK(ref) (D-01/D-02) — diverge del silencio de
 *     focus.js porque la TUI no muestra otro cambio visible.
 * runOpen es never-throws (Plan 01 contract); el `?.` cubre el contexto degradado sin onOpen
 * (tests del módulo sin DI), espejo de onFocus. El footer transitorio se limpia con el
 * clear-on-any-input (D-03 — sin timer dedicado).
 *
 * @param {any} row
 * @param {any} ctx
 */
export async function openRow(row, ctx) {
  if (!row.task_url) {
    ctx.setFocusError(OPEN_ERR_NO_URL);
    ctx.setFooterColor('red');
    return;
  }
  const result = await ctx.onOpen?.(row.task_url);
  if (!result || result.ok !== false) {
    // Éxito (o contexto degradado sin onOpen): footer verde de confirmación. REF =
    // task_ref (el mismo identificador que muestra la tabla), fallback a task_id.
    ctx.setFocusError(OPEN_OK(row.task_ref ?? row.task_id));
    ctx.setFooterColor('green');
  } else if (result.code === 'ENOENT') {
    ctx.setFocusError(OPEN_ERR_ENOENT);
    ctx.setFooterColor('red');
  } else if (result.code === 'BAD_PROTOCOL') {
    ctx.setFocusError(OPEN_ERR_BAD_PROTOCOL);
    ctx.setFooterColor('red');
  } else {
    // NON_ZERO_EXIT (`detail` = exit code numérico) o SPAWN_ERROR (`detail` = Error.message).
    const n = result.detail ?? 'unknown';
    ctx.setFocusError(openErrFailed(n));
    ctx.setFooterColor('red');
  }
}

/**
 * Tecla `O`: ENFOCAR el orquestador — NO requiere fila seleccionada (no es una sesión de tarea,
 * vive en el workspace cmux `kodo-orchestrator`). Contrato resolve-only, never-throws:
 *   1. openOrchestrator → el server RESUELVE el `workspace:N` (NO lanza: el daemon no tiene
 *      TTY/cmux fiable). workspace_ref === null ⇒ el orquestador no corre.
 *   2. onFocus(ref) → cmux select-workspace (mismo mecanismo que Enter).
 * Feedback transitorio en el footer (clear-on-any-input, sin timer), espejo de `o`/Enter.
 *
 * @param {any} ctx
 */
export async function focusOrchestrator(ctx) {
  const res = await openOrchestrator(ctx.baseUrl, ctx.fetchFn);
  if (!res.ok) {
    ctx.setFocusError(ORCH_ERR(res.error));
    ctx.setFooterColor('red');
    return;
  }
  if (!res.workspace_ref) {
    // Resuelto OK pero el orquestador no está corriendo: hint accionable, no es un error.
    ctx.setFocusError(ORCH_NOT_RUNNING);
    ctx.setFooterColor('red');
    return;
  }
  const fr = await ctx.onFocus?.(res.workspace_ref);
  if (fr && !fr.ok) {
    if (fr.code === 'ENOENT') ctx.setFocusError(FOCUS_ERR_ENOENT);
    else ctx.setFocusError(focusErrFailed(fr.detail ?? 'unknown'));
    ctx.setFooterColor('red');
  } else {
    // Éxito (o contexto degradado sin onFocus): footer verde.
    ctx.setFocusError(ORCH_OK);
    ctx.setFooterColor('green');
  }
}

/**
 * Phase 42 D-01/D-07-TUI (DISMISS-02/04): primera `d`. Espejo de c/l (no-op si no hay fila —
 * el caller ya filtra) + el guard INVERSO del Enter (alive===true en vez de alive===false).
 *
 * @param {any} row
 * @param {any} ctx
 */
export function armDismiss(row, ctx) {
  if (row.alive === true) {
    // DISMISS-04/SC#2: `d` JAMÁS descarta una sesión viva. NO entra en confirm, NO manda
    // DELETE — guard de UX (la autoridad TOCTOU es server-side, D-08). Mensaje rojo transitorio.
    ctx.setFocusError(DISMISS_GUARD_ALIVE);
    ctx.setFooterColor('red');
    return;
  }
  // D-02/D-13: arma capturando la IDENTIDAD (task_id) + el ref legible para el copy. El poll
  // sigue corriendo bajo confirm (D-05) — el target stale lo caza el 409 server-side al confirmar.
  ctx.setArmedTaskId(row.task_id);
  ctx.setArmedTaskRef(row.task_ref ?? row.task_id);
  ctx.setMode('confirm');
}

/**
 * Rama DISMISS del mode:'confirm' (App.js rutea aquí cuando armedSessionId == null). El armed
 * prompt DISMISS_CONFIRM se DERIVA de `mode==='confirm'` en SessionTable, NO de focusError — así
 * el clear-on-any-input no consume el segundo `d` (RESEARCH Pitfall 4). Es persistente (D-03: sin
 * timer); solo `d` ejecuta, cualquier otra tecla (incl. Esc) cancela.
 *
 * @param {string} input
 * @param {any} ctx
 */
export async function handleDismissConfirmInput(input, ctx) {
  if (input === 'd') {
    // D-02: segunda `d` → ejecuta. dismissSession es never-throws (D-10) → el `await` es legal
    // sin try/catch (ningún throw llega a React, SC#4). El re-check TOCTOU autoritativo vive
    // server-side (D-07/D-08): un 409 'alive' vuelve como {ok:false,error:'alive'} y se pinta rojo.
    // WR-01 guard: si por bug de estado armedTaskId es null/vacío, abortar silenciosamente.
    if (!ctx.armedTaskId) {
      ctx.setArmedTaskRef(null);
      ctx.setMode('list');
      return;
    }
    const res = await dismissSession(ctx.baseUrl, ctx.armedTaskId, ctx.fetchFn);
    const ref = ctx.armedTaskRef ?? ctx.armedTaskId ?? '';
    // D-09: el matiz se DERIVA de actions[] (mapDismissResult puro), no de un color lookup.
    const m = mapDismissResult(res, ref);
    let text;
    if (m.kind === 'ok') text = DISMISS_OK(ref);
    else if (m.kind === 'dirty') text = DISMISS_PARTIAL_DIRTY(ref);
    else if (m.kind === 'warn') text = DISMISS_PARTIAL_WARN(ref);
    else text = DISMISS_ERR(m.reason ?? 'error');
    ctx.setFocusError(text);
    ctx.setFooterColor(m.color);
    ctx.setArmedTaskId(null);
    ctx.setArmedTaskRef(null);
    ctx.setMode('list');
    // KODO-78: cierra el ciclo VISUAL del dismiss. El DELETE ya resolvió server-side, pero la tabla
    // se refresca solo por el tick del poll (2,5 s, hasta 10 s con el backoff abierto), así que la
    // fila descartada seguía pintada bajo un footer que decía "dismissed". Se refresca en AMBOS
    // desenlaces, no solo en el éxito: el 409 `alive` significa que la fila REVIVIÓ entre el arm y
    // el confirm, y es justo el caso en que el snapshot de la tabla está mintiendo. Un fallo de red
    // también se refresca — el kick es una sola request y el backoff sigue gobernando el ritmo.
    // never-throws: `refreshNow` solo invalida el tick vigente; el `?.` cubre el ctx degradado.
    ctx.refreshNow?.();
    return;
  }
  // D-04: Esc Y cualquier otra tecla cancelan (solo `d` ejecuta). Sin mensaje, sin timer (D-03).
  ctx.setArmedTaskId(null);
  ctx.setArmedTaskRef(null);
  ctx.setMode('list');
}
