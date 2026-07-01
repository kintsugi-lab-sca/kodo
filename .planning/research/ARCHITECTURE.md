# Architecture Research — v0.15 «kodo up»

**Domain:** Unified decoupled daemon entrypoint + OS-service distribution + dashboard-first onboarding for an existing Node.js CLI (kodo)
**Researched:** 2026-07-01
**Confidence:** HIGH (grounded in the shipped codebase; no new external tech — the proven `src/cli/polling.js` daemon pattern is the reference)

> Scope note: this is **integration-for-new-features** research, not greenfield ecosystem research. It answers "how do the v0.15 features graft onto the existing architecture, reusing the polling daemon pattern?" and feeds the roadmapper a risk-graded build order (Pilar 1 lifecycle+brew before Pilar 2 onboarding).

---

## Executive answer (the 4 sub-questions)

- **(a) One supervised daemon, not PID-tracked children.** `kodo up` composes `startServer` + (conditional) `startPolling` in **one** Node process. Generalize the leaf primitives from `src/cli/polling.js` into a shared `src/daemon/lifecycle.js` + a name-parameterized PID module. Spawning them as separate children would recreate a generic process-manager — explicitly OUT of scope (PROJECT.md "NO gestor de procesos genérico", LOCKED) — and would break `brew services` (launchd would supervise a shell that forks unsupervised children: the double-fork antipattern).
- **(b) The detach path spawns the foreground path.** This is *already* how `polling.js` works (`runPollingStartCli` spawns `kodo polling start --no-daemon`, polling.js:283-302). Mirror it: `kodo up` detach-spawns a new internal `kodo daemon run` foreground command; launchd/`brew services` invoke `kodo daemon run` **directly**. One foreground entrypoint, two callers.
- **(c) Dashboard attaches as a pure HTTP viewer and detaches for free.** `runDashboard` (dashboard/index.js:85) is already a stateless `/status` client that owns nothing. `up` = ensure-daemon → poll `/health` until ready → `runDashboard({url})` unchanged → on quit, `up` exits while the **detached** daemon (separate process group via `detached:true`) survives. LOCKED persistent-daemon model falls out of `detached:true` for free.
- **(d) Masked key → `~/.kodo/.env` via a new single writer; never crosses into config.json/status/logs.** Add `writeEnvVar`/`writeEnvFile` to `config.js` (atomic tmp+rename, `chmod 0o600`) as the *only* sink for secret values — mirror of `saveConfig`. The env var **name** stays in config.json (already does — `api_key_env`, config.js:198); only the **value** goes to `.env`. A source-hygiene grep test enforces the PERSIST-04 boundary, exactly like the color-isolation / mode-derivation guards.

---

## Standard Architecture

### System Overview — target state after v0.15

```
┌──────────────────────────────────────────────────────────────────────┐
│  ENTRYPOINTS (src/cli.js — commander)                                  │
│  ┌──────────┐  ┌───────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ kodo up  │  │ kodo daemon   │  │ kodo     │  │ kodo start (LEGACY│  │
│  │ (detach  │  │   run         │  │ stop /   │  │  fg server —      │  │
│  │  +attach)│  │ (foreground)  │  │ status   │  │  UNCHANGED)       │  │
│  └────┬─────┘  └──────┬────────┘  └────┬─────┘  └──────────────────┘  │
│       │  spawn detached│                │                              │
│       │  ───────────► ─┘  ◄── launchd/brew services invoke directly    │
├───────┼──────────────────────────────────────────────────────────────┤
│  DAEMON LIFECYCLE (NEW: src/daemon/)                                   │
│  ┌────────────────────┐   ┌──────────────────────────────────────┐    │
│  │ lifecycle.js       │   │ run.js  (the ONE foreground funnel)   │    │
│  │ startDaemon/stop/  │   │  composes startServer + startPolling  │    │
│  │ status (generic)   │   │  writes ~/.kodo/kodo.pid, blocks fwd  │    │
│  └─────────┬──────────┘   └───────────────┬──────────────────────┘    │
│            │ reuses                        │ composes                  │
├────────────┼─────────────────────────────┼───────────────────────────┤
│  EXISTING SUBSYSTEMS (reused, lightly refactored)                     │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────────────┐  │
│  │ server.js     │  │ triggers/      │  │ cli/polling-daemon.js    │  │
│  │ startServer → │  │ polling.js     │  │ PID primitives (name-    │  │
│  │  managed mode │  │ startPolling() │  │  parameterized)          │  │
│  │ (no exit/pid) │  │ →{stop} handle │  │ + gsd/lock.js isPidAlive │  │
│  └───────┬───────┘  └────────────────┘  └──────────────────────────┘  │
├──────────┼─────────────────────────────────────────────────────────────┤
│  VIEWER (unchanged) ── cli/dashboard/index.js runDashboard()          │
│    pure HTTP client of GET /status + /health; owns nothing            │
├──────────────────────────────────────────────────────────────────────┤
│  STATE / SECRETS (single writers)                                      │
│  config.json  projects.json  │  .env (0o600, NEW writeEnvVar sink)     │
│  kodo.pid (daemon)  server.pid (legacy start)  polling.pid (legacy)    │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New/Modified | Reuses |
|-----------|----------------|--------------|--------|
| `src/daemon/lifecycle.js` | Generic detach-spawn / stop (SIGTERM+5s+SIGKILL) / status. The "fontanería". | **NEW** | polling.js:212-324 (start), :492-521 (stop), :538-564 (status) as templates |
| `src/daemon/run.js` | The **single foreground entrypoint**. Composes `startServer` + conditional `startPolling`, writes unified PID, installs signal cleanup, blocks forever. | **NEW** | `runForegroundPolling` polling.js:350-392 as template; `startServer`; `startPolling` |
| `src/cli/up.js` | `runUp()`: setup-if-first-run → ensure-daemon → wait `/health` → `runDashboard` → exit (daemon persists). | **NEW** | `runDashboard`, lifecycle.js, fetchStatus/health |
| `src/cli/polling-daemon.js` | PID file primitives, generalized to a `name` param (`~/.kodo/<name>.pid`). | **MODIFIED** (additive) | itself (already atomic + 0o600 + defensive shape) |
| `src/server.js` `startServer` | Add `managed` mode: no `process.exit` on missing secret, no self-owned PID under the daemon. | **MODIFIED** | itself; PID ownership moves to daemon |
| `src/config.js` | Add `writeEnvVar`/`writeEnvFile` single writer (atomic, 0o600); export `ENV_PATH`; make `loadEnvFile` re-callable. | **MODIFIED** (additive) | `writeFileAtomic` (config.js:99) |
| `src/cli/dashboard/` setup mode | CFGF-03 fields (provider/base_url/workspace) + **masked** key input; first-run setup overlay. | **MODIFIED/NEW** | Phase 63/64 in-house text-input + overlay machine |
| Homebrew formula + `brew services` | `brew install kodo` (depends_on node≥20) + launchd plist via formula `service do { run [bin,"daemon","run"] }`. | **NEW** (tap repo) | `kodo daemon run` foreground entrypoint |

---

## The reuse map: polling.js → generalized daemon (concrete, file:line)

The polling daemon is the **proven, tested, shipped** pattern to generalize. Every piece the v0.15 daemon needs already exists there:

| Capability | Where it lives today | How v0.15 reuses it |
|------------|----------------------|---------------------|
| **Dual-mode funnel** (detach spawns foreground) | `runPollingStartCli` spawns `kodo polling start --no-daemon` (polling.js:283-302), then `child.unref()` (:303) | `up` detach-spawns `kodo daemon run`; launchd calls `kodo daemon run` directly. Same shape, generic command. |
| **Detach spawn hygiene** | `spawn(process.execPath, [KODO_BIN,...], {detached:true, stdio:['ignore',logFd,logFd], env})` (polling.js:286-302); `resolveKodoBin()` absolute-path, cero PATH lookup (:180-183) | Lift verbatim into `lifecycle.startDaemon`; parameterize argv (`['daemon','run']`) and logfile name. |
| **PID pre-flight (attach-if-running / idempotency)** | `readPidFile()` + `isPidAlive()` guard, stale cleanup (polling.js:260-268) | Same guard in `up` → if alive, **skip spawn and just attach** (idempotency requirement). |
| **Bounded wait for readiness** | 2s poll loop on PID file (polling.js:315-323) | daemon: poll PID file; `up` also polls `/health` for HTTP readiness (port bind is later than PID write). |
| **Foreground long-runner** | `runForegroundPolling`: start loop → `writePidFile` → SIGINT/SIGTERM cleanup (`handle.stop()`+`removePidFile`+`exit 0`) → `await new Promise(()=>{})` block-forever (polling.js:350-392) | `daemon/run.js` is the exact same shape but composes **two** handles (server + polling). |
| **Stop protocol** | SIGTERM → 5s `isPidAlive` loop → SIGKILL → `removePidFile`; ESRCH→cleanup+0 (polling.js:492-521) | `stopDaemon` verbatim, name-parameterized. |
| **Status** | `readPidFile` + `isPidAlive` → running\|idle, `--json` byte-deterministic 4 keys (polling.js:538-564) | `statusDaemon` verbatim. |
| **PID file primitives** | atomic tmp+rename + `chmod 0o600` pre-rename + defensive shape check + lazy `homedir()` path (polling-daemon.js:70-118) | Generalize `getPidPath()` → `getPidPath(name='polling')`; add `kind` to payload. |
| **Liveness** | `isPidAlive` (`process.kill(pid,0)`, EPERM=alive) (lock.js:67-74) | Shared, unchanged. |
| **Signal cleanup ordering precedent** | `kodo orchestrate --polling` installs handlers *before* async setup, idempotent `pollingHandle?.stop()` (cli.js:133-200) | Same discipline for the composed daemon: install handlers before `startServer`/`startPolling`. |

**Refactor risk grade:** generalizing the **leaf primitives** (PID path name param, `isPidAlive`) and writing a **new** `lifecycle.js`/`run.js` alongside polling.js is LOW risk. **Migrating polling.js itself** to consume the new lifecycle is a nice-to-have that touches a shipped/tested subsystem — defer or make it a separate low-priority phase. Recommended: `up` gets a fresh `lifecycle.js` modeled on polling.js; share only PID primitives + `isPidAlive`; leave polling.js running as-is.

---

## Architectural Patterns

### Pattern 1: One daemon process, composed handles (NOT child supervision)

**What:** `daemon/run.js` calls `startServer(managed)` → server handle, and (if provider needs polling) `startPolling()` → `{stop}` handle, in the same process. One PID file. One SIGTERM tears down both.
**When:** always, for `up`/`daemon run`/`brew services`.
**Trade-offs:** (+) one liveness check, one stop, launchd-friendly, no cross-process races, mutex already implicit (per-repo lock GSD-10; reconcile loop is the single `state.json` writer, server.js:589-610). (−) a crash in one subsystem takes the whole daemon — acceptable for a personal tool and *desirable* under launchd `KeepAlive` (it just restarts).
**Precedent:** `kodo orchestrate --polling` already runs polling in-process with the orchestrator and returns a `{stop}` handle (cli.js:156-159).

```js
// src/daemon/run.js (sketch)
export async function runDaemon() {
  installSignalHandlersFirst();                 // before async — orchestrate.js precedent
  const server = await startServer({ managed: true }); // no process.exit, no self-PID
  const polling = providerUsesPolling(config)          // github → yes, plane(webhook) → no
    ? startPolling({ provider, repos, intervalSec, logger })
    : null;
  writePidFile('kodo', { pid: process.pid, started_at: nowISO(), kind: 'daemon' });
  const cleanup = () => { try{polling?.stop()}catch{}; try{server.close()}catch{}; removePidFile('kodo'); process.exit(0); };
  process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);
  await new Promise(() => {}); // block forever
}
```

### Pattern 2: Detach path spawns the foreground path (dual-mode)

**What:** `up` (detached) re-invokes `kodo daemon run` (foreground) as a detached, unref'd child; launchd/brew invoke `kodo daemon run` in foreground with `RunAtLoad`+`KeepAlive`. Both funnel through the same foreground code.
**When:** `up` on macOS/Linux → detach; launchd/brew → foreground; Windows `up` → foreground fallback (documented constraint, no background).
**Trade-offs:** (+) zero duplicate lifecycle logic; launchd correctly tracks the process (no double-fork). (−) `up` must poll for readiness because the spawned child binds the port asynchronously.
**Precedent:** verbatim the polling.js self-spawn (`kodo polling start` → `kodo polling start --no-daemon`, polling.js:286-302).

### Pattern 3: Dashboard as detach-safe pure viewer

**What:** `runDashboard` is unchanged. `up` calls it after the daemon is healthy; when it returns, `up` exits, daemon persists.
**When:** the attach half of `up`.
**Trade-offs:** (+) the persistent-daemon LOCKED requirement is satisfied *for free* by `detached:true` — Ctrl-C in the terminal that ran `up` never reaches the daemon's separate process group. `up` must **not** register handlers that kill the daemon. (−) none material.
**Key invariant:** `up` owns the dashboard lifecycle only; it must never signal `kodo.pid`. Stopping the daemon is exclusively `kodo stop`.

### Pattern 4: Secrets single-writer + PERSIST-04 boundary guard

**What:** `writeEnvVar(name, value)` in config.js is the *only* place a secret value is written, to `~/.kodo/.env`, atomic + `chmod 0o600`. The dashboard masked-input calls an `onSaveApiKey` DI handler (mirror of `onSaveConfig`, dashboard/index.js:275-282). The value never enters the React snapshot, config.json, `/status`, or logs.
**When:** CFGF-03 masked-key entry.
**Trade-offs:** (+) one auditable sink; boundary enforceable by grep test. (−) `.env` is read only at import (`loadEnvFile`, config.js:30) → key change needs a daemon restart (honest "restart" notice, reuse v0.14 pattern; or first-run captures key *before* `up` starts the daemon so it loads fresh).

```js
// src/config.js (additive — mirror saveConfig)
export function writeEnvVar(name, value) {
  ensureDir();
  const map = readEnvMap();                 // parse existing ~/.kodo/.env
  map[name] = value;
  const body = Object.entries(map).map(([k,v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileAtomic(ENV_PATH, body);          // tmp+rename (config.js:99)
  chmodSync(ENV_PATH, 0o600);               // owner-only, like the PID file
}
```

**Masked rendering rule:** the field starts empty; typing renders `•` per char; the editor probes `getProviderApiKey(provider)` → boolean "set / not set" for display, and **never** reads the value back. Add a source-hygiene test (walker/grep, mirror `test/format-isolation.test.js`) asserting no write of key values into config.json / status / logs and that `writeEnvVar` is the sole `.env` writer.

---

## Data Flow

### `kodo up` (normal run, daemon not yet up)
```
kodo up
 └─ ensureConfigured()?  ── no ──► dashboard SETUP mode (CFGF-03) ──► writeEnvVar + saveConfig ──┐
        │ yes                                                                                    │
        ▼ ◄──────────────────────────────────────────────────────────────────────────────────── ┘
 lifecycle.startDaemon('kodo'):
   readPidFile('kodo') & isPidAlive?  ── yes ──► skip spawn (idempotent attach)
        │ no
        ▼
   spawn detached [node, kodo, daemon, run] ─► child.unref()
        │
        ▼  daemon: startServer(managed)+startPolling ─► writePidFile('kodo') ─► listen(port)
   poll /health until 200 (bounded)
        ▼
 runDashboard({ url })   ── polls GET /status every 5s (existing) ──►
        │ user quits (q / Ctrl-C / SIGTERM)
        ▼
 up exits.   Daemon keeps running (detached, own PID file).   ← LOCKED persistent model
```

### `kodo stop` / `status` (unified)
```
kodo stop   → lifecycle.stopDaemon('kodo') → SIGTERM kodo.pid → 5s isPidAlive → SIGKILL → rm pid
              (daemon cleanup() stops server+polling)
kodo status → lifecycle.statusDaemon('kodo') → readPidFile+isPidAlive → running|idle (+ port/health)
```

### `brew services start kodo`
```
launchd loads plist (RunAtLoad, KeepAlive) → exec [node, kodo, daemon, run] (FOREGROUND)
   daemon run: startServer+startPolling, writePidFile('kodo'), block-forever
   stdout/stderr → ~/.kodo/logs/  (launchd redirect)
   crash → launchd KeepAlive restarts
```

### Secret write (CFGF-03)
```
dashboard masked input → onSaveApiKey(name,value) DI → config.js writeEnvVar → ~/.kodo/.env (0o600)
   value NEVER → config.json / snapshot / /status / logs   (PERSIST-04, grep-guarded)
   effect on next daemon (re)start: loadEnvFile → process.env → getProviderApiKey
```

---

## Anti-Patterns to Avoid

| Anti-pattern | Why bad | Instead |
|--------------|---------|---------|
| Spawn server & polling as **separate** PID-tracked children | Becomes a generic process manager (OUT of scope); double-fork breaks launchd/`brew services` supervision; two liveness checks + startup races | One composed daemon process, one PID file |
| `daemon run` self-detaches | launchd/brew need a foreground process to supervise; a self-detaching service exits immediately and launchd flaps | Only `up` detaches; `daemon run` stays foreground |
| `up` installs SIGINT/SIGTERM that signals the daemon | Would kill the daemon on dashboard quit — violates LOCKED persistent model | `up` owns only the dashboard; `detached:true` isolates the daemon's process group |
| Reuse `startServer`'s `process.exit(1)` (server.js:407) under the daemon | Kills the whole daemon on a recoverable config gap; unfriendly under launchd | `managed` mode: throw/return a typed error, let `up`/launchd decide |
| Two writers for the unified PID file | server.js writes `server.pid` (plain int, server.js:581) *and* daemon writes `kodo.pid` → drift | Under daemon, server does NOT write a PID; daemon owns `kodo.pid` (JSON shape) |
| Overload `kodo install` (= Claude hooks) or `kodo start` (= fg server) | Breaks documented meaning; `start` is LOCKED-intact | `up` and `daemon run` are **new** commands |
| Masked value read back into the render tree / config snapshot | Leaks secret to `/status`/logs (PERSIST-04 breach) | Value flows only to `writeEnvVar`; display is a "set/not set" probe |
| Write `.env` non-atomically or world-readable | Torn write corrupts creds; 0o644 leaks secrets | `writeFileAtomic` + `chmod 0o600` (PID-file precedent) |

---

## Integration Points (explicit new-vs-modified)

**NEW modules**
- `src/daemon/lifecycle.js` — `startDaemon`/`stopDaemon`/`statusDaemon` (generic; templated on polling.js).
- `src/daemon/run.js` — composed foreground entrypoint (`runDaemon`).
- `src/cli/up.js` — `runUp()` orchestration (setup → ensure-daemon → wait-health → runDashboard → exit).
- Homebrew tap: `Formula/kodo.rb` (`depends_on "node"` ≥20, `service do { run [bin, "daemon", "run"]; keep_alive true; log_path/error_log_path → ~/.kodo/logs }`).
- Dashboard setup surface: CFGF-03 fields + masked input (extends Phase 63 in-house text-input to render `•`).

**MODIFIED files**
- `src/cli.js` — register `up`, `daemon run` (internal/hidden), unify `stop`/`status` onto the daemon (keep legacy `start` foreground server intact; decide whether `polling`/`server.pid` paths stay or deprecate — flag for roadmapper).
- `src/server.js` — `startServer({managed})`: skip `process.exit` (server.js:405-408) and skip `writeFileSync(PID_PATH,...)` (server.js:581) when managed; return a closable handle; keep standalone `start`/`stopServer` behavior for legacy.
- `src/config.js` — add `writeEnvVar`/`writeEnvFile` (atomic+0o600), export `ENV_PATH`, make `loadEnvFile` idempotently re-callable.
- `src/cli/polling-daemon.js` — `getPidPath(name='polling')`; payload gains `kind`; keep `getPidPath()` back-compat.
- `src/cli/dashboard/index.js` + `App.js` — add `onSaveApiKey` DI prop (mirror `onSaveConfig` :275-282) + setup-mode entry; wire first-run.

**Data-flow changes**
- New `~/.kodo/kodo.pid` (JSON) for the daemon; `server.pid`/`polling.pid` remain for legacy commands.
- New secret write path (dashboard → `writeEnvVar` → `.env`), read path unchanged.
- `up` adds a `/health` readiness poll between spawn and attach.

---

## Recommended build order (risk-graded — Pilar 1 before Pilar 2)

**Pilar 1 — lifecycle + entrypoint + brew (shippable core)**
1. **Foundation (LOW):** generalize PID primitives (`name` param) + extract `src/daemon/lifecycle.js` from polling.js. Pure, unit-testable, zero behavior change to polling. *Dependency: none.*
2. **Foreground daemon (MEDIUM — highest integration risk):** `src/daemon/run.js` + `kodo daemon run` + refactor `startServer` to `managed` mode (no `process.exit`, no self-PID). Do this **early** so everything else builds on a stable server. Verify standalone `kodo start` unchanged. *Depends on 1.*
3. **`kodo up` + unified `stop`/`status` (MEDIUM):** detach-spawn, idempotent attach, `/health` wait, `runDashboard` viewer, clean detach-on-quit. *Depends on 2.*
4. **Homebrew + `brew services` + Windows fallback (LOW-MEDIUM):** formula + launchd plist via `service do run [bin,"daemon","run"]`; Windows `up` → foreground. *Depends on 2/3 being stable.*

**Pilar 2 — onboarding dashboard-first (depends on all of Pilar 1)**
5. **Secrets writer + masked input + boundary guard (LOW-MEDIUM):** `writeEnvVar` single writer, masked text-input, PERSIST-04 source-hygiene test. *Depends on Phase 63 text-input.*
6. **CFGF-03 editor + first-run setup mode (MEDIUM):** provider/base_url/workspace + masked key in dashboard; wire first-run detection into `up`. *Depends on 3 (`up`) + 5.*

Rationale: 1 is pure foundation; 2 carries the only real integration risk (server.js refactor) so it goes early; 3→4 are orchestration/packaging on top; Pilar 2 needs `up` to exist (first-run wiring) so it strictly follows Pilar 1 — matching the requested "Pilar 1 lifecycle+brew before Pilar 2 onboarding."

---

## Open questions for the roadmapper

- **`kodo stop`/`status` unification vs legacy `polling`/`server.pid`.** Does v0.15 deprecate the standalone `polling start` daemon and `stopServer`, or keep them alongside the unified daemon? (LOCKED: `kodo start` foreground server stays.) Recommend: keep legacy commands, add the unified daemon as the primary path; revisit deprecation later.
- **Does the daemon always run polling, or only when provider=github?** Plane uses webhook (server ingress); github uses polling. Recommend conditional `startPolling` gated on `providerUsesPolling(config)`. Confirm plane users don't want polling too.
- **Homebrew tap location** — separate `homebrew-kodo` tap repo vs core. `brew services` needs the `service do` block in the formula; confirm tap ownership.
- **First-run "configured?" signal** — reuse `ensureConfig`'s `!existsSync(CONFIG_PATH)` (cli.js:538) *plus* a "provider API key set?" probe (`getProviderApiKey`) so setup mode also triggers when config exists but the key is missing.

## Sources

- Codebase (HIGH confidence, direct read): `src/cli/polling.js` (daemon pattern), `src/cli/polling-daemon.js` (PID primitives), `src/server.js` (startServer/stopServer), `src/config.js` (single writers, `.env` read), `src/cli/dashboard/index.js` (viewer + DI wiring), `src/gsd/lock.js` (`isPidAlive`), `src/cli.js` (command wiring, orchestrate signal ordering), `bin/kodo`, `package.json`, `.planning/PROJECT.md` (v0.15 goal, LOCKED constraints, PERSIST-04 boundary), `.planning/ROADMAP.md`.
- Homebrew `service do` DSL / launchd `RunAtLoad`+`KeepAlive` for `brew services` (MEDIUM — standard Homebrew formula convention; verify exact DSL keys against current Homebrew docs at roadmap time).
