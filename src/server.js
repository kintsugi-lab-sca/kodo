// @ts-check
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, loadProjects, KODO_DIR } from './config.js';
import { PlaneClient } from './plane/client.js';
import * as cmux from './cmux/client.js';
import { colorForStatus } from './cmux/colors.js';
import { addSession, listSessions, removeSession } from './session/state.js';
import { launchWorkItem } from './session/manager.js';

const PID_PATH = join(KODO_DIR, 'server.pid');

/**
 * Verify HMAC-SHA256 signature from Plane webhook
 * @param {string} payload
 * @param {string} signature
 * @param {string} secret
 * @returns {boolean}
 */
function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Parse JSON body from incoming request
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
 * Handle incoming Plane webhook
 * @param {object} payload
 */
async function handleWebhook(payload) {
  const event = payload.event;

  // We care about work item state changes
  if (event !== 'issue' && event !== 'work_item') {
    console.log(`[kodo] Ignored event: ${event}`);
    return;
  }

  const action = payload.action; // "created", "updated"
  const data = payload.data || payload.issue || payload.work_item;

  if (!data) {
    console.log('[kodo] No data in webhook payload');
    return;
  }

  console.log(`[kodo] Received: ${event}.${action} — ${data.name || data.id}`);

  // Check if state changed to trigger state ("In Progress")
  const config = loadConfig();
  const stateName = data.state?.name || data.state_detail?.name || data.state__name;

  if (action === 'updated' && stateName === config.plane.trigger_state) {
    await handleTriggerState(data, config);
  }
}

/**
 * @param {object} data
 * @param {ReturnType<import('./config.js').loadConfig>} config
 */
async function handleTriggerState(data, config) {
  const projectId = (typeof data.project === 'object' ? data.project?.id : data.project) || data.project_detail?.id;
  if (!projectId) {
    console.log('[kodo] No project ID in webhook data');
    return;
  }

  // Find project identifier to build the KL-42 style reference
  let identifier;
  try {
    const plane = new PlaneClient();
    const projects = await plane.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) {
      console.log(`[kodo] Unknown project: ${projectId}`);
      return;
    }
    identifier = `${project.identifier}-${data.sequence_id}`;
  } catch (err) {
    console.error(`[kodo] Error resolving project: ${err.message}`);
    return;
  }

  // Check if already running — but verify workspace still exists
  const active = listSessions();
  const existing = active.find((s) => s.plane_id === data.id);
  if (existing) {
    try {
      const workspaces = await cmux.listWorkspaces();
      if (workspaces.includes(existing.workspace_ref)) {
        console.log(`[kodo] Session already running for ${identifier}`);
        return;
      }
      // Workspace gone — clean up stale session
      console.log(`[kodo] Stale session for ${identifier} — workspace gone, relaunching`);
      removeSession(data.id);
    } catch {
      removeSession(data.id);
    }
  }

  console.log(`[kodo] Launching session for ${identifier}: ${data.name}`);

  try {
    const session = await launchWorkItem(identifier);
    console.log(`[kodo] ✓ Launched ${identifier} → ${session.workspace_ref}`);
  } catch (err) {
    console.error(`[kodo] Error launching ${identifier}: ${err.message}`);

    await cmux.notify({
      title: `kodo: Error`,
      body: `Failed to launch ${identifier}: ${err.message}`,
    }).catch(() => {});
  }
}

/**
 * Start the webhook server
 * @param {{ port?: number }} [opts]
 */
export function startServer(opts = {}) {
  const config = loadConfig();
  const port = opts.port || config.server.port;
  const webhookSecret = process.env.PLANE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[kodo] Warning: PLANE_WEBHOOK_SECRET not set — signature verification disabled');
  }

  const server = createServer(async (req, res) => {
    // CORS / health
    if (req.method === 'GET' && req.url === '/status') {
      const sessions = listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions, count: sessions.length }));
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook') {
      try {
        const body = await readBody(req);

        // Verify signature if secret is configured
        if (webhookSecret) {
          const signature = /** @type {string} */ (
            req.headers['x-plane-signature'] || req.headers['x-webhook-signature'] || ''
          );
          if (!verifySignature(body, signature, webhookSecret)) {
            console.warn('[kodo] Invalid webhook signature');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid signature' }));
            return;
          }
        }

        const payload = JSON.parse(body);
        // Respond immediately, process async
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));

        // Process webhook asynchronously
        handleWebhook(payload).catch((err) => {
          console.error(`[kodo] Webhook handler error: ${err.message}`);
        });
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

    // Write PID file for stop command
    writeFileSync(PID_PATH, String(process.pid));
  });

  // Cleanup on exit
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
