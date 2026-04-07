// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Install kodo hooks into Claude Code settings.json
 * Adds SessionStart and Stop hooks without clobbering existing ones.
 */
export function installHooks() {
  const kodoRoot = resolve(import.meta.dirname, '..', '..');
  const sessionStartCmd = `node "${join(kodoRoot, 'src', 'hooks', 'session-start.js')}"`;
  const stopCmd = `node "${join(kodoRoot, 'src', 'hooks', 'stop.js')}"`;

  let settings;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    console.error(`Cannot read ${SETTINGS_PATH}`);
    return false;
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  let changed = false;

  // Install SessionStart hook
  changed = addHook(settings.hooks, 'SessionStart', sessionStartCmd) || changed;

  // Install Stop hook
  changed = addHook(settings.hooks, 'Stop', stopCmd) || changed;

  if (changed) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    console.log('✓ Hooks instalados en ~/.claude/settings.json');
    console.log(`  SessionStart: ${sessionStartCmd}`);
    console.log(`  Stop: ${stopCmd}`);
  } else {
    console.log('✓ Hooks ya estaban instalados');
  }

  return true;
}

/**
 * Remove kodo hooks from Claude Code settings.json
 */
export function uninstallHooks() {
  let settings;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    console.error(`Cannot read ${SETTINGS_PATH}`);
    return false;
  }

  if (!settings.hooks) return false;

  let changed = false;

  for (const event of ['SessionStart', 'Stop']) {
    if (!Array.isArray(settings.hooks[event])) continue;
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter((entry) => {
      const hooks = entry.hooks || [];
      return !hooks.some((h) => h.command?.includes('kodo'));
    });
    if (settings.hooks[event].length !== before) changed = true;
  }

  if (changed) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    console.log('✓ Hooks de kodo eliminados');
  } else {
    console.log('No se encontraron hooks de kodo');
  }

  return changed;
}

/**
 * @param {object} hooks
 * @param {string} event
 * @param {string} command
 * @returns {boolean} true if added
 */
function addHook(hooks, event, command) {
  if (!Array.isArray(hooks[event])) {
    hooks[event] = [];
  }

  // Check if already installed
  const exists = hooks[event].some((entry) => {
    const h = entry.hooks || [];
    return h.some((hook) => hook.command?.includes('kodo'));
  });

  if (exists) return false;

  hooks[event].push({
    hooks: [{ type: 'command', command }],
  });

  return true;
}
