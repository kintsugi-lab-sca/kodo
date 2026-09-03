// @ts-check
//
// src/inbox/project-ref.js — KODO-76.
//
// Proyección entre el TAG de una captura y el PROYECTO del proveedor de tareas, en las dos
// direcciones, contra el mapa de `~/.kodo/projects.json`.
//
// Leaf PURO: solo `node:path`. Sin I/O (el mapa se recibe ya cargado), sin estado, sin color.
// NO importa `store.js` — es al revés: `store.js#deriveTag` importa de aquí la proyección
// `projectId → tag`, que antes vivía inline en él. Así hay UNA sola definición de qué es el tag
// de un proyecto, y la inversa no puede derivar de ella.
//
// ## Qué problema cierra (KODO-76)
//
// El `tag` de una captura se deriva del **cwd** desde el que se capturó, no del proyecto al que
// la idea pertenece. En el inbox real del operador hay capturas que describen un bug de kodo y
// llevan el tag de otro repo, sencillamente porque se escribieron desde allí. Mientras el tag fue
// solo decorativo eso era ruido; en cuanto una captura puede convertirse en una TAREA de Plane,
// el tag pasa a ser la señal que elige el proyecto de destino, y necesita (a) poder reasignarse
// y (b) resolverse a un id de proyecto de verdad.
//
// ## La resolución es EXPLÍCITA, nunca adivinada
//
// `resolveProjectRef` devuelve un discriminante con `error:'none'|'ambiguous'` en lugar de elegir
// un proyecto por el operador. Dos proyectos distintos pueden mapear al mismo nombre de
// directorio (`.../a/dev` y `.../b/dev`), y crear una tarea en el proyecto equivocado no se
// deshace con un Ctrl-Z: el caller enseña el fallo y pide el id.

import { basename } from 'node:path';

/**
 * Identificador de proveedor con forma de UUID canónico. Mismo criterio que `store.js` usaba
 * inline: un id así NO es legible y hay que proyectarlo a la mitad legible del mapa.
 */
const UUID_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ruta del proyecto asociada a una entrada del mapa, o `''`.
 *
 * Acepta las DOS formas reales del valor: una cadena que ya es la ruta, o un objeto con `default`.
 * Todo lo demás se descarta — `projects.json` es operator-editable y un `default` numérico, nulo
 * o array de un hand-edit no puede hacer lanzar a un carril never-throws.
 *
 * NO recorre la tabla de módulos a propósito: el tag identifica el PROYECTO, no el módulo.
 *
 * @param {unknown} entry
 * @returns {string}
 */
function entryPath(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const d = /** @type {any} */ (entry).default;
    if (typeof d === 'string') return d;
  }
  return '';
}

/**
 * Tag legible de un proyecto: la proyección `projectId → tag`.
 *
 * Un identificador que YA es legible se devuelve tal cual. Uno con forma de UUID se proyecta al
 * último segmento de su ruta mapeada — nunca a la ruta completa: el grado de información expuesto
 * en el inbox es el mismo que el del fallback `basename(cwd)` del writer.
 *
 * Never-throws → `''` cuando no hay proyección posible (UUID sin ruta utilizable).
 *
 * @param {Record<string, unknown> | undefined} projects Mapa de `loadProjects()`.
 * @param {unknown} projectId
 * @returns {string} Tag legible, o `''`.
 */
export function projectTag(projects, projectId) {
  try {
    const id = String(projectId ?? '');
    if (id === '') return '';
    if (!UUID_KEY_RE.test(id)) return id;
    const path = entryPath(/** @type {any} */ (projects ?? {})[id]).replace(/\/+$/, '');
    return path === '' ? '' : basename(path);
  } catch {
    return '';
  }
}

/**
 * Catálogo de proyectos configurados, proyectado a lo que una superficie de elección necesita.
 *
 * Los proyectos SIN tag derivable (UUID sin ruta en el mapa) se incluyen igualmente, con `tag`
 * vacío: son elegibles por id y ocultarlos convertiría un mapa mal configurado en un proyecto
 * invisible. Orden estable por tag y, a igualdad, por id — el picker del dashboard depende de que
 * el orden no baile entre renders.
 *
 * @param {Record<string, unknown> | undefined} projects Mapa de `loadProjects()`.
 * @returns {Array<{ projectId: string, tag: string, path: string }>}
 */
export function listProjectRefs(projects) {
  try {
    const map = /** @type {Record<string, unknown>} */ (projects ?? {});
    return Object.keys(map)
      .map((projectId) => ({
        projectId,
        tag: projectTag(map, projectId),
        path: entryPath(map[projectId]).replace(/\/+$/, ''),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag) || a.projectId.localeCompare(b.projectId));
  } catch {
    return [];
  }
}

/**
 * Resuelve una referencia de proyecto —un tag legible o un id literal— a un `projectId`.
 *
 * Orden de resolución:
 *   1. Coincidencia EXACTA con una clave del mapa (el operador pasó el id). Gana siempre: es
 *      inequívoca por construcción.
 *   2. Coincidencia por tag, case-insensitive. Un único match → ese proyecto; varios →
 *      `ambiguous` CON la lista de candidatos, para que el caller pueda enseñarlos.
 *
 * Nunca elige por el operador ante una ambigüedad (ver cabecera).
 *
 * @param {unknown} ref Tag o projectId. Vacío/no-string → `{ error: 'none' }`.
 * @param {Record<string, unknown> | undefined} projects Mapa de `loadProjects()`.
 * @returns {{ projectId: string, tag: string }
 *          | { error: 'none' }
 *          | { error: 'ambiguous', matches: string[] }}
 */
export function resolveProjectRef(ref, projects) {
  const needle = typeof ref === 'string' ? ref.trim() : '';
  if (needle === '') return { error: 'none' };
  const map = /** @type {Record<string, unknown>} */ (projects ?? {});

  // 1. Id literal.
  if (Object.prototype.hasOwnProperty.call(map, needle)) {
    return { projectId: needle, tag: projectTag(map, needle) };
  }

  // 2. Tag, case-insensitive.
  const target = needle.toLowerCase();
  const matches = listProjectRefs(map).filter((p) => p.tag.toLowerCase() === target);
  if (matches.length === 1) return { projectId: matches[0].projectId, tag: matches[0].tag };
  if (matches.length > 1) return { error: 'ambiguous', matches: matches.map((m) => m.projectId) };
  return { error: 'none' };
}
