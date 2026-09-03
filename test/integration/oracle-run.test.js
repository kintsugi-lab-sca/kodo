// @ts-check
//
// test/integration/oracle-run.test.js — KODO-69: el núcleo del oráculo mecánico.
//
// TODO por DI: `gitFn`, `execFn`, `tmpRootFn` y `now` entran por parámetro, así que estas
// pruebas ejercitan las cinco ramas sin un repo real, sin `sh` y sin tocar disco. Es el mismo
// seam con el que `capture.test.js` prueba la captura.
//
// Lo que este fichero congela es el CONTRATO del veredicto:
//   - los cuatro estados por check, y que `skip` NO es `unknown`;
//   - la precedencia `fail > unknown > pass`, y que cinco `skip` es `unknown` y jamás `pass`;
//   - que un `setup` roto degrada a `unknown` y NO a `fail`;
//   - que el worktree desechable se crea sobre el COMMIT y se destruye pase lo que pase;
//   - que ninguna ruta lanza.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_KEYS,
  COMMAND_CHECKS,
  DEFAULT_TIMEOUT_S,
  MAX_DETAIL,
  aggregateVerdict,
  isOracleStale,
  oracleEnabled,
  resolveRepoCommands,
  runningOracle,
  runOracle,
} from '../../src/integration/oracle.js';
import { SCOPE_OPEN, SCOPE_CLOSE } from '../../src/integration/scope.js';

const PROJECT = '/repo';
const BRANCH = 'worktree-abc';
const HEAD = 'a'.repeat(40);

/** Comandos sin nada configurado. */
const NO_COMMANDS = { setup: null, build: null, tests: null, lint: null, schema: null, timeout_s: 60 };

/**
 * `gitFn` de mentira, programable por comando. Registra lo que se le pidió para poder afirmar
 * que el oráculo NO llamó a git de más.
 * @param {Record<string, string|Error>} table
 * @returns {{ fn: (cwd: string, args: string[]) => string, calls: string[][] }}
 */
function fakeGit(table) {
  const calls = [];
  const fn = (cwd, args) => {
    calls.push(args);
    for (const [key, value] of Object.entries(table)) {
      if (args.join(' ').includes(key)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    return '';
  };
  return { fn, calls };
}

describe('aggregateVerdict — la precedencia del veredicto', () => {
  const mk = (statuses) => Object.fromEntries(CHECK_KEYS.map((k, i) => [k, { status: statuses[i], detail: null, ms: null }]));

  it('un `fail` manda sobre todo lo demás', () => {
    assert.equal(aggregateVerdict(mk(['pass', 'fail', 'pass', 'skip', 'pass'])), 'fail');
    assert.equal(aggregateVerdict(mk(['unknown', 'fail', 'skip', 'skip', 'skip'])), 'fail');
  });

  it('un `unknown` degrada aunque todo lo demás pase', () => {
    assert.equal(aggregateVerdict(mk(['pass', 'unknown', 'pass', 'skip', 'pass'])), 'unknown');
  });

  it('CINCO `skip` es `unknown`, JAMÁS `pass` — «sin oráculo configurado ≠ pass»', () => {
    assert.equal(aggregateVerdict(mk(['skip', 'skip', 'skip', 'skip', 'skip'])), 'unknown');
  });

  it('`pass` exige que algo se haya comprobado de verdad', () => {
    assert.equal(aggregateVerdict(mk(['skip', 'pass', 'skip', 'skip', 'skip'])), 'pass');
    assert.equal(aggregateVerdict(mk(['pass', 'pass', 'pass', 'pass', 'pass'])), 'pass');
  });

  it('entrada degenerada → unknown, nunca una excepción', () => {
    assert.equal(aggregateVerdict(null), 'unknown');
    assert.equal(aggregateVerdict(undefined), 'unknown');
    assert.equal(aggregateVerdict('x'), 'unknown');
    assert.equal(aggregateVerdict({}), 'unknown');
  });
});

describe('runningOracle — el marcador de corrida en curso', () => {
  it('su veredicto es `unknown`: una corrida empezada no ha verificado nada', () => {
    const o = runningOracle('2026-09-02T10:00:00.000Z');
    assert.equal(o.state, 'running');
    assert.equal(o.verdict, 'unknown');
    assert.equal(o.commit, null);
    assert.equal(o.finished_at, null);
  });

  it('lleva las 6 claves en ORDEN FIJO (byte-determinismo del --json)', () => {
    assert.deepEqual(Object.keys(runningOracle('2026-09-02T10:00:00.000Z')), [
      'state', 'verdict', 'commit', 'checks', 'started_at', 'finished_at',
    ]);
  });

  it('los checks van en el orden de CHECK_KEYS', () => {
    assert.deepEqual(Object.keys(runningOracle('x').checks), [...CHECK_KEYS]);
  });
});

describe('oracleEnabled — SOLO el literal `false` lo apaga', () => {
  it('apagado explícito', () => {
    assert.equal(oracleEnabled({ oracle: { enabled: false } }), false);
  });

  it('cualquier otra forma cae a ACTIVO (fail-open: el default no ejecuta nada)', () => {
    assert.equal(oracleEnabled({}), true);
    assert.equal(oracleEnabled(null), true);
    assert.equal(oracleEnabled({ oracle: {} }), true);
    assert.equal(oracleEnabled({ oracle: { enabled: 'no' } }), true);
    assert.equal(oracleEnabled({ oracle: { enabled: 0 } }), true);
  });
});

describe('resolveRepoCommands — por repo, claveado por path absoluto', () => {
  const config = {
    oracle: {
      timeout_s: 120,
      repos: {
        '/repo': { setup: 'npm ci', tests: 'npm test', lint: '   ', build: null },
        '/otro': { tests: 'pytest', timeout_s: 30 },
      },
    },
  };

  it('devuelve los comandos del repo pedido y nada del vecino', () => {
    const c = resolveRepoCommands(config, '/repo');
    assert.equal(c.setup, 'npm ci');
    assert.equal(c.tests, 'npm test');
    assert.equal(c.build, null);
    assert.equal(c.schema, null);
  });

  it('un comando en blanco es NO configurado (no un comando que no hace nada)', () => {
    assert.equal(resolveRepoCommands(config, '/repo').lint, null);
  });

  it('la coincidencia es IGUALDAD EXACTA de string — la misma que define «mismo repo»', () => {
    assert.equal(resolveRepoCommands(config, '/repo/').tests, null);
    assert.equal(resolveRepoCommands(config, '/Repo').tests, null);
  });

  it('el timeout del repo pisa el global, y el global al default', () => {
    assert.equal(resolveRepoCommands(config, '/otro').timeout_s, 30);
    assert.equal(resolveRepoCommands(config, '/repo').timeout_s, 120);
    assert.equal(resolveRepoCommands({}, '/repo').timeout_s, DEFAULT_TIMEOUT_S);
  });

  it('config ausente o rota → sin comandos, nunca una excepción', () => {
    for (const c of [null, undefined, {}, { oracle: null }, { oracle: { repos: 'x' } }]) {
      const r = resolveRepoCommands(/** @type {any} */ (c), '/repo');
      for (const k of COMMAND_CHECKS) assert.equal(r[k], null);
    }
  });
});

describe('isOracleStale — el ancla al commit', () => {
  it('desfasado solo cuando hay las dos cosas y NO coinciden', () => {
    assert.equal(isOracleStale({ commit: 'aaa' }, 'bbb'), true);
    assert.equal(isOracleStale({ commit: 'aaa' }, 'aaa'), false);
  });

  it('sin ancla o sin head → NO se inventa un desfase que no se puede demostrar', () => {
    assert.equal(isOracleStale({ commit: null }, 'bbb'), false);
    assert.equal(isOracleStale({ commit: 'aaa' }, null), false);
    assert.equal(isOracleStale(null, 'bbb'), false);
    assert.equal(isOracleStale(undefined, undefined), false);
  });
});

describe('runOracle — la corrida completa', () => {
  it('sin comandos configurados NO crea worktree y solo resuelve `scope`', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': 'src/a.js\n' });
    const r = await runOracle({
      project: PROJECT,
      branch: BRANCH,
      base: 'main',
      commands: NO_COMMANDS,
      planMd: `${SCOPE_OPEN}\n- src/**\n${SCOPE_CLOSE}`,
      gitFn: git.fn,
      execFn: () => assert.fail('no debe ejecutarse ningún comando'),
    });
    assert.equal(r.state, 'done');
    assert.equal(r.commit, HEAD);
    assert.equal(r.checks.scope.status, 'pass');
    for (const k of COMMAND_CHECKS) assert.equal(r.checks[k].status, 'skip');
    assert.equal(r.verdict, 'pass');
    assert.equal(git.calls.some((a) => a[0] === 'worktree'), false, 'no debe crear worktree');
  });

  it('scope FUERA de alcance → fail, y el veredicto entero es fail', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': 'src/a.js\ndb/migrate/1.rb\n' });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main', commands: NO_COMMANDS,
      planMd: `${SCOPE_OPEN}\n- src/**\n${SCOPE_CLOSE}`,
      gitFn: git.fn,
    });
    assert.equal(r.checks.scope.status, 'fail');
    assert.equal(r.verdict, 'fail');
    assert.match(r.checks.scope.detail, /db\/migrate\/1\.rb/);
  });

  it('sin alcance declarado en el plan → scope `skip` y veredicto `unknown` (nada verificado)', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': 'src/a.js\n' });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main', commands: NO_COMMANDS,
      planMd: '# Plan sin bloque\n', gitFn: git.fn,
    });
    assert.equal(r.checks.scope.status, 'skip');
    assert.equal(r.verdict, 'unknown');
  });

  it('sin base resoluble el diff no se pide y el scope declarado queda `unknown`', async () => {
    const git = fakeGit({ 'rev-parse': HEAD });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: null, commands: NO_COMMANDS,
      planMd: `${SCOPE_OPEN}\n- src/**\n${SCOPE_CLOSE}`,
      gitFn: git.fn,
    });
    assert.equal(r.checks.scope.status, 'unknown');
    assert.equal(git.calls.some((a) => a[0] === 'diff'), false);
  });

  it('la rama que no resuelve a un commit → state `error` y los cinco checks `unknown`', async () => {
    const git = fakeGit({ 'rev-parse': '' });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main', commands: NO_COMMANDS, gitFn: git.fn,
    });
    assert.equal(r.state, 'error');
    assert.equal(r.verdict, 'unknown');
    assert.equal(r.commit, null);
    for (const k of CHECK_KEYS) assert.equal(r.checks[k].status, 'unknown');
  });

  it('con comandos: worktree DESECHABLE sobre el COMMIT, y se destruye al terminar', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '' });
    const seen = [];
    await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main',
      commands: { ...NO_COMMANDS, tests: 'npm test' },
      gitFn: git.fn,
      execFn: (cmd, cwd) => { seen.push([cmd, cwd]); return { status: 'pass', detail: '' }; },
      tmpRootFn: () => '/tmp/x',
    });
    const add = git.calls.find((a) => a[0] === 'worktree' && a[1] === 'add');
    assert.ok(add, 'debe crear el worktree');
    assert.equal(add[2], '--detach', '--detach: la rama puede estar checkouteada en otro sitio');
    assert.equal(add[4], HEAD, 'se verifica un COMMIT, no un nombre de rama');
    const remove = git.calls.find((a) => a[0] === 'worktree' && a[1] === 'remove');
    assert.ok(remove, 'debe destruirlo');
    assert.equal(remove[2], '--force');
    assert.equal(seen[0][1], add[3], 'el comando corre DENTRO del worktree desechable');
  });

  it('el worktree se destruye AUNQUE el comando falle', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '' });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main',
      commands: { ...NO_COMMANDS, tests: 'npm test' },
      gitFn: git.fn,
      execFn: () => ({ status: 'fail', detail: 'exit 1: 3 failing' }),
      tmpRootFn: () => '/tmp/x',
    });
    assert.equal(r.checks.tests.status, 'fail');
    assert.equal(r.verdict, 'fail');
    assert.ok(git.calls.some((a) => a[0] === 'worktree' && a[1] === 'remove'));
  });

  it('worktree que NO se puede crear → los checks pedidos quedan `unknown`, no `fail`', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '', 'worktree add': new Error('disco lleno') });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main',
      commands: { ...NO_COMMANDS, tests: 'npm test', lint: 'npm run lint' },
      gitFn: git.fn,
      execFn: () => assert.fail('no debe ejecutarse nada sin worktree'),
      tmpRootFn: () => '/tmp/x',
    });
    assert.equal(r.checks.tests.status, 'unknown');
    assert.equal(r.checks.lint.status, 'unknown');
    assert.equal(r.checks.build.status, 'skip', 'lo NO pedido sigue siendo skip');
    assert.equal(r.verdict, 'unknown');
  });

  it('`setup` que falla degrada a `unknown` y NO a `fail` — un `npm ci` roto no dice nada de los tests', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '' });
    let ran = 0;
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main',
      commands: { ...NO_COMMANDS, setup: 'npm ci', tests: 'npm test' },
      gitFn: git.fn,
      execFn: (cmd) => {
        ran++;
        return cmd === 'npm ci' ? { status: 'fail', detail: 'exit 1: ENOTFOUND registry' } : { status: 'pass', detail: '' };
      },
      tmpRootFn: () => '/tmp/x',
    });
    assert.equal(ran, 1, 'los checks no llegan a correr si el setup no salió');
    assert.equal(r.checks.tests.status, 'unknown');
    assert.match(r.checks.tests.detail, /setup falló/);
    assert.equal(r.verdict, 'unknown');
  });

  it('los cuatro comandos corren en el orden fijo de COMMAND_CHECKS', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '' });
    const order = [];
    await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main',
      commands: { setup: null, build: 'b', tests: 't', lint: 'l', schema: 's', timeout_s: 60 },
      gitFn: git.fn,
      execFn: (cmd) => { order.push(cmd); return { status: 'pass', detail: '' }; },
      tmpRootFn: () => '/tmp/x',
    });
    assert.deepEqual(order, ['b', 't', 'l', 's']);
  });

  it('el `detail` se acota y se sanea (viaja a state.json y a un terminal)', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '' });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main',
      commands: { ...NO_COMMANDS, tests: 't' },
      gitFn: git.fn,
      execFn: () => ({ status: 'fail', detail: `\x1b[31mrojo\x07 ${'x'.repeat(500)}` }),
      tmpRootFn: () => '/tmp/x',
    });
    assert.ok(r.checks.tests.detail.length <= MAX_DETAIL);
    assert.equal(r.checks.tests.detail.includes('\x1b'), false);
    assert.equal(r.checks.tests.detail.includes('\x07'), false);
  });

  it('NEVER-THROWS: un gitFn que revienta entero devuelve state `error`, no una excepción', async () => {
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main', commands: NO_COMMANDS,
      gitFn: () => { throw new Error('boom'); },
    });
    // `revParse` ya es never-throws, así que el camino que se ejerce es el de la rama sin
    // commit: lo que importa es que NADA propaga.
    assert.equal(r.state, 'error');
    assert.equal(r.verdict, 'unknown');
  });

  it('el resultado lleva las 6 claves en ORDEN FIJO y sus 5 checks en el de CHECK_KEYS', async () => {
    const git = fakeGit({ 'rev-parse': HEAD, 'diff --name-only': '' });
    const r = await runOracle({
      project: PROJECT, branch: BRANCH, base: 'main', commands: NO_COMMANDS, gitFn: git.fn,
      now: () => new Date('2026-09-02T10:00:00.000Z'),
    });
    assert.deepEqual(Object.keys(r), ['state', 'verdict', 'commit', 'checks', 'started_at', 'finished_at']);
    assert.deepEqual(Object.keys(r.checks), [...CHECK_KEYS]);
    assert.deepEqual(Object.keys(r.checks.scope), ['status', 'detail', 'ms']);
    assert.equal(r.started_at, '2026-09-02T10:00:00.000Z');
  });
});
