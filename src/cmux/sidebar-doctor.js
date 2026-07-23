// @ts-check
//
// src/cmux/sidebar-doctor.js — Phase 79 Plan 02 (SDR-01/02/03/05).
//
// El MOTOR determinista (0 tokens, 0 red salvo cmux local) del `kodo sidebar
// doctor`: espejo arquitectónico EXACTO de `src/gsd/doctor.js` — una mitad PURA
// de detección (`scan`) y una mitad de I/O mutadora (`execute`), ambas DI,
// never-throws, fail-open per item, con re-detección TOCTOU antes de actuar.
//
// scan(deps)   → SidebarReport serializable (NO muta, NO hace I/O mutante).
//                Compara las sesiones kodo VIVAS de state.json contra el sidebar
//                real (workspace-group list --json + workspace list --json) y
//                clasifica en missing_group / loose_workspace / empty_group.
// execute(deps,opts) → RE-detecta (D-06 TOCTOU, NO consume el report externo) y
//                emite el allowlist NO-destructivo en orden D-09, cada acción en
//                su try/catch (fail-open), never-throws top-level. (Task 2.)
//
// Re-derivación OFFLINE del grupo esperado (SDR-03): reutiliza VERBATIM
// `deriveExpectedGroupName` + `resolveWorkspaceGroup` (manager.js) y reconstruye
// el task-like por reverse-lookup determinista del módulo en projects.json (D-02)
// — NO persiste `expected_group` en el session record (D-03).
//
// Invariantes (threat register Phase 79):
//   - SDR-03: 0 tokens — este módulo NO importa ningún cliente de provider ni
//     módulo LLM. La detección es 100% determinista (verificable por source
//     assertion sobre los imports).
//   - GRP-04: el doctor es SOLO-LECTURA sobre state.json — NO importa ningún
//     escritor de state (saveState/withStateLock/upsertTaskHandoff) ni persiste
//     ningún ref `workspace_group:N`.
//   - LOG-12: NO importa `logger.js`. El `logger` se inyecta via deps; el default
//     es `noopLogger` (zero-import whitelisted). `logger-events.js` (pure
//     transform) sí es importable estáticamente.
//   - D-04: solo se agrupan/mueven workspace_ref presentes en state.json Y vivos
//     (cruzados con `workspace list --json`); un ref no-kodo jamás entra a una acción.
//
// El módulo vive DENTRO de `src/cmux/`, así que PUEDE importar `./client.js` para
// sus defaults lazy DI — el walker de aislamiento (test/host/cmux-isolation.test.js)
// escanea SOLO src/cli/dashboard, src/session y src/cli/polling.js (RESEARCH §Nota
// de aislamiento). Cero riesgo de regresión del walker.

import { loadState } from '../session/state.js';
import { loadProjects } from '../config.js';
import { deriveExpectedGroupName, resolveWorkspaceGroup } from '../session/manager.js';
import {
  listWorkspaceGroups,
  listWorkspacesJson,
  createWorkspaceGroup,
  addToWorkspaceGroup,
  setGroupAnchor,
  ungroupWorkspaceGroup,
} from './client.js';
// LOG-12: noopLogger es el stub zero-import whitelisted — NUNCA logger.js.
import { noopLogger } from '../logger-noop.js';
import { sidebarDoctorScan, sidebarDoctorFix, sidebarDoctorFixError } from '../logger-events.js';

/**
 * @typedef {import('../session/state.js').Session} Session
 *
 * @typedef {{ name: string, anchor: string, members: string[] }} MissingGroupItem
 * @typedef {{ group: string, workspace_ref: string, name: string }} LooseWorkspaceItem
 * @typedef {{ ref: string, name: string }} EmptyGroupItem
 * @typedef {{ ref: string, group: string, name: string }} ProtectedItem
 *
 * @typedef {{
 *   missing_group: MissingGroupItem[],
 *   loose_workspace: LooseWorkspaceItem[],
 *   empty_group: EmptyGroupItem[],
 *   protected: { sessions: ProtectedItem[] },
 *   hasActions: boolean,
 * }} SidebarReport
 *
 * @typedef {{
 *   loadState?: () => any,
 *   loadProjects?: () => Record<string, any>,
 *   listWorkspaceGroupsRaw?: () => Promise<string> | string,
 *   listWorkspacesRaw?: () => Promise<string> | string,
 *   createWorkspaceGroup?: (opts: { name?: string, from?: string[] }) => Promise<string>,
 *   addToWorkspaceGroup?: (opts: { group: string, workspace: string }) => Promise<string>,
 *   setGroupAnchor?: (opts: { group: string, workspace: string }) => Promise<string>,
 *   ungroupWorkspaceGroup?: (opts: { group: string }) => Promise<string>,
 *   now?: () => number,
 *   logger?: { info: Function, warn: Function, error: Function },
 * }} SidebarDeps
 */

// ── DI default resolution (lazy real impls; espejo doctor.js:188-208) ─────────

/** Resuelve los deps con sus defaults reales lazy. */
function resolveDeps(deps = {}) {
  return {
    loadState: deps.loadState || loadState,
    loadProjects: deps.loadProjects || loadProjects,
    // raws: el ref del grupo/workspace se parsea DEFENSIVAMENTE en scan, no aquí
    // (el passthrough de client.js devuelve stdout crudo — D-05 Phase 77).
    listWorkspaceGroupsRaw: deps.listWorkspaceGroupsRaw || listWorkspaceGroups,
    listWorkspacesRaw: deps.listWorkspacesRaw || listWorkspacesJson,
    // Allowlist NO-destructivo (solo lo consume execute; jamás delete/remove/rename).
    createWorkspaceGroup: deps.createWorkspaceGroup || createWorkspaceGroup,
    addToWorkspaceGroup: deps.addToWorkspaceGroup || addToWorkspaceGroup,
    setGroupAnchor: deps.setGroupAnchor || setGroupAnchor,
    ungroupWorkspaceGroup: deps.ungroupWorkspaceGroup || ungroupWorkspaceGroup,
    now: deps.now || (() => Date.now()),
    // logger default seguro: sidebarDoctorScan invoca logger.info; un undefined
    // lo rompería. noopLogger es no-op (never-throws al emitir eventos).
    logger: deps.logger || noopLogger,
  };
}

// ── taskLikeFrom (reverse-lookup módulo offline, D-02) ────────────────────────

/**
 * Reconstruye el task-like que consume `deriveExpectedGroupName` a partir de un
 * session record, SIN red (D-02). El módulo se obtiene por reverse-lookup
 * determinista en projects.json: si `projects[session.project_id]` es un objeto
 * con `.modules` y `session.project_path` NO es el `default`, se busca el primer
 * `[name, path]` de `entry.modules` cuyo `path === session.project_path`
 * (first-match estable) y se usa ese `name`.
 *
 * Contrato verificado contra manager.js:114 (`deriveModuleName(task)` → `task.groups[0]`):
 * alimentamos `groups: [moduleName]` para que la re-derivación offline sea
 * idéntica a la del launch. `path === entry.default` (o entry flat) → `groups: []`
 * → identifier a secas.
 *
 * @param {Session} session
 * @param {Record<string, any>} projects
 * @returns {{ ref: string, groups: string[] }}
 */
export function taskLikeFrom(session, projects) {
  const entry = projects[session.project_id];
  let moduleName = null;
  if (entry && typeof entry === 'object' && entry.modules && session.project_path !== entry.default) {
    for (const [name, path] of Object.entries(entry.modules)) {
      if (path === session.project_path) {
        moduleName = name;
        break; // first-match estable (D-02)
      }
    }
  }
  return { ref: session.task_ref, groups: moduleName ? [moduleName] : [] };
}

// ── Helpers de detección ──────────────────────────────────────────────────────

/**
 * Parsea el stdout crudo de una raw en un objeto, con fallback never-throws.
 * @param {() => Promise<string> | string} rawFn
 * @param {any} fallback
 * @param {any} d
 * @param {string} category
 * @returns {Promise<any>}
 */
async function parseRaw(rawFn, fallback, d, category) {
  try {
    const raw = await rawFn();
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (err) {
    d.logger?.warn?.('sidebar.doctor.scan', { category, error: String(/** @type {any} */ (err)?.message || err) });
    return fallback;
  }
}

/**
 * Ordena por `started_at` ISO-8601 ascendente con desempate ESTABLE por el orden
 * de entrada (decorate-sort para no depender de la estabilidad del motor).
 * @param {Session[]} sessions
 * @returns {Session[]}
 */
function sortByOldest(sessions) {
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ta = a.s.started_at || '';
      const tb = b.s.started_at || '';
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return a.i - b.i; // empate → orden estable de la lista (D-08)
    })
    .map((x) => x.s);
}

/**
 * Índice `workspace:N` → [group refs] desde `member_workspace_refs`.
 * @param {any} groupsJson
 * @returns {Map<string, string[]>}
 */
function buildMemberIndex(groupsJson) {
  const idx = new Map();
  for (const g of groupsJson.groups || []) {
    if (!g || typeof g.ref !== 'string' || !Array.isArray(g.member_workspace_refs)) continue;
    for (const ws of g.member_workspace_refs) {
      if (typeof ws !== 'string') continue;
      const arr = idx.get(ws) || [];
      arr.push(g.ref);
      idx.set(ws, arr);
    }
  }
  return idx;
}

// ── scan() ─────────────────────────────────────────────────────────────────

/**
 * Detección PURA de las 3 categorías del sidebar. NO muta, NO hace I/O mutante.
 * never-throws: cada input va en su try/catch con fallback (D-06). Es async
 * porque los passthroughs cmux (`listWorkspaceGroups`/`listWorkspacesJson`) son
 * async (execFile); los stubs sync de test se resuelven igual vía `await`.
 *
 * @param {SidebarDeps} [deps]
 * @returns {Promise<SidebarReport>}
 */
export async function scan(deps = {}) {
  const d = resolveDeps(deps);

  let state;
  try {
    state = d.loadState();
  } catch (err) {
    d.logger?.warn?.('sidebar.doctor.scan', { category: 'state', error: String(/** @type {any} */ (err)?.message || err) });
    state = { sessions: {} };
  }
  let projects;
  try {
    projects = d.loadProjects();
  } catch (err) {
    d.logger?.warn?.('sidebar.doctor.scan', { category: 'projects', error: String(/** @type {any} */ (err)?.message || err) });
    projects = {};
  }
  const groupsJson = await parseRaw(d.listWorkspaceGroupsRaw, { groups: [] }, d, 'groups');
  const workspacesJson = await parseRaw(d.listWorkspacesRaw, { workspaces: [] }, d, 'workspaces');

  const liveWorkspaceRefs = new Set((workspacesJson.workspaces || []).map((w) => w?.ref).filter(Boolean));
  const memberOf = buildMemberIndex(groupsJson);

  // Agrupar sesiones kodo VIVAS por nombre de grupo esperado (D-02/D-04).
  /** @type {Map<string, Session[]>} */
  const byExpected = new Map();
  for (const s of Object.values(state.sessions || {})) {
    if (!s || s.alive === false) continue;                    // solo sesiones vivas (D-04)
    if (!liveWorkspaceRefs.has(s.workspace_ref)) continue;    // workspace ya cerrado → nada que agrupar
    let expected = null;
    try {
      expected = deriveExpectedGroupName(taskLikeFrom(s, projects), projects[s.project_id], s.project_path);
    } catch {
      expected = null; // fail-open: ref/entry raro → saltar la sesión
    }
    if (!expected) continue;                                  // ref degenerado → fail-open (guard reuso)
    const arr = byExpected.get(expected);
    if (arr) arr.push(s);
    else byExpected.set(expected, [s]);
  }

  /** @type {MissingGroupItem[]} */
  const missing_group = [];
  /** @type {LooseWorkspaceItem[]} */
  const loose_workspace = [];
  /** @type {ProtectedItem[]} */
  const protectedSessions = [];

  for (const [expected, sessions] of byExpected) {
    const groupRef = resolveWorkspaceGroup(groupsJson, expected);
    if (!groupRef) {
      // grupo faltante O disuelto (D-07): mismo remedio create+add+set-anchor
      const ordered = sortByOldest(sessions);
      missing_group.push({
        name: expected,
        anchor: ordered[0].workspace_ref,
        members: ordered.map((s) => s.workspace_ref),
      });
    } else {
      // el grupo existe: ¿algún miembro suelto? (SDR-05)
      for (const s of sessions) {
        const groups = memberOf.get(s.workspace_ref) || [];
        if (groups.includes(groupRef)) {
          protectedSessions.push({ ref: s.workspace_ref, group: groupRef, name: expected });
        } else {
          loose_workspace.push({ group: groupRef, workspace_ref: s.workspace_ref, name: expected });
        }
      }
    }
  }

  // grupos vacíos (D-05) — defensivo; cmux disuelve al cerrar el anchor, así que
  // un grupo con member_count 0 es un estado transitorio raro (Pitfall 5).
  /** @type {EmptyGroupItem[]} */
  const empty_group = (groupsJson.groups || [])
    .filter((g) => g && typeof g.ref === 'string' && g.member_count === 0)
    .map((g) => ({ ref: g.ref, name: typeof g.name === 'string' ? g.name : '' }));

  const hasActions = missing_group.length + loose_workspace.length + empty_group.length > 0;

  sidebarDoctorScan(/** @type {any} */ (d.logger), {
    mode: 'dry-run',
    missing: missing_group.length,
    loose: loose_workspace.length,
    empty: empty_group.length,
  });

  return {
    missing_group,
    loose_workspace,
    empty_group,
    protected: { sessions: protectedSessions },
    hasActions,
  };
}

// ── execute() ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ created: number, added: number, ungrouped: number, errors: Array<{ category: string, target: string, reason: string }> }} SidebarResult
 */

/** @returns {SidebarResult} */
function emptyResult() {
  return { created: 0, added: 0, ungrouped: 0, errors: [] };
}

/** @param {unknown} err @returns {string} */
function errMsg(err) {
  return String(/** @type {any} */ (err)?.message || err);
}

/** Registra un fallo en result.errors y emite sidebarDoctorFixError (fail-open jamás silencioso). */
function pushError(result, log, category, target, reason) {
  result.errors.push({ category, target, reason });
  if (log) sidebarDoctorFixError(log, { category, reason, target });
}

/**
 * Sanea el sidebar emitiendo EXCLUSIVAMENTE el allowlist NO-destructivo
 * (create/add/set-anchor/ungroup) en orden D-09. RE-detecta llamando `scan(deps)`
 * FRESCO (D-06 TOCTOU — NO consume un report externo: un grupo pudo crearse o
 * disolverse entre el scan del dry-run y este pase). Cada acción va en su
 * try/catch → pushError + continúa (fail-open per item); never-throws top-level.
 *
 * Con `opts.fix` falsy es un no-op (el dry-run usa `scan()` para renderizar).
 *
 * @param {SidebarDeps} [deps]
 * @param {{ fix?: boolean }} [opts]
 * @returns {Promise<SidebarResult>}
 */
export async function execute(deps = {}, opts = {}) {
  const result = emptyResult();
  if (!opts.fix) return result; // dry-run path: el CLI usa scan() para mostrar.

  const d = resolveDeps(deps);
  const log = /** @type {any} */ (d.logger);

  try {
    // RE-detección fresca (D-06). scan es never-throws → no puede tumbar execute.
    const report = await scan(deps);

    // ── missing_group: create --from <oldest> → add(resto) → set-anchor <oldest> (D-09) ──
    for (const g of report.missing_group) {
      try {
        // Pitfall 1: --from SIEMPRE explícito con el oldest (nunca omitido; el
        // default contextual de cmux agarraría el workspace del caller).
        await d.createWorkspaceGroup({ name: g.name, from: [g.anchor] });
        // Pitfall 2 / OQ1: el ref del grupo nuevo se obtiene por RE-LIST, no
        // parseando el stdout de create.
        let ref = null;
        try {
          ref = resolveWorkspaceGroup(JSON.parse(await d.listWorkspaceGroupsRaw()), g.name);
        } catch {
          ref = null;
        }
        if (!ref) {
          pushError(result, log, 'missing_group', g.name, 'ref no resuelto tras create');
          continue;
        }
        for (const ws of g.members) {
          if (ws === g.anchor) continue; // el anchor ya entró vía --from
          try {
            await d.addToWorkspaceGroup({ group: ref, workspace: ws });
            result.added++;
          } catch (e) {
            pushError(result, log, 'add', ws, errMsg(e));
          }
        }
        try {
          await d.setGroupAnchor({ group: ref, workspace: g.anchor }); // D-08 idempotente
        } catch (e) {
          pushError(result, log, 'set-anchor', g.anchor, errMsg(e));
        }
        result.created++;
      } catch (e) {
        pushError(result, log, 'create', g.name, errMsg(e));
      }
    }

    // ── loose_workspace: add al grupo existente (SDR-05) ──
    for (const l of report.loose_workspace) {
      try {
        await d.addToWorkspaceGroup({ group: l.group, workspace: l.workspace_ref });
        result.added++;
      } catch (e) {
        pushError(result, log, 'add', l.workspace_ref, errMsg(e));
      }
    }

    // ── empty_group: ungroup (no-destructivo, D-05) ──
    for (const eg of report.empty_group) {
      try {
        await d.ungroupWorkspaceGroup({ group: eg.ref });
        result.ungrouped++;
      } catch (e) {
        pushError(result, log, 'ungroup', eg.ref, errMsg(e));
      }
    }

    sidebarDoctorFix(log, { created: result.created, added: result.added, ungrouped: result.ungrouped });
  } catch (err) {
    // never-throws top-level: retorna result parcial + error registrado.
    pushError(result, log, 'execute', 'top-level', errMsg(err));
  }

  return result;
}
