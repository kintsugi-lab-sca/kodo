# Architecture Research — v0.19 «Inbox de capturas global»

**Domain:** A global, append-only capture buffer grafted onto an existing Node.js CLI (kodo) — deterministic 0-token CLI commands + one mid-session skill + a routing handoff to GSD's `gsd-capture`.
**Researched:** 2026-07-24
**Confidence:** HIGH (grounded in the shipped codebase; every integration point below cites a file/line read in this pass; no new external tech, no new npm deps)

> Scope note: this is **integration-for-a-new-feature** research, not greenfield ecosystem research. It answers "how does the capture inbox graft onto kodo's architecture, reusing existing primitives (`withFileLock`, atomic write, projects.json reverse-lookup, the skill-sync pattern)?" and feeds the roadmapper a risk-graded build order. The inbox is a self-contained surface (one file + two CLI commands + one skill), low blast radius, zero hard dependencies on the server or providers.

---

## Executive answer (the sub-questions)

- **(a) New CLI commands live in `src/cli/`, registered top-level in `src/cli.js`, over a pure core module `src/inbox/store.js`.** Mirror the doctor split that already exists: pure logic in `src/gsd/doctor.js` + thin CLI in `src/cli/gsd-doctor.js` (registered `src/cli.js:459-476`). So: `src/inbox/store.js` (pure: path const, line format, append, parse, status mutation, DI-able paths) + `src/cli/capture.js` + `src/cli/inbox.js` (thin wrappers, lazy-imported). Register `kodo capture <text>` and `kodo inbox` as top-level commands in `src/cli.js` using the identical `program.command(...).action(async () => { const { runX } = await import('./cli/…'); process.exit(await runX(...)); })` lazy-import pattern every other subcommand uses (`src/cli.js:408-422` doctor is the closest template). **No `ensureConfig()`** on either command — the inbox is filesystem-only and provider-agnostic, same precedent as `gsd doctor` / `sidebar doctor` / `skill sync` (`src/cli.js:466-468`, `490-492`, `512-513`).

- **(b) The append-only ↔ mutable-status tension resolves with "grow-only rows, mutable status token, one advisory lock".** The file never deletes a row (append-only *rows* = audit trail); triage flips a status token *in place*, which is a whole-file read-modify-write. Both paths serialize on one advisory lock (`~/.kodo/inbox.md.lock`) via the existing `withFileLock` from **`src/session/state-lock.js:215`** (never-throws, O_EXCL + retry, returns `{ok:false,reason:'lock-timeout'}` — it does **not** throw). Capture appends under the lock; triage does RMW + unique-tmp-name rename under the same lock. This is the exact primitive `session-end.js` already uses for the handoff RMW (`src/hooks/session-end.js:24,331`). See §"The append/mutate proposal" for the concrete format and the tmp-name caveat.

- **(c) `/kodo-capture` derives the project tag deterministically from cwd (and optionally session_id), not from LLM guessing.** The skill shells out to `kodo capture "idea" --origin session [--session-id <id>]`; `kodo capture` then resolves `tag-proyecto` by reverse-matching cwd against `projects.json` — the *nearest configured ancestor path* — exactly the resolution `src/cli/adopt.js:138-143` already performs (`resolveProjectId` / `deriveModuleFromCwd`). If `--session-id` is passed, `findSession({sessionId,cwd})` (`src/session/state.js:568`, already called by the session-start hook at `session-start.js:254`) yields a precise `task_ref` for a sharper tag. The tag derivation is 100% deterministic (0 tokens); the LLM's only job is to phrase the idea and invoke the command.

- **(d) The seam with `gsd-capture` is a *handoff*, not a call.** kodo owns the global buffer (`inbox.md`) + capture + triage-state. GSD's `gsd-capture` skill owns the project-scoped *destination* (todo / note / backlog 999.x / seed — see its routing table, `~/.claude/skills/gsd-capture/SKILL.md:28-39`). When the operator routes an item, they/the LLM run `/gsd-capture --backlog|--seed|… "<texto>"` *inside the target project*, then `kodo inbox route <id>` flips the row to `enrutada`. kodo never imports or re-implements gsd-capture's routing — the two are decoupled by the plain-text idea + its project tag.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CAPTURE SURFACES                               │
├──────────────────────────────────────────────────────────────────────┤
│  shell                    mid-session (Claude Code)                    │
│  ┌───────────────┐        ┌────────────────────────────┐              │
│  │ kodo capture  │        │ /kodo-capture (skill)       │              │
│  │  "idea"       │        │  derives tag from ctx →      │              │
│  └──────┬────────┘        │  shells `kodo capture … `    │              │
│         │                 └───────────┬─────────────────┘              │
│         │  origin=shell               │ origin=session (+session_id)   │
├─────────┴─────────────────────────────┴──────────────────────────────┤
│                    CORE  (src/inbox/store.js — pure, DI paths)         │
│   append(line)  ·  list(filter)  ·  setStatus(id, enrutada|descartada)│
│         │                    serialized by                             │
│         ▼          withFileLock(~/.kodo/inbox.md.lock)                 │
│   ┌──────────────────────────────────────────────────────────┐        │
│   │  APPEND path (grow-only)   │   RMW path (status mutation)  │        │
│   │  appendFileSync(line)      │   read → flip token →         │        │
│   │                            │   writeFile(tmp.pid.uuid)→rename│      │
│   └──────────────────────────────────────────────────────────┘        │
├──────────────────────────────────────────────────────────────────────┤
│                         STATE  (~/.kodo/)                              │
│   inbox.md   (append-only rows · mutable status token · audit trail)   │
│   inbox.md.lock   (advisory, O_EXCL + retry, stealable after TTL)      │
├──────────────────────────────────────────────────────────────────────┤
│                     TRIAGE / ROUTING (decoupled)                       │
│   kodo inbox (list open)  ──operator picks──►  /gsd-capture --backlog  │
│        │                                        (runs in target proj)  │
│        └── kodo inbox route <id>  ──►  status = enrutada  (no delete)   │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `src/inbox/store.js` (NEW, pure) | Path const, line format encode/parse, `appendCapture`, `listCaptures`, `setStatus`; all paths DI-able for tests | Node `fs` + `withFileLock`; mirrors purity of `src/gsd/doctor.js` |
| `src/cli/capture.js` (NEW) | `runCapture({text, origin, sessionId, cwd})` → derive tag → `appendCapture` → exit 0/1, `--json` | Thin, lazy-imported; mirrors `src/cli/gsd-doctor.js` |
| `src/cli/inbox.js` (NEW) | `runInbox()` list open; `route <id>` / `discard <id>` → `setStatus`; `--json` byte-deterministic | Thin; deterministic 0-token |
| `.claude/skills/kodo-capture/skill.md` (NEW) | Mid-session capture; derives context, shells `kodo capture --origin session --session-id …` | Canonical in repo, synced to `~/.claude/skills/` (see skill-sync note) |
| `src/cli.js` (MODIFIED) | Register `capture` + `inbox` top-level commands | +2 `program.command(...)` blocks, lazy-import pattern |
| `src/config.js` (MODIFIED) | Export `INBOX_PATH = join(KODO_DIR,'inbox.md')` next to `CONFIG_PATH`/`PROJECTS_PATH` (`config.js:11-14,615`) | 1 const + 1 export |
| `gsd-capture` (EXTERNAL, unchanged) | Route a plain-text idea into a GSD destination (todo/note/backlog/seed) | Existing GSD skill; kodo does **not** modify it |

---

## Recommended Project Structure

```
src/
├── inbox/                    # NEW — pure core for the capture buffer
│   └── store.js              # append / list / setStatus + line codec (DI paths)
├── cli/
│   ├── capture.js            # NEW — runCapture (append path, tag derivation)
│   └── inbox.js              # NEW — runInbox / route / discard (triage path)
├── cli.js                    # MODIFIED — register `capture` + `inbox`
├── config.js                # MODIFIED — export INBOX_PATH const
├── session/
│   └── state-lock.js         # REUSED — withFileLock (the RMW primitive)  :215
└── ...
.claude/skills/
├── kodo-orchestrate/skill.md # existing canonical skill (sync template)
└── kodo-capture/skill.md     # NEW — canonical, synced to ~/.claude/skills/
```

### Structure Rationale

- **`src/inbox/` (new dir, pure):** matches the "pure core + thin CLI" split proven by `src/gsd/doctor.js` ↔ `src/cli/gsd-doctor.js` and `src/tasks/pending.js` ↔ its consumers. Keeps the file-format and locking logic unit-testable against a tmpdir without going through commander.
- **CLI in `src/cli/`:** every kodo subcommand's implementation lives there and is lazy-imported from `src/cli.js` so the parent CLI pays no load cost for unrelated commands (`src/cli.js:398`, `469`, `493` are the pattern). Two new files keep capture and triage cohesive but separate.
- **`INBOX_PATH` in `config.js`:** all `~/.kodo/` paths are centralized there (`config.js:11-14`) and re-exported (`config.js:615`); the lock path is derived as `INBOX_PATH + '.lock'`.

---

## The append/mutate proposal (resolving the core tension)

**Requirement restated:** append is trivial and must never lose an idea; triage must flip a row to `enrutada`/`descartada` *without deleting it* (audit trail). These pull in opposite directions — append wants O_APPEND, in-place mutation wants a whole-file rewrite.

**Line format (line-based markdown, GitHub-checkbox status marker):**

```
- [ ] <id> · <texto> · <tag-proyecto> · <fecha ISO> · <origen>
```

- `- [ ]` = **open**; triage rewrites the marker to `- [x]` and appends a trailing status word + date:
  ```
  - [x] <id> · <texto> · <tag> · <fecha> · <origen> · enrutada 2026-07-24
  - [x] <id> · <texto> · <tag> · <fecha> · <origen> · descartada 2026-07-24
  ```
- `<id>` = a short stable token (e.g. `c` + base36 epoch-ms, or first 8 hex of `randomUUID()`), **first field** so triage can address the exact row unambiguously (`kodo inbox route <id>`), independent of free-text `texto`.
- `enrutada` vs `descartada` both close the checkbox but differ by the trailing word → `kodo inbox` lists open rows by filtering `- [ ]`.
- Renders cleanly in any markdown viewer (it's a task list), satisfying "the operator can just read `inbox.md`".

**Sanitization (mandatory):** `texto` must be a single line — strip `\n`/`\r`/control chars before append. Reuse `stripControlChars` (`src/cli/format.js:80`), the same sanitizer Phase 78 applied to the nudge fields. This keeps `·`-delimited parsing safe (id is fixed-position-first; status is a known suffix word; texto is free but newline-free).

**Concurrency design — one lock, two operations:**

1. **Append (`kodo capture`, `/kodo-capture`):** acquire `withFileLock(INBOX_PATH+'.lock')` (`src/session/state-lock.js:215`), then `appendFileSync(INBOX_PATH, line+'\n')`. Append (not full rewrite) means a crash mid-write can only lose the trailing partial line, never a prior row. **Lock-timeout fallback:** on `{ok:false,reason:'lock-timeout'}`, do a single **lockless** `appendFileSync` — O_APPEND makes concurrent single-line appends atomic on local fs, so the idea is never lost; the only residual race (a triage rename landing in the same instant) is a documented, acceptable corner on a single-user buffer.

2. **Triage (`kodo inbox route|discard`):** under the **same** `withFileLock`, read all rows → locate by `<id>` → flip that row's marker + append status word → write via **unique-tmp-name + rename**:
   ```
   const tmp = INBOX_PATH + '.tmp.' + process.pid + '.' + randomUUID();
   fs.writeFileSync(tmp, out); fs.renameSync(tmp, INBOX_PATH);
   ```
   **Do NOT use `writeFileAtomic` from `config.js`** here: its tmp name is *fixed* (`path + '.tmp'`, `config.js:136`), which two concurrent writers share and corrupt — exactly the `WR-02` bug `session-end.js:368-373` documents and avoids with the unique-tmp pattern. Copy that pattern verbatim.

**Why this closes the tension:** because triage's temp+rename holds the same lock that appends serialize on, the rename can never clobber a concurrent append. Rows are grow-only (audit trail preserved); status is the only mutable field; capture degrades to lockless-append rather than ever losing an idea. This is the strongest option that stays within the hard constraints (no new deps, never-throws, deterministic).

---

## Data Flow

### Capture flow (shell)

```
kodo capture "idea"
   → runCapture: derive tag (cwd → projects.json nearest-ancestor, adopt.js:138)
   → stripControlChars(texto)
   → withFileLock(inbox.lock): appendFileSync("- [ ] <id> · … · shell\n")
   → exit 0
```

### Capture flow (mid-session)

```
/kodo-capture "idea"   (skill, in a kodo-launched Claude session)
   → reads injected `# kodo <task_ref>` header (session-start.js:33-39) for context
   → shells: kodo capture "idea" --origin session --session-id <id>
   → runCapture: findSession({sessionId,cwd}) → precise task_ref tag
   → append (origin=session) → exit 0
```

### Triage + routing flow

```
kodo inbox                         → list rows where marker == "- [ ]"
operator picks item <id>
   ├─ route:   /gsd-capture --backlog "<texto>"   (runs in target project's repo)
   │              → GSD files it into ROADMAP.md 999.x / todo / seed
   │           kodo inbox route <id>  → setStatus(id, 'enrutada')  (no delete)
   └─ discard: kodo inbox discard <id> → setStatus(id, 'descartada') (no delete)
```

---

## Architectural Patterns

### Pattern 1: Pure core + thin lazy-imported CLI

**What:** All logic in `src/inbox/store.js` with DI-able paths; `src/cli/{capture,inbox}.js` only parse args, call the core, format output, and pick an exit code.
**When:** Every kodo subcommand. **Trade-offs:** one extra file per command, but full unit-testability against a tmpdir and zero parse cost for unrelated commands. Cite: `src/gsd/doctor.js` ↔ `src/cli/gsd-doctor.js` (registered `src/cli.js:459`).

### Pattern 2: Advisory-lock RMW with unique-tmp rename (never-throws)

**What:** Serialize file mutations with `withFileLock`; write via `tmp.<pid>.<uuid>` + `rename`, never a fixed tmp name.
**When:** Any concurrent read-modify-write of a `~/.kodo/` file. **Trade-offs:** O(n) rewrite (fine — the inbox is tiny), but crash-safe and lost-update-safe. Cite: `src/hooks/session-end.js:327-381`, `src/session/state-lock.js:215`.

### Pattern 3: Deterministic tag derivation, LLM only phrases

**What:** The project tag is computed from cwd/session_id, not asked of the model. **When:** the `/kodo-capture` skill. **Trade-offs:** the skill is a thin shell-out; all "intelligence" is the deterministic reverse-lookup already in `src/cli/adopt.js:138-143`. Keeps the capture path 0-token and reproducible.

### Pattern 4: Decoupled handoff to GSD (no import)

**What:** kodo emits a plain-text idea + tag; `gsd-capture` consumes it into a GSD destination in a separate invocation. **When:** routing. **Trade-offs:** the operator/LLM is the courier (two steps: `/gsd-capture …` then `kodo inbox route <id>`), but kodo carries zero GSD-routing logic and the two evolve independently. Cite: `~/.claude/skills/gsd-capture/SKILL.md:28-39`.

---

## Anti-Patterns

### Anti-Pattern 1: Using `config.js` `writeFileAtomic` for the triage RMW

**What people do:** reuse the handy `writeFileAtomic(INBOX_PATH, …)`.
**Why it's wrong:** its tmp name is fixed `path + '.tmp'` (`config.js:136`); two concurrent writers share it and corrupt each other — the `WR-02` bug `session-end.js:368-373` explicitly warns against.
**Do this instead:** unique tmp `INBOX_PATH + '.tmp.' + pid + '.' + randomUUID()` + rename, under the lock.

### Anti-Pattern 2: Deleting rows on discard/route

**What people do:** remove the line when it's handled.
**Why it's wrong:** kills the audit trail the feature exists to provide ("marks `enrutada`/`descartada` sin borrar", backlog 999.2).
**Do this instead:** flip the status token in place; rows are grow-only.

### Anti-Pattern 3: Adding a server endpoint or the model deciding the tag

**What people do:** POST captures to `src/server.js`, or ask the LLM which project a capture belongs to.
**Why it's wrong:** violates "cero endpoints nuevos" (LOCKED since v0.10; v0.14 config-editor precedent) and the "deterministic CLI, 0 tokens" constraint.
**Do this instead:** filesystem-only writes; deterministic cwd→projects.json tag derivation.

### Anti-Pattern 4: Re-implementing gsd-capture's routing inside kodo

**What people do:** parse the idea and write ROADMAP.md/todos from kodo.
**Why it's wrong:** duplicates GSD logic that will drift; explicitly out of scope ("routing delegated to GSD's gsd-capture, no reimplementation").
**Do this instead:** hand the text to `/gsd-capture`; kodo only tracks triage state.

---

## Integration Points

### External / Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `src/cli.js` ↔ `src/cli/{capture,inbox}.js` | lazy `await import()` in `.action()` | Two new `program.command` blocks; no `ensureConfig()` (provider-agnostic) |
| `src/inbox/store.js` ↔ `~/.kodo/inbox.md` | `fs` append + RMW under `withFileLock` | Lock at `INBOX_PATH+'.lock'` |
| `src/cli/capture.js` ↔ `projects.json` | `loadProjects()` reverse cwd match | Reuse `resolveProjectId`/`deriveModuleFromCwd` shape from `src/cli/adopt.js:138` |
| `/kodo-capture` skill ↔ `kodo capture` CLI | shell-out (`Bash` allowed-tool) | Skill passes `--origin session --session-id`; derivation stays in kodo |
| `kodo inbox` ↔ `gsd-capture` | operator/LLM courier (no code link) | Route = run `/gsd-capture` then `kodo inbox route <id>` |
| `kodo skill sync` ↔ new skill | canonical `.claude/skills/` → `~/.claude/skills/` | **⚠ `kodo skill sync` currently syncs ONLY `kodo-orchestrate`** (`src/cli.js:507`). Adding `kodo-capture` needs skill-sync generalized to multi-skill, or a documented manual copy — flag for the roadmap. |
| `src/server.js` | **none** | Hard constraint honored: zero endpoints touched |

---

## Suggested build order (dependency-graded)

1. **Phase 82 — Inbox core + `kodo capture` (foundation).** `src/config.js` `INBOX_PATH` export; `src/inbox/store.js` (line codec, `appendCapture`, `listCaptures`, `setStatus`, lock wiring, unique-tmp RMW); `src/cli/capture.js` + register `kodo capture` in `src/cli.js`; tag derivation via projects.json reverse-lookup + `stripControlChars`. Everything downstream depends on the store + format. Deterministic, 0 tokens, no server. *Verifies the append path + concurrency under `withFileLock`.*
2. **Phase 83 — `kodo inbox` triage (list + route/discard).** `src/cli/inbox.js` + register; consumes the store's `listCaptures`/`setStatus`; append-only-rows / mutable-status invariant; `--json` byte-deterministic. Depends on Phase 82's store. (Phases 82 and 83 could split within one milestone phase if the store lands first; the CLI surfaces parallelize once the core exists.)
3. **Phase 84 — `/kodo-capture` skill + skill-sync generalization.** Canonical `.claude/skills/kodo-capture/skill.md` (context derivation → shell `kodo capture --origin session`); **generalize `kodo skill sync` to multi-skill** (or document manual placement). Depends on Phase 82 (the CLI it shells) and touches the sync surface (`src/cli/skill-sync.js`, `src/cli.js:507`).
4. **Routing seam (doc/skill wiring, no kodo code).** Document the `kodo inbox` → `/gsd-capture` → `kodo inbox route <id>` handoff in the README / `kodo-orchestrate` skill so the courier flow is discoverable. Depends on Phase 83.

**Ordering rationale:** the file format + lock + append is the spine — nothing lists or triages without it, so it lands first and is where the concurrency risk concentrates (research flag: exercise N-way concurrent capture + simultaneous triage RMW). Triage is pure consumption of the store. The skill is last because it only shells the already-shipped CLI and drags in the orthogonal skill-sync generalization. The gsd-capture seam is a documentation/wiring concern with no kodo code, so it trails.

**Research flags for phases:**
- **Phase 82:** concurrency is the real risk — verify the append lock-timeout fallback and the triage unique-tmp rename against N processes (mirror the `gsd-lock-race` scrutiny this very milestone is fixing). Confirm `appendFileSync` O_APPEND atomicity assumption on the target fs.
- **Phase 84:** the skill-sync multi-skill generalization is a small but real API change to `src/cli/skill-sync.js` — scope it explicitly; don't let a second skill silently not-sync.
- **Phases 83 / routing:** standard patterns, unlikely to need deeper research.

---

## Confidence / corrections

- **HIGH** — every claim cites a file/line read in this pass; no external tech.
- **Correction to the milestone brief:** the brief says "file locks in `src/gsd/lock.js` (withFileLock pattern)". Verified in-repo: `src/gsd/lock.js` is the **per-repo GSD lock** (`acquireGsdLock`/`releaseGsdLock`/`stealLock`, a different concern — that's the one v0.19 also fixes for the `stealLock` race). The reusable advisory-lock RMW primitive the inbox should use is **`withFileLock` in `src/session/state-lock.js:215`**, the same one `src/hooks/session-end.js:331` uses for the handoff RMW. Use the latter; do not couple the inbox to the GSD per-repo lock.

## Sources

- `src/cli.js` (command registration + lazy-import pattern) — `:408-476`, `:479-500`, `:502-521`
- `src/inbox/…` — NEW (proposed), modeled on `src/gsd/doctor.js` ↔ `src/cli/gsd-doctor.js`
- `src/session/state-lock.js:182-231` — `withFileLock` / `releaseLock` (never-throws advisory lock)
- `src/hooks/session-end.js:325-391` — handoff RMW: `withFileLock` + unique-tmp rename, WR-02 caveat
- `src/hooks/session-start.js:33-106`, `:121-234`, `:254` — injected `# kodo <task_ref>` context + `findSession`
- `src/config.js:11-14`, `:135-146`, `:615` — `KODO_DIR`/path consts, `writeFileAtomic` fixed-tmp caveat, exports
- `src/cli/adopt.js:108-143` — projects.json reverse cwd→project resolution to reuse for the tag
- `src/cli/format.js:80` — `stripControlChars` sanitizer
- `~/.claude/skills/gsd-capture/SKILL.md:1-39` — routing table for the decoupled handoff
- `.claude/skills/kodo-orchestrate/skill.md` + `src/cli.js:502-521` — skill-sync single-skill scope (generalization flag)

---
*Architecture research for: kodo v0.19 global capture inbox*
*Researched: 2026-07-24*
