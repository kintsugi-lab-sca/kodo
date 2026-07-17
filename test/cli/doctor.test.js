// @ts-check
//
// test/cli/doctor.test.js — KODO-10.
//
// La mitad CLI de `kodo doctor` (handler `runDoctor`). Espejo del contrato de gsd-doctor.js:
// dry-run render humano + `--json` byte-determinista + exit code (hasIssues ? 1 : 0). Todo por
// DI: loadRawConfigFn/loadProjectsFn/listStatesFn/writeFn/errFn/formatterFn — CERO red, cero
// lectura del ~/.kodo real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../../src/cli/doctor.js';

// Formatter identidad (sin ANSI) para assertar por contenido.
function idFormatter() {
  const id = (s) => s;
  return { ok: id, fail: id, yellow: id, red: id, cyan: id, dim: id, green: id, gray: id, info: id, warn: id, error: id, bold: id };
}

function makeSink() {
  const out = { s: '', e: '' };
  return {
    out,
    writeFn: (x) => { out.s += x; },
    errFn: (x) => { out.e += x; },
    formatterFn: () => idFormatter(),
  };
}

const ALIGNED_CONFIG = {
  provider: 'plane',
  providers: { plane: {
    projects: [{ id: 'kodo', identifier: 'KODO', name: 'kodo' }],
    states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  } },
};

describe('runDoctor: cruce config↔projects', () => {
  it('alineado → exit 0 y mensaje de limpio', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink,
    });
    assert.equal(code, 0);
    assert.match(sink.out.s, /clean|alinead|sin problemas/i);
  });

  it('SCP-like (mapeado no-config) → exit 1 y finding accionable', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => ({ provider: 'plane', providers: { plane: { projects: [], states: {} } } }),
      loadProjectsFn: () => ({ scp: '/Users/alex/dev/roman/scp-cmri' }),
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /scp/i);
    assert.match(sink.out.s, /UNKNOWN|config\.json/i);
  });

  it('--json emite payload estructurado con findings (byte-determinista, sin formatter)', async () => {
    const sink = makeSink();
    const code = await runDoctor({ json: true }, {
      loadRawConfigFn: () => ({ provider: 'plane', providers: { plane: { projects: [], states: {} } } }),
      loadProjectsFn: () => ({ scp: '/tmp/scp' }),
      ...sink,
    });
    assert.equal(code, 1);
    const payload = JSON.parse(sink.out.s);
    assert.equal(payload.provider, 'plane');
    assert.equal(payload.hasIssues, true);
    assert.ok(payload.findings.some((f) => f.code === 'mapped_not_dispatched' && f.projectId === 'scp'));
  });

  it('config ausente (null) → never-throws, exit 0', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => null,
      loadProjectsFn: () => ({}),
      ...sink,
    });
    assert.equal(code, 0);
  });
});

describe('runDoctor --states (check de estados por proyecto, red inyectada)', () => {
  it('todos los estados presentes → sin problemas de estados, exit 0', async () => {
    const sink = makeSink();
    const listStatesFn = async (/** @type {string} */ id) => {
      assert.equal(id, 'kodo');
      return ['Backlog', 'In Progress', 'In review', 'Done', 'Cancelled'];
    };
    const code = await runDoctor({ states: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 0);
  });

  it('falta "In review" (caso SCP) → exit 1 y reporta el estado ausente', async () => {
    const sink = makeSink();
    const listStatesFn = async () => ['Backlog', 'In Progress', 'Done'];
    const code = await runDoctor({ states: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /In review/i);
  });

  it('--states + --json incluye la sección states', async () => {
    const sink = makeSink();
    const listStatesFn = async () => ['In Progress', 'Done'];
    const code = await runDoctor({ states: true, json: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 1);
    const payload = JSON.parse(sink.out.s);
    assert.ok(payload.states, 'el payload debe llevar la sección states bajo --states');
    assert.ok(payload.states.problems.some((p) => p.missing?.some((m) => m.name === 'In review')));
  });

  it('un fallo de red por proyecto NO tira el comando (never-throws) → se reporta como error de estados', async () => {
    const sink = makeSink();
    const listStatesFn = async () => { throw new Error('ECONNREFUSED'); };
    const code = await runDoctor({ states: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /ECONNREFUSED|no se pudo/i);
  });
});
