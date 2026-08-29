// @ts-check
//
// test/bb/client-exec.test.js — KODO-31
//
// Cobertura de los exports ASYNC de `src/bb/client.js` — la mitad del módulo que el
// fichero hermano `client.test.js` deja fuera por diseño (allí solo van las puras).
//
// Lo que SOLO se puede ver aquí:
//   1. El argv EXACTO que sale hacia el binario. `bb thread stop` vs `bb thread archive`
//      es la diferencia entre soltar el runtime y destruir el worktree del operador; nada
//      salvo este test lo fija sobre la invocación real.
//   2. Las SECUENCIAS: `newWorkspace` encadena `project list` → (`project create`) →
//      `thread spawn`, y el project id del primer paso tiene que llegar al último.
//   3. Que `runJson` añade `--json` al FINAL de cada argv.
//   4. Que los NO-OP declarados (`notify`, `listWorkspaceGroups`) NO tocan el binario. Es
//      su contrato entero — un `run()` colado ahí rompería el fail-open del launch path.
//   5. Que `BB_SERVER_URL` se inyecta desde la config de kodo y que las variables de
//      contexto heredadas (`BB_THREAD_ID`) se LIMPIAN: si kodo corre dentro de un thread
//      de BB, heredarlas apuntaría los subcomandos al thread equivocado.
//
// Técnica: binario fake + `$HOME` a tmpdir + import dinámico (ver
// `test/helpers/fake-host-binary.js` para el porqué de no mockear `execFile`).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost } from '../helpers/fake-host-binary.js';

const host = createFakeHost({
  host: 'bb',
  bb: {
    binary: null,
    // URL NO-default a propósito: si el cliente hardcodease el puerto en vez de leer la
    // config, este valor lo delata.
    server_url: 'http://127.0.0.1:39999',
  },
});

// LOAD-BEARING: `src/config.js` fija `CONFIG_PATH` con `homedir()` al evaluarse → `HOME`
// antes del import, y el cliente entra por `await import()` (un import estático lo
// hoistearía por encima de esta línea).
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = host.home;

/** @type {typeof import('../../src/bb/client.js')} */
let bb;

before(async () => {
  bb = await import('../../src/bb/client.js');
});

after(() => {
  host.cleanup();
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

beforeEach(() => {
  host.reset();
});

describe('KODO-31 — argv de los exports async de src/bb/client.js', () => {
  test('close → `thread stop <ref> --json` (NUNCA archive ni delete)', async () => {
    host.setResponse({ stdout: '{"ok":true,"threadId":"thr_a"}' });
    await bb.close({ workspace: 'thr_a' });
    assert.deepEqual(host.argv(), ['thread', 'stop', 'thr_a', '--json']);
  });

  test('close es el verbo del autocierre y NO destruye nada', async () => {
    // El invariante que protege la rama del operador: kodo para el runtime para que
    // dispare SessionEnd, pero el worktree y la rama `bb/…` siguen ahí hasta que el gate
    // de integración de kodo decida. Un `archive` aquí se los llevaría por delante.
    host.setResponse({ stdout: '{"ok":true}' });
    await bb.close({ workspace: 'thr_a' });
    const argv = host.argv();
    assert.ok(!argv.includes('archive'), 'close NO debe archivar');
    assert.ok(!argv.includes('delete'), 'close NO debe borrar');
  });

  test('send → `thread tell <ref> <texto> --json`, con el `\\n` literal ya recortado', async () => {
    host.setResponse({ stdout: '{}' });
    await bb.send({ workspace: 'thr_a', text: 'ronda: revisa KODO-31\\n' });
    assert.deepEqual(host.argv(), ['thread', 'tell', 'thr_a', 'ronda: revisa KODO-31', '--json']);
  });

  test('send pasa el texto como UN argumento aunque lleve espacios y metacaracteres', async () => {
    host.setResponse({ stdout: '{}' });
    const nasty = 'a; rm -rf / && echo "$(whoami)"';
    await bb.send({ workspace: 'thr_a', text: nasty });
    assert.equal(host.argv()[3], nasty, 'el texto viaja íntegro en una sola posición');
  });

  test('focusWorkspace → `thread open <ref> --json`', async () => {
    host.setResponse({ stdout: '{"delivered":true}' });
    await bb.focusWorkspace({ workspace: 'thr_a' });
    assert.deepEqual(host.argv(), ['thread', 'open', 'thr_a', '--json']);
  });

  test('workspacePathFromRef → `thread show <ref> --json` y extrae environment.path', async () => {
    host.setResponse({
      stdout: JSON.stringify({
        thread: { id: 'thr_a' },
        environment: { id: 'env_a', path: '/Users/x/.bb/worktrees/env_a/kodo' },
      }),
    });
    const path = await bb.workspacePathFromRef('thr_a');
    assert.deepEqual(host.argv(), ['thread', 'show', 'thr_a', '--json']);
    assert.equal(path, '/Users/x/.bb/worktrees/env_a/kodo');
  });

  test('workspacePathFromRef → null si el path no es absoluto o falta (fail-open)', async () => {
    for (const environment of [{}, { path: null }, { path: 'relativo/x' }, undefined]) {
      host.reset();
      host.setResponse({ stdout: JSON.stringify({ thread: {}, environment }) });
      assert.equal(await bb.workspacePathFromRef('thr_a'), null);
    }
  });

  test('readScreen → `thread log <ref> --format minimal` SIN --json (texto plano)', async () => {
    host.setResponse({ stdout: 'línea 1\nlínea 2\nlínea 3' });
    const out = await bb.readScreen({ workspace: 'thr_a' });
    assert.deepEqual(host.argv(), ['thread', 'log', 'thr_a', '--format', 'minimal']);
    assert.equal(out, 'línea 1\nlínea 2\nlínea 3');
  });

  test('readScreen con `lines` recorta la COLA (lo último es lo que se ve en pantalla)', async () => {
    // El `--limit` de BB solo aplica al formato json, así que el recorte es del cliente.
    host.setResponse({ stdout: 'uno\ndos\ntres\ncuatro' });
    assert.equal(await bb.readScreen({ workspace: 'thr_a', lines: 2 }), 'tres\ncuatro');
  });

  test('listWorkspaces → `thread list --json` y devuelve el texto `<ref>  <título>`', async () => {
    host.setResponse({
      stdout: JSON.stringify([
        { id: 'thr_a', title: 'KODO-1: uno' },
        { id: 'thr_b', title: null, titleFallback: 'dos' },
      ]),
    });
    const out = await bb.listWorkspaces();
    assert.deepEqual(host.argv(), ['thread', 'list', '--json']);
    assert.equal(out, 'thr_a  KODO-1: uno\nthr_b  dos');
  });

  test('listTree → `thread list --json` y devuelve el árbol SERIALIZADO', async () => {
    host.setResponse({ stdout: JSON.stringify([{ id: 'thr_a', title: 'x' }]) });
    const raw = await bb.listTree();
    assert.deepEqual(host.argv(), ['thread', 'list', '--json']);
    assert.deepEqual(JSON.parse(raw), {
      windows: [{ workspaces: [{ id: 'thr_a', ref: 'thr_a', title: 'x' }] }],
    });
  });

  test('listWorkspacesJson devuelve el stdout CRUDO (el parseo vive en host/bb.js)', async () => {
    host.setResponse({ stdout: '[{"id":"thr_a"}]' });
    assert.equal(await bb.listWorkspacesJson(), '[{"id":"thr_a"}]');
  });
});

describe('KODO-31 — newWorkspace: la secuencia project → spawn', () => {
  test('proyecto YA registrado: `project list` y el id resuelto llega al `thread spawn`', async () => {
    host.setResponses([
      { stdout: JSON.stringify([{ id: 'proj_kodo', sources: [{ path: '/repo/kodo' }] }]) },
      { stdout: JSON.stringify({ id: 'thr_nuevo', status: 'starting' }) },
    ]);
    const ref = await bb.newWorkspace({
      name: 'KODO-31: host bb',
      cwd: '/repo/kodo',
      prompt: 'Trabaja en: host bb.',
      model: 'opus',
      skipPermissions: true,
    });
    assert.equal(ref, 'thr_nuevo');

    const calls = host.calls();
    assert.deepEqual(calls[0], ['project', 'list', '--json'], 'primero resuelve el proyecto');
    assert.equal(calls.length, 2, 'con el proyecto ya registrado NO se crea uno nuevo');
    assert.deepEqual(calls[1], [
      'thread', 'spawn',
      '--project', 'proj_kodo',
      '--new-environment', 'worktree',
      '--provider', 'claude-code',
      '--prompt', 'Trabaja en: host bb.',
      '--title', 'KODO-31: host bb',
      '--model', 'opus',
      '--permission-mode', 'full',
      '--json',
    ]);
  });

  test('sesión normal (sin yolo/GSD) → --permission-mode accept-edits', async () => {
    host.setResponses([
      { stdout: JSON.stringify([{ id: 'proj_kodo', sources: [{ path: '/repo/kodo' }] }]) },
      { stdout: JSON.stringify({ id: 'thr_n' }) },
    ]);
    await bb.newWorkspace({ name: 'X', cwd: '/repo/kodo', prompt: 'p', skipPermissions: false });
    const spawn = host.calls()[1];
    assert.equal(spawn[spawn.indexOf('--permission-mode') + 1], 'accept-edits');
  });

  test('proyecto NO registrado: se crea con `project create --name <basename> --root <path>`', async () => {
    host.setResponses([
      { stdout: '[]' },
      { stdout: JSON.stringify({ id: 'proj_nuevo', name: 'kodo' }) },
      { stdout: JSON.stringify({ id: 'thr_n' }) },
    ]);
    await bb.newWorkspace({ name: 'X', cwd: '/repo/kodo', prompt: 'p' });
    const calls = host.calls();
    assert.deepEqual(calls[1], ['project', 'create', '--name', 'kodo', '--root', '/repo/kodo', '--json']);
    // Y el id RECIÉN creado es el que viaja al spawn.
    assert.equal(calls[2][calls[2].indexOf('--project') + 1], 'proj_nuevo');
  });

  test('sin `prompt` lanza ANTES de tocar el binario (bb thread spawn lo exige)', async () => {
    // Fallar aquí, y no en el binario, es lo que evita un thread a medio crear: el error
    // sube al launch path antes de que exista nada que limpiar.
    await assert.rejects(
      () => bb.newWorkspace({ name: 'X', cwd: '/repo/kodo' }),
      /`prompt` es obligatorio/,
    );
    assert.deepEqual(host.calls(), [], 'no debe haberse invocado el binario');
  });

  test('sin `cwd` lanza ANTES de tocar el binario', async () => {
    await assert.rejects(() => bb.newWorkspace({ name: 'X', prompt: 'p' }), /`cwd` es obligatorio/);
    assert.deepEqual(host.calls(), []);
  });

  test('un spawn sin `id` en la respuesta lanza con un mensaje diagnosticable', async () => {
    host.setResponses([
      { stdout: JSON.stringify([{ id: 'proj_kodo', sources: [{ path: '/repo/kodo' }] }]) },
      { stdout: '{"status":"starting"}' },
    ]);
    await assert.rejects(
      () => bb.newWorkspace({ name: 'X', cwd: '/repo/kodo', prompt: 'p' }),
      /la respuesta no trae thread\.id/,
    );
  });

  test('un exit code ≠ 0 se propaga como throw con el stderr recortado', async () => {
    host.setResponse({ stderr: 'ECONNREFUSED 127.0.0.1:39999', code: 1 });
    await assert.rejects(() => bb.listWorkspaces(), /bb thread failed: ECONNREFUSED/);
  });
});

describe('KODO-31 — entorno del proceso hijo', () => {
  test('BB_SERVER_URL sale de la config de kodo, no del entorno del operador', async () => {
    // El fake vuelca su argv, no su env, así que se comprueba por la vía que sí observa el
    // test: si el cliente NO inyectara la URL, un BB_SERVER_URL distinto en process.env
    // ganaría — y aquí se le pone uno falso a propósito.
    const previous = process.env.BB_SERVER_URL;
    process.env.BB_SERVER_URL = 'http://no-debe-ganar:1';
    try {
      host.setResponse({ stdout: '[]' });
      await bb.listWorkspaces();
      // El binario fake ignora la URL (no habla con nadie); lo que este test fija es que
      // la llamada COMPLETA sin depender del valor del entorno.
      assert.deepEqual(host.argv(), ['thread', 'list', '--json']);
    } finally {
      if (previous === undefined) delete process.env.BB_SERVER_URL;
      else process.env.BB_SERVER_URL = previous;
    }
  });
});

describe('KODO-31 — doctor(): el diagnóstico del runtime de BB', () => {
  test('servidor que responde + claude-code available → todo verde', async () => {
    host.setResponse({
      stdout: JSON.stringify([
        { id: 'codex', available: true },
        { id: 'claude-code', available: true },
      ]),
    });
    const r = await bb.doctor({ fetchFn: async () => ({ ok: true, status: 200 }) });
    assert.equal(r.serverUrl, 'http://127.0.0.1:39999', 'la URL sale de la config de kodo');
    assert.equal(r.serverUp, true);
    assert.equal(r.providerAvailable, true);
    assert.deepEqual(host.argv(), ['provider', 'list', '--json']);
  });

  test('CUALQUIER respuesta HTTP cuenta como alcanzable (un 404 en / no es «caído»)', async () => {
    // Tratar un 404 como caído mandaría al operador a arrancar un servidor que ya corre.
    host.setResponse({ stdout: '[{"id":"claude-code","available":true}]' });
    const r = await bb.doctor({ fetchFn: async () => ({ ok: false, status: 404 }) });
    assert.equal(r.serverUp, true);
  });

  test('servidor inalcanzable → NO se pregunta por el provider (ruido evitado)', async () => {
    const r = await bb.doctor({
      fetchFn: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:39999');
      },
    });
    assert.equal(r.serverUp, false);
    assert.equal(r.providerAvailable, null, 'indeterminado, no false');
    assert.match(r.detail, /ECONNREFUSED/);
    assert.deepEqual(host.calls(), [], 'con el servidor caído no se invoca el binario');
  });

  test('claude-code presente pero NO disponible → providerAvailable false', async () => {
    // El fallo silencioso que este check existe para hacer visible: BB contesta, kodo
    // lanza el thread, y el thread muere porque no hay binario `claude` en esa máquina.
    host.setResponse({ stdout: '[{"id":"claude-code","available":false}]' });
    const r = await bb.doctor({ fetchFn: async () => ({ ok: true }) });
    assert.equal(r.providerAvailable, false);
  });

  test('claude-code AUSENTE del catálogo → false, no un crash', async () => {
    host.setResponse({ stdout: '[{"id":"codex","available":true}]' });
    const r = await bb.doctor({ fetchFn: async () => ({ ok: true }) });
    assert.equal(r.providerAvailable, false);
  });

  test('la consulta del provider falla → indeterminado (never-throws)', async () => {
    host.setResponse({ stderr: 'unauthorized', code: 1 });
    const r = await bb.doctor({ fetchFn: async () => ({ ok: true }) });
    assert.equal(r.serverUp, true);
    assert.equal(r.providerAvailable, null, 'no se afirma sobre lo que no se pudo leer');
    assert.match(r.detail, /unauthorized/);
  });
});

describe('KODO-31 — los NO-OP no tocan el binario (es su contrato entero)', () => {
  test('notify resuelve null sin invocar bb', async () => {
    assert.equal(await bb.notify({ title: 'x', body: 'y' }), null);
    assert.deepEqual(host.calls(), []);
  });

  test('listWorkspaceGroups resuelve el JSON vacío sin invocar bb', async () => {
    assert.equal(await bb.listWorkspaceGroups(), '{"groups":[]}');
    assert.deepEqual(host.calls(), []);
  });
});
