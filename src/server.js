// @ts-check
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, KODO_DIR } from './config.js';
import { initRegistry, getProvider } from './providers/registry.js';
import { listSessions, listHistory, removeSession, loadState, saveState, runUnderStateLock } from './session/state.js';
import { handleWebhookRequest } from './triggers/webhook.js';
import { createProviderStateResolver } from './server/provider-state.js';
import { createDismissHandler } from './server/dismiss.js';
import { parseBearer, timingSafeTokenEqual, isOpenRoute, getOrCreateApiToken, MAX_BODY_BYTES } from './server/auth.js';
import * as cmux from './cmux/client.js';

const PID_PATH = join(KODO_DIR, 'server.pid');

// Ring buffer for recent server logs (last 200 lines)
const LOG_BUFFER_SIZE = 200;
const logBuffer = [];

// Cache for pending tasks (avoid hitting Plane API every dashboard poll)
const PENDING_CACHE_TTL_MS = 30 * 1000;
let pendingCache = { data: [], ts: 0 };

function pushLog(level, args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  logBuffer.push({ ts: new Date().toISOString(), level, msg });
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}

function getLogBuffer() {
  return logBuffer.slice().reverse();
}

/**
 * Envuelve un writer de console (origLog/origError/origWarn) haciéndolo EPIPE-safe.
 *
 * Orden y garantías (gap-closure Phase 66, flood infinito bajo `brew services`):
 *   1. pushLog SIEMPRE primero — el buffer in-memory de /logs no depende de que el
 *      write a stdout/stderr tenga éxito, así que /logs sigue mostrando la línea aun
 *      con el pipe roto.
 *   2. La llamada al writer original va en try/catch que TRAGA el error (EPIPE bajo
 *      launchd cuando el pipe de stdout/stderr se rompe). Crítico: en el fallo NO se
 *      intenta loguear nada — reescribir en el pipe roto es justo lo que recursa y
 *      auto-sostiene el bucle "Broken pipe, errno 32".
 *
 * En un TTY (foreground `kodo start`, tests) el writer nunca lanza → comportamiento
 * byte-idéntico al patch previo (UP-06). Exportado para poder testear el swallow con
 * un writer stub que tira EPIPE, sin abrir un pipe real.
 *
 * @param {'info'|'error'|'warn'} level
 * @param {(...args: any[]) => void} origWriter
 * @returns {(...args: any[]) => void}
 */
function makeSafeConsoleWriter(level, origWriter) {
  return (...args) => {
    pushLog(level, args);
    try {
      origWriter(...args);
    } catch {
      // Swallow (EPIPE u otro write error). NO re-loguear: eso reescribiría en el
      // mismo pipe roto y produciría el bucle de flood que este fix elimina.
    }
  };
}

// Patch console to capture logs (only if not already patched)
if (!console.log.__kodo_patched) {
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.log = makeSafeConsoleWriter('info', origLog);
  console.error = makeSafeConsoleWriter('error', origError);
  console.warn = makeSafeConsoleWriter('warn', origWarn);
  console.log.__kodo_patched = true;
}

function dashboardHtml(token) {
  // WR-02: the token is interpolated into an inline <script>. The auto-generated
  // token is 64-char lowercase hex (safe), but an operator-set KODO_API_TOKEN from
  // ~/.kodo/.env may carry quotes or `</script>`. JSON.stringify escapes quotes and
  // backslashes; replacing `<` with the < escape neutralizes a `</script>`
  // breakout from inside the string literal (defense-in-depth; no behavior change
  // for hex tokens).
  const tokenJs = JSON.stringify(String(token)).replace(/</g, '\\u003c');
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
  .log-line { font-size: 11px; padding: 3px 0; color: #888; font-family: inherit; white-space: pre-wrap; word-break: break-all; }
  .log-line.error { color: #ef4444; }
  .log-line.warn { color: #f59e0b; }
  .log-ts { color: #444; margin-right: 8px; }
  .logs-box { max-height: 280px; overflow-y: auto; background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 4px; padding: 8px; }
  .comments-box { margin-top: 8px; padding: 8px; background: #0a0a0a; border-left: 2px solid #222; font-size: 11px; max-height: 200px; overflow-y: auto; }
  .comment { padding: 4px 0; border-bottom: 1px dashed #1a1a1a; }
  .comment:last-child { border-bottom: none; }
  .comment-actor { color: #f59e0b; font-weight: 600; }
  .comment-time { color: #444; font-size: 10px; margin-left: 6px; }
  .comment-text { color: #999; margin-top: 2px; }
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
  <div class="card full">
    <h2>Logs del servidor</h2>
    <div class="subtitle">Últimas 200 entradas (más recientes arriba)</div>
    <div id="logs" class="logs-box"><div class="empty">Cargando...</div></div>
  </div>
</div>
<div class="update-time" id="updated"></div>

<script>
// NET-02 / D-05: the bearer token bound ONCE, injected from the served route (which
// only runs after the ?token= guard validated it). authedFetch adds the Authorization
// header to every same-origin API call so the four dashboard fetches cross the bearer
// guard. PERSIST-04: the token lives only here (and in the request headers) — it is
// never rendered as visible page text.
const TOKEN = ${tokenJs};
function authedFetch(url, opts) {
  const o = opts || {};
  return fetch(url, { ...o, headers: { ...(o.headers || {}), Authorization: 'Bearer ' + TOKEN } });
}

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

// T-48-10 (OPEN-03 paridad HTML): allowlist http(s) sobre el task_url ANTES de renderlo como
// href clickable. escapeHtml NO neutraliza \`javascript:\`/\`data:\` (no contienen & < > " '), así que
// sin este guard un task_url con esquema hostil ejecutaría script al click — el mismo vector que el
// carril TUI (open.js) ya bloquea. Espejo exacto de la allowlist de open.js. Devuelve la url segura
// o null. URL es global del navegador (este script corre client-side).
function safeHref(url) {
  try {
    var p = new URL(url);
    return (p.protocol === 'http:' || p.protocol === 'https:') ? url : null;
  } catch (e) {
    return null;
  }
}

// Helper compartido para el ref clickable de las 3 superficies (sessions/pending/history): aplica
// safeHref + escapeHtml + rel="noopener noreferrer" (anti reverse-tabnabbing en target="_blank"),
// con fallback a <span> de texto plano cuando la url es ausente o de esquema no permitido.
function refAnchor(url, ref) {
  var safe = safeHref(url);
  return safe
    ? '<a class="ref" href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(ref) + '</a>'
    : '<span class="ref">' + escapeHtml(ref) + '</span>';
}

async function deleteSession(taskId, ref) {
  if (!confirm('¿Eliminar sesión ' + ref + ' del state?')) return;
  await authedFetch('/sessions/' + encodeURIComponent(taskId), { method: 'DELETE' });
  refresh();
}

async function toggleComments(taskId, btnEl) {
  const boxId = 'comments-' + taskId;
  let box = document.getElementById(boxId);
  if (box) { box.remove(); btnEl.textContent = 'Comentarios'; return; }
  btnEl.textContent = 'Cargando...';
  try {
    const res = await authedFetch('/comments/' + encodeURIComponent(taskId));
    const data = await res.json();
    const comments = data.comments || [];
    box = document.createElement('div');
    box.id = boxId;
    box.className = 'comments-box';
    if (data.supported === false) {
      // D-08/D-09: paridad con el overlay ink — distinguir "provider sin soporte" de "sin comentarios".
      box.innerHTML = '<div class="empty">Comentarios no soportados por este provider</div>';
    } else if (!comments.length) {
      box.innerHTML = '<div class="empty">Sin comentarios</div>';
    } else {
      box.innerHTML = comments.map((c) => (
        '<div class="comment">' +
          '<span class="comment-actor">' + escapeHtml(c.actor) + '</span>' +
          '<span class="comment-time">' + ago(c.created_at) + '</span>' +
          '<div class="comment-text">' + escapeHtml(c.text).slice(0, 500) + '</div>' +
        '</div>'
      )).join('');
    }
    btnEl.closest('.session, .history-item').appendChild(box);
    btnEl.textContent = 'Ocultar';
  } catch (e) {
    btnEl.textContent = 'Error';
  }
}

function renderSession(s) {
  var displayStatus = s.status;
  if (!s.alive && s.status === 'running') displayStatus = 'dead';
  if (s.alive && s.status === 'running' && s.elapsed_min > 30) displayStatus = 'idle';
  var refLink = refAnchor(s.task_url, s.task_ref);
  return '<div class="session">' +
    '<div class="row-spread">' +
      '<div class="row">' + refLink + ' <span class="badge badge-' + displayStatus + '">' + displayStatus + '</span></div>' +
      '<span class="meta">' + s.elapsed_min + 'min · ' + s.workspace_ref + '</span>' +
    '</div>' +
    '<div class="title">' + escapeHtml(s.summary) + '</div>' +
    '<div class="actions">' +
      '<button class="btn" onclick="toggleComments(\\''+ escapeHtml(s.task_id) +'\\', this)">Comentarios</button>' +
      '<button class="btn btn-danger" onclick="deleteSession(\\''+ escapeHtml(s.task_id) +'\\', \\''+ escapeHtml(s.task_ref) +'\\')">Eliminar</button>' +
    '</div>' +
  '</div>';
}

function renderLogs(logs) {
  if (!logs.length) return '<div class="empty">Sin logs</div>';
  return logs.map((l) => {
    const ts = new Date(l.ts).toLocaleTimeString();
    return '<div class="log-line ' + l.level + '"><span class="log-ts">' + ts + '</span>' + escapeHtml(l.msg) + '</div>';
  }).join('');
}

async function refreshLogs() {
  try {
    const res = await authedFetch('/logs');
    const data = await res.json();
    document.getElementById('logs').innerHTML = renderLogs(data.logs || []);
  } catch {}
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
            // OPEN-04 / D-08: a work item with an unresolved identifier carries no url
            // (normalizeWorkItem suppresses it) — refAnchor renders the ref as plain text
            // rather than a dead <a href=""> anchor, and gates the protocol (T-48-10).
            refAnchor(t.url, t.ref) +
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
    var refLink = refAnchor(s.task_url, s.task_ref);
    return '<div class="history-item">' +
      '<div class="row-spread">' +
        '<div class="row">' + refLink + ' <span class="badge badge-done">cerrada</span></div>' +
        '<span class="meta">' + durMin + 'min · ' + ago(s.ended_at || s.started_at) + '</span>' +
      '</div>' +
      '<div class="title">' + escapeHtml(s.summary) + '</div>' +
      '<div class="actions">' +
        '<button class="btn" onclick="toggleComments(\\''+ escapeHtml(s.task_id) +'\\', this)">Comentarios</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function refresh() {
  try {
    const res = await authedFetch('/status');
    const data = await res.json();

    const m = data.metrics || {};
    document.getElementById('stats').innerHTML =
      '<div class="stat"><div class="stat-val">' + data.count + '</div><div class="stat-label">Activas</div></div>' +
      '<div class="stat"><div class="stat-val">' + data.pending_count + '</div><div class="stat-label">Candidatas</div></div>' +
      '<div class="stat"><div class="stat-val">' + (m.closed_24h || 0) + '</div><div class="stat-label">Hoy</div></div>' +
      '<div class="stat"><div class="stat-val">' + (m.closed_7d || 0) + '</div><div class="stat-label">7 días</div></div>' +
      '<div class="stat"><div class="stat-val">' + (m.avg_duration_min || 0) + 'm</div><div class="stat-label">Duración media</div></div>' +
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
refreshLogs();
setInterval(refresh, 5000);
setInterval(refreshLogs, 5000);
</script>
</body>
</html>`;
}

/**
 * Read raw body from incoming HTTP request, bounded at MAX_BODY_BYTES (NET-03).
 *
 * A body over the cap is rejected with an Error carrying `code:'PAYLOAD_TOO_LARGE'`
 * and the socket is destroyed to stop buffering — an unauthenticated attacker must
 * not be able to force megabytes of RAM behind auth/HMAC (T-69-03, D-06). The cap is
 * enforced twice: an early `content-length` short-circuit, and a running byte tally
 * on the `data` stream (a lying/absent content-length still can't overflow). Bodies
 * within the cap resolve `Buffer.concat(chunks).toString()` BYTE-IDENTICAL to before
 * — critical for the webhook HMAC, which signs the raw bytes (Pitfall 4).
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    let total = 0;

    const rejectTooLarge = () => {
      if (settled) return;
      settled = true;
      // Drain-and-discard the rest of the upload (memory stays bounded — we stop
      // accumulating, the DoS goal) rather than req.destroy(). Destroying the socket
      // mid-upload would surface to the client as a connection reset instead of the
      // clean 413 the caller is about to write; resuming lets the client finish its
      // send and read the 413 (Pitfall: undici reports 'fetch failed' on a reset).
      req.resume();
      reject(Object.assign(new Error('payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
    };

    req.on('data', (chunk) => {
      if (settled) return; // already over cap — discard further bytes, don't grow memory
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        rejectTooLarge();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    // Early reject on an honest oversized content-length (never reads the body).
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) rejectTooLarge();
  });
}

/**
 * Start the webhook server.
 *
 * Two modes gated by `opts.managed` (default falsy = legacy `kodo start`, byte-identical):
 * - Legacy (`managed` falsy): returns the raw `http.Server`; writes `server.pid`;
 *   `process.exit(1)` on misconfig; installs its own SIGTERM/SIGINT cleanup.
 * - Managed (`managed:true`, D-03): returns `{ server, stopReconcile }`; THROWS
 *   `{ code:'KODO_SETUP_REQUIRED' }` on missing secret (no `process.exit` — run.js
 *   handles it); rejects `{ code:'EADDRINUSE' }` on port collision via
 *   `server.on('error')`; writes NO PID; installs NO signal handlers (run.js owns
 *   the exit — D-05, single-owner teardown).
 *
 * `_loadConfig` / `_provider` are an optional DI seam (mirror
 * isReportToProviderEnabled(_loadConfig) config.js:233) so the managed path is
 * unit-testable offline (no real `provider.init()` network hit).
 *
 * @param {{ port?: number, insecure?: boolean, managed?: boolean,
 *   _loadConfig?: () => any, _provider?: any }} [opts]
 * @returns {Promise<import('node:http').Server | { server: import('node:http').Server, stopReconcile: () => void }>}
 */
export async function startServer(opts = {}) {
  const loadConfigFn = opts._loadConfig || loadConfig;
  const config = loadConfigFn();
  const port = opts.port || config.server.port;
  // NET-01 (T-69-01): bind to loopback by default. A missing bind keeps migrated
  // v0.15 configs safe — exposing on a LAN interface is an explicit opt-in via
  // config.server.bind. WR-04: an empty/whitespace string is treated as ABSENT,
  // not passed through — `server.listen(port, '')` silently binds 0.0.0.0 (all
  // interfaces), the exact LAN exposure NET-01 exists to prevent.
  const rawBind = config.server.bind;
  const host = (typeof rawBind === 'string' && rawBind.trim()) ? rawBind.trim() : '127.0.0.1';

  let provider;
  if (opts._provider) {
    provider = opts._provider;
  } else {
    await initRegistry();
    provider = getProvider(config.provider);
  }
  await provider.init();

  // Phase 40 (Plan 02, PSTATE-04): ONE provider_state resolver for the whole server
  // lifetime (NOT per-request — avoids NDJSON file churn and keeps the task_id cache
  // + in-flight dedup shared across polls). Logger uses the same synthetic 'reconcile'
  // sessionId the reconcile loop does, child component 'provider-state'. TTL reuses the
  // existing PENDING_CACHE_TTL_MS constant (D-02 — no second number). The resolver is
  // a read-only lane: it never writes state.json and never touches alive/elapsed_min.
  const { createLogger: createProviderStateLogger } = await import('./logger.js');
  const providerStateLogger = createProviderStateLogger({
    sessionId: 'reconcile',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'provider-state' });
  const providerStateResolver = createProviderStateResolver({
    provider,
    logger: providerStateLogger,
    ttlMs: PENDING_CACHE_TTL_MS,
    now: Date.now,
  });

  // Phase 42 (Plan 01, DISMISS-01/DISMISS-04): ONE dismiss handler for the whole
  // server lifetime (NOT per-request — mirrors the providerStateResolver wiring).
  // Real loadState/executeFn are defaulted inside the factory; we only inject a
  // server-lifetime logger child for the SESSION_DISMISSED aggregate audit event.
  const dismissLogger = createProviderStateLogger({
    sessionId: 'reconcile',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'dismiss' });
  const dismissHandler = createDismissHandler({ logger: dismissLogger });

  // Webhook secret check — provider-specific env var with legacy fallback
  const secretEnv = `KODO_WEBHOOK_SECRET_${config.provider.toUpperCase()}`;
  const webhookSecret = process.env[secretEnv] || process.env.PLANE_WEBHOOK_SECRET;

  if (process.env.PLANE_WEBHOOK_SECRET && !process.env[secretEnv]) {
    console.warn(`[kodo] Deprecation: use ${secretEnv} instead of PLANE_WEBHOOK_SECRET`);
  }

  if (!webhookSecret && !opts.insecure && !process.env.KODO_DEV) {
    // Point 1 (D-03): managed does NOT exit the process — it throws a discriminated
    // error that run.js catches (Phase 65: log+clean exit; Phase 68: setup mode).
    // The throw carries only a code + generic message — never the secret value (T-65-06).
    if (opts.managed) {
      throw Object.assign(new Error('missing webhook secret'), { code: 'KODO_SETUP_REQUIRED' });
    }
    console.error(`[kodo] Missing webhook secret. Set ${secretEnv} or use --insecure / KODO_DEV=1`);
    process.exit(1);
  }

  // NET-02 (D-02/D-04): obtain the bearer secret — auto-generate + 0600-persist on
  // first boot. getOrCreateApiToken throws { code:'KODO_TOKEN_WRITE_FAILED' } if the
  // persist fails; let it propagate (never start with auth silently disabled). The
  // value never leaves this closure — only a compare against the request token.
  const TOKEN = getOrCreateApiToken();

  const handleRequest = async (req, res) => {
    // NET-02 (Pitfall 2): parse the URL ONCE. A `?token=` on the HTML routes makes
    // req.url become '/?token=...', which no exact `req.url === '/x'` comparison would
    // match — so every route decision below keys off `pathname`, never raw req.url.
    // CR-01: parse defensively — Node's HTTP parser accepts request targets that
    // WHATWG-URL rejects (e.g. absolute-form `GET http://[ HTTP/1.1`), so an
    // unguarded `new URL()` threw synchronously inside the async handler →
    // unhandled rejection → daemon crash, PRE-auth. Malformed target ⇒ neutral 400.
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
      return;
    }
    const { pathname, searchParams } = parsedUrl;

    // NET-02 default-deny guard (D-04, fail-closed): every route except the OPEN
    // allowlist (GET /health, POST /webhook) requires a valid bearer BEFORE any route
    // branch runs. The two HTML routes read the candidate from ?token= (a browser
    // navigation cannot send an Authorization header, D-05); every other route reads
    // it from the Authorization header. A future route with no explicit branch stays
    // protected. Neutral 401 body — never leak err detail or the HTML shell.
    if (!isOpenRoute(req.method, pathname)) {
      const isHtmlRoute = req.method === 'GET' && (pathname === '/' || pathname === '/dashboard');
      const candidate = isHtmlRoute
        ? searchParams.get('token')
        : parseBearer(req.headers['authorization']);
      if (!timingSafeTokenEqual(candidate, TOKEN)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    if (req.method === 'GET' && pathname === '/status') {
      const sessions = listSessions();
      let pending = [];
      if (Date.now() - pendingCache.ts < PENDING_CACHE_TTL_MS) {
        pending = pendingCache.data;
      } else {
        try {
          pending = await provider.listPendingTasks();
          pendingCache = { data: pending, ts: Date.now() };
        } catch (err) {
          console.warn(`[kodo] listPendingTasks failed: ${err.message}`);
          pending = pendingCache.data;
        }
      }

      // Enrich sessions with elapsed_min + provider_state. `alive` is the authoritative
      // value written by reconcileTick into state.json (única fuente de verdad, D-04);
      // it pasa-through vía `...s`, NO se recomputa aquí.
      //
      // Phase 40 (PSTATE-04, D-05/D-06/D-07): provider_state + provider_state_reason are
      // a READ-ONLY carril — never written to state.json, never coupled to alive/elapsed_min.
      // Per-row fail-open via Promise.allSettled (NEVER Promise.all): one row's getTaskState
      // failure must not 500 the whole /status response. The resolver collapses failures to
      // {state:null, reason:'fetch-failed'} itself, so settled rows are always fulfilled;
      // the allSettled guard is belt-and-suspenders against any unexpected throw. No third
      // `supported` boolean — `provider_state_reason === 'unsupported'` derives it (D-07).
      const settled = await Promise.allSettled(
        sessions.map(async (s) => {
          const { state, reason } = await providerStateResolver.resolve(s);
          return {
            ...s,
            elapsed_min: Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60000),
            provider_state: state,
            provider_state_reason: reason,
          };
        }),
      );
      const enriched = settled.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : {
              ...sessions[i],
              elapsed_min: Math.floor((Date.now() - new Date(sessions[i].started_at).getTime()) / 60000),
              provider_state: null,
              provider_state_reason: 'fetch-failed',
            },
      );

      const fullHistory = listHistory();
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const last24h = fullHistory.filter((s) => s.ended_at && now - new Date(s.ended_at).getTime() < dayMs);
      const last7d = fullHistory.filter((s) => s.ended_at && now - new Date(s.ended_at).getTime() < 7 * dayMs);
      const durations = fullHistory
        .filter((s) => s.ended_at && s.started_at)
        .map((s) => (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000);
      const avgMin = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      const totalMin = Math.round(durations.reduce((a, b) => a + b, 0));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessions: enriched,
        count: enriched.length,
        pending: pending.map((t) => ({ ref: t.ref, title: t.title, url: t.url, state: t.state, projectName: t.projectName })),
        pending_count: pending.length,
        history: fullHistory.slice(0, 10),
        metrics: {
          total_closed: fullHistory.length,
          closed_24h: last24h.length,
          closed_7d: last7d.length,
          avg_duration_min: avgMin,
          total_duration_min: totalMin,
        },
        uptime: process.uptime(),
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: getLogBuffer() }));
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/comments/')) {
      // WR-01: decodeURIComponent throws URIError on malformed percent-encoding
      // (e.g. /comments/%zz). Guarded decode → neutral 400 instead of an escaped
      // throw (the CR-01 outer boundary is the backstop; 400 is the right semantics).
      let taskId;
      try {
        taskId = decodeURIComponent(pathname.slice('/comments/'.length));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }
      try {
        const session = listSessions().find((s) => s.task_id === taskId)
          || listHistory().find((s) => s.task_id === taskId);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }
        // D-07 (TUI-15): `supported` es un campo ADITIVO byte-compatible. Distingue
        // "este provider no implementa listComments" (supported:false, estado PERMANENTE)
        // de "la tarea no tiene comentarios aún" (supported:true + comments:[], TRANSITORIO).
        // Clientes viejos ignoran `supported` (invariante v0.9: respuestas JSON aditivas).
        // NO se crea endpoint nuevo — solo cambia la shape de la respuesta 200.
        const supported = typeof provider.listComments === 'function';
        const comments = supported
          ? await provider.listComments({ id: session.task_id, projectId: session.project_id })
          : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ comments, supported }));
      } catch (err) {
        // NET-04 (D-09): the thrown message may carry internal detail (DB errors,
        // stack fragments). Log it (ring buffer + stderr) but return a fixed neutral
        // body — never echo err.message to an external client (T-69-05).
        console.error(`[kodo] /comments error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
      return;
    }

    if (req.method === 'DELETE' && pathname.startsWith('/sessions/')) {
      // Phase 42 (DISMISS-01): thin adapter over the pure dismiss handler. The
      // handler does the 409 alive guard (authoritative TOCTOU re-check, D-07/D-08),
      // delegates sanitization to doctor.execute({taskId, fix:true}), and synthesizes
      // the actions[] body. decodeURIComponent is RETAINED (T-39-01 path-traversal
      // control, symmetric to the client's encodeURIComponent). dismiss is
      // never-throws by construction — no try/catch needed here.
      // WR-01: same guarded decode as /comments/ — malformed %-encoding ⇒ 400.
      let taskId;
      try {
        taskId = decodeURIComponent(pathname.slice('/sessions/'.length));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }
      // WR-02: rechazar antes de llegar al handler si el segmento está vacío
      // (p.ej. DELETE /sessions/ desde curl o cliente externo).
      if (!taskId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing session id' }));
        return;
      }
      const { status, body } = await dismissHandler(taskId);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method === 'POST' && pathname === '/orchestrator') {
      // Resuelve el `workspace:N` del orquestador (workspace cmux `kodo-orchestrator`) para
      // que la TUI lo enfoque (tecla `O`). Bearer-gated (default-deny: NO en isOpenRoute).
      // RESOLVE-ONLY (D-decisión operador): NO lanza el orquestador. Lanzarlo requiere una
      // TTY (launchOrchestrator vía `kodo orchestrate`/`check`); el daemon detached no puede
      // crear workspaces cmux de forma fiable. Si el orquestador no está corriendo →
      // `workspace_ref: null` y la TUI muestra el hint "run kodo orchestrate".
      //
      // Resuelve LEYENDO el ref persistido en ~/.kodo/orchestrator.json (readOrchestratorRef),
      // NO consultando cmux en vivo: `cmux workspace list` es window-scoped (limitación P-4) y
      // el daemon detached vive en otro window, así que jamás vería el ref. launchOrchestrator
      // (que corre con TTY en el window correcto) escribe ese fichero al lanzar/refrescar.
      // never-throws → 500 neutral; el detalle solo al log (NET-04, simétrico a /comments).
      try {
        const { readOrchestratorRef } = await import('./orchestrator/launch.js');
        const ref = readOrchestratorRef();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workspace_ref: ref, existing: ref != null }));
      } catch (err) {
        console.error(`[kodo] /orchestrator error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'internal error' }));
      }
      return;
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(dashboardHtml(TOKEN));
      return;
    }

    if (req.method === 'POST' && pathname === '/webhook') {
      try {
        const rawBody = await readBody(req);
        console.log(`[kodo] Webhook received: ${rawBody.slice(0, 200)}`);
        const result = await handleWebhookRequest(rawBody, req.headers, provider);
        console.log(`[kodo] Webhook result: ${JSON.stringify(result)}`);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        // NET-03 (D-06): an oversized body is rejected by readBody BEFORE
        // handleWebhookRequest runs, so this 413 is emitted PRE-HMAC — an
        // unauthenticated attacker cannot force >1 MB of buffering behind auth.
        if (err && err.code === 'PAYLOAD_TOO_LARGE') {
          // readBody drains the remaining upload so the client cleanly reads this 413.
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload too large' }));
          return;
        }
        console.error(`[kodo] Bad request: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };

  // CR-01: top-level error boundary. Any synchronous throw or rejected await that
  // escapes a route branch becomes a neutral 500 instead of an unhandled rejection
  // that kills the long-lived daemon (Node default --unhandled-rejections=throw).
  // NET-04 hygiene: err.message goes to the log only, never to the response body.
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      console.error(`[kodo] unhandled handler error: ${err?.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        res.end();
      }
    }
  });

  if (opts.managed) {
    // Points 2 + 3 (D-03): register 'error' BEFORE listen so EADDRINUSE surfaces as
    // a typed reject (today there is NO handler \u2192 EADDRINUSE is an uncaught exception,
    // Pitfall 3/4). Wrap listen in a Promise that resolves on 'listening', rejects on
    // 'error'. And SKIP writeFileSync(PID_PATH) \u2014 the daemon owns kodo.pid (D-04).
    await new Promise((resolveListen, rejectListen) => {
      const onError = (err) => {
        server.removeListener('error', onError);
        if (err && err.code === 'EADDRINUSE') {
          rejectListen(Object.assign(new Error(`port ${port} already in use`), { code: 'EADDRINUSE' }));
        } else {
          rejectListen(err);
        }
      };
      server.on('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        console.log(`[kodo] Server listening on :${port}`);
        console.log(`[kodo] Webhook URL: http://localhost:${port}/webhook`);
        console.log(`[kodo] Status URL: http://localhost:${port}/status`);

        // Point 3: managed skips its own server.pid (daemon owns kodo.pid).

        if (process.env.CMUX_WORKSPACE_ID) {
          cmux.rename({ workspace: process.env.CMUX_WORKSPACE_ID, title: '\u5FC3\u52D5 kodo service' }).catch(() => {});
          cmux.setColor({ workspace: process.env.CMUX_WORKSPACE_ID, color: 'Indigo' }).catch(() => {});
        }
        resolveListen(undefined);
      });
    });
  } else {
    server.listen(port, host, () => {
      console.log(`[kodo] Server listening on :${port}`);
      console.log(`[kodo] Webhook URL: http://localhost:${port}/webhook`);
      console.log(`[kodo] Status URL: http://localhost:${port}/status`);

      writeFileSync(PID_PATH, String(process.pid));

      if (process.env.CMUX_WORKSPACE_ID) {
        cmux.rename({ workspace: process.env.CMUX_WORKSPACE_ID, title: '\u5FC3\u52D5 kodo service' }).catch(() => {});
        cmux.setColor({ workspace: process.env.CMUX_WORKSPACE_ID, color: 'Indigo' }).catch(() => {});
      }
    });
  }

  // Phase 38 (Plan 04, D-07): loop de reconciliación host↔state. Vive en el
  // proceso server. Phase 70 (Plan 02, D-04): state.json tiene MÚLTIPLES
  // escritores (hooks, CLI, dispatcher y este loop de reconcile), NO uno solo —
  // todos serializados por `withStateLock` (el lock O_EXCL sobre state.json.lock)
  // que re-lee el estado fresco bajo el lock antes de mutar+guardar, así ninguna
  // escritura cross-proceso pisa a otra. El dashboard sigue siendo un cliente
  // HTTP read-only de /status: NO escribe state.json. Este tick consulta el
  // WorkspaceHost, aplica transiciones con debouncing 2-tick, rescata sesiones
  // desde history cuya tab sigue viva (cierra ROMAN-151/152) y sella las dead
  // viejas a closed. never-throws; .unref() para no bloquear el cierre.
  const { getHost } = await import('./host/interface.js');
  const { startReconcileLoop } = await import('./session/reconcile.js');
  const { createLogger } = await import('./logger.js');
  // createLogger exige un sessionId (lo usa como nombre del NDJSON). El server es
  // un proceso de servicio de larga vida, no una sesión — usamos un id sintético
  // estable ('reconcile') → ~/.kodo/logs/reconcile.ndjson. NO un sessionId real.
  const reconcileLogger = createLogger({
    sessionId: 'reconcile',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'reconcile' });
  const stopReconcile = startReconcileLoop({
    host: getHost('cmux'),
    loadState,
    saveState,
    // Phase 70 Plan 02: el save del tick participa del MISMO state lock que los
    // mutators (withStateLock) — así reconcile y los hooks/CLI/dispatcher no se
    // pisan. El lock envuelve SOLO la derivación+save (sub-ms); la snapshot del
    // host (listWorkspaces/pgrep) queda fuera (Pitfall 1).
    withStateLock: runUnderStateLock,
    logger: reconcileLogger,
  });

  // Point 4 (D-05): managed installs NO self SIGTERM/SIGINT handlers and does NOT
  // own the exit. run.js is the single owner — it composes { server, stopReconcile }
  // into its own teardown. Two owners = double teardown / race (Pitfall 4).
  if (opts.managed) {
    return { server, stopReconcile };
  }

  const cleanup = () => {
    try { stopReconcile(); } catch {}
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

export { PID_PATH, makeSafeConsoleWriter, getLogBuffer };
