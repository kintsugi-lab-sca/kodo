// @ts-check
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, KODO_DIR } from './config.js';
import { initRegistry, getProvider } from './providers/registry.js';
import { listSessions, listHistory, removeSession } from './session/state.js';
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
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1200px; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .card { background: #141414; border: 1px solid #222; border-radius: 8px; padding: 16px; }
  .card.full { grid-column: 1 / -1; }
  .card h2 { font-size: 11px; color: #555; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
  .card .subtitle { font-size: 11px; color: #444; margin-bottom: 12px; font-style: italic; }
  .proj-group { margin-bottom: 14px; }
  .proj-group:last-child { margin-bottom: 0; }
  .proj-header { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 6px; border-bottom: 1px solid #1a1a1a; margin-bottom: 6px; }
  .session, .pending-item, .history-item { padding: 10px 0; border-bottom: 1px solid #1a1a1a; }
  .session:last-child, .pending-item:last-child, .history-item:last-child { border-bottom: none; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row-spread { display: flex; justify-content: space-between; align-items: center; }
  .ref { font-weight: 600; color: #f59e0b; text-decoration: none; }
  .ref:hover { text-decoration: underline; }
  .title { color: #999; font-size: 12px; margin-top: 2px; }
  .meta { font-size: 11px; color: #555; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-running { background: #1a1a0a; color: #f59e0b; border: 1px solid #3d3200; }
  .badge-review { background: #0a0a1a; color: #60a5fa; border: 1px solid #002a5c; }
  .badge-stuck { background: #1a0a0a; color: #ef4444; border: 1px solid #5c0000; }
  .badge-gone, .badge-dead { background: #1a0a0a; color: #ef4444; border: 1px solid #5c0000; }
  .badge-idle { background: #111; color: #888; border: 1px solid #333; }
  .badge-done { background: #0a1a0a; color: #22c55e; border: 1px solid #004d1a; }
  .empty { color: #333; font-size: 12px; padding: 12px 0; }
  .btn { background: transparent; border: 1px solid #333; color: #999; font-size: 10px; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .btn:hover { border-color: #555; color: #e0e0e0; }
  .btn-danger:hover { border-color: #5c0000; color: #ef4444; }
  .actions { display: flex; gap: 6px; margin-top: 6px; }
  .stats { display: flex; gap: 24px; margin-bottom: 20px; }
  .stat { text-align: center; }
  .stat-val { font-size: 28px; font-weight: 700; color: #f59e0b; }
  .stat-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .update-time { font-size: 10px; color: #333; text-align: right; margin-top: 16px; max-width: 1200px; }
</style>
</head>
<body>
<h1><span>心動</span> kodo</h1>
<div class="stats" id="stats"></div>
<div class="grid">
  <div class="card">
    <h2><span class="dot"></span>Sesiones activas</h2>
    <div class="subtitle">Tareas con sesión Claude lanzada por kodo</div>
    <div id="sessions"><div class="empty">Cargando...</div></div>
  </div>
  <div class="card">
    <h2>Candidatas</h2>
    <div class="subtitle">Tareas en Plane con label kodo (no lanzadas)</div>
    <div id="pending"><div class="empty">Cargando...</div></div>
  </div>
  <div class="card full">
    <h2>Historial</h2>
    <div class="subtitle">Últimas 10 sesiones cerradas</div>
    <div id="history"><div class="empty">Cargando...</div></div>
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

function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const k = keyFn(item) || 'Sin proyecto';
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  }
  return groups;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function deleteSession(taskId, ref) {
  if (!confirm('¿Eliminar sesión ' + ref + ' del state?')) return;
  await fetch('/sessions/' + encodeURIComponent(taskId), { method: 'DELETE' });
  refresh();
}

function renderSession(s) {
  var displayStatus = s.status;
  if (!s.alive && s.status === 'running') displayStatus = 'dead';
  if (s.alive && s.status === 'running' && s.elapsed_min > 30) displayStatus = 'idle';
  var refLink = s.task_url
    ? '<a class="ref" href="' + escapeHtml(s.task_url) + '" target="_blank">' + escapeHtml(s.task_ref) + '</a>'
    : '<span class="ref">' + escapeHtml(s.task_ref) + '</span>';
  return '<div class="session">' +
    '<div class="row-spread">' +
      '<div class="row">' + refLink + ' <span class="badge badge-' + displayStatus + '">' + displayStatus + '</span></div>' +
      '<span class="meta">' + s.elapsed_min + 'min · ' + s.workspace_ref + '</span>' +
    '</div>' +
    '<div class="title">' + escapeHtml(s.summary) + '</div>' +
    '<div class="actions">' +
      '<button class="btn btn-danger" onclick="deleteSession(\\''+ escapeHtml(s.task_id) +'\\', \\''+ escapeHtml(s.task_ref) +'\\')">Eliminar</button>' +
    '</div>' +
  '</div>';
}

function renderGroupedSessions(sessions) {
  if (!sessions.length) return '<div class="empty">Sin sesiones activas</div>';
  const groups = groupBy(sessions, (s) => (s.project_path || '').split('/').slice(-2).join('/') || s.project_name);
  return Object.keys(groups).sort().map((proj) => (
    '<div class="proj-group">' +
      '<div class="proj-header">' + escapeHtml(proj) + '</div>' +
      groups[proj].map(renderSession).join('') +
    '</div>'
  )).join('');
}

function renderPending(items) {
  if (!items.length) return '<div class="empty">Sin tareas candidatas</div>';
  const groups = groupBy(items, (t) => t.projectName || t.ref.split('-')[0]);
  return Object.keys(groups).sort().map((proj) => (
    '<div class="proj-group">' +
      '<div class="proj-header">' + escapeHtml(proj) + '</div>' +
      groups[proj].map((t) => (
        '<div class="pending-item">' +
          '<div class="row">' +
            '<a class="ref" href="' + escapeHtml(t.url) + '" target="_blank">' + escapeHtml(t.ref) + '</a>' +
            (t.state ? '<span class="badge badge-running">' + escapeHtml(t.state) + '</span>' : '') +
          '</div>' +
          '<div class="title">' + escapeHtml(t.title) + '</div>' +
        '</div>'
      )).join('') +
    '</div>'
  )).join('');
}

function renderHistory(items) {
  if (!items.length) return '<div class="empty">Sin historial</div>';
  return items.map((s) => {
    var durMin = s.ended_at ? Math.floor((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000) : '?';
    var refLink = s.task_url
      ? '<a class="ref" href="' + escapeHtml(s.task_url) + '" target="_blank">' + escapeHtml(s.task_ref) + '</a>'
      : '<span class="ref">' + escapeHtml(s.task_ref) + '</span>';
    return '<div class="history-item">' +
      '<div class="row-spread">' +
        '<div class="row">' + refLink + ' <span class="badge badge-done">cerrada</span></div>' +
        '<span class="meta">' + durMin + 'min · ' + ago(s.ended_at || s.started_at) + '</span>' +
      '</div>' +
      '<div class="title">' + escapeHtml(s.summary) + '</div>' +
    '</div>';
  }).join('');
}

async function refresh() {
  try {
    const res = await fetch('/status');
    const data = await res.json();

    document.getElementById('stats').innerHTML =
      '<div class="stat"><div class="stat-val">' + data.count + '</div><div class="stat-label">Activas</div></div>' +
      '<div class="stat"><div class="stat-val">' + data.pending_count + '</div><div class="stat-label">Candidatas</div></div>' +
      '<div class="stat"><div class="stat-val">' + (data.history || []).length + '</div><div class="stat-label">Historial</div></div>' +
      '<div class="stat"><div class="stat-val">' + uptime(data.uptime) + '</div><div class="stat-label">Uptime</div></div>';

    document.getElementById('sessions').innerHTML = renderGroupedSessions(data.sessions);
    document.getElementById('pending').innerHTML = renderPending(data.pending);
    document.getElementById('history').innerHTML = renderHistory(data.history || []);
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

      // Enrich sessions with live workspace health
      let workspaceList = '';
      try { workspaceList = await cmux.listWorkspaces(); } catch {}
      const enriched = sessions.map((s) => ({
        ...s,
        alive: workspaceList.includes(s.workspace_ref),
        elapsed_min: Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60000),
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions: enriched,
        count: enriched.length,
        pending: pending.map((t) => ({ ref: t.ref, title: t.title, url: t.url, state: t.state, projectName: t.projectName })),
        pending_count: pending.length,
        history: listHistory().slice(0, 10),
        uptime: process.uptime(),
      }));
      return;
    }

    if (req.method === 'DELETE' && req.url?.startsWith('/sessions/')) {
      const taskId = decodeURIComponent(req.url.slice('/sessions/'.length));
      removeSession(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed: taskId }));
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
