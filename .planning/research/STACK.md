# Stack Research — kodo v0.3 (GSD Integration + Structured Logging)

**Domain:** CLI orchestrator / bridge daemon (Node.js, single-dep philosophy)
**Milestone:** v0.3 — GSD workflow integration + structured logging
**Researched:** 2026-04-15
**Confidence:** HIGH

## Scope

This milestone adds two capabilities on top of the existing v0.2 bridge:

1. **GSD integration** — read/parse `.planning/ROADMAP.md` from target repos; inject `/gsd:*` slash-command invocations into the launched Claude Code session (via the existing `SessionStart` hook context pipeline).
2. **Structured logging** — levelled JSON logs, per-session log files under `~/.kodo/logs/`, and a `kodo logs [--tail] [--session <id>]` CLI command.

Existing validated stack (**NOT re-evaluated** per milestone context): Node.js >=20, `commander@^13`, ESM (`"type": "module"`), JSDoc + `@ts-check`, no build step, single runtime dep.

## Guiding Principle

**Preserve the single-dep philosophy.** Adding a library requires clearing a higher bar than "it's convenient": it must solve a problem that hand-rolled code in Node 20 cannot solve cleanly in <150 LOC with adequate correctness.

Applying this test to v0.3:

- **Logging** → hand-roll. Node 20's `fs/promises` + `util.inspect` + a tiny level filter cover 100% of requirements. Pino/Winston are overkill for a tool whose hottest path writes ~10 events per session.
- **ROADMAP.md parsing** → hand-roll. We only need to extract phase headings (`## Phase N: ...`) and a handful of fields. No frontmatter, no AST.
- **Slash-command injection** → no library needed; it's a string written to the hook's `additionalContext` / stdout channel that Claude Code already consumes.

## Recommended Stack

### Core Technologies (unchanged from v0.2)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | >=20.0.0 | Runtime | Existing. Stable `fs/promises`, `node:test`, `structuredClone`, native `--env-file`. |
| commander | ^13.0.0 | CLI parser | Existing. Extend with `logs` subcommand — no new dep required. |
| ESM (`type: module`) | — | Module system | Existing. |

### Supporting Libraries — NEW

**None required.** All new functionality is delivered via Node stdlib + existing in-repo helpers.

| Would-be library | Decision | Replacement |
|------------------|----------|-------------|
| `pino` / `winston` | **REJECTED** | `src/logger.js` (hand-rolled, ~120 LOC) |
| `gray-matter` / `front-matter` | **REJECTED** (ROADMAP.md has no frontmatter in the GSD template) | `src/gsd/roadmap.js` (regex-based section parser, ~80 LOC) |
| `marked` / `remark` / `unified` | **REJECTED** (full markdown AST unneeded) | Same as above |
| `chalk` / `picocolors` | **REJECTED** (already have `src/cmux/colors.js` using ANSI escapes) | Reuse existing helper |
| `chokidar` (for `logs --tail`) | **REJECTED** | `fs.watch` + `fs.createReadStream` polling tail |
| `debug` | **REJECTED** (not levelled, no JSON) | Hand-rolled logger |

### Development Tools (unchanged)

| Tool | Purpose | Notes |
|------|---------|-------|
| `node --test` | Test runner | Existing `test/**/*.test.js`. Add `test/logger.test.js`, `test/gsd/roadmap.test.js`. |
| JSDoc + `@ts-check` | Type safety | Annotate new modules with `@typedef` for `LogEntry`, `Roadmap`, `Phase`. |

## Installation

```bash
# No new runtime dependencies.
# No new dev dependencies.
# package.json stays at dependencies: { commander: "^13.0.0" }.
```

## Module Additions (where the new code lives)

| New module | Responsibility | LOC est. |
|------------|----------------|----------|
| `src/logger.js` | Levelled JSON logger; `createLogger({ sessionId, filePath, minLevel })` factory | ~120 |
| `src/logs/reader.js` | Read/tail/filter log files for `kodo logs` | ~80 |
| `src/gsd/roadmap.js` | Parse `.planning/ROADMAP.md` → `{ phases: [{ id, title, status, body }] }` | ~100 |
| `src/gsd/context.js` | Build `additionalContext` block with `/gsd:*` suggestions for `SessionStart` hook | ~60 |
| `src/cli.js` | Add `logs` subcommand (tail, filter by session/level) | +50 |
| `src/hooks/session-start.js` | Call `gsd/context.js` when target repo has `.planning/ROADMAP.md`; logger everywhere | +30 |

## Logger Design (hand-rolled rationale)

### Requirements

- Levels: `debug`, `info`, `warn`, `error`.
- JSON-per-line output (Bunyan/Pino-compatible shape for future interop).
- Per-session file at `~/.kodo/logs/<sessionId>.jsonl`.
- Mirror `warn`/`error` to stderr of the parent process (cmux wrapper, webhook server, CLI).
- Timestamp, level, sessionId, message, arbitrary structured fields.
- `kodo logs --tail` follows the active session's file.

### Why not pino (10.3.1)?

Pino is excellent, but:
- Brings ~10 transitive deps (`atomic-sleep`, `fast-redact`, `on-exit-leak-free`, `pino-std-serializers`, `process-warning`, `quick-format-unescaped`, `real-require`, `safe-stable-stringify`, `sonic-boom`, `thread-stream`). Violates single-dep philosophy for zero measurable benefit at our throughput.
- Its main selling point is **async transport threads** — irrelevant when we write <1 KB/s.
- `pino-pretty@13` would be a second dep just for `kodo logs` output formatting.

### Why not winston (3.19.0)?

- Heavier API surface, multi-transport abstraction we don't need.
- Slower than pino and than a plain `fs.appendFile` for our volume.
- More transitive deps than pino.

### Hand-rolled sketch (for downstream reference)

```js
// src/logger.js
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** @typedef {"debug"|"info"|"warn"|"error"} LogLevel */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ sessionId, filePath, minLevel = "info" }) {
  const threshold = LEVELS[minLevel];
  const write = async (level, msg, fields = {}) => {
    if (LEVELS[level] < threshold) return;
    const entry = { t: new Date().toISOString(), level, sessionId, msg, ...fields };
    const line = JSON.stringify(entry) + "\n";
    await mkdir(dirname(filePath), { recursive: true }).catch(() => {});
    await appendFile(filePath, line).catch(() => {});
    if (level === "warn" || level === "error") process.stderr.write(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info:  (m, f) => write("info", m, f),
    warn:  (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
  };
}
```

That's the whole logger. Pino/winston would add >1 MB of `node_modules` for the same behaviour.

## ROADMAP Parser Design

### Format assumptions (verified against GSD template)

GSD's `.planning/ROADMAP.md` uses **plain markdown with `## Phase N: Title` headings**. No YAML frontmatter. Goals/success criteria live as bullet lists under each heading.

### Why not gray-matter (4.0.3)?

- Parses **YAML frontmatter** — which the template doesn't use. Zero value.
- Adds `js-yaml`, `strip-bom`, `section-matter` transitively.

### Why not a markdown AST (remark/marked)?

- We need 4 things per phase: `id`, `title`, `goal line`, `status marker`.
- A 25-line regex walker over `split("\n")` is correct, auditable, and zero-dep.
- If the schema becomes truly rich later (nested tasks, tables), revisit — but that's a v0.4+ decision.

### Sketch

```js
// src/gsd/roadmap.js
import { readFile } from "node:fs/promises";

const PHASE_RE = /^##\s+Phase\s+(\d+)\s*:\s*(.+?)\s*(✅|🔄|⏳)?\s*$/;

export async function parseRoadmap(path) {
  const text = await readFile(path, "utf8");
  const phases = [];
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(PHASE_RE);
    if (m) {
      if (current) phases.push(current);
      current = { id: Number(m[1]), title: m[2], status: statusFromMarker(m[3]), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) phases.push(current);
  return { phases };
}
```

## Slash-Command Injection (no library)

Claude Code's `SessionStart` hook supports emitting an `additionalContext` block that the session receives as system context. We already write to it in `src/hooks/session-start.js`.

For GSD: when a repo has `.planning/ROADMAP.md` and an active/next phase is detected, append a block like:

```
<gsd_context>
Active phase: Phase 3 — Consumer Rewiring
Suggested next action: run `/gsd:status` to see phase state, then `/gsd:work` to continue.
</gsd_context>
```

No library needed — it's string concatenation. The existing hook plumbing already delivers this to the session.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hand-rolled logger | `pino@10.3.1` | If log volume grows >1k events/sec or we need async transports / log rotation / redaction — none of which apply to a bridge writing one line per webhook. |
| Regex ROADMAP parser | `unified` + `remark-parse` | If GSD adopts rich nested schemas (tables, embedded task trees) that make regex brittle. Revisit in v0.4. |
| Regex ROADMAP parser | `gray-matter@4.0.3` | Only if GSD adds YAML frontmatter to roadmap files (it currently does not). |
| `fs.watch` tail | `chokidar@4` | Cross-platform file-watching edge cases (network drives, Docker mounts). Not relevant for `~/.kodo/logs/` on local disk. |
| Reuse `src/cmux/colors.js` | `picocolors@1.x` | If we ever need full theming; picocolors is tiny (~1KB) but still a new dep. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `pino` / `winston` / `bunyan` / `log4js` | Transitive dep bloat; features (async transports, rotation, multi-sink routing) we don't use. | `src/logger.js` (hand-rolled, ~120 LOC) |
| `pino-pretty` | Second dep for a dev-only concern; `kodo logs` can pretty-print with 30 lines of `JSON.parse` + color. | Hand-rolled pretty-printer in `src/logs/reader.js` |
| `gray-matter` / `front-matter` | GSD roadmap template has no YAML frontmatter. | Regex line walker |
| `marked` / `remark` / `unified` | Full markdown AST for 4 fields per phase is absurd overhead. | Regex line walker |
| `chalk@5` | We already have `src/cmux/colors.js`. | Reuse existing helper |
| `chokidar` | `fs.watch` in Node 20 is sufficient for tailing one file on local disk. | `fs.watch` + `createReadStream` |
| `debug` | Not levelled, env-var-driven only, no JSON output. | Hand-rolled logger |
| `nanoid` / `uuid` for log correlation | Session IDs already exist upstream; logger just carries them. | Reuse existing session ID |

## Integration Points

### `src/hooks/session-start.js`

- Import `createLogger` and `buildGsdContext`.
- After resolving the task, if `cwd/.planning/ROADMAP.md` exists, call `buildGsdContext(parseRoadmap(...))` and append to `additionalContext`.
- Replace existing `console.error` calls with logger calls (session-scoped).

### `src/cli.js`

- New subcommand:
  ```
  kodo logs [--session <id>] [--level debug|info|warn|error] [--tail] [--json]
  ```
- Wired via `commander` (already present); no new dep.

### `src/session/manager.js`, `src/triggers/webhook.js`, `src/orchestrator/launch.js`

- Replace ad-hoc `console.log`/`console.error` with `logger.info`/`logger.error`.
- Pass `sessionId` via logger factory — one line change per site.

### `src/config.js`

- Add `logLevel` (default `info`) and `logsDir` (default `~/.kodo/logs/`) to config schema.
- No new migration needed beyond appending defaults.

## Stack Patterns by Variant

**If log volume grows >1k events/sec (unlikely — webhook-driven, ~1 event/min peak):**
- Switch logger implementation to `pino@10.3.1`. The hand-rolled API surface (`logger.info/warn/error/debug`) is already pino-shaped, so migration is an import swap.

**If GSD roadmap schema becomes complex (nested tasks, tables, frontmatter):**
- Introduce `gray-matter@4.0.3` for frontmatter + keep regex for section walking, OR adopt `unified` + `remark-parse` for full AST. Keep parser isolated to `src/gsd/roadmap.js` so the swap is local.

**If we add a TUI (`kodo logs` with interactive filters):**
- Revisit — would justify `blessed` or `ink`. Out of scope for v0.3.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `commander@^13` | Node >=18 | Already pinned. No `logs` subcommand-specific concerns. |
| Node 20 `fs.watch` | Linux, macOS (tested), Windows | Sufficient for `--tail` on local disk. |
| Node 20 `node:test` | — | Add new test files; no runner change. |

## Sources

- `npm view pino version` → `10.3.1` (verified 2026-04-15, HIGH)
- `npm view winston version` → `3.19.0` (verified 2026-04-15, HIGH)
- `npm view pino-pretty version` → `13.1.3` (verified 2026-04-15, HIGH)
- `npm view gray-matter version` → `4.0.3` (verified 2026-04-15, HIGH)
- Node.js 20 LTS stdlib docs (`fs/promises`, `fs.watch`, `node:test`) — HIGH
- Claude Code hooks `SessionStart` `additionalContext` contract — existing usage in `src/hooks/session-start.js` — HIGH
- kodo v0.2 `package.json` single-dep baseline — HIGH
- Milestone context assertion that ROADMAP.md is plain markdown with phase headings — HIGH

---
*Stack research for: kodo v0.3 (GSD integration + structured logging)*
*Researched: 2026-04-15*
