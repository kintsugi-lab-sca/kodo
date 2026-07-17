// @ts-check
//
// test/config-doctor.test.js — KODO-10.
//
// Módulo PURO de cruce config.json ↔ projects.json (sin red, sin I/O). El test es el
// CONTRATO: fija los códigos de finding (mapped_not_dispatched / dispatched_not_mapped /
// dispatched_unknown_identifier / duplicate_path), la extracción de IDs dispatch-enabled
// (strings UUID o objetos {id}), y la verificación PURA de estados (checkStates,
// case-insensitive espejo del provider). Ningún fetch/provider real: solo estructuras.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchProjectIds,
  scanConfigAlignment,
  checkStates,
} from '../src/config-doctor.js';

// ── dispatchProjectIds ───────────────────────────────────────────────────────
describe('dispatchProjectIds: extrae el set de IDs dispatch-enabled del config', () => {
  it('objetos {id,identifier,name} → set de ids', () => {
    const config = { provider: 'plane', providers: { plane: { projects: [
      { id: 'a', identifier: 'AA', name: 'a' },
      { id: 'b', identifier: 'BB', name: 'b' },
    ] } } };
    const ids = dispatchProjectIds(config, 'plane');
    assert.ok(ids instanceof Set);
    assert.deepEqual([...ids].sort(), ['a', 'b']);
  });

  it('UUID strings sin resolver → set de ids', () => {
    const config = { providers: { plane: { projects: ['uuid-1', 'uuid-2'] } } };
    assert.deepEqual([...dispatchProjectIds(config, 'plane')].sort(), ['uuid-1', 'uuid-2']);
  });

  it('provider ausente / projects no-array → set vacío never-throws', () => {
    assert.equal(dispatchProjectIds({}, 'plane').size, 0);
    assert.equal(dispatchProjectIds({ providers: { plane: {} } }, 'plane').size, 0);
    assert.equal(dispatchProjectIds(null, 'plane').size, 0);
  });
});

// ── scanConfigAlignment ──────────────────────────────────────────────────────
describe('scanConfigAlignment: cruce config ↔ projects', () => {
  const provider = 'plane';

  it('todo alineado → sin findings, hasIssues=false', () => {
    const config = { provider, providers: { plane: { projects: [
      { id: 'a', identifier: 'AA', name: 'a' },
    ] } } };
    const projects = { a: '/tmp/a' };
    const r = scanConfigAlignment({ config, projects, provider });
    assert.equal(r.hasIssues, false);
    assert.equal(r.findings.length, 0);
    assert.equal(r.provider, 'plane');
  });

  it('mapped_not_dispatched: id mapeado con path pero AUSENTE de config (caso SCP) → error', () => {
    const config = { provider, providers: { plane: { projects: [] } } };
    const projects = { scp: '/Users/alex/dev/roman/scp-cmri' };
    const r = scanConfigAlignment({ config, projects, provider });
    const f = r.findings.find((x) => x.code === 'mapped_not_dispatched');
    assert.ok(f, 'debe emitir mapped_not_dispatched');
    assert.equal(f.severity, 'error');
    assert.equal(f.projectId, 'scp');
    assert.equal(f.path, '/Users/alex/dev/roman/scp-cmri');
    assert.match(f.detail, /UNKNOWN|config/i);
    assert.equal(r.hasIssues, true);
  });

  it('dispatched_not_mapped: id en config pero sin ruta en projects.json → warn', () => {
    const config = { provider, providers: { plane: { projects: [
      { id: 'a', identifier: 'AA', name: 'a' },
    ] } } };
    const projects = {}; // a no está mapeado
    const r = scanConfigAlignment({ config, projects, provider });
    const f = r.findings.find((x) => x.code === 'dispatched_not_mapped');
    assert.ok(f, 'debe emitir dispatched_not_mapped');
    assert.equal(f.severity, 'warn');
    assert.equal(f.projectId, 'a');
    assert.equal(f.identifier, 'AA');
  });

  it('una entrada mapeada SIN path (default vacío) NO cuenta como mapeada', () => {
    const config = { provider, providers: { plane: { projects: [
      { id: 'a', identifier: 'AA', name: 'a' },
    ] } } };
    // a mapeado como objeto sin default → getProjectPath('')  → no cuenta
    const projects = { a: { modules: { core: '/tmp/x' } } };
    const r = scanConfigAlignment({ config, projects, provider });
    // a está en config pero sin path default → dispatched_not_mapped
    assert.ok(r.findings.some((x) => x.code === 'dispatched_not_mapped' && x.projectId === 'a'));
    // y NO debe salir mapped_not_dispatched para 'a' (está en config)
    assert.ok(!r.findings.some((x) => x.code === 'mapped_not_dispatched' && x.projectId === 'a'));
  });

  it('dispatched_unknown_identifier: entry en config con identifier UNKNOWN → warn', () => {
    const config = { provider, providers: { plane: { projects: [
      { id: 'a', identifier: 'UNKNOWN', name: 'a' },
    ] } } };
    const projects = { a: '/tmp/a' };
    const r = scanConfigAlignment({ config, projects, provider });
    assert.ok(r.findings.some((x) => x.code === 'dispatched_unknown_identifier' && x.projectId === 'a'));
  });

  it('duplicate_path: dos ids mapeados al mismo path → warn (ambos ids listados)', () => {
    const config = { provider, providers: { plane: { projects: [
      { id: 'a', identifier: 'AA', name: 'a' },
      { id: 'b', identifier: 'BB', name: 'b' },
    ] } } };
    const projects = { a: '/tmp/same', b: '/tmp/same' };
    const r = scanConfigAlignment({ config, projects, provider });
    const f = r.findings.find((x) => x.code === 'duplicate_path');
    assert.ok(f, 'debe emitir duplicate_path');
    assert.equal(f.path, '/tmp/same');
    assert.deepEqual([...f.projectIds].sort(), ['a', 'b']);
  });

  it('el caso real combinado: SCP-like mapeado-no-config + config-sin-map', () => {
    const config = { provider, providers: { plane: { projects: [
      { id: 'kodo', identifier: 'KODO', name: 'kodo' },     // alineado
      { id: 'liken', identifier: 'LIKEN', name: 'liken' },  // en config, sin mapear
    ] } } };
    const projects = {
      kodo: '/Users/alex/dev/klab/kodo',                    // alineado
      ghost: '/Users/alex/dev/klab/personalchat',           // mapeado, no en config → SCP
    };
    const r = scanConfigAlignment({ config, projects, provider });
    assert.ok(r.findings.some((x) => x.code === 'mapped_not_dispatched' && x.projectId === 'ghost'));
    assert.ok(r.findings.some((x) => x.code === 'dispatched_not_mapped' && x.projectId === 'liken'));
    assert.equal(r.hasIssues, true);
  });

  it('never-throws ante inputs basura', () => {
    assert.doesNotThrow(() => scanConfigAlignment({ config: null, projects: null, provider }));
    const r = scanConfigAlignment({ config: undefined, projects: undefined });
    assert.equal(r.hasIssues, false);
  });
});

// ── checkStates (puro; el CLI obtiene availableStateNames por red) ────────────
describe('checkStates: verificación pura de estados requeridos', () => {
  it('todos presentes (case-insensitive) → missing vacío', () => {
    const r = checkStates({
      requiredStates: { trigger: 'In Progress', review: 'In review', done: 'Done' },
      availableStateNames: ['Backlog', 'in progress', 'IN REVIEW', 'done', 'Cancelled'],
    });
    assert.deepEqual(r.missing, []);
  });

  it('falta "In review" (caso SCP) → lo reporta con su role', () => {
    const r = checkStates({
      requiredStates: { trigger: 'In Progress', review: 'In review', done: 'Done' },
      availableStateNames: ['Backlog', 'In Progress', 'Done'],
    });
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].role, 'review');
    assert.equal(r.missing[0].name, 'In review');
  });

  it('estado requerido vacío/falsy se ignora; never-throws ante basura', () => {
    assert.deepEqual(checkStates({ requiredStates: { trigger: '', review: null }, availableStateNames: [] }).missing, []);
    assert.doesNotThrow(() => checkStates({ requiredStates: null, availableStateNames: null }));
  });
});
