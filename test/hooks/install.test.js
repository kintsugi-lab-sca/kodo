// @ts-check
//
// test/hooks/install.test.js — Phase 50.1 Plan 01 (DG-08).
//
// Tests del registro/limpieza de los hooks SessionStart/Stop en src/hooks/install.js,
// SIN clobbear hooks de terceros, y verificando que el hook de captura 50-02
// (TaskCreated/TaskCompleted → task-progress.js) quedó DEMOTADO: tras installHooks
// el settings.json NO contiene NINGUNA clave TaskCreated/TaskCompleted de kodo.
//
// HOME-isolation: install.js calcula SETTINGS_PATH = join(homedir(), '.claude',
// 'settings.json') en module-load. Fijamos HOME a un tmpdir y hacemos dynamic
// import POST-HOME para que el módulo resuelva la ruta al settings.json sintético
// (mismo patrón que test/hooks/stop-idempotency.test.js).
//
// 5 behaviors (cobertura preservada de SessionStart/Stop, sin Task*):
//   1. install añade SessionStart/Stop con command a los hooks kodo
//   2. idempotente: dos installHooks no duplican
//   3. no clobber: SessionStart/Stop ajenos intactos
//   4. uninstall limpia los hooks kodo, preserva hooks ajenos
//   5. DG-08 demote: tras installHooks NO existe entry kodo en TaskCreated/TaskCompleted

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let installHooks;
let uninstallHooks;
let SETTINGS_PATH;
let tmpHome;
let origHome;

before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-install-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.claude'), { recursive: true });
  SETTINGS_PATH = join(tmpHome, '.claude', 'settings.json');
  const mod = await import('../../src/hooks/install.js');
  installHooks = mod.installHooks;
  uninstallHooks = mod.uninstallHooks;
});

after(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

function writeSettings(obj) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2) + '\n');
}
function readSettings() {
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
}
/** Todas las commands de un evento, aplanadas. */
function commandsOf(hooks, event) {
  if (!Array.isArray(hooks?.[event])) return [];
  return hooks[event].flatMap((entry) => (entry.hooks || []).map((h) => h.command));
}

describe('install.js — registro de SessionStart/Stop (Phase 50.1, DG-08)', () => {
  beforeEach(() => {
    writeSettings({ hooks: {} });
  });

  it('Test 1: install añade SessionStart/Stop apuntando a los hooks kodo', () => {
    installHooks();
    const { hooks } = readSettings();
    assert.ok(
      commandsOf(hooks, 'SessionStart').some((c) => c.includes('session-start.js')),
      'SessionStart debe tener el command de session-start.js',
    );
    assert.ok(
      commandsOf(hooks, 'Stop').some((c) => c.includes('stop.js')),
      'Stop debe tener el command de stop.js',
    );
    // Phase 58 LIFE-03: tercer evento SessionEnd → cleanup terminal.
    assert.ok(
      commandsOf(hooks, 'SessionEnd').some((c) => c.includes('session-end.js')),
      'SessionEnd debe tener el command de session-end.js',
    );
  });

  it('Test 1b (LIFE-03): uninstall limpia el hook SessionEnd kodo', () => {
    writeSettings({
      hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'foreign-session-end' }] }] },
    });
    installHooks();
    assert.ok(
      commandsOf(readSettings().hooks, 'SessionEnd').some((c) => c.includes('session-end.js')),
      'install añade el SessionEnd kodo',
    );
    uninstallHooks();
    const after = commandsOf(readSettings().hooks, 'SessionEnd');
    assert.ok(!after.some((c) => c.includes('session-end.js')), 'uninstall quita el SessionEnd kodo');
    assert.ok(after.includes('foreign-session-end'), 'uninstall preserva el SessionEnd ajeno');
  });

  it('Test 2: idempotente — dos installHooks no duplican', () => {
    installHooks();
    installHooks();
    const { hooks } = readSettings();
    const ss = commandsOf(hooks, 'SessionStart').filter((c) => c.includes('kodo'));
    const stop = commandsOf(hooks, 'Stop').filter((c) => c.includes('kodo'));
    assert.equal(ss.length, 1, 'SessionStart no duplica la entry kodo');
    assert.equal(stop.length, 1, 'Stop no duplica la entry kodo');
  });

  it('Test 3: no clobber — SessionStart/Stop ajenos intactos', () => {
    writeSettings({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node /opt/gsd/hook.js' }] },
          { hooks: [{ type: 'command', command: 'codeisland-hook' }] },
          { hooks: [{ type: 'command', command: 'orca run' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'some-other-stop' }] }],
      },
    });
    installHooks();
    const { hooks } = readSettings();
    const ss = commandsOf(hooks, 'SessionStart');
    // Los 3 ajenos siguen presentes.
    assert.ok(ss.includes('node /opt/gsd/hook.js'));
    assert.ok(ss.includes('codeisland-hook'));
    assert.ok(ss.includes('orca run'));
    // El Stop ajeno sigue presente, más el kodo añadido.
    assert.ok(commandsOf(hooks, 'Stop').includes('some-other-stop'));
    assert.ok(commandsOf(hooks, 'Stop').some((c) => c.includes('stop.js')));
    // Y se añadió el SessionStart kodo.
    assert.ok(ss.some((c) => c.includes('session-start.js')));
  });

  it('Test 4: uninstall limpia los hooks kodo, preserva hooks ajenos', () => {
    writeSettings({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'orca run' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'third-party-stop' }] }],
      },
    });
    installHooks(); // añade los kodo a SessionStart/Stop
    uninstallHooks();
    const { hooks } = readSettings();
    const ss = commandsOf(hooks, 'SessionStart');
    const stop = commandsOf(hooks, 'Stop');
    // Los kodo se fueron.
    assert.ok(!ss.some((c) => c.includes('kodo')), 'SessionStart sin entry kodo');
    assert.ok(!stop.some((c) => c.includes('kodo')), 'Stop sin entry kodo');
    // Los hooks ajenos permanecen.
    assert.ok(ss.includes('orca run'), 'SessionStart ajeno preservado');
    assert.ok(stop.includes('third-party-stop'), 'Stop ajeno preservado');
  });

  it('Test 5 (DG-08 demote): tras installHooks NO existe entry kodo TaskCreated/TaskCompleted', () => {
    installHooks();
    const { hooks } = readSettings();
    const created = commandsOf(hooks, 'TaskCreated').filter((c) => c.includes('kodo'));
    const completed = commandsOf(hooks, 'TaskCompleted').filter((c) => c.includes('kodo'));
    assert.equal(created.length, 0, 'NINGÚN TaskCreated kodo tras install (hook 50-02 demotado)');
    assert.equal(completed.length, 0, 'NINGÚN TaskCompleted kodo tras install (hook 50-02 demotado)');
  });
});
