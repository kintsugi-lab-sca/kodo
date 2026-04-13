// @ts-check
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, KODO_DIR } from './config.js';
import { initRegistry, getProvider } from './providers/registry.js';
import { listSessions } from './session/state.js';
import { handleWebhookRequest } from './triggers/webhook.js';
import * as cmux from './cmux/client.js';

const PID_PATH = join(KODO_DIR, 'server.pid');

/**
 * Read raw body from incoming HTTP request
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/**
 * Start the webhook server
 * @param {{ port?: number, insecure?: boolean }} [opts]
 */
export async function startServer(opts = {}) {
  const config = loadConfig();
  const port = opts.port || config.server.port;

  await initRegistry();
  const provider = getProvider(config.provider);
  await provider.init();

  // Webhook secret check — provider-specific env var with legacy fallback
  const secretEnv = `KODO_WEBHOOK_SECRET_${config.provider.toUpperCase()}`;
  const webhookSecret = process.env[secretEnv] || process.env.PLANE_WEBHOOK_SECRET;

  if (process.env.PLANE_WEBHOOK_SECRET && !process.env[secretEnv]) {
    console.warn(`[kodo] Deprecation: use ${secretEnv} instead of PLANE_WEBHOOK_SECRET`);
  }

  if (!webhookSecret && !opts.insecure && !process.env.KODO_DEV) {
    console.error(`[kodo] Missing webhook secret. Set ${secretEnv} or use --insecure / KODO_DEV=1`);
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      const sessions = listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions, count: sessions.length }));
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook') {
      try {
        const rawBody = await readBody(req);
        const result = await handleWebhookRequest(rawBody, req.headers, provider);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        console.error(`[kodo] Bad request: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    console.log(`[kodo] Server listening on :${port}`);
    console.log(`[kodo] Webhook URL: http://localhost:${port}/webhook`);
    console.log(`[kodo] Status URL: http://localhost:${port}/status`);

    writeFileSync(PID_PATH, String(process.pid));

    if (process.env.CMUX_WORKSPACE_ID) {
      cmux.rename({ workspace: process.env.CMUX_WORKSPACE_ID, title: '\u5FC3\u52D5 kodo service' }).catch(() => {});
      cmux.setColor({ workspace: process.env.CMUX_WORKSPACE_ID, color: 'Indigo' }).catch(() => {});
    }
  });

  const cleanup = () => {
    try { unlinkSync(PID_PATH); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return server;
}

/**
 * Stop the server via PID file
 */
export function stopServer() {
  if (!existsSync(PID_PATH)) {
    console.log('[kodo] No server running (no PID file)');
    return false;
  }

  const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    unlinkSync(PID_PATH);
    console.log(`[kodo] Server stopped (PID ${pid})`);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      unlinkSync(PID_PATH);
      console.log('[kodo] Server was not running (stale PID file removed)');
      return false;
    }
    throw err;
  }
}

export { PID_PATH };
