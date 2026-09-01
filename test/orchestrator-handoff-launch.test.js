// @ts-check
//
// test/orchestrator-handoff-launch.test.js — KODO-67, criterio de éxito nº 1.
//
// «Con `handoff.md` presente, el prompt generado lo incluye y el fichero queda renombrado;
//  sin fichero, el prompt es idéntico al actual.»
//
// Ese observable NO se puede medir con un stub: hay que ver el TEXTO que sale por
// `cmux send`, que es lo único que el orquestador entrante llega a leer. Así que se corre
// `launchOrchestrator` de verdad contra un shim de cmux — mismo scaffold que
// `orchestrator-no-duplicate.test.js` (subprocess con HOME=tmpHome, porque `config.js`
// evalúa `KODO_DIR` en module-load y un invoke in-process leería el `~/.kodo` real).
//
// El shim de aquí diverge del de aquel fichero en una cosa: vuelca el argv ENTERO del
// `send` a un fichero aparte, porque el prompt viaja en `argv[3]` y aquel shim solo
// registraba los tres primeros tokens.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { HANDOFF_HEADING } from '../src/orchestrator/handoff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

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

describe('KODO-67 — el handoff entra en el prompt del orquestador y se consume', () => {
  /** @type {string} */ let tmpHome;
  /** @type {string} */ let kodoDir;
  /** @type {string} */ let sendLogPath;
  /** @type {string} */ let handoffFile;

  before(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-handoff-launch-'));
    kodoDir = join(tmpHome, '.kodo');
    mkdirSync(join(kodoDir, 'logs'), { recursive: true });
    sendLogPath = join(kodoDir, 'send.log');
    handoffFile = join(kodoDir, 'handoff.md');

    // Shim de cmux. `send` vuelca su argv COMPLETO (el prompt va en argv[3]); el resto de
    // subcomandos responden lo mínimo para que el launch llegue hasta el send.
    const binDir = join(tmpHome, 'bin');
    mkdirSync(binDir, { recursive: true });
    const shimPath = join(binDir, 'cmux');
    writeFileSync(shimPath, [
      '#!/usr/bin/env node',
      "const { appendFileSync } = require('node:fs');",
      `const SEND_LOG = ${JSON.stringify(sendLogPath)};`,
      'const argv = process.argv.slice(2);',
      'const sub = argv[0];',
      'if (sub === "send") { appendFileSync(SEND_LOG, JSON.stringify(argv) + "\\n"); }',
      'else if (sub === "tree") { process.stdout.write(JSON.stringify({ windows: [] })); }',
      'else if (sub === "workspace" && argv[1] === "list") { process.stdout.write(""); }',
      'else if (sub === "new-workspace") { console.log("OK workspace:77"); }',
      'process.exit(0);',
    ].join('\n'), 'utf-8');
    chmodSync(shimPath, 0o755);

    writeFileSync(join(kodoDir, 'config.json'), JSON.stringify({
      provider: 'plane',
      // Host EXPLÍCITO: el default es dependiente de plataforma (KODO-56) y en Linux
      // saldría `orca`, que no habla con este shim.
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
    writeFileSync(sendLogPath, '');
    writeFileSync(join(kodoDir, 'state.json'), JSON.stringify({ schema_version: 3, sessions: {}, history: [] }, null, 2) + '\n');
    // Limpieza de handoffs (originales y consumidos) entre casos.
    for (const f of readdirSync(kodoDir)) {
      if (f.startsWith('handoff')) rmSync(join(kodoDir, f), { force: true });
    }
  });

  /** Corre `launchOrchestrator` en subprocess y devuelve el prompt que llegó al `send`. */
  async function runLaunch() {
    const launchUrl = pathToFileURL(join(REPO, 'src', 'orchestrator', 'launch.js')).href;
    const script = [
      `process.env.HOME = ${JSON.stringify(tmpHome)};`,
      `const { launchOrchestrator } = await import(${JSON.stringify(launchUrl)});`,
      'await launchOrchestrator({});',
      'process.exit(0);',
    ].join('\n');
    const child = await runInlineNode(script, { ...process.env, HOME: tmpHome, KODO_ROOT: REPO });
    if (child.code !== 0) {
      assert.fail(`subprocess exit ${child.code}\nSTDOUT: ${child.stdout}\nSTDERR: ${child.stderr}`);
    }
    const lines = readFileSync(sendLogPath, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.length >= 1, `esperaba al menos un send; stderr: ${child.stderr}`);
    // `cmux send --workspace <ws> <texto>` → el comando de claude, con el prompt dentro.
    return lines[0][3];
  }

  /** Ficheros `handoff-consumed-*.md` que quedaron en el sandbox. */
  function consumedFiles() {
    return readdirSync(kodoDir).filter((f) => f.startsWith('handoff-consumed-'));
  }

  it('SIN handoff: el prompt no menciona el encabezado y no aparece ningún consumido', async () => {
    const prompt = await runLaunch();
    assert.ok(!prompt.includes(HANDOFF_HEADING), 'sin fichero no se inyecta nada');
    assert.ok(prompt.includes('Situación actual'), 'el prompt normal sí se compone');
    assert.equal(consumedFiles().length, 0);
  });

  it('CON handoff: el contenido entra en el prompt, bajo su encabezado y al final', async () => {
    writeFileSync(handoffFile, '**Sesiones vivas:** ninguna\n**Decisión pendiente:** merge de PR #55\n');
    const prompt = await runLaunch();

    assert.ok(prompt.includes(HANDOFF_HEADING), 'el encabezado del handoff está');
    assert.ok(prompt.includes('Decisión pendiente'), 'el contenido del handoff está');
    assert.ok(
      prompt.indexOf(HANDOFF_HEADING) > prompt.indexOf('Situación actual'),
      'el handoff va DESPUÉS de la situación actual (lo más fresco, último)',
    );
  });

  it('CON handoff: el fichero se RENOMBRA tras el spawn (no se borra, no se reinyecta)', async () => {
    writeFileSync(handoffFile, 'estado del saliente');
    await runLaunch();

    assert.ok(!existsSync(handoffFile), 'el original ya no está donde el launch lo busca');
    const consumed = consumedFiles();
    assert.equal(consumed.length, 1, 'queda exactamente un consumido');
    assert.equal(readFileSync(join(kodoDir, consumed[0]), 'utf-8'), 'estado del saliente');
  });

  it('un SEGUNDO launch tras consumir NO reinyecta el handoff', async () => {
    writeFileSync(handoffFile, 'solo una vez');
    const first = await runLaunch();
    assert.ok(first.includes('solo una vez'));

    writeFileSync(sendLogPath, '');
    // El primer launch dejó registro del orquestador; se limpia para forzar otro launch
    // real (aquí se mide la reinyección, no la deduplicación de KODO-16).
    writeFileSync(join(kodoDir, 'state.json'), JSON.stringify({ schema_version: 3, sessions: {}, history: [] }, null, 2) + '\n');
    const second = await runLaunch();

    assert.ok(!second.includes('solo una vez'), 'el handoff ya consumido no vuelve');
    assert.ok(!second.includes(HANDOFF_HEADING));
  });

  it('un handoff por encima del cap se IGNORA y se queda en disco para el operador', async () => {
    writeFileSync(handoffFile, 'x'.repeat(40 * 1024)); // > MAX_HANDOFF_BYTES (32 KB)
    const prompt = await runLaunch();

    assert.ok(!prompt.includes(HANDOFF_HEADING), 'no se inyecta un handoff sobredimensionado');
    assert.ok(existsSync(handoffFile), 'y NO se consume: el operador tiene que poder verlo');
  });
});
