#!/usr/bin/env node
// @ts-check
//
// Claude Code Stop hook for kodo
// Mechanical cleanup when a kodo-tracked Claude session ends: removes
// the session from local state and marks the cmux workspace as review.
// The active Claude session owns all provider-side interactions
// (comments, state transitions) so the hook never touches Plane.
// Also detects when the orchestrator session ends and auto-commits
// skill changes.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSession, removeSession } from '../session/state.js';
import { getSessionMode } from '../labels.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_ROOT = join(__dirname, '..', '..');
const SKILL_PATH = join(KODO_ROOT, 'skills', 'kodo-orchestrate', 'skill.md');

const STDIN_TIMEOUT = 3000;

/**
 * Build the orchestrator nudge text for a session that just ended.
 * Pure function — no I/O. Exported for testing.
 *
 * Phase 12 D-07: switch exhaustivo sobre getSessionMode(session) con tres cases:
 *   - 'quick' → texto que NO sugiere `kodo gsd verify` (CLI no soporta quick).
 *               Es one-shot sin VERIFICATION.md; orchestrator revisa manualmente.
 *   - 'full'  → texto Phase 10 D-04: apunta a `kodo gsd verify <session-id>`.
 *               phase_id puede estar ausente (bootstrap, Phase 9 D-11) → fallback "bootstrap".
 *   - default → null (no-GSD): texto original "Revisa el resultado y decide…".
 *
 * Idioma: español (D-16 Phase 10).
 *
 * @param {import('../session/state.js').Session} session
 * @returns {string}
 */
export function buildStopNudgeText(session) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  switch (getSessionMode(session)) {
    case 'quick':
      // D-08: texto ES, NO sugiere verify. Escape literal `\\n` preservado (D-04 Phase 10).
      return `${base} Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n`;
    case 'full': {
      // Texto Phase 10 D-04 preservado verbatim.
      const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
      return `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.\\n`;
    }
    default:
      // null → sesión no-GSD. Texto original preservado.
      return `${base} Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`;
  }
}

async function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
  });
}


/**
 * Test-friendly entry point for the stop hook.
 * Pure-ish function over (input, deps) — used by tests with memSink loggerFactory.
 * Production callers should use main() which parses stdin first.
 *
 * Phase 16 LOG-15: añade el bloque `markSessionStatus(... 'done' ...)` PRE-release
 * dentro de la rama "session.gsd" del cleanup. El refactor light a (input, deps)
 * permite a tests inyectar memSink logger sin spawn de child process — mismo
 * patrón que `runGsdVerify(opts, deps)` en src/gsd/verify.js.
 *
 * W-4 deps enumeration:
 *   - findSessionFn: mandatory para tests (lookup en fixture sintético)
 *   - removeSessionFn: mandatory para test no-GSD (sanity removeSession ejecuta)
 *   - cmux: mandatory para aislamiento — el flow invoca setColor/notify/listWorkspaces/send
 *           tanto en GSD como no-GSD; sin stub los tests intentarían conectar a cmuxd real.
 *   - loggerFactory: mandatory para captura de state.transition + session.end
 *
 * @param {{session_id: string, cwd?: string, transcript_path?: string}} input
 * @param {{
 *   findSessionFn?: typeof findSession,
 *   removeSessionFn?: typeof removeSession,
 *   cmux?: typeof cmux,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 * }} [deps]
 * @returns {Promise<void>}
 */
export async function runStopHook(input, deps = {}) {
  // W-4: defaults vía OR — runtime productivo usa los imports estáticos.
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  const cmuxClient = deps.cmux || cmux;
  try {
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    // Find the tracked session — prefer session_id (unique), fall back to cwd
    console.error(`[kodo:stop] Looking for session: sessionId=${sessionId}, cwd=${cwd}`);
    let result = findSessionFn({ sessionId, cwd });

    if (!result) {
      console.error(`[kodo:stop] No matching session found`);
      // Check if this is the orchestrator session (cwd = kodo repo)
      const isOrchestratorSession = cwd && (
        cwd === KODO_ROOT ||
        cwd.startsWith(KODO_ROOT + '/')
      );
      if (isOrchestratorSession) {
        await handleOrchestratorStop();
      }
      return;
    }

    const { id, session } = result;

    // The active Claude session owns all Plane interactions (comments +
    // state transition to review). The hook only performs mechanical
    // cleanup: cmux color + local state removal.
    try {
      await cmuxClient.setColor({
        workspace: session.workspace_ref,
        color: colorForStatus('review'),
      });
    } catch (err) {
      console.error(`[kodo] Error setting color: ${err.message}`);
    }

    try {
      await cmuxClient.notify({
        title: `kodo: ${session.task_ref} cerrada`,
        body: session.summary,
        workspace: session.workspace_ref,
      });
    } catch {}

    // Emit typed session.end event BEFORE removeSession so the logger
    // captures the transition while the session record still exists.
    // Silent-failure: never crash Claude Code stop hook.
    // W-2 (Phase 16): bloque preservado en su sitio durante el refactor —
    // solo cambia la creación del logger (loggerFactory si presente).
    try {
      const log = (deps && deps.loggerFactory)
        ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
        : await (async () => {
            const { createLogger } = await import('../logger.js');
            return createLogger({
              sessionId: session.session_id,
              minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
            }).child({ component: 'hook', task_id: session.task_id });
          })();
      const { sessionEnd } = await import('../logger-events.js');
      sessionEnd(log, {
        session_id: session.session_id,
        task_id: session.task_id,
        status: session.status,
        ended_at: new Date().toISOString(),
      });
    } catch {
      // silent — never crash Claude Code
    }

    // Release GSD lock if applicable (D-09: idempotent, verifies session_id)
    if (session.gsd) {
      // Phase 16 LOG-15 (D-04, D-08): mark session 'done' BEFORE releaseGsdLock so
      // the state.transition event captures the terminal status while the session
      // record still exists. Mirrors the session.end pattern at line 116 (emit
      // BEFORE mutation). Status is fixed 'done' for both modes (full + quick) —
      // stop.js is a mechanical hook and does NOT infer mode (D-04, D-07).
      // Reason canónico: 'session-stop:lock-released' (D-06).
      try {
        const log = (deps && deps.loggerFactory)
          ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
          : await (async () => {
              const { createLogger } = await import('../logger.js');
              return createLogger({
                sessionId: session.session_id,
                minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
              }).child({ component: 'hook', task_id: session.task_id });
            })();
        const { markSessionStatus } = await import('../session/manager.js');
        markSessionStatus(session.task_id, 'done', 'session-stop:lock-released', log);
      } catch {
        // silent — never block lock release on logger failure (mirrors session.end pattern line 116)
      }

      try {
        const { releaseGsdLock } = await import('../gsd/lock.js');
        releaseGsdLock(session.project_path, session.session_id);
      } catch (err) {
        console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
      }
    }

    removeSessionFn(id);
    console.error(`[kodo:stop] Session ${session.task_ref} removed from state`);

    // Notify orchestrator if running
    try {
      const workspaces = await cmuxClient.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        await cmuxClient.send({
          workspace: orchMatch[1],
          text: buildStopNudgeText(session),
        });
      }
    } catch {}

    // Session stays in state with status "review" — orchestrator or human removes it after approval
  } catch (err) {
    console.error(`[kodo] Stop hook error: ${err.message}`);
  }
}

async function main() {
  const input = JSON.parse(await readStdin());
  await runStopHook(input);
  // Preserve the historical exit semantics — main() always exits 0 (the hook
  // must not crash Claude Code). runStopHook ya envuelve su cuerpo en try/catch
  // top-level que silencia errores. El branch `no session found + orchestrator`
  // ahora retorna en lugar de process.exit(0); main() simplemente termina.
  process.exit(0);
}

/**
 * Called when the orchestrator session ends.
 * Auto-commits any pending changes in skills/ to preserve learnings.
 */
async function handleOrchestratorStop() {
  const { execSync } = await import('node:child_process');

  try {
    // Check if there are uncommitted changes in skills/
    const status = execSync('git status --porcelain skills/', {
      cwd: KODO_ROOT,
      encoding: 'utf-8',
    }).trim();

    if (!status) {
      console.error('[kodo] Orchestrator session ended — no skill changes to commit');
      return;
    }

    // Auto-commit skill changes
    const date = new Date().toISOString().slice(0, 10);
    execSync(`git add skills/ && git commit -m "skill: orchestrator learnings ${date}"`, {
      cwd: KODO_ROOT,
      encoding: 'utf-8',
    });

    console.error('[kodo] Orchestrator skill changes auto-committed');

    await cmux.notify({
      title: 'kodo: skill actualizado',
      body: `Aprendizajes del orquestador guardados (${date})`,
    });
  } catch (err) {
    console.error(`[kodo] Error auto-committing skill: ${err.message}`);
  }
}

// Only run main() when invoked as CLI (not when imported for testing)
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainEntry) {
  main();
}
