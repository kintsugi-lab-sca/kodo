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

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

  it('nunca invoca el helper de salida del runtime y sanea el carril de render', () => {
    const src = readFileSync(join(REPO, 'src', 'cli', 'inbox.js'), 'utf-8');
    assert.ok(!/process\.exit/.test(src), 'el exit lo hace el registro de commander');
    assert.ok(
      /stripControlChars/.test(src),
      'el render human DEBE sanear el contenido del fichero (Pitfall 6 / T-83-09)',
    );
  });
});

// --- INTEGRATION: proceso real con HOME sandbox (Task 3) ------------------------------------

const KODO_BIN = join(REPO, 'bin', 'kodo');

/**
 * Invoca el binario real. CADA spawn lleva su propio HOME sandbox: `~/.kodo` se resuelve al
 * CARGAR el módulo de config (Pitfall 5), así que el aislamiento solo es fiable si el env está
 * puesto ANTES de arrancar el proceso — que es exactamente lo que hace `spawnSync`.
 *
 * @param {string} home
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @param {{ cwd?: string }} [opts] — `cwd` solo lo fija el caso que verifica la derivación del
 *   tag: el resto de casos corren desde el repo, que es el molde histórico.
 */
function kodo(home, args, env = {}, opts = {}) {
  return spawnSync(process.execPath, [KODO_BIN, ...args], {
    cwd: opts.cwd || REPO,
    encoding: 'utf-8',
    timeout: 10_000, // WR-01 Phase 14 — fail-fast si el bin cuelga (higiene de CI)
    env: { ...process.env, HOME: home, ...env },
  });
}

/** @param {string} home */
function inboxOf(home) {
  return join(home, '.kodo', 'inbox.md');
}

/** Líneas NO vacías del inbox. @param {string} home */
function inboxLines(home) {
  return readFileSync(inboxOf(home), 'utf-8')
    .split('\n')
    .filter((l) => l !== '');
}

/** @param {string} p */
function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** Siembra un inbox con contenido literal. @param {string} home @param {string} content */
function seedInbox(home, content) {
  mkdirSync(join(home, '.kodo'), { recursive: true });
  writeFileSync(inboxOf(home), content);
}

/**
 * Id determinista de la captura sembrada en la posición `i`: base36 del índice, padded a los 6
 * caracteres del alfabeto que acepta el parser (`[0-9a-z]+`). Único para cualquier `n < 36^6`.
 *
 * @param {number} i
 * @returns {string}
 */
function capIdAt(i) {
  return i.toString(36).padStart(6, '0');
}

/**
 * Siembra un inbox GRANDE de UNA SOLA escritura y devuelve su tamaño en bytes.
 *
 * NO se usa el binario para sembrar: 1500 invocaciones de proceso harían el test inutilizable.
 * Las líneas se construyen con la gramática literal de `encodeLine` y se verifican parseables por
 * el propio fixture (ver el primer assert de cada caso, que exige el conteo exacto de capturas).
 *
 * `closedTail` cierra las N últimas capturas con su sufijo de estado y su trace pointer — el
 * material del carril `--all` (CAPT-06).
 *
 * @param {string} home
 * @param {number} n
 * @param {{ closedTail?: number }} [opts]
 * @returns {number} tamaño en bytes del fichero escrito
 */
function seedLargeInbox(home, n, opts = {}) {
  const closedTail = opts.closedTail ?? 0;
  const openCount = n - closedTail;
  /** @type {string[]} */
  const lines = [];
  for (let i = 0; i < n; i++) {
    const id = capIdAt(i);
    const text =
      `captura sembrada numero ${i} — texto largo y determinista para que el fichero ` +
      `cruce con holgura el umbral de truncado de la pipe`;
    const head = `${id} · ${text} · kodo · 2026-07-25 · cli`;
    lines.push(
      i < openCount ? `- [ ] ${head}` : `- [x] ${head} · enrutada → .planning/todos/TODO-${id}.md`,
    );
  }
  const content = lines.join('\n') + '\n';
  mkdirSync(join(home, '.kodo'), { recursive: true });
  writeFileSync(inboxOf(home), content);
  return Buffer.byteLength(content, 'utf-8');
}

/** Id de la primera captura parseable del fichero. @param {string} home */
function firstId(home) {
  for (const l of inboxLines(home)) {
    const c = parseLine(l);
    if (c) return c.id;
  }
  throw new Error('el inbox sembrado no contiene ninguna captura parseable');
}

describe('CLI `kodo capture` — proceso real (CAPT-01, D-19)', () => {
  /** @type {string} */
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-inbox-cli-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('primer run sobre un HOME limpio: crea el fichero SIN cabecera y sale 0', () => {
    const r = kodo(home, ['capture', 'una idea']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`);
    assert.ok(existsSync(inboxOf(home)), '~/.kodo/inbox.md se crea on-demand (D-19)');
    const ls = inboxLines(home);
    assert.equal(ls.length, 1, 'exactamente una línea');
    assert.equal(ls[0][0], '-', 'el fichero es una lista PURA: sin cabecera ni preámbulo (D-19)');
    const c = parseLine(ls[0]);
    assert.ok(c, 'la línea escrita debe parsear');
    assert.equal(c.text, 'una idea');
    assert.equal(c.open, true);
  });

  it('texto vacío y solo whitespace → exit 2 y NI SIQUIERA se crea el fichero', () => {
    for (const text of ['', '   ']) {
      const r = kodo(home, ['capture', text]);
      assert.equal(r.status, 2, `texto ${JSON.stringify(text)} → status ${r.status}: ${r.stderr}`);
      assert.equal(existsSync(inboxOf(home)), false, 'un gate que falla no puede tocar el disco');
    }
  });

  it('--origin skill fija el último campo estructurado (D-16 — el contrato de Phase 84)', () => {
    const r = kodo(home, ['capture', 'idea', '--origin', 'skill']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    const c = parseLine(inboxLines(home)[0]);
    assert.ok(c);
    assert.equal(c.origin, 'skill');
  });

  it('tres capturas seguidas → 3 líneas, en orden de invocación', () => {
    for (const t of ['primera', 'segunda', 'tercera']) {
      assert.equal(kodo(home, ['capture', t]).status, 0);
    }
    const texts = inboxLines(home).map((l) => parseLine(l)?.text);
    assert.deepEqual(texts, ['primera', 'segunda', 'tercera']);
  });

  // WR-05 (83-REVIEW): un texto que EMPIEZA POR GUION es la forma típica de una línea pegada de
  // una lista markdown o de una métrica negativa. El parser lo lee como una opción, así que sin el
  // separador de argumentos la captura se aborta y la idea se PIERDE. La forma segura está ahora
  // declarada en la ayuda del propio comando (`src/cli.js`, descripción del argumento de texto).
  it('texto que empieza por guion CON el separador `--`: captura verbatim y sale 0 (CAPT-01)', () => {
    const text = '-3 % de conversión en el checkout tras el rediseño';
    const r = kodo(home, ['capture', '--', text]);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);

    const ls = inboxLines(home);
    assert.equal(ls.length, 1, 'exactamente una línea');
    const c = parseLine(ls[0]);
    assert.ok(c, 'la línea escrita debe parsear');
    assert.equal(c.text, text, 'el guion inicial sobrevive: el texto se persiste ÍNTEGRO');
  });

  // GAP-3 / CR-03 — extremo a extremo sobre el binario, con la forma REAL de projects.json.
  // El carril unit vive en `test/inbox-store.test.js`; este comprueba el campo REALMENTE
  // PERSISTIDO, que es lo que el operador acaba leyendo.
  it('el tag persistido es el NOMBRE del proyecto, no el identificador de proveedor (GAP-3)', () => {
    // `realpathSync` sobre el sandbox: en macOS `mkdtempSync` devuelve `/var/folders/…` pero el
    // `process.cwd()` del proceso hijo llega ya resuelto a `/private/var/folders/…`. Sin resolver,
    // el path del mapa no sería ancestro del cwd y el caso mediría el fallback, no la proyección.
    const projectDir = join(realpathSync(home), 'dev', 'klab', 'kodo');
    const deepCwd = join(projectDir, 'src', 'inbox');
    mkdirSync(deepCwd, { recursive: true });
    mkdirSync(join(home, '.kodo'), { recursive: true });
    // Forma real: clave = identificador de proveedor (UUID de 36 chars), valor = objeto con la
    // ruta por defecto y su tabla de módulos.
    const uuid = '7246e3fe-3dc4-4f24-9078-1911ad477e0d';
    writeFileSync(
      join(home, '.kodo', 'projects.json'),
      JSON.stringify({ [uuid]: { default: projectDir, modules: { DEV: projectDir } } }) + '\n',
    );

    // Capturar desde un SUBDIRECTORIO profundo: el caso normal del operador.
    const r = kodo(home, ['capture', 'idea con tag legible'], {}, { cwd: deepCwd });
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);

    const c = parseLine(inboxLines(home)[0]);
    assert.ok(c, 'la línea escrita debe parsear');
    assert.ok(
      c.tag.length < 36,
      `el tag no puede ser un identificador de 36 chars: ${JSON.stringify(c.tag)}`,
    );
    assert.equal(c.tag, 'kodo', 'el último segmento de la ruta del PROYECTO, no la del cwd');
  });

  it('LIMITACIÓN CONOCIDA (no deseada): sin `--`, el mismo texto NO se captura y no toca el disco', () => {
    // Este test fija el comportamiento REAL de hoy, no el deseable. Interceptar el error de opción
    // desconocida de commander está DIFERIDO (toca el manejo global de errores del parser, ver
    // §Diferidos del plan 83-05). Si algún día se intercepta, este test se pondrá ROJO y obligará
    // a actualizar la expectativa de forma consciente en vez de por deriva.
    const text = '-3 % de conversión en el checkout tras el rediseño';
    const r = kodo(home, ['capture', text]);
    assert.notEqual(r.status, 0, `sin separador el parser aborta; status fue ${r.status}`);
    assert.match(r.stderr, /unknown option/i, 'el parser lo lee como una opción, no como texto');
    assert.equal(existsSync(inboxOf(home)), false, 'CERO escritura: un gate del parser no toca el disco');
  });
});

describe('CLI `kodo inbox` — listado (CAPT-03, D-12, D-18)', () => {
  /** @type {string} */
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-inbox-cli-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('sobre un HOME limpio sale 0 con la copy de inbox vacío (never-throws, D-18)', () => {
    const r = kodo(home, ['inbox']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /vac/i, 'un inbox inexistente NO es una condición de error');
  });

  it('tras 2 capturas lista 2 filas y sale 0', () => {
    kodo(home, ['capture', 'idea uno']);
    kodo(home, ['capture', 'idea dos']);
    const r = kodo(home, ['inbox']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /idea uno/);
    assert.match(r.stdout, /idea dos/);
  });

  it('--json: UNA línea parseable, sin ANSI y byte-idéntica entre dos ejecuciones (DX-06)', () => {
    kodo(home, ['capture', 'idea json']);
    const a = kodo(home, ['inbox', '--json']);
    const b = kodo(home, ['inbox', '--json']);
    assert.equal(a.status, 0, `status ${a.status}\nstderr: ${a.stderr}`);
    assert.equal(a.stdout, b.stdout, 'dos ejecuciones sobre el mismo estado → bytes idénticos');
    assert.equal(a.stdout.indexOf('\n'), a.stdout.length - 1, 'una sola línea');
    assert.ok(!/\u001b/.test(a.stdout), 'cero secuencias ANSI en el carril máquina');
    const payload = JSON.parse(a.stdout);
    assert.equal(payload.captures.length, 1);
    assert.equal(payload.captures[0].text, 'idea json');
  });

  it('--json sigue sin ANSI aunque el color esté FORZADO (la rama no toca el formatter)', () => {
    kodo(home, ['capture', 'idea color']);
    const r = kodo(home, ['inbox', '--json'], { FORCE_COLOR: '1' });
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.ok(!/\u001b/.test(r.stdout), 'FORCE_COLOR no puede contaminar --json');
    assert.doesNotThrow(() => JSON.parse(r.stdout));
  });
});

describe('CLI `kodo inbox route|discard` — cierre sin borrado (CAPT-03, CAPT-06, D-13)', () => {
  /** @type {string} */
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-inbox-cli-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('route --dest: cierra con trace pointer, conserva la línea y desaparece del listado', () => {
    kodo(home, ['capture', 'idea a enrutar']);
    const id = firstId(home);
    const before = inboxLines(home).length;

    const r = kodo(home, ['inbox', 'route', id, '--dest', '.planning/todos/TODO-012.md']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.equal(inboxLines(home).length, before, 'cerrar NO borra: el conteo de líneas no cambia');

    const c = parseLine(inboxLines(home)[0]);
    assert.ok(c);
    assert.equal(c.open, false);
    assert.equal(c.estado, 'enrutada');
    assert.equal(c.dest, '.planning/todos/TODO-012.md');
    assert.equal(c.text, 'idea a enrutar', 'el texto sobrevive intacto al cierre');

    assert.ok(!/idea a enrutar/.test(kodo(home, ['inbox']).stdout), 'ya no está entre las abiertas');
    assert.match(kodo(home, ['inbox', '--all']).stdout, /idea a enrutar/, '--all conserva la traza');
  });

  it('route SIN --dest sale 0 y cierra sin destino (best-effort, CAPT-06)', () => {
    kodo(home, ['capture', 'idea sin ref']);
    const id = firstId(home);
    const r = kodo(home, ['inbox', 'route', id]);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    const c = parseLine(inboxLines(home)[0]);
    assert.ok(c);
    assert.equal(c.estado, 'enrutada');
    assert.equal(c.dest, null, 'sin ref no hay trace pointer, pero el cierre se aplica igual');
  });

  it('discard sale 0 y la línea SIGUE en el fichero con su sufijo', () => {
    kodo(home, ['capture', 'idea a descartar']);
    const id = firstId(home);
    const r = kodo(home, ['inbox', 'discard', id]);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    const ls = inboxLines(home);
    assert.equal(ls.length, 1, 'descartar NO borra (CAPT-03: la traza permanente es el feature)');
    const c = parseLine(ls[0]);
    assert.ok(c);
    assert.equal(c.estado, 'descartada');
    assert.equal(c.text, 'idea a descartar');
  });

  it('id inexistente y captura ya cerrada → exit 2, con el fichero BYTE-IDÉNTICO', () => {
    kodo(home, ['capture', 'idea única']);
    const id = firstId(home);

    const hashBefore = sha256(inboxOf(home));
    const missing = kodo(home, ['inbox', 'route', 'zzzzzz']);
    assert.equal(missing.status, 2, `status ${missing.status}\nstderr: ${missing.stderr}`);
    assert.equal(sha256(inboxOf(home)), hashBefore, 'un id inexistente no reescribe NADA');

    assert.equal(kodo(home, ['inbox', 'route', id]).status, 0);
    const hashClosed = sha256(inboxOf(home));
    const again = kodo(home, ['inbox', 'route', id]);
    assert.equal(again.status, 2, `re-cerrar debe salir 2: ${again.stderr}`);
    assert.equal(sha256(inboxOf(home)), hashClosed, 'already-closed no reescribe NADA');
  });

  it('hand-edit `- [x]` SIN sufijo → route sale 2 y la línea no cambia (contrato 2)', () => {
    seedInbox(home, '- [x] bbb222 · hand-edit · kodo · 2026-07-25 · cli\n');
    const hashBefore = sha256(inboxOf(home));
    const r = kodo(home, ['inbox', 'route', 'bbb222']);
    assert.equal(r.status, 2, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stderr, /already closed/i);
    assert.equal(sha256(inboxOf(home)), hashBefore, 'el checkbox es la autoridad: no se reescribe');
  });

  it('las líneas ajenas (heading + nota a mano) sobreviven BYTE A BYTE a un route (D-04)', () => {
    const heading = '# Notas sueltas del inbox';
    const handwritten = 'esto lo escribí yo a mano y kodo no debe tocarlo';
    seedInbox(
      home,
      `${heading}\n- [ ] aaa111 · idea sembrada · kodo · 2026-07-25 · cli\n${handwritten}\n`,
    );

    const list = kodo(home, ['inbox']);
    assert.equal(list.status, 0, `status ${list.status}\nstderr: ${list.stderr}`);
    assert.match(list.stdout, /idea sembrada/);
    assert.ok(!new RegExp(heading).test(list.stdout), 'el heading NO es una captura');
    assert.match(list.stdout, /2/, 'las 2 líneas no parseables se cuentan');
    assert.match(list.stdout, /conserv/i, 'y se informa de que kodo NO las ha tocado');

    assert.equal(kodo(home, ['inbox', 'route', 'aaa111']).status, 0);
    const after = readFileSync(inboxOf(home), 'utf-8').split('\n');
    assert.equal(after[0], heading, 'el heading sobrevive byte a byte');
    assert.equal(after[2], handwritten, 'la nota a mano sobrevive byte a byte');
  });
});

// DEFECTO QUE CUBRE ESTE BLOQUE (Plan 83-05 / GAP-2 / 83-REVIEW CR-01).
//
// Los cuatro handlers del inbox terminaban el proceso inmediatamente después de escribir en
// stdout. Cuando la salida NO es un terminal sino una pipe, esas escrituras son ASÍNCRONAS: el
// proceso moría sin drenar el buffer del sistema y la salida se cortaba en EXACTAMENTE 65536
// bytes. Reproducción medida sobre este repo antes del arreglo: con 4000 capturas (~550 KB de
// fichero), `kodo inbox --json` canalizado devolvía 65536 bytes y `JSON.parse` fallaba con
// «Unterminated string in JSON at position 65536».
//
// NO RECORTAR EL TAMAÑO DEL FIXTURE «POR RAPIDEZ». Un fixture por debajo del umbral deja el caso
// verde con y sin el arreglo, que es exactamente el enmascaramiento que DEBT-04 prohíbe: una
// carrera (o un truncado) nunca se pone verde escondiéndola. Comprobado con el arreglo revertido a
// mano: el caso 1 se pone ROJO.
//
// Como CAPT-03 prohíbe borrar, el fichero solo crece: cruzar 64 KB no es un caso límite, es una
// certeza a plazo.
describe('CLI `kodo inbox` — la salida CANALIZADA no se trunca (GAP-2, DX-06, CAPT-03)', () => {
  /** Capturas del fixture: ~155 bytes por línea → fichero muy por encima de 100 000 bytes. */
  const N = 1500;
  /** Cola ya cerrada del fixture del carril `--all`. */
  const CLOSED_TAIL = 300;

  /** @type {string} */
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-inbox-big-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it(
    '--json: la salida canalizada parsea ENTERA y trae las N capturas, con la ÚLTIMA presente',
    { timeout: 30_000 },
    () => {
      const fileBytes = seedLargeInbox(home, N);
      assert.ok(fileBytes > 100_000, `el fixture debe ser realista, no simbólico: ${fileBytes} bytes`);

      const r = kodo(home, ['inbox', '--json']);
      assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);

      const outBytes = Buffer.byteLength(r.stdout, 'utf-8');
      assert.ok(
        outBytes > 65536,
        `la salida canalizada se cortó en ${outBytes} bytes — el truncado de la pipe está en 65536`,
      );

      const payload = JSON.parse(r.stdout);
      assert.equal(payload.captures.length, N, 'ni una captura de menos: la salida llegó completa');
      // Este assert es el que distingue «no se truncó» de «se truncó en un punto que casualmente
      // parsea»: exige el identificador de la ÚLTIMA captura sembrada, que vive al final del stream.
      assert.equal(payload.captures[N - 1].id, capIdAt(N - 1), 'la última captura sembrada llega');
    },
  );

  it(
    '--all --json: la traza completa tampoco se corta y el dest de la última cerrada llega íntegro',
    { timeout: 30_000 },
    () => {
      const fileBytes = seedLargeInbox(home, N, { closedTail: CLOSED_TAIL });
      assert.ok(fileBytes > 100_000, `el fixture debe ser realista, no simbólico: ${fileBytes} bytes`);

      const r = kodo(home, ['inbox', '--all', '--json']);
      assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);

      const outBytes = Buffer.byteLength(r.stdout, 'utf-8');
      assert.ok(
        outBytes > 65536,
        `la traza canalizada se cortó en ${outBytes} bytes — el truncado de la pipe está en 65536`,
      );

      const payload = JSON.parse(r.stdout);
      assert.equal(payload.captures.length, N, 'la traza permanente llega entera');
      assert.equal(payload.open, N - CLOSED_TAIL, 'el conteo de abiertas es el sembrado');

      const last = payload.captures[N - 1];
      assert.equal(last.id, capIdAt(N - 1), 'la última captura cerrada llega');
      assert.equal(last.estado, 'enrutada');
      assert.equal(
        last.dest,
        `.planning/todos/TODO-${capIdAt(N - 1)}.md`,
        'CAPT-06 viaja por el mismo carril: el trace pointer llega íntegro, no cortado',
      );
    },
  );

  it(
    'el carril HUMAN canalizado tampoco se corta (un paginador es el mismo camino asíncrono)',
    { timeout: 30_000 },
    () => {
      seedLargeInbox(home, N);

      const r = kodo(home, ['inbox']);
      assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);

      const outBytes = Buffer.byteLength(r.stdout, 'utf-8');
      assert.ok(
        outBytes > 65536,
        `el render human se cortó en ${outBytes} bytes — el truncado de la pipe está en 65536`,
      );
      assert.ok(
        r.stdout.includes(capIdAt(N - 1)),
        'la última fila del render llega al consumidor: el listado no se corta a mitad',
      );
    },
  );

  it(
    'los exit codes deterministas de D-13 sobreviven al cambio de mecanismo de terminación',
    { timeout: 30_000 },
    () => {
      seedLargeInbox(home, N);

      const missing = kodo(home, ['inbox', 'route', 'zzzzzz']);
      assert.equal(missing.status, 2, `id inexistente → 2; fue ${missing.status}: ${missing.stderr}`);

      const id = capIdAt(N - 1);
      const ok = kodo(home, ['inbox', 'route', id, '--dest', '.planning/todos/TODO-012.md']);
      assert.equal(ok.status, 0, `status ${ok.status}\nstderr: ${ok.stderr}`);
      assert.match(ok.stdout, new RegExp(`Captura ${id} enrutada`), 'la confirmación identifica la captura');
      assert.equal(ok.stdout.at(-1), '\n', 'y llega COMPLETA: terminada en su newline');

      const closed = kodo(home, ['inbox', 'route', id]);
      assert.equal(closed.status, 2, `re-cerrar sigue saliendo 2; fue ${closed.status}: ${closed.stderr}`);
    },
  );
});

describe('CLI — superficie LOCKED: nada de más, nada de menos (D-12, D-14, D-17)', () => {
  /** @type {string} */
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-inbox-cli-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('`inbox --help` sale 0 y anuncia route y discard', () => {
    const r = kodo(home, ['inbox', '--help']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /route/);
    assert.match(r.stdout, /discard/);
  });

  it('`capture --help` sale 0 y NO expone --project (D-17: sin override del tag)', () => {
    const r = kodo(home, ['capture', '--help']);
    assert.equal(r.status, 0, `status ${r.status}\nstderr: ${r.stderr}`);
    assert.ok(!/--project/.test(r.stdout), 'el tag se deriva SOLO del cwd (D-15)');
  });

  it('ni `inbox` ni sus subcomandos exponen --project o --open (D-14: CAPT-F1 diferido a v2)', () => {
    for (const args of [
      ['inbox', '--help'],
      ['inbox', 'route', '--help'],
      ['inbox', 'discard', '--help'],
    ]) {
      const r = kodo(home, args);
      assert.equal(r.status, 0, `\`${args.join(' ')}\` → status ${r.status}: ${r.stderr}`);
      assert.ok(
        !/--project|--open/.test(r.stdout),
        `\`${args.join(' ')}\` no puede adelantar superficie diferida:\n${r.stdout}`,
      );
    }
  });
});

// --- SOURCE HYGIENE: los dos gates de la fase ----------------------------------------------

describe('Gate CAPT-04 / D-09 — el seam de enrutado es DOCUMENTAL', () => {
  // La aserción está anclada al PATRÓN DE IMPORT (a principio de línea, o a una llamada de
  // `require`/`import()`), NUNCA al nombre suelto del módulo. Razón: la cabecera de
  // `src/cli/inbox.js` DOCUMENTA en prosa por qué no existe acoplamiento con el skill de
  // enrutado; un gate anclado al nombre pondría roja la suite por la propia documentación de la
  // regla que el código respeta. Es el mismo fallo que ya mordió en 83-01 (deviación 2).
  const CHILD_PROCESS_IMPORT_RE = new RegExp(
    [
      "^\\s*(?:import|export)\\b[^\\n]*from\\s*['\"](?:node:)?child_process['\"]",
      "^\\s*import\\s*['\"](?:node:)?child_process['\"]",
      "(?:require|import)\\(\\s*['\"](?:node:)?child_process['\"]\\s*\\)",
    ].join('|'),
    'm',
  );

  const SUBJECTS = Object.freeze([
    join('src', 'inbox', 'store.js'),
    join('src', 'cli', 'capture.js'),
    join('src', 'cli', 'inbox.js'),
  ]);

  it('ningún módulo del inbox importa el módulo de procesos hijo de Node', () => {
    for (const rel of SUBJECTS) {
      const src = readFileSync(join(REPO, rel), 'utf-8');
      assert.ok(
        !CHILD_PROCESS_IMPORT_RE.test(src),
        `${rel} importa node:child_process — el seam de enrutado es DOCUMENTAL (CAPT-04/D-09): ` +
          `kodo nunca invoca ni shellea al skill de enrutado`,
      );
    }
  });

  it('el gate es significativo: el patrón SÍ detecta un import real', () => {
    // Sanity check del propio gate — sin esto, un regex roto pasaría trivialmente.
    assert.ok(CHILD_PROCESS_IMPORT_RE.test("import { spawnSync } from 'node:child_process';"));
    assert.ok(CHILD_PROCESS_IMPORT_RE.test("import { spawn } from 'child_process';"));
    assert.ok(
      !CHILD_PROCESS_IMPORT_RE.test('// este módulo NO usa node:child_process — seam documental'),
      'un comentario que explique la ausencia de acoplamiento no puede poner roja la suite',
    );
  });
});

describe('Gate cero-deps — invariante cross-milestone', () => {
  it('package.json declara EXACTAMENTE 4 dependencias de producción', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8'));
    const keys = Object.keys(pkg.dependencies || {});
    assert.equal(
      keys.length,
      4,
      `INVARIANTE CROSS-MILESTONE ROTO: el inbox se construye con CERO dependencias npm nuevas. ` +
        `package.json declara ${keys.length}: ${keys.join(', ')}`,
    );
  });
});
