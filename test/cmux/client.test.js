// @ts-check
//
// test/cmux/client.test.js — KODO-50
//
// Cobertura de los exports ASYNC de `src/cmux/client.js`: los que construyen su argv
// inline y lo mandan al binario vía `run()`. El fichero hermano `client-args.test.js`
// solo cubre `buildNewWorkspaceArgs`, la única pieza pura del módulo — el resto de
// comandos (send, read-screen, workspace-action, rename, los tres passthroughs de
// workspace-group, notify) no tenían ningún test.
//
// Qué se verifica y por qué importa:
//   1. El argv EXACTO que sale hacia el binario. Es la superficie donde un typo
//      (`--title` vs `set-title`, `ungroup <ref>` posicional vs con flag) rompe en
//      producción y en ningún test. Varios de esos verbos ya costaron un fix en vivo
//      —ver los comentarios de `rename()` y del allowlist de grupos en el fuente—, así
//      que quedan clavados aquí.
//   2. Que cada ref viaja como ELEMENTO de array, nunca interpolado en un string:
//      `execFile` sin shell, cero superficie de inyección (V5/Tampering).
//   3. El post-proceso del stdout: `newWorkspace` extrae `workspace:N` de "OK
//      workspace:N", y `run()` hace `.trim()` del resto.
//   4. El camino de fallo: exit code ≠ 0 → rejects con el stderr en el mensaje.
//
// Técnica: binario fake + `$HOME` a tmpdir + import dinámico (ver
// `test/helpers/fake-host-binary.js` para el porqué de no mockear `execFile`).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost } from '../helpers/fake-host-binary.js';

const host = createFakeHost({ host: 'cmux', cmux: { binary: null } });

// LOAD-BEARING: `src/config.js` calcula `CONFIG_PATH` con `homedir()` al evaluarse, así
// que `HOME` tiene que estar puesto ANTES del import. Por eso el cliente entra por
// `await import()` dinámico y no por un import estático (que ESM hoistearía por encima).
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = host.home;

/** @type {typeof import('../../src/cmux/client.js')} */
let cmux;

before(async () => {
  cmux = await import('../../src/cmux/client.js');
});

after(() => {
  host.cleanup();
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

beforeEach(() => {
  host.reset();
});

describe('cmux client — argv de los comandos de sesión', () => {
  test('send: `send --workspace <ws> <text\\n>` con el sufijo de keystroke LITERAL', async () => {
    host.setResponse({ stdout: 'OK\n' });
    await cmux.send({ workspace: 'workspace:3', text: 'hola' });

    // El `\n` del final son DOS caracteres (backslash + n), no un salto real: es la
    // convención de keystroke que cmux traduce a Enter. `stripTrailingNewlineEscape`
    // de orca existe precisamente para deshacerlo en el otro host.
    assert.deepEqual(host.argv(), ['send', '--workspace', 'workspace:3', 'hola\\n']);
  });

  test('send: el texto viaja como UN elemento de array aunque traiga metacaracteres', async () => {
    host.setResponse({ stdout: '' });
    await cmux.send({ workspace: 'workspace:3', text: 'a; rm -rf / && echo $HOME' });

    const argv = host.argv();
    assert.equal(argv.length, 4);
    assert.equal(argv[3], 'a; rm -rf / && echo $HOME\\n');
  });

  test('readScreen: sin `lines` NO emite el flag --lines', async () => {
    host.setResponse({ stdout: 'pantalla\n' });
    const out = await cmux.readScreen({ workspace: 'workspace:7' });

    assert.deepEqual(host.argv(), ['read-screen', '--workspace', 'workspace:7']);
    assert.equal(out, 'pantalla');
  });

  test('readScreen: con `lines` lo añade al final y como STRING', async () => {
    host.setResponse({ stdout: '' });
    await cmux.readScreen({ workspace: 'workspace:7', lines: 40 });

    const argv = host.argv();
    assert.deepEqual(argv, ['read-screen', '--workspace', 'workspace:7', '--lines', '40']);
    assert.equal(typeof argv[4], 'string');
  });

  test('readScreen: `lines: 0` es falsy → sin flag (no manda `--lines 0`)', async () => {
    host.setResponse({ stdout: '' });
    await cmux.readScreen({ workspace: 'workspace:7', lines: 0 });

    assert.ok(!host.argv().includes('--lines'));
  });
});

describe('cmux client — newWorkspace: parseo del ref devuelto', () => {
  test('extrae `workspace:N` del "OK workspace:N" de cmux', async () => {
    host.setResponse({ stdout: 'OK workspace:12\n' });
    const ref = await cmux.newWorkspace({ name: 'KODO-50', cwd: '/repo' });

    assert.equal(ref, 'workspace:12');
    assert.deepEqual(host.argv(), ['new-workspace', '--name', 'KODO-50', '--cwd', '/repo']);
  });

  test('stdout sin `workspace:N` → devuelve el output crudo trimmed (no null)', async () => {
    // Fail-soft deliberado: un cmux futuro que cambie el formato degrada a "lo que
    // dijo el binario", no a un ref vacío que rompería el registro de la sesión.
    host.setResponse({ stdout: '  formato inesperado  \n' });
    assert.equal(await cmux.newWorkspace({ name: 'X' }), 'formato inesperado');
  });

  test('propaga el `--group` de buildNewWorkspaceArgs hasta el binario', async () => {
    host.setResponse({ stdout: 'OK workspace:4' });
    await cmux.newWorkspace({ name: 'X', group: 'workspace_group:2' });

    const argv = host.argv();
    const i = argv.indexOf('--group');
    assert.ok(i !== -1);
    assert.equal(argv[i + 1], 'workspace_group:2');
  });
});

describe('cmux client — workspace-action y rename', () => {
  test('setColor: `workspace-action --action set-color`', async () => {
    host.setResponse({ stdout: '' });
    await cmux.setColor({ workspace: 'workspace:3', color: 'Amber' });

    assert.deepEqual(host.argv(), [
      'workspace-action', '--action', 'set-color',
      '--workspace', 'workspace:3', '--color', 'Amber',
    ]);
  });

  test('setDescription: `workspace-action --action set-description`', async () => {
    host.setResponse({ stdout: '' });
    await cmux.setDescription({ workspace: 'workspace:3', description: 'KODO-50 · in review' });

    assert.deepEqual(host.argv(), [
      'workspace-action', '--action', 'set-description',
      '--workspace', 'workspace:3', '--description', 'KODO-50 · in review',
    ]);
  });

  test('rename: `workspace rename <ws> --title <new>`, NO workspace-action', async () => {
    // Regresión de un fix verificado en vivo (cmux 0.64.16): `--action set-title` no
    // existe y devuelve "Unknown workspace action". El ref es POSICIONAL aquí.
    host.setResponse({ stdout: '' });
    await cmux.rename({ workspace: 'workspace:3', title: 'KODO-50' });

    const argv = host.argv();
    assert.deepEqual(argv, ['workspace', 'rename', 'workspace:3', '--title', 'KODO-50']);
    assert.ok(!argv.includes('--action'));
    assert.ok(!argv.includes('set-title'));
  });
});

describe('cmux client — passthroughs de lectura', () => {
  test('listWorkspaces: `workspace list` (texto plano) y devuelve el stdout trimmed', async () => {
    host.setResponse({ stdout: '  workspace:3  KL-1\n  workspace:12  kodo-orchestrator\n' });
    const out = await cmux.listWorkspaces();

    assert.deepEqual(host.argv(), ['workspace', 'list']);
    assert.equal(out, 'workspace:3  KL-1\n  workspace:12  kodo-orchestrator');
  });

  test('listTree: `tree --all --json` — la vista CROSS-WINDOW, con --all', async () => {
    host.setResponse({ stdout: '{"windows":[]}' });
    const out = await cmux.listTree();

    assert.deepEqual(host.argv(), ['tree', '--all', '--json']);
    assert.equal(out, '{"windows":[]}');
  });

  test('listWorkspacesJson: `workspace list --json`, distinto de listWorkspaces()', async () => {
    host.setResponse({ stdout: '[]' });
    await cmux.listWorkspacesJson();

    assert.deepEqual(host.argv(), ['workspace', 'list', '--json']);
  });

  test('listWorkspaceGroups: `workspace-group list --json`', async () => {
    host.setResponse({ stdout: '[]' });
    await cmux.listWorkspaceGroups();

    assert.deepEqual(host.argv(), ['workspace-group', 'list', '--json']);
  });

  test('los passthroughs devuelven el JSON CRUDO, sin parsear (D-05)', async () => {
    host.setResponse({ stdout: 'esto no es JSON' });
    assert.equal(await cmux.listTree(), 'esto no es JSON');
  });
});

describe('cmux client — allowlist NO-DESTRUCTIVO de workspace-group', () => {
  test('createWorkspaceGroup sin opts: solo `workspace-group create`', async () => {
    host.setResponse({ stdout: '' });
    await cmux.createWorkspaceGroup({});

    assert.deepEqual(host.argv(), ['workspace-group', 'create']);
  });

  test('createWorkspaceGroup con name: añade `--name`', async () => {
    host.setResponse({ stdout: '' });
    await cmux.createWorkspaceGroup({ name: 'Grupo 1' });

    assert.deepEqual(host.argv(), ['workspace-group', 'create', '--name', 'Grupo 1']);
  });

  test('createWorkspaceGroup con `from`: los refs van en UN arg separado por comas', async () => {
    host.setResponse({ stdout: '' });
    await cmux.createWorkspaceGroup({ name: 'G', from: ['workspace:1', 'workspace:2'] });

    const argv = host.argv();
    assert.deepEqual(argv, [
      'workspace-group', 'create', '--name', 'G', '--from', 'workspace:1,workspace:2',
    ]);
    // La lista es UN solo elemento de array: el `join(',')` es del CLI, no del shell.
    assert.equal(argv.filter((a) => a.startsWith('workspace:')).length, 1);
  });

  test('createWorkspaceGroup con `from: []` → sin `--from` (lista vacía es no-op)', async () => {
    host.setResponse({ stdout: '' });
    await cmux.createWorkspaceGroup({ name: 'G', from: [] });

    assert.ok(!host.argv().includes('--from'));
  });

  test('addToWorkspaceGroup: `--group` y `--workspace` con flags, no posicionales', async () => {
    host.setResponse({ stdout: '' });
    await cmux.addToWorkspaceGroup({ group: 'workspace_group:1', workspace: 'workspace:5' });

    assert.deepEqual(host.argv(), [
      'workspace-group', 'add', '--group', 'workspace_group:1', '--workspace', 'workspace:5',
    ]);
  });

  test('ungroupWorkspaceGroup: el grupo es POSICIONAL (sin --group)', async () => {
    host.setResponse({ stdout: '' });
    await cmux.ungroupWorkspaceGroup({ group: 'workspace_group:1' });

    const argv = host.argv();
    assert.deepEqual(argv, ['workspace-group', 'ungroup', 'workspace_group:1']);
    assert.ok(!argv.includes('--group'));
  });

  test('ningún passthrough emite un verbo DESTRUCTIVO (delete/remove/rename/set-anchor)', async () => {
    // Espejo en runtime del guard source-hygiene (test/sidebar-doctor-hygiene.test.js):
    // aquel mira el fuente, este mira el argv que de verdad sale hacia el binario.
    const prohibidos = new Set(['delete', 'remove', 'rename', 'set-anchor']);
    /** @type {Array<() => Promise<unknown>>} */
    const calls = [
      () => cmux.createWorkspaceGroup({ name: 'G', from: ['workspace:1'] }),
      () => cmux.addToWorkspaceGroup({ group: 'workspace_group:1', workspace: 'workspace:5' }),
      () => cmux.ungroupWorkspaceGroup({ group: 'workspace_group:1' }),
      () => cmux.listWorkspaceGroups(),
    ];

    for (const call of calls) {
      host.setResponse({ stdout: '' });
      await call();
      const argv = host.argv();
      assert.equal(argv[0], 'workspace-group');
      for (const token of argv) {
        assert.ok(!prohibidos.has(token), `verbo destructivo en el argv: ${token}`);
      }
    }
  });
});

describe('cmux client — notify', () => {
  test('solo title → `notify --title <t>`', async () => {
    host.setResponse({ stdout: '' });
    await cmux.notify({ title: 'kodo' });

    assert.deepEqual(host.argv(), ['notify', '--title', 'kodo']);
  });

  test('title + body + workspace → orden estable --title → --body → --workspace', async () => {
    host.setResponse({ stdout: '' });
    await cmux.notify({ title: 'kodo', body: 'sesión lista', workspace: 'workspace:3' });

    assert.deepEqual(host.argv(), [
      'notify', '--title', 'kodo', '--body', 'sesión lista', '--workspace', 'workspace:3',
    ]);
  });

  test('body vacío → sin `--body` (no manda un flag con string vacío)', async () => {
    host.setResponse({ stdout: '' });
    await cmux.notify({ title: 'kodo', body: '', workspace: 'workspace:3' });

    assert.deepEqual(host.argv(), ['notify', '--title', 'kodo', '--workspace', 'workspace:3']);
  });
});

describe('cmux client — camino de fallo', () => {
  test('exit code ≠ 0 → rejects con el subcomando y el stderr en el mensaje', async () => {
    host.setResponse({ code: 1, stderr: 'Unknown workspace action' });

    await assert.rejects(
      () => cmux.setColor({ workspace: 'workspace:3', color: 'Amber' }),
      /cmux workspace-action failed: Unknown workspace action/,
    );
  });

  test('fallo SIN stderr → cae al mensaje del error de execFile, no a "undefined"', async () => {
    host.setResponse({ code: 2, stderr: '' });

    await assert.rejects(
      () => cmux.listWorkspaces(),
      (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /^cmux workspace failed: /);
        assert.ok(!/undefined/.test(err.message));
        return true;
      },
    );
  });

  test('un fallo NO deja escapar un stderr gigante sin recortar en el log', async () => {
    // `run()` trunca el stderr a 200 chars para el logger; el mensaje del Error sí lo
    // lleva entero. Aquí se fija que el fallo sigue siendo un rejects limpio con un
    // stderr grande (no un crash del handler).
    host.setResponse({ code: 1, stderr: 'x'.repeat(5000) });

    await assert.rejects(() => cmux.listTree(), /cmux tree failed: x{100}/);
  });
});
