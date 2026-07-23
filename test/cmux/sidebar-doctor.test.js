// test/cmux/sidebar-doctor.test.js
// Phase 79 Plan 02 — unit puro de scan()/execute() + taskLikeFrom del sidebar doctor.
//
// scan es la mitad PURA (never-throws, DI, defaults lazy) espejo de src/gsd/doctor.js:
// compara las sesiones kodo vivas de state.json contra el sidebar real
// (workspace-group list --json + workspace list --json) y clasifica en
// missing_group / loose_workspace / empty_group. execute re-detecta (TOCTOU) y
// emite el allowlist no-destructivo en orden D-09, fail-open per item.
//
// Todos los inputs se inyectan por DI (loadState/loadProjects/listWorkspaceGroupsRaw/
// listWorkspacesRaw + los 4 verbos del allowlist) — cero cmux real, cero FS.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scan, execute, taskLikeFrom } from '../../src/cmux/sidebar-doctor.js';

const MODULE_PATH = fileURLToPath(new URL('../../src/cmux/sidebar-doctor.js', import.meta.url));

/** Construye unos deps de solo-lectura desde fixtures planos (JSON crudo para las raws). */
function readDeps({ state, projects, groups, workspaces } = {}) {
  return {
    loadState: () => state ?? { schema_version: 3, sessions: {} },
    loadProjects: () => projects ?? {},
    listWorkspaceGroupsRaw: () => JSON.stringify(groups ?? { groups: [] }),
    listWorkspacesRaw: () => JSON.stringify(workspaces ?? { workspaces: [] }),
    now: () => 0,
  };
}

/** Sesión kodo mínima. */
function session(over = {}) {
  return {
    workspace_ref: 'workspace:1',
    session_id: 's1',
    task_id: 't1',
    task_ref: 'KODO-9',
    provider: 'plane',
    project_id: 'P1',
    project_path: '/repo/kodo',
    started_at: '2026-07-23T08:00:00Z',
    alive: true,
    ...over,
  };
}

describe('sidebar-doctor scan()', () => {
  test('D-08: 2 sesiones vivas mismo expectedName sin grupo → 1 missing_group, members por started_at asc, anchor = oldest', async () => {
    const sA = session({ session_id: 'a', workspace_ref: 'workspace:4', started_at: '2026-07-23T08:00:00Z' });
    const sB = session({ session_id: 'b', workspace_ref: 'workspace:3', started_at: '2026-07-23T07:00:00Z' });
    const report = await scan(readDeps({
      state: { sessions: { a: sA, b: sB } },
      projects: { P1: '/repo/kodo' },
      workspaces: { workspaces: [{ ref: 'workspace:3' }, { ref: 'workspace:4' }] },
    }));
    assert.equal(report.missing_group.length, 1);
    const g = report.missing_group[0];
    assert.equal(g.name, 'KODO');
    assert.deepEqual(g.members, ['workspace:3', 'workspace:4']); // oldest primero
    assert.equal(g.anchor, 'workspace:3');
    assert.equal(g.anchor, g.members[0]);
    assert.equal(report.hasActions, true);
  });

  test('SDR-05: sesión cuyo workspace_ref ∉ member_workspace_refs del grupo existente → loose_workspace', async () => {
    const sIn = session({ session_id: 'in', workspace_ref: 'workspace:3' });   // ya miembro
    const sOut = session({ session_id: 'out', workspace_ref: 'workspace:4' });  // suelto
    const report = await scan(readDeps({
      state: { sessions: { in: sIn, out: sOut } },
      projects: { P1: '/repo/kodo' },
      groups: { groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:3'] }] },
      workspaces: { workspaces: [{ ref: 'workspace:3' }, { ref: 'workspace:4' }] },
    }));
    assert.equal(report.missing_group.length, 0);
    assert.equal(report.loose_workspace.length, 1);
    assert.deepEqual(report.loose_workspace[0], { group: 'workspace_group:1', workspace_ref: 'workspace:4', name: 'KODO' });
    assert.equal(report.hasActions, true);
  });

  test('D-06: loadState throws → fallback, 3 categorías vacías, hasActions=false (never-throws)', async () => {
    const deps = readDeps({});
    deps.loadState = () => { throw new Error('state ilegible'); };
    const report = await scan(deps);
    assert.deepEqual(report.missing_group, []);
    assert.deepEqual(report.loose_workspace, []);
    assert.deepEqual(report.empty_group, []);
    assert.equal(report.hasActions, false);
  });

  test('D-06: listWorkspaceGroupsRaw devuelve JSON malformado → groups=[] → no crash, categorías coherentes', async () => {
    const deps = readDeps({
      state: { sessions: { a: session({ workspace_ref: 'workspace:3' }) } },
      projects: { P1: '/repo/kodo' },
      workspaces: { workspaces: [{ ref: 'workspace:3' }] },
    });
    deps.listWorkspaceGroupsRaw = () => 'no-es-json{';
    const report = await scan(deps);
    // sin grupos parseables → la sesión viva cae en missing_group (no crash)
    assert.equal(report.missing_group.length, 1);
    assert.equal(report.missing_group[0].name, 'KODO');
  });

  test('D-04: sesión alive===false o workspace_ref no vivo → excluida', async () => {
    const dead = session({ session_id: 'dead', workspace_ref: 'workspace:3', alive: false });
    const ghost = session({ session_id: 'ghost', workspace_ref: 'workspace:99' }); // no en workspace list
    const report = await scan(readDeps({
      state: { sessions: { dead, ghost } },
      projects: { P1: '/repo/kodo' },
      workspaces: { workspaces: [{ ref: 'workspace:3' }] },
    }));
    assert.equal(report.missing_group.length, 0);
    assert.equal(report.loose_workspace.length, 0);
    assert.equal(report.hasActions, false);
  });

  test('D-05: grupo con member_count===0 → empty_group (defensivo)', async () => {
    const report = await scan(readDeps({
      groups: { groups: [{ name: 'Vacio', ref: 'workspace_group:9', member_count: 0, member_workspace_refs: [] }] },
    }));
    assert.equal(report.empty_group.length, 1);
    assert.deepEqual(report.empty_group[0], { ref: 'workspace_group:9', name: 'Vacio' });
    assert.equal(report.hasActions, true);
  });

  test('D-02: reverse-lookup módulo → path == default → identifier a secas; path == módulo → "IDENTIFIER/Módulo"', async () => {
    const projects = { P1: { default: '/repo/roman', modules: { FVF: '/repo/roman-fvf' } } };
    // path == default → grupo esperado "ROMAN"
    const rDefault = await scan(readDeps({
      state: { sessions: { a: session({ task_ref: 'ROMAN-3', project_path: '/repo/roman', workspace_ref: 'workspace:3' }) } },
      projects,
      workspaces: { workspaces: [{ ref: 'workspace:3' }] },
    }));
    assert.equal(rDefault.missing_group[0].name, 'ROMAN');
    // path == módulo FVF → grupo esperado "ROMAN/FVF"
    const rModule = await scan(readDeps({
      state: { sessions: { a: session({ task_ref: 'ROMAN-3', project_path: '/repo/roman-fvf', workspace_ref: 'workspace:3' }) } },
      projects,
      workspaces: { workspaces: [{ ref: 'workspace:3' }] },
    }));
    assert.equal(rModule.missing_group[0].name, 'ROMAN/FVF');
  });

  test('empty deps stubs (cmux ausente) → fail-open, hasActions=false, no throw', async () => {
    const deps = {
      loadState: () => ({ sessions: {} }),
      loadProjects: () => ({}),
      listWorkspaceGroupsRaw: () => { throw new Error('cmux ausente'); },
      listWorkspacesRaw: () => { throw new Error('cmux ausente'); },
    };
    const report = await scan(deps);
    assert.equal(report.hasActions, false);
    assert.deepEqual(report.missing_group, []);
  });

  test('SDR-01 idempotency: scan dos veces sobre el mismo fixture → deepEqual', async () => {
    const mk = () => readDeps({
      state: { sessions: { a: session({ workspace_ref: 'workspace:3' }) } },
      projects: { P1: '/repo/kodo' },
      workspaces: { workspaces: [{ ref: 'workspace:3' }] },
    });
    const r1 = await scan(mk());
    const r2 = await scan(mk());
    assert.deepEqual(r1, r2);
  });
});

/** Deps mutantes con spy de argv sobre los 4 verbos del allowlist. */
function spyDeps({ state, projects, groupsState, workspaces, throwOn } = {}) {
  const calls = [];
  const errors = [];
  const deps = {
    loadState: () => state ?? { sessions: {} },
    loadProjects: () => projects ?? {},
    listWorkspaceGroupsRaw: () => JSON.stringify(typeof groupsState === 'function' ? groupsState() : (groupsState ?? { groups: [] })),
    listWorkspacesRaw: () => JSON.stringify(workspaces ?? { workspaces: [] }),
    createWorkspaceGroup: async (o) => { calls.push(['create', o]); if (throwOn === 'create') throw new Error('cmux rejected create'); return 'OK'; },
    addToWorkspaceGroup: async (o) => { calls.push(['add', o]); if (throwOn === 'add') throw new Error('cmux rejected add'); return 'OK'; },
    setGroupAnchor: async (o) => { calls.push(['set-anchor', o]); if (throwOn === 'set-anchor') throw new Error('cmux rejected set-anchor'); return 'OK'; },
    ungroupWorkspaceGroup: async (o) => { calls.push(['ungroup', o]); if (throwOn === 'ungroup') throw new Error('cmux rejected ungroup'); return 'OK'; },
    logger: { info() {}, warn() {}, error: (_ev, f) => errors.push(f) },
  };
  return { deps, calls, errors };
}

const DESTRUCTIVE = new Set(['delete', 'remove', 'rename']);

describe('sidebar-doctor execute()', () => {
  test('fix:false → emptyResult, ningún verbo del allowlist invocado (spy vacío)', async () => {
    const { deps, calls } = spyDeps({
      state: { sessions: { a: session({ workspace_ref: 'workspace:3' }) } },
      projects: { P1: '/repo/kodo' },
      workspaces: { workspaces: [{ ref: 'workspace:3' }] },
    });
    const result = await execute(deps, { fix: false });
    assert.deepEqual(result, { created: 0, added: 0, ungrouped: 0, errors: [] });
    assert.equal(calls.length, 0);
  });

  test('D-09: missing_group (2 members) → create(--from=oldest) → add(segundo) → set-anchor(oldest); ningún verbo destructivo', async () => {
    let created = false;
    const sA = session({ session_id: 'a', workspace_ref: 'workspace:4', started_at: '2026-07-23T08:00:00Z' });
    const sB = session({ session_id: 'b', workspace_ref: 'workspace:3', started_at: '2026-07-23T07:00:00Z' });
    const { deps, calls } = spyDeps({
      state: { sessions: { a: sA, b: sB } },
      projects: { P1: '/repo/kodo' },
      // stateful: tras create, la re-list ve el grupo nuevo (OQ1 / TOCTOU real)
      groupsState: () => created
        ? { groups: [{ name: 'KODO', ref: 'workspace_group:7', member_count: 1, member_workspace_refs: ['workspace:3'] }] }
        : { groups: [] },
      workspaces: { workspaces: [{ ref: 'workspace:3' }, { ref: 'workspace:4' }] },
    });
    deps.createWorkspaceGroup = async (o) => { calls.push(['create', o]); created = true; return 'OK'; };

    const result = await execute(deps, { fix: true });

    const verbs = calls.map((c) => c[0]);
    assert.deepEqual(verbs, ['create', 'add', 'set-anchor']); // orden D-09
    assert.deepEqual(calls[0][1], { name: 'KODO', from: ['workspace:3'] }); // --from = oldest
    assert.deepEqual(calls[1][1], { group: 'workspace_group:7', workspace: 'workspace:4' }); // add del segundo, ref re-listado
    assert.deepEqual(calls[2][1], { group: 'workspace_group:7', workspace: 'workspace:3' }); // set-anchor al oldest
    for (const [verb] of calls) assert.ok(!DESTRUCTIVE.has(verb), `verbo destructivo emitido: ${verb}`);
    assert.equal(result.created, 1);
    assert.equal(result.added, 1);
  });

  test('SDR-02 TOCTOU: el grupo ya existe entre scan externo e interno → 0 creaciones (re-detecta)', async () => {
    const sA = session({ session_id: 'a', workspace_ref: 'workspace:3' });
    const sB = session({ session_id: 'b', workspace_ref: 'workspace:4' });
    const { deps, calls } = spyDeps({
      state: { sessions: { a: sA, b: sB } },
      projects: { P1: '/repo/kodo' },
      // el grupo YA existe con ambos miembros → nada que hacer
      groupsState: { groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_count: 2, member_workspace_refs: ['workspace:3', 'workspace:4'] }] },
      workspaces: { workspaces: [{ ref: 'workspace:3' }, { ref: 'workspace:4' }] },
    });
    const result = await execute(deps, { fix: true });
    assert.equal(calls.length, 0);
    assert.deepEqual(result, { created: 0, added: 0, ungrouped: 0, errors: [] });
  });

  test('fail-open per item: un add que rechaza no aborta el pase (ungroup del empty sí corre) + emite fix.error', async () => {
    const { deps, calls, errors } = spyDeps({
      state: { sessions: { a: session({ workspace_ref: 'workspace:4' }) } },
      projects: { P1: '/repo/kodo' },
      groupsState: {
        groups: [
          { name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:3'] },
          { name: 'Vacio', ref: 'workspace_group:9', member_count: 0, member_workspace_refs: [] },
        ],
      },
      workspaces: { workspaces: [{ ref: 'workspace:3' }, { ref: 'workspace:4' }] },
      throwOn: 'add',
    });
    const result = await execute(deps, { fix: true });
    const verbs = calls.map((c) => c[0]);
    assert.ok(verbs.includes('add'), 'intentó el add suelto');
    assert.ok(verbs.includes('ungroup'), 'el ungroup del empty siguió pese al fallo del add');
    assert.equal(result.ungrouped, 1);
    assert.equal(result.errors.length, 1);
    assert.ok(errors.length >= 1, 'emitió sidebarDoctorFixError');
  });

  test('loose_workspace → add(group,workspace); empty_group → ungroup(ref)', async () => {
    const { deps, calls } = spyDeps({
      state: { sessions: { a: session({ workspace_ref: 'workspace:4' }) } },
      projects: { P1: '/repo/kodo' },
      groupsState: {
        groups: [
          { name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:3'] },
          { name: 'Vacio', ref: 'workspace_group:9', member_count: 0, member_workspace_refs: [] },
        ],
      },
      workspaces: { workspaces: [{ ref: 'workspace:3' }, { ref: 'workspace:4' }] },
    });
    const result = await execute(deps, { fix: true });
    assert.deepEqual(calls.find((c) => c[0] === 'add')[1], { group: 'workspace_group:1', workspace: 'workspace:4' });
    assert.deepEqual(calls.find((c) => c[0] === 'ungroup')[1], { group: 'workspace_group:9' });
    assert.equal(result.added, 1);
    assert.equal(result.ungrouped, 1);
  });

  test('never-throws top-level: loadState throws bajo fix → result parcial, no lanza', async () => {
    const { deps } = spyDeps({ projects: { P1: '/repo/kodo' } });
    deps.loadState = () => { throw new Error('state ilegible'); };
    const result = await execute(deps, { fix: true });
    // scan es never-throws (fallback sessions:{}) → 0 acciones, sin throw
    assert.deepEqual(result, { created: 0, added: 0, ungrouped: 0, errors: [] });
  });
});

describe('sidebar-doctor taskLikeFrom()', () => {
  test('entry flat string → groups vacío', () => {
    const t = taskLikeFrom(session({ project_path: '/repo/kodo' }), { P1: '/repo/kodo' });
    assert.deepEqual(t, { ref: 'KODO-9', groups: [] });
  });

  test('entry objeto, path == default → groups vacío', () => {
    const projects = { P1: { default: '/d', modules: { FVF: '/f' } } };
    const t = taskLikeFrom(session({ project_path: '/d' }), projects);
    assert.deepEqual(t.groups, []);
  });

  test('entry objeto, path == módulo → groups = [name] (first-match estable)', () => {
    const projects = { P1: { default: '/d', modules: { FVF: '/f', OTRO: '/f' } } };
    const t = taskLikeFrom(session({ project_path: '/f' }), projects);
    assert.deepEqual(t.groups, ['FVF']); // primer match por orden de entries
  });

  test('project_id sin entry → groups vacío, ref preservado', () => {
    const t = taskLikeFrom(session({ project_id: 'DESCONOCIDO', task_ref: 'X-1' }), {});
    assert.deepEqual(t, { ref: 'X-1', groups: [] });
  });
});

/** Strip line + block comments para asertar sobre el CÓDIGO, no la prosa (espejo hygiene-api-key). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('sidebar-doctor source hygiene (SDR-03)', () => {
  test('sidebar-doctor.js NO importa ningún cliente de provider ni logger.js', () => {
    const src = stripComments(readFileSync(MODULE_PATH, 'utf-8'));
    assert.ok(!/from\s+['"][^'"]*\/provider['"]/.test(src), 'no debe importar ../provider');
    assert.ok(!/from\s+['"][^'"]*\/plane['"]/.test(src), 'no debe importar ../plane');
    assert.ok(!/from\s+['"][^'"]*\/github['"]/.test(src), 'no debe importar ../github');
    assert.ok(!/from\s+['"][^'"]*\/logger\.js['"]/.test(src), 'no debe importar logger.js (LOG-12)');
  });

  test('sidebar-doctor.js NO usa ningún escritor de state (GRP-04)', () => {
    const src = stripComments(readFileSync(MODULE_PATH, 'utf-8'));
    assert.ok(!/\bsaveState\b/.test(src), 'no debe usar saveState');
    assert.ok(!/\bwithStateLock\b/.test(src), 'no debe usar withStateLock');
    assert.ok(!/\bupsertTaskHandoff\b/.test(src), 'no debe usar upsertTaskHandoff');
  });
});
