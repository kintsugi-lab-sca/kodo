// @ts-check
//
// test/server/rate-limit.test.js — KODO-45.
//
// Tests OFFLINE del token-bucket: reloj inyectado, cero sockets, cero espera real.
// El comportamiento e2e sobre `/webhook` (flood → 429 sin tumbar el daemon) vive en
// test/server-auth.test.js, que es donde está el carril abierto del webhook.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter, WEBHOOK_RATE_CAPACITY, WEBHOOK_RATE_REFILL_PER_SEC } from '../../src/server/rate-limit.js';

/** Reloj manual en ms. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createRateLimiter (KODO-45)', () => {
  it('deja pasar exactamente `capacity` peticiones seguidas y rechaza la siguiente', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 3, refillPerSec: 1, now: clock.now });

    for (let i = 0; i < 3; i++) {
      assert.equal(limiter.check('ip-a').allowed, true, `la petición ${i + 1} debe pasar`);
    }
    const denied = limiter.check('ip-a');
    assert.equal(denied.allowed, false, 'la 4ª agota el bucket');
    assert.ok(denied.retryAfterSec >= 1, 'Retry-After nunca es 0 (0 significaría "ya")');
  });

  it('aísla las claves: agotar una IP no afecta a otra', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 1, now: clock.now });

    limiter.check('ip-a');
    limiter.check('ip-a');
    assert.equal(limiter.check('ip-a').allowed, false, 'ip-a agotada');
    assert.equal(limiter.check('ip-b').allowed, true, 'ip-b tiene su propio bucket');
  });

  it('repone tokens con el paso del tiempo (fraccionado, sin ticks)', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 1, now: clock.now });

    limiter.check('ip-a');
    limiter.check('ip-a');
    assert.equal(limiter.check('ip-a').allowed, false);

    clock.advance(500); // medio token: sigue sin alcanzar para una petición entera
    assert.equal(limiter.check('ip-a').allowed, false, 'medio token no basta');

    clock.advance(600); // ya supera el token entero
    assert.equal(limiter.check('ip-a').allowed, true, 'con un token entero vuelve a pasar');
  });

  it('nunca acumula por encima de `capacity` por mucho que pase el tiempo', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 1, now: clock.now });

    limiter.check('ip-a');
    clock.advance(60 * 60 * 1000); // una hora parada

    assert.equal(limiter.check('ip-a').allowed, true);
    assert.equal(limiter.check('ip-a').allowed, true);
    assert.equal(limiter.check('ip-a').allowed, false, 'el bucket satura en capacity, no acumula la hora');
  });

  it('el Retry-After crece con la deuda acumulada', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1, now: clock.now });

    limiter.check('ip-a');
    const first = limiter.check('ip-a');
    assert.equal(first.allowed, false);
    assert.equal(first.retryAfterSec, 1, 'falta 1 token → 1 s a 1 token/s');

    const half = createRateLimiter({ capacity: 1, refillPerSec: 0.5, now: clock.now });
    half.check('ip-a');
    assert.equal(half.check('ip-a').retryAfterSec, 2, 'a 0.5 token/s, 1 token tarda 2 s');
  });

  it('acota la memoria: barre los buckets ya recuperados antes de crecer', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 1, now: clock.now, maxKeys: 4 });

    for (const ip of ['a', 'b', 'c', 'd']) limiter.check(ip);
    assert.equal(limiter.size(), 4, 'el Map llega al techo');

    clock.advance(10_000); // todos los buckets se han recuperado del todo
    limiter.check('e');
    assert.ok(limiter.size() <= 4, 'el barrido olvida los buckets llenos en vez de crecer');
    assert.equal(limiter.check('e').allowed, true, 'la clave nueva conserva su cuota');
  });

  it('bajo flood distribuido resetea en vez de crecer sin límite (fail-open acotado)', () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 5, refillPerSec: 1, now: clock.now, maxKeys: 3 });

    // Cada IP gasta un token, así que NINGÚN bucket está lleno: el barrido no puede
    // liberar nada y el limiter debe elegir memoria acotada por encima de contadores.
    for (const ip of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) limiter.check(ip);
    assert.ok(limiter.size() <= 3, `el Map nunca supera maxKeys (era ${limiter.size()})`);
  });

  it('los defaults exportados son los que consume el server', () => {
    assert.equal(WEBHOOK_RATE_CAPACITY, 30);
    assert.equal(WEBHOOK_RATE_REFILL_PER_SEC, 1);

    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now });
    for (let i = 0; i < WEBHOOK_RATE_CAPACITY; i++) {
      assert.equal(limiter.check('ip').allowed, true, `default capacity cubre la petición ${i + 1}`);
    }
    assert.equal(limiter.check('ip').allowed, false);
  });
});
