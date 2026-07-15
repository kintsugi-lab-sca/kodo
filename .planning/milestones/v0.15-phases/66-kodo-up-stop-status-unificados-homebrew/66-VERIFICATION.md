---
phase: 66-kodo-up-stop-status-unificados-homebrew
verified: 2026-07-02T09:35:00Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 66: kodo up / stop / status Unificados + Homebrew — Verification Report

**Phase Goal:** `kodo up` arranca el daemon desacoplado en background + engancha el dashboard como visor (persistente al cerrar); `stop`/`status` gestionan el daemon (`--json`); distribuible por Homebrew con `brew services` (plist invoca `kodo daemon run`, NUNCA `kodo up`). Cierra Pilar 1.
**Verified:** 2026-07-02T09:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `runUp` con daemon frío arranca daemon detached, espera /health y engancha el dashboard (UP-01) | ✓ VERIFIED | `src/cli/up.js:192-215`: statusDaemon → probePort → startDaemon(['daemon','run']) → waitForHealth → runDashboard; cli.js:82 lazy-imports runUp; `kodo up --help` exits 0 |
| 2 | `runUp` no registra ningún signal handler hacia el daemon — daemon persiste al cerrar el visor (UP-02) | ✓ VERIFIED | `grep -n "process\.on\|SIGINT\|SIGTERM" src/cli/up.js` returns only JSDoc comments (lines 131-132), zero actual registrations; cli.js `up` action has no signal handlers |
| 3 | `kodo up` es idempotente: daemon vivo o puerto ocupado → attach sin doble spawn (UP-03) | ✓ VERIFIED | `up.js:192-202`: `if (status.status !== 'running' && !portBusy) { startDaemon... }` — startDaemon invoked only when BOTH primary (PID-alive) and secondary (probePort) signals confirm no daemon |
| 4 | `kodo stop` daemon-first (SIGTERM→5s→SIGKILL) + fallback legacy server.pid; `kodo status --json` byte-deterministic (UP-05) | ✓ VERIFIED | `src/cli/stop-status.js:62-82`: stopDaemon first, fallback to stopServer on notRunning; `runStatusUnified:123`: `JSON.stringify({status, pid})` — fixed keys, no ANSI; both wired in cli.js:108-109,341-342 with `--json` option |
| 5 | `brew install kodo` funciona: `depends_on "node"`, instala a libexec, `bin.install_symlink` (DIST-01) | ✓ VERIFIED | Formula line 33: `depends_on "node"`; line 37: `system "npm","install",*std_npm_args`; line 40: `bin.install_symlink libexec.glob("bin/*")`; `test do` block present |
| 6 | `service do` invoca `kodo daemon run` (NUNCA `kodo up`); secretos AUSENTES del plist; scope server-only documentado (DIST-02) | ✓ VERIFIED | Formula line 47: `run [opt_bin/"kodo","daemon","run"]`; grep for `"up"` in service block: empty; grep for `environment_variables`: empty; scope documented in REQUIREMENTS.md DIST-02, formula `caveats`, and `packaging/homebrew/README.md:57-60` |
| 7 | En win32 `runUp` degrada a foreground (runDaemon) sin crashear; sin startDaemon ni dashboard (DIST-03) | ✓ VERIFIED | `up.js:157-165`: `if (platform === 'win32')` → stderr warning → `return runDaemonFn()`; startDaemon and runDashboard NOT called; win32 test in `test/cli/up.test.js` green |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Operator-Approved Manual Checkpoint (66-04)

`brew services` real macOS spike approved by operator per `66-04-SUMMARY.md`:
- Architecture: Apple Silicon (`/opt/homebrew`)
- Release: v0.15.3 (sha `0019dfc4b32d...` in formula, `30f9cf3d` git commit)
- All 9 manual checks passed (after gap-closures 66-05/06/07)
- Treated as PASSED per verification guidance — not re-opened

### Gap-Closures Verified (66-05 / 66-06 / 66-07)

| Gap | Fix Location | Evidence |
|-----|-------------|----------|
| 66-05: EPIPE flood under launchd | `src/daemon/run.js:67-72,93-99` | `installStreamEpipeGuard` installed on stdout/stderr BEFORE server compose; `makeSafeConsoleWriter` in server.js |
| 66-06: cmux child stderr leaked to daemon log | `src/host/cmux.js:26-36` | `makeRun`: `stdio: ['ignore','pipe','pipe']` — stderr captured, never inherited; fail-open swallows `err.stderr` silently |
| 66-07: cold-spawn PID timeout "failed to write PID within 2000ms" | `src/daemon/run.js:132-145` | `writePidFileFn(...)` called BEFORE `await startServerFn({managed:true})`; teardown removes pid on fail-path |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/up.js` | probePortInUse, waitForHealth, runUp | ✓ VERIFIED | 221 lines; exports all 3 functions; full DI seams; `// @ts-check` |
| `src/cli/stop-status.js` | runStopUnified, runStatusUnified | ✓ VERIFIED | 135 lines; daemon-first + legacy fallback; byte-deterministic --json |
| `src/cli.js` | kodo up registered; stop/status re-wired; kodo start intact | ✓ VERIFIED | Lines 65-88 (`up`), 98-113 (`stop`), 329-343 (`status`); `kodo start` at original location untouched |
| `packaging/homebrew/Formula/kodo.rb` | service do → daemon run; depends_on node; no env vars | ✓ VERIFIED | All three structure checks pass; sha256 filled in post-spike |
| `src/daemon/run.js` | Early PID write; EPIPE guards | ✓ VERIFIED | PID written at line 142 (before await startServerFn); guards at lines 98-99 |
| `src/host/cmux.js` | stderr captured (not inherited) in makeRun | ✓ VERIFIED | `stdio: ['ignore','pipe','pipe']` at lines 26-36 |
| `test/cli/up.test.js` | runUp DI tests | ✓ VERIFIED | Exists; 27 tests across 6 files all green |
| `test/cli/port-probe.test.js` | probePortInUse 4 branches | ✓ VERIFIED | Exists and green |
| `test/cli/health-wait.test.js` | waitForHealth 4 branches | ✓ VERIFIED | Exists and green |
| `test/cli/stop-unified.test.js` | runStopUnified daemon-first + fallback | ✓ VERIFIED | Exists and green |
| `test/cli/status-unified.test.js` | runStatusUnified --json byte-check | ✓ VERIFIED | Exists and green |
| `test/daemon/logging-epipe-safe.test.js` | EPIPE swallow (66-05) | ✓ VERIFIED | 12 tests green (incl. run.js + server.js EPIPE + cmux-stderr) |
| `test/host/cmux-stderr-capture.test.js` | cmux stdio pipe (66-06) | ✓ VERIFIED | Exists and green |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli.js:82` | `src/cli/up.js` → `runUp` | lazy import in `up` action | ✓ WIRED | Confirmed at cli.js:82 |
| `src/cli.js:108` | `src/cli/stop-status.js` → `runStopUnified` | lazy import in `stop` action | ✓ WIRED | Confirmed at cli.js:108-109 |
| `src/cli.js:341` | `src/cli/stop-status.js` → `runStatusUnified` | lazy import in `status` action | ✓ WIRED | Confirmed at cli.js:341-342 |
| Formula `service do` | `kodo daemon run` → `src/cli.js:524-535` → `runDaemon` | `run [opt_bin/"kodo","daemon","run"]` | ✓ WIRED | Formula line 47; cli.js `daemon run` at line 534 |
| `src/daemon/run.js` | `installStreamEpipeGuard` on stdout/stderr | called at lines 98-99 before server compose | ✓ WIRED | |
| `src/host/cmux.js:makeRun` | stderr captured | `stdio: ['ignore','pipe','pipe']` | ✓ WIRED | Lines 26-36 |
| `runUp:up.js:194` | `startDaemon('kodo', ['daemon','run'])` | lifecycle.js startDaemon | ✓ WIRED | Conditional on `!running && !portBusy` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `kodo up --help` exits 0, shows options | `node bin/kodo up --help` | Correct description + `--url` option | ✓ PASS |
| `kodo stop --help` exposes `--json` | `node bin/kodo stop --help \| grep json` | `--json` present | ✓ PASS |
| `kodo status --help` exposes `--json` | `node bin/kodo status --help \| grep json` | `--json` present | ✓ PASS |
| `kodo start` legacy intact | `node bin/kodo start --help` | "Start the webhook server" | ✓ PASS |
| Full test suite green | `npm test` | 1708 pass / 0 fail / 1 skip | ✓ PASS |
| Phase 66 unit tests | `node --test test/cli/{up,stop-unified,status-unified,port-probe,health-wait}.test.js` | 27 pass / 0 fail | ✓ PASS |
| Gap-closure tests | `node --test test/daemon/{logging-epipe-safe,run}.test.js test/host/cmux-stderr-capture.test.js` | 12 pass / 0 fail | ✓ PASS |
| UP-06 golden (legacy kodo start) | `node --test test/cli/kodo-start-regression.test.js` | 3 pass / 0 fail | ✓ PASS |

### Requirements Coverage

| Requirement | Plans | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| UP-01 | 66-01, 66-03 | `kodo up` arranca daemon + dashboard visor | ✓ SATISFIED | `runUp` flow + cli.js wiring |
| UP-02 | 66-01 | Daemon persistente (sin signal handlers desde el visor) | ✓ SATISFIED | No `process.on` in up.js; verified by grep |
| UP-03 | 66-01 | `kodo up` idempotente (statusDaemon + probePort guard) | ✓ SATISFIED | Conditional spawn in up.js:192-202 |
| UP-05 | 66-02, 66-03 | `stop` daemon-first + legacy fallback; `status --json` determinista | ✓ SATISFIED | stop-status.js + cli.js wiring |
| DIST-01 | 66-03 | `brew install` con `depends_on "node"`, sin bundlear runtime | ✓ SATISFIED | Formula confirmed |
| DIST-02 | 66-03 | `brew services` invoca `daemon run`; scope server-only documentado | ✓ SATISFIED | Formula + README + REQUIREMENTS.md |
| DIST-03 | 66-01 | win32 degrada a foreground sin crashear | ✓ SATISFIED | `up.js:157-165` guard + test green |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `packaging/homebrew/Formula/kodo.rb:19,23` | TODO comments (spike 66-04 reference) | ℹ Info | The sha256 placeholder was filled in post-spike (`0019dfc4b32d...`); TODO comments are vestigial. Referenced to approved checkpoint 66-04 — not an untracked debt marker. |

No TBD / FIXME / XXX markers found in any phase 66 source files.

### Human Verification Required

None. The only human-required check was the `brew services` runtime spike (66-04), approved by the operator before this verification. All automated checks pass.

---

_Verified: 2026-07-02T09:35:00Z_
_Verifier: Claude (gsd-verifier)_
