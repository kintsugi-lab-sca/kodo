# Phase 4: Server + Trigger Abstraction - Research

**Researched:** 2026-04-13
**Domain:** Node.js HTTP server refactoring, trigger dispatch architecture, CLI-webhook convergence
**Confidence:** HIGH

## Summary

Phase 4 is a pure refactoring phase: no new external libraries, no new protocols. The work involves extracting logic from `server.js` (~275 lines) into two new modules under `src/triggers/` and rewiring `kodo launch` to converge through `dispatchTrigger()`. All building blocks exist: `PlaneProvider` already implements `parseTriggerEvent()` and `verifySignature()`, the registry provides `getProvider()`, and `launchWorkItem()` in `manager.js` handles session creation.

The critical path is ensuring the extraction preserves exact behavior for the Plane webhook flow while making the dispatch path generic enough that CLI manual launches share the same guards (session-already-active, workspace-stale cleanup). The webhook handler becomes a pure function `(rawBody, headers, provider) => responseObject` that is testable without HTTP.

**Primary recommendation:** Extract in two layers -- webhook.js handles HTTP-level concerns (signature, parsing, response codes) and calls dispatcher.js which handles domain-level concerns (label checks, session guards, launch). server.js becomes an ~80-line HTTP shell.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `kodo launch <ref>` traverses `dispatchTrigger()` building a synthetic `TriggerEvent` (`action: "manual"`, provider from active config)
- Single dispatch path for webhook and CLI -- session-already-active, workspace-stale checks live inside dispatcher
- Default requires `kodo` label; `--force` flag skips that check for manual launches
- CLI accepts `<ref>` + `--model <name>` + `--yolo` as override options
- New `src/triggers/` directory with `dispatcher.js` + `webhook.js`
- No formal `TriggerChannel` interface -- extensibility via file organization
- `server.js` reduced to HTTP boot + routing (~80 lines): `/status`, `/health`, `/webhook`
- Webhook handler in `src/triggers/webhook.js` is pure function receiving `(rawBody, headers, provider)` -- testable without HTTP
- Single active provider from `config.provider` via `getProvider()` registry
- `startServer()` calls `provider.init()` before `listen()` -- fail-fast
- Env var per provider: `KODO_WEBHOOK_SECRET_PLANE`, `KODO_WEBHOOK_SECRET_GITHUB`, etc.
- Adapter reads its own secret via `verifySignature(body, headers)` -- server never touches the secret
- Missing webhook secret: fail-fast in `startServer()` unless `--insecure` or `KODO_DEV=1`

### Claude's Discretion
- Hydration of TaskItem in manual case (pre-dispatch vs inside dispatcher)
- Return contract of `dispatchTrigger()` (void, session object, result enum)
- HTTP response semantics (401, 400, 200/204)
- Exact TriggerEvent shape for CLI synthetic events
- `--insecure` flag implementation for dev without secret
- How server passes provider instance to webhook handler (import, closure, parameter)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REWI-04 | `server.js` delegates webhook parsing and signature verification to the active adapter | server.js currently has inline `verifySignature()` and Plane-specific `handleWebhook()` / `handleTriggerState()`. PlaneProvider already implements both methods. Extraction is mechanical: webhook.js calls `provider.verifySignature(rawBody, headers)` and `provider.parseTriggerEvent(payload)`. |
| TRIG-01 | `dispatchTrigger()` extracted from `server.js` as central function | `handleTriggerState()` (lines 82-141 of server.js) contains the core logic: label check, session-already-active guard, workspace-stale cleanup, launch. This moves to `dispatcher.js` accepting a `TriggerEvent` + options. |
| TRIG-02 | Webhook channel functional (used by Plane adapter) | webhook.js receives `(rawBody, headers, provider)`, calls `verifySignature`, parses JSON, calls `parseTriggerEvent`, passes result to `dispatchTrigger()`. Returns a response object `{status, body}`. |
| TRIG-03 | CLI manual (`kodo launch`) works with new abstraction | cli.js `launch` command builds synthetic `TriggerEvent` and calls `dispatchTrigger()` instead of directly calling `launchWorkItem()`. Needs `--force`, `--model`, `--yolo` flag handling. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:http | Node 20+ built-in | HTTP server | Already in use, no change needed |
| node:crypto | Node 20+ built-in | HMAC signature verification | Already used by PlaneProvider |
| node:test | Node 20+ built-in | Test runner | Project standard from Phase 1 |
| commander | ^13.0.0 | CLI framework | Already in use for `kodo` CLI |

### Supporting
No new dependencies needed. This is a pure refactoring phase using existing project infrastructure.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw node:http | Express/Fastify | Unnecessary -- server has 3 routes, raw http is fine and already works |
| Result enum from dispatcher | Throwing errors | Result enum is cleaner for distinguishing "ignored" from "error" from "launched" |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── triggers/
│   ├── dispatcher.js    # dispatchTrigger() — central entry point
│   └── webhook.js       # Pure webhook handler (no HTTP)
├── server.js            # HTTP boot + routing only (~80 lines)
├── cli.js               # launch command rewired to dispatcher
├── providers/           # Unchanged
├── session/             # Unchanged
└── ...
```

### Pattern 1: Pure Webhook Handler
**What:** `webhook.js` exports a function that receives parsed data, not an HTTP request. Returns a plain object `{status, body}` rather than writing to `res` directly.
**When to use:** When you want to test webhook handling without HTTP setup.
**Example:**
```javascript
// src/triggers/webhook.js
/**
 * @param {string} rawBody - Raw HTTP body string
 * @param {object} headers - HTTP headers object
 * @param {import('../interface.js').TaskProvider} provider
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleWebhookRequest(rawBody, headers, provider) {
  // 1. Verify signature
  if (!provider.verifySignature(rawBody, headers)) {
    return { status: 401, body: { error: 'Invalid signature' } };
  }

  // 2. Parse payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }

  // 3. Parse trigger event via provider
  const triggerEvent = provider.parseTriggerEvent(payload);
  if (!triggerEvent) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  // 4. Dispatch (async, don't await for HTTP response)
  dispatchTrigger(triggerEvent).catch(err =>
    console.error(`[kodo] Dispatch error: ${err.message}`)
  );

  return { status: 200, body: { ok: true } };
}
```

### Pattern 2: Central Dispatcher with TriggerEvent
**What:** `dispatchTrigger()` accepts a normalized `TriggerEvent` and handles all pre-launch checks uniformly for both webhook and CLI.
**When to use:** Every trigger source must go through this function.
**Example:**
```javascript
// src/triggers/dispatcher.js
/**
 * @param {import('../interface.js').TriggerEvent} event
 * @param {{ model?: string|null, flags?: string[], force?: boolean }} [opts]
 */
export async function dispatchTrigger(event, opts = {}) {
  const config = loadConfig();
  await initRegistry();
  const provider = getProvider(config.provider);

  // Resolve task from ref
  const task = await provider.getTask(event.taskRef);

  // Check kodo label (unless force or already validated by webhook)
  const kodoConfig = parseKodoLabels(task.labels.map(n => ({ name: n })));
  if (!kodoConfig.isKodo && !opts.force && event.action !== 'manual') {
    console.log(`[kodo] Ignored: ${event.taskRef} — no kodo label`);
    return;
  }

  // Session-already-active guard + workspace-stale cleanup
  // ... (moved from handleTriggerState)

  // Launch via launchWorkItem
  const session = await launchWorkItem(event.taskRef, {
    model: opts.model ?? kodoConfig.model,
    flags: [...(opts.flags || []), ...kodoConfig.flags],
  });

  return session;
}
```

### Pattern 3: Synthetic TriggerEvent for CLI
**What:** `kodo launch` creates a `TriggerEvent` with `action: "manual"` and passes it through `dispatchTrigger()`.
**When to use:** Manual CLI launches.
**Example:**
```javascript
// In cli.js launch command
const event = {
  taskRef: identifier.toUpperCase(),
  action: 'manual',
  provider: config.provider,
  raw: { source: 'cli', model: opts.model, yolo: opts.yolo },
};
const session = await dispatchTrigger(event, {
  model: opts.model,
  flags: opts.yolo ? ['yolo'] : [],
  force: opts.force,
});
```

### Anti-Patterns to Avoid
- **Provider-specific logic in server.js:** The whole point is that server.js does not know about Plane. No `x-plane-signature` header checks in server.js.
- **Duplicating session guards:** Session-already-active and workspace-stale checks must live ONLY in dispatcher.js, not split between webhook.js and cli.js.
- **Passing `req`/`res` to webhook.js:** The handler is pure -- it receives data, returns data. server.js handles HTTP write.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signature verification | Custom HMAC in server.js | `provider.verifySignature(rawBody, headers)` | Already implemented in PlaneProvider, each provider knows its own header names and secret source |
| Webhook payload parsing | Inline event type checks in server.js | `provider.parseTriggerEvent(payload)` | Already implemented, returns null for unrecognized events |
| Provider instantiation | Manual `new PlaneClient()` in server.js | `getProvider(config.provider)` via registry | Singleton caching, interface validation already built |
| Label resolution | Raw Plane API calls | `parseKodoLabels()` from labels.js | Already handles all kodo label formats |

**Key insight:** Every piece of provider-specific logic that server.js currently contains already has a provider-agnostic equivalent in the adapter layer from Phases 1-2. This phase is purely about wiring.

## Common Pitfalls

### Pitfall 1: Async Dispatch vs HTTP Response Timing
**What goes wrong:** Webhook responds 200 before dispatch completes, but errors in dispatch are swallowed silently.
**Why it happens:** Current server.js already does this (`handleWebhook(payload).catch(...)`) but the pattern needs to be preserved in the new architecture.
**How to avoid:** webhook.js fires `dispatchTrigger()` without awaiting, with `.catch()` error logging. This is intentional -- webhooks must respond fast.
**Warning signs:** If tests await `handleWebhookRequest()` and expect the session to be created synchronously.

### Pitfall 2: Double Provider Init
**What goes wrong:** `startServer()` calls `provider.init()` for fail-fast, then `dispatchTrigger()` also calls it.
**Why it happens:** The dispatcher needs an initialized provider but doesn't know if init was already called.
**How to avoid:** `provider.init()` should be idempotent (PlaneProvider already fetches labels -- make it a no-op on second call, or accept that it re-fetches which keeps labels fresh). Alternatively, dispatcher checks if called from server context where init already happened.

### Pitfall 3: CLI Launch Regression (TRIG-03)
**What goes wrong:** `kodo launch KL-42` stops working because the new dispatch path introduces checks that weren't there before (label requirement).
**Why it happens:** The old `launchWorkItem()` had no label check. The dispatcher adds one. Manual launches need to bypass it.
**How to avoid:** `--force` flag or `action === 'manual'` bypass in dispatcher. The CONTEXT.md specifies `--force` skips label requirement, and by default manual launches require the kodo label.
**Warning signs:** `kodo launch` fails on tasks without kodo label that previously worked.

### Pitfall 4: Webhook Secret Env Var Name Change
**What goes wrong:** Existing `PLANE_WEBHOOK_SECRET` env var stops working because the new convention is `KODO_WEBHOOK_SECRET_PLANE`.
**Why it happens:** CONTEXT.md specifies new naming convention.
**How to avoid:** Document the migration clearly. Consider supporting both env var names temporarily, or at minimum log a clear message about the rename.
**Warning signs:** Server fails to start after upgrade with "missing webhook secret" error.

### Pitfall 5: `cli.js` Still References `session.plane_identifier`
**What goes wrong:** The `launch` command logs `session.plane_identifier` which no longer exists (renamed to `task_ref` in Phase 1).
**Why it happens:** cli.js was not rewired in Phase 3 (it was not in scope).
**How to avoid:** Fix cli.js references when rewiring the launch command. Also fix the `status` command which reads `plane_identifier`.

## Code Examples

### Current server.js Flow (to be decomposed)
```
HTTP POST /webhook
  → readBody(req)
  → verifySignature(body, signature, PLANE_WEBHOOK_SECRET)  // inline, Plane-specific
  → JSON.parse(body)
  → handleWebhook(payload)
    → check event type (Plane-specific: "issue"/"work_item")
    → handleTriggerState(data, config)
      → resolve project identifier (Plane API)
      → check kodo labels (Plane label resolution)
      → check existing session + workspace liveness
      → launchWorkItem(identifier, opts)
```

### Target Flow After Phase 4
```
HTTP POST /webhook
  → readBody(req)                                       [server.js]
  → handleWebhookRequest(rawBody, headers, provider)    [webhook.js]
    → provider.verifySignature(rawBody, headers)        [adapter]
    → JSON.parse(rawBody)                               [webhook.js]
    → provider.parseTriggerEvent(payload)               [adapter]
    → dispatchTrigger(triggerEvent)                      [dispatcher.js]
      → provider.getTask(event.taskRef)                 [adapter]
      → label check, session guard, workspace check     [dispatcher.js]
      → launchWorkItem(ref, opts)                       [manager.js]
  → server writes {status, body} to res                 [server.js]

CLI: kodo launch KL-42 --model sonnet --force
  → build synthetic TriggerEvent                        [cli.js]
  → dispatchTrigger(event, { force: true, model })      [dispatcher.js]
    → (same path as above)
```

### readBody Helper (stays in server.js)
```javascript
// This stays in server.js — it's HTTP-level, not trigger-level
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
```

### Slim server.js Skeleton
```javascript
export function startServer(opts = {}) {
  const config = loadConfig();
  const port = opts.port || config.server.port;

  // Fail-fast: resolve and init provider before listening
  await initRegistry();
  const provider = getProvider(config.provider);
  await provider.init();

  // Webhook secret check (fail-fast unless insecure mode)
  if (!opts.insecure && !process.env.KODO_DEV) {
    // Provider's verifySignature will fail without secret,
    // but we want to fail at startup not at first webhook
    // Check provider-specific env var exists
  }

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') { ... }
    if (req.method === 'GET' && req.url === '/status') { ... }
    if (req.method === 'POST' && req.url === '/webhook') {
      const rawBody = await readBody(req);
      const result = await handleWebhookRequest(rawBody, req.headers, provider);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }
    res.writeHead(404).end();
  });

  server.listen(port, () => { ... });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline Plane logic in server.js | Provider adapter pattern | Phase 2 (2026-04-08) | Adapters exist but server.js hasn't been rewired |
| `PlaneClient` direct usage everywhere | `getProvider()` registry | Phase 2 (2026-04-08) | Registry ready, server.js still uses PlaneClient directly |
| `plane_id` / `plane_identifier` in state | `task_id` / `task_ref` | Phase 1 (2026-04-07) | State migrated, but cli.js still references old names |
| `PLANE_WEBHOOK_SECRET` env var | To become `KODO_WEBHOOK_SECRET_PLANE` | Phase 4 (this phase) | Breaking change for existing deployments |

**Stale references in current code:**
- `cli.js` line ~128: `session.plane_identifier` -- should be `session.task_ref`
- `server.js` line ~10: `import { PlaneClient }` -- will be removed entirely
- `server.js` line ~152: `process.env.PLANE_WEBHOOK_SECRET` -- will change to provider-resolved secret

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (Node 20+ built-in) |
| Config file | None -- uses `package.json` scripts |
| Quick run command | `node --test test/**/*.test.js` |
| Full suite command | `node --test test/**/*.test.js` |

### Phase Requirements - Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REWI-04 | server.js delegates to adapter | integration | `node --test test/webhook.test.js -x` | No -- Wave 0 |
| TRIG-01 | dispatchTrigger() central function | unit | `node --test test/dispatcher.test.js -x` | No -- Wave 0 |
| TRIG-02 | Webhook channel functional | unit | `node --test test/webhook.test.js -x` | No -- Wave 0 |
| TRIG-03 | CLI manual launch works | unit | `node --test test/dispatcher.test.js -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/dispatcher.test.js test/webhook.test.js`
- **Per wave merge:** `node --test test/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/dispatcher.test.js` -- covers TRIG-01, TRIG-03 (dispatchTrigger with webhook and manual events)
- [ ] `test/webhook.test.js` -- covers REWI-04, TRIG-02 (pure webhook handler, signature verification delegation)
- [ ] Test fixtures: sample Plane webhook payloads (may already exist in `test/fixtures/`)

## Open Questions

1. **Dispatcher return contract**
   - What we know: webhook.js doesn't need the return (fire-and-forget). CLI needs it for user feedback.
   - What's unclear: Return session object? Result enum? Void?
   - Recommendation: Return `{ action: 'launched'|'ignored'|'stale_cleanup', session? }` result object. CLI uses it for output, webhook ignores it.

2. **Webhook secret fail-fast mechanism**
   - What we know: Provider's `verifySignature` reads its own secret. Server should fail at startup if secret is missing.
   - What's unclear: How to check "secret exists" without exposing provider internals. Provider doesn't expose a `hasWebhookSecret()` method.
   - Recommendation: Add a convention where the adapter config includes `webhook_secret_env` field (already in CONTEXT.md). `startServer()` checks `process.env[provider_config.webhook_secret_env]` exists.

3. **PLANE_WEBHOOK_SECRET migration**
   - What we know: Existing deployments use `PLANE_WEBHOOK_SECRET`. New convention is `KODO_WEBHOOK_SECRET_PLANE`.
   - What's unclear: Whether to support both or hard-break.
   - Recommendation: Support both with deprecation warning -- check new name first, fall back to old name with console warning.

## Sources

### Primary (HIGH confidence)
- Source code analysis of `src/server.js` (275 lines, current implementation)
- Source code analysis of `src/providers/plane/provider.js` (PlaneProvider with verifySignature, parseTriggerEvent)
- Source code analysis of `src/providers/registry.js` (getProvider, initRegistry)
- Source code analysis of `src/session/manager.js` (launchWorkItem, buildSessionFromTask)
- Source code analysis of `src/interface.js` (TriggerEvent, TaskProvider typedefs)
- Source code analysis of `src/cli.js` (launch command, stale plane_identifier references)

### Secondary (MEDIUM confidence)
- Project CONTEXT.md decisions (architectural choices locked by user)
- Phase 3 patterns (pure helper extraction, dependency injection for testability)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure refactoring of existing code
- Architecture: HIGH -- all building blocks exist, clear decomposition path
- Pitfalls: HIGH -- identified from direct source code analysis of current implementation

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable -- internal refactoring, no external dependencies)
