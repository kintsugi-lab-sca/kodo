// @ts-check
//
// test/inbox-retag.test.js — KODO-76.
//
// Unit de `retagCapture` (`src/inbox/store.js`) y del handler `runInboxRetagCli`.
//
// `retagCapture` reusa el motor RMW de `markCapture` (extraído en KODO-76), así que aquí NO se
// re-testea la maquinaria compartida —lock, unique-tmp, guard compare-and-swap, preservación byte
// a byte— que `inbox-store.test.js` ya cubre. Lo que se prueba es lo PROPIO del retag: qué campo
// cambia, qué campos NO, sobre qué capturas se permite y qué entrada se rechaza.
//
// AISLAMIENTO: todos los paths van por DI a un sandbox de `mkdtempSync`. Este fichero no toca
// HOME y por tanto no puede escribir en el inbox real del desarrollador.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  retagCapture,
  listCaptures,
  INBOX_FILENAME,
  INBOX_LOCK_FILENAME,
} from '../src/inbox/store.js';
import { runInboxRetagCli } from '../src/cli/inbox.js';

/** @type {string} */ let dir;
/** @type {string} */ let inboxPath;
/** @type {string} */ let lockPath;

const OPEN_LINE = '- [ ] aaa111 · una idea con · separadores · dentro · clipping · 2026-09-03 · cli';
const CLOSED_LINE = '- [x] bbb222 · otra idea · kodo · 2026-09-01 · skill · enrutada → KODO-9';
const HAND_EDIT = 'una nota a mano que no parsea';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kodo-retag-'));
  inboxPath = join(dir, INBOX_FILENAME);
  lockPath = join(dir, INBOX_LOCK_FILENAME);
  writeFileSync(inboxPath, `${HAND_EDIT}\n${OPEN_LINE}\n${CLOSED_LINE}\n`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const capture = (/** @type {string} */ id) =>
  listCaptures({ inboxPath }).captures.find((c) => c.id === id);

describe('retagCapture — reasignación del proyecto', () => {
  it('cambia el tag y NADA más', () => {
    const before = capture('aaa111');
    const r = retagCapture('aaa111', 'kodo', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    const after = capture('aaa111');
    assert.equal(after?.tag, 'kodo');
    // El texto es el vector interesante: contiene el separador de campos, y el parser está
    // anclado a la COLA justamente para que eso no lo falsifique. Reescribir la línea no puede
    // haber desplazado ese anclaje.
    assert.equal(after?.text, before?.text);
    assert.equal(after?.date, before?.date);
    assert.equal(after?.origin, before?.origin);
    assert.equal(after?.open, true);
    assert.equal(after?.estado, null);
  });

  it('devuelve la captura PERSISTIDA, no la pre-saneo', () => {
    // El separador dentro del tag no puede llegar al fichero: `encodeLine` lo sustituye. Lo que
    // el caller recibe debe ser lo que está en disco, o la confirmación del CLI mentiría.
    const r = retagCapture('aaa111', 'a · b', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    assert.ok(r.ok === true && !r.capture.tag.includes('·'), `tag sin sanear: ${r.ok === true && r.capture.tag}`);
    assert.equal(r.ok === true && r.capture.tag, capture('aaa111')?.tag);
  });

  it('preserva las líneas ajenas, incluidas las que no parsean', () => {
    retagCapture('aaa111', 'kodo', { inboxPath, lockPath });
    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.equal(lines[0], HAND_EDIT, 'la línea no parseable sobrevive byte a byte');
    assert.equal(lines[2], CLOSED_LINE, 'la otra captura no se toca');
    assert.equal(lines[3], '', 'el newline final se conserva');
  });

  it('rechaza una captura CERRADA: ya fue triada, su línea es traza histórica', () => {
    const r = retagCapture('bbb222', 'otro-proyecto', { inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'already-closed' });
    assert.equal(capture('bbb222')?.tag, 'kodo', 'el tag de una cerrada no se toca');
  });

  it('rechaza un id inexistente', () => {
    assert.deepEqual(retagCapture('zzz999', 'kodo', { inboxPath, lockPath }), {
      ok: false,
      reason: 'not-found',
    });
  });

  it('rechaza un tag que el saneo colapsa a vacío, SIN tomar el lock', () => {
    const before = readFileSync(inboxPath, 'utf-8');
    for (const tag of ['', '   ', '\t\n']) {
      assert.deepEqual(retagCapture('aaa111', tag, { inboxPath, lockPath }), {
        ok: false,
        reason: 'invalid-tag',
      });
    }
    assert.equal(readFileSync(inboxPath, 'utf-8'), before, 'el fichero queda intacto');
  });

  it('un tag que el saneo TRANSFORMA (pero no vacía) se acepta, ya saneado', () => {
    // El separador de campos no colapsa el tag: `sanitizeField` lo sustituye por un guion. Es un
    // tag válido y el gate no debe rechazarlo — rechazarlo confundiría «no se puede escribir» con
    // «hay que reescribirlo».
    const r = retagCapture('aaa111', ' · ', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    assert.equal(capture('aaa111')?.tag, '-');
  });

  it('un inbox ausente es not-found, no un crash', () => {
    rmSync(inboxPath);
    assert.deepEqual(retagCapture('aaa111', 'kodo', { inboxPath, lockPath }), {
      ok: false,
      reason: 'not-found',
    });
  });
});

describe('runInboxRetagCli — exit codes', () => {
  const collector = () => {
    let s = '';
    return { write: (/** @type {string} */ x) => void (s += x), get: () => s };
  };
  const deps = (over = {}) => ({
    pathsFn: () => ({ inboxPath, lockPath }),
    ...over,
  });

  it('0 y confirmación con el proyecto NUEVO', () => {
    const out = collector();
    const code = runInboxRetagCli('aaa111', 'kodo', deps({ writeFn: out.write }));
    assert.equal(code, 0);
    assert.match(out.get(), /aaa111.*kodo/);
  });

  it('2 para id inexistente, captura cerrada y tag inválido (los tres son entrada mala)', () => {
    const err = collector();
    assert.equal(runInboxRetagCli('zzz999', 'kodo', deps({ errFn: err.write })), 2);
    assert.equal(runInboxRetagCli('bbb222', 'kodo', deps({ errFn: err.write })), 2);
    assert.equal(runInboxRetagCli('aaa111', '  ', deps({ errFn: err.write })), 2);
    assert.match(err.get(), /not found/);
    assert.match(err.get(), /already closed/);
  });

  it('1 cuando el store falla por filesystem', () => {
    const err = collector();
    const code = runInboxRetagCli(
      'aaa111',
      'kodo',
      deps({
        errFn: err.write,
        retagFn: () => ({ ok: false, reason: 'lock-timeout' }),
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /lock-timeout/);
  });

  it('un throw del store NO propaga: se mapea a 1', () => {
    const err = collector();
    const code = runInboxRetagCli(
      'aaa111',
      'kodo',
      deps({
        errFn: err.write,
        retagFn: () => {
          throw new Error('boom');
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /boom/);
  });
});
