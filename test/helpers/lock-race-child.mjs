// test/helpers/lock-race-child.mjs
//
// Child harness for the real-process lock race tests (Phase 70 Plan 01,
// Criterion 1) and the state-writers concurrency test (Phase 70 Plan 02).
// Invoked by:
//   - test/state/state-lock-concurrency.test.js    (--kind state)
//   - test/gsd-lock-race.test.js                   (--kind gsd)
//   - test/state/state-writers-concurrency.test.js (--kind writer)
//
// Contract: attempt the acquire EXACTLY ONCE, then print exactly `acquired`
// or `blocked` to stdout and exit 0. Never throw — on any error print
// `blocked`. When `--barrier <goFile>` is given, busy-wait (short poll) until
// the go-file exists before attempting, so the parent can release all children
// simultaneously and maximise real contention.
//
// `--kind writer` (Plan 02): each child dynamic-imports ../../src/session/state.js
// AFTER its HOME is set (the parent spawns it with an isolated HOME env so
// KODO_DIR resolves to the sandbox) and calls addSession('task-<idx>', {...}) for
// its assigned index. All writers race one isolated state.json; the parent then
// asserts zero lost writes. Writer mode prints `written` (or `failed`) and never
// throws. It ignores --lock/--repo and reads --idx.
//
// argv:
//   --kind   state|gsd|writer   (required)
//   --lock   <path>             (state: the lockfile path)
//   --repo   <path>             (gsd: the fake repo dir)
//   --idx    <n>                (writer: this writer's session index)
//   --barrier <goFile>          (optional: wait until this file exists)
//   --hold   <ms>               (optional: after a successful acquire, stay
//                                alive holding the lock for <ms> before exit —
//                                models a holder's critical section so a
//                                slightly-later sibling sees a LIVE owner and
//                                is blocked, instead of stealing a dead-PID
//                                lock the winner abandoned by exiting)

import { existsSync } from 'node:fs';

/** Parse `--flag value` pairs from argv into a plain object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

/** Busy-wait (bounded) until the barrier go-file appears. */
function waitForBarrier(goFile, timeoutMs = 5000) {
  if (!goFile) return;
  const deadline = Date.now() + timeoutMs;
  // Tight spin with a tiny Atomics sleep to avoid pegging the CPU while still
  // reacting within ~1ms of the go-file appearing.
  const sab = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(goFile) && Date.now() < deadline) {
    Atomics.wait(sab, 0, 0, 1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  waitForBarrier(args.barrier);

  // Writer mode (Plan 02): dynamic-import state.js AFTER HOME is set by the
  // parent (env), then addSession for this writer's index. Never throws.
  if (args.kind === 'writer') {
    let written = false;
    try {
      const { addSession } = await import('../../src/session/state.js');
      const idx = args.idx;
      addSession('task-' + idx, {
        workspace_ref: 'workspace:' + idx,
        session_id: 's' + idx,
        task_id: 'task-' + idx,
        task_ref: 'KL-' + idx,
        provider: 'test',
        project_id: 'p1',
        summary: 'writer ' + idx,
        status: 'running',
        started_at: new Date().toISOString(),
        project_path: '/tmp/w' + idx,
      });
      written = true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  let acquired = false;
  try {
    if (args.kind === 'state') {
      const { acquireLock } = await import('../../src/session/state-lock.js');
      const got = acquireLock(args.lock, { retries: 0 });
      acquired = !!(got && got.token);
    } else if (args.kind === 'gsd') {
      const { acquireGsdLock } = await import('../../src/gsd/lock.js');
      const result = acquireGsdLock(args.repo, {
        session_id: 'sess-' + process.pid,
        task_id: 'task-' + process.pid,
        task_ref: 'KL-' + process.pid,
      });
      acquired = result.acquired === true;
    }
  } catch {
    acquired = false;
  }

  // Hold the lock (stay alive) for the winner so concurrent siblings observe a
  // LIVE owner and are blocked, rather than stealing a lock abandoned by exit.
  if (acquired && args.hold) {
    const sab = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sab, 0, 0, Number(args.hold));
  }

  process.stdout.write(acquired ? 'acquired' : 'blocked');
  process.exit(0);
}

main();
