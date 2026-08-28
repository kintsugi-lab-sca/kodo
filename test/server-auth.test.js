// @ts-check
//
// test/server-auth.test.js — Phase 69 Plan 02, Task 1 + Task 3 (NET-02, D-04/D-05).
//
// Integration test over a REAL ephemeral-port managed server (mirror of the harness
// in server-managed.test.js: DI seam `_loadConfig`/`_provider`, HOME isolation,
// getFreePort, dynamic-import-with-cachebust). Drives real `fetch` against
// http://127.0.0.1:<port> and asserts the default-deny bearer guard:
//   - the API rail (/status, /logs, /comments, DELETE /sessions) requires a bearer;
//   - a ?token= query param NEVER authenticates (the HTML dashboard that needed it is gone);
//   - /health stays open, /webhook keeps its own HMAC (never bearer-gated);
//   - 401 bodies are neutral {error:'unauthorized'}.
//
// A known KODO_API_TOKEN is seeded in env BEFORE importing server.js so the startup
// getOrCreateApiToken() returns a deterministic value (no CSPRNG, no .env write).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'test-token-deadbeef-0123456789abcdef';

/** Free ephemeral port (reserve then release). */
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

/** Minimal config the DI seam injects — provider plane, offline, bound loopback. */
function fakeConfig(port) {
  return {
    provider: 'plane',
    providers: { plane: { projects: [] } },
    server: { port, bind: '127.0.0.1', idle_threshold_min: 5, stuck_threshold_min: 30 },
  };
}

// Fake provider: fully offline. verifySignature:false so a bad-signature webhook
// resolves via the HMAC lane (401 'Invalid signature'), distinct from the bearer
// 401 'unauthorized' — that distinction is what proves /webhook is NOT bearer-gated.
// KODO-45: `verifySignature` cuenta llamadas. El flood del final del fichero afirma
// que las peticiones limitadas NO llegan a computar el HMAC — que es el trabajo de
// CPU que el token-bucket existe para no pagar.
let verifyCalls = 0;

const fakeProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
  verifySignature: () => { verifyCalls++; return false; },
  parseTriggerEvent: () => null,
};

describe('server bearer guard (NET-02, D-04/D-05)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {Record<string, string | undefined>} */ let saved;
  /** @type {any} */ let handle;
  /** @type {string} */ let base;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-auth-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    saved = {
      HOME: process.env.HOME,
      KODO_API_TOKEN: process.env.KODO_API_TOKEN,
      KODO_DEV: process.env.KODO_DEV,
      PLANE_WEBHOOK_SECRET: process.env.PLANE_WEBHOOK_SECRET,
      KODO_WEBHOOK_SECRET_PLANE: process.env.KODO_WEBHOOK_SECRET_PLANE,
    };
    process.env.HOME = tmpHome;
    process.env.KODO_API_TOKEN = TOKEN; // deterministic bearer, no CSPRNG/.env write
    delete process.env.KODO_DEV;
    delete process.env.PLANE_WEBHOOK_SECRET;
    delete process.env.KODO_WEBHOOK_SECRET_PLANE;

    const port = await getFreePort();
    const mod = await import(`../src/server.js?auth-${Date.now()}`);
    handle = await mod.startServer({
      managed: true, insecure: true, port,
      _loadConfig: () => fakeConfig(port), _provider: fakeProvider,
    });
    base = `http://127.0.0.1:${port}`;
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

  it('GET /status without an Authorization header → 401 neutral body', async () => {
    const res = await fetch(`${base}/status`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /status with a wrong bearer → 401', async () => {
    const res = await fetch(`${base}/status`, { headers: { Authorization: 'Bearer nope' } });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /status with the correct bearer → 200 with the status shape', async () => {
    const res = await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions), 'sessions array present');
  });

  it('DELETE /sessions/:id without a bearer → 401 (never reaches the dismiss handler)', async () => {
    const res = await fetch(`${base}/sessions/abc`, { method: 'DELETE' });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('POST /orchestrator without a bearer → 401 (resolving the orchestrator can NOT be queried anonymously)', async () => {
    // Propiedad de seguridad de la tecla `O`: el endpoint resolve-only que resuelve el
    // `workspace:N` del orquestador NO está en isOpenRoute → el bearer se exige ANTES de tocar
    // cmux (un cliente anónimo jamás enumera los workspaces del host vía este endpoint).
    const res = await fetch(`${base}/orchestrator`, { method: 'POST' });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /health → 200 with NO Authorization header (open route)', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('POST /webhook is NOT bearer-gated — a no-auth request reaches HMAC (not the bearer 401)', async () => {
    const res = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    const body = await res.json();
    // Reached the webhook HMAC lane: bad/missing signature → 'Invalid signature',
    // NEVER the default-deny bearer body 'unauthorized'. This is what proves the
    // request crossed the guard into the webhook branch (open route).
    assert.notDeepEqual(body, { error: 'unauthorized' });
    assert.deepEqual(body, { error: 'Invalid signature' });
  });

  // --- KODO-17: the HTML dashboard rail is gone — `/` and `/dashboard` serve nothing ---

  it('GET / with no token → 401 neutral body (no HTML rail to fall into)', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 401);
    const text = await res.text();
    assert.doesNotMatch(text, /<!DOCTYPE html>/);
    assert.deepEqual(JSON.parse(text), { error: 'unauthorized' });
  });

  it('GET /?token=<correct> → 401 — a query token never authenticates any route', async () => {
    const res = await fetch(`${base}/?token=${TOKEN}`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET /status?token=<correct> (query, not header) → 401 — the bearer must be a header', async () => {
    const res = await fetch(`${base}/status?token=${TOKEN}`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  });

  it('GET / WITH a valid bearer → 404 and never HTML — the dashboard shell no longer exists', async () => {
    for (const path of ['/', '/dashboard']) {
      const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      assert.equal(res.status, 404, `${path} must be 404`);
      assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/);
      const text = await res.text();
      assert.doesNotMatch(text, /<!DOCTYPE html>/);
      assert.deepEqual(JSON.parse(text), { error: 'Not found' });
    }
  });

  it('an authenticated fetch to /status with the served token succeeds (bearer accepted)', async () => {
    const res = await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).sessions));
  });

  // --- KODO-45: rate limit del carril abierto (/webhook) ---
  //
  // ÚLTIMO test del fichero A PROPÓSITO: agota el bucket de 127.0.0.1 para el resto de
  // la vida de este server, así que cualquier test de /webhook que corriera después
  // vería 429. El bucket es por proceso-servidor, no global: los demás ficheros de test
  // arrancan el suyo.

  it('un flood a /webhook responde 429 sin tumbar el daemon, y las limitadas no llegan al HMAC', async () => {
    const beforeVerify = verifyCalls;
    const FLOOD = 60; // el doble de la capacidad por defecto (30)

    // Secuencial, no en paralelo: el token-bucket depende del reloj y con 60 fetch
    // concurrentes el resultado dependería del scheduler. Secuencial es determinista.
    const statuses = [];
    for (let i = 0; i < FLOOD; i++) {
      const res = await fetch(`${base}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-plane-signature': 'bad' },
        body: JSON.stringify({ event: 'noop', i }),
      });
      await res.arrayBuffer(); // drenar: undici mantiene viva la conexión si no
      statuses.push(res.status);
    }

    const limited = statuses.filter((s) => s === 429);
    assert.ok(limited.length > 0, `el flood debe encontrar el límite (respuestas: ${JSON.stringify(statuses)})`);
    assert.ok(
      statuses.every((s) => s === 429 || s === 401),
      'toda respuesta es o el 429 del límite o el 401 del HMAC — ningún 5xx, ninguna conexión rota',
    );
    // Un 429 no cuesta un HMAC: las verificaciones son estrictamente menos que las
    // peticiones enviadas, que es la propiedad de ahorro de CPU que se quiere.
    assert.ok(
      verifyCalls - beforeVerify < FLOOD,
      'las peticiones limitadas no deben computar la firma',
    );
    assert.equal(
      verifyCalls - beforeVerify,
      statuses.length - limited.length,
      'exactamente las peticiones NO limitadas llegan al HMAC',
    );

    // El daemon sigue en pie y el resto del carril no se ve afectado por el flood.
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200, 'el daemon sobrevive al flood');
    const status = await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(status.status, 200, 'el rate limit del webhook no toca el carril con bearer');
  });

  it('la respuesta 429 trae un Retry-After entero de segundos', async () => {
    // El bucket sigue agotado del test anterior (mismo server, misma IP).
    const res = await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-plane-signature': 'bad' },
      body: JSON.stringify({ event: 'noop' }),
    });
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: 'too many requests' });
    const retryAfter = res.headers.get('retry-after');
    assert.match(retryAfter || '', /^\d+$/, 'Retry-After debe ser un entero de segundos');
    assert.ok(Number(retryAfter) >= 1, 'Retry-After 0 significaría "reintenta ya"');
  });
});
