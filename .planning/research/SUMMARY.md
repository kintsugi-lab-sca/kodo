# Project Research Summary

**Project:** kodo v0.3 — GSD Integration + Structured Logging
**Domain:** CLI orchestrator / webhook bridge (Plane ↔ Claude Code) with local-first observability
**Researched:** 2026-04-15
**Confidence:** HIGH

## Executive Summary

kodo v0.3 layers two orthogonal capabilities on top of the v0.2 provider-agnostic bridge: (1) **GSD integration** — label-triggered (`kodo:gsd`), auto-bootstrapping when `.planning/` is absent, with a phase resolver that reads `ROADMAP.md` and an orchestrator gate that inspects `VERIFICATION.md`; and (2) **structured logging** — leveled JSON-per-line, per-session files under `~/.kodo/logs/`, exposed via a new `kodo logs` subcommand. Both features share a single guiding concern: they must not weaken the v0.2 provider abstraction (GSD logic stays out of `providers/`) and they must preserve kodo's single-dep philosophy (one runtime dep: `commander`).

The recommended approach is **hand-rolled, stdlib-first**: Node 20's `fs/promises` + `JSON.stringify` + `fs.createWriteStream` cover logging in ~120 LOC; a tolerant regex walker over `ROADMAP.md` headings covers phase parsing in ~100 LOC. pino/winston, gray-matter, marked/remark, chokidar, chalk, and debug are all rejected — transitive-dep bloat for features we do not need at kodo's volume (~10 events/session). GSD awareness lives in a new `src/gsd/` folder and enters the session via an existing primitive — `SessionStart` hook `additionalContext` — not via the provider layer.

The main risks are integration, not implementation: (a) the **phase resolver** silently picking the wrong phase on drifted/hand-authored roadmaps; (b) **per-repo concurrency** — the current `task_id` lock protects one task from duplicate webhooks, but two different tasks mapped to the same repo will race on `.planning/`; (c) **context collision** between existing Plane "document progress" instructions and GSD's own lifecycle; (d) **logger init creeping into `kodo check`**, breaking the 0-token stop-hook budget; and (e) **unbounded log growth** if retention is deferred. All five are preventable with patterns identified in research and must ship with Phase 1/Phase 2, not after.

## Key Findings

### Recommended Stack

Zero new runtime dependencies. v0.3 is delivered entirely via Node 20 stdlib plus existing in-repo helpers. The hand-rolled logger exposes a pino-shaped API (`info/warn/error/debug` + `child`) so a future swap to pino is an import change, not a refactor.

**Core technologies:**
- **Node.js >=20** — runtime. Provides `fs/promises`, `fs.watch`, `node:test`, `perf_hooks.monitorEventLoopDelay`. Existing.
- **commander ^13** — CLI parser. Extended with the new `logs` subcommand. Existing, no version bump.
- **ESM + JSDoc `@ts-check`** — module system and type safety. Existing. New modules get `@typedef`s for `LogEntry`, `Roadmap`, `Phase`.
- **Hand-rolled `src/logger.js`** (~120 LOC) — NDJSON file transport + stderr mirror for warn/error. Zero deps.
- **Hand-rolled `src/gsd/roadmap.js`** (~100 LOC) — regex-based phase parser over `## Phase N:` headings. Zero deps.

Explicitly rejected: `pino`, `winston`, `bunyan`, `pino-pretty`, `gray-matter`, `marked`, `remark`, `unified`, `chokidar`, `chalk`, `picocolors`, `debug`, `nanoid`, `uuid`. See STACK.md for rationale per library.

### Expected Features

**Must have (table stakes):**
- `kodo:gsd` label detection wired into existing dispatcher — plumbing only.
- Auto-bootstrap `/gsd:new-project` when `.planning/` is absent (guarded by presence check to avoid clobbering planned repos).
- Phase resolver reading `ROADMAP.md` with title/heading matching; 1 Plane task = 1 GSD phase (strict).
- Orchestrator verification gate: `VERIFICATION.md` required and ticked before In Review transition.
- Structured logger with 4 levels (`debug`/`info`/`warn`/`error`), NDJSON, per-session file, ISO-8601 timestamps.
- `kodo logs <session-id>` with `--follow`, `--level`, `--raw`.
- Console pretty-print at INFO+ to stderr for interactive runs.
- Secret redaction (Plane API key, webhook signatures, common key patterns) from day one.
- GSD session failures surface as structured Plane comments.

**Should have (competitive differentiators):**
- Phase-aware orchestrator prompts — supervisor loads `PROJECT.md` + `ROADMAP.md` + phase `PLAN.md` into context.
- Verification artifact as a hard gate (raises quality floor vs. self-declared "done" tools).
- Correlation ID (ULID/uuidv7) assigned at webhook ingress, propagated to log filename, log lines (`cid`), Plane comment footer, and git commit trailer.
- `kodo trace <cid>` or `kodo logs --session-of <plane-task-id>` for one-command incident reconstruction.
- Structured event taxonomy (`session.start`, `state.transition`, `orchestrator.review`, `gsd.phase.resolved`, `gsd.bootstrap`).

**Defer (v2+ / anti-features — do not build):**
- Web dashboard for logs (scope explosion; duplicates Loki/Grafana).
- Multi-phase per task (breaks atomicity guarantee).
- Auto-bootstrap on every GSD-labeled task (silent clobber of planned repos).
- Two-way sync of GSD plan ↔ Plane sub-tasks (distributed-systems tarpit).
- Orchestrator auto-creating next-phase Plane tasks (removes human checkpoint).
- Log shipping to vendors (Datadog/Loki/CloudWatch) — NDJSON on disk is enough.
- Log rotation/retention policy beyond a minimum — deferred, but basic cap + pruning ships in v0.3 to prevent disk fill.

### Architecture Approach

v0.3 adds one new folder (`src/gsd/`), one new cross-cutting module (`src/logger.js`), and one new CLI subcommand (`kodo logs`). The `gsd` behavior is a **boolean flag on the `SessionRecord`** — decided from labels at dispatch time, consumed by `hooks/session-start.js` to inject GSD context. Providers never see it. Phase resolution is **lazy** (at hook time, not dispatch time) so it always reads the current `ROADMAP.md`.

**Major components:**
1. **`src/logger.js`** — Factory returning `{info,warn,error,debug,child}`. JSON-per-line to stdout + optional per-session file transport keyed by `sessionId`. No global singleton; instantiate at entry points and pass down.
2. **`src/gsd/phase-resolver.js`** — Pure async function over target-repo filesystem. Returns `{ bootstrap: true }` when `.planning/` is absent, otherwise `{ current, next, roadmapPath }`.
3. **`src/gsd/context.js`** — Builds the `additionalContext` block injected into `SessionStart`. String concatenation only.
4. **`labels.js` (modified)** — `parseKodoLabels` surfaces `'gsd'` in `flags` when `kodo:gsd` label present.
5. **`session/state.js` + `session/manager.js` (modified)** — `SessionRecord` gains optional `gsd: boolean`. Dispatcher sets it; hook reads it.
6. **`hooks/session-start.js` (modified)** — On `session.gsd === true`, call phase resolver and append GSD block to `additionalContext`.
7. **`orchestrator/prompt.md` (modified)** — GSD supervision section: load phase artifacts, inspect `VERIFICATION.md` before approving In Review.
8. **`cli.js` (modified)** — `kodo logs <session-id> [--follow] [--level] [--raw]`.

### Critical Pitfalls

1. **Phase resolver brittleness on non-canonical `ROADMAP.md`** — silent wrong-phase dispatch. Prevent via schema-version marker, tolerant heading matching, `kodo gsd inspect` dry-run, and fail-closed on zero/multiple matches.
2. **Per-repo concurrency collision on `.planning/`** — existing `task_id` lock does not protect two tasks mapped to the same repo. Add a second lock tier keyed by resolved repo path (realpath) with FIFO queuing; use a filesystem sentinel (`.planning/.kodo.lock`) so manual `claude` runs collide visibly.
3. **Context injection collision between Plane and GSD instructions** — Claude gets muddled dual lifecycle guidance. Declare precedence: GSD owns work lifecycle (commits, verification); Plane instructions own status transitions only. Branch the context template on `session.gsd`.
4. **Logger import breaking `kodo check` latency budget** — eager transport setup adds 50-200ms to the 0-token stop-hook path. Lazy-init `getLogger()`; consider a split `bin/kodo-check` entry; add a CI budget test (`time kodo check < 50ms`).
5. **Unbounded per-session log growth + secret leakage** — flat directory of thousands of files + raw webhook/stdio dumps with tokens. Date-partition `logs/YYYY-MM-DD/`, cap per-session size (50MB), prune on every webhook ingress. Allowlist structured fields; redact `*token*|*secret*|authorization|api_key`; never log raw webhook bodies or Claude stdio.

Secondary pitfalls that must also be addressed in-phase: GSD command drift (version-pin + startup existence check), missing log correlation (ULID propagated end-to-end), and Plane/ROADMAP state divergence (ROADMAP.md as single source of truth, reconcile-on-ingress).

## Implications for Roadmap

Based on research, two phases with clear dependencies. Logger is foundational for observability but GSD integration is the headline capability — they can be built in parallel tracks only if the logger's file-path contract (`sessionLogPath(id)`) is defined first.

### Phase 1: Structured Logging Foundation

**Rationale:** Logger is cross-cutting and foundational — every module touched by GSD work will adopt it. Shipping logging first means GSD integration is observable from its first commit, and pitfalls in GSD work surface in structured form. Also lets us land the `kodo check` latency safeguards before they can regress.
**Delivers:** `src/logger.js`, `kodo logs <id>` CLI, NDJSON per-session files at `~/.kodo/logs/YYYY-MM-DD/<session>.ndjson`, 4 levels, stderr mirror for warn/error, secret redaction, ULID correlation IDs, boot-budget test for `kodo check`, basic retention (size cap + age-based prune on ingress).
**Addresses:** All "Structured Logging" table-stakes from FEATURES.md + correlation ID differentiator.
**Uses:** Node 20 stdlib only — `fs/promises`, `fs.createWriteStream`, `fs.watch`, `perf_hooks`, `commander`. Zero new deps.
**Implements:** `logger.js`, `cli.js logs` subcommand, logger adoption across `server.js`, `hooks/stop.js`, `session/health.js`, `orchestrator/launch.js`, `triggers/webhook.js`, `config.js`.
**Avoids:** Pitfalls #4 (kodo check latency), #5 (log accumulation), #6 (event-loop-blocking writes), #7 (secret leakage), #9 (missing correlation).

### Phase 2: GSD Integration

**Rationale:** Depends on Phase 1's logger and correlation-ID contract for observability of the new code paths. GSD work touches dispatcher, session manager, hooks, and orchestrator — doing this with structured logs from line one means drift/collision pitfalls are detectable instead of mysterious.
**Delivers:** `kodo:gsd` label handling, `src/gsd/phase-resolver.js`, `src/gsd/context.js`, auto-bootstrap path, `SessionRecord.gsd` field, GSD `additionalContext` injection in `SessionStart`, orchestrator verification gate (`VERIFICATION.md` inspection), per-repo lock tier, GSD-mode context template (Plane "progress narration" stripped), end-of-session kodo-posted Plane summary, `kodo gsd inspect` dry-run command, GSD version/existence check at startup.
**Addresses:** All "GSD Integration" table-stakes + phase-aware orchestrator differentiator from FEATURES.md.
**Uses:** Hand-rolled regex roadmap parser; existing `SessionStart` hook plumbing; Node 20 realpath/filesystem lock.
**Implements:** `src/gsd/*`, `labels.js` update, `session/state.js` schema additive field, `session/manager.js` flag write, `hooks/session-start.js` branch, `orchestrator/prompt.md` GSD section, two-tier lock in `triggers/dispatcher.js`, reconciliation-on-ingress.
**Avoids:** Pitfalls #1 (resolver brittleness), #2 (per-repo collision), #3 (context injection collision), #8 (GSD command drift), #10 (Plane/ROADMAP divergence).

### Phase Ordering Rationale

- **Logger before GSD:** cross-cutting dep; adopting it mid-GSD-work means two migration passes. Also, GSD pitfalls (phase drift, context collision, lock races) are only observable with structured logs; shipping them blind would be reckless.
- **Correlation ID as Phase 1 concern (not Phase 2):** must exist at webhook ingress, which is orthogonal to GSD. Adding it later means old logs stay un-correlated forever.
- **Per-repo lock, version check, and reconciliation-on-ingress are Phase 2 hard requirements, not follow-ups:** all three are single-commit adds but have high blast radius if deferred (corrupted git state, silent outages, duplicate work).
- **Retention + budget tests ship with Phase 1, not as Phase 3 polish:** both are regression-prone; CI guards them from day one.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (GSD Integration):** `VERIFICATION.md` schema is not fully standardized across GSD phase templates. The orchestrator gate needs a sub-spec for what constitutes "passing" — run `/gsd:research-phase` or spike before implementation to nail down the checklist contract. Also: reconciliation-on-ingress semantics when ROADMAP.md and Plane state disagree need a decision record (default: ROADMAP.md wins, surface conflict as human-resolvable error).

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1 (Structured Logging):** Industry-converged patterns (NDJSON, pino-shaped API, ULID correlation, redact allowlist). STACK.md + PITFALLS.md already spell out the implementation sketch. Straight to planning.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `npm view` verified versions 2026-04-15; decision to reject all candidates is principled (single-dep philosophy); hand-rolled sketches already compile-shaped. |
| Features | MEDIUM-HIGH | Logging table-stakes are decades-converged industry patterns. GSD integration grounded in the existing GSD skill contract + current kodo dispatcher, but phase-resolver heuristics and bootstrap-trigger edge cases only real runs will validate. |
| Architecture | HIGH | Based on direct read of v0.2 codebase; all integration points verified against current module layout (`src/labels.js`, `src/hooks/session-start.js`, `src/triggers/dispatcher.js`, `src/cli.js`). Provider-agnostic invariant preserved by construction. |
| Pitfalls | HIGH | Rooted in kodo's own retrospective (v0.2 lock addition, `dab86bc` lifecycle refactor, `4278931` rate-limit cache). Integration gotchas (GSD command drift, ROADMAP divergence, concurrency) mapped directly to existing code paths. |

**Overall confidence:** HIGH

### Gaps to Address

- **`VERIFICATION.md` contract:** Current GSD templates vary in how verification is structured (checkbox list vs. prose + checklist). Orchestrator gate needs a formal spec before implementation. Handle via a short design spike at start of Phase 2, or a `/gsd:research-phase` run.
- **Per-repo lock semantics on crash:** Filesystem lock sentinel (`.planning/.kodo.lock`) must be recoverable on stale PID. Decide: TTL-based auto-release vs. explicit `kodo unlock` command. Plan during Phase 2 PLAN.md.
- **Phase inference heuristic:** Auto-inferring the phase from Plane task title is a "should-have" but the matching algorithm (exact / fuzzy / custom field) is unspecified. Ship MVP with strict ID-in-title convention; defer fuzzy matching until operator feedback says it's painful.
- **Retention policy constants:** Exact numbers (50MB cap, 7-day raw retention, 90-day rollup) are placeholders from PITFALLS.md. Validate against real v0.2 session volume before hardcoding; keep them config-surfaced.
- **GSD version-pin mechanism:** `~/.claude/get-shit-done/` has no stable version manifest today. Decision needed: check file existence only vs. require GSD to emit a `VERSION` file. Coordinate with GSD project.

## Sources

### Primary (HIGH confidence)
- Direct read of kodo v0.2 source: `src/labels.js`, `src/hooks/session-start.js`, `src/triggers/dispatcher.js`, `src/session/manager.js`, `src/cli.js`.
- kodo `.planning/PROJECT.md` + `RETROSPECTIVE.md` — v0.2 provider-abstraction milestone.
- Recent commits: `8e1bcd3` (in-memory lock), `dab86bc` (Claude session owns Plane lifecycle), `4278931` (rate-limit-driven caching), `8a2fde7` (In Review default), `3e403a8` (Plane API load reduction).
- `npm view pino/winston/pino-pretty/gray-matter version` — verified 2026-04-15.
- Node.js 20 LTS stdlib docs (`fs/promises`, `fs.watch`, `fs.createWriteStream`, `node:test`, `perf_hooks.monitorEventLoopDelay`).
- Claude Code hooks `SessionStart` `additionalContext` contract — existing usage in `src/hooks/session-start.js`.
- GSD skill surface at `~/.claude/get-shit-done/` — slash command filenames, `/gsd:new-project`, `/gsd:research-phase`, ROADMAP.md / VERIFICATION.md template conventions.

### Secondary (MEDIUM confidence)
- Industry logging conventions: pino, bunyan, Go `slog`, Rust `tracing` — all converge on leveled + structured + NDJSON.
- Webhook idempotency patterns: two-tier locking (resource-scoped), reconciliation-on-ingress.
- Competitor analysis: GitHub Copilot Workspaces, Devin, Aider — all self-declare "done" without artifact gates; kodo's GSD approach is the differentiator.

### Tertiary (LOW confidence — validate during implementation)
- Exact retention constants (50MB per-session cap, 7-day raw, 90-day rollup) — placeholders, tune against real v0.2 session volume.
- Phase-title fuzzy-matching heuristics — defer; ship strict exact-match MVP first.
- GSD `VERSION`/manifest mechanism — does not exist today; coordinate with GSD project before implementing the compatibility check.

---
*Research completed: 2026-04-15*
*Ready for roadmap: yes*
