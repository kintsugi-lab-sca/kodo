#!/usr/bin/env node
// @ts-check
//
// Claude Code SessionStart hook for kodo
// Reads session context from stdin, checks if cwd matches a tracked task,
// and injects provider-agnostic work item context via stdout.

import { fileURLToPath } from 'node:url';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { getSessionMode } from '../labels.js';

const STDIN_TIMEOUT = 3000;

/**
 * Build the additional context block injected into Claude Code sessions.
 * Pure: no I/O, no globals — fully testable.
 *
 * @param {import('../session/state.js').Session} session
 * @param {{ provider: string, providers: Record<string, any> }} config
 * @returns {string}
 */
export function buildSessionContext(session, config) {
  const providerName = session.provider || config.provider;
  const providerCfg = (config.providers && config.providers[providerName]) || {};
  const mcpHint = providerCfg.mcp_hint || `MCP de ${providerName}`;
  const reviewState = providerCfg.states?.review || 'In Review';

  // Phase 20 HOOK-01 (no-GSD ES): bloque "Anti-push-fantasma" al FINAL del array preserva
  // golden bytes anteriores (HOOK-02 satisfied-by-construction).
  return [
    `# kodo ${session.task_ref}`,
    '',
    `Estás trabajando en **${session.task_ref}: ${session.summary}**`,
    `- Proyecto path: ${session.project_path}`,
    `- Session ID: ${session.session_id}`,
    `- Work item ID: ${session.task_id} | Project ID: ${session.project_id}`,
    '',
    '## Tu responsabilidad',
    '',
    `Tú gestionas el ciclo completo de esta tarea: trabajar → documentar → mover a "${reviewState}" → cerrar sesión. Usa ${mcpHint} para todas las interacciones con ${providerName}.`,
    '',
    '## Flujo esperado',
    '',
    '**1. Al empezar** — comenta tu plan de acción (qué vas a hacer, qué archivos esperas tocar).',
    '',
    '**2. Durante el trabajo** — comenta hitos importantes: features completadas, bugs encontrados, decisiones técnicas tomadas, blockers detectados.',
    '',
    '**3. Al terminar** — antes de cerrar la sesión, haz en orden:',
    '',
    '   a. **Escribe un comentario final de resumen** con:',
    '      - ✅ Qué se ha completado (features, fixes, cambios)',
    '      - 📁 Archivos modificados/creados (lista)',
    '      - ⚠️ Pendientes o limitaciones (si las hay)',
    '      - 🔍 Qué debe revisar el humano para aprobar',
    '',
    `   b. **Mueve la tarea al estado "${reviewState}"** vía ${mcpHint}. Esto señala que está lista para revisión humana.`,
    '',
    `   c. **Cierra la sesión con \`/exit\`** (el hook limpiará el estado local, sin tocar ${providerName}).`,
    '',
    '## Criterios para dar la tarea por terminada',
    '',
    '- La funcionalidad pedida está implementada y probada (si aplica)',
    '- El código está commiteado si era trabajo de código',
    '- La documentación/output solicitado está generado',
    '- Has dejado constancia clara de lo hecho en el comentario final',
    '',
    'Si no puedes terminar (falta info, hay blocker, requiere decisión humana): comenta el estado actual con detalle, **no muevas a revisión**, y cierra con `/exit`. La tarea quedará visible en el dashboard para que el humano intervenga.',
    '',
    '## Anti-push-fantasma',
    '',
    'kodo NO hace `git push` automático. Antes de afirmar deploy, publicación o cambios remotos, verifica con `git push` real, o redacta la afirmación en condicional ("una vez se haga push…").',
    '',
    'Ejemplos:',
    '- Bad: "Feature publicada en producción."',
    '- Good: "Feature commiteada localmente, pendiente de `git push` al remoto."',
    '- Bad: "Deploy hecho."',
    '- Good: "Deploy quedará efectivo una vez se haga `git push origin main`."',
  ].join('\n');
}

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
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;

    const result = findSession({ sessionId, cwd });
    if (!result) {
      // No tracked session for this directory — silent exit
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
