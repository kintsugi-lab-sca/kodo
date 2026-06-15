# Phase 48: open-in-manager-core - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 6 (1 new, 5 modified)
**Analogs found:** 6 / 6 (100% — `focus.js` is a near-line-for-line template for the new file)

## File Classification

| New/Modified File | Status | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|--------|------|-----------|----------------|---------------|
| `src/cli/dashboard/open.js` | NEW | utility (pure launcher) | event-driven (fire-and-forget execFile) | `src/cli/dashboard/focus.js` | exact (direct clone) |
| `src/cli/dashboard/App.js` | MODIFIED | component (keypress router) | event-driven (keypress) | self — existing `if (input==='d')` / `key.return` handlers (lines 510-573) | exact (in-file mirror) |
| `src/cli/dashboard/index.js` | MODIFIED | provider (DI wiring) | request-response (config → prop) | self — existing `onFocus` wiring (lines 109-137) | exact (in-file mirror) |
| `src/providers/plane/normalize.js` | MODIFIED | transform (normalizer) | transform (raw → TaskItem) | self — `normalizeWorkItem` line 76 (the bug) | exact (one-line fix) |
| `src/config.js` | MODIFIED | config | CRUD (schema + migration) | self — `DEFAULT_CONFIG` (33-46) + `migrateConfig` (82-102) | exact (in-file mirror) |
| `test/dashboard/open.test.js` (likely new) | NEW | test | n/a | `test/dashboard/focus.test.js` + `test/dashboard/app-focus.test.js` | exact (clone) |

> Note: `test/format-isolation.test.js` is NOT modified — its walker (line 209) globs `src/cli/dashboard/**` and auto-covers the new `open.js` for free. No edit needed; the planner should treat it as a passive gate.

> Note: `src/providers/plane/client.js:8,24` is read-only reference context (it documents WHY `base_url` is the API host). It is NOT modified in this phase.

---

## Pattern Assignments

### `src/cli/dashboard/open.js` (NEW — utility, fire-and-forget launcher)

**Analog:** `src/cli/dashboard/focus.js` — clone the entire structure. This is the load-bearing template. Keep the header comment block style (decision rationale + divergences enumerated).

**Module header + exported arg constants** (`focus.js:1-55`): Mirror the `// @ts-check` + multi-line rationale header, then export literal arg constants exactly as `focus.js` does. `open` takes NO verb/flag — only the URL as a single positional arg, so there is no `OPEN_VERB`/`OPEN_FLAG` analog. Instead the divergence is the **protocol allowlist** (CONTEXT specifics + D-08).

```javascript
// focus.js:54-55 — the constant-export pattern to mirror (tests assert literal ordering)
export const FOCUS_VERB = 'select-workspace';
export const FOCUS_FLAG = '--workspace';
```

**Never-throws discriminant typedef** (`focus.js:57-62`): Clone the `@typedef` for `OpenResult`. Reuse the SAME `code` union shape (`ENOENT | NON_ZERO_EXIT | SPAWN_ERROR`) PLUS add the new protocol-reject code the planner names (CONTEXT D-08 / specifics — reject `file://`, `javascript:`, leading-`-`). Recommended: `'BAD_PROTOCOL'` (planner decides exact literal).

```javascript
// focus.js:60-61 — discriminant typedef to clone
/**
 * @typedef {{ ok: true }
 *   | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail: any }} FocusResult
 */
```

**DI signature + STRUCTURAL leak guard** (`focus.js:80-90`): Clone the destructured-args signature and the pre-Promise `typeof exec !== 'function'` TypeError guard. **KEY DIVERGENCE (CONTEXT, focus.js:21-22):** `open.js` DOES provide a default `binary = 'open'` (focus.js deliberately has NO binary default; for open, `'open'` is the canonical macOS binary). The `exec` param keeps the no-default structural leak guard.

```javascript
// focus.js:80-90 — signature + structural leak guard to clone
export function runFocus({ exec, ref, binary, timeoutMs = 5_000 }) {
  if (typeof exec !== 'function') {
    throw new TypeError(
      'runFocus: `exec` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
```

**Core execFile + never-throws collapse** (`focus.js:91-117`): Clone verbatim — the `try { exec(...) } catch { resolve SPAWN_ERROR }` wrapper plus the err-code branching (no err → ok; `'ENOENT'` → ENOENT; numeric code → NON_ZERO_EXIT; else → SPAWN_ERROR). The args array changes from `[FOCUS_VERB, FOCUS_FLAG, ref]` to `[url]` (single literal positional — OPEN-03 flag-injection mitigation).

```javascript
// focus.js:91-117 — never-throws core to clone (swap args array to [url])
return new Promise((resolve) => {
    try {
      exec(binary, [FOCUS_VERB, FOCUS_FLAG, ref], { timeout: timeoutMs }, (err, _stdout, _stderr) => {
        if (!err) { resolve({ ok: true }); return; }
        if (err.code === 'ENOENT') {
          resolve({ ok: false, code: 'ENOENT', detail: err.message ?? 'ENOENT' }); return;
        }
        if (typeof err.code === 'number') {
          resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: err.code }); return;
        }
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      resolve({ ok: false, code: 'SPAWN_ERROR',
        detail: err instanceof Error ? err.message : String(err) });
    }
  });
```

**NET-NEW (no analog) — protocol allowlist guard:** Must run BEFORE `exec`. Per CONTEXT specifics: allow only `http(s)`, reject `file://`/`javascript:`/leading-`-`. Validate with `new URL(url)` + `protocol` check inside try (URL parse can throw — collapse to the reject code, never throw). This is the only part of `open.js` with no codebase precedent; planner uses RESEARCH PITFALLS for the exact allowlist shape.

**Color-isolation invariant (focus.js:39-42):** import ONLY from `node:*` or pure internals. ZERO `picocolors`, ZERO `src/cli/format.js`. Auto-verified by `test/format-isolation.test.js:209`.

---

### `src/cli/dashboard/App.js` (MODIFIED — keypress router + message constants)

**Analog:** self. Three in-file mirror points.

**(1) Message constants block** — mirror `FOCUS_ERR_*` (lines 77-85) and `DISMISS_OK` (line 134). The success message clones `DISMISS_OK`'s shape (param ref, no `[!]` prefix); error messages clone `FOCUS_ERR_*` (`[!] … — press any key`). The no-URL string is LOCKED by Success Criteria #2.

```javascript
// App.js:77-85 — error-constant pattern (mirror for OPEN_ERR_*)
export const FOCUS_ERR_ZOMBIE = '[!] workspace gone (alive=false) — press any key';
export const FOCUS_ERR_ENOENT = '[!] cmux not found in PATH — press any key';
export const focusErrFailed = (code) => `[!] cmux focus failed (code ${code}) — press any key`;

// App.js:134 — SUCCESS-message reference (green + ref, NO [!] prefix). Model `opening PROJ-123…` on this.
export const DISMISS_OK = (taskRef) => `dismissed ${taskRef}`;
```

Required net-new constants (planner names exact literals; LOCKED ones marked):
- `OPEN_OK = (ref) => \`opening ${ref}…\`` — success (D-02, green via `setFooterColor('green')`).
- `OPEN_ERR_NO_URL = 'no task URL for this session'` — **LOCKED** (D-05 / SC#2). Note: this one has NO `[!]` and no `— press any key` per the locked wording; planner should confirm against SC#2 whether it carries the prefix. (CONTEXT D-05 quotes it bare.)
- `OPEN_ERR_ENOENT` / `OPEN_ERR_BAD_PROTOCOL` / `openErrFailed(code)` — mirror `FOCUS_ERR_*` format.

**(2) Keypress handler `if (input === 'o')`** — insert in list mode alongside the existing single-char handlers (after `if (input === 'd')`, line 528; before the arrow handlers). Mirror the `d`/`Enter` row-resolution + guard + never-throws-invoke + discriminant-mapping shape.

```javascript
// App.js:510-528 — `d` handler: row resolution + guard + state transition (mirror)
if (input === 'd') {
  const row = sel.index >= 0 ? filtered[sel.index] : null;
  if (!row) return;
  if (row.alive === true) {            // ← `o` REPLACES this with the no-URL guard (D-04/D-05)
    setFocusError(DISMISS_GUARD_ALIVE);
    setFooterColor('red');
    return;
  }
  ...
}

// App.js:548-572 — `Enter` handler: never-throws onFocus invoke + discriminant → message mapping (mirror)
const row = sel.index >= 0 ? filtered[sel.index] : null;
if (!row) return;
if (row.alive === false) { setFocusError(FOCUS_ERR_ZOMBIE); return; }
const result = await onFocus?.(row.workspace_ref);
if (result && !result.ok) {
  if (result.code === 'ENOENT') { setFocusError(FOCUS_ERR_ENOENT); }
  else { const n = result.detail ?? 'unknown'; setFocusError(focusErrFailed(n)); }
}
```

**`o` handler divergences from `Enter` (per CONTEXT):**
- **D-04:** NO `alive` guard — `o` works on alive/zombie/dismissed. The ONLY guard is "no `task_url`" (D-05): `if (!row.task_url) { setFocusError(OPEN_ERR_NO_URL); setFooterColor('red'); return; }`. Read `row.task_url` directly (already persisted; no fetch — distinct from the `c`/`l` async overlay handlers).
- **D-01/D-02:** On `{ok:true}`, set a transient GREEN success footer (focus.js stays silent; open does not): `setFocusError(OPEN_OK(row.task_ref)); setFooterColor('green');`.
- The success ref uses `row.task_ref` (same identifier the table shows), mirroring `DISMISS_OK(ref)`.

**(3) Clear-on-any-input** — already exists (lines 312-315), reused for free. The transient `opening …` footer clears on the next keystroke via the same mechanism (D-03 — NO dedicated timer). No change needed beyond setting `focusError`.

```javascript
// App.js:312-315 — clear-on-any-input (reused as-is for the transient success/error footer)
if (focusError != null) { setFocusError(null); return; }
```

**(4) Hints footer line** (line 621) — append `o open` to the existing dim hints string (CONTEXT decision "Hint de footer").

```javascript
// App.js:621 — current hints line (add `· o open`)
createElement(Text, { dimColor: true }, '↑↓ move · c comments · l logs · p plan · / filter (ps:state) · d dismiss · q quit'),
```

**Footer render (read-only context, SessionTable.js:277-281):** the footer already renders `focusError` colored by `footerColor` via ink `<Text color>`. No SessionTable change required for the message itself — it consumes the existing `focusError`/`footerColor` props.

---

### `src/cli/dashboard/index.js` (MODIFIED — DI wiring of `onOpen`)

**Analog:** self — the `onFocus` wiring (lines 109-137) is the exact template.

```javascript
// index.js:109-137 — onFocus DI wiring to mirror as onOpen
const { runFocus } = await import('./focus.js');
const execImpl = exec ?? (await import('node:child_process')).execFile;
const cmuxBin = loadConfig().cmux.binary;
const app = render(createElement(App, {
  baseUrl,
  onFocus: async (ref) => runFocus({ exec: execImpl, ref, binary: cmuxBin }),
}));
```

**Mirror for open:** lazy-import `runOpen` from `./open.js`, reuse the SAME `execImpl` (already resolved line 115 — do not re-import), pass a new `onOpen` prop: `onOpen: async (url) => runOpen({ exec: execImpl, url })`. The `open` binary defaults to `'open'` inside `open.js` (D-06 / focus.js divergence), so NO config read is needed for the binary — unlike `cmuxBin`. The `deps.exec` param already exists (line 86); reuse it for both.

---

### `src/providers/plane/normalize.js` (MODIFIED — the URL bug fix, OPEN-04)

**Analog:** self — line 76 is the bug.

```javascript
// normalize.js:76 — THE BUG: browse-URL built from context.baseUrl (the API host, per client.js:24)
url: `${context.baseUrl}/${context.workspaceSlug}/browse/${ref}`,
```

**Fix (D-06/D-07):** route the browse-URL through `web_url` (default `base_url`), NOT the API host. The `NormalizeContext` typedef (lines 5-13) must gain `webUrl?: string`. New construction: `${context.webUrl ?? context.baseUrl}/${context.workspaceSlug}/browse/${ref}`. The caller (provider that builds `NormalizeContext`) must pass `webUrl` from `config.providers.plane.web_url`.

**Why `context.baseUrl` is wrong (read-only context, client.js:8,24):**

```javascript
// client.js:8  — baseUrl = the API host
this.baseUrl = (opts.baseUrl || config.plane.base_url).replace(/\/$/, '');
// client.js:24 — that host is then concatenated with /api/v1 → it is NOT a web/browse host in split deploys
const url = new URL(`${this.baseUrl}/api/v1/workspaces/${this.workspaceSlug}${path}`);
```

**UNKNOWN-<seq> (D-08, SC#5):** planner decides WHERE this is handled — either normalize-time (don't emit `url` when `projectIdentifier` is unresolved, cf. the `'UNKNOWN'` fallback already at line 107 in `parseTriggerEvent`) or launch-time (`open.js` recognizes a `UNKNOWN-` prefix). Either way it is treated as "no URL" (footer), NOT a dead link.

> Planner caveat: the caller that constructs `NormalizeContext` and passes it to `normalizeWorkItem` must be located (grep `normalizeWorkItem(` across `src/providers/plane/`) so the new `webUrl` field is actually wired from config — the one-line `normalize.js` change is inert without it.

---

### `src/config.js` (MODIFIED — `web_url` schema + migration)

**Analog:** self — `DEFAULT_CONFIG.providers.plane` (33-46) + `migrateConfig` (82-102).

```javascript
// config.js:34-45 — DEFAULT_CONFIG.providers.plane (add web_url, default to base_url value)
providers: {
  plane: {
    base_url: 'https://tasks.kintsugi-lab.com',
    api_key_env: 'PLANE_API_KEY',
    workspace_slug: 'k-lab',
    projects: [],
    states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  },
},

// config.js:88-99 — migrateConfig v1→v2 plane block (add web_url with base_url fallback)
providers: {
  plane: {
    base_url: planeOld.base_url,
    api_key_env: planeOld.api_key_env,
    workspace_slug: planeOld.workspace_slug,
    projects: planeOld.projects || [],
    states: { trigger: planeOld.trigger_state || 'In Progress', ... },
  },
},
```

**Add (D-06):** `web_url` is OPTIONAL with default = `base_url`. Two patterns possible (planner picks):
- Static default in `DEFAULT_CONFIG`: `web_url: 'https://tasks.kintsugi-lab.com'` (same as base_url).
- Resolve-on-read: leave config sparse, default at the consumer (`web_url ?? base_url`). **Preferred** — it survives the v1→v2 migration without forcing the key (cf. the CFG-02 zero-breaking-change invariant noted in `getDefaultGithubProviderConfig`, lines 205-208: keys are NOT injected into existing configs unless needed). For migration (line 88-99), add `web_url: planeOld.base_url` so split-deploy migrated configs default the web host to the API host (the safe pre-fix behavior) until the operator sets it.

> Test-isolation caveat (memory 21811): `config.js` caches `KODO_DIR` at import. Config tests must redirect `process.env.HOME` BEFORE importing `config.js`.

---

### `test/dashboard/open.test.js` (NEW — unit) + App integration tests

**Analog:** `test/dashboard/focus.test.js` (unit) + `test/dashboard/app-focus.test.js` (integration).

**Unit (`focus.test.js:26-65`):** clone the 5-scenario structure — ok path + args ordering, ENOENT, NON_ZERO_EXIT, SPAWN_ERROR (sync-throw), leak guard (omit `exec` → TypeError). Add a 6th: protocol-reject scenario (`file://`/`javascript:`/leading-`-` → `BAD_PROTOCOL`, `exec` NEVER called). The fake-exec pattern (capture `{cmd,args,opts}`, `setImmediate(() => cb(...))`) is the template.

```javascript
// focus.test.js:35-51 — fake-exec capture + args-ordering assertion (clone, assert [url] single positional)
const exec = (cmd, args, opts, cb) => { captured = { cmd, args, opts }; setImmediate(() => cb(null, '', '')); };
const result = await runFocus({ exec, ref: 'workspace:5', binary: '/path/to/cmux' });
assert.deepEqual(result, { ok: true });
assert.deepEqual(captured.args, ['select-workspace', '--workspace', 'workspace:5']);
```

**Integration (`app-focus.test.js:23-46`):** clone the `ink-testing-library` + `render` + `stdin.write('o')` + 80ms `tick()` + `lastFrame()` harness. Assert: (a) `o` on a row with `task_url` invokes `onOpen` once with the literal URL + green `opening …` footer; (b) `o` on a row WITHOUT `task_url` → no-op (onOpen never called) + `no task URL for this session` footer; (c) clear-on-any-input restores the hints line. The `makeFetch`/SessionRecord fixture builders (lines 38-55+) are reusable as-is.

---

## Shared Patterns

### Never-throws `{ok}` discriminant (end-to-end)
**Source:** `src/cli/dashboard/focus.js:91-117` (producer) → `App.js:560-571` (consumer mapping)
**Apply to:** `open.js`, the `o` handler in `App.js`.
No throw ever reaches React; every failure mode collapses to `{ok:false, code, detail}`. The `exec` leak guard (TypeError) is the ONE deliberate sync-throw, and it lives BEFORE the Promise so it propagates synchronously (focus.js:81-84).

### Literal-stable message constants (exported for test equality)
**Source:** `App.js:73-140` (all `FOCUS_ERR_*` / `DISMISS_*` / `OVERLAY_*`)
**Apply to:** all new `OPEN_*` constants.
Export every footer string so tests import-and-assert without duplicating literals — kills code/render drift. `[!] … — press any key` for errors; bare `verb ref` (param) for success (mirror `DISMISS_OK`).

### Color-isolation (Phase 34 D-12, cross-milestone invariant)
**Source:** `focus.js:39-42`; verified by `test/format-isolation.test.js:208-219`
**Apply to:** `open.js` (and confirmed for `App.js`/`SessionTable.js`).
Modules under `src/cli/dashboard/**` import ONLY `node:*` or pure internals. Color exclusively via ink `<Text color>` name (`SessionTable.js:280`). The walker auto-scans the new `open.js` — no test edit needed.

### Lazy-import DI wiring in index.js
**Source:** `index.js:111-136`
**Apply to:** `onOpen` wiring.
`runOpen` lazy-imported; `execImpl` (line 115) reused for both `onFocus` and `onOpen`; new `async (url) => runOpen({exec, url})` prop. No new config read for the binary (`open` defaults inside the module).

### Literal-arg execFile (flag-injection mitigation, OPEN-03)
**Source:** `focus.js:93` (`[FOCUS_VERB, FOCUS_FLAG, ref]`)
**Apply to:** `open.js` (`[url]` single literal positional — NEVER a shell string).

---

## No Analog Found

| Concern | Role | Reason | Planner guidance |
|---------|------|--------|------------------|
| Protocol allowlist (`http(s)` only; reject `file://`/`javascript:`/leading-`-`) | guard inside `open.js` | No existing dashboard module validates a URL before `execFile` — `focus.js` passes a trusted `workspace_ref`, never an untrusted URL | Use RESEARCH PITFALLS §browser-open/execFile for the exact allowlist + `new URL()` parse-inside-try shape. Collapse parse failure to the reject discriminant (never throw). |
| `UNKNOWN-<seq>` detection locus | normalize-time vs launch-time | New decision (D-08); the `'UNKNOWN'` fallback at `normalize.js:107` is webhook-only, not the browse-URL path | Planner decides; see RESEARCH ARCHITECTURE for the URL round-trip. |

---

## Metadata

**Analog search scope:** `src/cli/dashboard/**`, `src/providers/plane/**`, `src/config.js`, `test/dashboard/**`
**Files scanned:** 11 (focus.js, App.js, index.js, SessionTable.js, normalize.js, client.js, config.js, focus.test.js, app-focus.test.js, format-isolation.test.js, + grep sweeps)
**Pattern extraction date:** 2026-06-11
