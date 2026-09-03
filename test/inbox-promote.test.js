// @ts-check
//
// test/inbox-promote.test.js — KODO-76.
//
// Unit de `promoteCapture` (`src/inbox/promote.js`) y del handler `runInboxPromoteCli`.
//
// El eje del fichero es el ORDEN de las operaciones. `promoteCapture` crea la tarea y LUEGO marca
// la captura, y esa elección se prueba explícitamente en las dos direcciones: que un fallo del
// POST deja la captura ABIERTA (reintentable sin efecto lateral) y que un fallo del marcado
// devuelve la ref de la tarea que SÍ existe (recuperable a mano). Un orden invertido pasaría el
// primer test y fallaría el segundo con una captura cerrada apuntando a nada.
//
// AISLAMIENTO: paths por DI a un sandbox de `mkdtempSync`, provider fake. Cero red, cero HOME.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promoteCapture } from '../src/inbox/promote.js';
import { listCaptures, INBOX_FILENAME, INBOX_LOCK_FILENAME } from '../src/inbox/store.js';
import { runInboxPromoteCli } from '../src/cli/inbox.js';

const UUID_KODO = '7246e3fe-3dc4-4f24-9078-1911ad477e0d';
const UUID_DUP1 = '612583ec-8ac9-4c49-b411-c1019c719ee0';
const UUID_DUP2 = 'd24bcfa4-6eb3-425a-8c9c-9f8357ea8e67';

const PROJECTS = Object.freeze({
  [UUID_KODO]: { default: '/Users/alex/dev/klab/kodo' },
  [UUID_DUP1]: { default: '/Users/alex/dev/klab/dev' },
  [UUID_DUP2]: { default: '/Users/alex/otro/dev' },
});

const LONG_TEXT =
  'Fuga de la suite al log real: cada npm test escribe entradas dispatch.decision con fixtures ' +
  'KODO-42 en el log del operador. Aislar HOME o inyectar el sink del logger.';

/** @type {string} */ let dir;
/** @type {string} */ let inboxPath;
/** @type {string} */ let lockPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kodo-promote-'));
  inboxPath = join(dir, INBOX_FILENAME);
  lockPath = join(dir, INBOX_LOCK_FILENAME);
  writeFileSync(
    inboxPath,
    `- [ ] aaa111 · ${LONG_TEXT} · kodo · 2026-09-03 · cli\n` +
      '- [ ] ccc333 · idea sin proyecto mapeado · fantasma · 2026-09-03 · cli\n' +
      '- [ ] ddd444 · idea ambigua · dev · 2026-09-03 · skill\n' +
      '- [x] bbb222 · ya cerrada · kodo · 2026-09-01 · cli · descartada\n',
  );
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const capture = (/** @type {string} */ id) =>
  listCaptures({ inboxPath }).captures.find((c) => c.id === id);

/** Provider fake que registra los args del POST. */
function fakeProvider(over = {}) {
  const calls = [];
  return {
    calls,
    createTask: async (/** @type {any} */ args) => {
      calls.push(args);
      return { id: 'wi-1', ref: 'KODO-99', url: 'https://plane/KODO-99', ...over };
    },
  };
}

const promote = (/** @type {any} */ over) =>
  promoteCapture({ id: 'aaa111', projects: PROJECTS, inboxPath, lockPath, ...over });

describe('promoteCapture — camino feliz', () => {
  it('crea la tarea con el TITULAR como nombre y el texto ÍNTEGRO en la descripción', async () => {
    const provider = fakeProvider();
    const r = await promote({ provider });
    assert.equal(r.ok, true);
    assert.equal(provider.calls.length, 1);
    const [args] = provider.calls;
    assert.equal(args.title, 'Fuga de la suite al log real', 'el nombre es el titular derivado');
    assert.ok(args.description.includes(LONG_TEXT), 'el cuerpo lleva el texto entero, no el titular');
    assert.match(args.description, /Capturado el 2026-09-03 desde cli · inbox aaa111/);
    assert.equal(args.projectId, UUID_KODO, 'el tag de la captura eligió el proyecto');
  });

  it('la tarea nace en el BACKLOG, no en el estado trigger ni con la marca de adopción', async () => {
    // Sin esto la idea aterrizaría en la columna «en curso» de un tablero donde nadie la está
    // trabajando, y con `kodo:adopted` quedaría marcada como no-lanzable para siempre.
    const provider = fakeProvider();
    await promote({ provider });
    assert.equal(provider.calls[0].placement, 'backlog');
  });

  it('cierra la captura como enrutada apuntando a la ref creada', async () => {
    await promote({ provider: fakeProvider() });
    const c = capture('aaa111');
    assert.equal(c?.open, false);
    assert.equal(c?.estado, 'enrutada');
    assert.equal(c?.dest, 'KODO-99');
  });

  it('`--project` explícito GANA sobre el tag de la captura', async () => {
    const provider = fakeProvider();
    const r = await promote({ provider, projectRef: UUID_DUP1 });
    assert.equal(r.ok, true);
    assert.equal(provider.calls[0].projectId, UUID_DUP1);
  });

  it('cae al id de la tarea cuando el proveedor no devuelve ref', async () => {
    const provider = fakeProvider({ ref: '' });
    await promote({ provider });
    assert.equal(capture('aaa111')?.dest, 'wi-1');
  });
});

describe('promoteCapture — gates previos al POST (nada se crea)', () => {
  it('UNSUPPORTED cuando el proveedor no sabe crear tareas', async () => {
    assert.deepEqual(await promote({ provider: {} }), { ok: false, code: 'UNSUPPORTED' });
    assert.deepEqual(await promote({ provider: null }), { ok: false, code: 'UNSUPPORTED' });
    assert.equal(capture('aaa111')?.open, true);
  });

  it('NOT_FOUND para un id inexistente', async () => {
    const r = await promote({ provider: fakeProvider(), id: 'zzz999' });
    assert.deepEqual(r, { ok: false, code: 'NOT_FOUND' });
  });

  it('ALREADY_CLOSED para una captura ya triada', async () => {
    const provider = fakeProvider();
    const r = await promote({ provider, id: 'bbb222' });
    assert.equal(r.ok, false);
    assert.equal(/** @type {any} */ (r).code, 'ALREADY_CLOSED');
    assert.equal(provider.calls.length, 0, 'ni un POST');
  });

  it('NO_PROJECT cuando el tag no mapea, con la ref que falló en el detalle', async () => {
    const provider = fakeProvider();
    const r = await promote({ provider, id: 'ccc333' });
    assert.equal(/** @type {any} */ (r).code, 'NO_PROJECT');
    assert.equal(/** @type {any} */ (r).detail.ref, 'fantasma');
    assert.equal(provider.calls.length, 0);
    assert.equal(capture('ccc333')?.open, true, 'la captura sigue en la bandeja');
  });

  it('AMBIGUOUS_PROJECT NO elige por el operador: devuelve los candidatos', async () => {
    const provider = fakeProvider();
    const r = await promote({ provider, id: 'ddd444' });
    assert.equal(/** @type {any} */ (r).code, 'AMBIGUOUS_PROJECT');
    assert.deepEqual(
      /** @type {any} */ (r).detail.matches.slice().sort(),
      [UUID_DUP1, UUID_DUP2].sort(),
    );
    assert.equal(provider.calls.length, 0);
  });
});

describe('promoteCapture — el ORDEN crear-luego-marcar', () => {
  it('CREATE_FAILED deja la captura ABIERTA: reintentar es seguro', async () => {
    const r = await promote({
      provider: {
        createTask: async () => {
          throw new Error('502 bad gateway');
        },
      },
    });
    assert.equal(/** @type {any} */ (r).code, 'CREATE_FAILED');
    assert.match(/** @type {any} */ (r).detail, /502/);
    assert.equal(capture('aaa111')?.open, true, 'nada se creó y nada se cerró');
  });

  it('MARK_FAILED llega CON la ref de la tarea que sí existe', async () => {
    // El desenlace que hace que el orden importe: la tarea está creada, así que el mensaje tiene
    // que llevar con qué cerrar la captura a mano. Sin la ref, el operador queda con una tarea
    // huérfana en el tablero y una captura abierta que la duplicará al siguiente intento.
    const r = await promote({
      provider: fakeProvider(),
      markFn: () => ({ ok: false, reason: 'lock-timeout' }),
    });
    assert.equal(/** @type {any} */ (r).code, 'MARK_FAILED');
    assert.deepEqual(/** @type {any} */ (r).detail, {
      ref: 'KODO-99',
      url: 'https://plane/KODO-99',
      reason: 'lock-timeout',
    });
  });
});

describe('runInboxPromoteCli — exit codes y carril JSON', () => {
  const collector = () => {
    let s = '';
    return { write: (/** @type {string} */ x) => void (s += x), get: () => s };
  };
  const deps = (over = {}) => ({
    pathsFn: () => ({ inboxPath, lockPath }),
    getProviderFn: () => fakeProvider(),
    loadProjectsFn: () => PROJECTS,
    ...over,
  });

  it('0 y `--json` emite la ref y la url creadas', async () => {
    const out = collector();
    const code = await runInboxPromoteCli('aaa111', { json: true }, deps({ writeFn: out.write }));
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.get()), {
      ok: true,
      id: 'aaa111',
      ref: 'KODO-99',
      url: 'https://plane/KODO-99',
      project: UUID_KODO,
    });
  });

  it('2 SOLO para CREATE_FAILED — el único desenlace transitorio y reintentable', async () => {
    const err = collector();
    const code = await runInboxPromoteCli(
      'aaa111',
      {},
      deps({
        errFn: err.write,
        getProviderFn: () => ({
          createTask: async () => {
            throw new Error('502');
          },
        }),
      }),
    );
    assert.equal(code, 2);
    assert.match(err.get(), /no se pudo crear la tarea/);
  });

  it('1 con el comando de recuperación exacto cuando la tarea se creó y la captura no se cerró', async () => {
    const err = collector();
    const code = await runInboxPromoteCli(
      'aaa111',
      {},
      deps({
        errFn: err.write,
        promoteFn: async () => ({
          ok: false,
          code: 'MARK_FAILED',
          detail: { ref: 'KODO-99', url: '', reason: 'lock-timeout' },
        }),
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /kodo inbox route aaa111 --dest KODO-99/);
  });

  it('1 y mensaje accionable cuando el proyecto no resuelve', async () => {
    const err = collector();
    const code = await runInboxPromoteCli('ccc333', {}, deps({ errFn: err.write }));
    assert.equal(code, 1);
    assert.match(err.get(), /kodo inbox retag ccc333/);
  });

  it('1 y la lista de candidatos cuando el proyecto es ambiguo', async () => {
    const err = collector();
    const code = await runInboxPromoteCli('ddd444', {}, deps({ errFn: err.write }));
    assert.equal(code, 1);
    assert.match(err.get(), /desambigua con --project/);
    assert.match(err.get(), new RegExp(UUID_DUP1));
  });

  it('1 cuando la resolución de dependencias lanza (config ausente): nada se creó', async () => {
    const err = collector();
    const code = await runInboxPromoteCli(
      'aaa111',
      {},
      deps({
        errFn: err.write,
        getProviderFn: () => {
          throw new Error('provider no configurado');
        },
      }),
    );
    assert.equal(code, 1);
    assert.match(err.get(), /provider no configurado/);
    assert.equal(capture('aaa111')?.open, true);
  });
});
