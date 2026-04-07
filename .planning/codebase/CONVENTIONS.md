# Coding Conventions

**Analysis Date:** 2026-04-07

## Naming Patterns

**Files:**
- Kebab-case for JS modules: `session-manager.js`, `plane-client.js`, `color-utils.js`
- Directory structure uses kebab-case: `src/cmux/`, `src/plane/`, `src/session/`
- Test files match source file names with `.test.js` suffix: `state.test.js`, `labels.test.js`

**Functions:**
- camelCase for exported functions and methods: `parseKodoLabels()`, `loadConfig()`, `launchWorkItem()`
- camelCase for private helper functions: `stripHtml()`, `escapeShell()`, `detectIdle()`
- Functions that manage state use action verbs: `addSession()`, `removeSession()`, `updateSession()`
- Async functions use clear naming: `checkHealth()`, `launchWorkItem()`, `listWorkspaces()`

**Variables:**
- camelCase for local variables: `projectPath`, `workspaceRef`, `config`, `sessionId`
- snake_case for API/Plane data model fields: `plane_id`, `plane_identifier`, `project_id`, `workspace_ref`, `started_at`
- Constant collections use UPPERCASE: `KODO_DIR`, `CONFIG_PATH`, `STATE_PATH`, `PID_PATH`
- URL/HTTP path constants: `'/projects/'`, `'/work-items/'` (snake_case matching API)

**Types (JSDoc):**
- `@param` and `@returns` use JSDoc type annotations throughout
- Type object literals documented with `@typedef`: see `src/session/state.js` for `Session` and `State` types
- Optional fields in JSDoc use pipe union: `@param {string|null}`, `@returns {Promise<HealthReport[]>}`

## Code Style

**Formatting:**
- 2-space indentation (standard JavaScript)
- No trailing semicolons (modern JS style)
- Consistent use of quotes: double quotes for strings, template literals for interpolation
- Max line length is practical (160+ characters seen in use)

**Linting:**
- No linting configuration detected (`.eslintrc*`, `biome.json` not present)
- JSDoc type checking enabled via `// @ts-check` comment at file top
- Each source file begins with `// @ts-check` for TypeScript checking in JSDoc environment

**Error Handling:**
- Direct Error construction: `throw new Error('message')`
- Error messages include context: `throw new Error(\`Plane API ${res.status}: ${path} — ${text}\`)`
- Async operations wrapped in try-catch where appropriate
- Silent failures with `.catch(() => {})` used only for non-critical operations (notifications, optional workspace detection)

## Import Organization

**Order:**
1. Node.js built-in modules: `import { readFileSync } from 'node:fs'`
2. External packages: `import { Command } from 'commander'`
3. Relative imports from same package: `import { loadConfig } from '../config.js'`
4. Namespace imports for multi-export modules: `import * as cmux from '../cmux/client.js'`

**Path Aliases:**
- No path aliases configured
- All relative paths use standard `../` notation
- Cross-module imports go through explicit relative paths

**File Extensions:**
- All imports include `.js` extension (required for ES modules)
- Consistent across all files

## Error Handling

**Patterns:**

**API Errors (PlaneClient):**
```javascript
// src/plane/client.js
if (!res.ok) {
  const text = await res.text().catch(() => '');
  throw new Error(`Plane API ${res.status}: ${path} — ${text}`);
}
```

**Missing Configuration:**
```javascript
// src/plane/client.js
if (!this.apiKey) {
  throw new Error(`Plane API key not found. Set ${config.plane.api_key_env} env var.`);
}
```

**Process Errors (child_process):**
```javascript
// src/cmux/client.js
execFile(getCmuxBinary(), args, { timeout: 15_000 }, (err, stdout, stderr) => {
  if (err) {
    reject(new Error(`cmux ${args[0]} failed: ${stderr || err.message}`));
    return;
  }
  resolve(stdout.trim());
});
```

**File I/O:**
```javascript
// src/config.js
export function loadConfig() {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

**Graceful Degradation:**
```javascript
// src/check.js
const healthReports = await checkHealth().catch(() => []);
// Errors return empty array rather than crashing
```

## Logging

**Framework:** Native `console` object (no logger library)

**Patterns:**

**Prefix Convention:**
All logs use `[scope]` prefix for filtering and context:
- `[kodo]` — main server/webhook handler
- `[kodo:check]` — health check runner
- `[kodo:health]` — health evaluation
- `[kodo:idle]` — session idle detection

**Log Levels:**
```javascript
// Info/status
console.log(`[kodo] Server listening on :${port}`);
console.log(`[kodo] Received: ${event}.${action} — ${data.name}`);

// Warnings
console.warn('[kodo] Warning: PLANE_WEBHOOK_SECRET not set');

// Errors
console.error(`[kodo] Error: ${err.message}`);
console.error(`[kodo] Webhook handler error: ${err.message}`);
```

**When to Log:**
- Server startup/shutdown: `[kodo] Server listening`
- Webhook events: `[kodo] Received: issue.updated`
- Business logic decisions: `[kodo] Session already running`, `[kodo] Ignored: no kodo label`
- Errors: Always logged with context
- Health checks: Status before/after actions

## Comments

**When to Comment:**
- Minimal inline comments; code is self-documenting
- Block comments explain *why*, not *what* (e.g., "Why we use timingSafeEqual instead of ===")
- Algorithm explanations only for non-obvious logic

**Style:**
```javascript
// Single-line comment for brief explanations
// Wrap at column width for readability

// Multi-line explanations use // on each line:
// 1. First reason
// 2. Second reason
```

**JSDoc/TSDoc:**
- **Required for:** All exported functions, classes, and public methods
- **Format:** Standard JSDoc with `@param`, `@returns`, `@throws` where applicable
- **Example:**
```javascript
/**
 * Verify HMAC-SHA256 signature from Plane webhook
 * @param {string} payload
 * @param {string} signature
 * @param {string} secret
 * @returns {boolean}
 */
function verifySignature(payload, signature, secret) {
```

**Type Documentation:**
```javascript
/**
 * @typedef {{
 *   workspace_ref: string,
 *   session_id: string,
 *   plane_id: string,
 *   status: 'running'|'done'|'error'|'review',
 *   started_at: string,
 * }} Session
 */
```

## Function Design

**Size:** 
- Most functions 10-40 lines (pragmatic size, not dogmatic)
- Larger functions (50+ lines) used only for initialization/setup sequences
- Example: `launchWorkItem()` is 85 lines because it orchestrates multiple steps sequentially

**Parameters:**
- Positional parameters for required arguments: `function verifySignature(payload, signature, secret)`
- Object parameters for optional/configuration: `function launchWorkItem(identifier, opts = {})`
- Destructuring used in parameter unpacking: `const { name } = opts`

**Return Values:**
- Explicit return types in JSDoc: `@returns {Promise<Session>}`
- Union types for possible values: `@returns {Session|null}`
- Async functions always return Promises: `async function checkHealth() => Promise<HealthReport[]>`
- Functions returning no meaningful value omit `@returns` or use `@returns {void}`

**Async Pattern:**
```javascript
// Functions that call async operations are themselves async
export async function launchWorkItem(identifier, opts = {}) {
  const { project, workItem } = await plane.resolveIdentifier(identifier);
  // ...
}
```

## Module Design

**Exports:**
- Each file exports 1-3 related functions: `src/labels.js` exports `parseKodoLabels()` and `resolveLabels()`
- Utilities that are imported elsewhere live in their own file: `src/config.js`, `src/plane/client.js`
- Classes exported as default or named: `export class PlaneClient {}`
- Functions exported as named exports: `export function loadConfig() {}`

**Organization:**
```
src/
├── cli.js                    # CLI command definitions
├── server.js                 # HTTP webhook handler
├── config.js                 # Config/projects I/O
├── labels.js                 # Label parsing utilities
├── check.js                  # Health check orchestrator
├── plane/                    # Plane API client
│   └── client.js             # PlaneClient class
├── cmux/                     # cmux integration
│   ├── client.js             # Command execution
│   └── colors.js             # Color mapping
├── session/                  # Session state & lifecycle
│   ├── state.js              # Session CRUD operations
│   ├── manager.js            # Launch/orchestration logic
│   └── health.js             # Health check implementation
├── hooks/                    # Claude Code hooks
│   ├── install.js
│   ├── session-start.js
│   └── stop.js
└── orchestrator/             # Orchestrator launch
    └── launch.js
```

**No Barrel Files:**
- No `index.js` files re-exporting from sibling modules
- Direct imports: `import { PlaneClient } from './plane/client.js'` (not `'./plane'`)

**State Management:**
- Mutable state persisted to JSON files: `~/.kodo/state.json`, `~/.kodo/config.json`
- In-memory state during runtime via `loadState()`/`saveState()` cycle
- Functions always `loadState()` fresh from disk before mutations

## Console Output

**User-Facing Messages:**
- Use checkmarks for success: `console.log(\`✓ Orchestrator launched\`)`
- Use cross for failure: `console.log(\`✗ API key no está configurada\`)`
- Status indicators: `[kodo]` prefix for all console output

**Configuration Output:**
```javascript
// Interactive prompts are clear and multi-line
console.log(`  Workspace slug [${config.plane.workspace_slug}]: `);
// JSON pretty-printed for inspection
console.log('Config:', JSON.stringify(config, null, 2));
```

---

*Convention analysis: 2026-04-07*
