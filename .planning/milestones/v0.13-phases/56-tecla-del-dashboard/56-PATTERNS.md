# Phase 56: Tecla del dashboard - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 7 (3 new src, 1 extended-helper src, 2 modified src, 3 new tests)
**Analogs found:** 7 / 7 (every surface has a verified 1:1 mold — zero net-new business logic)

> This is a **pure consumer** phase. Every piece clones a shipped, tested mold. The risk is fidelity, not invention: copy the leak-guard, never-throws, identity-stability and color-isolation shapes EXACTLY.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/adopt.js` (NEW) | utility (execFile orchestrator) | request-response (child process) | `src/cli/dashboard/open.js` (`runOpen`) + `focus.js` (`runFocus`) | exact (clone) |
| `src/cli/dashboard/select.js` (MODIFIED — add `computeAdoptable`, `resolveProjectId`) | utility (pure derive) | transform (set-difference + reverse-lookup) | `src/cli/dashboard/select.js` (`grepLogs`, `resolveSelection`, `mapDismissResult`) | exact (same file) |
| `src/cli/dashboard/App.js` (MODIFIED — `a` handler, picker mode, confirm mode, footer copies, help line) | component (ink/React) | event-driven (keystroke) → request-response | `App.js` itself (dismiss `d` confirm machine + `c`/`l`/`p` overlay machine + `o` open handler) | exact (same file) |
| `src/cli/dashboard/index.js` (MODIFIED — `getHost` wiring + `onAdoptDiscover`/`onAdopt` props) | config (DI wiring) | request-response | `index.js` itself (`onFocus`/`onOpen` lazy-import + prop wiring) | exact (same file) |
| `test/dashboard/adopt.test.js` (NEW) | test (unit) | request-response | `test/dashboard/open.test.js` | exact (clone) |
| `test/dashboard/select-adopt.test.js` (NEW) | test (unit) | transform | (no direct test analog for these derives — mold the structure of any `node:test` unit) | role-match |
| `test/dashboard/app-adopt.test.js` (NEW) | test (integration-light) | event-driven | `test/dashboard/app-dismiss.test.js` | exact (clone) |

---

## Pattern Assignments

### `src/cli/dashboard/adopt.js` (NEW — `runAdopt`)

**Analog:** `src/cli/dashboard/open.js:74-129` (primary) + `src/cli/dashboard/focus.js:80-118` (secondary).

**Leak guard + never-throws skeleton** (clone `focus.js:80-117` verbatim, swap the body):
```javascript
// open.js:74-83 / focus.js:80-90 — leak guard ANTES de new Promise (TypeError propaga sync)
export function runOpen({ exec, url, binary = 'open', timeoutMs = 5_000 }) {
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runOpen: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      exec(binary, [url], { timeout: timeoutMs }, (err, _stdout, _stderr) => {
        if (!err) { resolve({ ok: true }); return; }
        if (err.code === 'ENOENT') { resolve({ ok: false, code: 'ENOENT', detail: err.message ?? 'ENOENT' }); return; }
        if (typeof err.code === 'number') { resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: err.code }); return; }
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      resolve({ ok: false, code: 'SPAWN_ERROR', detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
```

**Divergences from `runOpen` (load-bearing — copy these exactly, NOT open.js's specifics):**
1. **NO `BAD_PROTOCOL` allowlist.** That's `open.js`-specific (`open.js:85-99`). The 4 argv values come from trusted host data + reverse-lookup; do NOT clone the `new URL()` guard. `AdoptResult` = `FocusResult` union only: `{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}`.
2. **argv is a LITERAL 8-element array, not a single positional.** `['adopt', '--workspace', workspaceRef, '--cwd', cwd, '--session-id', sessionId, '--project', projectId]`.
3. **Binary resolution diverges from BOTH `runOpen` and `runFocus`** — see Shared Pattern "kodo binary resolution". `binary` must be `process.execPath` and `kodoBin` is the first argv element: `exec(process.execPath, [kodoBin, 'adopt', ...8elems], ...)`. Recommended signature: `runAdopt({ exec, execPath, kodoBin, workspaceRef, cwd, sessionId, projectId, timeoutMs = 5_000 })`.
4. Keep `exec` with NO default (leak guard); keep `timeoutMs = 5_000`.

**⚠ Exit-code semantics:** `kodo adopt` returns 0/1/2 (config/transient). `runAdopt` maps `typeof err.code === 'number'` → `NON_ZERO_EXIT` with `detail` = the literal exit code (1 or 2). The footer shows `adopt failed (code N)`; do NOT reinterpret the semantics in the dashboard.

**Color isolation (D-08):** header comment must declare `node:*`-only imports, mirroring `open.js:41-44` / `focus.js:39-42`. CERO `picocolors`, CERO `src/cli/format.js`.

---

### `src/cli/dashboard/select.js` (MODIFIED — add `computeAdoptable` + `resolveProjectId`)

**Analog:** same file. Mold the pure-derive shape of `resolveSelection` (`select.js:78-84`) and `grepLogs` (`select.js:268`).

**`resolveSelection` clamp pattern** (mold for the picker cursor clamp `[0, len-1]`, no wrap):
```javascript
// select.js:78-84 — pure, React-free, identity-keyed selection with clamp
export function resolveSelection(rows, selectedTaskId, prevIndex = 0) {
  if (rows.length === 0) return { index: -1, taskId: null };
  const idx = rows.findIndex((r) => r.task_id === selectedTaskId);
  if (idx !== -1) return { index: idx, taskId: selectedTaskId };
  const clamped = Math.max(0, Math.min(prevIndex, rows.length - 1));
  return { index: clamped, taskId: rows[clamped].task_id ?? null };
}
```

**`computeAdoptable` (D-02, D-05 Phase 55, Pitfall 5):** filter `kind === 'claude'` AND `sessionId ∉ statusSessions[].session_id` in ONE pass. Key by `sessionId`, NEVER `workspaceRef`. Source of `statusSessions` = the live `/status` snapshot already in React state (`sessions`, `App.js:266` area) — NOT a fresh `state.json` read. Shape per RESEARCH.md:343-360:
```javascript
export function computeAdoptable(surfaces, statusSessions) {
  const tracked = new Set((statusSessions ?? []).map((s) => s.session_id).filter(Boolean));
  return (surfaces ?? []).filter(
    (s) => s.kind === 'claude' && s.sessionId && !tracked.has(s.sessionId),
  );
}
```

**`resolveProjectId` (D-05, ancestor-match recommended):** reverse-lookup `cwd → projectId` against `loadProjects()` shape (VERIFIED `Record<string,string>`, `config.js:142-151`). Returns `{ projectId } | { error: 'none'|'ambiguous' }`. Pure (no `realpathSync` I/O — normalize with `path.normalize`/trailing-slash strip only). Algorithm in RESEARCH.md:227-243.

**Color isolation:** these stay `node:*`-only. `select.js` already passes the walker.

---

### `src/cli/dashboard/App.js` (MODIFIED — `a` handler + picker + confirm + footer + help)

**Analog:** App.js itself. Three molds to copy:

**(1) Footer copy constants** — mold `OPEN_OK`/`DISMISS_*` (`App.js:135-158`):
```javascript
// App.js:135 / :137 / :143 / :158 — literal-stable copies (tests assert these strings)
export const DISMISS_CONFIRM = (taskRef) => `dismiss ${taskRef}? press d again · Esc cancel`;
export const DISMISS_OK = (taskRef) => `dismissed ${taskRef}`;
export const DISMISS_ERR = (reason) => `[!] dismiss failed (${reason}) — press any key`;
export const OPEN_OK = (ref) => `opening ${ref}…`;   // single-char ellipsis …, not ...
```
Add the adopt copies per RESEARCH.md:365-370 (`ADOPT_NONE`, `ADOPT_CONFIRM`, `ADOPT_OK`, `ADOPT_NO_PROJECT`, `ADOPT_ERR_ENOENT`, `adoptErrFailed`).

**(2) Double-confirm machine** — mold the dismiss `mode:'confirm'` branch (`App.js:445-477`):
```javascript
// App.js:445-476 — armed-by-identity confirm; entering confirm does NOT set footer (so
// clear-on-any-input does not eat the 2nd key); only `d` executes, anything else cancels
if (mode === 'confirm') {
  if (input === 'd') {
    if (!armedTaskId) { setArmedTaskRef(null); setMode('list'); return; }  // WR-01 guard
    const res = await dismissSession(baseUrl, armedTaskId, fetchFn);
    // ...map result to footer text + color...
    setArmedTaskId(null); setArmedTaskRef(null); setMode('list');
    return;
  }
  setArmedTaskId(null); setArmedTaskRef(null); setMode('list');  // Esc + any other key cancels
  return;
}
```
And the arming site (`App.js:622-624`): `setArmedTaskId(row.task_id); setArmedTaskRef(...); setMode('confirm');`.

**⚠ Pitfall 2 (key collision — THE delicate decision):** the branch hardcodes `if (input === 'd')`. Adopt's 2nd key is `a`. Add a discriminator: new state `armedSessionId` (adopt arms by `sessionId`, NEVER `task_id` — the surface is not a `/status` row) and route the 2nd key by which armed-id is set: `armedSessionId != null` → `a` executes adopt; `armedTaskId != null` → `d` executes dismiss. Esc/other cancels both. Do NOT reuse `armedTaskId` for adopt.

**(3) Overlay picker** — mold the `mode:'overlay'` branch (`App.js:418-439`) + the `c`/`l`/`p` open handlers (`App.js:513-606`):
```javascript
// App.js:418-438 — overlay sub-mode: Esc closes (invalidates in-flight via overlayReqRef++),
// ↑/↓ scroll the frozen snapshot, everything else swallowed while reading
if (mode === 'overlay') {
  if (key.escape) { overlayReqRef.current++; setMode('list'); setOverlayKind(null); return; }
  if (key.upArrow) { setScrollOffset((o) => Math.max(0, o - 1)); return; }
  if (key.downArrow) { /* clamp to lines.length - OVERLAY_VIEWPORT */ return; }
  return;
}
```
```javascript
// App.js:513-553 — `c` overlay open: CR-01 reqId guard around the await, frozen snapshot,
// setMode('overlay'). The `p` handler (App.js:587-606) is the SYNC variant (no reqId, atomic open).
if (input === 'c') {
  const row = sel.index >= 0 ? filtered[sel.index] : null;
  if (!row) return;
  const reqId = ++overlayReqRef.current;
  const res = await fetchComments(baseUrl, row.task_id, fetchFn);
  if (overlayReqRef.current !== reqId) return;   // closed/superseded during await
  setOverlaySnapshot({ kind: 'comments', taskRef: ..., status, lines });
  setOverlayKind('comments'); setScrollOffset(0); setMode('overlay');
  return;
}
```
**⚠ Pitfall 3:** the c/l/p overlay only SCROLLS (`↑/↓` move `scrollOffset`); the picker needs a SELECTABLE cursor. Recommendation (Open Q1): add `overlaySnapshot.kind === 'adopt'` carrying `adoptable[]` + a cursor index, and route `↑/↓` to move the cursor (clamp `[0, len-1]`, no wrap — mold `resolveSelection`) when kind is `'adopt'`, keeping the `mode` typedef at 4 states (D-08 minimal).

**(4) The `a` handler** — mold the `o` open handler (`App.js:627-665`) for the async never-throws + footer-mapping shape:
```javascript
// App.js:647-664 — onOpen?.() never-throws result → footer color mapping (mold for onAdopt)
const result = await onOpen?.(row.task_url);
if (!result || result.ok !== false) { setFocusError(OPEN_OK(...)); setFooterColor('green'); }
else if (result.code === 'ENOENT') { setFocusError(OPEN_ERR_ENOENT); setFooterColor('red'); }
else { const n = result.detail ?? 'unknown'; setFocusError(openErrFailed(n)); setFooterColor('red'); }
```
The `a` handler (in `mode:'list'`, mold the `d` handler shape at `App.js:608-625`): call `onAdoptDiscover?.()` (typeof-gated upstream) → `computeAdoptable(...)` → if empty/unsupported set footer `ADOPT_NONE` and stay in list (D-03) → else open the adopt picker overlay.

**(5) Help line** — extend `App.js:760`:
```javascript
createElement(Text, { dimColor: true }, '↑↓ move · c comments · l logs · p plan · / filter (ps:state) · d dismiss · o open · q quit'),
```
Add `· a adopt` (placement is Claude's discretion).

**Props to add** to the `App` typedef/destructure (`App.js:190-212` area, mold `onFocus`/`onOpen` JSDoc): `onAdoptDiscover` and `onAdopt`.

---

### `src/cli/dashboard/index.js` (MODIFIED — host wiring + props)

**Analog:** index.js itself (`onFocus`/`onOpen` wiring, `index.js:109-144`).

**Lazy-import + prop wiring mold** (`index.js:111-144`):
```javascript
// index.js:111-118 — lazy imports (same pattern for runAdopt + getHost)
const { runFocus } = await import('./focus.js');
const { runOpen } = await import('./open.js');
const execImpl = exec ?? (await import('node:child_process')).execFile;
const cmuxBin = loadConfig().cmux.binary;   // index.js:125

// index.js:134-144 — render with onFocus/onOpen props (add onAdoptDiscover/onAdopt here)
const app = render(createElement(App, {
  baseUrl,
  onFocus: async (ref) => runFocus({ exec: execImpl, ref, binary: cmuxBin }),
  onOpen: async (url) => runOpen({ exec: execImpl, url }),
}));
```

**Additions (RESEARCH.md:322-345):**
- `const { runAdopt } = await import('./adopt.js');`
- `const { getHost } = await import('../../host/interface.js');` then `const host = getHost('cmux', { exec: execImpl, binary: cmuxBin });` — `getHost` factory verified at `interface.js:96-103`; `:91` JSDoc designates "el wiring del dashboard" as a caller.
- `kodoBin` resolution (see Shared Pattern below) — NOTE the depth: `dashboard/index.js` is ONE level deeper than `cli/polling.js`, so three `..`.
- `onAdoptDiscover: async () => typeof host.listAgentSurfaces === 'function' ? host.listAgentSurfaces() : []` (typeof-gated, fail-open — `listAgentSurfaces` is NOT in `HOST_METHODS`, verified `cmux.js:315`).
- `onAdopt: async ({ workspaceRef, cwd, sessionId, projectId }) => runAdopt({ exec: execImpl, execPath: process.execPath, kodoBin, workspaceRef, cwd, sessionId, projectId })`.

**Do NOT touch** the alt-screen toggle (`:132`/`:162`), SIGTERM handler (`:150-153`), or the non-TTY guard (`:90-93`). Phase 56 is additive DI only.

---

### `test/dashboard/adopt.test.js` (NEW)

**Analog:** `test/dashboard/open.test.js:1-168` (clone, drop the BAD_PROTOCOL scenario).

5 scenarios to clone (`open.test.js:34-137`): (1) ok path + assert argv ordering literal of the 8 elements `['adopt','--workspace',ref,'--cwd',cwd,'--session-id',sid,'--project',pid]` AND `cmd === process.execPath` with `kodoBin` as `args[0]`; (2) ENOENT → `{ok:false,code:'ENOENT'}`; (3) `err.code=1` (numeric, the config exit) AND `err.code=2` (transient) → `NON_ZERO_EXIT` with `detail:1`/`detail:2`; (4) sync-throw → `SPAWN_ERROR` (never-throws, assert promise does NOT reject); (5) leak guard → omit `exec` → `assert.rejects` TypeError. The fake `exec` capture pattern is `open.test.js:35-53`.

---

### `test/dashboard/select-adopt.test.js` (NEW)

**Analog:** no direct test mold for these specific derives — use plain `node:test` + `node:assert/strict` (mold the imports of `open.test.js:28-31`).

Cover: `computeAdoptable` (filters `kind==='claude'`, diffs by `sessionId`, ignores `workspaceRef`, handles null/empty inputs); `resolveProjectId` (exact match, ancestor match, none → `{error:'none'}`, ambiguous equal-length prefixes → `{error:'ambiguous'}`, trailing-slash normalization).

---

### `test/dashboard/app-adopt.test.js` (NEW)

**Analog:** `test/dashboard/app-dismiss.test.js:1-160` (clone the harness + state machine assertions).

**Critical mold pieces:**
- **`drain()` with 80ms `setTimeout`** (`app-dismiss.test.js:87-89`) — load-bearing per Pitfall 1; ink does NOT await async handlers, so chained keystrokes (2nd `a` must see `mode:'confirm'`) need the 80ms frame. NOT `setImmediate`.
- **`injectProps` + fake clock + URL router** (`app-dismiss.test.js:34-79, 129-146`) — the `app-adopt` test needs `onAdoptDiscover`/`onAdopt` as INJECTABLE props (stubs returning a fixed `AgentSurface[]` and a fixed `{ok}`), counting `onAdopt` calls (mold the `deletes[]` counter for "zero adopt on cancel/no-project").
- Scenarios to mold from dismiss (a)-(f) (`app-dismiss.test.js:148+`): `a` → picker frame; select + `a` → `ADOPT_CONFIRM` armed; 2nd `a` → `onAdopt` called once + `ADOPT_OK` frame; Esc cancels (zero `onAdopt`); no-project surface → `ADOPT_NO_PROJECT` footer + zero `onAdopt`.

**Host stub for discovery:** for a richer host fixture, mold `test/host/contract.test.js` `fakeExecFromFixtures` + `surface-resume-show.json` (canonical_refs) — but for the App-level test a plain `onAdoptDiscover` stub returning `AgentSurface[]` is sufficient.

---

## Shared Patterns

### kodo binary resolution (D-06, Claude's Discretion — RESOLVED)
**Source:** `src/cli/polling.js:180-183` (`resolveKodoBin`) + spawn site `polling.js:283-294`.
**Apply to:** `index.js` (resolve `kodoBin`), `runAdopt` (invoke via `process.execPath`).
```javascript
// polling.js:180-183 — absolute path, zero PATH lookup (EoP mitigation A6)
function resolveKodoBin() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'kodo');
}
// polling.js:283-289 — spawn shape: process.execPath is the binary, KODO_BIN is argv[0]
const KODO_BIN = resolveKodoBin();
spawn(process.execPath, [KODO_BIN, 'polling', 'start', ...], {...});
```
**⚠ DIVERGENCE from `runOpen`/`runFocus`:** they call `execFile(binary, args)` with `binary` a direct executable. `runAdopt` must call `execFile(process.execPath, [kodoBin, 'adopt', ...])` because `bin/kodo` is a `#!/usr/bin/env node` script (Pitfall 4). **DEPTH ⚠:** `dashboard/index.js` is one level deeper than `cli/polling.js` → use THREE `..`: `join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'kodo')`.

### typeof-detected optional host method (D-01)
**Source:** `interface.js:215` comment ("`typeof host.listAgentSurfaces === 'function'`"), `cmux.js:315` (method present, NOT in `HOST_METHODS`).
**Apply to:** `index.js` `onAdoptDiscover` wiring. Fail-open to `[]` if absent.

### never-throws + footer color mapping (D-07)
**Source:** `App.js:647-664` (`o` handler `setFocusError`/`setFooterColor`), `App.js:410-413` (clear-on-any-input).
**Apply to:** the adopt confirm-execute branch in `App.js`.

### Color isolation walker (D-08)
**Source:** `test/format-isolation.test.js:200-221` (scans `src/cli/dashboard/**` automatically).
**Apply to:** `adopt.js` + the new `select.js` exports — `node:*`/internal-pure imports only. Auto-verified, no new test needed.

### Zero new endpoints (invariant since v0.10)
**Source:** `src/server.js` (7 fixed routes). **Apply to:** the whole phase — `git diff --stat src/server.js` must be EMPTY. Discovery is in-process via the host; no `GET /surfaces`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `test/dashboard/select-adopt.test.js` | test (unit) | transform | No existing test targets pure derive helpers in isolation in this exact shape; use generic `node:test` structure. Low risk — the functions under test are trivial pure functions. |

Every src surface has an exact or same-file mold. The only "gap" is a unit-test file whose subject is new pure helpers; the test framework and assertion style are fully established.

---

## Metadata

**Analog search scope:** `src/cli/dashboard/`, `src/host/`, `src/config.js`, `src/cli/polling.js`, `test/dashboard/`.
**Files scanned (read):** `open.js`, `focus.js`, `App.js` (3 ranges), `index.js`, `select.js` (2 ranges), `config.js` (loadProjects), `polling.js` (resolveKodoBin), `interface.js` (getHost), `cmux.js` (signature grep), `open.test.js`, `app-dismiss.test.js`.
**Pattern extraction date:** 2026-06-17
