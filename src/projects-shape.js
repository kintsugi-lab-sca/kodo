// @ts-check
//
// Helpers PUROS de mutación/lectura del mapa `projects.json` (Phase 64, D-05/D-06).
//
// Es la extracción testeable de la lógica de forma dual del wizard `kodo config`
// (`cli.js:683-737`): listar estado de mapeo, asignar ruta, mapear módulos. Sus
// consumidores de RUNTIME son `manager.js:resolveProjectPath` (`:88` hace
// `typeof entry === 'string'`, `:92` lee `entry.modules?.[name]`) y `adopt.js:126`.
// Por eso la forma `string | { default, modules }` debe preservarse EXACTAMENTE
// (Anti-pattern RESEARCH / T-64-03): romperla rompe la resolución de rutas de TODAS
// las sesiones de un proyecto.
//
// Módulo 100% PURO: sin `node:fs`, sin ink, sin red. Cada función devuelve un mapa
// NUEVO (clon superficial) y NUNCA muta su argumento — la pureza se verifica por
// referencia en los tests.

/**
 * @typedef {string | { default?: string, modules?: Record<string, string> }} ProjectEntry
 * @typedef {Record<string, ProjectEntry>} ProjectsMap
 */

/**
 * Lee la ruta `default` de una entrada (para precargar el text-input). Espejo de
 * `cli.js:685` y `manager.js:88`. Never-throws.
 *
 * @param {any} entry
 * @returns {string} la ruta (string), el `default` del objeto, o '' si no está mapeado.
 */
export function getProjectPath(entry) {
  return typeof entry === 'string' ? entry : (entry?.default ?? '');
}

/**
 * Lee el mapa de módulos de una entrada. Una entrada-string (legacy) no tiene módulos.
 * Never-throws.
 *
 * @param {any} entry
 * @returns {Record<string, string>} el mapa `modules`, o `{}` si no aplica.
 */
export function getModuleMap(entry) {
  return (entry && typeof entry === 'object') ? (entry.modules ?? {}) : {};
}

/**
 * Asigna/edita la ruta `default` de un proyecto preservando la forma dual (D-06):
 *   - entrada-objeto con `modules` → `{ default: path, modules: <prev.modules INTACTO> }`.
 *   - entrada-string o ausente → string `path` plano (legacy).
 * NUNCA escribe `{ default: undefined }` ni colapsa un objeto-con-módulos a string.
 *
 * @param {ProjectsMap} map
 * @param {string} id
 * @param {string} path
 * @returns {ProjectsMap} un mapa NUEVO (no muta `map`).
 */
export function setProjectPath(map, id, path) {
  const next = { ...map };
  const prev = next[id];
  if (prev && typeof prev === 'object' && prev.modules) {
    next[id] = { default: path, modules: prev.modules }; // preserva modules (D-06)
  } else {
    next[id] = path; // string plano (legacy)
  }
  return next;
}

/**
 * Quita el mapeo de un proyecto (PROJ-03 / D-06): elimina SOLO la key `id`, deja las
 * demás entradas idénticas.
 *
 * @param {ProjectsMap} map
 * @param {string} id
 * @returns {ProjectsMap} un mapa NUEVO sin la key `id` (no muta `map`).
 */
export function removeProjectMapping(map, id) {
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * Mapea la carpeta de un módulo (PROJ-04 / D-05): asegura la forma objeto
 * `{ default, modules }` (preservando el default actual vía `getProjectPath`) y setea
 * `modules[moduleName] = path` preservando los otros módulos. La KEY es `mod.name`
 * del provider (`cli.js:728`).
 *
 * @param {ProjectsMap} map
 * @param {string} id
 * @param {string} moduleName
 * @param {string} path
 * @returns {ProjectsMap} un mapa NUEVO (no muta `map`).
 */
export function setModulePath(map, id, moduleName, path) {
  const next = { ...map };
  const def = getProjectPath(next[id]);
  const modules = { ...getModuleMap(next[id]), [moduleName]: path };
  next[id] = { default: def, modules };
  return next;
}
