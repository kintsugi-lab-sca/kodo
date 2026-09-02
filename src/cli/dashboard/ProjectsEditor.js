// @ts-check
//
// src/cli/dashboard/ProjectsEditor.js — KODO-40 (extracción de App.js).
//
// Editor de PROYECTOS y MÓDULOS in-dashboard (tecla `m`) + su copy literal-estable. Es una
// sub-máquina de SIETE modos, todos con prefijo `projects`:
//   projects-loading · projects · projects-edit · projects-error
//   projects-modules-loading · projects-modules · projects-modules-edit
// `handleProjectsInput` los despacha por `mode` (App.js entra con un único `mode.startsWith`).
//
// Extraído VERBATIM de App.js (Phase 64 Plan 02/03) sin cambio semántico: eran ramas del `useInput`
// monolítico y aquí son funciones que reciben un `ctx` con el estado y los setters que ya usaban
// por closure. App.js re-exporta todas las constantes, así que SessionTable.js y los tests
// `dashboard-projects` siguen importándolas de App.js.
//
// Dos hops async (listProjectsFn → listModulesFn) bajo UN token de generación DEDICADO
// (`ctx.projectsReqRef`, Pitfall 3): NO reusa overlayReqRef (lo comparten c/l/adopt/deriving).

// Phase 64 Plan 02 (PROJ-02): validador de ruta-directorio never-throws (módulo adyacente, NO
// config-validate.js que es 0-I/O — Plan 01). Corre ANTES de saveProjectsFn (T-64-06).
import { validateExistingDir } from '../../path-validate.js';
// Phase 64 Plan 02 (D-06): helpers PUROS de forma dual de projects.json (Plan 01). Preservan
// EXACTAMENTE `string | { default, modules }` que consumen manager.js/adopt.js (T-64-07).
// Phase 64 Plan 03 (PROJ-04/D-05): setModulePath materializa `{ default, modules:{[name]:ruta} }`
// preservando default y los otros módulos (D-06); getModuleMap lee el mapeo actual de un módulo
// para precargar el text-input. Todos PUROS/never-throws.
import {
  setProjectPath,
  removeProjectMapping,
  getProjectPath,
  setModulePath,
  getModuleMap,
} from '../../projects-shape.js';

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

// Phase 64 Plan 03 (PROJ-04/D-05): copy literal-estable del sub-editor de MÓDULOS. EXPORTADAS para
// que tests y SessionTable.js las importen y asseren equality sin duplicar strings (mismo patrón
// PROJECTS_*). El soporte de módulos es un SEGUNDO hop async (listModulesFn) espejo del wizard
// (`cli.js:700-740`).
//   - PROJECTS_MODULES_TITLE: cabecera del sub-overlay de módulos.
//   - PROJECTS_NO_MODULES (informativo, no error): el provider no expone módulos (GitHub) o la lista
//     viene vacía → footer no-op, never-throws, se vuelve a la lista de proyectos sin abrir el
//     sub-overlay (espejo `cli.js:711-714`). Se muestra vía focusError en mode:'projects' (transitorio).
export const PROJECTS_MODULES_TITLE = 'módulos del proyecto';
export const PROJECTS_NO_MODULES = 'este provider no tiene módulos';

// KODO-10: tags de estado de DISPATCH por proyecto en el overlay. El dashboard listaba TODOS los
// proyectos del workspace (listProjects) con el mapeo de projects.json superpuesto, sin distinguir
// los que el daemon REALMENTE despacha (los de config.providers.<provider>.projects) de los que
// solo están mapeados — la trampa del caso SCP (mapeado pero no configurado → webhooks a UNKNOWN).
//   - PROJECTS_DISPATCH_TAG (verde): el proyecto está en config → el daemon despacha sus webhooks.
//   - PROJECTS_MAPPED_ONLY_TAG (ámbar): mapeado en projects.json pero AUSENTE de config → sus
//     webhooks morirán con "No configured project" (UNKNOWN). Ejecuta `kodo doctor`.
export const PROJECTS_DISPATCH_TAG = '⚡ dispatch';
export const PROJECTS_MAPPED_ONLY_TAG = '⚠ solo-mapeado';

/**
 * Phase 64 Plan 02 (D-01, RESEARCH Pattern 1+2): apertura/retry del editor de proyectos. Compartido
 * por el handler `m` (mode:'list') y por `r` (mode:'projects-error') — el carril es idéntico. Entra a
 * projects-loading, captura un reqId DEDICADO (projectsReqRef), `await`a el fetch never-throws
 * discriminado, y tras el await DESCARTA el resultado si el ref avanzó (Esc/2ª apertura, T-64-08).
 * Éxito → snapshot CONGELADO { remote, map=loadProjectsFn() } + mode:'projects'. Fallo → projects-error
 * (PROJ-05). NO toca selectedTaskId (UX-03: resolveSelection re-deriva la fila al volver).
 *
 * @param {any} ctx
 */
export async function runProjectsFetch(ctx) {
  ctx.setMode('projects-loading');
  const reqId = ++ctx.projectsReqRef.current;
  const result = await ctx.listProjectsFn();
  if (ctx.projectsReqRef.current !== reqId) return; // T-64-08: cancelada/superada durante el await
  if (result && result.ok) {
    // KODO-10: congela también el set dispatch-enabled (estable durante la sesión) para marcar
    // cada fila dispatch vs solo-mapeado sin re-leer config en cada render.
    ctx.setProjectsSnapshot({ remote: result.projects ?? [], map: ctx.loadProjectsFn(), dispatch: new Set(ctx.dispatchProjectIdsFn()) });
    ctx.setFieldCursor(0);
    ctx.setProjectsError(null);
    ctx.setProjectsEditError(null);
    ctx.setMode('projects');
  } else {
    ctx.setProjectsError((result && result.error) || 'error desconocido');
    ctx.setMode('projects-error');
  }
}

/**
 * Phase 64 Plan 02/03 (D-01/D-02/D-07 + PROJ-04/D-05): SUB-MÁQUINA completa del editor de PROYECTOS.
 * En App.js se despacha ENTRE config-edit y filter (espejo del orden D-02 "antes del mode-gate de
 * filtro"). Siete modos: el transitorio projects-loading (fetch en vuelo), la lista navegable
 * projects, el text-input projects-edit, la degradación projects-error (PROJ-05) y los tres espejo
 * del 2º hop de MÓDULOS. Todos never-throws — el panel ink jamás se desmonta.
 *
 * @param {string} mode - el `mode` actual (siempre con prefijo `projects`).
 * @param {string} input
 * @param {any} key
 * @param {any} ctx
 */
export async function handleProjectsInput(mode, input, key, ctx) {
  if (mode === 'projects-loading') {
    // Esc CANCELA e invalida el fetch en vuelo: avanza projectsReqRef → el resultado tardío se
    // descarta tras el await (T-64-08, molde deriving). selectedTaskId intacto (UX-03).
    if (key.escape) {
      ctx.projectsReqRef.current++;
      ctx.setMode('list');
      return;
    }
    return; // traga el resto mientras carga
  }
  if (mode === 'projects') {
    const items = ctx.projectsSnapshot?.remote ?? [];
    if (key.escape) {
      ctx.setMode('list'); // UX-03: selectedTaskId intacto → el cursor de la tabla se conserva
      return;
    }
    if (key.upArrow) {
      ctx.setFieldCursor((/** @type {number} */ i) => Math.max(0, i - 1)); // clamp sin wrap (molde adoptCursor)
      return;
    }
    if (key.downArrow) {
      ctx.setFieldCursor((/** @type {number} */ i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (key.return) {
      // Precarga la ruta ACTUAL del proyecto (forma dual D-06: string|{default}|sin mapear → '')
      // y entra a projects-edit con el cursor al final. El id se re-deriva del snapshot en edit.
      const item = items[ctx.fieldCursor];
      if (!item) return;
      const current = getProjectPath(ctx.projectsSnapshot.map[item.id]);
      ctx.loadTextInput(current);
      ctx.setProjectsEditError(null);
      ctx.setMode('projects-edit');
      return;
    }
    if (input === 'x') {
      // PROJ-03/D-03/D-06: quitar el mapeo DIRECTO (sin modal — re-mapeable, no destructivo).
      // removeProjectMapping es puro (clon sin la key); saveProjectsFn persiste el mapa nuevo.
      // El aviso transitorio va en focusError/footerColor (molde config D-10).
      const item = items[ctx.fieldCursor];
      if (!item) return;
      const next = removeProjectMapping(ctx.projectsSnapshot.map, item.id);
      ctx.saveProjectsFn(next);
      ctx.setProjectsSnapshot((/** @type {any} */ s) => (s ? { ...s, map: next } : s));
      ctx.setFocusError(PROJECTS_REMOVED(item.identifier));
      ctx.setFooterColor('yellow');
      return;
    }
    if (input === 'm') {
      // Phase 64 Plan 03 (PROJ-04/D-05): SEGUNDO hop async. `m` en mode:'projects' abre los módulos
      // del proyecto bajo el cursor. NO colisiona con el `m` de mode:'list' (esta rama se evalúa
      // ANTES, Pitfall 0). Reusa el MISMO projectsReqRef (Pitfall 3 — dos hops, un ref dedicado):
      // cada apertura captura su reqId y descarta el resultado si el ref avanzó (Esc en loading).
      const item = items[ctx.fieldCursor];
      if (!item) return;
      const id = item.id;
      ctx.setMode('projects-modules-loading');
      const reqId = ++ctx.projectsReqRef.current;
      const result = await ctx.listModulesFn(id);
      if (ctx.projectsReqRef.current !== reqId) return; // T-64-12: cancelada/superada durante el await
      if (result && result.ok && Array.isArray(result.modules) && result.modules.length) {
        // Congela la lista de módulos + el proyecto activo en el snapshot (sin duplicar estado).
        ctx.setProjectsSnapshot((/** @type {any} */ s) => (s ? { ...s, modules: result.modules, activeProjectId: id } : s));
        ctx.setFieldCursor(0); // el cursor de la lista de módulos arranca en 0
        ctx.setProjectsEditError(null);
        ctx.setMode('projects-modules');
      } else if (result && result.ok) {
        // Lista vacía (github / provider sin módulos): footer informativo no-op, NO abre el
        // sub-overlay, NO escribe (PROJECTS_NO_MODULES, never-throws — T-64-10/D-05).
        ctx.setFocusError(PROJECTS_NO_MODULES);
        ctx.setFooterColor('yellow');
        ctx.setMode('projects');
      } else {
        // Fallo del 2º hop: footer error + vuelve a projects (never-throws, no escribe).
        ctx.setFocusError(PROJECTS_LOAD_FAILED((result && result.error) || 'error desconocido'));
        ctx.setFooterColor('red');
        ctx.setMode('projects');
      }
      return;
    }
    return; // traga el resto mientras navega la lista
  }
  if (mode === 'projects-edit') {
    // Mismo molde de text-input que config-edit: Esc cancela sin guardar; ←/→ clamp cursor;
    // backspace||delete (juntos, Pitfall 3) borra char anterior; char imprimible inserta en cursor;
    // Enter valida con validateExistingDir ANTES de saveProjectsFn (PROJ-02/T-64-06).
    const items = ctx.projectsSnapshot?.remote ?? [];
    const item = items[ctx.fieldCursor];
    if (key.escape) {
      ctx.setMode('projects'); // cancela sin guardar (D-03)
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
      ctx.deleteBeforeCursor(); // la guarda de inicio-de-buffer vive dentro (cursor fresco)
      return;
    }
    if (key.return) {
      if (!item) {
        ctx.setMode('projects');
        return;
      }
      // Validación con I/O never-throws (src/path-validate.js). Un inválido NUNCA alcanza el disco
      // (PROJ-02/T-64-06): se guarda en projectsEditError (dedicado, Pitfall 2) y se sigue en
      // projects-edit — la siguiente tecla edita, no se gasta limpiando el error.
      const res = validateExistingDir(ctx.buffer);
      if (!res.ok) {
        ctx.setProjectsEditError(res.error);
        return;
      }
      // setProjectPath es puro y preserva la forma dual (modules INTACTO si la entrada es objeto,
      // D-06/T-64-07). saveProjectsFn es síncrono atómico; el try/catch es defensa en profundidad
      // (never-throws — si lanzara, el panel ink sigue montado, D-07).
      const next = setProjectPath(ctx.projectsSnapshot.map, item.id, res.value);
      try {
        ctx.saveProjectsFn(next);
        ctx.setProjectsSnapshot((/** @type {any} */ s) => (s ? { ...s, map: next } : s));
        ctx.setProjectsEditError(null);
        ctx.setFocusError(PROJECTS_SAVED_RESTART);
        ctx.setFooterColor('yellow');
        ctx.setMode('projects');
      } catch {
        ctx.setProjectsEditError(PROJECTS_SAVE_FAILED); // never-throws de respaldo
      }
      return;
    }
    // Char imprimible: inserta en la posición del cursor (NO append ciego, molde config-edit).
    if (input && !key.ctrl && !key.meta) {
      ctx.insertAtCursor(input);
      return;
    }
    return; // traga el resto (teclas de control no mapeadas)
  }
  if (mode === 'projects-error') {
    // PROJ-05/D-07: `r` re-dispara el fetch (mismo carril que `m`); Esc sale a list. saveProjectsFn
    // JAMÁS se llama aquí (carril de LECTURA remota — projects.json intacto).
    if (input === 'r') {
      await runProjectsFetch(ctx);
      return;
    }
    if (key.escape) {
      ctx.setMode('list');
      return;
    }
    return; // traga el resto
  }
  // Phase 64 Plan 03 (PROJ-04/D-05): SUB-MÁQUINA del editor de MÓDULOS (2º hop). Tres modos espejo
  // del carril base: el transitorio projects-modules-loading (listModulesFn en vuelo), la lista
  // navegable projects-modules y el text-input projects-modules-edit. Todos never-throws.
  if (mode === 'projects-modules-loading') {
    // Esc CANCELA e invalida el fetch del 2º hop en vuelo: avanza projectsReqRef → el resultado
    // tardío se descarta tras el await (T-64-12) + vuelve a projects (no a list — el sub-editor se
    // abrió DESDE projects).
    if (key.escape) {
      ctx.projectsReqRef.current++;
      ctx.setMode('projects');
      return;
    }
    return; // traga el resto mientras carga
  }
  if (mode === 'projects-modules') {
    const modules = ctx.projectsSnapshot?.modules ?? [];
    if (key.escape) {
      ctx.setMode('projects'); // vuelve a la lista de proyectos
      return;
    }
    if (key.upArrow) {
      ctx.setFieldCursor((/** @type {number} */ i) => Math.max(0, i - 1)); // clamp sin wrap (molde projects)
      return;
    }
    if (key.downArrow) {
      ctx.setFieldCursor((/** @type {number} */ i) => Math.min(modules.length - 1, i + 1));
      return;
    }
    if (key.return) {
      // Precarga la ruta ACTUAL del módulo (getModuleMap del proyecto activo) en el text-input.
      const mod = modules[ctx.fieldCursor];
      if (!mod) return;
      const activeId = ctx.projectsSnapshot?.activeProjectId;
      const current = getModuleMap(ctx.projectsSnapshot?.map?.[activeId])[mod.name] ?? '';
      ctx.loadTextInput(current);
      ctx.setProjectsEditError(null);
      ctx.setMode('projects-modules-edit');
      return;
    }
    return; // traga el resto mientras navega la lista de módulos
  }
  if (mode === 'projects-modules-edit') {
    // Mismo molde de text-input que projects-edit: Esc cancela; ←/→ clamp cursor; backspace||delete
    // borra char anterior; char imprimible inserta en cursor; Enter valida con validateExistingDir
    // ANTES de setModulePath + saveProjectsFn (PROJ-04/T-64-11 reuso del validador del carril base).
    const modules = ctx.projectsSnapshot?.modules ?? [];
    const mod = modules[ctx.fieldCursor];
    if (key.escape) {
      ctx.setMode('projects-modules'); // cancela sin guardar, vuelve a la lista de módulos
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
      ctx.deleteBeforeCursor(); // la guarda de inicio-de-buffer vive dentro (cursor fresco)
      return;
    }
    if (key.return) {
      if (!mod) {
        ctx.setMode('projects-modules');
        return;
      }
      // Validación FS never-throws ANTES de tocar el disco (PROJ-04): inválida → projectsEditError
      // (dedicado, Pitfall 2) + sigue editando, NUNCA escribe.
      const res = validateExistingDir(ctx.buffer);
      if (!res.ok) {
        ctx.setProjectsEditError(res.error);
        return;
      }
      // setModulePath materializa { default, modules } preservando default y los OTROS módulos
      // (D-06/T-64-13). La KEY es mod.name del provider (no input libre — T-64-11). saveProjectsFn
      // es síncrono atómico; el try/catch es defensa en profundidad (never-throws).
      const activeId = ctx.projectsSnapshot?.activeProjectId;
      const next = setModulePath(ctx.projectsSnapshot.map, activeId, mod.name, res.value);
      try {
        ctx.saveProjectsFn(next);
        ctx.setProjectsSnapshot((/** @type {any} */ s) => (s ? { ...s, map: next } : s));
        ctx.setProjectsEditError(null);
        ctx.setFocusError(PROJECTS_SAVED_RESTART);
        ctx.setFooterColor('yellow');
        ctx.setMode('projects-modules');
      } catch {
        ctx.setProjectsEditError(PROJECTS_SAVE_FAILED); // never-throws de respaldo
      }
      return;
    }
    // Char imprimible: inserta en la posición del cursor (NO append ciego, molde projects-edit).
    if (input && !key.ctrl && !key.meta) {
      ctx.insertAtCursor(input);
      return;
    }
    return; // traga el resto (teclas de control no mapeadas)
  }
}
