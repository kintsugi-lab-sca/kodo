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
//                clasifica en missing_group / session_anchor / loose_workspace /
//                empty_group.
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
  setWorkspaceGroupAnchor,
  ungroupWorkspaceGroup,
  newWorkspace,
} from './client.js';
// LOG-12: noopLogger es el stub zero-import whitelisted — NUNCA logger.js.
import { noopLogger } from '../logger-noop.js';
import { sidebarDoctorScan, sidebarDoctorFix, sidebarDoctorFixError } from '../logger-events.js';

/**
 * @typedef {import('../session/state.js').Session} Session
 *
 * @typedef {{ name: string, cwd: string, members: string[] }} MissingGroupItem
 * @typedef {{ group: string, name: string, anchor: string, cwd: string }} SessionAnchorItem
 * @typedef {{ group: string, workspace_ref: string, name: string }} LooseWorkspaceItem
 * @typedef {{ ref: string, name: string }} EmptyGroupItem
 * @typedef {{ ref: string, group: string, name: string }} ProtectedItem
 *
 * @typedef {{
 *   missing_group: MissingGroupItem[],
 *   session_anchor: SessionAnchorItem[],
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
 *   createWorkspaceGroup?: (opts: { name?: string, cwd?: string }) => Promise<string>,
 *   addToWorkspaceGroup?: (opts: { group: string, workspace: string }) => Promise<string>,
 *   setWorkspaceGroupAnchor?: (opts: { group: string, workspace: string }) => Promise<string>,
 *   newWorkspace?: (opts: { name: string, cwd?: string, group?: string }) => Promise<string>,
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
    // KODO-106: el par que crea el ancla estable de reemplazo y la convierte en ancla.
    setWorkspaceGroupAnchor: deps.setWorkspaceGroupAnchor || setWorkspaceGroupAnchor,
    newWorkspace: deps.newWorkspace || newWorkspace,
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

/**
 * Refs `workspace:N` de las sesiones kodo de state.json (todas salvo las `alive:
 * false`). Es el conjunto que NUNCA puede ser ancla de un grupo (KODO-106).
 * @param {any} state
 * @returns {Set<string>}
 */
function sessionRefsOf(state) {
  const refs = new Set();
  for (const s of Object.values(state?.sessions || {})) {
    if (s && s.alive !== false && typeof s.workspace_ref === 'string') refs.add(s.workspace_ref);
  }
  return refs;
}

/** `sessionRefsOf` sobre `d.loadState()`, fail-open: un state ilegible → conjunto vacío. */
function loadSessionRefs(d) {
  try {
    return sessionRefsOf(d.loadState());
  } catch {
    return new Set();
  }
}

/**
 * Mueve el ancla de `group` a un workspace ESTABLE del repo (KODO-106): lo crea DENTRO
 * del grupo (`new-workspace --name <name> --cwd <cwd> --group <group>`) y lo ancla.
 * Nace ya como miembro porque `set-anchor` sobre un no-miembro responde `not_found`.
 * El ancla anterior (la sesión) sigue en el grupo como miembro normal.
 * @returns {Promise<string>} ref del ancla nueva
 */
async function reanchorOnStableWorkspace(d, { group, name, cwd }) {
  const stable = await d.newWorkspace({ name, cwd, group });
  if (!/^workspace:\d+$/.test(String(stable))) throw new Error(`new_workspace_sin_ref: ${String(stable).slice(0, 60)}`);
  await d.setWorkspaceGroupAnchor({ group, workspace: stable });
  return stable;
}

/**
 * Crea el grupo de proyecto `name` con ancla PROPIA y estable, y mete las sesiones como
 * miembros (KODO-106). Pasos:
 *   1. `create --name <name> --cwd <cwd>` (sin `--from`): cmux levanta el ancla.
 *   2. re-list para resolver el ref del grupo nuevo (OQ1: no se parsea el stdout).
 *   3. `add` de cada miembro que no esté ya dentro.
 *   4. guard post-creación: si el ancla resultó ser una sesión (un cmux futuro que
 *      adopte un workspace existente, o la semántica de `--from` reapareciendo), se
 *      reancla en un workspace estable — mismo remedio que `session_anchor`.
 * Lanza ante cualquier fallo; el caller decide (fail-open per item / skipped).
 * @param {ReturnType<typeof resolveDeps>} d
 * @param {{ name: string, cwd: string, members: string[], sessionRefs: Set<string> }} target
 * @returns {Promise<{ group: string, added: number, reanchored: boolean }>}
 */
async function createProjectGroup(d, { name, cwd, members, sessionRefs }) {
  await d.createWorkspaceGroup({ name, cwd });
  const groupsJson = JSON.parse(await d.listWorkspaceGroupsRaw());
  const group = resolveWorkspaceGroup(groupsJson, name);
  if (!group) throw new Error('grupo_no_encontrado_tras_create');
  const created = (groupsJson.groups || []).find((g) => g?.ref === group) || {};
  const inside = new Set(Array.isArray(created.member_workspace_refs) ? created.member_workspace_refs : []);

  let added = 0;
  for (const ws of members) {
    if (inside.has(ws)) continue;
    await d.addToWorkspaceGroup({ group, workspace: ws });
    added++;
  }

  let reanchored = false;
  if (sessionRefs.has(created.anchor_workspace_ref)) {
    await reanchorOnStableWorkspace(d, { group, name, cwd });
    reanchored = true;
  }
  return { group, added, reanchored };
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
      // grupo faltante O disuelto (D-07): mismo remedio — `create --name --cwd` (ancla
      // estable propia) + `add` de cada sesión (KODO-106). El orden oldest-first NO elige
      // ancla (ninguna sesión lo es nunca): solo hace el argv determinista y el report
      // idempotente. El cwd del ancla es el `project_path` resuelto vía projects.json en
      // el launch (todas las sesiones de un mismo grupo esperado lo comparten).
      const ordered = sortByOldest(sessions);
      missing_group.push({
        name: expected,
        cwd: ordered[0].project_path,
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

  // grupos anclados en una SESIÓN (KODO-106): la fila del grupo ES la sesión, la tarea
  // aparece en la raíz del grupo y su cierre arrastra al grupo. Regla del operador: las
  // sesiones nunca son ancla. Se mira TODO grupo (no solo los esperados) y el cwd del
  // ancla estable sale de la propia sesión-ancla.
  /** @type {Map<string, Session>} */
  const sessionByRef = new Map();
  for (const s of Object.values(state.sessions || {})) {
    if (s && s.alive !== false && typeof s.workspace_ref === 'string') sessionByRef.set(s.workspace_ref, s);
  }
  /** @type {SessionAnchorItem[]} */
  const session_anchor = [];
  for (const g of groupsJson.groups || []) {
    if (!g || typeof g.ref !== 'string' || !/^workspace_group:\d+$/.test(g.ref) || typeof g.name !== 'string') continue;
    const s = sessionByRef.get(g.anchor_workspace_ref);
    if (!s || typeof s.project_path !== 'string' || !s.project_path) continue;
    session_anchor.push({ group: g.ref, name: g.name, anchor: g.anchor_workspace_ref, cwd: s.project_path });
  }

  // grupos vacíos (D-05) — defensivo; cmux disuelve al cerrar el anchor, así que
  // un grupo con member_count 0 es un estado transitorio raro (Pitfall 5).
  // WR-01: excluir los grupos que también son destino de un `add` en este mismo
  // report (aparecen en loose_workspace). De lo contrario `execute` haría
  // `add` + `ungroup` contradictorios sobre el MISMO grupo, sin converger.
  const looseGroupRefs = new Set(loose_workspace.map((l) => l.group));
  /** @type {EmptyGroupItem[]} */
  const empty_group = (groupsJson.groups || [])
    .filter((g) => g && typeof g.ref === 'string'
      && g.member_count === 0
      && !looseGroupRefs.has(g.ref))
    .map((g) => ({ ref: g.ref, name: typeof g.name === 'string' ? g.name : '' }));

  // hasActions cuenta las 4 categorías: TODAS son ejecutables. Un 2º pase --fix sobre un
  // sidebar ya convergido da exit 0, así que el piggyback de Phase 80 no entra en bucle
  // (tras reanclar, el ancla es un workspace estable y session_anchor queda vacío).
  const hasActions = missing_group.length + session_anchor.length
    + loose_workspace.length + empty_group.length > 0;

  sidebarDoctorScan(/** @type {any} */ (d.logger), {
    mode: 'dry-run',
    missing: missing_group.length,
    session_anchor: session_anchor.length,
    loose: loose_workspace.length,
    empty: empty_group.length,
  });

  return {
    missing_group,
    session_anchor,
    loose_workspace,
    empty_group,
    protected: { sessions: protectedSessions },
    hasActions,
  };
}

// ── execute() ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ created: number, added: number, reanchored: number, ungrouped: number, errors: Array<{ category: string, target: string, reason: string }> }} SidebarResult
 */

/** @returns {SidebarResult} */
function emptyResult() {
  return { created: 0, added: 0, reanchored: 0, ungrouped: 0, errors: [] };
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
 * (create/set-anchor sobre ancla estable/add/ungroup) en orden D-09. RE-detecta llamando `scan(deps)`
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

    const sessionRefs = loadSessionRefs(d);

    // ── missing_group: `create --name <expected> --cwd <repo>` + `add` (KODO-106) ──
    //    G-79-1: lo que roba la fila sidebar de una sesión es que sea el ANCLA. KODO-14
    //    confiaba en `create --from <sesiones>` porque en cmux 0.64.20 levantaba un shell
    //    NUEVO como ancla; en cmux 0.65.2 (verificado en vivo 2026-10-26) `--from`
    //    REUTILIZA el primer ref como ancla → la sesión quedaba de header del grupo. Por
    //    eso el ancla nace sin `--from` (workspace estable del repo) y las sesiones entran
    //    con `add`; el guard post-creación de createProjectGroup cubre lo que quede.
    for (const m of report.missing_group) {
      try {
        const r = await createProjectGroup(d, { name: m.name, cwd: m.cwd, members: m.members, sessionRefs });
        result.created++;
        result.added += r.added;
        if (r.reanchored) result.reanchored++;
      } catch (e) {
        pushError(result, log, 'create', m.name, errMsg(e));
      }
    }

    // ── session_anchor: reanclar en un workspace estable del repo (KODO-106) ──
    for (const a of report.session_anchor) {
      try {
        await reanchorOnStableWorkspace(d, { group: a.group, name: a.name, cwd: a.cwd });
        result.reanchored++;
      } catch (e) {
        pushError(result, log, 'set-anchor', a.group, errMsg(e));
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

    sidebarDoctorFix(log, {
      created: result.created, added: result.added, reanchored: result.reanchored, ungrouped: result.ungrouped,
    });
  } catch (err) {
    // never-throws top-level: retorna result parcial + error registrado.
    pushError(result, log, 'execute', 'top-level', errMsg(err));
  }

  return result;
}

// ── convergeProject() ────────────────────────────────────────────────────────

/**
 * @typedef {{ action: 'created' | 'added' | 'none' | 'skipped', group: string | null, reanchored?: boolean, reason?: string }} ConvergeResult
 */

/**
 * Converge UN solo workspace recién creado a su grupo de proyecto (KODO-54).
 *
 * Es la unidad de-un-workspace del par `create`/`add` que `execute()` emite en lote:
 * misma re-detección FRESCA (D-06 TOCTOU — nunca consume un report externo), mismo
 * allowlist NO-destructivo (`create` / `add`, jamás delete/remove/rename) y el
 * mismo fail-open never-throws. Lo que NO comparte con `execute()` es la fuente de
 * verdad: aquí el workspace lo acaba de crear el launch y todavía NO está en
 * `state.json`, así que el input llega por parámetro en vez de por `scan()`.
 *
 * Existe porque el carril de CREACIÓN de grupos vivía SOLO en el pase del doctor que
 * `kodo check` corre antes de `launchOrchestrator` (check.js): con un orquestador ya
 * vivo ese pase no se ejecuta, así que el primer proyecto nuevo de la sesión se quedaba
 * suelto en el sidebar hasta el siguiente arranque en frío.
 *
 * Decisión (idéntica a la que `scan()` toma para las 3 categorías):
 *   - grupo `name` NO existe                        → `create --name <name> --cwd <cwd>`
 *                                                     + `add <ws>` + guard de ancla (KODO-106)
 *   - existe y `ws` ya está en member_workspace_refs → no-op (`none`)
 *   - existe y `ws` está suelto                     → `add --group <ref> --workspace <ws>`
 *
 * never-throws: CUALQUIER fallo (cmux caído, JSON ilegible, verbo ausente en el host)
 * devuelve `action: 'skipped'` con el motivo acotado. El caller decide el log; jamás se
 * aborta el lanzamiento por la sidebar.
 *
 * @param {{ name: string, workspaceRef: string, cwd: string }} target - `cwd` = path del
 *   proyecto resuelto vía projects.json (el mismo `projectPath` del `new-workspace`): es
 *   el cwd del ancla estable del grupo.
 * @param {SidebarDeps} [deps] - en el launch se inyectan los verbos de `host._legacy`
 *   (cmux confinado a `src/host/`); sin deps caen los defaults lazy de `client.js`.
 * @returns {Promise<ConvergeResult>}
 */
export async function convergeProject({ name, workspaceRef, cwd } = {}, deps = {}) {
  if (!name || !workspaceRef || !cwd) {
    return { action: 'skipped', group: null, reason: 'target_incompleto' };
  }
  const d = resolveDeps(deps);
  const log = /** @type {any} */ (d.logger);
  try {
    // Re-detección FRESCA: entre el `workspace-group list` del launch y este punto pudo
    // crearse el grupo (otro lanzamiento concurrente del mismo proyecto). La rama `add`
    // de abajo es lo que hace la convergencia idempotente en esa carrera.
    const groupsJson = JSON.parse(await d.listWorkspaceGroupsRaw());
    const groupRef = resolveWorkspaceGroup(groupsJson, name);

    if (!groupRef) {
      // Ancla PROPIA y estable del repo, nunca la sesión recién lanzada (KODO-106): en
      // cmux 0.65.2 `create --from <ws>` adopta `<ws>` como ancla. El workspace recién
      // creado todavía no está en state.json, así que se suma a mano al conjunto vetado.
      const sessionRefs = loadSessionRefs(d);
      sessionRefs.add(workspaceRef);
      const r = await createProjectGroup(d, { name, cwd, members: [workspaceRef], sessionRefs });
      sidebarDoctorFix(log, { created: 1, added: r.added, reanchored: r.reanchored ? 1 : 0, ungrouped: 0 });
      return { action: 'created', group: r.group, reanchored: r.reanchored };
    }

    const memberOf = buildMemberIndex(groupsJson);
    if ((memberOf.get(workspaceRef) || []).includes(groupRef)) {
      return { action: 'none', group: groupRef }; // ya dentro → cero comandos mutadores
    }

    await d.addToWorkspaceGroup({ group: groupRef, workspace: workspaceRef });
    sidebarDoctorFix(log, { created: 0, added: 1, reanchored: 0, ungrouped: 0 });
    return { action: 'added', group: groupRef };
  } catch (err) {
    const reason = errMsg(err);
    sidebarDoctorFixError(log, { category: 'converge', reason, target: workspaceRef });
    return { action: 'skipped', group: null, reason };
  }
}
