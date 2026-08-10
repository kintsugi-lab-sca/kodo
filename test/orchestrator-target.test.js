// @ts-check
//
// test/orchestrator-target.test.js — KODO-16, segunda mitad.
//
// `manager.js` (aviso de sesión lanzada) y `session-end.js` (nudge de cierre, el único
// nudge por-evento que sobrevivió a la Phase 73) resolvían al orquestador con su propio
// `match(/(workspace:\d+)\s+kodo-orchestrator/)` inline. Tras un reinicio del daemon que
// renombrase la tab, los dos avisos se perdían EN SILENCIO — su `catch {}` no distingue
// «no hay orquestador» de «hay uno y no lo he encontrado».

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOrchestratorTargets, sendToOrchestrator } from '../src/orchestrator/target.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LIST_CON_TITULO = 'workspace:7  KODO-1\nworkspace:12  kodo-orchestrator\n';
const LIST_RENOMBRADA = 'workspace:7  KODO-1\nworkspace:12  心動 kodo service\n';

const reg = (ref) => () => (ref ? { workspace_ref: ref } : null);

describe('resolveOrchestratorTargets — a quién se le avisa', () => {
  it('el ref registrado va PRIMERO', () => {
    assert.deepEqual(
      resolveOrchestratorTargets(LIST_CON_TITULO, { getOrchestratorFn: reg('workspace:32') }),
      ['workspace:32', 'workspace:12'],
    );
  });

  it('sin duplicados cuando registro y título coinciden', () => {
    assert.deepEqual(
      resolveOrchestratorTargets(LIST_CON_TITULO, { getOrchestratorFn: reg('workspace:12') }),
      ['workspace:12'],
    );
  });

  it('con la tab renombrada, el registro es el ÚNICO candidato', () => {
    // El escenario del bug: el título ya no dice `kodo-orchestrator`.
    assert.deepEqual(
      resolveOrchestratorTargets(LIST_RENOMBRADA, { getOrchestratorFn: reg('workspace:12') }),
      ['workspace:12'],
    );
  });

  it('sin registro, el título sigue funcionando (comportamiento previo)', () => {
    assert.deepEqual(
      resolveOrchestratorTargets(LIST_CON_TITULO, { getOrchestratorFn: reg(null) }),
      ['workspace:12'],
    );
  });

  it('sin registro y sin título → lista vacía (no hay a quién avisar)', () => {
    assert.deepEqual(
      resolveOrchestratorTargets(LIST_RENOMBRADA, { getOrchestratorFn: reg(null) }),
      [],
    );
  });

  it('never-throws ante lista no-string o registro que lanza', () => {
    for (const bad of [null, undefined, 42, {}]) {
      assert.deepEqual(
        resolveOrchestratorTargets(/** @type {any} */ (bad), { getOrchestratorFn: reg(null) }),
        [],
      );
    }
    const explota = () => { throw new Error('state ilegible'); };
    assert.deepEqual(
      resolveOrchestratorTargets(LIST_CON_TITULO, { getOrchestratorFn: explota }),
      ['workspace:12'],
      'un registro ilegible no puede impedir el fallback por título',
    );
  });
});

describe('sendToOrchestrator — entrega al primero que acepte', () => {
  it('entrega al primer candidato y NO prueba el resto', async () => {
    const enviados = [];
    const ref = await sendToOrchestrator(
      async (o) => { enviados.push(o.workspace); },
      ['workspace:32', 'workspace:12'],
      'hola',
    );
    assert.equal(ref, 'workspace:32');
    assert.deepEqual(enviados, ['workspace:32']);
  });

  it('cae al siguiente cuando el primero falla (registro stale)', async () => {
    const intentos = [];
    const ref = await sendToOrchestrator(
      async (o) => {
        intentos.push(o.workspace);
        if (o.workspace === 'workspace:32') throw new Error('cmux send failed: no such workspace');
      },
      ['workspace:32', 'workspace:12'],
      'hola',
    );
    assert.equal(ref, 'workspace:12');
    assert.deepEqual(intentos, ['workspace:32', 'workspace:12']);
  });

  it('null cuando ninguno acepta, sin lanzar', async () => {
    const ref = await sendToOrchestrator(
      async () => { throw new Error('cmux caído'); },
      ['workspace:32', 'workspace:12'],
      'hola',
    );
    assert.equal(ref, null);
  });

  it('null con lista vacía y sin llamar al sender', async () => {
    let llamadas = 0;
    const ref = await sendToOrchestrator(async () => { llamadas++; }, [], 'hola');
    assert.equal(ref, null);
    assert.equal(llamadas, 0);
  });

  it('pasa el texto verbatim', async () => {
    let visto;
    await sendToOrchestrator(async (o) => { visto = o.text; }, ['workspace:1'], 'línea\\n');
    assert.equal(visto, 'línea\\n');
  });
});

describe('source-hygiene: ningún consumidor resuelve al orquestador por título a mano', () => {
  it('manager.js y session-end.js ya no llevan el regex inline', () => {
    for (const rel of [['src', 'session', 'manager.js'], ['src', 'hooks', 'session-end.js']]) {
      const source = readFileSync(join(REPO, ...rel), 'utf-8');
      assert.ok(
        !/match\(\/\(workspace:\\d\+\)/.test(source),
        `${rel.join('/')} debe resolver vía resolveOrchestratorTargets, no con el regex inline`,
      );
      assert.match(source, /resolveOrchestratorTargets/);
    }
  });
});
