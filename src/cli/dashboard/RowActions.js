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
//   `O`   → `focusOrchestrator`   (resolve + focus, o launch si no hay; no requiere fila)
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
 * KODO-89: `reason` es la línea útil del stderr de cmux (p.ej. `invalid_params: Missing or invalid
 * workspace_id` para un ref muerto). Sin ella el footer se queda en el formato de siempre.
 * @param {number|string} code
 * @param {string} [reason]
 */
export const focusErrFailed = (code, reason) =>
  `[!] cmux focus failed (code ${code}${reason ? `: ${reason}` : ''}) — press any key`;

// KODO-89: cmux 0.64 antepone a CADA `select-workspace` un aviso de alias por stderr, también
// cuando sale bien. No es el motivo de nada, así que no puede acabar en el footer.
const CMUX_ALIAS_NOTICE = /is now an alias for/;
const REASON_MAX = 80;

/**
 * Última línea con contenido de un stderr, sin el aviso de alias de cmux ni el prefijo `Error:`,
 * acotada para que quepa en el footer. `''` si no queda nada.
 * @param {unknown} stderr
 */
function stderrReason(stderr) {
  const lines = String(stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !CMUX_ALIAS_NOTICE.test(l));
  const last = (lines.at(-1) ?? '').replace(/^Error:\s*/, '');
  return last.length > REASON_MAX ? `${last.slice(0, REASON_MAX - 1)}…` : last;
}

/**
 * Copy del footer para un focus fallido (Enter y `O` comparten mapeo).
 * @param {{ code: string, detail?: any, stderr?: string }} result
 */
function focusFailMessage(result) {
  if (result.code === 'ENOENT') return FOCUS_ERR_ENOENT;
  return focusErrFailed(result.detail ?? 'unknown', stderrReason(result.stderr));
}

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

// Tecla `O`: ENFOCAR el orquestador (workspace cmux `kodo-orchestrator`) y, si no hay ninguno que
// enfocar, LANZARLO (KODO-89). Copy literal-estable, mismo patrón que OPEN_* / FOCUS_*. El server
// sigue resolve-only (el daemon no tiene TTY / cmux fiable); quien lanza es la TUI, vía `kodo
// orchestrate`. Desenlaces:
//   ORCH_OK          (verde)    — ref resuelto → enfocado.
//   ORCH_LAUNCHING   (amarillo) — sin ref, o ref que cmux no resuelve → `kodo orchestrate` en curso.
//   ORCH_READY       (verde)    — lanzado (o encontrado vivo por el launch) → enfocado.
//   ORCH_LAUNCH_ERR  (rojo)     — `kodo orchestrate` falló o no dejó ref que enfocar.
//   ORCH_NOT_RUNNING (rojo)     — sin ref y sin lanzador cableado (ctx degradado) → hint.
//   ORCH_ERR         (rojo)     — la red/HTTP falló (reason honesto en el footer).
export const ORCH_OK = 'opening orchestrator…';
export const ORCH_NOT_RUNNING = 'orchestrator not running — run: kodo orchestrate';
/** @param {string} reason */
export const ORCH_ERR = (reason) => `[!] orchestrator failed (${reason}) — press any key`;
/** @param {string} why - por qué se lanza: `none registered` o `<ref>: <motivo de cmux>`. */
export const ORCH_LAUNCHING = (why) => `launching orchestrator (${why})…`;
/** @param {string} ref */
export const ORCH_READY = (ref) => `orchestrator ready at ${ref}`;
/** @param {string|number} reason */
export const ORCH_LAUNCH_ERR = (reason) => `[!] orchestrator launch failed (${reason}) — press any key`;

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
    // ENOENT → FOCUS_ERR_ENOENT. NON_ZERO_EXIT (`detail` = code numérico de exit, + el stderr de
    // cmux) o SPAWN_ERROR (`detail` = Error.message) → `code N[: motivo]` en el footer.
    ctx.setFocusError(focusFailMessage(result));
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

// KODO-89: un `kodo orchestrate` a la vez desde esta TUI. El launch tarda varios segundos y un
// segundo `O` impaciente arrancaría otro en paralelo: los dos verían el registro muerto y cada uno
// crearía su workspace — el orquestador duplicado que esta tecla existe para evitar. Estado de
// módulo porque hay una TUI por proceso; se libera en `finally`.
let launchInFlight = false;

/**
 * Tecla `O`: ENFOCAR el orquestador — NO requiere fila seleccionada (no es una sesión de tarea,
 * vive en el workspace cmux `kodo-orchestrator`). never-throws:
 *   1. openOrchestrator → el server RESUELVE el `workspace:N` persistido (NO lanza: el daemon no
 *      tiene TTY/cmux fiable).
 *   2. onFocus(ref) → cmux select-workspace (mismo mecanismo que Enter).
 *   3. KODO-89: sin ref, o con un ref que cmux no resuelve (exit ≠ 0: el orquestador de ayer ya
 *      cerrado), es el MISMO caso — no hay orquestador que enfocar — y se lanza.
 *
 * ENOENT no lanza: sin binario de cmux el launch fallaría igual. La TUI tampoco limpia el registro
 * antes de lanzar: `launchOrchestrator` lo revalida contra el host por UUID y solo lo limpia con
 * evidencia positiva de muerte. Limpiarlo aquí a ciegas borraría el de un orquestador VIVO cuando
 * `orchestrator.json` y `state.orchestrator` divergen, y el launch crearía un duplicado.
 *
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
  let why = 'none registered';
  if (res.workspace_ref) {
    const fr = await ctx.onFocus?.(res.workspace_ref);
    if (!fr || fr.ok) {
      // Éxito (o contexto degradado sin onFocus): footer verde.
      ctx.setFocusError(ORCH_OK);
      ctx.setFooterColor('green');
      return;
    }
    if (fr.code === 'ENOENT' || !ctx.onLaunchOrchestrator) {
      ctx.setFocusError(focusFailMessage(fr));
      ctx.setFooterColor('red');
      return;
    }
    why = `${res.workspace_ref}: ${stderrReason(fr.stderr) || `code ${fr.detail ?? 'unknown'}`}`;
  } else if (!ctx.onLaunchOrchestrator) {
    // Sin lanzador cableado (ctx degradado): el hint accionable de siempre.
    ctx.setFocusError(ORCH_NOT_RUNNING);
    ctx.setFooterColor('red');
    return;
  }
  await launchAndFocusOrchestrator(ctx, why);
}

/**
 * Lanza el orquestador con `kodo orchestrate` y enfoca el ref que deja registrado.
 *
 * El ref se RE-RESUELVE con POST /orchestrator en vez de leerlo del stdout del CLI: el launch
 * renueva `orchestrator.json` tanto al crear uno nuevo como al encontrar uno vivo (gate KODO-16),
 * así que es la misma fuente de verdad que usa el primer intento. Si el launch no pudo verificar
 * nada (host caído, registro de otro cliente) el ref no cambia y el focus falla con su motivo.
 *
 * @param {any} ctx
 * @param {string} why
 */
async function launchAndFocusOrchestrator(ctx, why) {
  ctx.setFocusError(ORCH_LAUNCHING(why));
  ctx.setFooterColor('yellow');
  if (launchInFlight) return;
  launchInFlight = true;
  try {
    const lr = await ctx.onLaunchOrchestrator();
    if (!lr || lr.ok === false) {
      const reason = stderrReason(lr?.stderr) || (lr?.code === 'NON_ZERO_EXIT' ? `code ${lr.detail}` : lr?.detail);
      ctx.setFocusError(ORCH_LAUNCH_ERR(reason ?? 'unknown'));
      ctx.setFooterColor('red');
      return;
    }
    const again = await openOrchestrator(ctx.baseUrl, ctx.fetchFn);
    if (!again.ok || !again.workspace_ref) {
      ctx.setFocusError(ORCH_LAUNCH_ERR(again.ok ? 'no workspace registered' : again.error));
      ctx.setFooterColor('red');
      return;
    }
    const fr = await ctx.onFocus?.(again.workspace_ref);
    if (fr && !fr.ok) {
      ctx.setFocusError(focusFailMessage(fr));
      ctx.setFooterColor('red');
      return;
    }
    ctx.setFocusError(ORCH_READY(again.workspace_ref));
    ctx.setFooterColor('green');
  } finally {
    launchInFlight = false;
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
