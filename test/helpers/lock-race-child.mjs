// test/helpers/lock-race-child.mjs
//
// Child harness for the real-process lock race tests (Phase 70 Plan 01,
// Criterion 1) and the state-writers concurrency test (Phase 70 Plan 02).
// Invoked by:
//   - test/state/state-lock-concurrency.test.js    (--kind state)
//   - test/gsd-lock-race.test.js                   (--kind gsd)
//   - test/state/state-writers-concurrency.test.js (--kind writer)
//   - test/daemon/polling-start-race.test.js       (--kind polling)
//   - test/dispatcher-dedup-crossproc.test.js      (--kind dispatch)
//   - test/state/handoff-concurrency.test.js       (--kind handoff)
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
// `--kind handoff` (Phase 74 Plan 05): each child dynamic-imports
// ../../src/hooks/session-end.js AFTER its HOME is set (parent spawns it with an
// isolated HOME env so KODO_DIR — and therefore ~/.kodo/plans — resolves to the
// sandbox) and calls writeHandoff({session, input, log}, {}) with EMPTY deps, so
// the real defaults (join(KODO_DIR, 'plans') + upsertTaskHandoff) are exercised.
// `--task <taskId>` selects the race: a DIFFERENT task per child races state.json
// (state.tasks, LIVE-04); the SAME task for every child races one plan file's
// read-modify-write (D-08, the lost update). Prints `written` (or `failed`) and
// never throws. Reads --idx (→ session_id `sess-<idx>`, which makes D-04's
// authorship detector see every child as a distinct session) and --task.
//
// argv:
//   --kind   state|gsd|writer|polling|dispatch|handoff   (required)
//   --lock   <path>             (state: the lockfile path)
//   --repo   <path>             (gsd: the fake repo dir)
//   --idx    <n>                (writer/handoff: this writer's session index)
//   --task   <taskId>           (dispatch/handoff: the task_id to write —
//                                handoff defaults to `task-<idx>`)
//   --sandbox <dir>             (polling/dispatch: the isolated ~/.kodo sandbox root)
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

  // Handoff mode (Phase 74 Plan 05, LIVE-04/D-08): dynamic-import session-end.js
  // AFTER HOME is set by the parent (env), then writeHandoff with EMPTY deps so the
  // real defaults resolve — plansDir → join(KODO_DIR, 'plans') and stateWriterFn →
  // upsertTaskHandoff, both inside the sandbox. The import MUST stay dynamic and
  // POST-HOME (RESEARCH §Pitfall 6): config.js:11 evaluates join(homedir(), '.kodo')
  // at module-load, so a static import would write to the operator's REAL ~/.kodo.
  // Never throws — any error collapses to `failed`.
  if (args.kind === 'handoff') {
    let written = false;
    try {
      const { writeHandoff } = await import('../../src/hooks/session-end.js');
      const idx = args.idx;
      const taskId = args.task || 'task-' + idx;
      const noop = () => {};
      writeHandoff(
        {
          session: {
            task_id: taskId,
            // Distinct session per child → D-04's scoped authorship detector finds no
            // block of its own session, so every child appends (that is the race).
            session_id: 'sess-' + idx,
            task_ref: 'KL-' + idx,
            summary: 'handoff racer ' + idx,
            status: 'running',
          },
          input: { reason: 'clear' },
          log: { info: noop, warn: noop, error: noop, debug: noop },
        },
        {},
      );
      written = true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  // Polling-start mode (Plan 04, CONC-06/D-12): each child calls startDaemon
  // against an isolated HOME (the parent spawns it with HOME=sandbox so
  // ~/.kodo resolves inside the sandbox — the start-lock AND the PID file both
  // live there). The injected `_spawn` records ONE line per real spawn decision
  // to `spawns.log` and writes a live PID file (its own pid), so the winner's
  // bounded-wait resolves and a later loser's pre-flight sees the daemon alive.
  // Verdicts: `started` (the one winner), `already_starting` (blocked on the
  // start-lock) or `already_running` (acquired after the winner released).
  // The parent asserts on the AGGREGATE: exactly one spawn line, exactly one
  // `started` — never on which child wins.
  if (args.kind === 'polling') {
    let verdict = 'blocked';
    try {
      const { startDaemon } = await import('../../src/daemon/lifecycle.js');
      const { writePidFile } = await import('../../src/cli/polling-daemon.js');
      const { appendFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const spawnsLog = join(args.sandbox, 'spawns.log');
      const res = await startDaemon('kodo', ['daemon', 'run'], {
        _spawn: () => {
          // Real spawn decision → cross-process marker (append is atomic for small writes).
          appendFileSync(spawnsLog, `${process.pid}\n`);
          // Emulate the daemon writing a LIVE PID immediately. We use the shared
          // parent (the test runner, process.ppid) because it stays alive for the
          // whole race window — the child itself exits right after printing its
          // verdict, which would make its own pid go stale and let a later loser
          // re-spawn. With a live PID the loser's pre-flight sees `already_running`.
          writePidFile(
            { pid: process.ppid, started_at: new Date().toISOString(), kind: 'daemon' },
            'kodo',
          );
          return { unref() {} };
        },
        _waitMs: 2000,
      });
      if (res.alreadyStarting) verdict = 'already_starting';
      else if (res.alreadyRunning) verdict = 'already_running';
      else if (res.started) verdict = 'started';
      else verdict = 'timed_out';
    } catch {
      verdict = 'error';
    }
    process.stdout.write(verdict);
    process.exit(0);
  }

  // Dispatch-dedup mode (Plan 04, CONC-08/D-13): each child calls dispatchTrigger
  // for the SAME non-GSD task_id against an isolated HOME (KODO_DIR → sandbox), so
  // the per-task_id lock at `~/.kodo/locks/dispatch-<task_id>.lock` is shared. The
  // stubbed launchWorkItemFn appends ONE line per real launch to `launches.log` and
  // then HOLDS the lock (sleep --hold ms) so a concurrent loser's retries:0 attempt
  // lands during the hold → `already_active`. Verdicts: `launched` (one winner) vs
  // `already_active`. Parent asserts exactly one launch line — never which wins.
  if (args.kind === 'dispatch') {
    // dispatchTrigger logs progress to stdout via console.log; silence it so the
    // ONLY thing on this child's stdout is its verdict (the parent parses stdout).
    console.log = () => {};
    let verdict = 'error';
    try {
      const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
      const { appendFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const launchLog = join(args.sandbox, 'launches.log');
      const holdMs = Number(args.hold || 500);
      const taskId = args.task;
      const fakeProvider = {
        getTask: async () => ({
          id: taskId,
          ref: 'KL-' + taskId,
          title: 'race task',
          description: '',
          labels: ['kodo'], // non-GSD: kodo label, no gsd flag
          projectId: 'p',
          projectName: 'P',
          groups: [],
          url: '',
          priority: 'medium',
        }),
      };
      const res = await dispatchTrigger(
        { taskRef: 'KL-' + taskId, action: 'state_change', provider: 'test', raw: {} },
        {},
        {
          getProviderFn: () => fakeProvider,
          launchWorkItemFn: async () => {
            // Record the real launch (cross-process marker), then hold the lock so
            // the concurrent sibling's single acquire attempt lands during the hold.
            appendFileSync(launchLog, `${process.pid}\n`);
            const sab = new Int32Array(new SharedArrayBuffer(4));
            Atomics.wait(sab, 0, 0, holdMs);
            return {
              workspace_ref: 'w', session_id: 's', task_id: taskId, task_ref: 'KL',
              provider: 'test', project_id: 'p', summary: 'race', status: 'running',
              started_at: new Date().toISOString(), project_path: '/tmp/x',
            };
          },
          listSessionsFn: () => [],
          listWorkspacesFn: async () => '',
          removeSessionFn: () => {},
          // Return null → no projectPath → skip worktree collision check; keeps the
          // path minimal (the dedup lock is what we exercise here).
          resolveProjectPathFn: () => null,
        },
      );
      verdict = res.action;
    } catch (e) {
      verdict = 'error:' + (e && e.message ? e.message : String(e));
    }
    process.stdout.write(verdict);
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
