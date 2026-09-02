// @ts-check
//
// test/integration/oracle-cli.test.js — KODO-69: `kodo oracle` (listado + detalle + corrida).
//
// TODO por DI: el store, git, el config y la corrida son stubs, así que ningún caso toca un
// repo real ni el `~/.kodo/state.json` del operador.
//
// Lo que se congela aquí es el contrato observable del comando:
//   - el LISTADO no hace UNA sola llamada a git ni ejecuta nada (la ronda del orquestador jamás
//     corre suites);
//   - `run` escribe DOS veces: el marcador `running` ANTES y el resultado DESPUÉS;
//   - el exit code NO refleja el veredicto (un `fail` que se registra bien sale con 0);
//   - `--json` es determinista y no lleva ANSI.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOracleListCli,
  runOracleStatusCli,
  runOracleRunCli,
  checkGlyph,
  summarizeChecks,
  verdictLabel,
} from '../../src/cli/oracle.js';
import { createFormatter } from '../../src/cli/format.js';
import { CHECK_KEYS } from '../../src/integration/oracle.js';

/** Formatter sin color: los asserts comparan texto, no secuencias ANSI. */
const plainFormatter = () => createFormatter({ isTTY: false }, {});

/**
 * Bloque `oracle` de mentira con los cinco checks.
 * @param {{ verdict?: string, state?: string, statuses?: Record<string,string>, commit?: string|null }} [o]
 */
function oracle(o = {}) {
  const statuses = o.statuses || {};
  return {
    state: o.state || 'done',
    verdict: o.verdict || 'pass',
    commit: o.commit === undefined ? 'c'.repeat(40) : o.commit,
    checks: Object.fromEntries(CHECK_KEYS.map((k) => [k, {
      status: statuses[k] || 'skip',
      detail: null,
      ms: 12,
    }])),
    started_at: '2026-09-02T10:00:00.000Z',
    finished_at: '2026-09-02T10:01:00.000Z',
  };
}

/** Entrada pendiente canónica de la cola. */
function entry(overrides = {}) {
  return {
    task_ref: 'KODO-69',
    task_id: 'uuid-69',
    project_path: '/repo/kodo',
    branch: 'worktree-abc',
    base_branch: 'main',
    commits_ahead: 3,
    base_ok: true,
    files_changed: 2,
    lines_changed: 40,
    suggested: 'merge',
    status: 'pending',
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    action: null,
    sha: null,
    outcome: null,
    resolved_at: null,
    oracle: null,
    ...overrides,
  };
}

/** Arnés con captura de stdout/stderr y registro de las escrituras en la cola. */
function harness({ found = entry(), entries = [entry()], config = {}, runResult = null, attachResult = null } = {}) {
  const out = [];
  const errs = [];
  const gitCalls = [];
  const attached = [];
  const runCalls = [];
  const deps = {
    listFn: () => entries,
    findFn: () => found,
    attachFn: (ref, o) => {
      attached.push({ ref, oracle: o });
      return attachResult || { ok: true, value: { ...entry(), oracle: o } };
    },
    runOracleFn: async (args) => {
      runCalls.push(args);
      return runResult || oracle({ statuses: { tests: 'pass' } });
    },
    loadConfigFn: () => config,
    readPlanFn: () => null,
    gitFn: (cwd, args) => { gitCalls.push(args.join(' ')); return ''; },
    loggerFn: () => ({ info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }),
    writeFn: (s) => out.push(s),
    errFn: (s) => errs.push(s),
    formatterFn: plainFormatter,
    nowFn: () => new Date('2026-09-02T12:00:00.000Z'),
  };
  return { deps, out, errs, gitCalls, attached, runCalls, text: () => out.join(''), errText: () => errs.join('') };
}

describe('helpers de render — PUROS', () => {
  it('cada estado tiene su glifo, y `skip` NO se parece a `pass`', () => {
    assert.equal(checkGlyph('pass'), '✓');
    assert.equal(checkGlyph('fail'), '✗');
    assert.equal(checkGlyph('unknown'), '?');
    assert.equal(checkGlyph('skip'), '—');
    assert.equal(checkGlyph(undefined), '—');
  });

  it('el resumen sigue el orden de CHECK_KEYS', () => {
    const o = oracle({ statuses: { build: 'pass', tests: 'fail', lint: 'unknown', schema: 'skip', scope: 'pass' } });
    assert.equal(summarizeChecks(o), '✓✗?—✓');
  });

  it('sin oráculo el resumen es `—`: «no ha corrido» ≠ cinco `skip`', () => {
    assert.equal(summarizeChecks(null), '—');
    assert.equal(summarizeChecks(undefined), '—');
  });

  it('la etiqueta distingue «sin correr», «en curso» y los tres veredictos', () => {
    assert.equal(verdictLabel(null), 'sin correr');
    assert.equal(verdictLabel(oracle({ state: 'running', verdict: 'unknown' })), 'en curso');
    assert.equal(verdictLabel(oracle({ verdict: 'pass' })), 'pass');
    assert.equal(verdictLabel(oracle({ verdict: 'fail' })), 'fail');
    assert.equal(verdictLabel(oracle({ verdict: 'unknown' })), 'unknown');
  });
});

describe('kodo oracle — el LISTADO', () => {
  it('CERO llamadas a git y CERO ejecución: la ronda del orquestador nunca corre suites', () => {
    const h = harness({ entries: [entry({ oracle: oracle({ statuses: { tests: 'pass' } }) })] });
    assert.equal(runOracleListCli({}, h.deps), 0);
    assert.deepEqual(h.gitCalls, []);
    assert.deepEqual(h.runCalls, []);
  });

  it('pinta el veredicto, el resumen de checks y el commit anclado', () => {
    const h = harness({ entries: [entry({ oracle: oracle({ statuses: { tests: 'pass', scope: 'fail' }, verdict: 'fail' }) })] });
    runOracleListCli({}, h.deps);
    const t = h.text();
    assert.match(t, /KODO-69/);
    assert.match(t, /fail/);
    assert.match(t, /cccccccc/);
  });

  it('cola vacía → una línea y exit 0', () => {
    const h = harness({ entries: [] });
    assert.equal(runOracleListCli({}, h.deps), 0);
    assert.match(h.text(), /vacía/);
  });

  it('--json no instancia el formatter y sale determinista', () => {
    const h = harness({ entries: [entry({ oracle: oracle() })] });
    h.deps.formatterFn = () => assert.fail('--json no debe tocar el formatter');
    assert.equal(runOracleListCli({ json: true }, h.deps), 0);
    const parsed = JSON.parse(h.text());
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].task_ref, 'KODO-69');
    assert.deepEqual(Object.keys(parsed.entries[0]), ['task_ref', 'branch', 'project_path', 'oracle']);
  });

  it('un store que revienta NO convierte un listado en un exit distinto de 0', () => {
    const h = harness();
    h.deps.listFn = () => { throw new Error('state.json ilegible'); };
    assert.equal(runOracleListCli({}, h.deps), 0);
    assert.match(h.errText(), /no se pudo renderizar/);
  });
});

describe('kodo oracle <ref> — el DETALLE', () => {
  it('ref que no está pendiente → exit 2 y ninguna escritura', () => {
    const h = harness({ found: null });
    assert.equal(runOracleStatusCli('NO-EXISTE', {}, h.deps), 2);
    assert.deepEqual(h.attached, []);
  });

  it('lista los CINCO checks aunque el veredicto sea `pass` — «pass» no es «todo está bien»', () => {
    const h = harness({ found: entry({ oracle: oracle({ statuses: { tests: 'pass' } }) }) });
    assert.equal(runOracleStatusCli('KODO-69', {}, h.deps), 0);
    const t = h.text();
    for (const k of CHECK_KEYS) assert.match(t, new RegExp(k), `falta el check ${k}`);
  });

  it('sin oráculo dice que no ha corrido y NOMBRA el comando que lo corre', () => {
    const h = harness({ found: entry({ oracle: null }) });
    runOracleStatusCli('KODO-69', {}, h.deps);
    assert.match(h.text(), /kodo oracle run KODO-69/);
  });

  it('--json emite el bloque tal cual, sin ANSI', () => {
    const h = harness({ found: entry({ oracle: oracle() }) });
    h.deps.formatterFn = () => assert.fail('--json no debe tocar el formatter');
    assert.equal(runOracleStatusCli('KODO-69', { json: true }, h.deps), 0);
    const parsed = JSON.parse(h.text());
    assert.deepEqual(Object.keys(parsed.oracle), ['state', 'verdict', 'commit', 'checks', 'started_at', 'finished_at']);
  });
});

describe('kodo oracle run <ref> — la CORRIDA', () => {
  it('escribe DOS veces: el marcador `running` ANTES, el resultado DESPUÉS', async () => {
    const h = harness();
    assert.equal(await runOracleRunCli('KODO-69', {}, h.deps), 0);
    assert.equal(h.attached.length, 2);
    assert.equal(h.attached[0].oracle.state, 'running');
    assert.equal(h.attached[0].oracle.verdict, 'unknown', 'una corrida empezada no ha verificado nada');
    assert.equal(h.attached[1].oracle.state, 'done');
  });

  it('el exit code NO refleja el veredicto: un `fail` bien registrado sale con 0', async () => {
    const h = harness({ runResult: oracle({ verdict: 'fail', statuses: { tests: 'fail' } }) });
    assert.equal(await runOracleRunCli('KODO-69', {}, h.deps), 0);
    assert.match(h.text(), /fail/);
  });

  it('ref que no está pendiente → exit 2, sin marcador y sin corrida', async () => {
    const h = harness({ found: null });
    assert.equal(await runOracleRunCli('NO-EXISTE', {}, h.deps), 2);
    assert.deepEqual(h.attached, []);
    assert.deepEqual(h.runCalls, []);
  });

  it('oráculo apagado por config → exit 1 y NO se verifica nada', async () => {
    const h = harness({ config: { oracle: { enabled: false } } });
    assert.equal(await runOracleRunCli('KODO-69', {}, h.deps), 1);
    assert.deepEqual(h.runCalls, []);
    assert.deepEqual(h.attached, []);
  });

  it('pasa al runner el repo, la rama y la base de la ENTRADA', async () => {
    const h = harness();
    await runOracleRunCli('KODO-69', {}, h.deps);
    assert.equal(h.runCalls[0].project, '/repo/kodo');
    assert.equal(h.runCalls[0].branch, 'worktree-abc');
    assert.equal(h.runCalls[0].base, 'main');
  });

  it('resuelve los comandos DEL REPO de la entrada', async () => {
    const h = harness({
      config: { oracle: { repos: { '/repo/kodo': { tests: 'npm test' }, '/otro': { tests: 'pytest' } } } },
    });
    await runOracleRunCli('KODO-69', {}, h.deps);
    assert.equal(h.runCalls[0].commands.tests, 'npm test');
  });

  it('verificación hecha pero NO persistida → exit 1: no se miente sobre lo que hay en la cola', async () => {
    const h = harness({ attachResult: { ok: false, reason: 'lock-timeout' } });
    assert.equal(await runOracleRunCli('KODO-69', {}, h.deps), 1);
    assert.match(h.errText(), /no se pudo persistir/);
  });

  // REGRESIÓN: una tarea que tocó DOS repos en dos sesiones deja DOS entradas con el MISMO
  // `task_ref` (la identidad es (project_path, branch), no la ref). Si la escritura usara
  // `entry.task_ref` en vez del `ref` que el operador tecleó, `kodo oracle run <rama-B>`
  // verificaría la rama B y colgaría el veredicto de la entrada A — un `pass` sobre código que
  // nadie verificó.
  it('persiste con el MISMO selector con el que buscó, no con el task_ref de la entrada', async () => {
    const h = harness({ found: entry({ branch: 'worktree-del-segundo-repo', project_path: '/repo/otro' }) });
    await runOracleRunCli('worktree-del-segundo-repo', {}, h.deps);
    assert.equal(h.attached.length, 2);
    for (const a of h.attached) {
      assert.equal(a.ref, 'worktree-del-segundo-repo', 'el selector de escritura debe ser el de búsqueda');
    }
  });

  it('--json lleva el bloque entero y el flag de persistencia', async () => {
    const h = harness();
    assert.equal(await runOracleRunCli('KODO-69', { json: true }, h.deps), 0);
    const parsed = JSON.parse(h.text());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.task_ref, 'KODO-69');
    assert.equal(parsed.oracle.state, 'done');
  });
});
