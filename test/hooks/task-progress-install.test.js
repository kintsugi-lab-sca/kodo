// @ts-check
//
// test/hooks/task-progress-install.test.js — Phase 50 Plan 02 Task 2 (PROG-02).
//
// Tests del registro/limpieza de los eventos TaskCreated/TaskCompleted en
// src/hooks/install.js, SIN clobbear hooks de terceros ni los SessionStart/Stop
// existentes (HOOK-02 golden-bytes de session-start.js intactos).
//
// HOME-isolation: install.js calcula SETTINGS_PATH = join(homedir(), '.claude',
// 'settings.json') en module-load. Fijamos HOME a un tmpdir y hacemos dynamic
// import POST-HOME para que el módulo resuelva la ruta al settings.json sintético
// (mismo patrón que test/hooks/stop-idempotency.test.js).
//
// 5 behaviors:
//   1. install añade TaskCreated/TaskCompleted con command a task-progress.js
//   2. idempotente: dos installHooks no duplican
//   3. no clobber: SessionStart ajenos (gsd/codeisland/orca) + Stop intactos
//   4. uninstall limpia los 2 eventos kodo, preserva hooks ajenos
//   5. golden-bytes: session-start.js no cambia (verificable por git, aquí
//      verificamos que install no toca ESE archivo — comprobado fuera del test)

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
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-tp-install-'));
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

describe('install.js — registro de TaskCreated/TaskCompleted (Phase 50)', () => {
  beforeEach(() => {
    writeSettings({ hooks: {} });
  });

  it('Test 1: install añade TaskCreated/TaskCompleted apuntando a task-progress.js', () => {
    installHooks();
    const { hooks } = readSettings();
    const created = commandsOf(hooks, 'TaskCreated');
    const completed = commandsOf(hooks, 'TaskCompleted');
    assert.ok(
      created.some((c) => c.includes('task-progress.js')),
      'TaskCreated debe tener el command de task-progress.js',
    );
    assert.ok(
      completed.some((c) => c.includes('task-progress.js')),
      'TaskCompleted debe tener el command de task-progress.js',
    );
  });

  it('Test 2: idempotente — dos installHooks no duplican', () => {
    installHooks();
    installHooks();
    const { hooks } = readSettings();
    const created = commandsOf(hooks, 'TaskCreated').filter((c) => c.includes('kodo'));
    const completed = commandsOf(hooks, 'TaskCompleted').filter((c) => c.includes('kodo'));
    assert.equal(created.length, 1, 'TaskCreated no duplica la entry kodo');
    assert.equal(completed.length, 1, 'TaskCompleted no duplica la entry kodo');
  });

  it('Test 3: no clobber — SessionStart ajenos + Stop existente intactos', () => {
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
    // El Stop ajeno sigue presente.
    assert.ok(commandsOf(hooks, 'Stop').includes('some-other-stop'));
    // Y se añadieron los 2 nuevos eventos kodo.
    assert.ok(commandsOf(hooks, 'TaskCreated').some((c) => c.includes('task-progress.js')));
    assert.ok(commandsOf(hooks, 'TaskCompleted').some((c) => c.includes('task-progress.js')));
  });

  it('Test 4: uninstall limpia TaskCreated/TaskCompleted kodo, preserva hooks ajenos', () => {
    writeSettings({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'orca run' }] }],
        TaskCreated: [{ hooks: [{ type: 'command', command: 'third-party-task-hook' }] }],
      },
    });
    installHooks(); // añade los kodo a TaskCreated/TaskCompleted
    uninstallHooks();
    const { hooks } = readSettings();
    const created = commandsOf(hooks, 'TaskCreated');
    const completed = commandsOf(hooks, 'TaskCompleted');
    // Los kodo se fueron.
    assert.ok(!created.some((c) => c.includes('kodo')), 'TaskCreated sin entry kodo');
    assert.ok(!completed.some((c) => c.includes('kodo')), 'TaskCompleted sin entry kodo');
    // El hook ajeno de TaskCreated permanece.
    assert.ok(created.includes('third-party-task-hook'), 'hook ajeno de TaskCreated preservado');
    // SessionStart ajeno permanece.
    assert.ok(commandsOf(hooks, 'SessionStart').includes('orca run'));
  });

  it('Test 5: install no muta el archivo session-start.js (golden-bytes HOOK-02)', () => {
    // El registro vive en install.js/settings.json — task-progress.js es el
    // único hook nuevo. session-start.js no se toca; verificado a nivel de git
    // en el plan. Aquí confirmamos que el command registrado es task-progress.js
    // y NO session-start.js (no se re-registra ni perturba el existente).
    installHooks();
    const { hooks } = readSettings();
    const taskCmds = [
      ...commandsOf(hooks, 'TaskCreated'),
      ...commandsOf(hooks, 'TaskCompleted'),
    ];
    assert.ok(taskCmds.every((c) => !c.includes('session-start.js')),
      'los eventos Task* NO apuntan a session-start.js');
  });
});
