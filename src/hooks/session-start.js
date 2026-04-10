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

  return [
    `# kodo ${session.task_ref} ${new Date().toISOString().slice(0, 16)}`,
    '',
    `Estás trabajando en **${session.task_ref}: ${session.summary}**`,
    `Proyecto path: ${session.project_path}`,
    `Session ID: ${session.session_id}`,
    '',
    '## Documentación de progreso',
    '',
    'IMPORTANTE: Debes documentar tu progreso en el sistema de tareas para que sea visible sin entrar en esta sesión.',
    '',
    '1. **Al empezar**: añade un comentario con tu plan de acción',
    '2. **Tras cada hito importante** (feature completada, bug encontrado, decisión tomada): añade un comentario breve',
    '3. **Al terminar**: añade un comentario final con resumen de lo hecho, archivos modificados, y cualquier pendiente',
    '',
    `Para comentar usa ${mcpHint}: work item ID = ${session.task_id} | project ID = ${session.project_id}`,
    '',
    'Al cerrar la sesión, el hook de Stop moverá la tarea al estado de revisión automáticamente.',
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

    const result = findSession({ cwd });
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
