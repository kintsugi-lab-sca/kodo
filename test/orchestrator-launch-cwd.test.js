// @ts-check
//
// test/orchestrator-launch-cwd.test.js — KODO-93.
//
// «El orquestador arranca con la raíz del repo kodo aunque `process.cwd()` sea otro directorio.»
//
// Síntoma real: `kodo up` desde un zsh en `~` → el daemon detached heredó cwd=`~` → el check
// lanzó el orquestador con `new-workspace --cwd ~`. Claude Code no auto-cargó
// `.claude/skills/kodo-orchestrate/SKILL.md` y `kodo audit` falló fuera de un repo git.
//
// El observable es el argv de `cmux new-workspace`, así que se corre `launchOrchestrator` de
// verdad contra un shim de cmux, en un subprocess con `cwd` ajeno al repo — mismo scaffold que
// `orchestrator-handoff-launch.test.js` (HOME=tmpHome: `config.js` evalúa `KODO_DIR` en
// module-load y un invoke in-process leería el `~/.kodo` real).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

/** @returns {Promise<{ code: number|null, stdout: string, stderr: string }>} */
function runInlineNode(script, env, cwd) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['-e', script], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', rej);
    child.on('close', (code) => res({ code, stdout, stderr }));
  });
}

describe('KODO-93 — el orquestador abre su workspace en la raíz del repo, no en process.cwd()', () => {
  /** @type {string} */ let tmpHome;
  /** @type {string} */ let kodoDir;
  /** @type {string} */ let foreignCwd;
  /** @type {string} */ let newWorkspaceLog;
  /** @type {string} */ let spawnFnLog;

  before(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-launch-cwd-'));
    kodoDir = join(tmpHome, '.kodo');
    mkdirSync(join(kodoDir, 'logs'), { recursive: true });
    // El cwd del subprocess: un directorio que NO es un repo kodo (el `~` del incidente).
    foreignCwd = join(tmpHome, 'elsewhere');
    mkdirSync(foreignCwd, { recursive: true });
    newWorkspaceLog = join(kodoDir, 'new-workspace.log');
    spawnFnLog = join(kodoDir, 'spawn-fn.log');

    const binDir = join(tmpHome, 'bin');
    mkdirSync(binDir, { recursive: true });
    const shimPath = join(binDir, 'cmux');
    writeFileSync(shimPath, [
      '#!/usr/bin/env node',
      "const { appendFileSync } = require('node:fs');",
      `const LOG = ${JSON.stringify(newWorkspaceLog)};`,
      'const argv = process.argv.slice(2);',
      'const sub = argv[0];',
      'if (sub === "new-workspace") { appendFileSync(LOG, JSON.stringify(argv) + "\\n"); console.log("OK workspace:77"); }',
      'else if (sub === "tree") { process.stdout.write(JSON.stringify({ windows: [] })); }',
      'else if (sub === "workspace" && argv[1] === "list") { process.stdout.write(""); }',
      'process.exit(0);',
    ].join('\n'), 'utf-8');
    chmodSync(shimPath, 0o755);

    writeFileSync(join(kodoDir, 'config.json'), JSON.stringify({
      provider: 'plane',
      host: 'cmux',
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
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    writeFileSync(newWorkspaceLog, '');
    writeFileSync(spawnFnLog, '');
    writeFileSync(join(kodoDir, 'state.json'), JSON.stringify({ schema_version: 3, sessions: {}, history: [] }, null, 2) + '\n');
    rmSync(join(kodoDir, 'orchestrator.json'), { force: true });
  });

  /**
   * Corre `launchOrchestrator` con `cwd=foreignCwd` y devuelve el `--cwd` que llegó a
   * `cmux new-workspace` y el `projectPath` que recibió `spawnFn`.
   *
   * @param {string|undefined} kodoRoot valor de `KODO_ROOT`; `undefined` lo quita del env.
   */
  async function runLaunch(kodoRoot) {
    const launchUrl = pathToFileURL(join(REPO, 'src', 'orchestrator', 'launch.js')).href;
    const script = [
      "const { writeFileSync } = await import('node:fs');",
      `const { launchOrchestrator } = await import(${JSON.stringify(launchUrl)});`,
      'await launchOrchestrator({',
      `  spawnFn: async (a) => writeFileSync(${JSON.stringify(spawnFnLog)}, a.projectPath),`,
      '});',
      'process.exit(0);',
    ].join('\n');
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, HOME: tmpHome };
    delete env.KODO_ROOT;
    if (kodoRoot !== undefined) env.KODO_ROOT = kodoRoot;

    const child = await runInlineNode(script, env, foreignCwd);
    if (child.code !== 0) {
      assert.fail(`subprocess exit ${child.code}\nSTDOUT: ${child.stdout}\nSTDERR: ${child.stderr}`);
    }
    const calls = readFileSync(newWorkspaceLog, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(calls.length, 1, `esperaba un new-workspace; stderr: ${child.stderr}`);
    const argv = calls[0];
    const i = argv.indexOf('--cwd');
    assert.ok(i >= 0, `new-workspace sin --cwd: ${JSON.stringify(argv)}`);
    return { cwd: argv[i + 1], projectPath: readFileSync(spawnFnLog, 'utf-8') };
  }

  it('sin KODO_ROOT: workspace y projectPath en la raíz del repo aunque process.cwd() sea otro', async () => {
    const { cwd, projectPath } = await runLaunch(undefined);
    assert.equal(cwd, REPO);
    assert.equal(projectPath, REPO);
  });

  it('KODO_ROOT en env tiene prioridad sobre la raíz resuelta desde el módulo (Phase 21 D-08)', async () => {
    const override = join(tmpHome, 'override-root');
    mkdirSync(override, { recursive: true });
    const { cwd, projectPath } = await runLaunch(override);
    assert.equal(cwd, override);
    assert.equal(projectPath, override);
  });
});
