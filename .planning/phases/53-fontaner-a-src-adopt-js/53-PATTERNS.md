# Phase 53: Fontanería `src/adopt.js` - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 3 (1 NEW top-level module, 1 MODIFY, 1 NEW test)
**Analogs found:** 3 / 3 (all exact or strong matches — phase is mechanical composition of verified exports)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/adopt.js` (NEW) | service / orchestrator | request-response (POST) + CRUD (local write) | `src/session/manager.js` (`launchWorkItem` :170 / `buildSessionFromTask` :32) | exact inverse |
| `src/session/state.js` (MODIFY `saveState` :241-242) | store / persistence | file-I/O (atomic write) | `src/triggers/polling.js:149-154` (`saveStateCache`) | exact idiom |
| `test/adopt.test.js` (NEW) | test | unit | `test/session/find-session.test.js` (HOME-isolation) + `test/server/dismiss.test.js` (DI fakes) | exact scaffold |

**Cross-cutting analog:** `src/server/dismiss.js:99-142` — supplies BOTH the never-throws discriminant shape AND the fresh-reread TOCTOU guard precedent (applies to `src/adopt.js`).

## Pattern Assignments

### `src/adopt.js` (service / orchestrator, request-response + CRUD)

The whole module is the **exact inverse of `launchWorkItem`** (`createTask → addSession` replacing `provider.fetch → addSession → cmux.send`). It COMPOSES verified exports — almost no new logic. Three functions: `sanitizeAdoptionData` (pure), `buildSessionFromAdoption` (pure), `adoptSession` (async orchestrator).

**Imports pattern** — `state.js` exports + Node builtins ONLY (NO cmux, NO host, NO logger.js — see anti-patterns):
```javascript
// Mirror manager.js:8 (state import) + research recommendation.
import { findSession, addSession } from './session/state.js';
import { basename } from 'node:path';   // precedent: src/session/format.js:25,42
import { homedir } from 'node:os';      // precedent: src/config.js:4, logger-events.js:23
```
Note: `findSession` already calls `loadState()` internally (`state.js:342`), so the "fresh read before POST" guard does NOT need a separate `loadState` import — calling `findSession` IS the fresh read.

---

#### `buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath })` — PURE

**Analog:** `src/session/manager.js:32-66` (`buildSessionFromTask`). MIRROR field-for-field, but RECEIVE `workspaceRef`/`sessionId` as data (launch DERIVES them from `cmux.newWorkspace`/`randomUUID`) and OMIT all GSD + reconcile-owned fields.

**Field shape to copy** (from `manager.js:37-49`):
```javascript
return {
  workspace_ref: workspaceRef,           // DATA (launch derives via cmux.newWorkspace :223)
  session_id: sessionId,                  // DATA (launch derives via randomUUID :235)
  task_id: task.id,
  task_ref: task.ref,
  provider: providerName,
  project_id: task.projectId,
  summary: task.title,
  status: 'running',                      // literal — D-07 healthy/active
  started_at: new Date().toISOString(),
  project_path: projectPath,
  task_url: task.url,
  project_name: task.projectName,
};
```

**MUST OMIT** (the discriminating difference vs `buildSessionFromTask`):
- GSD spread block (`manager.js:55-64`): `gsd`, `gsd_mode`, `phase_id`, `brief`, `worktree_path`. Adoption takes NO `flags`/`phaseId`/`brief` input — there is no `getGsdMode` call and no `computeWorktreePath` (the human's ad-hoc session is not a kodo worktree).
- Reconcile-owned lifecycle fields: `dead_since`, `last_seen_alive`, `alive`, `tab_alive`, `process_alive`, `needs_input`, `state`. NONE of these appear in `buildSessionFromTask:37-66` either — confirmed absent. Adding them breaks the "reconcileTick is the SOLE writer of `alive`" invariant.

---

#### `sanitizeAdoptionData({ cwd, title, description }, homedirFn = homedir)` — PURE, NET-NEW

**Analog:** NONE exists. [VERIFIED in research] `src/logger.js` `redact()` walks log-record values by sensitive key name — wrong shape, wrong intent, private to the sink. This function is genuinely net-new. Only the PRIMITIVES have precedent:
- `basename` for the default title — `src/session/format.js:25,42` uses it for the same display purpose.
- `homedir()` redaction — repo idiom at `src/config.js:4`, `logger-events.js:23`.
- `homedirFn` DI default param for testability — mirror `dashboard/plan.js:69` `homedirFn` pattern (so tests don't depend on real `$HOME`).

**Mechanics (D-06; exact regex is Claude's Discretion per A2):**
1. `title = title ?? basename(cwd)` — default applied INSIDE the core (single source of truth).
2. Redact `homedirFn()` prefix → `~` in title/description.
3. Strip embedded absolute paths (conservative POSIX-segment regex). Add an explicit test `/Users/alex/secret → ~/secret`.
4. **Never embed transcript** = structural guarantee: the function has NO transcript parameter, so it cannot forward one. Document as the backstop.

---

#### `adoptSession({ provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title?, description? })` — ASYNC

**Analogs:** `manager.js:170-297` (flow being inverted, minus cmux branch) + `dismiss.js:111-141` (never-throws discriminant + try/catch collapse).

**Operation order (D-03):** `typeof`-gate → sanitize → guard (fresh `findSession`) → POST `createTask` → `buildSessionFromAdoption` → `addSession` (local write LAST).

**(1) typeof capability-gate** — analog `dispatcher.js:82` / `contract.test.js:578` (NOT in FROZEN-9 `TASK_PROVIDER_METHODS`):
```javascript
if (typeof provider.createTask !== 'function') {
  return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
}
```

**(2) double-adopt guard — fresh re-read TOCTOU**, analog `dismiss.js:113-121`:
```javascript
// dismiss.js does the fresh loadState() re-read INLINE for the 409 TOCTOU.
// adoptSession does the equivalent via findSession (which loadState()s internally):
const existing = findSession({ workspaceRef, cwd });   // FRESH read, immediately before POST
if (existing) {
  return { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: existing.session.task_id } };
}
```
**CRITICAL — guard keying (Pitfall, `dismiss.js:18,113`):** `findSession` does NOT key by `task_id`. Key by `{ workspaceRef, cwd }`. Internally (`state.js:358,361`): `workspaceRef` matches `session.workspace_ref`, `cwd` matches `session.project_path`. Therefore the consumer MUST pass the SAME value as both the guard `cwd` and the persisted `projectPath` for the `ALREADY_ADOPTED` test to fire on re-run.

**(3) POST `createTask` — provider signature is `{ projectId, title, description }`** [VERIFIED `plane/provider.js:280`]. Wrap in try/catch → `CREATE_FAILED` (mirror dismiss's never-throws collapse `dismiss.js:133-139`; LOUD propagation of provider context per Phase 52 D-08):
```javascript
let task;
try {
  task = await provider.createTask({ projectId, title: clean.title, description: clean.description });
} catch (err) {
  return { ok: false, code: 'CREATE_FAILED', detail: { message: err?.message ?? String(err) } };
}
```
Do NOT re-normalize — `createTask` already returns a canonical `TaskItem` (Phase 52 D-06). Calling `normalizeWorkItem`/`normalizeIssue` again yields undefined fields.

**(4) local write LAST + PERSIST_FAILED LOUD** — this is the ONE try/catch-to-code conversion that is genuinely net-new. `addSession` (`state.js:250`) is reused verbatim (same write class as launch `manager.js:272`):
```javascript
const session = buildSessionFromAdoption({ task, providerName, workspaceRef, cwd, sessionId, projectPath });
try {
  addSession(task.id, session);          // → saveState (now atomic, see state.js below)
} catch (err) {
  return { ok: false, code: 'PERSIST_FAILED', detail: {
    task_id: task.id, task_url: task.url,
    hint: 'recoverable via idempotent re-run',
    message: err?.message ?? String(err),
  } };
}
return { ok: true, task, session };
```
LOUD ≠ throw (D-03): the code is semantically loud + carries orphan coordinates (`task_id`+`task_url`); the consumer (CLI Phase 54) makes it noisy (exit ≠ 0 + stderr). Never swallow silently — kodo never deletes the orphan task.

**`addSession` signature** (`state.js:250`): `addSession(taskId, session, logger = noopLogger)` — call as `addSession(task.id, session)`.

---

### `src/session/state.js` — MODIFY `saveState` (:241-242) to atomic tmp+rename

**Analog:** `src/triggers/polling.js:149-154` (`saveStateCache`) — the canonical repo idiom, copied verbatim in shape. Second precedent at `src/cli/polling-daemon.js:79-82`.

**Current** (`state.js:241-242`):
```javascript
export function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
```

**Upgrade** — mirror `polling.js:151-153` (no `mkdirSync` needed here; `STATE_PATH` dir already exists by the time anything writes):
```javascript
export function saveState(state) {
  const tmp = STATE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}
```
**Import change:** add `renameSync` to the existing `import { readFileSync, writeFileSync, existsSync } from 'node:fs';` at `state.js:2`. (`polling.js` imports `renameSync` from `node:fs` — same source.)

**Blast-radius confirmations (do NOT skip — CONTEXT D-05 flagged):**
- `.bak` migration snapshot is PROVEN INDEPENDENT: `migrateStateIfNeeded` (`state.js:189-227`) writes the `.bak.<ts>` AND the migrated state via its OWN inline `writeFileSync` (`state.js:202,208`) — it never calls `saveState`. Upgrading `saveState` cannot touch the migration path. Regression guard already exists: `test/state/migration-backup.test.js:64-88`.
- All `saveState` injection sites (`server.js:7,608`, `session/reconcile.js` DI param) call the same export with the same signature — the new internals are invisible. Run full suite at wave merge to confirm reconcile/server tests stay green.
- darwin/Linux only: `renameSync(tmp, dest)` is POSIX-atomic on same filesystem; Win32 unsupported by design (documented `polling.js:141-144`).

---

### `test/adopt.test.js` (test, unit)

**Analogs:** `test/session/find-session.test.js:36-103` (HOME-isolation scaffold) + `test/server/dismiss.test.js:15-46` (DI fakes + spy + never-throws asserts).

**HOME-isolation scaffold** (copy `find-session.test.js:76-94` — CRITICAL: `state.js` caches `KODO_DIR`/`STATE_PATH` from `homedir()` at module-load, so the import MUST be dynamic and POST-`HOME`):
```javascript
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome, origHome, adoptSession;
before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-adopt-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  ({ adoptSession } = await import('../src/adopt.js'));   // DYNAMIC, post-HOME — adopt.js transitively imports state.js
});
after(() => {
  if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});
afterEach(() => writeFileSync(join(tmpHome, '.kodo', 'state.json'),
  JSON.stringify({ schema_version: 3, sessions: {}, history: [] }) + '\n'));
```

**Fake provider + spy** (mirror `dismiss.test.js:35-46` spy idiom + `contract.test.js` fake-provider object):
```javascript
const fakeTaskItem = { id: 'KL-99', ref: 'KL-99', title: 'adopt smoke', url: 'https://x/KL-99', projectId: 'p1', projectName: 'Proj' };
const fakeProvider = { createTask: async () => fakeTaskItem };
```

**Coverage map (Wave 0):**
- BIDIR-03 `UNSUPPORTED` — `adoptSession({ provider: {} })` → `r.code === 'UNSUPPORTED'`.
- BIDIR-03 `ok:true` seeds row — assert `r.session.status === 'running'` AND `r.session.dead_since === undefined` AND `r.session.alive === undefined` (the invariant assert).
- BIDIR-04 `ALREADY_ADOPTED` — adopt twice with a `createTask` call-counter; assert `calls === 1` (no second POST). Guard fires because seeded `project_path === cwd`.
- BIDIR-05 `PERSIST_FAILED` carries `task_id`+`task_url` — inject a throwing `addSession` (DI default param, see research Open Q2 — cleaner than read-only-dir trick) OR make state dir read-only.
- BIDIR-08 `sanitizeAdoptionData` — default title = `basename(cwd)`; homedir→`~` redaction; abs-path strip (`/Users/alex/secret → ~/secret`); structural no-transcript-param.

**Run:** `node --test test/adopt.test.js` (per-commit); `node --test` (full suite at wave merge).

## Shared Patterns

### Never-throws discriminant `{ ok, code, detail }`
**Source:** `src/server/dismiss.js:120,132,139` + `src/session/manager.js:411,424` (`markSessionStatus` variant: `{ ok:false, reason }` / `{ ok:true, from, to }`).
**Apply to:** `adoptSession`'s top-level return — 5-state taxonomy (D-01):
```javascript
{ ok: true, task, session }
| { ok: false, code: 'UNSUPPORTED'   , detail: { providerName } }
| { ok: false, code: 'ALREADY_ADOPTED', detail: { task_id } }
| { ok: false, code: 'CREATE_FAILED' , detail: { message } }
| { ok: false, code: 'PERSIST_FAILED', detail: { task_id, task_url, hint, message } }
```
Exact `code` strings are Claude's Discretion (A1) — coordinate spelling with Phase 54 CLI exit-code mapping.

### typeof capability-gate (NOT in FROZEN-9)
**Source:** `src/triggers/dispatcher.js:82` + `test/providers/contract.test.js:578`.
**Apply to:** the `createTask` call site in `adoptSession`. Detect by `typeof provider.createTask === 'function'`; NEVER add to `TASK_PROVIDER_METHODS` (`interface.js:52`).

### Atomic tmp+rename for durable writes
**Source:** `src/triggers/polling.js:149-154`.
**Apply to:** `saveState` (`state.js:241`) — all state writers (`addSession`/`updateSession`/`removeSession`) inherit it transparently.

### HOME-isolation dynamic-import test scaffold
**Source:** `test/session/find-session.test.js:76-94`.
**Apply to:** `test/adopt.test.js` — mandatory because `state.js` caches `KODO_DIR` at import. Static import = real `~/.kodo/state.json` mutation (Pitfall 5).

## No Analog Found

| File / Unit | Role | Data Flow | Reason |
|-------------|------|-----------|--------|
| `sanitizeAdoptionData` (function within `src/adopt.js`) | utility (pure) | transform | No reusable home-dir/path-redaction helper exists. [VERIFIED] `logger.js` `redact()` is log-record-by-key, wrong shape. Net-new pure backstop. Only its primitives (`basename`, `homedir`) have precedent. Planner picks the exact regex (A2) and adds the `/Users/... → ~/...` test. |

The other genuinely net-new piece — the `PERSIST_FAILED` try/catch-to-code conversion around `addSession` — has a structural analog in `dismiss.js:133-139`'s never-throws collapse; it is "no analog" only in that it converts a LOCAL-WRITE throw (not a read) into a discriminant code, which no existing module does. Follow the D-03 mechanics exactly.

## Metadata

**Analog search scope:** `src/session/` (manager.js, state.js), `src/server/dismiss.js`, `src/triggers/polling.js`, `src/providers/plane/provider.js`, `test/session/`, `test/server/`.
**Files scanned (read):** 7 source/test files + 2 planning docs.
**Pattern extraction date:** 2026-06-16
