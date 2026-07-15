---
phase: 74-handoff-acumulativo-al-cierre
verified: 2026-07-15T11:02:28Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Tras el cierre, `state.json` refleja para esa tarea el puntero al plan y el `NEXT:` de una línea (LIVE-04, SC#4)"
    status: partial
    reason: >
      The locking/concurrency half of this truth is verified true (withStateLock, additive
      `tasks` field, reconcileTick stays the sole writer of `alive`, cross-process race
      test with mutation-tested teeth). But the "reflects the NEXT" half is FALSE in an
      ordinary two-session sequence: `upsertTaskHandoff` unconditionally overwrites the
      whole `state.tasks[taskId]` entry, defaulting `next` to `null` when the new entry
      carries none. A mechanical close (LIVE-03's own designed backstop path — no LLM
      handoff written) on a task that already had a real `NEXT:` from a prior session
      silently erases it in `state.json`, even though the real `NEXT:` block is still
      intact, byte-for-byte, in the plan file. This directly contradicts the must_have this
      phase's own Plan 02 declared ("El dato sobrevive a `removeSession`... así que la
      SIGUIENTE sesión de la misma tarea lo encuentra") and the phase's stated purpose
      ("sin este dato, ni el dashboard ni el nudge tienen nada que enseñar" — Phase 75 will
      render an empty NEXT cell despite a real one existing on disk). Independently
      reproduced below (Plan 02/Code Review WR-02, re-verified by this run, not merely
      trusted from SUMMARY/REVIEW).
    artifacts:
      - path: "src/session/state.js:408-429 (upsertTaskHandoff)"
        issue: "`next: entry.next ?? null` replaces the whole entry; does not fall back to the previous entry's `next` when the new one is absent."
      - path: "src/hooks/session-end.js:365-366 (writeHandoff, mechanical-block branch)"
        issue: "Mechanical block always calls `stateWriterFn` with `next: null` by design (LIVE-03), which then clobbers a prior real NEXT via the upsert above."
    missing:
      - "Preserve the previous `state.tasks[taskId].next` when the incoming entry's `next` is absent/null, per the WR-02 fix already proposed in 74-REVIEW.md (`const prev = state.tasks[taskId]; next: entry.next ?? (prev ? prev.next : null) ?? null`)."
      - "A regression test seeding a real NEXT via one `upsertTaskHandoff` call, then calling it again with `next: null`, asserting the previous NEXT survives."
deferred: []
behavior_unverified_items: []
human_verification:
  - test: "LIVE-01/SC#1 — launch a real kodo session against a task, close it with `/exit`, and open `~/.kodo/plans/<task_id>.md`."
    expected: "The file contains a `## Handoff <fecha>` block with Hecho/Pendiente (and NEXT: if the LLM wrote one)."
    why_human: "The write, its ordering before destructive cleanup, and its content are covered by unit/integration tests against injected deps; the end-to-end lived experience of a real Claude Code session closing was flagged by the executor (74-05-PLAN.md human-check) as not automatable in node:test."
  - test: "LIVE-03/SC#3 — provoke a close where the LLM does not write a handoff block, then read the resulting heading."
    expected: "The heading reads `... — automático` and is visually distinguishable at a glance from an LLM-authored block."
    why_human: "'Distinguishable at a glance' is a human visual judgment; the test suite can only assert the string suffix is present, not that it reads as obviously-different to an operator."
---

# Phase 74: Handoff acumulativo al cierre Verification Report

**Phase Goal:** Al cerrar una sesión, la tarea deja **estado vivo**: su plan gana un bloque de handoff que se acumula sesión tras sesión (nunca se pisa), y `state.json` guarda el puntero al plan + el `NEXT:` de una línea. Es el productor de todo el milestone: sin este dato, ni el dashboard ni el nudge tienen nada que enseñar.
**Verified:** 2026-07-15T11:02:28Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP §Phase 74 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (LIVE-01) | Handoff block appended to `~/.kodo/plans/<task_id>.md` BEFORE destructive terminal cleanup (removeSession + worktree + promptFile) | ✓ VERIFIED | `session-end.js:143` (`writeHandoff` call) is 66 lines before `performTerminalCleanup` at `:209`. Test `ORDEN OBSERVABLE (LIVE-01, SC#1)` in `test/hooks/session-end-handoff.test.js:467` asserts `iHandoff < iRemove` on the shared call-order array. `node --test` green. |
| 2 (LIVE-02) | Second session of the same task accumulates a second block; first stays intact; `session-start.js` no longer orders "overwrite if exists" | ✓ VERIFIED | `src/hooks/session-start.js:94-99` (ES) and `:173-178` (EN) both instruct "NO lo sobrescribas: añade tu plan al final" / "do NOT overwrite it: append". `findSessionBlock` in `handoff.js` is scoped per `session=<id>` exact token, not by count. Test `acumulación (LIVE-02)` (`session-end-handoff.test.js:182`) confirms two blocks + first byte-identical. `CASO CRÍTICO D-04` test confirms a prior session's block does not fool the current session's detector. |
| 3 (LIVE-03) | If the LLM closes without a handoff, the hook appends a minimal mechanical block (date + result, no NEXT), distinguishable from an LLM-written block | ✓ VERIFIED | `buildHandoffBlock` (`handoff.js:159-170`) emits heading `... — automático` + `author=auto` in the marker, vs. the LLM-instructed format's `author=llm` (`session-start.js:99`, `:178`). `extractNext` on a mechanical block always returns `null` (no `**NEXT:**` line emitted). Test `bloque mecánico appendeado → next es null` confirms. |
| 4 (LIVE-04) | `state.json` reflects the plan pointer + one-line NEXT for the task; concurrent writes (hook + reconcile + server) lose nothing; hook goes through `withStateLock`; `reconcileTick` stays sole writer of `alive` | ✗ **FAILED (partial)** | Concurrency/locking half TRUE: `upsertTaskHandoff` only mutates `state.tasks` (never `alive`); `test/state/handoff-state.test.js` asserts no `alive` key touched; `test/state/handoff-concurrency.test.js` proves, cross-process, with mutation-tested teeth (lock bypassed → 0/3 pass), that no `state.tasks` entry is lost under N concurrent closes. BUT the "reflects the NEXT" half is FALSE: `upsertTaskHandoff` (`state.js:408-429`) unconditionally sets `next: entry.next ?? null`, so a later mechanical close (no LLM NEXT) nulls a real NEXT recorded by an earlier session on the same task. Reproduced independently (see Gap below) — not a hypothetical. |
| 5 (SC#5) | A failing handoff (unreadable plan, unexpected format, busy lock) does not crash Claude Code nor block close; hook stays never-throw; `backstop → setColor → notify` order intact | ✓ VERIFIED | `session-end.js:142-146` wraps `writeHandoff` in its own try/catch (structural, not cosmetic — `withFileLock`'s `fn` has no catch and `acquireLock` rethrows non-EEXIST errors). `runReviewBackstop` at `:176`, `setColor` at `:226`, `notify` at `:236` — order unchanged, inserted before, not interleaved. Tests: `SC#5 — plan ilegible (EACCES)` and `SC#5 — lock ocupado` both assert the hook completes and the trio still runs. |

**Score:** 4/5 truths verified (1 partial failure — see Gaps).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/session/handoff.js` | Zero-import pure leaf: writer (buildHandoffBlock, buildPlanHeader, isSafeTaskId, normalizeReason, sanitizeInline) + parser (findSessionBlock, hasSessionHandoff, extractNext) | ✓ VERIFIED | 272 lines, 9/9 exports present, zero imports confirmed by reading the file and by `test/check-isolation.test.js:160-177` (D-13 guard, negative-tested by the executor injecting a real import and watching the guard fail). |
| `src/session/state.js` (`upsertTaskHandoff`) | Writer of `state.tasks` under `withStateLock`, additive, no schema bump | ✓ VERIFIED (wired), ⚠️ correctness gap — see Gaps | Function exists, wired into `writeHandoff`, mutates only `state.tasks`. `migrateStateV2toV3` still silently drops any pre-existing `tasks` key (WR-03) — confirmed present in code, but not reachable via the real hook flow today (session-end.js's `findSession` guard means `state.json` already exists and has already gone through one `loadState()`/migration cycle by the time `writeHandoff` runs). Latent, not a phase-blocking gap. |
| `src/hooks/session-end.js` (`writeHandoff` + seam) | RMW under `withFileLock`, create-if-missing, wired at the seam before cleanup | ✓ VERIFIED | `writeHandoff` (lines 289-384) confirmed synchronous, guards `isSafeTaskId` first, tmp+rename with unique name (`planPath + '.tmp.' + pid + '.' + randomUUID()`), never uses `writeFileAtomic`. Seam wired at `:143`. |
| `src/hooks/session-start.js` | Both instruction branches (ES non-GSD, EN GSD-quick) inverted to preserve-and-append | ✓ VERIFIED | Confirmed at `:94-99` and `:173-178`. |
| `test/session/handoff.test.js`, `test/state/handoff-state.test.js`, `test/hooks/session-end-handoff.test.js`, `test/state/handoff-concurrency.test.js`, `test/helpers/lock-race-child.mjs` | Test suites backing the above | ✓ VERIFIED (exist, run, pass) | All 5 files present; targeted run (`node --test` on the 6 phase-specific files) = 155/155 pass. Full `npm test` = 2130 total, 2129 pass, 0 fail, 1 skipped (matches SUMMARY claims). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `session-end.js:143` (`writeHandoff` call) | `session-end.js:209` (`performTerminalCleanup`) | Call-order in the same function body | ✓ WIRED | 66 lines apart; test asserts `iHandoff < iRemove` on a shared instrumented-call array. |
| `writeHandoff` | `src/session/handoff.js` (isSafeTaskId, buildPlanHeader, buildHandoffBlock, findSessionBlock, extractNext) | Static import (`session-end.js:25-31`) | ✓ WIRED | All 5 symbols imported and used inside `writeHandoff`. |
| `writeHandoff` | `upsertTaskHandoff` (`../session/state.js`) | `stateWriterFn` injected default, called at `:379-383` | ✓ WIRED | Confirmed call site passes `{plan_path, next, updated_at}`; test `el stateWriterFn recibe la entrada de state.tasks exactamente una vez por cierre (LIVE-04)` passes. |
| `upsertTaskHandoff` | `withStateLock` | Direct call (`state.js:412`) | ✓ WIRED | Confirmed; mutator only touches `state.tasks`. |
| `session-start.js` instruction text | The exact marker format `findSessionBlock` parses | Literal string match (`session-start.js:99`/`:178` vs. `handoff.js` `HEADING_PREFIX`/`MARKER_OPEN`) | ✓ WIRED | Both use `## Handoff <fecha> <!-- kodo:handoff v=1 session=<id> ... -->`, matching `handoff.js`'s `HEADING_PREFIX`/`MARKER_OPEN`/`MARKER_CLOSE` constants. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| LIVE-01 | 74-01, 74-04 | Handoff block appended before destructive cleanup | ✓ SATISFIED | Truth #1 above. Left `Pending` in REQUIREMENTS.md deliberately by all 5 executors (phase-level requirement, correctly deferred to this verification gate) — recommend marking **Complete**. |
| LIVE-02 | 74-01, 74-03 | Second session accumulates without overwriting | ✓ SATISFIED | Truth #2 above. Already marked `Complete` in REQUIREMENTS.md — confirmed correct. |
| LIVE-03 | 74-01, 74-04 | Mechanical backstop block, distinguishable, no NEXT | ✓ SATISFIED | Truth #3 above. Left `Pending` deliberately — recommend marking **Complete**. |
| LIVE-04 | 74-02, 74-04, 74-05 | `state.json` reflects pointer + NEXT; concurrency-safe; `withStateLock`; `reconcileTick` sole writer of `alive` | ✗ **NOT FULLY SATISFIED** | Truth #4 above. Concurrency/locking half true; NEXT-preservation half FALSE (WR-02, reproduced). Recommend leaving **Pending** until WR-02 is fixed or explicitly overridden. |

No orphaned requirements: all four IDs (LIVE-01..04) are declared across the phase's plan frontmatter and map to the phase's own Success Criteria; none are left unaddressed by any plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/session/state.js` | 408-429 (`upsertTaskHandoff`) | Whole-entry overwrite with `?? null` fallback, no "preserve previous NEXT" guard | 🛑 Blocker (for LIVE-04's full claim) | Silently regresses a real, user-meaningful `NEXT:` to `null` on the very next mechanical close of the same task — reproduced independently, see Gaps. |
| `src/session/state.js` | 128-151 (`migrateStateV2toV3`) | Exhaustive rebuild drops any unknown key, including `tasks` | ⚠️ Warning (latent, not reachable via the current hook flow) | Documented in 74-REVIEW.md (WR-03) and confirmed present in code; not currently reachable because `session-end.js`'s `findSession` guard means `state.json` has already been migrated at least once by the time `writeHandoff` runs. Reachable from any future direct caller of `upsertTaskHandoff` bypassing the session-tracked flow (e.g., a careless Phase 75 addition, or test helpers). |
| `src/session/handoff.js` | 163 (`buildHandoffBlock`) | `sessionId` interpolated into the marker with zero validation, unlike every other untrusted field in the module | ⚠️ Warning (latent, low current reachability) | Documented in 74-REVIEW.md (WR-01); confirmed by reading the code — `sessionId` is the one value the entire D-04 detector keys on and it is not sanitized like `reason`/`status`/`summary`/`task_ref`. Not reachable today because `session_id` is always `randomUUID()` at the two call sites (`manager.js:292`, `dispatcher.js:170`), but a defense-in-depth gap in a module whose own stated thesis is "validate before interpolating". |
| `src/hooks/session-start.js` | 94, 173 | `session.task_id` interpolated into a filesystem path told to the LLM, without the `isSafeTaskId` guard this same phase built and applied on the writer side (`session-end.js:300`) | ⚠️ Warning | Documented in 74-REVIEW.md (WR-05); confirmed no `isSafeTaskId` import in `session-start.js`. The writer refuses unsafe task_ids but the instruction side has already told the LLM to write there — asymmetric application of a guard this exact phase introduced. |
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 12 phase-touched files | — | Clean. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted phase test files pass | `node --test test/session/handoff.test.js test/hooks/session-end-handoff.test.js test/state/handoff-state.test.js test/state/handoff-concurrency.test.js test/session-start.test.js test/gsd-context.test.js` | 155/155 pass, 23 suites | ✓ PASS |
| Full suite (single run, per constraint) | `npm test` | 2130 tests, 2129 pass, 0 fail, 1 skipped | ✓ PASS |
| Real `~/.kodo` untouched by the test run | `ls ~/.kodo/plans/` before/after; no `.lock`/`.tmp.*` residue | Same file count, no stray lock/tmp artifacts | ✓ PASS |
| **WR-02 reproduction (LIVE-04 correctness)** | `node -e` script: `addSession` → `upsertTaskHandoff(t1, {next:'desplegar el fix'})` → `upsertTaskHandoff(t1, {next:null})`, inspecting `loadState().tasks.t1` after each step, under an isolated `HOME` | After step 2 (real NEXT): `{"next":"desplegar el fix",...}`. After step 3 (mechanical close, same task): `{"next":null,...}` — the real NEXT is gone. | ✗ FAIL — confirms WR-02 is production-reachable, not hypothetical |

### Human Verification Required

See frontmatter `human_verification` — both items harvested from `74-05-PLAN.md`'s deferred `<human-check>` block (explicitly deferred to this gate by the executor, not skipped):

1. **LIVE-01/SC#1 end-to-end.** Launch a real kodo session, close with `/exit`, open the plan file — confirm the handoff block is really there from the operator's chair. Not automatable in `node:test`.
2. **LIVE-03/SC#3 visual distinguishability.** Confirm the mechanical block's `— automático` heading actually reads as obviously-different at a glance, not just as a string match.

(A third note in the same block — the raw HTML marker being visible in the Phase-74 plan overlay until Phase 75 renders markdown — is a documented, accepted, non-bug window, not a verification item.)

## Gaps Summary

Phase 74 delivers 4 of its 5 success criteria cleanly, with real teeth: the ordering guarantee (LIVE-01), the accumulation-without-overwrite guarantee (LIVE-02), the mechanical backstop (LIVE-03), and the never-throw/order-preservation guarantee (SC#5) are all verified against the actual code and pass targeted + full test runs, including a mutation-tested cross-process concurrency proof for the locking mechanics themselves.

The one real gap is in LIVE-04: the concurrency/locking machinery is genuinely solid (state.tasks entries are never lost across concurrent closes, `alive` is untouched, `withStateLock` is respected throughout), but the data `upsertTaskHandoff` persists can still be **semantically wrong** — a later, ordinary mechanical close (the exact scenario LIVE-03 exists to handle) silently erases a real `NEXT:` recorded by an earlier session of the same task, even though that `NEXT:` remains intact on disk in the plan file. This was flagged in 74-REVIEW.md as WR-02 and I independently reproduced it end-to-end (not merely trusted from the review or SUMMARY): `addSession` → real-NEXT close → mechanical close leaves `state.tasks[t].next === null`. This directly contradicts a must_have this phase's own Plan 02 declared, and undermines the "producer" framing of this phase for Phase 75's dashboard, which will render an empty NEXT cell in exactly this common case.

The fix is already sketched in 74-REVIEW.md (preserve the previous `next` when the incoming entry's is absent) and is a small, surgical change to `upsertTaskHandoff` plus one regression test. Two secondary latent findings (WR-03: migration drops `tasks`, not currently reachable via the real hook flow; WR-01/WR-05: two asymmetric validation gaps around `sessionId`/`task_id`, low current reachability) are noted as warnings for the maintainer's judgment but do not block any of the 5 success criteria on their own.

---

_Verified: 2026-07-15T11:02:28Z_
_Verifier: Claude (gsd-verifier)_
