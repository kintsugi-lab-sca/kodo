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

/** Host stub: registra cada verbo invocado y devuelve el sidebar que se le pase. */
function hostStub({ groups = [], listThrows = null, createThrows = null, addThrows = null } = {}) {
  const calls = { list: 0, create: [], add: [] };
  return {
    calls,
    deps: {
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
  test('proyecto SIN grupo → create --name <expected> --from <ws recién creado>', async () => {
    const h = hostStub({ groups: [] });
    const r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67' }, h.deps);

    assert.equal(r.action, 'created');
    assert.deepEqual(h.calls.create, [{ name: 'VAMP', from: ['workspace:67'] }]);
    // `add` sobra: `--from` ya mete al workspace como miembro (mismo razonamiento que
    // el bucle missing_group de execute()).
    assert.deepEqual(h.calls.add, []);
  });

  test('grupo EXISTENTE con el workspace suelto → add, sin crear un grupo duplicado', async () => {
    const h = hostStub({
      groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:3'] }],
    });
    const r = await convergeProject({ name: 'KODO', workspaceRef: 'workspace:4' }, h.deps);

    assert.equal(r.action, 'added');
    assert.equal(r.group, 'workspace_group:1');
    assert.deepEqual(h.calls.add, [{ group: 'workspace_group:1', workspace: 'workspace:4' }]);
    assert.deepEqual(h.calls.create, [], 'jamás debe crear un grupo cuando ya existe uno con ese nombre');
  });

  test('grupo EXISTENTE y el workspace ya es miembro → no-op, CERO comandos mutadores', async () => {
    const h = hostStub({
      groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_count: 1, member_workspace_refs: ['workspace:4'] }],
    });
    const r = await convergeProject({ name: 'KODO', workspaceRef: 'workspace:4' }, h.deps);

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
    const r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67' }, h.deps);

    assert.equal(r.action, 'added');
    assert.deepEqual(h.calls.create, []);
  });

  test('fallo de cmux en el list → skipped con motivo, never-throws y cero mutadores (el launch sigue)', async () => {
    const h = hostStub({ listThrows: 'socket roto' });
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /socket roto/);
    assert.deepEqual(h.calls.create, []);
    assert.deepEqual(h.calls.add, []);
  });

  test('fallo de cmux en el create → skipped con motivo, never-throws (el launch sigue)', async () => {
    const h = hostStub({ groups: [], createThrows: 'exit 1' });
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /exit 1/);
  });

  test('fallo de cmux en el add → skipped con motivo, never-throws (el launch sigue)', async () => {
    const h = hostStub({
      groups: [{ name: 'Kodo', ref: 'workspace_group:1', member_workspace_refs: ['workspace:3'] }],
      addThrows: 'grupo desaparecido',
    });
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'KODO', workspaceRef: 'workspace:4' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.match(r.reason, /grupo desaparecido/);
  });

  test('JSON ilegible de cmux → skipped, never-throws y cero mutadores', async () => {
    const h = hostStub({});
    h.deps.listWorkspaceGroupsRaw = async () => 'not json at all';
    let r;
    await assert.doesNotReject(async () => { r = await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67' }, h.deps); });

    assert.equal(r.action, 'skipped');
    assert.deepEqual(h.calls.create, []);
  });

  test('target incompleto (expectedName null / ref vacío) → skipped SIN tocar cmux', async () => {
    const h = hostStub({ groups: [] });
    const sinNombre = await convergeProject({ name: null, workspaceRef: 'workspace:67' }, h.deps);
    const sinWs = await convergeProject({ name: 'VAMP', workspaceRef: '' }, h.deps);
    const sinNada = await convergeProject(undefined, h.deps);

    for (const r of [sinNombre, sinWs, sinNada]) {
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
    await convergeProject({ name: 'VAMP', workspaceRef: 'workspace:67' }, h.deps);
    assert.equal(ungrouped, 0, 'disolver grupos es del pase del doctor, nunca del launch');
  });
});
