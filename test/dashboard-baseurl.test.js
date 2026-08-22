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

// KODO-29 — el host sale de `config.server.bind`, no de un `localhost` fijo.
//
// El README recomienda `kodo config --set server.bind=100.x.y.z` (IP de Tailscale)
// para que el webhook de Plane llegue desde otra máquina. Con ese bind el daemon deja
// de escuchar en loopback y el dashboard se enganchaba a un `localhost:<port>` que no
// responde. El fallback `localhost` se conserva para el resto de casos: es el default
// histórico y el que anuncia el help de `--url` (cli.js:398).
describe('KODO-29: resolveBaseUrl deriva el host de server.bind', () => {
  it('bind a IP concreta → el baseUrl apunta a esa IP, no a localhost', () => {
    const loadConfig = () => ({ server: { port: 9090, bind: '100.64.1.2' } });
    assert.equal(resolveBaseUrl({ loadConfig }), 'http://100.64.1.2:9090');
  });

  it('bind `0.0.0.0` → localhost (el wildcard incluye loopback y no es marcable)', () => {
    const loadConfig = () => ({ server: { port: 9090, bind: '0.0.0.0' } });
    assert.equal(resolveBaseUrl({ loadConfig }), 'http://localhost:9090');
  });

  it('bind `::` → localhost', () => {
    const loadConfig = () => ({ server: { port: 9090, bind: '::' } });
    assert.equal(resolveBaseUrl({ loadConfig }), 'http://localhost:9090');
  });

  it('bind vacío → localhost (WR-04: vacío = ausente, igual que en el server)', () => {
    const loadConfig = () => ({ server: { port: 9090, bind: '   ' } });
    assert.equal(resolveBaseUrl({ loadConfig }), 'http://localhost:9090');
  });

  it('bind `127.0.0.1` explícito (el default del config) → esa IP y el puerto del config', () => {
    const loadConfig = () => ({ server: { port: 7777, bind: '127.0.0.1' } });
    assert.equal(resolveBaseUrl({ loadConfig }), 'http://127.0.0.1:7777');
  });

  it('bind IPv6 → literal entre corchetes, URL parseable', () => {
    const loadConfig = () => ({ server: { port: 9090, bind: 'fd7a:115c:a1e0::1' } });
    const baseUrl = resolveBaseUrl({ loadConfig });
    assert.equal(baseUrl, 'http://[fd7a:115c:a1e0::1]:9090');
    assert.equal(new URL(baseUrl).port, '9090');
  });

  it('--url sigue ganando sobre un bind a IP concreta', () => {
    const loadConfig = () => ({ server: { port: 9090, bind: '100.64.1.2' } });
    assert.equal(
      resolveBaseUrl({ url: 'http://example:1234', loadConfig }),
      'http://example:1234',
    );
  });

  it('--url no necesita leer el config (vía de escape si el config no es legible)', () => {
    const loadConfig = () => { throw new Error('config ilegible'); };
    assert.equal(resolveBaseUrl({ url: 'http://example:1234', loadConfig }), 'http://example:1234');
  });
});
