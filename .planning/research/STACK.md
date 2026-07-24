# Stack Research

**Domain:** Append-only capture inbox for a Node.js CLI (kodo v0.19, feature 999.2 / CAPT-01..04)
**Researched:** 2026-07-24
**Confidence:** HIGH

## Summary

The correct "stack" for the capture inbox is **zero new packages** — every primitive this
feature needs already exists and is battle-tested inside kodo. The only real engineering
decision is the concurrency model for an append-only file, and the codebase already contains
both halves of the answer (a lockless O_APPEND precedent in `src/logger.js` and a
lock+read-modify-write precedent in `src/hooks/session-end.js`). No external library
(`proper-lockfile`, `write-file-atomic`, `steno`, `lockfile`, `nanoid`, a markdown parser…)
is warranted; each would either duplicate an in-repo primitive or violate the hard
zero-new-deps constraint — and none give a guarantee the built-ins don't.

The one genuinely load-bearing choice: **the append path and the mark path must share the
same advisory lock**, because marking rewrites the whole file and a lockless concurrent
append would be lost inside that rewrite window. That is the single non-obvious finding.

## Recommended Stack

### Core Technologies (all already present — reuse, don't add)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `node:fs` (built-in) | Node ≥20 | `appendFileSync` (O_APPEND), `readFileSync`, `writeFileSync`, `renameSync`, `mkdirSync`, `existsSync` | Every file op the inbox needs. O_APPEND append + tmp+rename are the exact primitives already used across kodo. |
| `commander` | `^13.0.0` (installed) | Register `kodo capture` and `kodo inbox` subcommands | Same registration pattern as every other subcommand in `src/cli.js` (lazy `await import()` in the `.action` handler). No version change. |
| `withFileLock` / `acquireLock` / `releaseLock` | in-repo — `src/session/state-lock.js` | Advisory O_EXCL lock (retry + TTL steal + CAS, fail-safe `{ok:false}`) around both inbox operations | The Phase-70 generalized lock primitive. Never throws, never blocks indefinitely, zero deps. Exactly what "atómico/locked against concurrent captures" asks for. |

### Supporting Libraries (in-repo modules to reuse)

| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `KODO_DIR` | `src/config.js:11` (exported `:615`) | Resolve `~/.kodo/inbox.md` and `~/.kodo/inbox.md.lock` via `join(KODO_DIR, 'inbox.md')` | In the CLI command module. CLI paths may import `config.js` freely (session-end.js already does). |
| `sanitizeInline(text, maxLen)` | `src/session/handoff.js:81` | Flatten the captured idea text to a single CR/LF-free, whitespace-collapsed line | On the `"idea"` argument before appending — guarantees the one-line-per-capture invariant and blocks newline injection that would forge extra inbox rows. **Zero-import pure fn** — safe to reuse from anywhere. |
| String-only parse discipline (`split`/`indexOf`/`startsWith`, never `RegExp`) | pattern in `src/session/handoff.js` (whole module) | Parse inbox lines for `kodo inbox` list + mark | Inbox lines are human/LLM-authored arbitrary text → same anti-ReDoS discipline (T-74-09). Do not introduce a RegExp-based line parser. |
| `withFileLock` RMW+tmp+rename template | `src/hooks/session-end.js:331-389` | Copy-paste-adapt template for the mark operation | The mark op is a read→mutate-one-line→rewrite; this is the exact, already-reviewed pattern (unique tmp name per writer `path+'.tmp.'+pid+'.'+randomUUID()`, `rmSync` on failure). |
| `appendFileSync` precedent | `src/logger.js:318` | Reference for the append itself | The logger appends NDJSON from concurrent sessions with a bare `appendFileSync` and no lock — proves O_APPEND single-line atomicity is trusted in-repo. |
| Command registration precedent | `src/cli.js:18-77` (`config`), `src/cli/*.js` | Structure of the two new subcommands | `program.command('capture')` + `.argument('<text>')`; `program.command('inbox')` + options; body in `src/cli/capture.js` / `src/cli/inbox.js`, imported lazily. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `node --test` (built-in) | Unit tests for append atomicity + mark RMW + lock-timeout fail-safe | Existing suite is `node:test`. Add a concurrency test mirroring the 10-writer state-lock test. |
| `test/check-isolation.test.js` | Guards `handoff.js` cero-imports | If any new pure parser is added as a leaf, extend this guard; do NOT make `handoff.js` import fs for the inbox. |

## Installation

```bash
# Core
# (nothing to install — commander, node:fs built-ins, and the in-repo
#  lock/atomic-write primitives already satisfy the entire feature)

# Supporting
# (none)

# Dev dependencies
# (none — node --test is built in)
```

## The one real decision: append-only concurrency model

Two in-repo patterns are candidates. They are NOT interchangeable here:

**Option A — lockless `appendFileSync` (O_APPEND) only.**
POSIX makes a single `write()` to an O_APPEND regular file atomic w.r.t. the end-of-file
offset; a short capture line (`texto · tag · fecha · origen`, well under the ~4 KB single-syscall
size) never interleaves with a concurrent append. `src/logger.js:318` relies on exactly this
across concurrent sessions. **Sufficient for the append in isolation.**

**Why A alone is NOT enough:** `kodo inbox` marking `enrutada`/`descartada` changes a line's
length (adds a status token), so it cannot byte-patch in place — it must **read the whole file,
mutate one line, and rewrite** (tmp+rename). If a lockless append lands between that read and the
rename, the rewrite overwrites the file with content that never saw the new line → **silent lost
capture**. For a feature whose entire point is traceability ("never deletes"), that window is
unacceptable.

**Recommended — Option B: both operations share one advisory lock** (`~/.kodo/inbox.md.lock`
via `withFileLock`):

- `kodo capture` / `/kodo-capture` → `withFileLock(lock, () => appendFileSync(inbox, line))`.
  Trivial body; the lock closes the append-vs-rewrite window. On the (near-impossible for an
  interactive single-user capture) `{ok:false}` lock-timeout after 8×20 ms, report "no se pudo
  capturar, reintenta" honestly rather than losing the line.
- `kodo inbox` mark → `withFileLock(lock, () => { read → mutate → tmp+rename })`, cloning
  `session-end.js:331-389`.

This is one primitive, zero deps, already reviewed, and eliminates the lost-update entirely.
Contention is essentially nil (captures are human-paced), so the lock is nearly free.

> Do **not** use `writeFileAtomic` from `config.js` for the mark rewrite: its tmp name is
> **fixed** (`path + '.tmp'`), which WR-02 (Phase 74) specifically corrected because concurrent
> writers share and clobber it. Use the unique-per-writer tmp name from `session-end.js:374`.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `withFileLock` (in-repo, `state-lock.js`) | `proper-lockfile` / `lockfile` npm | Never here — violates zero-deps and duplicates a reviewed primitive. Only if kodo ever needed cross-host NFS locking (it does not; inbox is single-host `~/.kodo`). |
| `appendFileSync` + tmp+rename | `write-file-atomic` / `steno` npm | Never here — `config.js:writeFileAtomic` already implements temp+rename; adding a lib is pure redundancy. |
| String-only line parser (`handoff.js` style) | A markdown AST parser (`remark`, `marked`) | Never — the inbox is line-oriented, not a document tree; an AST parser is heavyweight, adds deps, and opens ReDoS/parse surface on untrusted text. |
| `randomUUID()` (`node:crypto`) for tmp suffix | `nanoid` npm | Never — `node:crypto.randomUUID` is built-in and already the repo convention (`lock.js:288`, `session-end.js:374`). |
| Lock BOTH paths | Lockless append + locked mark only | Only if marking were changed to never rewrite the file (e.g. an append-only "routed" side-ledger). Rejected: complicates the "single append-only file" model the spec asks for. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any new npm dependency | Hard milestone constraint (cero new deps); every need is covered by built-ins + in-repo modules | `node:fs`, `state-lock.js`, `handoff.js`, `config.js` |
| A new endpoint in `src/server.js` | Hard constraint (cero endpoints nuevos); capture is a local-filesystem CLI action, like `kodo adopt`/dashboard writes since v0.10 | Direct filesystem write from the CLI command module |
| `writeFileAtomic` (`config.js`) for the mark rewrite | Fixed tmp name → concurrent-writer clobber (the exact WR-02 bug) | Unique-per-writer tmp + rename (`session-end.js:374` pattern) inside `withFileLock` |
| `RegExp` line parsing of inbox text | Untrusted human/LLM text → ReDoS surface (T-74-09) | `split`/`indexOf`/`startsWith`/`slice` (handoff.js discipline) |
| Re-implementing routing to task/phase/config | `gsd-capture`/`gsd-inbox` skills already own it | Delegate: `/kodo-capture` shells out / hands the line to `gsd-capture` |
| An LLM/token step in `kodo capture` or `kodo inbox` list | Hard constraint: 0 tokens for CLI paths (deterministic) | Pure string composition + filesystem I/O. (Only `/kodo-capture`, a Claude Code skill, derives project/task from session context — that's the mid-session path, not the CLI path.) |

## Integration points (where the new code plugs in)

- **CLI:** register `capture` and `inbox` in `src/cli.js` (mirror the `config` command, lines 18-77);
  bodies in new leaf modules `src/cli/capture.js` and `src/cli/inbox.js`, lazy-imported in `.action`.
- **Paths:** `join(KODO_DIR, 'inbox.md')` and `…+'.lock'` — `KODO_DIR` from `src/config.js`.
- **Append:** `withFileLock(lockPath, () => appendFileSync(inboxPath, sanitizeInline(idea) + ' · ' + tag + ' · ' + date + ' · ' + origin + '\n'))`.
- **List/mark:** `withFileLock(lockPath, () => RMW tmp+rename)`, string-only parse.
- **Skill `/kodo-capture`:** new `.claude/skills/kodo-capture/skill.md` (model on `.claude/skills/kodo-orchestrate/skill.md`); derives project/task from the live session context and shells `kodo capture "…" --origen session` (deterministic CLI does the write; the skill only supplies derived context). Routing stays with `gsd-capture`.
- **No touch:** `src/server.js` (no endpoint), `src/gsd/lock.js` (that's the GSD repo lock, orthogonal — and it's under an independent fix in the same milestone; do not couple the inbox to it).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `node:fs` O_APPEND / tmp+rename | Node ≥20 (`engines.node`) | rename is atomic intra-filesystem only; keep the tmp in `~/.kodo` (same fs as the inbox) — never `os.tmpdir()` (EXDEV). Same rule already documented at `config.js:111`. |
| `commander@^13` | current kodo | No change; two more `.command()` calls. |
| `state-lock.js` `withFileLock` | current kodo | Fail-safe returns `{ok:false, reason:'lock-timeout'}` — the capture path must branch on it (report + non-zero exit), never assume success. |

## Sources

- `src/gsd/lock.js` (read in full) — O_EXCL + CAS steal lock; **not** the inbox lock (repo-scoped GSD lock), cited for the isPidAlive/steal primitives `state-lock.js` reuses. HIGH.
- `src/session/state-lock.js` (read in full) — `withFileLock`/`acquireLock`/`releaseLock`, the recommended inbox lock primitive. HIGH.
- `src/hooks/session-end.js:325-389` (read) — the exact lock+RMW+tmp+rename template for the mark op. HIGH.
- `src/session/handoff.js` (read in full) — `sanitizeInline`, string-only anti-ReDoS parse discipline, zero-import leaf pattern. HIGH.
- `src/config.js:11-146,615` (read) — `KODO_DIR` path helper + `writeFileAtomic` (and why its fixed tmp name disqualifies it for the mark rewrite). HIGH.
- `src/logger.js:314-324` (read) — lockless `appendFileSync` O_APPEND precedent across concurrent sessions. HIGH.
- `src/cli.js:1-77` (read) — command registration + lazy-import action pattern. HIGH.
- `.claude/skills/kodo-orchestrate/skill.md` (read) — skill authoring convention for the new `/kodo-capture`. HIGH.
- `package.json` — 4 prod deps (`commander@^13`, `ink@^6`, `picocolors@^1`, `react@^19`), `engines.node >=20`. HIGH.

---
*Stack research for: append-only capture inbox (kodo v0.19, CAPT-01..04)*
*Researched: 2026-07-24*
