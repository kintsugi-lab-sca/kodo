// @ts-check
//
// test/inbox-store.test.js — Phase 83 Plan 01 (CAPT-01/03/06; D-02..D-08, D-15..D-20).
//
// Unit de `src/inbox/store.js`:
//   - Codec + parser: la tabla de 15 vectores de `83-RESEARCH.md` §Code Examples, incluidos los
//     DOS forgeries (T-83-01), más el saneo de los tres carriles y la identidad de una captura.
//   - `listCaptures`: reader leaf never-throws (D-18) que jamás escribe.
//   - `appendCapture`: `O_APPEND` de una sola llamada con fail-open ante lock-timeout (D-02/D-03).
//   - `markCapture`: RMW bajo lock con unique-tmp + rename, preservación BYTE A BYTE de toda línea
//     ajena —incluidas las que no parsean, las vacías y el newline final— (D-01/D-04), sin
//     fail-open (contrato 3) y sin residuo de tmp (T-83-03).
//
// AISLAMIENTO (T-83-05, Pitfall 5): **todos** los paths van por DI (`{inboxPath, lockPath}`
// apuntando a un sandbox de `mkdtempSync`). Este fichero NO toca `HOME` en ningún punto y por
// tanto no puede contaminar el `~/.kodo/inbox.md` real del operador. El único test que roza el
// home es el de resolución perezosa de `defaultInboxPaths()`, que solo compara STRINGS de path
// sin tocar el filesystem.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, appendFileSync,
  statSync, lstatSync, existsSync, readdirSync, chmodSync, renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHash } from 'node:crypto';
import { acquireLock, releaseLock } from '../src/session/state-lock.js';
import {
  encodeLine, parseLine, newCaptureId, todayLocal, deriveTag, defaultInboxPaths,
  listCaptures, appendCapture, markCapture,
  INBOX_FILENAME, INBOX_LOCK_FILENAME, MAX_TEXT_LEN, MAX_DEST_LEN,
} from '../src/inbox/store.js';

/** sha256 hex del contenido de un fichero — la prueba dura de «byte-idéntico». */
const sha = (/** @type {string} */ p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** ¿Queda algún tmp residual en el sandbox? (T-83-03) */
const hasTmpResidue = (/** @type {string} */ d) => readdirSync(d).some((f) => f.includes('.tmp.'));

/** @type {string} */ let dir;
/** @type {string} */ let inboxPath;
/** @type {string} */ let lockPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kodo-inbox-'));
  inboxPath = join(dir, INBOX_FILENAME);
  lockPath = join(dir, INBOX_LOCK_FILENAME);
});

afterEach(() => {
  // Restaurar permisos antes de borrar: el test de EACCES deja un fichero a 0o000 y `rmSync`
  // no podría enlazarlo. Los DIRECTORIOS necesitan el bit de ejecución para ser recorridos, así
  // que se discriminan por `lstatSync` (0o700 vs 0o600).
  const restore = (/** @type {string} */ p) => {
    try {
      const st = lstatSync(p);
      chmodSync(p, st.isDirectory() ? 0o700 : 0o600);
      if (st.isDirectory()) for (const e of readdirSync(p)) restore(join(p, e));
    } catch { /* best-effort */ }
  };
  restore(dir);
  rmSync(dir, { recursive: true, force: true });
});

/** Base reutilizable de una captura abierta. @type {any} */
const BASE = {
  id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo',
  date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null,
};

// ---------------------------------------------------------------------------
// Codec + parser
// ---------------------------------------------------------------------------

describe('parseLine — tabla de 15 vectores (83-RESEARCH §Code Examples)', () => {
  /**
   * @type {ReadonlyArray<{ n: string, line: string, expect: any }>}
   * `expect === null` significa NO-MATCH (línea preservada en disco, excluida del listado).
   */
  const VECTORS = Object.freeze([
    {
      n: 'V01 abierta canónica',
      line: '- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V02 cerrada enrutada con dest',
      line: '- [x] a3f9k2 · el texto · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md',
      expect: { id: 'a3f9k2', text: 'el texto', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: '.planning/todos/TODO-012.md' },
    },
    {
      n: 'V03 cerrada enrutada SIN dest (CAPT-06 best-effort)',
      line: '- [x] b7c1m0 · otra idea · ROMAN · 2026-07-25 · cli · enrutada',
      expect: { id: 'b7c1m0', text: 'otra idea', tag: 'ROMAN', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: null },
    },
    {
      n: 'V04 cerrada descartada',
      line: '- [x] c4d8n5 · idea que no va · kodo · 2026-07-25 · cli · descartada',
      expect: { id: 'c4d8n5', text: 'idea que no va', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'descartada', dest: null },
    },
    {
      n: 'V05 texto CON separadores embebidos — verbatim',
      line: '- [ ] a3f9k2 · idea · con · separadores · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'idea · con · separadores', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V06 FORGERY 1 — el texto imita la cola (T-83-01)',
      line: '- [ ] a3f9k2 · idea falsa · kodo · 2026-07-25 · cli · descartada · real · 2026-07-26 · skill',
      expect: { id: 'a3f9k2', text: 'idea falsa · kodo · 2026-07-25 · cli · descartada', tag: 'real', date: '2026-07-26', origin: 'skill', open: true, estado: null, dest: null },
    },
    {
      n: 'V07 FORGERY 2 — fecha falsa embebida en el texto (T-83-01)',
      line: '- [ ] a3f9k2 · nota del 2026-01-01 · x · y · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'nota del 2026-01-01 · x · y', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V08 texto que TERMINA en «descartada» — no se confunde con el sufijo',
      line: '- [ ] a3f9k2 · esto es descartada · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'esto es descartada', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: true, estado: null, dest: null },
    },
    {
      n: 'V09 dest CON separadores dentro — se recupera completo',
      line: '- [x] a3f9k2 · el texto · kodo · 2026-07-25 · cli · enrutada → a · b · c',
      expect: { id: 'a3f9k2', text: 'el texto', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: 'enrutada', dest: 'a · b · c' },
    },
    {
      n: 'V10 hand-edit `- [x]` SIN sufijo → cerrada, cierre desconocido (contrato 2)',
      line: '- [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli',
      expect: { id: 'a3f9k2', text: 'el texto de la idea', tag: 'kodo', date: '2026-07-25', origin: 'cli', open: false, estado: null, dest: null },
    },
    { n: 'V11 NO-MATCH línea hand-written', line: 'esto lo escribi a mano', expect: null },
    { n: 'V12 NO-MATCH heading markdown', line: '## Notas', expect: null },
    { n: 'V13 NO-MATCH fecha inválida', line: '- [ ] a3f9k2 · x · kodo · ayer · cli', expect: null },
    { n: 'V14 NO-MATCH línea vacía', line: '', expect: null },
    { n: 'V15 NO-MATCH tag que contiene el separador (Pitfall 4)', line: '- [ ] a3f9k2 · x · ko·do · 2026-07-25 · cli', expect: null },
  ]);

  it('la tabla tiene exactamente 15 vectores (2 de ellos forgeries)', () => {
    assert.equal(VECTORS.length, 15);
    assert.equal(VECTORS.filter((v) => v.n.includes('FORGERY')).length, 2);
  });

  for (const v of VECTORS) {
    it(v.n, () => {
      assert.deepEqual(parseLine(v.line), v.expect);
    });
  }

  it('parseLine never-throws sobre input no-string', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      assert.equal(parseLine(/** @type {any} */ (bad)), null);
    }
  });
});

describe('encodeLine — saneo del carril de escritura (CAPT-01)', () => {
  it('colapsa `\\n`/`\\r`/`\\t` REALES y sus escapes LITERALES — cero saltos interiores', () => {
    const line = encodeLine({ ...BASE, text: 'a\nb\tc\rd\\ne\\tf' });
    assert.equal(/[\n\r\t]/.test(line), false);
    assert.equal(parseLine(line) !== null, true, 'la línea saneada sigue parseando');
  });

  it('neutraliza U+2028 y U+2029 (Pitfall 10)', () => {
    const line = encodeLine({ ...BASE, text: 'a\u2028b\u2029c' });
    assert.equal(/[\u2028\u2029]/.test(line), false);
    assert.equal(parseLine(line)?.text, 'a b c');
  });

  it('trunca el texto a MAX_TEXT_LEN caracteres (Pitfall 1)', () => {
    const parsed = parseLine(encodeLine({ ...BASE, text: 'x'.repeat(MAX_TEXT_LEN + 500) }));
    assert.equal(parsed?.text.length, MAX_TEXT_LEN);
  });

  it('trunca el dest a MAX_DEST_LEN caracteres', () => {
    const parsed = parseLine(encodeLine({
      ...BASE, open: false, estado: 'enrutada', dest: 'd'.repeat(MAX_DEST_LEN + 300),
    }));
    assert.equal(parsed?.dest?.length, MAX_DEST_LEN);
  });

  it('recorta los bordes del texto pero PRESERVA el whitespace interior (verbatim, CAPT-01)', () => {
    assert.equal(parseLine(encodeLine({ ...BASE, text: '   dos  espacios   ' }))?.text, 'dos  espacios');
  });

  it('tag/origen con el separador o whitespace múltiple salen normalizados y la línea parsea (Pitfall 4, T-83-04)', () => {
    const line = encodeLine({ ...BASE, tag: 'ko · do', origin: 'c   li' });
    const parsed = parseLine(line);
    assert.notEqual(parsed, null, 'un tag con U+00B7 no puede romper el parseo');
    assert.equal(parsed?.tag.includes('·'), false, 'el campo estructurado nunca contiene el separador');
    assert.equal(parsed?.tag, 'ko - do');
    assert.equal(parsed?.origin, 'c li');
  });

  it('una captura cerrada conserva id, texto, tag, fecha y origen (CAPT-03: cerrar no borra)', () => {
    const abierta = parseLine(encodeLine(BASE));
    const cerrada = parseLine(encodeLine({ ...BASE, open: false, estado: 'descartada' }));
    assert.equal(cerrada?.id, abierta?.id);
    assert.equal(cerrada?.text, abierta?.text);
    assert.equal(cerrada?.tag, abierta?.tag);
    assert.equal(cerrada?.date, abierta?.date);
    assert.equal(cerrada?.origin, abierta?.origin);
  });

  it('`enrutada` con dest vacío o solo whitespace no emite trace pointer (CAPT-06)', () => {
    for (const dest of ['', '   ', null]) {
      const line = encodeLine({ ...BASE, open: false, estado: 'enrutada', dest });
      assert.equal(line.includes('→'), false, `dest=${JSON.stringify(dest)}`);
      assert.equal(parseLine(line)?.estado, 'enrutada');
    }
  });

  it('`descartada` nunca emite trace pointer aunque llegue un dest', () => {
    const line = encodeLine({ ...BASE, open: false, estado: 'descartada', dest: 'algo' });
    assert.equal(line.includes('→'), false);
  });
});

describe('Identidad de una captura (D-06, D-07, D-15) + paths perezosos', () => {
  it('newCaptureId devuelve 6 chars de [0-9a-z] y 1000 llamadas dan >= 999 valores distintos', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const id = newCaptureId();
      assert.match(id, /^[0-9a-z]{6}$/);
      ids.add(id);
    }
    assert.ok(ids.size >= 999, `esperado >= 999 ids únicos, obtenidos ${ids.size}`);
  });

  it('todayLocal usa la fecha LOCAL, no UTC (D-07)', () => {
    // 23:30 local del 25 — con `toISOString()` en un huso al este de UTC saldría el 26.
    assert.equal(todayLocal(new Date(2026, 6, 25, 23, 30)), '2026-07-25');
    assert.equal(todayLocal(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  });

  it('deriveTag: match → projectId; sin match → basename(cwd) (D-15)', () => {
    assert.equal(deriveTag('/x/y/kodo', { kodo: '/x/y/kodo' }), 'kodo');
    assert.equal(deriveTag('/x/y/otro', { kodo: '/x/y/kodo' }), 'otro');
  });

  it('deriveTag: shape `ambiguous` cae a basename(cwd) — el SEGUNDO modo de fallo (Pitfall 3)', () => {
    // Dos projectIds con paths de IGUAL longitud → `{error:'ambiguous'}`. Los ids (`alpha`/`beta`)
    // difieren del basename (`zzz`) justo para que el fallback sea distinguible del match.
    assert.equal(deriveTag('/x/y/zzz', { alpha: '/x/y/zzz', beta: '/x/y/zzz' }), 'zzz');
  });

  it('deriveTag never-throws con `projects` corrupto (null, número, array, undefined)', () => {
    for (const corrupt of [null, 42, [1, 2], undefined, { a: null }, { b: { default: 7 } }]) {
      assert.equal(deriveTag('/x/y/zzz', /** @type {any} */ (corrupt)), 'zzz');
    }
  });

  it('defaultInboxPaths se resuelve PEREZOSAMENTE (contrato 7 — sin fuga de HOME al module-load)', () => {
    const prev = process.env.HOME;
    try {
      process.env.HOME = '/tmp/kodo-probe-h1';
      const a = defaultInboxPaths();
      process.env.HOME = '/tmp/kodo-probe-h2';
      const b = defaultInboxPaths();
      assert.notEqual(a.inboxPath, b.inboxPath);
      assert.equal(a.inboxPath.endsWith(join('.kodo', INBOX_FILENAME)), true);
      assert.equal(a.lockPath.endsWith(join('.kodo', INBOX_LOCK_FILENAME)), true);
    } finally {
      if (prev === undefined) delete process.env.HOME;
      else process.env.HOME = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// listCaptures — reader leaf never-throws (D-18)
// ---------------------------------------------------------------------------

describe('listCaptures — never-throws (D-18)', () => {
  it('path inexistente → { captures: [], unparsed: 0 } sin lanzar', () => {
    assert.deepEqual(listCaptures({ inboxPath }), { captures: [], unparsed: 0 });
  });

  it('el path es un DIRECTORIO (EISDIR) → listado vacío sin lanzar', () => {
    mkdirSync(inboxPath, { recursive: true });
    assert.deepEqual(listCaptures({ inboxPath }), { captures: [], unparsed: 0 });
  });

  it('fichero sin permiso de lectura (EACCES) → listado vacío sin lanzar', (t) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      t.skip('root ignora los bits de permiso');
      return;
    }
    writeFileSync(inboxPath, encodeLine(BASE) + '\n');
    chmodSync(inboxPath, 0o000);
    assert.deepEqual(listCaptures({ inboxPath }), { captures: [], unparsed: 0 });
  });

  it('2 válidas + heading + línea a mano + línea vacía → 2 capturas y unparsed: 2', () => {
    writeFileSync(inboxPath, [
      '## Notas',
      encodeLine(BASE),
      '',
      'esto lo escribi a mano',
      encodeLine({ ...BASE, id: 'b7c1m0', text: 'otra idea' }),
    ].join('\n') + '\n');

    const r = listCaptures({ inboxPath });
    assert.equal(r.captures.length, 2);
    assert.deepEqual(r.captures.map((c) => c.id), ['a3f9k2', 'b7c1m0']);
    assert.equal(r.unparsed, 2, 'la línea vacía NO cuenta como no-parseable');
  });

  it('NO escribe: bytes y mtime idénticos antes y después (D-18)', () => {
    const raw = '## Notas\n' + encodeLine(BASE) + '\nbasura\n';
    writeFileSync(inboxPath, raw);
    const before = statSync(inboxPath);
    listCaptures({ inboxPath });
    listCaptures({ inboxPath });
    const after = statSync(inboxPath);
    assert.equal(readFileSync(inboxPath, 'utf-8'), raw);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  });

  it('una captura cerrada sigue listada (la traza permanente es consultable — CAPT-03)', () => {
    writeFileSync(inboxPath, encodeLine({ ...BASE, open: false, estado: 'descartada' }) + '\n');
    const r = listCaptures({ inboxPath });
    assert.equal(r.captures.length, 1);
    assert.equal(r.captures[0].open, false);
    assert.equal(r.captures[0].estado, 'descartada');
    assert.equal(r.captures[0].text, BASE.text);
  });
});

// ---------------------------------------------------------------------------
// appendCapture — O_APPEND + fail-open (D-02, D-03, D-19)
// ---------------------------------------------------------------------------

describe('appendCapture — O_APPEND y creación on-demand (D-02, D-19)', () => {
  it('crea el directorio inexistente y escribe la línea SIN cabecera (D-19)', () => {
    const nested = join(dir, 'sub', 'dir', INBOX_FILENAME);
    const nestedLock = join(dir, 'sub', 'dir', INBOX_LOCK_FILENAME);
    const r = appendCapture(encodeLine(BASE) + '\n', { inboxPath: nested, lockPath: nestedLock });
    assert.deepEqual(r, { ok: true, coordinated: true });

    const raw = readFileSync(nested, 'utf-8');
    assert.equal(raw[0], '-', 'el primer byte es el `-` de la línea: sin cabecera ni preámbulo');
    assert.equal(raw, encodeLine(BASE) + '\n');
  });

  it('dos llamadas seguidas producen exactamente 2 líneas, en orden', () => {
    const a = encodeLine(BASE) + '\n';
    const b = encodeLine({ ...BASE, id: 'b7c1m0', text: 'segunda' }) + '\n';
    appendCapture(a, { inboxPath, lockPath });
    appendCapture(b, { inboxPath, lockPath });

    const raw = readFileSync(inboxPath, 'utf-8');
    assert.equal(raw, a + b);
    assert.equal(raw.split('\n').filter((l) => l !== '').length, 2);
    assert.deepEqual(listCaptures({ inboxPath }).captures.map((c) => c.id), ['a3f9k2', 'b7c1m0']);
  });

  it('sobre un fichero SIN newline final antepone un newline — jamás concatena sobre la línea previa', () => {
    const handEdited = '- [ ] zzz999 · linea hand-editada sin newline · kodo · 2026-07-24 · cli';
    writeFileSync(inboxPath, handEdited); // sin '\n' final, deliberadamente
    appendCapture(encodeLine(BASE) + '\n', { inboxPath, lockPath });

    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.equal(lines[0], handEdited, 'la línea hand-editada conserva sus bytes originales');
    assert.equal(lines[1], encodeLine(BASE));
    assert.equal(listCaptures({ inboxPath }).captures.length, 2);
  });

  it('sobre un fichero CON newline final no antepone nada (cero líneas vacías espurias)', () => {
    writeFileSync(inboxPath, encodeLine(BASE) + '\n');
    appendCapture(encodeLine({ ...BASE, id: 'b7c1m0' }) + '\n', { inboxPath, lockPath });
    assert.equal(readFileSync(inboxPath, 'utf-8').includes('\n\n'), false);
  });

  it('lock libre → { ok:true, coordinated:true } y warnFn NO se invoca', () => {
    /** @type {string[]} */ const warns = [];
    const r = appendCapture(encodeLine(BASE) + '\n', {
      inboxPath, lockPath, warnFn: (s) => warns.push(s),
    });
    assert.deepEqual(r, { ok: true, coordinated: true });
    assert.deepEqual(warns, []);
  });
});

describe('appendCapture — fail-open ante lock-timeout (D-03, contrato 6)', () => {
  it('lock ocupado → la línea SÍ se escribe, coordinated:false y EXACTAMENTE un warn accionable', () => {
    const got = acquireLock(lockPath);
    assert.notEqual(got, null, 'el test debe poder tomar el lock primero');

    /** @type {string[]} */ const warns = [];
    let consoleWarns = 0;
    const realConsoleWarn = console.warn;
    console.warn = () => { consoleWarns++; };
    let r;
    try {
      r = appendCapture(encodeLine(BASE) + '\n', {
        inboxPath, lockPath, warnFn: (s) => warns.push(s),
      });
    } finally {
      console.warn = realConsoleWarn;
      releaseLock(lockPath, /** @type {{token:string}} */ (got).token);
    }

    assert.deepEqual(r, { ok: true, coordinated: false });
    assert.equal(readFileSync(inboxPath, 'utf-8'), encodeLine(BASE) + '\n', 'D-03: la idea NO se pierde');
    assert.equal(warns.length, 1, 'exactamente UN mensaje accionable (contrato 6)');
    assert.match(warns[0], /^\[kodo:inbox\] lock-timeout/);
    assert.equal(warns[0].endsWith('\n'), true);
    assert.equal(consoleWarns, 0, 'el console.warn por defecto de withFileLock queda silenciado');
  });

  it('un fallo de escritura del filesystem devuelve { ok:false, reason:"fs" } sin lanzar', () => {
    // `inboxPath` es un DIRECTORIO: el lock se toma bien, pero el append falla con EISDIR.
    mkdirSync(inboxPath, { recursive: true });
    const r = appendCapture(encodeLine(BASE) + '\n', { inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'fs' });
  });

  it('no deja ningún fichero temporal residual en el directorio', () => {
    appendCapture(encodeLine(BASE) + '\n', { inboxPath, lockPath });
    assert.equal(readdirSync(dir).some((f) => f.includes('.tmp.')), false);
    assert.equal(existsSync(inboxPath), true);
  });
});

// ---------------------------------------------------------------------------
// markCapture — RMW bajo lock con unique-tmp + rename (D-01, D-04, T-83-02/03)
// ---------------------------------------------------------------------------

/**
 * Fixture de 6 líneas — 3 capturas válidas + 1 heading + 1 línea hand-written + 1 línea vacía.
 * La captura de la posición 0 es la que se marca en los tests de preservación.
 * @type {ReadonlyArray<string>}
 */
const FIXTURE_LINES = Object.freeze([
  '- [ ] a3f9k2 · primera captura · kodo · 2026-07-25 · cli',
  '## Notas del operador',
  '- [ ] b7c1m0 · segunda captura · ROMAN · 2026-07-25 · cli',
  'esto lo escribi a mano y no parsea',
  '',
  '- [x] c4d8n5 · tercera captura · kodo · 2026-07-24 · cli · descartada',
]);

/**
 * Siembra el fixture. `trailingNewline` discrimina los dos casos de D-04.
 * @param {string} p
 * @param {boolean} trailingNewline
 */
function seedFixture(p, trailingNewline) {
  writeFileSync(p, FIXTURE_LINES.join('\n') + (trailingNewline ? '\n' : ''));
}

describe('markCapture — cierre de una captura (CAPT-03, CAPT-06, D-10)', () => {
  beforeEach(() => seedFixture(inboxPath, true));

  it('`enrutada` CON dest cierra la línea con el trace pointer', () => {
    const r = markCapture('a3f9k2', 'enrutada', {
      dest: '.planning/todos/TODO-012.md', inboxPath, lockPath,
    });
    assert.equal(r.ok, true);
    assert.equal(r.capture?.open, false);
    assert.equal(r.capture?.estado, 'enrutada');
    assert.equal(r.capture?.dest, '.planning/todos/TODO-012.md');

    const line = readFileSync(inboxPath, 'utf-8').split('\n')[0];
    assert.equal(line, '- [x] a3f9k2 · primera captura · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md');
  });

  it('`enrutada` SIN dest cierra igualmente y devuelve ok — la falta de ref nunca bloquea (CAPT-06)', () => {
    const r = markCapture('a3f9k2', 'enrutada', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    assert.equal(r.capture?.dest, null);

    const line = readFileSync(inboxPath, 'utf-8').split('\n')[0];
    assert.equal(line, '- [x] a3f9k2 · primera captura · kodo · 2026-07-25 · cli · enrutada');
    assert.equal(line.includes('→'), false);
  });

  it('`descartada` cierra con su sufijo', () => {
    const r = markCapture('b7c1m0', 'descartada', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    assert.equal(r.capture?.estado, 'descartada');
    assert.equal(
      readFileSync(inboxPath, 'utf-8').split('\n')[2],
      '- [x] b7c1m0 · segunda captura · ROMAN · 2026-07-25 · cli · descartada',
    );
  });

  it('la captura marcada SIGUE en el fichero con id/texto/tag/fecha/origen intactos (CAPT-03: cero borrado)', () => {
    const before = readFileSync(inboxPath, 'utf-8').split('\n');
    markCapture('a3f9k2', 'descartada', { inboxPath, lockPath });
    const after = readFileSync(inboxPath, 'utf-8').split('\n');

    assert.equal(after.length, before.length, 'el número de líneas del fichero no cambia');
    const c = parseLine(after[0]);
    assert.equal(c?.id, 'a3f9k2');
    assert.equal(c?.text, 'primera captura');
    assert.equal(c?.tag, 'kodo');
    assert.equal(c?.date, '2026-07-25');
    assert.equal(c?.origin, 'cli');
    assert.equal(listCaptures({ inboxPath }).captures.length, 3, 'las 3 capturas siguen listadas');
  });

  it('localiza por ID, nunca por índice: la captura de la línea 3 se marca en su sitio (D-06)', () => {
    const r = markCapture('b7c1m0', 'enrutada', { inboxPath, lockPath, dest: 'SEED-012' });
    assert.equal(r.ok, true);
    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.equal(lines[2].endsWith('· enrutada → SEED-012'), true, 'se marcó la línea del ID');
    assert.equal(lines[0], FIXTURE_LINES[0], 'la línea 0 (otro ID) no se tocó');
  });
});

describe('markCapture — preservación BYTE A BYTE de toda línea ajena (D-04, el invariante)', () => {
  for (const trailingNewline of [true, false]) {
    it(`fixture de 6 líneas ${trailingNewline ? 'CON' : 'SIN'} newline final: las otras 5 líneas y el terminador sobreviven`, () => {
      seedFixture(inboxPath, trailingNewline);
      const rawBefore = readFileSync(inboxPath, 'utf-8');
      const before = rawBefore.split('\n');

      const r = markCapture('a3f9k2', 'enrutada', { dest: '999.4', inboxPath, lockPath });
      assert.equal(r.ok, true);

      const rawAfter = readFileSync(inboxPath, 'utf-8');
      const after = rawAfter.split('\n');

      assert.equal(after.length, before.length, 'mismo número de elementos → mismo terminador');
      assert.deepEqual(after.slice(1), before.slice(1), 'las 5 líneas restantes, byte a byte');
      assert.equal(
        rawAfter.endsWith('\n'), trailingNewline,
        'la presencia/ausencia de newline final se conserva',
      );
      // Exactamente UNA línea cambiada.
      const changed = before.reduce((n, l, i) => n + (l === after[i] ? 0 : 1), 0);
      assert.equal(changed, 1);
      // La línea vacía y la que no parsea siguen ahí, intactas.
      assert.equal(after[3], 'esto lo escribi a mano y no parsea');
      assert.equal(after[4], '');
      assert.equal(after[1], '## Notas del operador');
      // Los bytes NO tocados son idénticos en longitud.
      assert.equal(
        rawAfter.length - after[0].length,
        rawBefore.length - before[0].length,
      );
    });
  }

  it('no deja residuo de tmp tras 10 invocaciones mixtas (T-83-03)', () => {
    seedFixture(inboxPath, true);
    const calls = [
      () => markCapture('a3f9k2', 'enrutada', { dest: 'x', inboxPath, lockPath }),
      () => markCapture('a3f9k2', 'enrutada', { inboxPath, lockPath }),      // already-closed
      () => markCapture('no-existe', 'descartada', { inboxPath, lockPath }), // not-found
      () => markCapture('b7c1m0', 'descartada', { inboxPath, lockPath }),
      () => markCapture('c4d8n5', 'enrutada', { inboxPath, lockPath }),      // already-closed
    ];
    for (let i = 0; i < 2; i++) for (const c of calls) c();
    assert.equal(hasTmpResidue(dir), false, `residuo en: ${readdirSync(dir).join(', ')}`);
  });
});

describe('markCapture — rutas de fallo, todas sin reescribir el fichero', () => {
  it('id inexistente → not-found y el fichero queda byte-idéntico (sha256)', () => {
    seedFixture(inboxPath, true);
    const before = sha(inboxPath);
    const r = markCapture('zzzzzz', 'enrutada', { inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'not-found' });
    assert.equal(sha(inboxPath), before);
  });

  it('captura ya cerrada CON sufijo → already-closed, fichero intacto', () => {
    seedFixture(inboxPath, true);
    const before = sha(inboxPath);
    const r = markCapture('c4d8n5', 'enrutada', { dest: 'x', inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'already-closed' });
    assert.equal(sha(inboxPath), before);
  });

  it('hand-edit `- [x]` SIN sufijo → already-closed y NO se reescribe (contrato 2)', () => {
    const handEdited = '- [x] d5e6f7 · marcada a mano sin sufijo · kodo · 2026-07-25 · cli';
    writeFileSync(inboxPath, handEdited + '\n');
    const before = sha(inboxPath);

    assert.equal(parseLine(handEdited)?.open, false, 'el checkbox es la autoridad');
    assert.equal(parseLine(handEdited)?.estado, null, 'cierre desconocido');

    const r = markCapture('d5e6f7', 'enrutada', { inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'already-closed' });
    assert.equal(sha(inboxPath), before);
  });

  it('fichero inexistente → not-found y NO se crea nada', () => {
    const r = markCapture('a3f9k2', 'enrutada', { inboxPath, lockPath });
    assert.deepEqual(r, { ok: false, reason: 'not-found' });
    assert.equal(existsSync(inboxPath), false);
  });

  it('lock ocupado → lock-timeout y fichero INTACTO (contrato 3: sin fail-open)', () => {
    seedFixture(inboxPath, true);
    const before = sha(inboxPath);
    const got = acquireLock(lockPath);
    assert.notEqual(got, null);

    let consoleWarns = 0;
    const realConsoleWarn = console.warn;
    console.warn = () => { consoleWarns++; };
    let r;
    try {
      r = markCapture('a3f9k2', 'enrutada', { dest: 'x', inboxPath, lockPath });
    } finally {
      console.warn = realConsoleWarn;
      releaseLock(lockPath, /** @type {{token:string}} */ (got).token);
    }

    assert.deepEqual(r, { ok: false, reason: 'lock-timeout' });
    assert.equal(sha(inboxPath), before, 'la asimetría con D-03 es deliberada: el marcado NO reescribe');
    assert.equal(consoleWarns, 0, 'el console.warn de la primitiva queda silenciado');
    assert.equal(hasTmpResidue(dir), false);
  });

  it('dos líneas con el MISMO id → se marca la primera; la segunda queda abierta (contrato 5)', () => {
    writeFileSync(inboxPath, [
      '- [ ] dupdup · primera con id duplicado · kodo · 2026-07-25 · cli',
      '- [ ] dupdup · segunda con id duplicado · kodo · 2026-07-25 · cli',
    ].join('\n') + '\n');

    const r = markCapture('dupdup', 'descartada', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.equal(parseLine(lines[0])?.open, false);
    assert.equal(parseLine(lines[1])?.open, true, 'la segunda sigue abierta');
    assert.equal(parseLine(lines[1])?.text, 'segunda con id duplicado');
  });
});

describe('markCapture — seam `_afterReadFn` (D-21.2)', () => {
  it('se invoca EXACTAMENTE una vez, dentro del lock y ANTES de publicar', () => {
    seedFixture(inboxPath, true);
    const rawBefore = readFileSync(inboxPath, 'utf-8');

    let calls = 0;
    let lockHeldDuringHook = false;
    let fileStillOldDuringHook = false;

    const r = markCapture('a3f9k2', 'enrutada', {
      dest: '999.4', inboxPath, lockPath,
      _afterReadFn: () => {
        calls++;
        lockHeldDuringHook = existsSync(lockPath);
        fileStillOldDuringHook = readFileSync(inboxPath, 'utf-8') === rawBefore;
      },
    });

    assert.equal(r.ok, true);
    assert.equal(calls, 1);
    assert.equal(lockHeldDuringHook, true, 'el hook corre DENTRO de la sección crítica');
    assert.equal(fileStillOldDuringHook, true, 'el hook corre ANTES del rename de publicación');
    assert.notEqual(readFileSync(inboxPath, 'utf-8'), rawBefore, 'tras el hook sí se publicó');
  });

  it('el default es no-op: markCapture funciona sin el hook', () => {
    seedFixture(inboxPath, true);
    assert.equal(markCapture('a3f9k2', 'descartada', { inboxPath, lockPath }).ok, true);
  });
});

// ---------------------------------------------------------------------------
// markCapture — guard compare-and-swap (Plan 04, GAP-1 / CR-02)
// ---------------------------------------------------------------------------

/**
 * Siembra el fixture con un byte que NO es UTF-8 válido en una línea AJENA.
 *
 * Es la variante elegida para provocar el AGOTAMIENTO del RMW. Razón: el seam `_afterReadFn`
 * pertenece deliberadamente al PRIMER intento (si se disparase en cada uno, el hold del test de
 * concurrencia se multiplicaría por el número de intentos y el escenario dejaría de converger), y
 * espiar el `statSync` del guard exigiría meter código de test en producción — justo lo que este
 * repo prohíbe. En su lugar se siembra una condición de mismatch PERMANENTE y libre de reloj:
 * `readFileSync(…, 'utf-8')` sustituye el byte huérfano `0x80` por U+FFFD (3 bytes), así que
 * `Buffer.byteLength(raw, 'utf-8')` NUNCA puede igualar el `size` del fichero y el guard reporta
 * «cambiado» en los N intentos, sin depender de ninguna carrera ni de ningún timing.
 *
 * Cubre además el caso real que esa desigualdad protege: publicar el buffer reescribiría ese byte
 * ajeno como mojibake, violando la preservación byte a byte de D-04.
 *
 * @param {string} p
 */
function seedFixtureWithInvalidUtf8(p) {
  writeFileSync(p, Buffer.concat([
    Buffer.from(FIXTURE_LINES.join('\n') + '\n', 'utf-8'),
    Buffer.from([0x80]), // byte de continuación UTF-8 huérfano, en una línea que no es la marcada
    Buffer.from('\n', 'utf-8'),
  ]));
}

describe('markCapture — guard compare-and-swap contra la lectura obsoleta (GAP-1, CR-02)', () => {
  it('un append en la ventana lectura→rename NO se pierde: el RMW se rehace sobre el fichero nuevo', () => {
    seedFixture(inboxPath, true);
    const extra = '- [ ] e9x1y2 · captura appendeada durante la ventana · kodo · 2026-07-25 · cli';

    let hookCalls = 0;
    const r = markCapture('a3f9k2', 'enrutada', {
      dest: '999.4', inboxPath, lockPath,
      _afterReadFn: () => { hookCalls++; appendFileSync(inboxPath, extra + '\n'); },
    });

    assert.equal(r.ok, true, 'el marcado converge en un segundo intento');
    assert.equal(hookCalls, 1, 'el seam pertenece al PRIMER intento: no se multiplica con el reintento');

    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.ok(lines.includes(extra), 'la captura appendeada durante la ventana NO se pierde (CR-02)');
    assert.equal(parseLine(lines[0])?.open, false, 'la línea objetivo quedó marcada');
    assert.equal(parseLine(lines[0])?.dest, '999.4');
    assert.equal(listCaptures({ inboxPath }).captures.length, 4, '3 del fixture + la appendeada');
    assert.equal(hasTmpResidue(dir), false);
  });

  it('toda línea ajena sobrevive byte a byte AUNQUE el RMW se rehaga (D-04 a través del reintento)', () => {
    seedFixture(inboxPath, true);
    const extra = '- [ ] e9x1y2 · appendeada en la ventana · kodo · 2026-07-25 · cli';

    const r = markCapture('a3f9k2', 'descartada', {
      inboxPath, lockPath,
      _afterReadFn: () => appendFileSync(inboxPath, extra + '\n'),
    });
    assert.equal(r.ok, true);

    const after = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.deepEqual(
      after.slice(1, FIXTURE_LINES.length),
      FIXTURE_LINES.slice(1),
      'las 5 líneas ajenas del fixture, byte a byte, tras el reintento',
    );
    assert.equal(after[FIXTURE_LINES.length], extra, 'la línea appendeada conserva sus bytes');
  });

  it('una publicación por rename de un tercero con el MISMO tamaño se detecta por INODO', () => {
    seedFixture(inboxPath, true);
    const original = readFileSync(inboxPath, 'utf-8');
    // Mismo número de bytes EXACTO: solo cambia un carácter ASCII de una línea ajena. Sin el
    // componente `ino` del baseline, el guard de tamaño sería ciego a este caso.
    const replaced = original.replace('## Notas del operador', '## Notas del operadoR');
    assert.equal(Buffer.byteLength(replaced, 'utf-8'), Buffer.byteLength(original, 'utf-8'));

    let hookCalls = 0;
    const r = markCapture('a3f9k2', 'enrutada', {
      dest: 'INO', inboxPath, lockPath,
      _afterReadFn: () => {
        hookCalls++;
        const publicado = join(dir, 'tercero.publicacion');
        writeFileSync(publicado, replaced);
        renameSync(publicado, inboxPath); // inodo NUEVO, mismo tamaño
      },
    });

    assert.equal(r.ok, true);
    assert.equal(hookCalls, 1);
    const after = readFileSync(inboxPath, 'utf-8');
    assert.ok(after.includes('## Notas del operadoR'), 'el RMW se rehízo sobre el fichero NUEVO');
    assert.equal(parseLine(after.split('\n')[0])?.open, false);
    assert.equal(parseLine(after.split('\n')[0])?.dest, 'INO');
    assert.equal(hasTmpResidue(dir), false);
  });

  it('agotados los intentos → concurrent-write, fichero byte-idéntico y línea objetivo ABIERTA', () => {
    seedFixtureWithInvalidUtf8(inboxPath);
    const before = sha(inboxPath);

    const r = markCapture('a3f9k2', 'enrutada', { dest: 'x', inboxPath, lockPath });

    assert.deepEqual(r, { ok: false, reason: 'concurrent-write' });
    assert.equal(sha(inboxPath), before, 'no se publicó ninguna versión: el fichero queda intacto');
    assert.equal(
      parseLine(readFileSync(inboxPath, 'utf-8').split('\n')[0])?.open, true,
      'la línea objetivo sigue ABIERTA — el fallo es ruidoso, nunca un clobber',
    );
  });

  it('el agotamiento no deja NINGÚN fichero temporal residual', () => {
    seedFixtureWithInvalidUtf8(inboxPath);
    markCapture('a3f9k2', 'enrutada', { dest: 'x', inboxPath, lockPath });
    assert.equal(hasTmpResidue(dir), false, `residuo en: ${readdirSync(dir).join(', ')}`);
  });

  it('agotamiento CON un append en la ventana: la línea appendeada sobrevive igual', () => {
    seedFixtureWithInvalidUtf8(inboxPath);
    const extra = '- [ ] e9x1y2 · appendeada durante un agotamiento · kodo · 2026-07-25 · cli';

    const r = markCapture('a3f9k2', 'enrutada', {
      dest: 'x', inboxPath, lockPath,
      _afterReadFn: () => appendFileSync(inboxPath, extra + '\n'),
    });

    assert.deepEqual(r, { ok: false, reason: 'concurrent-write' });
    const lines = readFileSync(inboxPath, 'utf-8').split('\n');
    assert.ok(lines.includes(extra), 'la captura appendeada NO se pierde ni cuando el RMW se rinde');
    assert.equal(parseLine(lines[0])?.open, true, 'la línea objetivo sigue abierta');
    assert.equal(hasTmpResidue(dir), false);
  });

  it('`not-found` y `already-closed` siguen siendo terminales y no consumen el fichero', () => {
    seedFixture(inboxPath, true);
    const before = sha(inboxPath);
    assert.deepEqual(
      markCapture('zzzzzz', 'enrutada', { inboxPath, lockPath }),
      { ok: false, reason: 'not-found' },
    );
    assert.deepEqual(
      markCapture('c4d8n5', 'enrutada', { inboxPath, lockPath }),
      { ok: false, reason: 'already-closed' },
    );
    assert.equal(sha(inboxPath), before);
  });
});

describe('markCapture — devuelve la captura PERSISTIDA, no el objeto pre-saneo (WR-07, CAPT-06)', () => {
  it('un dest por encima de MAX_DEST_LEN se devuelve ya recortado, igual que en el fichero', () => {
    seedFixture(inboxPath, true);
    const r = markCapture('a3f9k2', 'enrutada', {
      dest: 'd'.repeat(MAX_DEST_LEN + 50), inboxPath, lockPath,
    });
    assert.equal(r.ok, true);

    const onDisk = parseLine(readFileSync(inboxPath, 'utf-8').split('\n')[0]);
    assert.equal(r.capture?.dest?.length, MAX_DEST_LEN, 'la confirmación no puede anunciar más de lo escrito');
    assert.deepEqual(r.capture, onDisk, 'lo devuelto es EXACTAMENTE lo persistido');
  });

  it('`descartada` no conserva un dest que la línea escrita no contiene', () => {
    seedFixture(inboxPath, true);
    const r = markCapture('a3f9k2', 'descartada', {
      dest: 'ref-que-nunca-se-escribe', inboxPath, lockPath,
    });
    assert.equal(r.ok, true);
    assert.equal(r.capture?.dest, null);
    assert.deepEqual(r.capture, parseLine(readFileSync(inboxPath, 'utf-8').split('\n')[0]));
  });

  it('un texto hand-editado por encima de MAX_TEXT_LEN se devuelve recortado como en el fichero', () => {
    writeFileSync(inboxPath, `- [ ] lng001 · ${'y'.repeat(MAX_TEXT_LEN + 40)} · kodo · 2026-07-25 · cli\n`);
    const r = markCapture('lng001', 'descartada', { inboxPath, lockPath });
    assert.equal(r.ok, true);
    assert.equal(r.capture?.text.length, MAX_TEXT_LEN);
    assert.deepEqual(r.capture, parseLine(readFileSync(inboxPath, 'utf-8').split('\n')[0]));
  });
});
