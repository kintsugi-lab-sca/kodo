// @ts-check
//
// src/cli/dashboard/App.js — Phase 35 Plan 03 (TUI-06).
//
// Componente root ink del dashboard. En Phase 35 reemplaza el placeholder estático
// del cuerpo (Phase 34) por una STATUS LINE VIVA (D-01): indicador de conexión
// (`● live` / `⚠ server caído`), contador `N sessions` y banner de degradación con
// la edad del último dato bueno. Cablea `usePoll(fetchStatus, …)` (Planes 01+02) y
// mantiene en React el estado de keep-last-good + connection + edad.
//
// Status line viva D-01 (capa de presentación del slice de datos):
//   - banner `kodo dashboard` (arriba) — conservado de Phase 34.
//   - status line central (← reemplaza el placeholder estático del cuerpo de Phase 34):
//       · `● live`            (Text color green)  + `N sessions`   cuando el último poll fue ok.
//       · `⚠ server caído`    (Text color yellow) + `N sessions (last update Ns ago, retrying…)`
//                              cuando el server cayó a mitad pero ya hubo dato bueno (keep-last-good).
//       · `waiting for server` (dimColor, sin contador) al arrancar sin dato bueno.
//   - footer hint `q quit` (abajo) — conservado de Phase 34.
//
// Dos estados de degradación (D-06, Pattern 3 RESEARCH:248-271):
//   - never had good (`lastGoodAt == null`) + !connected → 'waiting for server' (sin contador).
//   - had good + !connected                              → 'stale'  → ⚠ + edad + retrying (keep-last-good).
//   - connected                                          → 'live'   → ● live + N sessions.
// Keep-last-good (D-06, Pitfall 5): en un poll fallido NO se toca `lastGoodCount`/`lastGoodAt` →
// el operador conserva el contexto del último dato bueno en vez de ver un blanqueo.
// Edad (D-08, Pitfall 8): se recalcula en cada intento de poll (`lastAttemptAt - lastGoodAt`),
// NUNCA con un timer de 1s — el `onResult` actualiza `lastAttemptAt` por tick.
//
// JSON corrupto / ECONNREFUSED / HTTP no-ok (D-07): `fetchStatus` (client.js) los colapsa TODOS
// al discriminante `{ok:false}` never-throws → llegan aquí como un poll fallido más, jamás como
// un throw que tire el árbol ink (T-35-05).
//
// Lifecycle + interacción de teclado (mode-gated, Phase 36 Plan 03 — TUI-08/TUI-12):
//   useInput gateado por useStdin().isRawModeSupported (belt-and-suspenders, Pitfall 1). Un flag
//   `mode: 'list' | 'filter'` enruta las teclas (UI-SPEC §Interaction Contract):
//   - modo LISTA:
//       · `q`     → useApp().exit() (D-08): desmonta limpio, NO process.exit (conservado Phase 34).
//       · `/`     → entra a modo filtro (abre la línea de filtro modal, D-13).
//       · `↑`/`↓` → mueve el índice DERIVADO y re-fija `selectedTaskId` al row resultante; clamp en
//                   los extremos, SIN wrap-around (D-07).
//       · `Esc`   → DELIBERADAMENTE ignorado (reservado para overlays de Phase 38 — D-11/D-15).
//   - modo FILTRO (contexto MODAL, D-15):
//       · char imprimible → `query += char` (filtra en vivo, D-13).
//       · Backspace/Delete → pop; si la query queda vacía → vuelve a modo lista.
//       · `Enter` → confirma: vuelve a modo lista MANTENIENDO el filtro aplicado (D-15).
//       · `Esc`   → cancela: limpia la query y vuelve a modo lista (scope MODAL — D-15; NO contradice
//                   la reserva de Esc en modo lista). El cursor se preserva por identidad (D-16).
// El filtro (parseFilter/applyFilter de select.js) hace match por SUBSTRING via String.includes —
// jamás compila un patrón regex desde la query (anti-ReDoS / anti-inyección, Security V5 / T-36-01).
//
// Color-isolation (D-12): todo el color sale de props de <Text> de ink; cero import del helper
// de color del CLI clásico / picocolors. Markup via React.createElement plano (no JSX, no build).

import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { fetchStatus, fetchComments, fetchLogs, dismissSession } from './client.js';
import { usePoll } from './usePoll.js';
import {
  sortSessions,
  applyFilter,
  parseFilter,
  resolveSelection,
  countByStatus,
  grepLogs,
  mapDismissResult,
  deriveAnyGsd,
  deriveAnyProgress,
  computeAdoptable,
  resolveProjectId,
} from './select.js';
import { deriveRepo } from './format.js';
import { readPlan } from './plan.js';
import { readGsdProgress } from './progress.js';
import { existsSync } from 'node:fs';
import { computeRealWorktreePath } from '../../session/state.js';
import { resolvePhase } from '../../gsd/resolver.js';
import SessionTable from './SessionTable.js';
import { getEditableFields, validateField, getByPath, setByPath } from '../../config-validate.js';
// Phase 64 Plan 02 (PROJ-02): validador de ruta-directorio never-throws (módulo adyacente, NO
// config-validate.js que es 0-I/O — Plan 01). Corre ANTES de saveProjectsFn (T-64-06).
import { validateExistingDir } from '../../path-validate.js';
// Phase 64 Plan 02 (D-06): helpers PUROS de forma dual de projects.json (Plan 01). Preservan
// EXACTAMENTE `string | { default, modules }` que consumen manager.js/adopt.js (T-64-07).
import { setProjectPath, removeProjectMapping, getProjectPath } from '../../projects-shape.js';

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

// Phase 64 Plan 02 (D-01/D-02/D-07): copy literal-estable del editor de PROYECTOS. EXPORTADAS para
// que los tests las importen y asseren equality sin duplicar strings (mismo patrón CONFIG_*/OVERLAY_*).
// SessionTable.js (Task 3) también las importa → mata el drift code/render.
//   - PROJECTS_OVERLAY_TITLE / PROJECTS_LOADING: cabecera + estado transitorio del fetch async.
//   - PROJECTS_UNMAPPED: estado de fila sin ruta (espejo del wizard `cli.js:667`).
//   - PROJECTS_SAVED_RESTART (ámbar): aviso transitorio tras guardar — el server/daemon no recarga
//     en caliente (PERSIST-03/D-06). Va en focusError/footerColor (transitorio, ya de vuelta en projects).
//   - PROJECTS_REMOVED(ref) (ámbar): feedback de quitar un mapeo (PROJ-03).
//   - PROJECTS_SAVE_FAILED (rojo): la escritura local falló; projects.json previo intacto (defensa en
//     profundidad — saveProjects es síncrono atómico). Va en projectsEditError (estado dedicado).
//   - PROJECTS_LOAD_FAILED(reason) (rojo): el fetch de la lista remota falló — dirige projects-error
//     con la pista de teclas r/Esc (PROJ-05/D-07). LOAD-BEARING: distingue 0-proyectos de error de red.
export const PROJECTS_OVERLAY_TITLE = 'proyectos de kodo';
export const PROJECTS_LOADING = 'cargando proyectos…';
export const PROJECTS_UNMAPPED = '[sin mapear]';
export const PROJECTS_SAVED_RESTART = 'guardado — reinicia el server/daemon para aplicar los cambios';
export const PROJECTS_SAVE_FAILED = '[!] no se pudo guardar projects.json — el archivo previo quedó intacto';
/** @param {string} ref - identifier del proyecto cuyo mapeo se quitó. */
export const PROJECTS_REMOVED = (ref) => `mapeo de ${ref} quitado — reinicia el server/daemon para aplicar`;
/** @param {string} reason - mensaje del fallo de fetch (red/timeout/HTTP). */
export const PROJECTS_LOAD_FAILED = (reason) =>
  `[!] no se pudo cargar la lista de proyectos (${reason}) — r reintentar · Esc salir`;

// Default INERTE de loadConfigFn para los tests del módulo sin DI (el runtime real inyecta `loadConfig`
// de src/config.js, y los tests de integración inyectan su propio fixture). Shape mínimo que satisface
// getEditableFields (provider + los 11 paths editables) — sin secretos. NO es la fuente de verdad de
// runtime, solo evita un crash si App se renderiza sin la prop.
const DEFAULT_EDITOR_CONFIG = {
  provider: 'plane',
  providers: { plane: { states: { trigger: 'In Progress', review: 'In review', done: 'Done' } } },
  cmux: { colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' } },
  claude: { default_model: 'opus', max_parallel: 3 },
  server: { idle_threshold_min: 5, stuck_threshold_min: 30 },
};

// Phase 39 D-06: altura del viewport del body scrollable del overlay. ÚNICA fuente de verdad —
// SessionTable.js la importa para el slice del render y App.js la usa para el clamp de scrollOffset
// (sin esto, el clamp y el render divergen: WR-01). El snapshot congelado se sliceа
// [scrollOffset, scrollOffset+VIEWPORT) → el render nunca pinta miles de líneas (mitiga T-39-04).
export const OVERLAY_VIEWPORT = 18;

/**
 * Componente root del dashboard TUI.
 *
 * `fetchFn` + las opciones de clock (`now`/`schedule`/`cancel`/`scheduleTimeout`/`cancelTimeout`/
 * `baseMs`/`maxMs`) son props de INYECCIÓN opcionales: en runtime caen al `globalThis.fetch` /
 * `Date.now` / timers reales (defaults de `fetchStatus` y `usePoll`); en tests se inyectan fakes
 * para un render hermético sin red ni timers reales (igual que `baseUrl` ya se inyectaba en
 * Phase 34).
 *
 * @param {object} props
 * @param {string} props.baseUrl - Base URL del server kodo (resuelta en index.js).
 * @param {typeof globalThis.fetch} [props.fetchFn] - fetch inyectable. Default `globalThis.fetch`.
 * @param {() => number} [props.now] - reloj para la edad (D-08). Default `Date.now`.
 * @param {(fn: () => void, ms: number) => any} [props.schedule] - re-arme del tick (usePoll opt).
 * @param {(handle: any) => void} [props.cancel] - cancela el timer del tick (usePoll opt).
 * @param {(fn: () => void, ms: number) => any} [props.scheduleTimeout] - timeout de abort (usePoll opt).
 * @param {(handle: any) => void} [props.cancelTimeout] - cancela el timeout de abort (usePoll opt).
 * @param {number} [props.baseMs] - override del intervalo base del backoff (usePoll opt).
 * @param {number} [props.maxMs] - override del cap del backoff (usePoll opt).
 * @param {(ref: string) => Promise<{ok: true} | {ok: false, code: 'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail?: any}>} [props.onFocus]
 *   Phase 37 D-01: callback never-throws inyectado por `runDashboard` (Plan 03) que invoca
 *   `runFocus({exec, ref, binary})`. El handler de Enter lo `await`a tras el guard alive
 *   (D-02) y mapea `result.code` a uno de los 3 mensajes literal-estables D-05.
 * @param {(url: string) => Promise<{ok: true} | {ok: false, code: 'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR'|'BAD_PROTOCOL', detail?: any}>} [props.onOpen]
 *   Phase 48 D-01: callback never-throws inyectado por `runDashboard` que invoca
 *   `runOpen({exec, url})`. El handler de `o` lo `await`a tras el guard no-URL (D-05) y mapea
 *   `result.code` a OPEN_ERR_ENOENT / OPEN_ERR_BAD_PROTOCOL / openErrFailed; en éxito muestra
 *   el footer verde OPEN_OK (D-01/D-02). SIN guard alive (D-04: alive/zombie/dismissed por igual).
 * @param {() => Promise<Array<{ workspaceRef: string, cwd: string, sessionId: string, kind: string }>>} [props.onAdoptDiscover]
 *   Phase 56 D-01/D-03: callback never-throws inyectado por `runDashboard` (index.js) que invoca
 *   `host.listAgentSurfaces()` typeof-gated (fail-open a `[]` si el host no lo soporta). El handler
 *   de `a` lo `await`a, diffea contra el snapshot vivo de `/status` (computeAdoptable, D-02) y abre
 *   el picker overlay con las adoptables; vacío/unsupported → footer ADOPT_NONE, mode sigue list.
 * @param {(args: { workspaceRef: string, cwd: string, sessionId: string, projectId: string, title?: string, description?: string }) => Promise<{ok: true} | {ok: false, code: 'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail?: any}>} [props.onAdopt]
 *   Phase 56 D-06/D-07: callback never-throws inyectado por `runDashboard` que invoca
 *   `runAdopt({exec, execPath, kodoBin, ...})`. El segundo `a` del double-confirm lo `await`a y mapea
 *   `result.code` a ADOPT_OK (verde) / ADOPT_ERR_ENOENT / adoptErrFailed (rojo). never-throws (D-07).
 *   Phase 62 ORCH-02: el `args` lleva ahora `title`/`description` derivados por onDerive (fusión).
 * @param {(args: { cwd: string, sessionId: string }) => Promise<{ title?: string, description?: string }>} [props.onDerive]
 *   Phase 62 D-08/D-11 (ORCH-02): callback never-throws inyectado por `runDashboard` (index.js) que
 *   invoca `deriveAdoptionMeta(...)` (Plan 01). El handler `a` del picker entra en `mode==='deriving'`
 *   y lo `await`a entre el armado y el confirm; el `{title, description}` resuelto se fusiona en
 *   `armedSurface` (T4 fail-open a {} conserva surface.title). Never-throws — el panel sigue montado.
 * @param {Record<string, string>} [props.projects]
 *   Phase 56 D-05: mapa `projectId → path` (de `loadProjects()`, inyectado por index.js). El reverse-
 *   lookup `resolveProjectId(surface.cwd, projects)` resuelve el `--project` del adopt al armar;
 *   none/ambiguous → footer ADOPT_NO_PROJECT y NO se shellea. Default `{}` (tests del módulo sin DI).
 * @param {() => any} [props.loadConfigFn]
 *   Phase 63 D-09 (Plan 02): lee el snapshot de config al abrir el editor (`e`). Inyectado por
 *   `runDashboard` (Plan 03) con `loadConfig` de src/config.js. El handler `e` lo deep-clona
 *   (`structuredClone`, Pitfall 1) antes de editar — NUNCA muta el objeto devuelto (su spread
 *   superficial `{...DEFAULT_CONFIG}` aliasea el DEFAULT_CONFIG del módulo). Default inerte para
 *   tests del módulo sin DI (espejo de onAdopt/onDerive).
 * @param {(config: any) => Promise<{ ok: boolean, error?: any }>} [props.onSaveConfig]
 *   Phase 63 D-10/UX-04 (Plan 02): escribe el config editado, never-throws. Inyectado por
 *   `runDashboard` con un wrapper de `saveConfig` (escritura atómica temp+rename, PERSIST-05). El
 *   Enter de config-edit lo `await`a tras validar; `{ok:false}` → footer CONFIG_SAVE_FAILED (el
 *   archivo previo queda intacto). Default `async () => ({ ok: true })` (tests del módulo sin DI).
 * @param {() => Promise<{ ok: true, projects: Array<{ id: string, identifier: string, name: string }> } | { ok: false, error: string }>} [props.listProjectsFn]
 *   Phase 64 D-01/D-08 (Plan 02, PROJ-01/05): fetch async de la lista de proyectos del provider.
 *   Inyectado por `runDashboard` (Plan 04) con un wrapper NEVER-THROWS que devuelve un DISCRIMINADO
 *   `{ok}` (NO fail-open a `[]` como onDerive — necesario para distinguir 0-proyectos de error de
 *   red, PROJ-05/A4). El handler `m` lo `await`a bajo un guard de request-token (projectsReqRef):
 *   `{ok:true}` → mode:'projects'; `{ok:false}` → mode:'projects-error'. Default inerte para tests
 *   del módulo sin DI.
 * @param {() => Record<string, any>} [props.loadProjectsFn]
 *   Phase 64 D-08 (Plan 02): lee el mapa local `projects.json` (100% local, never-throws → `{}`).
 *   Se fusiona con la lista remota en el snapshot CONGELADO al abrir. Inyectado con `loadProjects`
 *   de src/config.js. Default `() => ({})` (tests del módulo sin DI).
 * @param {(map: Record<string, any>) => void} [props.saveProjectsFn]
 *   Phase 64 D-06/D-08 (Plan 02, PROJ-02/03): persiste el mapa editado (síncrono atómico vía
 *   `saveProjects`/`writeFileAtomic`). Solo se llama en los carriles de ESCRITURA (editar ruta
 *   válida, quitar mapeo) — JAMÁS en projects-error (carril de LECTURA, PROJ-05). Default inerte.
 * @returns {import('react').ReactElement}
 */
export default function App({
  baseUrl,
  fetchFn,
  now = Date.now,
  schedule,
  cancel,
  scheduleTimeout,
  cancelTimeout,
  baseMs,
  maxMs,
  onFocus,
  onOpen,
  onAdoptDiscover,
  onAdopt,
  onDerive,
  projects = {},
  loadConfigFn = () => DEFAULT_EDITOR_CONFIG,
  onSaveConfig = async () => ({ ok: true }),
  listProjectsFn = async () => ({ ok: true, projects: [] }),
  loadProjectsFn = () => ({}),
  saveProjectsFn = () => {},
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

  // Pantalla completa (TUI polish): el Box raíz adopta la altura de la terminal y el body crece
  // (flexGrow) para empujar el footer al fondo aunque haya pocas filas. NO usa alt-screen — ink
  // sigue renderizando inline, preservando la invariante v0.9/Phase 48 "cero toggle de alt-screen".
  // `termRows` es undefined bajo ink-testing-library (su stdout no expone `rows`) → `height` se
  // omite y el layout cae al comportamiento natural previo (suite intacta).
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(/** @type {number | undefined} */ (stdout?.rows));
  useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') return undefined; // harness de test sin EventEmitter
    const onResize = () => setTermRows(stdout.rows);
    stdout.on('resize', onResize);
    return () => {
      if (typeof stdout.off === 'function') stdout.off('resize', onResize);
    };
  }, [stdout]);

  // Keep-last-good + connection + edad (Discretion Open Question 2: este estado vive en App, no
  // en el hook). `lastGoodAt == null` ⇒ nunca hubo dato bueno (arranque).
  const [lastGoodCount, setLastGoodCount] = useState(/** @type {number | null} */ (null));
  const [lastGoodAt, setLastGoodAt] = useState(/** @type {number | null} */ (null));
  const [connected, setConnected] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [lastError, setLastError] = useState(/** @type {string | null} */ (null));
  const [lastAttemptAt, setLastAttemptAt] = useState(/** @type {number | null} */ (null));

  // Phase 37 D-06: estado local del footer-error rojo. `null` cuando no hay error pendiente.
  // Se setea en el Enter handler (D-02 zombie pre-flight o D-06 post-runFocus mapping) y se
  // limpia en el clear-on-any-input al inicio de useInput (D-04). Vive en App (no en
  // SessionTable) porque la lógica que lo emite (handler de Enter) también vive aquí; el
  // render lo recibe via prop en SessionTable junto al footer (D-04 consistency).
  const [focusError, setFocusError] = useState(/** @type {string | null} */ (null));

  // Phase 42 D-12 (DISMISS-02/03): color del footer transitorio. El `focusError` de Phase 37 era
  // siempre rojo; el dismiss necesita verde/amarillo/rojo según el resultado (D-09). En vez de
  // introducir un objeto {text,color} nuevo (mayor diff), se generaliza con un sibling: el TEXTO
  // sigue en `focusError`, el COLOR en `footerColor` (default 'red' para retro-compat Phase 37).
  // Se setea junto a `focusError` en el handler de `d` y se limpia con él en el clear-on-any-input.
  const [footerColor, setFooterColor] = useState(/** @type {string} */ ('red'));

  // Phase 42 D-01/D-13: target ARMADO del confirm, capturado por IDENTIDAD (task_id) al armar —
  // NUNCA un índice ni un snapshot de fila (el poll sigue corriendo bajo confirm, D-05). El
  // `armedTaskRef` (legible) se captura en paralelo para el copy del footer (task_ref, no task_id —
  // UI-SPEC). `null` cuando no hay nada armado (mode !== 'confirm').
  const [armedTaskId, setArmedTaskId] = useState(/** @type {string | null} */ (null));
  const [armedTaskRef, setArmedTaskRef] = useState(/** @type {string | null} */ (null));

  // Phase 56 D-04 (DETECT-02): target ARMADO del confirm de ADOPT, capturado por IDENTIDAD
  // (sessionId de la surface elegida — NUNCA un índice ni un snapshot de fila). Es un estado
  // SEPARADO de armedTaskId/armedTaskRef (el dismiss arma por task_id; la surface ad-hoc NO es una
  // fila de /status → no tiene task_id). Pitfall 2: la rama mode==='confirm' rutea la segunda tecla
  // por cuál armed-id está set (armedSessionId → `a` ejecuta adopt; armedTaskId → `d` ejecuta
  // dismiss). `armedSurface` stashea {workspaceRef,cwd,sessionId,projectId} resuelto al armar, para
  // pasárselo a onAdopt en el confirm sin re-resolver. `null` cuando no hay adopt armado.
  const [armedSessionId, setArmedSessionId] = useState(/** @type {string | null} */ (null));
  const [armedSurface, setArmedSurface] = useState(
    /** @type {{ workspaceRef: string, cwd: string, sessionId: string, projectId: string, title?: string, description?: string } | null} */ (null),
  );
  // Phase 56 D-03/Pitfall 3: cursor SELECCIONABLE del picker de adopt (índice clamped sobre
  // overlaySnapshot.adoptable, [0, len-1] sin wrap — molde de resolveSelection). Distinto de
  // scrollOffset (lectura): ↑/↓ MUEVEN este cursor cuando overlaySnapshot.kind==='adopt'.
  const [adoptCursor, setAdoptCursor] = useState(0);

  // Phase 36: lista cruda de sesiones (keep-last-good en fallo, misma disciplina que lastGoodCount)
  // y cursor por IDENTIDAD (selectedTaskId, NUNCA un índice — D-05). El índice visible se DERIVA
  // en cada render via resolveSelection sobre la lista ya ordenada+filtrada (TUI-08).
  const [sessions, setSessions] = useState(/** @type {Array<any>} */ ([]));
  const [selectedTaskId, setSelectedTaskId] = useState(/** @type {string | null} */ (null));

  // Phase 36 Plan 03: estado de interacción. `mode` enruta el teclado (list/filter, D-13/D-15);
  // `query` es el filtro EN VIVO (alimenta parseFilter/applyFilter cada render, D-13). El índice
  // posicional previo se guarda en un ref (no provoca re-render) para el clamp de D-06: cuando la
  // fila seleccionada desaparece, resolveSelection cae al vecino del MISMO índice previo.
  const [mode, setMode] = useState(/** @type {'list' | 'filter' | 'overlay' | 'confirm' | 'deriving' | 'config' | 'config-edit' | 'projects' | 'projects-loading' | 'projects-edit' | 'projects-error'} */ ('list'));
  const [query, setQuery] = useState('');

  // Phase 63 Plan 02 (UX-01/02, D-01/D-03/D-04/D-05): estado del editor de config.
  //   - configSnapshot: clon CONGELADO del config al abrir (`e` → structuredClone(loadConfigFn()),
  //     Pitfall 1). Todas las ediciones mutan SOLO clones de este objeto, jamás DEFAULT_CONFIG.
  //   - fieldCursor: índice del campo seleccionado en mode:'config' (clamp [0, fields.length-1]).
  //   - buffer/cursor: text-input controlado de mode:'config-edit' (inserción en `cursor`, NO append).
  //   - configEditError: error de validación/escritura. Estado DEDICADO (NO focusError) — el
  //     clear-on-any-input (línea ~510) consumiría la siguiente tecla si fuera focusError (Pitfall 2).
  const [configSnapshot, setConfigSnapshot] = useState(/** @type {any} */ (null));
  const [fieldCursor, setFieldCursor] = useState(0);
  const [buffer, setBuffer] = useState('');
  const [cursor, setCursor] = useState(0);
  const [configEditError, setConfigEditError] = useState(/** @type {string | null} */ (null));

  // Phase 64 Plan 02 (D-01/D-02/D-07): estado del editor de PROYECTOS (carril async).
  //   - projectsSnapshot: { remote, map } CONGELADO al abrir (la lista remota fusionada con el mapa
  //     local de loadProjectsFn). null cuando el editor está cerrado. El poll /status sigue por
  //     debajo sin tocar este snapshot (molde overlaySnapshot, D-04 de 63).
  //   - projectsError: mensaje del fallo de fetch (string|null). Dirige projects-error. Estado
  //     DEDICADO (NO focusError) — el clear-on-any-input consumiría la tecla `r`/Esc (Pitfall 2).
  //   - projectsEditError: error de validación de ruta / escritura inline (string|null). Estado
  //     DEDICADO (NO focusError ni projectsError) — la siguiente tecla edita, no limpia (Pitfall 2).
  // Reusa `fieldCursor` (cursor de la lista, clamp sin wrap) y `buffer`/`cursor` (text-input).
  const [projectsSnapshot, setProjectsSnapshot] = useState(
    /** @type {{ remote: Array<{ id: string, identifier: string, name: string }>, map: Record<string, any> } | null} */ (null),
  );
  const [projectsError, setProjectsError] = useState(/** @type {string | null} */ (null));
  const [projectsEditError, setProjectsEditError] = useState(/** @type {string | null} */ (null));
  const prevIndexRef = useRef(0);
  // Phase 39 CR-01: token de generación de apertura de overlay. Los handlers `c`/`l` son async
  // (await fetch). Si el operador encola un segundo `c`/`l` o cierra con Esc mientras una request
  // está en vuelo, el setMode('overlay') del post-await reabriría un overlay obsoleto. Cada apertura
  // toma un reqId incrementando este ref; al cerrar (Esc) o reabrir, el ref avanza e invalida la
  // request en vuelo, que tras el await comprueba `overlayReqRef.current !== reqId` y se descarta.
  const overlayReqRef = useRef(0);

  // Phase 64 Plan 02 (D-01, RESEARCH Anti-pattern): token de generación DEDICADO del carril de
  // proyectos. NO reusa overlayReqRef (lo comparten c/l/adopt/deriving): un Esc en projects-loading
  // que avanzara overlayReqRef invalidaría un overlay c/l legítimo en vuelo. Cada apertura/retry de
  // listProjectsFn toma un reqId incrementando este ref; tras el await se descarta si quedó obsoleto
  // (Esc o 2ª apertura durante el fetch — T-64-08 staleness, molde deriving T5).
  const projectsReqRef = useRef(0);

  // Phase 50 (PROG-03, D-09): keep-last-good del progreso vivo. Mapa por session_id → último
  // { n, m, completed } leído con status 'ok' (re-keyed en 50.1 desde task_id, ver DG-07 más
  // abajo: el enrich hace .set(sessionId) / .get(sessionId)). Vive en un useRef (memoria entre polls, NO dispara
  // re-render): ante un fallo transiente de lectura ('error') con un last-good presente, el enrich
  // expone el último N/M conocido (progCell pinta N/M, no '?'). Sin last-good, expone 'error' (→'?').
  const progressLastGoodRef = useRef(/** @type {Map<string, { n: number, m: number, completed: boolean }>} */ (new Map()));

  // Phase 39 (TUI-15/TUI-16): estado de los overlays auxiliares (comentarios `c` / logs `l`).
  //   - overlayKind: qué overlay está abierto ('comments'|'logs'|null).
  //   - scrollOffset: índice de la primera línea visible del body scrollable (D-06, ↑/↓ scrollean).
  //   - overlaySnapshot: contenido CONGELADO al abrir (D-05). El poll de la tabla sigue por debajo
  //     pero este objeto NO se re-escribe por onResult → el texto del overlay no salta bajo el lector.
  //     Forma: { kind, taskRef, status:'ok'|'empty'|'not-found'|'error', lines: string[] } donde
  //     `lines` ya viene proyectado a strings (comentarios o `msg` de cada log entry).
  const [overlayKind, setOverlayKind] = useState(/** @type {'comments'|'logs'|'plan'|'adopt'|null} */ (null));
  const [scrollOffset, setScrollOffset] = useState(0);
  const [overlaySnapshot, setOverlaySnapshot] = useState(
    /** @type {{ kind: 'comments'|'logs'|'plan'|'adopt', taskRef: string, status: string, lines: string[], adoptable?: Array<{ workspaceRef: string, cwd: string, sessionId: string, kind: string }> }|null} */ (null),
  );

  // onResult: en ok refresca el contador/at/connected; en fallo NO toca lastGoodCount/lastGoodAt
  // (keep-last-good, D-06/Pitfall 5). Siempre actualiza lastAttemptAt (edad por poll, D-08).
  const onResult = useCallback(
    (/** @type {{ ok: boolean, data?: any, error?: string }} */ result) => {
      const t = now();
      if (result.ok) {
        setLastGoodCount(result.data.count ?? result.data.sessions.length);
        setLastGoodAt(t);
        setConnected(true);
        setLastError(null);
        // Phase 36: guarda el array de sesiones para la tabla. En !ok NO se toca (keep-last-good).
        setSessions(result.data.sessions ?? []);
      } else {
        setConnected(false);
        setLastError(result.error ?? null);
        // keep-last-good: NO se tocan lastGoodCount/lastGoodAt.
      }
      setLastAttemptAt(t);
    },
    [now],
  );

  usePoll(
    (signal) => fetchStatus(baseUrl, fetchFn, signal),
    onResult,
    [baseUrl],
    { schedule, cancel, scheduleTimeout, cancelTimeout, baseMs, maxMs },
  );

  // Pipeline de derivación OBLIGATORIO (orden fijo — Pitfall 3 / D-16). La query EN VIVO (no '')
  // alimenta el filtro cada render (D-13): teclear re-filtra al instante. El clamp de D-06 usa el
  // índice posicional previo (prevIndexRef) para caer al vecino correcto si la fila desaparece.
  //   sortSessions (copia, DESC, tiebreak task_id) → applyFilter (AND, String.includes) →
  //   resolveSelection (índice derivado por identidad, clamp fallback).
  const sorted = sortSessions(sessions);
  // Phase 50.1 (PROG-03, DG-03/DG-04/DG-06/DG-07): enrich CLIENT-SIDE del progreso vivo, mold del
  // handler `p`/readPlan (App.js:544) — lectura filesystem SÍNCRONA never-throws en el render, SIN
  // await, SIN server.js (cero endpoints nuevos, DG-06). La FUENTE es el bloque `progress:` del
  // STATE.md que GSD mantiene dentro del worktree REAL de la sesión (`.claude/worktrees/<session_id>`),
  // localizado con computeRealWorktreePath(project_path, session_id) — NUNCA `row.worktree_path`
  // persistido (apunta a la ruta `.bg-shell` equivocada, Pitfall 1). Solo las filas GSD
  // (`row.gsd === true`, DG-03) se leen; las no-GSD → '—'. Se enriquece ANTES de
  // deriveAnyProgress/applyFilter para que `row.progress` esté presente en deriveAnyProgress, el
  // filtro y rowCells.
  //
  // Keep-last-good (DG-07): re-keyed por `session_id`. Un fallo transiente ('error') con un last-good
  // en el ref expone el último N/M conocido (progCell pinta N/M, no '?'); sin last-good, expone
  // 'error' (→'?'). Un 'ok' refresca el ref. Un 'no-progress' (ENOENT / STATE.md parcial) → '—'.
  const lastGood = progressLastGoodRef.current;
  const enriched = sorted.map((row) => {
    const projectPath = row.project_path;
    const sessionId = row.session_id;
    // DG-04: la ruta del STATE.md se deriva de project_path + session_id, NUNCA de
    // row.worktree_path (Pitfall 1). Guard anti-traversal del sessionId ANTES de construir la ruta
    // (T-501-traversal, defensa en profundidad): String.includes, NO regex (anti-ReDoS, mold
    // plan.js:120-121). El session_id es UUID por construcción (manager.js); falta o no usable → '—'.
    const usable =
      sessionId &&
      projectPath &&
      !sessionId.includes('/') &&
      !sessionId.includes('\\') &&
      !sessionId.includes('..');
    if (!usable) return { ...row, progress: { status: 'no-progress' } };
    // Phase 61 (PROG-04, D-2): resolución de path con FALLBACK. Sesión LANZADA por kodo →
    // su STATE.md vive en el worktree aislado (`.claude/worktrees/<sid>`, computeRealWorktreePath,
    // preserva Pitfall 1). Sesión ADOPTADA → no tiene worktree de kodo; su STATE.md vive en
    // `<project_path>/.planning/STATE.md`. Si el dir del worktree existe usamos ese; si no, project_path.
    const worktreeBase = computeRealWorktreePath(projectPath, sessionId);
    const base = existsSync(worktreeBase) ? worktreeBase : projectPath;
    // Phase 61 (PROG-04, D-1): gate DINÁMICO. El progreso se muestra si hay un STATE.md GSD legible
    // en el path resuelto, SIN depender del flag `gsd` persistido (una sesión adoptada que se vuelve
    // GSD después se enciende sola). readGsdProgress es never-throws: 'no-progress' (ENOENT / sin
    // progress:) → '—'; 'error' → keep-last-good; 'ok' → N/M. Reemplaza el corte por flag (DG-03).
    const res = readGsdProgress(base, {}); // never-throws (mold readLightPlan)
    if (res.status === 'ok') {
      lastGood.set(sessionId, { n: res.n, m: res.m, completed: res.completed });
      return { ...row, progress: res };
    }
    if (res.status === 'error') {
      const prev = lastGood.get(sessionId);
      // last-good presente → sobrevive el N/M (status 'ok'); ausente → 'error' (progCell pinta '?').
      return { ...row, progress: prev ? { status: 'ok', ...prev } : { status: 'error' } };
    }
    return { ...row, progress: res }; // 'no-progress' → '—'
  });
  // TUI-18/D-08: flag estructural de presencia GSD derivado del set SIN filtrar (`sorted`),
  // NO de `filtered` (Pitfall 4): la columna phase/mode no debe parpadear cuando una query `/`
  // vacía temporalmente las filas GSD del subconjunto visible.
  const anyGsd = deriveAnyGsd(enriched);
  // Phase 50 (PROG-03, D-06 / Pitfall 5): espejo de deriveAnyGsd — flag estructural sobre el set
  // SIN filtrar (`enriched`, no `filtered`). La columna `prog` no parpadea bajo `/`.
  const anyProgress = deriveAnyProgress(enriched);
  const filtered = applyFilter(enriched, parseFilter(query), deriveRepo);
  const sel = resolveSelection(filtered, selectedTaskId, prevIndexRef.current);
  const counts = countByStatus(filtered);
  // hasQuery distingue los dos estados vacíos en SessionTable (D-12): `no sessions match` (hay
  // query activa que oculta todo) vs `no active sessions` (lista realmente vacía).
  const hasQuery = query.trim().length > 0;

  // Phase 64 Plan 02 (D-01, RESEARCH Pattern 1+2): apertura/retry del editor de proyectos. Compartido
  // por el handler `m` (mode:'list') y por `r` (mode:'projects-error') — el carril es idéntico. Entra a
  // projects-loading, captura un reqId DEDICADO (projectsReqRef), `await`a el fetch never-throws
  // discriminado, y tras el await DESCARTA el resultado si el ref avanzó (Esc/2ª apertura, T-64-08).
  // Éxito → snapshot CONGELADO { remote, map=loadProjectsFn() } + mode:'projects'. Fallo → projects-error
  // (PROJ-05). NO toca selectedTaskId (UX-03: resolveSelection re-deriva la fila al volver).
  const runProjectsFetch = useCallback(async () => {
    setMode('projects-loading');
    const reqId = ++projectsReqRef.current;
    const result = await listProjectsFn();
    if (projectsReqRef.current !== reqId) return; // T-64-08: cancelada/superada durante el await
    if (result && result.ok) {
      setProjectsSnapshot({ remote: result.projects ?? [], map: loadProjectsFn() });
      setFieldCursor(0);
      setProjectsError(null);
      setProjectsEditError(null);
      setMode('projects');
    } else {
      setProjectsError((result && result.error) || 'error desconocido');
      setMode('projects-error');
    }
  }, [listProjectsFn, loadProjectsFn]);

  // useInput mode-gated (TUI-08/TUI-12). Declarado DESPUÉS del pipeline para que el closure capture
  // `filtered`/`sel` actuales (su índice derivado es la base del movimiento clamp del cursor).
  //
  // Phase 37 D-Claude's-Discretion: callback `async` para que el handler de Enter pueda
  // `await onFocus(...)` (ink permite handlers async — no awaitea el return; los state
  // updates del setFocusError llegan cuando la promise resuelve). Simétrico con el patrón
  // `await fetchStatus(...)` de usePoll (Phase 35 D-07).
  useInput(
    async (input, key) => {
      // Phase 37 D-04: cualquier tecla limpia focusError ANTES de procesar el resto del
      // routing. La tecla SE CONSUME (early return — no propaga a Enter/q/filter/etc): el
      // operador hace dismiss del error y vuelve a interactuar con un keystroke separado.
      // Va ANTES del mode-gate para que el dismiss aplique también si el operador estaba
      // tipeando en filtro cuando el error apareció. No choca con la reserva D-15 de Esc en
      // modo lista porque el dismiss es modal del propio error, no del modo de la lista.
      if (focusError != null) {
        setFocusError(null);
        return;
      }
      // Phase 39 (TUI-15/TUI-16 — D-05/D-06): SUB-MODO overlay. Va ANTES del mode-gate de filtro:
      // mientras un overlay está abierto, ↑/↓ SCROLLEAN el contenido (no navegan filas) y Esc cierra
      // restaurando mode:'list' SIN tocar selectedTaskId (cursor preservado GRATIS — resolveSelection
      // re-deriva la misma fila al volver). Cualquier otra tecla se traga (early return) mientras se lee.
      if (mode === 'overlay') {
        if (key.escape) {
          overlayReqRef.current++; // CR-01: invalida cualquier apertura `c`/`l` aún en vuelo
          setMode('list');
          setOverlayKind(null);
          return;
        }
        // Phase 56 D-03/D-04/Pitfall 3: SUB-MODO picker de adopt. Diverge del overlay c/l/p de
        // lectura: ↑/↓ mueven un CURSOR seleccionable sobre adoptable[] (no scroll); `a` ARMA el
        // adopt de la surface bajo el cursor (resuelve projectId; none/ambiguous → ADOPT_NO_PROJECT
        // + cierra picker, no arma). Cualquier otra tecla se traga mientras se elige.
        if (overlaySnapshot && overlaySnapshot.kind === 'adopt') {
          const adoptable = overlaySnapshot.adoptable ?? [];
          if (key.upArrow) {
            setAdoptCursor((i) => Math.max(0, i - 1)); // clamp [0,len-1] sin wrap (molde resolveSelection)
            return;
          }
          if (key.downArrow) {
            setAdoptCursor((i) => Math.min(adoptable.length - 1, i + 1));
            return;
          }
          if (input === 'a') {
            // Arma el adopt de la surface bajo el cursor. D-05: el reverse-lookup cwd→projectId es el
            // ÚNICO punto que puede impedir el shell — none/ambiguous → footer ADOPT_NO_PROJECT (rojo)
            // + cierra el picker, NUNCA arma (cero onAdopt). Match único → arma por sessionId (D-04) y
            // stashea el payload resuelto para el confirm.
            const surface = adoptable[adoptCursor];
            if (!surface) {
              overlayReqRef.current++;
              setMode('list');
              setOverlayKind(null);
              return;
            }
            const r = resolveProjectId(surface.cwd, projects);
            if ('error' in r) {
              setFocusError(ADOPT_NO_PROJECT(surface.cwd));
              setFooterColor('red');
              overlayReqRef.current++; // cierra el picker
              setMode('list');
              setOverlayKind(null);
              return;
            }
            // Match único: arma el confirm por IDENTIDAD (sessionId) + stashea el payload. NO se setea
            // footer al entrar en confirm/deriving (Pitfall 4): el copy se DERIVA de mode+armedSurface
            // en SessionTable, así el clear-on-any-input no consume el segundo `a`.
            setArmedSessionId(surface.sessionId);
            setOverlayKind(null);
            // Phase 62 D-08 (ORCH-02): derive-then-confirm. Entre el armado y el confirm se interpone
            // el estado transitorio 'deriving': armamos el payload BASE (con el title de la surface
            // como fallback), entramos en 'deriving' (spinner DERIVE_PROGRESS), y await onDerive. El
            // handler ya es async (usa await onAdopt en el confirm) → el await es legal. onDerive es
            // never-throws (Plan 01 contract / D-11): el try/catch fail-open a {} es defensa en
            // profundidad (el contrato es que NUNCA lanza, pero si lo hiciera el panel sigue montado).
            setArmedSurface({
              workspaceRef: surface.workspaceRef,
              cwd: surface.cwd,
              sessionId: surface.sessionId,
              projectId: r.projectId,
              // Phase 56-06: el título auto-derivado de cmux (← AgentSurface.title) es el FALLBACK del
              // título derivado (T4 fail-open conserva surface.title). Ausente → onAdopt lo omite.
              title: surface.title,
            });
            setMode('deriving');
            // Phase 62 D-09/T5: token de generación (reusa overlayReqRef, espejo del CR-01 de c/l).
            // Esc en deriving avanza el ref → el resultado tardío se descarta tras el await.
            const reqId = ++overlayReqRef.current;
            /** @type {{ title?: string, description?: string }} */
            let derived = {};
            try {
              derived = (await onDerive?.({ cwd: surface.cwd, sessionId: surface.sessionId })) ?? {};
            } catch {
              derived = {}; // never-throws / fail-open (D-11): defensa en profundidad
            }
            // T5: si overlayReqRef avanzó durante el await (Esc en deriving u otra apertura), esta
            // derivación quedó OBSOLETA → se descarta sin reabrir el confirm.
            if (overlayReqRef.current !== reqId) return;
            // Fusión: el {title, description} derivado entra en armedSurface. T4 fail-open conserva
            // surface.title cuando derived.title es undefined; description undefined cuando no hay.
            setArmedSurface({
              workspaceRef: surface.workspaceRef,
              cwd: surface.cwd,
              sessionId: surface.sessionId,
              projectId: r.projectId,
              title: derived.title ?? surface.title,
              description: derived.description,
            });
            setMode('confirm');
            return;
          }
          return; // traga el resto mientras el operador elige en el picker
        }
        if (key.upArrow) {
          setScrollOffset((o) => Math.max(0, o - 1));
          return;
        }
        if (key.downArrow) {
          // Clamp superior: el último scroll deja el viewport LLENO (no una sola línea). WR-01: usar
          // `lines.length - OVERLAY_VIEWPORT` (el mismo VIEWPORT del slice de SessionTable), no `- 1`.
          const max = overlaySnapshot
            ? Math.max(0, overlaySnapshot.lines.length - OVERLAY_VIEWPORT)
            : 0;
          setScrollOffset((o) => Math.min(max, o + 1));
          return;
        }
        return; // traga el resto mientras el operador lee el overlay
      }
      // Phase 62 D-09 (ORCH-02): SUB-MODO deriving. Va ANTES del confirm: mientras onDerive está en
      // vuelo el footer muestra el spinner DERIVE_PROGRESS (derivado de mode==='deriving' en
      // SessionTable). Esc CANCELA e invalida la derivación en vuelo (avanza overlayReqRef → el
      // resultado tardío se descarta tras el await, T5) y vuelve a list, limpiando el armado. Una
      // segunda `a` (o cualquier otra tecla) se TRAGA: NO encola un segundo onDerive (la derivación
      // ya está corriendo). El poll de /status sigue por debajo (T-62-09: no bloquea el panel).
      if (mode === 'deriving') {
        if (key.escape) {
          overlayReqRef.current++; // T5: invalida la derivación en vuelo (resultado tardío descartado)
          setArmedSessionId(null);
          setArmedSurface(null);
          setMode('list');
          return;
        }
        return; // traga el resto (incl. `a`) mientras la derivación está en vuelo
      }
      // Phase 42 D-01/D-02/D-04 (DISMISS-02): SUB-MODO confirm. Va DESPUÉS del clear-on-any-input
      // y del overlay, ANTES de filter/list. CRÍTICO (RESEARCH Pitfall 4): entrar en `confirm` NO
      // setea el footer transitorio — el armed prompt DISMISS_CONFIRM se deriva de `mode==='confirm'`
      // (NO de focusError), así el clear-on-any-input no consume el segundo `d`. El armed prompt es
      // persistente (D-03: sin timer); solo `d` ejecuta, cualquier otra tecla (incl. Esc) cancela.
      if (mode === 'confirm') {
        // Phase 56 Pitfall 2 (DETECT-02): el confirm tiene DOS consumidores que esperan teclas
        // distintas (dismiss=`d`, adopt=`a`). Se rutea por cuál armed-id está set — armedSessionId
        // != null → flujo ADOPT (solo `a` ejecuta; cualquier otra tecla, incl. `d`/Esc, cancela).
        // Esto va ANTES de la rama dismiss para que una `a` NUNCA dispare un dismiss y una `d` NUNCA
        // dispare un adopt. El dismiss arma por task_id; el adopt por sessionId — estados disjuntos.
        if (armedSessionId != null) {
          if (input === 'a') {
            // Segundo `a` → ejecuta. onAdopt es never-throws (Plan 01 contract / D-07) → el `await`
            // es legal sin try/catch (ningún throw llega a React, el panel ink sigue montado). El `?.`
            // cubre el contexto degradado sin onAdopt (tests del módulo sin DI). WR guard: si por bug
            // de estado armedSurface es null, aborta silenciosamente.
            if (!armedSurface) {
              setArmedSessionId(null);
              setMode('list');
              return;
            }
            const ref = armedSurface.workspaceRef;
            const result = await onAdopt?.(armedSurface);
            if (result?.code === 'ALREADY_ADOPTED') {
              // 56-03: `kodo adopt` salió 0 pero el discriminante --json es un no-op idempotente
              // (la sesión ya estaba adoptada). NO es éxito (no se crea fila) ni error — footer
              // ámbar distinto, para no mostrar el verde engañoso "adopted" del UAT blocker. Va
              // ANTES del check de éxito genérico (result.ok !== false) para no caer en verde.
              setFocusError(ADOPT_ALREADY(ref));
              setFooterColor('yellow');
            } else if (!result || result.ok !== false) {
              // Éxito (o contexto degradado sin onAdopt): footer verde transitorio (D-07). REF =
              // workspaceRef (el identificador legible de la surface ad-hoc, no hay task_ref aún).
              setFocusError(ADOPT_OK(ref));
              setFooterColor('green');
            } else if (result.code === 'ENOENT') {
              setFocusError(ADOPT_ERR_ENOENT);
              setFooterColor('red');
            } else {
              // NON_ZERO_EXIT (`detail` = exit code 1/2 de kodo adopt) o SPAWN_ERROR (`detail` =
              // Error.message). El dashboard NO reinterpreta la semántica — muestra el código (D-07).
              const n = result.detail ?? 'unknown';
              setFocusError(adoptErrFailed(n));
              setFooterColor('red');
            }
            setArmedSessionId(null);
            setArmedSurface(null);
            setMode('list');
            return;
          }
          // Cualquier otra tecla (Esc, `d`, etc.) cancela el adopt. Sin mensaje, sin timer (D-04).
          setArmedSessionId(null);
          setArmedSurface(null);
          setMode('list');
          return;
        }
        if (input === 'd') {
          // D-02: segunda `d` → ejecuta. dismissSession es never-throws (D-10) → el `await` es legal
          // sin try/catch (ningún throw llega a React, SC#4). El re-check TOCTOU autoritativo vive
          // server-side (D-07/D-08): un 409 'alive' vuelve como {ok:false,error:'alive'} y se pinta rojo.
          // WR-01 guard: si por bug de estado armedTaskId es null/vacío, abortar silenciosamente.
          if (!armedTaskId) {
            setArmedTaskRef(null);
            setMode('list');
            return;
          }
          const res = await dismissSession(baseUrl, armedTaskId, fetchFn);
          const ref = armedTaskRef ?? armedTaskId ?? '';
          // D-09: el matiz se DERIVA de actions[] (mapDismissResult puro), no de un color lookup.
          const m = mapDismissResult(res, ref);
          let text;
          if (m.kind === 'ok') text = DISMISS_OK(ref);
          else if (m.kind === 'dirty') text = DISMISS_PARTIAL_DIRTY(ref);
          else if (m.kind === 'warn') text = DISMISS_PARTIAL_WARN(ref);
          else text = DISMISS_ERR(m.reason ?? 'error');
          setFocusError(text);
          setFooterColor(m.color);
          setArmedTaskId(null);
          setArmedTaskRef(null);
          setMode('list');
          return;
        }
        // D-04: Esc Y cualquier otra tecla cancelan (solo `d` ejecuta). Sin mensaje, sin timer (D-03).
        setArmedTaskId(null);
        setArmedTaskRef(null);
        setMode('list');
        return;
      }
      // Phase 63 Plan 02 (D-03): SUB-MODO config (lista de campos navegable, valor read-only). Va
      // ENTRE el bloque confirm y el de filter (espejo del orden D-03 "antes del mode-gate de filtro").
      // Esc → list SIN tocar selectedTaskId (UX-03). ↑/↓ mueven fieldCursor con clamp sin wrap (molde
      // adoptCursor). Enter → precarga el valor del campo en el buffer y entra a config-edit.
      if (mode === 'config') {
        const fields = getEditableFields(configSnapshot);
        if (key.escape) {
          setMode('list'); // UX-03: selectedTaskId intacto → el cursor de la tabla se conserva
          return;
        }
        if (key.upArrow) {
          setFieldCursor((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setFieldCursor((i) => Math.min(fields.length - 1, i + 1));
          return;
        }
        if (key.return) {
          // Precarga el valor ACTUAL del campo (D-05). String(...) porque positiveInt es number en el
          // snapshot — el buffer es siempre texto. cursor al final para edición tipo "append natural".
          const field = fields[fieldCursor];
          if (!field) return;
          const current = String(getByPath(configSnapshot, field.path) ?? '');
          setBuffer(current);
          setCursor(current.length);
          setConfigEditError(null);
          setMode('config-edit');
          return;
        }
        return; // traga el resto mientras navega la lista
      }
      // Phase 63 Plan 02 (D-01/D-05, RESEARCH Pattern 1): SUB-MODO config-edit (text-input controlado).
      // Esc cancela SIN guardar (vuelve a config). ←/→ mueven el cursor con clamp. backspace||delete
      // borra el char anterior al cursor (ambos juntos — Pitfall 3, muchos terminales mandan delete).
      // Char imprimible se INSERTA en `cursor` (NO append ciego). Enter valida → inválido pinta el
      // error (estado dedicado, sigue en config-edit) → válido guarda sobre un deep-clone y avisa.
      if (mode === 'config-edit') {
        const fields = getEditableFields(configSnapshot);
        const field = fields[fieldCursor];
        if (key.escape) {
          setMode('config'); // cancela sin guardar (D-05)
          return;
        }
        if (key.leftArrow) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.rightArrow) {
          setCursor((c) => Math.min(buffer.length, c + 1));
          return;
        }
        if (key.backspace || key.delete) {
          if (cursor > 0) {
            setBuffer((b) => b.slice(0, cursor - 1) + b.slice(cursor));
            setCursor((c) => c - 1);
          }
          return;
        }
        if (key.return) {
          if (!field) {
            setMode('config');
            return;
          }
          // Validación PURA never-throws (src/config-validate.js). Un inválido NUNCA alcanza el disco
          // (CFG-05/D-05): se guarda en configEditError (estado dedicado, Pitfall 2) y se sigue en
          // config-edit — la siguiente tecla edita, no se gasta limpiando el error.
          const res = validateField(field, buffer);
          if (!res.ok) {
            setConfigEditError(res.error);
            return;
          }
          // Pitfall 1: deep-clone ANTES de mutar — setByPath escribe sobre el clon, jamás el snapshot
          // congelado ni DEFAULT_CONFIG. onSaveConfig es never-throws (D-10 contract); el try/catch es
          // defensa en profundidad (si lanzara, el panel ink sigue montado — UX-04/D-12).
          const next = structuredClone(configSnapshot);
          setByPath(next, field.path, res.value);
          try {
            const result = await onSaveConfig(next);
            if (!result || result.ok !== false) {
              // Éxito: el snapshot adopta el valor guardado; aviso de reinicio transitorio (PERSIST-03/
              // D-10). El aviso va en focusError/footerColor (transitorio, ya de vuelta en config) — el
              // clear-on-any-input lo descarta con la próxima tecla, comportamiento deseado.
              setConfigSnapshot(next);
              setConfigEditError(null);
              setFocusError(CONFIG_SAVED_RESTART);
              setFooterColor('yellow');
              setMode('config');
            } else {
              // Escritura fallida (PERSIST-05: el config previo quedó intacto). En configEditError (NO
              // focusError) → sigue visible mientras el operador sigue en el editor (UX-04/D-12).
              setConfigEditError(CONFIG_SAVE_FAILED);
            }
          } catch {
            setConfigEditError(CONFIG_SAVE_FAILED); // never-throws de respaldo (defensa en profundidad)
          }
          return;
        }
        // Char imprimible: inserta en la posición del cursor (NO append ciego — RESEARCH Pattern 1).
        if (input && !key.ctrl && !key.meta) {
          setBuffer((b) => b.slice(0, cursor) + input + b.slice(cursor));
          setCursor((c) => c + input.length);
          return;
        }
        return; // traga el resto (teclas de control no mapeadas)
      }
      // Phase 64 Plan 02 (D-01/D-02/D-07): SUB-MÁQUINA del editor de PROYECTOS. Va ENTRE config-edit
      // y filter (espejo del orden D-02 "antes del mode-gate de filtro"). Cuatro modos: el transitorio
      // projects-loading (fetch en vuelo), la lista navegable projects, el text-input projects-edit y
      // la degradación projects-error (PROJ-05). Todos never-throws — el panel ink jamás se desmonta.
      if (mode === 'projects-loading') {
        // Esc CANCELA e invalida el fetch en vuelo: avanza projectsReqRef → el resultado tardío se
        // descarta tras el await (T-64-08, molde deriving ~682). selectedTaskId intacto (UX-03).
        if (key.escape) {
          projectsReqRef.current++;
          setMode('list');
          return;
        }
        return; // traga el resto mientras carga
      }
      if (mode === 'projects') {
        const items = projectsSnapshot?.remote ?? [];
        if (key.escape) {
          setMode('list'); // UX-03: selectedTaskId intacto → el cursor de la tabla se conserva
          return;
        }
        if (key.upArrow) {
          setFieldCursor((i) => Math.max(0, i - 1)); // clamp sin wrap (molde adoptCursor)
          return;
        }
        if (key.downArrow) {
          setFieldCursor((i) => Math.min(items.length - 1, i + 1));
          return;
        }
        if (key.return) {
          // Precarga la ruta ACTUAL del proyecto (forma dual D-06: string|{default}|sin mapear → '')
          // y entra a projects-edit con el cursor al final. El id se re-deriva del snapshot en edit.
          const item = items[fieldCursor];
          if (!item) return;
          const current = getProjectPath(projectsSnapshot.map[item.id]);
          setBuffer(current);
          setCursor(current.length);
          setProjectsEditError(null);
          setMode('projects-edit');
          return;
        }
        if (input === 'x') {
          // PROJ-03/D-03/D-06: quitar el mapeo DIRECTO (sin modal — re-mapeable, no destructivo).
          // removeProjectMapping es puro (clon sin la key); saveProjectsFn persiste el mapa nuevo.
          // El aviso transitorio va en focusError/footerColor (molde config D-10).
          const item = items[fieldCursor];
          if (!item) return;
          const next = removeProjectMapping(projectsSnapshot.map, item.id);
          saveProjectsFn(next);
          setProjectsSnapshot((s) => (s ? { ...s, map: next } : s));
          setFocusError(PROJECTS_REMOVED(item.identifier));
          setFooterColor('yellow');
          return;
        }
        return; // traga el resto mientras navega la lista
      }
      if (mode === 'projects-edit') {
        // Mismo molde de text-input que config-edit (~818-886): Esc cancela sin guardar; ←/→ clamp
        // cursor; backspace||delete (juntos, Pitfall 3) borra char anterior; char imprimible inserta
        // en cursor; Enter valida con validateExistingDir ANTES de saveProjectsFn (PROJ-02/T-64-06).
        const items = projectsSnapshot?.remote ?? [];
        const item = items[fieldCursor];
        if (key.escape) {
          setMode('projects'); // cancela sin guardar (D-03)
          return;
        }
        if (key.leftArrow) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.rightArrow) {
          setCursor((c) => Math.min(buffer.length, c + 1));
          return;
        }
        if (key.backspace || key.delete) {
          if (cursor > 0) {
            setBuffer((b) => b.slice(0, cursor - 1) + b.slice(cursor));
            setCursor((c) => c - 1);
          }
          return;
        }
        if (key.return) {
          if (!item) {
            setMode('projects');
            return;
          }
          // Validación con I/O never-throws (src/path-validate.js). Un inválido NUNCA alcanza el disco
          // (PROJ-02/T-64-06): se guarda en projectsEditError (dedicado, Pitfall 2) y se sigue en
          // projects-edit — la siguiente tecla edita, no se gasta limpiando el error.
          const res = validateExistingDir(buffer);
          if (!res.ok) {
            setProjectsEditError(res.error);
            return;
          }
          // setProjectPath es puro y preserva la forma dual (modules INTACTO si la entrada es objeto,
          // D-06/T-64-07). saveProjectsFn es síncrono atómico; el try/catch es defensa en profundidad
          // (never-throws — si lanzara, el panel ink sigue montado, D-07).
          const next = setProjectPath(projectsSnapshot.map, item.id, res.value);
          try {
            saveProjectsFn(next);
            setProjectsSnapshot((s) => (s ? { ...s, map: next } : s));
            setProjectsEditError(null);
            setFocusError(PROJECTS_SAVED_RESTART);
            setFooterColor('yellow');
            setMode('projects');
          } catch {
            setProjectsEditError(PROJECTS_SAVE_FAILED); // never-throws de respaldo
          }
          return;
        }
        // Char imprimible: inserta en la posición del cursor (NO append ciego, molde config-edit).
        if (input && !key.ctrl && !key.meta) {
          setBuffer((b) => b.slice(0, cursor) + input + b.slice(cursor));
          setCursor((c) => c + input.length);
          return;
        }
        return; // traga el resto (teclas de control no mapeadas)
      }
      if (mode === 'projects-error') {
        // PROJ-05/D-07: `r` re-dispara el fetch (mismo carril que `m`); Esc sale a list. saveProjectsFn
        // JAMÁS se llama aquí (carril de LECTURA remota — projects.json intacto).
        if (input === 'r') {
          await runProjectsFetch();
          return;
        }
        if (key.escape) {
          setMode('list');
          return;
        }
        return; // traga el resto
      }
      if (mode === 'filter') {
        // Contexto MODAL (D-15): Esc cancela (limpia query), Enter confirma (mantiene filtro),
        // Backspace en query vacía sale, char imprimible se concatena en vivo (D-13).
        if (key.escape) {
          setQuery('');
          setMode('list');
          return;
        }
        if (key.return) {
          setMode('list'); // confirma: mantiene la query aplicada (D-15)
          return;
        }
        if (key.backspace || key.delete) {
          if (query === '') {
            setMode('list');
            return;
          }
          setQuery((q) => q.slice(0, -1));
          return;
        }
        // Char imprimible (no control/meta): append en vivo. Substring puro — esta query nunca
        // se compila a un patrón regex (anti-ReDoS, T-36-01); applyFilter usa String.includes.
        if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);
        return;
      }

      // mode === 'list'
      if (input === 'q') {
        exit(); // D-08: clean unmount, NO process.exit (conservado Phase 34).
        return;
      }
      if (input === '/') {
        setMode('filter'); // abre la línea de filtro modal (D-13)
        return;
      }
      if (input === 'e') {
        // Phase 63 Plan 02 D-02/UX-01: abre el editor de config SIN salir del dashboard. Pitfall 1:
        // deep-clone OBLIGATORIO — `loadConfig` sin fichero devuelve `{...DEFAULT_CONFIG}` (spread
        // superficial), así que mutar campos anidados aliasearía el DEFAULT_CONFIG del módulo. El
        // structuredClone congela un snapshot propio del editor. NO se toca selectedTaskId (UX-03 gratis:
        // resolveSelection re-deriva la misma fila al volver). fieldCursor a 0, error limpio.
        setConfigSnapshot(structuredClone(loadConfigFn()));
        setFieldCursor(0);
        setConfigEditError(null);
        setMode('config');
        return;
      }
      if (input === 'm') {
        // Phase 64 Plan 02 D-01/D-02/D-10 (PROJ-01): abre el editor de PROYECTOS SIN salir del
        // dashboard. `m` está LIBRE en mode:'list' (verificado: q / e c l p d o a + arrows/Enter; Esc
        // ignorado — RESEARCH Pitfall 0). Dispara el fetch async token-guarded (runProjectsFetch):
        // entra a projects-loading, await listProjectsFn, ramifica a projects (snapshot congelado) o
        // projects-error (PROJ-05). NO toca selectedTaskId (UX-03 gratis al volver).
        await runProjectsFetch();
        return;
      }
      if (input === 'c') {
        // TUI-15/SC#1: overlay de comentarios de la fila seleccionada (resueltos por task_id, D-02).
        // fetchComments es never-throws (Plan 39-01): mapeamos su discriminante a un snapshot CONGELADO.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        const reqId = ++overlayReqRef.current; // CR-01: marca esta apertura
        const res = await fetchComments(baseUrl, row.task_id, fetchFn);
        if (overlayReqRef.current !== reqId) return; // CR-01: cerrada/superada durante el await
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
              lines = comments.map((c) => {
                const body = c.body ?? c.text ?? c.message;
                if (body == null) return JSON.stringify(c);
                return c.author ? `${c.author}: ${body}` : String(body);
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
        setOverlaySnapshot({ kind: 'comments', taskRef: row.task_ref ?? '', status, lines });
        setOverlayKind('comments');
        setScrollOffset(0);
        setMode('overlay');
        return;
      }
      if (input === 'l') {
        // TUI-16/SC#2: overlay de logs por grep substring (task_ref/workspace_ref) sobre el buffer
        // compartido de /logs. fetchLogs never-throws; grepLogs es el filtro puro anti-ReDoS (Plan 39-01).
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        const reqId = ++overlayReqRef.current; // CR-01: marca esta apertura
        const res = await fetchLogs(baseUrl, fetchFn);
        if (overlayReqRef.current !== reqId) return; // CR-01: cerrada/superada durante el await
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
          lines = matched.map((e) =>
            `${e.ts ? `${e.ts} ` : ''}${e.level ? `${e.level} ` : ''}${e.msg ?? ''}`.trim(),
          );
        } else {
          status = 'error';
        }
        // D-05: snapshot congelado. D-06: selectedTaskId intacto.
        setOverlaySnapshot({ kind: 'logs', taskRef: row.task_ref ?? '', status, lines });
        setOverlayKind('logs');
        setScrollOffset(0);
        setMode('overlay');
        return;
      }
      if (input === 'p') {
        // Phase 44 PLAN-01/PLAN-02 (D-02/D-05): overlay del/los PLAN.md de la fase GSD de la fila
        // seleccionada (resuelta por task_id, D-02). CUARTO consumidor del mode:'overlay' junto a c/l.
        //
        // DIVERGENCIA CRÍTICA respecto a c/l (Pitfall 1 / RESEARCH:203-205): readPlan es SÍNCRONO —
        // NO hay await window. setOverlaySnapshot/setMode corren en el MISMO tick que el keypress, así
        // que NO existe carrera de "reapertura obsoleta": la apertura es ATÓMICA. Por eso este handler
        // NO captura `const reqId = ++overlayReqRef.current` ni hace el check post-await `if
        // (overlayReqRef.current !== reqId) return` de c/l — sería código muerto y engañoso. La rama de
        // cierre con Esc (mode:'overlay') ya incrementa overlayReqRef para invalidar OTRAS aperturas
        // c/l aún en vuelo; aquí no se toca. readPlan es never-throws (D-05): sin try/catch necesario.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        const res = readPlan(row, { resolvePhaseFn: resolvePhase });
        // D-05: snapshot congelado al abrir. NO se toca selectedTaskId (cursor GRATIS al volver, D-06).
        setOverlaySnapshot({ kind: 'plan', taskRef: row.task_ref ?? '', status: res.status, lines: res.lines });
        setOverlayKind('plan');
        setScrollOffset(0);
        setMode('overlay');
        return;
      }
      if (input === 'd') {
        // Phase 42 D-01/D-07-TUI (DISMISS-02/04): handler de dismiss. Espejo de c/l (no-op si no
        // hay fila) + el guard INVERSO del Enter (alive===true en vez de alive===false).
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        if (row.alive === true) {
          // DISMISS-04/SC#2: `d` JAMÁS descarta una sesión viva. NO entra en confirm, NO manda
          // DELETE — guard de UX (la autoridad TOCTOU es server-side, D-08). Mensaje rojo transitorio.
          setFocusError(DISMISS_GUARD_ALIVE);
          setFooterColor('red');
          return;
        }
        // D-02/D-13: arma capturando la IDENTIDAD (task_id) + el ref legible para el copy. El poll
        // sigue corriendo bajo confirm (D-05) — el target stale lo caza el 409 server-side al confirmar.
        setArmedTaskId(row.task_id);
        setArmedTaskRef(row.task_ref ?? row.task_id);
        setMode('confirm');
        return;
      }
      if (input === 'o') {
        // Phase 48 D-01/D-02/D-04/D-05 (OPEN-01/02/03): handler open-in-manager. Lee
        // `row.task_url` (ya persistido al lanzar — NO fetch, distinto de c/l). DIVERGENCIAS
        // respecto al Enter handler:
        //   - SIN guard alive (D-04): `o` funciona sobre alive/zombie/dismissed por igual.
        //   - El ÚNICO guard es no-URL (D-05): sin task_url → footer BARE `no task URL for this
        //     session` (no `[!]`, no `— press any key`) y onOpen NUNCA se invoca (open jamás
        //     recibe un arg falsy/basura). Es un no-op benigno, no un error.
        //   - En éxito: footer VERDE transitorio OPEN_OK(ref) (D-01/D-02) — diverge del silencio
        //     de focus.js porque la TUI no muestra otro cambio visible.
        // runOpen es never-throws (Plan 01 contract); el `?.` cubre el contexto degradado sin
        // onOpen (tests del módulo sin DI), espejo de onFocus. El footer transitorio se limpia
        // con el clear-on-any-input (D-03 — sin timer dedicado).
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        if (!row.task_url) {
          setFocusError(OPEN_ERR_NO_URL);
          setFooterColor('red');
          return;
        }
        const result = await onOpen?.(row.task_url);
        if (!result || result.ok !== false) {
          // Éxito (o contexto degradado sin onOpen): footer verde de confirmación. REF =
          // task_ref (el mismo identificador que muestra la tabla), fallback a task_id.
          setFocusError(OPEN_OK(row.task_ref ?? row.task_id));
          setFooterColor('green');
        } else if (result.code === 'ENOENT') {
          setFocusError(OPEN_ERR_ENOENT);
          setFooterColor('red');
        } else if (result.code === 'BAD_PROTOCOL') {
          setFocusError(OPEN_ERR_BAD_PROTOCOL);
          setFooterColor('red');
        } else {
          // NON_ZERO_EXIT (`detail` = exit code numérico) o SPAWN_ERROR (`detail` = Error.message).
          const n = result.detail ?? 'unknown';
          setFocusError(openErrFailed(n));
          setFooterColor('red');
        }
        return;
      }
      if (input === 'a') {
        // Phase 56 D-01/D-02/D-03 (DETECT-02): handler de adopt. Descubre surfaces ad-hoc ON-DEMAND
        // (NO poll loop) vía onAdoptDiscover (typeof-gated upstream en index.js, fail-open a []),
        // diffea contra el snapshot vivo de /status (computeAdoptable, keyeado por sessionId — D-02)
        // y abre el picker overlay con las adoptables. Vacío/unsupported → footer ADOPT_NONE y mode
        // SIGUE en list (NO abre overlay, D-03). Mold del `o` handler (async never-throws) + del `c`/`l`
        // reqId-guard alrededor del await (CR-01: una apertura encolada/Esc invalida la post-await).
        const reqId = ++overlayReqRef.current; // CR-01: marca esta apertura
        const surfaces = (await onAdoptDiscover?.()) ?? [];
        if (overlayReqRef.current !== reqId) return; // CR-01: cerrada/superada durante el await
        const adoptable = computeAdoptable(surfaces, sessions);
        if (adoptable.length === 0) {
          // D-02/D-03: set adoptable vacío / host sin soporte → footer informativo, NO abre picker.
          setFocusError(ADOPT_NONE);
          setFooterColor('yellow');
          return;
        }
        // D-03: abre el picker congelado con el cursor en 0. El poll sigue corriendo por debajo
        // (snapshot congelado en overlaySnapshot.adoptable, mold c/l/p).
        setOverlaySnapshot({ kind: 'adopt', taskRef: '', status: 'ok', lines: [], adoptable });
        setAdoptCursor(0);
        setOverlayKind('adopt');
        setMode('overlay');
        return;
      }
      if (key.upArrow) {
        // Mueve el índice DERIVADO arriba y re-fija selectedTaskId; clamp en 0, SIN wrap (D-07).
        const ni = Math.max(0, sel.index - 1);
        if (filtered[ni]) setSelectedTaskId(filtered[ni].task_id);
        return;
      }
      if (key.downArrow) {
        const ni = Math.min(filtered.length - 1, sel.index + 1);
        if (filtered[ni]) setSelectedTaskId(filtered[ni].task_id);
        return;
      }
      if (key.return) {
        // Phase 37 D-02 + D-06: handler de Enter — guard alive===false + invocación
        // never-throws de onFocus + mapeo del discriminated union a los 3 mensajes
        // literal-estables D-05.
        //
        // `resolveSelection` retorna `{index, taskId}` SIN `.row` — leemos la fila del
        // array filtrado por índice (cf. select.js:74-80). Si la lista está vacía,
        // `sel.index === -1` y `filtered[-1]` es undefined → no-op.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        if (row.alive === false) {
          // D-02: cero invocación de cmux sobre workspaces muertos. La marca textual
          // `(zombie)` ya pinta el estado (Phase 36 D-09); este mensaje confirma el
          // rechazo en el footer para que el operador vea por qué Enter no hizo nada.
          setFocusError(FOCUS_ERR_ZOMBIE);
          return;
        }
        // D-06: runFocus es never-throws (Plan 01 D-01 contract) — siempre resuelve con
        // el discriminado, jamás una excepción. El `?.` cubre el caso donde el caller no
        // inyectó onFocus (tests del módulo sin DI, contexto degradado).
        const result = await onFocus?.(row.workspace_ref);
        if (result && !result.ok) {
          if (result.code === 'ENOENT') {
            setFocusError(FOCUS_ERR_ENOENT);
          } else {
            // NON_ZERO_EXIT (`detail` = code numérico de exit) o SPAWN_ERROR
            // (`detail` = string del Error.message). En ambos casos, el operador ve
            // la pista útil (`code N` o `code unknown`) en el footer.
            const n = result.detail ?? 'unknown';
            setFocusError(focusErrFailed(n));
          }
        }
        return;
      }
      // key.escape: DELIBERADAMENTE ignorado en modo lista (reservado Phase 38 — D-11/D-15).
    },
    { isActive: isRawModeSupported },
  );

  // Selección inicial + write-back (D-07): cuando los datos llegan, fija selectedTaskId al row
  // resuelto (la primera fila al arrancar) para que el cursor nunca apunte a un id ausente.
  // Además se memoriza el índice posicional visible (prevIndexRef) para el clamp de D-06.
  useEffect(() => {
    // Conserva el último índice visible REAL; si la lista filtrada está vacía (sel.index === -1)
    // NO lo pisa con 0 — preserva el ancla posicional para el clamp de D-06 al volver.
    prevIndexRef.current = sel.index >= 0 ? sel.index : prevIndexRef.current;
    // NUNCA pisar la identidad con null (CR-01 / D-16): un filtro que oculta TODA la lista hace
    // sel.taskId === null; escribirlo borraría selectedTaskId y, al limpiar el filtro, el cursor
    // saltaría a la primera fila en vez de volver a la sesión seleccionada. Solo se escribe cuando
    // hay una fila resuelta real (sel.taskId != null). El borrado de identidad por terminación real
    // de la sesión lo cubre resolveSelection (clamp al vecino), no este write-back.
    if (sel.taskId != null && selectedTaskId !== sel.taskId) setSelectedTaskId(sel.taskId);
  }, [sel.index, sel.taskId, selectedTaskId]);

  return createElement(
    Box,
    { flexDirection: 'column', borderStyle: 'round', paddingX: 1, height: termRows },
    createElement(Text, { bold: true }, 'kodo dashboard'),
    createElement(
      Box,
      { marginY: 1, paddingX: 1, flexGrow: 1 },
      createElement(SessionTable, {
        rows: filtered,
        selectedIndex: sel.index,
        counts,
        connected,
        lastGoodCount,
        lastGoodAt,
        lastAttemptAt,
        mode,
        query,
        hasQuery,
        anyGsd, // TUI-18 D-08: flag estructural GSD (sobre `sorted`, no `filtered`) → drop columna phase/mode
        anyProgress, // PROG-03 D-06: flag estructural progreso (sobre `enriched` sin filtrar) → drop columna prog
        focusError, // Phase 37 D-04: render condicional del footer transitorio (espejo de filterLine)
        footerColor, // Phase 42 D-09: color del footer transitorio (green/yellow/red derivado de actions[])
        armedTaskRef, // Phase 42 D-02: task_ref del confirm armado (copy del DISMISS_CONFIRM)
        armedSessionId, // Phase 56 Pitfall 2: si != null el confirm es de ADOPT (ruta el copy ADOPT_CONFIRM)
        armedSurfaceRef: armedSurface?.workspaceRef ?? null, // Phase 56 D-04: ref legible del adopt armado
        armedSurfaceTitle: armedSurface?.title ?? null, // Phase 62 D-08: título derivado (propuesta del confirm)
        armedSurfaceDescription: armedSurface?.description ?? null, // Phase 62 D-08: descripción derivada
        adoptCursor, // Phase 56 D-03/Pitfall 3: cursor seleccionable del picker
        overlayKind, // Phase 39: qué overlay está abierto (comments/logs/plan/adopt/null)
        scrollOffset, // Phase 39 D-06: primera línea visible del body scrollable
        overlaySnapshot, // Phase 39 D-05: contenido congelado del overlay
        configSnapshot, // Phase 63 Plan 02: snapshot congelado del editor de config (null si cerrado)
        fieldCursor, // Phase 63 Plan 02 D-03: campo seleccionado en mode:'config'
        buffer, // Phase 63 Plan 02 D-01: text-input controlado de mode:'config-edit'
        cursor, // Phase 63 Plan 02 D-01: posición del cursor en el buffer
        configEditError, // Phase 63 Plan 02 Pitfall 2: error de validación/escritura (estado dedicado)
        projectsSnapshot, // Phase 64 Plan 02 D-01: snapshot congelado del editor de proyectos (null si cerrado)
        projectsError, // Phase 64 Plan 02 D-07: mensaje del fallo de fetch (dirige projects-error)
        projectsEditError, // Phase 64 Plan 02 Pitfall 2: error de validación de ruta inline (estado dedicado)
      }),
    ),
    createElement(Text, { dimColor: true }, '↑↓ move · c comments · l logs · p plan · / filter (ps:state) · d dismiss · o open · a adopt · e config · m projects · q quit'),
  );
}
