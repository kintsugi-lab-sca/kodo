# Project Research Summary

**Project:** kodo v0.19 — «Inbox de capturas + fix stealLock + saneo de deuda»
**Domain:** Append-only quick-capture inbox grafted onto an existing Node.js CLI (feature scope only: backlog 999.2 / CAPT-01..04). The other two milestone items — the `stealLock` race fix in `src/gsd/lock.js` and the doc/Nyquist debt sweep — are internal and NOT covered by this research pass.
**Researched:** 2026-07-24
**Confidence:** HIGH

## Executive Summary

This is a textbook GTD-style capture inbox (`org-capture`, `todo.txt`/`done.txt`, `jrnl` lineage): frictionless one-shot capture, a single trusted append-only store, and a deliberate, separate triage step that never destroys data — only transitions it (`enrutada`/`descartada`). kodo's own backlog spec (999.2) is already a faithful implementation of that proven shape, and all four research passes converge on the same conclusion: **zero new dependencies, zero new server endpoints, everything the feature needs already exists in-repo** (`appendFileSync` O_APPEND precedent in `src/logger.js`, `withFileLock` in `src/session/state-lock.js:215`, the lock+RMW+unique-tmp-rename template in `src/hooks/session-end.js`, cwd→project resolution in `src/cli/adopt.js`, sanitizers in `src/cli/format.js`). The recommended surface is a pure core (`src/inbox/store.js`) plus two thin CLI commands (`kodo capture`, `kodo inbox`) plus one mid-session skill (`/kodo-capture`) that shells out to the CLI rather than re-implementing the writer — with routing explicitly delegated to the existing `gsd-capture` skill, never reimplemented inside kodo.

The single genuinely load-bearing engineering decision, and the one place research disagrees on mechanism (not on principle), is **how status mutation (`enrutada`/`descartada`) coexists with append-only capture without a lost-update race**. All three technical passes agree the naive move — reusing `writeFileAtomic` (fixed-tmp temp+rename) for either path — is wrong: for appends it silently drops concurrent captures (last-rename-wins); for the mark path its *fixed* tmp name lets two concurrent triage writers clobber each other (the exact WR-02 bug already fixed elsewhere in kodo). Beyond that shared floor, STACK.md and ARCHITECTURE.md converge on "one shared advisory lock (`withFileLock`) around both the append and the mark RMW, unique-tmp-name rename for the mark," while PITFALLS.md argues the RMW/TOCTOU class should be eliminated altogether by making status itself append-only (an event-log fold: `estado · enrutada · <id> · <fecha>` as its own appended line, no line ever mutated in place). **This status-model choice is the key open design decision and must be made explicitly in discuss/plan-phase, not defaulted silently** — see the Roadmap Implications section.

Secondary risks are well-understood and cheap to close: injection/sanitization (the `·` separator, embedded newlines, and ANSI/OSC escapes in LLM-authored capture text must be neutralized with the *keystroke-rail* sanitizer `stripForKeystroke`, not the render-rail `stripControlChars` which deliberately preserves `\n`); skill/CLI format drift (the `/kodo-capture` skill must shell out to `kodo capture`, never re-implement the line writer); and inbox rot (an ambient "N sin enrutar" surface, deferrable past v1, is what keeps the buffer from becoming a write-only graveyard). One correction to the milestone brief that all three deeper-research passes independently confirmed: the reusable lock primitive is `withFileLock` in **`src/session/state-lock.js:215`**, not `src/gsd/lock.js` — the latter is the unrelated per-repo GSD lock whose `stealLock` race is being fixed by this same milestone's other workstream, and the inbox must not couple to it.

## Key Findings

### Recommended Stack

Zero new packages. The append path should use `appendFileSync` with `O_APPEND` semantics (POSIX guarantees atomic single-`write()` appends for short lines on a local filesystem — proven in-repo by `src/logger.js:318`). The mark/triage path — whichever status model is chosen — must not use `config.js`'s `writeFileAtomic` because its tmp name is fixed (`path + '.tmp'`) and two concurrent writers will clobber each other; instead clone the unique-tmp-name (`path + '.tmp.' + pid + '.' + randomUUID()`) + rename pattern from `src/hooks/session-end.js:331-389`, which already solved this exact class of bug (WR-02, Phase 74).

**Core technologies (all in-repo reuse):**
- `node:fs` (`appendFileSync`, `readFileSync`, `renameSync`) — every file op needed; no library adds a guarantee the built-ins lack.
- `withFileLock` / `acquireLock` / `releaseLock` (`src/session/state-lock.js:215`) — advisory O_EXCL lock with retry + TTL steal + CAS, never throws, fail-safe `{ok:false,reason:'lock-timeout'}` — the primitive for serializing whichever operations end up needing mutual exclusion.
- `commander@^13` (installed) — register `kodo capture`/`kodo inbox` exactly like every other subcommand (`src/cli.js`, lazy `await import()` in `.action`).
- `sanitizeInline` (`src/session/handoff.js:81`) / `stripForKeystroke` (`src/cli/format.js:114`) — collapse captured text to a single newline-free line; use the keystroke-rail sanitizer, not `stripControlChars` (render rail — deliberately preserves `\n`).
- `node:crypto.randomUUID()` — stable per-item id and unique tmp-name suffix, already the repo convention.

### Expected Features

**Must have (table stakes, backlog 999.2 baseline — all P1, none droppable):**
- `kodo capture "idea"` — one-shot append, zero prompts, auto metadata, fail-open.
- `~/.kodo/inbox.md` — single global, human-editable, append-only markdown file (GTD's "one trusted inbox" rule).
- Atomic append under concurrency (shell + mid-session hook can fire simultaneously).
- Auto-derived `texto · tag-proyecto · fecha · origen` — zero manual tagging, kodo already knows the project (cwd map) and session task.
- `kodo inbox` — list open captures (read-only, no new endpoint).
- Mark `enrutada`/`descartada` without deleting — the auditability mechanism the feature exists to provide.
- `/kodo-capture` — mid-session capture with context-derived tag, byte-identical format to the CLI writer.
- `enrutada` delegates routing to `gsd-capture` — kodo does not reimplement destination logic.

**Should have (differentiators — cheap because the wiring already exists):**
- Automatic origin/context derivation (project + session task) with zero typing.
- Routing delegated to an already-tested engine (`gsd-capture`) rather than a second router.
- `→ destination` trace pointer on routed lines, if `gsd-capture` returns a usable ref cheaply.

**Defer (v1.x / v2+):**
- Stale-inbox count surfaced in dashboard/nudge — real differentiator, but validate real usage first.
- `--project`/`--open` minimal filter — only once the inbox is busy enough to need it.
- Archival/rotation, cross-machine sync, NLP parsing, auto-routing, multiple inboxes, hard delete — explicit anti-features; each violates either the "one inbox" GTD rule, the zero-endpoints/zero-deps invariants, or the capture-must-be-instant principle.

### Architecture Approach

Pure core + thin CLI, mirroring the existing `src/gsd/doctor.js` ↔ `src/cli/gsd-doctor.js` split: a new `src/inbox/store.js` (DI-able paths, line codec, append/list/status operations) backs two thin, lazy-imported CLI wrappers registered in `src/cli.js`. `INBOX_PATH` is added as a new export alongside the other `~/.kodo/` path consts in `src/config.js`. The mid-session skill `/kodo-capture` derives project/task deterministically from cwd + session context (reusing `src/cli/adopt.js`'s reverse cwd→project lookup and `findSession` from `src/session/state.js`) and shells out to `kodo capture` rather than writing the file itself. The seam with `gsd-capture` is a documentation-level handoff (operator/LLM runs `/gsd-capture` in the target project, then `kodo inbox route <id>`), not a code import — kodo never links against or duplicates GSD's routing logic.

**Major components:**
1. `src/inbox/store.js` (new, pure) — path const, line format encode/parse, append/list/status operations, DI-able paths for testing.
2. `src/cli/capture.js` + `src/cli/inbox.js` (new, thin) — argument parsing, tag derivation, exit codes, `--json` output; registered top-level in `src/cli.js`.
3. `.claude/skills/kodo-capture/skill.md` (new) — context derivation only; shells `kodo capture`, owns no writer.
4. `src/config.js` (modified) — `INBOX_PATH` export.
5. `src/session/state-lock.js` `withFileLock` (reused, unmodified) — the shared lock primitive if the chosen status model needs one.

### Critical Pitfalls

1. **Reusing `writeFileAtomic` (temp+rename) for the append path** — silently loses concurrent captures (last-rename-wins). Use `O_APPEND` (`appendFileSync`) instead; single-write-syscall-per-line, cap capture length so it can't split across syscalls.
2. **Status mutation as a whole-file RMW racing against lockless appends** — a concurrent append landing between the mark's read and its rename gets silently overwritten. This is the core status-model decision (see Roadmap Implications) — either eliminate the RMW via an append-only event log, or serialize both append and mark under one shared `withFileLock` with unique-tmp-name rename (never `writeFileAtomic`'s fixed tmp name).
3. **Injection via the `·` separator, embedded newlines, and ANSI/OSC escapes in captured (possibly LLM-authored) text** — corrupts field parsing and can inject terminal escapes when `kodo inbox` prints items. Sanitize at write time with the keystroke-rail `stripForKeystroke` (not the render-rail `stripControlChars`, which deliberately preserves `\n`); consider putting the free-text field last so a stray `·` in text can't shift structured fields.
4. **Skill/CLI writer drift** — if `/kodo-capture` formats and appends independently instead of shelling out to `kodo capture`, the two producers diverge and `kodo inbox` can only parse one shape correctly. Enforce single-writer-by-construction (skill shells to CLI) plus a byte-identical golden test.
5. **Inbox rot** — capture is frictionless, triage is not; an append-only, never-delete inbox only grows without ambient pressure. Defer a stale-count nudge to v1.x but don't ship without a documented mitigation path.

## Implications for Roadmap

Based on research, suggested phase structure (adapted from ARCHITECTURE.md's dependency-graded build order):

### Phase 1: Inbox core + `kodo capture` (foundation)
**Rationale:** Everything downstream (list, mark, skill) depends on the store's line format and lock/append semantics. This is also where the concurrency risk concentrates — it must be settled before any consumer is built.
**Delivers:** `src/config.js` `INBOX_PATH` export; `src/inbox/store.js` (line codec, append, tag derivation via `projects.json` reverse-lookup, sanitization via `stripForKeystroke`); `src/cli/capture.js` + `kodo capture` registration in `src/cli.js`.
**Addresses:** table-stakes "one-shot zero-friction capture," "auto-derived metadata," "atomic append under concurrency" from FEATURES.md.
**Avoids:** Pitfall 1 (temp+rename lost-update), Pitfall 3 (injection), Pitfall 8 (no LLM/tokens reachable from the CLI path).
**Open decision to resolve in discuss/plan for this phase:** the status-mutation model (see below) — because it determines whether the append path needs to share a lock with anything at all, or can stay purely lockless `O_APPEND`.

### Phase 2: `kodo inbox` triage (list + mark)
**Rationale:** Pure consumption of Phase 1's store; the status-model decision made in Phase 1's planning gets implemented here.
**Delivers:** `src/cli/inbox.js` + registration — list open captures, mark `enrutada`/`descartada` without deleting, `--json` deterministic output.
**Uses:** `withFileLock` (if the shared-lock model is chosen) or pure append (if the event-log model is chosen); either way, unique-tmp-name rename if any whole-file rewrite is involved — never `writeFileAtomic`.
**Implements:** the append/mutate architecture component from ARCHITECTURE.md; the "mark without delete" and "process to zero" table-stakes features from FEATURES.md.
**Avoids:** Pitfall 2 (status TOCTOU), Pitfall 6 (routing scope creep — mark only, no destination classification here).

### Phase 3: `/kodo-capture` skill + skill-sync generalization
**Rationale:** Only depends on Phase 1's shipped CLI (it shells out, never writes directly); also touches the orthogonal skill-sync surface (`kodo skill sync` currently syncs only `kodo-orchestrate` — ARCHITECTURE.md flags this as a real, scoped API change needed to add a second synced skill).
**Delivers:** `.claude/skills/kodo-capture/skill.md` (context derivation from session state, shells `kodo capture --origin session`); generalized or documented multi-skill sync.
**Addresses:** "mid-session capture with context" table-stakes feature.
**Avoids:** Pitfall 5 (skill/CLI format drift) — enforce via a byte-identical golden test between skill-path and CLI-path output.

### Phase 4: Routing seam documentation (no kodo code)
**Rationale:** Trails everything — it's a docs/wiring concern (how `kodo inbox` → `/gsd-capture` → `kodo inbox route <id>` fits together), not new logic.
**Delivers:** README / `kodo-orchestrate` skill documentation of the handoff flow.
**Addresses:** "routing delegated to gsd-capture" differentiator/table-stakes item.
**Avoids:** Pitfall 6 (reimplementing gsd-capture's routing inside kodo).

### Phase Ordering Rationale

- Store/format/lock is the spine — nothing lists or triages without it, and it's where the two disagreeing technical passes (shared-lock vs event-log) must converge on one answer before Phase 2 can be planned concretely.
- Triage is pure consumption of the store, so it can only follow, not precede or parallelize with, Phase 1.
- The skill is last among the core three because it only shells the already-shipped CLI; building it before Phase 1 ships would have nothing to call.
- The routing-seam documentation has no code dependency chain — it trails purely by relevance (nothing to document until routing actually exists to describe).

### Research Flags

Phases likely needing deeper research/explicit design discussion during planning:
- **Phase 1 (inbox core):** the status-model decision is NOT resolved by research and must be decided explicitly in discuss-phase — see "Key open design decision" below. Also verify the `O_APPEND` atomicity assumption and lock-timeout fallback behavior with an N-way concurrent-write test (mirroring the `gsd-lock-race` scrutiny this same milestone is applying to `src/gsd/lock.js`).
- **Phase 3 (skill + skill-sync):** the multi-skill generalization of `kodo skill sync` (`src/cli/skill-sync.js`, currently single-skill-scoped) is a small but real API surface change — scope it explicitly rather than bolting it on.

Phases with standard, well-documented patterns (skip `--research-phase`):
- **Phase 2 (triage list/mark):** once the status model is fixed in Phase 1, the CLI wrapper is a standard thin-CLI-over-pure-store pattern already used repo-wide.
- **Phase 4 (routing docs):** no code, standard documentation task.

### Key open design decision (flagged, not resolved, by design)

Three research passes propose three related-but-distinct answers to "how does status mutation coexist with append-only capture," and this synthesis intentionally does not pick a winner:

- **STACK.md / ARCHITECTURE.md:** one shared `withFileLock` around both the append and the mark RMW; mark uses unique-tmp-name + rename inside the lock. Rows stay "grow-only" with an in-place mutable status token on each row (`- [ ]` → `- [x] … enrutada 2026-07-24`).
- **PITFALLS.md:** prefer eliminating the RMW/TOCTOU class entirely by making status itself append-only — an event-log design where `estado · enrutada · <id> · <fecha>` is its own appended line, and `kodo inbox` folds the event log to compute current state per item. Under this model the append path never needs to share a lock with anything; every write is `O_APPEND`.

Both eliminate the two hard-invariant violations (no `writeFileAtomic` for either path, no fixed-tmp-name clobber). The trade-off is: shared-lock + in-place token is simpler to read/grep in the raw file but reintroduces a (now correctly-locked) RMW window and a `{ok:false, reason:'lock-timeout'}` failure mode on the append path; the event-log model is more mechanically robust (removes the RMW class outright, keeps append always-lockless) at the cost of a slightly less human-legible file (status requires folding, not a glance) and a small additional read-time computation. **This must be an explicit decision recorded in the Phase 1 discuss/plan output**, not defaulted to either option silently by an implementer.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every recommendation cites a specific in-repo file/line already read in full; zero external unknowns (no new deps needed). |
| Features | HIGH (pattern) / MEDIUM (kodo-specific complexity) | Capture/inbox patterns are decades-established (org-capture, GTD, todo.txt, jrnl); kodo-specific complexity/dependency estimates are derived from PROJECT.md, not independently re-verified against code in this file. |
| Architecture | HIGH | Grounded in the shipped codebase; every integration point cites a file/line read in this pass; explicitly corrects the milestone brief's lock-file reference. |
| Pitfalls | HIGH | Grounded in kodo's real primitives and a demonstrated prior concurrency bug (`stealLock` race) in the same codebase, plus general POSIX/systems knowledge for `O_APPEND` semantics. |

**Overall confidence:** HIGH

### Gaps to Address

- **Status-model decision (shared-lock + in-place token vs. append-only event log):** not resolved by research — must be an explicit decision in Phase 1's discuss/plan step (see "Key open design decision" above). Whichever is chosen, the pitfall list, verification checklist, and Phase 2 plan should be written against that specific model, not both.
- **`kodo skill sync` multi-skill generalization:** flagged as needed by ARCHITECTURE.md but its scope (generalize the sync mechanism vs. document a manual copy step) is not decided — resolve in Phase 3 planning.
- **`gsd-capture` destination-ref availability:** the `→ destination` trace pointer differentiator depends on whether `gsd-capture` can cheaply return a usable destination reference; not verified in this research pass — treat as a v1.x trigger-based feature, not a Phase 1-4 commitment.
- **Two unrelated milestone workstreams (stealLock fix, doc/Nyquist debt sweep) have no research backing them** — this SUMMARY and its four source files cover the capture-inbox feature only; those two items should be scoped/planned independently without assuming any finding here applies.

## Sources

### Primary (HIGH confidence)
- `src/session/state-lock.js:182-231` (`withFileLock`/`acquireLock`/`releaseLock`) — read in full across STACK/ARCHITECTURE/PITFALLS passes.
- `src/hooks/session-end.js:325-391` — lock+RMW+unique-tmp-rename template (WR-02 precedent), read in full.
- `src/config.js:11-146,615` — `KODO_DIR`, `writeFileAtomic` (and its fixed-tmp-name disqualification), path exports.
- `src/logger.js:314-324` — lockless `appendFileSync` O_APPEND precedent across concurrent sessions.
- `src/cli/format.js:80,114` — `stripControlChars` (render rail, preserves `\n`) vs `stripForKeystroke` (keystroke rail, collapses `\n`).
- `src/cli/adopt.js:108-143` — cwd→projects.json reverse resolution reused for tag derivation.
- `src/session/handoff.js` — `sanitizeInline`, string-only anti-ReDoS parse discipline.
- `src/gsd/lock.js:283-351` — the unrelated per-repo GSD lock and its `stealLock` race (explicitly NOT the inbox's lock primitive).
- `src/cli.js:1-521` — command registration + lazy-import pattern.
- `.claude/skills/kodo-orchestrate/skill.md`, `~/.claude/skills/gsd-capture/SKILL.md:1-39` — skill authoring convention and routing table for the decoupled handoff.
- kodo `.planning/PROJECT.md` (v0.19 milestone scope, backlog 999.2, prior concurrency-hardening history v0.16-v0.18).

### Secondary (MEDIUM confidence)
- Org-mode Workflow (Jethro Kuan, two-part blog series) — zero-friction capture, process-to-zero, refile-as-separate-step principles.
- todo.txt-cli USAGE.md / Plaintext Productivity — never-delete, mark-done-not-delete ethos.
- org-gtd.el / emacs-gtd (rougier) — GTD single-inbox + clarify/organize model.

### Tertiary (LOW confidence)
- None flagged.

---
*Research completed: 2026-07-24*
*Ready for roadmap: yes — pending the status-model decision to be made explicitly in Phase 1 discuss/plan, as flagged above.*
