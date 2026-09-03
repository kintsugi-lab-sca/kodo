// @ts-check
//
// test/integration/integrate-require-oracle.test.js — KODO-69: el gate opcional del oráculo.
//
// El arnés es el hermano del de `integrate-cli.test.js` (mismos stubs de git/store/logger), y
// aquí solo se ejercita el eje que la flag añade.
//
// Lo que se congela:
//   - SIN la flag, nada cambia: un `fail` del oráculo NO impide integrar, y no se paga ni un
//     `rev-parse` extra. Es la propiedad que impide que este gate acabe apagado.
//   - CON la flag, el gate cierra en `fail`, en `unknown`, sin oráculo, en curso, y con un
//     veredicto DESFASADO respecto a la punta de la rama.
//   - `--drop` NUNCA se gatea: es la única acción que no hace avanzar la rama, y gatearla
//     dejaría al operador sin salida para una rama que el oráculo no sabe verificar.
//   - Un gate que cierra NO resuelve la entrada y NO toca git más allá del `rev-parse` del ancla.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runIntegrateActionCli, runIntegrateListCli, oracleCell } from '../../src/cli/integrate.js';
import { createFormatter } from '../../src/cli/format.js';
import { CHECK_KEYS } from '../../src/integration/oracle.js';

const plainFormatter = () => createFormatter({ isTTY: false }, {});
const HEAD = 'c'.repeat(40);

/**
 * @param {{ verdict?: string, state?: string, commit?: string|null, statuses?: Record<string,string> }} [o]
 */
function oracle(o = {}) {
  const statuses = o.statuses || {};
  return {
    state: o.state || 'done',
    verdict: o.verdict || 'pass',
    commit: o.commit === undefined ? HEAD : o.commit,
    checks: Object.fromEntries(CHECK_KEYS.map((k) => [k, { status: statuses[k] || 'skip', detail: null, ms: 1 }])),
    started_at: '2026-09-02T10:00:00.000Z',
    finished_at: '2026-09-02T10:01:00.000Z',
  };
}

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

/** Repo limpio, en la rama base, con la rama de la entrada apuntando a HEAD. */
const cleanRepo = (args) => {
  if (args === 'status --porcelain') return '';
  if (args === 'branch --show-current') return 'main';
  if (args.includes('worktree-abc^{commit}')) return HEAD;
  if (args.startsWith('rev-parse --verify')) return 'cafe1234';
  if (args === 'rev-parse HEAD') return 'abcdef1234567890';
  return '';
};

function harness({ found = entry(), git = cleanRepo } = {}) {
  const out = [];
  const errs = [];
  const gitCalls = [];
  const resolveCalls = [];
  const events = [];
  const logger = {
    debug() {}, info: (m, meta) => events.push({ m, meta }), warn: (m, meta) => events.push({ m, meta }),
    error() {}, child() { return logger; },
  };
  const deps = {
    findFn: () => found,
    resolveFn: (ref, patch) => { resolveCalls.push({ ref, patch }); return { ok: true, value: { ...entry(), ...patch } }; },
    gitFn: (cwd, args) => {
      gitCalls.push(args.join(' '));
      const r = git(args.join(' '), cwd);
      if (r instanceof Error) throw r;
      return r ?? '';
    },
    loggerFn: () => logger,
    writeFn: (s) => out.push(s),
    errFn: (s) => errs.push(s),
    formatterFn: plainFormatter,
  };
  return {
    deps, gitCalls, resolveCalls,
    stdout: () => out.join(''),
    stderr: () => errs.join(''),
    outcome: () => events.find((e) => e.meta?.event === 'integrate.action')?.meta?.outcome,
  };
}

describe('oracleCell — la columna del listado', () => {
  it('`—` cuando el oráculo no ha corrido, y NO se parece a un `pass`', () => {
    assert.equal(oracleCell(null), '—');
    assert.equal(oracleCell(undefined), '—');
  });

  it('los tres veredictos y la corrida en curso son distinguibles', () => {
    assert.equal(oracleCell(oracle({ verdict: 'pass' })), 'pass');
    assert.equal(oracleCell(oracle({ verdict: 'fail' })), 'fail');
    assert.equal(oracleCell(oracle({ verdict: 'unknown' })), '?');
    assert.equal(oracleCell(oracle({ state: 'running', verdict: 'unknown' })), '…');
  });

  it('la columna aparece en el listado JUNTO a `sugerido`, no en su lugar', () => {
    const out = [];
    const code = runIntegrateListCli({}, {
      listFn: () => [entry({ oracle: oracle({ verdict: 'fail' }) })],
      writeFn: (s) => out.push(s),
      errFn: () => {},
      formatterFn: plainFormatter,
      nowFn: () => new Date('2026-09-02T12:00:00.000Z'),
    });
    assert.equal(code, 0);
    const t = out.join('');
    assert.match(t, /sugerido/);
    assert.match(t, /oráculo/);
    assert.match(t, /merge/, 'la sugerencia sigue estando');
    assert.match(t, /fail/, 'y el veredicto del oráculo al lado');
  });
});

describe('SIN --require-oracle — el default no bloquea NUNCA', () => {
  it('un oráculo en `fail` no impide integrar', async () => {
    const h = harness({ found: entry({ oracle: oracle({ verdict: 'fail', statuses: { tests: 'fail' } }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true }, h.deps), 0);
    assert.equal(h.resolveCalls.length, 1);
  });

  it('no se paga ni una llamada a git de más (el ancla solo se lee con la flag)', async () => {
    const h = harness({ found: entry({ oracle: oracle() }) });
    await runIntegrateActionCli('KODO-69', { merge: true }, h.deps);
    assert.equal(h.gitCalls.some((c) => c.includes('worktree-abc^{commit}')), false);
  });
});

describe('CON --require-oracle — cierra en los cinco casos que no son un pass anclado', () => {
  it('SIN oráculo → aborta, no resuelve la entrada y nombra el comando que lo corre', async () => {
    const h = harness({ found: entry({ oracle: null }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true, requireOracle: true }, h.deps), 1);
    assert.deepEqual(h.resolveCalls, [], 'un gate cerrado jamás saca la entrada de pending');
    assert.equal(h.outcome(), 'oracle-missing');
    assert.match(h.stderr(), /kodo oracle run KODO-69/);
    assert.equal(h.gitCalls.some((c) => c.startsWith('merge')), false, 'no toca git de mutación');
  });

  it('oráculo EN CURSO → aborta (una corrida empezada no ha verificado nada)', async () => {
    const h = harness({ found: entry({ oracle: oracle({ state: 'running', verdict: 'unknown' }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { ff: true, requireOracle: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-running');
  });

  it('veredicto `fail` → aborta y NOMBRA los checks que fallaron', async () => {
    const h = harness({ found: entry({ oracle: oracle({ verdict: 'fail', statuses: { tests: 'fail', scope: 'fail' } }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true, requireOracle: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-failed');
    assert.match(h.stderr(), /tests/);
    assert.match(h.stderr(), /scope/);
  });

  it('veredicto `unknown` → TAMBIÉN aborta: no verificado no es verde', async () => {
    const h = harness({ found: entry({ oracle: oracle({ verdict: 'unknown' }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true, requireOracle: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-unknown');
  });

  it('veredicto `pass` DESFASADO respecto a la punta → aborta igual', async () => {
    const h = harness({ found: entry({ oracle: oracle({ verdict: 'pass', commit: 'a'.repeat(40) }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true, requireOracle: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-stale');
    assert.match(h.stderr(), /vuelve a correrlo/);
  });

  it('punta de rama ilegible → fail-CLOSED: sin ancla no hay veredicto que valga', async () => {
    const h = harness({
      found: entry({ oracle: oracle({ verdict: 'pass' }) }),
      git: (args) => (args.includes('worktree-abc^{commit}') ? new Error('fatal: bad revision') : cleanRepo(args)),
    });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true, requireOracle: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-unanchored');
  });

  it('veredicto `pass` ANCLADO en la punta → deja pasar y el merge ocurre', async () => {
    const h = harness({ found: entry({ oracle: oracle({ verdict: 'pass', statuses: { tests: 'pass' } }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { merge: true, requireOracle: true }, h.deps), 0);
    assert.ok(h.gitCalls.some((c) => c.startsWith('merge --no-ff')));
    assert.equal(h.resolveCalls.length, 1);
  });

  it('también gatea `--pr`, que también hace avanzar la rama', async () => {
    const h = harness({ found: entry({ oracle: null }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { pr: true, requireOracle: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-missing');
    assert.equal(h.stdout().includes('gh pr create'), false, 'no llega a preparar nada');
  });

  it('NUNCA gatea `--drop`: es la única acción que no hace avanzar la rama', async () => {
    const h = harness({ found: entry({ oracle: oracle({ verdict: 'fail' }) }) });
    assert.equal(await runIntegrateActionCli('KODO-69', { drop: true, requireOracle: true }, h.deps), 0);
    assert.equal(h.resolveCalls[0].patch.action, 'drop');
    assert.deepEqual(h.gitCalls, [], '--drop no toca git ni con la flag puesta');
  });
});
