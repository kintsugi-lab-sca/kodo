#!/usr/bin/env node
// @ts-check
//
// Claude Code Stop hook for kodo
// When a kodo-tracked Claude session ends, updates Plane work item
// state and cmux workspace color.

import { findSession, updateSession, removeSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { PlaneClient } from '../plane/client.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';

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
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    // Find the tracked session by cwd or session_id pattern
    let result = findSession({ cwd });
    if (!result && sessionId) {
      // Try to find by session_id prefix match (kodo-kl-42)
      const { loadState } = await import('../session/state.js');
      const state = loadState();
      for (const [id, session] of Object.entries(state.sessions)) {
        if (session.session_id === sessionId) {
          result = { id, session };
          break;
        }
      }
    }

    if (!result) {
      // Not a kodo session — silent exit
      process.exit(0);
    }

    const { id, session } = result;
    const config = loadConfig();

    // Update Plane work item to "Done"
    try {
      const plane = new PlaneClient();
      const states = await plane.listStates(session.project_id);
      const doneState = states.find((s) => s.name === config.plane.done_state);

      if (doneState) {
        await plane.updateWorkItem(session.project_id, session.plane_id, {
          state: doneState.id,
        });
        console.error(`[kodo] ${session.plane_identifier} → ${config.plane.done_state}`);
      }
    } catch (err) {
      console.error(`[kodo] Error updating Plane: ${err.message}`);
    }

    // Update cmux workspace color to "done"
    try {
      await cmux.setColor({
        workspace: session.workspace_ref,
        color: colorForStatus('done'),
      });
    } catch (err) {
      console.error(`[kodo] Error setting color: ${err.message}`);
    }

    // Notify
    try {
      await cmux.notify({
        title: `kodo: ${session.plane_identifier} completada`,
        body: session.summary,
        workspace: session.workspace_ref,
      });
    } catch {}

    // Remove session from state
    removeSession(id);
  } catch (err) {
    console.error(`[kodo] Stop hook error: ${err.message}`);
  }
}

main();
