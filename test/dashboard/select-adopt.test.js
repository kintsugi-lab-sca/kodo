// @ts-check
//
// test/dashboard/select-adopt.test.js — Phase 56 Plan 01 (DETECT-02).
//
// Cobertura unitaria de los dos derives puros añadidos a select.js:
//   - computeAdoptable(surfaces, statusSessions): set-difference D-02.
//       filtra kind==='claude', exige sessionId truthy, excluye los sessionId ya trackeados
//       en el snapshot vivo de /status (keyeado por session_id, NUNCA workspaceRef).
//   - resolveProjectId(cwd, projects): reverse-lookup D-05.
//       ancestro más cercano contra Record<projectId, path>; trailing-slash normalizado;
//       {projectId} único | {error:'none'} | {error:'ambiguous'}.
//
// Sin molde de test directo: node:test + node:assert/strict plano (molde de los imports
// de open.test.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computeAdoptable, resolveProjectId } from '../../src/cli/dashboard/select.js';

describe('Phase 56 Plan 01: computeAdoptable set-difference por sessionId (D-02)', () => {
  it('filtra solo kind==="claude" (Pitfall 5: listAgentSurfaces NO pre-filtra)', () => {
    const surfaces = [
      { workspaceRef: 'ws:1', cwd: '/a', sessionId: 's1', kind: 'claude' },
      { workspaceRef: 'ws:2', cwd: '/b', sessionId: 's2', kind: 'shell' },
      { workspaceRef: 'ws:3', cwd: '/c', sessionId: 's3', kind: 'codex' },
    ];
    const result = computeAdoptable(surfaces, []);
    assert.deepEqual(
      result.map((s) => s.sessionId),
      ['s1'],
      'solo la surface claude es adoptable',
    );
  });

  it('excluye surfaces cuyo sessionId ESTÁ en statusSessions[].session_id', () => {
    const surfaces = [
      { workspaceRef: 'ws:1', cwd: '/a', sessionId: 's1', kind: 'claude' },
      { workspaceRef: 'ws:2', cwd: '/b', sessionId: 's2', kind: 'claude' },
    ];
    const status = [{ session_id: 's1' }];
    const result = computeAdoptable(surfaces, status);
    assert.deepEqual(
      result.map((s) => s.sessionId),
      ['s2'],
      's1 ya trackeada → solo s2 adoptable',
    );
  });

  it('ignora workspaceRef por completo: mismo workspaceRef + nuevo sessionId → adoptable', () => {
    // cmux recicla workspace:N (defensa Phase 43 / D-06 Phase 55). El diff es por sessionId.
    const surfaces = [{ workspaceRef: 'workspace:5', cwd: '/a', sessionId: 'sNEW', kind: 'claude' }];
    const status = [{ session_id: 'sOLD', workspace_ref: 'workspace:5' }];
    const result = computeAdoptable(surfaces, status);
    assert.deepEqual(
      result.map((s) => s.sessionId),
      ['sNEW'],
      'el workspaceRef reciclado NO debe enmascarar una sesión nueva',
    );
  });

  it('excluye surfaces con sessionId falsy (no adoptables sin identidad)', () => {
    const surfaces = [
      { workspaceRef: 'ws:1', cwd: '/a', sessionId: '', kind: 'claude' },
      { workspaceRef: 'ws:2', cwd: '/b', sessionId: null, kind: 'claude' },
      { workspaceRef: 'ws:3', cwd: '/c', sessionId: 's3', kind: 'claude' },
    ];
    const result = computeAdoptable(surfaces, []);
    assert.deepEqual(result.map((s) => s.sessionId), ['s3']);
  });

  it('null/undefined surfaces → [] (never-throws)', () => {
    assert.deepEqual(computeAdoptable(null, []), []);
    assert.deepEqual(computeAdoptable(undefined, []), []);
  });

  it('null statusSessions → diffea contra Set vacío (todas las claude adoptables)', () => {
    const surfaces = [{ workspaceRef: 'ws:1', cwd: '/a', sessionId: 's1', kind: 'claude' }];
    assert.deepEqual(computeAdoptable(surfaces, null).map((s) => s.sessionId), ['s1']);
    assert.deepEqual(computeAdoptable(surfaces, undefined).map((s) => s.sessionId), ['s1']);
  });

  it('ignora session_id falsy en statusSessions al construir el Set tracked', () => {
    const surfaces = [{ workspaceRef: 'ws:1', cwd: '/a', sessionId: 's1', kind: 'claude' }];
    const status = [{ session_id: null }, { session_id: '' }, { session_id: 's2' }];
    assert.deepEqual(computeAdoptable(surfaces, status).map((s) => s.sessionId), ['s1']);
  });
});

describe('Phase 56 Plan 01: resolveProjectId reverse-lookup cwd→projectId (D-05)', () => {
  it('match exacto: cwd === projectPath → { projectId }', () => {
    const projects = { kodo: '/home/op/kodo', other: '/home/op/other' };
    assert.deepEqual(resolveProjectId('/home/op/kodo', projects), { projectId: 'kodo' });
  });

  it('match por ancestro: cwd es descendiente del projectPath → { projectId }', () => {
    const projects = { kodo: '/home/op/kodo' };
    assert.deepEqual(resolveProjectId('/home/op/kodo/src/cli', projects), { projectId: 'kodo' });
  });

  it('nearest-ancestor wins: el path más largo (más específico) gana', () => {
    const projects = {
      mono: '/home/op/mono',
      sub: '/home/op/mono/packages/api',
    };
    assert.deepEqual(
      resolveProjectId('/home/op/mono/packages/api/src', projects),
      { projectId: 'sub' },
      'el ancestro más largo (sub) gana sobre mono',
    );
  });

  it('sin match → { error: "none" }', () => {
    const projects = { kodo: '/home/op/kodo' };
    assert.deepEqual(resolveProjectId('/tmp/elsewhere', projects), { error: 'none' });
  });

  it('separator-boundary safe: /home/op/kodo-sibling NO matchea /home/op/kodo', () => {
    const projects = { kodo: '/home/op/kodo' };
    assert.deepEqual(resolveProjectId('/home/op/kodo-sibling', projects), { error: 'none' });
  });

  it('dos prefijos de igual longitud → distintos projectIds → { error: "ambiguous" }', () => {
    const projects = { a: '/home/op/shared', b: '/home/op/shared' };
    assert.deepEqual(resolveProjectId('/home/op/shared/x', projects), { error: 'ambiguous' });
  });

  it('trailing-slash normalizado en ambos lados', () => {
    const projects = { kodo: '/home/op/kodo/' };
    assert.deepEqual(resolveProjectId('/home/op/kodo', projects), { projectId: 'kodo' });
    assert.deepEqual(resolveProjectId('/home/op/kodo/', projects), { projectId: 'kodo' });
    assert.deepEqual(resolveProjectId('/home/op/kodo/src/', projects), { projectId: 'kodo' });
  });

  it('proyectos vacíos → { error: "none" }', () => {
    assert.deepEqual(resolveProjectId('/home/op/kodo', {}), { error: 'none' });
  });

  it('never-throws sobre valores no-string (projects.json operator-corruptible, CR-01)', () => {
    // loadProjects() hace JSON.parse SIN validar el tipo de los valores. Un valor no-string
    // (número/null/array de un hand-edit) haría `.replace` lanzar un TypeError SÍNCRONO dentro
    // del handler `a` (sin try/catch hasta el useInput de ink → tearing-down del panel). El
    // helper DEBE saltar las entradas malformadas y resolver contra las válidas, jamás lanzar.
    const projects = { valid: '/home/op/kodo', bad: 123 };
    assert.doesNotThrow(() => resolveProjectId('/home/op/kodo/src', projects));
    assert.deepEqual(
      resolveProjectId('/home/op/kodo/src', projects),
      { projectId: 'valid' },
      'la entrada string válida resuelve; la numérica se ignora',
    );
  });

  it('never-throws cuando TODOS los valores son no-string → { error: "none" }', () => {
    const projects = { a: 123, b: null, c: ['/arr'], d: { default: '/obj' } };
    assert.doesNotThrow(() => resolveProjectId('/home/op/kodo', projects));
    assert.deepEqual(resolveProjectId('/home/op/kodo', projects), { error: 'none' });
  });

  it('never-throws sobre projects null/undefined/no-objeto', () => {
    assert.doesNotThrow(() => resolveProjectId('/home/op/kodo', null));
    assert.doesNotThrow(() => resolveProjectId('/home/op/kodo', undefined));
    assert.deepEqual(resolveProjectId('/home/op/kodo', null), { error: 'none' });
    assert.deepEqual(resolveProjectId('/home/op/kodo', undefined), { error: 'none' });
  });

  it('never-throws sobre cwd no-string / ausente → { error: "none" }', () => {
    const projects = { kodo: '/home/op/kodo' };
    assert.doesNotThrow(() => resolveProjectId(undefined, projects));
    assert.doesNotThrow(() => resolveProjectId(123, projects));
    assert.deepEqual(resolveProjectId(undefined, projects), { error: 'none' });
    assert.deepEqual(resolveProjectId(123, projects), { error: 'none' });
  });
});
