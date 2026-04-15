# Architecture Research — kodo v0.3 (GSD Integration + Structured Logging)

**Domain:** Task-dispatch automation for Claude Code sessions (Node.js CLI + HTTP webhook service)
**Researched:** 2026-04-15
**Confidence:** HIGH (based on direct reading of existing v0.2 codebase; all integration points verified against current module layout)

## Standard Architecture

### System Overview (v0.3 after integration)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              ENTRY POINTS                                    │
│  ┌────────────┐   ┌────────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │ server.js  │   │ hooks/stop.js  │   │ hooks/       │   │ cli.js       │  │
│  │ (webhook)  │   │                │   │ session-start│   │ (logs/launch)│  │
│  └──────┬─────┘   └────────┬───────┘   └──────┬───────┘   └──────┬───────┘  │
├─────────┼──────────────────┼──────────────────┼──────────────────┼──────────┤
│         │          ORCHESTRATION / CONTROL PLANE                 │          │
│  ┌──────▼──────────┐   ┌───▼───────────┐   ┌──▼──────────────┐   │          │
│  │ triggers/       │   │ session/      │   │ session-start   │   │          │
│  │ dispatcher      │──▶│ manager       │   │ (injects GSD    │   │          │
│  │ (webhook route) │   │ (spawn Claude)│   │  instructions)  │   │          │
│  └─────────┬───────┘   └───┬─────┬─────┘   └──────┬──────────┘   │          │
│            │               │     │                │              │          │
│            │      ┌────────▼─────▼──┐   ┌─────────▼──────────┐   │          │
│            │      │ session/state   │   │ gsd/phase-resolver │   │          │
│            │      │ (active map)    │   │ (reads ROADMAP.md) │◀──┘          │
│            │      └─────────────────┘   └────────────────────┘   NEW        │
├────────────┼─────────────────────────────────────────────────────────────────┤
│            │                DOMAIN / ABSTRACTIONS                            │
│  ┌─────────▼──────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────┐ │
│  │ providers/     │   │ labels.js    │   │ interface.js │   │ orchestrator│ │
│  │ registry       │   │ (+ gsd flag) │   │ (typedefs)   │   │ launch/prompt│ │
│  │  ├─plane/      │   │  MODIFIED    │   │              │   │  MODIFIED   │ │
│  │  └─(future)    │   └──────────────┘   └──────────────┘   └─────────────┘ │
│  └────────────────┘                                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                         CROSS-CUTTING (NEW)                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ logger.js — createLogger({ sessionId? }) → { info, warn, error, child }│ │
│  │  ├─ stdout transport (JSON, always)                                    │ │
│  │  └─ file transport (~/.kodo/logs/<session-id>.log, when sessionId set) │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│                              PERSISTENCE                                     │
│  ┌──────────────────┐   ┌────────────────────┐   ┌──────────────────────┐   │
│  │ ~/.kodo/         │   │ ~/.kodo/logs/      │   │ Target repo          │   │
│  │  sessions.json   │   │  <session>.log NEW │   │  .planning/ROADMAP.md│   │
│  └──────────────────┘   └────────────────────┘   └──────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status in v0.3 |
|-----------|----------------|----------------|
| `server.js` | HTTP shell; forwards requests to `triggers/webhook` | UNCHANGED (modulo logger) |
| `triggers/dispatcher.js` | Decide if a task event should spawn a session; dedup; call `session/manager` | MODIFIED — emit structured logs, pass `gsd` flag into session record |
| `session/manager.js` | Spawn Claude Code CLI, persist session, own lifecycle | MODIFIED — writes `gsd` flag into session record; attaches per-session logger |
| `session/state.js` | Read/write `~/.kodo/sessions.json` | MODIFIED — session schema gains optional `gsd` boolean |
| `hooks/session-start.js` | Called by Claude Code at boot; injects system context | MODIFIED — if `session.gsd`, resolve phase and inject GSD instructions |
| `hooks/stop.js` | Called by Claude Code at exit; owns task lifecycle | MODIFIED — structured logs only (behavior unchanged) |
| `labels.js` | Parse `kodo:*` labels → `{ isKodo, model, flags }` | MODIFIED — `flags` includes `'gsd'` when `kodo:gsd` present |
| `providers/*` | Provider-agnostic task access | UNCHANGED — GSD must NOT leak here |
| `orchestrator/prompt.md` | Supervisor session prompt template | MODIFIED — GSD supervision guidance |
| `orchestrator/launch.js` | Spawn supervisor session | UNCHANGED (modulo logger) |
| `cli.js` | Commander entry; subcommands | MODIFIED — add `kodo logs <id>` |
| `gsd/phase-resolver.js` | Read target repo's `.planning/ROADMAP.md`; return current/next phase | **NEW** |
| `logger.js` | Structured logging primitive used everywhere | **NEW** |

## Recommended Project Structure (v0.3)

```
src/
├── interface.js              # typedefs (TaskProvider, TaskItem, TriggerEvent, SessionRecord)
├── config.js                 # config + getProviderApiKey                  MODIFIED (logger)
├── labels.js                 # parseKodoLabels (+ gsd flag)                 MODIFIED
├── logger.js                 # createLogger, transports                    NEW
├── server.js                 # HTTP shell                                   MODIFIED (logger)
├── cli.js                    # Commander CLI                                MODIFIED (logs cmd)
│
├── gsd/                      # GSD-specific concerns (isolated)            NEW FOLDER
│   └── phase-resolver.js     # reads .planning/ROADMAP.md
│
├── providers/                # provider-agnostic abstraction — DO NOT TOUCH
│   ├── registry.js
│   └── plane/*
│
├── triggers/
│   ├── dispatcher.js         # MODIFIED — structured logs, carry gsd flag
│   └── webhook.js            # MODIFIED — logger
│
├── session/
│   ├── state.js              # MODIFIED — schema adds optional gsd:boolean
│   ├── manager.js            # MODIFIED — passes gsd to session record
│   └── health.js             # MODIFIED — logger
│
├── hooks/
│   ├── session-start.js      # MODIFIED — consumes gsd + calls phase-resolver
│   ├── stop.js               # MODIFIED — logger
│   └── install.js            # UNCHANGED
│
└── orchestrator/
    ├── prompt.md             # MODIFIED — GSD supervision section
    └── launch.js             # MODIFIED — logger

test/
├── gsd/phase-resolver.test.js     NEW
├── logger.test.js                 NEW
├── labels.test.js                 MODIFIED (gsd flag)
└── hooks/session-start.test.js    MODIFIED (GSD injection path)
```

### Structure Rationale

- **`src/gsd/` as its own folder:** GSD is a vertical feature that sits *above* the provider abstraction. Keeping it outside `providers/`, `session/`, and `triggers/` preserves the provider-agnostic invariant earned in v0.2 — a future GitHub Issues or Linear provider must not touch GSD, and GSD must not assume Plane.
- **`logger.js` at `src/` root:** Cross-cutting concern imported by nearly every module. Placing it at the root avoids awkward relative paths and signals its universality.
- **No `src/utils/` dumping ground:** logger earns a named module; phase-resolver is domain logic, not utility.
- **Tests mirror `src/`:** existing v0.2 convention — maintained.

## Architectural Patterns

### Pattern 1: Cross-cutting Logger via Factory + Child Loggers

**What:** A single `createLogger({ sessionId, module })` factory returns a logger that writes JSON lines to stdout and (optionally) to a per-session file. `logger.child({ module: 'dispatcher' })` adds contextual fields without re-opening transports.

**When to use:** Every module that currently calls `console.log`/`console.error`. Non-negotiable for dispatcher, manager, hooks, server.

**Trade-offs:**
- Pro: One format, one place to change output; greppable; enables `kodo logs <id>` tail.
- Pro: Zero dependencies (`fs.createWriteStream` + `JSON.stringify` is enough); avoids pino/winston weight.
- Con: Must pass `sessionId` at the boundary — solved by passing a logger argument through constructors rather than importing a global.

**Example:**
```js
// src/logger.js
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function sessionLogPath(id) {
  return path.join(os.homedir(), '.kodo', 'logs', `${id}.log`);
}

export function createLogger({ sessionId = null, module = null } = {}) {
  const base = { sessionId, module };
  let fileStream = null;
  if (sessionId) {
    mkdirSync(path.dirname(sessionLogPath(sessionId)), { recursive: true });
    fileStream = createWriteStream(sessionLogPath(sessionId), { flags: 'a' });
  }

  function emit(level, msg, fields = {}) {
    const line = JSON.stringify({
      ts: new Date().toISOString(), level, msg, ...base, ...fields,
    });
    process.stdout.write(line + '\n');
    if (fileStream) fileStream.write(line + '\n');
  }

  return {
    info:  (msg, f) => emit('info',  msg, f),
    warn:  (msg, f) => emit('warn',  msg, f),
    error: (msg, f) => emit('error', msg, f),
    child: (extra) => createLogger({ sessionId, module: extra.module ?? module }),
  };
}
```

### Pattern 2: Feature Flag on Session Record (not on Provider)

**What:** The `gsd` boolean lives on the `SessionRecord` in `~/.kodo/sessions.json`, decided at dispatch time from labels. Providers never know GSD exists.

**When to use:** Any feature that depends on *how Claude runs*, not on *where the task came from*.

**Trade-offs:**
- Pro: Preserves provider-agnostic design (the hard-won v0.2 invariant).
- Pro: `hooks/session-start.js` reads one field to decide injection — no provider round-trip.
- Con: Session schema migration. Low risk: additive optional boolean, defaults to false.

**Example:**
```js
// session/manager.js — at session creation
const { isKodo, model, flags } = parseKodoLabels(task.labels);
const record = {
  id: sessionId,
  taskId: task.id,
  providerName: task.providerName,
  model,
  gsd: flags.includes('gsd'),   // <-- the only new line
  startedAt: Date.now(),
};
await state.upsert(record);
```

### Pattern 3: Lazy Phase Resolution at Hook Time (not at Dispatch Time)

**What:** `phase-resolver.js` is called by `hooks/session-start.js`, not by the dispatcher. The dispatcher only records `gsd: true`; actually reading `.planning/ROADMAP.md` happens inside the Claude session's cwd.

**When to use:** When context depends on the target repo's filesystem state, which may change between dispatch and session start.

**Trade-offs:**
- Pro: Always sees current ROADMAP.md (user may have edited it between webhook and session start).
- Pro: Dispatcher stays fast and stateless about repo contents.
- Pro: Bootstrap detection (no `.planning/` yet) is naturally handled — resolver returns `{ bootstrap: true }` and the hook injects "run `/gsd:new-project`" instead.
- Con: Slightly more work inside the hook, but it's already reading session state.

**Example:**
```js
// src/gsd/phase-resolver.js
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

export async function resolvePhase({ cwd }) {
  const roadmapPath = path.join(cwd, '.planning', 'ROADMAP.md');
  try { await access(roadmapPath); }
  catch { return { bootstrap: true, roadmapPath }; }

  const md = await readFile(roadmapPath, 'utf8');
  return {
    bootstrap: false,
    roadmapPath,
    current: parseCurrentPhase(md),
    next: parseNextPhase(md),
  };
}
```

### Pattern 4: Hook-Time Context Injection (existing pattern, extended)

**What:** `hooks/session-start.js` already returns additional system context to Claude Code. Extend it to conditionally append a GSD block when `session.gsd === true`.

**When to use:** Whenever per-session behavior must shape Claude's prompt without touching the orchestrator or provider layers.

**Trade-offs:**
- Pro: Single, testable decision point.
- Pro: No change to Claude Code invocation in `session/manager.js`.
- Con: session-start.js accumulates feature-flag branches over time — acceptable until there are 3+ flags, then extract `hooks/context-builders/`.

## Data Flow

### Flow A — `kodo:gsd`-labeled task, webhook to session exit

```
Plane webhook
    │
    ▼
server.js  ──────── logger.info("webhook received")
    │
    ▼
triggers/webhook.js  (validate, normalize TriggerEvent)
    │
    ▼
triggers/dispatcher.js
    │   1. provider.getTask(event.taskId)    → TaskItem { labels, ... }
    │   2. parseKodoLabels(task.labels)      → { isKodo:true, model, flags:['gsd'] }
    │   3. dedup check (state.findActive)
    │   4. logger.info("dispatching", { gsd: true })
    ▼
session/manager.js
    │   1. create SessionRecord { ..., gsd: true }
    │   2. state.upsert(record)
    │   3. spawn `claude` CLI with cwd = repo, env = { KODO_SESSION_ID }
    ▼
Claude Code starts
    │
    ▼
hooks/session-start.js    (invoked by Claude)
    │   1. session = state.get(KODO_SESSION_ID)
    │   2. if (session.gsd):
    │        phase = await resolvePhase({ cwd: process.cwd() })
    │        if (phase.bootstrap)  inject "run /gsd:new-project ..."
    │        else                  inject "current phase: X, next: Y, use /gsd:* ..."
    │   3. logger.info("context injected", { gsd, bootstrap })
    ▼
[Claude session runs — user work happens — all log calls route through logger]
    │
    ▼
hooks/stop.js  (existing behavior: task lifecycle transitions via provider)
    │   logger.info("session stopped")
    ▼
End — ~/.kodo/logs/<session-id>.log is closed
```

Key invariant: **the `gsd` flag crosses exactly two boundaries** — labels → session record (at dispatcher) and session record → hook (at session-start). Providers never see it.

### Flow B — A log line from any module to disk + CLI tail

```
[any module]
  const log = createLogger({ sessionId, module: 'dispatcher' })
  log.info("dispatching", { taskId, gsd: true })
        │
        ▼
  logger.js emit()
        │   JSON.stringify({ ts, level:'info', msg:'dispatching',
        │                    sessionId, module:'dispatcher', taskId, gsd:true })
        │
        ├──▶ process.stdout   (always — visible in server console / PM2)
        │
        └──▶ fs.WriteStream for ~/.kodo/logs/<session-id>.log   (if sessionId)
                         │
                         ▼
              File persists after session exit
                         │
                         ▼
              kodo logs <session-id>        (new CLI command)
                  │
                  ├─ default: `tail -n 200` equivalent + pretty-print JSON
                  ├─ --follow: fs.watch + stream
                  └─ --raw:    emit JSON unchanged (pipe to jq)
```

Backpressure / rotation: out of scope for v0.3. File is append-only per session; total volume bounded by session count. A future `kodo logs --prune` can handle cleanup.

### Key Data Flows

1. **Label → behavior flag:** `parseKodoLabels(task.labels).flags` contains `'gsd'` → dispatcher stores `session.gsd = true` → session-start hook reads and injects GSD prompt.
2. **Session ID propagation for logging:** dispatcher generates `sessionId` → passes to `createLogger({ sessionId })` for its own logs AND into spawn env `KODO_SESSION_ID` → hooks reconstruct the same logger and write to the same file.
3. **ROADMAP read:** only `gsd/phase-resolver.js` reads `.planning/ROADMAP.md`; all other modules stay filesystem-ignorant about project state.

## Build Order (respects dependencies)

1. **`src/logger.js` + tests** — zero internal deps; everything else will import it. Build first so subsequent modules can adopt it as they are touched.
2. **`labels.js` — surface `gsd` flag + tests** — trivial change; unblocks dispatcher/manager schema work. `parseKodoLabels` already puts unknown tags into `flags`, so `'gsd'` will land there naturally; add an explicit test asserting that.
3. **`session/state.js` — schema extension** (`gsd?: boolean`) — additive, backward-compatible.
4. **`session/manager.js` — write `gsd` into record** — depends on (2) and (3).
5. **`triggers/dispatcher.js` — adopt logger + pass label parse through** — depends on (1), (2), (4).
6. **`src/gsd/phase-resolver.js` + tests** — standalone pure function over filesystem; no runtime deps on other new code.
7. **`hooks/session-start.js` — GSD injection branch** — depends on (3), (6).
8. **`orchestrator/prompt.md` — GSD supervision section** — doc-only; any time after (7).
9. **`cli.js` — `kodo logs <id>` command** — depends on (1)'s `sessionLogPath()` convention being stable.
10. **Adopt logger in remaining modules** (`server.js`, `hooks/stop.js`, `session/health.js`, `orchestrator/launch.js`, `triggers/webhook.js`, `config.js`) — parallelizable, mechanical migration.

Rationale: logger is foundational (1). Labels must expose `gsd` before session code decides on it (2→4). Phase resolver is pure and can be built in parallel but must exist before session-start consumes it (6→7). CLI logs command (9) only needs the file path contract from (1).

## Scaling Considerations

Kodo is single-user / single-host by design; "scale" here means feature scale, not traffic.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 provider, 1 behavior flag | Current design is correct. |
| 2+ providers | No change — GSD is provider-agnostic. |
| 3+ behavior flags (`gsd`, `review`, `design`, …) | Promote `hooks/session-start.js` branches into `hooks/context-builders/*.js`. |
| Multi-machine dispatch | Logger needs remote transport (syslog/vector). Out of scope. |

### Scaling Priorities

1. **First bottleneck (feature):** `hooks/session-start.js` bloats with flag branches. Fix by extracting per-flag context builders.
2. **Second bottleneck (ops):** log file directory grows unbounded. Fix with `kodo logs --prune --older-than 30d`.

## Anti-Patterns

### Anti-Pattern 1: Pushing GSD awareness into providers

**What people do:** Add a `provider.getRoadmap()` or special-case `kodo:gsd` inside `providers/plane/*`.
**Why it's wrong:** Violates the v0.2 provider abstraction — GSD is a Claude-session behavior, not a task-provider concept. Recouples consumers to Plane-like providers.
**Do this instead:** Keep GSD logic inside `src/gsd/` and `hooks/session-start.js`. Providers only return labels.

### Anti-Pattern 2: Global logger singleton imported everywhere

**What people do:** `export const logger = createLogger(); import logger from '../logger.js'`
**Why it's wrong:** Logger needs per-session context (sessionId) not known at import time; a global forces either no session context or mutable global state.
**Do this instead:** Instantiate `createLogger({ sessionId, module })` at entry points (dispatcher, hook, CLI command) and pass it down. Leaf utilities with no sessionId get a module-scoped logger without the file transport.

### Anti-Pattern 3: Resolving phase at dispatch time

**What people do:** Have `triggers/dispatcher.js` read `.planning/ROADMAP.md` and stuff the phase into the session record.
**Why it's wrong:** Captures a stale snapshot (user may edit ROADMAP.md between webhook and session start). Pushes filesystem concerns into the dispatcher.
**Do this instead:** Store only `gsd: true` at dispatch time; resolve phase lazily in `hooks/session-start.js`.

### Anti-Pattern 4: Mixing `console.*` with the new logger

**What people do:** Add the new logger in some places, keep `console.log` elsewhere "to avoid churn."
**Why it's wrong:** Split-brain output formats defeat structured logging and break `kodo logs <id>` (console output bypasses the file transport).
**Do this instead:** Complete step (10) in the build order. Lint-level grep for `console\.(log|warn|error)` outside `logger.js` and `cli.js` user-facing prints.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude Code CLI | spawn subprocess from `session/manager.js`; pass `KODO_SESSION_ID` via env | Hooks receive this env; used to reconstruct per-session logger |
| Target repo filesystem | read-only, scoped to `<cwd>/.planning/ROADMAP.md` | Only accessed from `src/gsd/phase-resolver.js` |
| Plane API | via `providers/plane/*` only | Untouched by v0.3 work |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| dispatcher ↔ manager | direct call; `TriggerEvent` + parsed labels | `gsd` flag crosses here |
| manager ↔ Claude Code | subprocess spawn + env vars | `KODO_SESSION_ID` is the only env contract |
| hooks ↔ session state | `session/state.js` read | Single source of truth for `gsd` flag |
| hooks ↔ gsd/phase-resolver | direct call in session-start only | phase-resolver has no reverse dependency |
| any module ↔ logger | constructor/arg injection of logger instance | No global import |
| cli.js `logs` ↔ log files | direct fs read of `~/.kodo/logs/<id>.log` | Path convention owned by `logger.js` (export `sessionLogPath(id)`) |

## Sources

- Direct read of `/Users/alex/dev/klab/kodo/src/labels.js` (current shape of `parseKodoLabels`)
- Hook-observation outlines for `src/session/manager.js`, `src/hooks/session-start.js`, `src/triggers/dispatcher.js`, `src/cli.js` (v0.2 provider abstraction complete; dispatcher has in-flight dedup lock; CLI wizard already has Plane-neutralization debt noted)
- `.planning/PROJECT.md` timeline — v0.2 provider abstraction complete (obs 16110), PROJECT.md updated post-v0.2 (obs 16315), v0.3 research phase initiated (obs 16976)
- Recent commits (`dab86bc feat: Claude session owns Plane lifecycle`, `8e1bcd3 in-memory lock`) — confirm current dispatcher/session-start contracts

---
*Architecture research for: kodo v0.3 — GSD integration + structured logging*
*Researched: 2026-04-15*
