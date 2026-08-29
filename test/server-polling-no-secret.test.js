// @ts-check
//
// test/server-polling-no-secret.test.js — KODO-66.
//
// El secreto de webhook (`KODO_WEBHOOK_SECRET_<PROVIDER>`) solo sirve para verificar
// la firma HMAC de `POST /webhook`. Con `polling.enabled` (KODO-60) la máquina se
// entera de los cambios preguntando, así que exigirlo obligaba al operador sin URL
// pública a inventarse un secreto para un endpoint que nadie iba a llamar — y bajo
// systemd (KODO-59) producía un daemon que moría y se reiniciaba en bucle.
//
// Contrato que fija este fichero:
//   1. polling ON  + sin secreto → ARRANCA; `POST /webhook` → 503 neutro; el resto
//      del carril (bearer /status, /health) intacto.
//   2. polling OFF + sin secreto → sigue fallando (managed: throw KODO_SETUP_REQUIRED;
//      legacy: exit 1) con el mensaje que ahora NOMBRA la salida por polling.
//   3. con secreto (con o sin polling) → webhook ACTIVO: la petición llega a la lane
//      HMAC, que es lo que distingue «apagado» de «rechazado por firma».
//
// Arnés: espejo de test/server-auth.test.js — server managed real en puerto efímero,
// DI seam `_loadConfig`/`_provider`, HOME aislado, import dinámico con cache-bust.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

const TOKEN = 'test-token-kodo66-0123456789abcdef';

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

/**
 * Config mínima del DI seam — provider plane offline, bind loopback.
 * @param {number} port
 * @param {boolean} pollingEnabled
 */
function fakeConfig(port, pollingEnabled) {
  return {
    provider: 'plane',
    providers: { plane: { projects: [] } },
    server: { port, bind: '127.0.0.1', idle_threshold_min: 5, stuck_threshold_min: 30 },
    polling: { enabled: pollingEnabled, interval_s: 60, catch_up: false },
  };
}

// Provider offline. `verifySignature:false` hace que un webhook FIRMADO MAL resuelva
// por la lane HMAC (401 'Invalid signature'), distinguible del 503 de la ruta apagada.
const fakeProvider = {
  init: async () => {},
  listPendingTasks: async () => [],
  getTaskState: async () => null,
  verifySignature: () => false,
  parseTriggerEvent: () => null,
};

/** Env que este fichero manipula; se restaura entera en el `after`. */
const TOUCHED_ENV = [
  'HOME',
  'KODO_API_TOKEN',
  'KODO_DEV',
  'PLANE_WEBHOOK_SECRET',
  'KODO_WEBHOOK_SECRET_PLANE',
];

/**
 * Arranca un server managed aislado y devuelve `{ handle, base, restore }`.
 * @param {{ polling: boolean, secret?: string }} opts
 */
async function startIsolated({ polling, secret }) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-k66-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  /** @type {Record<string, string | undefined>} */
  const saved = {};
  for (const k of TOUCHED_ENV) saved[k] = process.env[k];

  process.env.HOME = tmpHome;
  process.env.KODO_API_TOKEN = TOKEN; // bearer determinista: ni CSPRNG ni escritura en .env
  delete process.env.KODO_DEV;
  delete process.env.PLANE_WEBHOOK_SECRET;
  if (secret) process.env.KODO_WEBHOOK_SECRET_PLANE = secret;
  else delete process.env.KODO_WEBHOOK_SECRET_PLANE;

  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpHome, { recursive: true, force: true });
  };

  try {
    const port = await getFreePort();
    const mod = await import(`../src/server.js?k66-${Date.now()}-${Math.random()}`);
    const handle = await mod.startServer({
      managed: true,
      port,
      _loadConfig: () => fakeConfig(port, polling),
      _provider: fakeProvider,
    });
    return { handle, base: `http://127.0.0.1:${port}`, restore, mod, port };
  } catch (err) {
    restore();
    throw err;
  }
}

/** Cierra el handle managed y restaura el entorno. */
async function stopIsolated(ctx) {
  try { ctx?.handle?.stopReconcile(); } catch {}
  if (ctx?.handle?.server) await new Promise((r) => ctx.handle.server.close(() => r(undefined)));
  ctx?.restore?.();
}

describe('KODO-66 — polling sin secreto: el daemon arranca con /webhook apagado', () => {
  /** @type {any} */ let ctx;

  before(async () => {
    ctx = await startIsolated({ polling: true });
  });

  after(async () => { await stopIsolated(ctx); });

  it('POST /webhook → 503 con body neutro (ruta desactivada, no 401 ni 500)', async () => {
    const res = await fetch(`${ctx.base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-plane-signature': 'deadbeef' },
      body: JSON.stringify({ event: 'issue', action: 'update' }),
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'webhook disabled' });
  });

  it('el 503 NO depende del Content-Type ni de la firma (guard 0, antes de todo)', async () => {
    const res = await fetch(`${ctx.base}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'no-json',
    });
    assert.equal(res.status, 503);
  });

  it('GET /status con el bearer sigue funcionando — el carril API no se toca', async () => {
    const res = await fetch(`${ctx.base}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sessions), 'el /status debe seguir sirviendo su shape');
  });

  it('GET /status sin bearer sigue siendo 401 — apagar el webhook no abre nada', async () => {
    const res = await fetch(`${ctx.base}/status`);
    assert.equal(res.status, 401);
  });

  it('GET /health sigue abierto', async () => {
    const res = await fetch(`${ctx.base}/health`);
    assert.equal(res.status, 200);
  });
});

describe('KODO-66 — con secreto el webhook sigue activo', () => {
  it('polling OFF + secreto → la petición llega a la lane HMAC (401 firma), no 503', async () => {
    const ctx = await startIsolated({ polling: false, secret: 'k66-secret' });
    try {
      const res = await fetch(`${ctx.base}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-plane-signature': 'deadbeef' },
        body: JSON.stringify({ event: 'issue', action: 'update' }),
      });
      assert.notEqual(res.status, 503, 'con secreto la ruta NO puede estar apagada');
      assert.equal(res.status, 401);
    } finally {
      await stopIsolated(ctx);
    }
  });

  it('polling ON + secreto → conviven: el webhook sigue sirviéndose', async () => {
    const ctx = await startIsolated({ polling: true, secret: 'k66-secret' });
    try {
      const res = await fetch(`${ctx.base}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-plane-signature': 'deadbeef' },
        body: JSON.stringify({ event: 'issue', action: 'update' }),
      });
      assert.notEqual(res.status, 503);
      assert.equal(res.status, 401);
    } finally {
      await stopIsolated(ctx);
    }
  });
});

describe('KODO-66 — sin polling y sin secreto sigue siendo un fallo', () => {
  it('managed → throw KODO_SETUP_REQUIRED (run.js sigue siendo el dueño del exit)', async () => {
    await assert.rejects(
      () => startIsolated({ polling: false }),
      (err) => {
        assert.equal(/** @type {any} */ (err).code, 'KODO_SETUP_REQUIRED');
        return true;
      },
    );
  });

  it('legacy `kodo start` → exit 1 y el mensaje NOMBRA la salida por polling', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-k66-exit-'));
    try {
      mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
      writeFileSync(
        join(tmpHome, '.kodo', 'config.json'),
        JSON.stringify({
          provider: 'plane',
          providers: {
            plane: {
              base_url: 'http://127.0.0.1:1',
              web_url: 'http://127.0.0.1:1',
              api_key_env: 'PLANE_API_KEY',
              workspace_slug: 'test',
              projects: [],
              states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
            },
          },
          server: { port: 0, idle_threshold_min: 5, stuck_threshold_min: 30 },
          polling: { enabled: false, interval_s: 60, catch_up: false },
        }),
      );

      const env = { ...process.env, HOME: tmpHome, NO_COLOR: '1', PLANE_API_KEY: 'kodo-test-key' };
      delete env.KODO_DEV;
      delete env.PLANE_WEBHOOK_SECRET;
      for (const k of Object.keys(env)) {
        if (k.startsWith('KODO_WEBHOOK_SECRET_')) delete env[k];
      }

      const res = spawnSync(process.execPath, [KODO_BIN, 'start'], {
        env,
        encoding: 'utf-8',
        timeout: 15000,
      });
      assert.equal(res.status, 1, `esperado exit 1, got ${res.status}. stderr: ${res.stderr}`);
      assert.match(res.stderr, /Missing webhook secret/, res.stderr);
      // Lo nuevo de KODO-66: el mensaje ya no manda solo a generar un secreto.
      assert.match(res.stderr, /polling\.enabled/, res.stderr);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
