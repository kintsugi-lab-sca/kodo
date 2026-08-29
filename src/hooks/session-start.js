#!/usr/bin/env node
// @ts-check
//
// Claude Code SessionStart hook for kodo
// Reads session context from stdin, checks if cwd matches a tracked task,
// and injects provider-agnostic work item context via stdout.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { findSession, updateSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { KODO_DIR } from '../config.js';
import { getSessionMode } from '../labels.js';

const STDIN_TIMEOUT = 3000;

// KODO-19: `buildSessionContext` se movió a `session/context.js` — SIN tocar el texto —
// porque `session/manager.js` también lo necesita, para inyectarlo en el prompt de los
// agentes que no ejecutan este hook. El movimiento va en esa dirección y no al revés:
// este fichero carga `logger.js` por `import()` dinámico, y el guard de aislamiento
// LOG-12 (test/check-isolation.test.js) prohíbe que ese logger entre en el grafo de
// `check.js` — que es justo lo que pasaría si `manager.js` importase el hook entero.
//
// Se importa Y se re-exporta, no solo se re-exporta: un `export { x } from '…'` NO crea
// el binding local, así que `main()` se quedaría sin la función y el try/catch exterior
// se tragaría el ReferenceError en silencio (el hook saldría con 0 y sin contexto).
import { buildSessionContext } from '../session/context.js';
export { buildSessionContext };

/**
 * Build GSD-mode context injected into Claude Code sessions.
 * Replaces buildSessionContext entirely for GSD sessions (per D-03).
 * Pure: no I/O, no globals — fully testable.
 *
 * Phase 9 extension (D-09, D-11): accepts `opts.brief` (pre-rendered bootstrap
 * brief from buildBriefFromTask) and renders it FIRST, then the bootstrap
 * command. Phase 8 behavior unchanged for sessions that already have phase_id.
 *
 * @param {import('../session/state.js').Session} session
 * @param {{ brief?: string }} [opts] - Phase 9: bootstrap brief to render before commands (D-11 order).
 * @returns {string}
 */
export function buildGsdContext(session, opts = {}) {
  const lines = [
    `# kodo ${session.task_ref} — GSD Mode`,
    '',
    `You are working on **${session.task_ref}: ${session.summary}**`,
    `- Project path: ${session.project_path}`,
    `- Session ID: ${session.session_id}`,
    `- Work item ID: ${session.task_id} | Project ID: ${session.project_id}`,
    '',
    '## GSD Workflow',
    '',
  ];

  const mode = getSessionMode(session);
  if (mode === 'quick') {
    // Phase 12 D-06: quick wins over phase_id (defense in depth — dispatcher
    // already strips phase_id in quick mode per Phase 11 D-03).
    // D-03: brief FIRST when present (quick+bootstrap), command AFTER.
    // Replicates D-11 Phase 9 ordering. In quick+match the dispatcher does
    // not persist a brief, so the block simply skips.
    if (opts.brief) {
      lines.push(opts.brief, '');
    }
    // D-04: defang double-quotes in the title with a simple replace before
    // wrapping in double-quotes. Plane titles rarely use quotes meaningfully;
    // Claude Code's slash-command parser handles backslash escapes
    // inconsistently, so a literal replacement is the predictable choice.
    const safeTitle = session.summary.replace(/"/g, "'");
    lines.push(
      'This is a one-shot GSD session.',
      '',
      'Execute the slash command:',
      '',
      `1. \`/gsd-quick "${safeTitle}"\``,
      '',
      // D-05: closing line that justifies why this block has a single
      // command instead of three. Idioma EN per D-04 Phase 8.
      'Run the slash command and finish — no plan/execute/verify cycle.',
      // Phase 45 PLAN-03: append DENTRO del if quick — antes del bloque común
      // "## No automatic push" (fuera del if/else) preserva la D-04 common-block
      // invariance. D-03 sin I/O, D-05 markdown plano, D-07 una línea para el NEXT,
      // D-08 EN (bloque GSD).
      //
      // Phase 74 D-10 + LIVE-02: misma inversión que la rama no-GSD (`buildSessionContext`) —
      // «overwrite if it exists» (Phase 45 D-06, latest-wins) pasa a preservar-y-appendear.
      // LIVE-02 nombra solo la rama ES porque es donde se detectó; ambas son el MISMO bug.
      // Las ramas full y bootstrap NO reciben instrucción por diseño (D-10): las cubre el
      // backstop mecánico de D-03 y esas sesiones ya tienen continuidad propia vía GSD.
      // Las etiquetas del formato siguen en español en ambos idiomas: lo que alterna por
      // rama es la INSTRUCCIÓN (D-08 Phase 45), no el contrato — el parser de D-02 busca
      // `**NEXT:**` y el bloque mecánico de D-03 escribe español.
      '',
      `Also, at the start write a short plan (what you'll do + planned steps) to \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`. If the file already exists, do NOT overwrite it: append your plan at the end, keeping intact whatever is already there.`,
      '',
      'And when you close the session, append a handoff block at the end of that same file, without deleting the previous blocks, using this exact format:',
      '',
      '```markdown',
      `## Handoff <local date-time YYYY-MM-DD HH:MM> <!-- kodo:handoff v=1 session=${session.session_id} author=llm at=<ISO-8601 UTC timestamp> -->`,
      '',
      '**Hecho:** what you completed in this session',
      '**Pendiente:** what is still open',
      '**NEXT:** the next concrete action, on a single line',
      '```',
    );
  } else if (session.phase_id) {
    // Phase known — inject plan/execute/verify sequence (D-01)
    lines.push(
      `This is a GSD session for **phase ${session.phase_id}**.`,
      '',
      'Execute the following commands in order:',
      '',
      `1. \`/gsd-plan-phase ${session.phase_id}\``,
      `2. \`/gsd-execute-phase ${session.phase_id}\``,
      `3. \`/gsd-verify-work\``,
      '',
      'Do NOT comment your plan manually or move the task state — GSD manages the full cycle.',
    );
  } else {
    // No phase — bootstrap mode (D-01 fallback).
    // D-11: brief FIRST, commands AFTER. Claude reads the brief, then executes
    // the bootstrap command. If brief is absent (legacy sessions or non-GSD
    // bootstrap paths), skip the brief block entirely — never render a blank section.
    if (opts.brief) {
      lines.push(opts.brief, '');
    }
    lines.push(
      'No `.planning/` directory detected or no phase resolved for this task.',
      '',
      'Run the bootstrap command:',
      '',
      '1. `/gsd-new-project`',
      '',
      'This will initialize the project planning structure using the task description as brief.',
    );
  }

  // Phase 20 HOOK-01 (GSD EN): anti-push reminder común a las 3 ramas (quick / phase / bootstrap).
  // D-04: bloque EN único; las 3 ramas convergen aquí post-if/else.
  // HOOK-02 satisfied-by-construction: append al FINAL preserva golden bytes de los bloques anteriores.
  lines.push(
    '',
    '## No automatic push',
    '',
    'kodo does NOT push automatically. Before claiming a deploy, release, or any remote change, verify with a real `git push`, or phrase the claim conditionally ("once pushed…").',
    '',
    'Examples:',
    '- Bad: "Feature deployed to production."',
    '- Good: "Feature committed locally, pending `git push` to remote."',
    '- Bad: "Deploy done."',
    '- Good: "Deploy will be live once `git push origin main` runs."',
  );

  return lines.join('\n');
}

/**
 * Deja traza del rebind de identidad de una sesión BB (KODO-31). Best-effort y
 * never-throws: el logger se carga LAZY y un fallo suyo jamás debe tumbar el arranque de
 * Claude Code — mismo criterio que el bloque de `sessionStart` de más abajo.
 *
 * Merece traza propia porque es el ÚNICO punto del sistema donde el `session_id` de una
 * sesión cambia después de persistirse. Sin este rastro, un `state.json` cuyo session_id
 * no coincide con el que kodo generó al lanzar parecería corrupción.
 *
 * @param {{ session: any, newSessionId: string, threadId: string, persisted: boolean }} params
 */
async function emitRebindEvent({ session, newSessionId, threadId, persisted }) {
  try {
    const { createLogger } = await import('../logger.js');
    const log = createLogger({
      sessionId: newSessionId,
      minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
    }).child({ component: 'hook', task_id: session.task_id });
    log.info('session.rebind', {
      task_ref: session.task_ref,
      thread_id: threadId,
      from_session_id: session.session_id,
      to_session_id: newSessionId,
      host: session.host,
      persisted,
    });
  } catch {
    // silent — never crash Claude Code
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

async function main() {
  try {
    const input = JSON.parse(await readStdin());
    const sessionId = input.session_id;

    // KODO-27 — lookup por IDENTIDAD, sin fallback por cwd. Este hook INYECTA el
    // contexto de la tarea en el prompt: un match equivocado no corrompe estado, pero
    // arranca la sesión creyendo que trabaja en otra cosa. El 20-ago el orquestador
    // arrancó con el contexto de KODO-24 — una tarea cerrada horas antes — porque el
    // fallback matcheó su cwd contra `state.history`, donde TODAS las sesiones
    // archivadas del repo comparten `project_path`.
    //
    // Sólo `session_id` identifica: kodo lo genera en el dispatcher y se lo pasa a
    // Claude Code con `--session-id`, así que la sesión lanzada por kodo sigue
    // recibiendo su contexto igual que antes. Una sesión ad-hoc no adoptada sale en
    // silencio, que es lo correcto: no hay tarea que inyectar.
    let result = findSession({ sessionId });

    // KODO-31 — fallback ACOTADO por BB_THREAD_ID, y su rebind.
    //
    // El host bb rompe la premisa sobre la que se construyó el lookup por identidad: kodo
    // NO controla el `--session-id`. BB arranca Claude Code por el Agent SDK y genera el
    // suyo, así que el `session_id` que kodo persistió al lanzar NUNCA coincidirá con el
    // que llega por stdin — la sesión saldría en silencio y arrancaría sin contexto de
    // tarea, que es exactamente el fallo que este hook existe para evitar.
    //
    // Lo que SÍ controla kodo es el ref: el id del thread, que BB exporta en el entorno del
    // proceso hijo como `BB_THREAD_ID` (verificado en vivo) y que kodo guardó como
    // `workspace_ref`. Ese es el puente, y es identidad REAL —no una heurística por cwd
    // como el fallback que KODO-27 eliminó—: un thread pertenece a una sola sesión.
    //
    // Tres guardas, todas necesarias:
    //   1. Solo si el lookup por session_id ya falló (cero cambio para cmux/orca).
    //   2. Solo con `BB_THREAD_ID` presente: sin la variable el hook sigue saliendo en
    //      silencio, así que una sesión ad-hoc no adoptada no matchea por accidente.
    //   3. Solo sobre `state.sessions` y con `host === 'bb'`: una entry de history no se
    //      reabre, y una sesión de otro host no se toca aunque su ref colisionara.
    //
    // El REBIND es la mitad importante: se reescribe `session_id` con el real del hijo. A
    // partir de ahí `stop.js` y `session-end.js` matchean por session_id SIN cambio alguno,
    // y el `pgrep -f "session-id <sid>"` del reconcile encuentra el proceso — BB lanza
    // `claude … --session-id <ese mismo id>`, así que la detección de proceso vivo vuelve a
    // funcionar. Sin el rebind, kodo tendría el contexto pero no podría cerrar la sesión.
    if (!result && process.env.BB_THREAD_ID) {
      const byThread = findSession({ workspaceRef: process.env.BB_THREAD_ID });
      if (byThread && byThread.source === 'sessions' && byThread.session.host === 'bb') {
        const upd = updateSession(byThread.id, { session_id: sessionId });
        // Un lock-timeout NO invalida el contexto: el prompt se inyecta igual (es lo más
        // valioso y es idempotente). Lo que se pierde es el rebind, y el siguiente
        // SessionStart —BB reanuda con `source=resume`— lo reintenta.
        result = { ...byThread, session: { ...byThread.session, session_id: sessionId } };
        await emitRebindEvent({
          session: byThread.session,
          newSessionId: sessionId,
          threadId: process.env.BB_THREAD_ID,
          persisted: !(upd && upd.ok === false),
        });
      }
    }

    if (!result) {
      // No tracked session for this session_id — silent exit
      process.exit(0);
    }

    const { session } = result;
    // Phase 9: thread session.brief into buildGsdContext — it was persisted by
    // the dispatcher via buildSessionFromTask when resolver returned 'bootstrap'.
    const context = session.gsd
      ? buildGsdContext(session, { brief: session.brief })
      : buildSessionContext(session, loadConfig());

    // Emit typed session.start event (best-effort; silent on failure so we
    // never crash Claude Code startup — outer try/catch still catches but
    // the inner try makes the intent explicit and isolates logger load).
    try {
      const { createLogger } = await import('../logger.js');
      const { sessionStart } = await import('../logger-events.js');
      const log = createLogger({
        sessionId: session.session_id,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'hook', task_id: session.task_id });
      sessionStart(log, {
        session_id: session.session_id,
        task_id: session.task_id,
        provider: session.provider,
        project_path: session.project_path,
        transcript_path: input.transcript_path,
        started_at: new Date().toISOString(),
      });
    } catch {
      // silent — never crash Claude Code
    }

    // Phase 9 (pattern-mapper refinement #3, completado en 09-06): ni
    // gsd.phase.resolved ni gsd.bootstrap se emiten desde este hook. El
    // dispatcher es la fuente única (src/triggers/dispatcher.js).

    // Output context for Claude Code to inject
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    });

    process.stdout.write(output);
  } catch {
    // Silent failure — never break Claude Code startup
  }
}

// Only run main() when invoked directly as a script, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
