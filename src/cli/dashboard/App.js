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
//
// ─── KODO-40: reparto de responsabilidades ──────────────────────────────────────────────────
// App.js era un monolito de ~2100 LOC con 15 sub-máquinas de teclado en un único `useInput`.
// Los modos con estado propio viven ahora en módulos hermanos, cada uno con SU copy literal y
// SU(s) handler(s) puro(s) que reciben un `ctx` (el mismo estado + setters que antes capturaban
// por closure). App.js conserva: el estado, el poll, el pipeline de derivación, el modo LISTA +
// FILTRO + la rama dismiss del confirm, y el render raíz.
//
//   SetupWizard.js    — mode:'setup' (wizard first-run de 4 pasos)          + SETUP_*
//   OverlayViewer.js  — mode:'overlay' (c/l/L/p) + sus aperturas            + OVERLAY_*
//   AdoptPicker.js    — picker `a`, mode:'deriving', rama adopt del confirm + ADOPT_*/DERIVE_*
//   ConfigEditor.js   — mode:'config' y 'config-edit'                       + CONFIG_*/API_KEY_*
//   ProjectsEditor.js — los 7 modos `projects*` (2 hops async)              + PROJECTS_*
//
// Las constantes de esos módulos se RE-EXPORTAN desde aquí (abajo): `SessionTable.js` y los
// tests `dashboard-*` / `app-*` siguen importándolas de App.js exactamente igual que antes.
// El RENDER de todos los overlays sigue viviendo en SessionTable.js (sin cambios).

import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { fetchStatus } from './client.js';
import { usePoll } from './usePoll.js';
import { readTasks } from './tasks.js';
import { readOpenCaptureCount } from './inbox-count.js';
import { readPendingIntegrationCount } from './queue-count.js';
// KODO-40: pipeline de derivación de filas (sort → enrich → flags → filtro → selección).
import { deriveRows } from './rows.js';
// KODO-40: sub-máquinas de teclado extraídas (ver cabecera). Se importan ANTES de SessionTable
// para que sus módulos estén evaluados cuando el ciclo App↔SessionTable (preexistente) resuelva
// los re-exports de más abajo.
import { handleSetupInput } from './SetupWizard.js';
import {
  handleOverlayInput,
  openCommentsOverlay,
  openLogsOverlay,
  openLogsAllOverlay,
  openPlanOverlay,
} from './OverlayViewer.js';
import { openAdoptPicker, handleDerivingInput, handleAdoptConfirmInput } from './AdoptPicker.js';
import {
  DEFAULT_EDITOR_CONFIG,
  openConfigEditor,
  handleConfigInput,
  handleConfigEditInput,
} from './ConfigEditor.js';
import { runProjectsFetch as runProjectsFetchImpl, handleProjectsInput } from './ProjectsEditor.js';
import {
  focusRow,
  openRow,
  focusOrchestrator,
  armDismiss,
  handleDismissConfirmInput,
} from './RowActions.js';
import SessionTable from './SessionTable.js';

// KODO-40: RE-EXPORTS de compatibilidad. La copy literal-estable de cada modo vive ahora en su
// módulo, pero App.js sigue siendo su punto de import público — `SessionTable.js` y los ~10 tests
// `dashboard-*` / `app-*` no cambian ni una línea. Cambiar el literal en su módulo sigue rompiendo
// los asserts automáticamente (la propiedad anti-drift original se conserva intacta).
export {
  OVERLAY_COMMENTS_EMPTY,
  OVERLAY_COMMENTS_NOT_FOUND,
  OVERLAY_COMMENTS_ERROR,
  OVERLAY_COMMENTS_UNSUPPORTED,
  OVERLAY_LOGS_EMPTY,
  OVERLAY_LOGS_ERROR,
  OVERLAY_LOGS_LABEL,
  OVERLAY_LOGS_ALL_LABEL,
  OVERLAY_LOGS_ALL_EMPTY,
  OVERLAY_PLAN_NO_PHASE,
  OVERLAY_PLAN_NO_PLAN,
  OVERLAY_PLAN_NO_LIGHT,
  OVERLAY_PLAN_ERROR,
  OVERLAY_VIEWPORT,
} from './OverlayViewer.js';
export {
  ADOPT_NONE,
  ADOPT_CONFIRM,
  ADOPT_OK,
  ADOPT_ALREADY,
  ADOPT_NO_PROJECT,
  ADOPT_ERR_ENOENT,
  adoptErrFailed,
  DERIVE_PROGRESS,
  ADOPT_DERIVED_CONFIRM,
  ADOPT_DERIVED_CONFIRM_FALLBACK,
} from './AdoptPicker.js';
export {
  CONFIG_OVERLAY_TITLE,
  CONFIG_SAVED_RESTART,
  CONFIG_SAVE_FAILED,
  API_KEY_LABEL,
  API_KEY_CONFIGURED,
  API_KEY_UNSET,
  API_KEY_SAVED_RESTART,
  API_KEY_SAVE_FAILED,
  API_KEY_INVALID,
  API_KEY_NO_RAWMODE,
} from './ConfigEditor.js';
export {
  SETUP_OVERLAY_TITLE,
  SETUP_INTRO,
  SETUP_STEP_PROVIDER,
  SETUP_STEP_BASE_URL,
  SETUP_STEP_WORKSPACE,
  SETUP_STEP_APIKEY,
  SETUP_PROVIDER_LABEL,
  SETUP_PROVIDER_HINT,
  SETUP_GITHUB_REDIRECT,
  SETUP_BASE_URL_LABEL,
  SETUP_WORKSPACE_LABEL,
  SETUP_COMPLETE_RESTART,
  SETUP_WEBHOOK_NOTE,
  SETUP_NO_RAWMODE,
  SETUP_INVALID,
  SETUP_SAVE_FAILED,
  SETUP_PROVIDERS,
} from './SetupWizard.js';
export {
  PROJECTS_OVERLAY_TITLE,
  PROJECTS_LOADING,
  PROJECTS_UNMAPPED,
  PROJECTS_SAVED_RESTART,
  PROJECTS_SAVE_FAILED,
  PROJECTS_REMOVED,
  PROJECTS_LOAD_FAILED,
  PROJECTS_MODULES_TITLE,
  PROJECTS_NO_MODULES,
  PROJECTS_DISPATCH_TAG,
  PROJECTS_MAPPED_ONLY_TAG,
} from './ProjectsEditor.js';
export {
  FOCUS_ERR_ZOMBIE,
  FOCUS_ERR_ENOENT,
  focusErrFailed,
  DISMISS_GUARD_ALIVE,
  DISMISS_CONFIRM,
  DISMISS_OK,
  DISMISS_PARTIAL_DIRTY,
  DISMISS_PARTIAL_WARN,
  DISMISS_ERR,
  OPEN_OK,
  OPEN_ERR_NO_URL,
  OPEN_ERR_ENOENT,
  OPEN_ERR_BAD_PROTOCOL,
  openErrFailed,
  ORCH_OK,
  ORCH_NOT_RUNNING,
  ORCH_ERR,
} from './RowActions.js';

// Phase 69 Plan 03 (NET-02, D-08): mensaje literal-estable del estado 401 "no autorizado".
// EXPORTADO para que tests y SessionTable.js lo importen y asseren equality sin duplicar strings
// (mismo patrón que FOCUS_ERR_* / OVERLAY_* / DISMISS_*). Registro en minúscula alineado con
// `⚠ server caído` (UI-SPEC §Copywriting), glifo ⚠ + color yellow (UI-SPEC §Color: acotado a
// {yellow (recomendado), red}, jamás cyan/green). El 401 es una degradación VISIBLE y accionable
// (revisa el token en ~/.kodo/.env) — nunca una pantalla vacía silenciosa (D-08).
export const UNAUTHORIZED_MESSAGE = '⚠ no autorizado — revisa KODO_API_TOKEN';

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
 *
 * KODO-40 — los callbacks DI de abajo los CONSUME una sub-máquina extraída, no App. App solo los
 * declara (siguen siendo props del componente) y los mete en el `ctx` del router de teclado. El
 * porqué de cada contrato (guards, orden, fail-open, pitfalls) vive junto al código que lo aplica,
 * en el módulo indicado — aquí queda el contrato mínimo: tipo, semántica y default.
 *
 * @param {() => Promise<Array<{ workspaceRef: string, cwd: string, sessionId: string, kind: string }>>} [props.onAdoptDiscover]
 *   → AdoptPicker.js. `host.listAgentSurfaces()` typeof-gated, never-throws (fail-open a `[]`).
 * @param {(args: { workspaceRef: string, cwd: string, sessionId: string, projectId: string, title?: string, description?: string }) => Promise<{ok: true} | {ok: false, code: 'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail?: any}>} [props.onAdopt]
 *   → AdoptPicker.js. `runAdopt({exec, execPath, kodoBin, …})`, never-throws (discriminado `{ok}`).
 * @param {(args: { cwd: string, sessionId: string }) => Promise<{ title?: string, description?: string }>} [props.onDerive]
 *   → AdoptPicker.js. `deriveAdoptionMeta(…)`, never-throws (fail-open a `{}`).
 * @param {Record<string, string>} [props.projects]
 *   → AdoptPicker.js. Mapa `projectId → path` de `loadProjects()`; alimenta el reverse-lookup
 *   cwd→projectId del `--project`. Default `{}` (tests del módulo sin DI).
 * @param {() => any} [props.loadConfigFn]
 *   → ConfigEditor.js / SetupWizard.js. Snapshot de config al abrir. SIEMPRE se deep-clona antes de
 *   editar (Pitfall 1). Default `DEFAULT_EDITOR_CONFIG` (inerte, sin secretos).
 * @param {(config: any) => Promise<{ ok: boolean, error?: any }>} [props.onSaveConfig]
 *   → ConfigEditor.js / SetupWizard.js. Wrapper never-throws de `saveConfig` (atómico temp+rename).
 * @param {(key: string, value: string) => Promise<{ ok: boolean, error?: any }>} [props.onSaveApiKey]
 *   → ConfigEditor.js / SetupWizard.js. Wrapper never-throws de `writeEnvVar` (atómico + chmod 0600
 *   pre-rename) que además refresca `process.env[key]`. Escritura EN-PROCESO SIEMPRE, jamás
 *   shell-out (Pitfall 11).
 * @param {(providerName?: string) => boolean} [props.isApiKeyConfiguredFn]
 *   Prueba de PRESENCIA de la API key (JAMÁS el valor — Pitfall 11); la consulta el render de
 *   SessionTable para pintar `[configurado]`/`[sin configurar]`. Default `() => false`.
 * @param {() => Promise<{ ok: true, projects: Array<{ id: string, identifier: string, name: string }> } | { ok: false, error: string }>} [props.listProjectsFn]
 *   → ProjectsEditor.js. 1.er hop async. DISCRIMINADO `{ok}` (NO fail-open a `[]` como onDerive:
 *   distinguir 0-proyectos de error de red es LOAD-BEARING, PROJ-05/A4).
 * @param {() => Record<string, any>} [props.loadProjectsFn]
 *   → ProjectsEditor.js. Mapa local `projects.json` (100% local, never-throws → `{}`).
 * @param {(map: Record<string, any>) => void} [props.saveProjectsFn]
 *   → ProjectsEditor.js. Persiste el mapa editado (síncrono atómico). Solo en carriles de ESCRITURA.
 * @param {(projectId: string) => Promise<{ ok: true, modules: Array<{ id: string, name: string }> } | { ok: false, error: string }>} [props.listModulesFn]
 *   → ProjectsEditor.js. 2.º hop async, espejo de listProjectsFn. ASIMETRÍA: `listModules` NO está
 *   en el contrato TaskProvider, solo en PlaneClient — el cableado condicional vive en index.js.
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
  onSaveApiKey = async () => ({ ok: true }),
  isApiKeyConfiguredFn = () => false,
  // Phase 68 Plan 02 (SETUP-01/D-01/D-04): first-run guiado. `setup` (propagado por runUp→runDashboard,
  // plan 68-01) arranca el dashboard en mode:'setup' en vez de la tabla. `needsSetupFn` es la
  // comprobación coherente-con-D-01 (helper compartido needsSetup); el flag `setup` es la señal primaria.
  setup = false,
  needsSetupFn = () => false,
  listProjectsFn = async () => ({ ok: true, projects: [] }),
  loadProjectsFn = () => ({}),
  saveProjectsFn = () => {},
  listModulesFn = async () => ({ ok: true, modules: [] }),
  // KODO-10: IDs dispatch-enabled (config.providers.<provider>.projects). El overlay marca cada
  // fila dispatch vs solo-mapeado. Default vacío (sin info → ninguna fila se marca como dispatch).
  dispatchProjectIdsFn = () => [],
  // Phase 75 (LIVE-05): reader del bloque `tasks` de ~/.kodo/state.json. Default = readTasks real
  // (never-throws → {}); inyectable para aislar el HOME en tests (mismo patrón DI que fetchFn/loadConfigFn).
  readTasksFn = readTasks,
  // Phase 84 (CAPT-07/D-17): conteo de capturas ABIERTAS de ~/.kodo/inbox.md. Default =
  // readOpenCaptureCount real (leaf never-throws → 0); inyectable para aislar el HOME en tests
  // (mismo patrón DI que readTasksFn — sin él, los tests leerían el inbox real del desarrollador).
  inboxCountFn = readOpenCaptureCount,
  // KODO-26: entradas PENDIENTES de la cola de integración (~/.kodo/state.json). Default =
  // readPendingIntegrationCount real (leaf never-throws → 0); inyectable para aislar el HOME en
  // tests, mismo patrón DI que inboxCountFn.
  queueCountFn = readPendingIntegrationCount,
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
  // Phase 69 Plan 03 (NET-02, D-08): estado 401 "no autorizado". `true` cuando el último poll trajo
  // code:'unauthorized' (token ausente/revocado); se limpia con cualquier poll OK. Alimenta el banner
  // amarillo accionable del LiveIndicator, con precedencia sobre la degradación genérica (never blank).
  const [unauthorized, setUnauthorized] = useState(false);
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

  // Phase 56 D-03/D-04 (DETECT-02) — estado del carril ADOPT (lógica en AdoptPicker.js).
  // armedSessionId/armedSurface son estado SEPARADO de armedTaskId/armedTaskRef: el dismiss arma
  // por task_id, la surface ad-hoc NO es una fila de /status y no tiene task_id. Pitfall 2: la
  // rama mode==='confirm' rutea la segunda tecla por cuál armed-id está set (armedSessionId → `a`
  // ejecuta adopt; armedTaskId → `d` ejecuta dismiss). adoptCursor es el cursor SELECCIONABLE del
  // picker (distinto de scrollOffset, que es lectura).
  const [armedSessionId, setArmedSessionId] = useState(/** @type {string | null} */ (null));
  const [armedSurface, setArmedSurface] = useState(
    /** @type {{ workspaceRef: string, cwd: string, sessionId: string, projectId: string, title?: string, description?: string } | null} */ (null),
  );
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
  const [mode, setMode] = useState(/** @type {'list' | 'filter' | 'overlay' | 'confirm' | 'deriving' | 'config' | 'config-edit' | 'projects' | 'projects-loading' | 'projects-edit' | 'projects-error' | 'projects-modules-loading' | 'projects-modules' | 'projects-modules-edit' | 'setup'} */ (setup ? 'setup' : 'list'));
  const [query, setQuery] = useState('');

  // Phase 68 Plan 02 (SETUP-01/02) — estado del wizard first-run (lógica en SetupWizard.js).
  // 'complete' es el estado TERMINAL (aviso de reinicio honesto, D-08). El wizard REUSA el
  // text-input (buffer/cursor/maskValue) y el configSnapshot de config-edit — cero estado propio
  // más allá de estos dos. providerCursor indexa SETUP_PROVIDERS con clamp sin wrap.
  const [setupStep, setSetupStep] = useState(/** @type {'provider' | 'base_url' | 'workspace_slug' | 'apikey' | 'complete'} */ ('provider'));
  const [providerCursor, setProviderCursor] = useState(0);

  // Phase 63 Plan 02 (UX-01/02) — estado del editor de config (lógica en ConfigEditor.js), COMPARTIDO
  // con el wizard de setup y con el editor de proyectos:
  //   - configSnapshot: clon CONGELADO al abrir (structuredClone, Pitfall 1). Toda edición muta SOLO
  //     clones de este objeto, jamás DEFAULT_CONFIG.
  //   - fieldCursor: campo/fila seleccionada (clamp sin wrap). Lo reusan projects y projects-modules.
  //   - buffer/cursor: text-input controlado (inserción EN `cursor`, NO append ciego).
  //   - configEditError: error de validación/escritura. Estado DEDICADO, NO focusError — el
  //     clear-on-any-input de más abajo consumiría la siguiente tecla si fuera focusError (Pitfall 2).
  const [configSnapshot, setConfigSnapshot] = useState(/** @type {any} */ (null));
  const [fieldCursor, setFieldCursor] = useState(0);
  const [buffer, setBuffer] = useState('');
  const [cursor, setCursor] = useState(0);
  const [configEditError, setConfigEditError] = useState(/** @type {string | null} */ (null));

  // ── Text-input: mutaciones ATÓMICAS de (buffer, cursor) ────────────────────────────────────
  //
  // `buffer` y `cursor` son DOS estados de React, pero toda edición los toca a la vez y el nuevo
  // buffer DEPENDE del cursor. Escribirlos con dos updaters independientes tiene un fallo real:
  //
  //     setBuffer((b) => b.slice(0, ctx.cursor) + input + b.slice(ctx.cursor));  // ctx.cursor OBSOLETO
  //     setCursor((c) => c + input.length);                                      // c fresco
  //
  // El updater de `buffer` recibe `b` fresco pero lee `cursor` del CLOSURE del render. Si dos
  // pulsaciones caen en el mismo batch de React —teclear rápido, un paste, o un runner de CI
  // lento— la segunda inserta en la posición ANTERIOR y los caracteres salen TRANSPUESTOS:
  // teclear `sk-secret-123` producía `sks-ecret-123`. Se cazó como flake de
  // `test/dashboard/app-setup.test.js` en node 24 · macos-latest, pero no era del test: un
  // operador tecleando deprisa su API key en el wizard obtenía la key barajada.
  //
  // Dos estados de React NO se pueden leer de forma atómica desde un updater, así que la fuente
  // de verdad SÍNCRONA vive en refs y las mutaciones se exponen como estas tres primitivas. Los
  // consumidores (ConfigEditor, SetupWizard) las llaman en vez de componer `slice` con un cursor
  // que puede estar caducado — el invariante queda donde vive el estado, no repartido por cada
  // call-site.
  //
  // `buffer`/`cursor` siguen siendo estado de React para la LECTURA (render, props de
  // SessionTable): las refs son el carril de escritura, no un segundo modelo.
  const bufferRef = useRef('');
  const cursorRef = useRef(0);

  /**
   * Fija buffer y cursor a la vez. Es el ÚNICO camino de escritura: mantiene refs y estado en
   * sincronía, y el cursor siempre acotado al buffer que lo acompaña.
   * @param {string} nextBuffer
   * @param {number} nextCursor
   */
  const setTextInput = useCallback((nextBuffer, nextCursor) => {
    const clamped = Math.max(0, Math.min(nextBuffer.length, nextCursor));
    bufferRef.current = nextBuffer;
    cursorRef.current = clamped;
    setBuffer(nextBuffer);
    setCursor(clamped);
  }, []);

  /** Inserta texto EN el cursor y lo avanza. Atómico. @param {string} text */
  const insertAtCursor = useCallback((text) => {
    const b = bufferRef.current;
    const c = cursorRef.current;
    setTextInput(b.slice(0, c) + text + b.slice(c), c + text.length);
  }, [setTextInput]);

  /** Borra el carácter ANTERIOR al cursor (backspace). No-op en el inicio. Atómico. */
  const deleteBeforeCursor = useCallback(() => {
    const b = bufferRef.current;
    const c = cursorRef.current;
    if (c <= 0) return;
    setTextInput(b.slice(0, c - 1) + b.slice(c), c - 1);
  }, [setTextInput]);

  /** Mueve el cursor `delta` posiciones, acotado al buffer vigente. @param {number} delta */
  const moveCursor = useCallback((delta) => {
    setTextInput(bufferRef.current, cursorRef.current + delta);
  }, [setTextInput]);

  /** Vacía el text-input (abrir/cerrar un campo, guardar, cancelar). Atómico. */
  const resetTextInput = useCallback(() => setTextInput('', 0), [setTextInput]);

  /** Precarga el campo con su valor actual y deja el cursor al final. @param {string} text */
  const loadTextInput = useCallback((text) => setTextInput(text, text.length), [setTextInput]);

  // Phase 68 Plan 02 (SETUP-01/D-01): al arrancar en modo setup, congela un snapshot propio del config
  // (structuredClone — Pitfall 1: loadConfig sin fichero devuelve un spread superficial de DEFAULT_CONFIG,
  // mutar campos anidados aliasearía el módulo). Los saves estructurales del wizard mutan SOLO este clon.
  useEffect(() => {
    if (setup && configSnapshot == null) {
      setConfigSnapshot(structuredClone(loadConfigFn()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  // Phase 67 Plan 02 (SETUP-03, Pitfall 11): flag de RENDER del text-input enmascarado. `true` SOLO
  // mientras se edita el renglón de API key → SessionTable deriva `•` por carácter (el buffer sigue
  // guardando el VALOR REAL en memoria; solo la PINTURA se enmascara). Se apaga al salir o al entrar
  // a cualquier campo normal — ningún campo no-secreto se enmascara por estado colgado.
  const [maskValue, setMaskValue] = useState(false);

  // Phase 64 Plan 02/03 — estado del editor de PROYECTOS/MÓDULOS (lógica en ProjectsEditor.js).
  //   - projectsSnapshot: { remote, map, dispatch } CONGELADO al abrir; el poll /status sigue por
  //     debajo sin tocarlo. Se EXTIENDE (no se duplica estado) con { modules, activeProjectId } al
  //     abrir el sub-editor de módulos (2.º hop) — ambos opcionales, solo presentes mientras está
  //     abierto. Reusa `fieldCursor` para la lista y `buffer`/`cursor` para el text-input.
  //   - projectsError / projectsEditError: estados DEDICADOS (ni focusError ni el uno al otro) — si
  //     fueran focusError, el clear-on-any-input consumiría la tecla `r`/Esc o la de edición (Pitfall 2).
  const [projectsSnapshot, setProjectsSnapshot] = useState(
    /** @type {{ remote: Array<{ id: string, identifier: string, name: string }>, map: Record<string, any>, modules?: Array<{ id: string, name: string }>, activeProjectId?: string } | null} */ (null),
  );
  const [projectsError, setProjectsError] = useState(/** @type {string | null} */ (null));
  const [projectsEditError, setProjectsEditError] = useState(/** @type {string | null} */ (null));
  const prevIndexRef = useRef(0);
  // DOS tokens de generación, deliberadamente SEPARADOS (Phase 39 CR-01 + Phase 64 Anti-pattern):
  //   - overlayReqRef: aperturas async de overlay (c/l/L), picker de adopt y deriving. Cada apertura
  //     toma un reqId incrementándolo; al cerrar con Esc o reabrir, el ref avanza y la request en
  //     vuelo se descarta tras el await (`ref.current !== reqId`) en vez de reabrir un overlay obsoleto.
  //   - projectsReqRef: DEDICADO a los dos hops del editor de proyectos. NO reusa overlayReqRef — un
  //     Esc en projects-loading que lo avanzara invalidaría un overlay c/l legítimo en vuelo.
  const overlayReqRef = useRef(0);
  const projectsReqRef = useRef(0);

  // Phase 50 (PROG-03, D-09): keep-last-good del progreso vivo. Mapa session_id → último
  // { n, m, completed } leído con status 'ok'. Vive en un useRef (memoria ENTRE polls, NO dispara
  // re-render); lo lee y escribe el enrich de rows.js: ante un fallo transiente ('error') con
  // last-good presente expone el último N/M conocido (progCell pinta N/M, no '?').
  const progressLastGoodRef = useRef(/** @type {Map<string, { n: number, m: number, completed: boolean }>} */ (new Map()));

  // Phase 39 (TUI-15/TUI-16) — estado de los overlays de LECTURA (lógica en OverlayViewer.js).
  // `overlaySnapshot` es el contenido CONGELADO al abrir (D-05): el poll de la tabla sigue por
  // debajo pero onResult NO lo re-escribe → el texto no salta bajo el lector. `lines` ya viene
  // proyectado a strings; `adoptable` solo está presente cuando kind==='adopt' (picker).
  const [overlayKind, setOverlayKind] = useState(/** @type {'comments'|'logs'|'logs-all'|'plan'|'adopt'|null} */ (null));
  const [scrollOffset, setScrollOffset] = useState(0);
  const [overlaySnapshot, setOverlaySnapshot] = useState(
    /** @type {{ kind: 'comments'|'logs'|'logs-all'|'plan'|'adopt', taskRef: string, status: string, lines: string[], adoptable?: Array<{ workspaceRef: string, cwd: string, sessionId: string, kind: string }> }|null} */ (null),
  );

  // onResult: en ok refresca el contador/at/connected; en fallo NO toca lastGoodCount/lastGoodAt
  // (keep-last-good, D-06/Pitfall 5). Siempre actualiza lastAttemptAt (edad por poll, D-08).
  const onResult = useCallback(
    (/** @type {{ ok: boolean, data?: any, error?: string, code?: string }} */ result) => {
      const t = now();
      if (result.ok) {
        setLastGoodCount(result.data.count ?? result.data.sessions.length);
        setLastGoodAt(t);
        setConnected(true);
        setLastError(null);
        // Phase 69 (NET-02, D-08): un poll OK limpia el estado 401 (token repuesto/válido).
        setUnauthorized(false);
        // Phase 36: guarda el array de sesiones para la tabla. En !ok NO se toca (keep-last-good).
        setSessions(result.data.sessions ?? []);
      } else {
        setConnected(false);
        setLastError(result.error ?? null);
        // Phase 69 (NET-02, D-08): el 401 es una condición específica y accionable — se marca para
        // que el LiveIndicator pinte el banner "no autorizado" con precedencia. keep-last-good queda
        // intacto (lastGoodCount/lastGoodAt no se tocan). Cualquier otro fallo limpia el flag.
        setUnauthorized(result.code === 'unauthorized');
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

  // Phase 75 (LIVE-05, D-02): lee el bloque `tasks` de ~/.kodo/state.json. Esta lectura vive en
  // el cuerpo del componente, que React re-ejecuta en CADA render (75/WR-02) — no solo en los
  // ticks de usePoll: cada pulsación de tecla en filtro, cada scroll de overlay y cada cambio de
  // `mode` dispara una lectura síncrona (readFileSync). En la práctica hace piggyback sobre el
  // tick de usePoll que refresca /status (cero loop nuevo, cero watcher), pero NO está limitada a
  // ese tick. never-throws → {} (Pitfall 1: readTasks NO importa loadState, no escribe .bak). El
  // NEXT: es dato de la TAREA (por task_id), no de la sesión; ausente → celda vacía.
  const tasks = readTasksFn({});
  // Phase 84 (CAPT-07, D-21) + KODO-26: las dos presiones ambient del operador — capturas sin triar
  // por un lado, ramas sin integrar por el otro. Se calculan AQUÍ, junto a `tasks`, y no dentro de
  // deriveRows: NO se derivan del conjunto de sesiones (una rama sobrevive a su sesión), así que no
  // tienen el problema de parpadeo bajo filtro que obliga a derivar los `any*` sobre el set sin
  // filtrar. De los `any*` heredan solo la política de COLAPSO en el render (0 → no se pinta,
  // D-23). Misma cadencia que `readTasksFn` (piggyback sobre el render que redispara el tick de
  // usePoll — cero timers nuevos). Ambas never-throws → 0 (D-20).
  const inboxOpen = inboxCountFn({});
  const queuePending = queueCountFn({});
  // KODO-40: el pipeline de derivación (sort → enrich → flags → filtro → selección) vive en
  // rows.js. Corre en CADA render, igual que cuando estaba inline. `progressLastGoodRef.current`
  // es la memoria del keep-last-good del progreso ENTRE polls (un ref, no dispara re-render).
  const { filtered, anyGsd, anyProgress, anyNext, sel, counts, hasQuery } = deriveRows({
    sessions,
    query,
    selectedTaskId,
    prevIndex: prevIndexRef.current,
    tasks,
    lastGood: progressLastGoodRef.current,
  });

  // useInput mode-gated (TUI-08/TUI-12). Declarado DESPUÉS del pipeline para que el closure capture
  // `filtered`/`sel` actuales (su índice derivado es la base del movimiento clamp del cursor).
  //
  // Phase 37 D-Claude's-Discretion: callback `async` para que el handler de Enter pueda
  // `await onFocus(...)` (ink permite handlers async — no awaitea el return; los state
  // updates del setFocusError llegan cuando la promise resuelve). Simétrico con el patrón
  // `await fetchStatus(...)` de usePoll (Phase 35 D-07).
  //
  // KODO-40: las sub-máquinas con estado propio (setup / overlay+picker / deriving / config /
  // projects) viven en módulos hermanos. Este callback es el ROUTER: construye un `ctx` con el
  // mismo estado + setters que esas ramas capturaban por closure y delega. El orden de los
  // mode-gates es IDÉNTICO al del monolito (setup → overlay → deriving → confirm → config →
  // projects → filter → list): cambiarlo alteraría la semántica (Pitfall 0 de Phase 64).
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

      // KODO-40: contexto compartido con las sub-máquinas extraídas. Se construye por pulsación
      // (no por render) — es un objeto plano con el estado VIVO y los setters, exactamente lo que
      // esas ramas leían del closure cuando vivían dentro de este mismo callback.
      const ctx = {
        baseUrl,
        fetchFn,
        sessions,
        projects,
        setMode,
        setFocusError,
        setFooterColor,
        // acciones de fila (RowActions.js): runners never-throws + armado del dismiss
        onFocus,
        onOpen,
        armedTaskId,
        setArmedTaskId,
        armedTaskRef,
        setArmedTaskRef,
        // text-input compartido (config-edit / projects-edit / setup)
        buffer,
        setBuffer,
        cursor,
        setCursor,
        // Mutaciones ATÓMICAS de (buffer, cursor) — ver el bloque de su definición. Todo
        // handler de tecla debe usar ESTAS, nunca componer `slice` con `ctx.cursor`: dos
        // pulsaciones en un mismo batch de React leerían un cursor obsoleto y transpondrían
        // los caracteres.
        insertAtCursor,
        deleteBeforeCursor,
        moveCursor,
        resetTextInput,
        loadTextInput,
        setMaskValue,
        // editor de config + wizard de setup
        configSnapshot,
        setConfigSnapshot,
        setConfigEditError,
        fieldCursor,
        setFieldCursor,
        loadConfigFn,
        onSaveConfig,
        onSaveApiKey,
        setupStep,
        setSetupStep,
        providerCursor,
        setProviderCursor,
        // editor de proyectos/módulos (dos hops async bajo projectsReqRef)
        projectsSnapshot,
        setProjectsSnapshot,
        setProjectsError,
        setProjectsEditError,
        projectsReqRef,
        listProjectsFn,
        loadProjectsFn,
        saveProjectsFn,
        listModulesFn,
        dispatchProjectIdsFn,
        // overlays de lectura + picker de adopt
        overlayReqRef,
        overlaySnapshot,
        setOverlaySnapshot,
        setOverlayKind,
        setScrollOffset,
        adoptCursor,
        setAdoptCursor,
        armedSurface,
        setArmedSurface,
        setArmedSessionId,
        onAdoptDiscover,
        onAdopt,
        onDerive,
      };

      // Phase 68 Plan 02 (SETUP-01/02): el wizard first-run es un modo TERMINAL sin tabla debajo →
      // va ANTES del resto de mode-gates. Handler en SetupWizard.js (KODO-40).
      if (mode === 'setup') {
        await handleSetupInput(input, key, ctx);
        return;
      }
      // Phase 39 (TUI-15/TUI-16 — D-05/D-06): el overlay va ANTES del mode-gate de filtro: mientras
      // está abierto, ↑/↓ SCROLLEAN el contenido (no navegan filas) y Esc cierra a list SIN tocar
      // selectedTaskId. Handler en OverlayViewer.js, que a su vez delega el sub-modo picker de
      // adopt (overlaySnapshot.kind === 'adopt') en AdoptPicker.js (KODO-40).
      if (mode === 'overlay') {
        await handleOverlayInput(input, key, ctx);
        return;
      }
      // Phase 62 D-09 (ORCH-02): el estado transitorio `deriving` va ANTES del confirm. Handler en
      // AdoptPicker.js (KODO-40).
      if (mode === 'deriving') {
        handleDerivingInput(key, ctx);
        return;
      }
      // Phase 42 D-01/D-02/D-04 (DISMISS-02): SUB-MODO confirm. Va DESPUÉS del clear-on-any-input
      // y del overlay, ANTES de filter/list. CRÍTICO (RESEARCH Pitfall 4): entrar en `confirm` NO
      // setea el footer transitorio — el armed prompt DISMISS_CONFIRM se deriva de `mode==='confirm'`
      // (NO de focusError), así el clear-on-any-input no consume el segundo `d`. El armed prompt es
      // persistente (D-03: sin timer); solo `d` ejecuta, cualquier otra tecla (incl. Esc) cancela.
      if (mode === 'confirm') {
        // Phase 56 Pitfall 2 (DETECT-02): el confirm tiene DOS consumidores que esperan teclas
        // distintas (dismiss=`d`, adopt=`a`). Se rutea por cuál armed-id está set — armedSessionId
        // != null → flujo ADOPT (AdoptPicker.js: solo `a` ejecuta; cualquier otra tecla, incl.
        // `d`/Esc, cancela). Esto va ANTES de la rama dismiss para que una `a` NUNCA dispare un
        // dismiss y una `d` NUNCA dispare un adopt. El dismiss arma por task_id; el adopt por
        // sessionId — estados disjuntos.
        if (armedSessionId != null) {
          await handleAdoptConfirmInput(input, ctx);
          return;
        }
        // Rama DISMISS (RowActions.js): solo `d` ejecuta; Esc y cualquier otra tecla cancelan.
        await handleDismissConfirmInput(input, ctx);
        return;
      }
      // Phase 63 Plan 02 (D-03): editor de config, ENTRE el bloque confirm y el de filter (espejo
      // del orden D-03 "antes del mode-gate de filtro"). Handlers en ConfigEditor.js (KODO-40).
      if (mode === 'config') {
        handleConfigInput(input, key, ctx);
        return;
      }
      if (mode === 'config-edit') {
        await handleConfigEditInput(input, key, ctx);
        return;
      }
      // Phase 64 Plan 02/03: los SIETE modos del editor de proyectos/módulos, ENTRE config-edit y
      // filter (espejo del orden D-02). Todos llevan el prefijo `projects` — un único gate los cubre.
      // Handler en ProjectsEditor.js (KODO-40).
      if (mode.startsWith('projects')) {
        await handleProjectsInput(mode, input, key, ctx);
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
      if (input === 'e') {
        // Phase 63 Plan 02 D-02/UX-01: abre el editor de config SIN salir del dashboard (deep-clone
        // OBLIGATORIO del snapshot — Pitfall 1). Implementación en ConfigEditor.js (KODO-40).
        openConfigEditor(ctx);
        return;
      }
      if (input === 'm') {
        // Phase 64 Plan 02 D-01/D-02/D-10 (PROJ-01): abre el editor de PROYECTOS SIN salir del
        // dashboard. `m` está LIBRE en mode:'list' (verificado: q / e c l p d o a + arrows/Enter; Esc
        // ignorado — RESEARCH Pitfall 0). Dispara el fetch async token-guarded (runProjectsFetch):
        // entra a projects-loading, await listProjectsFn, ramifica a projects (snapshot congelado) o
        // projects-error (PROJ-05). NO toca selectedTaskId (UX-03 gratis al volver).
        await runProjectsFetchImpl(ctx);
        return;
      }
      // Los cuatro overlays de LECTURA (c/l/L/p) viven en OverlayViewer.js (KODO-40). Los tres
      // asíncronos (c/l/L) llevan dentro el reqId-guard CR-01 anti-reapertura-obsoleta; `p` es
      // síncrono y por tanto ATÓMICO (no lo necesita — ver la nota en openPlanOverlay).
      if (input === 'c') {
        // TUI-15/SC#1: comentarios de la fila seleccionada (resueltos por task_id, D-02).
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        await openCommentsOverlay(row, ctx);
        return;
      }
      if (input === 'l') {
        // TUI-16/SC#2: logs por grep substring (task_ref/workspace_ref) del buffer compartido.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        await openLogsOverlay(row, ctx);
        return;
      }
      if (input === 'L') {
        // Vista de log GENERAL: el buffer compartido COMPLETO, sin grep por sesión. NO requiere
        // fila seleccionada (es debug del daemon: webhooks/dispatch/lifecycle).
        await openLogsAllOverlay(ctx);
        return;
      }
      if (input === 'p') {
        // Phase 44 PLAN-01/PLAN-02 (D-02/D-05): el/los PLAN.md de la fase GSD de la fila seleccionada.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        openPlanOverlay(row, ctx);
        return;
      }
      // Las acciones sobre la fila seleccionada (d/o/O/Enter) viven en RowActions.js (KODO-40):
      // todas mapean un runner never-throws al footer transitorio. El no-op sin fila se resuelve
      // AQUÍ (el módulo recibe siempre una fila real).
      if (input === 'd') {
        // Phase 42 D-01/D-07-TUI (DISMISS-02/04): primera `d` — guard INVERSO del Enter (rechaza
        // alive===true) y armado del double-confirm por IDENTIDAD (task_id).
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        armDismiss(row, ctx);
        return;
      }
      if (input === 'o') {
        // Phase 48 (OPEN-01/02/03): open-in-manager. Lee `row.task_url` ya persistido (NO fetch,
        // distinto de c/l). SIN guard alive (D-04): funciona sobre alive/zombie/dismissed por igual.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        await openRow(row, ctx);
        return;
      }
      if (input === 'O') {
        // ENFOCAR el orquestador — NO requiere fila seleccionada (no es una sesión de tarea, vive
        // en el workspace cmux `kodo-orchestrator`). Contrato resolve-only + focus, never-throws.
        await focusOrchestrator(ctx);
        return;
      }
      if (input === 'a') {
        // Phase 56 D-01/D-02/D-03 (DETECT-02): descubre surfaces ad-hoc ON-DEMAND, las diffea contra
        // el snapshot vivo de /status y abre el picker. Vacío/unsupported → footer ADOPT_NONE y mode
        // SIGUE en list. Implementación (con su reqId-guard CR-01) en AdoptPicker.js (KODO-40).
        await openAdoptPicker(ctx);
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
        // Phase 37 D-02 + D-06: Enter — guard alive===false + onFocus never-throws.
        //
        // `resolveSelection` retorna `{index, taskId}` SIN `.row` — leemos la fila del
        // array filtrado por índice (cf. select.js:74-80). Si la lista está vacía,
        // `sel.index === -1` y `filtered[-1]` es undefined → no-op.
        const row = sel.index >= 0 ? filtered[sel.index] : null;
        if (!row) return;
        await focusRow(row, ctx);
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
        unauthorized, // Phase 69 Plan 03 NET-02 D-08: estado 401 → banner "no autorizado" con precedencia
        unauthorizedMessage: UNAUTHORIZED_MESSAGE, // Phase 69 Plan 03 NET-02 D-08: literal amarillo accionable
        mode,
        query,
        hasQuery,
        anyGsd, // TUI-18 D-08: flag estructural GSD (sobre `sorted`, no `filtered`) → drop columna phase/mode
        anyProgress, // PROG-03 D-06: flag estructural progreso (sobre `enriched` sin filtrar) → drop columna prog
        anyNext, // LIVE-05 Pitfall 4: flag estructural NEXT: (sobre `enriched` sin filtrar) → drop columna next
        inboxOpen, // CAPT-07 D-22/D-23: capturas sin enrutar → 3er hijo del header; en 0 no se emite
        queuePending, // KODO-26: ramas esperando integración → 4º hijo del header; en 0 no se emite
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
        mask: maskValue, // Phase 67 Plan 02 D-05: enmascara el text-input del renglón de API key (`•`)
        apiKeyConfigured: configSnapshot ? isApiKeyConfiguredFn(configSnapshot.provider) : false, // D-09: presencia
        rawModeSupported: isRawModeSupported, // Phase 67 Plan 02 D-07/Pitfall 16: degrada el renglón API key en non-TTY
        setupStep, // Phase 68 Plan 02 D-04: paso activo del wizard de setup (provider/base_url/workspace_slug/apikey/complete)
        providerCursor, // Phase 68 Plan 02 D-05: cursor del selector de provider en el paso 1/4
        projectsSnapshot, // Phase 64 Plan 02 D-01: snapshot congelado del editor de proyectos (null si cerrado)
        projectsError, // Phase 64 Plan 02 D-07: mensaje del fallo de fetch (dirige projects-error)
        projectsEditError, // Phase 64 Plan 02 Pitfall 2: error de validación de ruta inline (estado dedicado)
      }),
    ),
    createElement(Text, { dimColor: true }, '↑↓ move · c comments · l logs · L log-all · p plan · / filter (ps:state) · d dismiss · o open · O orch · a adopt · e config · m projects · q quit'),
  );
}
