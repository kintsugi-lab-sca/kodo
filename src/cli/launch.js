// @ts-check
//
// src/cli/launch.js — `kodo launch <ref>` (KODO-42).
//
// La acción vivía inline en `src/cli.js`; se mueve verbatim. El gate `ensureConfig()` se
// queda en el registro de commander, FUERA de este try/catch, igual que estaba: un fallo
// del gate no se reescribe como `Error: <mensaje>` del launch.
//
// Salida: en éxito NO termina el proceso (lo hace el runtime al vaciarse el event loop);
// en error imprime y sale con EXIT_ERROR. Mismo contrato observable que antes de KODO-42.

import { EXIT_ERROR } from './exit-codes.js';

/**
 * Lanza una sesión de Claude Code para una tarea, vía el dispatcher de triggers.
 *
 * @param {string} ref Referencia de la tarea (p.ej. `KL-42`); se normaliza a mayúsculas.
 * @param {{ model?: string, yolo?: boolean, force?: boolean }} opts
 * @returns {Promise<void>}
 */
export async function runLaunchCli(ref, opts) {
  try {
    const { initRegistry } = await import('../providers/registry.js');
    const { loadConfig } = await import('../config.js');
    const { dispatchTrigger } = await import('../triggers/dispatcher.js');

    const config = loadConfig();
    await initRegistry();

    const event = {
      taskRef: ref.toUpperCase(),
      action: 'manual',
      provider: config.provider,
      raw: { source: 'cli', model: opts.model, yolo: opts.yolo },
    };

    const result = await dispatchTrigger(event, {
      model: opts.model || null,
      flags: opts.yolo ? ['yolo'] : [],
      force: opts.force || false,
    });

    if (result.action === 'launched' || result.action === 'stale_relaunch') {
      console.log(`✓ Launched session for ${ref.toUpperCase()}`);
      console.log(`  Workspace: ${result.session.workspace_ref}`);
      console.log(`  Session ID: ${result.session.session_id}`);
      console.log(`  Path: ${result.session.project_path}`);
    } else if (result.action === 'ignored') {
      console.log(`Ignored: ${ref.toUpperCase()} — no kodo label (use --force to override)`);
    } else if (result.action === 'already_active') {
      console.log(`Session already active for ${ref.toUpperCase()}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(EXIT_ERROR);
  }
}
