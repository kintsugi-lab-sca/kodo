---
phase: 74-handoff-acumulativo-al-cierre
reviewed: 2026-07-15T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/session/handoff.js
  - src/session/state.js
  - src/hooks/session-end.js
  - src/hooks/session-start.js
  - test/session/handoff.test.js
  - test/hooks/session-end-handoff.test.js
  - test/hooks/session-end.test.js
  - test/state/handoff-state.test.js
  - test/state/handoff-concurrency.test.js
  - test/helpers/lock-race-child.mjs
  - test/session-start.test.js
  - test/gsd-context.test.js
  - test/check-isolation.test.js
  - test/session/reconcile-lock.test.js
  - src/session/state-lock.js
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 74: Code Review Report

**Reviewed:** 2026-07-15
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 74 wires an accumulating `## Handoff` block into the `SessionEnd` hook plus an
additive `state.tasks` pointer. I attacked the locked invariants, the claimed security
reasoning, and the "our tests have teeth" claims, and re-verified each one against the
code rather than the prose.

**Invariants that hold (verified, not taken on trust):**

- **Never-throw.** `writeHandoff` propagates; the seam at `session-end.js:142-146` catches it.
  Both EACCES and lock-timeout lanes are covered by tests that assert the cleanup + cosmetic
  trio still run.
- **`backstop → setColor → notify` is intact** (`session-end.js:176 → 226 → 236`); the handoff
  is inserted *before* the trio, not interleaved.
- **Handoff lands before destructive cleanup** (`:143` vs `:209`).
- **`withStateLock` is the only path to `state.json`**; `upsertTaskHandoff`'s mutator touches
  only `state.tasks`, never `alive`.
- **`handoff.js` is a zero-import leaf**, guarded at runtime by `check-isolation.test.js:160-177`.
- **`withFileLock`'s `fn` is synchronous** — the arrow at `session-end.js:319` contains no `await`.
- **The author-detector is genuinely session-scoped.** `findSessionBlock` is line-anchored
  (`startsWith('## Handoff ')`), requires a well-formed marker, and compares `session=<id>` as an
  *exact space-split token* — `s-1-extra` does not match `s-1`. No count, no mtime. This is correct.

**The marker-forgery reasoning, scrutinized as requested — mostly sound, one hole.** The claim
"the only structural hazard is a newline, so collapsing CR/LF closes it" holds for
`summary`, `task_ref`, `status` and `reason`: every line this module emits has a fixed
non-`## Handoff ` prefix (`# `, `**Hecho:**`, `**Pendiente:**`), so a hostile provider string
can never occupy a candidate line, and line-scoping ignores inline/quoted markers. Not escaping
backticks or `#` is defensible. **But `sessionId` — the single field the entire detector keys on —
is the one value interpolated into the marker with zero validation** (`handoff.js:163`). I proved
both failure modes empirically (WR-01).

**Concurrency "teeth" claim: verified, and it is real.** I rebuilt the RACE-2 harness with the
lock removed and ran it 10×: **10/10 trials lost a block** (1–3 survivors out of 4). The
`'spawn'`-event barrier does produce genuine overlap; the test would fail if `withFileLock` were
bypassed. Claim confirmed.

**HOME-isolation claim: verified, and broader than reported.** `session-end.test.js` injects
`plansDir`/`stateWriterFn` on 18/18 invocations. I also checked the two *unlisted* suites that
call the same seam — `test/stop-worktree-cleanup.test.js` (10 calls) and
`test/hooks/stop-idempotency.test.js` (2 calls). Neither injects `plansDir`, but both isolate
HOME via `process.env.HOME = tmpHome` before a dynamic import, and `node --test` gives each file
its own process. No leak. Claim confirmed.

The remaining findings are latent-robustness and data-hygiene defects, not shipping blockers.

## Warnings

### WR-01: `sessionId` is interpolated into the handoff marker without validation — the one field the detector depends on

**File:** `src/session/handoff.js:163`
**Issue:** Every other untrusted value in this module is validated or sanitized before
interpolation (`normalizeReason` for `reason`, `sanitizeInline` for `status`/`summary`/`task_ref`,
`isSafeTaskId` for `taskId`). `sessionId` is not:

```js
const marker = `${MARKER_OPEN} v=1 session=${sessionId} author=auto at=${at.toISOString()} ${MARKER_CLOSE}`;
```

This is the exact string the correctness property rests on. I confirmed two failure modes by
running the real module:

1. `sessionId` containing `\n` → the heading splits, the first line has no `-->`, so
   `findSessionBlock` skips it (`:214`). `hasSessionHandoff(block, sessionId)` returns **false for
   the block the writer just produced**. The backstop then appends a fresh, equally-undetectable
   block on *every* subsequent close of that task — the plan file grows without bound and D-12's
   "no cap" makes it permanent.
2. `sessionId = 'a session=victim'` → `hasSessionHandoff(md, 'victim')` returns **true**. One
   session's block forges attribution to another session, which is precisely the
   "make the detector believe the LLM already wrote" vector, killing the backstop silently.

Reachability today is low — `session_id` is always `randomUUID()` (`manager.js:292`,
`dispatcher.js:170`) — so this is defense-in-depth rather than an exploitable vulnerability. But
it is a one-line gap in a module whose entire stated thesis is "validate before interpolating",
and `manager.js:484` already shows `session_id: sessionId || 'unknown'` fallbacks existing
elsewhere in the codebase.

**Fix:** add a marker-token guard mirroring `isSafeTaskId` (String ops only, no RegExp), and
apply it in `buildHandoffBlock`:

```js
/** A session id is only safe inside the marker if it is a single space-free token. */
export function isSafeSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
  return (
    !sessionId.includes(' ') &&
    !sessionId.includes('\n') &&
    !sessionId.includes('\r') &&
    !sessionId.includes('-->') &&
    !sessionId.includes('<!--')
  );
}

export function buildHandoffBlock({ sessionId, reason, status, at = new Date() }) {
  if (!isSafeSessionId(sessionId)) {
    // A block whose marker cannot be parsed is worse than no block: it is invisible
    // to D-04 and re-appends forever. Refuse to emit one.
    throw new TypeError('unsafe sessionId for handoff marker');
  }
  ...
}
```

`writeHandoff`'s existing try/catch seam already turns that throw into a warn + no-op close.

---

### WR-02: a later mechanical backstop clobbers a real `NEXT:` in `state.tasks` with `null`

**File:** `src/hooks/session-end.js:366` (and `src/session/state.js:419`)
**Issue:** `upsertTaskHandoff` replaces the whole entry, and `next` defaults to `null`:

```js
state.tasks[taskId] = { plan_path: ..., next: entry.next ?? null, updated_at: ... };
```

Sequence: session 1's LLM writes `**NEXT:** desplegar el fix` → `state.tasks[T].next =
'desplegar el fix'`. Session 2 on the same task closes without an LLM handoff → the mechanical
block is appended, which by design carries no `NEXT:` (`writeHandoff:366` returns
`{ planPath, next: null }`) → `state.tasks[T].next` becomes `null`.

This contradicts the stated purpose of `state.tasks` (`state.js:390-395`): *"its whole value is
surviving the session that produced it so the NEXT session of that same task finds it."* The
pointer's value is destroyed by exactly the session the backstop exists to compensate for. The
Phase 75 dashboard would render an empty cell while a perfectly good `NEXT:` still sits in the
plan file.

It is arguable that "the latest close is authoritative" — but D-02 explicitly frames `null` as
*"ausente"* (absent), not *"there is no next step"*. Absent should not overwrite present.

**Fix:** preserve the previous `next` when the new one is absent (keeps the upsert semantics for
`plan_path`/`updated_at`):

```js
const prev = state.tasks[taskId];
state.tasks[taskId] = {
  plan_path: entry.plan_path,
  // An absent NEXT means "this close had nothing to say", not "the task has no next
  // step". Do not let the mechanical block of D-03 erase a real NEXT from a prior close.
  next: entry.next ?? (prev ? prev.next : null) ?? null,
  updated_at: entry.updated_at ?? new Date().toISOString(),
};
```

---

### WR-03: `migrateStateV2toV3` silently drops `tasks` — the additive-key invariant is guarded by an argument, not by code

**File:** `src/session/state.js:146-150`
**Issue:** The migration rebuilds the state exhaustively and discards every unknown top-level key:

```js
return { schema_version: 3, sessions: newSessions, history: Array.isArray(rawState.history) ? rawState.history : [] };
```

The team clearly knows: `handoff-state.test.js:19-26` and `handoff-concurrency.test.js:79-84`
both document it, and the concurrency test states it was *empirically reproduced* — *"running the
child with no seed writes `schema_version: 2` with `tasks` alongside."* Both suites work around it
by seeding v3 rather than fixing the drop.

The lane is real: `loadState():264` returns the **v2** shape `{schema_version: 2, sessions: {}}`
when `state.json` is missing, `withStateLock` mutates *that*, `saveState` persists a v2 file
*with* `tasks`, and the very next `loadState` fires `migrateStateIfNeeded` → `tasks` gone.
Production reachability is currently blocked by `session-end.js:96-99` (no `state.json` →
`findSession` → `null` → early return), so this is latent, not live. But it is reachable from any
direct caller of `writeHandoff`/`upsertTaskHandoff` — including `test/helpers/lock-race-child.mjs`
and anything Phase 75 adds — and it is one line to close permanently.

Note the asymmetry: `reconcile-lock.test.js:150-212` added an explicit anti-drop regression for
`reconcile.js`'s *spread* (which preserves unknown keys), while the code that *actually drops*
them has no guard at all.

**Fix:**

```js
return {
  schema_version: 3,
  sessions: newSessions,
  history: Array.isArray(rawState.history) ? rawState.history : [],
  // Phase 74 D-05: `tasks` is additive and must survive the migration. The exhaustive
  // rebuild above is what would otherwise discard it.
  ...(rawState.tasks ? { tasks: rawState.tasks } : {}),
};
```

Add a regression case alongside the existing `reconcile` one.

---

### WR-04: `state.tasks` grows without bound — no cap, no reaper, no reader

**File:** `src/session/state.js:408-429`
**Issue:** `sessions` rows are deleted on close; `history` is FIFO-capped at 50 (`:373`).
`state.tasks` has neither. I grepped the whole tree: nothing ever deletes from `state.tasks`, and
nothing reads it yet — every consumer is Phase 75. One entry accrues per task ever closed, forever.

`state.json` is `JSON.parse`d on **every** `loadState()`, i.e. on every hook invocation, every
reconcile tick and every dashboard render. D-12's "no pruning" reasoning is scoped to *plan
blocks* ("una tarea típica vive 1-3 sesiones") — it does not cover a monotonically growing key in
the hot-path state file.

This is not a perf finding (out of scope): the concern is that the growth is unbounded and
undocumented, so there is no point at which anything notices.

**Fix:** either cap it the way `history` is capped, or tie eviction to the existing
`removeSession` archival. Minimal version, mirroring the `history` precedent:

```js
// Cap `tasks` the way `history` is capped (:373). Keep the most recently updated.
const MAX_TASKS = 200;
const entries = Object.entries(state.tasks).sort(
  (a, b) => (b[1].updated_at || '').localeCompare(a[1].updated_at || ''),
);
if (entries.length > MAX_TASKS) state.tasks = Object.fromEntries(entries.slice(0, MAX_TASKS));
```

If the deliberate choice is "unbounded in v0.17, revisit in v0.18 with data" (the M21 precedent
D-12 invokes), then say so in the `TaskHandoff` typedef — right now the typedef only explains
*why the key exists*, not that it never shrinks.

---

### WR-05: `session-start.js` interpolates `session.task_id` into a filesystem path handed to the LLM without `isSafeTaskId`

**File:** `src/hooks/session-start.js:94`, `src/hooks/session-start.js:173`
**Issue:** Both branches build the plan path straight from provider data:

```js
`… escribe un plan corto … en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`.`
```

`join` *normalizes* traversal rather than rejecting it: a `task_id` of `../../../../etc/foo`
yields `/etc/foo.md`, and the generated instruction tells Claude to append LLM-authored content
there — "conservando íntegro lo que ya hubiera". kodo spawns Claude with
`--dangerously-skip-permissions` on some paths (`manager.js:413`), so there is no interactive gate.

Phase 74 built `isSafeTaskId` for precisely this threat (T-74-01), exported it from `handoff.js`,
and applied it on the *writer* side (`session-end.js:300`) — but not on the *instruction* side of
the same feature. The two halves now disagree about whether `task_id` is trusted: `session-end`
refuses to create the file, while `session-start` has already told the LLM to write it.

The interpolation itself predates this phase (Phase 45 PLAN-03), but the guard did not exist then
and does now, and Phase 74 rewrote this exact block.

**Fix:** apply the existing exported guard and omit the instruction when it fails — `handoff.js`
is a zero-import leaf, so importing it from `session-start.js` costs nothing:

```js
import { isSafeTaskId } from '../session/handoff.js';
…
// T-74-01: never name a path built from an unvalidated provider task_id. `join` normalizes
// traversal instead of rejecting it; the SessionEnd writer already refuses these ids.
if (isSafeTaskId(session.task_id)) {
  lines.push('', `Además, al empezar escribe un plan corto … en \`${planPath}\`. …`);
}
```

The mechanical backstop already covers sessions that receive no instruction (D-10 precedent: the
`phase` and `bootstrap` branches).

## Info

### IN-01: the "is it synchronous" test asserts the wrong function

**File:** `test/hooks/session-end-handoff.test.js:88-91`
**Issue:** The stated rationale is "un fn asíncrono liberaría el lock antes de que la escritura
aterrice (Pitfall 4)" — that hazard is about the callback passed to `withFileLock`
(`session-end.js:319`), not about `writeHandoff` itself. The test checks the *outer* function.
Also, `assert.notEqual(..., 'AsyncFunction')` is dead: an `AsyncFunction` would already have
failed the preceding `assert.equal(..., 'Function')`.
**Fix:** drop the redundant assert and add a source guard over the callback, mirroring the one
that already exists at `reconcile-lock.test.js:214-233` (extract the `withFileLock(lockPath, () => {`
block and assert it contains no `await`). That guards the property the comment claims to guard.

### IN-02: `findSessionBlock`'s block-end scan is not fence-aware

**File:** `src/session/handoff.js:224-229`
**Issue:** The block terminates at the first following line starting with `## `. A fenced code
block inside an LLM-authored handoff containing a `## ` line truncates the block early, so a
`**NEXT:**` after it is invisible to `extractNext`. Conversely, a following `# ` (h1) section does
*not* terminate the block, so unrelated prose is absorbed and a stray `**NEXT:**` there could be
picked up.
**Fix:** low priority given the LLM is instructed to put `**NEXT:**` immediately in the block.
If tightened, track fence state with `startsWith('```')` while scanning — String ops only, still
zero-RegExp.

### IN-03: `sanitizeInline` and `extractNext` truncate on UTF-16 code units, splitting surrogate pairs

**File:** `src/session/handoff.js:91`, `src/session/handoff.js:268`
**Issue:** `collapsed.slice(0, maxLen)` on a 120th-character emoji leaves a lone high surrogate
(verified: `'a'.repeat(119) + '😀'` → tail `\ud83d`). Written with default utf8 it becomes U+FFFD
in the plan file. `JSON.stringify` escapes it safely for `state.json` (well-formed stringify), so
this is cosmetic.
**Fix:** if it matters, drop a trailing lone surrogate:
`const out = collapsed.slice(0, maxLen); return (out.charCodeAt(out.length - 1) >= 0xd800 && out.charCodeAt(out.length - 1) <= 0xdbff ? out.slice(0, -1) : out).trim();`

### IN-04: lock/tmp/steal artifacts are written into `~/.kodo/plans/`, the data dir Phase 75 will scan

**File:** `src/hooks/session-end.js:308`, `src/hooks/session-end.js:357`
**Issue:** `<task_id>.md.lock`, `<task_id>.md.tmp.<pid>.<uuid>` and — on a steal —
`<task_id>.md.lock.steal.<pid>.<uuid>` (`state-lock.js:102`) all land next to the plan files.
Happy paths clean up (the hygiene test at `handoff-concurrency.test.js:257-273` covers it), but a
hard kill mid-write leaves residue in the directory Phase 75 enumerates.
**Fix:** either put locks under `~/.kodo/locks/` (the convention `dispatcher` already uses per
`lock-race-child.mjs:197`), or have the Phase 75 reader filter to `*.md` exactly.

### IN-05: the `fs` injection is partial — the lock's I/O always uses the real `node:fs`

**File:** `src/hooks/session-end.js:317`
**Issue:** `deps.fs` covers `mkdirSync`/`existsSync`/`readFileSync`/`writeFileSync`/`renameSync`/
`rmSync` in `writeHandoff`, but `withFileLock` → `acquireLock`/`releaseLock` import `node:fs`
statically. A test that stubs `fs` to simulate a failing filesystem does not simulate a failing
*lock* filesystem, so the `acquireLock` → `mkdirSync` throw path the comment at `:135-141`
explicitly reasons about is untested via that seam.
**Fix:** document the boundary in the `deps` JSDoc, or thread `fs` through `LockOpts` if the
untested branch matters.

### IN-06: `now()` is called twice, so the block timestamp and `updated_at` can disagree

**File:** `src/hooks/session-end.js:346` vs `src/hooks/session-end.js:381`
**Issue:** The block's `at=` and the `state.tasks` `updated_at` come from two separate `now()`
calls. With the injected fixed clock they match (which is why tests do not catch it); with the
default `() => new Date()` they differ by the duration of the RMW, so `state.tasks[T].updated_at`
never exactly matches the marker it points at.
**Fix:** hoist one value: `const at = now();` before the lock, then use `at` in both places.

### IN-07: `buildPlanHeader` emits `#  — ` when `task_ref`/`summary` are missing

**File:** `src/session/handoff.js:116-118`
**Issue:** `sanitizeInline` correctly returns `''` for non-strings, so a session record missing
`task_ref`/`summary` (legacy rows, or the minimal record `lock-race-child.mjs:127-135` builds)
produces a plan file whose first line is `#  — `. Not a bug — `undefined` never leaks — but the
created file is a meaningless header.
**Fix:** fall back to the `task_id` the path is already keyed on:
``return `# ${sanitizeInline(taskRef) || sanitizeInline(taskId)} — ${sanitizeInline(summary)}\n`;``

---

_Reviewed: 2026-07-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
