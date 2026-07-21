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
let checkHookRegistration;
let KODO_HOOKS;
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
  checkHookRegistration = mod.checkHookRegistration;
  KODO_HOOKS = mod.KODO_HOOKS;
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

  // B9 (Phase 72 HYG-06): el match de install/uninstall es por la RUTA canónica
  // del hook (`/src/hooks/<name>.js`), no por el substring genérico `'kodo'`. Un
  // comando ajeno que menciona "kodo" (p.ej. un script de notas del usuario) NO
  // debe confundirse con un hook de kodo.
  const FOREIGN_KODO_CMD = 'node /home/user/kodo-notes/reminder.js';

  it('Test 6 (B9): un comando ajeno que menciona "kodo" NO bloquea la instalación', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: FOREIGN_KODO_CMD }] }] },
    });
    installHooks();
    const ss = commandsOf(readSettings().hooks, 'SessionStart');
    // Con el fix, el exists-check NO trata el comando ajeno como hook kodo → SÍ instala.
    assert.ok(ss.some((c) => c.includes('/src/hooks/session-start.js')), 'el hook kodo SÍ se instala');
    assert.ok(ss.includes(FOREIGN_KODO_CMD), 'el comando ajeno con "kodo" se preserva');
  });

  it('Test 6b (B9): uninstall NO elimina un comando ajeno que menciona "kodo"', () => {
    writeSettings({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: FOREIGN_KODO_CMD }] }] },
    });
    installHooks(); // añade el session-start.js canónico junto al ajeno
    uninstallHooks();
    const ss = commandsOf(readSettings().hooks, 'SessionStart');
    assert.ok(!ss.some((c) => c.includes('/src/hooks/session-start.js')), 'el hook kodo canónico se elimina');
    assert.ok(ss.includes(FOREIGN_KODO_CMD), 'el comando ajeno con "kodo" NO se elimina');
  });
});

// ── checkHookRegistration — checker PURO de deriva instalación↔settings (Plan 74-07) ──
//
// El detector de G-74-4: dado el objeto settings PARSEADO (no I/O), devuelve qué hooks
// canónicos de kodo están registrados y cuáles faltan, POR-EVENTO. Never-throws sobre
// cualquier forma de settings malformado. Raíz del gap: SessionEnd ausente mientras
// SessionStart/Stop presentes → un match laxo «hay algún hook de kodo» habría dado
// falso verde; el chequeo mira el file específico de cada evento.
describe('install.js — checkHookRegistration (deriva instalación↔settings, G-74-4)', () => {
  /** Command canónico de kodo para un file de hook (ruta POSIX). */
  const kodoCmd = (file) => `node "/Users/alex/dev/klab/kodo/src/hooks/${file}"`;
  /** Un settings con los 3 hooks kodo bajo su evento correcto. */
  const cleanSettings = () => ({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: kodoCmd('session-start.js') }] }],
      Stop: [{ hooks: [{ type: 'command', command: kodoCmd('stop.js') }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: kodoCmd('session-end.js') }] }],
    },
  });

  it('KODO_HOOKS expone los 3 hooks canónicos en orden determinista', () => {
    assert.deepEqual(KODO_HOOKS, [
      { event: 'SessionStart', file: 'session-start.js' },
      { event: 'Stop', file: 'stop.js' },
      { event: 'SessionEnd', file: 'session-end.js' },
    ]);
  });

  it('Los 3 hooks registrados → missing vacío, registered de longitud 3', () => {
    const { registered, missing } = checkHookRegistration(cleanSettings());
    assert.equal(missing.length, 0);
    assert.equal(registered.length, 3);
  });

  it('Falta SessionEnd (solo SessionStart+Stop) → missing = solo SessionEnd (caso G-74-4)', () => {
    const s = cleanSettings();
    delete s.hooks.SessionEnd;
    const { registered, missing } = checkHookRegistration(s);
    assert.deepEqual(missing, [{ event: 'SessionEnd', file: 'session-end.js' }]);
    assert.equal(registered.length, 2);
  });

  it('SessionEnd presente pero con command AJENO → SessionEnd sigue en missing', () => {
    const s = cleanSettings();
    s.hooks.SessionEnd = [{ hooks: [{ type: 'command', command: 'python codeisland-state.py' }] }];
    const { missing } = checkHookRegistration(s);
    assert.ok(missing.some((m) => m.event === 'SessionEnd'));
    assert.ok(!missing.some((m) => m.event === 'SessionStart'));
    assert.ok(!missing.some((m) => m.event === 'Stop'));
  });

  it('Match por-evento estricto: session-end.js bajo Stop NO cuenta como SessionEnd registrado', () => {
    const s = cleanSettings();
    delete s.hooks.SessionEnd;
    // Un command de session-end.js colocado por error bajo Stop.
    s.hooks.Stop.push({ hooks: [{ type: 'command', command: kodoCmd('session-end.js') }] });
    const { missing } = checkHookRegistration(s);
    assert.ok(missing.some((m) => m.event === 'SessionEnd'), 'SessionEnd sigue ausente');
  });

  it('Separador Windows: \\src\\hooks\\session-end.js cuenta como registrado', () => {
    const s = cleanSettings();
    s.hooks.SessionEnd = [
      { hooks: [{ type: 'command', command: 'node "C:\\repos\\kodo\\src\\hooks\\session-end.js"' }] },
    ];
    const { missing } = checkHookRegistration(s);
    assert.ok(!missing.some((m) => m.event === 'SessionEnd'), 'SessionEnd registrado vía separador Windows');
  });

  it('Un comando ajeno que menciona "kodo" en su ruta NO cuenta (B9)', () => {
    const s = cleanSettings();
    s.hooks.SessionEnd = [
      { hooks: [{ type: 'command', command: 'node /home/user/kodo-notes/reminder.js' }] },
    ];
    const { missing } = checkHookRegistration(s);
    assert.ok(missing.some((m) => m.event === 'SessionEnd'), 'el comando ajeno con "kodo" no registra SessionEnd');
  });

  it('Never-throws sobre settings malformado → los 3 en missing sin lanzar', () => {
    const malformed = [
      null,
      undefined,
      {},
      { hooks: null },
      { hooks: 'nope' },
      { hooks: { SessionEnd: 'x' } }, // no-array
      { hooks: { SessionEnd: [{ noHooksArray: true }] } }, // entry sin array hooks
      { hooks: { SessionEnd: [{ hooks: [{ command: 42 }] }] } }, // command no-string
      { hooks: { SessionEnd: [null, 'garbage', { hooks: [null] }] } },
    ];
    for (const settings of malformed) {
      let result;
      assert.doesNotThrow(() => { result = checkHookRegistration(settings); });
      assert.equal(result.missing.length, 3, `los 3 en missing para ${JSON.stringify(settings)}`);
      assert.equal(result.registered.length, 0);
    }
  });
});
