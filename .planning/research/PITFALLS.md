# Pitfalls Research

**Domain:** Global quick-capture inbox added to an existing Node.js CLI (kodo) — filesystem-local append log with status mutation, an LLM-authored capture skill, and routing delegated to an external system (GSD).
**Researched:** 2026-07-24
**Confidence:** HIGH (grounded in kodo's real primitives — `writeFileAtomic` `src/config.js:135`, `withFileLock` `src/session/state-lock.js:215`, `stripControlChars`/`stripForKeystroke` `src/cli/format.js:80,114`, `appendFileSync` sink `src/logger.js:318`, and the demonstrated `stealLock` race `src/gsd/lock.js:283-351`)

## Critical Pitfalls

### Pitfall 1: Using `writeFileAtomic` (temp+rename) for the append path → silent lost-update under concurrent captures

**What goes wrong:**
The instinct is to reuse kodo's canonical "non-corrupting write" primitive `writeFileAtomic` (`src/config.js:135`: `writeFileSync(tmp)` → `renameSync(tmp, path)`) for `kodo capture`. To append, that primitive forces a read-all → append-line → write-whole-temp → rename cycle. Two `kodo capture` processes firing at once (shell + `/kodo-capture` skill mid-session; or two shells) each snapshot the file, each append their own line, each rename their temp over the file. **Last rename wins; the other capture's line is silently gone.** The file is never *corrupt* (a reader never sees a half-written file) — it is *lossy*. "Non-corrupting" ≠ "concurrency-safe."

**Why it happens:**
`writeFileAtomic` is the house style for every other writer in the codebase (config, projects, .env, state migration), so it looks like the obviously-correct choice. Its atomicity guarantee (temp+rename is atomic intra-fs) is about *torn reads*, not *mutual exclusion*. This is the exact failure class the codebase just diagnosed in `stealLock`: a non-atomic window between two steps lets two actors both "win" (`.planning/debug/gsd-lock-race-cr01.md`, DEBT-04). Concurrency bugs in kodo's file primitives are a demonstrated, not hypothetical, risk.

**How to avoid:**
Do **not** use temp+rename for appends. Use `O_APPEND` (`appendFileSync(path, line, { flag: 'a', mode: 0o600 })`) — POSIX guarantees each `write()` under `O_APPEND` seeks-to-end atomically, so concurrent short-line appends never overwrite each other. There is already a precedent in-tree: the NDJSON sink `src/logger.js:318` (`appendFileSync(filePath, JSON.stringify(record) + '\n')`). Constraints to make the atomicity real: (a) one capture = exactly one short line ending in `\n`, written in a single `appendFileSync` call so it is one `write()` syscall (cap capture length so it never splits into multiple syscalls); (b) `~/.kodo` is a local FS — do not rely on `O_APPEND` atomicity over NFS.

**Warning signs:**
`kodo capture` appears in the same file/module as `writeFileAtomic` or `renameSync`; a read-then-write pair on `inbox.md`; captures occasionally "disappear" when two sessions capture within the same second.

**Phase to address:**
The `kodo capture` foundation phase (append primitive selection) — the first inbox phase.

---

### Pitfall 2: Marking `enrutada`/`descartada` by rewriting a line → TOCTOU that clobbers a concurrent capture

**What goes wrong:**
`kodo inbox` must mark items `enrutada`/`descartada` "sin borrar." The obvious implementation reads the whole file, mutates the matched line, and writes the whole file back (necessarily temp+rename — you cannot edit a line in place with `O_APPEND`). Between the read and the rename, a concurrent `kodo capture` appends a new line via `O_APPEND`. The mutation's write is based on the *stale* snapshot and its rename **overwrites the file without the just-appended capture** — the new idea is lost. This is the append-only-vs-mutation tension made concrete: the append path (lockless `O_APPEND`) and the mutate path (whole-file RMW) do not share mutual exclusion, so they race.

**Why it happens:**
`O_APPEND` (Pitfall 1's fix) and in-place status edits are fundamentally different write models, and it is easy to solve the append path cleanly and then bolt on status mutation without noticing they now race against each other. Matching lines by index/byte-offset makes it worse: the offset the mutation computed is invalidated the instant an append lands.

**How to avoid:**
Prefer the design that eliminates the RMW entirely: **make status append-only too.** Store status as an appended event line (e.g. `estado · enrutada · <id> · <fecha>`) rather than editing the original capture line; `kodo inbox` folds the event log to compute each item's current state. This keeps the file *literally* append-only (satisfies "sin borrar" by construction), makes every write an `O_APPEND`, and removes the whole TOCTOU class — no lock needed on the write path. If a single-line-per-item file is a hard requirement instead, then **both** append and mutate must go through the *same* `withFileLock` (`src/session/state-lock.js:215`) on one inbox lock file, mutation must re-read fresh *inside* the lock, and lines must be matched by a stable capture `id` (from `randomUUID()`, already available via `node:crypto`), never by index/offset. Note the cost of that path: `withFileLock` returns `{ok:false, reason:'lock-timeout'}` on contention and never blocks — a capture that loses the lock must not be silently dropped, which is a second reason to prefer the event-log design.

**Warning signs:**
`kodo inbox` mutation code that computes line numbers or byte offsets; a mutation path that writes the whole file while the capture path uses `O_APPEND` with no shared lock; status stored as an editable column on the original line.

**Phase to address:**
The `kodo inbox` list/mark phase — the status-model decision (event-log vs in-place) must be made here, up front.

---

### Pitfall 3: Injection — the `·` separator, newlines, control chars, and markdown in captured (possibly LLM-derived) text break line parsing and the terminal

**What goes wrong:**
The line format is `texto · tag-proyecto · fecha · origen`. Four independent failure modes:
1. **`·` inside the text** (U+00B7 middot) collides with the field separator. Because free text is the *first* field, a stray `·` shifts every structured field right → the parser reads part of the idea as the tag/date/origin. Field parsing corrupts.
2. **Newline inside the text** breaks the one-capture-per-line invariant — a `\n` splits one idea into a phantom second entry (and, combined with Pitfall 1's single-`write()` requirement, can split the append itself).
3. **Control chars / ANSI-OSC escapes** survive into `inbox.md` and then execute when `kodo inbox` prints the item to the terminal. Captures from `/kodo-capture` are **LLM-derived from session context** — exactly the untrusted-toward-terminal class the codebase mandates sanitizing (invariant: LLM content toward terminal/keystroke ALWAYS `stripControlChars`, v0.17 Phase 78 / R-75-02).
4. **Markdown metachars** (`##`, `- `, `|`, backticks) in text corrupt any structure-aware parse of `~/.kodo/inbox.md`.

**Why it happens:**
`·` feels safe as a separator because it's rare in prose — until an LLM emits it, or a user pastes a formatted snippet. And kodo already has a subtle trap here: the render-rail saneador `stripControlChars` (`src/cli/format.js:80`) **deliberately preserves `\n` and `\t`** (the dashboard needs multiline). Reaching for the familiar `stripControlChars` on the inbox write path therefore does *not* protect the one-line invariant — the newline survives.

**How to avoid:**
Sanitize at **write** time so the on-disk file is always well-formed, and stay defensive at **read/render** time. Use the *keystroke-rail* saneador `stripForKeystroke` (`src/cli/format.js:114`) or an equivalent that collapses real `\n`/`\r`/`\t` (and their literal `\n`/`\t` escape forms) to spaces — **not** `stripControlChars`, which keeps `\n`. Additionally strip/escape the `·` separator from the text field, and/or **put the free-text field LAST** (`tag · fecha · origen · texto`) so stray separators in text can't shift structured fields — everything after the 3rd `·` is text. Treat `inbox.md` as a line-delimited log, never as parseable markdown structure. Enforce a max capture length (also needed for Pitfall 1's single-`write()`).

**Warning signs:**
The write path imports `stripControlChars` (render rail) instead of `stripForKeystroke` (keystroke rail); the text field is first in the line format; `kodo inbox` prints captured text without any strip; a `.split(' · ')` that assumes exactly 4 fields.

**Phase to address:**
Both inbox write phases — the `kodo capture` foundation (CLI path) and the `/kodo-capture` skill phase (LLM path). Sanitization must live in the single shared writer (see Pitfall 5).

---

### Pitfall 4: Inbox rot — capture with no triage pressure becomes a write-only graveyard

**What goes wrong:**
Capture is frictionless; triage is not. Items accumulate, `kodo inbox` becomes a wall of noise, and the user stops trusting/using it — the classic GTD "inbox that's really a black hole." Because the invariant is *never delete*, an un-triaged inbox only grows; without a countervailing signal it grows forever.

**Why it happens:**
The feature's whole value proposition is "capture instantly, decide later," which optimizes the capture side and leaves triage as unforced homework. There's no ambient pressure telling the user the backlog is growing.

**How to avoid:**
Surface an ambient count of *un-routed* captures where the operator already looks — kodo already has the pattern: the dashboard renders pending-task counts and a `NEXT:` column read from `state.json` (v0.17 LIVE-05). A "N capturas sin enrutar" (with oldest-age hint) reader-leaf column, read from `inbox.md`, creates the triage pressure at near-zero cost and **zero new endpoints** (filesystem read only, like every dashboard reader since v0.10). Make triage one action (route via `gsd-capture`, mark `descartada` cheaply). Do not solve rot by auto-deleting or auto-expiring — that violates "sin borrar."

**Warning signs:**
`kodo inbox` has no notion of "pending vs handled" count; nothing surfaces capture backlog outside the explicit `kodo inbox` command; the count of lines with no `enrutada`/`descartada` marker climbs across weeks.

**Phase to address:**
The `kodo inbox` phase (surface pending count) — optionally a small dashboard reader-leaf follow-on.

---

### Pitfall 5: Skill/CLI format drift — `/kodo-capture` and `kodo capture` grow two divergent writers

**What goes wrong:**
`/kodo-capture` (LLM skill, mid-session) and `kodo capture` (CLI) both need to write a capture. If the skill writes `inbox.md` *directly* (its own `·`-join, its own date format, its own field order), the two producers drift. `kodo inbox` can only parse one shape; the other's captures render as garbage or vanish. This is precisely the seam kodo has been burned by before: v0.17 forced the producer↔consumer plan seam (`~/.kodo/plans/<task_id>.md`) to be verified **byte-identical** between the session-start writer and the overlay reader (v0.11 Phase 45/46).

**Why it happens:**
Two entrypoints, written in different phases, quietly re-implement the same serialization. The user's own global rule and kodo's `cmux-shared-behavior` discipline both name this: a behavior exposed through multiple entrypoints drifts unless they share one implementation.

**How to avoid:**
**One writer, by construction.** The `/kodo-capture` skill must *not* format or append anything — it derives `text`/`project`/`origin` from session context and **shells out to `kodo capture`** (`execFile`, never-throws), exactly as the v0.13 TUI shells out to `kodo adopt` rather than reimplementing adoption. The line format then exists in exactly one place (the CLI), so drift is impossible. If a shared library function is used instead of shell-out, it must be the *single* serializer both paths import — no second `·`-join anywhere.

**Warning signs:**
The skill definition contains an `appendFile`, a `·` join, or a date-format string; any `inbox.md` write outside the one CLI writer; no golden test asserting skill-path and CLI-path output are byte-identical for the same input.

**Phase to address:**
The `/kodo-capture` skill phase — must depend on and delegate to the `kodo capture` CLI phase, not parallel it.

---

### Pitfall 6: Scope creep — reimplementing `gsd-capture` routing inside kodo

**What goes wrong:**
`kodo inbox` starts by marking items, then someone adds "route this to a Plane task / a GSD phase / a config change" directly in kodo — re-deriving destination classification, talking to a `TaskProvider`, deciding task vs seed vs config. This duplicates `gsd-capture`/`gsd-inbox`, which the milestone explicitly delegates to (CAPT-01..04: "el enrutado a tarea/fase/config lo hace `gsd-capture`, no una reimplementación").

**Why it happens:**
Routing feels like the natural next step once you're already looking at an item in `kodo inbox`, and the boundary between "kodo owns capture/storage/status" and "GSD owns destination" is easy to blur under momentum. It's the same trap as the v0.17 RETROSPECTIVE lesson ("Phase 73 planificada sobre un síntoma") — building past the actual scope.

**How to avoid:**
Draw the boundary explicitly and defend it: **kodo owns capture + storage + status marking; GSD owns routing/destination.** `kodo inbox`'s "route" action hands the item off to `gsd-capture` (invoke the skill / emit the item for it to consume) and records only a status marker on return. No `TaskProvider` calls from the inbox path; no destination classification logic in kodo.

**Warning signs:**
Inbox code imports a provider/registry or classifies an item's destination; `kodo inbox` grows flags like `--to-task`/`--to-phase`; capture-routing logic that duplicates anything in the `gsd-capture` skill.

**Phase to address:**
The `kodo inbox` phase — the requirement/spec must state routing is a delegation, and the plan must show the hand-off seam, not a router.

---

### Pitfall 7: Reaching for a new npm dep or a new server endpoint (hard-invariant violation)

**What goes wrong:**
A naive implementation pulls in `proper-lockfile` (file locking), a markdown parser, or a `uuid` package; or exposes the inbox to the dashboard via a new `GET /inbox` in `src/server.js`. Each violates a hard invariant: **cero new npm deps**, **cero endpoints nuevos en `src/server.js`**.

**Why it happens:**
Locking, UUIDs, and markdown parsing all have popular libraries, and "let the dashboard read the inbox over HTTP" mirrors how a normal web app would do it — but kodo's dashboard has been strictly filesystem-read-only since v0.10 ("cero endpoints nuevos").

**How to avoid:**
Everything the inbox needs already exists in-tree: `randomUUID` from `node:crypto` (used in `lock.js`), `withFileLock`/`acquireLock` (`src/session/state-lock.js`), `appendFileSync`/`mkdirSync` from `node:fs` (`src/logger.js`), and line-based parsing (no markdown lib — treat the file as a log). The dashboard, if it surfaces the count, reads `inbox.md` from the filesystem as a reader-leaf (the v0.10–v0.17 pattern), never an endpoint.

**Warning signs:**
A diff to `package.json` dependencies; a new route registered in `src/server.js`; `import ... from 'proper-lockfile'`/a markdown lib.

**Phase to address:**
Every inbox phase — enforce in plan review and a source-hygiene guard (grep test that no new route/dep was added), mirroring v0.18's guard against `workspace-group delete` being cabled.

---

### Pitfall 8: Leaking LLM/tokens into the deterministic CLI path

**What goes wrong:**
`kodo capture` derives its `tag-proyecto`. If that derivation calls an LLM (to "figure out the project"), it breaks the **deterministic CLI = 0 tokens** invariant. Only `/kodo-capture` (the skill) is allowed to spend tokens (to derive project/task from session context).

**Why it happens:**
"Derive the project automatically" sounds like an LLM job, and the skill does exactly that — so it's tempting to share that logic down into the CLI.

**How to avoid:**
CLI tag derivation stays deterministic: from `cwd` → project mapping via `projects.json` (the existing `listProjects`/path-mapping machinery), or an explicit `--project` flag; unknown → a literal fallback tag. The LLM derivation lives **only** in the skill, which then passes the resolved tag down to `kodo capture` as a plain string.

**Warning signs:**
Any model/LLM call reachable from the `kodo capture` code path; `kodo capture` output that isn't byte-deterministic for fixed input+clock.

**Phase to address:**
The `kodo capture` foundation phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse `writeFileAtomic` (temp+rename) for appends | One familiar primitive, no new write path | Silent lost captures under concurrency (Pitfall 1); same class as the `stealLock` race | **Never** — use `O_APPEND` |
| In-place line mutation for status | Simple one-line-per-item file | TOCTOU clobber of concurrent captures (Pitfall 2); needs a lock the append path also honors | Only with a shared lock on **both** paths; prefer append-only event log |
| Skill writes `inbox.md` directly | Skill ships without the CLI dependency | Format drift → unparseable captures (Pitfall 5) | **Never** — skill must shell out to `kodo capture` |
| Sanitize with render-rail `stripControlChars` on the write path | Reuses the obvious helper | `\n` survives → broken one-line invariant (Pitfall 3) | **Never on the writer** — use keystroke-rail `stripForKeystroke` |
| `kodo inbox` grows a router | Feels complete ("capture → done") | Duplicates `gsd-capture`, scope creep (Pitfall 6) | **Never** — delegate to GSD |
| Skip the pending-count surface | Ship inbox faster | Inbox rot; users abandon it (Pitfall 4) | MVP-acceptable *if* a follow-on phase adds the count |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `/kodo-capture` skill → `kodo capture` CLI | Skill re-implements the line format | Skill `execFile`s `kodo capture` (never-throws); one serializer, byte-identical by construction (v0.13 `adopt` precedent) |
| `kodo inbox` → `gsd-capture` routing | Inbox reimplements destination classification | Hand the item to `gsd-capture`; kodo records only a status marker (milestone CAPT-01..04) |
| Dashboard ← `inbox.md` | New `GET /inbox` endpoint | Filesystem reader-leaf, cero endpoints (v0.10–v0.17 pattern) |
| Concurrent writers (shell + mid-session skill) | Assume single-writer | Assume ≥2 concurrent writers always; `O_APPEND` for capture, event-log or shared `withFileLock` for status |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `kodo inbox` reads + folds the whole file each invocation | Sluggish listing on a large inbox | Fine at expected scale (hundreds–low-thousands of lines); keep parse O(n) line-based, no per-line file reopen | Thousands of un-triaged lines (which itself signals inbox rot, Pitfall 4 — fix triage, not the parser) |
| Event-log status model replays all events every read | Redundant folding as events accumulate | Acceptable at this scale; compaction is a *future* option, never an auto-delete | Only at very large event counts — do not pre-optimize |
| Dashboard re-reads `inbox.md` every poll tick | Extra I/O per tick | Same reader-leaf discipline as `state.json` — one small file per tick, never-throws | Negligible for a local file |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `inbox.md` written world-readable (umask default 0644) | Idea text (possibly sensitive, incl. LLM-derived project context) leaks to other local users | Create/append with `mode: 0o600` — mirror config/.env/plans (`chmod 0600` house rule, `src/config.js`) |
| LLM/untrusted capture text rendered raw by `kodo inbox` | ANSI/OSC escape injection into the operator's terminal | Sanitize at write (`stripForKeystroke`-class) **and** stay defensive at render — the codebase's standing invariant (v0.17 Phase 78) |
| Capture text interpolated toward `cmux send`/keystroke anywhere downstream | Spurious Enter/Tab (premature submit + injected line) via real or literal `\n` | If any capture field is ever keystroked, route it through `stripForKeystroke` (`src/cli/format.js:114`), not `stripControlChars` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Capture silently dropped on lock-timeout | User's idea lost with no signal — worse than a visible error | Prefer lockless `O_APPEND` (never drops); if a lock is used, surface a clear failure, never swallow it |
| No feedback that capture landed | User re-captures or distrusts the tool | `kodo capture` prints a short confirmation (id + destination file) deterministically |
| Inbox as a black hole (no triage signal) | Captured ideas never resurface (Pitfall 4) | Ambient "N sin enrutar" count + one-action routing/dismiss |
| `descartada` = delete | Violates "sin borrar"; user can't audit past decisions | Mark as a status; keep the line (event-log or status column) |

## "Looks Done But Isn't" Checklist

- [ ] **Concurrent capture:** Often missing real concurrency handling — verify two `kodo capture` processes in the same second both land (spawn N=10 concurrent captures, assert N lines; this is the inbox analog of the `gsd-lock-race` test).
- [ ] **Capture-during-mutation:** Often missing — verify an `O_APPEND` capture that lands *during* a `kodo inbox` status write is not clobbered (interleave a capture inside the mark window; assert it survives).
- [ ] **`·`/newline/escape in text:** Often missing — verify a capture containing `·`, `\n`, an ANSI OSC sequence, and `## ` round-trips and lists without corrupting fields or the terminal.
- [ ] **First-run / missing dir:** Often missing — verify first `kodo capture` when `~/.kodo` (or `inbox.md`) doesn't exist creates it (`mkdirSync` recursive; `writeFileAtomic`/`appendFileSync` do *not* create the dir) with mode 0600, never throws.
- [ ] **Skill == CLI format:** Often missing — golden test that `/kodo-capture` output and `kodo capture` output are byte-identical for the same input (or that the skill has no writer at all).
- [ ] **No new dep / no new endpoint:** Often missing the guard — grep test that `package.json` deps and `src/server.js` routes are unchanged.
- [ ] **0-token CLI:** Often missing — verify `kodo capture`/`kodo inbox` reach no LLM and are byte-deterministic for fixed input.
- [ ] **Triage pressure:** Often missing — verify the pending-capture count is surfaced somewhere ambient, not only inside `kodo inbox`.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Lost captures from temp+rename append (Pitfall 1) | MEDIUM | Switch write path to `O_APPEND`; lost captures are unrecoverable — add the N-concurrent regression test to prevent recurrence |
| Clobbered capture from status TOCTOU (Pitfall 2) | MEDIUM | Migrate status to append-only event log (removes the RMW); recover recent losses from shell history / session transcripts if available |
| Corrupted line parse from `·`/newline in text (Pitfall 3) | LOW | Add `stripForKeystroke`-class sanitize + reorder free text last; a repair pass can re-parse the log leniently (text = everything after the 3rd `·`) |
| Format drift skill vs CLI (Pitfall 5) | LOW | Rewrite skill to shell out to `kodo capture`; one-time lenient re-parse to reconcile old divergent lines |
| Router built into kodo (Pitfall 6) | MEDIUM | Excise the router, re-delegate to `gsd-capture`; keep only the status-marker write |
| Inbox rot (Pitfall 4) | LOW | Add ambient pending count + one-action dismiss; bulk-mark stale items `descartada` (never delete) |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 — temp+rename append lost-update | `kodo capture` foundation (first inbox phase) | N=10 concurrent captures → N lines assertion |
| 2 — status-mutation TOCTOU | `kodo inbox` list/mark phase | Interleave capture during mark → capture survives; status-model decision recorded (event-log preferred) |
| 3 — injection / sanitization | `kodo capture` + `/kodo-capture` phases | Round-trip test with `·`/`\n`/OSC/markdown; write path uses `stripForKeystroke`, not `stripControlChars` |
| 4 — inbox rot | `kodo inbox` phase (+ dashboard reader-leaf follow-on) | Pending "sin enrutar" count surfaced ambiently |
| 5 — skill/CLI drift | `/kodo-capture` skill phase | Byte-identical golden vs `kodo capture`; skill has no direct writer |
| 6 — routing scope creep | `kodo inbox` phase | No `TaskProvider`/classifier in inbox path; hand-off to `gsd-capture` verified |
| 7 — new dep / endpoint | All inbox phases | Source-hygiene grep: `package.json` deps + `src/server.js` routes unchanged |
| 8 — tokens in CLI path | `kodo capture` foundation | No LLM reachable from `kodo capture`; byte-deterministic output |

## Sources

- kodo codebase primitives (HIGH): `src/config.js:135` (`writeFileAtomic` temp+rename), `src/session/state-lock.js:215` (`withFileLock`), `src/cli/format.js:80,114` (`stripControlChars`/`stripForKeystroke`), `src/logger.js:318` (`appendFileSync` NDJSON sink), `src/gsd/lock.js:283-351` (`stealLock` race)
- kodo project history (HIGH): `.planning/PROJECT.md` — v0.16 concurrency hardening (`withStateLock`/`O_EXCL`), v0.17 producer↔consumer byte-identical seam + `NEXT:` reader-leaf, v0.18 DEBT-04 `stealLock` race diagnosis, v0.10+ "cero endpoints nuevos" invariant
- Milestone v0.19 scope (HIGH): backlog CAPT-01..04 (routing delegated to `gsd-capture`), inbox line format `texto · tag · fecha · origen`
- POSIX `O_APPEND` atomicity semantics for concurrent short-line appends on local filesystems (HIGH, general systems knowledge)
- GTD / inbox-triage failure mode "capture without triage pressure" (MEDIUM, domain knowledge)

---
*Pitfalls research for: global quick-capture inbox added to the kodo CLI*
*Researched: 2026-07-24*
