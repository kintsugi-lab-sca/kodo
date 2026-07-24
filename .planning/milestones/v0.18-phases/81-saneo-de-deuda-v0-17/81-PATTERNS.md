# Phase 81: Saneo de deuda v0.17 - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 8 (5 modified code/test, 1 read-only diagnosis, 2 read-only references)
**Analogs found:** 8 / 8 (all in-repo — brownfield debt cleanup, every analog is the file itself or a sibling)

> This is a brownfield debt phase. There are NO net-new files. Every "new" pattern is a
> surgical edit to an existing site whose current shape is quoted below. The "analog" is
> either the file itself (before→after) or an in-repo mirror the edit must match.

## File Classification

| File (modified) | Role | Data Flow | Debt | Closest Analog | Match Quality |
|-----------------|------|-----------|------|----------------|---------------|
| `src/session/state.js` (`upsertTaskHandoff` :418) | model/persistence (writer under `withStateLock`) | CRUD (merge-on-write) | DEBT-01 | self (`:448` merge line) + sibling `removeSession` guards | exact (self) |
| `src/hooks/session-end.js` (`writeHandoff` :299) | hook/caller | event-driven (SessionEnd → write) | DEBT-01 | self (branch returns `:347`,`:376`; upsert call `:389`) | exact (self) |
| `test/state/handoff-state.test.js` | test | unit (persistence) | DEBT-01 | self (asymmetry cases `:147`,`:224`) | exact (self) |
| `src/cli/dashboard/format.js` (`nextCell` :258) | utility (render projection) | transform (string→cell) | DEBT-03 | self + adopt-picker `.replace(/\s+/g,' ')` (`SessionTable.js`) | exact (self) |
| `test/dashboard-format.test.js` (`:505-531`) | test | unit (render) | DEBT-03 | self (existing `nextCell` describe block `:509`) | exact (self) |
| `src/cli/dashboard/App.js` (comment :735) | component (doc-only) | n/a | DEBT-02a | self + `75-REVIEW.md` WR-02 text | exact (self) |
| `src/cli/dashboard/SessionTable.js` (typedef :817) | component (doc-only) | n/a | DEBT-02b | mirror `plan.js:48` `PlanResult` typedef | exact (mirror exists) |
| `test/gsd-lock-race.test.js` (:142 CR-01) | test/diagnosis | event-driven (multi-process race) | DEBT-04 | self (harness `:74-118`) + debug artifact `state-tasks-missing-live04.md` | exact (self) |

**READ-ONLY (referenced, never edited):** `src/gsd/lock.js` (`stealLock` :283-351, v0.16 invariant LOCKED), `src/session/handoff.js` (`extractNext` :287-297), `src/cli/dashboard/plan.js:48` (typedef mirror source).

## Pattern Assignments

### `src/session/state.js` — `upsertTaskHandoff` (model, CRUD merge) — DEBT-01

**Analog:** self. The change replaces ONE line and rewrites the JSDoc asymmetry block.

**Current merge line to replace** (`:448`, inside the `withStateLock` mutator):
```js
// The ONE field where an absent incoming value is semantically different
// from a persisted `null` ...
next: entry.next ?? (prev ? prev.next : null) ?? null,
```
The `??` conflates `null` and `undefined` → both preserve. This IS the bug.

**Target three-state shape** (from RESEARCH Code Examples; executor finalizes exact form). Build the value before the object literal so the `persisted = {...}` literal at `:436-454` stays readable:
```js
let nextValue;
if (!('next' in entry) || entry.next === undefined) {
  nextValue = prev ? prev.next : null;   // absent → preserve (mechanical backstop)
} else if (entry.next === null) {
  nextValue = null;                       // explicit null → deliberate clear (LLM no-NEXT)
} else {
  nextValue = entry.next;                 // non-empty string → overwrite
}
// ... next: nextValue,   in the persisted literal
```

**JSDoc rewrite** (`:403-409` currently documents the OLD binary asymmetry — must become the three-state table, D-04). Preserve the Phase 74 74/WR-02 rationale (do NOT delete it — RESEARCH "State of the Art"); reframe it as: mechanical close = field-absent = preserve; LLM-no-NEXT = `null` = clear. Also update the `@param entry` line `:412` and note `next: string|null` stays legal (no schema bump).

**Invariants to preserve (do NOT touch):**
- Telemetry: `logger.info('state.task.handoff_saved', { task_id })` (`:463`) — `next` NEVER logged (T-71-18).
- `prev` comes from the mutator's own `state` arg (`:435`), never a re-load (T-74-16 lost-update guard).
- The return `{ ok: true, value: persisted }` (`:464`) carries the EFFECTIVE post-merge value for LIVE-07 — keep it.
- Defensive `if (!state.tasks) state.tasks = {}` (`:428`).

---

### `src/hooks/session-end.js` — `writeHandoff` caller (hook, event-driven) — DEBT-01

**Analog:** self. Two branches inside `withFileLock` currently BOTH collapse to `next: null` — the discriminator must survive out of the lock.

**Current branch returns:**
```js
// LLM branch (:347) — LLM authored the block this session:
return { planPath, next: extractNext(existing) };   // extractNext → null if no **NEXT:** line
// Mechanical backstop (:376) — hook appended the minimum, no NEXT by design:
return { planPath, next: null };
```

**Current upsert call** (`:389-393`) passes `r.value.next` unconditionally — this is the anti-pattern to fix:
```js
const upsertResult = stateWriterFn(
  taskId,
  { plan_path: r.value.planPath, next: r.value.next, updated_at: now().toISOString() },
  log,
);
```

**Required change (D-02, RESEARCH Deep Finding + Assumption A2):** thread an authorship discriminator out of `withFileLock` (e.g. mechanical branch returns `next: undefined` OR add an `authored: 'llm'|'auto'` flag), then build the entry conditionally at the call site:
- LLM-authored branch → pass `next: extractNext(existing)` (may be `null` → clear).
- Mechanical backstop → **omit** the `next` key entirely (→ preserve prev).

Do the conditional-key build with an object spread, e.g. `{ plan_path, updated_at, ...(authored === 'llm' ? { next } : {}) }`.

**Invariant to preserve — LIVE-07 nudge coupling** (`:395-404`, RESEARCH Pitfall 3/5): `effectiveNext` MUST read the POST-merge `upsertResult.value.next`, not `r.value.next`. Keep this derivation intact:
```js
const effectiveNext = upsertResult && upsertResult.ok && upsertResult.value
  ? upsertResult.value.next
  : r.value.next;
return { planPath: r.value.planPath, next: effectiveNext };
```
Also update the JSDoc at `:295-297` describing the effective-next return contract.

---

### `test/state/handoff-state.test.js` — writer unit tests — DEBT-01

**Analog:** self. Existing cases encode the OLD semantics and MUST be edited (expected, not a regression — RESEARCH Pitfall 2).

**Harness pattern already in place (reuse verbatim):** HOME-isolation via `process.env.HOME = tmpHome` BEFORE dynamic `await import()` inside `before()` (header `:12-26`), v3 state.json seeding mandatory, `loadState().tasks.t1` to assert persisted value.

**Case-editing map (verified line numbers):**
- `:147` "un NEXT: real sobrevive a un cierre mecánico posterior" — currently expresses the mechanical close as `next: null` (`:160`). Under the new contract `null` CLEARS. Re-express the mechanical close as **field-absent** (omit `next`, keep `plan_path`+`updated_at`) so its preserve-intent still holds.
- `:224` "el value devuelto honra la ASIMETRÍA … cierre mecánico tras un NEXT: previo" — same fix: `next: null` (`:234`) → field-absent.
- `:300` "persists next: null as null" — stays true; its MEANING is now "clear" — optionally reword comment only.
- `:312` "defaults next to null when field omitted" (no-prev) — still passes (omit → preserve → null with no prev); keep + add the with-prev counterpart.

**New cases to ADD (D-04):**
- `next: null` with pre-existing `prev.next` → persists `null` (explicit clear).
- `next` omitted with pre-existing `prev.next` → preserves `prev.next` (mechanical preserve).
- LIVE-07 return `value.next`: clear → `null`; preserve → `prev.next`.

Follow the existing `it('…', () => { upsertTaskHandoff(...); const entry = loadState().tasks.t1; assert.equal(...) })` shape (`:147-175`).

---

### `src/cli/dashboard/format.js` — `nextCell` (utility, transform) — DEBT-03

**Analog:** self + in-repo adopt-picker `.replace(/\s+/g, ' ')` precedent (`SessionTable.js`, cited 75/WR-03).

**Current** (`:258-260`):
```js
export function nextCell(session) {
  return typeof session.next === 'string' && session.next.length > 0 ? session.next : '';
}
```

**Target shape (D-05, RESEARCH Pattern 1 — collapse-at-projection):**
```js
export function nextCell(session) {
  if (typeof session.next !== 'string') return '';   // never-throws, non-string → '' (D-07)
  const s = session.next.replace(/\s+/g, ' ').trim(); // \s covers \n \t \r + multi-space
  return s;                                            // empty → '' , NO placeholder (SC5, Pitfall 4)
}
```
- Stays pure, no own color (color-isolation D-12). Update the JSDoc `:248-256` to note the collapse.
- Do NOT move the collapse into App.js enrich — the datum stays verbatim in `state.json` (D-06); enrich keeps `stripControlChars` only (`App.js:753`). Complementary layers (RESEARCH Pattern 2).
- `rowCells` (`:271`) consumes `nextCell` unchanged — single point of change.

---

### `test/dashboard-format.test.js` — `nextCell` unit tests — DEBT-03

**Wave 0 gap RESOLVED:** the format test file is `test/dashboard-format.test.js` (not `test/dashboard/format.test.js`). The `nextCell` describe block already exists at `:509` ("LIVE-05 (SC5): nextCell proyecta el NEXT: por tarea").

**Existing cases to extend** (`:511-525`): string passthrough, `null`/`undefined`/`''`/`{}` → `''`, non-string (`42`, `{}`) → `''`. **Add** whitespace-collapse cases:
- `nextCell({ next: 'a\nb\tc' })` → `'a b c'`
- `nextCell({ next: '  multiple   spaces  ' })` → `'multiple spaces'` (trim + collapse)
- `nextCell({ next: '\n\t \r' })` → `''` (whitespace-only → empty, no placeholder)

Follow the existing `assert.equal(nextCell({ next: ... }), ...)` one-liner shape.

---

### `src/cli/dashboard/App.js` — comment fix (doc-only) — DEBT-02a

**Analog:** self + `75-REVIEW.md` WR-02 exact text (executor MUST read it before rewording — D-11).

**Current comment** (`:735-736`):
```js
// Phase 75 (LIVE-05, D-02): lee el bloque `tasks` de ~/.kodo/state.json UNA vez por tick,
// piggyback sobre el tick de usePoll que ya refresca /status ...
```
WR-02 flags "UNA vez por tick" as inaccurate — the read (`readTasksFn({})` `:739`) happens on EVERY render, not once per tick. Reword to reflect "one synchronous read per render" (RESEARCH Open Q2). **Doc-only — do NOT change render behavior** (D-12 evidence = unmodified green suite). No memoization.

---

### `src/cli/dashboard/SessionTable.js` — typedef fix (doc-only) — DEBT-02b

**Analog:** mirror `src/cli/dashboard/plan.js:48` `PlanResult` typedef, which already declares `render?: 'markdown'|'plain'`.

**Current typedef** (`:817`, missing `render`):
```js
 * @param {{ kind: 'comments'|'logs'|'plan', taskRef: string, status: string, lines: string[] }|null} [props.overlaySnapshot]
```

**Target:** add `render?: 'markdown'|'plain'` to the inline object type, mirroring `plan.js:48`:
```js
 * @param {{ kind: 'comments'|'logs'|'plan', taskRef: string, status: string, lines: string[], render?: 'markdown'|'plain' }|null} [props.overlaySnapshot]
```
Pure JSDoc — zero runtime. No new test (D-12).

---

### `test/gsd-lock-race.test.js` — flaky diagnosis (READ-ONLY unless root cause) — DEBT-04

**Analog:** self (harness `raceGsdStealDeadHolder` `:74-118`, CR-01 cases `:143`/`:153`) + debug-artifact format from `.planning/debug/resolved/state-tasks-missing-live04.md`.

**Deliverable = diagnosis, NOT a fix.** `src/gsd/lock.js` (`stealLock` CAS `:283-351`) is READ-ONLY (D-09, v0.16 LOCKED). Forbidden blind: retries, `.skip`, raising timeouts, editing `lock.js` without a confirmed cause (Pitfall 5).

**Repro loops (RESEARCH Diagnostic Guidance):**
```bash
# Cold loop of just the flaky file
for i in $(seq 1 50); do node --test test/gsd-lock-race.test.js || { echo "FAILED run $i"; break; }; done
# Under load: full suite in parallel, looped
for i in $(seq 1 20); do node --test $(find test -name '*.test.js' -type f) || { echo "FAILED run $i"; break; }; done
```

**Harness facts:** seeds a dead-PID (`99999999`) stale lock at `<realpath repo>/.planning/.kodo.lock` (`:79-95`), spawns N children via `test/helpers/lock-race-child.mjs` with `--hold 500`, asserts exactly one `acquired` (`:146`).

**Hypotheses to record (D-08/D-10):** (a) briefly-empty window between move-aside and O_EXCL create; (b) harness timing — hold-expiry before a loser evaluates (→ a TEST fix is legitimate, not a product fix); (c) cold-vs-load (12 green cold runs 2026-07-06).

**Artifact convention:** write to `.planning/debug/` (move to `resolved/` when closed). Structure from `state-tasks-missing-live04.md`: `# Debug: <title>` → Fecha / Gap / Metodología → `## Síntoma` → `## Evidencia (verificada, no inferida)` → `## Root Cause` → `## Files Involved` → `## Suggested Fix Direction`. Plus a resolution note in the phase dir. If cheap instrumentation is warranted (no repro), add it to the TEST/helper (dump verdicts on failure), NEVER to `lock.js`.

---

## Shared Patterns

### Persistence under lock (DEBT-01)
**Source:** `src/session/state.js` `withStateLock` wrapper (`:425`), and the sibling `removeSession` defensive-guard style (`if (!state.tasks) state.tasks = {}`).
**Apply to:** the `upsertTaskHandoff` merge — the primitive is untouched; only the in-lock merge logic changes. `prev` from the mutator's own `state` arg (never a re-load).

### Layered sanitization (Phase 78 lane, DEBT-03)
**Source:** `App.js:753` enrich `stripControlChars` (control-char neutralization) + adopt-picker `.replace(/\s+/g,' ')` (SessionTable.js).
**Apply to:** `nextCell` gets the WHITESPACE/layout layer; enrich keeps the CONTROL-CHAR layer. Complementary, not redundant — do not merge them (D-06).

### Never-throws render projection (DEBT-03)
**Source:** existing `nextCell`/`progCell`/`taskCell` pure-cell molds in `format.js`.
**Apply to:** `nextCell` — non-string input → `''`, empty → `''` (no placeholder, SC5), no own color (D-12 color-isolation).

### Doc-only Tier-1 change (DEBT-02)
**Source:** the unmodified-green-suite-as-evidence precedent (v0.11 Phase 47, CONTEXT §Established Patterns).
**Apply to:** App.js comment + SessionTable.js typedef — zero behavior, no new tests; the existing suite passing unmodified IS the proof (D-12).

### JSDoc mirror (DEBT-02b)
**Source:** `plan.js:48` `PlanResult` already declares `render?: 'markdown'|'plain'`.
**Apply to:** copy the `render?` field verbatim into `SessionTable.js:817` `overlaySnapshot` typedef.

### Debug artifact convention (DEBT-04)
**Source:** `.planning/debug/resolved/state-tasks-missing-live04.md` (Síntoma → Evidencia → Root Cause → Files → Fix Direction).
**Apply to:** the `/gsd-debug` diagnosis for CR-01; `.planning/debug/` staging, move to `resolved/` when closed.

## No Analog Found

None. Every touched site has a self-analog (before→after) or an in-repo mirror. This is a
brownfield debt phase — the planner should reference the exact line numbers above, not
RESEARCH.md's generic patterns.

## Metadata

**Analog search scope:** `src/session/`, `src/hooks/`, `src/cli/dashboard/`, `src/gsd/` (read-only), `test/`, `test/state/`, `test/hooks/`, `.planning/debug/resolved/`.
**Files scanned:** state.js, session-end.js, format.js, App.js, SessionTable.js, plan.js, lock.js (read-only), handoff.js (read-only), handoff-state.test.js, dashboard-format.test.js, gsd-lock-race.test.js.
**Wave 0 gaps resolved:** (1) format test file = `test/dashboard-format.test.js` with an existing `nextCell` describe at `:509`; (2) session-end hook tests exist (`test/hooks/session-end.test.js`, `test/hooks/session-end-handoff.test.js`) — the DEBT-01 caller-mapping case can land there or writer-level tests cover it.
**Pattern extraction date:** 2026-07-24
