# Feature Research

**Domain:** Local-dev daemon lifecycle (`kodo up`) + dashboard-first onboarding + secure secret entry in a TUI — subsequent-milestone (v0.15) features on an existing Node.js CLI with an ink dashboard.
**Researched:** 2026-07-01
**Confidence:** HIGH (UX conventions are well-established and cross-verified against docker compose, brew services, supabase, tailscale, Textual/ink) · MEDIUM on the exact detach/attach model kodo should adopt (design choice, argued below)

> Scope discipline: only the NEW surface is researched here — `kodo up` (decoupled persistent daemon + dashboard-as-viewer), unified `stop`/`status`, Homebrew + `brew services` install UX, and dashboard-first onboarding closing CFGF-03 (active provider / `base_url` / `workspace_slug` + masked API key). Already-shipped surfaces (v0.9–v0.14 dashboard, v0.7 polling daemon, `kodo config` wizard, `kodo adopt`) are treated as **existing dependencies**, not re-researched.

---

## Reusable assets already in the tree (the leverage)

These decide most complexity ratings — the new features are mostly *composition*, not new machinery:

- **`src/cli/polling.js` + `polling-daemon.js`** — the proven daemon template: `writePidFile`/`readPidFile`/`removePidFile`/`getPidPath` (PID file `{pid, started_at, repos}`, `chmod 0o600`), `spawn` detached, `stop` = SIGTERM + 5s wait + SIGKILL fallback, `status` = idle/running via `isPidAlive`, deterministic exit codes 0/1/2/3, `--json` byte-determinism, Windows guard refuse-with-guidance. **`kodo up`/`stop`/`status` should be a generalization of this, not a new invention.**
- **`src/cli/dashboard/`** — overlay system (`mode:'overlay'`/`'confirm'`), in-house editable text-input in ink with cursor/backspace (Phase 63), `config-validate.js` pure validators, `writeFileAtomic` (temp+rename), `saveConfig`/`saveProjects` as single writers, never-throws data layer. **The onboarding "setup mode" is a new dashboard mode reusing this, not a new UI stack.**
- **`~/.kodo/.env`** — the secret store. PERSIST-04 boundary (v0.14): API keys live only here, never rendered back, never in `/status`/logs. The masked-key editor must *extend* this boundary, not break it.
- **`kodo start`** (server foreground) stays intact — `up` is a new command. Daemon model is **persistent** (LOCKED): survives dashboard close; `kodo stop` tears it down.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Missing these makes `kodo up` feel broken or surprising vs the tools users already know (`docker compose up`, `supabase start`, `brew services`).

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **`kodo up` = one command → daemon (server + polling) running in background + dashboard attaches as viewer** | This is the milestone's whole promise; `supabase start` sets the bar (one command → full stack up). | MEDIUM | Compose spawn-detached from `polling.js` + attach the existing dashboard process. The daemon is *decoupled*: dashboard is a viewer, closing it must NOT kill the daemon (LOCKED). |
| **Idempotent `up`: if daemon already running, attach the dashboard instead of double-spawning / colliding on port** | Users re-run `up` reflexively. tailscaled's "failed to connect… already running as pid N" is the anti-example — kodo must *attach*, not error. | MEDIUM | PID-file liveness check (`isPidAlive`, already exists) BEFORE spawn. If alive → skip spawn, go straight to attach. Port-in-use must be a clean "already running" path, not an EADDRINUSE stack trace. |
| **`kodo stop` tears down the *entire* daemon (server + polling) in one command** | If `up` starts everything, `stop` must stop everything — asymmetry is a bug users report. | LOW | SIGTERM + 5s + SIGKILL (already in `polling.js`). Must stop both concerns, not just polling. Idempotent: `stop` when nothing runs = clean exit 0 + "not running", not error. |
| **`kodo status` reports the whole daemon: running/not, pid, uptime, what's up (server port + polling repos)** | `brew services list` / `docker compose ps` conditioned users to expect a status verb. | LOW | Generalize `runPollingStatusCli`. `--json` byte-deterministic (existing invariant). Exit codes: 0 running / 3 not-running (reuse the polling taxonomy). |
| **Closing the dashboard (`q`/Ctrl-C) leaves the daemon running** | Core to "dashboard-as-viewer". Detaching a viewer must not kill the service — the whole point of decoupling. | MEDIUM | This is the deliberate DIVERGENCE from `docker compose up` foreground (where Ctrl-C stops containers). kodo's `up` behaves like `compose up -d` + auto-attach. Must be documented in `--help` so muscle memory doesn't cause surprise. |
| **First-run onboarding: fresh `brew install kodo` → `kodo up` → dashboard opens in setup mode (no crash on missing config)** | A brand-new user with no `~/.kodo/config.json` must be *guided*, not hit an error. `ensureConfig` already does this for headless commands. | MEDIUM | Detect "no/incomplete config" and enter dashboard **setup mode** instead of the normal table. Minimum to reach "running": provider + base_url + workspace + API key. |
| **Masked API-key entry in the TUI (characters shown as `•`/`*`, never echoed plaintext)** | Universal expectation for secret fields — every TUI framework (Textual `password=True`, Terminal.Gui) masks by default. | MEDIUM | New behavior on the Phase 63 text-input: render mask glyphs while keeping the real buffer in memory only. Writes to `~/.kodo/.env`, honoring PERSIST-04. |
| **"Already set" indicator for a stored secret WITHOUT revealing it** | Users need to know a key exists without seeing it; showing the value (even masked-length) leaks length. | LOW | Show `••••••• (set)` or `[configured]` — a boolean presence flag read from `.env` key existence, never the value. Editing replaces; empty-submit keeps existing. |
| **Homebrew install: `brew install kodo` with `depends_on node ≥20`** | The stated distribution channel; brew is the macOS default for CLI tools. | MEDIUM | Formula authoring + tap. `depends_on "node"` with version floor. This is packaging work, low code-risk but real infra. |
| **`brew services start kodo` runs the daemon under launchd (survives logout/reboot, auto-restart)** | brew-services users expect `start`/`stop`/`restart`/`list` to just work once a formula is service-aware. | MEDIUM-HIGH | Requires the **foreground-supervised daemon mode** (launchd expects a non-forking process it supervises via the plist `run` block). This is why the daemon needs DUAL mode (see below). |
| **Clear terminal feedback during `up`: "starting… / kodo is running at :PORT / attaching dashboard…"** | `supabase start` prints readiness + endpoints; silence during a multi-second spawn reads as a hang. | LOW | Reuse `createFormatter` for TTY-aware status lines. Non-TTY/`--json` stays byte-deterministic. |

### Differentiators (Competitive Advantage)

Where kodo can feel nicer than the generic pattern — all aligned with the existing dashboard-centric identity.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dashboard-first onboarding (setup screen), not a separate readline wizard, for first run** | The dashboard is already the product's face; guiding config *inside* it (vs dropping to a linear prompt) is a coherent, modern UX. Closes CFGF-03 in the surface users already live in. | MEDIUM-HIGH | New dashboard `mode:'setup'` composing the Phase 63 text-input + `config-validate.js`. The friction v0.14 solved for projects, extended to provider/key. |
| **CFGF-03 closed: edit active provider / `base_url` / `workspace_slug` + masked key from the dashboard** | These were explicitly deferred in v0.14; delivering them removes the last reason to hand-edit files or re-run the wizard. | MEDIUM | Structural fields → `config.json` via `saveConfig`; key → `.env` via a dedicated atomic `.env` writer (new, mirrors `writeFileAtomic`). Provider switch may need a re-validate/re-connect nudge. |
| **`kodo config` (readline wizard) retained as the headless/scriptable twin of the same plumbing** | Power users / CI / SSH-without-TTY still get a path; both surfaces write through the SAME single writers (`saveConfig` + the new `.env` writer). | LOW | Non-goal to change the wizard's flow — just ensure it and the dashboard share writers so they can't diverge. Guards the "single writer" invariant. |
| **Reveal toggle on the key field (show/hide while typing) + paste support** | Lets a user verify a long pasted key without leaving plaintext on screen after. Standard in good password fields (toggle icon). | LOW-MEDIUM | ink `useInput` receives pasted text as a burst — accept multi-char input in one event. Toggle key (e.g. Ctrl-R / a footer hint) flips mask on the render only; buffer unchanged. Default = masked. |
| **`up` auto-detects and reports "already running → attaching" as a first-class, friendly state** | Turns the classic daemon foot-gun (double-start) into a smooth re-attach. | LOW | Falls out of the idempotency table-stake, but *phrasing it as a feature* (clear message, instant attach) is the differentiator. |
| **Restart advisory after config change (honest "no hot-reload")** | v0.14 already set this expectation; extending it to provider/key changes keeps behavior predictable. | LOW | After saving provider/key, footer: "restart the daemon (`kodo stop && kodo up`) to apply". Consistent with existing config-load-at-boot model. |
| **Windows: honest foreground fallback for `up` (documented constraint, not a crash)** | The polling daemon already refuses-with-guidance on Windows; `up` should degrade to a foreground run rather than pretend to daemonize. | LOW | Reuse the existing Windows guard pattern. `brew services` is macOS/Linux only anyway. |

### Anti-Features (Commonly Requested, Often Problematic)

Explicitly out — these are the scope-creep traps for this milestone.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Generic process/service manager (start/stop arbitrary user commands, multiple named services, dependency graphs)** | "While we're building daemon lifecycle, make it general." | Explodes scope into a mini-`pm2`/`supervisord`; kodo manages exactly ONE thing (its own daemon = server + polling). LOCKED context: "núcleo = un entrypoint + ciclo de vida del daemon… NO gestor de procesos genérico". | One daemon, one lifecycle. `up`/`stop`/`status` operate on kodo's daemon only. |
| **Generic secrets manager (multiple secrets, rotation, vault backends, encryption-at-rest)** | "Handle all my keys." | The milestone needs exactly ONE masked field (the provider API key) written to `~/.kodo/.env`. A secrets manager is a product of its own. LOCKED: "edición de secretos = extensión consciente, NO gestor de secretos genérico". | Single masked key field + "already set" indicator, writing the one `api_key_env` value to `.env`. |
| **Hot-reload of config into the running daemon** | "Edit provider and have it apply instantly." | The daemon loads config in memory at boot; live-reload means watchers, safe-swap of the polling loop, provider re-init mid-flight — high risk for marginal value. v0.14 already chose restart-advisory. | Restart advisory (`kodo stop && kodo up`). Honest and simple, matches existing behavior. |
| **`up` foreground-attach that stops the daemon on Ctrl-C (docker-compose-up semantics)** | Familiar from `docker compose up`. | Contradicts the LOCKED persistent-daemon model — closing the *viewer* must never kill the *service*. Adopting compose semantics would make the dashboard a foreground owner again. | `up` = attach a decoupled viewer (compose `-d` + auto-attach). Ctrl-C/`q` detaches the viewer only; `kodo stop` is the sole teardown. |
| **Revealing / round-tripping the stored API key into the dashboard for "editing"** | "Let me see/edit the current key inline." | Breaks PERSIST-04: the key must never be rendered back, logged, or sent to `/status`. Loading it into a TUI buffer risks it on screen and in memory dumps. | Show `[configured]` only. To change: type a NEW value (replaces). Empty submit = keep existing. Never read the old value back into the UI. |
| **Auto-installing / bootstrapping Node as part of `brew install`** | "Zero-dependency install." | brew's job is `depends_on "node"`; bundling/patching a runtime is fragile and fights the package manager. | `depends_on "node"` (≥20). Let brew resolve the runtime. |
| **New HTTP endpoint(s) in `src/server.js` to drive setup/secret writes from the dashboard** | "The dashboard should POST config to the server." | Breaks the "cero endpoints nuevos desde v0.10" invariant; config/secrets live on the filesystem, not the server. v0.14 already proved local writes from the TUI. | Local writes via `saveConfig` + a new atomic `.env` writer, imported directly in the ink process (like Phase 63). |
| **Multi-user / remote daemon control (start kodo's daemon on another host, auth for `stop`)** | "Manage kodo everywhere." | kodo is explicitly a single-user personal tool (PROJECT.md Out of Scope). | Local-only daemon, local PID file, local dashboard. |

---

## Feature Dependencies

```
Homebrew formula (brew install kodo, depends_on node)
    └──enables──> brew services start kodo (launchd plist)
                       └──requires──> Daemon: foreground-supervised mode
                                          │
Daemon: dual mode  ─────────────────────┤
  (a) self-detach  ──requires──> PID-file lifecycle (reuse polling-daemon.js)
      (for `kodo up` without brew)              │
  (b) foreground-supervised ──> (for launchd / brew services)
                                          │
kodo up ──requires──> Daemon spawn/attach ┘
    │        └──requires──> idempotency (isPidAlive check before spawn)
    │
    ├──requires──> unified stop  (SIGTERM+SIGKILL, reuse polling stop)
    └──requires──> unified status (isPidAlive + report, reuse polling status)

kodo up (first run, no config)
    └──triggers──> Dashboard setup mode
                       └──requires──> ink text-input (Phase 63, exists)
                       └──requires──> config-validate.js (exists)
                       └──requires──> saveConfig  ──writes──> config.json (provider/base_url/workspace)
                       └──requires──> NEW atomic .env writer ──writes──> ~/.kodo/.env (masked key)
                                          └──enhanced-by──> masked field + reveal toggle + "already set" indicator

kodo config (readline wizard, existing)
    └──shares──> saveConfig + NEW .env writer  (single-writer invariant)
```

### Dependency Notes

- **`brew services` requires foreground-supervised daemon mode:** launchd supervises a process via the plist `run` block and expects it NOT to fork/detach (it does the backgrounding). The **same daemon binary needs a mode that self-detaches** (for plain `kodo up` without brew). This dual mode is the linchpin dependency of Pilar 1 — get it wrong and either `kodo up` blocks the terminal or `brew services` can't supervise.
- **`kodo up` idempotency requires the PID-file liveness check to run BEFORE spawn:** the `isPidAlive` helper already exists (`src/gsd/lock.js`, used by polling status). Attach-if-running is a small addition, but it is what prevents port collisions and double-spawn.
- **Setup mode enhances (does not replace) `kodo config`:** both must write through the same `saveConfig` + new `.env` writer, or the two surfaces can silently diverge — the single-writer invariant is the safety rail.
- **Masked key field depends on the Phase 63 text-input, extended:** adds a render-time mask + reveal toggle + "already set" presence read. The buffer/cursor logic is reused; only rendering + a presence check are new.
- **The new `.env` writer is the one genuinely new low-level piece:** `writeFileAtomic` handles `config.json`; `.env` needs its own atomic key-upsert (parse existing lines, replace/append the one key, temp+rename, `chmod 0o600`) so it never clobbers other `.env` entries or leaks via a partial write.

---

## MVP Definition

### Launch With (v0.15 core — Pilar 1, shippable on its own)

- [ ] **Daemon with dual mode (self-detach + foreground-supervised)** — the linchpin; everything else composes on it.
- [ ] **`kodo up`** — spawn decoupled daemon (server + polling) + attach dashboard as viewer; idempotent attach-if-running.
- [ ] **`kodo stop` / `kodo status` unified** — one command each, whole-daemon, idempotent, deterministic exit codes + `--json`.
- [ ] **Dashboard-as-viewer detach semantics** — closing dashboard leaves daemon running; `stop` is the only teardown.
- [ ] **Homebrew formula (`brew install kodo`, `depends_on node ≥20`)** + `brew services start kodo` (launchd plist).
- [ ] **Windows foreground fallback** for `up` (documented constraint).

### Add After Validation (Pilar 2 — onboarding, layered on Pilar 1)

- [ ] **Dashboard setup mode on first run** (no/incomplete config → guided screen).
- [ ] **CFGF-03: edit active provider / base_url / workspace_slug** from the dashboard → `config.json`.
- [ ] **Masked API-key field** (mask by default, reveal toggle, paste) → new atomic `.env` writer.
- [ ] **"Already set" indicator** for the stored key (presence only, never value).
- [ ] **Restart advisory** after provider/key change.
- [ ] **`kodo config` wizard rewired** to share the new `.env` writer (single-writer invariant).

### Future Consideration (deferred / already in PROJECT.md)

- [ ] Hot-reload of config into the running daemon — deferred; restart-advisory is the chosen model.
- [ ] Direct Anthropic API key management for title-derivation (latency tradeoff) — already a deferred candidate.
- [ ] Secrets beyond the single provider key — out of scope by design.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Daemon dual mode (self-detach + supervised) | HIGH | MEDIUM-HIGH | P1 |
| `kodo up` (spawn + attach + idempotent) | HIGH | MEDIUM | P1 |
| Unified `stop` / `status` | HIGH | LOW | P1 |
| Dashboard-as-viewer detach (don't kill daemon on quit) | HIGH | MEDIUM | P1 |
| Homebrew formula + `brew services` | HIGH | MEDIUM-HIGH | P1 |
| Dashboard setup mode (first-run onboarding) | HIGH | MEDIUM-HIGH | P1/P2 |
| Masked API-key field + `.env` writer | HIGH | MEDIUM | P1/P2 |
| CFGF-03 provider/base_url/workspace editor | MEDIUM-HIGH | MEDIUM | P2 |
| "Already set" indicator | MEDIUM | LOW | P2 |
| Reveal toggle + paste on key field | MEDIUM | LOW-MEDIUM | P2 |
| Restart advisory after change | MEDIUM | LOW | P2 |
| `kodo config` rewired to shared writer | MEDIUM | LOW | P2 |
| Windows foreground fallback | LOW-MEDIUM | LOW | P2 |

**Priority key:** P1 = must have for the milestone's core promise (Pilar 1) · P2 = completes the milestone (Pilar 2 onboarding) · P3 = future.

## Competitor Feature Analysis

| Feature | docker compose | supabase / brew services / tailscale | Our Approach |
|---------|----------------|--------------------------------------|--------------|
| Single-command up | `up` (foreground) / `up -d` (detached) | `supabase start` (detached, prints endpoints) | `kodo up` = detached daemon + auto-attach viewer (compose `-d` + attach hybrid) |
| Ctrl-C behavior | foreground: **stops** containers | supabase: containers persist (start already detached) | Ctrl-C/`q` **detaches the viewer only**; daemon persists (LOCKED) — diverges from compose foreground |
| Re-run when running | `up` reconciles/attaches | tailscale errors "already running as pid N" (anti-example) | Idempotent: attach-if-running, never double-spawn / port-collide |
| Stop | `compose down`/`stop` | `brew services stop` / `supabase stop` | `kodo stop` (whole daemon, SIGTERM+SIGKILL) |
| Status | `compose ps` | `brew services list` | `kodo status` (running/pid/uptime/port/repos, `--json`) |
| OS service integration | — | `brew services` → launchd | `brew services start kodo` → launchd plist (needs supervised daemon mode) |
| First-run onboarding | — | supabase: `init` scaffolds | Dashboard **setup mode** (guided, in-TUI) — our differentiator |
| Secret entry | env files / secrets | — | Masked TUI field + reveal toggle + "already set", writes `~/.kodo/.env` |

## Sources

- [docker compose up — Docker Docs](https://docs.docker.com/reference/cli/docker/compose/up/) — foreground vs `-d`, Ctrl-C = SIGINT stops containers (exit 0)
- [Make --detach the default on `up` (docker/compose #6330)](https://github.com/docker/compose/issues/6330) and [detach key-sequence (#4560)](https://github.com/docker/compose/issues/4560) — detach-without-stop is a known gap; informs kodo's viewer-detach design
- [Starting and stopping background services with Homebrew — thoughtbot](https://thoughtbot.com/blog/starting-and-stopping-background-services-with-homebrew) and [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook) — `service do run … end` block, launchd plist generation, `~/Library/LaunchAgents`
- [Make an existing formula 'brew services' aware (Homebrew/homebrew-services #37)](https://github.com/Homebrew/homebrew-services/issues/37) — supervised (non-forking) service expectation
- [Supabase CLI getting started](https://supabase.com/docs/guides/local-development/cli/getting-started) / [supabase start reference](https://supabase.com/docs/reference/cli/supabase-start) — single-command up, prints endpoints, first-run vs warm-start timing
- [Tailscale CLI](https://tailscale.com/docs/reference/tailscale-cli) / [tailscaled daemon](https://tailscale.com/docs/reference/tailscaled) — CLI-as-LocalAPI-client to a daemon; "already running as pid N" as the foot-gun to avoid
- [Textual (Real Python)](https://realpython.com/python-textual/) + [Password input — Timely Design System](https://tui.supernova-docs.io/latest/product-design/components/text-input/password-input-fRBdSJVG-fRBdSJVG) — masked-by-default `password=True`, `•`/`*` glyphs, reveal toggle convention
- **Codebase (primary):** `src/cli/polling.js`, `src/cli/polling-daemon.js` (PID-file daemon template); `src/cli/dashboard/index.js`, `App.js`, Phase 63 text-input + `config-validate.js` + `writeFileAtomic` + `saveConfig`; `.planning/PROJECT.md` (v0.15 LOCKED context, PERSIST-04 boundary, Out of Scope)

---
*Feature research for: `kodo up` unified startup + dashboard-first onboarding (v0.15)*
*Researched: 2026-07-01*
