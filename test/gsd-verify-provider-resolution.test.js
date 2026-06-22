// @ts-check
//
// test/gsd-verify-provider-resolution.test.js — Regresión KODO-4.
//
// Bug: `kodo gsd verify <session-id>` fallaba con "Unknown provider: undefined"
// porque el getProviderFn por defecto invocaba `getProvider(undefined)` — el
// nombre del provider estaba hardcodeado a undefined en vez de leerse de la
// sesión (`session.provider`, poblado en state.json).
//
// Estos tests ejercitan el PATH POR DEFECTO (sin inyectar getProviderFn), que es
// donde vivía el bug: los tests de integración previos inyectan getProviderFn y
// por tanto NUNCA tocaban la resolución del nombre del provider.
//
// Estrategia: registrar un provider fake bajo el nombre 'plane' en el registry
// real (tras initRegistry, para sobrescribir el factory real), y verificar que
// runGsdVerify resuelve el provider y llama getTask SIN lanzar "Unknown
// provider". Si el nombre fuese undefined, getProvider(undefined) lanzaría.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGsdVerify } from '../src/gsd/verify.js';
import {
  initRegistry,
  registerProvider,
  clearRegistry,
} from '../src/providers/registry.js';

describe('runGsdVerify — resolución del provider desde la sesión (KODO-4)', () => {
  let tmpRoot;
  let getTaskCalls;

  /** Provider fake que implementa la interfaz completa (TASK_PROVIDER_METHODS). */
  function makeFakeProvider() {
    return {
      init: async () => {},
      getTask: async (ref) => {
        getTaskCalls.push(ref);
        return { id: 'task-x', ref, title: 'T', projectId: 'proj-x' };
      },
      updateTaskState: async () => {},
      addComment: async () => {},
      listPendingTasks: async () => [],
      parseTriggerEvent: () => ({}),
      verifySignature: () => true,
      resolveRef: async () => null,
      listProjects: async () => [],
    };
  }

  function makeLogger() {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => logger,
    };
    return logger;
  }

  /**
   * Deps SIN getProviderFn — fuerza el path por defecto (registry real). Inyecta
   * findSessionFn, loadConfigFn y loggerFactory para aislar fs/red.
   * tmpRoot no tiene `.planning/` → el verdict será 'missing', pero getTask +
   * addComment se invocan igual (D-14), ejercitando la resolución del provider.
   */
  function makeDeps(session, configProvider = 'plane') {
    return {
      findSessionFn: () => session,
      loadConfigFn: () => ({
        provider: configProvider,
        providers: { plane: { states: { review: 'In review' } } },
      }),
      loggerFactory: () => makeLogger(),
    };
  }

  function makeSession(overrides = {}) {
    return {
      session_id: 'sess-kodo4',
      task_id: 'task-kodo4',
      task_ref: 'KL-4',
      provider: 'plane',
      project_id: 'proj-x',
      project_path: tmpRoot,
      summary: 'Provider resolution',
      status: 'review',
      started_at: new Date().toISOString(),
      workspace_ref: 'workspace:1',
      gsd: true,
      phase_id: '10',
      ...overrides,
    };
  }

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'kodo-prov-'));
    getTaskCalls = [];
    // initRegistry() PRIMERO (registra los defaults reales y marca
    // defaultsRegistered=true), LUEGO sobrescribimos 'plane' con el fake. Así la
    // llamada interna initRegistry() de runGsdVerify es no-op y getProvider('plane')
    // devuelve nuestro fake sin tocar config/red real.
    clearRegistry();
    await initRegistry();
    registerProvider('plane', makeFakeProvider);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    clearRegistry();
  });

  it('resuelve el provider desde session.provider y hace fetch del task (no "Unknown provider")', async () => {
    const result = await runGsdVerify(
      { sessionId: 'sess-kodo4' },
      makeDeps(makeSession()),
    );

    // getTask se invocó vía el provider resuelto desde session.provider='plane'.
    assert.deepEqual(getTaskCalls, ['KL-4']);
    // El gate emite un verdict canónico (aquí 'missing' — sin .planning/).
    assert.equal(result.verdict.action, 'missing');
    assert.equal(result.plane.commented, true);
  });

  it('hace fallback a config.provider cuando session.provider está ausente', async () => {
    const session = makeSession();
    delete session.provider; // sesión legacy sin provider poblado

    const result = await runGsdVerify(
      { sessionId: 'sess-kodo4' },
      makeDeps(session, 'plane'),
    );

    assert.deepEqual(getTaskCalls, ['KL-4']);
    assert.equal(result.verdict.action, 'missing');
  });

  it('antes del fix lanzaría "Unknown provider: undefined" — ahora no lanza', async () => {
    // Si el nombre del provider fuese undefined, getProvider(undefined) lanzaría
    // en finalize() y el throw saldría de runGsdVerify. Aserción explícita de no-throw.
    await assert.doesNotReject(
      runGsdVerify({ sessionId: 'sess-kodo4' }, makeDeps(makeSession())),
    );
  });
});
