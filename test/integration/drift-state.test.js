// @ts-check
//
// test/integration/drift-state.test.js — KODO-101: el refresco de deriva sobre un state.json real.
//
// AISLAMIENTO DEL HOME OBLIGATORIO (ver `queue.test.js`): NINGÚN import estático de `src/`.
// `state.js` deriva la ruta de state.json del HOME en module-load, así que todo se importa en
// `before()`, después de apuntar HOME a un directorio temporal.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OLD = 'bade98f'.padEnd(40, '0');
const NEW = 'c1d7486'.padEnd(40, '0');

function entry(overrides = {}) {
  return {
    task_ref: 'ITCLIP-169', task_id: 'uuid-169', project_path: '/repo/itclip', branch: 'worktree-169',
    base_branch: 'main', commits_ahead: 5, base_ok: true, files_changed: 4, lines_changed: 120,
    suggested: 'merge', status: 'pending',
    created_at: '2026-09-17T14:34:00.000Z', updated_at: '2026-09-17T14:34:00.000Z',
    action: null, sha: null, outcome: null, resolved_at: null,
    oracle: { state: 'done', verdict: 'pass', commit: OLD, checks: {}, started_at: null, finished_at: null },
    audit: {
      status: 'audited', count: 1, fingerprint: 'a'.repeat(64), evidence: 'artifact', findings: 0,
      commit: OLD, challenge_commit: OLD, base_commit: null, opened_at: null, audited_at: null,
    },
    head: OLD,
    ...overrides,
  };
}

/** Stub de git: la rama de la entrada en `tip`, 7 commits por delante, dos ficheros. */
function makeGit(tip) {
  const calls = [];
  const gitFn = (cwd, args) => {
    const a = args.join(' ');
    calls.push(a);
    if (a.includes('^{commit}')) return tip;
    if (a.includes('rev-list --count') && a.includes('--not')) return '7';
    if (a.includes('rev-list --count')) return '0';
    if (a.startsWith('diff --numstat')) return '10\t40\tsrc/a.js\n1\t1\tsrc/b.js';
    return '';
  };
  return { gitFn, calls };
}

describe('refresco de deriva sobre state.json', () => {
  let tmpHome;
  let origHome;
  let queue;
  let drift;
  let cli;

  const statePath = () => join(tmpHome, '.kodo', 'state.json');
  const seed = (q) => writeFileSync(
    statePath(),
    JSON.stringify({ schema_version: 3, sessions: {}, history: [], integration_queue: q }, null, 2) + '\n',
  );
  const rawQueue = () => JSON.parse(readFileSync(statePath(), 'utf-8')).integration_queue;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-drift-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    queue = await import('../../src/integration/queue.js');
    drift = await import('../../src/integration/drift.js');
    cli = await import('../../src/cli/integrate.js');
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => seed([entry()]));

  it('HEAD igual al sellado → ni re-mide ni escribe', async () => {
    const before = readFileSync(statePath(), 'utf-8');
    const { gitFn, calls } = makeGit(OLD);
    const r = await drift.refreshIfMoved({ entry: rawQueue()[0], gitFn });
    assert.equal(r.moved, false);
    assert.deepEqual(calls.filter((c) => !c.includes('^{commit}')), [], 'solo el rev-parse');
    assert.equal(readFileSync(statePath(), 'utf-8'), before, 'state.json intacto');
  });

  it('HEAD distinto → recuento nuevo, `head` y `updated_at`; oráculo y auditoría se conservan', async () => {
    const { gitFn } = makeGit(NEW);
    const r = await drift.refreshIfMoved({
      entry: rawQueue()[0], gitFn, now: () => new Date('2026-09-17T15:21:00.000Z'),
    });
    assert.deepEqual(r, { moved: true, from: OLD, to: NEW, refreshed: true });

    const [e] = rawQueue();
    assert.equal(e.head, NEW);
    assert.equal(e.commits_ahead, 7);
    assert.equal(e.files_changed, 2);
    assert.equal(e.lines_changed, 52);
    assert.equal(e.updated_at, '2026-09-17T15:21:00.000Z');
    assert.equal(e.created_at, '2026-09-17T14:34:00.000Z', 'la edad de la espera no se rejuvenece');
    assert.equal(e.audit.commit, OLD, 'la auditoría se conserva…');
    assert.equal(cli.auditCell(e.audit, e.head), '✓1↑', '…y se lee como desfasada');
    assert.equal(cli.oracleCell(e.oracle, e.head), 'pass↑');
  });

  it('el listado tras el refresco dice la verdad: 7 commits y `✓1↑`', async () => {
    await drift.refreshIfMoved({ entry: rawQueue()[0], gitFn: makeGit(NEW).gitFn });
    const out = [];
    cli.runIntegrateListCli({}, {
      writeFn: (s) => out.push(s),
      errFn: () => {},
      formatterFn: () => ({ dim: (s) => s, formatTable: (rows) => rows.map((r) => r.join(' | ')).join('\n') }),
      nowFn: () => new Date('2026-09-17T15:25:00.000Z'),
    });
    const text = out.join('');
    assert.match(text, /ITCLIP-169 \| worktree-169 \| 7 \|/);
    assert.match(text, /✓1↑/);
  });

  it('una captura que se adelantó gana: el parche llega `superseded` y no pisa nada', () => {
    const r = queue.refreshBranchHead(entry(), 'f'.repeat(40), {
      head: NEW, commits_ahead: 9, base_ok: true, files_changed: 1, lines_changed: 1, suggested: 'ff',
    });
    assert.deepEqual(r, { ok: false, reason: 'superseded' });
    assert.equal(rawQueue()[0].commits_ahead, 5);
  });

  it('el barrido recorre solo las pending y cuenta las que se movieron', async () => {
    seed([
      entry(),
      entry({ branch: 'otra', head: NEW }),
      entry({ branch: 'resuelta', status: 'done' }),
    ]);
    const stats = await drift.runDriftSweep({ gitFn: makeGit(NEW).gitFn });
    assert.deepEqual(stats, { checked: 2, moved: 1 });
  });
});
