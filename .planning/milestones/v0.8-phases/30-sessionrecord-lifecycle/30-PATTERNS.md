# Phase 30: SessionRecord Lifecycle - Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 7 (2 modified core + 2 callsite touch + 2 new tests + 1 verify likely-touched)
**Analogs found:** 7 / 7 (100%)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/session/state.js` (mod `findSession`) | state-store helper | request-response (read-only query) | `src/session/state.js` `findSession` (lines 180-194) **itself** + `listHistory` (143-147) | exact (self-extend) |
| `src/session/manager.js` (mod `markSessionStatus`) | service mutator | event-driven (state.transition emit) | `src/session/manager.js` `markSessionStatus` (lines 352-360) **itself** + `addSession` warn-style of `state.js` (113-121) | exact (self-refactor) |
| `src/gsd/verify.js` (callsite update line ~267) | controller (orchestration) | request-response | `src/hooks/stop.js#188` (sibling callsite, parallel pattern) | exact (sibling) |
| `src/hooks/stop.js` (callsite update line ~188) | hook | event-driven | `src/gsd/verify.js#267` (sibling callsite) | exact (sibling) |
| `test/session/find-session.test.js` (new) | test (unit) | request-response | `test/state.test.js` "state store" describe (lines 15-85) + `test/session-of-resolver.test.js` HOME-isolation scaffold (101-134) | role + flow match |
| `test/session/mark-status.test.js` (new) | test (unit + log capture) | event-driven | `test/stop-state-transition.test.js` `makeLogger` (lines 65-80) + `test/gsd-verify-integration.test.js#95` warn-capture | exact (memSink) |
| `src/hooks/session-start.js` (verify-only line ~203) | hook | event-driven | `src/gsd/verify.js#83-86` (sibling normalize) | partial (verify caller tolerance) |

**Files NOT in scope** (out-of-scope per CONTEXT.md):
- `src/logs/session-lookup.js` (step-1 of `kodo logs --session-of` resolver) — currently iterates `state.sessions` directly (line 33), NOT via `findSession`. CONTEXT.md SC#1 lockea that this CLI keeps working post-removeSession. **Decision deferred to planner**: either (a) `session-lookup.js` step-1 ALSO scans history (parallel to LIFE-01) or (b) refactor to call `findSession({sessionId: task_id})` — but that breaks the lookup-key contract (current step-1 matches by `task_id` OR `task_ref`, `findSession` only matches `sessionId/workspaceRef/cwd`). **Recommendation: leave `session-lookup.js` untouched in Phase 30**; SC#1 is satisfied via step-2 head-line scan over `~/.kodo/logs/*.ndjson` which survives removeSession (NDJSON files are independent of `state.sessions`). Worth confirming with planner.

## Pattern Assignments

---

### `src/session/state.js` — extend `findSession` (LIFE-01)

**Analog (self-extend):** `src/session/state.js` lines 180-194 + `listHistory` (143-147)

**Imports pattern** (lines 1-7) — no new imports needed; `loadState()` already returns `state.history`:
```javascript
// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
import { noopLogger } from '../logger-noop.js';
```

**Current findSession to extend** (lines 176-194):
```javascript
/**
 * Find session by workspace ref or project path
 * @param {{ cwd?: string, workspaceRef?: string }} query
 */
export function findSession(query) {
  const sessions = loadState().sessions;
  // Prefer exact session_id match (unique, no ambiguity)
  if (query.sessionId) {
    for (const [id, session] of Object.entries(sessions)) {
      if (session.session_id === query.sessionId) return { id, session };
    }
  }
  // Fall back to workspace ref or cwd
  for (const [id, session] of Object.entries(sessions)) {
    if (query.workspaceRef && session.workspace_ref === query.workspaceRef) return { id, session };
    if (query.cwd && session.project_path === query.cwd) return { id, session };
  }
  return null;
}
```

**Pattern to apply** (per D-01..D-04):
1. Single `loadState()` call (current pattern — keep). Then read both `state.sessions` and `state.history`.
2. **D-02 priority sessions**: scan `state.sessions` first; return early with `source: 'sessions'`.
3. **D-04 same lookup keys**: history entries share shape (`session_id`, `workspace_ref`, `project_path`) — same comparison logic.
4. **D-03 id synthesis for history**: history entries have no key (array items); use `session.task_id` as `id`.
5. **Optional helper** (Claude's Discretion): extract `findInBucket(bucket, query, source)` if readability suffers. Bucket can be `Object.entries(sessions)` or `state.history.map(s => [s.task_id, s])`.

**History entry shape source** (from `removeSession` lines 127-141):
```javascript
export function removeSession(taskId, logger = noopLogger) {
  const state = loadState();
  const removed = state.sessions[taskId];
  if (removed) {
    if (!Array.isArray(state.history)) state.history = [];
    state.history.unshift({
      ...removed,             // ← preserves session_id, workspace_ref, project_path, task_id
      ended_at: new Date().toISOString(),
    });
    state.history = state.history.slice(0, 50);
  }
  delete state.sessions[taskId];
  saveState(state);
  logger.info('state.session.removed', { task_id: taskId });
}
```
Guarantee: D-04 holds — history entries have the same 3 lookup-key fields.

**Defensive helper pattern** (from `listHistory` line 144-147 — copy this `Array.isArray` guard):
```javascript
const history = Array.isArray(state.history) ? state.history : [];
```
Apply this guard to handle legacy state.json files without the `history` array.

**JSDoc updates** (per Claude's Discretion):
```javascript
/**
 * Find session by sessionId, workspace ref, or project path. Scans both
 * `state.sessions` (active) and `state.history` (terminated, FIFO 50-slot
 * cap maintained by removeSession).
 *
 * Priority: sessions wins when an entry appears in both (degenerate window
 * between removeSession's unshift and delete — SC#3 ROADMAP lockea).
 *
 * @param {{ sessionId?: string, cwd?: string, workspaceRef?: string }} query
 * @returns {{ id: string, session: Session, source: 'sessions' | 'history' } | null}
 */
```

**Return shape (D-01 tagged discriminated union)**:
```javascript
return { id, session, source: 'sessions' };  // or 'history'
return null;                                  // not found
```

---

### `src/session/manager.js` — refactor `markSessionStatus` (LIFE-02)

**Analog (self-refactor):** `src/session/manager.js` lines 342-360 + `addSession` logger pattern from `state.js` (113-121)

**Current code to refactor** (lines 342-360):
```javascript
/**
 * Update a session's status and emit a typed state.transition event when a
 * logger is provided. Retrocompatible: callers that do not pass a logger
 * behave identically to a direct updateSession() call.
 *
 * @param {string} taskId
 * @param {'running'|'done'|'error'|'review'|'interrupted'} nextStatus
 * @param {string} reason
 * @param {import('../logger.js').Logger} [logger]
 */
export function markSessionStatus(taskId, nextStatus, reason, logger) {
  const current = listSessions().find((s) => s.task_id === taskId || s.task_ref === taskId);
  const fromStatus = current?.status || 'unknown';
  updateSession(taskId, { status: nextStatus });
  if (logger) {
    const log = logger.child({ component: 'session', task_id: taskId });
    stateTransition(log, { from: fromStatus, to: nextStatus, reason });
  }
}
```

**Pattern to apply** (per D-05..D-09):

1. **D-07 new signature** with optional 5th param:
   ```javascript
   /**
    * @param {string} taskId
    * @param {'running'|'done'|'error'|'review'|'interrupted'} nextStatus
    * @param {string} reason
    * @param {import('../logger.js').Logger} [logger]
    * @param {string} [sessionId]   // Phase 30 D-07: opcional, para observability del falsy-taskId path
    * @returns {{ ok: true, from: string, to: string } | { ok: false, reason: 'missing-task-id' }}
    */
   export function markSessionStatus(taskId, nextStatus, reason, logger, sessionId) {
   ```

2. **D-09 + D-08 falsy guard at top** (early return BEFORE listSessions/updateSession):
   ```javascript
   if (!taskId) {
     if (logger) {
       logger.warn('markSessionStatus: missing task_id', {
         session_id: sessionId || 'unknown',  // D-07 fallback
         status: nextStatus,                   // D-08 key 'status' (not 'next_status')
         reason,
       });
     }
     return { ok: false, reason: 'missing-task-id' };
   }
   ```

3. **D-05 success shape** at the end:
   ```javascript
   return { ok: true, from: fromStatus, to: nextStatus };
   ```

**Defensive helper shape pattern** (from `isGsdChild` in `src/labels.js` lines 114-123):
```javascript
export function isGsdChild(labels) {
  if (!Array.isArray(labels)) return false;     // ← defensive prefix guard
  return labels.some(...)
}
```
Applies to taskId check: `if (!taskId)` covers `null`, `undefined`, `''` — the exact 4-scenario test matrix from SC#3.

**Logger child pattern preserved** (lines 357-358) — the existing `child({component, task_id})` only fires on the success path (already conditional on `if (logger)`). No change in success path.

**Critical literal** (D-08 byte-exact, SC#2 lockea):
```
'markSessionStatus: missing task_id'
```
Single space between colon and "missing". Keys `{session_id, status, reason}` — in this order documented but JS objects ignore key order; tests should match by key existence.

---

### `src/gsd/verify.js` — update callsite line ~267

**Analog (sibling parallel pattern):** `src/hooks/stop.js#188`

**Current code** (lines 266-270):
```javascript
try {
  markSessionStatus(session.task_id, 'review', 'gate-passed', log);
} catch {
  // intencionalmente vacío — ver comentario CR-01 arriba.
}
```

**Update pattern** (per D-07): pass `session.session_id` as 5th arg. `log` already in scope at line 110:
```javascript
try {
  markSessionStatus(session.task_id, 'review', 'gate-passed', log, session.session_id);
} catch {
  // intencionalmente vacío — ver comentario CR-01 arriba.
}
```

**Key invariant** (CONTEXT.md D-06): caller does NOT capture return value. `try/catch` envelope stays intact. Only the 5th arg changes.

**Verify.js findSession callsite** (line 83-86) — already tolerates `result.session` shape:
```javascript
const findSessionFn =
  deps.findSessionFn ||
  ((q) => {
    const r = findSession(q);
    return r ? r.session : undefined;  // ← only reads .session; .source addition is non-breaking
  });
```
**No change needed** for findSession integration here — D-01 tagged shape is additive.

---

### `src/hooks/stop.js` — update callsite line ~188

**Analog (sibling parallel pattern):** `src/gsd/verify.js#267` (above)

**Current code** (lines 186-193):
```javascript
try {
  const { markSessionStatus } = await import('../session/manager.js');
  markSessionStatus(session.task_id, 'done', 'session-stop', log);
} catch (err) {
  // WR-03: state.json mutation failure merits explicit diagnostic (NOT silent).
  // Still fail-open — runStopHook never crashes Claude Code.
  console.error(`[kodo:stop] markSessionStatus failed: ${(err).message}`);
}
```

**Update pattern** (D-07): `session.session_id` is in scope (visible at hook entry point). Pass as 5th arg:
```javascript
try {
  const { markSessionStatus } = await import('../session/manager.js');
  markSessionStatus(session.task_id, 'done', 'session-stop', log, session.session_id);
} catch (err) {
  console.error(`[kodo:stop] markSessionStatus failed: ${(err).message}`);
}
```

**WR-03 catch with console.error preserved** — Phase 30 changes NEITHER the catch nor the diagnostic format.

---

### `src/hooks/session-start.js` — verify-only line ~203 (NO change expected)

**Analog (verify caller tolerance):** `src/gsd/verify.js#83-86`

**Current code** (lines 203-209):
```javascript
const result = findSession({ sessionId, cwd });
if (!result) {
  // No tracked session for this directory — silent exit
  process.exit(0);
}

const { session } = result;
```

**Verification needed**: caller only checks truthy + destructures `.session`. The D-01 added `source` field is non-breaking. **Expected outcome: no edit needed.** Planner should add an assertion test that this caller still works post-extension (or leverage existing `test/session-start.test.js`).

---

### `test/session/find-session.test.js` (NEW — 4 scenarios LIFE-01)

**Analog A (test structure):** `test/state.test.js` lines 1-85 (basic state-store describe with `beforeEach` mkdirSync + writeState reset)
**Analog B (HOME-isolation):** `test/session-of-resolver.test.js` lines 35-134 (mkdtempSync + HOME override + dynamic import post-HOME for KODO_DIR cache)

**HOME-isolation scaffold to copy** (session-of-resolver.test.js lines 101-134):
```javascript
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let findSession;
let addSession;
let removeSession;

describe('LIFE-01 — findSession scans history', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-life01-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME — KODO_DIR is computed at module-load time.
    const stateMod = await import('../../src/session/state.js');
    findSession = stateMod.findSession;
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    writeFileSync(
      join(tmpHome, '.kodo', 'state.json'),
      JSON.stringify({ schema_version: 2, sessions: {} }) + '\n',
    );
  });

  // ... 4 scenarios
});
```

**SessionRecord construction pattern** (from session-of-resolver.test.js lines 142-154):
```javascript
const session = {
  session_id: 'sess-life01-active',
  task_id: 'task-active',
  task_ref: 'KL-active',
  gsd: false,
  status: 'running',
  provider: 'plane',
  project_id: 'p1',
  project_path: tmpHome,
  workspace_ref: 'workspace:active',
  started_at: new Date().toISOString(),
  summary: 'active session',
};
```

**Test prefix convention** (D-10 + CONTEXT.md Established Pattern from QUICK-08/REPORT-NN):
```
'LIFE-01 — findSession scans history'
```

**4 scenarios** (per D-10 + CONTEXT.md §specifics):
1. `it('returns {source: "sessions"} when session is active', ...)` — addSession + findSession by sessionId
2. `it('returns {source: "history"} when session was removed', ...)` — addSession + removeSession + findSession by sessionId
3. `it('priorities sessions over history when entry exists in both', ...)` — manually seed state.json with same session_id in both buckets, assert `source: 'sessions'` (D-02)
4. `it('returns null when session is in neither bucket', ...)` — clean state, findSession by sessionId returns null

**Manual state.json seed pattern** (for scenario 3 priority test):
```javascript
writeFileSync(
  join(tmpHome, '.kodo', 'state.json'),
  JSON.stringify({
    schema_version: 2,
    sessions: { 'task-X': { session_id: 'shared-id', task_id: 'task-X', /* ... */ } },
    history: [{ session_id: 'shared-id', task_id: 'task-X', ended_at: '...', /* ... */ }],
  }) + '\n',
);
```

---

### `test/session/mark-status.test.js` (NEW — 4 scenarios LIFE-02)

**Analog A (fakeLogger memSink):** `test/stop-state-transition.test.js` lines 65-80
**Analog B (warn capture):** `test/gsd-verify-integration.test.js#95`

**fakeLogger pattern to copy verbatim** (stop-state-transition.test.js lines 70-80):
```javascript
function makeLogger() {
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,   // ← critical: child() returns same logger so events survive .child() chains
  };
  return { logger, events };
}
```

**Test prefix convention** (D-10):
```
'LIFE-02 — markSessionStatus falsy task_id observability'
```

**4 scenarios** (per D-10 + CONTEXT.md §specifics):
1. `it('returns {ok:true, from, to} when task_id present and session exists', ...)` — addSession + markSessionStatus → assert no warn event + `{ok:true}` shape
2. `it('warns + returns {ok:false} when task_id is null', ...)`
3. `it('warns + returns {ok:false} when task_id is undefined', ...)`
4. `it('warns + returns {ok:false} when task_id is empty string', ...)`

**Warn-payload assertion pattern** (byte-exact per D-08):
```javascript
const { logger, events } = makeLogger();
const result = markSessionStatus(null, 'done', 'session-stop', logger, 'sess-abc');

assert.deepEqual(result, { ok: false, reason: 'missing-task-id' });
const warns = events.filter(e => e.level === 'warn');
assert.equal(warns.length, 1);
assert.equal(warns[0].msg, 'markSessionStatus: missing task_id');
assert.deepEqual(warns[0].fields, {
  session_id: 'sess-abc',  // ← from 5th arg (D-07)
  status: 'done',
  reason: 'session-stop',
});
```

**Sessionless fallback assertion** (when 5th arg omitted):
```javascript
const result = markSessionStatus(undefined, 'done', 'reason', logger);  // no 5th arg
assert.equal(warns[0].fields.session_id, 'unknown');  // D-07 fallback
```

---

## Shared Patterns

### State Persistence (loadState/saveState)

**Source:** `src/session/state.js` lines 93-106
**Apply to:** `findSession` extension (read history via same `loadState()` — D-04 same lookup keys, same data shape)

```javascript
export function loadState() {
  migrateStateIfNeeded();
  if (!existsSync(STATE_PATH)) return { schema_version: 2, sessions: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { schema_version: 2, sessions: {} };
  }
}
```
Note: `loadState()` does NOT init `history: []` — callers must `Array.isArray(state.history) ? state.history : []` defensively (pattern from `listHistory` line 144-147).

### Logger pattern (state.transition event preserved)

**Source:** `src/session/manager.js` lines 356-359 (preserved as-is in success path)
**Apply to:** `markSessionStatus` success branch only — falsy path uses `logger.warn` directly (NO `logger.child` call since `task_id` would be null).

```javascript
if (logger) {
  const log = logger.child({ component: 'session', task_id: taskId });
  stateTransition(log, { from: fromStatus, to: nextStatus, reason });
}
```

### Defensive prefix guard (early return)

**Source:** `src/labels.js#isGsdChild` lines 114-115
**Apply to:** `markSessionStatus` falsy taskId check, `findSession` Array.isArray history guard

```javascript
if (!Array.isArray(labels)) return false;  // defensive prefix
```

### Discriminated union return shape

**Source:** Phase 29-01 dispatcher `{action, code}` pattern (CONTEXT.md §code_context Reusable Assets)
**Apply to:** `findSession` return shape `{id, session, source}` AND `markSessionStatus` return shape `{ok, ...}`

### Test HOME-isolation

**Source:** `test/session-of-resolver.test.js` lines 102-134 (mkdtempSync + HOME override + dynamic import POST-HOME)
**Apply to:** Both new test files in `test/session/` subdirectory (D-10).

**Critical detail:** `state.js` computes `KODO_DIR` (and thus `STATE_PATH`) at module-load time from `homedir()`. The dynamic import MUST happen AFTER `process.env.HOME = tmpHome` is set, otherwise the cached module points at the real `~/.kodo/`.

### Try/catch silent in callers

**Source:** `src/gsd/verify.js#266-270` + `src/hooks/stop.js#186-193`
**Apply to:** D-06 preservation. Both callsites keep their try/catch (verify silent, stop with console.error). The 5th arg addition does not introduce any new throw path — only adds an optional positional argument.

## No Analog Found

None. All 7 files have direct or near-direct analogs in the existing codebase.

## Pitfalls & Gotchas

1. **`session-lookup.js` step-1 is NOT `findSession`** — it directly iterates `state.sessions` (line 33). LIFE-01 extending `findSession` does NOT automatically fix `kodo logs --session-of` for archived sessions. SC#1 ROADMAP lockea both `kodo gsd verify` AND `kodo logs --session-of`. Planner must decide:
   - Option A (recommended): `session-lookup.js` step-2 (head-line scan over `~/.kodo/logs/*.ndjson`) already works for archived sessions because NDJSON files outlive `state.sessions`. SC#1 already passes for `kodo logs --session-of` via this path.
   - Option B: refactor `session-lookup.js` step-1 to iterate `state.history` too. This is parallel scope-creep.

2. **History entry shape from `removeSession` lines 132-135** — `{...removed, ended_at}` (note: `ended_at`, NOT `archived_at` as CONTEXT.md D-04 says). Verify D-04 byte-exact during planning. CONTEXT.md says `archived_at` in one place and `ended_at` in another; **source code uses `ended_at`**.

3. **`listSessions()` in current `markSessionStatus` (line 353)** scans ONLY `state.sessions`. For the success-path `fromStatus` computation, this means archived sessions would show `'unknown'` as `from`. Phase 30 does NOT change this (only the falsy-taskId path). If a future caller wants `fromStatus` from history, that's a follow-up.

4. **JSDoc `Session` typedef** (state.js lines 11-33) does NOT document `history` array on State type. The current State typedef (line 32) is `{schema_version, sessions}` only. Optional D-09 cleanup: extend the typedef to include `history?: Array<Session & {ended_at: string}>`.

5. **Test subdirectory `test/session/` is new** (D-11). Verify `package.json` test glob includes it. Current convention is `node --test test/**/*.test.js` — the `**` should match it, but planner should confirm with `npm test` smoke-run.

## Metadata

**Analog search scope:** `src/session/*.js`, `src/gsd/verify.js`, `src/hooks/*.js`, `src/logs/*.js`, `src/labels.js`, `test/*.test.js`, `test/session/*` (empty)
**Files scanned:** 14 source + 12 test
**Pattern extraction date:** 2026-05-20
