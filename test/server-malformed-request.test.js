// @ts-check
//
// test/server-malformed-request.test.js — Phase 69 code review fixes (CR-01, WR-01).
//
// CR-01: a malformed request target (absolute-form with a bad authority, e.g.
// `GET http://[ HTTP/1.1`) made the unguarded `new URL(req.url, …)` throw
// synchronously inside the async handler → unhandled rejection → the whole
// long-lived daemon died, PRE-auth. The fix answers a neutral 400 and the server
// must stay alive for the next request. fetch/undici refuse to emit an invalid
// request target, so the malformed request goes out over a raw TCP socket.
//
// WR-01: the /comments/ and DELETE /sessions/ branches decoded the path segment
// with an unguarded decodeURIComponent — malformed percent-encoding (%zz) threw
// URIError with the same crash consequence, post-auth. Fixed with a guarded
// decode → neutral 400.
//
// KODO-45 amplía el fichero con las dos peticiones que ahora se rechazan ANTES de
// llegar a cualquier trabajo real: un Content-Type que no es JSON (415, sin parsear
// ni firmar el body) y unas cabeceras por encima de `maxHeaderSize` (431, que
// responde el propio parser de Node — el handler ni se ejecuta).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-malformed-0123456789ab';

function getFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

/** Send raw bytes over a TCP socket and collect the full response. */
function rawRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('raw request timeout')); });
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

// KODO-45: `verifySignature` cuenta llamadas para poder afirmar que el 415 se emite
// PRE-HMAC (el trabajo criptográfico es justo lo que el guard evita).
let verifyCalls = 0;

const fakeProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
  verifySignature: () => { verifyCalls++; return false; },
  parseTriggerEvent: () => null,
};

describe('server malformed request target (CR-01)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let handle;
  /** @type {number} */ let port;
  /** @type {any} */ let mod;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-malformed-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    saved = { HOME: process.env.HOME, KODO_API_TOKEN: process.env.KODO_API_TOKEN };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN;
    port = await getFreePort();
    const config = {
      provider: 'plane',
      providers: { plane: { projects: [] } },
      server: { port, bind: '127.0.0.1' },
    };
    mod = await import(`../src/server.js?malformed-${Date.now()}`);
    handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => config, _provider: fakeProvider,
    });
  });

  after(async () => {
    try { handle?.stopReconcile(); } catch {}
    if (handle?.server) await new Promise((r) => handle.server.close(() => r(undefined)));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('a request target that WHATWG-URL rejects → neutral 400, daemon survives', async () => {
    const response = await rawRequest(
      port,
      'GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
    );
    assert.match(response, /^HTTP\/1\.1 400 /, 'malformed target must answer 400, not crash');
    assert.match(response, /\{"error":"bad request"\}/, 'neutral body, no err detail');

    // The daemon must still be alive and serving after the malformed request.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200, 'server must survive the malformed request');
    const body = await health.json();
    assert.equal(body.status, 'ok');
  });

  it('WR-01: malformed %-encoding on /comments/ → 400, daemon survives', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/comments/%zz`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'bad request' });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200, 'server must survive the malformed decode');
  });

  it('WR-01: malformed %-encoding on DELETE /sessions/ → 400, daemon survives', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/sessions/%zz`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'bad request' });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200, 'server must survive the malformed decode');
  });

  // --- KODO-45: Content-Type → 415 antes de parsear ni firmar ---

  it('POST /webhook con Content-Type text/plain → 415 PRE-HMAC', async () => {
    const before = verifyCalls;
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-plane-signature': 'whatever' },
      body: 'no soy json',
    });
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: 'unsupported media type' });
    assert.equal(verifyCalls, before, 'verifySignature NO debe correr para un tipo no-JSON');
  });

  it('POST /webhook sin cabecera Content-Type → 415 (no se adivina el tipo)', async () => {
    const before = verifyCalls;
    // undici pone `text/plain;charset=UTF-8` a un body string, así que para no enviar
    // NINGÚN Content-Type hay que bajar al socket crudo.
    const body = JSON.stringify({ event: 'noop' });
    const response = await rawRequest(
      port,
      `POST /webhook HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${Buffer.byteLength(body)}\r\n`
        + `Connection: close\r\n\r\n${body}`,
    );
    assert.match(response, /^HTTP\/1\.1 415 /, 'sin Content-Type declarado → 415');
    assert.match(response, /\{"error":"unsupported media type"\}/);
    assert.equal(verifyCalls, before, 'verifySignature NO debe correr sin Content-Type');
  });

  it('POST /webhook con application/json; charset=utf-8 SÍ atraviesa el guard (llega al HMAC)', async () => {
    const before = verifyCalls;
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-plane-signature': 'bad' },
      body: JSON.stringify({ event: 'noop' }),
    });
    // Firma inválida → el carril HMAC responde 401: prueba de que el guard dejó pasar.
    assert.notEqual(res.status, 415, 'los parámetros del media type no deben rechazar la petición');
    assert.equal(verifyCalls, before + 1, 'el guard dejó llegar la petición al HMAC');
  });

  it('isJsonContentType acepta los tipos JSON legítimos y rechaza el resto', () => {
    for (const ok of [
      'application/json',
      'application/json; charset=utf-8',
      'APPLICATION/JSON',
      '  application/json  ',
      'application/vnd.plane+json', // subtipo estructurado con sufijo +json
    ]) {
      assert.equal(mod.isJsonContentType(ok), true, `debe aceptar ${JSON.stringify(ok)}`);
    }
    for (const bad of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/jsonish', // NO es JSON: el media type completo no casa
      '',
      undefined,
      null,
      42,
    ]) {
      assert.equal(mod.isJsonContentType(bad), false, `debe rechazar ${JSON.stringify(bad)}`);
    }
  });

  // --- KODO-45: maxHeaderSize → 431 del propio parser de Node ---

  it('cabeceras por encima de maxHeaderSize → 431, daemon survives', async () => {
    // 10 KB: por ENCIMA del tope explícito de kodo (8 KB) y por DEBAJO del default de
    // Node (16 KB) a propósito — con el default esta petición se serviría con un 200,
    // así que el 431 solo puede venir del maxHeaderSize que fija el server.
    const huge = 'a'.repeat(10 * 1024);
    const response = await rawRequest(
      port,
      `GET /health HTTP/1.1\r\nHost: localhost\r\nX-Big: ${huge}\r\nConnection: close\r\n\r\n`,
    );
    assert.match(response, /^HTTP\/1\.1 431 /, 'cabeceras sobredimensionadas → 431');

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200, 'el daemon sigue sirviendo tras el 431');
  });

  it('una cabecera Authorization normal sigue cabiendo de sobra bajo el tope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200, 'el tope de 8 KB no puede estorbar al carril API real');
  });
});
