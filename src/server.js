// @ts-check
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, KODO_DIR } from './config.js';
import { initRegistry, getProvider } from './providers/registry.js';
import { listSessions, listHistory, removeSession, loadState, saveState, updateSession, runUnderStateLock, getOrchestrator } from './session/state.js';
import { handleWebhookRequest } from './triggers/webhook.js';
import { createProviderStateResolver } from './server/provider-state.js';
import { createPendingResolver, buildPendingStatusFields } from './tasks/pending.js';
import { createDismissHandler } from './server/dismiss.js';
import { parseBearer, timingSafeTokenEqual, isOpenRoute, getOrCreateApiToken, MAX_BODY_BYTES } from './server/auth.js';
import * as cmux from './cmux/client.js';

const PID_PATH = join(KODO_DIR, 'server.pid');

// Ring buffer for recent server logs (last 200 lines)
const LOG_BUFFER_SIZE = 200;
const logBuffer = [];

// Cache for pending tasks (avoid hitting Plane API every dashboard poll). The cache
// itself now lives in the createPendingResolver closure (src/tasks/pending.js); this
// constant remains the ONLY source of the TTL literal (D-03).
const PENDING_CACHE_TTL_MS = 30 * 1000;

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
 * ¿Puede el daemon marcar como suyo el workspace del que arranca?
 *
 * Puro / never-throws. Responde `false` SOLO cuando hay evidencia de que ese workspace
 * es el del orquestador. Sin `workspaceId` no hay nada que marcar; sin registro (o con
 * un registro sin UUID) no hay evidencia y se permite marcar.
 *
 * KODO-16 — el motivo de existir de este guard: el branding renombra el workspace a
 * `心動 kodo service`. Cuando el daemon se reinicia DESDE la tab del orquestador
 * (`kodo stop && kodo up` lanzado ahí dentro), ese rename le borraba el nombre
 * `kodo-orchestrator` y lo dejaba huérfano: el siguiente `kodo check` no lo reconocía y
 * lanzaba un duplicado. El registro en state.json ya blinda la DETECCIÓN, pero pisar el
 * nombre del supervisor sigue siendo mentira en el sidebar y rompe el fallback por
 * título — así que no se hace.
 *
 * Segundo guard, `underTest`: la suite arranca servers de verdad (server-bind,
 * server-managed…) y esos procesos HEREDAN el CMUX_WORKSPACE_ID del shell del
 * operador. Sin este guard, `npm test` renombra el workspace real desde el que se
 * lanza — verificado en vivo mientras se arreglaba KODO-16: la tab de la propia
 * sesión de trabajo acabó titulada `心動 kodo service`. Un test no puede tener ese
 * efecto sobre el entorno de quien lo corre, y para el orquestador es justo el
 * accidente que lo huerfanizaba.
 *
 * Tercer guard, `sessions`: el mismo accidente que huerfanizaba al orquestador le ocurre
 * a una sesión de tarea cuando el daemon arranca desde SU tab (`kodo up` tecleado ahí
 * dentro). La tab acaba titulada `心動 kodo service` y la sesión pierde su identidad en
 * el sidebar — y si luego se adopta, la tarea nace con ese título (ocurrió: KODO-8 se
 * llama literalmente `心動 kodo service`). Una sesión viva nunca es el workspace del
 * servicio, así que su ref/id bloquea el branding igual que el del orquestador.
 *
 * @param {string|undefined|null} workspaceId - CMUX_WORKSPACE_ID del proceso (UUID).
 * @param {{ workspace_ref?: string, workspace_id?: string|null }|null|undefined} orchestrator
 *   Registro del orquestador (state.json `.orchestrator`), o null si no consta.
 * @param {boolean} [underTest] - true bajo el test runner de Node (`NODE_TEST_CONTEXT`).
 * @param {Array<{ workspace_ref?: string, workspace_id?: string|null }>} [sessions]
 *   Sesiones activas (state.json `.sessions`). Vacío/ausente = no hay evidencia y no bloquea.
 * @returns {boolean}
 */
export function shouldBrandWorkspace(workspaceId, orchestrator, underTest = false, sessions = []) {
  if (!workspaceId) return false;
  if (underTest) return false;
  // Se comparan AMBOS campos: CMUX_WORKSPACE_ID es hoy el UUID, pero comparar también
  // el ref cuesta nada y cubre un host que exportara `workspace:N` en su lugar.
  const claims = (rec) =>
    Boolean(rec) &&
    ((rec.workspace_id && rec.workspace_id === workspaceId) ||
      (rec.workspace_ref && rec.workspace_ref === workspaceId));
  if (claims(orchestrator)) return false;
  if (Array.isArray(sessions) && sessions.some(claims)) return false;
  return true;
}

/**
 * Marca el workspace del daemon (rename + color) si el guard lo permite.
 * never-throws — el branding es cosmético y jamás debe tumbar el arranque del server.
 */
function brandServiceWorkspace() {
  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  let orchestrator = null;
  let sessions = [];
  try {
    orchestrator = getOrchestrator();
  } catch {
    /* fail-open: sin registro legible, el guard decide con lo que hay */
  }
  try {
    sessions = listSessions();
  } catch {
    /* fail-open: idem — sin sesiones legibles el guard degrada al comportamiento previo */
  }
  if (!shouldBrandWorkspace(workspaceId, orchestrator, Boolean(process.env.NODE_TEST_CONTEXT), sessions)) return;
  cmux.rename({ workspace: workspaceId, title: '\u5FC3\u52D5 kodo service' }).catch(() => {});
  cmux.setColor({ workspace: workspaceId, color: 'Indigo' }).catch(() => {});
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

  // Phase 76 (Plan 02, ORCH-05/ORCH-06): ONE pending resolver for the whole server
  // lifetime — the converged read lane shared with check.js (src/tasks/pending.js).
  // Same shape as the providerStateResolver sibling, reusing the PENDING_CACHE_TTL_MS
  // literal (D-03 — no second number). resolve() NEVER throws: a provider outage past
  // the TTL is LABELED stale, never served as fresh (ORCH-06). The resolver does not
  // log; the /status caller inspects `stale` and emits the trace (D-02 / Pitfall 1).
  const pendingResolver = createPendingResolver({
    listPendingTasksFn: () => provider.listPendingTasks(),
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
    // NET-02 (Pitfall 2): parse the URL ONCE. A query string makes req.url become
    // '/x?...', which no exact `req.url === '/x'` comparison would match — so every
    // route decision below keys off `pathname`, never raw req.url.
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
    const { pathname } = parsedUrl;

    // NET-02 default-deny guard (D-04, fail-closed): every route except the OPEN
    // allowlist (GET /health, POST /webhook) requires a valid bearer BEFORE any route
    // branch runs, read from the Authorization header. A future route with no explicit
    // branch stays protected. Neutral 401 body — never leak err detail.
    if (!isOpenRoute(req.method, pathname)) {
      const candidate = parseBearer(req.headers['authorization']);
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
      // Phase 76 (ORCH-05/ORCH-06): the converged pending read lane. The resolver never
      // throws; a stale result (TTL expired + provider down) is LABELED, not served as
      // fresh. The warn is generic — no payload, no err.message (D-02 / Pitfall 1 / T-76-01).
      const pendingResult = await pendingResolver.resolve();
      if (pendingResult.stale) console.warn('[kodo] listPendingTasks stale — serving last-known-good');
      const pendingFields = buildPendingStatusFields(pendingResult);

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
        ...pendingFields,
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

        brandServiceWorkspace(); // KODO-16: no pisa el workspace del orquestador
        resolveListen(undefined);
      });
    });
  } else {
    server.listen(port, host, () => {
      console.log(`[kodo] Server listening on :${port}`);
      console.log(`[kodo] Webhook URL: http://localhost:${port}/webhook`);
      console.log(`[kodo] Status URL: http://localhost:${port}/status`);

      writeFileSync(PID_PATH, String(process.pid));

      brandServiceWorkspace(); // KODO-16: no pisa el workspace del orquestador
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

  // KODO-11: barrido de sesiones huérfanas. Consume justo lo que produce el loop de
  // arriba (la transición a `dead`) y le añade lo que ese loop no puede hacer por ser
  // puro: avisar al provider. Cubre el ~15% de sesiones que mueren sin disparar
  // `SessionEnd` — y por tanto sin el backstop de review — dejando la tarea en «In
  // Progress» sin un solo comentario. Loop propio (cadencia de minutos, no de 2.5 s)
  // en vez de un paso dentro de `reconcileTick`: ese tick es PURO y sin I/O de red por
  // contrato, y el sweep es exclusivamente I/O de red.
  const { startOrphanSweepLoop } = await import('./session/orphan-sweep.js');
  const orphanSweepLogger = createLogger({
    sessionId: 'reconcile',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'orphan-sweep' });
  const stopOrphanSweep = startOrphanSweepLoop({
    loadStateFn: loadState,
    // `updateSession` ya serializa por `withStateLock` internamente — el sweep escribe
    // solo su marca de idempotencia, jamás campos del ciclo de vida (`alive`/`state`
    // siguen siendo propiedad exclusiva de reconcileTick, D-04).
    updateSessionFn: updateSession,
    provider,
    logger: orphanSweepLogger,
  });

  // Teardown ÚNICO de ambos loops bajo la clave `stopReconcile` que run.js ya compone
  // (Point 4/D-05: un solo dueño del exit). Renombrar la clave rompería ese contrato.
  const stopLoops = () => {
    try { stopReconcile(); } catch {}
    try { stopOrphanSweep(); } catch {}
  };

  // Point 4 (D-05): managed installs NO self SIGTERM/SIGINT handlers and does NOT
  // own the exit. run.js is the single owner — it composes { server, stopReconcile }
  // into its own teardown. Two owners = double teardown / race (Pitfall 4).
  if (opts.managed) {
    return { server, stopReconcile: stopLoops };
  }

  const cleanup = () => {
    try { stopLoops(); } catch {}
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
