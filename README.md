# kodo 心動

[![tests](https://github.com/kintsugi-lab-sca/kodo/actions/workflows/tests.yml/badge.svg)](https://github.com/kintsugi-lab-sca/kodo/actions/workflows/tests.yml)

Automated Claude Code sessions driven from your kanban board. Move a task to "In Progress" → kodo launches [Claude Code](https://claude.ai/code) in a [cmux](https://cmux.dev), [Orca](https://www.onorca.dev) or [BB](https://github.com/get-bb/bb) workspace → when it finishes, the task comes back as "In Review".

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

Requires **Node ≥ 22** and a terminal client. Which client, which install route and which
supervisor depend on the platform:

| Platform | Terminal client | Install | Service |
|---|---|---|---|
| **macOS** | [cmux](https://cmux.dev) or [Orca](https://www.onorca.dev) | `brew install kodo` | launchd — `brew services start kodo` |
| **Linux** | [Orca](https://www.onorca.dev) — cmux ships for macOS only | `npm install -g` from a tag | systemd user unit — `kodo install --systemd` |
| **Windows** | — | out of scope | out of scope |

**Which Node is actually tested.** CI runs the whole suite on **Node 22 and Node 24**, on both
Linux and macOS — four jobs, `.github/workflows/tests.yml`. 22 is the floor `engines` declares
(supported until 2027-04-30); 24 is the active LTS, i.e. what `nvm install --lts` gives you
today. **Node 26 is not tested**: `engines` accepts it because the range is open-ended, but
nothing verifies it until 26 becomes LTS on 2026-10-28, at which point it joins the matrix.
This is not pedantry — the suite has already failed on a runtime it was not tested on (three
tests broke under Node 20, one of them for no reason other than the Node version).

Note that `brew install kodo` depends on Homebrew's `node`, which tracks the newest release
line and can therefore be ahead of the matrix. `brew install node@24` first if you want the
runtime CI actually tests.

Linux is not a lesser tier: the daemon, the provider lane and the session lifecycle are the
same code. What it loses is cmux, and with it the cmux-only features (tab colour, sidebar
groups, `surface resume` adoption) — the very same set a macOS machine loses if it picks
Orca. See [Orca as a client](#orca-as-a-client).

> **Linux trap: `orca` is not Orca.** Outside macOS the Orca binary is **`orca-ide`**; plain
> `orca` is GNOME's screen reader. Pointing kodo at it does not fail with `ENOENT` — it
> launches a different program and you get to debug that instead. Hence the factory defaults
> on non-darwin (`src/platform-defaults.js`): `host = "orca"`, `orca.binary = "orca-ide"`,
> and `xdg-open` instead of `open`. You should not have to set any of them. Check the binary
> with `which -a orca-ide orca`, and if yours lives elsewhere:
> `kodo config --set orca.binary=/absolute/path/to/orca-ide`.

**Windows is a decision, not a gap.** The three paths that would spawn a detached daemon
handle `win32` explicitly and up front: `kodo up` runs in the foreground instead
(`src/cli/up.js`), and `kodo polling start` (`src/cli/polling.js`) and `startDaemon`
(`src/daemon/lifecycle.js`) refuse with a message naming the alternative. None of them
crashes; none of them is on the roadmap.

### Homebrew — macOS (recommended)

```bash
brew tap kintsugi-lab-sca/kodo
brew install kodo
```

### npm + systemd — Linux

```bash
npm install -g github:kintsugi-lab-sca/kodo#v0.24.0
kodo install --systemd   # user unit in ~/.config/systemd/user, enabled and started
```

Step-by-step guide for Pop!_OS / Ubuntu 22.04 (Node, Orca, the `orca` vs `orca-ide` trap, the
service, and troubleshooting): **[`packaging/linux/README.md`](packaging/linux/README.md)**.

If this is the *second* machine on the same board, read
[Multiple operators on the same project](#multiple-operators-on-the-same-project) (who owns a
task) and [Polling instead of a webhook](#polling-instead-of-a-webhook) (no tunnel, no
per-machine webhook) before starting the service. Together they are the whole second-operator
setup, and on Linux they are the recommended one.

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
- `PLANE_WEBHOOK_SECRET`: you get it when creating the webhook (step 4). **Optional** if you use
  [polling](#polling-instead-of-a-webhook) instead — the daemon then starts with `/webhook` disabled.
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
| `kodo:review` | Adversarial review: after the work session closes, a second session reviews the same branch and can only write under `review/` |

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

> 💡 No public URL for this machine? Skip this step entirely and use
> [polling](#polling-instead-of-a-webhook) — `kodo config --set polling.enabled=true`. It is the
> recommended setup on Linux and for a second operator: no tunnel, no per-machine webhook, no
> shared HMAC secret.

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

You can also leave it as a service that starts automatically:

```bash
brew services start kodo      # macOS (launchd)
kodo install --systemd        # Linux (systemd user unit)
```

Both supervise the same process, `kodo daemon run`. On Linux, `kodo status`, `kodo up` and
`kodo stop` are systemd-aware: `stop` stops the unit (a SIGTERM would just make
`Restart=always` bring it back) and `up` starts the unit instead of spawning a daemon systemd
does not know about.

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

`d` only works on dead rows and asks for confirmation (press `d` again). The table refreshes
itself every 2.5s, but a dismiss does not wait for that tick: as soon as the `DELETE` returns,
the dashboard polls `/status` immediately — so the row disappears at once, and if the server
rejected the dismiss because the session came back to life, the table shows it alive right away
instead of keeping a stale dead row on screen.

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
kodo oracle              # mechanical oracle: what kodo itself verified on each branch (run <REF>)
kodo review              # adversarial review cycles (--all, --json; start <REF>, commit)
kodo config              # configuration wizard / --show / --set key=value
kodo launch <REF>        # launches a task manually (e.g. KL-42)
kodo check               # watchdog: reviews state and launches the orchestrator if needed (0 tokens)
kodo orchestrate         # launches the orchestrating session (spends tokens)
kodo adopt               # adopts an ad-hoc cmux session as a tracked task
kodo comment <REF>       # posts a summary comment on an existing task
kodo logs [session-id]   # inspects session logs (dump, tail, filter)
kodo doctor              # diagnoses config.json ↔ projects.json alignment (--states, --identifiers, --operator, --json)
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
(`state.orchestrator_inbox`): session closures with their verdict and their `NEXT:`, launches,
and the two notices the daemon raises on its own —
[integration pressure](#integration-pressure--the-notice-when-the-queue-grows) and
[recycle-suggested](#recycling-the-orchestrator).

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

**If the branch is gone by the time the queue is written, kodo brings it back first.** When you
leave a `--worktree` session, Claude Code's "Remove worktree" prompt runs `git branch -D` on the
session branch without checking whether it still held work — the commits survive as unreachable
objects until the next `git gc`, and the queue entry that follows would point at a branch that no
longer exists, with every column `null`. The Stop hook seals the branch tip's SHA on every turn
while the worktree is still alive, so the close can recreate the branch from it before measuring
anything. You will see it in the log as `worktree.branch.restored` (a warning, not an info: the
work is saved, but needing to save it is worth grepping for). A branch whose work already lives
somewhere else is not resurrected.

```bash
kodo integrate                    # the pending queue, in one block
kodo integrate --all --json       # including the trace of what is already resolved, as JSON
kodo integrate KL-42 --ff       # fast-forward (fails if not possible)
kodo integrate KL-42 --merge    # explicit merge commit (--no-ff)
kodo integrate KL-42 --pr       # prepares the branch and RETURNS the ready-to-run gh command
kodo integrate KL-42 --drop     # discards the entry without touching the branch
kodo integrate KL-42 --merge --test 'npm test'   # test suite before integrating
```

```
ref     · rama             · commits · base · sugerido · oráculo · edad · estado
KL-42 · worktree-5b1f809 · 3       · sí   · merge    · pass    · 2h   ·
KL-7 · worktree-ae91f22 · 1       · NO   · merge    · —       · 3d   ·
```

The `oráculo` column is the [mechanical oracle](#kodo-oracle--the-mechanical-oracle)'s verdict,
which sits **beside** the suggestion and never replaces it: they are two different readings of the
same branch — a heuristic about what it *touches*, a fact about what *passes* — and you need both
to decide. `—` means nobody has verified this branch, and it looks nothing like a `pass`.

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

#### Integration pressure — the notice when the queue grows

The dispatcher launches up to `claude.max_parallel` sessions **without looking at this queue**, so
nothing said out loud that a new branch was being opened on a repo that already has branches
waiting. Parallel branches on the same tree conflict, and the way you find that out is orphan
commits and a recovery merge by hand.

Now, at launch time, kodo counts the `pending` entries whose `project_path` is the target repo and,
if there is at least one, says so through **two surfaces you already watch**. The dispatcher's lane:

```
[kodo:dispatch] integration_pressure — KL-42 va a un repo con 3 entradas pending en la cola de integración (/path/to/repo); se lanza igualmente
```

…and an `integration-pressure` event in the [orchestrator inbox](#kodo-inbox-orch--the-orchestrator-inbox),
which the round already reads in its step 1 and which — unlike the daemon's stdout — survives the
process.

**It is a notice, never a block.** Two branches on the same repo are the normal case, not the
anomaly: blocking would break the parallelism that is the whole point of kodo, and a gate that gets
in the way ends up switched off. What was missing was not a permission, it was a look. There is no
threshold to tune and no flag to turn it off — one pending entry is enough, and it costs one line
per launch.

The rest of the contract, all of it load-bearing:

- **Zero git calls.** The count comes out of the `integration_queue` block of `state.json`, the same
  one the listing above reads. Asking git how many branches are unmerged would cost a
  `for-each-ref` per launch *and* would answer a different question: branches that exist are not
  branches somebody asked to integrate.
- **Empty queue ⇒ nothing at all.** With zero pending entries it returns before touching stdout or
  the inbox, so the usual launch path is byte-identical to what it was before this existed.
- **Fail-open, end to end.** A queue that cannot be read counts as a queue with no pressure, and a
  failure to log or to enqueue is swallowed. A notice able to abort a launch would be exactly the
  block this forbids.
- **Only on the paths that actually launch** — first launch and relaunch after a stale cleanup, both
  *after* the cross-process dedup lock. The loser of a race leaves through `already_active` without
  launching, so warning it would be noise.
- **The repo match is exact string equality** on `project_path` — the same criterion that gives an
  entry its identity and that matches sessions to their repo. A third definition of "same repo"
  disagreeing with the other two would be worse than a notice that fails to fire.

### `kodo oracle` — the mechanical oracle

Until now the hard verdict on a session's work was whatever **the session said**: "suite green",
"lint passes", "docs only". A judge grading itself. And the failure mode is not deliberate lying —
it is the session that ran the suite twenty turns ago, kept touching code, and closed remembering
that green.

The oracle runs the verification **itself**, on the branch, after the session has closed, and
persists the result in the same integration-queue entry. The signal stops being a sentence on
screen and becomes evidence with a commit, a timestamp and an exit code. It is 100% deterministic,
which is why it lives in the CLI and **never** in the orchestrator's prompt: an LLM asked "do the
tests pass?" will answer, and its answer is not verifiable.

```bash
kodo oracle                     # the verdict for every branch in the queue
kodo oracle KL-42               # the five checks of one entry, with detail
kodo oracle KL-42 --json        # the block as-is, scriptable
kodo oracle run KL-42           # run it now and persist the verdict
```

```
ref     · rama             · veredicto · checks (build/tests/lint/schema/scope) · commit
KL-42 · worktree-5b1f809 · pass      · —✓——✓                                  · 8f1c0a2b
KL-7  · worktree-ae91f22 · fail      · —✓——✗                                  · 3d90fe11
```

**Five checks, four states each.** `build`, `tests`, `lint` and `schema` come from commands you
configure per repo. `scope` needs no command at all — it compares the branch's real diff against
the scope the task declared.

| State | Glyph | Meaning |
|---|---|---|
| `pass` | `✓` | the check ran and came out clean |
| `fail` | `✗` | the check ran and came out red |
| `unknown` | `?` | it **was** asked for and could not be determined (timeout, missing binary, uninspectable diff) |
| `skip` | `—` | this repo did not ask for this check |

The third state is the point. `unknown` **is not** `pass`: nothing unverified is ever painted
green. The fourth (`skip`) is what makes the whole thing usable — without it, a repo that only
configures `tests` would sit at `unknown` forever and you would switch the feature off in a week.
The difference between them is exactly the one that matters: `skip` is "I did not ask you",
`unknown` is "I asked you and you do not know". The first does not lower the verdict; the second
does.

The aggregate verdict is `fail` if anything failed, `unknown` if anything was asked and left
undetermined (**five `skip`s included** — an oracle that verified nothing is not a `pass`), and
`pass` only when at least one check ran and none failed. So:

> **`pass` means "everything it was asked to check passed". It does not mean "everything is
> fine".** Exactly what a green CI badge means. That is why `kodo oracle <REF>` always prints all
> five rows: whoever reads `pass` can see, on the same screen, what was checked and what was not.

**Diff-scope — the check nobody else runs.** `build`/`tests`/`lint` answer "is the artifact
healthy?", a question the repo already knows how to answer on its own. Scope answers one nothing
answers today: **did this branch touch what it said it would?** That is what catches scope creep,
the auth file that slipped into a docs change, the migration nobody announced.

The source of the scope is **declared, never inferred** — an invented scope produces a `fail`
nobody can defend, and a check that cries wolf gets switched off. The session declares it in its
own plan (`~/.kodo/plans/<task_id>.md`), and the session prompt already asks for it:

```markdown
<!-- kodo:scope v=1 -->
- src/integration/**
- test/oracle-*.test.js
<!-- /kodo:scope -->
```

The dialect is deliberately small: `*` (within a segment), `**` (across separators), `?` (one
character), and a trailing `/` meaning "everything under here". No braces, no character classes,
no negation — each one adds a way to get the declaration wrong, and `**` covers almost everything.
The plan is append-only, so the **last** block wins: the scope in force is the one the session
that just closed declared. No block at all ⇒ `skip`.

**Configuration is per repo, and lives in your config — never inside the repo.**

```jsonc
// ~/.kodo/config.json
"oracle": {
  "enabled": true,
  "timeout_s": 600,
  "repos": {
    "/Users/you/dev/kodo": {
      "setup":  "npm ci --silent",   // optional: prepares the freshly created worktree
      "tests":  "npm run test:raw",
      "build":  null,
      "lint":   null,
      "schema": null
    }
  }
}
```

Per repo and not universal on purpose: Rails, Django, Node and a repo of plain HTML with no tests
live on the same machine, and no single `npm test` covers the four. The key is the **absolute
path**, matched by exact string equality — the same criterion that gives a queue entry its
identity and that the integration-pressure notice uses to decide "same repo".

Why the config and not a versioned `.kodo/oracle.json` inside the repo, which would be more
convenient: these are commands kodo runs **by itself**, in a detached process, when a session
closes. Reading them from a file in the working tree would turn "check out a branch" into "run
whatever that branch says". Your config lives outside every repo and only you edit it.

`setup` is **not** a check — it is the precondition that makes the checks mean anything (a
freshly created worktree has no `node_modules`, no `vendor/bundle`, no `.venv`). If it fails, the
four commands come out `unknown` and **not** `fail`: an `npm ci` that cannot reach the registry
says nothing about whether the tests pass.

The rest of the contract, all of it load-bearing:

- **`SessionEnd` launches, it never runs.** The hook spawns `kodo oracle run <REF>` detached and
  returns. Running it inline would put an `npm ci && npm test` *inside* the session close —
  minutes of hook blocking Claude Code, with the session's worktree about to be deleted three
  lines later.
- **Its own disposable worktree.** The runner does `git worktree add --detach` on the branch's
  commit, runs there, and destroys it — even when a command fails. It never touches your checkout,
  never switches branches, never stashes. `--detach` because the branch may be checked out
  elsewhere: the oracle verifies a *commit*, not a name.
- **The verdict is anchored to a commit.** A verdict without one means nothing — the branch is
  alive and can gain work. If the branch moves, the result is *stale*, and a re-capture of the same
  branch clears the block outright: a green verdict must never describe code nobody verified.
- **The listing costs nothing.** Zero git calls, zero execution — everything comes out of
  `state.json`, like `kodo integrate`. That is what lets the orchestrator show it on every round,
  and what guarantees its round **never** runs a suite.
- **Fail-open end to end.** A spawn that does not happen, a worktree that cannot be created, a
  config that will not load: all of them leave `unknown` or `null` (nobody verified this), never a
  crash and never a close that hangs.

#### The optional gate: `--require-oracle`

```bash
kodo integrate KL-42 --ff --require-oracle
```

**Never blocking by default**, and that is not a concession: a gate that gets in the way with
flakies ends up switched off, and a switched-off gate is worse than none because it also gives the
false impression that something is watching. Without the flag the verdict is simply *presented* —
the `oráculo` column in `kodo integrate`, the detail in `kodo oracle` — and you decide with it in
front of you.

With the flag, it closes in every case that is not a `pass` anchored to the branch tip: `fail`,
`unknown`, no oracle at all, a run still in flight, and a `pass` that verified an older commit. It
does **not** apply to `--drop`, the only action that does not advance the branch — gating the
emergency exit would leave you with no way to clear a branch the oracle cannot verify.

Each closed gate leaves its `integrate.action` NDJSON line with a greppable `outcome`
(`oracle-missing`, `oracle-running`, `oracle-failed`, `oracle-unknown`, `oracle-stale`,
`oracle-unanchored`) and **never** takes the entry out of `pending`.

### `kodo review` — the adversarial reviewer

A session that verifies its own work is a judge grading itself. `kodo:review` adds a **second
pair of eyes**: after the work session closes, a separate session reviews the same branch and
**can only write under `review/`**.

**Opt-in, never the default.** Each review doubles the cost of a task. Its place is high
blast-radius work — migrations, auth, concurrency primitives — the Tier 3 of your merge policy.

**The write restriction is mechanical, not a promise in the prompt.** The reviewer's commit
carries the pathspec `review/` in **both** `git add` and `git commit`, gated on a
`KODO_REVIEWER=1` marker that only its own session carries — the same mechanism that gates the
orchestrator's skill auto-commit. A reviewer that edits `src/` keeps the edit in its working
tree and gets told it was excluded; nothing outside `review/` reaches the commit. That is the
guarantee that it **writes the finding instead of quietly patching it**.

**The artifacts, and how the core reads them without an LLM:**

```
review/approval.md                             # satisfied — stop
review/recommendations/NNN-recommendations.md  # a round of "Things To Address"
```

Both carry a frontmatter with `branch` and `commit`, and both are load-bearing: `commit`
anchors the review to a state of the code, `branch` says which task the artifact belongs to
(artifacts travel in the tree, so once a reviewed task merges, every later branch inherits its
`review/`). The state is read **from the branch** — `git show <branch>:review/approval.md`, not
from the working tree — so the answer does not depend on what happens to be checked out.

From that, `kodo review <REF>` derives:

| State | Meaning | Confidence reported |
|---|---|---|
| `approved` | `approval.md` anchored at the reviewed head | `reviewed` |
| `changes-requested` | a recommendations round is open | `changes-requested` |
| `stale-approval` | it was approved, then code changed | `stale` |
| `none` / `malformed` | no artifact, or unreadable | `unreviewed` (fail-closed) |

That confidence is what `kodo review <REF>` prints (`confianza`, and `confidence` under `--json`).
It is a reading for whoever integrates, **not** something `kodo integrate` consumes: the queue
neither shows it nor changes its suggestion because of it.

The anchor is **not `HEAD`** but the last commit touching anything *outside* `review/`. That is
what lets the reviewer's own artifact commit not invalidate its approval, while any new coder
commit invalidates it immediately. No LLM is consulted at any point.

**The loop has a cap.** `review.max_rounds` (default `3`) bounds the coder ↔ reviewer
conversation. On the last round without approval — or if the reviewer closes writing *nothing*,
or leaves an unreadable artifact — the cycle **escalates** to the orchestrator inbox. It ends by
approval or by escalation, never in silence.

```
kodo review                 # open cycles (escalated ones show WITHOUT --all)
kodo review KL-42           # review state derived from the artifacts
kodo review start KL-42     # launch the reviewer on that branch
kodo review commit          # the REVIEWER's close: pathspec commit + report of what was excluded
```

`commit` is also what **evaluates the cycle**: it derives the state from the branch, applies the
disposition (approve / back to the coder / another pass / escalate) and reports it. It runs the
evaluation even when there was nothing to commit — a reviewer that closes writing nothing is the
`no-artifact` case, and it must escalate rather than pass unnoticed.

`start` provisions its own worktree with `git worktree add <path> <branch>` — a **checkout of the
existing branch**, not `claude --worktree`, which would create a new one. Because git refuses two
worktrees on one branch, a still-live coder session surfaces as `branch-busy` instead of a
collision: review runs *after* the work, not alongside it.

Exit codes: `0` done · `1` git or host failed · `2` unresolvable ref, or `commit` run outside a
reviewer session.

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

`--operator` re-asks the provider who owns the API key and refreshes the cached identity used by the
assignee filter (see below). Run it after rotating the key or switching accounts. If it cannot
resolve the identity it exits 1 and says so out loud, because a daemon with no identity silently
falls back to launching *anyone's* tasks.

## Multiple operators on the same project

Two people running kodo against the same Plane projects receive **the same webhooks**. Before
`dispatch.require_assignee`, every label or state change launched the session on **both** machines:
`claude.max_parallel` and `state.json` do not help — they are per-machine, and each machine believes
the work is its own.

The rule that splits the work is the one already on the board: **a task is eligible for this daemon
only if its assignees include the user who owns the API key it signs with.**

```jsonc
// ~/.kodo/config.json
{
  "dispatch": { "require_assignee": true },     // default
  "providers": {
    "plane": {
      // Resolved automatically from GET /users/me on the first init() and cached here.
      "operator": { "id": "<user uuid>", "display_name": "alex" }
    }
  }
}
```

It applies to the three paths that can start a session — webhook, pending-task resolver
(`kodo check`), and `kodo launch` — so what the daemon launches and what it reports as pending can
never disagree.

| Task | Result |
|---|---|
| Assigned to you | Launches |
| Assigned to someone else | `dispatch.decision action=ignored code=assigned_to_other` |
| Assigned to you *and* someone else | Launches (sharing a task is not exclusive) |
| **Unassigned** | Nobody launches it: `dispatch.skipped reason=unassigned` |

The unassigned case is the point, not an oversight: while no one has claimed a task, no machine
takes it, which is exactly what stops the double launch and what pushes you to assign it. To run it
anyway from the machine you are sitting at, use `kodo launch <ref> --force` — the same escape hatch
as the `kodo` label.

**Fail-open by design.** If the identity cannot be resolved (`/users/me` down, nothing cached yet),
the filter lets everything through — the pre-existing behaviour. A network blip must not leave a
daemon launching nothing. Check it with `kodo doctor --operator`.

**Single operator?** `kodo config --set dispatch.require_assignee=false` restores the old behaviour
exactly, and you never have to assign anything to yourself.

**GitHub.** The contract is the same over the issue's `assignees` (matched by **login**), but there
is *no* auto-detection: the GitHub provider's `init()` is a deliberate no-op, so the identity is
declared once by hand and, without it, the filter stays inert.

```jsonc
{ "providers": { "github": { "operator": { "id": "<your github login>" } } } }
```

## Blocked tasks stay blocked

kodo has no dependency graph of its own, and it does not need one: the board already models the
relation. Before launching, the dispatcher asks the provider for the task's relations. If it has a
`blocked_by` pointing at work items that are **not** in a terminal state, no session starts.

```
[kodo:dispatch] dispatch.skipped reason=blocked_by_open — KL-42 bloqueada por KL-7
```

It also leaves the reason **on the task** as a comment naming the open blockers — the log alone is
not where you will look when you wonder why a task never started. One comment per *set* of
blockers, not one per polling tick.

The task's state is never touched. Every `ignored` verdict in the dispatcher is read-only, and
moving a blocked task back to Todo would fight the operator who dragged it into In Progress by
hand.

| Situation | Result |
|---|---|
| `blocked_by` with an open blocker | `dispatch.decision action=ignored code=blocked_by_open`, plus a comment |
| `blocked_by`, all blockers Done/Cancelled | Launches |
| No relations | Launches |
| Provider without the capability | Launches — **identical path, zero extra API calls** |

### When the blocker closes

**On polling: automatic.** A blocked verdict does *not* count as a consumed dispatch, so the tick
cursor is held below the blocked task and every tick re-evaluates it. The tick after the blocker
closes, the task launches. Nothing to click.

The price is stated plainly: while a task stays blocked, the cursor does not advance past it, so
each tick also re-evaluates the pending tasks that are newer than it. Those are the ones
`listPendingTasks` already returns (trigger state, `kodo` label, assigned to you) — a handful — and
the ones with a live session exit at the `already_active` guard. This is the same mechanism the
polling lane already uses for any unconfirmed dispatch.

**On a webhook-only setup: not automatic.** Closing the blocker fires a webhook for the *blocker*,
not for the blocked task, and Plane does not touch the blocked task's `updated_at` when a related
item changes. So nothing wakes it. Give it any nudge that produces an event on the task itself — a
label toggle, an edit, moving it out of and back into In Progress — or run
`kodo launch <ref> --force`. If this matters to you, [turn polling on](#polling-instead-of-a-webhook);
webhook and polling are a supported combination.

**Cost.** One `GET /relations/` per launch, plus one read per blocker. Blockers are rare and the
zero-blocker case exits on the first call. The gate runs *after* the label, state and assignee
gates, so a task that was going to be skipped anyway never pays for it — and `--force` skips it
entirely.

**Fail-open, and where it stops.** If the `/relations/` call itself fails, the task launches,
exactly as before this existed — a flaky API must not leave a daemon launching nothing. But a
single *blocker* that cannot be read (deleted, no permission) does **not** disable the gate: it
counts as **open**, and the other blockers are still resolved normally. The board asserted the
block; failing to prove it was resolved is not the same as it being resolved.

**GitHub.** GitHub Issues has no native `blocked_by`, so its provider does not implement
`listBlockers` and the gate is inert there by construction — not disabled by a flag, absent.

**Turn it off:** `kodo config --set dispatch.respect_blockers=false` restores the previous
behaviour exactly.

## Polling instead of a webhook

A webhook needs a URL Plane can reach. On a laptop that means a tunnel (cloudflared, Tailscale),
an HMAC secret, and **one webhook per machine** registered in Plane. For a second operator that is
setup friction and network surface for no gain.

Polling removes all of it: the daemon asks Plane every `interval_s` seconds for the work items that
are in the trigger state, carry the `kodo` label, and are **assigned to the owner of the API key it
signs with**, and passes the new ones through the same `dispatchTrigger` the webhook uses.

```bash
kodo config --set polling.enabled=true
kodo config --set polling.interval_s=60   # optional, this is the default
```

```jsonc
// ~/.kodo/config.json
{
  "polling": {
    "enabled": true,     // ask Plane instead of waiting to be told
    "interval_s": 60,    // seconds between ticks
    "catch_up": false    // see below
  }
}
```

No second daemon and no second command: the loop is an in-process timer inside `kodo daemon run`,
which is what `kodo up`, `brew services start kodo` and a systemd user unit already launch. Nothing
else to start, nothing else to supervise.

**Latency.** Moving an assigned task to *In Progress* starts the session within `interval_s`. That
is the whole trade: a webhook is instant, polling is bounded.

**Webhook and polling at the same time is fine.** They are not exclusive and you do not have to
turn one off: the same task seen by both lanes launches **once**, guarded by the per-`task_id`
dedup lock and the active-session check. Keeping the webhook where it works and polling where it
does not is a supported topology, not a workaround.

**No webhook secret needed.** `KODO_WEBHOOK_SECRET_<PROVIDER>` only verifies the HMAC signature of
incoming webhooks. With `polling.enabled` and no secret configured, the daemon starts with the
`/webhook` route **disabled** — any `POST` to it gets a `503` — and says so once on startup:

```
[kodo] webhook disabled: polling mode, no secret configured
```

Everything else is unaffected: `/status` and the TUI (bearer token), dispatch by polling, dismiss
and comments all work the same. Set the secret and the webhook lane comes back, coexisting with
polling. With **neither** a secret nor polling there is no lane at all, and the daemon still exits
with 1 on startup. `--insecure` (plus `KODO_ALLOW_INSECURE=1`) is unchanged and remains the only
way to accept **unsigned** webhooks.

**The first tick does not replay your backlog.** kodo keeps a watermark per project
(the `updated_at` of the last item it saw) in `~/.kodo/polling-state.json`, so a tick only looks at
what changed. The first time it observes a project it records the watermark **without launching
anything** — otherwise enabling polling on a board with a dozen tasks already in progress would
start a dozen sessions at once. To deliberately pick up what is already there:

```bash
kodo config --set polling.catch_up=true   # permanent (systemd, brew services)
kodo daemon run --catch-up                # one-off, the flag wins over the config
```

Catch-up is inert once a project has been observed; it only ever affects that first tick.

**Rate limit.** One request per tick, not one per project — `listPendingTasks` already walks every
configured project. A 5xx does not kill the loop: `PlaneClient` retries with exponential backoff and
jitter, the polling loop retries on top of that (2s/4s/8s, bounded), and if it still fails the
watermark is left untouched so the next tick sees the same work again.

**Linux / Pop!_OS.** This is the recommended setup for a second operator: **no tunnel, turn on
polling.** You do not need to publish a port, register a webhook in Plane, or share an HMAC secret —
only an API key and `polling.enabled`. The `kodo` bind can stay on `127.0.0.1`.

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

The `orca.binary` above is the **macOS** default. Outside macOS the factory default is
**`orca-ide`** — `orca` there is GNOME's screen reader, and kodo pointed at it launches that
instead of failing. Do not copy the path from this snippet on Linux; see the
[Installation](#installation) note.

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

## BB as a client

[BB](https://github.com/get-bb/bb) is the third client. Unlike cmux and Orca it is **not a
terminal**: it does not open a shell where kodo types `claude …` — it launches Claude Code
through the Agent SDK on a *thread* of its own. Everything else is the same single key:

```bash
kodo config --set host=bb          # 'cmux' (default) | 'orca' | 'bb'
kodo config --set bb.binary=bb     # resolved through PATH by default
kodo config --set bb.server_url=http://127.0.0.1:38886
```

### What changes with BB

| | cmux | Orca | BB |
|---|---|---|---|
| Unit of work | tab (`workspace:N`, recycled ref) | worktree (`<repoId>::<path>`) | thread (`thr_…`, stable ref) |
| git isolation | `claude --worktree` → `.bg-shell/<id>` | Orca's worktree | `thread spawn --new-environment worktree` |
| How the prompt arrives | typed into the shell | typed into the shell | `thread spawn --prompt` |
| Who owns the `--session-id` | kodo | kodo | **BB** (see below) |
| Session state | tab colour | board column | no channel (kodo's dashboard only) |
| End of session | human closes the tab | human closes the tab | kodo runs `bb thread stop` |

Like Orca, BB brings its own worktree, so kodo does **not** emit `claude --worktree`
(`worktree_skipped_host` in the log).

### The two things that are genuinely different

**BB owns the session id.** kodo generates a `--session-id` for every session and matches its
hooks against it. BB does not accept one: it generates its own. What kodo *does* control is the
thread id, which BB exports into the child process as `BB_THREAD_ID`. So `SessionStart` falls
back to that variable, finds the session by its `workspace_ref`, and **rewrites** the stored
`session_id` with the real one (event `session.rebind`). From that point on `Stop` and
`SessionEnd` match by `session_id` with no special casing. Without `BB_THREAD_ID` the hook
still exits silently — the fallback never fires on its own.

**Sessions close themselves.** When a turn ends BB leaves the thread `idle` with the `claude`
process still alive, and `SessionEnd` only fires on `bb thread stop`. So kodo runs that stop
itself: once a session has been idle, with no pending interaction, for longer than the grace
period, the reconcile loop stops the thread and the existing close path takes over (cleanup,
handoff, "In Review" backstop, orchestrator nudge). It is logged as `session.autoclose`.

```bash
kodo config --set bb.idle_close_grace_s=90   # default 90 s
```

A session with a **pending interaction is never closed**, however long it waits: the agent is
holding a question for you. `bb thread stop` only releases the runtime — it does not archive the
thread and does not touch the worktree, so the `bb/…` branch stays under kodo's integration
gate (merged → deleted; not merged → kept). Reopening is just `bb thread tell`, which resumes
the thread.

### Requirements

BB is an **optional runtime dependency**: kodo does not bundle it and nothing breaks if it is
absent — it is only needed when `host: bb`. It ships as an npm package with native addons
(`better-sqlite3`, `node-pty`), so install it the way you prefer:

```bash
npx bb-app@latest              # server + CLI, no global install
```

`kodo doctor` checks it **automatically whenever the active host is `bb`** (no flag): that the
server answers at `bb.server_url` and that BB reports `claude-code` as available. Both failures
are invisible from the rest of the system — a launch would create threads that die on startup —
so they exit with code 1.

### Known limits

- **No presentation channel**: BB has neither cmux's tab colour nor Orca's board column, so
  `setStatus`/`setColor`/`setDescription` are documented no-ops. Session state lives in kodo's
  dashboard and in the provider.
- **Adopting ad-hoc sessions**: same reason as Orca — BB does not publish Claude Code's
  `session_id` in its CLI. Explicit adoption by ref still works.
- **Sidebar groups**: BB organises by sections, an axis kodo does not model. `kodo sidebar
  doctor` does not apply.
- **One provider — and it overrides `kodo:oc`**: kodo always spawns with
  `--provider claude-code`. BB's other providers (codex, cursor, pi) do not emit the hooks
  kodo's whole lifecycle depends on. Because BB launches the agent itself, the agent labels
  have nothing to select: a task labelled `kodo:oc` on `host: bb` runs on Claude Code and
  logs `agent_pinned_by_host`. The session record stores what actually runs, not the label —
  otherwise liveness detection would grep for the wrong process.
- **Remote machines** (`--machine`) are out of scope: kodo assumes the worktree is reachable
  on the local filesystem.

## Configuration

```bash
kodo config --show                                  # show current configuration
kodo config --set claude.max_parallel=5             # concurrent sessions (default 3)
kodo config --set claude.default_model=opus         # model for work sessions
kodo config --set claude.orchestrator_model=fable   # orchestrator model (default fable)
kodo config --set server.idle_threshold_min=5       # minutes before considering a session idle
kodo config --set server.stuck_threshold_min=30     # minutes before considering a session stuck
kodo config --set dispatch.require_assignee=false    # launch tasks regardless of assignee (single operator)
kodo config --set review.max_rounds=3               # cap on the coder ↔ reviewer loop (default 3)
kodo config --set polling.enabled=true              # ask Plane instead of waiting for a webhook
kodo config --set polling.interval_s=60             # seconds between polling ticks (default 60)
kodo config --set polling.catch_up=true             # first tick also picks up what was already there
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

`fable` is the alias `claude --model` documents for "the latest Fable", which today
resolves to **Fable 5.1** (`claude-fable-5-1`). kodo keeps the alias rather than pinning
the version, so the orchestrator follows the newest Fable without a config edit. On
OpenCode, which takes `provider/model` identifiers and has no such alias, the pin is
explicit in `agents.registry.opencode.model_map` (`opencode/claude-fable-5-1`); the
orchestrator applies that map exactly like work sessions do.

Its skill (`.claude/skills/kodo-orchestrate/`) accumulates knowledge across
sessions: API quirks, discovered mappings, validated processes. Before
closing, the orchestrator updates the skill and the stop hook auto-commits the
changes — but only in the orchestrating session (marked with the `KODO_ORCHESTRATOR`
env var) and scoped to the `.claude/skills/kodo-orchestrate/` pathspec,
so that the next session starts with all the previous context without
dragging along other staged changes.

### Recycling the orchestrator

A long-lived orchestrator accumulates context it no longer needs. After several days of
rounds, most of its transcript is **historical tool output** — a `state.json` dump from two
days ago, a `read-screen` of a session that closed long since, diffs of already-merged PRs.
The durable state does not live there: it lives in the provider, in `state.json`, in git and
in the NDJSON. Compaction is expensive and lossy — it summarises everything, including what
no longer matters, and drops precisely the hot ids that do.

Recycling is cheaper: a small handoff plus a fresh orchestrator (~15k tokens).

**The handoff.** The outgoing orchestrator writes `~/.kodo/handoff.md` — live sessions,
decisions the operator still owes, hot refs (PRs, branches, tasks in Review), lessons not yet
folded into the skill, and the next concrete action. On the next launch, `kodo` appends that
file to the end of the orchestrator prompt and renames it to `handoff-consumed-<ts>.md`. It is
renamed, never deleted: it is the only copy of the outgoing session's reasoning, and the rename
is what stops the same handoff from being re-injected on every relaunch. If the send to the
workspace fails, the handoff is **not** consumed — the incoming orchestrator never read it.

The file is capped at 32 KB. Above that it is **ignored whole**, not truncated (a half handoff
is worse than none) and left on disk for the operator to look at. The **format is defined by
the `kodo-orchestrate` skill** (§Reciclado), not by the code: `kodo` treats the file as opaque
text — it reads it, bounds it, strips control bytes and appends it.

**The size notice.** There is no API exposing a session's context usage to a hook, so the proxy
is the size of the orchestrator's transcript
(`~/.claude/projects/<cwd-encoded>/<session>.jsonl`). The Stop hook compares it against
`orchestrator.recycle_mb` (default 8 MB) and, on crossing it, leaves a `recycle-suggested`
event in the orchestrator inbox — which then surfaces through the same one-line notice as any
other event. It is a coarse proxy on purpose: it means "you have done enough rounds that it is
worth a look", not "you are at 45%".

The debounce guarantees the event fires **once**, not on every turn: there is never more than
one unseen `recycle-suggested`, and never two within 30 minutes. **When to recycle is the
orchestrator's call** — never mid-integration.

```bash
kodo config --set orchestrator.recycle_mb=16   # later notice
```

The relaunch itself needs nothing new: `kodo check` already launches an orchestrator when there
is none, so the exit ritual is write the handoff → `/exit` → the daemon relaunches on the next
tick with the handoff inside.

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
├── config.json        # provider, states, server, claude, oracle (per-repo verification commands)
├── projects.json      # provider project → local path
├── state.json         # active sessions + orchestrator registration (`.orchestrator`) + integration queue (`.integration_queue`)
├── inbox.md           # quick captures (plain markdown, hand-editable)
├── handoff.md         # handoff from the outgoing orchestrator (consumed on the next launch)
├── inbox.lock         # advisory inbox lock (ephemeral: released on exit)
├── polling-state.json # polling watermark per project/repo (only with polling enabled)
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

With `host: bb` — **no channel**. BB has neither colours nor columns per thread, so kodo does not
invent one: the state lives in kodo's own dashboard and in the provider, and `setStatus` is a
documented no-op.

## Tests

```bash
npm test
```

Conventions for writing them live in [`test/CONVENTIONS.md`](test/CONVENTIONS.md). The one worth
knowing before you touch a test: **pin the contract, never the prose.** Prompts and skills are
markdown that gets rewritten often, and an `includes()` over their wording turns every rewrite into
a red suite with no behaviour changed.

What counts as contract — and stays pinned — is what something else *reads*: template placeholders
(`{{provider_name}}`), CLI command names the prompt has to keep naming, structural markers
(`<!-- kodo:handoff v=1 -->`), MCP call names, labels and statuses the agent emits or filters on,
greppable log literals, and data formats a later step parses. Section headings and prose are not
contract, and a composed heading stops being prose the moment it is exported as a constant the test
imports.

The check that a batch of prompt asserts is right is to bite the file **both ways**: rewrite the
headings and the prose without touching commands, placeholders or markers — the suite must stay
green — and then remove one command, placeholder or marker — it must go red.

## License

MIT
