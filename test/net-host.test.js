// @ts-check
//
// test/net-host.test.js — KODO-29.
//
// Prueba los helpers puros de src/net-host.js: la fuente única de verdad que deriva
// de `config.server.bind` (a) el host que el server pasa a `listen` y (b) el host al
// que el tooling local (dashboard, sonda de puerto de `kodo up`) debe conectarse.
//
// El bug que motiva el módulo: el README recomienda `kodo config --set
// server.bind=100.x.y.z` (IP de Tailscale) para recibir el webhook desde otra máquina,
// pero el cliente asumía loopback fijo — dashboard contra `localhost:9090` muerto y
// sonda de puerto contra un 127.0.0.1 donde ya nadie escucha.
//
// Todo síncrono y hermético: los helpers no hacen I/O ni importan nada.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOPBACK,
  resolveListenHost,
  resolveClientHost,
  formatHostForUrl,
  isWildcardHost,
} from '../src/net-host.js';

/** Config mínimo con el bind pedido. `undefined` omite la clave por completo. */
function cfg(bind) {
  return bind === undefined ? { server: { port: 9090 } } : { server: { port: 9090, bind } };
}

describe('resolveListenHost (host para server.listen)', () => {
  it('bind ausente → loopback (NET-01: exponerse es opt-in explícito)', () => {
    assert.equal(resolveListenHost(cfg(undefined)), LOOPBACK);
  });

  it('config v1 migrado sin `server` → loopback, sin TypeError', () => {
    assert.equal(resolveListenHost({ provider: 'plane' }), LOOPBACK);
  });

  it('config undefined → loopback, sin TypeError', () => {
    assert.equal(resolveListenHost(undefined), LOOPBACK);
  });

  it('WR-04: cadena vacía / solo espacios = AUSENTE, nunca se deja pasar', () => {
    // `server.listen(port, '')` bindea 0.0.0.0 en silencio — la exposición a LAN que
    // NET-01 existe para prevenir.
    assert.equal(resolveListenHost(cfg('')), LOOPBACK);
    assert.equal(resolveListenHost(cfg('   ')), LOOPBACK);
  });

  it('bind no-string (número, null) = AUSENTE → loopback', () => {
    assert.equal(resolveListenHost(cfg(9090)), LOOPBACK);
    assert.equal(resolveListenHost(cfg(null)), LOOPBACK);
  });

  it('wildcards se respetan tal cual: en `listen` SÍ son válidos', () => {
    assert.equal(resolveListenHost(cfg('0.0.0.0')), '0.0.0.0');
    assert.equal(resolveListenHost(cfg('::')), '::');
  });

  it('IP concreta se respeta, con los espacios recortados', () => {
    assert.equal(resolveListenHost(cfg('100.64.1.2')), '100.64.1.2');
    assert.equal(resolveListenHost(cfg('  100.64.1.2  ')), '100.64.1.2');
  });
});

describe('resolveClientHost (host que marca el tooling local)', () => {
  it('bind ausente → fallback (default: loopback)', () => {
    assert.equal(resolveClientHost(cfg(undefined)), LOOPBACK);
  });

  it('config v1 migrado sin `server` / config undefined → fallback', () => {
    assert.equal(resolveClientHost({ provider: 'plane' }), LOOPBACK);
    assert.equal(resolveClientHost(undefined), LOOPBACK);
  });

  it('cadena vacía / solo espacios → fallback', () => {
    assert.equal(resolveClientHost(cfg('')), LOOPBACK);
    assert.equal(resolveClientHost(cfg('   ')), LOOPBACK);
  });

  it('wildcards → fallback: `0.0.0.0` y `::` NO son destinos marcables', () => {
    assert.equal(resolveClientHost(cfg('0.0.0.0')), LOOPBACK);
    assert.equal(resolveClientHost(cfg('::')), LOOPBACK);
  });

  it('IP concreta (Tailscale) → esa IP: es la ÚNICA donde el daemon escucha', () => {
    assert.equal(resolveClientHost(cfg('100.64.1.2')), '100.64.1.2');
  });

  it('`127.0.0.1` explícito → se devuelve tal cual (ya es loopback)', () => {
    assert.equal(resolveClientHost(cfg('127.0.0.1')), '127.0.0.1');
  });

  it('`::1` NO se colapsa: un bind a loopback IPv6 no atiende en 127.0.0.1', () => {
    assert.equal(resolveClientHost(cfg('::1')), '::1');
  });

  it('hostname → se devuelve tal cual', () => {
    assert.equal(resolveClientHost(cfg('kodo.local')), 'kodo.local');
  });

  it('el fallback es inyectable: `localhost` para las URLs legibles', () => {
    assert.equal(resolveClientHost(cfg(undefined), 'localhost'), 'localhost');
    assert.equal(resolveClientHost(cfg('0.0.0.0'), 'localhost'), 'localhost');
    // El fallback NO se aplica cuando el bind manda.
    assert.equal(resolveClientHost(cfg('100.64.1.2'), 'localhost'), '100.64.1.2');
  });
});

describe('formatHostForUrl', () => {
  it('hostname e IPv4 pasan intactos (no contienen `:`)', () => {
    assert.equal(formatHostForUrl('localhost'), 'localhost');
    assert.equal(formatHostForUrl('127.0.0.1'), '127.0.0.1');
    assert.equal(formatHostForUrl('100.64.1.2'), '100.64.1.2');
  });

  it('literal IPv6 → entre corchetes (si no, los `:` rompen el parseo del puerto)', () => {
    assert.equal(formatHostForUrl('::1'), '[::1]');
    assert.equal(formatHostForUrl('fd7a:115c:a1e0::1'), '[fd7a:115c:a1e0::1]');
  });

  it('idempotente: un host ya entre corchetes no se re-envuelve', () => {
    assert.equal(formatHostForUrl('[::1]'), '[::1]');
  });

  it('el resultado es una URL parseable por `new URL`', () => {
    const url = `http://${formatHostForUrl('fd7a:115c:a1e0::1')}:9090`;
    assert.equal(new URL(url).port, '9090');
  });
});

// KODO-45: el mismo listado de wildcards que colapsa `resolveClientHost` alimenta
// ahora el aviso de arranque del server. Un solo origen, dos consumidores.
describe('isWildcardHost', () => {
  it('los dos wildcards de escucha son los únicos true', () => {
    assert.equal(isWildcardHost('0.0.0.0'), true);
    assert.equal(isWildcardHost('::'), true);
  });

  it('loopback y direcciones concretas son false', () => {
    assert.equal(isWildcardHost('127.0.0.1'), false);
    assert.equal(isWildcardHost('::1'), false, 'el loopback IPv6 escucha en una sola interfaz');
    assert.equal(isWildcardHost('100.64.1.2'), false);
    assert.equal(isWildcardHost('localhost'), false);
  });

  it('es coherente con resolveClientHost: lo que colapsa al fallback es lo que avisa', () => {
    for (const bind of ['0.0.0.0', '::']) {
      assert.equal(isWildcardHost(resolveListenHost(cfg(bind))), true);
      assert.equal(resolveClientHost(cfg(bind), 'localhost'), 'localhost');
    }
  });
});
