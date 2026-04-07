# Technology Stack

**Analysis Date:** 2026-04-07

## Languages

**Primary:**
- JavaScript (ES2020+) - Node.js 20+ — All source code in `src/`, CLI, server, clients
- JSDoc + TypeScript comments (`@ts-check`) - Type hints without TypeScript compilation

**Secondary:**
- Markdown - Documentation and skill files in `skills/`

## Runtime

**Environment:**
- Node.js 20.0.0+ (specified in `package.json` engines field)

**Package Manager:**
- npm 10.x - Standard package management
- Lockfile: `package-lock.json` present and up-to-date

## Frameworks & Core Libraries

**HTTP Server:**
- Built-in `node:http` module - Lightweight webhook server in `src/server.js`

**CLI Framework:**
- Commander.js v13.0.0 - Command-line interface with subcommands in `src/cli.js`

**Built-in Node APIs Used:**
- `node:crypto` - HMAC-SHA256 signature verification for Plane webhooks
- `node:fs` - File operations for config, state, and PID management
- `node:path` - Path resolution and manipulation
- `node:os` - Home directory detection
- `node:child_process` - Execute external cmux and Claude binaries
- `node:test` - Native test runner (Node 18+)
- `node:assert/strict` - Assertion library for tests

## Key Dependencies

**Production:**
- `commander@^13.0.0` - Command-line argument parsing and subcommand routing

**Zero External Runtime Dependencies** - This is intentional. All network communication (Plane API, cmux CLI) uses Node built-ins.

## Configuration

**Files:**
- `~/.kodo/config.json` - Main configuration (Plane URL, workspace slug, thresholds, paths)
- `~/.kodo/projects.json` - Project ID → local filesystem path mappings
- `~/.kodo/.env` - Environment variables (PLANE_API_KEY, PLANE_WEBHOOK_SECRET)
- `~/.kodo/state.json` - Active session tracking (workspace references, IDs, timestamps)
- `~/.kodo/server.pid` - PID file for server lifecycle management

**Default Configuration:**
```javascript
{
  plane: {
    base_url: 'https://tasks.kintsugi-lab.com',
    api_key_env: 'PLANE_API_KEY',
    workspace_slug: 'k-lab',
    trigger_state: 'In Progress',
    done_state: 'Done',
    review_state: 'In review',
  },
  cmux: {
    binary: '/Applications/cmux.app/Contents/Resources/bin/cmux',
    colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' }
  },
  claude: {
    binary: '/Applications/cmux.app/Contents/Resources/bin/claude',
    default_model: 'opus',
    max_parallel: 3,
    flags: []
  },
  server: {
    port: 9090,
    idle_threshold_min: 5,
    stuck_threshold_min: 30
  }
}
```

**Environment Variables:**
- `PLANE_API_KEY` - API token for Plane REST API authentication (required)
- `PLANE_WEBHOOK_SECRET` - HMAC secret for webhook signature verification (optional but recommended)
- `CMUX_WORKSPACE_ID` - Set by cmux when running inside a workspace (internal use)

## Binaries & External Tools

**Required:**
- `cmux` - Terminal multiplexer for workspace management. Path configured in `config.json`
- `claude` - Claude Code CLI. Path configured in `config.json`

**Optional:**
- `npm` - For installation and testing

## API Integration Methods

**Plane API:**
- REST API v1 at `{base_url}/api/v1/workspaces/{workspace_slug}`
- Authentication: `X-API-Key` header
- Timeout: 10 seconds per request (via `AbortSignal.timeout(10_000)`)
- See `src/plane/client.js` for endpoint list

**cmux CLI:**
- Subprocess execution via `node:child_process.execFile()`
- Commands: `new-workspace`, `send`, `read-screen`, `workspace-action`, `list-workspaces`, `notify`, `rename`
- Timeout: 15 seconds per invocation
- See `src/cmux/client.js` for wrapper functions

**Claude Code CLI:**
- Invoked via command string in cmux workspace
- Models: `opus`, `sonnet`, `haiku` (selected via `--model` flag)
- Custom flags passed from Plane labels (e.g., `--dangerously-skip-permissions`)

## Platform Requirements

**Development:**
- macOS with cmux installed (`/Applications/cmux.app/`)
- Claude Code CLI available
- Node.js 20.0.0+
- Git for version control and auto-commits via hooks

**Production / Deployment:**
- Server mode: Any Unix-like system with Node.js 20.0.0+
- Webhook listener: Accessible IP + port 9090 (configurable)
- Plane workspace connectivity (REST API)
- cmux CLI and Claude CLI installed on target system
- Tailscale or network access from Plane webhook source to webhook server

## Testing Framework

**Test Runner:**
- `node:test` - Native Node.js test runner (no external dependency)

**Assertion Library:**
- `node:assert/strict` - Strict equality assertions

**Test Files:**
- `test/labels.test.js` - Label parsing logic
- `test/state.test.js` - Session state management

**Run Tests:**
```bash
npm test
```

## Build & Distribution

**Executable:**
- `bin/kodo` - Shebang entry point that imports `src/cli.js`
- Installed globally via `npm link` during setup

**Package Metadata:**
- Version: 0.1.0
- License: MIT
- Bin entry: `"kodo": "./bin/kodo"`
- Type: `"module"` (ES modules only, no CommonJS)

## Security Considerations

**Credential Handling:**
- API keys loaded from `~/.kodo/.env` (single-instance, never logged)
- Webhook signature verification using HMAC-SHA256 (timing-safe comparison)
- Secrets environment variables recommended but not enforced

**Session Management:**
- Session state stored locally in `~/.kodo/state.json` (readable by user only)
- No tokens stored in state — only session references and metadata
- PID file for server lifecycle prevents orphaned processes

---

*Stack analysis: 2026-04-07*
