# Pitfalls Research

**Domain:** Node.js CLI/TUI (ink) — adding "open-in-manager" deep links + (spike-gated) live Claude Code task-state capture to an existing dashboard
**Researched:** 2026-06-11
**Confidence:** HIGH on the open-in-manager half (verified against existing kodo source + official Plane/GitHub docs); MEDIUM-HIGH on the live-capture half (Claude Code internals churn fast; verified the critical regression with a primary GitHub issue but flag version-coupling explicitly)

> **Framing note for the roadmapper.** Both features are *less greenfield than they look*. The
> open-in-manager plumbing is ~80% already present in `src/` (see Critical Pitfall 0). The live-capture
> half is *more dangerous than v0.11 thought* — the exact mechanism v0.11 leaned toward (PostToolUse on
> `TodoWrite`) has since been **bypassed by Claude Code's own migration to `Task*` tools** (see Critical
> Pitfall 6). Read those two first; they reshape the milestone.

---

## Critical Pitfalls

### Pitfall 0: Re-building `task_url` from scratch (it already exists and is already persisted)

**What goes wrong:**
A naive read of the milestone ("provide `task_url` from each normalizer, persist in `SessionRecord`")
leads to adding a *new* field, a *new* normalizer method, and a *new* persistence path — duplicating
machinery that **already ships in main**.

**Why it happens:**
The milestone prose describes the *intent* ("`task_url` persisted... provided by each normalizer") as if
it were new work. It mostly isn't. Verified in current source:
- `src/interface.js:20` — `TaskItem.url` is already a canonical field.
- `src/providers/plane/normalize.js:76` — Plane already builds `url: ${baseUrl}/${workspaceSlug}/browse/${ref}` where `ref = ${projectIdentifier}-${sequence_id}`.
- `src/providers/github/normalize.js:102` — GitHub already sets `url: issue.html_url` (D-15).
- `src/session/manager.js:48` — `addSession` already maps `task_url: task.url` into the SessionRecord.
- `src/session/state.js:23` — `task_url?: string` is already a persisted, optional field.

**How to avoid:**
Treat v0.12 open-in-manager as a **wiring + correctness audit**, not new construction. The real work is:
(1) the TUI keypress + `execFile open`; (2) fixing the Plane URL-host bug (Pitfall 2); (3) a backfill/fallback
for sessions whose `task_url` is empty (Pitfall 1). Do NOT add a `getTaskUrl()` opt-in method mirroring
`getTaskState` — the URL is plain data on `TaskItem`, not a capability that needs typeof-detection.

**Warning signs:**
A plan that introduces `TASK_PROVIDER_METHODS` changes, or a new `task_url` field alongside the existing one,
or a normalizer diff that touches the `url:` line. Any of these means you're rebuilding.

**Phase to address:**
Open-in-manager core phase — first task should be "audit the existing `url`/`task_url` round-trip" before writing any new code.

---

### Pitfall 1: `task_url` empty for legacy / already-running sessions (the field is optional and not backfilled)

**What goes wrong:**
The operator presses the open key on a session that was launched before v0.12 (or by a code path that didn't
carry `task.url`), and nothing useful happens — `task_url` is `undefined`. Because the field is `task_url?`
(optional, `state.js:23`), the dashboard has rows with no URL, and a sloppy handler either does nothing
silently (looks broken) or — worse — calls `open` with `undefined`.

**Why it happens:**
`task_url` is persisted *at launch time* from `task.url`. Every SessionRecord already in `state.json` from
v0.9–v0.11 predates this being relied upon, and `kodo`'s own convention (mirror of `gsd_mode`) is that
additive fields are falsy for old records. The `state.json` migration history (v1→v2→v3) does *not* backfill
URLs because the provider isn't re-queried during migration.

**How to avoid:**
- Guard the open handler on a **present, non-empty, http(s) `task_url`** before calling `open`; if absent,
  show a footer message (`no task URL for this session`) — never call `open` with a falsy/garbage arg.
- Provide a **derive-on-read fallback**: when `task_url` is missing but the row has provider + `ref`/`task_id`,
  reconstruct the URL the same way the normalizer does (shared pure helper, so producer and fallback are
  byte-identical — the exact "seam" discipline v0.11 used for the light-plan path). This avoids needing a
  state migration just to light up old rows.
- Accept that some very old rows may legitimately have no URL → the footer message is the honest outcome.

**Warning signs:**
The open key works on freshly-launched sessions in dogfooding but does nothing on the rows that were already
in the dashboard when you started. Tests that only cover the happy "just launched" path.

**Phase to address:**
Open-in-manager core phase. Add a regression test with a SessionRecord that has no `task_url`.

---

### Pitfall 2: Plane web URL built from the **API base URL** — dead link when web host ≠ API host

**What goes wrong:**
The normalizer builds the issue link as `${baseUrl}/${workspaceSlug}/browse/${ref}` (`normalize.js:76`).
But `baseUrl` in kodo is the **API host root**: `client.js:24` does
`${this.baseUrl}/api/v1/workspaces/${slug}${path}`. So `baseUrl` is "the host you hit the REST API on,"
and the code *reuses it as the web host*. On the common single-domain Docker deploy these are the same origin,
so it works — and quietly hides the bug. On any deploy where the web app and API are served on **separate
URLs**, the produced link points at the API host and is dead (or returns API JSON / a 404), opening a useless
browser tab.

**Why it happens:**
Plane self-hosting historically supported `NEXT_PUBLIC_API_BASE_URL` to split web and API onto different hosts
(common in Kubernetes); the single-domain default makes the conflation invisible in testing. kodo's config only
stores one `plane.base_url` (the API one), so there is currently *no place* to put the web host.

Secondary URL-construction traps in the same line:
- **Trailing-slash drift:** `client.js` strips a trailing slash from `baseUrl` (`.replace(/\/$/, '')`), but the
  `url:` field in `normalize.js` interpolates `baseUrl` *raw* — if a future config path feeds it un-normalized,
  you get `host//workspace/browse/...` (double slash) or a missing slash.
- **`workspaceSlug` vs workspace id:** the web URL needs the human **slug** (`my-team`), not the workspace UUID.
  `normalize.js` uses `context.workspaceSlug` correctly today — but if anyone wires the UUID in, the link 404s.
- **`sequence_id` vs uuid:** the web `/browse/` ref is `IDENTIFIER-<sequence_id>` (the human "PROJ-123"),
  NOT the issue UUID (`workItem.id`). `normalize.js:65` builds `ref` from `sequence_id` correctly; do not
  "simplify" it to the uuid.
- **`projectIdentifier` missing:** `normalize.js:107` shows a real fallback to `'UNKNOWN'` when the identifier
  can't be resolved → a ref of `UNKNOWN-123` produces a dead link. (HIGH confidence — this fallback is in the source.)

**How to avoid:**
- Introduce an **optional `plane.web_url` config** (defaulting to `base_url` when unset, preserving today's
  single-domain behavior). Build the web link from `web_url`, the API client keeps using `base_url`. This is the
  only correct fix for the host-divergence case and is cheap.
- Normalize the host once (strip trailing slash) in a shared helper before interpolation, so producer and any
  fallback agree.
- Keep the `IDENTIFIER-<sequence_id>` ref, the **slug** (not UUID), and treat `projectIdentifier === 'UNKNOWN'`
  as "no reliable URL" (footer message) rather than emitting a known-dead link.

**Warning signs:**
Links work on your own single-domain Plane CE but a self-hosted user reports the tab opens raw JSON or a 404.
A config that has only one Plane host field. `UNKNOWN-` appearing in any persisted `task_url`.

**Phase to address:**
Open-in-manager core phase (the link-correctness task). Verify against a config where `web_url ≠ base_url`.

---

### Pitfall 3: `open` (or its failure) crashing the never-throws TUI / breaking the alt-screen

**What goes wrong:**
Launching the browser from inside an ink full-screen (alt-screen) app goes wrong three ways:
(1) An error path (`ENOENT` because `open` isn't found, non-zero exit, sync throw) propagates as an
exception into the React render tree, violating the TUI never-throws invariant and tearing down the panel.
(2) The launch is done with `spawn(..., {stdio:'inherit'})` or otherwise grabs the TTY, corrupting the
alt-screen / leaving the terminal in a bad state. (3) The panel is unmounted "to be safe" while the browser
opens, losing the operator's cursor/selection.

**Why it happens:**
Developers reach for `child_process` without remembering the project's hard-won `focus.js` pattern. macOS `open`
is fire-and-forget (returns immediately, detaches the browser), so there's a temptation to await it or inherit
stdio — both wrong here.

**How to avoid:**
**Clone `src/cli/dashboard/focus.js` verbatim as the template** — it already solves exactly this for
`cmux select-workspace`:
- `execFile` (NOT `exec` with a shell, NOT `spawn` with `stdio:'inherit'`) — see Pitfall 4 for the security reason.
- `exec` injected via DI, **no default** (structural leak guard — tests can never touch the real `execFile`).
- Never-throws discriminated return `{ ok: true } | { ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail }`.
- Map `code` → canonical footer message in `App.js` (presentation), panel stays mounted, cursor preserved by `task_id`.
- Short timeout (`focus.js` uses 5s) so a hung `open` doesn't wedge the UI.
- `open` does NOT take the TTY — it hands the URL to the OS and exits, so the alt-screen is untouched as long as
  you don't inherit stdio.

**Warning signs:**
Any `import ... from 'node:child_process'` in the dashboard that isn't behind a DI'd, never-throws helper. A
plan that `await`s the browser or unmounts the panel. The terminal left garbled after opening a link.

**Phase to address:**
Open-in-manager core phase. The acceptance test must include the ENOENT/non-zero/throw fault matrix (mirror `focus.js` tests) plus a UAT confirming the alt-screen survives.

---

### Pitfall 4: Argument-injection via a crafted URL into `open`

**What goes wrong:**
A `task_url` value is passed to the browser launcher. If launched through a **shell** (`exec`,
`spawn(..., {shell:true})`, string interpolation into a command line), a malicious/garbage URL can inject
shell metacharacters (`; rm -rf`, backticks, `$(...)`). Even without a shell, `open` itself interprets
**leading-dash arguments as flags** — a `task_url` like `-a /System/.../Calculator.app` or a value starting
with `-` could be read by `open` as an option rather than a URL.

**Why it happens:**
The URL comes from provider data (Plane/GitHub responses), which is *mostly* trusted but not guaranteed —
a self-hosted Plane field, a manipulated issue, or a buggy normalizer could yield an unexpected string. The
"it's just opening a link" framing makes people skip the threat model.

**How to avoid:**
- **`execFile(binary, [url])`** — never a shell. `execFile` passes the URL as a single argv element, so shell
  metacharacters are inert (no shell parses them). This is already the `focus.js` discipline.
- **Validate the URL before launch:** require it parse as a `URL` whose `protocol` is `http:` or `https:`
  (rejects `file:`, `javascript:`, `-`-prefixed junk, empty). This kills both the leading-dash flag-injection
  (a real `http(s)://` URL never starts with `-`) and accidental `file://` opens.
- The http(s) allowlist is the load-bearing guard once `execFile` removes the shell.

**Warning signs:**
A launcher using `exec`/template strings/`shell:true`. No protocol validation on `task_url`. Tests that only
feed well-formed `https://` URLs and never a hostile string.

**Phase to address:**
Open-in-manager core phase. Add adversarial tests: `javascript:alert(1)`, `file:///etc/passwd`,
`-a Calculator`, `https://x; touch /tmp/pwn`, empty string — all must be refused, never reach `execFile`.

---

### Pitfall 5: Cross-platform launcher (`open` macOS vs `xdg-open` Linux vs Windows)

**What goes wrong:**
Hardcoding `open` makes the feature macOS-only and silently `ENOENT`s on Linux (`open` isn't the browser
opener there — `xdg-open` is). On Windows the opener is different again (`start`, which is a shell builtin,
not an executable — a classic injection footgun).

**Why it happens:**
The dev environment is macOS (constraint: "Debe funcionar en macOS con cmux instalado"), so `open` "works on my
machine." The repo already targets macOS-first.

**How to avoid:**
- macOS-first is fine and matches the project constraint — but follow the **existing repo precedent**: kodo
  already has a **Windows "refuse-with-guidance"** pattern (used by `kodo polling` per PROJECT.md / v0.7).
  Reuse it: on `win32`, refuse with a clear message rather than attempting a shell `start` (which reintroduces
  the injection surface of Pitfall 4).
- For Linux, `xdg-open` is a low-cost addition (platform switch on `process.platform`), but it's optional for
  this milestone given the macOS-only runtime constraint. If skipped, the ENOENT path (Pitfall 3) must still
  degrade gracefully to a footer message, not a crash.
- Decide explicitly (macOS-only + Windows refuse, or +Linux) and document it — don't let the default be
  "crashes on non-mac."

**Warning signs:**
`open` string literal with no platform guard. A `win32` path that shells out to `start`. ENOENT on Linux
treated as a generic error instead of "unsupported platform."

**Phase to address:**
Open-in-manager core phase. Platform switch + reuse the existing Windows refuse-with-guidance helper.

---

### Pitfall 6: **[SPIKE GATE]** Live task-state capture — the v0.11 fragility got *worse*, not better

**What goes wrong:**
This is the conditional half and the highest-risk pitfall. v0.11 already found live capture fragile
(`TodoWrite` deprecated; `transcript` / `~/.claude/plans/` unstable between Claude Code versions) and
deliberately settled for a *static* light-plan file. **The situation has since regressed further**, which is
why the spike exists and why its default verdict should lean INVIABLE unless a hook-stable surface is
empirically proven.

Root-caused with current sources (flag: Claude Code internals, fast-moving, version-coupled):

1. **`TodoWrite` → `Task*` migration broke the hook surface.** Per the Agent SDK docs and a primary GitHub
   issue, recent Claude Code / Agent SDK versions use structured `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`
   tools instead of `TodoWrite`. The newer `Task*` tools **completely bypass the `PreToolUse`/`PostToolUse`
   hook system**, unlike `TodoWrite` which fired hooks (anthropics/claude-code issue #20243, described as a
   "user control regression"). So the exact mechanism a 2026 "zero-token progress bar" relied on — PostToolUse
   on TodoWrite reading `block.input.todos` — **does not fire for the current task tooling**. (HIGH confidence
   on the bypass; MEDIUM on exact version numbers — these drift.)

2. **Transcript JSONL is undocumented-as-stable and churns.** `transcript_path` points at a per-session
   `.jsonl` under `~/.claude/projects/.../<session>.jsonl`. The *path* is provided by the hook payload (stable
   enough — kodo already correlates it via `session.start`, LOG-10), but the **line schema is internal**: tool
   calls, todo/task blocks, and their field names are not a committed public contract and have changed across
   versions. Parsing task-state out of it is reverse-engineering an internal format.

3. **Undocumented files under `~/.claude/`.** `~/.claude/plans/` (v0.11's tripwire) and any task-list-on-disk
   file are implementation details that can move/rename/disappear between releases. The "progress bar reads the
   native task list from disk" approach (dev.to, 2026) depends on exactly such a file.

4. **Race / partial-JSON when reading a file being written live.** Any capture that reads the transcript or a
   task file *while Claude is writing it* will hit half-written lines / partial JSON / truncated objects. A
   parser that isn't tolerant of incomplete trailing lines will throw or mis-read.

5. **Hook latency / session breakage risk.** If capture is done via a hook (PostToolUse), a slow or throwing
   hook command adds latency to every tool call and can disrupt the session. The capture hook must be
   fast, non-blocking, and must never fail the session.

6. **HOOK-02 golden-bytes invariant.** kodo's existing `session-start.js` injection is byte-protected
   (golden-bytes HOOK-02, append-at-end, v0.11 Phase 45). Any new capture hook must be a **separate** hook and
   must not perturb the existing session-start injection bytes, or it breaks a verified invariant.

**Why it happens:**
Claude Code ships fast and treats its on-disk/transcript formats and the `Task*` tool internals as private.
Training data (and last milestone's research) captured a *snapshot* (`TodoWrite` + hooks) that the product has
already moved past. Believing the snapshot is the trap.

**How to avoid (this is the spike's job, not the implementation's):**
- **Run the spike against the operator's actually-installed Claude Code version** (`claude --version`), not
  against docs or memory. The answer is version-specific.
- Probe in priority order, recording empirical evidence for each:
  1. Is there a **documented, hook-firing** surface for task/todo state in *this* version? (Check whether
     `TodoWrite` can be explicitly re-enabled and whether it still fires PostToolUse, vs. whether `Task*` is
     now exclusive and hook-silent.)
  2. If only the transcript/on-disk file exists: can it be parsed **tolerantly** (skip partial trailing lines)
     and is the schema stable enough to extract a coherent in_progress/completed/pending count?
  3. Does the capture path add acceptable latency and **never throw into the session**?
- Build the capture as a **separate, additive hook** that writes to a **kodo-controlled path**
  (`~/.kodo/...`, mirroring the v0.11 light-plan seam) — never read Claude's internal files directly at display
  time. The dashboard then reads kodo's own artifact (cero endpoints nuevos, read-only filesystem — same shape
  as the existing plan overlays).
- The display side reuses the v0.11 overlay machinery (`mode:'overlay'`, snapshot, never-throws, anti-ReDoS
  `task_id` guard) — so display is low-risk *if* capture is viable.

**Spike VIABLE criteria (ALL must hold):**
- [ ] A **hook-firing or stable-on-disk** surface exists in the installed Claude Code version that exposes
      live task/todo state (in_progress / completed / pending), demonstrated by capturing real state from a
      live session — not inferred from docs.
- [ ] The capture mechanism is **version-resilient enough**: either it's a documented/supported surface, OR the
      parse is tolerant of format drift and partial writes (skips unparseable lines, never throws).
- [ ] Capture runs **without adding meaningful latency** to the session and **cannot fail the session**
      (fire-and-forget, never-throws, isolated from the HOOK-02 session-start injection).
- [ ] Capture writes to a **kodo-controlled path** (`~/.kodo/...`), so the display side never reads Claude's
      internal files directly and the existing read-only/overlay invariants hold.

**Spike INVIABLE warning signs (ANY ⇒ return INVIABLE, ship core only):**
- The only task surface is `Task*` tools and they **bypass hooks** with no documented opt-in to a hook-firing
  path → no supported capture point. (This is the current default expectation per issue #20243 — so INVIABLE
  is the *likely* verdict and the roadmap must not depend on the conditional half.)
- The only readable surface is an **undocumented `~/.claude/` file** whose schema differs from any prior version
  you've seen (high churn → guaranteed breakage on the next Claude Code update).
- Reads hit partial/corrupt JSON that can't be tolerated without heuristics that would mis-report progress.
- Any capture attempt adds latency to tool calls, perturbs the session, or risks the HOOK-02 golden bytes.
- You cannot demonstrate end-to-end capture of *real* live state inside the spike timebox.

**Phase to address:**
Dedicated **spike phase**, hard gate, BEFORE any display phase. The display phase must be explicitly
**conditional** on a VIABLE verdict; the roadmap ships open-in-manager + Nyquist backfill regardless.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse `plane.base_url` as the web host for the link | No new config field | Dead links on split web/API self-hosted deploys (Pitfall 2) | Only if you accept single-domain-only AND document it; better to add optional `plane.web_url` now |
| Skip the `task_url` empty/legacy fallback | Less code | Open key silently no-ops on pre-v0.12 / partial sessions (Pitfall 1) | Never — guard + footer message is cheap and required for never-throws honesty |
| Read Claude's transcript / `~/.claude/` file directly at display time | No capture hook needed | Breaks on every Claude Code release; couples the dashboard to internal formats | Never — go through a kodo-controlled artifact (`~/.kodo/...`) |
| Implement live-capture display before the spike verdict | Feels like progress | Builds on a foundation that may be INVIABLE; sunk cost pressures a bad ship | Never — display phase MUST be gated on VIABLE |
| `open`/launcher with `exec` + string URL | One-liner | Shell + argument injection (Pitfall 4) | Never — `execFile([url])` + http(s) validation |
| Hardcode `open`, no platform guard | Works on the mac dev box | Crashes/ENOENT on Linux, injection on Windows `start` (Pitfall 5) | Acceptable macOS-only IF the non-mac path degrades to refuse-with-guidance, not a crash |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Plane web link | Building URL from API `base_url`; using workspace UUID or issue UUID; `UNKNOWN-` identifier fallback (`normalize.js:107`) | Use web host (`web_url`, default = `base_url`), workspace **slug**, `IDENTIFIER-<sequence_id>` ref; treat `UNKNOWN-` as "no URL" |
| Plane host config | One `base_url` field assumed = web URL | Add optional `plane.web_url`; strip trailing slash once in a shared helper to avoid `//browse` drift |
| GitHub issue link | Assuming `html_url` could be absent / hand-building `github.com/owner/repo/issues/N` | `issue.html_url` is a standard, present field on issue responses (cloud + Enterprise) — use it verbatim; for GitHub Enterprise the `html_url` already encodes the enterprise host, so don't reconstruct it |
| GitHub Enterprise base_url | Reconstructing URLs from `api.github.com` | Enterprise is explicitly Out of Scope for kodo today (PROJECT.md deferred candidates); `html_url` would carry the right host anyway — don't special-case it now |
| macOS `open` | `exec`/shell, awaiting it, `stdio:'inherit'` | `execFile(open, [url])`, fire-and-forget, ignore stdout/stderr, short timeout, never-throws (clone `focus.js`) |
| Claude Code `Task*` tools | Assuming PostToolUse fires on task updates (it did for `TodoWrite`) | It does NOT fire for `Task*` (issue #20243) — spike must prove an alternative hook-firing/on-disk surface or return INVIABLE |
| Claude Code transcript JSONL | Parsing the whole file strictly | Tolerant line-by-line parse, skip partial/last line (live writes), treat schema as unstable/internal |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Capture hook on every tool call | Session feels sluggish; tool latency up | Fire-and-forget write, no blocking I/O, no network; or capture out-of-band | As soon as the hook does real work synchronously |
| Re-reading a large transcript JSONL each poll to derive state | Dashboard poll gets slow as the session grows | Have the capture hook write a small distilled state file to `~/.kodo/`; dashboard reads that, not the raw transcript | Long sessions with big transcripts |
| `open` awaited / not detached | UI stalls while browser launches | Fire-and-forget `execFile`, short timeout | Slow browser cold-start |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing `task_url` through a shell | Command injection from a crafted provider field | `execFile`, never `exec`/`shell:true` (Pitfall 4) |
| No protocol allowlist on the URL | `file://` / `javascript:` / leading-`-` flag injection into `open` | Require parsed `URL` with `http:`/`https:` protocol before launch |
| Windows `start` shell builtin to open URLs | Reintroduces shell injection on win32 | Refuse-with-guidance on win32 (existing repo pattern), don't shell out |
| Reading/echoing Claude transcript content into logs/UI unfiltered | Could surface secrets the session handled | Capture only structured task-state (counts/titles), not raw transcript bodies; keep kodo's NDJSON redactor discipline |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Open key silently does nothing when `task_url` missing | Operator thinks the feature is broken | Footer message `no task URL for this session` (honest, mirrors existing overlay copy discipline) |
| Reusing an already-bound key | Conflicts with `q`/`/`/`c`/`l`/`p`/`d`/Enter (verified bound in `App.js`) | Pick a free key (e.g. `o` for open); keep the mode-gated `useInput` structure |
| Unmounting the panel / losing cursor to open a link | Operator loses their place | Panel stays mounted, cursor preserved by `task_id` (Pitfall 3) |
| Live-progress overlay showing stale data without a freshness cue | Operator trusts a frozen number | Reuse v0.11 snapshot + live-poll labeling honesty; if capture is best-effort, say so (mirror the `l` logs "not-per-session" honesty) |

## "Looks Done But Isn't" Checklist

- [ ] **Open-in-manager:** Works on a freshly-launched session — but verify it on a **pre-v0.12 SessionRecord with no `task_url`** (Pitfall 1).
- [ ] **Plane link:** Opens correctly on single-domain Plane — but verify with a config where **`web_url ≠ base_url`** and where `projectIdentifier` resolves to `UNKNOWN` (Pitfall 2).
- [ ] **Launcher safety:** Opens normal URLs — but verify the **adversarial URL matrix** is refused before reaching `execFile` (Pitfall 4).
- [ ] **TUI resilience:** Opens a link — but verify the **alt-screen survives** and an **ENOENT/non-zero/throw** never crashes React (Pitfall 3).
- [ ] **Platform:** Works on macOS — but verify the **non-mac path refuses gracefully** (no crash, no `start` shell-out) (Pitfall 5).
- [ ] **Spike:** "We can read the transcript" — but verify you captured **real live task-state from a running session on the installed Claude Code version**, tolerant of partial JSON, without breaking the session (Pitfall 6).
- [ ] **Invariants:** Verify **cero endpoints nuevos**, color isolation (no picocolors in the new dashboard code), `TASK_PROVIDER_METHODS` still FROZEN at 9, HOOK-02 golden bytes intact if a capture hook is added.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Plane links built from API host (dead on split deploys) | LOW | Add `plane.web_url` config (default `base_url`), route normalizer + fallback through it, re-test |
| `task_url` empty on legacy rows | LOW | Add derive-on-read fallback helper shared with the normalizer; no state migration needed |
| Launcher crashed the TUI | LOW | Refactor to clone `focus.js` never-throws DI helper; add fault-matrix tests |
| Shipped live-display on a fragile surface that then broke on a Claude update | HIGH | Hard to recover — this is *why* the spike gates it; if it breaks post-ship, fall back to the static v0.11 light-plan and mark display deferred |
| Capture hook slowed/broke sessions | MEDIUM | Disable the hook, move capture out-of-band, re-verify latency before re-enabling |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 0 — Re-building existing `task_url` machinery | Open-in-manager core | First task audits existing `url`/`task_url` round-trip; diff shows no new field/method |
| 1 — Empty `task_url` on legacy sessions | Open-in-manager core | Regression test with a SessionRecord lacking `task_url`; footer message asserted |
| 2 — Plane web URL from API host / slug / sequence_id | Open-in-manager core | Test with `web_url ≠ base_url`, slug vs UUID, `UNKNOWN` identifier → no dead link emitted |
| 3 — Launcher crashing TUI / alt-screen | Open-in-manager core | Fault matrix (ENOENT/non-zero/throw) + UAT alt-screen survives, panel stays mounted |
| 4 — URL argument/shell injection | Open-in-manager core | Adversarial URL tests all refused before `execFile` |
| 5 — Cross-platform launcher | Open-in-manager core | win32 refuse-with-guidance asserted; non-mac ENOENT degrades to footer |
| 6 — Live-capture fragility | **Spike phase (hard gate)** | Empirical VIABLE/INVIABLE verdict on installed Claude Code version; display phase conditional on VIABLE |

## Sources

- Claude Code Hooks reference (transcript_path, PostToolUse input shape) — https://code.claude.com/docs/en/hooks (HIGH)
- Agent SDK Todo Tracking (TodoWrite → Task* tooling, monitoring todos via PostToolUse) — https://platform.claude.com/docs/en/agent-sdk/todo-tracking (HIGH)
- **anthropics/claude-code issue #20243 — "Task* tools bypass PreToolUse/PostToolUse hooks"** (the load-bearing regression for the spike) — https://github.com/anthropics/claude-code/issues/20243 (HIGH for the bypass; MEDIUM for exact version numbers)
- "A zero-token progress bar for Claude Code" (reads native task list from disk via PostToolUse) — https://dev.to/prafulreddy/a-zero-token-progress-bar-for-claude-code-51bp (MEDIUM — shows the on-disk approach and its TodoWrite dependency)
- Plane API — issue endpoint structure, `sequence_id`, workspace slug — https://developers.plane.so/api-reference/issue/get-issue-detail (HIGH for API shape)
- makeplane/plane issue #2434 — web and API on separate URLs in self-hosting (`NEXT_PUBLIC_API_BASE_URL`) — https://github.com/makeplane/plane/issues/2434 (HIGH — confirms web≠API host divergence)
- GitHub REST API — issue `html_url` present on issue responses (cloud + Enterprise) — https://docs.github.com/en/rest/issues (HIGH)
- kodo source verified in-repo: `src/interface.js:20` (`TaskItem.url`), `src/providers/plane/normalize.js:65,76,107`, `src/providers/plane/client.js:8,24`, `src/providers/github/normalize.js:102`, `src/session/manager.js:48`, `src/session/state.js:23`, `src/cli/dashboard/focus.js` (never-throws launcher pattern), `src/cli/dashboard/App.js` (bound keys `q`/`/`/`c`/`l`/`p`/`d`/Enter) (HIGH)

---
*Pitfalls research for: Node CLI/TUI — open-in-manager deep links + spike-gated live Claude Code task-state capture*
*Researched: 2026-06-11*
</content>
