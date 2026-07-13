// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Ficheros canónicos de los hooks de kodo. B9 (Phase 72): el match de
 * install/uninstall se hace por el segmento de ruta `/src/hooks/<name>.js`
 * (soporta separador POSIX y Windows) en vez del substring genérico `'kodo'`,
 * que confundiría cualquier comando ajeno que mencione "kodo". Robusto ante la
 * ubicación de instalación (global vs local): no exige la ruta absoluta completa.
 */
const KODO_HOOK_FILES = ['session-start.js', 'stop.js', 'session-end.js'];

/**
 * @param {unknown} command
 * @returns {boolean} true si el comando invoca un hook canónico de kodo.
 */
function isKodoHookCommand(command) {
  if (typeof command !== 'string') return false;
  return KODO_HOOK_FILES.some(
    (f) => command.includes(`/src/hooks/${f}`) || command.includes(`\\src\\hooks\\${f}`),
  );
}

/**
 * Install kodo hooks into Claude Code settings.json
 * Adds SessionStart and Stop hooks without clobbering existing ones.
 * Phase 50.1 (DG-08): el hook de captura 50-02 (los eventos Task* →
 * task-progress.js) quedó DEMOTADO — leía la superficie equivocada
 * (~/.claude/tasks/, vacía en sesiones GSD reales que usan Agent, no TaskCreate).
 * El progreso vivo ahora se deriva del bloque progress: del STATE.md del worktree
 * GSD (ver src/cli/dashboard/progress.js::readGsdProgress). Aquí solo se
 * registran SessionStart y Stop.
 */
export function installHooks() {
  const kodoRoot = resolve(import.meta.dirname, '..', '..');
  const sessionStartCmd = `node "${join(kodoRoot, 'src', 'hooks', 'session-start.js')}"`;
  const stopCmd = `node "${join(kodoRoot, 'src', 'hooks', 'stop.js')}"`;
  // Phase 58 LIFE-03: SessionEnd hace el cleanup terminal al cierre real (`/exit`).
  const sessionEndCmd = `node "${join(kodoRoot, 'src', 'hooks', 'session-end.js')}"`;

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

  // Install SessionEnd hook (Phase 58 LIFE-03)
  changed = addHook(settings.hooks, 'SessionEnd', sessionEndCmd) || changed;

  if (changed) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    console.log('✓ Hooks instalados en ~/.claude/settings.json');
    console.log(`  SessionStart: ${sessionStartCmd}`);
    console.log(`  Stop: ${stopCmd}`);
    console.log(`  SessionEnd: ${sessionEndCmd}`);
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

  for (const event of ['SessionStart', 'Stop', 'SessionEnd']) {
    if (!Array.isArray(settings.hooks[event])) continue;
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter((entry) => {
      const hooks = entry.hooks || [];
      return !hooks.some((h) => isKodoHookCommand(h.command));
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
    return h.some((hook) => isKodoHookCommand(hook.command));
  });

  if (exists) return false;

  hooks[event].push({
    hooks: [{ type: 'command', command }],
  });

  return true;
}
