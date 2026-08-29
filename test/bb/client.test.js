// test/bb/client.test.js
// KODO-31 — funciones PURAS de src/bb/client.js. Hermano de test/orca/client.test.js.
//
// Este fichero cubre solo lo que no toca el binario: construcción de argv, parseo,
// normalización y traducciones. El argv que SALE hacia el binario real se cubre en
// test/bb/client-exec.test.js con el fake host.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJson,
  permissionModeFor,
  buildSpawnArgs,
  findProjectIdByPath,
  stripTrailingNewlineEscape,
  formatThreadList,
  threadTitle,
  buildTreeFromThreads,
} from '../../src/bb/client.js';

describe('parseJson — BB no tiene sobre; el fallo viaja por exit code', () => {
  test('devuelve el payload tal cual (array plano)', () => {
    assert.deepEqual(parseJson('[{"id":"thr_a"}]'), [{ id: 'thr_a' }]);
  });

  test('un objeto también pasa (thread show / spawn)', () => {
    assert.deepEqual(parseJson('{"id":"thr_a"}'), { id: 'thr_a' });
  });

  test('stdout no-JSON lanza con un mensaje DIAGNOSTICABLE (incluye el prefijo del stdout)', () => {
    // El caso real: un binario que escupe un aviso de actualización antes del payload.
    assert.throws(
      () => parseJson('npm notice New version available\n[]', 'bb thread list'),
      /bb thread list: respuesta no-JSON de bb \(npm notice/,
    );
  });
});

describe('permissionModeFor — traducción al vocabulario de permisos de BB', () => {
  test('yolo / GSD → full', () => {
    assert.equal(permissionModeFor(true), 'full');
  });

  test('sesión normal → accept-edits', () => {
    assert.equal(permissionModeFor(false), 'accept-edits');
  });

  test('los dos valores están en el catálogo de claude-code de BB', () => {
    // Verificado contra `bb provider list --json` → capabilities.permissionModes:
    // ['accept-edits', 'auto', 'full']. Emitir un modo fuera del set haría fallar el spawn.
    const CATALOG = new Set(['accept-edits', 'auto', 'full']);
    assert.ok(CATALOG.has(permissionModeFor(true)));
    assert.ok(CATALOG.has(permissionModeFor(false)));
  });
});

describe('buildSpawnArgs — argv determinista de `thread spawn`', () => {
  test('emite los obligatorios en orden estable, aun sin opcionales', () => {
    assert.deepEqual(
      buildSpawnArgs({ projectId: 'proj_x', prompt: 'Trabaja en: X.' }),
      [
        'thread', 'spawn',
        '--project', 'proj_x',
        '--new-environment', 'worktree',
        '--provider', 'claude-code',
        '--prompt', 'Trabaja en: X.',
      ],
    );
  });

  test('`--new-environment worktree` SIEMPRE (es la razón de HOSTS_WITH_OWN_WORKTREE)', () => {
    // Sin este flag BB lanzaría el thread sobre el workspace personal y kodo, que ya omite
    // `claude --worktree` para este host, dejaría la sesión sin ningún aislamiento.
    const args = buildSpawnArgs({ projectId: 'p', prompt: 'x' });
    const i = args.indexOf('--new-environment');
    assert.notEqual(i, -1);
    assert.equal(args[i + 1], 'worktree');
  });

  test('`--provider claude-code` SIEMPRE (kodo solo sabe leer sus hooks)', () => {
    const args = buildSpawnArgs({ projectId: 'p', prompt: 'x' });
    const i = args.indexOf('--provider');
    assert.equal(args[i + 1], 'claude-code');
  });

  test('los opcionales solo aparecen si traen valor', () => {
    const args = buildSpawnArgs({
      projectId: 'proj_x',
      prompt: 'p',
      title: 'KODO-31: host bb',
      model: 'opus',
      permissionMode: 'full',
      baseBranch: 'main',
    });
    assert.deepEqual(args.slice(10), [
      '--title', 'KODO-31: host bb',
      '--model', 'opus',
      '--permission-mode', 'full',
      '--base-branch', 'main',
    ]);
  });

  test('el modelo viaja como ALIAS de kodo sin traducir (BB acepta ids no catalogados)', () => {
    for (const model of ['opus', 'sonnet', 'haiku', 'fable']) {
      const args = buildSpawnArgs({ projectId: 'p', prompt: 'x', model });
      assert.equal(args[args.indexOf('--model') + 1], model);
    }
  });

  test('contenido no confiable viaja como UN argumento, sin escapar ni interpolar', () => {
    // El título y el prompt salen de Plane/LLM. Con execFile cada uno es un elemento del
    // array, así que un `; rm -rf /` es texto y nada más. Este test fija esa propiedad en
    // la construcción: el valor llega ÍNTEGRO y en una sola posición.
    const nasty = 'KODO-1: $(rm -rf /) && echo "; --provider codex"';
    const args = buildSpawnArgs({ projectId: 'p', prompt: nasty, title: nasty });
    assert.equal(args[args.indexOf('--prompt') + 1], nasty);
    assert.equal(args[args.indexOf('--title') + 1], nasty);
    // Y no se ha colado un segundo --provider por la vía del contenido.
    assert.equal(args.filter((a) => a === '--provider').length, 1);
  });
});

describe('findProjectIdByPath — resolución repo → proyecto de BB', () => {
  const PROJECTS = [
    { id: 'proj_otro', sources: [{ path: '/Users/x/dev/otro', isDefault: true }] },
    {
      id: 'proj_kodo',
      sources: [
        { path: '/Users/x/dev/kodo', isDefault: true },
        { path: '/Users/x/dev/kodo-mirror', isDefault: false },
      ],
    },
  ];

  test('matchea por igualdad exacta de path, en cualquier source', () => {
    assert.equal(findProjectIdByPath(PROJECTS, '/Users/x/dev/kodo'), 'proj_kodo');
    assert.equal(findProjectIdByPath(PROJECTS, '/Users/x/dev/kodo-mirror'), 'proj_kodo');
    assert.equal(findProjectIdByPath(PROJECTS, '/Users/x/dev/otro'), 'proj_otro');
  });

  test('NO matchea por prefijo: un repo anidado es otro proyecto', () => {
    // Un match por prefijo lanzaría las sesiones del sub-repo dentro del worktree del
    // padre — y ahí el worktree que BB crea no contendría el código que la tarea toca.
    assert.equal(findProjectIdByPath(PROJECTS, '/Users/x/dev/kodo/packages/bar'), null);
    assert.equal(findProjectIdByPath(PROJECTS, '/Users/x/dev'), null);
  });

  test('never-throws ante shapes inesperados', () => {
    for (const input of [null, undefined, 42, {}, [null], [{ id: 5 }], [{ id: 'p' }]]) {
      assert.doesNotThrow(() => findProjectIdByPath(input, '/x'));
      assert.equal(findProjectIdByPath(input, '/x'), null);
    }
  });

  test('un path vacío nunca matchea (evita cazar la primera source con path falsy)', () => {
    assert.equal(findProjectIdByPath([{ id: 'p', sources: [{ path: '' }] }], ''), null);
  });
});

describe('stripTrailingNewlineEscape — normalización del carril compartido con cmux', () => {
  test('quita el `\\n` LITERAL del final (convención de cmux send)', () => {
    assert.equal(stripTrailingNewlineEscape('hola\\n'), 'hola');
  });

  test('respeta un `\\n` literal en MEDIO del texto (es contenido)', () => {
    assert.equal(stripTrailingNewlineEscape('a\\nb'), 'a\\nb');
  });

  test('deja intacto un salto de línea real', () => {
    assert.equal(stripTrailingNewlineEscape('hola\n'), 'hola\n');
  });

  test('never-throws ante no-strings', () => {
    assert.equal(stripTrailingNewlineEscape(null), '');
    assert.equal(stripTrailingNewlineEscape(undefined), '');
  });
});

describe('threadTitle / formatThreadList — el contrato de texto que consume health.js', () => {
  test('threadTitle prefiere `title` y cae a `titleFallback`', () => {
    assert.equal(threadTitle({ title: 'A', titleFallback: 'B' }), 'A');
    assert.equal(threadTitle({ title: null, titleFallback: 'B' }), 'B');
    assert.equal(threadTitle({ title: '', titleFallback: 'B' }), 'B', 'un title vacío no gana');
    assert.equal(threadTitle({}), undefined);
  });

  test('formatThreadList emite `<ref>  <título>` por línea', () => {
    const out = formatThreadList([
      { id: 'thr_a', title: 'KODO-1: uno' },
      { id: 'thr_b', title: null, titleFallback: 'dos' },
    ]);
    assert.equal(out, 'thr_a  KODO-1: uno\nthr_b  dos');
  });

  test('el ref va LITERAL: health.js decide presencia con `includes(workspace_ref)`', () => {
    const out = formatThreadList([{ id: 'thr_abc123', title: 'x' }]);
    assert.ok(out.includes('thr_abc123'));
  });

  test('un thread sin título no deja espacios colgando al final', () => {
    assert.equal(formatThreadList([{ id: 'thr_a' }]), 'thr_a');
  });

  test('filas null / sin id se filtran; never-throws', () => {
    assert.doesNotThrow(() => formatThreadList([null, { title: 'x' }, 42]));
    assert.equal(formatThreadList([null, { title: 'x' }]), '');
    assert.equal(formatThreadList(null), '');
  });
});

describe('buildTreeFromThreads — vista de identidad del orquestador', () => {
  test('emite id === ref (en BB el ref YA es identidad estable)', () => {
    const tree = buildTreeFromThreads([{ id: 'thr_a', title: 'KODO-1: uno' }]);
    const ws = tree.windows[0].workspaces[0];
    assert.equal(ws.id, 'thr_a');
    assert.equal(ws.ref, 'thr_a');
    assert.equal(ws.title, 'KODO-1: uno');
  });

  test('un único window sintético (BB no tiene ese eje)', () => {
    const tree = buildTreeFromThreads([{ id: 'a' }, { id: 'b' }]);
    assert.equal(tree.windows.length, 1);
    assert.equal(tree.windows[0].workspaces.length, 2);
  });

  test('title null cuando el thread no tiene ninguno (el consumidor lo espera nullable)', () => {
    assert.equal(buildTreeFromThreads([{ id: 'a' }]).windows[0].workspaces[0].title, null);
  });

  test('never-throws ante shapes inesperados → árbol vacío', () => {
    for (const input of [null, undefined, 42, {}]) {
      assert.doesNotThrow(() => buildTreeFromThreads(input));
      assert.deepEqual(buildTreeFromThreads(input), { windows: [{ workspaces: [] }] });
    }
  });
});
