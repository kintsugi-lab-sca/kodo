// @ts-check
//
// test/integration/audit-cli.test.js — KODO-74: el handler de `kodo audit`.
//
// TODO por DI: `gitFn`, `cwdFn`, `loadStateFn`, los tres accesos al store y la lectura del
// artefacto entran por parámetro, así que estos casos no tocan git de verdad ni el
// `~/.kodo/state.json` del operador. La cobertura del store real (que sí aísla HOME) vive en
// `audit-gate.test.js`; la del núcleo puro, en `audit-core.test.js`.
//
// Lo que este fichero congela:
//   - el CONTRATO DE EXIT CODES, que es lo que hace el comando usable en un script: 0 auditado,
//     2 AUDIT_REQUIRED, 1 no se pudo determinar/persistir;
//   - que la primera invocación NO marca nada y la segunda sin evidencia TAMPOCO;
//   - que el fingerprint NO rota en un re-reto (si rotara, el artefacto recién escrito dejaría
//     de valer justo al presentarlo y el gate sería imposible de satisfacer);
//   - que la clave del reto sale de la SESIÓN y no de git, que es lo que hace que el veredicto
//     llegue a la cola cuando git resuelve symlinks y `state.json` no.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAuditCli, resolveSession, readGitFacts, auditArtifactPath } from '../../src/cli/audit.js';
import { createFormatter } from '../../src/cli/format.js';
import { shortFingerprint } from '../../src/integration/audit.js';

const plainFormatter = () => createFormatter({ isTTY: false }, {});

const PROJECT = '/repo/kodo';
const WORKTREE = '/repo/kodo/.claude/worktrees/sess-74';
const BRANCH = 'feat/audit';
const HEAD = 'b'.repeat(40);
const BASE = 'd'.repeat(40);

const SESSION = {
  workspace_ref: 'workspace:1',
  session_id: 'sess-74',
  task_id: 'uuid-74',
  task_ref: 'KODO-74',
  provider: 'plane',
  project_id: 'p1',
  summary: 'audit gate',
  status: 'running',
  started_at: '2026-09-03T07:00:00.000Z',
  project_path: PROJECT,
  branch: BRANCH,
  base_commit: BASE,
};

/** Repo sano: worktree de la sesión, rama con trabajo, árbol limpio. */
function healthyGit({ head = HEAD, dirty = '', branch = BRANCH, common = `${PROJECT}/.git` } = {}) {
  return (args) => {
    if (args.includes('--git-common-dir')) return common;
    if (args === 'rev-parse --show-toplevel') return WORKTREE;
    if (args === 'branch --show-current') return branch;
    if (args === 'rev-parse HEAD') return head;
    if (args === 'status --porcelain') return dirty;
    return '';
  };
}

/**
 * Arnés con store en memoria: `openGateFn`/`closeGateFn`/`readGateFn` se comportan como el store
 * real (mismo contrato de retorno) sin tocar disco.
 */
function harness({ git = healthyGit(), sessions = { 'uuid-74': SESSION }, artifact = null, gate = null } = {}) {
  const out = [];
  const errs = [];
  const gitCalls = [];
  let stored = gate;
  const opened = [];
  const closed = [];
  const artifactReads = [];
  const mkdirs = [];

  const deps = {
    cwdFn: () => WORKTREE,
    gitFn: (cwd, args) => {
      gitCalls.push(args.join(' '));
      const r = git(args.join(' '), cwd);
      if (r instanceof Error) throw r;
      return r ?? '';
    },
    loadStateFn: () => ({ schema_version: 3, sessions, history: [] }),
    readGateFn: () => stored,
    openGateFn: (input) => {
      opened.push(input);
      stored = {
        status: 'pending',
        count: (stored?.count || 0) + 1,
        fingerprint: input.fingerprint,
        evidence: null,
        findings: null,
        commit: null,
        challenge_commit: input.challenge_commit ?? null,
        base_commit: input.base_commit ?? null,
        opened_at: '2026-09-03T08:00:00.000Z',
        audited_at: null,
      };
      return { ok: true, value: stored };
    },
    closeGateFn: (target, patch) => {
      closed.push({ target, patch });
      if (!stored) return { ok: false, reason: 'not-found' };
      stored = { ...stored, status: 'audited', evidence: patch.evidence, findings: patch.findings ?? null, commit: patch.commit ?? null, audited_at: '2026-09-03T09:00:00.000Z' };
      return { ok: true, value: stored };
    },
    readArtifactFn: (p) => {
      artifactReads.push(p);
      return artifact;
    },
    // Stub del mkdir: sin él, emitir un reto crearía `~/.kodo/audits` en el HOME REAL.
    mkdirFn: (p) => { mkdirs.push(p); },
    writeFn: (s) => out.push(s),
    errFn: (s) => errs.push(s),
    formatterFn: plainFormatter,
    nowFn: () => new Date('2026-09-03T08:00:00.000Z'),
  };
  return {
    deps, gitCalls, opened, closed, artifactReads, mkdirs,
    gate: () => stored,
    stdout: () => out.join(''),
    stderr: () => errs.join(''),
  };
}

describe('kodo audit — la PRIMERA invocación no marca nada', () => {
  it('abre el reto, imprime AUDIT_REQUIRED y sale con 2', async () => {
    const h = harness();
    const code = await runAuditCli(null, {}, h.deps);
    assert.equal(code, 2, 'el gate NO está satisfecho: exit 2');
    assert.match(h.stdout(), /^AUDIT_REQUIRED/);
    assert.equal(h.opened.length, 1);
    assert.equal(h.closed.length, 0, 'nada se cierra en la primera invocación');
    assert.equal(h.gate()?.status, 'pending');
    assert.equal(h.gate()?.count, 1);
  });

  it('la clave del reto sale de la SESIÓN, no de lo que git resolvió', async () => {
    // git resuelve el symlink (`/private/repo/kodo`), `state.json` guarda `/repo/kodo`. Si el
    // reto se guardara bajo la forma de git, la captura no lo encontraría jamás.
    const h = harness({ git: healthyGit({ common: '/private/repo/kodo/.git' }) });
    await runAuditCli(null, {}, h.deps);
    assert.equal(h.opened[0].project_path, PROJECT);
    assert.equal(h.opened[0].branch, BRANCH);
  });

  it('el reto ancla el commit de apertura y la base de la sesión (§2.5)', async () => {
    const h = harness();
    await runAuditCli(null, {}, h.deps);
    assert.equal(h.opened[0].challenge_commit, HEAD);
    assert.equal(h.opened[0].base_commit, BASE);
    assert.match(h.stdout(), new RegExp(`git diff ${BASE}\\.\\.\\.HEAD`), 'con base, el comando exacto');
  });

  it('el texto nombra el artefacto donde firmar el «sin hallazgos», y su directorio existe', async () => {
    const h = harness();
    await runAuditCli(null, {}, h.deps);
    assert.match(h.stdout(), /audits\/uuid-74\.md/);
    assert.equal(h.mkdirs.length, 1, 'el reto no manda a escribir en un directorio que no existe');
    assert.match(h.mkdirs[0], /audits$/);
  });
});

describe('kodo audit — la SEGUNDA invocación exige algo distinto', () => {
  const pending = {
    status: 'pending', count: 1, fingerprint: 'a'.repeat(64), evidence: null, findings: null,
    commit: null, challenge_commit: HEAD, base_commit: BASE,
    opened_at: '2026-09-03T08:00:00.000Z', audited_at: null,
  };

  it('SIN nada nuevo: re-reta, sube el contador y NO cierra — no es un doble tecleo', async () => {
    const h = harness({ gate: pending });
    const code = await runAuditCli(null, {}, h.deps);
    assert.equal(code, 2);
    assert.equal(h.closed.length, 0);
    assert.equal(h.gate()?.status, 'pending');
    assert.equal(h.gate()?.count, 2);
    assert.match(h.stdout(), /reto 2/);
  });

  it('en el re-reto el fingerprint NO rota: el artefacto ya escrito sigue valiendo', async () => {
    const h = harness({ gate: { ...pending }, git: healthyGit({ dirty: ' M src/x.js' }) });
    await runAuditCli(null, {}, h.deps);
    assert.equal(h.opened[0].fingerprint, pending.fingerprint, 'mismo fingerprint pese al árbol movido');
    assert.equal(h.opened[0].challenge_commit, HEAD, 'y el listón del commit tampoco se mueve');
  });

  it('con COMMIT NUEVO: cierra por evidencia de commit y sale con 0', async () => {
    const h = harness({ gate: pending, git: healthyGit({ head: 'e'.repeat(40) }) });
    const code = await runAuditCli(null, {}, h.deps);
    assert.equal(code, 0);
    assert.equal(h.closed[0].patch.evidence, 'commit');
    assert.equal(h.closed[0].patch.commit, 'e'.repeat(40));
    assert.equal(h.gate()?.status, 'audited');
  });

  it('con ARTEFACTO firmado: cierra por artefacto, con los hallazgos declarados', async () => {
    const md = `<!-- kodo:audit v=1 fp=${shortFingerprint(pending.fingerprint)} findings=3 -->`;
    const h = harness({ gate: pending, artifact: md });
    const code = await runAuditCli(null, {}, h.deps);
    assert.equal(code, 0);
    assert.equal(h.closed[0].patch.evidence, 'artifact');
    assert.equal(h.closed[0].patch.findings, 3);
    assert.match(h.stdout(), /3 hallazgo/);
  });

  it('el artefacto se lee del fichero del RETO VIGENTE, no de uno recalculado', async () => {
    const h = harness({ gate: pending });
    await runAuditCli(null, {}, h.deps);
    assert.deepEqual(h.artifactReads, [auditArtifactPath({ taskId: 'uuid-74', fingerprint: pending.fingerprint })]);
  });

  it('un artefacto de OTRO reto no cierra nada', async () => {
    const md = '<!-- kodo:audit v=1 fp=ffffffffffff findings=0 -->';
    const h = harness({ gate: pending, artifact: md });
    assert.equal(await runAuditCli(null, {}, h.deps), 2);
    assert.equal(h.closed.length, 0);
  });
});

describe('kodo audit — idempotencia y desfase', () => {
  const audited = {
    status: 'audited', count: 2, fingerprint: 'a'.repeat(64), evidence: 'artifact', findings: 0,
    commit: HEAD, challenge_commit: HEAD, base_commit: BASE,
    opened_at: '2026-09-03T08:00:00.000Z', audited_at: '2026-09-03T09:00:00.000Z',
  };

  it('volver a ejecutarlo con la rama quieta no cambia nada y sale con 0', async () => {
    const h = harness({ gate: audited });
    assert.equal(await runAuditCli(null, {}, h.deps), 0);
    assert.equal(h.opened.length, 0);
    assert.equal(h.closed.length, 0);
    assert.match(h.stdout(), /ya auditado/);
  });

  it('un commit posterior DESFASA la auditoría: reto nuevo, con fingerprint nuevo', async () => {
    const h = harness({ gate: audited, git: healthyGit({ head: 'e'.repeat(40) }) });
    assert.equal(await runAuditCli(null, {}, h.deps), 2);
    assert.equal(h.opened.length, 1);
    assert.notEqual(h.opened[0].fingerprint, audited.fingerprint);
    assert.equal(h.opened[0].challenge_commit, 'e'.repeat(40));
  });
});

describe('kodo audit — degradaciones honestas', () => {
  it('fuera de un repo: exit 1, y no se abre ningún reto', async () => {
    const h = harness({ git: () => '' });
    assert.equal(await runAuditCli(null, {}, h.deps), 1);
    assert.equal(h.opened.length, 0);
    assert.match(h.stderr(), /no hay rama que auditar/);
  });

  it('detached HEAD: exit 1 — tampoco habrá entrada en la cola', async () => {
    const h = harness({ git: healthyGit({ branch: '' }) });
    assert.equal(await runAuditCli(null, {}, h.deps), 1);
    assert.equal(h.opened.length, 0);
  });

  it('sin sesión asociable: el reto se abre IGUAL, pero se avisa por stderr', async () => {
    const h = harness({ sessions: {} });
    assert.equal(await runAuditCli(null, {}, h.deps), 2);
    assert.equal(h.opened.length, 1);
    assert.match(h.stderr(), /no se pudo asociar a ninguna sesión/);
    assert.match(h.stdout(), /no disponible/, 'y no se ofrece un artefacto que nadie asociará');
  });

  it('el reto que no se puede persistir sale con 1, no con 2', async () => {
    const h = harness();
    h.deps.openGateFn = () => ({ ok: false, reason: 'lock-timeout' });
    assert.equal(await runAuditCli(null, {}, h.deps), 1);
    assert.match(h.stderr(), /no se pudo abrir el reto/);
  });

  it('la auditoría que ocurrió pero no se pudo registrar sale con 1: no se finge un 0', async () => {
    const h = harness({
      gate: { status: 'pending', count: 1, fingerprint: 'a'.repeat(64), evidence: null, findings: null, commit: null, challenge_commit: HEAD, base_commit: null, opened_at: '2026-09-03T08:00:00.000Z', audited_at: null },
      git: healthyGit({ head: 'e'.repeat(40) }),
    });
    h.deps.closeGateFn = () => ({ ok: false, reason: 'lock-timeout' });
    assert.equal(await runAuditCli(null, {}, h.deps), 1);
    assert.match(h.stderr(), /no se pudo persistir/);
  });
});

describe('kodo audit --json — carril máquina', () => {
  it('el reto abierto sale como JSON y el exit sigue siendo 2', async () => {
    const h = harness();
    const code = await runAuditCli(null, { json: true }, h.deps);
    assert.equal(code, 2);
    const payload = JSON.parse(h.stdout());
    assert.equal(payload.action, 'challenge');
    assert.equal(payload.task_ref, 'KODO-74');
    assert.equal(payload.branch, BRANCH);
    assert.equal(payload.audit.status, 'pending');
    assert.match(payload.artifact_path, /audits\/uuid-74\.md$/);
    assert.equal(/\[/.test(h.stdout()), false, 'el carril máquina no lleva ANSI');
  });
});

describe('resolveSession — unique-or-null, con el symlink cubierto', () => {
  const load = (sessions) => () => ({ schema_version: 3, sessions, history: [] });

  it('resuelve por path cuando coincide con `project_path`', () => {
    const s = resolveSession({ project: PROJECT, toplevel: WORKTREE, branch: BRANCH, loadStateFn: load({ a: SESSION }) });
    assert.equal(s?.task_ref, 'KODO-74');
  });

  it('resuelve por `worktree_path` cuando el toplevel es el del worktree', () => {
    const withWt = { ...SESSION, project_path: '/otro', worktree_path: WORKTREE };
    const s = resolveSession({ project: '/nada', toplevel: WORKTREE, branch: BRANCH, loadStateFn: load({ a: withWt }) });
    assert.equal(s?.task_ref, 'KODO-74');
  });

  it('con el path resuelto por symlink cae a la RAMA, que es única', () => {
    const s = resolveSession({
      project: '/private/repo/kodo', toplevel: '/private/repo/kodo', branch: BRANCH,
      loadStateFn: load({ a: SESSION }),
    });
    assert.equal(s?.task_ref, 'KODO-74');
  });

  it('dos sesiones del mismo repo se desempatan por rama', () => {
    const otra = { ...SESSION, task_ref: 'KODO-99', task_id: 'uuid-99', branch: 'feat/otra' };
    const s = resolveSession({ project: PROJECT, toplevel: WORKTREE, branch: 'feat/otra', loadStateFn: load({ a: SESSION, b: otra }) });
    assert.equal(s?.task_ref, 'KODO-99');
  });

  it('ambiguo → null: ante la duda, no responder', () => {
    const otra = { ...SESSION, task_ref: 'KODO-99', task_id: 'uuid-99' };
    assert.equal(resolveSession({ project: PROJECT, toplevel: WORKTREE, branch: BRANCH, loadStateFn: load({ a: SESSION, b: otra }) }), null);
  });

  it('el `ref` explícito es el desempate del operador', () => {
    const otra = { ...SESSION, task_ref: 'KODO-99', task_id: 'uuid-99' };
    const s = resolveSession({ project: PROJECT, toplevel: WORKTREE, branch: BRANCH, ref: 'KODO-99', loadStateFn: load({ a: SESSION, b: otra }) });
    assert.equal(s?.task_id, 'uuid-99');
  });

  it('un state ilegible no lanza', () => {
    assert.equal(resolveSession({ project: PROJECT, branch: BRANCH, loadStateFn: () => { throw new Error('EACCES'); } }), null);
  });
});

describe('readGitFacts — never-throws y hashea el árbol sucio', () => {
  it('deriva el repo principal del `--git-common-dir`, no del layout del worktree', async () => {
    const facts = await readGitFacts({ cwd: WORKTREE, gitFn: (c, a) => healthyGit()(a.join(' ')) });
    assert.equal(facts.project, PROJECT);
    assert.equal(facts.toplevel, WORKTREE);
    assert.equal(facts.branch, BRANCH);
    assert.equal(facts.head, HEAD);
    assert.equal(facts.dirty, null, 'árbol limpio es ausencia');
  });

  it('un git que lanza devuelve todo en null en vez de propagar', async () => {
    const facts = await readGitFacts({ cwd: WORKTREE, gitFn: () => { throw new Error('no git'); } });
    assert.deepEqual(facts, { project: null, toplevel: null, branch: null, head: null, dirty: null });
  });

  it('el árbol sucio se hashea, nunca viaja crudo', async () => {
    const facts = await readGitFacts({ cwd: WORKTREE, gitFn: (c, a) => healthyGit({ dirty: ' M secreto.env' })(a.join(' ')) });
    assert.match(/** @type {string} */ (facts.dirty), /^[0-9a-f]{16}$/);
    assert.equal(/secreto/.test(/** @type {string} */ (facts.dirty)), false);
  });
});
