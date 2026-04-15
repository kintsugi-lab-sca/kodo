# Feature Research

**Domain:** AI-workflow automation bridge (Plane ↔ Claude Code via GSD) + structured logging for local dev CLI
**Researched:** 2026-04-15
**Milestone:** kodo v0.3 (GSD integration + structured logging)
**Confidence:** MEDIUM-HIGH (GSD integration grounded in existing kodo + GSD skill; logging patterns are industry standard)

## Scope

Milestone v0.3 adds two orthogonal capability sets to kodo:

1. **GSD Integration** — bridge Plane tasks to the Get-Shit-Done multi-phase workflow so that a single Plane task drives a single GSD phase, with auto-bootstrap when `.planning/` is absent, roadmap-aware phase resolution, and orchestrator awareness of verification artifacts.
2. **Structured Logging** — replace ad-hoc `console.log` / stdout noise with leveled, JSON-formatted per-session logs and a `kodo logs <session-id>` CLI for retrieval.

These are independent features but will ship in the same milestone because both feed operator trust in long-running, autonomous Claude sessions.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that are assumed to exist. Missing these makes the feature set feel half-finished.

#### GSD Integration

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Label-triggered GSD mode (`kodo:gsd`) | Consistent with existing `kodo:sonnet` / `kodo:haiku` / `kodo:yolo` label-driven model/permission pattern | LOW | Reuse existing label parser in dispatcher; add `gsd` to known-label enum. Depends on existing webhook → session pipeline. |
| Auto-bootstrap `/gsd:new-project` when `.planning/` missing | If GSD requires planning artifacts and none exist, session would error; user expects "just work" on first run | MEDIUM | Claude session must detect absence and invoke the slash command as its first instruction. Plane task body is the natural project-brief input. |
| Phase resolver reading `ROADMAP.md` | 1 Plane task = 1 GSD phase only works if the system knows which phase this task maps to | MEDIUM | Parse `.planning/ROADMAP.md`, match task title/ID to a phase entry. Needs a stable convention for linking Plane task → phase (phase ID in title, or Plane custom field). |
| Orchestrator verifies `VERIFICATION.md` before approving In Review | The whole point of GSD is gated phases; orchestrator approving without checking verification defeats it | MEDIUM | Orchestrator skill already exists; add a branch: if task is GSD, require `.planning/phases/<phase>/VERIFICATION.md` present and passing before sign-off. |
| 1 Plane task = 1 GSD phase (strict mapping) | Prevents scope creep inside a session; keeps phases atomic | LOW | Enforced by phase resolver — refuse to run if task spans multiple phases or no phase matches. |
| GSD session failure surfaces in Plane (comment + state) | Silent failures break trust; existing kodo already comments on state transitions | LOW | Reuse existing Plane comment hook. Differentiator is including which phase/verification step failed. |

#### Structured Logging

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Log levels (`debug` / `info` / `warn` / `error`) | Industry standard since syslog; every serious CLI has them | LOW | Single logger module; level configurable via env (`KODO_LOG_LEVEL`) and CLI flag. |
| JSON output (NDJSON, one event per line) | Expected for anything that might be shipped to Loki/Datadog/CloudWatch or parsed with `jq` | LOW | Include `timestamp`, `level`, `session_id`, `component`, `msg`, plus arbitrary context. Newline-delimited, grep-friendly. |
| Per-session log file | Sessions run in parallel; interleaved global log is unreadable | LOW | Path convention: `~/.kodo/logs/<session-id>.ndjson`. Rotation/cleanup deferred. |
| `kodo logs <session-id>` CLI | Operators expect to retrieve logs by ID without knowing the file layout | LOW | Thin wrapper: resolve session-id → path, stream file. Support `--follow` (tail -f) and `--level` filter. |
| Human-readable console output alongside JSON file | JSON is for machines; terminal output should stay readable during interactive runs | LOW | Pretty-print to stderr at INFO+ by default; full JSON to file always. |
| Timestamps in ISO-8601 / RFC 3339 | Any other format is a bug; required for log aggregation | LOW | `new Date().toISOString()` — zero dependency. |
| Context propagation (session_id, task_id, phase) | Without correlation IDs, multi-session debugging is impossible | LOW | Child loggers per session; bind `session_id`, `plane_task_id`, and (when GSD) `phase_id` at session creation. |

### Differentiators (Competitive Advantage)

Features that make kodo's GSD and logging story noticeably better than rolling your own wrapper.

#### GSD Integration

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Phase-aware orchestrator prompts | Orchestrator knows it's supervising a GSD phase and loads `PROJECT.md` + `ROADMAP.md` + phase-specific `PLAN.md` into context, so its review is phase-contextual not generic | MEDIUM | Dispatcher passes GSD metadata to orchestrator session at spawn; orchestrator skill branches on presence. |
| Verification artifact as hard gate | Most AI-task tools let the agent self-declare "done"; kodo requires an artifact the orchestrator can inspect, raising the quality floor | MEDIUM | Tie "In Progress → In Review" transition to VERIFICATION.md existing and its checklist being ticked. |
| Auto-bootstrap uses Plane task body as project description | Zero-config first run: user labels an epic-sized task `kodo:gsd`, kodo bootstraps the whole plan | MEDIUM | Feed Plane task description into `/gsd:new-project` as project brief. Guardrail: only bootstrap on the *first* GSD task in a repo. |
| Phase inference from task title when no explicit mapping | Plane tasks named "Phase 2: Plane Adapter" resolve automatically without custom fields | LOW | Regex/fuzzy match on `ROADMAP.md` phase headings. Fall back to failing loudly if ambiguous. |

#### Structured Logging

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `kodo logs <session-id> --follow` with live tail | Operators watch a session unfold without attaching to the running process; rare in AI-agent tooling which tends to dump to terminal and lose history | LOW | `fs.watchFile` or tail semantics; trivial. |
| Log redaction of secrets (Plane API key, webhook signatures) | Dev tools routinely leak tokens in logs; building redaction from day one is a real differentiator | MEDIUM | Central allow/deny list of keys; redact before write. Strip `Authorization` headers from any HTTP trace. |
| Structured events for lifecycle transitions (`session.start`, `state.transition`, `plane.api.call`, `orchestrator.review`) | Makes logs queryable: "show me all failed orchestrator reviews this week" becomes a `jq` one-liner | LOW-MEDIUM | Define a small event taxonomy (~10 event types) to avoid churn. |
| Correlation between kodo log and Claude session transcript | Link each `session.start` entry to the Claude session's JSONL transcript path so operators can pivot between kodo's view and Claude's view | LOW | Log `transcript_path` at session start. |
| `kodo logs --session-of <plane-task-id>` | Operators think in Plane task IDs, not kodo session IDs; saves a lookup | LOW | Index by task-id on session creation (small sqlite or flat index file). |

### Anti-Features (Commonly Requested, Often Problematic)

Things that look reasonable but should be avoided.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Web dashboard for logs | "I want to see everything in a nice UI" | Scope explosion; duplicates Loki/Grafana/CloudWatch; pulls kodo away from "local CLI bridge" identity | `kodo logs --follow` + document the NDJSON schema so users ship to their own stack |
| Multi-phase per task | Feels flexible | Breaks atomicity guarantee; orchestrator can't gate verification cleanly; a task secretly spanning 3 phases can't be reviewed coherently | Enforce 1:1; if task is too big, bootstrap creates child tasks per phase |
| Auto-bootstrap on every GSD-labeled task | "Make it always work" | Silently re-runs `/gsd:new-project` in already-planned repos, corrupting `.planning/` | Bootstrap only when `.planning/` is truly absent. If present but incomplete, fail loudly with remediation hint |
| Custom log format (proprietary schema) | "We can optimize for our needs" | Every log-aggregation tool assumes NDJSON + common field names; proprietary schemas force custom parsers forever | NDJSON + small documented schema matching pino/bunyan conventions |
| Log levels beyond the standard four | `trace`, `fatal`, `notice`, `critical`, `verbose` seen in many loggers | Paralysis of choice; `debug` covers `trace`; `error` + process.exit covers `fatal` | Stick to `debug` / `info` / `warn` / `error` |
| Two-way sync of GSD plan ↔ Plane sub-tasks | "Plane should mirror the roadmap" | Two-way sync is a distributed-systems tarpit; conflict resolution hell | Plane = task queue, `.planning/` = plan. One-way link (task references phase) |
| Orchestrator auto-creates Plane tasks for next phase | "Chain phases automatically" | Removes the human checkpoint that makes GSD trustworthy; runaway orchestrator could burn through a whole roadmap | Human creates next Plane task manually (or via `/gsd:next-phase`) |
| Log rotation / retention policy in v0.3 | "Disk will fill up" | Premature; NDJSON compresses well and sessions are short-lived. Adding rotation now means choosing a policy without data | Document `~/.kodo/logs/`; let operators clean up. Add rotation in a later milestone |
| Log shipping built into kodo (Datadog/Loki agents) | "Send logs to our stack" | Coupling kodo to specific vendors | NDJSON on disk is enough — operators point their existing agent at `~/.kodo/logs/*.ndjson` |

---

## Feature Dependencies

```
[kodo:gsd label detection]
    └──requires──> [existing label parser / dispatcher]  (already built)

[Phase resolver]
    └──requires──> [.planning/ROADMAP.md exists]
                       └──requires──> [auto-bootstrap OR pre-existing planning]

[Auto-bootstrap /gsd:new-project]
    └──requires──> [Plane task description → project brief mapping]
    └──requires──> [presence check for .planning/]

[Orchestrator verification gate]
    └──requires──> [Phase resolver]  (knows which VERIFICATION.md to check)
    └──requires──> [existing orchestrator skill]  (already built)
    └──enhances──> [existing In Progress → In Review flow]

[kodo logs CLI]
    └──requires──> [Per-session log file with stable path convention]
                       └──requires──> [Session-id → file mapping]

[Log redaction]
    └──requires──> [Structured logger]  (regex-redacting free-form strings is fragile)

[--session-of <plane-task-id>]
    └──requires──> [task-id ↔ session-id index]
    └──enhances──> [kodo logs CLI]

[Structured logging]
    └──enhances──> [GSD integration]  (phase transitions become queryable events)
    └──enhances──> [Orchestrator]     (review decisions become audit trail)
```

### Dependency Notes

- **Phase resolver requires ROADMAP.md:** If bootstrap hasn't run and ROADMAP.md doesn't exist, phase resolution fails. Bootstrap path must run *before* phase resolution on first-run sessions.
- **Auto-bootstrap must be idempotent-guarded:** The presence check is the dependency — removing it turns the feature into a footgun.
- **Orchestrator gate requires phase resolver:** The orchestrator needs to know *which* phase's VERIFICATION.md to inspect. Without phase resolution, the gate is unimplementable.
- **Log redaction requires structured logging:** Context objects can be walked and sanitized cleanly; free-form strings cannot.
- **Structured logging enhances GSD:** Phase transitions, orchestrator reviews, and verification gate outcomes are the highest-signal events and benefit most from structured emission.

---

## MVP Definition

### Launch With (v0.3)

Minimum to validate "kodo + GSD + observable sessions":

- [ ] `kodo:gsd` label detection — plumbing into existing dispatcher
- [ ] Auto-bootstrap `/gsd:new-project` when `.planning/` absent, guarded by presence check
- [ ] Phase resolver reading `ROADMAP.md` with title/heading matching
- [ ] Orchestrator verification gate (reads `VERIFICATION.md`, blocks In Review transition if missing/incomplete)
- [ ] Structured logger with 4 levels, NDJSON output, per-session file
- [ ] `kodo logs <session-id>` with `--follow` and `--level`
- [ ] ISO-8601 timestamps, session_id correlation, basic event taxonomy (`session.start`, `session.end`, `state.transition`, `orchestrator.review`, `gsd.phase.resolved`, `gsd.bootstrap`)
- [ ] Console pretty-print at INFO+ for interactive use
- [ ] Secret redaction for Plane API key and webhook signatures

### Add After Validation (v0.3.x)

- [ ] `kodo logs --session-of <plane-task-id>` — add once operators ask "which session was that?"
- [ ] Phase inference from Plane task title — only if explicit-mapping convention proves painful
- [ ] Expanded event taxonomy (`plane.api.call`, `claude.tool.use`) — driven by actual debugging needs
- [ ] Correlation to Claude transcript path — add when operators pivot between views regularly

### Future Consideration (v0.4+)

- [ ] Log rotation/retention — only once disk usage is a proven problem
- [ ] Metrics export (Prometheus-style) — only if someone operates kodo at scale
- [ ] GSD multi-project support (monorepo with multiple `.planning/` roots) — defer until kodo has more than one GSD user
- [ ] Slash command from Plane comment to trigger orchestrator re-review — nice but not core

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `kodo:gsd` label detection | HIGH | LOW | P1 |
| Auto-bootstrap with guard | HIGH | MEDIUM | P1 |
| Phase resolver (ROADMAP.md) | HIGH | MEDIUM | P1 |
| Orchestrator verification gate | HIGH | MEDIUM | P1 |
| Structured logger (levels + NDJSON + per-session file) | HIGH | LOW | P1 |
| `kodo logs <session-id>` CLI | HIGH | LOW | P1 |
| Console pretty-print | MEDIUM | LOW | P1 |
| Secret redaction | HIGH | MEDIUM | P1 |
| `--follow` / `--level` flags | MEDIUM | LOW | P1 |
| Phase inference from title | MEDIUM | LOW | P2 |
| `--session-of <task-id>` | MEDIUM | LOW | P2 |
| Expanded event taxonomy | MEDIUM | LOW | P2 |
| Transcript-path correlation | MEDIUM | LOW | P2 |
| Log rotation | LOW | MEDIUM | P3 |
| Web dashboard | LOW | HIGH | P3 (anti-feature — do not build) |
| Log shipping integrations | LOW | HIGH | P3 (anti-feature — do not build) |

---

## Dependencies on Existing kodo Capabilities

Explicit list of what the new features lean on (already built in v0.1–v0.2):

| New feature | Depends on existing |
|-------------|---------------------|
| `kodo:gsd` label | Label parser, webhook dispatcher, session spawner |
| Auto-bootstrap | Claude session spawner with slash-command-as-first-instruction; Plane task-body fetch |
| Phase resolver | Target-repo working-directory resolution (already per-session) |
| Orchestrator verification gate | Existing orchestrator skill / supervision session; existing In Progress → In Review hook |
| Per-session logging | Session-id generation; session lifecycle hooks (start/end) |
| `kodo logs` CLI | Session-id persistence / lookup (small addition if not already present) |
| Secret redaction | Central config module where Plane API key lives |

No feature in this milestone requires new infrastructure outside these existing primitives — it's composition plus one new CLI subcommand.

---

## Competitor / Prior-Art Feature Analysis

| Feature | GitHub Copilot Workspaces | Devin / Cognition | Aider / Claude Code CLI | Our Approach |
|---------|---------------------------|-------------------|-------------------------|--------------|
| Multi-phase task decomposition | Implicit in "plan" step, not persisted | Implicit, agent-internal | None | Explicit: GSD roadmap as on-disk artifact, human-editable |
| Verification gate before "done" | Self-declared | Self-declared | Self-declared | Orchestrator inspects VERIFICATION.md artifact — human-editable gate |
| Structured logs for agent runs | Proprietary dashboard | Proprietary dashboard | Transcript file, unstructured | NDJSON on disk, `jq`-friendly, operator-owned |
| Task-tracker integration | GitHub Issues (native) | Linear/Jira (proprietary) | None | Plane (self-hosted, label-driven) |
| Self-hostable / local-first | No | No | Yes | Yes — core value |

Differentiation story: **artifact-based gates + operator-owned logs + self-hosted task tracker**. Every other tool in this space hides state in a vendor dashboard. kodo keeps state on disk where operators can grep, edit, and version it.

---

## Sources

- Existing kodo codebase (`.planning/PROJECT.md` timeline, `README.md` timeline) — confirms current capability set
- GSD skill (`~/.claude/get-shit-done/`) — defines `/gsd:new-project`, `ROADMAP.md`, `VERIFICATION.md` conventions
- Industry logging conventions: pino, bunyan, Go's slog, Rust's tracing (all converge on leveled + structured + NDJSON)
- Prior commits: `dab86bc feat: Claude session owns Plane lifecycle`, `8e1bcd3 fix: in-memory lock` — confirm lifecycle hook model the new features plug into

**Confidence rationale:**
- HIGH on logging table-stakes and anti-features — decades of industry convergence
- MEDIUM-HIGH on GSD integration — grounded in the existing GSD skill contract and kodo dispatcher, but the phase-resolver heuristic and bootstrap trigger have real design choices that only testing will validate
- MEDIUM on the orchestrator verification gate — depends on how strictly VERIFICATION.md is structured across phases (may need a sub-spec in the phase PLAN.md for this milestone)

---
*Feature research for: GSD integration + structured logging (kodo v0.3)*
*Researched: 2026-04-15*
