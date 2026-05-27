// @ts-check
//
// test/dashboard-baseurl.test.js — Phase 35 Plan 04 (TUI-06, WR-01 / D-10).
//
// Verifica la resolución del baseUrl del subcomando `kodo dashboard` con el
// guard WR-01: `migrateConfig` (src/config.js:82-102) reconstruye el config v1
// SIN la clave `server`, así que un acceso `loadConfig().server.port` sin
// guardia lanza TypeError al arrancar el dashboard. El fix usa optional
// chaining + fallback al default conocido `DEFAULT_CONFIG.server.port` (9090).
//
// Vía de testabilidad (a) — Discretion del PLAN.md Task 1: la resolución del
// baseUrl se extrae a un helper puro exportado `resolveBaseUrl({ url, loadConfig })`
// que `runDashboard` invoca. El test importa el helper directamente con un
// `loadConfig` fake — sin server real, sin TTY, sin arrancar ink.
//
// Estado Wave 0: ROJO por diseño hasta que Task 2 extraiga el helper.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBaseUrl } from '../src/cli/dashboard/index.js';

describe('TUI-06 / WR-01: resolveBaseUrl guard (config v1 migrado sin `server`)', () => {
  it('config v1 migrado (sin `server`) → fallback al default 9090 sin TypeError', () => {
    // migrateConfig omite la clave `server` → cfg.server es undefined.
    const loadConfig = () => ({ provider: 'plane' });
    const baseUrl = resolveBaseUrl({ url: undefined, loadConfig });
    assert.equal(baseUrl, 'http://localhost:9090');
  });

  it('config normal (con server.port) → usa el puerto del config', () => {
    const loadConfig = () => ({ server: { port: 7777 } });
    const baseUrl = resolveBaseUrl({ url: undefined, loadConfig });
    assert.equal(baseUrl, 'http://localhost:7777');
  });

  it('override --url tiene prioridad sobre el config (aunque falte `server`)', () => {
    const loadConfig = () => ({ provider: 'plane' });
    const baseUrl = resolveBaseUrl({ url: 'http://example:1234', loadConfig });
    assert.equal(baseUrl, 'http://example:1234');
  });
});
