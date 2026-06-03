# Feature Research

**Domain:** Developer CLI tooling — session/task lifecycle hygiene + cross-system task-state normalization (Node.js CLI bridging task managers ↔ Claude Code sessions)
**Researched:** 2026-06-03
**Confidence:** HIGH (provider-state mapping & doctor conventions verified against primary sources; TUI destructive-action conventions MEDIUM — UX-guidance sources, no single authoritative TUI spec)

> Scope: research for kodo v0.10 — three features. (1) `kodo gsd doctor` (saneo), (2) dismiss desde el dashboard (TUI read-write), (3) `provider_state` cross-system normalization (HIGHEST value — most effort here). Existing v0.9 dashboard features are NOT re-researched.

---

## Feature 3 — `provider_state` cross-system normalization (PRIORITARIO)

### The single most important finding

**Every major task system converges on the SAME small, fixed set of state *categories* — and NONE of them has "review" or "blocked" as a native category.** They are always *custom states* that live inside the "in progress / started" bucket.

| System | Fixed category set | Source | "Review" native? | "Blocked" native? |
|--------|-------------------|--------|------------------|-------------------|
| **Jira** | `To Do` · `In Progress` · `Done` (exactly 3, names/colors NOT customizable) | [Jira statusCategory REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-status-categories/) | No — custom status inside `In Progress` | No — custom status inside `In Progress` |
| **Linear** | `triage` · `backlog` · `unstarted` · `started` · `completed` · `canceled` (fixed *types*; custom statuses map to one type) | [Linear workflows docs](https://linear.app/docs/configuring-workflows) | No — custom status of type `started` | No — custom status of type `started` |
| **Plane** (kodo's primary adapter) | `Backlog` · `Unstarted` · `Started` · `Completed` · `Cancelled` (5 fixed groups, cannot be customized; custom *names* allowed within a group) | [Plane workflow states docs](https://docs.plane.so/core-concepts/issues/states) | No — "In Review" is a custom state in the `Started` group | No |

**Implication for kodo:** the proposed vocabulary `in_progress | in_review | blocked | done | unknown` is *richer* than what any upstream provider exposes as a first-class category. "In Review" and "Blocked" only exist as **named states inside the started/in-progress bucket**. kodo cannot read them from a category field — it must match on the **state *name* string** (Plane) or **derive them by convention** (GitHub). This is exactly the coupling pitfall the todo flagged ("si el nombre de los estados cambia en Plane, kodo se rompe").

### How real tools normalize cross-system (the pattern to copy)

The robust pattern across Linear↔Jira, GAIA, Capybara and similar bridges:

1. **Map by category/type, not by raw name** where a category field exists. Jira→Linear maps via the 3-bucket `statusCategory`, not the literal status string. ([Linear Jira docs](https://linear.app/docs/jira))
2. **Fall back, never crash, on unmapped states.** Linear's documented behavior: a Jira status with no Linear mapping → the issue **does not update** (keeps last good), or new issues land in **Triage** (a neutral default). It never errors. ([Linear Jira docs](https://linear.app/docs/jira)) — This is precisely kodo's `unknown` + fail-open requirement.
3. **Allow per-workspace name overrides.** Because "In Review"/"Blocked" are custom names, mature integrations let the user remap names → buckets. kodo's equivalent: a small per-provider name→normalized lookup table that's easy to extend, with `unknown` as the default for anything unrecognized.

### RECOMMENDED normalized vocabulary

**Keep the proposed 5 values — they are correct and sufficient. Add nothing speculative.**

`in_progress | in_review | blocked | done | unknown`

Rationale per value:

| Value | Keep? | Why |
|-------|-------|-----|
| `in_progress` | ✅ | Maps cleanly to Jira `In Progress` / Linear `started` / Plane `Started`. The default "session is doing work" state. |
| `in_review` | ✅ | The **driver of the whole feature** (ROMAN-150). Not a native category anywhere, but it's the one signal kodo most needs to surface (work awaiting human merge/review that would otherwise vanish on `/exit`). |
| `blocked` | ✅ (keep, low cost) | Common custom state; cheap to map by name. Genuinely actionable in a dashboard ("this needs you"). Low risk because it's purely additive and falls through to `unknown` if absent. |
| `done` | ✅ | Maps to Jira `Done` / Linear `completed` / Plane `Completed`. Note: semantic overlap with kodo's internal `status==='done'` — see Pitfall below. |
| `unknown` | ✅ **(mandatory)** | The fail-open sink. Required for (a) provider API failure/timeout, (b) any state name the lookup doesn't recognize, (c) GitHub where review can't be derived. Without this the feature is brittle. |

**Do NOT add** (anti-vocabulary — see Anti-Features): `backlog`, `todo`, `unstarted`, `triage`, `cancelled`/`canceled`, `closed`, `paused`, `archived`. A kodo session only exists because work is *active*; backlog/triage states are pre-session and irrelevant to a live-session dashboard. `cancelled`/`closed` collapse into `done` for dashboard purposes (the session is over). Adding them is speculative richness that increases the mapping surface for no dashboard value.

**One value worth considering but recommend deferring:** distinguishing `done` (provider says complete) from `closed`/`cancelled` (provider says won't-do). For a *hygiene* dashboard both mean "session no longer needs attention" → fold into `done`. Revisit only if a real driver appears.

### Plane mapping (primary adapter — straightforward)

Map on the **state group** when the Plane API exposes it (`group ∈ {backlog, unstarted, started, completed, cancelled}`), then refine `started` by **name match** for the two custom states:

```
group=completed | cancelled        → done
group=started AND name ~ "review"  → in_review     (case-insensitive substring)
group=started AND name ~ "block"   → blocked
group=started (otherwise)          → in_progress
group=unstarted | backlog          → in_progress   (session is live → treat as working)
anything else / fetch fails        → unknown
```

Keep the name-match table tiny, case-insensitive, substring-based (reuse the anti-ReDoS `String.includes` discipline already enforced in the dashboard filter layer). Document that custom Plane state names must contain "review"/"block" to be recognized, else they degrade to `in_progress` (not an error).

### GitHub Issues mapping — CRITICAL (no native review)

GitHub Issues has only `open` / `closed`. There is **no review concept**. Three options to derive `in_review`:

| Option | How | Pros | Cons | API cost |
|--------|-----|------|------|----------|
| **(i) Label convention** | Read issue labels; `awaiting-review` / `in-review` / `needs-review` → `in_review`; `blocked` label → `blocked`; else open→`in_progress`, closed→`done` | Simplest; labels already fetched in the existing `normalizeIssue` payload (**zero extra API calls**); mirrors kodo's own `kodo:gsd` label convention; user-controllable; deterministic | Requires the user/agent to apply the label (won't fire for the exact ROMAN-150 "agent moved it via MCP" pattern unless the agent also labels); convention must be documented | **0 extra** (labels are on the issue) |
| **(ii) Issue→PR link, read PR review state** | Find PR that closes the issue (closing-keyword link), read its review/merge state | Most "accurate" if a PR exists; reflects real review status | **No clean API** to list issues↔PRs — requires the Timeline events API (fragile, undocumented-shape, paginated) → N+1+ calls per session per poll; PR may not exist yet at the moment review is needed; closing-keyword links only count against the default branch; high coupling | **HIGH** (Timeline API + PR fetch, multiple calls) — see [GitHub community discussion #179613](https://github.com/orgs/community/discussions/179613) confirming no clean endpoint |
| **(iii) open/closed only** | open→`in_progress`, closed→`done`, never `in_review`/`blocked` | Trivial; truthful to what GitHub natively models; zero new failure modes | Doesn't solve the driver at all for GitHub — no review signal | **0 extra** |

**RECOMMENDATION: Option (i) — label convention — as the primary path, with (iii) open/closed as the fallback when no recognized label is present.**

Concrete GitHub mapping:

```
issue.state = closed                                  → done
issue.labels contains "review" (substring, ci)        → in_review
issue.labels contains "block"  (substring, ci)        → blocked
issue.state = open (otherwise)                         → in_progress
fetch fails / shape bad                                → unknown
```

Why (i) over (ii):
- **Cost & robustness.** Labels ride on the issue payload kodo already normalizes (`normalizeIssue`). Zero extra API calls, no Timeline-API fragility, no N+1 explosion on every poll. The todo explicitly flags N+1 as a predictable pitfall and mandates caching — (i) sidesteps it entirely for GitHub.
- **Consistency with kodo's own design.** kodo already uses labels (`kodo:gsd`, `kodo:gsd-quick`, `kodo:gsd-child`) as its cross-provider trigger mechanism, and PROJECT.md records "Labels como mecanismo cross-provider" as a ✓ Good key decision. A review label is idiomatic to the existing architecture.
- **(ii) doesn't even reliably solve the driver.** The ROMAN-150 case is "agent moves task to In Review bypassing verify." On GitHub the analog is the agent applying a label or opening a PR — but the PR-link path requires the PR to already exist *and* be discoverable via Timeline, which won't hold mid-work. A label is the lighter, more reliable contract.

Document the recognized label substrings (`review`, `block`) and note that GitHub `in_review` is **convention-driven, not automatic** — this honesty is a feature, not a gap.

### Server `/status` enrichment — table stakes for this feature

Per the todo, all MEDIUM-complexity but non-negotiable for correctness:

- **Fail-open per row.** A failed/timed-out `getTaskState(task_id)` omits `provider_state` for that row only; never throws, never blocks the endpoint, never breaks the poll. (Mirrors the v0.9 `fetchStatus` never-throws invariant.)
- **Cache with TTL.** N active sessions × every poll = Plane/GitHub API exhaustion risk. Reuse the existing `pendingCache` TTL pattern (5–30s). Mandatory, not optional.
- **Concurrency cap.** Serial is fine for typical N<10; if it grows, `Promise.allSettled` with a concurrency cap. Don't build this until N demands it (anti-feature: premature batching).
- **Structured failure logging.** Emit `provider.state.fetch.failed` (NDJSON) so silent fail-open doesn't hide an hours-long provider outage. If *all* calls fail, degrade a header banner (like the v0.9 `server caído` banner) rather than silently showing everything as `unknown`.

---

## Feature 1 — `kodo gsd doctor`

### What real `doctor` tools do (verified conventions)

| Tool | Reports? | Fixes? | Exit code on problems | Dry-run | Notes | Source |
|------|----------|--------|----------------------|---------|-------|--------|
| `brew doctor` | Yes | **No — report only** | **Non-zero** | n/a (never mutates) | Diagnostics only; mutation lives in a *separate* `brew cleanup` | [brew Manpage](https://docs.brew.sh/Manpage) |
| `brew cleanup` | Yes | Yes (removes stale locks, old downloads, old versions) | — | **`-n, --dry-run`** shows what would be removed | The mutating half is a distinct command with explicit dry-run | [brew Manpage](https://docs.brew.sh/Manpage) |
| `flutter doctor` | Yes, **grouped by category** with ✓/✗ per check; `-v` verbose | No (points you to fixes) | reports status per category | n/a | Category-per-line output is the recognizable UX | [Flutter troubleshoot](https://docs.flutter.dev/install/troubleshoot) |
| `npm doctor` | Yes | No | **Always 0 even on errors — widely considered a BUG** | n/a | Explicitly the anti-pattern to avoid | [npm/cli#1226](https://github.com/npm/cli/issues/1226), [npm-doctor docs](https://docs.npmjs.com/cli/v11/commands/npm-doctor/) |
| `git worktree prune` | Yes (`-v`) | Yes (removes orphaned admin entries) | — | **`--dry-run`** (`-n`) + `-v` | Never prunes *locked* worktrees; relevant directly to kodo's worktree saneo | [git-worktree docs](https://git-scm.com/docs/git-worktree) |
| `git fsck` | Yes | No (reports dangling/corrupt objects) | non-zero on corruption | n/a | Pure integrity check | [git docs] |

**The dominant industry split:** `doctor` = **report-only, exit non-zero if problems found**; a *separate verb* (`cleanup`/`prune`/`gc`) does the mutation and *that* one carries `--dry-run`. kodo's design ("dry-run por defecto + `--fix`") collapses both into one command — which is fine and arguably more ergonomic for a personal tool, **but only if the dry-run-by-default + explicit-`--fix` discipline is rigorous** (the opposite failure of `npm doctor`).

### Recommended conventions for `kodo gsd doctor`

| Convention | Recommendation | Source-backed rationale |
|-----------|----------------|------------------------|
| Default behavior | **Dry-run / report-only** (list what *would* be cleaned, mutate nothing) | `brew cleanup -n`, `git worktree prune --dry-run` — safe-by-default is universal for cleanup tooling |
| Mutation | Behind explicit **`--fix`** flag | Matches the report/mutate split; opposite of accidental destruction |
| Output | **Grouped by category** (worktrees huérfanos · sesiones zombie · locks colgados · logs antiguos), ✓/✗ per item | `flutter doctor`'s category-per-line is the recognizable, scannable convention |
| Exit codes | **0 = clean, 1 = problems found** (and in `--fix` mode, 1 only if something couldn't be fixed). Reserve 2+ for usage/config errors per kodo's existing exit-code discipline (D-19, Pitfall #6) | Avoid the `npm doctor` bug (exit 0 on errors). kodo already has deterministic exit codes as a project invariant |
| Confirmation in `--fix` | For a personal tool, `--fix` itself is the consent. **Don't** add interactive y/N per item (friction); DO support `--fix --dry-run` as an explicit preview alias if desired. A `--yes` is unnecessary noise here | Personal-tool ergonomics; interactive prompts fight scripting/automation |
| Liveness checks | Worktrees: never touch *locked* ones, only orphaned/prunable (`git worktree list` reports `prunable`/`locked`); locks: PID-liveness + TTL (kodo already has this in GSD-10); zombies: `alive===false` from the v3 reconcile (single source of truth, don't recompute) | [git-worktree prune docs](https://git-scm.com/docs/git-worktree); reuse v0.9 `reconcileTick` as the only `alive` writer |
| `--json` | Emit byte-deterministic JSON report (kodo `--json` invariant) | Existing project constraint |

### Doctor categories (the 4 from the milestone)

| Category | Detect | Fix (`--fix`) | Complexity | Reuse |
|----------|--------|---------------|------------|-------|
| Worktrees huérfanos | `git worktree list` prunable + `.bg-shell/<id>` dirs with no live session | `git worktree prune` / remove (respect `.dirty` rename + locked) | MEDIUM | v0.6 worktree cleanup logic (`stop.js` already does `git worktree remove --force` + `.dirty` rename — extract/share) |
| Sesiones zombie (`alive===false`) | Read `alive` from v3 state (single source) | `removeSession` + emit terminal NDJSON | LOW | **This is the exact logic `d`/dismiss reuses** — extract a shared `dismissSession`/`reapZombie` helper |
| Locks per-repo colgados | PID dead OR TTL expired | release lock file | LOW | GSD-10 lock already has PID+TTL liveness |
| Logs NDJSON antiguos | mtime older than retention (e.g. >7d, matching existing polling-log 7d retention) | delete old files | LOW | Polling daemon already does 7-day retention — align the threshold |

---

## Feature 2 — Dismiss desde el dashboard (TUI read-write)

### Destructive-action conventions in a TUI (MEDIUM confidence)

General UX guidance (no single TUI spec, synthesized from UX sources + common TUI idioms):

- **Friction proportional to reversibility.** If the action is irreversible → confirm. If easily undone → a lightweight "undo" affordance is enough. ([UX guide to destructive actions](https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03))
- **Reinforce the target in the confirmation**, avoid vague yes/no. ([Indie Hackers destructive-action tip](https://www.indiehackers.com/post/ux-tip-how-to-design-destructive-actions-e-g-delete-turn-off-74d17fdc28))
- **Vim-style double-keystroke** (`dd`, "press again to confirm") is the idiomatic *terminal* confirmation — low friction, no modal, keyboard-only. (MEDIUM — common idiom; not in a formal spec.)

### Recommendation for `d` (dismiss)

| Aspect | Recommendation | Rationale |
|--------|----------------|-----------|
| Guard | **Inverse of Enter**: `d` only acts on `alive===false` rows; on `alive===true` → footer error, no-op | Already the stated design; mirrors the v0.9 Enter guard (TUI-13). Dismissing a *live* session would be the real footgun |
| Confirmation | **Inline footer confirm** — first `d` shows `dismiss <task_id>? (d again / Esc)`, second `d` executes, `Esc` cancels | How destructive vs. reversible: dismissing a *dead* session is low-stakes (it's already over; `DELETE /sessions/{id}` removes a record, not real work) → a single inline confirm is proportional, no modal needed |
| Reused logic | Calls the **same `dismissSession` helper as doctor's zombie reap** | Milestone requirement: "reusa la lógica de doctor". Single code path = consistent behavior + one place to test |
| Feedback | Footer success line (`dismissed <task_id>`) + row disappears on next poll (the table already reconciles by `task_id` identity) | Reuses v0.9 selection-by-identity + footer-error plumbing from Phase 37 |
| Undo | **None for v0.10** | The record is for a dead session; `DELETE /sessions/{id}` exists and is the intended terminal op. Undo would mean resurrecting state — over-engineering for the value |

---

## Feature Dependencies

```
[provider_state: getTaskState in TaskProvider contract (9→10 methods)]
    └──requires──> [Plane + GitHub adapter mappings]
    └──requires──> [/status enrichment: fail-open + TTL cache]
                       └──enables──> [dashboard render (column/badge/color)]
                       └──enables──> [filter semantics (s:review OR / ps: prefix)]

[kodo gsd doctor]
    └──extracts──> [shared dismissSession / reapZombie helper]
                       └──reused-by──> [dashboard `d` dismiss]   (HARD dependency per milestone)
    └──reuses──> [v0.6 worktree cleanup] [GSD-10 lock PID+TTL] [v3 reconcile `alive`]

[dashboard `d` dismiss]
    └──requires──> [doctor's zombie-reap helper extracted FIRST]
    └──promotes──> [TUI read-only → read-write]   (conscious milestone decision, backlog 999.1)
```

### Dependency Notes

- **`d` dismiss requires doctor's reap helper:** milestone mandates code reuse. Order doctor's zombie-reap extraction *before or with* the dismiss key — don't build two cleanup paths.
- **provider_state render/filter require the contract + enrichment first:** the `getTaskState` method and `/status` enrichment must land before any dashboard column/badge/filter work. The render decision (A column / B badge / C color) and filter semantics (`s:review` OR vs `ps:` prefix) are flagged in PROJECT.md as **discuss-phase open decisions** — keep them as a thin layer on top of the data.
- **provider_state and doctor/dismiss are independent** — can be sequenced in either order across phases; provider_state is the higher-value, higher-uncertainty one (touches the TaskProvider contract → mandatory discuss-phase).

---

## MVP Definition

### Launch With (v0.10 core)

- [ ] `getTaskState(taskId): NormalizedState` on the TaskProvider contract (9→10 methods) — the cross-provider promise demands it be a contract method, not provider-specific
- [ ] Plane mapping (group + name-match for review/block) — essential; primary adapter and the literal ROMAN-150 driver
- [ ] GitHub mapping via **label convention (Option i) + open/closed fallback** — essential for cross-provider parity, zero extra API cost
- [ ] `/status` enrichment: per-row fail-open + TTL cache + `provider.state.fetch.failed` logging — correctness-critical, non-negotiable
- [ ] `unknown` as the universal fallback — without it the feature is brittle
- [ ] `kodo gsd doctor` **dry-run by default**, `--fix` to mutate, category-grouped output, exit 0/1 — the saneo workhorse
- [ ] doctor: zombie reap + lock release + worktree prune + old-log delete (4 categories)
- [ ] Extracted shared `dismissSession`/`reapZombie` helper
- [ ] Dashboard `d` dismiss (inverse guard, inline footer confirm, reuses the helper)

### Add After Validation (v0.10.x)

- [ ] Dashboard render of provider_state (column vs badge vs color) — **discuss-phase decision**; can ship the data before the final visual lands
- [ ] Filter semantics for provider_state (`s:review` OR vs `ps:` prefix) — discuss-phase decision
- [ ] Header banner degradation when *all* provider_state fetches fail (like v0.9 `server caído`)

### Future Consideration (post-v0.10)

- [ ] GitHub Option (ii) issue→PR review-state derivation — only if the label convention proves insufficient *and* a real driver appears; high API/complexity cost
- [ ] Concurrency-capped batched enrichment — only when N sessions grows enough to matter
- [ ] Per-workspace user-configurable name→normalized mapping table — only if Plane custom state names diverge from the `review`/`block` substrings in practice
- [ ] doctor `--fix` per-item interactive confirmation — only if accidental destruction becomes a real problem (unlikely for a personal tool)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `getTaskState` contract method + Plane mapping | HIGH | MEDIUM | P1 |
| `/status` enrichment (fail-open + cache) | HIGH | MEDIUM | P1 |
| GitHub label-convention mapping (i) + open/closed | HIGH | LOW | P1 |
| `unknown` fallback | HIGH | LOW | P1 |
| `kodo gsd doctor` (dry-run default, --fix, 4 categories) | HIGH | MEDIUM | P1 |
| Shared dismiss/reap helper | HIGH | LOW | P1 |
| Dashboard `d` dismiss (guard + inline confirm) | HIGH | LOW | P1 |
| provider_state render (column/badge/color) | MEDIUM | LOW | P2 (discuss-phase) |
| provider_state filter (`s:review`/`ps:`) | MEDIUM | LOW | P2 (discuss-phase) |
| All-fail header banner degradation | MEDIUM | LOW | P2 |
| GitHub issue→PR review derivation (ii) | LOW | HIGH | P3 |
| Batched concurrency-capped enrichment | LOW | MEDIUM | P3 |
| Configurable name→normalized table | LOW | MEDIUM | P3 |

---

## Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Rich normalized vocabulary** (`backlog`/`todo`/`triage`/`cancelled`/`closed`/`paused`/`archived`) | "Be faithful to every provider state" | A live-session dashboard only cares about *active* work; pre-session and won't-do states add mapping surface + coupling for zero dashboard value; every system proves 5 buckets suffice | Keep the 5 proposed values; collapse cancelled/closed→`done`, backlog/todo→`in_progress` |
| **GitHub issue→PR review-state derivation as the primary path** | "Most accurate review signal" | No clean API (Timeline only), N+1+ calls per poll, PR may not exist when review is needed, closing-keyword links only count vs default branch — directly triggers the todo's N+1 pitfall | Label convention (Option i), zero extra API calls; PR-derivation deferred to P3 |
| **Stop-hook reads provider before marking `done` (Option 2)** | "Catch the review state at /exit" | Only captures the `/exit` transition (misses in_progress→blocked mid-session); couples kodo's lifecycle to provider API availability — a Plane outage could block `/exit` | Option 3 (this milestone): separate `provider_state` field, enriched continuously in `/status`, lifecycle stays decoupled (todo §"Por qué Option 3 vs Option 2") |
| **`doctor` mutates by default / exit 0 on problems** | "Just clean it up for me" | This is literally the `npm doctor` bug (exit 0 on error) and the accidental-destruction footgun | Dry-run default + explicit `--fix`; exit 0=clean / 1=problems (brew/git convention) |
| **Modal confirmation dialog for `d` dismiss** | "Don't let me delete by accident" | Heavy friction for a low-stakes op (the session is already *dead*; record-only delete); breaks the keyboard-only TUI flow | Inline footer double-`d` confirm + inverse guard (only `alive===false`) |
| **Undo for dismiss** | "What if I mis-press?" | Would require resurrecting session state; the target is a dead session and `DELETE /sessions/{id}` is the intended terminal op | None; the inverse guard + inline confirm already prevent the realistic mistake |
| **Recompute `alive` in the dashboard for dismiss eligibility** | "Be sure it's really dead" | Violates the v0.9 single-source invariant (`reconcileTick` is the only `alive` writer); two sources drift | Read `alive` from the v3 state as-is (single source of truth) |
| **Per-poll provider fetch with no cache** | "Always fresh state" | N sessions × every poll = Plane/GitHub rate-limit exhaustion (explicit todo pitfall) | TTL cache (5–30s) reusing `pendingCache`; fail-open per row |
| **New `/status` endpoint or schema break for provider_state** | "Clean API surface" | v0.9 invariant is "cero endpoints nuevos"; provider_state is additive enrichment | Additive `provider_state` field on existing `/status` payload, byte-compatible (like the v0.9 `supported` field) |

---

## Competitor Feature Analysis (cross-system state normalization)

| Aspect | Jira | Linear | Plane (kodo's adapter) | kodo's approach |
|--------|------|--------|------------------------|-----------------|
| Fixed category set | 3 (To Do/In Progress/Done) | 6 types (triage/backlog/unstarted/started/completed/canceled) | 5 groups (Backlog/Unstarted/Started/Completed/Cancelled) | 5 normalized values tuned to *live sessions* (in_progress/in_review/blocked/done/unknown) |
| Native "review" | No (custom in In Progress) | No (custom started) | No (custom in Started) | Derived: Plane name-match, GitHub label convention |
| Unmapped state handling | n/a | Keep last good / fall to Triage; never errors | n/a | `unknown` + fail-open (mirrors Linear) |
| Mapping mechanism | category buckets | status→type | group + name | group/state → name-match → label convention (GitHub) |

---

## Sources

- [Jira Cloud REST — workflow status categories (3 buckets, non-customizable)](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-status-categories/) — HIGH
- [Linear — Issue status / configuring workflows (status types: triage/backlog/unstarted/started/completed/canceled)](https://linear.app/docs/configuring-workflows) — HIGH
- [Linear — Jira integration (unmapped→Triage / keep-last-good fallback)](https://linear.app/docs/jira) — HIGH
- [Plane — Workflow states (5 fixed groups, custom names within, no native review)](https://docs.plane.so/core-concepts/issues/states) — HIGH
- [GitHub Docs — Linking a PR to an issue (closing keywords, default-branch only)](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) — HIGH
- [GitHub community discussion #179613 — no clean API for PR↔linked issues (Timeline only)](https://github.com/orgs/community/discussions/179613) — MEDIUM
- [Homebrew Manpage — brew doctor (report-only, non-zero exit) + brew cleanup (-n/--dry-run, stale locks)](https://docs.brew.sh/Manpage) — HIGH
- [Flutter — doctor troubleshooting (category-grouped output)](https://docs.flutter.dev/install/troubleshoot) — MEDIUM
- [npm/cli#1226 — npm doctor exit 0 on error (anti-pattern)](https://github.com/npm/cli/issues/1226) + [npm-doctor docs](https://docs.npmjs.com/cli/v11/commands/npm-doctor/) — HIGH
- [git-worktree docs — prune --dry-run, locked never pruned, prunable detection](https://git-scm.com/docs/git-worktree) — HIGH
- [UX guide to destructive actions (friction ∝ reversibility, undo vs confirm)](https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03) — MEDIUM
- [Indie Hackers — designing destructive actions (reinforce target, avoid vague yes/no)](https://www.indiehackers.com/post/ux-tip-how-to-design-destructive-actions-e-g-delete-turn-off-74d17fdc28) — MEDIUM
- kodo `.planning/PROJECT.md` + `.planning/todos/pending/2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md` — project context (HIGH)

---
*Feature research for: developer CLI session/task lifecycle hygiene + cross-system task-state normalization (kodo v0.10)*
*Researched: 2026-06-03*
