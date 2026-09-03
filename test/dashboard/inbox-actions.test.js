// @ts-check
//
// test/dashboard/inbox-actions.test.js — KODO-76.
//
// Unit de `src/cli/dashboard/inbox-actions.js` (shell never-throws de `kodo inbox …`) y de
// `src/cli/dashboard/inbox-rows.js` (reader + envoltorio del panel de detalle).
//
// El eje del primero es el ARGV LITERAL: `execFile` sin shell hace inertes los metacaracteres,
// pero solo si cada valor va donde debe. Un id o un tag que empiece por `-` es el vector que
// distingue un argv correcto de uno que el parser de commander reinterpreta.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInboxAction, parsePromotedRef } from '../../src/cli/dashboard/inbox-actions.js';
import { readInboxRows, wrapText } from '../../src/cli/dashboard/inbox-rows.js';

const WIRING = { execPath: '/usr/bin/node', kodoBin: '/abs/bin/kodo' };

/** exec fake que captura el argv y responde lo que se le diga. */
function fakeExec(behaviour = { err: null, stdout: '', stderr: '' }) {
  const calls = [];
  const exec = (/** @type {any} */ cmd, /** @type {any} */ argv, /** @type {any} */ opts, /** @type {any} */ cb) => {
    calls.push({ cmd, argv, opts });
    cb(behaviour.err, behaviour.stdout, behaviour.stderr);
  };
  return { exec, calls };
}

describe('runInboxAction — argv literal', () => {
  it('promote: kodoBin como argv[0], --project y --json al final', async () => {
    const { exec, calls } = fakeExec({ err: null, stdout: '{"ref":"KODO-9"}', stderr: '' });
    const r = await runInboxAction({ ...WIRING, exec, verb: 'promote', id: 'aaa111', project: 'p-1' });
    assert.deepEqual(r, { ok: true, stdout: '{"ref":"KODO-9"}' });
    assert.equal(calls[0].cmd, '/usr/bin/node', 'el binario es node: bin/kodo es un script de shebang');
    assert.deepEqual(calls[0].argv, [
      '/abs/bin/kodo',
      'inbox',
      'promote',
      'aaa111',
      '--project',
      'p-1',
      '--json',
    ]);
  });

  it('promote sin proyecto omite el par --project (el CLI cae al tag de la captura)', async () => {
    const { exec, calls } = fakeExec();
    await runInboxAction({ ...WIRING, exec, verb: 'promote', id: 'aaa111' });
    assert.deepEqual(calls[0].argv, ['/abs/bin/kodo', 'inbox', 'promote', 'aaa111', '--json']);
  });

  it('retag: el tag es POSICIONAL, tras el id', async () => {
    const { exec, calls } = fakeExec();
    await runInboxAction({ ...WIRING, exec, verb: 'retag', id: 'aaa111', tag: 'kodo' });
    assert.deepEqual(calls[0].argv, ['/abs/bin/kodo', 'inbox', 'retag', 'aaa111', 'kodo']);
  });

  it('discard: sin flags ni --json', async () => {
    const { exec, calls } = fakeExec();
    await runInboxAction({ ...WIRING, exec, verb: 'discard', id: 'aaa111' });
    assert.deepEqual(calls[0].argv, ['/abs/bin/kodo', 'inbox', 'discard', 'aaa111']);
  });

  it('un valor que empieza por `-` viaja como VALOR, no como flag nueva', async () => {
    const { exec, calls } = fakeExec();
    await runInboxAction({ ...WIRING, exec, verb: 'promote', id: 'aaa111', project: '--force' });
    assert.deepEqual(calls[0].argv.slice(-3), ['--project', '--force', '--json']);
  });

  it('los metacaracteres de shell son inertes: van como UN argumento literal', async () => {
    const { exec, calls } = fakeExec();
    await runInboxAction({ ...WIRING, exec, verb: 'retag', id: 'aaa111', tag: 'a; rm -rf /' });
    assert.equal(calls[0].argv[4], 'a; rm -rf /', 'sin comillas y sin trocear: execFile no usa shell');
  });

  it('promote lleva más presupuesto de tiempo que las acciones locales (hace un POST)', async () => {
    const { exec, calls } = fakeExec();
    await runInboxAction({ ...WIRING, exec, verb: 'promote', id: 'aaa111' });
    assert.ok(calls[0].opts.timeout >= 20_000, `timeout demasiado corto: ${calls[0].opts.timeout}`);
  });
});

describe('runInboxAction — never-throws', () => {
  it('ENOENT se discrimina de un exit code', async () => {
    const { exec } = fakeExec({ err: Object.assign(new Error('nope'), { code: 'ENOENT' }), stdout: '', stderr: '' });
    const r = await runInboxAction({ ...WIRING, exec, verb: 'discard', id: 'a' });
    assert.equal(/** @type {any} */ (r).code, 'ENOENT');
  });

  it('un exit code numérico llega CON el stderr: el mensaje del CLI es accionable', async () => {
    const { exec } = fakeExec({
      err: Object.assign(new Error('x'), { code: 2 }),
      stdout: '',
      stderr: 'Error: no se pudo crear la tarea: 502\n',
    });
    const r = await runInboxAction({ ...WIRING, exec, verb: 'promote', id: 'a' });
    assert.equal(/** @type {any} */ (r).code, 'NON_ZERO_EXIT');
    assert.equal(/** @type {any} */ (r).detail, 2);
    assert.equal(/** @type {any} */ (r).stderr, 'Error: no se pudo crear la tarea: 502');
  });

  it('un exec que lanza SÍNCRONAMENTE no rechaza la promise', async () => {
    const exec = () => {
      throw new Error('boom');
    };
    const r = await runInboxAction({ ...WIRING, exec, verb: 'discard', id: 'a' });
    assert.equal(/** @type {any} */ (r).code, 'SPAWN_ERROR');
    assert.match(/** @type {any} */ (r).detail, /boom/);
  });

  it('omitir `exec` es un TypeError VISIBLE, no una degradación silenciosa', () => {
    // Leak guard estructural: sin esto, un test que olvidara inyectar `exec` shellearía el
    // `kodo inbox promote` real y crearía una tarea en el tablero de producción.
    assert.throws(
      () => runInboxAction(/** @type {any} */ ({ ...WIRING, verb: 'discard', id: 'a' })),
      TypeError,
    );
  });
});

describe('parsePromotedRef — defensivo por contrato', () => {
  it('extrae la ref del JSON del CLI', () => {
    assert.equal(parsePromotedRef('{"ok":true,"ref":"KODO-99"}'), 'KODO-99');
  });

  it('un stdout que no parsea, o sin ref, da cadena vacía en vez de tumbar el árbol de ink', () => {
    for (const s of ['', 'no json', '{"ok":true}', '{"ref":42}', 'null']) {
      assert.equal(parsePromotedRef(s), '');
    }
  });
});

describe('readInboxRows — reader del snapshot', () => {
  const CAPTURES = [
    { id: 'a1', text: 'Un titular bien claro: y su desarrollo largo detrás', tag: 'kodo', date: '2026-09-03', origin: 'cli', open: true, estado: null, dest: null },
    { id: 'b2', text: 'ya cerrada', tag: 'liken', date: '2026-09-01', origin: 'skill', open: false, estado: 'enrutada', dest: 'KODO-1' },
  ];
  const deps = (over = {}) => ({
    pathsFn: () => ({ inboxPath: '/sandbox/inbox.md' }),
    listFn: () => ({ captures: CAPTURES, unparsed: 0 }),
    ...over,
  });

  it('por defecto solo las ABIERTAS, con titular derivado', () => {
    const rows = readInboxRows(deps());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'a1');
    assert.equal(rows[0].headline, 'Un titular bien claro');
    assert.equal(rows[0].text, 'Un titular bien claro: y su desarrollo largo detrás', 'el texto entero sobrevive');
  });

  it('`all` incluye la traza cerrada', () => {
    assert.equal(readInboxRows(deps({ all: true })).length, 2);
  });

  it('sanea los campos que vienen del FICHERO, que es human-editable', () => {
    // OSC-52 pegado a mano: si llegara al frame, el terminal del operador escribiría su
    // portapapeles solo con abrir la pantalla.
    const rows = readInboxRows(
      deps({
        listFn: () => ({
          captures: [{ ...CAPTURES[0], text: 'idea ]52;c;aGk= con cola', tag: 'kodo' }],
          unparsed: 0,
        }),
      }),
    );
    assert.ok(!rows[0].text.includes(''), `control sin sanear: ${JSON.stringify(rows[0].text)}`);
    assert.ok(!rows[0].tag.includes(''), 'el C1 de un solo byte también');
  });

  it('never-throws → [] ante cualquier fallo de lectura', () => {
    assert.deepEqual(
      readInboxRows(
        deps({
          listFn: () => {
            throw new Error('EACCES');
          },
        }),
      ),
      [],
    );
  });
});

describe('wrapText — envoltorio del panel de detalle', () => {
  it('respeta el ancho sin partir palabras', () => {
    const lines = wrapText('alfa bravo charlie delta echo', 12);
    for (const l of lines) assert.ok(l.length <= 12, `desborda: ${JSON.stringify(l)}`);
    assert.equal(lines.join(' '), 'alfa bravo charlie delta echo', 'ni una palabra se pierde ni se parte');
  });

  it('trocea duro una palabra más larga que el ancho', () => {
    const lines = wrapText('x'.repeat(25), 10);
    for (const l of lines) assert.ok(l.length <= 10);
    assert.equal(lines.join(''), 'x'.repeat(25));
  });

  it('devuelve al menos una línea, también con texto vacío', () => {
    assert.deepEqual(wrapText('', 10), ['']);
    assert.deepEqual(wrapText(/** @type {any} */ (null), 10), ['']);
  });

  it('un ancho inválido devuelve el texto sin envolver', () => {
    assert.deepEqual(wrapText('hola mundo', 0), ['hola mundo']);
    assert.deepEqual(wrapText('hola mundo', /** @type {any} */ (-3)), ['hola mundo']);
  });
});
