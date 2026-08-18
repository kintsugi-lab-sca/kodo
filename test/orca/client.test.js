// test/orca/client.test.js
// KODO-18 — funciones PURAS de src/orca/client.js.
//
// El módulo resuelve el binario desde loadConfig() y no tiene seam de DI sobre
// execFile (misma limitación que src/cmux/client.js), así que aquí se ejercitan las
// piezas puras: el desempaquetado del sobre JSON, la normalización de selectores, el
// slug de rama, el argv de creación, la elección de terminal y el formateo de la lista.
// Son exactamente las que deciden si un comando sale bien formado hacia el binario.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  unwrapEnvelope,
  worktreeSelector,
  slugifyWorktreeName,
  buildCreateWorktreeArgs,
  pickTerminalHandle,
  formatWorkspaceList,
  statusForState,
  stripTrailingNewlineEscape,
  buildTreeFromPs,
} from '../../src/orca/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures', 'orca');
const PS = JSON.parse(readFileSync(join(FIXTURES, 'worktree-ps.json'), 'utf-8'));
const TERMINALS = JSON.parse(readFileSync(join(FIXTURES, 'terminal-list.json'), 'utf-8'));

describe('unwrapEnvelope — sobre JSON de orca', () => {
  test('ok:true → devuelve `result`', () => {
    assert.deepEqual(unwrapEnvelope('{"id":"x","ok":true,"result":{"a":1}}'), { a: 1 });
  });

  test('ok:true sin result → objeto vacío (comandos sin payload)', () => {
    assert.deepEqual(unwrapEnvelope('{"id":"x","ok":true}'), {});
  });

  test('ok:false → lanza con el code y el message del sobre', () => {
    const raw = '{"id":"x","ok":false,"error":{"code":"runtime_unavailable","message":"Start the Orca app first."}}';
    assert.throws(() => unwrapEnvelope(raw, 'orca worktree ps'), /runtime_unavailable/);
    assert.throws(() => unwrapEnvelope(raw, 'orca worktree ps'), /Start the Orca app first/);
  });

  test('stdout no-JSON → lanza sin dejar escapar el SyntaxError crudo', () => {
    assert.throws(() => unwrapEnvelope('command not found', 'orca status'), /respuesta no-JSON/);
  });

  test('un sobre SIN `ok` no se acepta como éxito', () => {
    // Defensa: un binario viejo que devolviera JSON pelado no debe colar como ok.
    assert.throws(() => unwrapEnvelope('{"worktrees":[]}'), /unknown_error/);
  });
});

describe('worktreeSelector — normalización del ref al selector de orca', () => {
  test('un ref desnudo se prefija con `id:`', () => {
    assert.equal(worktreeSelector('repo-a::/repos/alpha'), 'id:repo-a::/repos/alpha');
  });

  test('es idempotente sobre un ref ya prefijado', () => {
    assert.equal(worktreeSelector('id:repo-a::/repos/alpha'), 'id:repo-a::/repos/alpha');
  });

  test('respeta los demás selectores de orca sin envolverlos', () => {
    for (const sel of ['active', 'current', 'path:/repos/alpha', 'name:mi-tarea', 'branch:main']) {
      assert.equal(worktreeSelector(sel), sel);
    }
  });

  test('never-throws ante entrada degenerada', () => {
    assert.doesNotThrow(() => worktreeSelector(undefined));
    assert.doesNotThrow(() => worktreeSelector(null));
  });
});

describe('slugifyWorktreeName — el `--name` de orca se materializa como RAMA git', () => {
  test('el nombre real de un workspace kodo produce un slug válido', () => {
    // `${task.ref}: ${title}` es literalmente lo que arma session/manager.js.
    assert.equal(
      slugifyWorktreeName('KODO-18: Añadir Orca como cliente elegible'),
      'kodo-18-anadir-orca-como-cliente-elegible',
    );
  });

  test('el prefijo de módulo (corchetes) no rompe la rama', () => {
    assert.equal(slugifyWorktreeName('ROMAN-170 [FVF]: revisar'), 'roman-170-fvf-revisar');
  });

  test('sin espacios, `:`, ni `-` de borde (rechazados por git)', () => {
    const slug = slugifyWorktreeName('  ::KODO-1:: ');
    assert.doesNotMatch(slug, /\s/);
    assert.doesNotMatch(slug, /:/);
    assert.doesNotMatch(slug, /^-|-$/);
  });

  test('trunca a 48 caracteres sin dejar un `-` colgando', () => {
    const slug = slugifyWorktreeName('x'.repeat(30) + ' ' + 'y'.repeat(60));
    assert.ok(slug.length <= 48, `longitud ${slug.length}`);
    assert.doesNotMatch(slug, /-$/);
  });

  test('entrada degenerada → fallback estable, nunca vacío', () => {
    for (const raw of ['', '   ', '???', null, undefined, 42, {}]) {
      const slug = slugifyWorktreeName(raw);
      assert.ok(slug.length > 0, `slug vacío para ${JSON.stringify(raw)}`);
    }
    assert.equal(slugifyWorktreeName('???'), 'kodo-session');
  });
});

describe('buildCreateWorktreeArgs — argv de `worktree create`', () => {
  test('argv determinista con repo, nombre slugificado y --no-parent', () => {
    assert.deepEqual(
      buildCreateWorktreeArgs({ name: 'KODO-18: probar', cwd: '/repos/alpha' }),
      ['worktree', 'create', '--repo', 'path:/repos/alpha', '--name', 'kodo-18-probar', '--no-parent'],
    );
  });

  test('--no-parent SIEMPRE: kodo lanza trabajo independiente, no stacked', () => {
    // Sin esta flag Orca infiere el worktree padre del cwd del daemon y encadena
    // todas las sesiones entre sí.
    assert.ok(buildCreateWorktreeArgs({ name: 'x', cwd: '/r' }).includes('--no-parent'));
  });

  test('--base-branch solo aparece cuando se pide', () => {
    assert.ok(!buildCreateWorktreeArgs({ name: 'x', cwd: '/r' }).includes('--base-branch'));
    const args = buildCreateWorktreeArgs({ name: 'x', cwd: '/r', baseBranch: 'origin/dev' });
    assert.equal(args[args.indexOf('--base-branch') + 1], 'origin/dev');
  });

  test('el argv es un array PLANO de strings (execFile sin shell, cero inyección)', () => {
    const args = buildCreateWorktreeArgs({ name: 'x"; rm -rf /', cwd: '/r' });
    for (const a of args) assert.equal(typeof a, 'string');
    // El nombre hostil queda neutralizado por el slug, y jamás se interpola en un string.
    assert.equal(args[args.indexOf('--name') + 1], 'x-rm-rf');
  });
});

describe('pickTerminalHandle — a qué terminal teclea kodo', () => {
  test('gana el conectado+escribible NO huérfano, aunque el huérfano vaya primero', () => {
    assert.equal(pickTerminalHandle(TERMINALS.result), 'term_kodo42');
  });

  test('sin candidato ideal cae al primero conectado', () => {
    const only = { terminals: [{ handle: 'term_a', connected: true, writable: false, orphaned: true }] };
    assert.equal(pickTerminalHandle(only), 'term_a');
  });

  test('shape inesperado o lista vacía → null (never-throws)', () => {
    for (const bad of [undefined, null, {}, { terminals: null }, { terminals: [] }, { terminals: [null] }]) {
      assert.doesNotThrow(() => pickTerminalHandle(bad));
      assert.equal(pickTerminalHandle(bad), null);
    }
  });

  test('descarta entradas sin handle string', () => {
    assert.equal(pickTerminalHandle({ terminals: [{ handle: 42, connected: true }] }), null);
  });
});

describe('formatWorkspaceList — compat con el `cmux workspace list` de texto plano', () => {
  test('emite el ref LITERAL para que el `includes` de health.js siga funcionando', () => {
    const text = formatWorkspaceList(PS.result);
    // session/health.js decide si un workspace existe con
    // `workspaceList.includes(session.workspace_ref)`.
    assert.ok(text.includes('repo-b::/orca/workspaces/beta/kodo-42'));
    assert.ok(text.includes('KODO-42: arreglar el login'));
  });

  test('una línea por workspace', () => {
    assert.equal(formatWorkspaceList(PS.result).split('\n').length, PS.result.worktrees.length);
  });

  test('shape inesperado → string vacío (never-throws)', () => {
    for (const bad of [undefined, null, {}, { worktrees: 'x' }]) {
      assert.doesNotThrow(() => formatWorkspaceList(bad));
      assert.equal(formatWorkspaceList(bad), '');
    }
  });
});

describe('statusForState — estado de kodo → columna del tablero de Orca', () => {
  const statuses = { running: 'in-progress', done: 'completed', error: 'in-progress', review: 'in-review' };

  test('mapea los cuatro estados desde el mapa de config', () => {
    assert.equal(statusForState('running', statuses), 'in-progress');
    assert.equal(statusForState('done', statuses), 'completed');
    assert.equal(statusForState('review', statuses), 'in-review');
    assert.equal(statusForState('error', statuses), 'in-progress');
  });

  test('un estado desconocido cae a in-progress en vez de mandar un id vacío a orca', () => {
    assert.equal(statusForState(/** @type {any} */ ('zzz'), statuses), 'in-progress');
    assert.equal(statusForState('running', {}), 'in-progress');
  });
});

describe('stripTrailingNewlineEscape — convención de keystroke compartida con cmux', () => {
  test('quita el `\\n` LITERAL final que los call sites compartidos añaden para cmux', () => {
    // `hooks/stop.js` y `session/manager.js` rematan el nudge con `\\n` porque `cmux send`
    // lo interpreta como Enter. Orca usa la flag `--enter`, así que sin este saneo el
    // terminal recibiría dos caracteres imprimibles al final de la línea.
    assert.equal(stripTrailingNewlineEscape('KL-1 está en Review.\\n'), 'KL-1 está en Review.');
  });

  test('un `\\n` literal EN MEDIO es contenido y se respeta', () => {
    assert.equal(stripTrailingNewlineEscape('a\\nb'), 'a\\nb');
  });

  test('un texto sin el sufijo pasa intacto', () => {
    assert.equal(stripTrailingNewlineEscape('claude --model opus'), 'claude --model opus');
  });

  test('no toca un salto de línea REAL final (no es el escape)', () => {
    assert.equal(stripTrailingNewlineEscape('hola\n'), 'hola\n');
  });

  test('never-throws ante entrada degenerada', () => {
    for (const raw of [undefined, null, 42]) {
      assert.doesNotThrow(() => stripTrailingNewlineEscape(raw));
      assert.equal(typeof stripTrailingNewlineEscape(raw), 'string');
    }
  });
});

describe('buildTreeFromPs — `worktree ps` traducido al shape de árbol de cmux', () => {
  test('emite un único window sintético con todos los worktrees', () => {
    const tree = buildTreeFromPs(PS.result);
    assert.equal(tree.windows.length, 1, 'Orca no tiene eje de windows');
    assert.equal(tree.windows[0].workspaces.length, PS.result.worktrees.length);
  });

  test('id === ref: en Orca el ref YA es identidad estable, no hay UUID aparte', () => {
    // Esto es lo que hace que el carril anti-duplicado del orquestador (que en cmux
    // necesita un UUID porque los `workspace:N` se reciclan) funcione sin ramificar.
    for (const ws of buildTreeFromPs(PS.result).windows[0].workspaces) {
      assert.equal(ws.id, ws.ref);
      assert.equal(typeof ws.ref, 'string');
    }
  });

  test('title ← displayName', () => {
    const ws = buildTreeFromPs(PS.result).windows[0].workspaces
      .find((w) => w.ref === 'repo-b::/orca/workspaces/beta/kodo-42');
    assert.equal(ws.title, 'KODO-42: arreglar el login');
  });

  test('el resultado alimenta findWorkspaceInTree sin adaptación', async () => {
    // El contrato REAL de esta función: que el consumidor del orquestador la digiera.
    const { findWorkspaceInTree } = await import('../../src/orchestrator/launch.js');
    const hit = findWorkspaceInTree(buildTreeFromPs(PS.result), {
      id: 'repo-b::/orca/workspaces/beta/kodo-42',
    });
    assert.ok(hit, 'el workspace registrado se encuentra por identidad');
    assert.equal(hit.ref, 'repo-b::/orca/workspaces/beta/kodo-42');
  });

  test('shape inesperado → árbol vacío, nunca lanza', () => {
    for (const bad of [undefined, null, {}, { worktrees: 'x' }, { worktrees: [null] }]) {
      assert.doesNotThrow(() => buildTreeFromPs(bad));
      assert.deepEqual(buildTreeFromPs(bad).windows[0].workspaces, []);
    }
  });
});
