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
import { parseLine, MAX_TEXT_LEN } from '../src/inbox/store.js';
import { runCaptureCli } from '../src/cli/capture.js';

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
