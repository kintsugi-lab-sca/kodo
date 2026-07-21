---
phase: 74-handoff-acumulativo-al-cierre
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/cli/doctor.js
  - src/hooks/install.js
  - src/hooks/session-start.js
  - src/session/handoff.js
  - test/check-isolation.test.js
  - test/cli/doctor.test.js
  - test/gsd-context.test.js
  - test/hooks/install.test.js
  - test/session-start.test.js
  - test/session/handoff.test.js
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 74: Code Review Report (gap-closure pass — G-74-4)

**Reviewed:** 2026-07-21
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

> Note: this overwrites the initial 2026-07-15 REVIEW for Phase 74. This pass reviews the
> `--gaps-only` work closing G-74-4 (plans 74-07/74-08): `checkHookRegistration`, `KODO_HOOKS`,
> and the hooks section wired into `runDoctor`, plus the surrounding scoped files.

## Summary

The pure `src/session/handoff.js` module is well-defended (never-throws, string-only, zero-import
leaf, exhaustive tests) — no correctness defect found there. The prompt-builders in
`session-start.js` are golden-byte disciplined.

The defects cluster around the **install ↔ doctor consistency** the gap-closure was meant to
guarantee, plus robustness gaps in `install.js` and one false-positive path in `doctor --states`.
No BLOCKERs: no injection, data-loss, or happy-path crash. The most consequential finding (WR-01)
is a matching-strategy asymmetry that can make a reported drift **unfixable** by the very remedy
the doctor prints (`kodo install`).

## Warnings

### WR-01: `addHook` uses loose (any-kodo-file) matching while the drift detector is strict per-event — doctor and install can disagree, making a reported drift unfixable

**File:** `src/hooks/install.js:190-193` (and `:49-51`)
**Issue:**
`checkHookRegistration` (the G-74-4 detector) matches **per event, per canonical file** via
`commandMatchesFile(h.command, file)` (line 81) — a `session-end.js` command placed under `Stop`
does NOT count as `SessionEnd` registered (asserted by test "Match por-evento estricto"). But
`addHook`'s exists-check uses the **loose** `isKodoHookCommand` (line 192), true if *any* of the
three kodo files appears under the event:

```js
const exists = hooks[event].some((entry) => {
  const h = entry.hooks || [];
  return h.some((hook) => isKodoHookCommand(hook.command)); // ANY kodo file
});
```

Consequence: if a kodo command for the *wrong* file sits under an event (e.g. `session-start.js`
under `SessionEnd`), the detector reports `SessionEnd` missing (exit 1, "remedio: ejecuta kodo
install"), but `addHook('SessionEnd', …)` sees `exists === true` and refuses to add
`session-end.js`. Doctor keeps reporting drift; `kodo install` keeps saying "Hooks ya estaban
instalados" — the drift is unfixable via the advertised remedy. This contradicts the `KODO_HOOKS`
header comment, which claims per-file matching is the single source consumed "por installHooks …
y por el doctor". (Happy-path install is unaffected — POSIX and Windows separators both match.)

**Fix:** Make `addHook` event-aware, mirroring the detector:

```js
function addHook(hooks, event, command, file) {
  if (!Array.isArray(hooks[event])) hooks[event] = [];
  const exists = hooks[event].some((entry) =>
    (entry.hooks || []).some((hook) => commandMatchesFile(hook.command, file)),
  );
  if (exists) return false;
  hooks[event].push({ hooks: [{ type: 'command', command }] });
  return true;
}
```
Thread the file through from `installHooks` (derive `event → file` from `KODO_HOOKS`, per the
header comment's stated intent, instead of the three hand-written `addHook` calls).

### WR-02: `installHooks` / `uninstallHooks` throw (or silently drop hooks) on non-object `settings.json` — inconsistent with the never-throws robustness the phase established

**File:** `src/hooks/install.js:106-115` and `:145-154`
**Issue:**
The `try/catch` wraps only `JSON.parse`. A file that parses to a non-object still passes:
- `null` → `JSON.parse` returns `null` → `if (!settings.hooks)` dereferences `null.hooks` →
  **uncaught TypeError**, `installHooks` crashes.
- `[]` → `settings.hooks = {}` sets a non-index property on an array; `JSON.stringify(settings)`
  then serializes `[]`, **silently discarding all hooks**.
- Primitive (`"x"`, `42`) → assigning `.hooks` throws in ESM strict mode.

This is the input class `checkHookRegistration` was hardened against ("Never-throws sobre settings
malformado"). Since the doctor tells users to run `kodo install` as the remedy, a
malformed-but-parseable settings turns the remedy itself into a crash. Note doctor's
`defaultReadSettings` already treats JSON-`null` as "unreadable" (WARN, no exit 1), so the two
halves disagree on the same input.

**Fix:** Guard the shape after parse in both functions:

```js
settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
  console.error(`${SETTINGS_PATH} is not a JSON object`);
  return false;
}
```

### WR-03: `doctor --states` reports ALL required states missing for non-plane providers (false positives → false exit 1)

**File:** `src/cli/doctor.js:220-233` (`defaultListStatesFactory`) with `:126-135`
**Issue:**
For any provider other than `plane`, the factory returns `async () => []`:

```js
if (provider !== 'plane') {
  return async () => [];   // "no-op vacío"
}
```

`runStatesCheck` feeds that empty list into `checkStates({ requiredStates, availableStateNames: [] })`.
If the provider declares required states (GitHub config sets `states.review = 'closed'`), *every*
required state is reported missing, each configured project becomes a problem, and the command
exits 1. The "no-op" intent (skip the check) produces the opposite: a confident false "estados
ausentes" — the same failure mode (a diagnostic fabricating a problem it cannot observe) that
`kodo doctor` exists to eliminate. Reachable only via the real CLI under `--states` with a
non-plane provider, so scoped, but it is a wrong diagnosis.

**Fix:** Short-circuit the states check for providers without per-project states (e.g.
`runStatesCheck` returns `{ checked: 0, problems: [] }` when `provider !== 'plane'`), or have the
factory signal "unsupported" so the caller emits a WARN ("estados no verificables para <provider>")
instead of marking everything missing.

### WR-04: Tests 2 and 4 filter hook commands by the `'kodo'` substring — path-dependent (false-fail) and can mask uninstall regressions (false-pass)

**File:** `test/hooks/install.test.js:109-110` and `:153-154`
**Issue:**
`installHooks` derives its command from `import.meta.dirname` (the real checkout path). Test 2
asserts one kodo entry via `.filter((c) => c.includes('kodo'))`; Test 4 asserts removal via
`!ss.some((c) => c.includes('kodo'))`. Both lean on the checkout path containing the literal
`kodo`:
- Test 2 (positive) **false-fails** if the repo is checked out to a path without `kodo`
  (worktree, fork, CI cache) — the command no longer contains `kodo`, the filter returns 0, and
  `assert.equal(ss.length, 1)` fails despite install working.
- Test 4 (negative) **false-passes** in the same situation — `!some(includes('kodo'))` is
  vacuously true even if uninstall failed, masking a real regression.

This is the exact fragility the B9 fix (Test 6/6b) moved away from — matching by the canonical
`/src/hooks/<name>.js` segment rather than the generic `'kodo'` substring. Tests 2 and 4 were
left on the old proxy.

**Fix:** Match the canonical path segment, consistent with Test 1/6:

```js
// Test 2
const ss = commandsOf(hooks, 'SessionStart').filter((c) => c.includes('/src/hooks/session-start.js'));
const stop = commandsOf(hooks, 'Stop').filter((c) => c.includes('/src/hooks/stop.js'));
// Test 4
assert.ok(!ss.some((c) => c.includes('/src/hooks/')), 'SessionStart sin entry kodo');
assert.ok(!stop.some((c) => c.includes('/src/hooks/')), 'Stop sin entry kodo');
```

## Info

### IN-01: `doctor.js` module header omits the hooks-drift section added this phase

**File:** `src/cli/doctor.js:3-18`
**Issue:** The header describes only the config↔projects cross-check and `--states`; the exit-code
note (line 14) still reads "1 si hay CUALQUIER finding de alineación o problema de estados" and
omits hook drift, which now also forces exit 1 (line 88). The header gives a stale contract for a
command this phase extended.
**Fix:** Add a bullet for the always-on hooks-drift section and amend the exit-code line to include
"o deriva de registro de hooks".

### IN-02: `hasHookDrift` recomputed in `renderHuman`; drift-only case prints no closing verdict

**File:** `src/cli/doctor.js:85` vs `:188`, and `:201-206`
**Issue:** The predicate `settingsReadable && hooks.missing.length > 0` is written twice. When the
*only* problem is hook drift, neither verdict branch fires (line 202 false because `hasHookDrift`;
line 204 false because no alignment/state issues), so no trailing line prints — exit code is
correctly 1 and the hooks section printed its own "remedio", but the render is asymmetric with the
other problem paths.
**Fix:** Thread the single `hasHookDrift` value from `runDoctor` into `renderHuman` instead of
recomputing, and add an explicit closing line for the drift-only case.

---

## Narrative Findings (AI reviewer)

All findings above are narrative (no `<structural_findings>` block was supplied). Areas that held
up under adversarial tracing and produced **no** finding:

- `src/session/handoff.js`: `sanitizeInline` neutralizes the only structural forgery vector
  (`\r`/`\n`) that `findSessionBlock` (which splits solely on `\n`) is sensitive to; U+2028/U+2029
  are not collapsed but also cannot create a parser line-break, so no forgery bypass.
  `findSessionBlock` searches `-->` strictly after the open token and matches `session=<id>` by
  exact token (not substring) — the s-1 vs s-1-extra case is safe. `extractNext` hard-caps at 200.
  Zero-import leaf invariant is guarded by `check-isolation.test.js`.
- `session-start.js`: the resolved `session=<id>` marker in the injected instruction lines up
  byte-for-byte with what `findSessionBlock` expects; anti-push golden bytes preserved.

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
