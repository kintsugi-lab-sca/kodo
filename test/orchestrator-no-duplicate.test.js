// @ts-check
//
// test/orchestrator-no-duplicate.test.js — KODO-16, prueba del criterio de éxito.
//
// «Reiniciar el daemon con un orquestador vivo NO produce un segundo orquestador.»
// El observable que lo demuestra es UNO y es negativo: `cmux new-workspace` no se
// invoca. Por eso estos tests corren `launchOrchestrator` de verdad contra un shim de
// cmux que apunta cada subcomando a un log, en vez de stubear la decisión.
//
// Escenarios (todos con la tab del orquestador YA renombrada a `心動 kodo service`,
// que es lo que hacía el arranque del daemon y lo que rompía la detección por título):
//   1. registrado + vivo            → NO lanza
//   2. registrado + muerto          → SÍ lanza y re-registra (la cola no se queda sin
//                                      supervisor — criterio 3)
//   3. registrado + cmux no responde → NO lanza (silencio ≠ muerte)
//   4. sin registro + tab legacy     → NO lanza y ADOPTA la tab en el registro
//
// Scaffold copiado de test/launch.test.js (ADVISORY-03): subprocess `node -e` con
// HOME=tmpHome para que `config.js` evalúe KODO_DIR sobre el sandbox — un invoke
// in-process leería el `~/.kodo` real del operador. El shim de cmux lee su guion de
// `$HOME/.kodo/test-scenario.json` y escribe cada invocación en `$HOME/.kodo/cmux.log`.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const ORCH_UUID = 'AAAAAAAA-1111-2222-3333-444444444444';
const NEW_UUID = 'BBBBBBBB-5555-6666-7777-888888888888';
// El shim responde SIEMPRE workspace:99 a `new-workspace`, así que su presencia en el
// log de cmux es la prueba de que se creó (o no) un segundo orquestador.
const NEW_REF = 'workspace:99';

/** @returns {Promise<{ code: number|null, stdout: string, stderr: string }>} */
function runInlineNode(script, env) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', rej);
    child.on('close', (code) => res({ code, stdout, stderr }));
  });
}

describe('KODO-16 — reiniciar el daemon no duplica el orquestador', () => {
  /** @type {string} */ let tmpHome;
  /** @type {string|undefined} */ let origHome;
  /** @type {string} */ let kodoDir;
  /** @type {string} */ let scenarioPath;
  /** @type {string} */ let cmuxLogPath;
  /** @type {string} */ let statePath;

  before(() => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-orch-dup-'));
    kodoDir = join(tmpHome, '.kodo');
    mkdirSync(join(kodoDir, 'logs'), { recursive: true });
    scenarioPath = join(kodoDir, 'test-scenario.json');
    cmuxLogPath = join(kodoDir, 'cmux.log');
    statePath = join(kodoDir, 'state.json');

    // Shim de cmux: registra cada subcomando y responde según el guion en disco.
    const binDir = join(tmpHome, 'bin');
    mkdirSync(binDir, { recursive: true });
    const shimPath = join(binDir, 'cmux');
    writeFileSync(shimPath, [
      '#!/usr/bin/env node',
      "const { appendFileSync, readFileSync } = require('node:fs');",
      `const LOG = ${JSON.stringify(cmuxLogPath)};`,
      `const SCENARIO = ${JSON.stringify(scenarioPath)};`,
      'const argv = process.argv.slice(2);',
      'appendFileSync(LOG, JSON.stringify(argv.slice(0, 3)) + "\\n");',
      'let s = {};',
      'try { s = JSON.parse(readFileSync(SCENARIO, "utf-8")); } catch {}',
      'const sub = argv[0];',
      'if (sub === "tree") {',
      '  if (s.treeFail) { process.stderr.write("socket unavailable\\n"); process.exit(1); }',
      '  process.stdout.write(s.treeRaw !== undefined ? s.treeRaw : JSON.stringify(s.tree || { windows: [] }));',
      '} else if (sub === "workspace" && argv[1] === "list") {',
      '  process.stdout.write(s.workspaceList || "");',
      `} else if (sub === "new-workspace") { console.log("OK ${NEW_REF}"); }`,
      'process.exit(0);',
    ].join('\n'), 'utf-8');
    chmodSync(shimPath, 0o755);

    writeFileSync(join(kodoDir, 'config.json'), JSON.stringify({
      provider: 'plane',
      cmux: {
        binary: shimPath,
        colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' },
      },
      claude: { binary: '/fake/claude', default_model: 'test', max_parallel: 1, flags: [] },
      providers: {
        plane: {
          base_url: 'https://example.invalid',
          api_key_env: 'FAKE_API_KEY',
          workspace_slug: 'test',
          projects: [],
          states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
        },
      },
    }), 'utf-8');
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    writeFileSync(cmuxLogPath, '');
  });

  /** Escribe el state.json v3 del sandbox, con o sin registro de orquestador. */
  function seedState(orchestrator) {
    const state = { schema_version: 3, sessions: {}, history: [] };
    if (orchestrator) state.orchestrator = orchestrator;
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  }

  /** Escribe el guion del shim de cmux. */
  function seedScenario(scenario) {
    writeFileSync(scenarioPath, JSON.stringify(scenario), 'utf-8');
  }

  /** Árbol con la tab del orquestador viva en un window SECUNDARIO y ya renombrada. */
  function treeWithOrchestrator() {
    return {
      windows: [
        { ref: 'window:1', workspaces: [{ ref: 'workspace:1', id: 'CCCC', title: 'otra cosa' }] },
        { ref: 'window:2', workspaces: [{ ref: 'workspace:32', id: ORCH_UUID, title: '心動 kodo service' }] },
      ],
    };
  }

  /** Corre launchOrchestrator en subprocess y devuelve su resultado + el log de cmux. */
  async function runLaunch(launchOpts = {}) {
    const launchUrl = pathToFileURL(join(REPO, 'src', 'orchestrator', 'launch.js')).href;
    const script = [
      `process.env.HOME = ${JSON.stringify(tmpHome)};`,
      `const { launchOrchestrator } = await import(${JSON.stringify(launchUrl)});`,
      `const result = await launchOrchestrator(${JSON.stringify(launchOpts)});`,
      "process.stdout.write('__RECEIPT__' + JSON.stringify(result) + '\\n');",
      'process.exit(0);',
    ].join('\n');
    const child = await runInlineNode(script, { ...process.env, HOME: tmpHome });
    if (child.code !== 0) {
      assert.fail(`subprocess exit ${child.code}\nSTDOUT: ${child.stdout}\nSTDERR: ${child.stderr}`);
    }
    const idx = child.stdout.indexOf('__RECEIPT__');
    assert.ok(idx !== -1, `sin receipt en stdout: ${child.stdout}`);
    const result = JSON.parse(child.stdout.slice(idx + '__RECEIPT__'.length).split('\n')[0]);
    const calls = readFileSync(cmuxLogPath, 'utf-8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { result, calls, stdout: child.stdout };
  }

  /** ¿Se creó un workspace? El observable central de esta tarea. */
  function createdWorkspace(calls) {
    return calls.some((c) => c[0] === 'new-workspace');
  }

  function readState() {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  }

  it('1. orquestador registrado y VIVO → no crea un segundo workspace', async () => {
    seedState({
      workspace_ref: 'workspace:32',
      workspace_id: ORCH_UUID,
      session_id: 'sess-1',
      started_at: '2026-08-10T08:00:00.000Z',
    });
    seedScenario({ tree: treeWithOrchestrator(), workspaceList: '' });

    const { result, calls } = await runLaunch();

    assert.equal(createdWorkspace(calls), false, 'NO debe crear un segundo orquestador');
    assert.equal(result.existing, true);
    assert.equal(result.workspace, 'workspace:32');
    // La tab está renombrada y `workspace list` responde vacío: la detección por título
    // habría fallado. Lo que salva el caso es el registro + el árbol cross-window.
    assert.ok(calls.some((c) => c[0] === 'tree'), 'debe revalidar contra el host');
  });

  it('2. orquestador registrado pero MUERTO → relanza y re-registra la identidad nueva', async () => {
    seedState({
      workspace_ref: 'workspace:32',
      workspace_id: ORCH_UUID,
      session_id: 'sess-1',
      started_at: '2026-08-10T08:00:00.000Z',
    });
    // El host responde y el workspace registrado NO está; el `workspace:99` que devolverá
    // `new-workspace` sí, para que el re-registro resuelva su UUID.
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID, title: 'kodo-orchestrator' }] }] },
      workspaceList: '',
    });

    const { result, calls } = await runLaunch();

    assert.equal(createdWorkspace(calls), true, 'la cola no puede quedarse sin supervisor');
    assert.equal(result.existing, false);
    assert.equal(result.workspace, NEW_REF);
    const reg = readState().orchestrator;
    assert.equal(reg.workspace_ref, NEW_REF, 'el registro huérfano se reemplaza');
    assert.equal(reg.workspace_id, NEW_UUID);
    assert.ok(reg.session_id, 'el session-id del launch nuevo queda registrado');
  });

  it('3. registrado + cmux no responde → NO lanza (silencio no es muerte)', async () => {
    seedState({
      workspace_ref: 'workspace:32',
      workspace_id: ORCH_UUID,
      session_id: 'sess-1',
      started_at: '2026-08-10T08:00:00.000Z',
    });
    seedScenario({ treeFail: true, workspaceList: '' });

    const { result, calls } = await runLaunch();

    assert.equal(createdWorkspace(calls), false, 'un host mudo no autoriza un duplicado');
    assert.equal(result.existing, true);
    assert.equal(result.verified, false);
    // Y el registro sigue intacto: no se limpia lo que no se ha podido refutar.
    assert.equal(readState().orchestrator.workspace_id, ORCH_UUID);
  });

  it('3b. registrado + árbol corrupto → tampoco lanza', async () => {
    seedState({
      workspace_ref: 'workspace:32',
      workspace_id: ORCH_UUID,
      session_id: 'sess-1',
      started_at: '2026-08-10T08:00:00.000Z',
    });
    seedScenario({ treeRaw: '{ no json', workspaceList: '' });

    const { result, calls } = await runLaunch();
    assert.equal(createdWorkspace(calls), false);
    assert.equal(result.verified, false);
  });

  it('4. sin registro + tab legacy titulada kodo-orchestrator → no lanza y la adopta', async () => {
    // Migración: el orquestador que ya corría cuando no existía el registro.
    seedState(null);
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: 'workspace:32', id: ORCH_UUID, title: 'kodo-orchestrator' }] }] },
      workspaceList: '  workspace:7  KODO-1\n  workspace:32  kodo-orchestrator\n',
    });

    const { result, calls } = await runLaunch();

    assert.equal(createdWorkspace(calls), false);
    assert.equal(result.existing, true);
    assert.equal(result.workspace, 'workspace:32');
    const reg = readState().orchestrator;
    assert.equal(reg.workspace_ref, 'workspace:32', 'la tab legacy queda registrada');
    assert.equal(reg.workspace_id, ORCH_UUID, 'con su UUID, para sobrevivir al próximo rename');
  });

  it('5. sin registro y sin ninguna tab → lanza y registra (arranque en frío)', async () => {
    seedState(null);
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID }] }] },
      workspaceList: '',
    });

    const { result, calls } = await runLaunch();

    assert.equal(createdWorkspace(calls), true);
    assert.equal(result.existing, false);
    assert.equal(readState().orchestrator.workspace_ref, NEW_REF);
  });

  it('el registro se escribe ANTES del send (una tab a medias no se multiplica)', async () => {
    seedState(null);
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID }] }] },
      workspaceList: '',
    });
    const { calls } = await runLaunch();
    // El resolve del UUID (un `tree`) ocurre dentro del setOrchestrator del launch, así
    // que el último `tree` del log tiene que preceder al `send`.
    const lastTree = calls.map((c) => c[0]).lastIndexOf('tree');
    const sendIdx = calls.map((c) => c[0]).indexOf('send');
    assert.ok(sendIdx !== -1, 'el launch debe enviar el comando claude');
    assert.ok(lastTree < sendIdx, 'la identidad se registra antes de arrancar claude');
  });

  function seedForeignRegistration() {
    seedState({
      workspace_ref: 'repo-x::/orca/workspaces/kodo/kodo-orchestrator',
      workspace_id: 'repo-x::/orca/workspaces/kodo/kodo-orchestrator',
      session_id: 'sess-orca',
      started_at: '2026-08-18T09:00:00Z',
      host: 'orca',
    });
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID }] }] },
      workspaceList: '',
    });
  }

  it('KODO-18: un registro de OTRO host NO se relanza solo — la decisión es del operador', async () => {
    // Un registro de orca es invisible desde cmux, pero esa ausencia es ESTRUCTURAL, no
    // evidencia de muerte: el orquestador de orca puede seguir perfectamente vivo. Lanzar
    // igualmente arrancaría un segundo supervisor sobre el mismo state.json, que es justo
    // lo que este carril existe para impedir.
    seedForeignRegistration();
    const { calls, stdout, result } = await runLaunch();
    assert.ok(!createdWorkspace(calls), 'NO se crea un segundo workspace');
    assert.equal(result.verified, false, 'existing:true pero sin haberlo visto vivo');
    assert.equal(result.foreignHost, 'orca');
    // El registro NO se limpia: sigue siendo la única pista de que hay algo en orca.
    assert.equal(readState().orchestrator.host, 'orca', 'el registro se conserva');
  });

  it('KODO-18: el mensaje dice qué hacer, no solo qué pasa', async () => {
    // Un aviso que no es accionable es ruido: el operador tiene que saber que debe mirar
    // el otro cliente y cuál es la salida.
    seedForeignRegistration();
    const { stdout } = await runLaunch();
    assert.match(stdout, /'orca'/, 'nombra el host del registro');
    assert.match(stdout, /'cmux'/, 'nombra el host activo');
    assert.match(stdout, /ciérralo/i, 'dice qué hacer con el orquestador anterior');
    assert.match(stdout, /kodo orchestrate --force/, 'da la salida explícita');
  });

  it('KODO-18: --force descarta el registro ajeno y lanza en el host activo', async () => {
    // La cola no puede quedarse sin supervisor para siempre: reintentar no resuelve nada
    // mientras no se vuelva al otro cliente, así que hace falta una salida explícita.
    seedForeignRegistration();
    const { calls, stdout } = await runLaunch({ force: true });
    assert.ok(createdWorkspace(calls), 'con --force sí se lanza');
    assert.match(stdout, /--force/);
    assert.equal(readState().orchestrator.host, 'cmux', 'el registro nuevo lleva el host activo');
  });

  it('KODO-18: un registro del MISMO host muerto NO dispara el aviso cross-host', async () => {
    // El aviso solo tiene sentido cuando hay otro host implicado; en el caso normal
    // (la tab murió de verdad) el mensaje de siempre.
    seedState({
      workspace_ref: 'workspace:32',
      workspace_id: ORCH_UUID,
      session_id: 'sess-cmux',
      started_at: '2026-08-18T09:00:00Z',
      host: 'cmux',
    });
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID }] }] },
      workspaceList: '',
    });
    const { calls, stdout } = await runLaunch();
    assert.ok(createdWorkspace(calls), 'se relanza igual');
    assert.doesNotMatch(stdout, /AVISO/, 'sin cambio de host no hay aviso');
    assert.match(stdout, /ya no existe — se relanza/);
  });

  it('KODO-18: un registro LEGACY sin `host` no inventa un aviso (sin evidencia, silencio)', async () => {
    seedState({
      workspace_ref: 'workspace:32',
      workspace_id: ORCH_UUID,
      session_id: 'sess-legacy',
      started_at: '2026-08-18T09:00:00Z',
    });
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID }] }] },
      workspaceList: '',
    });
    const { stdout } = await runLaunch();
    assert.doesNotMatch(stdout, /AVISO/, 'un registro pre-KODO-18 no permite concluir nada');
  });

  it('state.json queda con la clave top-level `orchestrator` (jq .orchestrator)', async () => {
    seedState(null);
    seedScenario({
      tree: { windows: [{ ref: 'window:1', workspaces: [{ ref: NEW_REF, id: NEW_UUID }] }] },
      workspaceList: '',
    });
    await runLaunch();
    assert.ok(existsSync(statePath));
    const raw = readState();
    // KODO-18: se suma `host` — sella bajo qué cliente (cmux|orca) se creó el
    // orquestador, para poder distinguir «el workspace murió» de «cambiaste de host»
    // cuando la revalidación no lo encuentra.
    assert.deepEqual(Object.keys(raw.orchestrator).sort(),
      ['host', 'session_id', 'started_at', 'workspace_id', 'workspace_ref']);
    assert.ok(
      ['cmux', 'orca'].includes(raw.orchestrator.host),
      `host sellado inválido: ${raw.orchestrator.host}`,
    );
  });
});
