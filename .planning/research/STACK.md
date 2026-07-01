# Stack Research

**Domain:** Node.js CLI — unified daemon entrypoint (`kodo up`) + OS-service distribution (Homebrew / launchd) + dashboard-first onboarding with masked secret entry (v0.15 «kodo up»)
**Researched:** 2026-07-01
**Confidence:** HIGH

## Headline

**Zero new runtime dependencies are required for v0.15.** Every new capability is met with (a) Node built-ins already in use, (b) the daemon primitives already shipped in `src/cli/polling.js` + `src/cli/polling-daemon.js`, (c) the in-house ink text-input already shipped in v0.14 (Phase 63), and (d) two *non-npm* distribution artifacts: a Homebrew **formula** (Ruby) that lives in a **tap repo**, not in `package.json`. The only unavoidable "new tech" is the Homebrew formula file itself — it is not a dependency of kodo, it is packaging metadata.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js built-in `node:net` | ships with Node ≥20 | Port-in-use detection for idempotent `kodo up` (attach vs spawn) | The one primitive `polling.js` lacks. `net.connect(port)`→ECONNREFUSED means free; a successful connect means the daemon (or something) already holds the port. Zero deps, deterministic. |
| Node.js built-in `node:child_process` (`spawn` + `detached` + `unref`) | ships with Node ≥20 | Self-detach mode of the `up` daemon | Already the exact pattern in `polling.js` (`spawn(process.execPath, [KODO_BIN, …], { detached:true, stdio:['ignore', logFd, logFd] }); child.unref()`). Reuse verbatim. |
| Node.js built-in `node:fs` PID-file trio | ships with Node ≥20 | Single-instance daemon guard | Already implemented as `writePidFile`/`readPidFile`/`removePidFile`/`getPidPath` in `src/cli/polling-daemon.js` + `isPidAlive` in `src/gsd/lock.js`. Generalize to a `kodo up` daemon PID (`~/.kodo/kodod.pid`) distinct from `server.pid`/polling PID. |
| Homebrew **formula** (Ruby DSL) | Homebrew ≥4.x service DSL | `brew install kodo` + `brew services start kodo` | Modern Homebrew renders the launchd plist *for you* from a `service do … end` block. You never hand-write a `.plist`. `depends_on "node"` (no bundling). |
| launchd (via `brew services`) | macOS system | Supervises the foreground daemon | `brew services` writes `~/Library/LaunchAgents/homebrew.mxcl.kodo.plist` and loads it. launchd is the supervisor; `keep_alive` handles restart. |
| In-house ink text-input (existing) | v0.14 Phase 63 code | Masked API-key field | Already has cursor/backspace/controlled-value. Add a `mask` render option (show `*` per char, never echo/store the raw back to any surface). No new dep. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| *(none)* | — | — | **No supporting npm library is needed.** Every candidate is explicitly rejected in "What NOT to Use". |

### Development / Distribution Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| A Homebrew **tap** repo (`kintsugi-lab/homebrew-kodo` or `alexnunez/homebrew-tap`) | Ships the formula outside homebrew-core | `brew tap <owner>/kodo && brew install <owner>/kodo/kodo`. Personal/low-notability tools do **not** qualify for homebrew-core (notability + maintenance gates). A tap is the correct vehicle and is fully first-class for `brew services`. |
| `brew audit --new --strict <formula>` + `brew style` | Lint the formula before publishing | Cheap CI gate on the tap repo. **Note:** audit does *not* catch the "process self-daemonizes under launchd" bug — that is manual UAT. |

## The four questions, answered

### (a) Homebrew formula for a Node CLI

**Decision: `depends_on "node"` (NOT bundling Node), install to `libexec`, symlink into `bin`, distribute via a personal tap.**

Canonical install stanza (verified against Homebrew's *Node for Formula Authors* doc):

```ruby
class Kodo < Formula
  desc "Automated Claude Code sessions from task-management systems"
  homepage "https://github.com/kintsugi-lab/kodo"
  url "https://github.com/kintsugi-lab/kodo/archive/refs/tags/v0.15.0.tar.gz"
  sha256 "…"
  license "MIT"

  depends_on "node" # NOT bundled — matches package.json engines ">=20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  service do
    run [opt_bin/"kodo", "up", "--foreground"]  # see (b) — MUST be foreground
    keep_alive true
    log_path       var/"log/kodo.log"
    error_log_path var/"log/kodo.log"
    working_dir    var  # cosmetic; kodo reads ~/.kodo absolutely
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kodo --version")
  end
end
```

Notes that matter:
- `std_npm_args` (no `prefix: false`) is the CLI-app form; it installs the package + deps into `libexec` and puts executables in `libexec/bin`. `prefix: false` is only for the library/multi-step case — do not use it here.
- `bin.install_symlink libexec.glob("bin/*")` exposes `kodo` on `PATH` while keeping `node_modules` isolated in `libexec` (no global pollution).
- **Native addons:** kodo has none (pure JS deps: commander, ink, react, picocolors). So you do **not** need `depends_on "python" => :build`. If a future dep pulls `node-gyp`, add that line.
- **Tap vs core:** ship in a tap. homebrew-core has notability + maintenance gates a personal tool won't clear, and core review is slow. A tap loses nothing for `brew services`.

### (b) `brew services` / launchd plist for the long-running daemon

**Decision: use the modern `service do … end` DSL (never hand-write a plist). The `run` command MUST invoke kodo in a foreground-supervised mode that does NOT self-daemonize.**

- Modern Homebrew (≥4.x) generates `homebrew.mxcl.kodo.plist` dynamically from the `service` block; `def plist` is legacy/deprecated. Don't write raw XML.
- launchd runs the daemon as a **simple/foreground** process and *is itself the supervisor*. **If the kodo daemon forks-and-parent-exits (self-detach) under launchd, launchd sees the parent die, considers the service crashed, and with `keep_alive` restarts it in a tight loop.** This is the single highest-risk pitfall of the milestone.
- Therefore the daemon needs the exact double-mode already precedented by `polling.js`:
  - **`kodo up` (default, no brew):** parent process self-detaches — `spawn(detached:true) + unref()` a child running the foreground daemon, write PID, then attach the ink dashboard as a viewer. (Mirrors `runPollingStartCli` daemon branch.)
  - **`kodo up --foreground` (launchd / `brew services`):** the process runs server+polling **in-process** and **blocks forever** (`await new Promise(() => {})`), cleaning up on SIGTERM/SIGINT. NO spawn, NO detach, NO PID-file spawn dance (launchd owns supervision). (Mirrors `runForegroundPolling`.)
- DSL fields you need (verified in Homebrew's `Homebrew::Service` API):

  | Field | Value for kodo | Why |
  |-------|----------------|-----|
  | `run` | `[opt_bin/"kodo", "up", "--foreground"]` | argv array form (no shell); foreground mode. |
  | `keep_alive` | `true` (or `keep_alive crashed: true` to restart only on non-zero exit) | Restart the daemon if it dies. Hash forms: `always`/`successful_exit`/`crashed`/`path`. |
  | `run_type` | leave default `:immediate` | Long-running service, not `:interval`/`:cron`. |
  | `log_path` / `error_log_path` | `var/"log/kodo.log"` | launchd does not inherit your terminal; capture stdout/stderr like `polling.js` does with its `0o600` fd. |
  | `working_dir` | `var` or `Dir.home` | kodo reads `~/.kodo` absolutely, so this is cosmetic. |
  | `environment_variables` | usually **omit** | See secrets note below. |

- **Secrets under launchd (critical):** launchd does **not** inherit shell-exported env vars (`PLANE_API_KEY`, `GITHUB_TOKEN`, `KODO_WEBHOOK_SECRET_*`). kodo already loads `~/.kodo/.env` at runtime via `config.js`, so the daemon still gets its secrets — **keep it that way**. Do NOT pass secrets through `environment_variables` in the plist (they'd be world-readable in `~/Library/LaunchAgents/*.plist`). This dovetails with the masked-input feature: onboarding writes the key to `~/.kodo/.env`, and the launchd daemon reads it from there.
- **Windows:** launchd/brew don't exist. Keep the documented constraint: Windows → foreground only (`kodo up --foreground`), same refuse-with-guidance stance `polling.js` already takes for its daemon branch.

### (c) Masked / hidden secret input in the terminal

**Decision: extend the EXISTING in-house ink text-input (v0.14 Phase 63) with a `mask` render mode. Do NOT add `ink-text-input`.**

- `ink-text-input` *does* support masking — `<TextInput mask="*" />` renders `*****` — and the deprecated `ink-password-input` just wraps that. So the capability is trivial and well-precedented.
- **But you already own an equivalent component** (v0.14 shipped a controlled in-house text-input with cursor + backspace, wired to `writeFileAtomic`). Adding `ink-text-input` now would be a redundant 5th runtime dep for a feature you can satisfy with a ~10-line render tweak, and it would fragment the input pattern the config/project editors already use.
- Implementation shape (mirrors the v0.15 text-input pattern):
  - Keep the real value in controlled state exactly as today.
  - Render `'*'.repeat(value.length)` (or bullet `•`) instead of the raw chars; keep the cursor logic.
  - Security boundary (respect PERSIST-04 / the existing `.env` invariant): the masked value is written to `~/.kodo/.env` and is **never** rendered back, never echoed into `/status`, never logged, never placed in the poll snapshot. On re-entering setup, show a placeholder like `•••• (set)` rather than the stored key — same "secrets are write-only from the UI" rule the dashboard already follows.
- No new dep. This honors "NO new deps preferred" cleanly.

### (d) Process-management primitives beyond `polling.js`

`polling.js` + `polling-daemon.js` already provide: `spawn` detached + `unref`, PID-file write/read/remove, `isPidAlive` liveness, stale-PID cleanup, and SIGTERM→5s→SIGKILL stop. **The only genuinely new primitive is port-in-use detection**, needed to make `kodo up` idempotent (attach the dashboard if the daemon already runs, instead of double-spawning / colliding on the server port).

| Primitive | Status | Source |
|-----------|--------|--------|
| Detached spawn + `unref` | ✅ exists | `polling.js` daemon branch — reuse |
| PID file (write/read/remove/path) | ✅ exists | `polling-daemon.js` — generalize to `~/.kodo/kodod.pid` (distinct from `server.pid`) |
| PID liveness | ✅ exists | `isPidAlive` in `gsd/lock.js` |
| Stop: SIGTERM + wait + SIGKILL | ✅ exists | `runPollingStopCli` — reuse pattern for unified `kodo stop` |
| Bounded-wait for daemon readiness | ✅ pattern exists | `polling.js` polls the PID file for 2s; adapt to poll the port |
| **Port-in-use detection** | ⚠️ NEW (built-in) | `node:net` — `net.connect(port,'127.0.0.1')`: `connect`→in use, `ECONNREFUSED`→free. Zero deps. |
| Attach-vs-spawn decision | ⚠️ NEW logic (no dep) | Compose PID-alive + port-listening: alive+listening → attach dashboard; stale PID → clean + spawn; nothing → spawn. |

Guidance:
- Use **one** authoritative daemon PID file for the combined server+polling daemon (`~/.kodo/kodod.pid`). Don't reuse `server.pid` (owned by the legacy `kodo start` foreground server, which stays intact per the milestone LOCK).
- Prefer the **PID-file + liveness** check as the primary idempotency guard (process-identity, not just "something holds the port"), and use port detection as the secondary signal to decide "is the HTTP server actually up yet" before attaching the dashboard (bounded-wait loop, exactly like `polling.js`'s 2s PID-file poll).
- `kodo stop` unified: read `kodod.pid`, SIGTERM the daemon (its in-process SIGTERM handler already tears down `startServer` + polling via existing `cleanup()` handlers in `server.js`/`polling.js`), 5s wait, SIGKILL fallback, remove PID. Under launchd, `brew services stop kodo` sends the signal instead — the same in-process cleanup fires.

## Installation

```bash
# Runtime deps: NONE added. package.json dependencies stay exactly:
#   commander ^13, ink ^6.8, react ^19.2, picocolors ^1.1
# (ink/react remain lazy-imported so non-dashboard commands stay light.)

# Distribution (end users), via the tap:
brew tap kintsugi-lab/kodo
brew install kodo            # depends_on node ≥20
brew services start kodo     # launchd supervises `kodo up --foreground`

# Non-brew users:
kodo up                      # self-detaches the daemon + attaches the dashboard
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `depends_on "node"` | Bundle a Node runtime (`node --sea`, `pkg`, `nexe`) | Only if you must ship to machines without Node and can't require the `node` formula. Adds tens of MB + a build pipeline; overkill for a Homebrew audience that can take `depends_on node`. |
| Homebrew `service do` DSL | Hand-written launchd `.plist` (`def plist`) | Never for new formulae — `def plist` is legacy. Only relevant when reading old formulae. |
| Personal tap | homebrew-core submission | If kodo later gains broad notability and you want `brew install kodo` with no tap. Not now. |
| Extend in-house ink input with `mask` | `ink-text-input` `mask="*"` | If the in-house component were missing/immature. It isn't (v0.14). Reach for `ink-text-input` only if you decide to replace the in-house component wholesale — a separate decision, not this milestone. |
| `node:net` port probe | `detect-port` / `get-port` npm pkgs | Never here — a ~10-line `net.connect` probe removes the need for a dep. |
| Self-detach via `spawn detached`+`unref` | `pm2`, `forever`, `daemonize` | Never — heavyweight external supervisors that duplicate launchd (mac) and the existing PID pattern. The whole point of `--foreground` is to let launchd/brew be the supervisor. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Self-daemonizing (fork+parent-exit) **under launchd** | launchd supervises the process it starts; if the parent exits, it marks the service crashed and `keep_alive` restart-loops it | A `--foreground` mode that blocks and cleans up on SIGTERM — launchd is the supervisor |
| `def plist` raw XML | Deprecated; brittle across `/usr/local` vs `/opt/homebrew` prefixes | `service do … end` DSL (Homebrew renders the plist) |
| Passing secrets via plist `environment_variables` | Plist is a plaintext file in `~/Library/LaunchAgents/`; launchd env is also fragile | Keep secrets in `~/.kodo/.env`; kodo already loads it at runtime |
| Relying on shell-exported env under launchd | launchd does NOT inherit your interactive shell env | Read `~/.kodo/.env` in-process (already done) |
| `pm2` / `forever` / `nodemon` for the daemon | External process managers duplicate launchd + the existing PID/spawn pattern; new dep | Reuse `polling.js` spawn/PID primitives + launchd |
| `ink-text-input` / `ink-password-input` as a new dep | Redundant 5th runtime dep; fragments the input pattern | Extend the v0.14 in-house ink text-input with a mask render |
| `detect-port`, `get-port` | Trivially replaced by `node:net` | `net.connect` ECONNREFUSED probe |
| Bundling Node into the formula | Bloat + build pipeline for zero benefit to a brew audience | `depends_on "node"` |
| Reusing `server.pid` for the `up` daemon | Collides with the untouched legacy `kodo start` foreground server | A dedicated `~/.kodo/kodod.pid` |

## Stack Patterns by Variant

**If installed via Homebrew (`brew services start kodo`):**
- Entry = `kodo up --foreground`; launchd supervises; `keep_alive true`; logs to `var/log/kodo.log`.
- No PID-file spawn dance — launchd owns the lifecycle. `brew services stop` sends SIGTERM → existing in-process cleanup fires.

**If run directly (`kodo up`, no brew):**
- Parent self-detaches the daemon (`spawn detached + unref`), writes `~/.kodo/kodod.pid`, bounded-waits for the port, then attaches the ink dashboard as a viewer.
- `kodo stop` = SIGTERM via PID + 5s + SIGKILL (reuse `runPollingStopCli` shape).

**If Windows:**
- No launchd/brew. `kodo up --foreground` only; refuse the detached daemon with guidance (same stance `polling.js` already takes).

**If already running (any platform):**
- PID alive + port listening → **attach dashboard, do not spawn** (idempotency). Stale PID → clean + spawn. Nothing → spawn.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `depends_on "node"` (formula) | `package.json engines >=20.0.0` | Homebrew `node` tracks latest (≥22); satisfies the ≥20 floor. If a dep ever breaks on latest, pin `depends_on "node@22"`. |
| Homebrew `service do` DSL | Homebrew ≥2.7 (`process_type`) / stable in ≥4.x | Full DSL (`keep_alive` hash forms, `run_type`) is stable in current Homebrew. No version risk for a 2026 install. |
| ink `^6.8` + react `^19.2` | in-house masked input | Same components already render the v0.14 config editor; mask is a render-only change, no ink/react bump. |
| `node:net` / `node:child_process` | Node ≥20 | Stable built-ins; no compatibility concern. |

## Sources

- [Homebrew: Node for Formula Authors](https://docs.brew.sh/Node-for-Formula-Authors) — install stanza (`std_npm_args`, `libexec`, `bin.install_symlink`), `depends_on "node"`, native-addon Python note — HIGH
- [Homebrew::Service Ruby API](https://docs.brew.sh/rubydoc/Homebrew/Service.html) — service DSL fields, `keep_alive`/`run_type` syntax, foreground/no-self-daemonize requirement — HIGH
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook) — formula structure, tap vs core, service block — HIGH
- [Homebrew/brew Services System (DeepWiki)](https://deepwiki.com/Homebrew/brew/11.2-services-system) — how `brew services` generates/consumes the launchd plist — MEDIUM
- [ink-text-input (npm)](https://www.npmjs.com/package/ink-text-input) + [vadimdemedes/ink-text-input](https://github.com/vadimdemedes/ink-text-input) — `mask="*"` prop confirmation (used only to justify the in-house extension) — HIGH
- [vadimdemedes/ink-password-input](https://github.com/vadimdemedes/ink-password-input) — deprecated in favor of `TextInput mask` — HIGH
- Existing kodo source (`src/cli/polling.js`, `src/cli/polling-daemon.js`, `src/server.js`, `src/cli.js`, `package.json`) — daemon/PID/spawn/stop primitives to reuse, engines floor, current 4-dep runtime — HIGH

---
*Stack research for: Node CLI unified daemon + Homebrew/launchd distribution + masked TUI secret entry (v0.15)*
*Researched: 2026-07-01*
