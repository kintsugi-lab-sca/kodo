#!/usr/bin/env node
// @ts-check
//
// Claude Code SessionStart hook for kodo
// Reads session context from stdin, checks if cwd matches a tracked task,
// and injects provider-agnostic work item context via stdout.

import { fileURLToPath } from 'node:url';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';

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
  ].join('\n');
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
    const config = loadConfig();
    const context = buildSessionContext(session, config);

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
