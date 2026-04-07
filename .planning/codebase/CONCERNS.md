# Codebase Concerns

**Analysis Date:** 2026-04-07

## Architecture & Design Issues

### 1. File-Based State Management - Race Condition Risk

**Issue:** All session state is persisted via synchronous file writes in `src/session/state.js`.

**Files:** 
- `src/session/state.js` (lines 25-76)
- `src/server.js` (lines 125-140)
- `src/session/health.js` (lines 39-94)

**Problem:** Multiple concurrent operations can corrupt state:
- Webhook handler (line 208 in `server.js`) processes async but writes state immediately
- Health checker runs every 60 seconds and modifies state
- If two operations read, modify, and write simultaneously, the last write wins and earlier changes are lost
- Example: Webhook thread modifies session while health checker is doing the same

**Impact:** 
- Lost session records (invisible sessions)
- Orphaned cmux workspaces
- Orchestrator loses visibility into active work
- Manual cleanup required periodically

**Fix approach:**
- Implement file locking with atomic writes (temp file + rename pattern)
- Use a lock file in `~/.kodo/state.lock` for exclusive access
- Or migrate to a database (SQLite/simple key-value store)
- Short term: Add delays between reads and writes to reduce collision window

---

### 2. Health Checker - False Positives in "Stuck" Detection

**Issue:** Session "stuck" detection is fragile and unreliable.

**Files:** `src/session/health.js` (lines 72-82, 128-140)

**Problem:**
- `detectIdle()` looks for prompt markers (`>`, `$`, `%`) but Claude's output varies widely
- Long-running legitimate work (research, complex analysis) can appear idle
- Shell prompts might not appear due to buffering or terminal state
- Threshold-based detection (30 minutes) is arbitrary and doesn't account for task complexity
- False positives cause unnecessary orchestrator launches, wasting tokens

**Patterns relying on fragile detection:**
```javascript
// Line 135-138: These patterns are too narrow
if (lastLine.startsWith('>') || lastLine.startsWith('$') || lastLine.startsWith('%')) return true;
if (lastLine.includes('What would you like to do?')) return true;
```

**Impact:**
- Legitimate long-running tasks flagged as stuck
- Orchestrator launched unnecessarily (token waste)
- False alarms in monitoring/logging
- Users distrust the monitoring system

**Fix approach:**
- Add cmux activity pulse tracking instead of screen parsing
- Implement real "no output for N minutes" detection via cmux event logs
- Increase stuck threshold or make it configurable per-task
- Add activity metadata to state (last keystroke, last output timestamp)

---

### 3. Plane API Label Resolution Complexity

**Issue:** Labels arrive in inconsistent formats from Plane webhook, causing brittle parsing.

**Files:** 
- `src/server.js` (lines 90-101)
- `src/labels.js` (lines 1-38, 40-61)
- `src/check.js` (lines 99-141)

**Problem:**
- Labels can be: objects with `name`, object with `id` only, or raw IDs
- No guarantee which format Plane sends (depends on API version, request params)
- Three separate places implement label resolution logic: server, check, labels
- If Plane changes response format, multiple places break
- `resolveLabels()` makes extra API calls only if labels are IDs (N+1 problem in check loop)

**Code duplication:**
```javascript
// Appears in server.js line 95-97 AND check.js line 129-131
const itemLabelIds = (item.labels || []).map((l) => (typeof l === 'object' ? l.id : l));
```

**Impact:**
- Kodo labels sometimes silently ignored (task not launched)
- Extra API calls when processing many tasks
- Hard to debug why a task wasn't picked up

**Fix approach:**
- Centralize label resolution in `PlaneClient` as a method
- Validate label format when received and normalize immediately
- Cache label ID→name mapping to avoid N+1 lookups
- Add logging when label resolution fails

---

## Error Handling & Resilience

### 4. Webhook Signature Verification Can Be Bypassed

**Issue:** HMAC verification is optional and silently disabled if env var not set.

**Files:** `src/server.js` (lines 164-168, 190-200)

**Problem:**
```javascript
if (!webhookSecret) {
  console.warn('[kodo] Warning: PLANE_WEBHOOK_SECRET not set — signature verification disabled');
}
```

If `PLANE_WEBHOOK_SECRET` is missing (typo, misconfiguration), webhook verification silently fails and all webhooks are accepted. An attacker on the same network can trigger arbitrary task launches.

**Impact:**
- High security risk in shared network environments (especially if exposed beyond Tailscale)
- Unauthenticated remote code execution potential
- Silent degradation — operators won't notice until logs are reviewed

**Fix approach:**
- Make webhook secret mandatory (fail at startup if missing)
- Add explicit confirmation in logs: `"Webhook signature verification: ENABLED"`
- Add a `/health` endpoint that reports security status

---

### 5. Insufficient Error Context in Plane API Failures

**Issue:** Plane API errors are caught broadly with minimal context.

**Files:**
- `src/server.js` (line 99-100, 120)
- `src/check.js` (lines 105-109, 135)
- `src/session/manager.js` (line 43-44)

**Examples:**
```javascript
// Line 43-44 in manager.js: silently swallows module resolution
try {
  moduleName = await plane.getWorkItemModule(project.id, workItem.id);
} catch {}  // <- completely silent

// Line 105-109 in check.js: skips entire projects
for (const projectId of config.plane.projects) {
  try { /* ... */ } catch { /* skip projects we can't access */ }
}
```

**Problem:**
- Temporary network issues are treated the same as permission errors
- Operator can't distinguish between "task not found" and "API rate limited"
- Silently skipped projects mean tasks are never launched
- Debugging requires checking logs for context

**Impact:**
- Silent failures: tasks marked kodo stay in backlog forever
- Impossible to know if a project access issue is temporary
- Monitoring blind spots

**Fix approach:**
- Categorize errors (404=not found, 403=permission, 5xx=transient, timeout)
- Log error categories with different severity levels
- Retry transient failures with exponential backoff
- Expose error stats via `/status` endpoint

---

## Performance & Scaling

### 6. N+1 API Calls in Module Resolution

**Issue:** Each work item launch triggers an individual module lookup.

**Files:** `src/session/manager.js` (lines 41-44)

**Problem:**
```javascript
let moduleName = null;
try {
  moduleName = await plane.getWorkItemModule(project.id, workItem.id);
  // This loops through ALL modules, checking each one:
  // src/plane/client.js lines 111-122
} catch {}
```

Every module lookup queries all modules, then loops through each to find membership. With many modules or concurrent launches, this becomes slow.

**Impact:**
- Slow session startup (noticeable 5-10 second delay)
- API quota usage increases
- Cascading slowness when multiple tasks are queued

**Fix approach:**
- Fetch all modules once and cache for the project
- Use Plane API `include_issues` parameter if available
- Batch module lookups by project
- Make module lookup optional/async so it doesn't block session start

---

### 7. Health Check Blocks on All Sessions

**Issue:** `checkHealth()` is serial and blocks on each workspace read.

**Files:** `src/session/health.js` (lines 30-94)

**Problem:**
- Loop processes sessions sequentially (line 41)
- Each `readScreen()` call has a 15-second timeout (cmux/client.js line 15)
- With 10 sessions: up to 150 seconds to complete a health check
- Health checks run every 60 seconds, can overlap and queue

**Impact:**
- Stale health data (check started 2 minutes ago, still running)
- Monitoring becomes unreliable
- Orchestrator is notified slowly about problems

**Fix approach:**
- Run health checks in parallel with `Promise.all()`
- Add timeout handling to detect hung workspaces faster
- Cache health status with max age instead of always recomputing

---

## Security & Secrets

### 8. API Key Exposure in Error Messages

**Issue:** Plane API errors can leak the API key.

**Files:** `src/plane/client.js` (lines 40-42)

**Problem:**
```javascript
if (!res.ok) {
  const text = await res.text().catch(() => '');
  throw new Error(`Plane API ${res.status}: ${path} — ${text}`);
  // If text contains the API key in an error response, it's exposed
}
```

If Plane returns a 400/500 error that echoes back the Authorization header or request data, the key could appear in error logs.

**Impact:**
- API key logged to console/files if an error occurs
- Logs are often centralized or monitored, extending exposure window
- Low immediate risk but violates secrets principle

**Fix approach:**
- Sanitize error responses before logging
- Log only status code + message, not raw response text
- Never log anything containing 'Authorization', 'X-API-Key', tokens

---

## Test Coverage Gaps

### 9. Incomplete Test Coverage

**Issue:** Very limited test coverage for critical paths.

**Files:** `test/state.test.js`, `test/labels.test.js`

**Missing coverage:**
- Server webhook handling (`src/server.js`) — zero tests
- Plane API client (`src/plane/client.js`) — zero tests
- CMux interaction (`src/cmux/client.js`) — zero tests
- Session launch workflow (`src/session/manager.js`) — zero tests
- Health checking (`src/session/health.js`) — zero tests
- Config loading/saving — zero tests
- Error scenarios and edge cases

**Complexity of untested code:**
- `server.js`: 275 lines, critical security (webhook verification)
- `plane/client.js`: 161 lines, network I/O, retry logic missing
- `session/manager.js`: 135 lines, orchestration logic

**Impact:**
- Regressions go undetected
- Refactoring is risky
- Security vulnerabilities (like #4 above) not caught
- No regression test for the state race condition (#1)

**Fix approach:**
- Mock `PlaneClient` and `cmux` modules
- Add integration tests for webhook flow
- Test error scenarios: network timeout, invalid labels, missing API key
- Add tests for state corruption scenarios
- Aim for 70%+ coverage on `src/server.js`, `src/session/manager.js`, `src/plane/client.js`

---

## Operational Issues

### 10. PID File Management - Process Cleanup Race

**Issue:** PID file can become stale or cause issues with process management.

**Files:** `src/server.js` (lines 14, 223-245, 253-273)

**Problem:**
- PID file is only cleaned up on graceful shutdown (SIGTERM, SIGINT)
- If process crashes or is killed with SIGKILL, stale PID remains
- Next `kodo stop` tries to kill a non-existent process
- If system reuses the PID, wrong process gets killed

**Impact:**
- Manual cleanup required after crashes
- Potential to kill unrelated processes if PID is reused
- `kodo stop` becomes unreliable

**Fix approach:**
- Verify process is actually running before killing (check `/proc/PID` or use kill -0)
- Remove stale PID files more aggressively
- Use process handles instead of manual PID management (if Node.js APIs allow)

---

### 11. Config File Structure Fragility

**Issue:** Three separate JSON files can get out of sync or corrupted.

**Files:** 
- `src/config.js` (config.json, projects.json)
- `src/session/state.js` (state.json)

**Problem:**
- No schema validation when loading JSON
- If any file is corrupted or manually edited, parsing silently fails and defaults are used
- No warnings when files can't be read
- Projects are stored separately from config, two sources of truth

**Current code:**
```javascript
try {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
} catch {
  return { ...DEFAULT_CONFIG };  // <- silent fallback
}
```

**Impact:**
- User reconfigures everything by hand after a crash
- Custom thresholds/settings lost silently
- Hard to debug configuration issues

**Fix approach:**
- Add schema validation (JSON Schema or Zod)
- Log when files are missing or corrupt
- Backup config on write
- Merge projects into main config.json

---

## Known Limitations & Design Decisions

### 12. Orchestrator Skill Learning is Manual

**Issue:** Skill auto-commit only happens on orchestrator session stop, not per-update.

**Files:** 
- `src/hooks/stop.js` (lines 161-192)
- `skills/kodo-orchestrate/skill.md`

**Problem:**
- If orchestrator session crashes or is killed, skill updates are lost
- Learnings are only saved when session closes gracefully
- No validation that skill.md was actually updated before committing

**Impact:**
- Valuable learnings can be lost
- Multiple issues with the same Plane API quirk get re-discovered

**Fix approach:**
- Save skill snapshots more frequently (or use a git auto-save pattern)
- Validate skill.md exists and was modified before committing
- Add skill versioning/history

---

### 13. Module Detection is Best-Effort Only

**Issue:** Module lookup is wrapped in try-catch with silent failure.

**Files:** `src/session/manager.js` (lines 41-44)

**Problem:**
- If module lookup fails (any reason), task still launches without module context
- Claude loses valuable information about task scope
- User doesn't know the module context was unavailable

**Impact:**
- Claude works less effectively without module scope
- Diagnostics are harder (which tasks are from which module?)

**Fix approach:**
- Return module info explicitly or log it
- Add module to session state for tracking
- Warn user if module detection fails

---

## Fragile Code Areas Needing Care

### 14. Session Launch Workflow - Multiple Sequential Async Calls

**Issue:** `launchWorkItem()` has many sequential async operations with limited error recovery.

**Files:** `src/session/manager.js` (lines 14-97)

**Sequence:**
1. Resolve identifier (line 19)
2. Get max parallel sessions (line 22)
3. Get projects config (line 31)
4. Get module name (line 43)
5. Create cmux workspace (line 49)
6. Set color (line 55)
7. Send Claude command (line 62)
8. Update state (line 76)
9. Notify (line 79)
10. Notify orchestrator (line 86)

**Problem:**
- If any step fails partway through (e.g., workspace created but send fails), cleanup is incomplete
- Workspace might exist but session not tracked
- No rollback mechanism
- Order matters: state must be updated AFTER cmux operations succeed, but code does it after send

**Impact:**
- Orphaned workspaces
- Inconsistent state (workspace created but state.json doesn't know about it)
- Session appears to fail but actually started

**Fix approach:**
- Implement cleanup/rollback on error (delete workspace if state update fails)
- Move state update to beginning (optimistic locking)
- Group related operations into atomic blocks
- Add detailed error recovery tests

---

### 15. Bash Command Escaping in Manager

**Issue:** Shell command construction is fragile and potentially unsafe.

**Files:** `src/session/manager.js` (lines 108-117)

**Code:**
```javascript
return `claude --model ${model} --session-id ${sessionId} ${cliFlags} '${escapeShell(prompt)}'`.replace(/\s+/g, ' ').trim();

function escapeShell(str) {
  return str.replace(/'/g, "'\\''");
}
```

**Problem:**
- Only escapes single quotes
- Doesn't handle newlines in prompt (would break shell)
- Doesn't validate `model` or `sessionId` (should be alphanumeric only)
- Building CLI command as string is error-prone

**Impact:**
- Malicious task descriptions could escape the quote and inject commands
- Newlines in task names/descriptions break the command
- Hard to audit for injection vulnerabilities

**Fix approach:**
- Use `execFile()` with array of arguments instead of string building
- Validate model against whitelist: `['opus', 'sonnet', 'haiku']`
- Validate sessionId format (UUID)
- Don't build shell commands, pass arguments directly to execFile

---

## Monitoring & Observability Gaps

### 16. No Metrics or Performance Tracking

**Issue:** No way to see system performance or bottlenecks.

**Problem:**
- No metrics on task launch time, success rate, model usage
- No visibility into API call counts per project
- Can't identify which projects are slow to respond
- No data on health check execution time
- No tracking of failed launches vs successful launches

**Impact:**
- Can't optimize or identify problems
- Scaling decisions are guesswork
- Operator blind to system health

**Fix approach:**
- Add Prometheus-style metrics endpoint
- Track: task launch latency, API call count, health check duration, error rates
- Log structured data (JSON) for analysis

---

## Dependency & Compatibility Risks

### 17. Hardcoded Binary Paths

**Issue:** CMux and Claude binary paths are hardcoded in config defaults.

**Files:** `src/config.js` (lines 43, 52)

**Code:**
```javascript
cmux: {
  binary: '/Applications/cmux.app/Contents/Resources/bin/cmux',
  // ...
},
claude: {
  binary: '/Applications/cmux.app/Contents/Resources/bin/claude',
  // ...
}
```

**Problem:**
- Paths are macOS-specific (won't work on Linux)
- Paths assume specific installation locations
- Binary is not actually used (removed in later code) but stored in config
- If user installs to different location, must manually edit config

**Impact:**
- Linux users can't use this tool without hacks
- Cross-platform portability is broken
- Dead code in config

**Fix approach:**
- Remove unused binary paths from config (they're not used anywhere)
- Use PATH to find cmux instead of hardcoding
- Add platform detection and sensible defaults per OS
- Or use `npx cmux` / find via npm package.json

---

## Documentation & Maintainability

### 18. JSDoc Incomplete in Critical Functions

**Issue:** Not all functions have JSDoc, making types and contracts unclear.

**Missing or incomplete documentation:**
- `PlaneClient.request()` (line 22): No return type documentation
- `checkHealth()` return type mixes string and null inconsistently
- Config merging logic has no docs on how defaults are applied
- Health check `detectIdle()` function: no clear contract on what constitutes "idle"

**Impact:**
- New contributors misunderstand function contracts
- Type checking is less effective
- Errors are caught late instead of at callsite

**Fix approach:**
- Add complete JSDoc to all public functions
- Use TypeScript, or enable JSDoc with `@ts-check` more rigorously
- Add return type and parameter descriptions

---

## Summary of Critical Issues by Severity

### 🔴 Critical (Fix Immediately)
1. **File-based state race condition** (#1) — Can lose session data
2. **Webhook signature verification bypass** (#4) — Security vulnerability
3. **Session launch rollback issues** (#14) — Creates orphaned workspaces

### 🟠 High (Fix Soon)
4. **Health checker false positives** (#2) — Wastes tokens, unreliable
5. **Insufficient error context** (#5) — Hard to debug
6. **Test coverage gaps** (#9) — Regressions undetected
7. **Bash command escaping** (#15) — Potential injection vulnerability

### 🟡 Medium (Fix Next Phase)
8. **Label resolution complexity** (#3) — Brittle, code duplication
9. **N+1 API calls** (#6) — Performance issue
10. **Health check serial execution** (#7) — Slow monitoring
11. **API key in error messages** (#8) — Secrets handling
12. **Config fragility** (#11) — Silent failures

### 🔵 Low (Nice to Have)
13. **PID file management** (#10) — Edge case reliability
14. **Orchestrator skill learning** (#12) — Resilience improvement
15. **Module detection best-effort** (#13) — Feature completeness
16. **Hardcoded binary paths** (#17) — Platform support
17. **JSDoc coverage** (#18) — Maintainability
18. **No metrics** (#16) — Observability

---

*Concerns audit: 2026-04-07*
