# Pitfalls Research

**Domain:** Webhook-driven Node.js CLI bridge integrating external agent framework (GSD) and structured logging
**Researched:** 2026-04-15
**Confidence:** HIGH (rooted in kodo's known architecture + prior v0.2 retrospective; integration patterns verified against GSD command surface)

## Critical Pitfalls

### Pitfall 1: Phase Resolver Brittleness on Non-Canonical ROADMAP.md

**What goes wrong:**
The GSD phase resolver (the code that reads `.planning/ROADMAP.md` in the target repo to determine which `/gsd:phase-N-execute` to inject) hard-codes the Markdown shape GSD currently emits. Target repos that (a) predate current GSD, (b) were hand-authored, (c) have renamed phases, or (d) use `## Milestone N` instead of `## Phase N` silently fall back to the wrong phase — or worse, phase 1 — causing the agent to redo completed work.

**Why it happens:**
"ROADMAP.md" feels like a standard, but GSD's own template has evolved (phases vs. milestones, numeric vs. named, checkbox vs. status emoji). Developers write a regex against the current repo they're testing and ship it. The resolver is invoked per webhook with no user in the loop to catch the mismatch.

**How to avoid:**
- Define an explicit `ROADMAP_SCHEMA_VERSION` marker in GSD-generated roadmaps; resolver refuses to proceed on unrecognized/missing version and logs a structured error instead of guessing.
- Parse with a tolerant AST (e.g., `remark` + `unified`) not regex. Extract all `## ` headings and match by normalized slug, not exact string.
- Provide a `kodo gsd inspect <repo>` dry-run command that prints resolved phase + matched heading, so operators can verify before live webhooks hit it.
- Fail closed: if two headings match or zero match, abort the session and surface the error to Plane as a comment. Do NOT start Claude.

**Warning signs:**
- Sessions starting with phase 1 on a repo that has 4 completed phases (look for repeated `phase-1-execute` invocations in logs across one repo).
- Claude output contains "I'm not sure which phase this is" or re-asks about already-decided architecture.
- Plane task comments from kodo referencing wrong phase number vs. task title.

**Phase to address:** Phase 1 (GSD integration foundation) — resolver must be built with tolerance + dry-run from day one, not retrofitted.

---

### Pitfall 2: Per-Repo Concurrency Collision on `.planning/`

**What goes wrong:**
Two Plane tasks that map to the same target repo arrive close in time. The current dedup lock is keyed by Plane `task_id`, so both pass. Two Claude Code sessions launch in the same working directory. They race on `.planning/ROADMAP.md`, `.planning/research/*`, and git operations — producing interleaved commits, lost edits, or a rebase nightmare. The `/gsd:*` workflow assumes a single author on `.planning/` per repo at a time.

**Why it happens:**
The in-memory lock was added in commit `8e1bcd3` to prevent duplicate-webhook sessions for the *same* task. The mental model ("one session per task") is correct for Plane but wrong for GSD, which arbitrates over a shared `.planning/` directory per repo.

**How to avoid:**
- Add a second lock tier keyed by **resolved target repo path** (absolute, realpath-resolved). Acquire both `task_id` lock and `repo_path` lock; release in reverse order.
- On repo-path contention, do NOT drop the second webhook — queue it (FIFO per repo) so the second task runs after the first completes. Dropping causes silent task starvation.
- Use a filesystem lock (`proper-lockfile` or a `.planning/.kodo.lock` sentinel with PID + start time) so even an accidentally-launched manual `claude` session collides visibly instead of corrupting git state.
- Reject concurrent launches with a Plane comment: "Queued behind task X (started HH:MM)" so the human sees why nothing is happening.

**Warning signs:**
- Git log on target repo shows two commits within seconds of each other, one reverting/conflicting with the other.
- `.planning/ROADMAP.md` has merge-conflict markers that no human introduced.
- Two kodo log files for the same repo path with overlapping timestamp ranges.
- Plane comments from two tasks both claim "starting phase 3."

**Phase to address:** Phase 1 (GSD integration) — the lock must exist before the first GSD session ships; retrofitting after a collision means investigating a corrupted repo.

---

### Pitfall 3: Context Injection Collision Between Plane Instructions and `/gsd:*`

**What goes wrong:**
kodo currently injects "document progress in Plane via MCP" instructions into every session. When it also injects `/gsd:phase-N-execute`, the GSD command has its own completion protocol (commit, update ROADMAP.md, run its own verifier). The two sets of instructions compete: Claude either (a) ignores Plane updates because GSD didn't mention them, (b) commits mid-GSD-phase because Plane instructions said "document progress after each step," or (c) writes phase updates into Plane comments that duplicate the ROADMAP.md history.

**Why it happens:**
System/user prompt layering is invisible at runtime. The Plane instructions were written assuming Claude is the only author of the session's behavior. GSD commands assume the same. Neither was designed to co-exist.

**How to avoid:**
- Define an explicit precedence: GSD phase command owns the **work lifecycle** (what to build, when to commit, how to verify). Plane instructions own **status reporting only** (state transitions, not progress narration).
- Rewrite the Plane context block for GSD sessions: strip "commit when done" (GSD handles it) and "document each step" (noisy); keep only "on session end, set task state to X."
- Detect GSD mode explicitly via a flag (e.g., `--gsd-phase` on the session launcher) and branch the context template — don't try to make one template serve both modes.
- Add an end-of-session reconciliation hook: after Claude exits, kodo (not Claude) posts a single structured comment to Plane summarizing the phase outcome from the logs. Removes the dependency on Claude remembering to update Plane.

**Warning signs:**
- Plane task has 20+ comments from one session (narration spam) or 0 comments (silence).
- Git commits happen but Plane task stays "In Progress."
- Commit messages contain "as requested by Plane task" (Claude is conflating the two instruction sources).
- ROADMAP.md phase status disagrees with Plane task status.

**Phase to address:** Phase 1 (GSD integration) — context templating must be split before the first real run; otherwise every session produces muddled behavior that's hard to untangle retroactively.

---

### Pitfall 4: Logger Initialization Breaking `kodo check` Zero-Token Path

**What goes wrong:**
`kodo check` is the 0-token vigilante path — it must stay fast and cheap because it runs on every stop hook. A naive structured-logger addition (pino/winston) imports transports, opens file handles, resolves log paths, and maybe spins up a worker thread during module load. `kodo check` now pays 50-200ms + FD overhead for a command that should be ~10ms and touch no disk.

**Why it happens:**
Logger modules are typically initialized at top-of-file import. The CLI entry point imports a shared `logger.js` that eagerly configures file destinations. Every subcommand pays the cost, even ones that never log.

**How to avoid:**
- Lazy-init the logger: `getLogger()` is a function that constructs on first call; import is free. `kodo check` never calls it.
- Split CLI entry points: `bin/kodo-check` is a minimal script with no logger import at all — it requires only what it needs, like the existing vigilante does. Do NOT route `check` through the same subcommand dispatcher as `webhook` or `session`.
- Add a boot-time budget test: `time kodo check` in CI must stay under a threshold (e.g., 50ms). Fail the build on regression.
- If a shared entry is unavoidable, gate logger construction on `process.argv[2] !== 'check'` before any transport setup.

**Warning signs:**
- `kodo check` wall-clock time creeping up between commits (track it).
- `kodo check` writes a log file (it shouldn't log anything — if a log exists, the import chain is wrong).
- Stop hook latency complaints or timeouts from the Claude Code harness.
- Profiler shows `require('pino')` or similar in `check`'s call graph.

**Phase to address:** Phase 2 (structured logging) — must ship with the boot-time budget test; without it, regression is invisible and creeps.

---

### Pitfall 5: Unbounded Per-Session Log Accumulation

**What goes wrong:**
Per-session log files (e.g., `~/.kodo/logs/session-<id>.log`) look clean during dev — one file per run, easy to grep. After 3 months of production webhook traffic (10-50 sessions/day), the directory holds 3000+ files, some multi-MB. `readdir` on the log dir starts taking seconds; disk fills on the developer laptop; `find` queries for debugging are slow.

**Why it happens:**
"One file per session" is the obvious design for debuggability. Rotation and retention are "later problems." There's no backpressure — the file grows as long as the session does, and sessions don't self-limit.

**How to avoid:**
- Retention policy defined **before** first log write, not after filesystem full: e.g., keep 7 days of per-session logs, then compress to a daily rollup, delete rollups older than 90 days.
- Implement retention as a startup check, not a cron: every webhook trigger, kodo (async, non-blocking) prunes older-than-threshold files. No external scheduler dependency.
- Cap per-session log size (e.g., 50MB hard cap); on overflow, rotate to `session-<id>.log.1` and warn in a structured error. Prevents a runaway session from eating the disk.
- Use a date-partitioned directory structure (`logs/YYYY-MM-DD/session-<id>.log`) so `readdir` on the top level stays O(days), not O(sessions). Trivial to delete an entire day's directory.
- Document the log location and retention policy in the README so users can opt to ship logs elsewhere (syslog, journald) before retention kicks in.

**Warning signs:**
- `ls ~/.kodo/logs | wc -l` > 500.
- Any single log file > 10MB (session should never produce that much; indicates a loop or noisy debug).
- Disk usage of logs dir growing faster than 100MB/week on a normal workload.
- `kodo logs <session-id>` CLI command (if built) gets slow.

**Phase to address:** Phase 2 (structured logging) — retention policy ships with the first log line, not as a follow-up task.

---

### Pitfall 6: Log Writes Blocking the Event Loop During Active Sessions

**What goes wrong:**
Synchronous `fs.appendFileSync` or unflushed stream writes during a high-traffic moment (Plane webhook burst, or a chatty `/gsd:research` phase with lots of structured events) back up on the event loop. Webhook responses slow down. Plane retries the webhook. kodo receives the same webhook 2-3 times. The existing `task_id` lock handles this, but under enough pressure, the lock itself is held waiting for I/O and contends.

**Why it happens:**
Node.js file-I/O footguns: `fs.appendFileSync` feels safe (no callback, no promise), but it blocks the loop. `fs.createWriteStream` is async but needs explicit backpressure handling via `.write()` return values.

**How to avoid:**
- Use pino's default async transport or `fs.createWriteStream` with `highWaterMark` tuning. Never `appendFileSync` in a handler path.
- Handle `.write() === false` by pausing structured event emission until `drain`, not by buffering unbounded in memory (that just moves the OOM point).
- Benchmark: simulate 100 webhooks/minute in a test and verify the event loop lag stays under 50ms (`perf_hooks.monitorEventLoopDelay`).
- Prefer append-only JSONL with one-line-per-event over pretty-printed JSON — simpler to flush, easier to grep, no close-brace bookkeeping.

**Warning signs:**
- Plane webhook retry rate > 0 (Plane sends the same event more than once because kodo didn't 200 fast enough).
- Event-loop-delay metric rising during session activity.
- Webhook handler tail latency spikes correlating with log volume spikes.

**Phase to address:** Phase 2 (structured logging) — must be verified under load before shipping, not discovered in production.

---

### Pitfall 7: Secret Leakage via Structured Logs

**What goes wrong:**
Structured logging is tempting to feed raw webhook bodies, raw Claude context blocks, and raw Plane API responses for debuggability. These contain: Plane API tokens (in retry headers), GitHub PATs (if user embeds them in task descriptions), OpenAI/Anthropic keys (in MCP server configs injected into sessions), and user prompts with PII. Logs land in plaintext on disk, potentially committed if a dev runs `kodo` inside a repo, potentially shared when a user sends a "bug report bundle."

**Why it happens:**
"Log everything, redact later" is the default DX. The structured logger gets a `context` object and calls `JSON.stringify` — no one audits what's in the object graph.

**How to avoid:**
- Define an explicit allowlist of fields per event type. The logger rejects (or drops with a warning) unknown fields. This inverts the default: you have to opt a field in.
- Centralize a redaction function: known secret-looking keys (`*token*`, `*secret*`, `authorization`, `api_key`, `cookie`) replaced with `[REDACTED]` before serialization. Pino's `redact` option is designed for this — configure it at logger construction.
- NEVER log raw webhook body or raw Claude stdin/stdout. Log metadata (length, event type, task id) and a stable hash of the content if correlation is needed.
- Add a pre-commit check / test that scans recent log samples for common secret patterns and fails if found.

**Warning signs:**
- `grep -E 'sk-|pat_|ghp_' ~/.kodo/logs/` returns hits.
- Log files flagged by repo secret scanners if accidentally committed.
- Users attach log files to bug reports and secrets are visible.

**Phase to address:** Phase 2 (structured logging) — redaction shipped with first log write. Retrofitting redaction after logs exist on user disks is too late.

---

### Pitfall 8: GSD Command Drift Breaking kodo's Phase Injection

**What goes wrong:**
GSD (separate repo, separate release cadence) renames `/gsd:phase-N-execute` to `/gsd:execute-phase N`, or changes its arguments, or splits into `/gsd:plan` and `/gsd:build`. kodo hard-codes the command string. Next Claude session launches with an invalid slash command; Claude either ignores it or asks the user what to do. No user is watching — the session sits idle until the Claude Code timeout.

**Why it happens:**
Slash commands look like stable API but are just filenames in `~/.claude/commands/`. GSD is allowed to rename them; kodo sees a string, not a contract.

**How to avoid:**
- Version-pin the expected GSD command set in kodo: on startup, scan `~/.claude/get-shit-done/` (or wherever GSD installs) for a `manifest.json` / `VERSION` and check commands exist before launching. Fail with a clear error: "GSD version X installed, kodo expects Y, check compatibility."
- Contract test: a CI job in kodo clones the GSD repo at its latest tag and asserts the expected commands exist as files.
- When kodo detects a GSD version mismatch, fall back to launching a plain Claude session with a comment to Plane explaining why — don't inject broken commands.

**Warning signs:**
- Sessions that start but produce zero git activity and zero Plane updates.
- Claude session logs containing "I don't recognize this command" or similar.
- Upgrading GSD in dev suddenly breaks kodo with no code change.

**Phase to address:** Phase 1 (GSD integration) — compatibility check is part of the integration contract; without it, every GSD release is a potential silent outage.

---

### Pitfall 9: Missing Log Correlation Across Session, Webhook, and Plane

**What goes wrong:**
A user reports "this task failed weirdly yesterday." You have: Plane task id, a vague timestamp, log files per session, and commits in the target repo. No single identifier ties them together. You grep logs by time window, guess which session file matches, cross-reference commits, and spend 20 minutes reconstructing what happened. Multiply by every incident.

**Why it happens:**
Each subsystem has its own ID: Plane `task_id`, webhook delivery id, session uuid, git commit sha, log filename. Nothing assigns a single trace id at webhook receipt and propagates it.

**How to avoid:**
- Assign a `correlation_id` (ULID or uuidv7 — time-sortable) at webhook ingress. Propagate it into: log filename, every structured log line's `cid` field, Plane comment footer, git commit trailer (`Kodo-Correlation-Id: 01HX...`).
- Provide `kodo trace <cid>` CLI that assembles the full story: which webhook, which task, which session log, which commits, which Plane comments.
- For GSD phase injections, pass the correlation id into the Claude session context as a non-secret value so Claude can include it in its own summaries.

**Warning signs:**
- "How do I find the log for Plane task TKN-123?" has no one-liner answer.
- Incident investigation regularly takes >10 min of log archaeology.
- Multiple log files match one timestamp and you don't know which is "the" session.

**Phase to address:** Phase 2 (structured logging) — correlation id is logging's job; retrofitting means old logs stay un-correlated forever.

---

### Pitfall 10: `.planning/` State Divergence Between Plane and Repo

**What goes wrong:**
Plane says task is "Done." `.planning/ROADMAP.md` in the repo says phase is still "In Progress." Or vice versa. GSD treats ROADMAP.md as source of truth for what to do next; Plane treats its own state as source of truth for dispatch. They drift because the session may complete partially, be killed mid-commit, or the GSD phase verifier rejects work after kodo already moved the Plane task.

**Why it happens:**
Two systems, two state machines, no transactional boundary. A crash between "commit ROADMAP.md update" and "update Plane state" leaves them inconsistent, with no reconciliation.

**How to avoid:**
- Declare ROADMAP.md the single source of truth for phase state. Plane state is a **projection** updated from it, not an independent authority.
- After session end, kodo reads ROADMAP.md to decide the new Plane state. Never trust the in-memory session outcome alone.
- On webhook ingress for a task, reconcile first: read ROADMAP.md, compare to Plane state, correct Plane if drifted (with a log entry) before dispatching new work.
- Refuse to start a session on a task whose Plane state contradicts ROADMAP.md beyond a configured tolerance — surface the conflict for human resolution.

**Warning signs:**
- Tasks "completed" in Plane where the target repo has uncommitted `.planning/` changes.
- Phases marked `[x]` in ROADMAP.md for tasks still "In Progress" in Plane.
- Duplicate work: GSD re-runs a phase already marked done because kodo dispatched based on Plane alone.

**Phase to address:** Phase 1 (GSD integration) — reconciliation rule baked into dispatch, not added after the first drift incident.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Regex-based ROADMAP.md parsing | Ships in 1 hour instead of 1 day | Silent phase misdetection on any format drift; hard to debug | Never — the blast radius (wrong work committed) is too high |
| `console.log` as structured logging | Zero deps, zero setup | No correlation, no redaction, no rotation, no structure for later querying | Only for `kodo check` (already exempt); never for sessions or webhooks |
| Single shared lock keyed by task_id only | Solves the observed duplicate-webhook bug | Per-repo collision waiting to happen the moment two tasks share a repo | MVP only if a README note warns ops not to map two tasks to one repo; remove before public release |
| Hard-coded `/gsd:phase-N-execute` string | Simplest possible integration | Silent breakage on every GSD version bump | Never — add at minimum a startup existence check |
| Log-to-disk-only (no stdout) | No log noise in webhook terminal | Harder to tail in dev, no journald/syslog path | Acceptable if `--log-stdout` dev flag exists |
| Eager logger init at module load | Simple imports | Breaks `kodo check` latency budget | Never in the shared CLI entry; acceptable in session-only entries |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GSD (slash commands) | Treating command names as stable API | Startup version/existence check; contract tests in CI |
| GSD (ROADMAP.md) | Parsing with regex against the current template | Markdown AST + schema version marker; tolerant to heading renames |
| GSD (`.planning/` writes) | Assuming kodo is sole writer | Filesystem lock `.planning/.kodo.lock` with PID/timestamp; detect manual `claude` runs |
| Plane (webhook retries) | Assuming each delivery is unique work | Idempotency via `task_id` lock + reconciliation against ROADMAP.md on ingress |
| Plane (state updates) | Mid-session progress narration comments | Single end-of-session summary comment posted by kodo from logs, not by Claude mid-flight |
| Plane (two tasks → one repo) | Per-task lock is sufficient | Two-tier lock: task_id + resolved repo path; FIFO queue on repo contention |
| Claude Code session (context) | Layering GSD + Plane instructions without precedence | Mode-specific template; GSD owns lifecycle, Plane owns status transitions only |
| Claude Code session (exit) | Trusting session's self-reported outcome | Re-read ROADMAP.md + git log after exit; derive truth from artifacts |
| File logging (Node fs) | `appendFileSync` in webhook handler | `createWriteStream` + pino async transport; event-loop-delay monitoring |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Eager logger import in `kodo check` | Stop-hook latency creep, mystery slowness per-Claude-stop | Split entry points; lazy `getLogger()`; CI budget test | Any time (affects every stop hook from first session) |
| Flat log directory with `session-<id>.log` | `readdir` slowdowns, directory-listing lag, IDE freezes on folder open | Date-partitioned `logs/YYYY-MM-DD/`; retention pruning on every webhook | ~2000-5000 files (OS/filesystem dependent) |
| Synchronous file writes in hot path | Webhook tail latency, Plane delivery retries | Async streams, backpressure handling, event-loop-delay monitoring | ~20-50 webhooks/min sustained |
| Unbounded per-session log growth | Disk fill, slow `kodo trace`, bloated bug report bundles | 50MB per-session cap + rotate; document in README | One runaway session (could happen on day one) |
| ROADMAP.md re-parse per log line | Session startup latency, event loop blocked while parsing large files | Parse once at session start, cache the AST, invalidate on file change | Any repo with >20 phases or long descriptions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging raw webhook body | Plane signing secret, embedded PATs, user PII on disk | Log metadata only (length, type, hash); pino `redact` config |
| Logging raw Claude stdin/stdout | MCP server credentials, session API keys, user prompt PII | Allowlist-based structured events; never pipe stdio to the logger |
| Storing correlation ids that embed secrets | Secrets in filenames, grep hits | Use ULID/uuidv7 — opaque, time-sortable, non-secret by construction |
| Default-permissive log file mode | Other users on shared dev machine read logs | `fs.chmod(0o600)` on create; document in install |
| Shipping logs in bug report bundles unredacted | Credential exfil via support channel | `kodo trace --redact` mode that scrubs and bundles; default to redacted |
| Trusting target repo path from Plane custom field without canonicalization | Path traversal to write `.planning/` in unintended repo | `path.resolve` + allowlist of permitted repo roots; reject symlinks |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failure when GSD command missing | Task sits "In Progress" forever, no feedback | Fail fast with Plane comment explaining the version mismatch |
| No way to find logs for a given task | Debugging takes 20+ minutes of archaeology | `kodo trace <task-id>` or `<correlation-id>` CLI assembles full story |
| Unclear which phase is "next" for a repo | User re-runs dispatch manually, gets wrong phase | `kodo gsd inspect <repo>` dry-run prints resolved phase + heading |
| GSD session produces mid-flight Plane spam | Task comments unusable; real comments drowned | Single end-of-session structured summary posted by kodo |
| Two tasks for one repo → silent queue | User wonders why second task isn't starting | Explicit Plane comment: "Queued behind task X, started HH:MM" |
| Log retention deletes evidence mid-investigation | User loses logs while debugging | Retention runs in background; `kodo logs pin <cid>` prevents deletion |

## "Looks Done But Isn't" Checklist

- [ ] **GSD phase resolver:** Often missing tolerance for renamed/versioned roadmaps — verify with 3 real roadmaps from different eras
- [ ] **Per-repo lock:** Often missing even when per-task lock exists — verify by launching 2 tasks mapped to same repo simultaneously
- [ ] **Context injection split:** Often missing mode branching — verify GSD sessions do NOT see Plane "document progress" text
- [ ] **Logger in `kodo check`:** Often accidentally imported transitively — verify with `time kodo check` and a CI budget test
- [ ] **Log retention:** Often "planned for later" — verify by running 500 simulated sessions and checking disk/dir counts
- [ ] **Secret redaction:** Often assumes devs won't log sensitive things — verify by `grep -E` on a sample of production logs for known secret patterns
- [ ] **Correlation id:** Often added to logs but not to Plane comments or git trailers — verify full round-trip from webhook to commit
- [ ] **GSD version check:** Often omitted because "GSD is stable" — verify startup aborts on missing command
- [ ] **ROADMAP.md as source of truth:** Often tacitly assumed but not enforced — verify reconciliation runs on every webhook, not just on failure
- [ ] **Async log writes:** Often "it's async because I used `fs.promises`" — verify with event-loop-delay metric under simulated burst load

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Phase resolver picked wrong phase | MEDIUM | `git revert` the bad commits; fix resolver + schema version; re-dispatch task |
| Two sessions collided on `.planning/` | HIGH | Manually reconcile git state (likely hard reset + replay); add per-repo lock; audit for corrupt commits |
| `kodo check` slowed from logger import | LOW | Split entry point; verify with budget test; no data corruption |
| Log directory blew up | LOW | Delete old files; add retention + partitioning; no data loss of useful logs |
| Secrets leaked to logs | HIGH | Rotate affected credentials; scrub log files on all machines; add redaction + post-facto scanner |
| GSD command rename broke sessions | MEDIUM | Pin GSD version; add compatibility check; replay affected tasks after fix |
| Plane/ROADMAP drift | MEDIUM | Manually reconcile affected tasks; implement reconciliation-on-ingress; audit for duplicate work |
| Context injection confusion | MEDIUM | Review recent commits + Plane comments for muddled behavior; split templates; re-test |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Phase resolver brittleness | Phase 1 (GSD integration) | `kodo gsd inspect` against 3 diverse roadmaps returns correct phase |
| Per-repo concurrency collision | Phase 1 (GSD integration) | Simulate 2 tasks → 1 repo; second queues, first completes cleanly |
| Context injection collision | Phase 1 (GSD integration) | Snapshot test of GSD-mode vs. plain-mode context template diff |
| Logger breaking `kodo check` | Phase 2 (structured logging) | CI budget test: `time kodo check` < 50ms |
| Unbounded log accumulation | Phase 2 (structured logging) | 500-session simulation; dir count + disk usage within policy |
| Event-loop-blocking writes | Phase 2 (structured logging) | Burst load test (100 webhooks/min) with event-loop-delay < 50ms |
| Secret leakage in logs | Phase 2 (structured logging) | Secret-pattern scanner test on log samples returns zero matches |
| GSD command drift | Phase 1 (GSD integration) | Startup check test: missing command → clear abort, no session launch |
| Missing log correlation | Phase 2 (structured logging) | `kodo trace <cid>` assembles webhook + session + commits + Plane comments |
| Plane/ROADMAP drift | Phase 1 (GSD integration) | Reconciliation-on-ingress test; inconsistent state → human-resolvable error, not silent dispatch |

## Sources

- kodo `.planning/PROJECT.md` + `RETROSPECTIVE.md` timeline (v0.2 provider-abstraction milestone, Apr 2026)
- Recent kodo commits: `8e1bcd3` (in-memory lock), `dab86bc` (Claude session owns Plane lifecycle), `4278931` (rate-limit-driven caching)
- GSD command surface (`~/.claude/get-shit-done/`) — slash command filenames, phase-execute pattern, ROADMAP.md template evolution
- Node.js logging footguns: pino docs on `redact` and async transports; `perf_hooks.monitorEventLoopDelay` pattern
- Webhook idempotency patterns: two-tier locking (resource-scoped), reconciliation-on-ingress
- Milestone context: known concerns listed by orchestrator (phase resolver, dedup granularity, context conflict, `kodo check` latency, log retention)

---
*Pitfalls research for: kodo v0.3 GSD integration + structured logging*
*Researched: 2026-04-15*
