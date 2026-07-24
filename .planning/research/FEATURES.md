# Feature Research

**Domain:** Global quick-capture inbox for a CLI/dev tool (kodo v0.19 — feature "Inbox de capturas global", backlog 999.2)
**Researched:** 2026-07-24
**Confidence:** HIGH (capture/inbox patterns are decades-established: org-capture, GTD, todo.txt, jrnl, Drafts/nvALT); MEDIUM on kodo-specific complexity/dependency mapping (derived from PROJECT.md)

## Context & Scope Guardrail

This is a **subsequent-milestone, single-feature** research pass. The inbox is explicitly "la única feature nueva: superficie aislada (comando + skill + fichero), bajo blast radius, sin dependencias duras" (PROJECT.md v0.19). Every feature below is judged against that guardrail: **does it stay within `kodo capture` (command) + `/kodo-capture` (skill) + `~/.kodo/inbox.md` (file), reusing `gsd-capture` for routing?** Anything that pulls in an HTTP endpoint, a scheduler, an NLP parser, or a second storage surface is an anti-feature by construction here.

The reference ecosystem — org-mode `org-capture`+refile, GTD ubiquitous-capture, `todo.txt`/`done.txt`, `jrnl`, Drafts/nvALT/Notational Velocity — converges on one shape: **capture is instantaneous and dumb; triage is a separate, deliberate, batchable step; nothing is ever destroyed, only transitioned.** kodo's backlog spec (append-only line `texto · tag-proyecto · fecha · origen`, mark `enrutada`/`descartada` never delete, routing delegated to `gsd-capture`) is already a faithful implementation of that shape. The job of this research is to confirm the baseline, flag where it can differentiate cheaply, and fence off the scope-creep magnets.

## Feature Landscape

### Table Stakes (Users Expect These)

Features every quick-capture inbox has. Missing these and it is not a capture inbox — it is a note file.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One-shot zero-friction capture (`kodo capture "idea"`) | The entire value of a capture buffer is "thought → text in <2s, no prompts, no required fields, return to work". org-capture's design goal is "reduce friction of thought to text to essentially zero". Any prompt kills it. | LOW | Single positional arg, no interactive flow, no confirmation. Fail-open: capture must never block the shell or throw in the user's face. |
| Append-only single global file (`~/.kodo/inbox.md`) | GTD's cardinal rule: **one** trusted inbox. Multiple inboxes = things fall through cracks. Plain-text single file = greppable, editable, portable, zero lock-in (todo.txt/jrnl ethos). | LOW | `~/.kodo/` is already home to `plans/`, `config.json`, `.env`. Markdown so `kodo inbox` and a human editor read the same bytes. |
| Atomic append under concurrency | kodo captures fire from any project shell AND mid-session hooks simultaneously. Two concurrent appends must not interleave/corrupt a line or lose a capture. | MEDIUM | kodo already owns this primitive: `writeFileAtomic` (temp+rename, v0.14) and `withFileLock`/`withStateLock` (v0.16/v0.17). Append is RMW-under-lock or `O_APPEND` write; both are in-house patterns. Do NOT hand-roll a new locking scheme. |
| Auto-captured metadata (`texto · tag-proyecto · fecha · origen`) | Context that must be typed is context that won't be — the capture loses its "where did this come from" the moment you leave the shell. Every serious capture tool timestamps and tags automatically (jrnl timestamps, org `%U`, todo.txt creation date). | LOW–MEDIUM | Project tag derived from cwd→project mapping (kodo already resolves this via `projects.json`/`listProjects`). Date from `date`. Origin = `cli` vs `session`. Zero manual entry is the whole point. |
| List open captures (`kodo inbox`) | You cannot triage what you cannot see. The inbox must be reviewable in one command; the open-count is what nags you to process it (GTD "process to zero"). | LOW | Read + parse the markdown, show open items with index. Read-only path — mirror the read-leaf discipline of the TUI overlays (never-throws, no new endpoint). |
| Mark item routed/discarded **without deleting** (`enrutada`/`descartada`) | Preserving a trace of "what became what" is the auditability that separates an inbox from a scratchpad. todo.txt marks `x` and moves to `done.txt` rather than deleting; org refiles out but keeps the node. Deletion loses the decision history. | LOW–MEDIUM | State transition in-place (annotate the line) or move to a `## Resuelta` section — either way the line survives. This is explicitly in kodo's spec ("sin borrar"). |
| Item lifecycle: `open → {enrutada \| descartada}` | A capture inbox needs exactly enough states to answer "is this still pending?" Two terminal states (routed somewhere / consciously dropped) is the minimum that lets you process to zero honestly. | LOW | Match todo.txt (open→done) / org (TODO→DONE\|refiled). Do NOT add intermediate states (in-progress, blocked, snoozed) — that is task-manager territory, and kodo already has Plane for that. |
| Mid-session capture with context (`/kodo-capture`) | The highest-value captures happen *while working* ("I should fix X later") — forcing a context switch to a shell loses them. org-capture's superpower is capturing from anywhere without leaving the current buffer. | MEDIUM | Skill derives project/task from session context (session-start.js already injects `KODO_DIR`, project, task_id). Must write the **byte-identical format** as `kodo capture` (shared writer, not a parallel implementation). |

### Differentiators (Competitive Advantage)

Features that make kodo's inbox better than a generic todo.txt, aligned with kodo's Core Value (reuse existing plumbing, provider-agnostic, deterministic).

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Automatic origin/context derivation (project + session task) | Generic CLI inboxes make you type context (`todo.sh add "fix bug +kodo @work"`). kodo already *knows* the project (cwd map) and the task (session hook) — it fills `tag-proyecto`/`origen` for free. Single biggest ergonomic edge and it costs almost nothing because the wiring exists. | LOW (CLI) / MEDIUM (session) | Reuses `projects.json` resolution and session-start context injection. The differentiator is "you never tag anything, it's already tagged." |
| Routing delegated to `gsd-capture` (not reimplemented) | The triage destinations (Plane task / roadmap phase / config / discard) already exist and are tested in `gsd-capture` (CAPT-01..04). kodo's inbox becomes a *buffer that feeds an existing router* instead of a second routing engine. Less code, one source of truth, consistent with kodo's "una fontanería, N consumidores" pattern. | LOW (integration) | The inbox owns capture + list + mark; `gsd-capture` owns "where does it go". `kodo inbox` marking `enrutada` is the join. This is the architectural differentiator — most inbox tools bake routing in. |
| Trace of "what became what" | Because items transition rather than delete, a routed capture can carry a pointer to its destination (Plane task id / phase). GTD-grade auditability that plain todo.txt/done.txt doesn't give (done.txt records completion, not the outcome linkage). | MEDIUM | Optional annotation on the routed line (e.g. `→ ROMAN-153`). Cheap if `gsd-capture` returns the destination ref; skip if it doesn't (don't force it). |
| Human-editable plain markdown | The inbox is a `.md` a human can open, hand-edit, grep, or fix when kodo's parser disagrees. Same lock-in-free ethos as todo.txt/org/jrnl. Reduces the blast radius of any bug — worst case, the user edits the file. | LOW (free consequence of format choice) | Format must be forgiving on read (tolerate hand-edits, blank lines, reordering) — parse defensively, never assume kodo wrote every byte. |
| Stale-inbox surfacing (nudge) | The #1 reason inboxes rot is invisibility. A count surfaced where the operator already looks (dashboard TUI, or a one-line nudge) turns "process to zero" from discipline into a visible signal. kodo already has a nudge/dashboard surface. | MEDIUM | **Differentiator, not table stakes — defer past v1.** Reuses the dashboard/nudge pattern (v0.17 LIVE-04/05). Only worth it once capture+list+mark is proven in real use. Risk: over-nudging is annoying. |

### Anti-Features (Commonly Requested, Often Problematic)

These are the scope-creep magnets. Each one individually seems reasonable and each one breaks the "comando + skill + fichero, bajo blast radius" guardrail.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Natural-language parsing (dates, priorities, assignees) à la Todoist quick-add | "Capture `fix X tomorrow !p1`" feels smart. | Parsing ambiguity, locale bugs, a whole grammar to maintain, and it slows capture (you second-guess syntax). kodo doesn't schedule — Plane does. It's an NLP dependency in a tool whose value is determinism. | Capture raw text. Structure/priority/date get assigned **at routing time**, by `gsd-capture` into Plane, where those fields actually live. |
| Auto-routing / AI triage at capture time | "Just file it in the right place automatically." | Kills capture speed (capture now blocks on a decision), removes the human triage step GTD is built on, and burns tokens on every capture. The maintainer's own pattern (v0.16/v0.18 doctor) is "0 tokens, deterministic, LLM decides nothing" for the mechanical rail. | Capture is dumb and instant. Triage is a **separate, deliberate** `kodo inbox` step that delegates to `gsd-capture`. Two phases, never fused. |
| Multiple inboxes / folders / sub-categories | "Separate work vs personal vs project inboxes." | Directly violates GTD's one-trusted-inbox rule — the moment there are N inboxes, capture requires choosing one (friction) and items rot in the ones you don't check. | One `inbox.md`. The `tag-proyecto` field gives per-project *views* (`kodo inbox --project X`) without splitting storage. |
| In-place rich editing / full TUI editor for captures | "Let me edit the capture text in the inbox." | Pulls the v0.14 ink text-input editor into a surface meant to be capture-and-triage. Balloons the feature past "list + mark". A capture is a fleeting note — if it needs editing it should be routed to where editing belongs (Plane). | Read + mark only. To fix text, the user edits the plain `.md` directly (the human-editable differentiator covers this). |
| Sync / server endpoint / remote inbox | "Access my inbox from another machine / the daemon." | Adds an HTTP endpoint — breaks kodo's standing invariant "cero endpoints nuevos" (held since v0.10) and the local-file security model. Also a concurrency/auth surface for a feature whose whole appeal is a local file. | Local file only. `~/.kodo/` is already the sync boundary if the user wants to sync it (git, Syncthing). kodo doesn't own transport. |
| Reminders / due dates / notifications on captures | "Remind me about this capture." | Turns a capture buffer into a task manager with a scheduler — the exact thing Plane already is. Scope explosion (timers, notification delivery, snooze states). | Route the capture into Plane, which owns scheduling/reminders. The inbox's job ends at "routed". |
| Hard delete of captures | "Clean up junk captures." | Loses the "what became what" trace; `descartada` already exists to consciously drop something *while keeping the record* (todo.txt/done.txt never-delete ethos). Delete is indistinguishable from data loss on a bug. | `descartada` state. If the file genuinely needs pruning, that's a manual/archival concern on a plain `.md`, not a product feature. |
| Query language / tags / saved searches | "Filter captures by tag/status like todo.txt." | A healthy inbox is *small and processed to zero* — if it's big enough to need a query engine, it's rotting, and the fix is triage, not search. Building `String.includes` filters is fine; a grammar is over-build. | Minimal filter at most (`--project`, `--open`), `String.includes` not regex (anti-ReDoS, matching kodo's existing filter discipline). Beyond that, `grep ~/.kodo/inbox.md`. |
| Naming/behavioral overlap with `gsd-inbox` | `gsd-inbox` already exists as a skill. | `gsd-inbox` triages **GitHub issues/PRs against contribution guidelines** — a completely different thing from a personal capture buffer. Conflating them (or reusing the name) confuses users and invites wrong wiring. | Keep `kodo inbox` (capture triage) distinct from `gsd-inbox` (GH issue triage). Note the collision explicitly in docs. Routing reuse is with **`gsd-capture`**, not `gsd-inbox`. |

## Feature Dependencies

```
[Atomic append primitive]  (writeFileAtomic / withFileLock — ALREADY EXISTS)
    └──enables──> [kodo capture "idea"]  (CLI writer)
                       └──shares format──> [/kodo-capture]  (session-context writer)
                       └──produces──> [~/.kodo/inbox.md]  (single global file)
                                          └──read by──> [kodo inbox list]
                                                            └──mark──> [enrutada | descartada]
                                                                          └──enrutada delegates──> [gsd-capture routing]  (CAPT-01..04, ALREADY EXISTS)

[Project resolution (projects.json / cwd map)]  ──feeds──> tag-proyecto in capture
[Session context (session-start.js: project, task_id, KODO_DIR)]  ──feeds──> /kodo-capture origin/tag
[Dashboard/nudge surface (v0.17)]  ──enhances (defer)──> stale-inbox count

[kodo inbox]  ──must-not-collide──> [gsd-inbox]  (different domain: GH issues)
[capture-time routing]  ──conflicts──> [zero-friction capture]  (fusing them breaks both)
```

### Dependency Notes

- **`kodo capture` requires the atomic append primitive:** concurrent captures from multiple shells + hooks must not corrupt the file. kodo already ships `writeFileAtomic` (v0.14) and `withFileLock`/`withStateLock` (v0.16/v0.17) — the correct build is "reuse", not "new locking scheme". This is the one MEDIUM-complexity item that is genuinely load-bearing.
- **`/kodo-capture` shares the writer with `kodo capture`:** both must emit the byte-identical `texto · tag-proyecto · fecha · origen` line. Same failure mode as every kodo producer↔consumer seam — verify byte-identical format with a test. The skill's only extra job is deriving project/task from session context (wiring that already exists in session-start.js).
- **`enrutada` delegates to `gsd-capture`, does not reimplement it:** the marking step is the join point. `kodo inbox` owns the buffer lifecycle; `gsd-capture` owns destination logic. This is a soft dependency — if `gsd-capture` is unavailable, marking `enrutada` can still succeed as a pure state transition (fail-open); the routing is the LLM-assisted consumer.
- **Zero-friction capture conflicts with capture-time routing/parsing:** mutually exclusive by design. The GTD/org/todo.txt consensus is that capture and triage are *separate acts*. Fusing them (auto-route, NLP-parse-on-capture) breaks capture speed AND removes the human triage loop that keeps the inbox honest.
- **`kodo inbox` must not collide with `gsd-inbox`:** different domains (capture buffer vs GitHub issue triage). Dependency is "avoid confusion", surfaced in naming/docs.

## What Makes an Inbox NOT Rot (design principles, cross-tool consensus)

Durable findings from org/GTD/todo.txt/jrnl — these should shape acceptance criteria, not just the feature list:

1. **Capture and triage are separate steps.** Never make capture wait on a filing decision. (org: capture to inbox now, refile in the evening batch.)
2. **Processable to zero.** The inbox must be *emptyable* — every item has two terminal exits (routed / discarded). An inbox you can't empty is a graveyard.
3. **Visible open-count nags.** Invisibility is the #1 rot cause. Surface the pending count where the operator already looks (kodo differentiator, deferrable).
4. **Batch triage is fine; per-item triage is not required.** `kodo inbox` should let you rip through many items in one sitting.
5. **Nothing is destroyed, only transitioned.** Trace of "what became what" builds the trust that lets the user offload their brain (todo.txt done.txt; org keeps the node).
6. **Low enough friction that it's the reflex.** If capturing is slower than remembering, users won't use it. One command, one arg, no prompts.

## MVP Definition

### Launch With (v1) — the backlog 999.2 baseline, confirmed minimal

- [ ] `kodo capture "idea"` — one-shot append, auto metadata, atomic, fail-open. *The core; without instant capture nothing else matters.*
- [ ] `~/.kodo/inbox.md` append-only single file, human-editable markdown. *The single trusted store.*
- [ ] Auto-derived `texto · tag-proyecto · fecha · origen`. *Context that isn't auto-captured is lost — non-negotiable.*
- [ ] `kodo inbox` list open captures. *Can't process what you can't see.*
- [ ] Mark `enrutada` / `descartada` without deleting. *The trace / process-to-zero mechanism.*
- [ ] `/kodo-capture` mid-session capture, byte-identical format, context-derived. *Highest-value captures happen while working.*
- [ ] `enrutada` delegates routing to `gsd-capture`. *Reuse, don't reimplement destinations.*

### Add After Validation (v1.x)

- [ ] Stale-inbox count surfaced in dashboard/nudge — *trigger: real use shows captures accumulating unprocessed.*
- [ ] `→ destination` pointer on routed lines (Plane id / phase) — *trigger: `gsd-capture` returns a usable destination ref cheaply.*
- [ ] Minimal `--project` / `--open` filter (`String.includes`) — *trigger: a single global inbox gets busy enough that per-project views help; not before.*

### Future Consideration (v2+) — only if real friction demands it

- [ ] Archival/rotation of an old `inbox.md` — *defer: a healthy inbox stays small; premature.*
- [ ] Cross-machine access — *defer indefinitely: violates local-file / cero-endpoints invariant; user syncs `~/.kodo/` themselves if needed.*

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `kodo capture` one-shot append + auto metadata | HIGH | LOW | P1 |
| Atomic append under concurrency | HIGH | MEDIUM | P1 |
| `~/.kodo/inbox.md` single markdown file | HIGH | LOW | P1 |
| `kodo inbox` list open | HIGH | LOW | P1 |
| Mark `enrutada`/`descartada` (never delete) | HIGH | LOW–MEDIUM | P1 |
| `/kodo-capture` session-context capture | HIGH | MEDIUM | P1 |
| Route via `gsd-capture` (delegated) | HIGH | LOW | P1 |
| Auto origin/context derivation | MEDIUM | LOW | P1 (nearly free) |
| Stale-inbox surfacing (nudge/dashboard) | MEDIUM | MEDIUM | P2 |
| `→ destination` trace pointer | MEDIUM | MEDIUM | P2 |
| Minimal `--project`/`--open` filter | LOW–MEDIUM | LOW | P2 |
| NLP parse / auto-route / reminders / sync / multi-inbox | LOW (net-negative) | HIGH | P3 (anti-feature — do not build) |

**Priority key:**
- P1: Must have for launch (this is the backlog 999.2 spec — confirmed minimal, none droppable)
- P2: Should have, add when real use justifies
- P3: Explicitly out — documented anti-features

## Competitor / Prior-Art Feature Analysis

| Feature | org-capture + refile | todo.txt / done.txt | jrnl | kodo's approach |
|---------|----------------------|---------------------|------|-----------------|
| Zero-friction capture | Global hotkey `C-c c` → template | `todo.sh add "…"` | `jrnl idea …` | `kodo capture "idea"` (CLI) + `/kodo-capture` (mid-session) |
| Storage | `inbox.org` (single) | `todo.txt` (single) | single journal file | `~/.kodo/inbox.md` (single, markdown) |
| Auto metadata | `%U` timestamp, tags | creation date, `+proj @ctx` (manual) | timestamp, `@tags` | `fecha` + auto `tag-proyecto` + `origen` (**derived, not typed** — kodo edge) |
| Triage step | refile `C-c C-w` to project files | `do` → `archive` to done.txt | edit/tag | `kodo inbox` → `enrutada`/`descartada`, routing via `gsd-capture` |
| Never delete | node preserved on refile | mark `x`, move to done.txt | append-only log | `enrutada`/`descartada` in-place, line survives |
| Routing engine | manual, into org files | none (flat) | none | **delegated to existing `gsd-capture`** (kodo edge) |
| Anti-rot | daily process-to-zero habit | visible list | — | (defer) stale count in dashboard/nudge |

kodo's genuine edges over the prior art: (1) **context is auto-derived** rather than hand-tagged, because kodo already knows the project and session task; (2) **routing is a reused, already-tested engine** (`gsd-capture`) rather than absent (todo.txt/jrnl) or manual (org). Everything else faithfully matches a proven design — the right call for a low-blast-radius feature.

## Sources

- [Org-mode Workflow Part 1: Capturing in the Inbox — Jethro Kuan](https://blog.jethro.dev/posts/capturing_inbox/) — zero-friction capture principle, capture-to-inbox default (HIGH)
- [Org-mode Workflow Part 2: Processing the Inbox — Jethro Kuan](https://blog.jethro.dev/posts/processing_inbox/) — process-to-zero, refile as separate batch step, inbox = trust (HIGH)
- [The Beautiful Simplicity of Org Mode — Joshua Blais](https://joshblais.com/blog/org-mode-beautiful-simplicity/) — "reduce friction of thought to text to essentially zero" (HIGH)
- [todo.txt-cli Usage / USAGE.md — GitHub](https://github.com/todotxt/todo.txt-cli/blob/master/USAGE.md) — `do`/`archive` convention, mark-done-not-delete (HIGH)
- [Plaintext Productivity: Todo.txt and Done.txt](https://plaintext-productivity.net/1-05-accountability-todo-txt-and-done-txt.html) — never-delete / preserve-record ethos (HIGH)
- [org-gtd.el — GitHub](https://github.com/Trevoke/org-gtd.el) and [emacs-gtd — rougier](https://github.com/rougier/emacs-gtd) — GTD single-inbox + clarify/organize model (HIGH)
- kodo `.planning/PROJECT.md` (v0.19 milestone, backlog 999.2, existing `writeFileAtomic`/`withFileLock`/`gsd-capture`/session-start context) — kodo-specific complexity and dependency mapping (MEDIUM)

---
*Feature research for: global quick-capture inbox in a CLI/dev tool (kodo)*
*Researched: 2026-07-24*
