---
phase: 55-contrato-hostprovider-describesurface-cmux
reviewed: 2026-06-16T16:25:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/host/cmux.js
  - src/host/interface.js
  - test/host/contract.test.js
  - test/fixtures/cmux/surface-resume-show.json
  - test/fixtures/cmux/surface-tree.json
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 55: Code Review Report

**Reviewed:** 2026-06-16T16:25:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the Phase 55 addition of `listAgentSurfaces()` to `CmuxHost` plus its
contract test and golden fixtures. The implementation honors the invariants the
prompt called out: argv-literal shell-out via `execFile`/`execFileSync` (no shell
injection surface), `HOST_METHODS` stays frozen at exactly 4 entries with
`listAgentSurfaces` deliberately excluded, no `src/logger.js` import (LOG-12
satisfied — confirmed cmux.js injects logger via `opts.logger`), and the
never-throws / fail-open architecture is structurally correct (step-1 failure →
`[]`, row-by-row `try/catch` inside the fan-out loop, `JSON.parse` wrapped). The
22-test suite passes.

No BLOCKER-class defects were found. The findings below are correctness-adjacent
robustness gaps in the shape-validation contract (`normalizeSurface` only
type-checks 2 of the 4 output fields), a defensive-parse inconsistency, and a few
quality/test-coverage observations. The most important is WR-01: the
`AgentSurface` typedef promises 4 strings but only 2 are validated, so malformed
cmux output can emit a surface with `workspaceRef`/`kind` set to `undefined`,
`null`, or a non-string — which then flows into Phase 56's `adoptSession` input
unchecked.

## Warnings

### WR-01: `normalizeSurface` validates only 2 of 4 output fields against the `AgentSurface` string contract

**File:** `src/host/cmux.js:45-57` (cross-ref `src/host/interface.js:34-41`)
**Issue:**
The `AgentSurface` typedef in `interface.js` declares all four properties as
`string` (`workspaceRef`, `cwd`, `sessionId`, `kind`). `normalizeSurface` only
guards two of them:

```js
if (typeof b.checkpoint_id !== 'string' || typeof b.cwd !== 'string') return null; // T-55-01
return {
  workspaceRef: raw.workspace_ref, // NOT type-checked
  cwd: b.cwd,
  sessionId: b.checkpoint_id,
  kind: b.kind,                    // NOT type-checked
};
```

The comment cites T-55-01 ("shape inesperado / tampering") as the rationale for
the `checkpoint_id`/`cwd` guard — but that exact tampering argument applies
equally to `workspace_ref` and `kind`. The stated threat model (untrusted cmux
stdout) is only half-enforced. If cmux returns `resume_binding.kind: null` or
omits `workspace_ref` (so `raw.workspace_ref` is `undefined`), `normalizeSurface`
emits `{ workspaceRef: undefined, kind: null, ... }`. That object passes the
"adoptable" filter and is handed to the Phase 56 consumer / `adoptSession`, which
the typedef says receives a `string`. This is a shape-contract violation that the
fixtures never exercise (every fixture surface has well-formed `workspace_ref` and
`kind`), so the green test suite gives false confidence.

**Fix:** Extend the guard to cover every field that must be a string per the
typedef:

```js
if (
  typeof b.checkpoint_id !== 'string' ||
  typeof b.cwd !== 'string' ||
  typeof raw.workspace_ref !== 'string' ||
  typeof b.kind !== 'string'
) {
  return null; // T-55-01: shape inesperado / tampering
}
```

If `kind` is intentionally allowed to be absent, then the typedef in
`interface.js:41` should be relaxed to `{string} [kind]` so the source of truth
matches the runtime behavior — pick one, do not leave them divergent.

### WR-02: `normalizeSurface` does not guard `cleared` against truthy non-boolean values

**File:** `src/host/cmux.js:46`
**Issue:**
The cleared check is strict-equality against `true`:

```js
if (!raw || raw.cleared === true) return null; // D-05: cleared
```

Under the documented threat model (untrusted/tampered cmux stdout), a value of
`cleared: "true"` (string), `cleared: 1`, or any other truthy-but-not-`=== true`
value bypasses this filter and the surface is treated as live. Given that the
whole point of the `=== 'string'` guards two lines down is defense against
unexpected shapes, accepting only the literal boolean `true` as "cleared" is an
inconsistent posture: a tampered payload that wants to keep a cleared binding
visible just has to send a non-boolean truthy `cleared`. This is lower severity
than WR-01 because `source !== 'agent-hook'` and the string guards still filter
most malformed rows, but it is the same class of gap.

**Fix:** Treat any truthy `cleared` as cleared (fail-safe toward omission):

```js
if (!raw || raw.cleared) return null; // D-05: cleared (cualquier truthy = limpiada)
```

Note this is a deliberate semantic choice — fail toward *dropping* a
questionable surface rather than adopting it. If the strict `=== true` was chosen
to preserve surfaces whose `cleared` is `null`/`undefined` (i.e. "not cleared"),
that already works with the truthy check too (`null`/`undefined`/`false` are all
falsy).

### WR-03: `tree --all` is not deduplicated against the caller's own surface — fan-out re-queries the live caller surface

**File:** `src/host/cmux.js:66-87`, `220-265`
**Issue:**
`extractSurfaceRefs` walks only `treeJson.windows[]` and dedups by ref — correct
as far as it goes. But the tree output also exposes top-level `active.surface_ref`
and `caller.surface_ref` (see `surface-tree.json:3-18`), which is the surface of
the *kodo/caller process itself*. Because the caller surface also appears inside
`windows[].workspaces[].panes[].surface_refs`, it is enumerated and then
`surface resume show` is fan-out-called against it like any other. For the
adoption use case this means the host can surface *its own* caller session as an
adoptable agent surface if that caller happens to be an `agent-hook` claude
session. The current fixture's `surface:1` is simultaneously the `active`/`caller`
surface AND the adoptable result asserted by the test — so the test actually
*encodes* this self-adoption rather than guarding against it.

This may be intentional (the design doc may want the caller included), but it is
undocumented and the consumer-side dedup is described as keying on
`sessionId`/`cwd` (D-06) — which would NOT dedup the caller against itself, only
against other already-known sessions. Worth an explicit decision.

**Fix:** Either document that self-inclusion is intended (add a comment at
`extractSurfaceRefs` referencing `caller.surface_ref`), or exclude the caller
surface:

```js
const caller = typeof treeJson?.caller?.surface_ref === 'string'
  ? treeJson.caller.surface_ref : null;
// ... at the end:
if (caller) refs.delete(caller);
return [...refs];
```

## Info

### IN-01: `makeRun` ignores `execFile`/`execFileSync` default `maxBuffer` (1 MB) for untrusted stdout

**File:** `src/host/cmux.js:24-27`
**Issue:**
`makeRun` calls `execSync(binary, args, { encoding: 'utf-8', timeout: TIMEOUT_MS })`
without setting `maxBuffer`. The Node default is 1 MB. `cmux tree --all --json` on
a host with many windows/workspaces could plausibly exceed that, in which case the
call throws `ENOBUFS`/`maxBuffer exceeded`. The fail-open contract *does* catch
this (step-1 → `[]`, fan-out → row skipped), so it is not a correctness bug — but
it converts a recoverable "large but valid output" into a silent total-empty
result, defeating enumeration exactly when there is the most to enumerate. Out of
strict v1 scope (not a crash, not data loss), recorded as Info.

**Fix:** Set an explicit, generous `maxBuffer` (e.g. `maxBuffer: 10 * 1024 * 1024`)
in the `makeRun` options so realistic tree sizes parse instead of fail-opening.

### IN-02: `surfaceShowFor` test helper splits argv with `\S+`, masking refs that contain whitespace

**File:** `test/host/contract.test.js:27-32`
**Issue:**
The test helper extracts the ref with `argv.match(/--surface\s+(\S+)/)`. Because
the production code passes `ref` as a discrete argv element (no shell, no
re-splitting), a real cmux `surface_ref` containing a space would be passed
correctly by the implementation but would be *mis-parsed by the test fake*
(truncated at the first space). This means the test harness is slightly less
faithful than the real execFile path. Cmux refs are `surface:N` today so there is
no live impact, but the fake's fidelity gap could hide a future regression.

**Fix:** Since the fake receives the already-split `args` array, match the ref
positionally instead of re-joining-then-regexing:

```js
function surfaceShowFor(args) {
  const i = args.indexOf('--surface');
  const ref = i >= 0 ? args[i + 1] : null;
  ...
}
```
(and pass `args` rather than the joined `argv` from the run fakes).

### IN-03: Misleading inline comment in the row-by-row failure test

**File:** `test/host/contract.test.js:242-244`
**Issue:**
The comment reads "sirve surface:1 OK pero throws para surface:1... no: hacemos
throw en una surface NO adoptable (surface:2)". The "surface:1... no:" fragment is
a leftover self-correction left in the committed source. It is confusing and reads
like an unfinished edit. Cosmetic only.

**Fix:** Replace with the clean intent: "Throw on a non-adoptable surface
(surface:2) and serve surface:1 OK; assert surface:1 still survives."

---

_Reviewed: 2026-06-16T16:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
