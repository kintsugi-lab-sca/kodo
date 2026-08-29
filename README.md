# kodo 心動

Automated Claude Code sessions driven from your kanban board. Move a task to "In Progress" → kodo launches [Claude Code](https://claude.ai/code) in a [cmux](https://cmux.dev) or [Orca](https://www.onorca.dev) workspace → when it finishes, the task comes back as "In Review".

Supported providers: [Plane](https://plane.so) (webhook) and GitHub Issues (polling).

## How it works

```
Plane (kanban)          kodo (daemon)              cmux (terminal)
─────────────           ─────────────              ────────────────

Task → In Progress ──webhook──→ kodo
                                  │
                        has the "kodo" label?
                          │ no → ignore
                          │ yes ↓
                        create workspace ────────→ KL-42 [Amber]
                        launch claude ───────────→ claude --model opus ...
                                                     │
                                                   Claude works
                                                     │
                                                   session closes
                                                   (Ctrl+C, /exit, close)
                                                     │
                        SessionEnd ←─────────────────┘
                          │
                        backstop → In Review       KL-42 [Blue]
                        event → orchestrator inbox
                          │
                        human/orchestrator reviews
                          │
                        Plane → Done               KL-42 [Green]
```

## Installation

Requires macOS, Node ≥ 20 and [cmux](https://cmux.dev).

### Homebrew (recommended)

```bash
brew tap kintsugi-lab-sca/kodo
brew install kodo
```

### From source

```bash
git clone https://github.com/kintsugi-lab-sca/kodo.git
cd kodo
npm install
npm link   # makes "kodo" available globally
```

## Getting started

### 1. Credentials

```bash
mkdir -p ~/.kodo
cat > ~/.kodo/.env << 'EOF'
PLANE_API_KEY=plane_api_your_token_here
PLANE_WEBHOOK_SECRET=plane_wh_your_secret_here
EOF
```

- `PLANE_API_KEY`: in Plane → profile → **API tokens**.
- `PLANE_WEBHOOK_SECRET`: you get it when creating the webhook (step 4).
- `KODO_API_TOKEN` (API auth) is generated automatically on first startup — you don't need to create it.

### 2. Configure and map projects

```bash
kodo config   # interactive wizard: connects to Plane, lists projects, asks for local paths
```

Creates `~/.kodo/config.json` and `~/.kodo/projects.json` (Plane project → local repo path).

### 3. Create labels in Plane

In every project you want to automate:

| Label | Effect |
|---|---|
| `kodo` | Enables automation. Default model: Opus |
| `kodo:sonnet` / `kodo:haiku` | Changes the model |
| `kodo:yolo` | Skips tool-call confirmation (`--dangerously-skip-permissions`, or `--auto` on OpenCode) |
| `kodo:gsd` / `kodo:gsd-quick` | GSD mode (structured planning workflow); implies yolo |
| `kodo:cc` / `kodo:oc` | Which CLI runs the session — Claude Code or OpenCode. Absent → Claude Code |

Only tasks labelled `kodo` (or `kodo:*`) are automated.

> **Agent labels are non-reactive.** `kodo:cc` / `kodo:oc` never trigger a dispatch on
> their own — the task still needs `kodo` (or another `kodo:*` label) to launch. They are
> only *read* at launch time to decide which CLI opens the session, so you can set them
> ahead of time without anything happening. Long forms `kodo:claude-code` /
> `kodo:opencode` work identically. If both agents are labelled, Claude Code wins.
>
> **What OpenCode does not do.** OpenCode is a genuine alternative for ordinary coding
> tasks, but three parts of kodo's lifecycle are Claude Code features and do not carry
> over. Know them before you label a task `kodo:oc`:
>
> - **No hooks.** kodo's SessionStart / Stop / SessionEnd hooks are Claude Code hooks.
>   An OpenCode session will not auto-comment on the provider, will not move the task to
>   review by itself, and will not clean up after closing — its status is derived from
>   whether its process is alive. The session context (task ref, expected flow, where the
>   plan and handoff go) *is* delivered: kodo injects it into the initial prompt instead.
> - **No worktree isolation.** OpenCode has no `--worktree`, so the session runs directly
>   on the project path. Two concurrent OpenCode sessions on the same repo will collide.
>   Hosts that isolate on their own (Orca) still do.
> - **No GSD.** `kodo:gsd` + `kodo:oc` downgrades to Claude Code and logs
>   `agent_downgraded_gsd`. The GSD flow is `/gsd-*` slash commands and hooks all the way
>   down; running it on OpenCode would type commands that do not exist.
>
> **Models.** OpenCode takes `provider/model` identifiers, so kodo maps its own aliases
> (`opus`, `sonnet`, `haiku`, `fable`) through `agents.registry.opencode.model_map` in
> `~/.kodo/config.json`. Defaults point at the `opencode` provider (OpenCode Zen); edit
> the map to use your own Anthropic account. Any model **not** in the map is passed
> verbatim, so `anthropic/claude-sonnet-4-5` works with no configuration at all.

> **`kodo:gsd` contract (full mode).** The resolver matches the task against a phase in
> `.planning/ROADMAP.md` by **exact title**: the task title must match a phase title, and the
> heading must follow the canonical format **`## Phase N: Title`** or
> **`### Phase N: Title`** (`## Phase N — Title` also works). Any **suffix between the number and
> the colon** — e.g. `### Phase 0 (MVP): Setup` — makes the phase **invisible** to the resolver
> and the task will fail with `no-match`. For one-off tasks with no ROADMAP phase, use
> `kodo:gsd-quick`. When a dispatch fails, `kodo logs` explains why with an actionable hint.

### 4. Configure the webhook in Plane

Settings → Webhooks → new webhook:

- **URL**: `http://<ip-reachable-from-plane>:9090/webhook`
- **Events**: Work Items
- **Secret**: copy it into `PLANE_WEBHOOK_SECRET` in `~/.kodo/.env`

> ⚠️ By default kodo listens **only on `127.0.0.1`**. If Plane runs on another
> machine, expose the bind (e.g. your Tailscale IP) or the webhook will never arrive:
>
> ```bash
> kodo config --set server.bind=100.x.y.z
> ```
>
> Local tooling (`kodo up`, `kodo dashboard`) follows the bind
> automatically: no need for `0.0.0.0` and no need to pass `--url`.
>
> See [Multi-node topology](#multi-node-topology) for the security implications.

**`/webhook` response contract** — Plane retries delivery when it receives an
error, so the status encodes whether the event deserves another attempt:

| Status | When | Effect in Plane |
|--------|------|-----------------|
| `200`  | Event accepted, ignored (no `kodo` label, inactive state), **duplicate redelivery** or **permanent** dispatch failure | No retry |
| `401`  | Invalid or missing HMAC signature | — |
| `400` / `413` | Non-JSON body or larger than 1 MB | — |
| `415` / `431` | `Content-Type` other than `application/json`, or headers > 8 KB | — |
| `429`  | Per-IP rate limit reached (burst > 30 or > 1 req/s sustained) | Retries delivery |
| `503`  | **Transient** dispatch failure: Plane 5xx/429/408, network down, timeout | Retries delivery |

A transient failure answers with 503 instead of swallowing the event: without that
retry the task would sit in In Progress with no session and no explanation. The
classification is *default-closed* — only what is recognised as retryable returns
503; a configuration error (e.g. `No configured project`) fails the same way on
every attempt, so it returns 200 to avoid opening a retry storm. Every 503 leaves a
`webhook.dispatch.retry` entry in `kodo logs`.

The webhook waits on the dispatch for a short window (2 s) before responding: just
enough to see the network die, without blocking the response for the full session
startup. A dispatch still alive when the window expires answers 200 and continues in
the background.

**Anti-replay protection** — Plane's HMAC is signed over the body alone and Plane sends
no temporal header, so a captured webhook would pass signature verification
indefinitely. kodo remembers already-processed bodies for a short window
(5 minutes; tunable with `KODO_WEBHOOK_REPLAY_TTL_MS`, or `0` to disable) and
discards the redelivery with `200 {"ok":true,"duplicate":true}` without firing a second
dispatch, leaving a `webhook.replay` entry in `kodo logs`. Outside the window the event is
processed normally, and a 503 releases the mark so it does not block the legitimate retry.

#### Development without a secret: `--insecure` requires two signals

`kodo start --insecure` **disables the webhook's HMAC verification**: anyone who
reaches the port can trigger Claude sessions. So that this does not happen out of
inertia — a flag copied from a README that ends up in a startup script — the
flag on its own is not enough: the `KODO_ALLOW_INSECURE=1` environment variable
is also required.

```bash
kodo start --insecure                          # exit 1 — the flag alone authorises nothing
KODO_ALLOW_INSECURE=1 kodo start --insecure    # starts, with a warning visible on every startup
```

They are two signals from different channels (an ephemeral command line + a
deliberate environment), and neither takes effect by accident when the other is missing. Only
the exact value `1` is accepted.

Do not use this outside your local machine: set `KODO_WEBHOOK_SECRET_<PROVIDER>`
(e.g. `KODO_WEBHOOK_SECRET_PLANE`) in `~/.kodo/.env`.

### 5. Install Claude Code hooks

```bash
kodo install   # registers SessionStart and Stop hooks in ~/.claude/settings.json
```

### 6. Start it

```bash
kodo up   # starts the daemon in the background and opens the TUI dashboard
```

With Homebrew you can leave it as a service that starts automatically:

```bash
brew services start kodo
```

## Usage

### Automatic (webhook)

1. Add the `kodo` label to a task in Plane
2. Move it to "In Progress"
3. kodo creates the cmux workspace and launches Claude
4. Claude works and documents its progress as comments on the task
5. When the session closes → the task moves to "In Review"
6. You (or the orchestrator) review it and move it to "Done"

State names are configurable (`plane.states.trigger/review/done`); by default `In Progress` / `In review` / `Done`.

### Manual

```bash
kodo launch KL-42   # launches a specific task without going through the webhook
kodo orchestrate    # launches the supervising session
```

### Dashboard

```bash
kodo dashboard   # live TUI (also opened by kodo up)
```

Keys: `↑↓` move · `c` comments · `l` session logs · `L` general daemon log · `p` plan · `/` filter · `d` dismiss dead session · `o` open task in the browser · `O` focus the orchestrator · `a` adopt ad-hoc session · `e` config · `m` projects · `q` quit

> **Note on runtime strings.** kodo's own output — the dashboard header, console
> messages, the config editor labels — is still rendered in Spanish. Wherever this
> README quotes that output it reproduces it **verbatim**, so what you read here is
> what you will see on screen. Translating the runtime UI is tracked separately.

## Commands

```
kodo up                  # starts daemon + dashboard (main command)
kodo stop                # stops the daemon
kodo status              # daemon state (running|stopped)
kodo dashboard           # TUI of active sessions
kodo capture "<text>"    # captures an idea into the global inbox (~/.kodo/inbox.md)
kodo inbox               # inbox triage (--all, --json, route <id>, discard <id>)
kodo inbox-orch          # orchestrator inbox: unseen events (--all, --json, ack --all)
kodo integrate           # integration queue: which branches await ff/merge/PR (--all, --json)
kodo config              # configuration wizard / --show / --set key=value
kodo launch <REF>        # launches a task manually (e.g. KL-42)
kodo check               # watchdog: reviews state and launches the orchestrator if needed (0 tokens)
kodo orchestrate         # launches the orchestrating session (spends tokens)
kodo adopt               # adopts an ad-hoc cmux session as a tracked task
kodo comment <REF>       # posts a summary comment on an existing task
kodo logs [session-id]   # inspects session logs (dump, tail, filter)
kodo doctor              # diagnoses config.json ↔ projects.json alignment (--states, --identifiers, --json)
kodo install / uninstall # registers/removes Claude Code hooks
```

### `kodo capture` / `kodo inbox` — the capture inbox

A **single global capture buffer** at `~/.kodo/inbox.md`. The idea is to separate two acts that
usually get mixed up and get in each other's way: **capturing is instant and dumb** (one line, zero
questions, zero decisions), and **triaging is a deliberate, separate step** you do when you feel
like it and not when the idea interrupts you.

```bash
kodo capture "try the new state resolver before v0.19"

# If the text starts with a dash, prepend the argument separator:
kodo capture -- "-3 % checkout conversion after the redesign"
```

Full surface:

| Command | What it does | Exit codes |
|---|---|---|
| `kodo capture "<text>"` | Appends a line to the inbox. The file is created on the fly on the first capture | `0` ok · `1` fs error · `2` empty text after sanitising |
| `kodo inbox` | Lists open captures with their short `<id>` | `0` always — the reader never throws |
| `kodo inbox --all` | Also includes the already-closed ones, with their status | `0` always |
| `kodo inbox --json` | The same listing as a single JSON line, deterministic and colourless | `0` always |
| `kodo inbox route <id>` | Marks the capture as **routed** | `0` ok · `1` fs error, lock held or concurrent write · `2` unknown id or capture already closed |
| `kodo inbox route <id> --dest <ref>` | Same, adding a trace pointer to where it ended up | same |
| `kodo inbox discard <id>` | Marks the capture as **discarded** | same |

#### Routing is decided by `gsd-capture`, not by kodo

kodo **does not decide where an idea goes**. That job belongs to Claude Code's `gsd-capture` skill,
which is the one that knows the real destinations (all structured: notes, backlog, seeds). The flow
has three steps, and the middle one happens **outside kodo**:

```
1. kodo inbox                          → lists the open ones with their <id>
2. /gsd-capture …                      → routes the idea (kodo does NOT take part)
3. kodo inbox route <id> --dest <ref>  → marks it routed + trace pointer (if there is a ref)
```

This is deliberate and it is a hard design boundary: **kodo does not invoke, does not import and does
not reimplement** the destination logic. The "where it goes" lives outside, so kodo cannot fall out of
sync with it. Practical consequences:

- `--dest` is **optional and best-effort**. It is an opaque ref — `999.4`, `SEED-012`, a relative
  path, whatever — that kodo stores verbatim without validating that it exists or interpreting its shape.
- Without a ref, `kodo inbox route <id>` closes the capture all the same. A missing pointer **never**
  blocks the marking.

#### The file is yours

`~/.kodo/inbox.md` is plain markdown and is meant to be opened and edited by hand:

- **kodo never deletes a capture.** Closing is only a state transition: the line is still there,
  with its id, its text and its date. The permanent trace is the goal, not a side effect.
- **Every line kodo does not recognise is preserved intact**, byte for byte — headings, loose notes,
  blank lines — and is simply omitted from the listing. Marking one capture does not rewrite any
  other line in the file.

### `kodo inbox-orch` — the orchestrator inbox

**Not to be confused with `kodo inbox`.** That one holds the operator's captures
(`~/.kodo/inbox.md`); this one holds the lifecycle events headed for the orchestrator
(`state.orchestrator_inbox`): session closures with their verdict and their `NEXT:`, and launches.

Previously those events were **typed** into the orchestrator's prompt (`cmux send`), which Claude
Code queues as if the operator had written them. That failed by design, not by volume:
the hook fires on CLOSE, but the supervision round had already read the final comment in
the provider and on screen — the notice was born stale. Measured over two days of intensive
orchestration (13 sessions, 9 PRs): out of ~10 nudges, **none** contributed anything the round
did not already have, and several arrived with the task merged and Done. Worse: during a long turn
they piled up and appeared all at once, out of order with respect to reality, and the operator
deleted them by hand.

Now the event is **persisted** and the round reads it in the same `cat ~/.kodo/state.json` it was
already doing. The keyboard is left for a **one-line** notice, and only if the orchestrator is idle:

```
[kodo] 2 eventos nuevos — ITCLIP-119 en Review, ITCLIP-121 lanzada. Ronda.
```

```bash
kodo inbox-orch              # what is unseen
kodo inbox-orch --all        # including the trace of what has been seen
kodo inbox-orch --json       # the listing as one JSON line, deterministic and colourless
kodo inbox-orch ack --all    # mark everything seen when closing the round
kodo inbox-orch ack <id>...  # mark specific entries
```

The three rules that govern it:

- **If the orchestrator is thinking, nothing gets typed at it.** The idle probe is
  fail-closed: an empty screen, an unreadable one, or a prompt with a half-written draft all count
  as "busy". The event is already in the inbox and the next round will see it anyway.
- **30 s debounce.** Three closures in a row produce one notice, not three.
- **An `ack` never deletes.** It transitions to `seen` with its `seen_at`, just like the capture
  inbox and the integration queue. Only entries ALREADY SEEN are evicted by FIFO (cap
  50); unseen ones are never evicted.

The lane is chosen with `orchestrator.nudges` in `~/.kodo/config.json`:

| Value | What it does |
|---|---|
| `inbox` (default) | Persists the event and types the one-line notice only if the orchestrator is idle |
| `keystroke` | Restores the previous behaviour for session closure: types the long text, bypassing the inbox |
| `off` | Persists the event and **never types**. Turns off the notice, not the memory |

The "New session launched" notice **never goes back to the keyboard in any mode**: when the
launch is done by the orchestrator itself with `kodo launch`, notifying it meant announcing
something it had just executed. It still enters the inbox to cover launches from the
dashboard or the dispatcher.

What does **not** change: `kodo check`, which launches an orchestrator when there is none. That is
the real alarm clock — the absent-operator case — and it is a different path from this one.

### `kodo integrate` — the integration queue

Every session ends up asking for something different: this branch is a fast-forward, that one deserves
a merge commit, this one needs a look first. That information used to travel only in the ephemeral
nudge from the Stop hook: if you did not act right then, it was lost and you ended up reviewing session
by session from memory. (The same reasoning later led to the orchestrator inbox, above:
persist instead of typing.)

Now, **when a session closes whose branch has commits that are not in any other reference**
(the same calculation that decides whether to keep the branch), kodo persists an entry in
`~/.kodo/state.json`. A session that closes already merged leaves nothing behind.

```bash
kodo integrate                    # the pending queue, in one block
kodo integrate --all --json       # including the trace of what is already resolved, as JSON
kodo integrate KODO-26 --ff       # fast-forward (fails if not possible)
kodo integrate KODO-26 --merge    # explicit merge commit (--no-ff)
kodo integrate KODO-26 --pr       # prepares the branch and RETURNS the ready-to-run gh command
kodo integrate KODO-26 --drop     # discards the entry without touching the branch
kodo integrate KODO-26 --merge --test 'npm test'   # test suite before integrating
```

```
ref     · rama             · commits · base · sugerido · edad · estado
KODO-26 · worktree-5b1f809 · 3       · sí   · merge    · 2h   ·
KODO-24 · worktree-ae91f22 · 1       · NO   · merge    · 3d   ·
```

**The suggestion is a suggestion.** It comes out of a simple, visible heuristic, and it is confirmed
by whoever integrates:

| What the branch touches | Suggestion |
|---|---|
| Documentation and tests only | `ff` |
| `src/` with nothing sensitive | `merge` |
| Migrations, auth, billing, credentials, or a diff over 400 lines | `pr` |
| Non-inspectable diff (no resolvable base, or merge commits only) | `review` |

The **base** column is `merge-base` in one word: `sí` means the branch contains the whole base;
`NO` means `main` moved underneath while the session was working. With `NO` (or with `?`, not
verifiable) `ff` is **never** suggested — `git merge --ff-only` would fail.

What this command does **not** do, by contract:

- **It never runs `git push` and never creates PRs.** `--pr` validates the branch, marks the entry and
  prints the `git push … && gh pr create …` ready for you to paste. Publishing is still yours.
- **It never switches branches.** If the repo is not on the base, it aborts with exit code 1 and tells
  you; it does not `switch` behind your back.
- **It never deletes the branch** after integrating (that belongs to cleanup, which already knows how
  to verify) **and never deletes the entry** from the queue: once resolved it keeps its `status`,
  `action`, `sha` and `outcome` as a trace, just like the inbox.
- **It never integrates on top of a dirty worktree.** That is the first precondition it checks.

Exit codes: `0` the action ran · `1` it failed (dirty worktree, base not checked out, merge
rejected, test suite red) · `2` incorrect usage or a ref that is not pending in the queue. Only
`0` takes the entry out of pending.

Every action — `--drop` included — also leaves an NDJSON line in
`~/.kodo/logs/integrate.ndjson` with `{action, task_ref, branch, sha, outcome}`, on success and on
failure. That is the permanent record of what was executed; if the log is not writable, the action
proceeds anyway.

The listing makes **not a single** git call: everything was computed when the session closed and lives
in `state.json`, so the orchestrator can present the whole queue on every round for free. The
dashboard reflects it as `N por integrar` in the header, and `kodo status` lists the block.

### `kodo doctor` — config ↔ projects alignment

The dashboard lists **every** project in the Plane workspace with the `projects.json` mapping
overlaid, but the daemon only dispatches webhooks for the projects present in
`config.providers.<provider>.projects`. A project that is **mapped but not configured** looks
operational and yet all its webhooks die with `No configured project ... UNKNOWN`.

`kodo doctor` cross-checks the two files and reports the misalignment (exit code 1 if there are problems):

- **mapped but not in config** (ERROR): its webhooks will die with `UNKNOWN` → add it to `config.json`.
- **in config but with no local path** (WARN): the launch will fail to resolve the path → map it.
- **`UNKNOWN` identifier** / **duplicate paths** (WARN): config noise.

`--states` additionally queries the API and verifies that every configured project has the
`trigger` / `review` / `done` states (by exact name, case-insensitive) — the second failure of the
SCP case: without the `In review` state, closing the flow also fails. The dashboard's project editor
(`m`) marks each row **⚡ dispatch** (in config) or **⚠ solo-mapeado** (mapped-only — the trap).

`--identifiers` queries the API and compares the `identifier` cached in `config.json` with the real
one from the provider. Renaming a project in Plane leaves the cache stale and the ref ends up pointing
at a project that does not exist there (`ITROMAN-1` for what Plane calls `ITCLIP`). The provider
already realigns itself on every `init()` — the ref always comes from Plane's identifier — but this
check makes the divergence persisted on disk visible so it can be fixed with `kodo config`.

## GitHub as a provider

kodo can also operate against GitHub Issues (no webhook: polling built into the daemon).

```bash
# In ~/.kodo/.env
GITHUB_TOKEN=ghp_...
```

Set `provider: "github"` via `kodo config`. The trigger is issues labelled `kodo`; when finished, the session reports with a comment and the review state is closing the issue.

## Orca as a client

Besides [cmux](https://cmux.dev), kodo can run its sessions in
[Orca](https://www.onorca.dev). The client is chosen with **a single key** in
`~/.kodo/config.json`:

```bash
kodo config --set host=orca        # 'cmux' (default) | 'orca'
kodo config --set orca.binary=/usr/local/bin/orca
```

It is a property of the **installation**, not of the project or the task: one kodo
points at one client, the same way it points at a single cmux binary. There is no migration —
existing installations stay on cmux without touching anything.

### What changes with Orca

| | cmux | Orca |
|---|---|---|
| Unit of work | tab (`workspace:N`, recycled ref) | worktree (`<repoId>::<path>`, stable ref) |
| git isolation | `claude --worktree` → `.bg-shell/<id>` | created by Orca in `~/orca/workspaces/<repo>/<slug>` |
| Session state | tab colour (Amber/Blue/…) | board column (`in-progress`/`in-review`/…) |
| kodo marking | `set-description` | card comment |
| Name | free-form title | git branch → slugified; the human title goes to `--display-name` |

With Orca, kodo does **not** emit `claude --worktree`: the isolation is already provided by Orca
itself when it creates the worktree. You will see it in the log as `worktree_skipped_host`.

**Orca worktrees are not deleted automatically.** With cmux, kodo creates
`<repo>/.bg-shell/<id>` and cleans it up when the session closes. With Orca the checkout is *your*
workspace — it has its card on the board and its branch — so kodo does not touch it: it is where
you review the work when the agent finishes. You close it yourself, from the app or with
`orca worktree rm`. No kodo code path runs that command, and there is a test that fails
if anyone wires it in.

Board columns are adjusted the same way as cmux colours:

```bash
kodo config --set orca.statuses.review=in-review
```

### Switching client with live sessions

Every session records which client it was launched under. That is what allows switching `host`
to **leave alone** the sessions of the previous client: their workspaces do not appear in the
new client's snapshot, and without that stamp kodo would read them as "tab gone" and
downgrade them to idle/dead while they are perfectly alive. Absence of evidence is not
evidence of death: they stay intact until you go back to their client.

Sessions launched before v0.19 do not carry the stamp and are evaluated as before.

### Switching client with a live orchestrator

If you switch `host` while `kodo orchestrate` is running, the previous client's orchestrator is
left **out of reach** of the new one: its workspace does not appear there, and
that absence is *structural* — it does not mean it has died. kodo does **not launch another one
on its own**: two supervisors over the same `state.json` dispatch the same task twice,
step on each other's inbox and duplicate comments in the provider.

```
[kodo] Orchestrator registrado en … pertenece al host 'cmux' y el host activo es
'orca' — NO se lanza otro.
[kodo]   Desde 'orca' no puedo ver si sigue vivo. Si el orquestador de 'cmux' está
abierto, ciérralo; después: kodo orchestrate --force
```

The decision is yours because you are the only one who can look at the other client. Check that
the previous one is closed and launch the new one with `--force`.

### Known limits (v0.19)

Orca does not expose some things in its CLI that cmux does, and kodo degrades **fail-open** in
all of them — nothing aborts a launch:

- **System notifications**: Orca has no `notify`. Stuck-session warnings come out only through
  the console and the dashboard.
- **Sidebar groups**: Orca organises by lineage (parent/child, folders), not by named
  groups. `kodo sidebar doctor` does not apply.
- **Adopting ad-hoc sessions** (`kodo adopt` from the dashboard's discovery): requires
  Claude Code's `session_id`, which cmux publishes in
  `surface resume show` and Orca does not. Explicit adoption by ref still works.
- **The daemon's own marking**: `kodo server` renames and colours its tab based on
  `CMUX_WORKSPACE_ID`, which only exists inside cmux. With Orca the block is skipped —
  it is daemon cosmetics, not session lifecycle.
- **`needs-input`**: derived from Orca's `agents[].state` (`done` = the agent
  finished its turn and is waiting). It requires the agent hooks: enable them with
  `orca agent hooks on`; without them sessions are never marked as "waiting".

## Configuration

```bash
kodo config --show                                  # show current configuration
kodo config --set claude.max_parallel=5             # concurrent sessions (default 3)
kodo config --set claude.default_model=opus         # model for work sessions
kodo config --set claude.orchestrator_model=fable   # orchestrator model (default fable)
kodo config --set server.idle_threshold_min=5       # minutes before considering a session idle
kodo config --set server.stuck_threshold_min=30     # minutes before considering a session stuck
```

### Plane API rate limit

Plane limits to **60 requests/minute** per API key by default. kodo caches
states, labels and modules (TTL 5 min) and retries with exponential backoff (cap
8s, with random jitter so that several sessions do not retry at the same time) on
429, transient 5xx and network errors, but with several concurrent projects you
can exhaust the quota. On a self-hosted Plane, raise it in the `.env` of the
`api` container:

```env
API_KEY_RATE_LIMIT=300/minute
```

## Multi-node topology

By default the server listens on **`127.0.0.1`** (loopback): the network surface
stays closed unless you deliberately open it. To receive the webhook
from another machine, expose the bind consciously:

```bash
kodo config --set server.bind=100.x.y.z   # e.g. your Tailscale IP
```

Exposing the bind is an **explicit opt-in** and must come with an ACL or
firewall restricting who can reach port `:9090` (Tailscale ACLs,
`pf`/`ufw`). Do not leave `0.0.0.0` without access control in front of it.

### Local tooling follows the bind

`kodo up` and `kodo dashboard` derive which host to connect to from
`server.bind` itself, so a bind to a specific interface works as is:

| `server.bind`            | where the daemon listens | what `up` / `dashboard` connect to |
| ------------------------ | ------------------------ | ---------------------------------- |
| absent (default)         | `127.0.0.1`              | `http://localhost:<port>`          |
| `0.0.0.0` / `::`         | all interfaces           | `http://localhost:<port>`          |
| `100.x.y.z` (Tailscale)  | `100.x.y.z`              | `http://100.x.y.z:<port>`          |

Connecting to an IP assigned to this same machine never leaves the kernel, so the
dashboard is just as fast as it is against loopback. **There is no need to bind to
`0.0.0.0` or to add firewall rules just so the dashboard can talk to the
daemon**, and `kodo status` never touches the network at all (it resolves by PID).

`--url` is reserved for what the bind does not describe: pointing the dashboard at a
daemon running on **another** machine.

```bash
kodo dashboard --url http://100.x.y.z:9090
```

Exposure does **not** relax authentication:

- The non-webhook lane (the API the TUI consumes) still requires the **bearer token**
  (`KODO_API_TOKEN`) in the `Authorization` header — without a token it answers `401`.
- `/webhook` keeps its **HMAC** verification with the webhook secret.
- `/health` stays open (health probe without auth).

> **Note — the token always goes in a header.** There is no route that accepts it as a query
> param: `?token=` existed only for the web dashboard, which has been retired. If you suspect
> it has leaked, delete the `KODO_API_TOKEN` line from `~/.kodo/.env` (it is regenerated on
> startup) and restart (`kodo stop && kodo up`).

Starting with `server.bind` set to `0.0.0.0` or `::` prints a warning in the startup
logs (`kodo logs`) reminding you that the port is exposed on every
interface. It is a reminder, not a block: the opt-in is still yours.

### HTTP layer limits

`/webhook` is the only open route with cryptographic work behind it (it verifies the
HMAC of every payload), so it carries its own limits, applied **before** spending
CPU on the signature:

| Limit                        | Value           | Response |
| ---------------------------- | --------------- | -------- |
| Requests to `/webhook`       | burst of 30, 1/s sustained **per IP** | `429` + `Retry-After` |
| `Content-Type` on `/webhook` | `application/json` only (or `…+json`) | `415` |
| Body size                    | 1 MB            | `413` |
| Header size                  | 8 KB            | `431` |

The rate limit is a token bucket in the daemon's own memory, with no persistence:
restarting clears the counters. The other three limits are static.

> **Watch out for a reverse proxy in front.** The limit is applied per source IP, and
> behind a proxy every delivery arrives with the proxy's IP: the bucket becomes
> a single one shared by all traffic. If you expose kodo behind nginx/Caddy, put the
> rate limit on the front end (which does see the real IP) instead of relying on this one.

None of the four affects the bearer lane the TUI consumes.

## Supervision: watchdog + orchestrator

Two separate levels: mechanical (0 tokens) and cognitive (LLM).

### Watchdog (`kodo check`)

A pure script that reviews system state — stuck sessions, tasks in
"In Review" awaiting approval, pending tasks with free slots — and launches
the orchestrator **only if it detects something that requires judgement**.

```bash
kodo check              # review and act
kodo check --dry-run    # report only
```

### Orchestrator (`kodo orchestrate`)

A supervising Claude Code session: it reads the screens of active sessions via
cmux, evaluates tasks in "In Review" and decides whether they move to "Done", unblocks
stuck sessions, launches new tasks if there are slots, and documents its decisions in
Plane. From the dashboard it is focused with the `O` key.

It **always starts with `fable`** (`claude.orchestrator_model`), independently of the
model used by work sessions (`claude.default_model`, Opus by default): its
job is to supervise and dispatch, not to implement. Change it with
`kodo config --set claude.orchestrator_model=opus` or from the dashboard's
editor (`e` → "Modelo del orquestador").

Its skill (`.claude/skills/kodo-orchestrate/`) accumulates knowledge across
sessions: API quirks, discovered mappings, validated processes. Before
closing, the orchestrator updates the skill and the stop hook auto-commits the
changes — but only in the orchestrating session (marked with the `KODO_ORCHESTRATOR`
env var) and scoped to the `.claude/skills/kodo-orchestrate/` pathspec,
so that the next session starts with all the previous context without
dragging along other staged changes.

## Progress visibility

Everything is documented in Plane as comments, without opening cmux:

- **During the session** — Claude comments its plan at the start, intermediate milestones and a final summary.
- **On close** — at the real close of the session (`/exit`), the `SessionEnd` hook runs a mechanical backstop: if the task is still in progress it moves it to "In Review" and comments the automatic closure together with the session handoff (the active session has usually done this already; the backstop only covers the gap).
- **If the session dies without closing** — closing the tab, a kill or a reboot do not fire `SessionEnd`, so the backstop never runs. The server's orphan sweep detects the dead session and, if the task is still in "In Progress", comments the incomplete closure with the last known handoff. It does **not** change the state: kodo cannot know whether the work was finished. A task is never left in progress with no trace — it either closes, or it is marked as incomplete.
- **With the orchestrator active** — supervision rounds that document the observed state.

## Architecture

| Module | What it does |
|---|---|
| `src/server.js` | HTTP server on `:9090` — webhook (HMAC) + authenticated JSON API |
| `src/daemon/` | Daemon lifecycle (`kodo up/stop/status`, `daemon run` for launchd) |
| `src/triggers/` | Event dispatch: webhook (Plane), polling (GitHub) |
| `src/providers/` | Plane and GitHub clients (REST, normalisation, states) |
| `src/cmux/` + `src/host/` | cmux CLI wrapper: workspaces, screens, colours |
| `src/session/` | Session manager, state store (`~/.kodo/state.json`), reconciliation loop, orphan-session sweep |
| `src/hooks/` | SessionStart (injects task context), Stop (lightweight per-turn state: idle + lock released) and SessionEnd (backstop "In Review" + terminal cleanup + colour/notify/event to the orchestrator inbox on real close) |
| `src/integration/` | Integration queue: capture on session close, tier heuristic and store over `state.json` |
| `src/orchestrator/` | Orchestrator launch + its prompt |
| `src/cli/dashboard/` | TUI dashboard (Ink/React) |

## Files

```
~/.kodo/
├── .env               # PLANE_API_KEY, PLANE_WEBHOOK_SECRET, KODO_API_TOKEN
├── config.json        # provider, states, server, claude
├── projects.json      # provider project → local path
├── state.json         # active sessions + orchestrator registration (`.orchestrator`) + integration queue (`.integration_queue`)
├── inbox.md           # quick captures (plain markdown, hand-editable)
├── inbox.lock         # advisory inbox lock (ephemeral: released on exit)
├── plans/             # per-task action plans
└── logs/              # per-session NDJSON logs
```

## Session state in the client

With `host: cmux` — tab colour:

| Colour | Meaning |
|---|---|
| Amber | Session running |
| Blue | In review |
| Green | Completed |
| Crimson | Error |
| Indigo | kodo service / orchestrator |

With `host: orca` — board column (`orca.statuses`):

| Column | Meaning |
|---|---|
| `in-progress` | Session running (and errors too: Orca has no failure column, and hiding the card exactly when it needs looking at would be worse) |
| `in-review` | In review |
| `completed` | Completed |

## Tests

```bash
npm test
```

## License

MIT
