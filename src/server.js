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

function dashboardHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kodo</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; background: #0a0a0a; color: #e0e0e0; padding: 24px; min-height: 100vh; }
  h1 { font-size: 14px; color: #666; margin-bottom: 20px; letter-spacing: 2px; text-transform: uppercase; }
  h1 span { color: #f59e0b; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 960px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 16px; }
  .card h2 { font-size: 11px; color: #555; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; }
  .session { padding: 10px 0; border-bottom: 1px solid #1a1a1a; }
  .session:last-child { border-bottom: none; }
  .ref { font-weight: 600; color: #f59e0b; }
  .title { color: #999; font-size: 12px; margin-top: 2px; }
  .meta { font-size: 11px; color: #555; margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-running { background: #1a1a0a; color: #f59e0b; border: 1px solid #3d3200; }
  .badge-review { background: #0a0a1a; color: #60a5fa; border: 1px solid #002a5c; }
  .badge-stuck { background: #1a0a0a; color: #ef4444; border: 1px solid #5c0000; }
  .badge-gone { background: #111; color: #555; border: 1px solid #333; }
  .empty { color: #333; font-size: 12px; padding: 12px 0; }
  .pending-item { padding: 8px 0; border-bottom: 1px solid #1a1a1a; }
  .pending-item:last-child { border-bottom: none; }
  .pending-item a { color: #f59e0b; text-decoration: none; font-weight: 600; }
  .pending-item a:hover { text-decoration: underline; }
  .stats { display: flex; gap: 24px; margin-bottom: 20px; }
  .stat { text-align: center; }
  .stat-val { font-size: 28px; font-weight: 700; color: #f59e0b; }
  .stat-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .update-time { font-size: 10px; color: #333; text-align: right; margin-top: 16px; }
</style>
</head>
<body>
<h1><span>心動</span> kodo</h1>
<div class="stats" id="stats"></div>
<div class="grid">
  <div class="card">
    <h2><span class="dot"></span>Sesiones</h2>
    <div id="sessions"><div class="empty">Cargando...</div></div>
  </div>
  <div class="card">
    <h2>Pendientes</h2>
    <div id="pending"><div class="empty">Cargando...</div></div>
  </div>
</div>
<div class="update-time" id="updated"></div>

<script>
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd';
}

function uptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

async function refresh() {
  try {
    const res = await fetch('/status');
    const data = await res.json();

    document.getElementById('stats').innerHTML =
      '<div class="stat"><div class="stat-val">' + data.count + '</div><div class="stat-label">Sesiones</div></div>' +
      '<div class="stat"><div class="stat-val">' + data.pending_count + '</div><div class="stat-label">Pendientes</div></div>' +
      '<div class="stat"><div class="stat-val">' + uptime(data.uptime) + '</div><div class="stat-label">Uptime</div></div>';

    if (data.sessions.length === 0) {
      document.getElementById('sessions').innerHTML = '<div class="empty">Sin sesiones activas</div>';
    } else {
      document.getElementById('sessions').innerHTML = data.sessions.map(function(s) {
        return '<div class="session">' +
          '<span class="ref">' + s.task_ref + '</span> ' +
          '<span class="badge badge-' + s.status + '">' + s.status + '</span>' +
          '<div class="title">' + s.summary + '</div>' +
          '<div class="meta">' + ago(s.started_at) + ' · ' + (s.project_path || '').split('/').slice(-2).join('/') + '</div>' +
          '</div>';
      }).join('');
    }

    if (data.pending.length === 0) {
      document.getElementById('pending').innerHTML = '<div class="empty">Sin tareas pendientes</div>';
    } else {
      document.getElementById('pending').innerHTML = data.pending.map(function(t) {
        return '<div class="pending-item">' +
          '<a href="' + t.url + '" target="_blank">' + t.ref + '</a>' +
          '<div class="title">' + t.title + '</div>' +
          '</div>';
      }).join('');
    }

    document.getElementById('updated').textContent = 'Actualizado: ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('updated').textContent = 'Error: ' + e.message;
  }
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

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
      let pending = [];
      try { pending = await provider.listPendingTasks(); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions,
        count: sessions.length,
        pending: pending.map((t) => ({ ref: t.ref, title: t.title, url: t.url })),
        pending_count: pending.length,
        uptime: process.uptime(),
      }));
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml());
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook') {
      try {
        const rawBody = await readBody(req);
        console.log(`[kodo] Webhook received: ${rawBody.slice(0, 200)}`);
        const result = await handleWebhookRequest(rawBody, req.headers, provider);
        console.log(`[kodo] Webhook result: ${JSON.stringify(result)}`);
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
