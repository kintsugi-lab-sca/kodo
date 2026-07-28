# Phase 82: Fix de la carrera de `stealLock` - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 5 (1 production rewrite, 1 new test, 3 doc closures)
**Analogs found:** 5 / 5 (all in-repo; no external patterns needed)

## Scope note

This is a **surgical fix + rewrite** phase, not a greenfield build. There is exactly
**one production file** touched (`src/gsd/lock.js`, D-08 blast-radius LOCKED), one **new
test file**, and three **documentation closures**. Every code pattern the fix needs
already exists in the repo — the fix *composes* them, it does not invent primitives
(RESEARCH.md "Key insight"). All analogs are exact or role-match.

## File Classification

| File | Change | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `src/gsd/lock.js` (`stealLock` + new private helpers) | modify | service / concurrency primitive | file-I/O (mutual exclusion via `node:fs`) | `src/hooks/session-end.js:368-381` (atomic tmp+rename) + `src/gsd/lock.js:203-208` (O_EXCL create) | exact (self-referential, patterns in-file) |
| `src/gsd/lock.js:258-282` (docblock of `stealLock`) | modify | doc | — | existing docblocks in same file (`:14-32`, `:101-107`) | exact |
| `test/gsd-lock-guard.test.js` | create | test | file-I/O seeding + public-API assertion | `test/gsd-lock.test.js` (unit, `writeLockDirect` seeding) + `test/gsd-lock-race.test.js` (race harness) | exact |
| `.planning/debug/gsd-lock-race-cr01.md` → `resolved/` | move | doc | — | `.planning/debug/resolved/` (dir confirmed to exist) | n/a |
| `.planning/STATE.md` §Deferred Items | modify | doc | — | existing STATE.md rows | n/a |

**Confirmed:** `.planning/debug/resolved/` already exists (D-09 target). `test/gsd-lock-guard.test.js` does not yet exist (Wave 0 create).

## Pattern Assignments

### `src/gsd/lock.js` — `stealLock` rewrite (service, file-I/O concurrency)

**Analogs:** two atomic primitives already in `src/gsd/lock.js` and `src/hooks/session-end.js`. The rewrite composes them; it must NOT add module exports (D-08) and must keep `AcquireResult` shape + JSON lock format intact.

**Imports pattern** — already present at `src/gsd/lock.js:1-12`, NO new imports needed. All primitives (`writeFileSync`, `renameSync`, `unlinkSync`, `readFileSync`, `existsSync`, `mkdirSync`, `dirname`, `randomUUID`) are already imported:
```javascript
import {
  readFileSync, writeFileSync, unlinkSync, existsSync,
  mkdirSync, realpathSync, renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
```

**Pattern 1 — Atomic in-place replacement (D-02, the LOCK owner op).**
Source of truth: `src/hooks/session-end.js:374-381` (WR-02 fix, in production). Unique tmp name per writer (`process.pid` + `randomUUID()`), same directory as target (avoids EXDEV, Pitfall 3), unlink/rm on error:
```javascript
// src/hooks/session-end.js:374-381
const tmp = planPath + '.tmp.' + process.pid + '.' + randomUUID();
try {
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, planPath);   // atomic: planPath never briefly-empty
} catch (err) {
  fs.rmSync(tmp, { force: true }); // no orphaned tmp
  throw err;
}
```
Apply to the critical body of `stealLock`: `writeFileSync(tmp, serializeLockContent(sessionInfo)); renameSync(tmp, lockPath)`. This REPLACES the current move-aside (`src/gsd/lock.js:288-292`) which is the root cause.

**Pattern 2 — `O_EXCL` create (D-02, the GUARD owner op + fresh-create branch).**
Source of truth: `src/gsd/lock.js:203-208` (`writeLockFile`, CONC-02). `{ flag: 'wx' }` = atomic exclusive create, EEXIST on loser:
```javascript
// src/gsd/lock.js:207
writeFileSync(lockPath, serializeLockContent(sessionInfo), { flag: 'wx' });
```
And the EEXIST-handling convention from `src/gsd/lock.js:116-122` / `326-336`:
```javascript
try {
  writeFileSync(guardPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' });
  // won the guard
} catch (e) {
  if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
  // guard busy → break-vs-recontend decision (D-06)
}
```

**Pattern 3 — Staleness reuse (D-05, guard-orphan detection).**
Reuse `isStaleLock` (`src/gsd/lock.js:251-256`) for the in-guard ABA re-check, and `isPidAlive` (`src/gsd/lock.js:72-79`) for guard-owner liveness. Do NOT write new staleness logic (Don't Hand-Roll):
```javascript
// src/gsd/lock.js:251
function isStaleLock(lock) {
  if (!isPidAlive(lock.pid)) return true;
  const acquiredAt = new Date(lock.acquired_at).getTime();
  const ttlHours = lock.ttl_hours || DEFAULT_TTL_HOURS;
  return Number.isFinite(acquiredAt) && Date.now() - acquiredAt > ttlHours * 3600_000;
}
```
Guard-stale predicate (NEW helper, mirrors this shape): `!guard || !isPidAlive(guard.pid) || Date.now() - guard.ts > thresholdMs`.

**Pattern 4 — Bounded re-contention (D-06).**
Reuse `MAX_STEAL_ATTEMPTS` loop skeleton already in `stealLock` (`src/gsd/lock.js:57`, `:287`). The `for (let attempt = 0; attempt < MAX_STEAL_ATTEMPTS; attempt++)` bound stays; only the loop *body* changes (guard-acquire → critical body → finally-unlink guard).

**Error / cleanup pattern** — best-effort unlink in try/catch, present throughout `stealLock` (`src/gsd/lock.js:307-313, 320-331`). Guard cleanup goes in a `finally` (camino feliz + error), tmp cleanup on the throw path:
```javascript
} finally {
  try { unlinkSync(guardPath); } catch { /* best-effort */ }
}
```

**Reference skeleton:** RESEARCH.md §"Esqueleto de `stealLock` reescrito" (lines 224-269) — design reference, not literal prescription. Pitfall 2 (lockPath-absent branch inside guard) needs explicit handling: `current == null` → `writeFileSync(lockPath, ..., {flag:'wx'})` direct (respect a fresh creator), EEXIST → re-read holder.

---

### `src/gsd/lock.js:258-282` — docblock rewrite (doc, D-11)

**Analog:** the module docblock style already in the same file — numbered acquisition cases (`:23-28`), `@param`/`@returns` JSDoc (`:101-107`). The current docblock describes the **move-aside CAS** the fix removes; rewrite it to describe the guard + in-place-rename mechanism (D-02). Keep the same JSDoc `@param`/`@returns` tail (`:278-281`) since the signature is unchanged (D-08).

---

### `test/gsd-lock-guard.test.js` — new unit tests (test, file-I/O seeding)

**Analog:** `test/gsd-lock.test.js` (structure, imports, `writeLockDirect` on-disk seeding) + `test/gsd-lock-race.test.js` (real-process race intent). Test the private guard **via the public API + file seeding** — do NOT export helpers (D-08, Open Question 1).

**Imports + harness pattern** (`test/gsd-lock.test.js:1-22`):
```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireGsdLock, releaseGsdLock, readLock, isPidAlive } from '../src/gsd/lock.js';
```

**Seeding pattern** (`test/gsd-lock.test.js:37-49` `writeLockDirect`) — write lock/guard content directly to disk to simulate stale/orphan scenarios, then invoke `acquireGsdLock` and assert result + final on-disk state:
```javascript
function writeLockDirect(projectPath, content) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  writeFileSync(join(planning, '.kodo.lock'), JSON.stringify(content, null, 2) + '\n');
}
```
Extend with a `writeGuardDirect` seeding a `.kodo.lock.steal-guard` with a chosen `{pid, ts}`.

**Sandbox lifecycle** (`test/gsd-lock.test.js:53-62`): `mkdtempSync(join(tmpdir(), 'kodo-lock-'))` in `beforeEach`, `rmSync(..., {recursive, force})` in `afterEach`.

**Required cases (D-07 / Wave 0):**
- (a) orphan guard, dead PID → steal proceeds (guard broken, exactly one winner).
- (b) fresh guard, live PID → contender re-contends/blocks, no double-acquire.
- (c) simulated crash (guard left + stale lock) → final state consistent (one lock, one winner).
- (a1, from Assumption A1) two breakers of the same orphan guard → exactly one ends up owning.

---

### `.planning/debug/gsd-lock-race-cr01.md` → `.planning/debug/resolved/` (doc, D-09)

`git mv` the file into the existing `resolved/` dir; update its Outcome section (date, fix mechanism, commit). No code pattern — follows the established `.planning/debug/resolved/` convention.

### `.planning/STATE.md` §Deferred Items (doc, D-10)

Mark the row «Carrera real confirmada en `stealLock`» closed with the resolution. Follow the existing row format in that section.

## Shared Patterns

### Atomic write without intermediate empty state
**Source:** `src/hooks/session-end.js:374-381` (WR-02) — canonical in-repo.
**Apply to:** the LOCK-owner op in `stealLock`.
**Rule:** unique tmp name (`pid + randomUUID()`), same dir as target, `renameSync(tmp, dest)`, cleanup on throw. NEVER a fixed tmp name (`writeFileAtomic` in config.js is the anti-pattern WR-02 fixed — RESEARCH Anti-Patterns).

### Exclusive create (O_EXCL)
**Source:** `src/gsd/lock.js:207` (`writeLockFile`) + `src/session/state-lock.js:78`.
**Apply to:** the GUARD-owner op and the fresh-create branch.
**Rule:** `writeFileSync(path, body, { flag: 'wx' })`; treat only `EEXIST` as "lost", rethrow anything else. Ownership is conferred ONLY by a successful `O_EXCL`-create, never by a rename/move-aside (RESEARCH Pattern 2-3).

### Staleness detection
**Source:** `src/gsd/lock.js:72-79` (`isPidAlive`) + `:251-256` (`isStaleLock`).
**Apply to:** in-guard ABA re-check (lock) and guard-orphan break decision.
**Rule:** reuse verbatim; do not re-derive TTL/PID logic. Guard break criterion: dead PID (always safe) OR age > threshold (seconds ≫ ~1ms critical section, Pitfall 1 / A2).

### EEXIST-handling idiom
**Source:** `src/gsd/lock.js:116-122`, `:326-336`.
**Apply to:** every `O_EXCL` create in the rewrite.
```javascript
if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
const holder = readLockContent(lockPath);
if (holder && !isStaleLock(holder)) return { acquired: false, holder };
// else re-contend
```

### Best-effort cleanup
**Source:** `src/gsd/lock.js:307-331` (existing), `src/hooks/session-end.js:379`.
**Apply to:** tmp + guard removal.
**Rule:** `try { unlinkSync(x); } catch { /* best-effort */ }`; guard unlink in `finally` (happy + error path).

## No Analog Found

None. Every construct the fix needs has an exact in-repo precedent. The only genuinely
*new* code is the guard-orphan break helper (`guardIsStale` + break-once), which is a
straightforward composition of `isPidAlive` + a timestamp threshold — no external pattern
required. Planner should reference RESEARCH.md Patterns 1-3 and the analogs above, NOT
invent a new concurrency primitive.

## Metadata

**Analog search scope:** `src/gsd/lock.js`, `src/hooks/session-end.js`, `src/session/state-lock.js`, `test/gsd-lock.test.js`, `test/gsd-lock-race.test.js`, `.planning/debug/resolved/`.
**Files scanned:** 6.
**Pattern extraction date:** 2026-07-24.
