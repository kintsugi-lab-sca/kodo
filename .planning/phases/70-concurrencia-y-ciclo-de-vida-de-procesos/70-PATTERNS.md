# Phase 70: Concurrencia y ciclo de vida de procesos - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 9 (1 new module + 8 modified)
**Analogs found:** 9 / 9 (all in-repo — this is hardening, not greenfield)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/session/state-lock.js` **(NEW)** | utility (FS primitive) | file-I/O / lock | `src/gsd/lock.js` | exact (generalization) |
| `src/session/state.js` (`withStateLock` + wrap writers) | model/state | file-I/O CRUD | `src/gsd/lock.js` (steal) + own `saveState` | exact |
| `src/gsd/lock.js` (`wx` fix + `stealLock` tmp+rename) | utility (FS primitive) | file-I/O / lock | itself (`writeLockFile`/`stealLock`) | exact |
| `src/session/manager.js:178` (gate `alive`) | service | request-response (gate) | itself (existing filter) | exact |
| `src/config.js:146` (`migrateConfigIfNeeded` atomic) | config | file-I/O | `writeFileAtomic` (`config.js:100`) | exact |
| `src/daemon/run.js` (teardown ownership guard) | provider/runtime | event-driven (lifecycle) | itself (`teardown`, `run.js:115`) | exact |
| `src/daemon/lifecycle.js` (`ps lstart` before SIGKILL; `polling start` lock) | service (lifecycle) | event-driven | itself (`stopDaemon`/`startDaemon`) | exact |
| `src/triggers/dispatcher.js` (dedup no-GSD por `task_id`) | service (dispatch) | event-driven | `acquireGsdLock` guard (`dispatcher.js:143`) | role-match |
| `src/session/reconcile.js` (único escritor `alive`; wrap saveState) | service (loop) | batch/transform | own `applyLiveFields` (`:250`) | exact (read-only for gate) |
| `src/server.js:842` (fix comentario mentiroso) | comment fix | — | grep, not line | exact |

**New test files** (Wave 0 gaps from RESEARCH §Validation): `test/state/state-lock.test.js`, `test/state/state-lock-concurrency.test.js`, `test/gsd-lock-race.test.js`, `test/daemon/polling-start-race.test.js`, `test/dispatcher-dedup-crossproc.test.js`, `test/config-migration-atomic.test.js`. Extend existing `test/daemon/run.test.js`, `test/daemon/lifecycle.test.js`, `test/session/manager.test.js`. Analog: `test/state/save-state-atomic.test.js` (HOME-isolation + dynamic import) and `test/gsd-concurrency.test.js` (mkdtemp sandbox).

## Pattern Assignments

### `src/session/state-lock.js` (NEW — advisory lock primitive, CONC-01/06/08)

**Analog:** `src/gsd/lock.js` — the ENTIRE file is the template. Generalize its lockfile + `isPidAlive` + TTL + steal into a reusable primitive. **Reuse `isPidAlive` by import — do NOT reimplement.**

**Liveness check to REUSE verbatim** (`src/gsd/lock.js:67-74`):
```javascript
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code !== 'ESRCH';
  }
}
```

**Steal-if-stale pattern to copy** (adapt from `acquireGsdLock` Cases 2/3/5, `lock.js:112-135`): read existing lock JSON → `!isPidAlive(held.pid)` OR TTL exceeded → steal; corrupt JSON → treat as stale/steal; alive+TTL-ok → reject/retry. The new primitive differs from GSD only in: (a) creation uses `writeFileSync(path, content, {flag:'wx'})` instead of `existsSync` check (see CONC-02 below — the SAME `wx` fix), (b) steal writes tmp+rename (see D-08), (c) short retry/backoff loop instead of single-shot, (d) lock content is `{pid, acquired_at, token}` with a `token` for idempotent ownership-checked release.

**Release must be ownership-checked** (mirror `releaseGsdLock`, `lock.js:154-171`): only `unlinkSync` if the held token/pid matches ours; missing/other-owner → no-op. The GSD version keys on `session_id`; the new one keys on `token` (randomUUID per acquire).

**Retry-exhaustion = D-03 fail-safe** (RESEARCH Pattern 1): return `{ok:false, reason:'lock-timeout'}` + warn NDJSON, never throw, never block indefinitely. See RESEARCH §Code Examples lines 335-373 for the full reference implementation.

**tmp naming for steal** (copy uniqueness pattern from `saveState`, `state.js:249`): `lockPath + '.steal.' + process.pid + '.' + randomUUID()` then `renameSync`.

---

### `src/session/state.js` — `withStateLock(fn)` + wrap writers (CONC-01)

**Analog:** own `saveState` (atomicity already solved) + new `state-lock.js` (coordination).

**`saveState` is the atomic write step — KEEP AS-IS inside the lock** (`state.js:242-257`):
```javascript
export function saveState(state) {
  const tmp = STATE_PATH + '.tmp.' + process.pid + '.' + randomUUID();
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, STATE_PATH);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
```

**The 3 mutators to wrap** — all follow `loadState()`→mutate→`saveState()` WITHOUT lock today (`state.js:264-315`):
```javascript
export function addSession(taskId, session, logger = noopLogger) {
  const state = loadState();        // ← today: read OUTSIDE any lock (clobber)
  state.sessions[taskId] = session;
  saveState(state);
  ...
}
// removeSession (:278), updateSession (:305) — identical shape
```

**Target pattern (D-02 load→mutate→save under lock)** — the reload under the lock is the anti-clobber key (RESEARCH lines 191-197):
```javascript
export function withStateLock(mutator) {
  return withFileLock(STATE_LOCK_PATH, () => {
    const state = loadState();     // RE-READ fresh under the lock
    const next = mutator(state);
    saveState(next ?? state);
  });
}
```
Each mutator body becomes `withStateLock(state => { ...mutate state... })`. This coordinates the ~13 cross-process call-sites (hooks, cli/polling, cli/adopt, doctor, verify, orchestrator/launch, manager, health, dispatcher) for free — they all funnel through these 3 functions.

**4th write point:** `runReconcileTick`'s `saveState` (`reconcile.js:308→351`). **Pitfall 1 (CRITICAL):** do NOT hold the lock across `runReconcileTick`'s async host I/O (`pgrep`/`listWorkspaces`). Snapshot the host OUTSIDE the lock, then `withStateLock(state => reconcileTick(state, liveRefs, ...).state)` — the derivation is pure.

---

### `src/gsd/lock.js` — atomic `wx` + `stealLock` tmp+rename (CONC-02)

**Analog:** itself. The TOCTOU is `acquireGsdLock` Case 1 (`lock.js:106-110`):
```javascript
  // Case 1: lock file absent — create + acquire.
  if (!existsSync(lockPath)) {     // ← TOCTOU: two procs both see absent → both win
    writeLockFile(lockPath, sessionInfo);
    return { acquired: true };
  }
```

**Fix (D-07):** `writeLockFile` (`lock.js:191-203`) writes with `{flag:'wx'}`; wrap the create attempt in try/catch, `EEXIST` falls through to the existing read-existing path (Cases 2-5 unchanged):
```javascript
export function acquireGsdLock(projectPath, sessionInfo) {
  const lockPath = lockPathFor(projectPath);
  try {
    writeLockFile(lockPath, sessionInfo);  // now {flag:'wx'} — atomic create
    return { acquired: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // EEXIST → existing read-existing path: PID-dead→steal, TTL→steal, corrupt→steal, alive+TTL-ok→reject
  }
  // ... Cases 2-5 unchanged (readLock, isPidAlive→steal, TTL→steal, else reject) ...
}
```

**`writeLockFile` change** (`lock.js:202`): `writeFileSync(lockPath, ..., { flag: 'wx' })`.

**`stealLock` → tmp+rename (D-08)** — today it calls `writeLockFile` which does a direct `writeFileSync` (`lock.js:216-220`). Change the write to tmp+rename (copy `saveState`'s pattern) so a concurrent reader never sees a half-written lock.

**Consistency guard:** `decideLock` in `src/gsd/doctor.js:~230` is a PURE mirror (decides steal/keep, does not write). Verify its semantics still match after the change (D-08 historical). No code change expected there.

---

### `src/session/manager.js:178` — gate filters by `alive` (CONC-03)

**Analog:** itself. Current gate (`manager.js:178`):
```javascript
const active = listSessions().filter((s) => s.status === 'running');
```
**Fix (D-05):** `...filter((s) => s.status === 'running' && s.alive !== false)`. Use `!== false` (not `=== true`) so legacy sessions without the `alive` field still count (conservative, no regression). The gate READS `alive`; it never writes it.

**CRITICAL semantics (Pitfall 2 / obs. 24919):** `alive` is derived from the workspace/TAB liveness by `reconcileTick`, NOT from the Claude process PID. A `kill -9` that kills only the process but leaves the cmux tab alive yields `alive:true` → the gate still counts it. The zombie test (Criterion 3) MUST drive TAB death (or mock `host.listWorkspaces()` to drop the `workspace_ref`), not just `kill -9`.

**Invariant source** — `applyLiveFields` is the SOLE writer of `alive` (`reconcile.js:250-259`):
```javascript
function applyLiveFields(session, live, effectiveState, now) {
  const tabAlive = !!(live && live.alive);
  return {
    ...session,
    tab_alive: tabAlive,
    alive: effectiveState === 'running' || effectiveState === 'idle' || effectiveState === 'needs-input',
  };
}
```

---

### `src/config.js:146` — `migrateConfigIfNeeded` atomic (CONC-07)

**Analog:** `writeFileAtomic` already defined in the same file (`config.js:100-104`):
```javascript
function writeFileAtomic(path, data) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, data);      // if it throws, `path` untouched
  renameSync(tmp, path);         // atomic intra-fs swap
}
```
**Fix (D-14):** `migrateConfigIfNeeded` (`config.js:150`) currently does a direct `writeFileSync(CONFIG_PATH, ...)`. Swap to `writeFileAtomic(CONFIG_PATH, JSON.stringify(newConfig, null, 2) + '\n')`. One-line diff. The `.bak` at `:148` is optional to harden (the risk is a truncated `config.json`, not the backup).

---

### `src/daemon/run.js` — teardown ownership guard (CONC-04)

**Analog:** itself. Current teardown does UNCONDITIONAL PID removal (`run.js:115-123`):
```javascript
const teardown = (code) => {
  if (tornDown) return;
  tornDown = true;
  try { polling?.stop(); } catch {}
  try { stopReconcile?.(); } catch {}
  try { server?.close(); } catch {}
  try { removePidFileFn('kodo'); } catch {}   // ← D-09: guard by payload.pid === process.pid
  proc.exit(code);
};
```
**Fix (D-09):** read the PID payload and only `removePidFile('kodo')` if `payload.pid === process.pid` — a process must only delete its OWN PID file.

**Fix (D-10 — DO NOT REGRESS, Pitfall 3 CRITICAL):** the PID write at `run.js:142-145` is DELIBERATELY pre-bind (gap-closure 66-07). Keep pre-bind. The "no lying PID if bind fails" invariant is ALREADY satisfied by the fail-path `teardown(1)` (`run.js:152-166`) which removes the PID when boot aborts. Action: **do NOT move to post-bind**; add a comment documenting that fail-path cleanup guarantees it. See RESEARCH §Assumptions A1 / Open Question 1 — confirm interpretation before coding.

**Payload already includes `started_at`** (`run.js:143`) — needed by D-11.

---

### `src/daemon/lifecycle.js` — anti-PID-reuse before SIGKILL + `polling start` lock (CONC-05/06)

**Analog:** itself + `state-lock.js`.

**SIGKILL site to harden (D-11)** — `stopDaemon` (`lifecycle.js:176-187`):
```javascript
  kill(payload.pid, 'SIGTERM');
  const deadline = now() + 5000;
  while (now() < deadline && isAlive(payload.pid)) { await sleepFn(100); }
  if (isAlive(payload.pid)) {
    try { kill(payload.pid, 'SIGKILL'); } catch {}   // ← D-11: compare ps -o lstart= == started_at FIRST
  }
```
**Fix:** before SIGKILL, compare `payload.started_at` with `execFileSync('ps', ['-o','lstart=','-p',pid], {env:{...process.env, LC_ALL:'C'}})`. Mismatch → abort kill + warn; `ps` absent/unparseable → degrade safe (do NOT kill, warn). Tolerance ~5-10s for lstart 1s-resolution skew. Full reference: RESEARCH §Code Examples lines 375-407. **Pitfall 4:** `ps -o lstart=` is locale-dependent (macOS es_ES → Spanish months); force `LC_ALL=C`.

**`polling start` TOCTOU (D-12)** — `startDaemon` pre-flight is check-then-spawn (`lifecycle.js:110-118`):
```javascript
  const existing = readPid(name);
  if (existing && isAlive(existing.pid)) return { ok: true, alreadyRunning: true, pid: existing.pid };
  if (existing) removePid(name);   // ← two concurrent starts both reach here → both spawn
```
**Fix:** wrap the spawn decision in the `state-lock.js` `O_EXCL` primitive; the second process sees `EEXIST` → reports "already starting/started" → exits clean. Reuse the primitive, no new lock logic.

---

### `src/triggers/dispatcher.js` — dedup no-GSD cross-process (CONC-08)

**Analog:** the GSD lock guard already in this file (`dispatcher.js:143-159`, `acquireGsdLockFn`) — mirror it for the non-GSD lane.

**Current in-process-only dedup** (`dispatcher.js:16` + `:138`):
```javascript
const inFlight = new Set();   // ← in-process only
...
if (inFlight.has(task.id)) {   // dedups only within the same process
  return { action: 'already_active' };
}
```
The non-GSD lane never acquires the GSD lock (that guard is `if (gsdMode)` at `:150`). **Fix (D-13):** for the non-GSD lane, acquire a per-`task_id` lock via `state-lock.js` (path e.g. `~/.kodo/locks/dispatch-<task_id>.lock`) before dispatching. Mirror of the per-repo GSD lock. Acquire-before-dispatch, release in finally — same ownership discipline as the CR-01 fix already applied to the GSD lane (acquire/persist/release share one identity).

---

### `src/session/reconcile.js` — sole writer of `alive` (CONC-01/03 support)

**No logic change to reconcile's state machine.** `applyLiveFields` (`:257`) stays the sole writer of `alive`. Only change: `runReconcileTick`'s `saveState` participates in `withStateLock` via the snapshot-outside / apply-inside pattern (see state.js entry, Pitfall 1).

---

### `src/server.js:842` — fix the false "ÚNICO escritor" comment (CONC-01 / D-04)

**Grep, do NOT trust the audit's `:682`** (Pitfall 6 — the line drifted to `:842`):
```
842:  // proceso server — el ÚNICO escritor de state.json (el dashboard es cliente
```
Replace with the truth ("N escritores coordinados por `withStateLock`") in the SAME commit that introduces `withStateLock`.

## Shared Patterns

### Advisory lock (`O_EXCL` + isPidAlive + TTL + steal)
**Source:** `src/gsd/lock.js` (whole file) → generalized into `src/session/state-lock.js`.
**Apply to:** `withStateLock` (state writers), `polling start` (lifecycle), dedup no-GSD (dispatcher).
**Key:** reuse `isPidAlive` by import; creation via `{flag:'wx'}`; steal via tmp+rename; release ownership-checked; retry-exhaustion = warn+abort, never throw/block.

### Atomic file write (tmp+rename)
**Source (3 proven impls, do NOT hand-roll a 4th):** `saveState` (`state.js:242`), `writeFileAtomic` (`config.js:100`), `writePidFile` (`polling-daemon.js:94-101`, adds `chmodSync(tmp, 0o600)`).
**Apply to:** config migration (D-14), `stealLock` (D-08), all lock writes.

### PID payload shape + defensive read
**Source:** `readPidFile`/`writePidFile` (`polling-daemon.js:94-129`) — shape-check `pid:number` + `started_at:string`, fail-open to `null`. Daemon payload `{pid, started_at, kind:'daemon'}` already passes.
**Apply to:** teardown ownership guard (D-09), anti-PID-reuse (D-11).

### Never-throws / safe degradation
**Source:** `stopDaemon` ESRCH handling (`lifecycle.js:190`), `readPidFile` fail-open.
**Apply to:** lock-timeout (D-03), `ps` absent/unparseable (D-11).

### Test scaffold: HOME-isolation + dynamic import
**Source:** `test/state/save-state-atomic.test.js:1-45` — `mkdtempSync` sandbox, set `HOME` BEFORE dynamic `import()` of state.js (KODO_DIR cached at module-load from `homedir()`), reset in afterEach.
**Apply to:** `config-migration-atomic.test.js`, `state-lock.test.js`.

### Test scaffold: real-process race
**Source:** `test/gsd-concurrency.test.js` (mkdtemp per-test sandbox) + `spawn(..., {detached})` from `lifecycle.js:121`.
**Apply to:** `gsd-lock-race.test.js`, `polling-start-race.test.js`, `dispatcher-dedup-crossproc.test.js`, `state-lock-concurrency.test.js`. Pattern (RESEARCH lines 409-429): helper `.mjs` that `acquireLock`+reports stdout; sync barrier (`go` file); launch N children simultaneously; assert on aggregate (`exactly 1 acquired`), not on which wins.

## No Analog Found

None. Every file has an exact or near-exact in-repo analog — this is a hardening phase over existing plumbing, with zero new npm dependencies (milestone invariant).

## Metadata

**Analog search scope:** `src/session/`, `src/gsd/`, `src/daemon/`, `src/cli/`, `src/triggers/`, `src/config.js`, `src/server.js`, `test/state/`, `test/gsd-concurrency.test.js`.
**Files scanned:** 10 source + 2 test analogs (read); all excerpts verified against current code 2026-07-06.
**Pattern extraction date:** 2026-07-06
