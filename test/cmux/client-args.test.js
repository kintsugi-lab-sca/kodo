// test/cmux/client-args.test.js
// Phase 77 Plan 01 Task 1 — test directo de la función pura
// `buildNewWorkspaceArgs(opts)` extraída de `src/cmux/client.js`.
//
// Verifica la construcción determinista del argv de `new-workspace`, incluido
// el flag opcional `--group <ref>` (GRP-01). Función pura: sin FS, sin cmux
// real, sin `run()`/execFile. El argv es un array plano de strings apto para
// `execFile` sin shell (V5/Tampering, T-77-01).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildNewWorkspaceArgs } from '../../src/cmux/client.js';

/**
 * Helper: ¿contiene `arr` la subsecuencia consecutiva `sub`?
 * @param {string[]} arr
 * @param {string[]} sub
 * @returns {boolean}
 */
function hasConsecutive(arr, sub) {
  for (let i = 0; i + sub.length <= arr.length; i++) {
    let ok = true;
    for (let j = 0; j < sub.length; j++) {
      if (arr[i + j] !== sub[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

describe('buildNewWorkspaceArgs', () => {
  test('solo name → argv mínimo', () => {
    assert.deepEqual(
      buildNewWorkspaceArgs({ name: 'X' }),
      ['new-workspace', '--name', 'X'],
    );
  });

  test('name + cwd → añade --cwd tras --name', () => {
    assert.deepEqual(
      buildNewWorkspaceArgs({ name: 'X', cwd: '/p' }),
      ['new-workspace', '--name', 'X', '--cwd', '/p'],
    );
  });

  test('name + cwd + command → --command tras --cwd', () => {
    assert.deepEqual(
      buildNewWorkspaceArgs({ name: 'X', cwd: '/p', command: 'claude' }),
      ['new-workspace', '--name', 'X', '--cwd', '/p', '--command', 'claude'],
    );
  });

  test('name + group → incluye --group <ref> como par consecutivo', () => {
    const args = buildNewWorkspaceArgs({ name: 'X', group: 'workspace_group:1' });
    assert.ok(hasConsecutive(args, ['--group', 'workspace_group:1']));
  });

  test('sin group → el token --group NO aparece (byte-idéntico al comportamiento previo)', () => {
    const args = buildNewWorkspaceArgs({ name: 'X' });
    assert.ok(!args.includes('--group'));
  });

  test('todos los flags → orden completo --name → --cwd → --command → --group', () => {
    assert.deepEqual(
      buildNewWorkspaceArgs({ name: 'X', cwd: '/p', command: 'c', group: 'workspace_group:2' }),
      ['new-workspace', '--name', 'X', '--cwd', '/p', '--command', 'c', '--group', 'workspace_group:2'],
    );
  });

  test('group falsy (string vacío) → NO incluye --group', () => {
    const args = buildNewWorkspaceArgs({ name: 'X', group: '' });
    assert.ok(!args.includes('--group'));
  });

  test('el array es plano de strings (apto para execFile sin shell)', () => {
    const args = buildNewWorkspaceArgs({ name: 'X', cwd: '/p', command: 'c', group: 'workspace_group:2' });
    assert.ok(Array.isArray(args));
    for (const el of args) {
      assert.equal(typeof el, 'string');
    }
  });

  test('orden relativo de flags estable aunque falte --cwd', () => {
    // name + command + group (sin cwd): --command y --group tras --name, en orden
    const args = buildNewWorkspaceArgs({ name: 'X', command: 'c', group: 'workspace_group:3' });
    assert.deepEqual(
      args,
      ['new-workspace', '--name', 'X', '--command', 'c', '--group', 'workspace_group:3'],
    );
  });
});
