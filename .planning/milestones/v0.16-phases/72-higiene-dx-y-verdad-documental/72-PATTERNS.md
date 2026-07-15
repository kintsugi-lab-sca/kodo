# Phase 72: Higiene, DX y verdad documental - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 15 modified (0 new source files; 4-5 new test files)
**Analogs found:** 15 / 15 (100% — self-referential hygiene phase; analogs are sibling patterns in the same files/modules)

> **Note on phase shape:** This is a mechanical-hardening / dead-code-removal / hook-lifecycle-refactor phase with **zero new capabilities and zero new files** (source). Every touchpoint is a **modification** of existing code, so the "closest analog" for each file is almost always a **pattern already present in the same module or a sibling module** — the planner copies the established local convention, not a foreign template. RESEARCH.md already verified every file:line at HEAD (2026-07-13) and supplies before/after excerpts; this map anchors each change to the concrete analog to copy from.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/hooks/stop.js` (HYG-01 gate) | hook | event-driven | `src/hooks/stop.js` idempotency-guard + early-return pattern (`session-end.js:71-74`) | exact |
| `src/orchestrator/launch.js` (HYG-01 inject) | provider/launch | transform (command-string build) | `launch.js:250-256` `claudeCmd` array-join | exact (same block) |
| `src/hooks/stop.js` (HYG-04 remove effects) | hook | event-driven | never-throws cmux effect blocks `stop.js:156-171` | exact (self) |
| `src/hooks/session-end.js` (HYG-04 add effects) | hook | event-driven | reserved slot after backstop `session-end.js:89-120` + never-throws catch pattern | exact |
| `src/cli.js` (HYG-02 remove `--url`) | cli/route | request-response | sibling `.option()`/`.action()` command defs `cli.js:72-84` | exact |
| `src/cli/up.js` (HYG-02) | cli | request-response | `runUp` deps destructure | role-match |
| `src/session/health.js` (HYG-03 delete loop) | service | batch/timer | `health.js` module (delete `startHealthLoop`/`stopHealthLoop`/`runHealthCheck` only) | exact |
| `src/cli.js` (HYG-05 M3 setNestedValue) | cli/config-edge | transform | `config-validate.js:setByPath` (`:149`) + guard convention | role-match |
| `src/cli.js` (HYG-05 M14 split→indexOf) | cli/config-edge | transform | `config.js:loadEnvFile` `indexOf('=')+slice` (`:19-22`) | exact (mirror) |
| `src/config.js` (HYG-05 B5 quote strip) | config | file-I/O | `loadEnvFile` parser `config.js:19-22` | exact (self) |
| `src/config.js` (HYG-05 B7 deep-merge/validate) | config | file-I/O | `config-validate.js` validators + `loadConfig` `config.js:161-169` | role-match |
| `src/config.js` (HYG-05 M5 chmod 0600) | config | file-I/O | `writeEnvVar` chmod-pre-rename `config.js:448-454` | exact (mirror) |
| `src/labels.js` (HYG-06 B1 opus) | utility | transform | whitelist `labels.js:29` | exact (1-line) |
| `src/providers/plane/client.js` (HYG-06 B2/B8/B12b/B12c) | provider | request-response | sibling config-read + regex + throttle in same file | exact |
| `src/gsd/verification.js` (HYG-06 B3/B12a) | service | transform | `must_haves` comparison `:~213`; YAML parser `:118` | exact |
| `src/gsd/verify.js` (HYG-06 B4) | service | transform | zero-pad match `verify.js:137,177,463` | exact |
| `src/gsd/roadmap.js` (HYG-06 M12 dash) | service | transform | header regex `roadmap.js:31` | exact (1-line) |
| `src/providers/registry.js` (HYG-06 B12d) | provider/factory | transform | github factory `registry.js:66-71` | exact |
| `src/hooks/install.js` (HYG-06 B9) | config/install | file-I/O | match predicates `install.js:82,111` | exact |
| `src/cli/dashboard/App.js` (HYG-07 M4 strip) | component | transform (render projection) | `format.js:57` CSI-strip regex (extend to OSC/C1) | role-match |
| `README.md` (HYG-08) | docs | — | existing README @ `cb98a6d` (delta only) | exact |

---

## Pattern Assignments

### `src/hooks/stop.js` — HYG-01 gate (hook, event-driven)

**Analog:** early-return-with-log guard pattern already used in `session-end.js:71-74` and the current `handleOrchestratorStop` (`stop.js:265-299`).

**Current code to change** (`stop.js:265-298`, `handleOrchestratorStop`):
```javascript
async function handleOrchestratorStop() {
  const { execSync } = await import('node:child_process');
  try {
    const status = execSync('git status --porcelain .claude/skills/', { cwd: KODO_ROOT, encoding: 'utf-8' }).trim();
    if (!status) { console.error('[kodo] Orchestrator session ended — no skill changes to commit'); return; }
    const date = new Date().toISOString().slice(0, 10);
    // ⬇ TODAY: add is `.claude/skills/` whole; commit has NO pathspec
    execSync(`git -c commit.gpgsign=false add .claude/skills/ && git -c commit.gpgsign=false commit -m "skill: orchestrator learnings ${date}"`, { cwd: KODO_ROOT, encoding: 'utf-8' });
    ...
```

**Gate to add** (D-06 — cover whole block, skip-silently-with-log, mirror of `session-end.js:63-66` early return):
```javascript
if (process.env.KODO_ORCHESTRATOR !== '1') {
  console.error('[kodo] Stop: no es sesión orquestadora (KODO_ORCHESTRATOR ausente) — skip auto-commit');
  return;
}
```

**Pathspec fix** (D-07 — literal success-criterion #1, BOTH steps `.claude/skills/kodo-orchestrate/`):
```javascript
execSync(
  `git -c commit.gpgsign=false add -- .claude/skills/kodo-orchestrate/ && ` +
  `git -c commit.gpgsign=false commit -- .claude/skills/kodo-orchestrate/ -m "skill: orchestrator learnings ${date}"`,
  { cwd: KODO_ROOT, encoding: 'utf-8' }
);
```

---

### `src/orchestrator/launch.js` — HYG-01 env injection (transform)

**Analog:** the `claudeCmd` array-join at `launch.js:250-258` (verified — array is `['claude', '--model', …].join(' ')`, sent via `cmux.send`, NOT `spawn`).

**Current** (`launch.js:250-258`):
```javascript
const claudeCmd = [
  'claude',
  '--model', config.claude.default_model,
  '--session-id', sessionId,   // (verify exact args at plan time)
  ...config.claude.flags,
  `'${escapedPrompt}'`,
].join(' ');
await cmux.send({ workspace: workspaceRef, text: claudeCmd + '\\n' });
```

**Injection** (D-07 — prefix env assignment into the shell command string, since there is no `child_process`):
```javascript
const claudeCmd = [
  'KODO_ORCHESTRATOR=1',   // ◄── inline shell env for `claude` + hook children
  'claude',
  ...
].join(' ');
```

> **A2 / Open Question #1 (MEDIUM confidence):** verify empirically in the first HYG-01 plan that the cmux shell propagates `VAR=val cmd` to the hook process. Robust fallback: file marker via existing `persistOrchestratorRef` (`~/.kodo/orchestrator.json`) read by `stop.js`.

---

### `src/hooks/stop.js` → `src/hooks/session-end.js` — HYG-04 lifecycle split (event-driven)

**Analog (source):** the three never-throws cmux effect blocks in `stop.js:156-171` (setColor) and `:234-243` (nudge send).
**Analog (destination):** the reserved insertion slot after the backstop, documented in the comment at `session-end.js:89-94` (Pitfall #5 confirms Phase 71 anticipated this).

**Effect blocks to MOVE** (each keeps its own try/catch — Pattern 2, never-throws individual):
```javascript
// stop.js:156-163 — setColor(review)  ── MOVE
try {
  await cmuxClient.setColor({ workspace: session.workspace_ref, color: colorForStatus('review') });
} catch (err) { console.error(`[kodo] Error setting color: ${err.message}`); }

// stop.js:165-171 — notify("… cerrada")  ── MOVE
try {
  await cmuxClient.notify({ title: `kodo: ${session.task_ref} cerrada`, body: session.summary, workspace: session.workspace_ref });
} catch {}

// stop.js:234-243 — nudge orchestrator (uses buildStopNudgeText)  ── MOVE
try {
  const workspaces = await cmuxClient.listWorkspaces();
  const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
  if (orchMatch) await cmuxClient.send({ workspace: orchMatch[1], text: buildStopNudgeText(session) });
} catch {}
```

**Stop KEEPS** (D-09 — not close-effects): idempotency guards, `markSessionStatus(...'idle'...)` (`stop.js:196`), GSD lock release (`stop.js:216-223`).

**Destination order in `session-end.js`** (D-08 — AFTER the backstop, at the END of the cleanup chain, each never-throws):
```
1. idempotency guards           (:61-74)
2. runReviewBackstop            (:95-120)  ← load-bearing DELIV-04
3. sessionEnd typed event       (:122-135)
4. releaseGsdLock backstop      (:137+)
5. performTerminalCleanup
6. ◄── HYG-04: setColor → notify → nudge (each own try/catch)   ← INSERT HERE
```

> **Pitfall #3:** `buildStopNudgeText` (`stop.js:41-56`) text says "ha terminado y está en Review" — a lie per-turn (Stop), true at real close (SessionEnd). Move the function's callsite (not necessarily the pure function itself, which is exported for tests) together with the effect.
> **Pitfall #4:** update guardrail tests in the SAME commit: `test/hooks/stop-idempotency.test.js`, `test/hooks/session-end.test.js`, and (if present) `test/stop.test.js`, `test/stop-state-transition.test.js`.

---

### `src/cli.js` — HYG-02 remove `kodo up --url` (route, request-response)

**Analog:** the sibling command `.option()`/`.action()` definitions in the same file (commander pattern).

**Delete** (`cli.js:75` the `--url` option line + `cli.js:83` the `{ url: opts.url }` arg):
```javascript
.option('--url <baseUrl>', 'Base URL del server kodo (…)')   // ⬅ DELETE (cli.js:75)
...
await runUp({ url: opts.url });   // ⬅ becomes  await runUp();  (cli.js:83)
```

> **Anti-pattern (RESEARCH):** do NOT touch `cli.js:381` — that is the `--url` of `kodo dashboard`, which `runDashboard` DOES read (`cli.js:386`). Only the `up` command's flag is dead.
> `src/cli/up.js`: drop the unused `deps.url` read (`runUp` computes `baseUrl` via `resolveBaseUrlFn`; `url` is swallowed).

---

### `src/session/health.js` — HYG-03 delete dead loop (service, timer)

**Analog:** N/A deletion. Remove ONLY `startHealthLoop` (`:157`), `stopHealthLoop` (`:167`), `runHealthCheck` (`:174`), and the module-level `healthInterval`.

> **Anti-pattern:** do NOT delete the file. `checkHealth`/`actOnHealth` in the same module are imported by `check.js:11,71,77` — keep them.
> Add a grep-test of absence for `startHealthLoop` (pattern: `labels-hygiene.test.js` style).

---

### `src/cli.js` — HYG-05 M3 reject prototype pollution (config-edge, transform)

**Analog:** `config-validate.js:setByPath` (`:149`) + the guard convention. `setNestedValue` def at `cli.js:551-559`, callsite `cli.js:42`.

**Add reject (not escape)** — RESEARCH Code Example:
```javascript
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) throw new Error(`Clave de config prohibida: ${k}`);
  }
  ...
}
```

---

### `src/cli.js` — HYG-05 M14 split→indexOf (config-edge, transform)

**Analog (mirror):** `config.js:loadEnvFile` already uses `indexOf('=')+slice` (`config.js:19-22`) — copy that idiom into `cli.js:36` (`--set`) and `cli.js:49` (`--map-project`).

**Current** (`cli.js:36`):
```javascript
const [key, value] = opts.set.split('=');   // truncates token=a=b=c
```
**Fix** (RESEARCH Code Example):
```javascript
const eq = opts.set.indexOf('=');
const key = eq === -1 ? opts.set : opts.set.slice(0, eq);
const value = eq === -1 ? undefined : opts.set.slice(eq + 1);
// idem for --map-project with indexOf(':')
```

> **Pitfall #1 [ASSUMED]:** CONTEXT D-11 mislabels M14 as "parser .env"; the real bug is at `cli.js:36,49`. The `.env` parser already uses `indexOf` (correct). Planner must confirm against the literal audit M14 (`cli.js:36,49`), and apply B5 (quote strip) — not M14 — to the `.env` parser.

---

### `src/config.js` — HYG-05 B5 quote strip (config, file-I/O)

**Analog (self):** the `loadEnvFile` parser body `config.js:19-22`.

**Add after `value = trimmed.slice(eq+1).trim()`** (RESEARCH Code Example — conservative, matched pairs only):
```javascript
if (value.length >= 2 &&
    ((value[0] === '"' && value.at(-1) === '"') ||
     (value[0] === "'" && value.at(-1) === "'"))) {
  value = value.slice(1, -1);
}
```

---

### `src/config.js` — HYG-05 B7 deep-merge + validate (config, file-I/O)

**Analog:** `config-validate.js` exported validators — `validatePositiveInt` (`:50`), `validateModel` (`:68`), `validateNonEmpty` (`:82`), `validateCmuxColor` (`:96`), `validateField` (`:110`), `getByPath`/`setByPath`. Wire into `loadConfig` (`config.js:161-169`).

**Current** (`config.js:164-169`):
```javascript
const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
return migrateConfigIfNeeded(parsed);
```

**Direction** (D-10 — deep-merge over `DEFAULT_CONFIG`, warn-and-fallback, NEVER crash): partial config deep-merges onto `DEFAULT_CONFIG`; invalid values (e.g. `max_parallel:-5`) fall back to default with an NDJSON warn. Reuse `config-validate.js` — do NOT duplicate validation. Keep the existing outer `try/catch { return {...DEFAULT_CONFIG} }` fail-open contract.

---

### `src/config.js` — HYG-05 M5 chmod 0600 (config, file-I/O)

**Analog (mirror):** `writeEnvVar` chmod-pre-rename at `config.js:448-454`:
```javascript
const tmp = envPath + '.tmp';
writeFileSync(tmp, content, { mode: 0o600 });
chmodSync(tmp, 0o600);   // exact 0600, PRE-rename, not subject to umask
renameSync(tmp, envPath);
```
Apply the same technique to the `.env` write path that today lands 0644 (audit points at `writeFileAtomic`/`config.js:100-104` context) when the file contains `*_secret`.

---

### HYG-06 batch — micro-diffs (Pattern 1: 1-5 lines + test per finding)

| Finding | File:line (HEAD) | Analog | Change |
|---------|------------------|--------|--------|
| **B1** opus whitelist | `labels.js:29` | self | `['sonnet','haiku']` → `['opus','sonnet','haiku']` |
| **B2** plane schema v1 | `plane/client.js:8,10,14` | `config.providers.*` reads elsewhere | `config.plane.*` → `config.providers.plane.*` |
| **B3** must_haves `<`→`!==` | `gsd/verification.js:~213` | self | `< total` → `!== total` (rejects `99/3`) |
| **B4** pad-coupled match | `gsd/verify.js:137,177,463` | self | decouple from 2-digit zero-pad |
| **B8** identifier regex | `plane/client.js:~289` `resolveIdentifier` | self | `/^([A-Z]+)-(\d+)$/i` → `/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/` |
| **B9** install match by path | `hooks/install.js:82,111` | self | substring `'kodo'` → canonical path match |
| **B12a** YAML inline `#` | `gsd/verification.js:118` | self | strip inline comment before parse |
| **B12b** throttle epoch | `plane/client.js:37,57` | self | detect epoch-vs-delta on `x-ratelimit-reset` |
| **B12c** 409 over-broad | `plane/client.js:263-264` | self | narrow `isNameConflict409` (drop `\|\| labels/`) |
| **B12d** github factory TypeError | `registry.js:66-71` | self | guard `config.providers?.github` → canonical message |
| **M12** dash in roadmap | `gsd/roadmap.js:31` | self | `(?::\s*\|\s+-\s+)` → `(?::\s*\|\s+[-–—]\s+)` |

**B8 analog excerpt** (`registry.js`-style regex fix; RESEARCH Pitfall #2 — re-grep for `parseRef` in case of 2 sites):
```javascript
// grep -n "A-Z.*\\d" src/providers/plane/client.js   before fixing
const re = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;  // accepts K2-42
```

**B12d analog** (`registry.js:66-71`, current):
```javascript
const github = config.providers?.github;   // undefined → createGitHubProvider(undefined) → cryptic TypeError
return createGitHubProvider(github);
```
Guard so a missing `github` block yields the canonical error message, not a raw `TypeError`.

> **Pitfall #6 (D-02):** B12b (throttle epoch-vs-delta) may exceed the ~5-line budget — if the header format cannot be confirmed cheaply, DEFER with a note in the SUMMARY rather than guess.

---

### `src/cli/dashboard/App.js` — HYG-07 strip `\x1b` (component, render transform)

**Analog:** the CSI-strip regex in `format.js:57` (`\x1b\[[\d;]*[A-Za-z]`) — but it only covers CSI, NOT the OSC-52 vector (`\x1b]`). Do NOT extend that regex; add a broad helper (Don't-Hand-Roll guidance).

**Injection point** `App.js:1696-1699` (Plane comment projection). RESEARCH Code Example:
```javascript
function stripControlChars(s) {
  return String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
lines = comments.map((c) => {
  const body = c.body ?? c.text ?? c.message;
  if (body == null) return stripControlChars(JSON.stringify(c));
  return stripControlChars(c.author ? `${c.author}: ${body}` : String(body));
});
```
Test payload: OSC-52 `\x1b]52;c;…\x07`.

---

### `README.md` — HYG-08 DELTA verification (docs)

**Analog:** the README already rewritten & CLI-audited @ `cb98a6d` (2026-07-10). This is a DELTA pass (D-04), NOT a rewrite. Runs LAST (D-05) because HYG-04 changes the described behavior ("stop hook posts comment & moves to In Review" → now `SessionEnd`). Verify each claim against the POST-72 state; touch only claims that became false. Also: remove any "health check cada 60s" promise (HYG-03 deletes the loop).

---

## Shared Patterns

### Never-throws / warn-and-continue (cross-cutting)
**Source:** every effect block wrapped in its own `try/catch` — `stop.js:156-171`, `session-end.js:118-135`; NDJSON logger `src/logger.js` + `logger-events.js`.
**Apply to:** HYG-04 (each moved effect individual catch), HYG-05 B7 (warn-and-fallback), all hook edits — a hook must NEVER crash Claude Code (`main()` always `process.exit(0)`).
```javascript
try { await cmuxClient.setColor({ ... }); }
catch (err) { console.error(`[kodo] Error setting color: ${err.message}`); }
```

### Atomic write + chmod 0600 pre-rename
**Source:** `config.js:448-454` (`writeEnvVar`).
**Apply to:** HYG-05 M5 (secret `.env` perms). Pattern: `writeFileSync(tmp,{mode:0o600})` → `chmodSync(tmp,0o600)` → `renameSync(tmp,dest)`.

### Idempotency guard / early-return-with-log
**Source:** `session-end.js:63-66` (no session → return), `:71-74` (`source==='history'` → return).
**Apply to:** HYG-01 gate (`KODO_ORCHESTRATOR!=='1'` → return), preserving Stop↔SessionEnd re-entry guards (D-09).

### Micro-diff + test-per-finding
**Source:** waves 1-3 of the same audit.
**Apply to:** all HYG-05/06/07 findings — 1-5 line diff, one unit test each. Runner: `node --test <file>.test.js`.

### DI-with-lazy-default resolvers
**Source:** `session-end.js:96-116`, `stop.js:179-187` (`deps.loggerFactory` else lazy `await import('../logger.js')`).
**Apply to:** any new deps threaded into hook/config edits for testability.

---

## No Analog Found

None. Every change has a direct in-repo analog (usually in the same file or module). New **test** files (Wave 0 gaps) follow the existing `node:test` `describe/it` + `assert/strict` convention shown in `test/labels.test.js:1-3`:

| New test file | Covers | Convention source |
|---------------|--------|-------------------|
| `test/config-hardening.test.js` | M3, M14, B5, B7, M5 | `test/config-validate.test.js`, `test/config-env-writer.test.js` |
| grep-test absence `startHealthLoop` | HYG-03 | labels-hygiene grep-test pattern |
| grep-test absence `--url` in `up` | HYG-02 | idem |
| `stripControlChars` OSC-52 test | HYG-07 | `test/dashboard-*.test.js` |

---

## Metadata

**Analog search scope:** `src/hooks/`, `src/config.js`, `src/config-validate.js`, `src/orchestrator/launch.js`, `src/cli.js`, `src/cli/up.js`, `src/session/health.js`, `src/labels.js`, `src/providers/{plane/client,registry}.js`, `src/gsd/{verification,verify,roadmap}.js`, `src/hooks/install.js`, `src/cli/dashboard/App.js`, `src/cli/format.js`, `test/`
**Files scanned:** ~18 source + test dir listing
**Pattern extraction date:** 2026-07-13
**Cross-reference:** RESEARCH.md §Re-verificación (all file:line verified at HEAD) is the authoritative before/after source; this map anchors analogs and shared conventions.
</content>
</invoke>
