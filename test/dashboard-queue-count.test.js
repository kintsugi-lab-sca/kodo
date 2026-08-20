// @ts-check
//
// test/dashboard-queue-count.test.js — KODO-26: el conteo de la cola en el header del TUI.
//
// Dos mitades, igual que su hermano `dashboard-inbox-count.test.js`:
//   1. El LEAF (`readPendingIntegrationCount`): never-throws de cuerpo entero, resolución
//      perezosa del HOME y — la parte que impide la deriva — el ANTI-DRIFT contra el filtro
//      real del store. El leaf duplica «qué cuenta como pendiente» para no arrastrar
//      `state.js` + `config.js` + el lock al grafo del TUI; esa duplicación solo es aceptable
//      si un test la ata a su oráculo.
//   2. El RENDER: la copy aparece cuando hay entradas y la cabecera queda BYTE-IDÉNTICA a la
//      previa cuando no las hay.
//
// Disciplina de HOME: todos los fixtures viven en un `mkdtempSync` inyectado por DI
// (`kodoDir`/`homedirFn`/`readFileFn`). NUNCA se toca `process.env` y NUNCA se lee el
// `~/.kodo/state.json` real — tampoco de rebote: los tests de render inyectan `queueCountFn`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { readPendingIntegrationCount } from '../src/cli/dashboard/queue-count.js';
import SessionTable from '../src/cli/dashboard/SessionTable.js';

/** Escribe un state.json de fixture bajo un kodoDir aislado y devuelve ese dir. */
function fixtureDir(state) {
  const dir = mkdtempSync(join(tmpdir(), 'kodo-qcount-'));
  mkdirSync(join(dir, '.kodo'), { recursive: true });
  writeFileSync(join(dir, '.kodo', 'state.json'), JSON.stringify(state, null, 2) + '\n');
  return dir;
}

/** Entrada de cola mínima con el `status` que pida el caso. */
function qEntry(status, branch) {
  return {
    task_ref: `T-${branch}`,
    task_id: null,
    project_path: '/repo/x',
    branch,
    base_branch: 'main',
    commits_ahead: 1,
    base_ok: true,
    files_changed: 1,
    lines_changed: 1,
    suggested: 'merge',
    status,
    created_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-20T10:00:00.000Z',
    action: status === 'pending' ? null : 'drop',
    sha: null,
    outcome: status === 'pending' ? null : 'dropped',
    resolved_at: status === 'pending' ? null : '2026-08-20T11:00:00.000Z',
  };
}

describe('readPendingIntegrationCount — solo cuenta lo PENDIENTE', () => {
  it('cuenta las pendientes e ignora las resueltas (que siguen ahí como traza)', (t) => {
    const dir = fixtureDir({
      schema_version: 3,
      sessions: {},
      integration_queue: [
        qEntry('pending', 'a'),
        qEntry('done', 'b'),
        qEntry('dropped', 'c'),
        qEntry('pending', 'd'),
      ],
    });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ kodoDir: join(dir, '.kodo') }), 2);
  });

  it('un state.json sin la clave aditiva → 0 (no es un error: es lo normal antes de KODO-26)', (t) => {
    const dir = fixtureDir({ schema_version: 3, sessions: {}, history: [] });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ kodoDir: join(dir, '.kodo') }), 0);
  });

  it('anti-drift: el leaf coincide EXACTAMENTE con el filtro del store sobre el mismo fixture', async (t) => {
    // El oráculo es `listIntegrationQueue`, importado AQUÍ y solo aquí. Se le pasa el
    // `loadStateFn` del fixture para no tocar el HOME real. Si alguien cambia qué cuenta como
    // pendiente en un sitio y no en el otro, esta línea se pone roja.
    const state = {
      schema_version: 3,
      sessions: {},
      integration_queue: [
        qEntry('pending', 'a'),
        qEntry('done', 'b'),
        qEntry('pending', 'c'),
        qEntry('dropped', 'd'),
        qEntry('pending', 'e'),
      ],
    };
    const dir = fixtureDir(state);
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const { listIntegrationQueue } = await import('../src/integration/queue.js');
    const oracle = listIntegrationQueue({}, { loadStateFn: () => state }).length;
    assert.equal(readPendingIntegrationCount({ kodoDir: join(dir, '.kodo') }), oracle);
    assert.equal(oracle, 3, 'valor absoluto, para que el test no pueda coincidir en 0');
  });
});

describe('readPendingIntegrationCount — never-throws de cuerpo entero', () => {
  it('fichero ausente, JSON corrupto, clave de tipo inesperado y entradas basura → 0', (t) => {
    const missing = mkdtempSync(join(tmpdir(), 'kodo-qcount-none-'));
    t.after(() => rmSync(missing, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ kodoDir: join(missing, '.kodo') }), 0);

    const corrupt = mkdtempSync(join(tmpdir(), 'kodo-qcount-bad-'));
    mkdirSync(join(corrupt, '.kodo'), { recursive: true });
    writeFileSync(join(corrupt, '.kodo', 'state.json'), '{ esto no es json');
    t.after(() => rmSync(corrupt, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ kodoDir: join(corrupt, '.kodo') }), 0);

    const weird = fixtureDir({ schema_version: 3, sessions: {}, integration_queue: 'no-soy-un-array' });
    t.after(() => rmSync(weird, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ kodoDir: join(weird, '.kodo') }), 0);

    const junk = fixtureDir({ schema_version: 3, sessions: {}, integration_queue: [null, 42, {}, qEntry('pending', 'a')] });
    t.after(() => rmSync(junk, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ kodoDir: join(junk, '.kodo') }), 1);
  });

  it('un fallo al RESOLVER el path también degrada a 0, no lanza', () => {
    assert.equal(
      readPendingIntegrationCount({ homedirFn: () => { throw new Error('sin HOME'); } }),
      0,
    );
    // @ts-expect-error — kodoDir no-string: `join` lanzaría si la resolución viviera fuera del try.
    assert.equal(readPendingIntegrationCount({ kodoDir: 42 }), 0);
  });

  it('un readFileFn que lanza (EACCES, EISDIR) → 0', () => {
    assert.equal(
      readPendingIntegrationCount({ readFileFn: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } }),
      0,
    );
  });
});

describe('readPendingIntegrationCount — resolución perezosa del path', () => {
  it('dos kodoDir distintos dan conteos distintos EN EL MISMO PROCESO', (t) => {
    const uno = fixtureDir({ schema_version: 3, sessions: {}, integration_queue: [qEntry('pending', 'a')] });
    const dos = fixtureDir({
      schema_version: 3,
      sessions: {},
      integration_queue: [qEntry('pending', 'a'), qEntry('pending', 'b')],
    });
    t.after(() => { rmSync(uno, { recursive: true, force: true }); rmSync(dos, { recursive: true, force: true }); });
    assert.equal(readPendingIntegrationCount({ kodoDir: join(uno, '.kodo') }), 1);
    assert.equal(readPendingIntegrationCount({ kodoDir: join(dos, '.kodo') }), 2);
  });

  it('con `homedirFn` inyectado resuelve bajo ese HOME simulado', (t) => {
    const dir = fixtureDir({ schema_version: 3, sessions: {}, integration_queue: [qEntry('pending', 'a')] });
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.equal(readPendingIntegrationCount({ homedirFn: () => dir }), 1);
  });
});

/** Props mínimas de un render DIRECTO de SessionTable (molde de dashboard-inbox-count.test.js). */
const TABLE_BASE = {
  rows: [],
  selectedIndex: -1,
  counts: { running: 3, review: 1, done: 0, error: 0, zombie: 0 },
  connected: true,
  lastGoodCount: 0,
  lastGoodAt: 1,
  lastAttemptAt: 1,
  mode: 'list',
};

/**
 * Primera línea (la cabecera) de un render directo de SessionTable.
 * @param {Record<string, unknown>} extra
 * @returns {string}
 */
function headerLine(extra) {
  const { lastFrame, unmount } = render(createElement(SessionTable, { ...TABLE_BASE, ...extra }));
  try {
    return (lastFrame() ?? '').split('\n')[0];
  } finally {
    unmount();
  }
}

describe('el conteo de la cola en la cabecera', () => {
  it('con 3 pendientes se pinta la copy, detrás del indicador', () => {
    const line = headerLine({ queuePending: 3 });
    assert.match(line, /3 por integrar/);
    assert.ok(line.indexOf('live') < line.indexOf('por integrar'), 'el conteo va después del indicador');
  });

  it('convive con el conteo del inbox y va SIEMPRE el último', () => {
    const line = headerLine({ inboxOpen: 2, queuePending: 5 });
    assert.match(line, /2 sin enrutar/);
    assert.match(line, /5 por integrar/);
    assert.ok(
      line.indexOf('sin enrutar') < line.indexOf('por integrar'),
      'la cola es el CUARTO hijo: nunca se cuela antes del inbox',
    );
  });

  it('con 0 la cabecera es BYTE-IDÉNTICA a la de antes de esta fase', () => {
    const referencia = headerLine({});
    assert.equal(headerLine({ queuePending: 0 }), referencia, 'ni un byte de más en 0');
    assert.ok(!referencia.includes('por integrar'));
  });

  it('el entero va crudo, sin separador de millares', () => {
    const line = headerLine({ queuePending: 1200 });
    assert.match(line, /1200 por integrar/);
    assert.doesNotMatch(line, /1\.200|1,200|1,2k/);
  });
});
