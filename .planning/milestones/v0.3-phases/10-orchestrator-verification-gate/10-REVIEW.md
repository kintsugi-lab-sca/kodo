---
phase: 10-orchestrator-verification-gate
reviewed: 2026-04-22T14:48:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/cli.js
  - src/cli/gsd-verify.js
  - src/gsd/verification.js
  - src/gsd/verify.js
  - src/hooks/stop.js
  - src/orchestrator/launch.js
  - src/orchestrator/prompt.md
  - test/gsd-verification.test.js
  - test/gsd-verify-cli-handler.test.js
  - test/gsd-verify-cli.test.js
  - test/gsd-verify-integration.test.js
  - test/orchestrator-gsd.test.js
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-22T14:48:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 10 implements the GSD orchestrator verification gate with a clean separation of concerns: pure parser (`verification.js`), orchestration (`verify.js`), thin CLI handler (`cli/gsd-verify.js`), and orchestrator wiring (`prompt.md`, `launch.js`, `stop.js`). The work adheres to the CONTEXT decisions (D-01..D-21) and Pitfalls #1-#7 documented in the planning artefacts:

- **Pitfall #1** (`config.providers[name].states.review`, not top-level) — correctly applied in `verify.js:205-208`.
- **Pitfall #2** (legacy `approved|blocked` mapping for `orchestratorReview`) — exhaustive mapping in `finalize` including the nuanced "pass but getTask failed → blocked" degradation.
- **Pitfall #3** (directory discovery via `readdirSync` + prefix match) — implemented with deliberate `startsWith(\`${padded}-\`)` to prevent `03` matching `30-…`.
- **Pitfall #4** (`phase_id` absent in bootstrap) — early-return `malformed` with no filesystem access.
- **Pitfall #5** (do not duplicate `plane.api.call`) — only `plane.api.call.failed` emitted from verify.js.
- **Pitfall #6** (exit codes 0/1/2, Opción A) — regex-based transient classification.
- **Pitfall #7** (idempotencia diferida) — explicitly documented in comment header.

Fail-open semantics on Plane failures are correctly preserved: verdict emission to NDJSON is unconditional even if HTTP POSTs fail. The test suite is thorough (37 cases across 5 files; fixtures cover the real Phase 9 VERIFICATION.md shape).

The issues below are **non-blocking** for v0.3. Three warnings concern UX/observability rough edges; six info items flag minor naming, dead-code, and documentation gaps.

## Warnings

### WR-01: Empty `phase_id` leaks into comment body when bootstrap session lacks phase_id

**File:** `src/gsd/verify.js:107-115`, `src/gsd/verify.js:349-355`
**Issue:** When `session.phase_id` is absent (bootstrap mode), the code constructs `verdict = { action: 'malformed', phase_id: '', detail: 'session has no phase_id (bootstrap?)' }` and passes it to `finalize`, which then calls `renderMalformedComment(v, phaseName)`. The rendered comment is:

```
[kodo:gsd] ⚠️ VERIFICATION.md presente pero inválido (Phase )

Detalle: session has no phase_id (bootstrap?)
...
```

The literal string `"Phase "` (empty suffix) is posted to Plane, which is misleading since the failure is not about an invalid VERIFICATION.md — it's about a missing `phase_id` altogether. Additionally, the comment header states "VERIFICATION.md presente pero inválido" which is false (the file was never even looked for).

**Fix:** Branch `renderMalformedComment` on whether this is a filesystem-parse error or a pre-parse condition. Minimal change:

```javascript
export function renderMalformedComment(v, phaseName) {
  const phaseLabel = v.phase_id ? `Phase ${v.phase_id}` : 'sesión sin phase_id';
  return [
    `[kodo:gsd] ⚠️ Gate no aplicable — ${phaseLabel}`,
    '',
    `Detalle: ${v.detail}`,
    `Corrige el contexto y re-dispara el flujo.`,
  ].join('\n');
}
```

Alternatively, treat "no phase_id" as a dedicated `no-phase` verdict or skip the comment entirely (the orchestrator already knows the session is bootstrap from the `state.json` nudge).

---

### WR-02: `readdirSync` error is swallowed silently — permission errors become `missing`

**File:** `src/gsd/verify.js:131-135`
**Issue:**

```javascript
let entries;
try {
  entries = readdirFn(phasesRoot);
} catch {
  entries = [];
}
```

Any exception thrown by `readdirFn` (EACCES permission denied, EMFILE too many open files, malformed symlink, etc.) is swallowed and collapses into `verdict = { action: 'missing' }`. The orchestrator then posts "VERIFICATION.md no encontrado" to Plane and tells the human to run `/gsd-verify-work`, when the actual problem is a filesystem permission issue. This could send the operator down the wrong debugging path.

**Fix:** Log the error before swallowing so forensics via `kodo logs` can distinguish real-absent from can't-read:

```javascript
let entries;
try {
  entries = readdirFn(phasesRoot);
} catch (err) {
  log.warn('gsd.verify.readdir_failed', {
    path: phasesRoot,
    error: /** @type {Error} */ (err).message,
  });
  entries = [];
}
```

This preserves the fail-closed verdict while ensuring the operator has a signal to investigate.

---

### WR-03: `plane.api.call.failed` is an ad-hoc event string — not in EVENTS taxonomy

**File:** `src/gsd/verify.js:185, 196, 213`
**Issue:** `verify.js` emits `log.error('plane.api.call.failed', { step, error })` as a bare string, bypassing the event taxonomy in `src/logger-events.js`. Phase 7 D-09 established the taxonomy specifically to prevent event-name drift ("Componente `orchestrator` reservado en la taxonomía (D-15)"). The grep-friendly contract is broken — `kodo logs --event plane.api.call.failed` works today but only because no other site emits it; a typo here or in another module would create silent splits.

The Phase 7 context note in CONTEXT.md §canonical_refs explicitly says the taxonomy is a canonical contract. This event should be declared alongside `ORCHESTRATOR_REVIEW` and exposed through a helper.

**Fix:** Add to `src/logger-events.js`:

```javascript
export const EVENTS = {
  // ...
  PLANE_API_CALL_FAILED: 'plane.api.call.failed',
};

/**
 * @param {Logger} logger
 * @param {{ step: 'getTask' | 'addComment' | 'updateTaskState', error: string }} fields
 */
export function planeApiCallFailed(logger, fields) {
  logger.error(EVENTS.PLANE_API_CALL_FAILED, {
    event: EVENTS.PLANE_API_CALL_FAILED,
    step: fields.step,
    error: fields.error,
  });
}
```

Then consume in `verify.js` instead of the raw string. Tests (`T18`, `T19`, `T19b`) currently assert on the literal string; they will continue to pass if the helper emits the same event name.

## Info

### IN-01: Test filename is misleading — `gsd-verify-cli.test.js` tests the service module, not the CLI

**File:** `test/gsd-verify-cli.test.js:1-3`
**Issue:** The file header says "Tests unitarios CLI para `src/gsd/verify.js`" but `src/gsd/verify.js` is the orchestration module, not a CLI. The companion file `test/gsd-verify-cli-handler.test.js` is the actual CLI handler test. Readers looking for CLI tests will open the wrong file; readers looking for `verify.js` unit tests have to realise the "-cli" suffix is a misnomer.

**Fix:** Rename `test/gsd-verify-cli.test.js` → `test/gsd-verify.test.js` (mirrors the source file name) and update the file header to match. No behavioural change.

---

### IN-02: Unused `phaseName` parameter in `renderMissingComment` and `renderMalformedComment`

**File:** `src/gsd/verify.js:336, 349`
**Issue:** Both `renderMissingComment(v, phaseName)` and `renderMalformedComment(v, phaseName)` accept `phaseName` but never reference it in the body. The pass/fail renderers do use it, so the signature was presumably kept for uniformity — but the IDE / linter will flag it as dead, and readers may assume the variable is used somewhere.

**Fix:** Either drop the parameter (and adjust the dispatcher) or prefix with `_` to signal intentional:

```javascript
export function renderMissingComment(v, _phaseName) { /* ... */ }
export function renderMalformedComment(v, _phaseName) { /* ... */ }
```

Alternatively, include `phaseName` in the output for consistency with pass/fail comments (e.g. `Phase ${v.phase_id} (${phaseName})`).

---

### IN-03: `TRANSIENT_PATTERNS` regex has a broad `network` alternation that could cause false positives

**File:** `src/cli/gsd-verify.js:39`
**Issue:** `/provider.*fetch|fetch.*failed|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i` — the `network` alternation will match any error message containing that word, including application-level errors like `"network interface config missing"` (internal error, not transient). Effect is an operator sees exit code 2 and assumes retry; the real issue may be non-retryable.

The risk is low because the caller is the orchestrator (a human-in-the-loop supervisor) and exit 2 vs 1 differs only in retry hint, not correctness. But a narrower pattern like `\bnetwork\s+(unreachable|error|down)\b` or dropping `network` entirely (keeping the specific errno codes) would be more precise.

**Fix:** Narrow to node errno-shaped signals:

```javascript
const TRANSIENT_PATTERNS = /provider.*fetch|fetch.*failed|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|getaddrinfo/i;
```

If `network` must remain, anchor it: `\bnetwork\s+unreachable\b`.

---

### IN-04: `find()` on first-match prefix could silently pick wrong directory on ambiguity

**File:** `src/gsd/verify.js:136`
**Issue:** `const match = entries.find((e) => e.startsWith(\`${padded}-\`))` returns the first matching entry. If a project accidentally has two directories matching the padded phase prefix (e.g. `10-foo/` and `10-bar/` — perhaps from a botched rename), the function silently picks one. The `missing` verdict would be wrong (file exists in one dir), and the picked directory may not be the canonical one.

Phase 9 Pitfall #3 pointed out the prefix-overlap risk (`03` vs `30-`); this is a different overlap (two `10-*` dirs). The test `T6` asserts the canonical case but doesn't cover duplicates.

**Fix:** Use `filter` + length check:

```javascript
const matches = entries.filter((e) => e.startsWith(`${padded}-`));
if (matches.length === 0) {
  verdict = { action: 'missing', phase_id: session.phase_id };
} else if (matches.length > 1) {
  verdict = {
    action: 'malformed',
    phase_id: session.phase_id,
    detail: `multiple phase dirs match ${padded}-*: ${matches.join(', ')}`,
  };
} else {
  // single match — proceed
}
```

This aligns with Phase 9 resolver.js pattern `multi-match → error` (cited in PATTERNS.md §9 as the canonical fail-closed behaviour for ambiguity).

---

### IN-05: Parser regex silently accepts corrupt quoted values with trailing garbage

**File:** `src/gsd/verification.js:114`
**Issue:** The regex `/^([A-Za-z_]\w*):\s*"?(.*?)"?\s*$/` with non-greedy `.*?` and optional quotes means an input like:

```
status: "passed"extra
```

…would match with the captured value being `passed"extra` (the non-greedy `.*?` backtracks to make `\s*$` satisfy). This is unlikely in legitimate machine-generated VERIFICATION.md but could silently accept corruption.

Observable impact is minimal (downstream `STATUS_MAP` lookup would fail, yielding `malformed` — the correct verdict). The issue is that the error message becomes `unknown status 'passed"extra'` instead of a cleaner "malformed value" signal.

**Fix:** Require balanced quotes or no quotes via alternation:

```javascript
const re = /^([A-Za-z_]\w*):\s*(?:"([^"]*)"|([^"\s].*?))\s*$/;
// then pick m[2] ?? m[3]
```

Low priority — the current behaviour fails closed.

---

### IN-06: Markdown link in pass comment uses literal `*` glob

**File:** `src/gsd/verify.js:303`
**Issue:**

```javascript
`Ver: \`.planning/phases/${padPhaseForPath(v.phase_id)}-*/${padPhaseForPath(v.phase_id)}-VERIFICATION.md\``
```

Produces a comment like `Ver: .planning/phases/10-*/10-VERIFICATION.md`. The `*` is a glob hint for humans to expand, but:

1. It's not a clickable link in Plane (HTML rendering via `plane/provider.js:183` converts `\n` → `<br>` only).
2. Some operators might paste the string verbatim into a terminal and get zero matches if the shell expands globs differently.
3. The actual directory name is already known at comment-render time (it was resolved via `readdirSync` in `finalize`).

**Fix:** Pass the resolved directory match from `finalize` through to the comment renderer:

```javascript
// in finalize, after finding `match`:
const verRelPath = `.planning/phases/${match}/${padded}-VERIFICATION.md`;
const markdown = renderComment(verdict, phaseName, verRelPath);
```

Then templates use the real path. Alternatively, drop the `Ver:` line entirely (the orchestrator can locate the file from context). Low priority.

---

_Reviewed: 2026-04-22T14:48:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
