// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyReportingGate } from '../src/orchestrator/launch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

/**
 * Spawn `node -e <script>` and resolve with { code, stdout, stderr }.
 * Used by ADVISORY-03 integration test to invoke launchOrchestrator in a
 * fresh subprocess (clean module cache, isolated HOME).
 *
 * @param {string} script
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runInlineNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('inline script timeout 10s'));
    }, 10_000);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

describe('REPORT-03 — applyReportingGate helper (gating infrastructure)', () => {
  const SAMPLE = [
    '# Header',
    '',
    'Some prose before the block.',
    '',
    '<!-- BEGIN reporting -->',
    '## Sub-issue reporting',
    '',
    'Reporting body.',
    '<!-- END reporting -->',
    '',
    'Some prose after the block.',
  ].join('\n');

  it('LG1: enabled=true preserves the block (markers + body intact)', () => {
    const out = applyReportingGate(SAMPLE, true);
    assert.equal(out, SAMPLE, 'enabled=true must return the prompt unchanged');
  });

  it('LG2: enabled=false strips the block AND its markers', () => {
    const out = applyReportingGate(SAMPLE, false);
    assert.ok(!out.includes('<!-- BEGIN reporting -->'),
      'BEGIN marker must be removed');
    assert.ok(!out.includes('<!-- END reporting -->'),
      'END marker must be removed');
    assert.ok(!out.includes('## Sub-issue reporting'),
      'block heading must be removed');
    assert.ok(!out.includes('Reporting body.'),
      'block body must be removed');
  });

  it('LG3: enabled=false preserves prose outside the block', () => {
    const out = applyReportingGate(SAMPLE, false);
    assert.ok(out.includes('Some prose before the block.'),
      'pre-block prose must be preserved');
    assert.ok(out.includes('Some prose after the block.'),
      'post-block prose must be preserved');
    assert.ok(out.includes('# Header'),
      'header must be preserved');
  });

  it('LG4: idempotent — applying with enabled=false twice yields identical output', () => {
    const once = applyReportingGate(SAMPLE, false);
    const twice = applyReportingGate(once, false);
    assert.equal(twice, once,
      'second application must be a no-op (no markers left to match)');
  });

  it('LG5: prompt without markers + enabled=false is a no-op', () => {
    const noMarkers = '# Header\n\nNo block here.\n';
    const out = applyReportingGate(noMarkers, false);
    assert.equal(out, noMarkers, 'absence of markers means no change');
  });

  it('LG6: pure function — same input + same flag produces same output', () => {
    const a = applyReportingGate(SAMPLE, false);
    const b = applyReportingGate(SAMPLE, false);
    assert.equal(a, b, 'same args must always produce same result');
  });

  it('LG7: applies to the real prompt.md — flag=false strips the section completely', () => {
    const real = readFileSync('src/orchestrator/prompt.md', 'utf-8');
    const stripped = applyReportingGate(real, false);
    assert.ok(!stripped.includes('Sub-issue reporting'),
      'real prompt with flag=false must not mention "Sub-issue reporting"');
    assert.ok(!stripped.includes('<!-- BEGIN reporting -->'),
      'BEGIN marker must be absent from stripped real prompt');
    assert.ok(!stripped.includes('<!-- END reporting -->'),
      'END marker must be absent from stripped real prompt');
  });

  it('LG8: applies to the real prompt.md — flag=true preserves the markers', () => {
    const real = readFileSync('src/orchestrator/prompt.md', 'utf-8');
    const kept = applyReportingGate(real, true);
    assert.equal(kept, real, 'flag=true must be byte-identical to source');
    assert.ok(kept.includes('<!-- BEGIN reporting -->'),
      'BEGIN marker must remain when flag=true');
    assert.ok(kept.includes('<!-- END reporting -->'),
      'END marker must remain when flag=true');
  });
});

describe('REPORT-03 — launch.js source hygiene (Phase 14 D-05 forward-looking)', () => {
  const LAUNCH_SOURCE_PATH = 'src/orchestrator/launch.js';

  it('LH1: launch.js consumes isReportToProviderEnabled (helper, not inline access)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /import\s*\{[^}]*isReportToProviderEnabled[^}]*\}\s*from\s*['"]\.\.\/config\.js['"]/,
      'launch.js must import isReportToProviderEnabled from ../config.js',
    );
  });

  it('LH2: launch.js does NOT access .report_to_provider directly (Phase 14 D-05 invariant)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/\.report_to_provider\b/.test(stripped),
      'src/orchestrator/launch.js must not access .report_to_provider directly. Use isReportToProviderEnabled() from src/config.js. Direct access is allowed only inside the helper itself (src/config.js).',
    );
  });

  it('LH3: launch.js invokes isReportToProviderEnabled() at the call site (composed with applyReportingGate)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    // The invocation must be wrapped by applyReportingGate. We grep for the
    // specific composition pattern to lock in the wiring.
    assert.match(
      source,
      /applyReportingGate\([\s\S]*?isReportToProviderEnabled\(\)/,
      'launchOrchestrator must compose applyReportingGate(..., isReportToProviderEnabled())',
    );
  });
});

describe('launchOrchestrator real spawn observables (ADVISORY-03)', () => {
  // ──────────────────────────────────────────────────────────────────────
  // ADVISORY-03 / Plan 31-03 — Opción A "Lifecycle Simulator Hook".
  //
  // Valida que `launchOrchestrator` engancha correctamente al lifecycle
  // downstream cuando se inyecta `opts.spawnFn`. Tres observables verificados
  // post-launch:
  //   1. spawnFn es invocado con el payload correcto (workspaceRef,
  //      sessionId, projectPath, kodoDir, taskRef).
  //   2. state.json contiene la nueva session record (addSession ejecutado
  //      dentro del spawnFn).
  //   3. NDJSON head-line parseable con event=session.start + transcript_path
  //      populated (sessionStart emitter ejecutado dentro del spawnFn).
  //
  // Estrategia técnica:
  //   - Subprocess `node -e <inlineScript>` con HOME=_tmpHome desde el
  //     entrypoint. Esto da un module cache LIMPIO al child: `config.js`
  //     evalúa `KODO_DIR = join(homedir(), '.kodo')` con homedir() = _tmpHome.
  //   - El test runner pre-existente carga `applyReportingGate` static al
  //     top del archivo, congelando `config.js` en el parent con HOME real.
  //     Por eso este test ejecuta launchOrchestrator EN SUBPROCESS — un
  //     in-process invoke leería el ~/.kodo del usuario real.
  //   - cmux real NUNCA se invoca: shim `${_tmpHome}/bin/cmux` (script node
  //     ejecutable) responde a new-workspace / list-workspaces / send /
  //     workspace-action / notify con outputs canónicos. `config.cmux.binary`
  //     apunta al shim absolute.
  // ──────────────────────────────────────────────────────────────────────

  /** @type {string} */ let _tmpHome;
  /** @type {string | undefined} */ let _origHome;

  before(() => {
    // Snapshot HOME para restore en after().
    _origHome = process.env.HOME;
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-launch-advisory-03-'));
    // NOTA: el parent NO necesita override de HOME — la lógica corre en
    // un subprocess que recibe HOME=_tmpHome via env. El snapshot se
    // mantiene defensive por si emerge testing in-process en el futuro.

    // Plumbing: ~/.kodo/, ~/.kodo/logs/, ~/.kodo/state.json.
    const kodoDir = join(_tmpHome, '.kodo');
    mkdirSync(join(kodoDir, 'logs'), { recursive: true });
    writeFileSync(
      join(kodoDir, 'state.json'),
      JSON.stringify({ schema_version: 2, sessions: {}, history: [] }, null, 2),
      'utf-8',
    );

    // cmux shim: script node ejecutable que responde a las subcommands del
    // cliente cmux. `new-workspace` imprime "OK workspace:99" para satisfacer
    // el regex /(workspace:\d+)/ del cmux/client.js. `list-workspaces` imprime
    // string vacío → launchOrchestrator NO entra en la rama "already exists".
    // Las demás subcommands (send, workspace-action, notify) salen 0 sin
    // output.
    const binDir = join(_tmpHome, 'bin');
    mkdirSync(binDir, { recursive: true });
    const shimPath = join(binDir, 'cmux');
    const shimContent =
      '#!/usr/bin/env node\n' +
      'const sub = process.argv[2];\n' +
      'if (sub === "new-workspace") { console.log("OK workspace:99"); }\n' +
      'else if (sub === "list-workspaces") { process.stdout.write(""); }\n' +
      'process.exit(0);\n';
    writeFileSync(shimPath, shimContent, 'utf-8');
    chmodSync(shimPath, 0o755);

    // config.json: provider plane + cmux.binary apuntando al shim. Mínimo
    // viable para satisfacer loadConfig() + el shape `providers.plane.*`
    // que migrateConfigIfNeeded NO re-escriba (presence de `providers` salta
    // la migración v1→v2).
    const configObj = {
      provider: 'plane',
      cmux: {
        binary: shimPath,
        colors: { running: 'Amber', done: 'Green', error: 'Crimson', review: 'Blue' },
      },
      claude: {
        binary: '/fake/claude',
        default_model: 'test',
        max_parallel: 1,
        flags: [],
      },
      providers: {
        plane: {
          base_url: 'https://example.invalid',
          api_key_env: 'FAKE_API_KEY',
          workspace_slug: 'test',
          projects: [],
          states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
        },
      },
    };
    writeFileSync(join(kodoDir, 'config.json'), JSON.stringify(configObj), 'utf-8');
  });

  after(() => {
    // Restore HOME (defensive — no se modificó en parent, pero el snapshot
    // garantiza idempotencia si el invariante cambia).
    if (_origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = _origHome;
    }
    if (_tmpHome) {
      rmSync(_tmpHome, { recursive: true, force: true });
    }
  });

  it('SC#3: spawnFn DI ejecuta inline lifecycle → state.json + NDJSON head-line observables', async () => {
    const sessionId = 'test-advisory-03-uuid';
    const taskId = 'TEST-ADVISORY-03';

    // pathToFileURL convierte paths POSIX/Windows a `file://` URLs absolutos
    // — Node ESM exige URLs no-relativas en `await import(...)` desde `-e`.
    const stateUrl = pathToFileURL(join(REPO, 'src', 'session', 'state.js')).href;
    const loggerUrl = pathToFileURL(join(REPO, 'src', 'logger.js')).href;
    const eventsUrl = pathToFileURL(join(REPO, 'src', 'logger-events.js')).href;
    const launchUrl = pathToFileURL(join(REPO, 'src', 'orchestrator', 'launch.js')).href;

    // Inline script: corre en subprocess con HOME=_tmpHome. Toda dynamic
    // import al cargarse evalúa config.js fresh → KODO_DIR=_tmpHome/.kodo.
    // El spawnFn DI invocado dentro de launchOrchestrator simula el lifecycle:
    // addSession + sessionStart. Al exit, el filesystem queda con los
    // observables que el parent test lee y assertea.
    const inlineScript = [
      // 1) HOME isolation defensive (el subprocess ya recibe HOME=_tmpHome via
      //    env, pero el override explícito blinda contra herencia parcial).
      `process.env.HOME = ${JSON.stringify(_tmpHome)};`,
      // 2) Dynamic imports — file:// URLs absolutas obligatorias en `node -e`.
      `const stateMod = await import(${JSON.stringify(stateUrl)});`,
      `const loggerMod = await import(${JSON.stringify(loggerUrl)});`,
      `const eventsMod = await import(${JSON.stringify(eventsUrl)});`,
      `const { launchOrchestrator } = await import(${JSON.stringify(launchUrl)});`,
      // 3) noopLogger inline para el await launchOrchestrator (evita ruido
      //    NDJSON parásito del propio orchestrator logger).
      `const noopLog = { info(){}, warn(){}, error(){}, debug(){}, child(){ return noopLog; } };`,
      // 4) spawnFn DI: simula el lifecycle downstream que en producción haría
      //    claude binary dentro del workspace cmux. Push ctx para sanity
      //    check del payload + addSession + sessionStart real.
      `const spawnCalls = [];`,
      `const spawnFn = async (ctx) => {`,
      `  spawnCalls.push(ctx);`,
      `  const sessionRecord = {`,
      `    workspace_ref: ctx.workspaceRef,`,
      `    session_id: ${JSON.stringify(sessionId)},`,
      `    task_id: ${JSON.stringify(taskId)},`,
      `    task_ref: 'kodo-orchestrator',`,
      `    provider: 'plane',`,
      `    project_id: 'p-test',`,
      `    summary: 'inline lifecycle simulator (ADVISORY-03)',`,
      `    status: 'running',`,
      `    started_at: new Date().toISOString(),`,
      `    project_path: process.cwd(),`,
      `    gsd: false,`,
      `  };`,
      `  stateMod.addSession(${JSON.stringify(taskId)}, sessionRecord);`,
      `  const baseLog = loggerMod.createLogger({ sessionId: ${JSON.stringify(sessionId)} });`,
      `  const log = typeof baseLog.child === 'function' ? baseLog.child({ component: 'test' }) : baseLog;`,
      `  eventsMod.sessionStart(log, {`,
      `    session_id: ${JSON.stringify(sessionId)},`,
      `    task_id: ${JSON.stringify(taskId)},`,
      `    provider: 'plane',`,
      `    project_path: process.cwd(),`,
      `    started_at: new Date().toISOString(),`,
      `  });`,
      `};`,
      // 5) Invoke under test.
      `const result = await launchOrchestrator({ logger: noopLog, spawnFn });`,
      // 6) Emit a single-line JSON receipt to stdout so the parent can assert
      //    that spawnFn was invoked exactly once with the expected shape.
      `process.stdout.write('__ADVISORY03_RECEIPT__' + JSON.stringify({ result, spawnCalls }) + '\\n');`,
      `process.exit(0);`,
    ].join('\n');

    const env = { ...process.env, HOME: _tmpHome };
    const childResult = await runInlineNode(inlineScript, env);
    if (childResult.code !== 0) {
      assert.fail(
        `inline script exit ${childResult.code}\nSTDOUT: ${childResult.stdout}\nSTDERR: ${childResult.stderr}`,
      );
    }

    // ── Assertion 1: spawnFn fue invocado con payload correcto ──────────
    const receiptMarker = '__ADVISORY03_RECEIPT__';
    const receiptIdx = childResult.stdout.indexOf(receiptMarker);
    assert.ok(receiptIdx !== -1, `receipt marker not found in stdout: ${childResult.stdout}`);
    const receiptLine = childResult.stdout.slice(receiptIdx + receiptMarker.length).split('\n')[0];
    /** @type {{ result: { workspace: string, existing: boolean }, spawnCalls: Array<{ workspaceRef: string, sessionId: string, projectPath: string, kodoDir: string, taskRef: string }> }} */
    let receipt;
    try {
      receipt = JSON.parse(receiptLine);
    } catch (err) {
      assert.fail(`receipt JSON parse failed: ${err}\nLINE: ${receiptLine}`);
    }
    assert.equal(receipt.spawnCalls.length, 1, 'spawnFn must be called exactly once');
    assert.equal(receipt.spawnCalls[0].taskRef, 'kodo-orchestrator');
    assert.ok(receipt.spawnCalls[0].workspaceRef, 'workspaceRef present');
    assert.ok(receipt.spawnCalls[0].sessionId, 'sessionId present');
    assert.equal(
      receipt.spawnCalls[0].kodoDir,
      join(_tmpHome, '.kodo'),
      'kodoDir derived from homedir() override',
    );

    // ── Assertion 2: state.json contiene la nueva session record ─────────
    const stateJsonPath = join(_tmpHome, '.kodo', 'state.json');
    assert.ok(existsSync(stateJsonPath), 'state.json present');
    const stateRaw = readFileSync(stateJsonPath, 'utf-8');
    /** @type {{ schema_version: number, sessions: Record<string, any> }} */
    let state;
    try {
      state = JSON.parse(stateRaw);
    } catch (err) {
      assert.fail(`state.json parse failed: ${err}\nRAW: ${stateRaw}`);
    }
    assert.ok(state.sessions[taskId], `session ${taskId} present in state.json`);
    assert.equal(state.sessions[taskId].session_id, sessionId);
    assert.equal(state.sessions[taskId].task_ref, 'kodo-orchestrator');
    assert.equal(state.sessions[taskId].status, 'running');

    // ── Assertion 3: NDJSON head-line con event=session.start ─────────────
    const ndjsonPath = join(_tmpHome, '.kodo', 'logs', `${sessionId}.ndjson`);
    assert.ok(existsSync(ndjsonPath), `NDJSON logfile present: ${ndjsonPath}`);
    const ndjsonRaw = readFileSync(ndjsonPath, 'utf-8');
    const lines = ndjsonRaw.split('\n').filter((l) => l.length > 0);
    assert.ok(lines.length >= 1, 'NDJSON has at least one line');
    const head = lines[0];
    /** @type {{ event: string, task_id: string, transcript_path: string, session_id: string }} */
    let rec;
    try {
      rec = JSON.parse(head);
    } catch (err) {
      assert.fail(`NDJSON head-line parse failed: ${err}\nLINE: ${head}`);
    }
    assert.equal(rec.event, 'session.start', 'head-line event must be session.start');
    assert.equal(rec.task_id, taskId);
    assert.equal(rec.session_id, sessionId);
    assert.ok(
      typeof rec.transcript_path === 'string' && rec.transcript_path.length > 0,
      'transcript_path populated and non-empty',
    );
  });

  it('source-hygiene: launch.js does NOT import node:child_process (Opción A invariante)', () => {
    // Blinda el invariante Opción A: en producción, launch.js NO usa
    // child_process. El lifecycle real lo hace claude binary dentro del
    // cmux workspace; los tests proveen su propio spawn vía spawnFn DI.
    const source = readFileSync(join(REPO, 'src', 'orchestrator', 'launch.js'), 'utf-8');
    assert.ok(
      !source.includes("from 'node:child_process'"),
      'launch.js must NOT import from node:child_process (ADVISORY-03 Opción A invariante)',
    );
    assert.ok(
      !source.includes('from "node:child_process"'),
      'launch.js must NOT import from "node:child_process" (ADVISORY-03 Opción A invariante)',
    );
    assert.ok(
      !source.includes("from 'child_process'"),
      'launch.js must NOT import from bare "child_process" (ADVISORY-03 Opción A invariante)',
    );
  });
});
