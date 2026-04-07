# Architecture

**Analysis Date:** 2026-04-07

## Pattern Overview

**Overall:** Event-driven bridge architecture with three independent subsystems: Plane webhook consumer, session orchestrator, and health monitor.

**Key Characteristics:**
- Decoupled components communicating through state files and external APIs
- Stateless HTTP server responding to webhooks
- Async session launching without blocking webhook handler
- Two-tier monitoring: lightweight health checker (no LLM) + intelligent orchestrator (LLM-based)
- Hooks injected into Claude Code to provide context and capture completion events

## Layers

**Webhook Ingress Layer:**
- Purpose: Receive Plane webhooks, verify signatures, parse events, dispatch to session launcher
- Location: `src/server.js`
- Contains: HTTP server, HMAC-SHA256 signature verification, event filtering
- Depends on: `PlaneClient`, `session/manager.js`, `labels.js`
- Used by: External Plane instance via webhook POST to `:9090/webhook`

**Session Management Layer:**
- Purpose: Resolve work items, check capacity, create cmux workspaces, launch Claude processes
- Location: `src/session/manager.js`
- Contains: Work item → Claude command builder, capacity checks, workspace creation
- Depends on: `PlaneClient`, `cmux/client.js`, `session/state.js`
- Used by: Webhook handler, manual launch command, orchestrator

**State Persistence Layer:**
- Purpose: Track active sessions across process restarts, enable state queries
- Location: `src/session/state.js`
- Contains: JSON-based session store (`~/.kodo/state.json`) with read/write/query operations
- Depends on: File system
- Used by: Session manager, health checker, CLI status command, orchestrator

**Health Monitoring Layer:**
- Purpose: Detect workspace lifecycle changes, idle/stuck sessions, trigger escalation
- Location: `src/session/health.js`
- Contains: Session status classification (healthy/idle/stuck/gone), screen output analysis
- Depends on: `cmux/client.js`, configuration thresholds
- Used by: `check.js` command

**Configuration Layer:**
- Purpose: Load Plane/cmux credentials, project mappings, behavioral thresholds
- Location: `src/config.js`
- Contains: Config loader, project mapping resolver, environment variable loader (`~/.kodo/.env`)
- Depends on: File system, environment
- Used by: All layers

**Integration Clients:**
- Plane API client: `src/plane/client.js` — REST wrapper for work items, projects, states, comments, labels
- cmux CLI wrapper: `src/cmux/client.js` — Exec wrapper for workspace creation, screen reading, notifications
- Label parser: `src/labels.js` — Parse `kodo`, `kodo:sonnet`, `kodo:haiku`, `kodo:yolo` labels

**Claude Code Hooks:**
- SessionStart: `src/hooks/session-start.js` — Injects Plane context and documentation instructions
- Stop: `src/hooks/stop.js` — Moves task to "In Review", documents completion, triggers orchestrator
- Install/uninstall: `src/hooks/install.js` — Registers hooks in `~/.claude/settings.json`

**Orchestrator:**
- Purpose: Intelligent supervisor for multi-session coordination, task queueing, decision making
- Location: `src/orchestrator/launch.js` + `src/orchestrator/prompt.md`
- Contains: Session context builder, Claude prompt injection, workspace management
- Depends on: Session state, Plane client, cmux client
- Used by: Health checker when action needed, manual invocation

**CLI Interface:**
- Purpose: User commands for setup, launching, monitoring, orchestration
- Location: `src/cli.js`
- Contains: Command definitions (config, start, stop, check, launch, status, orchestrate, install)
- Depends on: All subsystems
- Entry point: `bin/kodo` (Node.js script using Commander)

## Data Flow

**Webhook → Session Launch:**

1. Plane work item moves to trigger state (e.g., "In Progress")
2. Plane posts webhook to `POST /webhook`
3. `server.js` verifies HMAC signature
4. Parses payload, checks for `kodo` label via `labels.js`
5. If labeled: calls `launchWorkItem(identifier)`
6. `manager.js` resolves identifier → project/work item via `PlaneClient`
7. Checks parallel session limit
8. Creates cmux workspace with project path
9. Builds Claude command with work item context and prompt
10. Sends command to workspace, writes to `state.json`
11. Returns 200 to webhook immediately (async processing)

**Health Check Cycle:**

1. `kodo check` invoked (CLI or cron)
2. `check.js` calls `checkHealth()` (reads `state.json`, lists cmux workspaces, samples screens)
3. Classifies each session: healthy/idle/stuck/gone
4. Cleans up gone sessions, reports stuck
5. Counts pending kodo tasks in Plane (if API key available)
6. If any action needed: calls `launchOrchestrator()`
7. Orchestrator Claude session reads state, evaluates, takes action
8. Orchestrator session ends → stop hook auto-commits skill updates

**Claude Session Lifecycle:**

1. Claude starts in cmux workspace, receives SessionStart hook
2. Hook reads `state.json`, finds session by working directory, injects context
3. Claude works and documents progress in Plane via MCP
4. User closes session (Ctrl+C, `/exit`, or tab close)
5. Stop hook triggers: reads last screen output, posts completion comment, moves task to "In Review"
6. Orchestrator (if running) gets nudge to re-evaluate

**State Management:**

- **Running State**: JSON file `~/.kodo/state.json` with session records keyed by Plane work item ID
- **Session Record**: Contains workspace ref, session ID, plane metadata, status, timestamps, project path
- **Status Transitions**: `running` → `review` (stop hook) → `done` (orchestrator decision) or stays `running`
- **No database**: Pure file-based, allows session recovery across machine reboots

## Key Abstractions

**PlaneClient (`src/plane/client.js`):**
- Purpose: Encapsulate Plane REST API details
- Examples: `resolveIdentifier("KL-42")`, `getWorkItem()`, `updateWorkItem()`, `createComment()`, `listProjects()`
- Pattern: Fetch wrapper with timeout, error handling, path templating

**Session State (`src/session/state.js`):**
- Purpose: Abstract session storage and querying
- Examples: `addSession()`, `listSessions()`, `findSession({ cwd, workspaceRef })`
- Pattern: Functional API, no class instantiation, `loadState()` → read `state.json`, `saveState()` → write

**Configuration (`src/config.js`):**
- Purpose: Single source of truth for settings and mappings
- Examples: `loadConfig()`, `loadProjects()`, `getPlaneApiKey()`
- Pattern: Lazy loading with defaults, dot-notation `setNestedValue()` for CLI updates

**Label Parsing (`src/labels.js`):**
- Purpose: Interpret kodo label directives
- Examples: `parseKodoLabels(labels)` → `{ isKodo, model, flags }`
- Pattern: Pure function, handles both object and string label formats

**cmux Wrapper (`src/cmux/client.js`):**
- Purpose: Abstract CLI tool invocation
- Examples: `newWorkspace()`, `send()`, `readScreen()`, `setColor()`, `notify()`
- Pattern: Promisified execFile, timeout handling, stdout parsing

## Entry Points

**`bin/kodo`:**
- Location: `bin/kodo` (Node.js shebang script)
- Triggers: Direct CLI invocation (`kodo config`, `kodo start`, etc.)
- Responsibilities: Argument parsing, command routing to `src/cli.js`

**`src/server.js` HTTP Server:**
- Location: Exports `startServer()` function
- Triggers: `kodo start` command, also runs during daemon mode
- Responsibilities: Listen on `:9090`, parse webhook, dispatch to `launchWorkItem()`

**`src/session/manager.js` Launch Function:**
- Location: `launchWorkItem(identifier, opts)`
- Triggers: Webhook handler, `kodo launch` command, orchestrator task queue
- Responsibilities: Resolve work item, check slots, create workspace, build Claude command, track session

**`src/check.js` Health Check:**
- Location: `runCheck()` / `runCheckAndAct()`
- Triggers: `kodo check` command, cron/loop automation
- Responsibilities: Detect health issues, optionally launch orchestrator

**Claude Code SessionStart Hook:**
- Location: `src/hooks/session-start.js`
- Triggers: Claude Code startup in a tracked project directory
- Responsibilities: Inject Plane work item context via hook output JSON

**Claude Code Stop Hook:**
- Location: `src/hooks/stop.js`
- Triggers: Claude Code session closes (any exit method)
- Responsibilities: Post completion comment, update Plane state, signal orchestrator

## Error Handling

**Strategy:** Graceful degradation with logging and fallback behavior. No throwing from webhook handler — always respond 200.

**Patterns:**

- **Webhook Errors**: Parse errors → 400; Signature mismatch → 401; Processing errors → log async, respond 200
- **API Timeouts**: 10-second abort signal on all Plane API calls; cmux commands timeout at 15 seconds
- **Missing Config**: Load defaults on first run; prompt user to fill in via `kodo config`
- **Stale Sessions**: Detect workspace gone → clean from state; detect stuck → notify orchestrator
- **Hook Failures**: SessionStart/Stop hooks catch all exceptions, never crash Claude Code

## Cross-Cutting Concerns

**Logging:** Console output with `[kodo]` prefix for server, `[kodo:check]` for health checks, `[kodo:orchestrator]` for orchestrator. No structured logs or files — stdout/stderr only.

**Validation:** 
- Identifier format: regex `^([A-Z]+)-(\d+)$` (e.g., KL-42)
- HMAC verification: timing-safe comparison
- Label names: case-insensitive `kodo`, `kodo:model`, `kodo:flag`
- Project mapping: path must exist on filesystem

**Authentication:**
- Plane API: Bearer token via `PLANE_API_KEY` env var (loaded from `~/.kodo/.env`)
- Webhook Secret: HMAC-SHA256 via `PLANE_WEBHOOK_SECRET` (optional but recommended)
- Claude Code: Authentication handled by cmux; kodo passes CLI flags transparently

**Concurrency:**
- State file: No locking, relies on atomic file writes (safe on local filesystem)
- Session limits: Enforced at launch time (`max_parallel` config)
- Workspace management: Parallel cmux commands allowed; list/create/delete are independent

**Information Flow:**
- Plane → kodo: Webhooks (push) + REST API queries (pull)
- kodo → Plane: Work item updates, comments (REST API POST/PATCH)
- kodo ↔ cmux: Bidirectional (send commands, read screens)
- kodo ↔ Claude Code: Via hooks (JSON in/out) and session state (file-based)
- kodo ↔ Orchestrator: Via state file and cmux send commands

---

*Architecture analysis: 2026-04-07*
