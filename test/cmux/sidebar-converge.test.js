// @ts-check
//
// test/cmux/sidebar-converge.test.js — KODO-54.
//
// `convergeProject` es la unidad de-un-workspace del par create/add que `execute()`
// emite en lote: la llama `launchWorkItem` justo después de crear el workspace cuando
// `resolveWorkspaceGroup` devolvió null, para que el PRIMER proyecto nuevo de una sesión
// con orquestador ya vivo no se quede suelto en el sidebar (el pase del doctor de
// `kodo check` solo corre en arranque frío).
//
// Mismo patrón que test/cmux/sidebar-doctor.test.js: TODO por DI (los 3 verbos que en
// producción llegan desde `host._legacy`), cero cmux real, cero FS, cero state.json —
// el workspace acaba de nacer y todavía no está en el state.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { convergeProject } from '../../src/cmux/sidebar-doctor.js';
import { fakeCmuxGroups } from '../helpers/fake-cmux-groups.js';

/** Host stub: registra cada verbo invocado y devuelve el sidebar que se le pase. */
function hostStub({ groups = [], listThrows = null, createThrows = null, addThrows = null } = {}) {
  const calls = { list: 0, create: [], add: [] };
  return {
    calls,
    deps: {
      // El guard de ancla (KODO-106) lee state.json: aquí vacío, cero FS.
      loadState: () => ({ sessions: {} }),
      listWorkspaceGroupsRaw: async () => {
        calls.list++;
        if (listThrows) throw new Error(listThrows);
        return JSON.stringify({ groups, window_ref: 'window:1' });
      },
      createWorkspaceGroup: async (o) => {
        calls.create.push(o);
        if (createThrows) throw new Error(createThrows);
        return 'workspace_group:9';
      },
      addToWorkspaceGroup: async (o) => {
        calls.add.push(o);
        if (addThrows) throw new Error(addThrows);
        return '';
      },
    },
  };
}

describe('convergeProject (KODO-54)', () => {
  test('KODO-106: proyecto SIN grupo → create --name <expected> --cwd <repo> (sin --from) + add <ws>', async () => {
    const cmux = fakeCmuxGroups({ workspaces: [{ ref: 'workspace:67', name: 'VAMP-1', cwd: '/repo/vamp' }] });
    const r = await convergeProject(
      { name: 'VAMP', workspaceRef: 'workspace:67', cwd: '/repo/vamp' },
      { ...cmux.deps, loadState: () => ({ sessions: {} }) },
    );

    assert.equal(r.action, 'created');
    assert.equal(r.reanchored, false);
    assert.deepEqual(cmux.calls.filter((c) => c[0] === 'create'), [['create', { name: 'VAMP', cwd: '/repo/vamp' }]]);
    assert.deepEqual(cmux.calls.find((c) => c[0] === 'add'), ['add', { group: r.group, workspace: 'workspace:67' }]);
  });

  test('grupo EXISTENTE con el workspace suelto → add, sin crear un grupo duplicado', async () => {
    const h = hostStub({
      groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:3'] }],
    });
    const r = await convergeProject({ name: 'KODO', workspaceRef: 'workspace:4', cwd: '/repo/kodo' }, h.deps);

    assert.equal(r.action, 'added');
    assert.equal(r.group, 'workspace_group:1');
    assert.deepEqual(h.calls.add, [{ group: 'workspace_group:1', workspace: 'workspace:4' }]);
    assert.deepEqual(h.calls.create, [], 'jamás debe crear un grupo cuando ya existe uno con ese nombre');
  });

  test('grupo EXISTENTE y el workspace ya es miembro → no-op, CERO comandos mutadores', async () => {
    const h = hostStub({
      groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:4'] }],
    });
    const r = await convergeProject({ name: 'KODO', workspaceRef: 'workspace:4', cwd: '/repo/kodo' }, h.deps);

    assert.equal(r.action, 'none');
    assert.equal(r.group, 'workspace_group:1');
    assert.deepEqual(h.calls.create, []);
    assert.deepEqual(h.calls.add, []);
  });

  test('TOCTOU: el grupo apareció entre el list del launch y la convergencia → add (idempotente), no create', async () => {
    // El launch resolvió groupRef=null; para cuando corre convergeProject, otro
    // lanzamiento del mismo proyecto ya creó el grupo. La re-detección FRESCA lo ve.
    const h = hostStub({
      groups: [{ name: 'VAMP', ref: 'workspace_group:7', member_count: 1, member_workspace_refs: ['workspace:66'] }],
    });
    const r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67', cwd: '/repo/vamp' }, h.deps);

    assert.equal(r.action, 'added');
    assert.deepEqual(h.calls.create, []);
  });

  test('fallo de cmux en el list → skipped con motivo, never-throws y cero mutadores (el launch sigue)', async () => {
    const h = hostStub({ listThrows: 'socket roto' });
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67', cwd: '/repo/vamp' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /socket roto/);
    assert.deepEqual(h.calls.create, []);
    assert.deepEqual(h.calls.add, []);
  });

  test('fallo de cmux en el create → skipped con motivo, never-throws (el launch sigue)', async () => {
    const h = hostStub({ groups: [], createThrows: 'exit 1' });
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67', cwd: '/repo/vamp' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /exit 1/);
  });

  test('fallo de cmux en el add → skipped con motivo, never-throws (el launch sigue)', async () => {
    const h = hostStub({
      groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_workspace_refs: ['workspace:3'] }],
      addThrows: 'grupo desaparecido',
    });
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'KODO', workspaceRef: 'workspace:4', cwd: '/repo/kodo' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /grupo desaparecido/);
  });

  test('JSON ilegible de cmux → skipped, never-throws y cero mutadores', async () => {
    const h = hostStub({});
    h.deps.listWorkspaceGroupsRaw = async () => 'not json at all';
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67', cwd: '/repo/vamp' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.deepEqual(h.calls.create, []);
  });

  test('target incompleto (expectedName null / ref vacío / sin cwd) → skipped SIN tocar cmux', async () => {
    const h = hostStub({ groups: [] });
    const sinNombre = await convergeProject({ name: null, workspaceRef: 'workspace:67', cwd: '/repo/vamp' }, h.deps);
    const sinWs = await convergeProject({ name: 'VAMP', workspaceRef: '' }, h.deps);
    // KODO-106: sin cwd no hay ancla estable del repo que crear.
    const sinCwd = await convergeProject(/** @type {any} */ ({ name: 'VAMP', workspaceRef: 'workspace:67' }), h.deps);
    const sinNada = await convergeProject(undefined, h.deps);

    for (const r of [sinNombre, sinWs, sinCwd, sinNada]) {
      assert.equal(r.action, 'skipped');
      assert.equal(r.reason, 'target_incompleto');
    }
    assert.equal(h.calls.list, 0, 'un target incompleto no debe gastar un execFile a cmux');
    assert.deepEqual(h.calls.create, []);
  });

  test('allowlist NO-destructivo: convergeProject jamás emite ungroup ni ningún verbo destructivo', async () => {
    let ungrouped = 0;
    const h = hostStub({ groups: [] });
    h.deps.ungroupWorkspaceGroup = async () => { ungrouped++; return ''; };
    await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67', cwd: '/repo/vamp' }, h.deps);
    assert.equal(ungrouped, 0, 'disolver grupos es del pase del doctor, nunca del launch');
  });
});

// ── KODO-106: el ancla del grupo nunca es una sesión, sea cual sea la versión de cmux ──
describe('convergeProject — ancla estable (KODO-106)', () => {
  const SESSION = 'workspace:67';
  const REPO = '/repo/vamp';

  /** El ancla final ≠ cualquier sesión; la sesión es miembro; el ancla es del repo. */
  function assertStableAnchor(cmux, sessionRefs) {
    const g = cmux.group('VAMP');
    assert.ok(g, 'el grupo existe');
    assert.ok(!sessionRefs.includes(g.anchor), `el ancla ${g.anchor} no puede ser una sesión`);
    for (const ref of sessionRefs) assert.ok(g.members.includes(ref), `${ref} debe ser miembro`);
    assert.deepEqual(cmux.workspace(g.anchor), { name: 'VAMP', cwd: REPO }, 'ancla = workspace estable del repo');
  }

  test('el fake reproduce la regresión: con cmux 0.65.2 el carril viejo (`create --from`) ancla en la sesión', async () => {
    const cmux = fakeCmuxGroups({ version: '0.65.2', workspaces: [{ ref: SESSION, cwd: REPO }] });
    await cmux.deps.createWorkspaceGroup({ name: 'VAMP', from: [SESSION] });
    assert.equal(cmux.group('VAMP').anchor, SESSION);
  });

  for (const version of /** @type {const} */ (['0.64.20', '0.65.2'])) {
    test(`cmux ${version}: grupo nuevo → ancla propia del repo y la sesión como miembro`, async () => {
      const cmux = fakeCmuxGroups({ version, workspaces: [{ ref: SESSION, name: 'VAMP-1', cwd: REPO }] });
      const r = await convergeProject(
        { name: 'VAMP', workspaceRef: SESSION, cwd: REPO },
        { ...cmux.deps, loadState: () => ({ sessions: {} }) },
      );
      assert.equal(r.action, 'created');
      assertStableAnchor(cmux, [SESSION]);
      assert.ok(!cmux.calls.some((c) => c[0] === 'set-anchor'), 'sin reanclaje: el ancla ya nació estable');
    });
  }

  test('guard post-creación: un cmux que adopta la sesión como ancla → se reancla en un workspace estable', async () => {
    const cmux = fakeCmuxGroups({ version: 'adopt-cwd', workspaces: [{ ref: SESSION, name: 'VAMP-1', cwd: REPO }] });
    const r = await convergeProject(
      { name: 'VAMP', workspaceRef: SESSION, cwd: REPO },
      { ...cmux.deps, loadState: () => ({ sessions: {} }) },
    );
    assert.equal(r.action, 'created');
    assert.equal(r.reanchored, true);
    assertStableAnchor(cmux, [SESSION]);
    // set-anchor exige miembro: el ancla nueva nace dentro del grupo con --group.
    const nw = cmux.calls.find((c) => c[0] === 'new-workspace');
    assert.deepEqual(nw, ['new-workspace', { name: 'VAMP', cwd: REPO, group: r.group }]);
  });

  test('guard post-creación: también veta las sesiones de state.json (no solo la recién lanzada)', async () => {
    const OTHER = 'workspace:66';
    const cmux = fakeCmuxGroups({
      version: 'adopt-cwd',
      workspaces: [{ ref: OTHER, name: 'VAMP-0', cwd: REPO }, { ref: SESSION, name: 'VAMP-1', cwd: REPO }],
    });
    const r = await convergeProject(
      { name: 'VAMP', workspaceRef: SESSION, cwd: REPO },
      { ...cmux.deps, loadState: () => ({ sessions: { s0: { workspace_ref: OTHER, alive: true } } }) },
    );
    assert.equal(r.reanchored, true);
    const g = cmux.group('VAMP');
    assert.ok(![OTHER, SESSION].includes(g.anchor), 'ninguna sesión es ancla');
  });

  test('guard: fallo del set-anchor → skipped never-throws (el launch sigue)', async () => {
    const cmux = fakeCmuxGroups({ version: 'adopt-cwd', workspaces: [{ ref: SESSION, cwd: REPO }] });
    cmux.deps.setWorkspaceGroupAnchor = async () => { throw new Error('not_found'); };
    let r;
    await assert.doesNotReject(async () => {
      r = await convergeProject({ name: 'VAMP', workspaceRef: SESSION, cwd: REPO }, { ...cmux.deps, loadState: () => ({ sessions: {} }) });
    });
    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /not_found/);
  });
});
