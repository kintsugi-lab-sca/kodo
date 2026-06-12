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
} from './select.js';
import { deriveRepo } from './format.js';
import { readPlan } from './plan.js';
import { resolvePhase } from '../../gsd/resolver.js';
import SessionTable from './SessionTable.js';

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

  // Phase 36: lista cruda de sesiones (keep-last-good en fallo, misma disciplina que lastGoodCount)
  // y cursor por IDENTIDAD (selectedTaskId, NUNCA un índice — D-05). El índice visible se DERIVA
  // en cada render via resolveSelection sobre la lista ya ordenada+filtrada (TUI-08).
  const [sessions, setSessions] = useState(/** @type {Array<any>} */ ([]));
  const [selectedTaskId, setSelectedTaskId] = useState(/** @type {string | null} */ (null));

  // Phase 36 Plan 03: estado de interacción. `mode` enruta el teclado (list/filter, D-13/D-15);
  // `query` es el filtro EN VIVO (alimenta parseFilter/applyFilter cada render, D-13). El índice
  // posicional previo se guarda en un ref (no provoca re-render) para el clamp de D-06: cuando la
  // fila seleccionada desaparece, resolveSelection cae al vecino del MISMO índice previo.
  const [mode, setMode] = useState(/** @type {'list' | 'filter' | 'overlay' | 'confirm'} */ ('list'));
  const [query, setQuery] = useState('');
  const prevIndexRef = useRef(0);
  // Phase 39 CR-01: token de generación de apertura de overlay. Los handlers `c`/`l` son async
  // (await fetch). Si el operador encola un segundo `c`/`l` o cierra con Esc mientras una request
  // está en vuelo, el setMode('overlay') del post-await reabriría un overlay obsoleto. Cada apertura
  // toma un reqId incrementando este ref; al cerrar (Esc) o reabrir, el ref avanza e invalida la
  // request en vuelo, que tras el await comprueba `overlayReqRef.current !== reqId` y se descarta.
  const overlayReqRef = useRef(0);

  // Phase 39 (TUI-15/TUI-16): estado de los overlays auxiliares (comentarios `c` / logs `l`).
  //   - overlayKind: qué overlay está abierto ('comments'|'logs'|null).
  //   - scrollOffset: índice de la primera línea visible del body scrollable (D-06, ↑/↓ scrollean).
  //   - overlaySnapshot: contenido CONGELADO al abrir (D-05). El poll de la tabla sigue por debajo
  //     pero este objeto NO se re-escribe por onResult → el texto del overlay no salta bajo el lector.
  //     Forma: { kind, taskRef, status:'ok'|'empty'|'not-found'|'error', lines: string[] } donde
  //     `lines` ya viene proyectado a strings (comentarios o `msg` de cada log entry).
  const [overlayKind, setOverlayKind] = useState(/** @type {'comments'|'logs'|'plan'|null} */ (null));
  const [scrollOffset, setScrollOffset] = useState(0);
  const [overlaySnapshot, setOverlaySnapshot] = useState(
    /** @type {{ kind: 'comments'|'logs'|'plan', taskRef: string, status: string, lines: string[] }|null} */ (null),
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
  // TUI-18/D-08: flag estructural de presencia GSD derivado del set SIN filtrar (`sorted`),
  // NO de `filtered` (Pitfall 4): la columna phase/mode no debe parpadear cuando una query `/`
  // vacía temporalmente las filas GSD del subconjunto visible.
  const anyGsd = deriveAnyGsd(sorted);
  const filtered = applyFilter(sorted, parseFilter(query), deriveRepo);
  const sel = resolveSelection(filtered, selectedTaskId, prevIndexRef.current);
  const counts = countByStatus(filtered);
  // hasQuery distingue los dos estados vacíos en SessionTable (D-12): `no sessions match` (hay
  // query activa que oculta todo) vs `no active sessions` (lista realmente vacía).
  const hasQuery = query.trim().length > 0;

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
      // Phase 42 D-01/D-02/D-04 (DISMISS-02): SUB-MODO confirm. Va DESPUÉS del clear-on-any-input
      // y del overlay, ANTES de filter/list. CRÍTICO (RESEARCH Pitfall 4): entrar en `confirm` NO
      // setea el footer transitorio — el armed prompt DISMISS_CONFIRM se deriva de `mode==='confirm'`
      // (NO de focusError), así el clear-on-any-input no consume el segundo `d`. El armed prompt es
      // persistente (D-03: sin timer); solo `d` ejecuta, cualquier otra tecla (incl. Esc) cancela.
      if (mode === 'confirm') {
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
        focusError, // Phase 37 D-04: render condicional del footer transitorio (espejo de filterLine)
        footerColor, // Phase 42 D-09: color del footer transitorio (green/yellow/red derivado de actions[])
        armedTaskRef, // Phase 42 D-02: task_ref del confirm armado (copy del DISMISS_CONFIRM)
        overlayKind, // Phase 39: qué overlay está abierto (comments/logs/null)
        scrollOffset, // Phase 39 D-06: primera línea visible del body scrollable
        overlaySnapshot, // Phase 39 D-05: contenido congelado del overlay
      }),
    ),
    createElement(Text, { dimColor: true }, '↑↓ move · c comments · l logs · p plan · / filter (ps:state) · d dismiss · o open · q quit'),
  );
}
