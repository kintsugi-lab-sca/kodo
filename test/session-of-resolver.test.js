// @ts-check
//
// test/session-of-resolver.test.js — Phase 17 UAT-03 SC#3 coverage.
//
// Convierte el UAT-03 humano de Phase 7 (`07-HUMAN-UAT.md` test #3) en
// integration test que monta `state.json` sintético + ficheros de log NDJSON y
// ejecuta `kodo logs --session-of <plane-task-id>` E2E vía spawnSync,
// verificando la resolución two-step del resolver
// (`state.json` index → head-line scan) y los exit codes deterministas para
// los 4 escenarios de D-12.
//
// Decisiones aplicadas:
//   - D-01 (Phase 17): subprocess real spawneando `bin/kodo`, NO import
//     directo de `resolveSessionIdFromTaskId` (eso ya está cubierto por
//     test/logs-session-of.test.js a nivel unit). Aquí ejercemos el path
//     completo subprocess+CLI+resolver+reader.
//   - D-02 (Phase 17) + CR-02 (Phase 16): aislamiento HOME via mkdtempSync +
//     `process.env.HOME = tmpHome` ANTES del dynamic import de state.js (que
//     calcula KODO_DIR al import-time). El child del spawnSync recibe
//     `env: { HOME: tmpHome }` explícito — doble defensa runner+child.
//   - D-12 (Phase 17): cuatro escenarios — `step-1 hit`, `step-2 hit`,
//     `not-found`, `state-points-to-missing-log`.
//   - D-13 (Phase 17): exit codes observados desde el comportamiento ACTUAL
//     del CLI (no rediseñar). Documentados en `interfaces` del PLAN.md.
//   - D-14 (Phase 17): multi-match (D-21 LOG-11) FUERA de scope; cada test
//     seedea como mucho UN log file por escenario.
//
// Cleanup robusto:
//   - `before`: mkdtempSync + HOME override + mkdir ~/.kodo + dynamic import.
//   - `after`: restaurar HOME + rmSync recursive del tmpdir.
//   - `afterEach`: reset state.json a `{sessions:{}}` y borrado de logs/
//     para aislamiento entre escenarios (T-17-03-02 mitigation).
//

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

// Resueltos en `before` después de fijar HOME (CR-02 Phase 16: state.js
// calcula KODO_DIR al import-time desde homedir()).
let tmpHome;
let origHome;
let addSession;

/**
 * Spawna `bin/kodo logs --session-of <task-id>` con HOME aislado.
 * Síncrono: los 4 escenarios son request/response, sin streaming → spawnSync
 * es más simple que spawn+await-exit, suficiente para el contrato.
 *
 * @param {string} taskId
 * @returns {ReturnType<typeof spawnSync>}
 */
function runSessionOf(taskId) {
  return spawnSync(
    process.execPath,
    [KODO_BIN, 'logs', '--session-of', taskId],
    {
      cwd: REPO,
      env: { ...process.env, HOME: tmpHome },
      encoding: 'utf-8',
      timeout: 5000, // T-17-03-03 DoS mitigation
    },
  );
}

/**
 * Seedea `<tmpHome>/.kodo/logs/<sessionId>.ndjson` con head-line +
 * 1 línea body-<sessionId>. La head-line cumple el contrato del resolver
 * (event === 'session.start' && task_id === <expected>); la 2ª línea
 * permite al test assertear que runLogs llegó a hacer dump del archivo.
 *
 * @param {string} sessionId
 * @param {object} headRecord  Head-line: el resolver matchea por
 *   event/task_id; `level`/`msg`/`timestamp` se incluyen para que formatLine
 *   no produzca tokens raros en stdout.
 */
function seedLogFile(sessionId, headRecord) {
  const dir = join(tmpHome, '.kodo', 'logs');
  mkdirSync(dir, { recursive: true });
  const head = JSON.stringify(headRecord) + '\n';
  // Body line: distinguible por session_id en el msg para el assert match.
  const body =
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      session_id: sessionId,
      event: 'log.line',
      msg: 'body-' + sessionId,
    }) + '\n';
  writeFileSync(join(dir, sessionId + '.ndjson'), head + body);
}

describe('UAT-03 SC#3: kodo logs --session-of E2E (D-12 four scenarios)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-uat-session-of-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME — garantiza que KODO_DIR del módulo cacheado
    // resuelve al tmpdir aislado. Cualquier import transitivo posterior
    // recibe la misma instancia cacheada (CR-02 Phase 16).
    const stateMod = await import('../src/session/state.js');
    addSession = stateMod.addSession;
  });

  after(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Reset state.json a vacío + borrar logs/ para aislamiento cross-test
    // (T-17-03-02 tampering mitigation).
    writeFileSync(
      join(tmpHome, '.kodo', 'state.json'),
      JSON.stringify({ schema_version: 2, sessions: {} }) + '\n',
    );
    const logsDir = join(tmpHome, '.kodo', 'logs');
    rmSync(logsDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 1: state.json hit (step-1 del resolver)
  // -------------------------------------------------------------------------
  it('step-1 hit: state.json maps task_id → exit 0 + stdout contains log body', () => {
    const sessionId = 'uat03-step1-' + process.pid;
    const taskId = 'kodo-uat03-step1';
    const session = {
      session_id: sessionId,
      task_id: taskId,
      task_ref: 'KL-step1',
      gsd: false,
      status: 'running',
      provider: 'plane',
      project_id: 'p1',
      project_path: tmpHome,
      workspace_ref: 'workspace:1',
      started_at: new Date().toISOString(),
      summary: 'step1 hit',
    };
    addSession(taskId, session);
    seedLogFile(sessionId, {
      timestamp: session.started_at,
      level: 'info',
      session_id: sessionId,
      event: 'session.start',
      task_id: taskId,
      provider: 'plane',
      project_path: tmpHome,
      transcript_path: '/tmp/fake.jsonl',
      started_at: session.started_at,
      msg: 'session.start',
    });

    const result = runSessionOf(taskId);

    assert.equal(
      result.status,
      0,
      `step-1 hit should exit 0. status=${result.status} stderr=${result.stderr}`,
    );
    assert.match(
      result.stdout,
      /body-uat03-step1/,
      'stdout should contain log body line from dumped NDJSON',
    );
  });

  // -------------------------------------------------------------------------
  // Test 2: step-2 hit (state.json miss + head-line scan match)
  // -------------------------------------------------------------------------
  it('step-2 hit: state.json empty + log head-line matches task_id → exit 0 + stdout contains log body', () => {
    // afterEach ya dejó state.json = {sessions:{}}, NO addSession aquí.
    const sessionId = 'uat03-step2-' + process.pid;
    const taskId = 'kodo-uat03-step2';
    seedLogFile(sessionId, {
      timestamp: new Date().toISOString(),
      level: 'info',
      session_id: sessionId,
      event: 'session.start',
      task_id: taskId,
      provider: 'plane',
      project_path: tmpHome,
      transcript_path: '/tmp/fake.jsonl',
      started_at: new Date().toISOString(),
      msg: 'session.start',
    });

    const result = runSessionOf(taskId);

    assert.equal(
      result.status,
      0,
      `step-2 hit should exit 0. status=${result.status} stderr=${result.stderr}`,
    );
    assert.match(
      result.stdout,
      new RegExp('body-' + sessionId),
      'stdout should contain log body line from dumped NDJSON',
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: not-found (ni state.json ni log scan resuelven)
  // -------------------------------------------------------------------------
  it('not-found: no state.json entry + no log head-line match → exit 1 + stderr "No session found for task"', () => {
    // afterEach asegura state.json vacío y logs/ borrado.
    const result = runSessionOf('kodo-uat03-doesnotexist');

    assert.equal(
      result.status,
      1,
      `not-found should exit 1. status=${result.status} stderr=${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /No session found for task kodo-uat03-doesnotexist/,
      'stderr should mention task id missing',
    );
  });

  // -------------------------------------------------------------------------
  // Test 4: state-points-to-missing-log (D-13: descubrir comportamiento real)
  // -------------------------------------------------------------------------
  it('state-points-to-missing-log: state.json maps task_id → sessionId but <sid>.ndjson absent → exit 1 + stderr "No log file at"', () => {
    const sessionId = 'uat03-orphan-' + process.pid;
    const taskId = 'kodo-uat03-orphan';
    const session = {
      session_id: sessionId,
      task_id: taskId,
      task_ref: 'KL-orphan',
      gsd: false,
      status: 'running',
      provider: 'plane',
      project_id: 'p1',
      project_path: tmpHome,
      workspace_ref: 'workspace:1',
      started_at: new Date().toISOString(),
      summary: 'orphan',
    };
    addSession(taskId, session);
    // NO seedLogFile — log file ausente intencionalmente.

    const result = runSessionOf(taskId);

    // D-13: comportamiento observado del CLI actual.
    //   - resolver step-1 retorna sessionId desde state.json.
    //   - runLogs (src/logs/reader.js:113-116) verifica `existsSync(filePath)`
    //     antes del readFileSync; si no existe → stderr "No log file at <path>"
    //     + process.exit(1).
    // Asserts contra ese contrato concreto, NO contra una bandera genérica.
    assert.equal(
      result.status,
      1,
      `D-13: missing-log should exit 1 per current reader.js contract. status=${result.status} stderr=${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /No log file at /,
      'D-13: stderr should match the canonical "No log file at <path>" message emitted by runLogs',
    );
    assert.match(
      result.stderr,
      new RegExp(sessionId + '\\.ndjson'),
      'D-13: stderr should reference the resolved sessionId.ndjson path (proves resolver step-1 actually resolved the sid)',
    );
  });

  // -------------------------------------------------------------------------
  // D-14 NOTE: multi-match queda fuera de scope. NO seedeamos 2+ logs con el
  // mismo task_id en ningún test. Si en el futuro el resolver añade
  // comportamiento multi-match (warn stderr + escoger más reciente), los 4
  // tests siguen pasando porque cada uno seedea un único match.
  // -------------------------------------------------------------------------
});
