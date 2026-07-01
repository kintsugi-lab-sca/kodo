# Pitfalls Research

**Domain:** Adding a unified decoupled daemon entrypoint (`kodo up`) + Homebrew/launchd distribution + dashboard-first masked-secret onboarding to an existing Node.js CLI (kodo v0.15)
**Researched:** 2026-07-01
**Confidence:** HIGH (codebase-specific findings verified against `src/cli/polling.js`, `src/cli/polling-daemon.js`, `src/config.js`, `src/server.js`, `src/cli.js`); MEDIUM on launchd/brew-services specifics (no formula exists yet — flagged for spike)

> Scope note: these are pitfalls **specific to grafting these features onto THIS system**, not a generic daemon primer. The recurring theme is that kodo already contains a *mature* daemon pattern (`polling.js`) and a *naive* one (`server.js`), and v0.15 must unify them without regressing the mature one or promoting the naive one.

---

## Critical Pitfalls

### Pitfall 1: Reinventing the daemon instead of reusing the hardened `polling.js` pattern

**What goes wrong:**
`kodo up` gets written from scratch (fresh `spawn`, fresh PID handling) and silently drops one of the six hard-won mitigations already living in `src/cli/polling.js`: `child.unref()` (line 303 — "sin esto el padre cuelga"), the pre-spawn `isPidAlive` + stale-PID cleanup (lines 259-268), the bounded 2s PID-write wait (lines 315-323), the fd-redirect for crash logs (lines 274-275), the absolute-argv spawn (`process.execPath` + `resolveKodoBin()`, no PATH lookup), and the Windows refuse-with-guidance branch (lines 236-240).

**Why it happens:**
The `server.js` daemon path is the one most devs will copy because `kodo up` is "about the server" — but `server.js` uses the *naive* pattern (`writeFileSync(PID_PATH, String(process.pid))`, line 581; no atomic write, no chmod, no stale check, `server.listen` with no error handler). Copying the wrong precedent regresses everything Phase 26/28 fixed.

**How to avoid:**
Extract the daemon-lifecycle primitives from `polling.js`/`polling-daemon.js` into a shared module (`src/cli/daemon.js`) and have BOTH `kodo up` and the polling daemon consume it. Treat `polling-daemon.js` (atomic tmp+rename + `chmodSync(tmp, 0o600)` PRE-rename + defensive shape check + lazy `getPidPath()`) as the reference for the new unified PID file. Do NOT extend `server.js`'s `writeFileSync(PID_PATH, String(pid))`.

**Warning signs:**
New `spawn` call without a matching `.unref()`; a PID file written as a bare integer string instead of the `{pid, started_at, ...}` JSON shape; no `isPidAlive` check before spawn; `server.listen(port)` still lacking a `'error'` handler.

**Phase to address:** Pilar 1 — the `kodo up` daemon-lifecycle phase (first phase of the milestone).

---

### Pitfall 2: Stale PID file after crash/SIGKILL causes permanent "already running" false-positive

**What goes wrong:**
The daemon is SIGKILL'd (OOM, `kill -9`, power loss) so its SIGTERM cleanup never runs and the PID file survives. Next `kodo up` reads the file, and if a naive check only tests file *existence* (`existsSync(PID_PATH)`, the pattern in `server.js` `stopServer`), it refuses to start forever — or worse, PID reuse means the recorded PID now belongs to an unrelated process and `kodo stop` kills the wrong process.

**Why it happens:**
Existence-based checks are the obvious first implementation. The correct liveness check (`isPidAlive` from `src/gsd/lock.js`, already used by `polling.js:261`) is easy to forget when unifying, because `server.js`'s own stop path does NOT do liveness — it just `process.kill(pid)` and unlinks.

**How to avoid:**
Reuse the exact `polling.js` sequence: `readPidFile()` → `isPidAlive(pid)` → if alive, refuse (exit 1); if file present but dead, `removePidFile()` and proceed (lines 259-268). For `kodo stop`, mirror `runPollingStopCli`: SIGTERM → poll `isPidAlive` up to 5s → SIGKILL fallback → cleanup, treating ESRCH as already-dead success (lines 501-519). Consider storing `started_at` (already in the payload shape) and optionally a start-time cross-check to shrink the PID-reuse window.

**Warning signs:**
"already running" when nothing is running; `kodo stop` reporting success but the dashboard still shows a dead server; a `polling.pid`/`kodo.pid` present after a crash with a PID that `ps` doesn't list.

**Phase to address:** Pilar 1 — daemon lifecycle (`up`/`stop`/`status` idempotency).

---

### Pitfall 3: Double-spawn / port-in-use race — `server.listen()` has no error handler today

**What goes wrong:**
Two near-simultaneous `kodo up` invocations (or one `kodo up` while `kodo start` already holds the port) both pass the PID check, both spawn, and the second `server.listen(port)` throws `EADDRINUSE`. Because `server.js:576` registers only a success callback and no `'error'` listener, the error is an **uncaught exception → the child dies immediately**, but the parent's 2s bounded wait may have already seen a transiently-written PID file and reported success (exit 0). The user thinks kodo is up; it isn't.

**Why it happens:**
`server.listen(port, cb)` with only a success callback is the copy-paste default. `EADDRINUSE` only surfaces under real contention, which unit tests rarely reproduce. The existing `kodo start` and the new `kodo up` share the same config port with no mutual exclusion.

**How to avoid:**
(1) Make the PID check the single gate for "is a kodo daemon up?" and have `up` be idempotent: if a live daemon exists, **attach the dashboard instead of spawning** (this is the LOCKED behavior in the milestone: "attach si ya corre, sin doble-spawn"). (2) Add a `server.on('error', ...)` handler that distinguishes `EADDRINUSE` (→ clear message + non-zero exit, do NOT leave a half-written PID file) from other errors. (3) Decide the `up` vs `start` relationship explicitly — `start` is LOCKED as intact/foreground; ensure `up` and `start` can't silently fight over the port (e.g. `up` detects an existing `start` server on the port and attaches rather than erroring cryptically).

**Warning signs:**
Intermittent `EADDRINUSE` in logs; `kodo up` exits 0 but `/health` never responds; two PID files or a PID file whose process isn't listening on the port.

**Phase to address:** Pilar 1 — daemon lifecycle + idempotent attach.

---

### Pitfall 4: Unifying server + polling into one daemon while they have two PID files and two lifecycles

**What goes wrong:**
Today the server (`server.js`, its own `PID_PATH`, plain-string) and the polling daemon (`~/.kodo/polling.pid`, JSON shape) are **independent processes with independent PID files and independent SIGTERM handlers**. `kodo up` promises "arranca el daemon (server + polling)". If they're stapled together naively — e.g. `up` spawns the server which internally spawns polling — you get nested detachment, orphaned polling children when the server dies, and `kodo stop` that kills one but not the other.

**Why it happens:**
The two subsystems were built in different milestones (server pre-v0.7, polling v0.7/v0.8) with no shared lifecycle owner. "Just start both" hides the reaping/ownership question.

**How to avoid:**
Pick ONE process model and make it explicit: either (a) a single daemon process that runs both the HTTP server and the polling loop in-process (polling already runs as an in-process timer loop in `runForegroundPolling` — it does NOT require a separate process), controlled by ONE unified PID file; or (b) a supervisor that owns both children and reaps them together. Option (a) is simpler and matches the "in-process timer loop" reality — strongly preferred. Retire or clearly scope the standalone `polling start` daemon so there aren't two competing PID files. Ensure a single SIGTERM handler tears down both the HTTP server (`stopReconcile` + `server.close`) and the polling handle (`handle.stop()`).

**Warning signs:**
An orphaned polling process after `kodo stop`; two PID files; polling ticks continuing in the logs after the server is stopped; `reconcileTick` (the sole `alive` writer) and the polling loop running in different processes writing the same `~/.kodo` state.

**Phase to address:** Pilar 1 — this is the core architectural decision of the milestone; resolve it in the first phase.

---

### Pitfall 5: Daemon dies silently when the launching terminal closes (detach not actually detaching)

**What goes wrong:**
`kodo up` spawns "in background" but the child keeps the controlling terminal / inherits the parent's stdio, so when the terminal window closes (SIGHUP) or the parent exits, the child receives SIGHUP and dies. The user runs `kodo up`, closes the terminal, and the daemon silently vanishes — but the PID file (if written before death) says it's running.

**Why it happens:**
`spawn(..., { detached: true })` alone is insufficient; you also need `child.unref()` AND stdio must NOT be inherited TTY fds. `polling.js` gets this right (`detached: true`, `stdio: ['ignore', logFd, logFd]`, `child.unref()`) — but a from-scratch `up` implementation can easily inherit stdio (e.g. `stdio: 'inherit'` for "nice output") which re-couples the child to the terminal.

**How to avoid:**
Copy the `polling.js` spawn options verbatim: `detached: true`, stdin `'ignore'`, stdout/stderr redirected to a log fd opened with `openSync(logfile, 'a', 0o600)` (lines 274-302), then `child.unref()`. Never use `stdio: 'inherit'` for the detached child. On macOS/Linux, `detached: true` puts the child in a new process group / session so it survives the parent. Verify empirically by closing the terminal and checking `/health` still responds.

**Warning signs:**
Daemon works while the terminal is open but dies on terminal close; nothing in the logfile after the terminal closed; `ps -o pgid` shows the child sharing the parent's process group.

**Phase to address:** Pilar 1 — daemon lifecycle. Add a UAT step: "close launching terminal, confirm `/health` still responds."

---

### Pitfall 6: The launchd "must run foreground, must NOT self-detach" trap

**What goes wrong:**
`brew services start kodo` runs the plist, which invokes `kodo up`. But `kodo up` self-detaches (spawn + unref) and the launched foreground shim exits 0 immediately. launchd sees the process it started exit right away and — with `KeepAlive` true — **restarts it in a tight crash-loop** (the classic launchd throttle: relaunch every 10s forever). Meanwhile the real detached daemon is running unsupervised, invisible to launchd, and `brew services stop` can't kill it because launchd never tracked its PID.

**Why it happens:**
The exact same command needs opposite behaviors: under `kodo up` (bare shell) it must background itself and return the prompt; under launchd it must stay in the foreground so launchd can supervise it. Developers test `kodo up` interactively (where detach is correct) and only discover the launchd conflict after publishing the formula.

**How to avoid:**
Make the daemon's foreground mode the launchd contract. The plist must invoke the **foreground/supervised** entrypoint (the equivalent of `--no-daemon`, which `polling.js` already distinguishes), NOT `kodo up`. Design an explicit `kodo up --foreground` (or reuse a `kodo daemon --foreground` command) that runs the server+polling loop in the current process, writes NO detached child, installs SIGTERM handling, and blocks. The plist runs that; `kodo up` (bare) self-detaches by calling the same core with detach. This is exactly the double-mode already noted as a target feature ("self-detach para `kodo up` sin brew y foreground-supervisado para launchd").

**Warning signs:**
`brew services list` shows kodo cycling between `started`/`error`; Console.app / system logs show "Service exited with abnormal code" every ~10s; a running daemon that `brew services stop` cannot stop.

**Phase to address:** Pilar 1 — Homebrew/launchd distribution phase. Requires a real `brew services` install test (spike/UAT on macOS), not just unit tests.

---

### Pitfall 7: `node` not found / PATH & environment minimal under launchd

**What goes wrong:**
The plist runs `kodo`, which is a Node shebang script; launchd starts it with a **minimal environment** (typically PATH ≈ `/usr/bin:/bin:/usr/sbin:/sbin`) that excludes Homebrew's node (`/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on Intel) and any nvm/asdf-managed node. The daemon fails with "env: node: No such file or directory" or a shebang failure, and under `KeepAlive` crash-loops.

**Why it happens:**
Interactive shells load `~/.zprofile`/`~/.zshrc` which set PATH; launchd does not. `depends_on "node"` in the formula guarantees node is *installed* but not that the plist's PATH includes its bin dir. nvm-managed node is invisible to the formula entirely.

**How to avoid:**
In the Homebrew formula, generate the plist with an absolute path to the node/kodo binary (Homebrew's `opt_bin`/`Formula["node"].opt_bin`) rather than relying on PATH, or set `EnvironmentVariables.PATH` in the plist to include Homebrew's prefix. Prefer invoking the resolved absolute interpreter (mirrors the `polling.js` security stance of `process.execPath` + absolute `KODO_BIN`, no PATH lookup). Document that nvm/asdf node is unsupported under `brew services` (use the Homebrew node dependency).

**Warning signs:**
Works from the terminal, fails only under `brew services`; system log shows "node: command not found" or "spawn node ENOENT"; the daemon works when started via `kodo up` but not via launchd.

**Phase to address:** Pilar 1 — Homebrew/launchd phase (formula + plist generation).

---

### Pitfall 8: launchd writing PID/logs/state to paths it can't access (or the wrong HOME)

**What goes wrong:**
The daemon writes its PID file, logs, and `~/.kodo/*` state using `homedir()`. `getPidPath()` and `KODO_DIR` resolve `~` at runtime. Under `brew services` running as the **user** agent this is fine, but if the service is ever loaded as a **system** daemon (`sudo brew services`, or LaunchDaemons vs LaunchAgents) `homedir()` becomes `/var/root` (or root's home), so the daemon writes state to a different `~/.kodo` than the one the user configured and the dashboard reads — silent split-brain. Also, `WorkingDirectory`/`StandardOutPath` in the plist pointing at a non-writable path makes launchd fail before kodo even runs.

**Why it happens:**
`homedir()` is correct for the interactive user but launchd's execution identity may differ. The codebase already has a documented HOME-caching hazard (obs. 21811/22683: `config.js` caches `KODO_DIR` at import via `homedir()`), so identity mismatches are pre-existing landmines.

**How to avoid:**
Ship as a **LaunchAgent (per-user)**, not a system LaunchDaemon — this is the `brew services start kodo` (no sudo) default and keeps `homedir()` == the user. Do NOT document `sudo brew services start kodo`. In the plist, set `StandardOutPath`/`StandardErrorPath` to `~/.kodo/logs/` (created with `ensureLogsDir()` mode 0o700, which already exists) and `WorkingDirectory` to a writable path. Verify the daemon's effective `~/.kodo` matches the user's under `brew services`.

**Warning signs:**
Config edited in the dashboard doesn't take effect; two `~/.kodo` directories (one under `/var/root`); launchd fails with a path/permission error before any kodo log line; `brew services` requires sudo to work.

**Phase to address:** Pilar 1 — Homebrew/launchd phase.

---

### Pitfall 9: `brew services` expecting a specific plist label/location

**What goes wrong:**
`brew services` only manages a formula if the formula defines a `service do ... end` block (modern Homebrew) or ships a plist with the canonical label `homebrew.mxcl.<formula>`. If the label/location doesn't match Homebrew's convention, `brew services start kodo` reports success but launchd never actually loads it, or `brew services list` shows `unknown`/`none`. Hand-rolled plists in `~/Library/LaunchAgents` with a custom label are invisible to `brew services`.

**Why it happens:**
There's a legacy path (ship a `.plist` file) and a modern path (Ruby `service do` DSL in the formula). Mixing them, or using a custom label, breaks `brew services`' bookkeeping.

**How to avoid:**
Use the modern `service do` DSL in the formula (`run [opt_bin/"kodo", "up", "--foreground"]`, `keep_alive true`, `log_path`, `error_log_path`, `working_dir`). Let Homebrew generate the plist and label. Do NOT hand-write the plist or pick a custom label. Test the full loop: `brew install` → `brew services start kodo` → `brew services list` shows `started` → reboot/re-login persists → `brew services stop` cleanly stops.

**Warning signs:**
`brew services list` shows kodo as `none`/`unknown`; `brew services start` says started but no process runs; the service doesn't survive logout/login.

**Phase to address:** Pilar 1 — Homebrew/launchd phase. Needs a real install spike (cannot be unit-tested).

---

### Pitfall 10: KeepAlive/RunAtLoad misconfig turning any startup failure into a crash-loop

**What goes wrong:**
With `KeepAlive: true` (or `keep_alive true`), **every** way the daemon can exit non-zero becomes an infinite relaunch loop: missing webhook secret (`server.js:405-408` → `process.exit(1)`), `provider.init()` failure on first run (no API key), `EADDRINUSE`, or an unhandled `listen` error. launchd throttles to ~1 relaunch/10s but never gives up, spamming logs and hammering the provider API.

**Why it happens:**
The current server *intentionally* `process.exit(1)`s on misconfiguration — a sane choice for a foreground CLI, a disaster under KeepAlive. First-run (no config yet) is precisely when the daemon exits 1, and first-run is exactly when a new user installs via brew.

**How to avoid:**
(1) Under the foreground/launchd mode, do NOT `process.exit(1)` on missing config — degrade to "setup needed" state and keep the process alive serving the dashboard's setup mode (ties directly to Pitfall 12's chicken-and-egg fix). (2) Consider `keep_alive { successful_exit: false }` semantics or `RunAtLoad` without aggressive KeepAlive during the onboarding window. (3) Add a fast `/health` that returns "needs-setup" rather than crashing. (4) Ensure `EADDRINUSE` and `listen` errors are handled (Pitfall 3), not thrown.

**Warning signs:**
Log file growing rapidly with repeated startup banners; provider rate-limit warnings firing constantly; `brew services list` flapping.

**Phase to address:** Pilar 1 (launchd) + Pilar 2 (first-run setup state) — these two pillars intersect here; sequence Pilar 2's "setup mode" before or with the launchd KeepAlive work.

---

### Pitfall 11: Leaking the API key into logs / `/status` / process args / scrollback (PERSIST-04 boundary)

**What goes wrong:**
The masked API key entered in the dashboard leaks via one of several concrete channels:
- **Process args (`ps`)**: if the dashboard writes the key by shelling out (`execFile('kodo', ['config', '--api-key', SECRET])`) — the v0.13/v0.14 precedent is to shell out for mutations — the secret appears in the process table and in any command-audit log for the lifetime of the child. **This is the highest-risk vector given kodo's shell-out habit.**
- **NDJSON logs**: if the new `.env` writer or the config-save path logs the value, or if the value transits `saveConfig`/an event.
- **`/status` response**: if the key is ever placed in `config.json` (it must stay in `~/.kodo/.env`) it will be serialized into `/status` and read by the dashboard HTTP client.
- **Scrollback / render**: echoing typed characters, or a footer/confirmation that prints the value, or including it in an immutable overlay snapshot that other overlays (`c`/`l`/`p`) read.
- **`config.json.bak`**: `migrateConfigIfNeeded` writes a backup of the whole config — if a key ever lands in config, the backup leaks it too.

**Why it happens:**
kodo's established mutation pattern is "shell out via execFile" (dismiss, adopt), which is safe for non-secret args but catastrophic for secrets (argv is world-readable). The redactor exists for the *logger* but not for arbitrary render/subprocess paths.

**How to avoid:**
- **Write the key IN-PROCESS to `~/.kodo/.env`**, never via a subprocess argv. This is the one mutation that must break the "shell out" habit.
- Keep the key exclusively in `~/.kodo/.env`; NEVER write it to `config.json` (which flows to `/status`, `.bak`, and the dashboard client).
- Mask at input (render `•`/`*`, never the char); never echo; never place the value in the frozen overlay snapshot the read-only overlays consume.
- Never pass the value to `createLogger`/events; if any diagnostic is needed, log only "api key set for provider X" (name, not value) — mirror `configureGithubProvider` which deliberately asks for the env-var *name*, not the token (polling.js:133-137).
- Add a source-hygiene test (kodo already uses grep/walker guards for color isolation and mode-derivation) asserting the secret variable never reaches `saveConfig`, `console.*`, `logger.*`, or an `execFile`/`spawn` argv.

**Warning signs:**
The key visible in `ps aux` during entry; the key in `~/.kodo/logs/*.ndjson`; the key round-tripping in `/status` JSON; the key in `config.json` or `config.json.bak`; the key echoed in the TUI.

**Phase to address:** Pilar 2 — masked-secret entry phase (CFGF-03). This is the milestone's top security requirement; give it an explicit threat model.

---

### Pitfall 12: First-run chicken-and-egg — the daemon needs config, but config is entered in the dashboard the daemon serves

**What goes wrong:**
`kodo up` on a fresh install: no `config.json` (so `loadConfig()` returns `DEFAULT_CONFIG` — Plane defaults the user never chose), no `~/.kodo/.env` (no API key). The server's startup does `provider.init()` and a webhook-secret check that `process.exit(1)` (server.js:405-408) — so the daemon dies before it can serve the dashboard where the user is supposed to enter the config. The user has no way to bootstrap.

**Why it happens:**
The server was designed assuming config already exists (`ensureConfig` runs the readline wizard for CLI commands, but `kodo dashboard` deliberately skips `ensureConfig`, per PROJECT.md). The onboarding-in-dashboard model inverts the dependency: the daemon must run *before* config exists.

**How to avoid:**
Introduce an explicit **setup state** for the daemon: when config/secret is missing, the daemon starts anyway (does NOT `provider.init()` against a nonexistent key, does NOT exit), serves the dashboard in setup mode, and only initializes the provider + polling once the user saves valid config. Detect first-run by absence of `config.json` (not by DEFAULT_CONFIG values, which are indistinguishable from a real Plane config). After the user saves the key/provider via the masked-secret editor, transition to running (respecting the "aviso de reinicio / no hot-reload" precedent — a restart nudge is acceptable rather than live re-init, but the daemon must not have crashed in the meantime).

**Warning signs:**
`kodo up` on a clean machine exits immediately; the dashboard shows "server caído" forever; the only way to configure is the old readline wizard (defeating the dashboard-first goal).

**Phase to address:** Pilar 2 — first-run/onboarding phase; must be coordinated with Pilar 1's daemon startup (the daemon's "don't exit on missing config" behavior is a Pilar 1 change driven by a Pilar 2 requirement).

---

### Pitfall 13: Non-atomic / wrong-permission `.env` write (0600) — and `writeFileAtomic` does NOT chmod

**What goes wrong:**
There is **no `.env` writer in the codebase today** (only `loadEnvFile` reads it). The tempting reuse is `writeFileAtomic(ENV_PATH, ...)` — but `writeFileAtomic` (config.js:99-103) does `writeFileSync(tmp, data)` then `renameSync`, with **no `chmod`**. So the secret file is created with the process umask (typically 0644 — world-readable), and the intermediate `.env.tmp` also exists at 0644 containing the plaintext key. A crash between write and rename leaves a world-readable `.env.tmp` with the secret. This directly violates the 0600 requirement.

**Why it happens:**
`writeFileAtomic` was built for `config.json`/`projects.json` (non-secret) and correctly ignores permissions. Reusing it for secrets inherits its permission-blindness. The correct precedent is in the *other* module — `polling-daemon.js:76-83` does `writeFileSync(tmp)` → **`chmodSync(tmp, 0o600)` PRE-rename** → `renameSync`, exactly so the final file is 0600 the instant it appears.

**How to avoid:**
Write a dedicated secret-file writer (or extend `writeFileAtomic` with an optional mode) that mirrors `polling-daemon.js`: create tmp in the same dir (intra-fs, avoids EXDEV — the existing `writeFileAtomic` doc already warns about this), `chmodSync(tmp, 0o600)` **before** rename, then rename. Consider `openSync(tmp, 'wx', 0o600)` to create with the mode atomically. Also `chmod 0o600` the final `.env` on every write (defensive against a pre-existing 0644 file). Ensure `~/.kodo` itself is 0700 (`ensureLogsDir` already does 0700 for the logs subdir; the top dir should match).

**Warning signs:**
`ls -l ~/.kodo/.env` shows `-rw-r--r--`; a lingering `~/.kodo/.env.tmp`; the secret readable by other users on a shared machine.

**Phase to address:** Pilar 2 — masked-secret entry phase. Add a test asserting `.env` mode is 0600 after write.

---

### Pitfall 14: `.env` write format + parser mismatch, and merge-clobbering existing keys

**What goes wrong:**
Two problems: (1) The existing parser (`config.js:12-28`) is naive — splits on the first `=`, trims the value, no quoting/escaping. If the masked writer emits a quoted value, or the API key contains `#`, leading/trailing spaces, or `=`, a round-trip corrupts it (`#` at line start is a comment; trailing spaces are trimmed away). (2) A full-file rewrite of `.env` clobbers other keys the user has (e.g. `PLANE_API_KEY`, `GITHUB_TOKEN`, `KODO_WEBHOOK_SECRET_*`) if the writer only knows about the one key it's editing.

**Why it happens:**
The parser was written read-only for simple `KEY=VALUE`; nobody has had to *produce* a byte-compatible file before. And the dashboard edits one secret at a time, so a naive writer serializes only that key.

**How to avoid:**
Make the writer the inverse of `loadEnvFile`: read the existing `.env`, parse into a map, update/insert the single key, re-serialize ALL keys preserving the others, write atomically at 0600. Emit values without trimming-sensitive content; if a value could contain spaces/`#`/`=`, either constrain input (API keys are typically `[A-Za-z0-9_-]`) or add matching quoting on BOTH read and write. Validate the key value pre-write (non-empty, no newlines — a newline would inject a second env line). Test a full write→`loadEnvFile` round-trip byte-for-byte.

**Warning signs:**
After saving the API key, a previously-set `GITHUB_TOKEN` disappears; the saved key fails auth because a trailing space or `#` was mangled; two lines for the same key.

**Phase to address:** Pilar 2 — masked-secret entry phase.

---

### Pitfall 15: `loadEnvFile` never overrides live `process.env` — the freshly-saved key is ignored until restart

**What goes wrong:**
`loadEnvFile` does `if (!process.env[key]) process.env[key] = value` (config.js:23-25). After the user saves a new API key to `.env`, the long-lived daemon process already has `process.env` populated (or empty), and (a) it won't re-read the file, and (b) even a re-read wouldn't override an already-set var. So the daemon keeps using the old/absent key. Worse, `getProviderApiKey` reads `process.env[envVarName]` — so the new key never reaches the provider until a full restart.

**Why it happens:**
The load-once, don't-override semantics are correct for the "shell env wins over file" precedence at startup, but they make in-daemon hot-adoption of a new secret impossible. The milestone already accepts "aviso de reinicio (sin hot-reload)" for config, but a user entering their API key for the *first time* in the dashboard expects it to start working.

**How to avoid:**
Be explicit and honest: after saving the key, show the same "restart daemon to apply" nudge that config edits use (consistent with v0.14). Since first-run flows through Pitfall 12's setup state, the transition from setup→running should perform the provider init *after* the key is saved (reading the value directly from the just-written file/value, not relying on `loadEnvFile`'s no-override path). Do NOT silently expect the running provider to pick up the new key. If a smoother UX is wanted later, that's a scoped "hot-reload secret" follow-up, not this milestone.

**Warning signs:**
User enters a valid key, dashboard still shows auth failures / "server caído"; the key is correct in `.env` but the daemon behaves as if unset; only a manual `kodo stop && kodo up` fixes it.

**Phase to address:** Pilar 2 — onboarding (coordinate the setup→running transition with Pilar 1's daemon).

---

### Pitfall 16: TTY raw-mode / masked-input failures in ink (non-TTY, pipes, `up`-attached dashboard)

**What goes wrong:**
Masked input needs raw-mode keystroke capture (ink `useInput` / `setRawMode`). This throws or silently no-ops when stdin is not a TTY — which happens when the dashboard is attached by `kodo up` through a wrapper, when output is piped, or under some terminal emulators. The result is either a crash (violating the never-throws TUI convention) or an input field that accepts nothing, stranding first-run.

**Why it happens:**
`kodo up` introduces a new launch path (daemon spawn + dashboard attach) that may not preserve a clean TTY on stdin the way `kodo dashboard` did directly. The existing dashboard already guards non-TTY at startup (exit 1 with a canonical message, per Phase 34 TUI-01), but the *attach-after-up* path is new and the masked field is a new raw-mode consumer.

**How to avoid:**
Reuse the existing non-TTY guard for the attach path; ensure `kodo up` hands the dashboard a real TTY (attach in the foreground of the invoking terminal, don't pipe it). Guard `setRawMode` with `stdin.isTTY` and fall back gracefully (e.g. instruct the user to run `kodo config` headless — which the milestone keeps as the scriptable consumer). The in-house text-input from Phase 63 already handles cursor/backspace via `useInput`; the masked variant should render `•` per char but reuse that raw-mode plumbing rather than a new dependency.

**Warning signs:**
"Raw mode is not supported" errors; the masked field ignores keystrokes; first-run works in one terminal but not another; crash when stdin is piped.

**Phase to address:** Pilar 2 — masked-secret UI phase; Pilar 1 for the `up`→dashboard attach TTY handoff.

---

### Pitfall 17: Cross-platform — the detach pattern is macOS/Linux only; Windows must fall back

**What goes wrong:**
`spawn(..., { detached: true })` + `child.unref()` + POSIX process groups + `process.kill(pid, 'SIGTERM'/'SIGKILL')` + `chmod 0o600` semantics are POSIX. On Windows there are no real POSIX signals (SIGTERM/SIGKILL are emulated inconsistently), `detached` means a new console (not a daemon), and file-mode 0600 is a no-op (ACLs govern instead). A naive `kodo up` on Windows either spawns a visible console window, fails to stop cleanly, or writes a "0600" `.env` that's actually ACL-world-readable.

**Why it happens:**
The mac/Linux happy path is developed and tested first (constraint: "Debe funcionar en macOS con cmux instalado"). The existing polling daemon already chose the honest answer — **refuse the daemon on Windows** (`polling.js:236-240`: "Windows daemon unsupported. Use `--no-daemon` instead").

**How to avoid:**
Adopt the same refuse-with-guidance stance for `kodo up`'s detach path on `process.platform === 'win32'`: point the user at the foreground mode (`kodo up --foreground`, the same one launchd uses). Homebrew/launchd is inherently macOS/Linux — declare Windows distribution out of scope for this milestone (the milestone already lists "Windows → fallback foreground como constraint"). For the `.env` 0600 requirement, document that on Windows perms rely on the user profile's ACLs; don't claim 0600 you can't enforce.

**Warning signs:**
A stray console window on Windows; `kodo stop` not stopping on Windows; tests passing on macOS but the Windows branch untested; a "0600" claim in docs that's false on Windows.

**Phase to address:** Pilar 1 — daemon lifecycle (Windows refuse branch) + Homebrew phase (declare platform scope).

---

### Pitfall 18: Zombie children / no SIGCHLD reaping when the daemon spawns sessions

**What goes wrong:**
The kodo daemon's whole job is to spawn Claude sessions (via cmux) and, in polling mode, dispatch. If the long-lived daemon spawns children and never reaps them (no `SIGCHLD` handling, no `.unref()` on fire-and-forget children), zombies accumulate over the daemon's (now much longer) lifetime. Previously the server was often short-lived / foreground; as a persistent daemon it runs for days, so leaks that were invisible become real.

**Why it happens:**
Node reaps children automatically **only if you attach handlers or let them be collected**; truly-detached `.unref()`'d children are fine, but `spawn` without consuming `exit`/`close` and without `unref` can leave `<defunct>` entries. The dispatch path (`fire-and-forget`) and cmux shell-outs multiply over a long uptime.

**How to avoid:**
Audit every `spawn`/`execFile` the daemon performs over its lifetime: fire-and-forget children should be `.unref()`'d and their `error`/`exit` consumed (kodo's `execFile` never-throws pattern already attaches callbacks — that's the right shape). Confirm no `<defunct>` accumulation in a long-running soak test (`ps` under sustained dispatch). Since `detached: true` children in a new session are reaped by init, the main concern is short-lived cmux/exec shell-outs — ensure they resolve/reject.

**Warning signs:**
`ps aux | grep defunct` grows over daemon uptime; file-descriptor count climbing; the daemon's memory/handle count creeping over days.

**Phase to address:** Pilar 1 — daemon lifecycle; add a long-running soak check to the phase's verification.

---

### Pitfall 19: Log file handling when detached — unbounded growth, fd leaks, and losing crash output

**What goes wrong:**
The detached daemon's stdout/stderr must go somewhere. If not redirected (Pitfall 5), crash stack traces vanish. If redirected but never rotated, the file grows unbounded over the daemon's long life. If the fd isn't closed on spawn failure, it leaks (the polling code already guards this — `polling.js:304-313` closes `logFd` before re-throw on spawn error).

**Why it happens:**
The polling daemon solved this for *its* logfile (`openSync(path, 'a', 0o600)` + `sweepRetention` 7-day cleanup + `ensureLogsDir` 0o700, polling.js:242-275). A new `kodo up` daemon that doesn't reuse `polling-logfile.js` will re-solve it worse — or forget rotation entirely.

**How to avoid:**
Reuse `src/cli/polling-logfile.js` (`resolveLogfilePath`, `ensureLogsDir`, `sweepRetention`) for the unified daemon's log. Open the log fd with mode 0o600, redirect both stdout and stderr to the same fd (preserves chronological interleaving, as polling.js notes), and close the fd on spawn failure before re-throw. Under launchd, prefer the plist's `StandardOutPath`/`StandardErrorPath` (also in `~/.kodo/logs/`) so both launch paths land logs in the same place. Keep the 7-day retention sweep.

**Warning signs:**
`~/.kodo/logs/*.log` growing without bound; no logs after a crash; leaked fds after repeated failed `up` attempts; launchd logs going to a separate, forgotten location.

**Phase to address:** Pilar 1 — daemon lifecycle + Homebrew phase (plist log paths).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse `writeFileAtomic` for `.env` (no chmod) | One fewer helper | World-readable secret + 0644 `.env.tmp` window (Pitfall 13) | **Never** — secrets require the 0600 pre-rename chmod pattern from `polling-daemon.js` |
| Shell out to write the secret (`execFile kodo config --api-key …`) | Reuses the v0.13/v0.14 mutation habit | Secret in `ps`/argv (Pitfall 11) | **Never** for secrets; fine for non-secret mutations |
| Keep two PID files (server + polling) and start both | No refactor of existing daemons | Orphans, split state, `stop` misses one (Pitfall 4) | Only as a throwaway spike; the shipped `up` must unify |
| `server.listen(port)` with no `'error'` handler (status quo) | Less code | Uncaught `EADDRINUSE` crash, half-written PID (Pitfall 3) | Never once `up` exists |
| `process.exit(1)` on missing config in the daemon | Simple fail-fast | launchd crash-loop + broken first-run (Pitfalls 10, 12) | Fine for the foreground *CLI* `start`; never for the launchd/`up` daemon |
| Skip real `brew services` install test (unit tests only) | Faster CI | Ships a crash-looping or unmanaged service (Pitfalls 6, 9) | Never — requires a macOS install spike/UAT |
| Rely on PATH for `node` in the plist | Simpler formula | `spawn node ENOENT` under launchd (Pitfall 7) | Never — use absolute interpreter path |
| Full `.env` rewrite editing one key | Trivial serializer | Clobbers other secrets (Pitfall 14) | Never — read-merge-write |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| launchd / `brew services` | Plist runs `kodo up` (self-detaching) with `KeepAlive` | Plist runs `kodo up --foreground` (supervised, blocks); `up` bare self-detaches (Pitfall 6) |
| Homebrew formula | Custom plist label / hand-written plist | Modern `service do` DSL; let Homebrew own label `homebrew.mxcl.kodo` (Pitfall 9) |
| Homebrew + node | `depends_on "node"` and rely on PATH | Absolute `opt_bin` node/kodo path in the service block (Pitfall 7) |
| launchd execution identity | Assume `homedir()` == user always | Ship as per-user LaunchAgent (no sudo); verify `~/.kodo` matches (Pitfall 8) |
| `~/.kodo/.env` writer ↔ `loadEnvFile` reader | Emit a format the naive parser can't round-trip; forget 0600 | Inverse-of-parser writer, read-merge-write, chmod 0600 pre-rename, round-trip test (Pitfalls 13, 14) |
| Provider init on first run | `provider.init()` before a key exists → exit(1) | Setup state: start daemon, defer init until key saved (Pitfall 12) |
| cmux/exec shell-outs from a long-lived daemon | Fire-and-forget without `unref`/callback | `.unref()` + consume `error`/`exit` (Pitfall 18) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded daemon log growth | `~/.kodo/logs` fills disk | Reuse `polling-logfile.js` retention sweep (Pitfall 19) | Days–weeks of uptime (new, since daemon is now persistent) |
| Zombie/fd accumulation over long uptime | `<defunct>` procs, rising fd count | `.unref()` + reap all children (Pitfall 18) | Long-running daemon under sustained dispatch |
| launchd KeepAlive crash-loop hammering provider API | Constant rate-limit warnings | Don't exit on misconfig; handle listen errors (Pitfalls 10, 3) | Immediately on any startup failure |
| PID-reuse false liveness | `kodo stop` kills the wrong PID | `isPidAlive` + `started_at` cross-check (Pitfall 2) | After a crash + OS PID wraparound |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Secret in subprocess argv (`ps`-visible) | Any local user reads the API key | Write `.env` in-process, never via `execFile` argv (Pitfall 11) |
| Secret in `config.json` / `/status` / `.bak` | Key leaks to HTTP client + backups | Key lives ONLY in `~/.kodo/.env`; never in config (Pitfall 11) |
| `.env` at 0644 / `.env.tmp` window | World-readable secret on shared machine | `chmod 0600` pre-rename; `~/.kodo` at 0700 (Pitfall 13) |
| Secret in NDJSON logs / events | Persistent on-disk leak | Never pass value to logger/events; log name only (Pitfall 11) |
| Echoing the key / snapshot capture in overlay | Scrollback + cross-overlay leak | Render `•`, exclude value from frozen snapshot (Pitfalls 11, 16) |
| System-daemon (`sudo brew services`) writing root's `~/.kodo` | Split-brain + wrong-owner secret file | Per-user LaunchAgent only; forbid sudo in docs (Pitfall 8) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `kodo up` exits 0 but daemon didn't actually start | User thinks it's running; it's dead | Bounded PID-write wait + real `/health` probe before reporting success (Pitfalls 3, 5) |
| First-run daemon crashes before dashboard loads | New user can't onboard at all | Setup state serves the dashboard without config (Pitfall 12) |
| Saved API key silently not applied | "I entered my key and nothing works" | Honest restart nudge or explicit setup→running init (Pitfall 15) |
| `kodo up` twice spawns a second daemon | Duplicate processes, port fight | Idempotent attach-if-running (Pitfall 3) |
| Masked field dead on non-TTY attach | First-run stuck, no feedback | TTY guard + graceful fallback to `kodo config` (Pitfall 16) |

## "Looks Done But Isn't" Checklist

- [ ] **`kodo up`:** Often missing the terminal-close survival test — verify `/health` still responds after closing the launching terminal (Pitfall 5)
- [ ] **`kodo up`:** Often missing idempotency — verify a second `kodo up` attaches instead of spawning a duplicate (Pitfall 3)
- [ ] **`kodo stop`:** Often missing SIGKILL fallback + ESRCH-as-success + PID cleanup — verify a `kill -9`'d daemon is recoverable next start (Pitfalls 2, 4)
- [ ] **Unified daemon:** Often missing joint teardown — verify `kodo stop` leaves NO orphaned polling loop / no second PID file (Pitfall 4)
- [ ] **Homebrew:** Often missing the real `brew services` loop — verify install → start → `list` shows `started` → survives re-login → stop (Pitfalls 6, 9)
- [ ] **launchd:** Often missing absolute node path — verify it starts under `brew services`, not just from the terminal (Pitfall 7)
- [ ] **launchd:** Often missing the no-crash-loop guarantee — verify a misconfigured daemon does NOT relaunch every 10s (Pitfalls 10, 12)
- [ ] **`.env` write:** Often missing 0600 — verify `ls -l ~/.kodo/.env` is `-rw-------` and no `.env.tmp` remains (Pitfall 13)
- [ ] **`.env` write:** Often missing merge — verify editing the API key preserves other keys (`GITHUB_TOKEN`, webhook secrets) (Pitfall 14)
- [ ] **Secret entry:** Often missing the `ps` check — verify the key never appears in the process table during/after entry (Pitfall 11)
- [ ] **Secret entry:** Often missing the log/`/status` check — grep `~/.kodo/logs` and `/status` for the key value after entry (Pitfall 11)
- [ ] **First-run:** Often missing the clean-machine test — verify `kodo up` with NO `config.json`/`.env` serves the dashboard setup mode instead of exiting (Pitfall 12)

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stale PID false-positive (Pitfall 2) | LOW | `rm ~/.kodo/*.pid` (or `kodo stop` if it does stale cleanup) then `kodo up` |
| Orphaned polling after stop (Pitfall 4) | LOW | Manual `kill` of the orphan; fix requires unifying the lifecycle |
| launchd crash-loop (Pitfalls 6, 10) | MEDIUM | `brew services stop kodo`, fix plist/foreground mode, `brew services start` |
| Leaked secret in logs/argv/config (Pitfall 11) | HIGH | Rotate the API key at the provider; scrub `~/.kodo/logs` + `config.json.bak`; patch the leak vector |
| 0644 `.env` (Pitfall 13) | LOW | `chmod 600 ~/.kodo/.env`; assume key exposure on shared hosts → rotate |
| Clobbered other secrets (Pitfall 14) | MEDIUM | Re-enter lost keys; fix writer to read-merge-write |

## Pitfall-to-Phase Mapping

Phase numbering continues from Phase 64 (next is Phase 65); exact numbers set by the roadmapper. Mapping is by pillar.

| Pitfall | Prevention Pillar/Phase | Verification |
|---------|------------------------|--------------|
| 1 Reinvent daemon | Pilar 1 — `kodo up` core | Shared daemon module consumed by both `up` and polling; grep for duplicated spawn logic |
| 2 Stale PID | Pilar 1 — lifecycle | Kill -9 then `up` recovers; `stop` handles ESRCH |
| 3 Double-spawn / EADDRINUSE | Pilar 1 — lifecycle/attach | `server.on('error')` exists; second `up` attaches |
| 4 Unify server+polling | Pilar 1 — core (first phase) | One PID file; `stop` leaves no orphan |
| 5 Silent death on terminal close | Pilar 1 — lifecycle | `/health` alive after terminal close |
| 6 launchd foreground trap | Pilar 1 — Homebrew/launchd | `brew services` runs `--foreground`; no crash-loop |
| 7 node/PATH under launchd | Pilar 1 — Homebrew/launchd | Starts under `brew services`, absolute node path |
| 8 launchd HOME/paths | Pilar 1 — Homebrew/launchd | Per-user agent; `~/.kodo` matches user |
| 9 brew services label | Pilar 1 — Homebrew/launchd | `brew services list` shows `started` |
| 10 KeepAlive crash-loop | Pilar 1 + Pilar 2 | No relaunch on misconfig; setup state |
| 11 Secret leak vectors | Pilar 2 — masked secret (threat model) | `ps`/logs/`/status`/config all clean of the value |
| 12 First-run chicken-and-egg | Pilar 2 (+ Pilar 1 daemon) | Clean machine → dashboard setup mode, no exit |
| 13 `.env` 0600 / atomic | Pilar 2 — masked secret | `.env` is 0600; no `.env.tmp` remnant |
| 14 `.env` format/merge | Pilar 2 — masked secret | Round-trip test; other keys preserved |
| 15 loadEnvFile no-override | Pilar 2 (+ Pilar 1) | Restart nudge or setup→running init applies key |
| 16 TTY raw-mode masked input | Pilar 2 (+ Pilar 1 attach) | Non-TTY guard; masked field works on `up` attach |
| 17 Cross-platform detach | Pilar 1 — lifecycle/Homebrew | Windows refuse-with-guidance; scope declared |
| 18 Zombie reaping | Pilar 1 — lifecycle | Soak test: no `<defunct>` growth |
| 19 Detached log handling | Pilar 1 — lifecycle/Homebrew | Reuses `polling-logfile.js` retention; fd closed on failure |

**Highest-risk, sequence first:** Pitfalls 4, 6, 11, 12 (the unify decision, the launchd foreground trap, the secret-leak surface, and the first-run chicken-and-egg). Pitfalls 6 and 9 REQUIRE a real macOS `brew services` install spike — they cannot be unit-tested and should gate the Homebrew phase.

## Sources

- `src/cli/polling.js` (verified 2026-07-01) — hardened daemon pattern: detached spawn + `unref` + fd redirect + bounded wait + Windows refuse + SIGTERM/SIGKILL stop + stale-PID cleanup [HIGH]
- `src/cli/polling-daemon.js` (verified 2026-07-01) — atomic PID write + `chmod 0o600` pre-rename + defensive shape check + lazy path [HIGH]
- `src/config.js` (verified 2026-07-01) — `writeFileAtomic` (no chmod), `loadEnvFile` (no-override, naive parser), no `.env` writer exists [HIGH]
- `src/server.js` (verified 2026-07-01) — naive PID write, `server.listen` with no error handler, `process.exit(1)` on missing secret/init [HIGH]
- `src/cli.js` (verified 2026-07-01) — existing `start`/`stop`/`dashboard` command wiring; `dashboard` skips `ensureConfig` [HIGH]
- `.planning/PROJECT.md` v0.15 milestone (verified 2026-07-01) — LOCKED constraints (persistent daemon, `start` intact, cero endpoints nuevos, PERSIST-04 secret boundary) [HIGH]
- Session memory obs. 21811/22683 — `KODO_DIR`/`homedir()` cached at import (HOME-identity hazard) [HIGH]
- launchd / `brew services` behavior (KeepAlive throttle ~10s, minimal PATH, LaunchAgent vs LaunchDaemon, `homebrew.mxcl.*` label, `service do` DSL) — established platform knowledge, NOT yet verified against a kodo formula [MEDIUM — flagged for install spike]

---
*Pitfalls research for: unified daemon entrypoint + Homebrew/launchd + dashboard-first masked secret (kodo v0.15 "kodo up")*
*Researched: 2026-07-01*
