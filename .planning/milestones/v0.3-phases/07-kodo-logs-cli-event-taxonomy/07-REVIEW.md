---
phase: 07-kodo-logs-cli-event-taxonomy
reviewed: 2026-04-16T13:25:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/cli.js
  - src/cmux/client.js
  - src/hooks/session-start.js
  - src/hooks/stop.js
  - src/logger-events.js
  - src/logger.js
  - src/logs/follow.js
  - src/logs/head-line.js
  - src/logs/reader.js
  - src/logs/session-lookup.js
  - src/orchestrator/launch.js
  - src/providers/plane/client.js
  - src/providers/plane/provider.js
  - src/session/manager.js
  - src/session/state.js
  - test/logger-exports.test.js
  - test/logs-follow.test.js
  - test/logs-head-line.test.js
  - test/logs-reader.test.js
  - test/logs-session-of.test.js
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-04-16T13:25:00Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 07 adds the closed taxonomy of 7 lifecycle events (`logger-events.js`), the
`kodo logs` CLI command with dump / follow / filter / `--session-of` subflows,
and wires typed event emission across the hooks, session manager, plane client,
and orchestrator. The design honors the LOG-12 isolation constraint
(`src/check.js` remains disconnected from `logger.js`) by threading `noopLogger`
through `src/session/state.js` and keeping `logger-events.js` free of logger
imports.

Overall the phase is well-shaped: redaction runs before every sink, the CLI
filters are deterministic client-side, `readFirstLine` is bounded, and the
`--session-of` resolver has a documented two-step path with multi-match
warning. Tests exist for each main surface and the contract is captured in
golden fixtures.

Findings are concentrated on type/doc drift, a `--follow` code path that can
race an `rm -rf $HOME/.kodo`, a stderr swallow pattern that hides logger
bootstrap errors in hooks, and some minor robustness gaps. No critical
security issues. One potentially confusing bug around `findSession` is
flagged as a warning because it is already covered by runtime behavior but
sits outside the documented contract.

## Warnings

### WR-01: `findSession` JSDoc does not declare `sessionId`, the primary key used by callers

**File:** `src/session/state.js:148-164`
**Issue:** The function signature is documented as `@param {{ cwd?: string, workspaceRef?: string }} query`, but the body reads `query.sessionId` (line 153) and both hooks (`session-start.js:87`, `stop.js:45`) pass `sessionId` in. `@ts-check` passes only because the object literal is inferred wider than the JSDoc; any stricter checker or refactor that trusts the JSDoc will silently drop the fast-path lookup. The function has three distinct lookup keys and the most important one is invisible to the type system.
**Fix:**
```js
/**
 * Find a tracked session by id, workspace ref, or cwd (checked in that order).
 * @param {{ sessionId?: string, cwd?: string, workspaceRef?: string }} query
 */
export function findSession(query) { ... }
```

### WR-02: `kodo logs --follow` can hang indefinitely if the log directory does not yet exist

**File:** `src/logs/follow.js:42-70`
**Issue:** `watchFile(filePath, ...)` is called unconditionally at line 53, even when the parent directory `~/.kodo/logs/` has not been created (fresh machine, first `kodo logs --follow <sess>` before any session has logged). On macOS `watchFile` tolerates missing files, but the poll never converges to "ready" until the file actually appears; combined with the always-registered `SIGINT` handler this is fine interactively but misleading in tests or CI where the dir is never created — the process prints "waiting for session log to appear..." and holds forever. No timeout, no abort signal.
**Fix:** Either document the behavior explicitly in the CLI help (`--follow` blocks indefinitely) or short-circuit with a friendlier error when the directory is missing and no session was seeded:
```js
import { dirname } from 'node:path';
if (!existsSync(dirname(filePath))) {
  process.stderr.write(`No logs directory at ${dirname(filePath)} — start a kodo session first.\n`);
  process.exit(1);
}
```
Secondary: register a single `SIGINT` handler using `process.once('SIGINT', ...)` to avoid leaking listeners if `followFile` is ever called twice in the same process (e.g. from tests).

### WR-03: `createLogger` may throw if `minLevel` comes from `KODO_LOG_LEVEL` with an unexpected value, crashing both hooks

**File:** `src/logger.js:192-198` (callers: `src/hooks/session-start.js:103-106`, `src/hooks/stop.js:88-91`)
**Issue:** Hooks cast `process.env.KODO_LOG_LEVEL || 'info'` through an `any` cast and pass it to `createLogger`, which throws on invalid values (`if (!(minLevel in LEVELS))`). Both hooks wrap the logger block in `try/catch {}` that swallows silently, which is safe for Claude Code startup but also means a typo in `KODO_LOG_LEVEL` (e.g. `KODO_LOG_LEVEL=verbose`) drops every `session.start`/`session.end` event with zero feedback to the user — the NDJSON files are silently empty for the lifetime of that env var. The taxonomy guarantee is broken invisibly.
**Fix:** Normalize unknown values to `'info'` in the factory (defense-in-depth) rather than throw, so a misconfigured env still produces events:
```js
const normalized = (minLevel in LEVELS) ? minLevel : 'info';
const minLevelNum = LEVELS[normalized];
```
Or, preserve the throw but have the hooks write to stderr once: `[kodo:hook] invalid KODO_LOG_LEVEL='${val}', defaulting to info`.

### WR-04: `parseInt(remaining, 10)` without validation can store `NaN` in `_rateRemaining` and disable throttling

**File:** `src/providers/plane/client.js:56-59`
**Issue:** If Plane ever returns `x-ratelimit-remaining: -` or a non-numeric header (some proxies normalize), `parseInt(remaining, 10)` yields `NaN`. `NaN < 5` is `false`, so the proactive throttle at lines 36-42 silently never fires; `this._rateRemaining !== undefined` passes. Combined with `_rateReset` also potentially NaN, the branch `waitMs > 0 && waitMs < 65_000` evaluates `NaN > 0 === false` so nothing explodes, but the throttle becomes a no-op. This is a latent logic bug exposed by a bad upstream header.
**Fix:**
```js
if (remaining !== null) {
  const parsed = parseInt(remaining, 10);
  if (Number.isFinite(parsed)) this._rateRemaining = parsed;
}
if (reset !== null) {
  const parsed = parseInt(reset, 10);
  if (Number.isFinite(parsed)) this._rateReset = parsed;
}
```

### WR-05: Orchestrator detection in `stop.js` is a prefix match that misclassifies sibling directories

**File:** `src/hooks/stop.js:50-57`
**Issue:** `cwd.startsWith(KODO_ROOT + '/')` treats any subdirectory of `kodo/` as the orchestrator session, including developer scratch paths or worktrees placed under `kodo/worktrees/foo` (which actually exists per the `ls .claude/` output). A Claude session started in a worktree that happens to live under `KODO_ROOT` will trigger `handleOrchestratorStop()`, which runs `git add skills/ && git commit -m "skill: ..."` on the main kodo repo regardless of the worktree's actual working directory. This can auto-commit unrelated in-flight changes.
**Fix:** Require exact match, or explicitly exclude worktrees:
```js
const isOrchestratorSession = cwd === KODO_ROOT;
```
If worktrees legitimately need to be recognized as orchestrator sessions, guard the auto-commit with an additional check that the git repo at `KODO_ROOT` is the kodo repo and not a worktree clone.

## Info

### IN-01: `readFirstLine` leaves descriptor leak window on concurrent truncate

**File:** `src/logs/head-line.js:33-52`
**Issue:** `openSync` + `try/finally` is correct, but the loop calls `readSync(fd, buf, 0, buf.length, pos)` in a tight loop without checking whether the file was truncated mid-read. On truncation `readSync` returns `0` and the function returns `null`, which is fine — just worth a comment acknowledging that the function sees "no newline found" on race, not an error.
**Fix:** Add a brief comment noting the race semantics; no code change needed.

### IN-02: `resolveSessionIdFromTaskId` skips corrupt files silently without telemetry

**File:** `src/logs/session-lookup.js:51-66`
**Issue:** Corrupt or unreadable `.ndjson` files are skipped silently during the fallback scan. In a production debugging scenario, a user running `kodo logs --session-of KL-42` against a corrupted log directory will see `null` without any hint that files were skipped.
**Fix:** Emit a single stderr summary at the end when any files were skipped:
```js
if (skipped > 0) process.stderr.write(`(skipped ${skipped} unreadable log file(s))\n`);
```

### IN-03: `send` in `cmux/client.js` passes a literal `'\\n'` instead of `'\n'`

**File:** `src/cmux/client.js:46` (and callers at `orchestrator/launch.js:54, 90`, `hooks/stop.js:112`, `session/manager.js:205`)
**Issue:** Every `cmux.send({ text: '...' + '\\n' })` call emits two chars `\` `n`, not a newline. If cmux's `send` subcommand expects a literal backslash-n token it's working as intended (treats `\n` as an escape in args), but the shape is consistent across all callers and looks suspicious on first read. If cmux actually parses `\n` as newline, it's correct; if it passes the two chars to the inner tty, the prompt will contain a literal `\n`. Verify intent and document.
**Fix:** Add a one-line comment on the helper:
```js
// cmux's `send` interprets `\n` as "press Enter"; we append the token literally.
export async function send(opts) { ... }
```

### IN-04: Hooks dynamically import `logger.js` twice per session lifecycle

**File:** `src/hooks/session-start.js:101-114`, `src/hooks/stop.js:86-97`
**Issue:** Both hooks do `await import('../logger.js')` and `await import('../logger-events.js')` inside the event-emission try block. The comments justify the dynamic load as isolation from Claude Code crashes, but since the file is already in the hook's module graph via `findSession → state.js → logger-noop.js` (not `logger.js` itself — good), the dynamic import is there purely to keep the happy-path synchronous. This is fine; the small nit is that the two calls could be `Promise.all`-ed for ~1ms startup saving.
**Fix:** Optional optimization; leave if startup budget is not a constraint.

### IN-05: `parseRef` / `resolveIdentifier` regex accepts lowercase letters then uppercases

**File:** `src/providers/plane/client.js:196-211`, `src/providers/plane/provider.js:50-53`
**Issue:** The regex `/^([A-Z]+)-(\d+)$/i` allows `kl-42` which gets `.toUpperCase()`'d. Two different modules replicate the same regex and the same logic. Not a bug, just DRY drift; `parseRef` in `provider.js` and `resolveIdentifier` in `client.js` could share a helper.
**Fix:** Extract a small `parseRef` helper to `src/providers/plane/ref.js` and import from both.

### IN-06: `buildClaudeCommand` shell injection surface

**File:** `src/session/manager.js:222-236`
**Issue:** The command builder uses a hand-rolled `escapeShell` (single-quote wrap + `'\\''` escape) and passes the resulting string to `cmux.send({ text: ... })`, which itself passes through `execFile` (not `exec`). Since `execFile` does not spawn a shell, the single-quote escaping is actually for cmux's downstream interpreter (the claude process's argv). The description field is user-controlled upstream (Plane work item description), so a maliciously crafted description cannot break the outer exec, but it could confuse whatever shell cmux uses to inject the command into the TTY. Low risk (Plane is trusted; the content is ultimately displayed to the user), but the pattern of concatenating user input into a command string is worth a note.
**Fix:** None required given the threat model. If Plane ever exposes public tasks, consider using a structured send mechanism instead of interpolated shell.

---

_Reviewed: 2026-04-16T13:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
