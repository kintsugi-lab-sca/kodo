# Phase 39: Paneles auxiliares — comentarios + logs - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 5 (2 modified core, 2 helper-host, 1 test)
**Analogs found:** 5 / 5 (all in-repo, exact role+flow matches)

> Toda la fase vive bajo `src/cli/dashboard/` y reusa patrones de las Phases 35/36/37/38 — NO hay
> que inventar arquitectura nueva. Cada archivo nuevo tiene un análogo EXACTO en su propio módulo.
> Invariantes cross-milestone que el planner DEBE preservar: never-throws `{ok}` en el cliente,
> color-isolation (cero picocolors bajo `dashboard/`, blindado por `test/format-isolation.test.js`),
> selección por `task_id` (nunca índice), cero endpoints nuevos en `src/server.js`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/client.js` (+`fetchComments`, +`fetchLogs`) | data-client | request-response | `fetchStatus` (same file, lines 47-58) | exact |
| `src/cli/dashboard/App.js` (+`mode:'overlay'`, +`overlayKind`, +`scrollOffset`, +snapshot) | provider/controller (root state + useInput) | event-driven (keyboard) | `mode:'filter'` mode-gate (same file, lines 213-313) | exact |
| `src/cli/dashboard/SessionTable.js` (overlay chrome) | component (presentational) | transform/render | `filterLine`/`errorLine` + `cell` helper (same file, lines 49-59, 138-159) | exact |
| `src/cli/dashboard/select.js` (+`grepLogs` pure helper) | utility (pure derive) | transform | `parseFilter`/`applyFilter` (same file, lines 97-152) | exact |
| `test/dashboard-table.test.js` (or new `dashboard-overlay.test.js`) | test | event-driven (ink-testing) | `dashboard-table.test.js` harness + `dashboard-client.test.js` for client units | exact |

## Pattern Assignments

### `src/cli/dashboard/client.js` — `fetchComments` + `fetchLogs` (data-client, request-response)

**Analog:** `fetchStatus` in the same file. Copy its shape VERBATIM — try/catch never-throws, injectable
`fetchFn`, optional `AbortSignal`, discriminated `{ok}` return. D-02/D-07 require the same contract.

**Core never-throws pattern** (`client.js` lines 47-58 — copy structure exactly):
```javascript
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    const res = await fetchFn(`${baseUrl}/status`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json(); // puede lanzar (JSON corrupto) → cae al catch
    if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Adaptations for the two new fns (D-07 discriminated empty/error states):**
- `fetchComments(baseUrl, taskId, fetchFn = globalThis.fetch, signal)`:
  - URL: `` `${baseUrl}/comments/${encodeURIComponent(taskId)}` `` (server resolves by `task_id` — D-02).
  - Server returns `{ comments: [...] }` on 200 (`src/server.js` line 435), `404 {error:'Session not found'}`,
    `500 {error}`. The shape guard should be `if (!Array.isArray(data.comments)) return {ok:false,error:'bad shape'}`.
  - **D-07 needs the 404 distinguishable from 5xx/network.** `fetchStatus` collapses all HTTP non-ok to
    one `HTTP ${status}` string — that is INSUFFICIENT here. Recommend either returning the `status`
    in the result (`{ok:false, error, status: res.status}`) OR a discriminant `code: 'not-found'|'http'`
    so App.js can pick "task not found" (404) vs "error fetching comments" (5xx/network). The empty case
    (`comments.length === 0` → "no comments yet") is `{ok:true, data:{comments:[]}}` — empty is NOT an error.
- `fetchLogs(baseUrl, fetchFn = globalThis.fetch, signal)`:
  - URL: `` `${baseUrl}/logs` `` → server returns `{ logs: [...] }` (`src/server.js` line 417).
  - **Log entry shape is `{ ts, level, msg }`** (`src/server.js` lines 23-28, buffer reversed newest-first).
    Guard: `if (!Array.isArray(data.logs)) return {ok:false,error:'bad shape'}`. The grep/match is a SEPARATE
    pure step (see `select.js` below) — `fetchLogs` only fetches the shared buffer, never filters.

**Doc to update in this file:** the YAGNI comment at lines 28-29 ("`fetchComments` / `fetchLogs` quedan
diferidos a Phases 36/38") is now stale — Phase 39 implements them. Update the header comment.

---

### `src/cli/dashboard/App.js` — `mode:'overlay'` sub-mode (provider/controller, event-driven)

**Analog:** the existing `mode:'list'|'filter'` mode-gate in the same `useInput` callback. Phase 39 adds a
THIRD mode. The header comment at lines 33-49 and the Esc reservation note (line 41 / line 310) explicitly
reserve Esc "para overlays de Phase 38/39" — that reservation is now consumed.

**State declaration pattern** (`App.js` lines 153-162 — mirror these `useState` lines):
```javascript
const [mode, setMode] = useState(/** @type {'list' | 'filter'} */ ('list'));
const [query, setQuery] = useState('');
const prevIndexRef = useRef(0);
```
Phase 39 widens `mode` to `'list' | 'filter' | 'overlay'` and adds (D-06):
- `overlayKind: 'comments' | 'logs' | null`
- `scrollOffset: number` (reset to 0 on open)
- `overlaySnapshot` — the FROZEN content captured at open time (D-05). This is the load-bearing decision:
  the table keeps polling underneath (keep-last-good, Phase 35 — do NOT stop the poll), but the overlay
  renders the snapshot, not live data. Mirror the keep-last-good discipline already in `onResult`
  (`App.js` lines 166-184): a background poll never overwrites what the operator is reading.

**Mode-gate routing pattern** (`App.js` lines 230-313 — copy the gate structure):
```javascript
if (mode === 'filter') {
  if (key.escape) { setQuery(''); setMode('list'); return; }   // Esc cancels (modal scope)
  if (key.return) { setMode('list'); return; }
  if (key.backspace || key.delete) { /* pop / exit */ return; }
  if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);
  return;
}
// mode === 'list'
if (input === 'q') { exit(); return; }
if (input === '/') { setMode('filter'); return; }
if (key.upArrow) { /* move derived index, re-pin selectedTaskId */ return; }
if (key.downArrow) { /* ... */ return; }
// key.escape: DELIBERADAMENTE ignorado en modo lista (reservado Phase 38/39)
```

**New overlay branch (D-01/D-05/D-06) — add as a guard at TOP of the callback (before `mode==='filter'`):**
```javascript
if (mode === 'overlay') {
  if (key.escape) { setMode('list'); setOverlayKind(null); return; } // restore cursor (selectedTaskId untouched)
  if (key.upArrow) { setScrollOffset((o) => Math.max(0, o - 1)); return; }   // scroll, NOT row-nav
  if (key.downArrow) { setScrollOffset((o) => Math.min(maxOffset, o + 1)); return; }
  return; // swallow everything else while reading
}
```
**Opening the overlay from `list` mode** (add to the `mode==='list'` block, mirror the `'q'`/`'/'` handlers):
- `c` → resolve selected row (`const row = sel.index >= 0 ? filtered[sel.index] : null`, exact pattern at
  `App.js` lines 284-285) → `await fetchComments(baseUrl, row.task_id, fetchFn)` → freeze result into
  `overlaySnapshot`, set `overlayKind:'comments'`, `mode:'overlay'`, `scrollOffset:0`.
- `l` → `await fetchLogs(baseUrl, fetchFn)` → run the pure `grepLogs` helper against `row.task_ref` /
  `row.workspace_ref` → freeze the matched lines into `overlaySnapshot`.
- Reuse the EXISTING async-handler precedent (Phase 37 Enter handler is already `async` and `await`s
  `onFocus` — `App.js` lines 213-214, 296). The `c`/`l` handlers `await fetch*` the same way.
- **Esc preserves the cursor for free**: `selectedTaskId` is never touched on overlay open/close, so
  `resolveSelection` re-derives the same row on return (D-06, contract from `select.js` lines 74-80).

**`useInput` is gated by `{ isActive: isRawModeSupported }`** (`App.js` line 312) — keep that; do not add a
second `useInput`.

**Render wiring** (`App.js` lines 330-353): pass the overlay props down to `SessionTable` (or render a
sibling overlay component). Mirror how `focusError`/`hostError` are threaded as props (lines 348-349).

---

### `src/cli/dashboard/SessionTable.js` — overlay chrome (component, transform/render)

**Analog:** the `filterLine` / `errorLine` conditional-footer pattern + the `cell` width helper, same file.
The overlay chrome (header + scrollable body + footer hints) is the same React.createElement-plano style.

**Conditional modal line pattern** (`SessionTable.js` lines 138-159 — the overlay header/footer copy this):
```javascript
const filterLine =
  mode === 'filter'
    ? h(Box, { marginTop: 1 }, h(Text, null, `/ ${query}▏`))
    : null;

const footerError = focusError ?? hostError;
const errorLine =
  footerError != null
    ? h(Box, { marginTop: 1 }, h(Text, { color: 'red' }, footerError))
    : null;
```

**Fixed-width cell helper** (`SessionTable.js` lines 49-59 — reuse for aligned overlay rows, e.g. log
`level`/`ts` columns):
```javascript
function cell({ width, text, color, dim, bold, truncate }) {
  return h(Box, { width },
    h(Text, { color, dimColor: dim, bold, wrap: truncate ? 'truncate-end' : undefined }, text));
}
```

**Color-isolation invariant (D-12, Discretion note in CONTEXT line 72):** all overlay color comes from
`<Text color="...">` ink props (string names like `'red'`, `'cyan'`, `'yellow'` from `STATE_BADGES`
`format.js` lines 121-126). ZERO picocolors, ZERO ANSI inline. `test/format-isolation.test.js` walks this
file automatically and will fail loud on any color import.

**Overlay-specific render (Claude's Discretion — CONTEXT lines 71-75):**
- **Comments overlay header**: e.g. `comments · <task_ref>` (cyan/bold), body = comment list, footer hint
  `↑↓ scroll · Esc close`. Empty/error copy per D-07: "no comments yet" / "task not found" /
  "error fetching comments" — render as a single dim/red line, mirror `emptyCopy` at lines 169-177.
- **Logs overlay header**: MUST carry the honesty label (D-04, SC#3) — explicitly state it is a grep over a
  SHARED buffer and "may include other sessions" (NOT a per-session tail). This label is load-bearing
  (CONTEXT lines 155-157), not cosmetic. Empty copy: "no log lines match this session".
- **Viewport/scroll**: slice the snapshot by `scrollOffset` against the available height (viewport size is
  Discretion). Mirror the column-body `Box{flexDirection:'column'}` at line 229.

> Note: SessionTable is currently a single presentational table. The overlay full-screen mode (D-01 "ocupa
> el área de la tabla") can be either (a) a new conditional branch at the TOP of `SessionTable` (early-return
> the overlay instead of the table when `mode==='overlay'`), or (b) a new sibling `Overlay.js` component
> rendered by App.js when `mode==='overlay'`. Both honor the precedent; (b) keeps SessionTable's "dumb table"
> charter cleaner — planner's call, but if (b), the new file copies the same `cell`/`filterLine` patterns.

---

### `src/cli/dashboard/select.js` — `grepLogs` pure helper (utility, transform)

**Analog:** `applyFilter` / `parseFilter` in the same file. The log grep is a pure, ink-free, React-free
substring filter — exactly the `String.includes` anti-ReDoS pattern (D-03, Security V5 / T-36-01).

**Pure substring-filter pattern** (`select.js` lines 135-152 — copy the `String.includes` discipline):
```javascript
export function applyFilter(rows, parsed, deriveRepo) {
  return rows.filter((r) => {
    if (parsed.text) {
      const hay = `${r.task_ref ?? ''} ${deriveRepo(r)} ...`.toLowerCase();
      if (!hay.includes(parsed.text)) return false;   // substring, NEVER a compiled regex
    }
    return true;
  });
}
```

**New helper signature (D-03):**
```javascript
/**
 * Grep best-effort de líneas de log que mencionan la sesión. SUBSTRING puro (anti-ReDoS):
 * casa por task_ref/workspace_ref contra `entry.msg` (lowercased). El buffer es COMPARTIDO
 * y NO garantiza session_id por línea — por eso es best-effort y el header lo etiqueta (D-04).
 *
 * @param {Array<{ts:string, level:string, msg:string}>} logs  // shape de src/server.js:23
 * @param {{ task_ref?: string, workspace_ref?: string }} session
 * @returns {Array<{ts:string, level:string, msg:string}>}
 */
export function grepLogs(logs, session) {
  const needles = [session.task_ref, session.workspace_ref]
    .filter(Boolean).map((s) => s.toLowerCase());
  if (needles.length === 0) return [];
  return logs.filter((e) => {
    const hay = (e.msg ?? '').toLowerCase();
    return needles.some((n) => hay.includes(n)); // OR over refs, substring only
  });
}
```
- **D-03 critical:** do NOT try to parse `session_id` per line — the buffer does not guarantee that field;
  substring-only avoids an empty overlay during real activity. This mirrors the `parseFilter` decision to
  never compile a regex from operator input.
- Lives in `select.js` (derive layer) NOT `format.js` (presentation). It is a filter/derive, not a cell
  projector. Color-isolation applies identically (no picocolors import).

---

### `test/dashboard-table.test.js` (or new `dashboard-overlay.test.js`) — overlay tests (test, event-driven)

**Analog A — overlay interaction (ink render + keypress):** `test/dashboard-table.test.js`. Reuse the
hermetic harness VERBATIM (CONTEXT note + file header lines 17-20): `makeFakeClock` (lines 44-81),
`injectProps` (lines 87+), `drain`, fake `okResponse`. ink@4 has no `waitUntilExit()` — assert via
`lastFrame()` after draining microtasks and firing the fake `schedule`. Drive `c`/`l`/`Esc`/`↑`/`↓` via
the ink-testing-library `stdin.write(...)` API (see existing filter tests for the keypress idiom:
`test/dashboard-filter.test.js`).

**Analog B — client units (never-throws discriminant):** `test/dashboard-client.test.js` (lines 49-70).
Reuse `makeFetch` and the fetch-leak guard (`before`/`after` swapping `globalThis.fetch` for a thrower,
lines 31-40). Cover the D-07 matrix for both new fns:
- `fetchComments`: 200+comments → `{ok:true}`; 200+empty array → `{ok:true, comments:[]}` (NOT error);
  404 → distinguishable "not found"; 500 → error; ECONNREFUSED → error; corrupt JSON → error.
- `fetchLogs`: 200+logs → `{ok:true}`; 200 bad shape → `{ok:false}`; 500/network/corrupt → error.

**Analog C — pure helper unit:** `test/dashboard-select.test.js`. `grepLogs` is a pure fn — test it with
plain assertions (substring match, OR over refs, empty needles → `[]`, no-match → `[]`), no ink/host needed.

**Color-isolation:** `test/format-isolation.test.js` already walks all of `src/cli/dashboard/` — any new
overlay file is auto-covered; no new isolation test needed unless a new file is added outside the walk root.

## Shared Patterns

### Never-throws `{ok}` discriminant (client layer)
**Source:** `src/cli/dashboard/client.js` lines 47-58.
**Apply to:** `fetchComments`, `fetchLogs`. Every failure mode (network, HTTP non-ok, corrupt JSON, bad
shape) collapses to `{ok:false}`; never propagate an exception into React (Pitfall 12). Empty-but-valid
(`comments:[]`, no matching logs) is `{ok:true}` — emptiness is a UI state, not an error.

### Mode-gated `useInput` sub-modes
**Source:** `src/cli/dashboard/App.js` lines 213-313.
**Apply to:** the new `'overlay'` mode. Each mode is a top-level branch in ONE `useInput` callback; keys
not handled by the active mode are swallowed (early `return`). The clear-on-any-input guards for
`focusError`/`hostError` (lines 221-229) run BEFORE the mode-gate — preserve that ordering.

### Conditional modal footer line
**Source:** `src/cli/dashboard/SessionTable.js` lines 138-159 (`filterLine`/`errorLine`).
**Apply to:** overlay header (honesty label), empty/error copy, and footer hints. Same
`h(Box,{marginTop:1}, h(Text,{...}, ...))` shape; color only via `<Text color>`.

### Pure substring filter (anti-ReDoS)
**Source:** `src/cli/dashboard/select.js` lines 135-152 (`applyFilter`).
**Apply to:** `grepLogs`. `String.includes` only — never compile a regex from a ref string. Pure,
ink-free, testable without a host.

### Selection by identity (cursor preservation)
**Source:** `src/cli/dashboard/select.js` lines 74-80 (`resolveSelection`) + `App.js` lines 284-285.
**Apply to:** overlay open (resolve the selected row by `task_id`, then read `task_id`/`task_ref`/
`workspace_ref` off it) and overlay close (do NOT touch `selectedTaskId` → cursor restored for free, D-06).

### Color-isolation
**Source:** invariant enforced by `test/format-isolation.test.js` (walks `src/cli/dashboard/`).
**Apply to:** every new/modified dashboard file. Color from `<Text color>` ink props only; zero picocolors,
zero `src/cli/format.js` import, zero ANSI inline.

### Literal-stable message constants
**Source:** `App.js` lines 72-87 (`FOCUS_ERR_*`, `HOST_ERR_*` exported for tests to import & assert).
**Apply to:** the D-07 overlay copy ("no comments yet", "task not found", "error fetching comments/logs",
"no log lines match this session") and the D-04 logs honesty label. Export them so tests assert equality
without duplicating strings (kills code/test drift).

## No Analog Found

None. Every file has an exact in-repo analog. No RESEARCH.md was needed — the codebase already contains the
full pattern set from Phases 35-38.

## Cross-cutting Notes for the Planner

- **Zero new server endpoints (v0.9 invariant):** `GET /comments/<task_id>` (`src/server.js` 421-441) and
  `GET /logs` (415-419) already exist and are consumed by the browser dashboard. Phase 39 touches
  `src/server.js` ONLY for the D-08 doc-wording check (PROJECT.md, not server code).
- **D-08 doc fix:** verify `.planning/PROJECT.md` ~line 32 wording on `/logs` says "best-effort substring
  grep" (NOT "filtered by session_id"). CONTEXT line 68 says it is already partially correct — confirm no
  residual incorrect wording elsewhere; if none, mark SC#4 satisfied.
- **Snapshot vs live (D-05):** the table poll keeps running under the overlay (keep-last-good intact). The
  overlay renders the FROZEN snapshot captured at open, never live data — prevents text jumping under the
  reader. This is the single most load-bearing behavioral decision.
- **Logs honesty label (D-04, SC#3):** mandatory in the logs overlay header. The grep is over a SHARED
  buffer with no per-line session_id; the operator must not believe it is a reliable per-session tail.

## Metadata

**Analog search scope:** `src/cli/dashboard/` (client, App, SessionTable, select, format),
`src/server.js` (endpoints + log buffer shape), `test/` (dashboard-* harnesses).
**Files scanned:** 9 (4 dashboard source, 1 server, 4 test/listings).
**Pattern extraction date:** 2026-06-02
