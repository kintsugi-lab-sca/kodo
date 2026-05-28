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

import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { fetchStatus } from './client.js';
import { usePoll } from './usePoll.js';
import {
  sortSessions,
  applyFilter,
  parseFilter,
  resolveSelection,
  countByStatus,
} from './select.js';
import { deriveRepo } from './format.js';
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
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

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

  // Phase 36: lista cruda de sesiones (keep-last-good en fallo, misma disciplina que lastGoodCount)
  // y cursor por IDENTIDAD (selectedTaskId, NUNCA un índice — D-05). El índice visible se DERIVA
  // en cada render via resolveSelection sobre la lista ya ordenada+filtrada (TUI-08).
  const [sessions, setSessions] = useState(/** @type {Array<any>} */ ([]));
  const [selectedTaskId, setSelectedTaskId] = useState(/** @type {string | null} */ (null));

  // Phase 36 Plan 03: estado de interacción. `mode` enruta el teclado (list/filter, D-13/D-15);
  // `query` es el filtro EN VIVO (alimenta parseFilter/applyFilter cada render, D-13). El índice
  // posicional previo se guarda en un ref (no provoca re-render) para el clamp de D-06: cuando la
  // fila seleccionada desaparece, resolveSelection cae al vecino del MISMO índice previo.
  const [mode, setMode] = useState(/** @type {'list' | 'filter'} */ ('list'));
  const [query, setQuery] = useState('');
  const prevIndexRef = useRef(0);

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
    { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
    createElement(Text, { bold: true }, 'kodo dashboard'),
    createElement(
      Box,
      { marginY: 1, paddingX: 1 },
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
        focusError, // Phase 37 D-04: render condicional del footer-error rojo (espejo de filterLine)
      }),
    ),
    createElement(Text, { dimColor: true }, '↑↓ move · / filter · q quit'),
  );
}
