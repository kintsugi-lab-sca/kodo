// @ts-check
//
// test/platform-defaults.test.js — KODO-56 (F2 del port a Linux).
//
// Ata los cuatro defaults que dejaron de ser literales de macOS, cada uno con la PLATAFORMA
// INYECTADA (`'linux'` y `'darwin'`), sin monkey-patchear `process.platform`: los cuatro
// sujetos aceptan la plataforma como parámetro, así que la suite verifica ambas ramas corra
// donde corra.
//
//   1. `platformDefaults(platform)`      — el resolvedor único (host, orcaBinary, openBinary).
//   2. `DEFAULT_CONFIG` / `mergeAndValidateConfig` — que el config de fábrica CONSUME 1.
//   3. `runOpen({ platform })`           — la tecla `o` del dashboard.
//   4. `runCheckAndAct({ hostNameFn })`  — el guard del piggyback del sidebar doctor.
//
// EL FALLO QUE MOTIVA EL FICHERO, y por qué merece tests propios: en Linux, `orca` por PATH
// es el LECTOR DE PANTALLA de GNOME. Un default equivocado ahí no da ENOENT — ejecuta otro
// programa, callando. Es la clase de bug que ningún test de «no crashea» atrapa, así que lo
// que se asevera es el VALOR concreto del binario, no que la llamada no reviente.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { platformDefaults } from '../src/platform-defaults.js';
import { DEFAULT_CONFIG, mergeAndValidateConfig } from '../src/config.js';
import { runOpen } from '../src/cli/dashboard/open.js';
import { runCheckAndAct } from '../src/check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');

/** Lo que la plataforma de ESTA máquina debe producir — para los asserts de coherencia. */
const HERE = platformDefaults(process.platform);

describe('KODO-56 — platformDefaults: el resolvedor único', () => {
  it('darwin: los tres valores son los de macOS (cero regresión byte a byte)', () => {
    assert.deepEqual(platformDefaults('darwin'), {
      host: 'cmux',
      orcaBinary: '/usr/local/bin/orca',
      openBinary: 'open',
    });
  });

  it('linux: host orca, binario orca-ide y lanzador xdg-open', () => {
    assert.deepEqual(platformDefaults('linux'), {
      host: 'orca',
      orcaBinary: 'orca-ide',
      openBinary: 'xdg-open',
    });
  });

  it("linux NO puede resolver a 'orca' a secas — es el lector de pantalla de GNOME", () => {
    // Assert NEGATIVO explícito: el modo de fallo no es un ENOENT, es ejecutar otro
    // programa. Si alguien «simplifica» el resolvedor a `binary: 'orca'` para ambas
    // plataformas, el deepEqual de arriba y esta línea se ponen rojos por separado.
    assert.notEqual(platformDefaults('linux').orcaBinary, 'orca');
  });

  it('el eje es darwin / no-darwin: freebsd resuelve como linux', () => {
    assert.deepEqual(platformDefaults('freebsd'), platformDefaults('linux'));
  });

  it('sin argumento resuelve la plataforma del proceso', () => {
    assert.deepEqual(platformDefaults(), platformDefaults(process.platform));
  });

  it('devuelve un objeto NUEVO por llamada (un caller que mute no contamina a otro)', () => {
    const a = platformDefaults('linux');
    a.orcaBinary = 'pisado';
    assert.equal(platformDefaults('linux').orcaBinary, 'orca-ide');
  });

  it('es una HOJA pura: cero imports (premisa de config.js, check.js y dashboard/open.js)', () => {
    // Los tres consumidores tienen restricciones de grafo distintas (ciclos en config.js,
    // LOG-12 en check.js, color-isolation en src/cli/dashboard/**). La forma de no tener
    // que razonar sobre las tres es que este módulo no importe NADA, ni builtins.
    const src = readFileSync(join(SRC, 'platform-defaults.js'), 'utf-8');
    const imports = [...src.matchAll(/^\s*(?:import|export)(?=[\s{*'"])[^'"]*?from\s*['"]([^'"]+)['"]/gm)]
      .map((m) => m[1])
      .concat([...src.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]));
    assert.deepEqual(imports, [], `platform-defaults.js debe tener 0 imports, encontrados: ${imports.join(', ')}`);
  });
});

describe('KODO-56 — el config de fábrica consume el resolvedor', () => {
  it('DEFAULT_CONFIG.host es el host de ESTA plataforma (cmux en macOS, orca fuera)', () => {
    assert.equal(DEFAULT_CONFIG.host, HERE.host);
  });

  it('DEFAULT_CONFIG.orca.binary es el binario de ESTA plataforma', () => {
    assert.equal(DEFAULT_CONFIG.orca.binary, HERE.orcaBinary);
  });

  it('un config SIN la clave `host` recibe el default de plataforma por deep-merge', () => {
    // Mismo argumento que KODO-18: no hace falta migración. Lo que cambia en KODO-56 es
    // QUÉ valor entra por el merge, no el mecanismo.
    const merged = mergeAndValidateConfig({ provider: 'plane', providers: { plane: {} } });
    assert.equal(merged.host, HERE.host);
    assert.equal(merged.orca.binary, HERE.orcaBinary);
  });

  it('un `host` explícito del operador gana sobre el default de plataforma', () => {
    const merged = mergeAndValidateConfig({ host: 'bb', providers: { plane: {} } });
    assert.equal(merged.host, 'bb');
  });

  it('un `orca.binary` explícito del operador sobrevive al merge', () => {
    const merged = mergeAndValidateConfig({ orca: { binary: '/opt/orca-ide/bin/orca-ide' } });
    assert.equal(merged.orca.binary, '/opt/orca-ide/bin/orca-ide');
  });

  it('ningún fallback de binario de Orca vuelve al literal `orca`', () => {
    // Guard de source: los dos sitios que resuelven el binario (`createOrcaHost` y
    // `getOrcaBinary`) tenían un `|| 'orca'` final. Ese literal es el que ejecutaba el
    // lector de pantalla; si reaparece, el bug vuelve por una puerta que ningún test
    // funcional cruza (solo se llega a él con `config.orca` ausente).
    for (const rel of [['host', 'orca.js'], ['orca', 'client.js']]) {
      const src = readFileSync(join(SRC, ...rel), 'utf-8');
      assert.doesNotMatch(
        src,
        /\|\|\s*'orca'/,
        `src/${rel.join('/')} no debe caer al literal 'orca' — usa platformDefaults().orcaBinary`,
      );
    }
  });
});

describe('KODO-56 — runOpen: lanzador de URLs por plataforma (tecla `o`)', () => {
  /** exec fake que captura el comando y resuelve ok. */
  function capturingExec(sink) {
    return (cmd, args, _opts, cb) => {
      sink.cmd = cmd;
      sink.args = args;
      setImmediate(() => cb(null, '', ''));
    };
  }

  it("platform 'linux' → xdg-open", async () => {
    const sink = {};
    const result = await runOpen({ exec: capturingExec(sink), url: 'https://example.com', platform: 'linux' });
    assert.deepEqual(result, { ok: true });
    assert.equal(sink.cmd, 'xdg-open');
    assert.deepEqual(sink.args, ['https://example.com'], 'el argv literal [url] no cambia (OPEN-03)');
  });

  it("platform 'darwin' → open (byte-idéntico al comportamiento previo)", async () => {
    const sink = {};
    const result = await runOpen({ exec: capturingExec(sink), url: 'https://example.com', platform: 'darwin' });
    assert.deepEqual(result, { ok: true });
    assert.equal(sink.cmd, 'open');
  });

  it('un `binary` explícito gana sobre la plataforma', async () => {
    const sink = {};
    await runOpen({ exec: capturingExec(sink), url: 'https://example.com', platform: 'linux', binary: 'open' });
    assert.equal(sink.cmd, 'open');
  });

  it('sin `platform` resuelve por la plataforma del proceso', async () => {
    const sink = {};
    await runOpen({ exec: capturingExec(sink), url: 'https://example.com' });
    assert.equal(sink.cmd, HERE.openBinary);
  });

  it('la allowlist http(s) sigue corriendo ANTES de resolver el binario', async () => {
    // El orden importa: una URL adversarial no debe llegar a exec ni siquiera para
    // descubrir qué lanzador tocaba (Pitfall 4 de Phase 48).
    let called = 0;
    const result = await runOpen({
      exec: () => { called += 1; },
      url: 'file:///etc/passwd',
      platform: 'linux',
    });
    assert.deepEqual(result, { ok: false, code: 'BAD_PROTOCOL', detail: 'file:///etc/passwd' });
    assert.equal(called, 0, 'exec NUNCA se invoca con un protocolo fuera de la allowlist');
  });
});

describe('KODO-56 — guard de host del piggyback del sidebar doctor', () => {
  /** SidebarResult vacío (0 acciones), igual que en test/check.test.js. */
  const emptyResult = () => ({ created: 0, added: 0, ungrouped: 0, errors: [] });

  const baseCheck = async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' });

  for (const host of ['orca', 'bb']) {
    it(`host '${host}': executeFn NO se invoca ni una vez, y el orquestador arranca igual`, async () => {
      const calls = [];
      await runCheckAndAct({
        runCheckFn: baseCheck,
        executeFn: async () => { calls.push('execute'); return emptyResult(); },
        launchFn: async () => { calls.push('launch'); },
        logFn: () => {},
        errorFn: () => {},
        hostNameFn: () => host,
      });
      assert.deepEqual(
        calls,
        ['launch'],
        `con host '${host}' el motor cmux del doctor no debe invocarse (2 execFile inútiles por check), ` +
          `pero launchOrchestrator SÍ — el guard salta el piggyback, jamás el orquestador`,
      );
    });
  }

  it("host 'orca': cero líneas de Sidebar por stdout y por stderr", async () => {
    // El fail-open tragaba los fallos, pero la línea «N acción(es) fallida(s)» sí salía por
    // stderr describiendo un problema que no existe (cmux no está instalado, y no tiene por
    // qué estarlo). Silencio total es el contrato.
    const logs = [];
    const errs = [];
    await runCheckAndAct({
      runCheckFn: baseCheck,
      executeFn: async () => { throw new Error('cmux no existe'); },
      launchFn: async () => {},
      logFn: (m) => logs.push(m),
      errorFn: (m) => errs.push(m),
      hostNameFn: () => 'orca',
    });
    assert.ok(!logs.some((m) => m.includes('Sidebar')), `stdout no debe mencionar Sidebar: ${JSON.stringify(logs)}`);
    assert.ok(!errs.some((m) => m.includes('Sidebar')), `stderr no debe mencionar Sidebar: ${JSON.stringify(errs)}`);
  });

  it("host 'cmux': el piggyback sigue corriendo tal cual (cero regresión en macOS)", async () => {
    const order = [];
    let execArgs = null;
    await runCheckAndAct({
      runCheckFn: baseCheck,
      executeFn: async (_deps, opts) => { order.push('execute'); execArgs = opts; return emptyResult(); },
      launchFn: async () => { order.push('launch'); },
      logFn: () => {},
      errorFn: () => {},
      hostNameFn: () => 'cmux',
    });
    assert.deepEqual(execArgs, { fix: true });
    assert.deepEqual(order, ['execute', 'launch'], 'orden D-05 intacto');
  });

  it('un hostNameFn que LANZA cae al fail-open: sin doctor, con orquestador', async () => {
    // El guard vive DENTRO del try justo para esto: la resolución del host no puede
    // convertirse en una segunda ruta de escape que se lleve por delante el launch.
    const calls = [];
    const errs = [];
    await assert.doesNotReject(
      runCheckAndAct({
        runCheckFn: baseCheck,
        executeFn: async () => { calls.push('execute'); return emptyResult(); },
        launchFn: async () => { calls.push('launch'); },
        logFn: () => {},
        errorFn: (m) => errs.push(m),
        hostNameFn: () => { throw new Error('config ilegible'); },
      }),
    );
    assert.deepEqual(calls, ['launch'], 'launch corre pese al throw del resolvedor de host');
    assert.ok(errs.some((m) => m.includes('Sidebar doctor error')), 'el fallo se reporta por stderr');
  });

  it('gate cerrado (All clear): el guard no cambia nada — nada corre', async () => {
    const calls = [];
    await runCheckAndAct({
      runCheckFn: async () => ({ needsOrchestrator: false, reasons: [], summary: 's' }),
      executeFn: async () => { calls.push('execute'); return emptyResult(); },
      launchFn: async () => { calls.push('launch'); },
      logFn: () => {},
      errorFn: () => {},
      hostNameFn: () => 'cmux',
    });
    assert.deepEqual(calls, [], 'needsOrchestrator=false sigue siendo el gate exterior (D-03)');
  });
});
