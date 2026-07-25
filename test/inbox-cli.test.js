// @ts-check
//
// test/inbox-cli.test.js — Phase 83 Plan 02 (CAPT-01/03/04/06; D-12, D-13, D-14, D-17).
//
// Tres carriles:
//   1. UNIT por DI — invoca los handlers directamente con deps espía. Sin proceso y sin tocar
//      `HOME` en ningún punto (Pitfall 5): los paths se INYECTAN siempre, así que un fallo de
//      este carril jamás puede escribir en el `~/.kodo/inbox.md` real del operador.
//   2. INTEGRATION por proceso real — `spawnSync(bin/kodo)` con un HOME sandbox POR TEST.
//      Molde: `test/version-smoke.test.js:1-35` (timeout 10 s + stderr dentro del assert).
//   3. SOURCE-HYGIENE — los dos gates de la fase: el seam documental de CAPT-04 y el
//      invariante cross-milestone de cero dependencias npm.
//      Molde: `test/gsd-doctor-cli.test.js:265`.
//
// Higiene de este fichero: cero caracteres de control LITERALES en el source. Los vectores de
// inyección se escriben SIEMPRE con notación de escape (`\u001b`, `\u009b`) — un byte de control
// literal es ilegible en diff y dispara los detectores de inyección del pipeline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createFormatter } from '../src/cli/format.js';
import { parseLine, MAX_DEST_LEN, MAX_TEXT_LEN } from '../src/inbox/store.js';
import { runCaptureCli } from '../src/cli/capture.js';
import { runInboxListCli, runInboxMarkCli } from '../src/cli/inbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

// --- Helpers del carril UNIT ---------------------------------------------------------------

/**
 * Colector de un stream de escritura (`writeFn` / `errFn`).
 * @returns {{ write: (s: string) => void, get: () => string, calls: string[] }}
 */
function collector() {
  /** @type {string[]} */
  const calls = [];
  return { write: (s) => void calls.push(s), get: () => calls.join(''), calls };
}

/**
 * Espía de `appendCapture`. Registra cada invocación y devuelve el resultado prefijado.
 * @param {any} [result]
 */
function spyAppend(result = { ok: true, coordinated: true }) {
  /** @type {{ line: string, o: any }[]} */
  const calls = [];
  return {
    calls,
    fn: (/** @type {string} */ line, /** @type {any} */ o) => {
      calls.push({ line, o });
      return result;
    },
  };
}

/**
 * Deps deterministas: id, reloj, cwd y paths fijos. Los paths se inyectan SIEMPRE (nunca se
 * resuelve `defaultInboxPaths()` en el carril unit) para que este test no pueda tocar el HOME real.
 * El formatter va sin color (`NO_COLOR`) para que los asserts sean sobre bytes estables.
 */
function fixedDeps(extra = {}) {
  return {
    idFn: () => 'a3f9k2',
    clockFn: () => '2026-07-25',
    cwdFn: () => '/x/kodo',
    projectsFn: () => ({}),
    pathsFn: () => ({ inboxPath: '/x/kodo/inbox.md', lockPath: '/x/kodo/inbox.lock' }),
    formatterFn: () => createFormatter({ isTTY: false }, { NO_COLOR: '1' }),
    ...extra,
  };
}

// --- UNIT: runCaptureCli (Task 1) ----------------------------------------------------------

describe('runCaptureCli — gate de texto vacío (contrato 4, Pitfall 8)', () => {
  it('texto vacío → exit 2, mensaje canónico y CERO escritura', () => {
    const append = spyAppend();
    const err = collector();
    const code = runCaptureCli({ text: '' }, fixedDeps({ appendFn: append.fn, errFn: err.write }));
    assert.equal(code, 2, 'texto vacío debe salir 2 (entrada inválida)');
    assert.equal(append.calls.length, 0, 'no se puede appendear NADA con texto vacío');
    assert.match(err.get(), /^Error: capture text is empty after sanitization\n$/);
  });

  it('solo whitespace → exit 2 y cero escritura', () => {
    const append = spyAppend();
    const err = collector();
    const code = runCaptureCli(
      { text: '   ' },
      fixedDeps({ appendFn: append.fn, errFn: err.write }),
    );
    assert.equal(code, 2);
    assert.equal(append.calls.length, 0);
  });

  it('texto que el saneo COLAPSA a vacío → exit 2 (escapes literales y CSI)', () => {
    // `\n` y `\t` como secuencia LITERAL de dos chars imprimibles (lo que stripForKeystroke
    // neutraliza a espacio) + una secuencia CSI completa que stripControlChars elimina.
    for (const vector of ['\\n \\t', '\u001b[31m\u001b[0m', '\u2028\u2029']) {
      const append = spyAppend();
      const code = runCaptureCli(
        { text: vector },
        fixedDeps({ appendFn: append.fn, errFn: () => {} }),
      );
      assert.equal(code, 2, `vector ${JSON.stringify(vector)} debe colapsar a vacío → exit 2`);
      assert.equal(append.calls.length, 0);
    }
  });

  it('`text` ausente (no string) NO captura la cadena "undefined"', () => {
    const append = spyAppend();
    const code = runCaptureCli({}, fixedDeps({ appendFn: append.fn, errFn: () => {} }));
    assert.equal(code, 2, 'sin texto no hay captura');
    assert.equal(append.calls.length, 0);
  });
});

describe('runCaptureCli — ruta feliz y forma de la línea', () => {
  it('appendea UNA línea terminada en newline que parsea a captura ABIERTA', () => {
    const append = spyAppend();
    const out = collector();
    const code = runCaptureCli(
      { text: 'una idea' },
      fixedDeps({ appendFn: append.fn, writeFn: out.write }),
    );
    assert.equal(code, 0);
    assert.equal(append.calls.length, 1, 'exactamente un append');
    const { line, o } = append.calls[0];
    assert.ok(line.endsWith('\n'), 'la línea llega al store YA terminada en newline');
    assert.equal(line.indexOf('\n'), line.length - 1, 'un solo newline: el terminador');
    const c = parseLine(line.slice(0, -1));
    assert.ok(c, 'la línea appendeada debe parsear');
    assert.equal(c.open, true, 'una captura nace ABIERTA');
    assert.equal(c.text, 'una idea');
    assert.equal(c.estado, null);
    assert.equal(c.dest, null);
    assert.equal(o.inboxPath, '/x/kodo/inbox.md', 'los paths salen de pathsFn (contrato 7)');
    assert.equal(o.lockPath, '/x/kodo/inbox.lock');
  });

  it('la confirmación incluye el id corto (es el handle de `route`)', () => {
    const out = collector();
    const code = runCaptureCli(
      { text: 'una idea' },
      fixedDeps({ appendFn: spyAppend().fn, writeFn: out.write }),
    );
    assert.equal(code, 0);
    assert.match(out.get(), /a3f9k2/, 'sin el id el operador no puede enrutar la captura');
  });

  it('el tag sale de deriveTag(cwd, projects) — sin match cae a basename(cwd) (D-15)', () => {
    const append = spyAppend();
    runCaptureCli(
      { text: 'idea' },
      fixedDeps({ appendFn: append.fn, cwdFn: () => '/home/op/proyecto-x', projectsFn: () => ({}) }),
    );
    const c = parseLine(append.calls[0].line.slice(0, -1));
    assert.ok(c);
    assert.equal(c.tag, 'proyecto-x');
  });

  it('la fecha sale de clockFn (D-07: fecha LOCAL inyectable)', () => {
    const append = spyAppend();
    runCaptureCli({ text: 'idea' }, fixedDeps({ appendFn: append.fn, clockFn: () => '1999-12-31' }));
    const c = parseLine(append.calls[0].line.slice(0, -1));
    assert.ok(c);
    assert.equal(c.date, '1999-12-31');
  });
});

describe('runCaptureCli — `--origin` (D-16: un solo writer para Phase 84)', () => {
  it('el default es `cli`', () => {
    const append = spyAppend();
    runCaptureCli({ text: 'idea' }, fixedDeps({ appendFn: append.fn }));
    const c = parseLine(append.calls[0].line.slice(0, -1));
    assert.ok(c);
    assert.equal(c.origin, 'cli');
  });

  it('`--origin skill` produce una línea IDÉNTICA salvo el campo de origen', () => {
    const a = spyAppend();
    const b = spyAppend();
    runCaptureCli({ text: 'idea' }, fixedDeps({ appendFn: a.fn }));
    runCaptureCli({ text: 'idea', origin: 'skill' }, fixedDeps({ appendFn: b.fn }));
    const lineCli = a.calls[0].line;
    const lineSkill = b.calls[0].line;
    const cSkill = parseLine(lineSkill.slice(0, -1));
    assert.ok(cSkill);
    assert.equal(cSkill.origin, 'skill', 'el último campo estructurado es el origen');
    assert.equal(
      lineSkill.replace(/ · skill\n$/, ' · cli\n'),
      lineCli,
      'byte-identidad salvo el origen — el contrato que Phase 84 consume (CAPT-02)',
    );
  });

  it('un `--origin` vacío o solo whitespace cae al default `cli`', () => {
    for (const origin of ['', '   ']) {
      const append = spyAppend();
      runCaptureCli({ text: 'idea', origin }, fixedDeps({ appendFn: append.fn }));
      const c = parseLine(append.calls[0].line.slice(0, -1));
      assert.ok(c);
      assert.equal(c.origin, 'cli');
    }
  });
});

describe('runCaptureCli — cota de longitud y mapeo de errores (D-13)', () => {
  it('texto sobre MAX_TEXT_LEN: se recorta, se avisa, pero el exit code SIGUE siendo 0', () => {
    const append = spyAppend();
    const err = collector();
    const code = runCaptureCli(
      { text: 'x'.repeat(MAX_TEXT_LEN + 500) },
      fixedDeps({ appendFn: append.fn, errFn: err.write }),
    );
    assert.equal(code, 0, 'la idea NO se pierde por ser larga');
    const c = parseLine(append.calls[0].line.slice(0, -1));
    assert.ok(c);
    assert.equal(c.text.length, MAX_TEXT_LEN);
    assert.match(err.get(), /\[kodo:inbox\]/, 'el recorte se avisa por stderr');
  });

  it('appendFn devolviendo {ok:false, reason:"fs"} → exit 1 con mensaje canónico', () => {
    const err = collector();
    const code = runCaptureCli(
      { text: 'idea' },
      fixedDeps({ appendFn: spyAppend({ ok: false, reason: 'fs' }).fn, errFn: err.write }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /^Error: filesystem error/);
  });

  it('appendFn que LANZA → exit 1 (nunca propaga la excepción al runtime)', () => {
    const err = collector();
    const code = runCaptureCli(
      { text: 'idea' },
      fixedDeps({
        appendFn: () => {
          throw new Error('EACCES boom');
        },
        errFn: err.write,
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /^Error: filesystem error/);
  });

  it('fail-open ({ok:true, coordinated:false}) → exit 0 y CERO mensaje extra (contrato 6)', () => {
    const err = collector();
    const code = runCaptureCli(
      { text: 'idea' },
      fixedDeps({
        appendFn: spyAppend({ ok: true, coordinated: false }).fn,
        errFn: err.write,
      }),
    );
    assert.equal(code, 0);
    assert.equal(
      err.get(),
      '',
      'el warn del fail-open lo emite appendCapture — el handler NO puede duplicarlo (contrato 6)',
    );
  });
});

describe('runCaptureCli — source hygiene del handler', () => {
  it('exporta runCaptureCli', async () => {
    const mod = await import('../src/cli/capture.js');
    assert.equal(typeof mod.runCaptureCli, 'function');
  });

  it('nunca invoca el helper de salida del runtime (retorna el código — D-07 del repo)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(REPO, 'src', 'cli', 'capture.js'), 'utf-8');
    assert.ok(
      !/process\.exit/.test(src),
      'el exit lo hace el registro de commander en src/cli.js, jamás el handler',
    );
  });
});

// --- UNIT: runInboxListCli / runInboxMarkCli (Task 2) ---------------------------------------

/**
 * Fixture de una captura parseada. Los defaults son los de una captura ABIERTA.
 * @param {Partial<import('../src/inbox/store.js').Capture>} [over]
 * @returns {import('../src/inbox/store.js').Capture}
 */
function cap(over = {}) {
  return {
    id: 'a3f9k2',
    text: 'una idea',
    tag: 'kodo',
    date: '2026-07-25',
    origin: 'cli',
    open: true,
    estado: null,
    dest: null,
    ...over,
  };
}

/** 2 abiertas + 1 cerrada enrutada con destino. */
const FIXTURE = Object.freeze([
  cap({ id: 'aaa111', text: 'primera idea' }),
  cap({ id: 'bbb222', text: 'segunda idea' }),
  cap({
    id: 'ccc333',
    text: 'tercera idea',
    open: false,
    estado: 'enrutada',
    dest: '.planning/todos/TODO-012.md',
  }),
]);

/**
 * Deps deterministas del listado. `pathsFn` se inyecta SIEMPRE (nunca se toca HOME) y el
 * formatter va sin color salvo que el test pida lo contrario.
 */
function listDeps(extra = {}) {
  return {
    listFn: () => ({ captures: [...FIXTURE], unparsed: 0 }),
    pathsFn: () => ({ inboxPath: '/x/kodo/inbox.md', lockPath: '/x/kodo/inbox.lock' }),
    formatterFn: () => createFormatter({ isTTY: false }, { NO_COLOR: '1' }),
    ...extra,
  };
}

/**
 * Deps deterministas del marcado.
 */
function markDeps(extra = {}) {
  return {
    markFn: () => ({ ok: true, capture: cap({ open: false, estado: 'enrutada' }) }),
    pathsFn: () => ({ inboxPath: '/x/kodo/inbox.md', lockPath: '/x/kodo/inbox.lock' }),
    formatterFn: () => createFormatter({ isTTY: false }, { NO_COLOR: '1' }),
    ...extra,
  };
}

describe('runInboxListCli — filtrado abiertas / --all (CAPT-03, D-12)', () => {
  it('por defecto lista SOLO las abiertas', () => {
    const out = collector();
    const code = runInboxListCli({}, listDeps({ writeFn: out.write }));
    assert.equal(code, 0);
    const s = out.get();
    assert.match(s, /primera idea/);
    assert.match(s, /segunda idea/);
    assert.ok(!/tercera idea/.test(s), 'una captura cerrada no aparece sin --all');
  });

  it('--all incluye las cerradas CON su estado', () => {
    const out = collector();
    const code = runInboxListCli({ all: true }, listDeps({ writeFn: out.write }));
    assert.equal(code, 0);
    const s = out.get();
    assert.match(s, /primera idea/);
    assert.match(s, /tercera idea/);
    assert.match(s, /enrutada/, '--all debe mostrar el estado de cierre');
  });

  it('--all: una cerrada con estado null se muestra como cierre DESCONOCIDO (contrato 2)', () => {
    const out = collector();
    const code = runInboxListCli(
      { all: true },
      listDeps({
        writeFn: out.write,
        listFn: () => ({
          captures: [cap({ id: 'ddd444', text: 'hand-edit', open: false, estado: null })],
          unparsed: 0,
        }),
      }),
    );
    assert.equal(code, 0);
    assert.match(
      out.get(),
      /desconocid/i,
      'un `- [x]` hand-editado sin sufijo se muestra como cierre desconocido',
    );
  });
});

describe('runInboxListCli — never-throws y copy de vacío (D-18)', () => {
  it('inbox VACÍO → exit 0 con copy explícita (jamás una tabla muda)', () => {
    const out = collector();
    const code = runInboxListCli(
      {},
      listDeps({ writeFn: out.write, listFn: () => ({ captures: [], unparsed: 0 }) }),
    );
    assert.equal(code, 0);
    assert.match(out.get(), /vac/i, 'el inbox vacío tiene su propia copy');
  });

  it('sin abiertas pero CON traza → copy que apunta a --all', () => {
    const out = collector();
    const code = runInboxListCli(
      {},
      listDeps({
        writeFn: out.write,
        listFn: () => ({
          captures: [cap({ open: false, estado: 'descartada' })],
          unparsed: 0,
        }),
      }),
    );
    assert.equal(code, 0);
    assert.match(out.get(), /--all/, 'si hay traza, la copy debe indicar cómo verla');
  });

  it('un listFn que LANZA sigue devolviendo 0 (never-throws de extremo a extremo)', () => {
    const code = runInboxListCli(
      {},
      listDeps({
        writeFn: () => {},
        errFn: () => {},
        listFn: () => {
          throw new Error('EACCES boom');
        },
      }),
    );
    assert.equal(code, 0, 'el listado NUNCA sale con código distinto de 0 (D-18)');
  });

  it('informa de las líneas no parseables OMITIDAS del listado y CONSERVADAS en el fichero', () => {
    const out = collector();
    const code = runInboxListCli(
      {},
      listDeps({ writeFn: out.write, listFn: () => ({ captures: [cap()], unparsed: 2 }) }),
    );
    assert.equal(code, 0);
    const s = out.get();
    assert.match(s, /2/, 'el conteo de no parseables se surfacea');
    assert.match(s, /conserv|omit/i, 'el operador debe saber que kodo NO las ha tocado');
  });
});

describe('runInboxListCli — render human saneado (T-83-09, Pitfall 6)', () => {
  it('una secuencia de escape hand-pegada NO llega al terminal del operador', () => {
    const out = collector();
    const code = runInboxListCli(
      { all: true },
      listDeps({
        writeFn: out.write,
        listFn: () => ({
          captures: [
            cap({
              // OSC-52 (escritura al portapapeles) + CSI, tal como podrían haberse pegado a mano
              // en el fichero: el saneo del carril de ESCRITURA no cubre este caso.
              text: 'idea \u001b]52;c;aGVsbG8=\u0007 fin',
              tag: 'pro\u009byecto',
              open: false,
              estado: 'enrutada',
              dest: 'ruta\u001b[31m/mala',
            }),
          ],
          unparsed: 0,
        }),
      }),
    );
    assert.equal(code, 0);
    assert.ok(
      !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(out.get()),
      'el render human debe neutralizar TODO byte de control proveniente del fichero',
    );
  });
});

describe('runInboxListCli — --json determinista (DX-06)', () => {
  it('una sola línea, parseable, y byte-idéntica entre dos invocaciones', () => {
    const a = collector();
    const b = collector();
    assert.equal(runInboxListCli({ json: true }, listDeps({ writeFn: a.write })), 0);
    assert.equal(runInboxListCli({ json: true }, listDeps({ writeFn: b.write })), 0);
    const s = a.get();
    assert.equal(s, b.get(), 'dos ejecuciones sobre la misma entrada → bytes idénticos');
    assert.ok(s.endsWith('\n'), 'la línea JSON termina en newline');
    assert.equal(s.indexOf('\n'), s.length - 1, 'UNA sola línea');
    assert.doesNotThrow(() => JSON.parse(s));
  });

  it('la rama --json NUNCA instancia el formatter (sin ANSI por construcción)', () => {
    const out = collector();
    const code = runInboxListCli(
      { json: true },
      listDeps({
        writeFn: out.write,
        formatterFn: () => {
          throw new Error('la rama --json no puede tocar el formatter');
        },
      }),
    );
    assert.equal(code, 0);
    assert.ok(!/\u001b/.test(out.get()), 'cero secuencias ANSI en el carril máquina');
  });

  it('claves en orden FIJO: conteo de abiertas, no parseables, capturas', () => {
    const out = collector();
    runInboxListCli(
      { json: true },
      listDeps({ writeFn: out.write, listFn: () => ({ captures: [...FIXTURE], unparsed: 3 }) }),
    );
    const payload = JSON.parse(out.get());
    assert.deepEqual(Object.keys(payload), ['open', 'unparsed', 'captures']);
    assert.equal(payload.open, 2, 'el conteo de abiertas es sobre TODAS las capturas del fichero');
    assert.equal(payload.unparsed, 3);
    assert.equal(payload.captures.length, 2, 'sin --all solo van las abiertas');
  });

  it('cada captura expone sus claves en orden fijo; --all añade estado y dest', () => {
    const plain = collector();
    runInboxListCli({ json: true }, listDeps({ writeFn: plain.write }));
    assert.deepEqual(Object.keys(JSON.parse(plain.get()).captures[0]), [
      'id',
      'text',
      'tag',
      'date',
      'origin',
      'open',
    ]);

    const all = collector();
    runInboxListCli({ json: true, all: true }, listDeps({ writeFn: all.write }));
    const parsed = JSON.parse(all.get());
    assert.deepEqual(Object.keys(parsed.captures[0]), [
      'id',
      'text',
      'tag',
      'date',
      'origin',
      'open',
      'estado',
      'dest',
    ]);
    assert.equal(parsed.captures[2].estado, 'enrutada');
    assert.equal(parsed.captures[2].dest, '.planning/todos/TODO-012.md');
  });
});

describe('runInboxMarkCli — route/discard (CAPT-06, D-10, D-13)', () => {
  it('route con --dest → 0 y el destino llega TAL CUAL al store', () => {
    /** @type {any[]} */
    const calls = [];
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      { dest: '.planning/todos/TODO-012.md' },
      markDeps({
        writeFn: () => {},
        markFn: (/** @type {any} */ ...args) => {
          calls.push(args);
          return { ok: true, capture: cap({ open: false, estado: 'enrutada', dest: args[2].dest }) };
        },
      }),
    );
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'a3f9k2');
    assert.equal(calls[0][1], 'enrutada');
    assert.equal(calls[0][2].dest, '.planning/todos/TODO-012.md');
    assert.equal(calls[0][2].inboxPath, '/x/kodo/inbox.md');
  });

  it('route SIN --dest → 0 igualmente (best-effort, CAPT-06/D-10)', () => {
    /** @type {any[]} */
    const calls = [];
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      {},
      markDeps({
        writeFn: () => {},
        markFn: (/** @type {any} */ ...args) => {
          calls.push(args);
          return { ok: true, capture: cap({ open: false, estado: 'enrutada' }) };
        },
      }),
    );
    assert.equal(code, 0, 'la falta de ref NUNCA bloquea el marcado');
    assert.equal(calls[0][2].dest, null);
  });

  it('discard → 0 y el estado que llega al store es `descartada`', () => {
    /** @type {any[]} */
    const calls = [];
    const code = runInboxMarkCli(
      'a3f9k2',
      'descartada',
      {},
      markDeps({
        writeFn: () => {},
        markFn: (/** @type {any} */ ...args) => {
          calls.push(args);
          return { ok: true, capture: cap({ open: false, estado: 'descartada' }) };
        },
      }),
    );
    assert.equal(code, 0);
    assert.equal(calls[0][1], 'descartada');
  });

  it('un --dest por encima de MAX_DEST_LEN NO falla (el store lo recorta)', () => {
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      { dest: 'x'.repeat(MAX_DEST_LEN + 50) },
      markDeps({ writeFn: () => {} }),
    );
    assert.equal(code, 0);
  });
});

describe('runInboxMarkCli — mapeo de reasons a exit codes (D-13, contrato 3)', () => {
  it('not-found → 2 con mensaje propio', () => {
    const err = collector();
    const code = runInboxMarkCli(
      'zzz',
      'enrutada',
      {},
      markDeps({ errFn: err.write, markFn: () => ({ ok: false, reason: 'not-found' }) }),
    );
    assert.equal(code, 2);
    assert.match(err.get(), /not found/i);
  });

  it('already-closed → 2 con mensaje DISTINGUIBLE de not-found', () => {
    const err = collector();
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      {},
      markDeps({ errFn: err.write, markFn: () => ({ ok: false, reason: 'already-closed' }) }),
    );
    assert.equal(code, 2);
    assert.match(err.get(), /already closed/i);
    assert.ok(!/not found/i.test(err.get()), 'los dos cierres de exit 2 deben distinguirse');
  });

  it('lock-timeout → 1 e indica que el marcado NO se aplicó', () => {
    const err = collector();
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      {},
      markDeps({ errFn: err.write, markFn: () => ({ ok: false, reason: 'lock-timeout' }) }),
    );
    assert.equal(code, 1, 'el marcado NO hace fail-open (contrato 3)');
    assert.match(err.get(), /lock/i);
    assert.match(err.get(), /no se ha aplicado|reint/i);
  });

  it('fs → 1 con el mensaje canónico de filesystem', () => {
    const err = collector();
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      {},
      markDeps({ errFn: err.write, markFn: () => ({ ok: false, reason: 'fs' }) }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /^Error: filesystem error/);
  });

  it('markFn que LANZA → 1 (jamás propaga la excepción al runtime)', () => {
    const err = collector();
    const code = runInboxMarkCli(
      'a3f9k2',
      'enrutada',
      {},
      markDeps({
        errFn: err.write,
        markFn: () => {
          throw new Error('EACCES boom');
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /^Error: filesystem error/);
  });

  it('el id que se pinta en el error viene SANEADO (llega de argv)', () => {
    const err = collector();
    runInboxMarkCli(
      'zz\u001b]52;c;x\u0007z',
      'enrutada',
      {},
      markDeps({ errFn: err.write, markFn: () => ({ ok: false, reason: 'not-found' }) }),
    );
    assert.ok(
      !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(err.get()),
      'un id con escapes no puede ejecutarse en el terminal al reportar el error',
    );
  });
});

describe('runInbox*Cli — source hygiene del handler', () => {
  it('exporta runInboxListCli y runInboxMarkCli', async () => {
    const mod = await import('../src/cli/inbox.js');
    assert.equal(typeof mod.runInboxListCli, 'function');
    assert.equal(typeof mod.runInboxMarkCli, 'function');
  });

  it('nunca invoca el helper de salida del runtime y sanea el carril de render', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(REPO, 'src', 'cli', 'inbox.js'), 'utf-8');
    assert.ok(!/process\.exit/.test(src), 'el exit lo hace el registro de commander');
    assert.ok(
      /stripControlChars/.test(src),
      'el render human DEBE sanear el contenido del fichero (Pitfall 6 / T-83-09)',
    );
  });
});
