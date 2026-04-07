#!/usr/bin/env node
// @ts-check
//
// Claude Code SessionStart hook for kodo
// Reads session context from stdin, checks if cwd matches a tracked task,
// and injects Plane work item context via stdout.

import { findSession } from '../session/state.js';

const STDIN_TIMEOUT = 3000;

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
    const context = [
      `# kodo ${session.plane_identifier} ${new Date().toISOString().slice(0, 16)}`,
      '',
      `Estás trabajando en **${session.plane_identifier}: ${session.summary}**`,
      `Proyecto path: ${session.project_path}`,
      `Session ID: ${session.session_id}`,
      '',
      '## Documentación de progreso',
      '',
      'IMPORTANTE: Debes documentar tu progreso en Plane para que sea visible sin entrar en esta sesión.',
      '',
      '1. **Al empezar**: añade un comentario en Plane con tu plan de acción',
      '2. **Tras cada hito importante** (feature completada, bug encontrado, decisión tomada): añade un comentario breve en Plane',
      '3. **Al terminar**: añade un comentario final con resumen de lo hecho, archivos modificados, y cualquier pendiente',
      '',
      `Para comentar usa el MCP de Plane: work item ID = ${session.plane_id} | project ID = ${session.project_id}`,
      '',
      'Al cerrar la sesión, el hook de Stop moverá la tarea a "In Review" automáticamente.',
    ].join('\n');

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

main();
