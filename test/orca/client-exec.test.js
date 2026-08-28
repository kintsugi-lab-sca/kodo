// @ts-check
//
// test/orca/client-exec.test.js — KODO-50
//
// Cobertura de los exports ASYNC de `src/orca/client.js` — la mitad del módulo que el
// fichero hermano `client.test.js` deja fuera por diseño (allí solo van las funciones
// puras: `unwrapEnvelope`, `worktreeSelector`, `buildCreateWorktreeArgs`, …).
//
// Lo que solo se puede ver aquí, y no en un test de función pura:
//   1. Las SECUENCIAS de comandos. Casi ningún export de orca es una sola invocación:
//      `send`/`readScreen`/`focusWorkspace` resuelven antes el handle del terminal, y
//      `newWorkspace` encadena repo add → worktree create → worktree set. El orden y el
//      encadenado de datos entre pasos es donde se rompen, y no lo cubre nada más.
//   2. Que `runJson` añade `--json` al FINAL de cada argv y desempaqueta el sobre.
//   3. Que `worktreeSelector` se aplica de verdad en cada call site (`--worktree id:<ref>`):
//      pasar el ref desnudo es un fallo silencioso de selector en orca.
//   4. Que los dos NO-OP declarados (`notify`, `listWorkspaceGroups`) NO tocan el
//      binario. Es su contrato entero — un `run()` colado ahí rompería el fail-open del
//      launch path compartido con cmux.
//
// Técnica: binario fake + `$HOME` a tmpdir + import dinámico (ver
// `test/helpers/fake-host-binary.js` para el porqué de no mockear `execFile`).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost } from '../helpers/fake-host-binary.js';

const host = createFakeHost({
  host: 'orca',
  orca: {
    binary: null,
    // Mapa NO-default a propósito: si `setStatus` ignorara la config y hardcodease los
    // ids de Orca, estos valores lo delatan.
    statuses: { running: 'col-run', done: 'col-done', error: 'col-err', review: 'col-rev' },
  },
});

// LOAD-BEARING: `src/config.js` fija `CONFIG_PATH` con `homedir()` al evaluarse → `HOME`
// antes del import, y el cliente entra por `await import()` (un import estático lo
// hoistearía por encima de esta línea).
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = host.home;

/** @type {typeof import('../../src/orca/client.js')} */
let orca;

before(async () => {
  orca = await import('../../src/orca/client.js');
});

after(() => {
  host.cleanup();
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

beforeEach(() => {
  host.reset();
});

const REF = 'repo-a::/repos/alpha';
const SELECTOR = `id:${REF}`;

/** Sobre JSON de éxito, tal cual lo emite orca con `--json`. @param {any} result */
function ok(result) {
  return { stdout: JSON.stringify({ id: 'req-1', ok: true, result, _meta: {} }) };
}

/** Sobre JSON de error. @param {string} code @param {string} message */
function fail(code, message) {
  return { stdout: JSON.stringify({ id: 'req-1', ok: false, error: { code, message } }) };
}

/** Respuesta de `terminal list` con un terminal usable. */
const TERMINAL_OK = ok({ terminals: [{ handle: 'term_42', connected: true, writable: true }] });

describe('orca client — runJson: el sobre y el flag --json', () => {
  test('`--json` se añade al FINAL del argv, no en medio', async () => {
    host.setResponse(ok({ repo: { id: 'repo-a' } }));
    await orca.addRepo('/repos/alpha');

    const argv = host.argv();
    assert.equal(argv[argv.length - 1], '--json');
    assert.deepEqual(argv, ['repo', 'add', '--path', '/repos/alpha', '--json']);
  });

  test('un sobre `ok:false` se convierte en throw con el comando en la etiqueta', async () => {
    host.setResponse(fail('runtime_unavailable', 'Start the Orca app first.'));

    await assert.rejects(() => orca.addRepo('/repos/alpha'), /runtime_unavailable/);
  });
});

describe('orca client — addRepo', () => {
  test('devuelve el `repo.id` del sobre', async () => {
    host.setResponse(ok({ repo: { id: 'repo-a', path: '/repos/alpha' } }));
    assert.equal(await orca.addRepo('/repos/alpha'), 'repo-a');
  });

  test('shape sin `repo.id` → null, no undefined ni throw', async () => {
    host.setResponse(ok({ repo: {} }));
    assert.equal(await orca.addRepo('/repos/alpha'), null);
  });

  test('`repo.id` no-string → null (no cuela un número como ref)', async () => {
    host.setResponse(ok({ repo: { id: 7 } }));
    assert.equal(await orca.addRepo('/repos/alpha'), null);
  });
});

describe('orca client — newWorkspace: la secuencia completa', () => {
  test('sin `cwd` falla ANTES de tocar el binario (Orca crea el checkout desde el repo)', async () => {
    await assert.rejects(
      () => orca.newWorkspace({ name: 'KODO-50' }),
      /`cwd` es obligatorio/,
    );
    assert.deepEqual(host.calls(), []);
  });

  test('encadena repo add → worktree create → worktree set --display-name', async () => {
    host.setResponses([
      ok({ repo: { id: 'repo-a' } }),
      ok({ worktree: { id: REF } }),
      ok({}),
    ]);

    const ref = await orca.newWorkspace({ name: 'KODO-50: tests', cwd: '/repos/alpha' });
    assert.equal(ref, REF);

    const calls = host.calls();
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], ['repo', 'add', '--path', '/repos/alpha', '--json']);
    assert.deepEqual(calls[1], [
      'worktree', 'create',
      '--repo', 'path:/repos/alpha',
      '--name', 'kodo-50-tests', // slug de rama: sin `:` ni espacios
      '--no-parent',
      '--json',
    ]);
    // El nombre HUMANO se restituye como display-name — la rama no puede llevarlo.
    assert.deepEqual(calls[2], [
      'worktree', 'set', '--worktree', SELECTOR, '--display-name', 'KODO-50: tests', '--json',
    ]);
  });

  test('`--no-parent` SIEMPRE: kodo lanza trabajo independiente, no stacked', async () => {
    host.setResponses([ok({ repo: { id: 'repo-a' } }), ok({ worktree: { id: REF } }), ok({})]);
    await orca.newWorkspace({ name: 'X', cwd: '/repos/alpha' });

    assert.ok(host.calls()[1].includes('--no-parent'));
  });

  test('un `worktree set` fallido NO tumba la creación (el rename es best-effort)', async () => {
    host.setResponses([
      ok({ repo: { id: 'repo-a' } }),
      ok({ worktree: { id: REF } }),
      fail('not_found', 'no such worktree'),
    ]);

    assert.equal(await orca.newWorkspace({ name: 'X', cwd: '/repos/alpha' }), REF);
  });

  test('respuesta sin `worktree.id` → error explícito, no un ref vacío', async () => {
    host.setResponses([ok({ repo: { id: 'repo-a' } }), ok({ worktree: {} })]);

    await assert.rejects(
      () => orca.newWorkspace({ name: 'X', cwd: '/repos/alpha' }),
      /la respuesta no trae worktree\.id/,
    );
  });

  test('`command` → un `terminal create` extra al final, con el selector del ref nuevo', async () => {
    host.setResponses([
      ok({ repo: { id: 'repo-a' } }),
      ok({ worktree: { id: REF } }),
      ok({}),
      ok({ terminal: { handle: 'term_1' } }),
    ]);

    await orca.newWorkspace({ name: 'X', cwd: '/repos/alpha', command: 'claude --model opus' });

    const calls = host.calls();
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[3], [
      'terminal', 'create', '--worktree', SELECTOR, '--command', 'claude --model opus', '--json',
    ]);
  });

  test('`group` se IGNORA (Orca no tiene grupos): ningún argv lo menciona', async () => {
    host.setResponses([ok({ repo: { id: 'repo-a' } }), ok({ worktree: { id: REF } }), ok({})]);
    await orca.newWorkspace({ name: 'X', cwd: '/repos/alpha', group: 'workspace_group:1' });

    for (const argv of host.calls()) {
      assert.ok(!argv.includes('--group'));
      assert.ok(!argv.includes('workspace_group:1'));
    }
  });
});

describe('orca client — newWorkspace: colisión de nombre de rama', () => {
  test('nombre ocupado → un reintento con el primer sufijo libre', async () => {
    host.setResponses([
      ok({ repo: { id: 'repo-a' } }),
      fail('branch_exists', 'branch already exists'),   // create #1
      ok({ worktrees: [{ path: '/w/kodo-50' }] }),      // worktree list (qué está cogido)
      ok({ worktree: { id: REF } }),                    // create #2 con el sufijo
      ok({}),                                           // rename
    ]);

    assert.equal(await orca.newWorkspace({ name: 'KODO-50', cwd: '/repos/alpha' }), REF);

    const calls = host.calls();
    assert.deepEqual(calls[2], ['worktree', 'list', '--repo', 'path:/repos/alpha', '--json']);
    // `-2` es el primer sufijo libre: `kodo-50` a secas ya figura en el listado.
    const i = calls[3].indexOf('--name');
    assert.equal(calls[3][i + 1], 'kodo-50-2');
  });

  test('si el listado también falla → propaga el error ORIGINAL de create, sin reintentar', async () => {
    host.setResponses([
      ok({ repo: { id: 'repo-a' } }),
      fail('branch_exists', 'branch already exists'),
      fail('runtime_unavailable', 'app cerrada'),
    ]);

    await assert.rejects(
      () => orca.newWorkspace({ name: 'KODO-50', cwd: '/repos/alpha' }),
      /branch_exists/,
    );
    assert.equal(host.calls().length, 3); // sin un segundo `worktree create`
  });

  test('sin hueco en los 9 primeros sufijos → propaga en vez de insistir', async () => {
    const taken = Array.from({ length: 9 }, (_, n) => ({ path: `/w/kodo-50-${n + 1}` }));
    host.setResponses([
      ok({ repo: { id: 'repo-a' } }),
      fail('branch_exists', 'branch already exists'),
      ok({ worktrees: taken }),
    ]);

    await assert.rejects(
      () => orca.newWorkspace({ name: 'KODO-50', cwd: '/repos/alpha' }),
      /branch_exists/,
    );
    assert.equal(host.calls().length, 3);
  });
});

describe('orca client — send: Enter es un FLAG, no un `\\n` en el payload', () => {
  test('resuelve el handle y luego teclea con --enter', async () => {
    host.setResponses([TERMINAL_OK, ok({})]);
    await orca.send({ workspace: REF, text: 'hola' });

    const calls = host.calls();
    assert.deepEqual(calls[0], ['terminal', 'list', '--worktree', SELECTOR, '--json']);
    assert.deepEqual(calls[1], [
      'terminal', 'send', '--terminal', 'term_42', '--text', 'hola', '--enter', '--json',
    ]);
  });

  test('el `\\n` LITERAL que añaden los call sites de cmux se retira del texto', async () => {
    // Sin esto, los dos caracteres `\` y `n` llegarían impresos al terminal de Orca.
    host.setResponses([TERMINAL_OK, ok({})]);
    await orca.send({ workspace: REF, text: 'kodo: continúa\\n' });

    const argv = host.calls()[1];
    assert.equal(argv[argv.indexOf('--text') + 1], 'kodo: continúa');
  });

  test('el handle se re-resuelve en CADA envío (los handles son runtime-scoped)', async () => {
    host.setResponses([TERMINAL_OK, ok({}), TERMINAL_OK, ok({})]);
    await orca.send({ workspace: REF, text: 'uno' });
    await orca.send({ workspace: REF, text: 'dos' });

    const listCalls = host.calls().filter((a) => a[0] === 'terminal' && a[1] === 'list');
    assert.equal(listCalls.length, 2);
  });

  test('sin terminal utilizable → error con el ref, y NO se llega a teclear', async () => {
    host.setResponses([ok({ terminals: [] })]);

    await assert.rejects(() => orca.send({ workspace: REF, text: 'hola' }), /sin terminal utilizable/);
    assert.equal(host.calls().length, 1);
  });
});

describe('orca client — readScreen: el tail se devuelve como texto plano', () => {
  test('junta el array `tail` con saltos de línea (contrato de cmux.readScreen)', async () => {
    host.setResponses([TERMINAL_OK, ok({ terminal: { tail: ['línea 1', 'línea 2'] } })]);

    assert.equal(await orca.readScreen({ workspace: REF }), 'línea 1\nlínea 2');
  });

  test('sin `lines` NO emite --limit', async () => {
    host.setResponses([TERMINAL_OK, ok({ terminal: { tail: [] } })]);
    await orca.readScreen({ workspace: REF });

    assert.deepEqual(host.calls()[1], ['terminal', 'read', '--terminal', 'term_42', '--json']);
  });

  test('con `lines` emite `--limit <n>` como string (el flag de orca no es --lines)', async () => {
    host.setResponses([TERMINAL_OK, ok({ terminal: { tail: [] } })]);
    await orca.readScreen({ workspace: REF, lines: 40 });

    const argv = host.calls()[1];
    assert.deepEqual(argv, ['terminal', 'read', '--terminal', 'term_42', '--limit', '40', '--json']);
    assert.ok(!argv.includes('--lines'));
  });

  test('tail ausente o no-array → string vacío, nunca undefined (never-throws)', async () => {
    host.setResponses([TERMINAL_OK, ok({ terminal: {} })]);
    assert.equal(await orca.readScreen({ workspace: REF }), '');
  });
});

describe('orca client — mutaciones de la tarjeta: worktree set', () => {
  test('setStatus traduce el estado con `orca.statuses` de la CONFIG, no hardcodeado', async () => {
    host.setResponse(ok({}));
    await orca.setStatus({ workspace: REF, status: 'review' });

    assert.deepEqual(host.argv(), [
      'worktree', 'set', '--worktree', SELECTOR, '--workspace-status', 'col-rev', '--json',
    ]);
  });

  test('setStatus con un estado desconocido cae a `in-progress`, no manda un id vacío', async () => {
    host.setResponse(ok({}));
    await orca.setStatus({ workspace: REF, status: /** @type {any} */ ('inventado') });

    const argv = host.argv();
    assert.equal(argv[argv.indexOf('--workspace-status') + 1], 'in-progress');
  });

  test('setDescription usa `--comment` (Orca no tiene descripción de workspace)', async () => {
    host.setResponse(ok({}));
    await orca.setDescription({ workspace: REF, description: 'KODO-50 · in review' });

    assert.deepEqual(host.argv(), [
      'worktree', 'set', '--worktree', SELECTOR, '--comment', 'KODO-50 · in review', '--json',
    ]);
  });

  test('rename usa `--display-name` (la rama git ya está creada y no se toca)', async () => {
    host.setResponse(ok({}));
    await orca.rename({ workspace: REF, title: 'KODO-50: tests' });

    assert.deepEqual(host.argv(), [
      'worktree', 'set', '--worktree', SELECTOR, '--display-name', 'KODO-50: tests', '--json',
    ]);
  });

  test('los tres mutadores aplican `worktreeSelector` — nunca el ref desnudo', async () => {
    /** @type {Array<() => Promise<unknown>>} */
    const calls = [
      () => orca.setStatus({ workspace: REF, status: 'running' }),
      () => orca.setDescription({ workspace: REF, description: 'x' }),
      () => orca.rename({ workspace: REF, title: 'x' }),
    ];

    for (const call of calls) {
      host.reset();
      host.setResponse(ok({}));
      await call();
      const argv = host.argv();
      assert.equal(argv[argv.indexOf('--worktree') + 1], SELECTOR);
      assert.ok(!argv.includes(REF), 'el ref desnudo no debe viajar como selector');
    }
  });
});

describe('orca client — focusWorkspace', () => {
  test('Orca enfoca por TERMINAL: resuelve el handle y hace `terminal switch`', async () => {
    host.setResponses([TERMINAL_OK, ok({})]);
    await orca.focusWorkspace({ workspace: REF });

    const calls = host.calls();
    assert.deepEqual(calls[0], ['terminal', 'list', '--worktree', SELECTOR, '--json']);
    assert.deepEqual(calls[1], ['terminal', 'switch', '--terminal', 'term_42', '--json']);
  });
});

describe('orca client — vistas de listado', () => {
  test('listWorkspaces: `worktree ps` formateado al texto plano de `cmux workspace list`', async () => {
    // `session/health.js` decide la liveness con `.includes(workspace_ref)` sobre este
    // string, así que el ref tiene que salir LITERAL.
    host.setResponse(ok({
      worktrees: [
        { worktreeId: REF, displayName: 'KODO-50' },
        { worktreeId: 'repo-b::/repos/beta', displayName: 'KODO-51' },
      ],
    }));

    const out = await orca.listWorkspaces();
    assert.deepEqual(host.argv(), ['worktree', 'ps', '--json']);
    assert.ok(out.includes(REF));
    assert.equal(out.split('\n').length, 2);
  });

  test('listWorkspacesJson: stdout CRUDO, sin desempaquetar el sobre', async () => {
    const raw = JSON.stringify({ id: 'r', ok: true, result: { worktrees: [] } });
    host.setResponse({ stdout: raw });

    assert.equal(await orca.listWorkspacesJson(), raw);
    assert.deepEqual(host.argv(), ['worktree', 'ps', '--json']);
  });

  test('listTree: emite el shape de `cmux tree --all --json`, con id === ref', async () => {
    host.setResponse(ok({ worktrees: [{ worktreeId: REF, displayName: 'KODO-50' }] }));

    const parsed = JSON.parse(await orca.listTree());
    assert.deepEqual(host.argv(), ['worktree', 'ps', '--json']);
    assert.deepEqual(parsed, {
      windows: [{ workspaces: [{ id: REF, ref: REF, title: 'KODO-50' }] }],
    });
  });

  test('listTerminalsJson sin workspace: `terminal list --json` sin acotar', async () => {
    host.setResponse({ stdout: '{}' });
    await orca.listTerminalsJson();

    assert.deepEqual(host.argv(), ['terminal', 'list', '--json']);
  });

  test('listTerminalsJson con workspace: acota con `--worktree id:<ref>` ANTES de --json', async () => {
    host.setResponse({ stdout: '{}' });
    await orca.listTerminalsJson({ workspace: REF });

    assert.deepEqual(host.argv(), ['terminal', 'list', '--worktree', SELECTOR, '--json']);
  });
});

describe('orca client — los NO-OP declarados no tocan el binario', () => {
  test('notify: devuelve null y NO invoca orca (no existe el comando)', async () => {
    assert.equal(await orca.notify({ title: 'kodo', body: 'x', workspace: REF }), null);
    assert.deepEqual(host.calls(), []);
  });

  test('listWorkspaceGroups: listado vacío constante, sin invocar orca', async () => {
    // Hace que `resolveWorkspaceGroup` no matchee y la sesión se lance sin `--group`:
    // exactamente la rama fail-open que session/manager.js ya contempla.
    const out = await orca.listWorkspaceGroups();
    assert.deepEqual(JSON.parse(out), { groups: [] });
    assert.deepEqual(host.calls(), []);
  });
});

describe('orca client — camino de fallo del proceso', () => {
  test('exit code ≠ 0 → rejects con el subcomando y el stderr', async () => {
    host.setResponse({ code: 127, stderr: 'command not found' });

    await assert.rejects(
      () => orca.listWorkspacesJson(),
      /orca worktree failed: command not found/,
    );
  });

  test('stdout no-JSON en un comando con sobre → error legible, no un SyntaxError crudo', async () => {
    host.setResponse({ stdout: 'command not found' });

    await assert.rejects(() => orca.addRepo('/repos/alpha'), /respuesta no-JSON/);
  });
});
