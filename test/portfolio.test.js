// @ts-check
//
// test/portfolio.test.js — `kodo portfolio`: almacén (src/portfolio/store.js) y handlers
// (src/cli/portfolio.js). Todo corre contra un directorio temporal inyectado: nunca toca
// el `~/.kodo` real.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_STEPS,
  PortfolioUsageError,
  addStep,
  applyPatch,
  listEntries,
  readEntry,
} from '../src/portfolio/store.js';
import {
  runPortfolioListCli,
  runPortfolioSetCli,
  runPortfolioShowCli,
  runPortfolioStepCli,
} from '../src/cli/portfolio.js';

const NOW = '2026-11-12T10:00:00.000Z';
const BASE = { name: 'Aparca&Go', planeProject: 'p-1', module: 'Aparca&Go' };

describe('portfolio store: applyPatch', () => {
  it('crea una ficha con los mínimos y la narrativa vacía', () => {
    const e = applyPatch(null, 'aparcago', BASE, NOW);
    assert.equal(e.schema_version, 1);
    assert.deepEqual(e.plane, { project_id: 'p-1', module: 'Aparca&Go' });
    assert.equal(e.archived, false);
    assert.equal(e.headline, null);
    assert.deepEqual(e.steps, []);
    assert.equal(e.updated_at, NOW);
  });

  it('crear sin --name o sin --plane-project es un error de uso', () => {
    assert.throws(() => applyPatch(null, 'x', { headline: 'hola' }, NOW), PortfolioUsageError);
    assert.throws(() => applyPatch(null, 'x', { name: 'X' }, NOW), PortfolioUsageError);
  });

  it('actualiza solo los campos indicados y no muta la ficha original', () => {
    const a = applyPatch(null, 'aparcago', { ...BASE, headline: 'uno', nextStep: 'dos' }, NOW);
    const b = applyPatch(a, 'aparcago', { headline: 'tres', source: 'ROMAN-12' }, '2026-11-13T00:00:00.000Z');
    assert.equal(b.headline, 'tres');
    assert.equal(b.next_step, 'dos');
    assert.equal(b.updated_by, 'ROMAN-12');
    assert.equal(a.headline, 'uno');
    assert.equal(a.plane.module, 'Aparca&Go');
  });

  it('una cadena vacía borra el campo opcional', () => {
    const a = applyPatch(null, 'aparcago', { ...BASE, waitingOn: 'Pau', status: 'waiting' }, NOW);
    const b = applyPatch(a, 'aparcago', { waitingOn: '', status: '', module: '' }, NOW);
    assert.equal(b.waiting_on, null);
    assert.equal(b.status, null);
    assert.equal(b.plane.module, null);
  });

  it('blockers y dates reemplazan la lista; las fechas salen ordenadas', () => {
    const a = applyPatch(null, 'aparcago', {
      ...BASE,
      blockers: ['uno', '  '],
      dates: ['2026-12-01=Entrega', '2026-11-20=Demo = cliente'],
    }, NOW);
    assert.deepEqual(a.blockers, ['uno']);
    assert.deepEqual(a.dates, [
      { date: '2026-11-20', label: 'Demo = cliente' },
      { date: '2026-12-01', label: 'Entrega' },
    ]);
    assert.deepEqual(applyPatch(a, 'aparcago', { blockers: [] }, NOW).blockers, []);
  });

  it('rechaza slug, estado y fecha inválidos', () => {
    assert.throws(() => applyPatch(null, 'Aparca Go', BASE, NOW), PortfolioUsageError);
    assert.throws(() => applyPatch(null, '../x', BASE, NOW), PortfolioUsageError);
    assert.throws(() => applyPatch(null, 'x', { ...BASE, status: 'verde' }, NOW), PortfolioUsageError);
    assert.throws(() => applyPatch(null, 'x', { ...BASE, dates: ['2026-02-30=x'] }, NOW), PortfolioUsageError);
    assert.throws(() => applyPatch(null, 'x', { ...BASE, dates: ['2026-03-01'] }, NOW), PortfolioUsageError);
  });

  it('sanea el texto a una sola línea', () => {
    const e = applyPatch(null, 'x', { ...BASE, headline: ' dos\nlíneas\t y  espacios ' }, NOW);
    assert.equal(e.headline, 'dos líneas y espacios');
  });
});

describe('portfolio store: addStep', () => {
  it('antepone el paso y conserva solo los más recientes', () => {
    let e = applyPatch(null, 'x', BASE, NOW);
    for (let i = 0; i < MAX_STEPS + 5; i++) e = addStep(e, `paso ${i}`, 'sesion-1', NOW);
    assert.equal(e.steps.length, MAX_STEPS);
    assert.deepEqual(e.steps[0], { at: NOW, text: `paso ${MAX_STEPS + 4}`, source: 'sesion-1' });
  });

  it('un paso vacío es un error de uso', () => {
    assert.throws(() => addStep(applyPatch(null, 'x', BASE, NOW), ' \n ', undefined, NOW), PortfolioUsageError);
  });
});

describe('portfolio CLI', () => {
  /** @type {string} */ let dir;
  /** @type {string[]} */ let out;
  /** @type {string[]} */ let err;
  /** @type {import('../src/cli/portfolio.js').PortfolioDeps} */ let deps;

  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'kodo-portfolio-')), 'portfolio');
    out = [];
    err = [];
    deps = { dirFn: () => dir, writeFn: (s) => out.push(s), errFn: (s) => err.push(s), clockFn: () => NOW };
  });
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

  it('set crea el directorio y la ficha, sin dejar temporales', () => {
    assert.equal(runPortfolioSetCli('aparcago', { ...BASE, headline: 'En marcha' }, deps), 0);
    assert.deepEqual(readdirSync(dir), ['aparcago.json']);
    assert.equal(readEntry(dir, 'aparcago')?.headline, 'En marcha');
  });

  it('set con entrada inválida sale con 2 y no escribe', () => {
    assert.equal(runPortfolioSetCli('aparcago', { headline: 'sin crear' }, deps), 2);
    assert.match(err.join(''), /--name y --plane-project/);
    assert.deepEqual(listEntries(dir), []);
  });

  it('step exige que la ficha exista', () => {
    assert.equal(runPortfolioStepCli('nada', 'hola', {}, deps), 2);
    runPortfolioSetCli('aparcago', BASE, deps);
    assert.equal(runPortfolioStepCli('aparcago', 'Desplegado en producción', { source: 'ROMAN-9' }, deps), 0);
    assert.equal(readEntry(dir, 'aparcago')?.steps[0].text, 'Desplegado en producción');
  });

  it('show vuelca JSON y sale con 2 si no existe', () => {
    assert.equal(runPortfolioShowCli('aparcago', deps), 2);
    runPortfolioSetCli('aparcago', BASE, deps);
    out.length = 0;
    assert.equal(runPortfolioShowCli('aparcago', deps), 0);
    assert.equal(JSON.parse(out.join('')).slug, 'aparcago');
  });

  it('list oculta los archivados salvo --all y omite fichas corruptas', () => {
    assert.equal(runPortfolioListCli({}, deps), 0, 'directorio inexistente → vacío, no error');
    runPortfolioSetCli('aparcago', BASE, deps);
    runPortfolioSetCli('viejo', { name: 'Viejo', planeProject: 'p-2', archived: true }, deps);
    writeFileSync(join(dir, 'roto.json'), '{ no es json');

    out.length = 0;
    assert.equal(runPortfolioListCli({ json: true }, deps), 0);
    assert.deepEqual(JSON.parse(out.join('')).map((/** @type {{ slug: string }} */ e) => e.slug), ['aparcago']);

    out.length = 0;
    runPortfolioListCli({ all: true, json: true }, deps);
    assert.equal(JSON.parse(out.join('')).length, 2);
  });

  it('una ficha corrupta en set/show es error 1, no 2', () => {
    runPortfolioSetCli('aparcago', BASE, deps);
    writeFileSync(join(dir, 'aparcago.json'), '{ no es json');
    assert.equal(runPortfolioShowCli('aparcago', deps), 1);
    assert.equal(runPortfolioSetCli('aparcago', { headline: 'x' }, deps), 1);
  });
});
