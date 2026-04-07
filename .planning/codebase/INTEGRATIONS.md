# External Integrations

**Analysis Date:** 2026-04-07

## APIs & External Services

**Plane (Project Management):**
- Service: Plane CE (https://tasks.kintsugi-lab.com by default, configurable)
- What it's used for: Task/work item tracking, webhook events, labels, project structure
- SDK/Client: Custom REST client in `src/plane/client.js` (no external SDK)
- Auth: API token via `X-API-Key` header
- Env var: `PLANE_API_KEY` (required)

**Endpoints used:**
- `GET /projects/` — List all projects
- `GET /projects/{id}/states/` — Get workflow states
- `GET /projects/{id}/work-items/` — List/search work items
- `GET /projects/{id}/work-items/{id}/` — Get single work item details
- `PATCH /projects/{id}/work-items/{id}/` — Update work item state
- `GET /projects/{id}/modules/` — List module structure
- `GET /projects/{id}/modules/{id}/module-issues/` — Find work item in module
- `GET /projects/{id}/labels/` — List available labels
- `POST /projects/{id}/work-items/{id}/comments/` — Add comments to task

**Known API Quirks:**
- Filtering with `label_ids` or `state_groups` parameters returns 403 Forbidden — fetch full list and filter in-memory
- Labels have distinct UUIDs per project despite same name ("kodo" in different projects = different IDs)
- Search endpoint does not filter by labels effectively
- See `skills/kodo-orchestrate/skill.md` for learned behaviors

## Webhooks & Event Sources

**Incoming:**
- **Plane Webhooks** — POST to `http://{ip}:9090/webhook`
  - Triggers: Work item state changes (event types: `work_item`, `issue`)
  - Actions: `created`, `updated`
  - Payload verification: HMAC-SHA256 signature in `X-Plane-Signature` or `X-Webhook-Signature` header
  - Processing: Filtered by `kodo` label presence, state change to "In Progress"
  - Location: `src/server.js` handles webhook validation and routing

**Outgoing (via cmux):**
- **Desktop Notifications** — System notifications when session starts/stops/fails
- **Claude Code MCP Calls** — Session-start hook calls Plane MCP to update task context
- **State Comments** — Stop hook updates work item with session summary before state transition

## Authentication & Identity

**Auth Method:**
- API Key based (Plane)
- HMAC-SHA256 verification (Plane webhooks)
- No OAuth or SSO integration

**Where Secrets Stored:**
- `~/.kodo/.env` — Plain text file with `PLANE_API_KEY` and `PLANE_WEBHOOK_SECRET`
- Never logged or included in state files
- Loaded at startup via `src/config.js` — `loadEnvFile()`

**Token Lifecycle:**
- Tokens never expire within a session (Plane API key is static)
- No refresh mechanism — if key changes, update `.env` and restart server

## Webhooks Configuration

**Server Endpoint:**
- **URL**: `http://{tailscale-ip}:9090/webhook`
- **Port**: 9090 (configurable via `config.json` or CLI)
- **Health check**: `GET http://localhost:9090/health` — returns JSON with uptime
- **Status endpoint**: `GET http://localhost:9090/status` — lists active sessions

**Webhook Registration in Plane:**
- Settings → Webhooks → Add webhook
- Events: "Work Items" (covers both creation and updates)
- Secret: Must match `PLANE_WEBHOOK_SECRET` env var for signature verification

**Signature Verification:**
- Algorithm: HMAC-SHA256
- Key: `PLANE_WEBHOOK_SECRET` from `~/.kodo/.env`
- Message: Raw request body (before JSON parsing)
- Header: `X-Plane-Signature` or `X-Webhook-Signature`
- Implementation: `src/server.js` — `verifySignature()` with timing-safe comparison

## Session Management & State

**State Store:**
- File: `~/.kodo/state.json`
- Format: JSON with `sessions` object keyed by Plane work item ID
- Tracking fields: `workspace_ref`, `session_id`, `plane_id`, `plane_identifier`, `project_id`, `summary`, `status`, `started_at`, `project_path`
- Lifecycle: Session added on launch, updated on health checks, removed on completion or workspace cleanup

**Session States:**
- `running` — Claude Code session active in cmux workspace
- `review` — Session ended, waiting for review/approval before moving to "Done"
- `completed` — Task moved to done state in Plane

## Data Storage

**Databases:**
- Not used. All state is file-based JSON.

**File Storage:**
- Local filesystem only — project files live in paths mapped via `~/.kodo/projects.json`
- Workspace content stored in cmux sessions (ephemeral)

**Caching:**
- Project list cached during operation (refreshed on each check)
- Configuration cached in memory (requires server restart to reload)

## Monitoring & Observability

**Error Tracking:**
- Not integrated with external service
- Errors logged to stdout/stderr in kodo server and CLI
- Session health errors documented in skill `skills/kodo-orchestrate/skill.md`

**Logs:**
- **Server logs**: Printed to terminal when `kodo start` runs — includes webhook events, session launches
- **Health checks**: `kodo check` or periodic health loop prints status to stdout
- **Session logs**: Visible in cmux workspace screen, readable via `cmux read-screen`

**Health Monitoring:**
- Periodic checks every 60 seconds (configurable via `src/session/health.js`)
- Detects "gone" (workspace closed), "stuck" (>30min no progress), "idle" (5min at prompt)
- Thresholds configurable in `config.json`:
  - `idle_threshold_min`: 5 (minutes before idle alert)
  - `stuck_threshold_min`: 30 (minutes before stuck alert)

## CI/CD & Deployment

**Hosting:**
- Not a hosted service — CLI binary + server process
- Intended for macOS development environment (cmux for terminal multiplexing)
- Can run on any Unix with Node.js 20+, cmux, and Claude CLI

**Installation / Deployment:**
```bash
git clone <repo>
npm install
npm link           # Makes 'kodo' globally available
kodo config        # Interactive setup
kodo install       # Register Claude Code hooks
kodo start         # Start webhook server
```

**Server Lifecycle:**
- PID file: `~/.kodo/server.pid` — prevents duplicate servers
- Graceful shutdown: SIGTERM/SIGINT handlers clean up PID file
- Status check: `kodo status` lists active sessions
- Stop: `kodo stop` kills process via PID

**Automatic Hooks:**
- Claude Code **SessionStart** hook (`src/hooks/session-start.js`) — injects task context
- Claude Code **Stop** hook (`src/hooks/stop.js`) — updates task state in Plane, moves to review

## Integration Points Summary

```
┌─────────────────────────────────────────────────────────────┐
│                      kodo Bridge                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Plane (webhook)  ←→  kodo server (:9090)  ←→  cmux CLI     │
│     API calls      ←→  PlaneClient         ←→  Workspaces   │
│   (comments,        ←→  State store         ←→  Claude Code  │
│    state updates)   ←→  Health checks       ←→  (subprocess) │
│                     ←→  Config store                         │
│                                                               │
│  Claude Code hooks (SessionStart, Stop) update Plane         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Environment Configuration

**Required Environment Variables:**
- `PLANE_API_KEY` — API token from Plane profile settings

**Optional Environment Variables:**
- `PLANE_WEBHOOK_SECRET` — HMAC secret (highly recommended)
- All other config via `~/.kodo/config.json` (JSON format)

**Configuration Paths:**
- Base: `~/.kodo/` directory
- Config: `~/.kodo/config.json`
- Projects: `~/.kodo/projects.json`
- State: `~/.kodo/state.json`
- Secrets: `~/.kodo/.env`

**Setting Configuration:**
```bash
kodo config --show                           # View current config
kodo config --set plane.base_url=https://... # Update single value
kodo config --map-project projectId:/path    # Map Plane project to disk
```

---

*Integration audit: 2026-04-07*
