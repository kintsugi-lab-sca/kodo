// @ts-check
//
// test/integration/integrate-require-audit.test.js — KODO-74: el gate opcional del audit gate.
//
// El arnés es el hermano del de `integrate-require-oracle.test.js` (mismos stubs de
// git/store/logger), y aquí solo se ejercita el eje que la flag añade.
//
// Lo que se congela:
//   - SIN la flag, nada cambia: una rama sin auditar se integra igual y no se paga ni un
//     `rev-parse` extra. Es la propiedad que impide que este gate acabe apagado.
//   - CON la flag, el gate cierra en los tres estados que NO son «auditado sobre esto»: sin
//     gate, con reto abierto, y con una auditoría DESFASADA respecto a la punta de la rama.
//   - `--drop` NUNCA se gatea: es la única acción que no hace avanzar la rama.
//   - Las dos señales conviven en el listado: el veredicto del oráculo y el del audit gate son
//     ortogonales y se leen JUNTAS.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runIntegrateActionCli, runIntegrateListCli, auditCell } from '../../src/cli/integrate.js';
import { createFormatter } from '../../src/cli/format.js';

const plainFormatter = () => createFormatter({ isTTY: false }, {});
const HEAD = 'c'.repeat(40);

/** @param {object} [o] */
function audit(o = {}) {
  return {
    status: 'audited',
    count: 1,
    fingerprint: 'a'.repeat(64),
    evidence: 'artifact',
    findings: 0,
    commit: HEAD,
    challenge_commit: HEAD,
    base_commit: null,
    opened_at: '2026-09-03T08:00:00.000Z',
    audited_at: '2026-09-03T09:00:00.000Z',
    ...o,
  };
}

function entry(overrides = {}) {
  return {
    task_ref: 'KODO-74',
    task_id: 'uuid-74',
    project_path: '/repo/kodo',
    branch: 'worktree-abc',
    base_branch: 'main',
    commits_ahead: 3,
    base_ok: true,
    files_changed: 2,
    lines_changed: 40,
    suggested: 'merge',
    status: 'pending',
    created_at: '2026-09-03T08:00:00.000Z',
    updated_at: '2026-09-03T08:00:00.000Z',
    action: null,
    sha: null,
    outcome: null,
    resolved_at: null,
    oracle: null,
    audit: null,
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

describe('auditCell — la columna del listado', () => {
  it('`—` cuando nadie corrió el gate, y NO se parece a un visto bueno', () => {
    assert.equal(auditCell(null), '—');
    assert.equal(auditCell(undefined), '—');
  });

  it('los tres estados son distinguibles de un vistazo', () => {
    assert.equal(auditCell(audit({ status: 'pending', count: 2 })), '…2');
    assert.equal(auditCell(audit({ count: 1 })), '✓1');
    assert.equal(auditCell(audit({ count: 3 })), '✓3', 'el contador ES la señal');
  });

  it('un contador corrupto no rompe la celda', () => {
    assert.equal(auditCell(audit({ count: /** @type {any} */ ('x') })), '✓1');
    assert.equal(auditCell(audit({ count: 0 })), '✓1');
  });

  it('la columna aparece JUNTO a la del oráculo, no en su lugar', () => {
    const out = [];
    const code = runIntegrateListCli({}, {
      listFn: () => [entry({ audit: audit({ count: 2 }) })],
      writeFn: (s) => out.push(s),
      errFn: () => {},
      formatterFn: plainFormatter,
      nowFn: () => new Date('2026-09-03T12:00:00.000Z'),
    });
    assert.equal(code, 0);
    const t = out.join('');
    assert.match(t, /oráculo/);
    assert.match(t, /audit/);
    assert.match(t, /—/, 'el oráculo sin correr sigue viéndose');
    assert.match(t, /✓2/, 'y el audit gate al lado');
  });
});

describe('SIN --require-audit — el default no bloquea NUNCA', () => {
  it('una rama SIN auditar se integra igual', async () => {
    const h = harness({ found: entry({ audit: null }) });
    const code = await runIntegrateActionCli('KODO-74', { merge: true }, h.deps);
    assert.equal(code, 0);
    assert.equal(h.resolveCalls.length, 1, 'la entrada se resolvió: la acción ocurrió');
  });

  it('una rama con un reto ABIERTO se integra igual', async () => {
    const h = harness({ found: entry({ audit: audit({ status: 'pending', count: 3 }) }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true }, h.deps), 0);
  });

  it('no se paga ni un `rev-parse` extra por el gate apagado', async () => {
    const h = harness({ found: entry({ audit: null }) });
    await runIntegrateActionCli('KODO-74', { merge: true }, h.deps);
    const anchors = h.gitCalls.filter((c) => c.includes('worktree-abc^{commit}'));
    assert.equal(anchors.length, 0);
  });
});

describe('CON --require-audit — los tres estados que NO son «auditado sobre esto»', () => {
  it('sin gate: bloquea. SIN AUDITAR no es un visto bueno', async () => {
    const h = harness({ found: entry({ audit: null }) });
    const code = await runIntegrateActionCli('KODO-74', { merge: true, requireAudit: true }, h.deps);
    assert.equal(code, 1);
    assert.equal(h.outcome(), 'audit-missing');
    assert.equal(h.resolveCalls.length, 0, 'un gate que cierra NO resuelve la entrada');
    assert.match(h.stderr(), /kodo audit/);
  });

  it('con reto ABIERTO: bloquea, y dice cuántos retos hubo', async () => {
    const h = harness({ found: entry({ audit: audit({ status: 'pending', count: 3 }) }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true, requireAudit: true }, h.deps), 1);
    assert.equal(h.outcome(), 'audit-pending');
    assert.match(h.stderr(), /\(3\)/);
  });

  it('DESFASADO: se auditó otro commit, así que no vale aunque diga auditado', async () => {
    const h = harness({ found: entry({ audit: audit({ commit: 'f'.repeat(40) }) }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true, requireAudit: true }, h.deps), 1);
    assert.equal(h.outcome(), 'audit-stale');
    assert.match(h.stderr(), /no los ha leído nadie/);
  });

  it('sin punta legible: fail-CLOSED — el operador pidió que no se integrara sin auditar', async () => {
    const git = (args) => {
      if (args.includes('worktree-abc^{commit}')) return new Error('ref desconocida');
      return cleanRepo(args);
    };
    const h = harness({ found: entry({ audit: audit() }), git });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true, requireAudit: true }, h.deps), 1);
    assert.equal(h.outcome(), 'audit-unanchored');
  });

  it('auditado y anclado a la punta: pasa', async () => {
    const h = harness({ found: entry({ audit: audit() }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true, requireAudit: true }, h.deps), 0);
    assert.equal(h.resolveCalls.length, 1);
  });

  it('`--drop` NO se gatea: la salida de emergencia sigue disponible', async () => {
    const h = harness({ found: entry({ audit: null }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { drop: true, requireAudit: true }, h.deps), 0);
    assert.equal(h.resolveCalls[0].patch.action, 'drop');
  });
});

describe('las dos flags juntas — el oráculo primero', () => {
  it('con el oráculo en fail y sin auditar, se reporta el fallo MECÁNICO', async () => {
    const oracle = {
      state: 'done', verdict: 'fail', commit: HEAD,
      checks: { build: { status: 'skip', detail: null, ms: null }, tests: { status: 'fail', detail: 'x', ms: 1 }, lint: { status: 'skip', detail: null, ms: null }, schema: { status: 'skip', detail: null, ms: null }, scope: { status: 'skip', detail: null, ms: null } },
      started_at: '2026-09-03T08:00:00.000Z', finished_at: '2026-09-03T08:01:00.000Z',
    };
    const h = harness({ found: entry({ oracle, audit: null }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true, requireOracle: true, requireAudit: true }, h.deps), 1);
    assert.equal(h.outcome(), 'oracle-failed', 'primero el que se arregla con un comando');
  });

  it('con el oráculo en pass y sin auditar, se reporta el audit gate', async () => {
    const oracle = {
      state: 'done', verdict: 'pass', commit: HEAD,
      checks: { build: { status: 'pass', detail: null, ms: 1 }, tests: { status: 'pass', detail: null, ms: 1 }, lint: { status: 'skip', detail: null, ms: null }, schema: { status: 'skip', detail: null, ms: null }, scope: { status: 'skip', detail: null, ms: null } },
      started_at: '2026-09-03T08:00:00.000Z', finished_at: '2026-09-03T08:01:00.000Z',
    };
    const h = harness({ found: entry({ oracle, audit: null }) });
    assert.equal(await runIntegrateActionCli('KODO-74', { merge: true, requireOracle: true, requireAudit: true }, h.deps), 1);
    assert.equal(h.outcome(), 'audit-missing', 'compila y pasa los tests, pero nadie lo releyó');
  });
});
