// @ts-check
//
// test/daemon/provider-uses-polling.test.js — Plan 65-01 Task 2.
//
// Prueba el helper puro `providerUsesPolling(config)` (D-06): decide si el daemon
// kodo debe correr el loop de polling. Allowlist explícita contra 'github' (único
// provider polling-based entre los dos registrados hoy en registry.js). Plane usa
// webhook ingress en el server (/webhook), NO polling.
//
// Unit puro — la función recibe `config` como argumento, así que NO necesita
// HOME-isolation. Cubre github→true, plane→false, y los tres casos malformed
// (fail-open / never-throws: config ausente o corrupto → false, que es el fallo
// seguro porque NO arrancar polling deja el server sirviendo).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { providerUsesPolling } from '../../src/daemon/provider-uses-polling.js';

describe('providerUsesPolling(config)', () => {
  it("github → true (polling-based: repos + poll_interval)", () => {
    assert.equal(providerUsesPolling({ provider: 'github' }), true);
  });

  it("plane → false (webhook ingress, no polling loop)", () => {
    assert.equal(providerUsesPolling({ provider: 'plane' }), false);
  });

  it("undefined → false (fail-safe, never-throws)", () => {
    assert.equal(providerUsesPolling(undefined), false);
  });

  it("{} → false (provider ausente)", () => {
    assert.equal(providerUsesPolling({}), false);
  });

  it("{provider:42} → false (provider no-string malformed)", () => {
    assert.equal(providerUsesPolling({ provider: 42 }), false);
  });

  it("null → false (fail-safe, no throw)", () => {
    assert.equal(providerUsesPolling(null), false);
  });
});
