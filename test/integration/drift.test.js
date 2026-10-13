// @ts-check
//
// test/integration/drift.test.js — KODO-101: la cola se entera de que la rama avanzó.
//
// Lo que se congela:
//   - Con la punta real IGUAL a la sellada, nada cambia: ni se re-mide, ni se reescribe la fila,
//     ni el listado gana una sola llamada a git.
//   - Con la punta real DISTINTA, el refresco re-describe la fila (recuento, `head`,
//     `updated_at`) y CONSERVA oráculo y auditoría, cuyo desfase se deriva de `commit ≠ head`.
//   - El listado distingue `✓1` de `✓1↑` (y `pass` de `pass↑`) sin tocar git.
//   - `kodo integrate <ref> --merge|--ff|--pr` se niega si la rama avanzó, nombra los dos SHA y
//     no resuelve la entrada.
//
// Los casos que escriben state.json viven en `drift-state.test.js`: aquí hay imports estáticos
// de `src/`, y `state.js` fija la ruta de state.json al HOME del momento en que carga.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runIntegrateActionCli, runIntegrateListCli, auditCell, oracleCell } from '../../src/cli/integrate.js';
import { createFormatter } from '../../src/cli/format.js';
import { CHECK_KEYS } from '../../src/integration/oracle.js';

const plainFormatter = () => createFormatter({ isTTY: false }, {});
const OLD = 'bade98f'.padEnd(40, '0');
const NEW = 'c1d7486'.padEnd(40, '0');

function audit(o = {}) {
  return {
    status: 'audited', count: 1, fingerprint: 'a'.repeat(64), evidence: 'artifact', findings: 0,
    commit: OLD, challenge_commit: OLD, base_commit: null,
    opened_at: '2026-09-17T14:00:00.000Z', audited_at: '2026-09-17T14:30:00.000Z',
    ...o,
  };
}

function oracle(o = {}) {
  return {
    state: 'done', verdict: 'pass', commit: OLD,
    checks: Object.fromEntries(CHECK_KEYS.map((k) => [k, { status: 'skip', detail: null, ms: 1 }])),
    started_at: '2026-09-17T14:35:00.000Z', finished_at: '2026-09-17T14:36:00.000Z',
    ...o,
  };
}

function entry(overrides = {}) {
  return {
    task_ref: 'ITCLIP-169', task_id: 'uuid-169', project_path: '/repo/itclip', branch: 'worktree-169',
    base_branch: 'main', commits_ahead: 5, base_ok: true, files_changed: 4, lines_changed: 120,
    suggested: 'merge', status: 'pending',
    created_at: '2026-09-17T14:34:00.000Z', updated_at: '2026-09-17T14:34:00.000Z',
    action: null, sha: null, outcome: null, resolved_at: null,
    oracle: oracle(), audit: audit(), head: OLD,
    ...overrides,
  };
}

/** Stub de git: repo limpio en `main`, rama de la entrada en `tip`, 7 commits por delante. */
function makeGit(tip) {
  const calls = [];
  const gitFn = (cwd, args) => {
    const a = args.join(' ');
    calls.push(a);
    if (a.includes('worktree-169^{commit}')) return tip instanceof Error ? (() => { throw tip; })() : tip;
    if (a === 'status --porcelain') return '';
    if (a === 'branch --show-current') return 'main';
    if (a.startsWith('rev-list --count worktree-169 --not')) return '7';
    if (a.startsWith('rev-list --count worktree-169..main')) return '0';
    if (a.startsWith('diff --numstat')) return '10\t40\tsrc/a.js\n1\t1\tsrc/b.js';
    if (a.startsWith('rev-parse --verify')) return 'cafe1234';
    if (a === 'rev-parse HEAD') return 'abcdef1234567890';
    return '';
  };
  return { gitFn, calls };
}

describe('celdas del listado — «auditado» vs «auditado sobre un HEAD anterior»', () => {
  it('audit sobre la punta descrita → `✓1`; sobre otra → `✓1↑`', () => {
    assert.equal(auditCell(audit(), OLD), '✓1');
    assert.equal(auditCell(audit(), NEW), '✓1↑');
  });

  it('sin `head` (entrada anterior a KODO-101) no se inventa el desfase', () => {
    assert.equal(auditCell(audit(), null), '✓1');
    assert.equal(oracleCell(oracle(), null), 'pass');
  });

  it('un reto abierto no lleva marca: no hay commit auditado que comparar', () => {
    assert.equal(auditCell(audit({ status: 'pending', commit: null, count: 2 }), NEW), '…2');
  });

  it('oráculo: `pass` / `pass↑` y `fail` / `fail↑`', () => {
    assert.equal(oracleCell(oracle(), OLD), 'pass');
    assert.equal(oracleCell(oracle(), NEW), 'pass↑');
    assert.equal(oracleCell(oracle({ verdict: 'fail' }), NEW), 'fail↑');
  });

  it('el listado pinta la marca y la leyenda solo cuando hay desfase, sin llamar a git', () => {
    const render = (e) => {
      const out = [];
      let gitCalls = 0;
      runIntegrateListCli({}, {
        listFn: () => [e],
        gitFn: () => { gitCalls++; return ''; },
        writeFn: (s) => out.push(s),
        errFn: () => {},
        formatterFn: plainFormatter,
        nowFn: () => new Date('2026-09-17T15:25:00.000Z'),
      });
      return { text: out.join(''), gitCalls };
    };
    const fresh = render(entry());
    assert.doesNotMatch(fresh.text, /↑/);
    assert.equal(fresh.gitCalls, 0);

    const moved = render(entry({ head: NEW, commits_ahead: 7 }));
    assert.match(moved.text, /✓1↑/);
    assert.match(moved.text, /pass↑/);
    assert.match(moved.text, /HEAD anterior/);
    assert.equal(moved.gitCalls, 0, 'el listado sigue siendo cero-git');
  });
});

describe('cinturón al actuar — `kodo integrate <ref> --merge|--ff|--pr`', () => {
  function harness(e, tip) {
    const out = [];
    const errs = [];
    const resolveCalls = [];
    const driftCalls = [];
    const events = [];
    const logger = {
      debug() {}, info: (m, meta) => events.push({ m, meta }), warn: (m, meta) => events.push({ m, meta }),
      error() {}, child() { return logger; },
    };
    const git = makeGit(tip);
    return {
      git, resolveCalls, driftCalls,
      stdout: () => out.join(''),
      stderr: () => errs.join(''),
      outcome: () => events.find((x) => x.meta?.event === 'integrate.action')?.meta?.outcome,
      deps: {
        findFn: () => e,
        resolveFn: (ref, patch) => { resolveCalls.push({ ref, patch }); return { ok: true, value: { ...e, ...patch } }; },
        gitFn: git.gitFn,
        driftFn: async (args) => { driftCalls.push(args); return { moved: true, from: OLD, to: args.head, refreshed: true }; },
        loggerFn: () => logger,
        writeFn: (s) => out.push(s),
        errFn: (s) => errs.push(s),
        formatterFn: plainFormatter,
      },
    };
  }

  for (const action of ['merge', 'ff', 'pr']) {
    it(`--${action} con la rama avanzada → se niega, nombra los dos SHA y no resuelve`, async () => {
      const h = harness(entry(), NEW);
      const code = await runIntegrateActionCli('ITCLIP-169', { [action]: true }, h.deps);
      assert.equal(code, 1);
      assert.equal(h.outcome(), 'branch-moved');
      assert.match(h.stderr(), /bade98f0/);
      assert.match(h.stderr(), /c1d74860/);
      assert.deepEqual(h.resolveCalls, [], 'la entrada sigue pendiente');
      assert.equal(h.git.calls.some((c) => c.startsWith('merge')), false, 'no se integra nada');
      assert.equal(h.driftCalls.length, 1, 'y la fila se re-describe para el siguiente listado');
      assert.equal(h.driftCalls[0].head, NEW, 'reutilizando la punta ya leída');
    });
  }

  it('entrada anterior a KODO-101 (sin `head`): el ancla es `audit.commit`', async () => {
    const h = harness(entry({ head: undefined }), NEW);
    assert.equal(await runIntegrateActionCli('ITCLIP-169', { merge: true }, h.deps), 1);
    assert.equal(h.outcome(), 'branch-moved');
  });

  it('con la punta IGUAL a la sellada, nada cambia: se integra con un solo rev-parse', async () => {
    const h = harness(entry(), OLD);
    assert.equal(await runIntegrateActionCli('ITCLIP-169', { merge: true }, h.deps), 0);
    assert.equal(h.driftCalls.length, 0);
    assert.equal(h.resolveCalls.length, 1);
    assert.equal(h.git.calls.filter((c) => c.includes('^{commit}')).length, 1);
  });

  it('punta ilegible: no se inventa el desfase (fail-open)', async () => {
    const h = harness(entry(), new Error('fatal: bad revision'));
    assert.equal(await runIntegrateActionCli('ITCLIP-169', { merge: true }, h.deps), 0);
    assert.equal(h.driftCalls.length, 0);
  });

  it('--drop no paga el cinturón: no toca git', async () => {
    const h = harness(entry(), NEW);
    assert.equal(await runIntegrateActionCli('ITCLIP-169', { drop: true }, h.deps), 0);
    assert.deepEqual(h.git.calls, []);
  });
});
