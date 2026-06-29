---
phase: 53-fontaner-a-src-adopt-js
reviewed: 2026-06-16T11:05:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/adopt.js
  - src/session/state.js
  - test/adopt.test.js
  - test/state/save-state-atomic.test.js
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 53: Code Review Report

**Reviewed:** 2026-06-16T11:05:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the 0-token adoption core (`src/adopt.js`) and the atomic `saveState` upgrade
(`src/session/state.js`), plus their two unit suites. The orchestration skeleton of
`adoptSession` is sound: the 5-state discriminant is correctly wired, the capability gate
fires before any POST, the idempotency guard does a fresh read, and the PERSIST_FAILED
orphan path carries `task_id` + `task_url` and never throws or swallows. The
`buildSessionFromAdoption` omission invariant holds and is well-tested. The tmp+rename
atomicity is structurally correct.

The dominant concern is the **path-sanitization regex in `redactPaths`**, the explicit
information-disclosure surface for this phase. It has several confirmed leak paths where
absolute filesystem layout (and home-directory layout) escapes to the external task
manager verbatim or corrupted. The tests assert only the happy-path home prefix and a
single non-home strip; they do not cover the leak cases, so this shipped green. There are
also robustness gaps in the never-throws contract and the atomic-write durability claim.

## Critical Issues

### CR-01: `redactPaths` leaks absolute paths through multiple regex gaps (information disclosure)

**File:** `src/adopt.js:54`
**Issue:** The negative lookbehind `(?<![\w:/~.])` over-excludes, and the leading-`/`
anchor under-matches. Several real inputs cross the local→external trust boundary with
filesystem layout intact. Confirmed by direct execution of the regex:

1. **Double-slash paths survive verbatim.** A `//`-rooted run (common after naive path
   joins, normalized URLs-without-scheme, or `path.posix.join('/', '/x')`) is skipped
   because the first `/` is immediately followed by another `/`, which the lookbehind
   `[/]` then blocks on the second:
   - `"//etc/secret"` → `"//etc/secret"` (NOT redacted)
   - `"//Users/bob/secret"` → `"//Users/bob/secret"` (NOT redacted)
2. **Home-substring corruption / partial leak.** Home redaction uses naive
   `split(home).join('~')` with no boundary check. A sibling user whose name is a
   superset of the current user leaks its tail:
   - home `/Users/alex`, input `/Users/alexandra/secret` → `"~andra/secret"`
     — the string `andra/secret` leaks AND the result is a corrupted nonsense path.
3. **Paths immediately preceded by `:` survive.** The lookbehind excludes `:` to spare
   `http://`, but this also spares any `key:/abs/path` shape:
   - `"path:/Users/bob/x"` → `"path:/Users/bob/x"` (NOT redacted) — full absolute path
     leaks to the external system.
4. **Empty/falsy `home` disables step (1) silently.** If `homedirFn()` ever returns `''`
   (e.g. a stubbed/containerized env), `if (home)` is false and home redaction is skipped
   entirely; only step (2) runs. Combined with gaps 1–3 this widens the leak.

Because `sanitizeAdoptionData` is documented as the *backstop* defending the trust
boundary "even if a downstream consumer forgets to sanitize," a backstop that passes
absolute paths through is the one finding that must block. The existing tests
(`adopt.test.js:185-196`) only assert `notEqual(verbatim)` on a single happy case and
never exercise `//`, `:/`, or superset-username inputs.

**Fix:** Redact home by path-segment boundary, not raw substring, and tighten the
abs-path matcher to catch `/`-rooted runs regardless of a preceding `:` or a second `/`.
Anchor on a true boundary (start-of-string or whitespace/`(`/`=`), and match one-or-more
`/segment`:

```js
function redactPaths(str, home) {
  let out = str;
  // (1) Home redaction at a path boundary so '/Users/alexandra' is NOT matched
  //     by home '/Users/alex'. Escape regex metachars in `home`.
  if (home) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc + '(?=$|/|\\s)', 'g'), '~');
  }
  // (2) Strip remaining absolute paths. Anchor on a real left boundary
  //     (start | whitespace | one of ([{=,) and require at least one segment.
  //     Still spare URLs by excluding a preceding scheme via the alternation.
  out = out.replace(
    /(?<=^|[\s([{=,])(?<!:\/)\/{1,2}[^\s/]+(?:\/[^\s]*)?/g,
    '<path>',
  );
  return out;
}
```

Whatever the final expression, add regression tests for: `//etc/secret`, `path:/abs`,
home-superset usernames (`/Users/alexandra/...`), and empty `home`.

## Warnings

### WR-01: `saveState` tmp+rename is not crash-durable — no fsync before rename

**File:** `src/session/state.js:241-245`
**Issue:** The upgrade gives atomicity *within the filesystem's metadata ordering* but
the test suite header and the adopt comment both claim "durable" / "no torn writes." On
most platforms `writeFileSync` does not fsync the file data, and `renameSync` does not
fsync the containing directory. A power loss after `rename` returns can still leave
`state.json` pointing at a zero-length or partially-flushed inode — the rename is durable
but the *data* may not be. This is the exact torn-write class the phase claims to close
(BIDIR-05). `save-state-atomic.test.js` "round-trips durably" only proves in-process
read-back, which cannot observe a missing fsync.

**Fix:** If true durability is in scope, fsync the temp file and the directory before/after
rename:

```js
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';

export function saveState(state) {
  const tmp = STATE_PATH + '.tmp';
  const data = JSON.stringify(state, null, 2) + '\n';
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, STATE_PATH);
  // Optional: fsync KODO_DIR fd so the rename itself is durable.
}
```

If full fsync durability is explicitly out of scope, downgrade the "durable" wording in
the test/comments to "atomic (no torn reader)" so the guarantee is not overstated.

### WR-02: Concurrent adopt/save can lose writes via a shared `.tmp` path

**File:** `src/session/state.js:242`
**Issue:** The temp filename is a fixed constant `STATE_PATH + '.tmp'`. Two concurrent
writers (e.g. an adopt orchestrator plus a reconcile tick, or two adopt CLIs) both write
the same `.tmp` and both rename it; the last `writeFileSync` wins and one caller's full
state — including a freshly seeded adoption row — is silently clobbered. The
`addSession` read-modify-write in `state.js:252-255` (loadState → mutate → saveState) is
already a non-atomic RMW, so this is a real lost-update window, not theoretical. The
adopt orphan-recovery story leans on "idempotent re-run," but a lost *local* write with a
successful POST is precisely the PERSIST-without-throw case that produces a silent orphan
the code is trying to avoid.

**Fix:** Use a unique temp name per write so renames never collide, e.g.
`STATE_PATH + '.tmp.' + process.pid + '.' + randomUUID()`, and accept that lost-update
across the RMW still needs a higher-level lock if true concurrency is expected. At minimum
the unique tmp name prevents two writers from corrupting each other's *partial* tmp file.

### WR-03: `adoptSession` is not actually never-throws — synchronous inputs can throw before the try/catch

**File:** `src/adopt.js:159-170`
**Issue:** The contract (and header) promise a never-throws discriminant, but several
pre-POST steps run *outside* any try/catch and can throw on hostile/edge inputs:

- `provider.createTask` is read via `typeof provider.createTask` — if `provider` itself
  is `null`/`undefined`, line 159 throws `TypeError: Cannot read properties of null`.
- `sanitizeAdoptionData({ cwd, ... })` → `basename(cwd)` (line 73) throws
  `TypeError` if `cwd` is `undefined` (e.g. caller omits it on the title-defaulting path).
- `findSessionFn({ workspaceRef, cwd })` → `loadState` → `JSON.parse` is guarded, but a
  thrown custom `findSession` dep is not wrapped.

For a function whose entire value proposition is "never throws, always returns a
discriminant," these uncaught synchronous throws break the contract. The tests never pass
`provider: null` or omit `cwd`.

**Fix:** Either document a precondition that `provider`, `cwd`, `workspaceRef`,
`sessionId`, `projectPath` are non-null resolved DATA (and validate at the entry,
returning a discriminant code like `INVALID_INPUT`), or wrap the whole body. Minimal:

```js
if (!provider || typeof provider.createTask !== 'function') {
  return { ok: false, code: 'UNSUPPORTED', detail: { providerName } };
}
```
and guard `cwd`/required string args at the top.

### WR-04: `description: undefined` is forwarded to `createTask` and may serialize as `null`/leak the key

**File:** `src/adopt.js:76, 180`
**Issue:** `sanitizeAdoptionData` returns `description: undefined` when no description was
provided, and `adoptSession` spreads `description: clean.description` into the
`createTask` payload unconditionally. Whether this is benign depends entirely on the
provider's HTTP client: `JSON.stringify({ description: undefined })` drops the key, but if
the provider client copies fields explicitly or applies defaults, an explicit `undefined`
can become a literal `null` description on the external task, or surface a "description"
property the contract did not intend. The FROZEN-9 createTask contract is referenced but
not co-located, so this boundary is unverified here.

**Fix:** Omit the key entirely when absent, mirroring the `...(x ? {x} : {})` idiom used
throughout `buildSessionFromTask`:

```js
task = await provider.createTask({
  projectId,
  title: clean.title,
  ...(clean.description !== undefined ? { description: clean.description } : {}),
});
```

### WR-05: `loadState` corruption fallback returns wrong-shape state, masking the corruption

**File:** `src/session/state.js:230-238`
**Issue:** Not introduced this phase, but directly on the atomicity path under review:
when `JSON.parse` throws on a corrupt `state.json`, `loadState` swallows it and returns a
fresh empty `{ schema_version: 3, sessions: {}, history: [] }`. The very next `addSession`
→ `saveState` then *overwrites* the corrupt-but-recoverable file with an empty one,
permanently discarding every existing session. Combined with the adopt flow, a transient
parse error during the idempotency read (line 170) makes `findSession` return `null`,
adopt re-POSTs (duplicate external task), then clobbers the real state on save. The
atomic rename guarantees you atomically write the *empty* state. This is silent data loss.

**Fix:** On parse failure, do not return a blank writable state. Either rename the corrupt
file aside (`state.json.corrupt.<ts>`) before returning empty, or throw a typed error so
callers (including adopt's guard) can convert it to a discriminant instead of treating
"corrupt" as "empty." At minimum, make adopt's guard distinguish "no session" from "could
not read."

## Info

### IN-01: PERSIST_FAILED discriminant omits the `session` payload needed for recovery

**File:** `src/adopt.js:196-206`
**Issue:** The orphan-recovery detail carries `task_id` + `task_url` + `hint` + `message`,
but not the fully-built `session` object (which is already in scope at line 186). A
consumer wanting to retry the *local write only* (the actual failed step) must rebuild the
row from scratch. Including it would make idempotent re-run cheaper and removes the
temptation to re-POST.

**Fix:** Add `session` (and optionally `task`) to the `detail`, or document why the
consumer must re-derive it.

### IN-02: `redactPaths` does not handle Windows-style absolute paths

**File:** `src/adopt.js:54`
**Issue:** The matcher is POSIX-only (`/`-rooted). `C:\Users\bob\secret` and UNC
`\\server\share` pass through verbatim. The module is documented as host-agnostic; if any
consumer ever runs on or forwards Windows paths, layout leaks. Confirmed:
`"C:\\Users\\bob\\secret"` → unchanged.

**Fix:** If Windows is in scope, add a `[A-Za-z]:\\` and `\\\\` matcher. If POSIX-only is
guaranteed, note it explicitly in the docstring so the limitation is intentional.

### IN-03: `cwd` parameter accepted by `buildSessionFromAdoption` but unused

**File:** `src/adopt.js:102`
**Issue:** `cwd` is destructured but never referenced in the body (the persisted path is
`projectPath`). The docstring explains it is "accepted for parity with the orchestrator
signature," which is a reasonable intent, but an unused param invites a future caller to
pass `cwd` expecting it to matter. Marginal.

**Fix:** Keep for parity (acceptable) but consider a `void cwd;` or a lint-ignore marker,
or drop it since the orchestrator passes named args and parity is not enforced by position.

---

_Reviewed: 2026-06-16T11:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
