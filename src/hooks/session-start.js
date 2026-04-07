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
      'Al terminar, el hook de Stop actualizará Plane automáticamente.',
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
