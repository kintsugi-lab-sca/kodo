// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Mapeo canónico evento→file de los hooks de kodo. ÚNICA fuente de verdad de qué
 * hooks registra kodo: consumida por installHooks/uninstallHooks (evento por evento)
 * y por el doctor (`checkHookRegistration`). El orden es determinista y fija el orden
 * del render y del payload del doctor. Añadir un cuarto hook aquí lo cubre
 * automáticamente el instalador, el uninstall y el detector de deriva sin tocar nada más.
 * @type {ReadonlyArray<{ event: string, file: string }>}
 */
export const KODO_HOOKS = [
  { event: 'SessionStart', file: 'session-start.js' },
  { event: 'Stop', file: 'stop.js' },
  // Phase 58 LIFE-03: SessionEnd hace el cleanup terminal / handoff al cierre real.
  { event: 'SessionEnd', file: 'session-end.js' },
];

/**
 * Ficheros canónicos de los hooks de kodo, DERIVADOS de `KODO_HOOKS` (una sola verdad).
 * B9 (Phase 72): el match de install/uninstall se hace por el segmento de ruta
 * `/src/hooks/<name>.js` (soporta separador POSIX y Windows) en vez del substring
 * genérico `'kodo'`, que confundiría cualquier comando ajeno que mencione "kodo".
 * Robusto ante la ubicación de instalación (global vs local): no exige la ruta absoluta.
 */
const KODO_HOOK_FILES = KODO_HOOKS.map((h) => h.file);

/**
 * Match por-FILE de un command contra un hook canónico. Guard `typeof string` →
 * never-throws. Es la primitiva que hace posible el chequeo POR-EVENTO del detector
 * de deriva (el file específico de cada evento, no «cualquier file de kodo»).
 * @param {unknown} command
 * @param {string} file
 * @returns {boolean}
 */
function commandMatchesFile(command, file) {
  if (typeof command !== 'string') return false;
  return command.includes(`/src/hooks/${file}`) || command.includes(`\\src\\hooks\\${file}`);
}

/**
 * @param {unknown} command
 * @returns {boolean} true si el comando invoca un hook canónico de kodo.
 */
function isKodoHookCommand(command) {
  return KODO_HOOK_FILES.some((f) => commandMatchesFile(command, f));
}

/**
 * Detector PURO de deriva instalación↔settings (raíz de G-74-4). Dado el objeto
 * `settings` PARSEADO (NO hace I/O — el CLI lee `~/.claude/settings.json` y se lo pasa),
 * devuelve qué hooks canónicos de kodo están registrados y cuáles faltan. El chequeo es
 * POR-EVENTO a propósito: cada file de `KODO_HOOKS` tiene que estar registrado bajo SU
 * evento (SessionEnd→session-end.js bajo SessionEnd), no un match laxo «hay algún hook de
 * kodo en algún sitio» — que en G-74-4 (SessionStart/Stop presentes, SessionEnd ausente)
 * habría dado un falso verde. Never-throws sobre cualquier forma de settings malformado
 * (null, `hooks` no-objeto, arrays con basura, command no-string): cada anomalía se trata
 * como «ausente», nunca lanza.
 *
 * @param {unknown} settings — objeto settings parseado (o null si ilegible/ausente).
 * @returns {{ registered: Array<{ event: string, file: string }>, missing: Array<{ event: string, file: string }> }}
 */
export function checkHookRegistration(settings) {
  const hooks =
    settings && typeof settings === 'object' && /** @type {any} */ (settings).hooks;
  const hooksObj = hooks && typeof hooks === 'object' ? /** @type {any} */ (hooks) : null;

  /** @type {Array<{ event: string, file: string }>} */
  const registered = [];
  /** @type {Array<{ event: string, file: string }>} */
  const missing = [];

  for (const { event, file } of KODO_HOOKS) {
    const entries = hooksObj && Array.isArray(hooksObj[event]) ? hooksObj[event] : [];
    const isRegistered = entries.some((entry) => {
      const list = entry && typeof entry === 'object' && Array.isArray(entry.hooks) ? entry.hooks : [];
      return list.some((h) => h && commandMatchesFile(h.command, file));
    });
    (isRegistered ? registered : missing).push({ event, file });
  }

  return { registered, missing };
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
