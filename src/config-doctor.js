// @ts-check
//
// src/config-doctor.js — KODO-10.
//
// Módulo PURO (sin `node:fs`, sin red) del cruce `config.json` ↔ `projects.json`. Es el
// corazón de `kodo doctor`: detecta la desalineación que hizo morir todos los webhooks del
// proyecto SCP con `No configured project with identifier "UNKNOWN"` — el proyecto estaba
// mapeado en `projects.json` (path + módulos) pero AUSENTE de
// `config.providers.<provider>.projects`, así que el daemon nunca lo despachaba.
//
// Dos superficies del problema, dos direcciones del cruce:
//   - mapped_not_dispatched: mapeado (con path) pero NO en config → dispatch UNKNOWN (ERROR).
//   - dispatched_not_mapped: en config pero SIN ruta local → launch no resuelve path (WARN).
//   - dispatched_unknown_identifier: entry en config con identifier "UNKNOWN" (WARN).
//   - duplicate_path: dos ids mapeados a la misma ruta (WARN — ruido de config).
//
// `checkStates` es la mitad PURA del check de estados (`--states`): recibe los nombres de estado
// YA obtenidos por red (el CLI hace la llamada al provider) y verifica trigger/review/done
// case-insensitive — espejo EXACTO de `updateTaskState` (stateByName con claves lowercase),
// que es la razón por la que SCP también habría fallado el cierre (no tenía "In review").
//
// Consume `getProjectPath` de `projects-shape.js` (forma dual string | {default,modules}) para
// no duplicar la lógica de lectura del mapa — misma fuente que el runtime (`manager.js`) y el
// dashboard usan para resolver la ruta local de un proyecto.

import { getProjectPath } from './projects-shape.js';

/**
 * @typedef {'error'|'warn'} Severity
 * @typedef {{
 *   severity: Severity,
 *   code: 'mapped_not_dispatched'|'dispatched_not_mapped'|'dispatched_unknown_identifier'|'duplicate_path',
 *   projectId?: string,
 *   projectIds?: string[],
 *   identifier?: string|null,
 *   path?: string,
 *   detail: string,
 * }} AlignmentFinding
 */

/**
 * Extrae el set de IDs de proyecto dispatch-enabled del config. La lista
 * `config.providers[provider].projects` puede contener UUID strings sin resolver (pre-`init`)
 * u objetos `{ id, identifier, name }` (post-`init`). Never-throws.
 *
 * @param {any} config
 * @param {string} providerName
 * @returns {Set<string>}
 */
export function dispatchProjectIds(config, providerName) {
  const list = config?.providers?.[providerName]?.projects;
  const ids = new Set();
  if (!Array.isArray(list)) return ids;
  for (const p of list) {
    if (typeof p === 'string') ids.add(p);
    else if (p && typeof p === 'object' && p.id) ids.add(p.id);
  }
  return ids;
}

/**
 * Normaliza `config.providers[provider].projects` a un Map id → { id, identifier, name }.
 * @param {any} config
 * @param {string} providerName
 * @returns {Map<string, { id: string, identifier: string|null, name?: string }>}
 */
function configProjectsById(config, providerName) {
  const list = config?.providers?.[providerName]?.projects;
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const p of list) {
    if (typeof p === 'string') {
      map.set(p, { id: p, identifier: null });
    } else if (p && typeof p === 'object' && p.id) {
      map.set(p.id, { id: p.id, identifier: p.identifier ?? null, name: p.name });
    }
  }
  return map;
}

/**
 * Cruce PURO de `config.providers[provider].projects` ↔ `projects.json`. No hace I/O ni red.
 *
 * @param {{ config: any, projects: any, provider?: string }} params
 *   `config`: el objeto config (crudo de disco, `loadRawConfig` — pre-merge para ver ausencias).
 *   `projects`: el mapa `projects.json` (id → string | { default, modules }).
 *   `provider`: nombre del provider a cruzar; default `config.provider` o `'plane'`.
 * @returns {{ provider: string, findings: AlignmentFinding[], hasIssues: boolean }}
 */
export function scanConfigAlignment({ config, projects, provider } = /** @type {any} */ ({})) {
  const providerName = provider || config?.provider || 'plane';
  /** @type {AlignmentFinding[]} */
  const findings = [];

  const configById = configProjectsById(config, providerName);
  const projectsMap = projects && typeof projects === 'object' ? projects : {};

  // 1. mapped_not_dispatched (ERROR): id mapeado CON path pero ausente de config → el daemon
  //    no lo despacha; todo webhook suyo muere con "No configured project ... UNKNOWN".
  for (const [id, entry] of Object.entries(projectsMap)) {
    const path = getProjectPath(entry);
    if (!path) continue; // sin path no cuenta como mapeo real (p.ej. solo módulos)
    if (!configById.has(id)) {
      findings.push({
        severity: 'error',
        code: 'mapped_not_dispatched',
        projectId: id,
        path,
        detail: `Mapeado en projects.json (${path}) pero AUSENTE de config.providers.${providerName}.projects — sus webhooks morirán con "No configured project" (UNKNOWN). Añádelo a config.json.`,
      });
    }
  }

  // 2. dispatched_not_mapped (WARN): en config pero SIN ruta local → el launch fallará al
  //    resolver el path del worktree.
  for (const [id, meta] of configById) {
    const path = getProjectPath(projectsMap[id]);
    if (!path) {
      findings.push({
        severity: 'warn',
        code: 'dispatched_not_mapped',
        projectId: id,
        identifier: meta.identifier,
        detail: `Configurado (dispatch-enabled${meta.identifier ? ' ' + meta.identifier : ''}) pero SIN ruta local en projects.json — el launch fallará al resolver el path. Mapéalo con "kodo config" o el editor de proyectos del dashboard.`,
      });
    }
  }

  // 3. dispatched_unknown_identifier (WARN): entry en config con identifier "UNKNOWN" — `init`
  //    no lo resolvió contra la API (id inválido / proyecto borrado).
  for (const [id, meta] of configById) {
    if (meta.identifier === 'UNKNOWN') {
      findings.push({
        severity: 'warn',
        code: 'dispatched_unknown_identifier',
        projectId: id,
        detail: `Configurado con identifier "UNKNOWN" — no se resolvió contra la API. Revisa el id del proyecto o reconfigúralo.`,
      });
    }
  }

  // 4. duplicate_path (WARN): dos+ ids mapeados a la misma ruta → casi siempre ruido de config.
  /** @type {Map<string, string[]>} */
  const byPath = new Map();
  for (const [id, entry] of Object.entries(projectsMap)) {
    const path = getProjectPath(entry);
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    /** @type {string[]} */ (byPath.get(path)).push(id);
  }
  for (const [path, ids] of byPath) {
    if (ids.length > 1) {
      findings.push({
        severity: 'warn',
        code: 'duplicate_path',
        path,
        projectIds: ids,
        detail: `Ruta ${path} mapeada por ${ids.length} proyectos (${ids.join(', ')}) — un solo path para varios proyectos suele ser un error de config.`,
      });
    }
  }

  return { provider: providerName, findings, hasIssues: findings.length > 0 };
}

/**
 * Verificación PURA de que los estados requeridos (trigger/review/done) existen entre los
 * `availableStateNames` de un proyecto. Match CASE-INSENSITIVE — espejo de `updateTaskState`
 * (el provider guarda `stateByName` con claves lowercase porque la capitalización de los
 * estados de Plane varía por proyecto). El CLI obtiene `availableStateNames` por red y las
 * inyecta aquí. Never-throws.
 *
 * @param {{ requiredStates: Record<string, string>|null|undefined, availableStateNames: string[]|null|undefined }} params
 * @returns {{ missing: Array<{ role: string, name: string }> }}
 */
export function checkStates({ requiredStates, availableStateNames } = /** @type {any} */ ({})) {
  const available = new Set((Array.isArray(availableStateNames) ? availableStateNames : []).map((n) => String(n).toLowerCase()));
  /** @type {Array<{ role: string, name: string }>} */
  const missing = [];
  for (const [role, name] of Object.entries(requiredStates || {})) {
    if (!name) continue; // rol sin estado definido → nada que verificar
    if (!available.has(String(name).toLowerCase())) {
      missing.push({ role, name });
    }
  }
  return { missing };
}
