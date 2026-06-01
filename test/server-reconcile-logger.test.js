// @ts-check
//
// test/server-reconcile-logger.test.js — Phase 38 Plan 04 regression guard.
//
// Caza el bug que rompió el arranque del server: startServer creaba el logger del
// reconciliador con `createLogger({ minLevel })` SIN sessionId, y createLogger
// EXIGE sessionId (lo usa como nombre del NDJSON) → throw al arrancar. Ningún
// test arrancaba startServer, así que el self-check pasó pero `kodo start` petaba.
//
// Este smoke test reproduce el wiring exacto del server (createLogger con el
// sessionId sintético de servicio 'reconcile') y verifica que NO lanza y que el
// logger es usable. No arranca el server completo (eso toca red/provider); cubre
// el punto de fallo concreto.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../src/logger.js';
import { startReconcileLoop } from '../src/session/reconcile.js';

describe('Phase 38 Plan 04: server reconcile-logger wiring (regression)', () => {
  it('createLogger con sessionId sintético de servicio NO lanza (el server usa "reconcile")', () => {
    // Reproduce server.js: el reconciliador es un proceso de servicio, no una
    // sesión — usa un sessionId sintético estable. ANTES del fix esto se llamaba
    // sin sessionId y lanzaba '[kodo:logger] sessionId is required'.
    assert.doesNotThrow(() => {
      const logger = createLogger({ sessionId: 'reconcile', minLevel: 'info' }).child({ component: 'reconcile' });
      logger.info('smoke', { ok: true });
    });
  });

  it('createLogger SIN sessionId sí lanza (confirma que el guard sigue activo)', () => {
    assert.throws(
      () => createLogger(/** @type {any} */ ({ minLevel: 'info' })),
      /sessionId is required/,
      'el guard de createLogger debe seguir exigiendo sessionId',
    );
  });

  it('startReconcileLoop arranca y se detiene sin lanzar (DI hermético, sin timers reales)', () => {
    // Verifica el contrato de wiring: host + loadState + saveState + logger →
    // teardown. setInterval inyectado como no-op para no programar timers reales.
    let intervalSet = false;
    const logger = createLogger({ sessionId: 'reconcile', minLevel: 'error' }).child({ component: 'reconcile' });
    let stop;
    assert.doesNotThrow(() => {
      stop = startReconcileLoop({
        host: { listWorkspaces: async () => [] },
        loadState: () => ({ schema_version: 3, sessions: {}, history: [] }),
        saveState: () => {},
        logger,
        setInterval: () => { intervalSet = true; return 1; },
        clearInterval: () => {},
      });
    });
    assert.equal(intervalSet, true, 'startReconcileLoop programa su tick');
    assert.equal(typeof stop, 'function', 'retorna un teardown');
    assert.doesNotThrow(() => stop(), 'el teardown no lanza');
  });
});
