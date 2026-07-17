// @ts-check
//
// test/dispatcher-resolver-hint.test.js — KODO-10 (deliverable B).
//
// Helper PURO `resolverFailureHint`: convierte un verdict fail-closed del resolver GSD en un
// mensaje accionable para el log del daemon. Hoy `resolver_failed — <ref>: no-match` no explica
// el contrato kodo:gsd (el título de la tarea debe coincidir EXACTAMENTE con el título de una
// fase de ROADMAP.md) y costó una segunda ronda de diagnóstico. El test fija que cada code
// (no-match / roadmap-missing / multi-match) produce una pista concreta y accionable.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolverFailureHint } from '../src/triggers/dispatcher.js';

describe('resolverFailureHint: pistas accionables por code', () => {
  it('no-match → explica el contrato (título exacto de fase) y la salida kodo:gsd-quick', () => {
    const hint = resolverFailureHint(
      { code: 'no-match' },
      { taskTitle: 'Arreglar login', projectPath: '/Users/alex/dev/klab/scp', mode: 'full' },
    );
    assert.match(hint, /Arreglar login/);
    assert.match(hint, /\/Users\/alex\/dev\/klab\/scp/);
    assert.match(hint, /phase|fase/i);
    assert.match(hint, /kodo:gsd-quick/);
  });

  it('roadmap-missing → apunta a crear ROADMAP.md e incluye el detail (path)', () => {
    const hint = resolverFailureHint(
      { code: 'roadmap-missing', detail: '/p/.planning/ROADMAP.md' },
      { projectPath: '/p', mode: 'full' },
    );
    assert.match(hint, /ROADMAP/);
    assert.match(hint, /\/p\/\.planning\/ROADMAP\.md/);
  });

  it('multi-match → lista los matches y pide títulos únicos', () => {
    const hint = resolverFailureHint(
      { code: 'multi-match', matches: ['Phase 1: A', 'Phase 2: A'] },
      { projectPath: '/p', mode: 'full' },
    );
    assert.match(hint, /Phase 1: A/);
    assert.match(hint, /Phase 2: A/);
    assert.match(hint, /uniq|únic/i);
  });

  it('code desconocido → cae al detail o al code, never-throws', () => {
    assert.equal(resolverFailureHint({ code: 'weird', detail: 'boom' }, {}), 'boom');
    assert.doesNotThrow(() => resolverFailureHint({ code: 'x' }, {}));
  });
});
