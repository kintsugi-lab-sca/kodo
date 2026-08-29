// @ts-check
//
// test/cli/systemd.test.js — KODO-59 (F3 del port a Linux).
//
// Cubre `src/cli/systemd.js` entero por DI: sin escribir en el home real, sin lanzar un
// solo `systemctl`, y sin depender de correr en Linux (la plataforma es un parámetro).
//
// Los cuatro invariantes que este fichero protege:
//   1. PARIDAD del espejo in-tree: `packaging/systemd/kodo.service` === `renderUnit()`.
//      Mismo patrón que el mirror de la fórmula Homebrew — el fichero revisable no puede
//      derivar del que se instala de verdad.
//   2. La unidad supervisa `daemon run`, NUNCA el comando interactivo (que se auto-detacha
//      y metería a systemd en bucle de reinicios).
//   3. IDEMPOTENCIA observable: reinstalar sin cambios NO reescribe el fichero.
//   4. Los guards que hacen que en macOS todo esto cueste cero.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  UNIT_NAME,
  renderUnit,
  resolveKodoExecutable,
  resolveServicePath,
  runInstallSystemd,
  servicePreflight,
  unitDir,
  unitPath,
  unitState,
} from '../../src/cli/systemd.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Fake de execFileSync con la semántica REAL de systemctl que importa: `is-active` y
 * `is-enabled` salen con código ≠ 0 cuando la respuesta no es afirmativa, y aun así ponen
 * la respuesta en stdout. Un fake que solo devolviera strings no probaría nada del catch.
 */
function makeExec(responses = {}, calls = []) {
  return (bin, args) => {
    calls.push([bin, ...args]);
    const key = args.filter((a) => a !== '--user').join(' ');
    const r = responses[key];
    if (r === undefined) return '';
    if (r && r.throws) {
      const e = new Error(r.message || 'systemctl failed');
      // @ts-ignore — forma real del error de execFileSync.
      e.stdout = r.stdout ?? null;
      // @ts-ignore
      e.stderr = r.stderr ?? '';
      throw e;
    }
    return r;
  };
}

/** Deps de instalación con FS y subprocesos falsos; devuelve también lo capturado. */
function makeInstallDeps(overrides = {}, execResponses = {}) {
  const calls = { out: [], err: [], exec: [], written: [], mkdir: [] };
  const files = overrides.files || {};
  const deps = {
    _platform: 'linux',
    _homedir: () => '/home/jj',
    _env: {},
    _execPath: '/home/jj/.local/share/nvm/v20.19.0/bin/node',
    _argv: ['/usr/bin/node', '/home/jj/.local/bin/kodo', 'install', '--systemd'],
    _exec: makeExec({ '--version': 'systemd 249', ...execResponses }, calls.exec),
    _exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    _read: (p) => files[p],
    _write: (p, data) => { calls.written.push(p); files[p] = data; },
    _mkdir: (p) => { calls.mkdir.push(p); },
    _out: (s) => { calls.out.push(s); },
    _err: (s) => { calls.err.push(s); },
    _stdout: { isTTY: false },
    // Sin este stub, el pre-vuelo leería el `~/.kodo` REAL de quien corra la suite (fuga de
    // HOME que el runner ya prohíbe desde KODO-57). Su lógica se prueba aparte, por DI.
    _preflight: async () => [],
    ...overrides,
  };
  delete deps.files;
  return { deps, calls, files };
}

describe('renderUnit — contrato de la unidad', () => {
  it('el espejo in-tree packaging/systemd/kodo.service es EXACTAMENTE renderUnit()', () => {
    const onDisk = readFileSync(join(REPO_ROOT, 'packaging', 'systemd', 'kodo.service'), 'utf8');
    assert.equal(
      onDisk,
      renderUnit(),
      'el fichero de packaging derivó de renderUnit(); regenéralo — es su espejo revisable, ' +
        'igual que el mirror de la fórmula Homebrew',
    );
  });

  it('supervisa `daemon run`, NUNCA el comando interactivo que se auto-detacha', () => {
    const unit = renderUnit();
    assert.match(unit, /^ExecStart=.*kodo daemon run$/m);
    // Trampa del supervisor: `ExecStart=… kodo up` daría exit 0 inmediato → crash-loop.
    assert.doesNotMatch(unit, /^ExecStart=.*kodo up\b/m);
  });

  it('declara Restart=always y un PATH explícito (load-bearing: node, git, claude)', () => {
    const unit = renderUnit();
    assert.match(unit, /^Restart=always$/m);
    assert.match(unit, /^Environment=PATH=/m);
  });

  it('NO lleva secretos: la única Environment= es PATH', () => {
    const envLines = renderUnit().split('\n').filter((l) => l.startsWith('Environment'));
    assert.equal(envLines.length, 1);
    assert.match(envLines[0], /^Environment="?PATH=/);
  });

  it('pone freno al bucle: StartLimit con una ventana MAYOR que 5 ciclos de reinicio', () => {
    const unit = renderUnit();
    const interval = Number(unit.match(/^StartLimitIntervalSec=(\d+)$/m)?.[1]);
    const burst = Number(unit.match(/^StartLimitBurst=(\d+)$/m)?.[1]);
    const restartSec = Number(unit.match(/^RestartSec=(\d+)$/m)?.[1]);
    // Un arranque fallido por config incompleta tarda ~10s (reintentos de red del provider)
    // + RestartSec. Si la ventana no cubre `burst` ciclos completos, el contador se resetea
    // antes de llegar al límite y el «freno» no frena nada — medido en VM con 60s.
    const cycleMs = 10 + restartSec;
    assert.ok(
      interval > burst * cycleMs,
      `ventana ${interval}s demasiado corta para ${burst} ciclos de ~${cycleMs}s: el límite no llegaría a dispararse`,
    );
  });

  it('se instala en default.target (el target de las unidades de USUARIO)', () => {
    assert.match(renderUnit(), /^WantedBy=default\.target$/m);
  });

  it('un PATH con espacios entrecomilla la asignación ENTERA (sintaxis de systemd)', () => {
    const unit = renderUnit({ path: '/home/jj perez/.local/bin:/usr/bin' });
    assert.match(unit, /^Environment="PATH=\/home\/jj perez\/\.local\/bin:\/usr\/bin"$/m);
  });

  it('es PURA: dos llamadas con los mismos argumentos dan bytes idénticos', () => {
    assert.equal(renderUnit({ execStart: '/x/kodo daemon run' }), renderUnit({ execStart: '/x/kodo daemon run' }));
  });
});

describe('unitDir / unitPath', () => {
  it('default: ~/.config/systemd/user/kodo.service', () => {
    const d = { _homedir: () => '/home/jj', _env: {} };
    assert.equal(unitDir(d), '/home/jj/.config/systemd/user');
    assert.equal(unitPath(d), `/home/jj/.config/systemd/user/${UNIT_NAME}`);
  });

  it('honra XDG_CONFIG_HOME cuando es absoluto', () => {
    const d = { _homedir: () => '/home/jj', _env: { XDG_CONFIG_HOME: '/opt/cfg' } };
    assert.equal(unitDir(d), '/opt/cfg/systemd/user');
  });

  it('ignora un XDG_CONFIG_HOME relativo (systemd también lo ignora)', () => {
    const d = { _homedir: () => '/home/jj', _env: { XDG_CONFIG_HOME: 'cfg' } };
    assert.equal(unitDir(d), '/home/jj/.config/systemd/user');
  });
});

describe('resolveServicePath', () => {
  it('antepone el directorio del node en curso (el que resolverá el shebang)', () => {
    const p = resolveServicePath({
      _execPath: '/home/jj/.nvm/versions/node/v20.19.0/bin/node',
      _homedir: () => '/home/jj',
    });
    assert.equal(
      p,
      '/home/jj/.nvm/versions/node/v20.19.0/bin:/home/jj/.local/bin:/usr/local/bin:/usr/bin:/bin',
    );
  });

  it('deduplica preservando el orden (NodeSource ya vive en /usr/bin)', () => {
    const p = resolveServicePath({ _execPath: '/usr/bin/node', _homedir: () => '/home/jj' });
    assert.equal(p, '/usr/bin:/home/jj/.local/bin:/usr/local/bin:/bin');
    assert.equal(p.split(':').length, new Set(p.split(':')).size);
  });
});

describe('resolveKodoExecutable', () => {
  it('usa argv[1]: el shim ESTABLE de npm, no el directorio versionado de node_modules', () => {
    const bin = resolveKodoExecutable({ _argv: ['/usr/bin/node', '/home/jj/.local/bin/kodo'] });
    assert.equal(bin, '/home/jj/.local/bin/kodo');
  });

  it('argv[1] no absoluto → fallback a ~/.local/bin/kodo', () => {
    const bin = resolveKodoExecutable({ _argv: ['node', 'kodo'], _homedir: () => '/home/jj' });
    assert.equal(bin, '/home/jj/.local/bin/kodo');
  });
});

describe('unitState', () => {
  it('no-linux → estado vacío SIN tocar el FS ni lanzar systemctl (coste cero en macOS)', () => {
    let touched = false;
    const st = unitState({
      _platform: 'darwin',
      _exists: () => { touched = true; return true; },
      _exec: () => { touched = true; return ''; },
    });
    assert.deepEqual(st, { installed: false, active: null, enabled: null });
    assert.equal(touched, false);
  });

  it('unidad ausente → installed:false y NI UN systemctl (la presencia se decide por FS)', () => {
    const exec = [];
    const st = unitState({
      _platform: 'linux',
      _exists: () => false,
      _exec: makeExec({}, exec),
      _homedir: () => '/home/jj',
      _env: {},
    });
    assert.deepEqual(st, { installed: false, active: null, enabled: null });
    assert.deepEqual(exec, []);
  });

  it('unidad presente y activa → lee is-active / is-enabled', () => {
    const st = unitState({
      _platform: 'linux',
      _exists: () => true,
      _exec: makeExec({ [`is-active ${UNIT_NAME}`]: 'active\n', [`is-enabled ${UNIT_NAME}`]: 'enabled\n' }),
      _homedir: () => '/home/jj',
      _env: {},
    });
    assert.deepEqual(st, { installed: true, active: 'active', enabled: 'enabled' });
  });

  it('is-active sale ≠ 0 cuando está parada: la respuesta viene por stdout, no es un error', () => {
    const st = unitState({
      _platform: 'linux',
      _exists: () => true,
      _exec: makeExec({
        [`is-active ${UNIT_NAME}`]: { throws: true, stdout: 'inactive\n' },
        [`is-enabled ${UNIT_NAME}`]: { throws: true, stdout: 'disabled\n' },
      }),
      _homedir: () => '/home/jj',
      _env: {},
    });
    assert.deepEqual(st, { installed: true, active: 'inactive', enabled: 'disabled' });
  });

  it('systemctl ausente (ENOENT, sin stdout) → nulls, sin lanzar', () => {
    const st = unitState({
      _platform: 'linux',
      _exists: () => true,
      _exec: makeExec({
        [`is-active ${UNIT_NAME}`]: { throws: true },
        [`is-enabled ${UNIT_NAME}`]: { throws: true },
      }),
      _homedir: () => '/home/jj',
      _env: {},
    });
    assert.deepEqual(st, { installed: true, active: null, enabled: null });
  });

  it('un FS que lanza NO tumba el detector (fail-open: `kodo status` no puede fallar)', () => {
    const st = unitState({
      _platform: 'linux',
      _exists: () => { throw new Error('EACCES'); },
      _homedir: () => '/home/jj',
      _env: {},
    });
    assert.deepEqual(st, { installed: false, active: null, enabled: null });
  });
});

describe('servicePreflight', () => {
  it('todo configurado → sin avisos', async () => {
    const w = await servicePreflight({
      _needsSetup: () => false,
      _loadConfig: () => ({ provider: 'plane' }),
      _env: { KODO_WEBHOOK_SECRET_PLANE: 'abc' },
    });
    assert.deepEqual(w, []);
  });

  it('sin el secreto de webhook → avisa NOMBRANDO la variable (es el gate que mata al daemon)', async () => {
    const w = await servicePreflight({
      _needsSetup: () => false,
      _loadConfig: () => ({ provider: 'plane' }),
      _env: {},
    });
    assert.equal(w.length, 1);
    assert.match(w[0], /KODO_WEBHOOK_SECRET_PLANE/);
    // El detalle que costó una verificación en VM entera: también hace falta en modo polling.
    assert.match(w[0], /polling/);
  });

  it('el nombre de la variable sigue al provider activo, no está hardcodeado a plane', async () => {
    const w = await servicePreflight({
      _needsSetup: () => false,
      _loadConfig: () => ({ provider: 'github' }),
      _env: {},
    });
    assert.match(w[0], /KODO_WEBHOOK_SECRET_GITHUB/);
  });

  it('config incompleta y sin secreto → los DOS avisos (son señales distintas)', async () => {
    const w = await servicePreflight({
      _needsSetup: () => true,
      _loadConfig: () => ({ provider: 'plane' }),
      _env: {},
    });
    assert.equal(w.length, 2);
    assert.match(w[0], /kodo check/);
  });

  it('un loadConfig que lanza → sin avisos, sin propagar (el pre-vuelo es una cortesía)', async () => {
    const w = await servicePreflight({
      _needsSetup: () => false,
      _loadConfig: () => { throw new Error('config.json corrupto'); },
      _env: {},
    });
    assert.deepEqual(w, []);
  });
});

describe('runInstallSystemd', () => {
  it('no-linux → exit 1, señala brew services y NO escribe nada', async () => {
    const { deps, calls } = makeInstallDeps({ _platform: 'darwin' });
    const code = await runInstallSystemd({}, deps);
    assert.equal(code, 1);
    assert.deepEqual(calls.written, []);
    assert.match(calls.err.join(''), /solo existen en Linux/);
    assert.match(calls.err.join(''), /brew services/);
  });

  it('sin systemctl → exit 1 con guía, sin escribir la unidad', async () => {
    const { deps, calls } = makeInstallDeps({}, { '--version': { throws: true } });
    const code = await runInstallSystemd({}, deps);
    assert.equal(code, 1);
    assert.deepEqual(calls.written, []);
    assert.match(calls.err.join(''), /systemctl --user/);
  });

  it('instalación limpia: escribe, daemon-reload y enable --now, en ese orden', async () => {
    const { deps, calls, files } = makeInstallDeps();
    const code = await runInstallSystemd({}, deps);
    assert.equal(code, 0);

    const target = `/home/jj/.config/systemd/user/${UNIT_NAME}`;
    assert.deepEqual(calls.written, [target]);
    assert.deepEqual(calls.mkdir, ['/home/jj/.config/systemd/user']);

    const ordered = calls.exec.map((c) => c.slice(1).filter((a) => a !== '--user').join(' '));
    assert.ok(ordered.indexOf('daemon-reload') < ordered.indexOf(`enable --now ${UNIT_NAME}`));

    // El ExecStart instalado apunta al binario REAL resuelto, no al `%h` de la plantilla.
    assert.match(files[target], /^ExecStart=\/home\/jj\/\.local\/bin\/kodo daemon run$/m);
    // Y el PATH lleva delante el directorio del node en curso.
    assert.match(files[target], /^Environment=PATH=\/home\/jj\/\.local\/share\/nvm\/v20\.19\.0\/bin:/m);
    assert.match(calls.out.join(''), /creada/);
  });

  it('hace reset-failed ANTES de arrancar (una unidad en failed rechaza cualquier start)', async () => {
    const { deps, calls } = makeInstallDeps();
    await runInstallSystemd({}, deps);
    const ordered = calls.exec.map((c) => c.slice(1).filter((a) => a !== '--user').join(' '));
    assert.ok(
      ordered.indexOf(`reset-failed ${UNIT_NAME}`) < ordered.indexOf(`enable --now ${UNIT_NAME}`),
      'sin esto, «arreglar el .env y reinstalar» no arrancaría nada tras agotar StartLimitBurst',
    );
  });

  it('un reset-failed que falla NO aborta la instalación (es preparatorio, no el objetivo)', async () => {
    const { deps } = makeInstallDeps({}, {
      [`reset-failed ${UNIT_NAME}`]: { throws: true, stderr: 'Unit kodo.service not loaded.' },
    });
    assert.equal(await runInstallSystemd({}, deps), 0);
  });

  it('IDEMPOTENTE: reinstalar sin cambios NO reescribe el fichero', async () => {
    const first = makeInstallDeps();
    await runInstallSystemd({}, first.deps);
    const target = `/home/jj/.config/systemd/user/${UNIT_NAME}`;

    // Segunda pasada partiendo del fichero que dejó la primera.
    const second = makeInstallDeps({ files: { [target]: first.files[target] } });
    const code = await runInstallSystemd({}, second.deps);
    assert.equal(code, 0);
    assert.deepEqual(second.calls.written, [], 'no debe reescribir un fichero idéntico');
    assert.match(second.calls.out.join(''), /sin cambios/);
    // daemon-reload y enable --now siguen ejecutándose: son baratos y convergen el estado.
    const ordered = second.calls.exec.map((c) => c.slice(1).filter((a) => a !== '--user').join(' '));
    assert.ok(ordered.includes('daemon-reload'));
    assert.ok(ordered.includes(`enable --now ${UNIT_NAME}`));
  });

  it('unidad ACTIVA cuyo fichero cambia → además reinicia (enable --now no recarga)', async () => {
    const target = `/home/jj/.config/systemd/user/${UNIT_NAME}`;
    const { deps, calls } = makeInstallDeps(
      { files: { [target]: '# unidad vieja\n' } },
      { [`is-active ${UNIT_NAME}`]: 'active\n' },
    );
    const code = await runInstallSystemd({}, deps);
    assert.equal(code, 0);
    const ordered = calls.exec.map((c) => c.slice(1).filter((a) => a !== '--user').join(' '));
    assert.ok(ordered.includes(`restart ${UNIT_NAME}`), 'sin restart, el proceso vivo sigue con el ExecStart viejo');
    assert.match(calls.out.join(''), /actualizada/);
  });

  it('unidad PARADA cuyo fichero cambia → NO reinicia (enable --now ya la arranca)', async () => {
    const target = `/home/jj/.config/systemd/user/${UNIT_NAME}`;
    const { deps, calls } = makeInstallDeps(
      { files: { [target]: '# unidad vieja\n' } },
      { [`is-active ${UNIT_NAME}`]: { throws: true, stdout: 'inactive\n' } },
    );
    assert.equal(await runInstallSystemd({}, deps), 0);
    const ordered = calls.exec.map((c) => c.slice(1).filter((a) => a !== '--user').join(' '));
    assert.ok(!ordered.includes(`restart ${UNIT_NAME}`));
  });

  it('enable falla → exit 1 con el stderr de systemctl, sin tragárselo', async () => {
    const { deps, calls } = makeInstallDeps({}, {
      [`enable --now ${UNIT_NAME}`]: { throws: true, stderr: 'Failed to connect to bus' },
    });
    assert.equal(await runInstallSystemd({}, deps), 1);
    assert.match(calls.err.join(''), /Failed to connect to bus/);
  });

  it('un home no escribible → exit 1 con la ruta, sin dejar la unidad a medias', async () => {
    const { deps, calls } = makeInstallDeps({
      _mkdir: () => { throw new Error('EACCES: permission denied'); },
    });
    assert.equal(await runInstallSystemd({}, deps), 1);
    assert.match(calls.err.join(''), /EACCES/);
    assert.deepEqual(calls.written, []);
  });

  it('los avisos del pre-vuelo salen por stderr ANTES de arrancar, sin bloquear la instalación', async () => {
    const { deps, calls } = makeInstallDeps({
      _preflight: async () => ['falta KODO_WEBHOOK_SECRET_PLANE en ~/.kodo/.env'],
    });
    const code = await runInstallSystemd({}, deps);
    assert.equal(code, 0, 'el pre-vuelo AVISA; instalar sin configurar es un flujo legítimo');
    assert.match(calls.err.join(''), /KODO_WEBHOOK_SECRET_PLANE/);
    const ordered = calls.exec.map((c) => c.slice(1).filter((a) => a !== '--user').join(' '));
    assert.ok(ordered.includes(`enable --now ${UNIT_NAME}`));
  });

  it('un home con espacios entrecomilla el ExecStart (si no, systemd parte la línea)', async () => {
    const { deps, files } = makeInstallDeps({
      _homedir: () => '/home/jj perez',
      _argv: ['/usr/bin/node', '/home/jj perez/.local/bin/kodo'],
    });
    assert.equal(await runInstallSystemd({}, deps), 0);
    const target = '/home/jj perez/.config/systemd/user/kodo.service';
    assert.match(files[target], /^ExecStart="\/home\/jj perez\/\.local\/bin\/kodo" daemon run$/m);
    assert.match(files[target], /^Environment="PATH=/m);
  });
});
