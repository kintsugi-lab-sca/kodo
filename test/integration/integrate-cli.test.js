// @ts-check
//
// test/integration/integrate-cli.test.js — KODO-26: `kodo integrate` (listado + ejecución).
//
// TODO por DI: git, el store y el logger son stubs, así que ningún caso toca un repo real, el
// `~/.kodo/state.json` del operador ni el NDJSON de `~/.kodo/logs/`. Lo que se congela aquí es
// el contrato observable del comando: qué comandos git emite (y cuáles NO emite jamás), qué
// exit code devuelve, cuándo resuelve la entrada y qué línea de registro deja.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runIntegrateActionCli, runIntegrateListCli, formatAge } from '../../src/cli/integrate.js';
import { createFormatter } from '../../src/cli/format.js';

/** Formatter sin color: los asserts comparan texto, no secuencias ANSI. */
const plainFormatter = () => createFormatter({ isTTY: false }, {});

/** Entrada pendiente canónica. */
function entry(overrides = {}) {
  return {
    task_ref: 'KODO-26',
    task_id: 'uuid-26',
    project_path: '/repo/kodo',
    branch: 'worktree-abc',
    base_branch: 'main',
    commits_ahead: 3,
    base_ok: true,
    files_changed: 2,
    lines_changed: 40,
    suggested: 'merge',
    status: 'pending',
    created_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-20T10:00:00.000Z',
    action: null,
    sha: null,
    outcome: null,
    resolved_at: null,
    ...overrides,
  };
}

/**
 * Arnés completo: stubs de git/store/logger + captura de stdout y stderr.
 * `git` responde por args igual que en capture.test.js; devolver un Error simula exit != 0.
 */
function harness({ found = entry(), git = () => '', resolveResult = null } = {}) {
  const out = [];
  const errs = [];
  const gitCalls = [];
  const resolveCalls = [];
  const events = [];
  const logger = {
    debug() {},
    info: (msg, meta) => events.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => events.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => events.push({ level: 'error', msg, meta }),
    child() { return logger; },
  };
  const deps = {
    findFn: () => found,
    resolveFn: (ref, patch) => {
      resolveCalls.push({ ref, patch });
      return resolveResult || { ok: true, value: { ...entry(), ...patch, status: patch.status } };
    },
    gitFn: (cwd, args) => {
      gitCalls.push({ cwd, args: args.join(' ') });
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
    deps,
    out,
    errs,
    gitCalls,
    resolveCalls,
    events,
    stdout: () => out.join(''),
    stderr: () => errs.join(''),
    /** El evento `integrate.action`, que debe ser exactamente uno por invocación con acción. */
    action: () => events.filter((e) => e.meta?.event === 'integrate.action'),
  };
}

/** Repo limpio, en la rama base, con la rama de la entrada viva. */
const cleanRepo = (args) => {
  if (args === 'status --porcelain') return '';
  if (args === 'branch --show-current') return 'main';
  if (args.startsWith('rev-parse --verify')) return 'cafe1234';
  if (args === 'rev-parse HEAD') return 'abcdef1234567890';
  return '';
};

describe('kodo integrate <ref> --ff', () => {
  it('ejecuta merge --ff-only, resuelve la entrada con el sha y devuelve 0', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', { ff: true }, h.deps);

    assert.equal(code, 0);
    assert.ok(h.gitCalls.some((c) => c.args === 'merge --ff-only worktree-abc'), 'debe hacer ff-only');
    assert.equal(h.resolveCalls.length, 1);
    assert.deepEqual(h.resolveCalls[0].patch, {
      action: 'ff',
      status: 'done',
      sha: 'abcdef1234567890',
      outcome: 'fast-forwarded',
    });
  });

  it('un ff imposible NO resuelve la entrada (sigue pendiente, que es la verdad)', async () => {
    const h = harness({
      git: (args) => (args.startsWith('merge') ? new Error('fatal: Not possible to fast-forward, aborting.') : cleanRepo(args)),
    });
    const code = await runIntegrateActionCli('KODO-26', { ff: true }, h.deps);

    assert.equal(code, 1);
    assert.deepEqual(h.resolveCalls, [], 'un fallo jamás saca la entrada de pending');
    assert.equal(h.action()[0].meta.outcome, 'ff-failed');
  });
});

describe('kodo integrate <ref> --merge', () => {
  it('ejecuta merge --no-ff con mensaje trazable y resuelve como merged', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', { merge: true }, h.deps);

    assert.equal(code, 0);
    const merge = h.gitCalls.find((c) => c.args.startsWith('merge'));
    assert.equal(merge.args, "merge --no-ff -m Merge branch 'worktree-abc' (KODO-26) worktree-abc");
    assert.equal(h.resolveCalls[0].patch.outcome, 'merged');
  });
});

describe('kodo integrate <ref> --pr', () => {
  it('NO hace push ni llama a gh: valida, imprime el comando y marca la entrada preparada', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', { pr: true }, h.deps);

    assert.equal(code, 0);
    // La invariante anti-push-fantasma, medida sobre lo que el comando REALMENTE ejecutó.
    assert.ok(!h.gitCalls.some((c) => c.args.includes('push')), 'jamás un push');
    assert.ok(!h.gitCalls.some((c) => c.args.includes('merge')), 'jamás un merge');
    assert.ok(h.stdout().includes('git push -u origin worktree-abc'), 'imprime el comando listo');
    assert.ok(h.stdout().includes('gh pr create --base main --head worktree-abc'));
    assert.equal(h.resolveCalls[0].patch.outcome, 'prepared');
    assert.equal(h.resolveCalls[0].patch.sha, null);
  });

  it('rama desaparecida → 1, sin resolver', async () => {
    const h = harness({
      git: (args) => (args.startsWith('rev-parse --verify') ? '' : cleanRepo(args)),
    });
    const code = await runIntegrateActionCli('KODO-26', { pr: true }, h.deps);
    assert.equal(code, 1);
    assert.deepEqual(h.resolveCalls, []);
    assert.equal(h.action()[0].meta.outcome, 'branch-missing');
  });
});

describe('kodo integrate <ref> --drop', () => {
  it('no ejecuta NI UN comando git y marca la entrada descartada', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', { drop: true }, h.deps);

    assert.equal(code, 0);
    assert.deepEqual(h.gitCalls, [], '--drop no toca la rama ni el repo');
    assert.deepEqual(h.resolveCalls[0].patch, { action: 'drop', status: 'dropped', sha: null, outcome: 'dropped' });
  });
});

describe('kodo integrate — precondiciones (nada se mutila a medias)', () => {
  it('worktree sucio → 1, sin merge y sin resolver', async () => {
    const h = harness({ git: (args) => (args === 'status --porcelain' ? ' M src/a.js\n' : cleanRepo(args)) });
    const code = await runIntegrateActionCli('KODO-26', { merge: true }, h.deps);

    assert.equal(code, 1);
    assert.ok(!h.gitCalls.some((c) => c.args.startsWith('merge')));
    assert.deepEqual(h.resolveCalls, []);
    assert.equal(h.action()[0].meta.outcome, 'worktree-dirty');
  });

  it('la base NO está checkouteada → 1, y kodo NO cambia de rama por su cuenta', async () => {
    const h = harness({ git: (args) => (args === 'branch --show-current' ? 'otra-cosa' : cleanRepo(args)) });
    const code = await runIntegrateActionCli('KODO-26', { ff: true }, h.deps);

    assert.equal(code, 1);
    assert.ok(!h.gitCalls.some((c) => c.args.startsWith('switch') || c.args.startsWith('checkout')), 'jamás un switch');
    assert.ok(!h.gitCalls.some((c) => c.args.startsWith('merge')));
    assert.equal(h.action()[0].meta.outcome, 'base-not-checked-out');
  });

  it('entrada sin base resuelta → 1 con outcome propio', async () => {
    const h = harness({ found: entry({ base_branch: null }), git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', { merge: true }, h.deps);
    assert.equal(code, 1);
    assert.equal(h.action()[0].meta.outcome, 'base-unknown');
  });

  it('la suite opcional falla → no se integra nada', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli(
      'KODO-26',
      { merge: true, test: 'npm test' },
      { ...h.deps, runTestsFn: () => ({ ok: false, detail: '3 failing' }) },
    );
    assert.equal(code, 1);
    assert.ok(!h.gitCalls.some((c) => c.args.startsWith('merge')));
    assert.equal(h.action()[0].meta.outcome, 'tests-failed');
  });

  it('la suite opcional pasa → se integra', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli(
      'KODO-26',
      { merge: true, test: 'npm test' },
      { ...h.deps, runTestsFn: () => ({ ok: true, detail: '' }) },
    );
    assert.equal(code, 0);
    assert.ok(h.gitCalls.some((c) => c.args.startsWith('merge')));
  });
});

describe('kodo integrate — uso incorrecto (exit 2)', () => {
  it('sin acción → 2 y ni un comando git', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', {}, h.deps);
    assert.equal(code, 2);
    assert.deepEqual(h.gitCalls, []);
    assert.deepEqual(h.action(), []);
  });

  it('dos acciones a la vez → 2', async () => {
    const h = harness({ git: cleanRepo });
    const code = await runIntegrateActionCli('KODO-26', { ff: true, drop: true }, h.deps);
    assert.equal(code, 2);
    assert.deepEqual(h.gitCalls, []);
  });

  it('ref que no está pendiente → 2', async () => {
    const h = harness({ found: null, git: cleanRepo });
    const code = await runIntegrateActionCli('NO-EXISTE', { ff: true }, h.deps);
    assert.equal(code, 2);
    assert.deepEqual(h.gitCalls, []);
    assert.deepEqual(h.action(), []);
  });
});

describe('kodo integrate — registro NDJSON (auditoría determinista)', () => {
  it('éxito: UN evento integrate.action a nivel info con las 6 claves del contrato', async () => {
    const h = harness({ git: cleanRepo });
    await runIntegrateActionCli('KODO-26', { ff: true }, h.deps);

    const evs = h.action();
    assert.equal(evs.length, 1, 'exactamente uno por invocación');
    assert.equal(evs[0].level, 'info');
    assert.deepEqual(evs[0].meta, {
      event: 'integrate.action',
      action: 'ff',
      task_ref: 'KODO-26',
      branch: 'worktree-abc',
      sha: 'abcdef1234567890',
      outcome: 'fast-forwarded',
    });
  });

  it('fallo: MISMO evento a nivel warn y con outcome distinto', async () => {
    const h = harness({ git: (args) => (args === 'status --porcelain' ? ' M x\n' : cleanRepo(args)) });
    await runIntegrateActionCli('KODO-26', { ff: true }, h.deps);

    const evs = h.action();
    assert.equal(evs.length, 1);
    assert.equal(evs[0].level, 'warn');
    assert.equal(evs[0].meta.outcome, 'worktree-dirty');
    assert.equal(evs[0].meta.sha, null);
  });

  it('--drop también deja su línea', async () => {
    const h = harness({ git: cleanRepo });
    await runIntegrateActionCli('KODO-26', { drop: true }, h.deps);
    assert.equal(h.action()[0].meta.outcome, 'dropped');
  });

  it('un log que LANZA no rompe la acción (fail-open del registro)', async () => {
    const h = harness({ git: cleanRepo });
    const brokenLogger = {
      debug() {}, child() { return brokenLogger; },
      info() { throw new Error('EROFS: read-only file system'); },
      warn() { throw new Error('EROFS: read-only file system'); },
      error() { throw new Error('EROFS'); },
    };
    const code = await runIntegrateActionCli('KODO-26', { ff: true }, { ...h.deps, loggerFn: () => brokenLogger });
    assert.equal(code, 0, 'el merge se hizo y el comando devuelve éxito pese al log roto');
    assert.ok(h.gitCalls.some((c) => c.args === 'merge --ff-only worktree-abc'));
  });

  it('acción hecha pero cola no actualizable → 1 con outcome state-lock-timeout', async () => {
    const h = harness({ git: cleanRepo, resolveResult: { ok: false, reason: 'lock-timeout' } });
    const code = await runIntegrateActionCli('KODO-26', { ff: true }, h.deps);
    assert.equal(code, 1, 'no se miente con un 0: la entrada seguiría pendiente');
    assert.equal(h.action()[0].meta.outcome, 'state-lock-timeout');
    assert.equal(h.action()[0].level, 'warn');
  });
});

describe('kodo integrate — listado', () => {
  it('--json: keys fijas {pending, entries} y cero llamadas a git', () => {
    const out = [];
    const code = runIntegrateListCli(
      { json: true },
      { listFn: () => [entry()], writeFn: (s) => out.push(s), gitFn: () => { throw new Error('el listado NO usa git'); } },
    );
    assert.equal(code, 0);
    const payload = JSON.parse(out.join(''));
    assert.deepEqual(Object.keys(payload), ['pending', 'entries']);
    assert.equal(payload.pending, 1);
    assert.equal(payload.entries[0].task_ref, 'KODO-26');
    assert.ok(!/\x1b\[/.test(out.join('')), 'sin ANSI en el carril máquina');
  });

  it('humano: una fila por entrada con ref, rama, commits, base, sugerencia y edad', () => {
    const out = [];
    const code = runIntegrateListCli(
      {},
      {
        listFn: () => [entry()],
        writeFn: (s) => out.push(s),
        formatterFn: plainFormatter,
        nowFn: () => new Date('2026-08-20T13:00:00.000Z'),
      },
    );
    assert.equal(code, 0);
    const text = out.join('');
    assert.match(text, /KODO-26/);
    assert.match(text, /worktree-abc/);
    assert.match(text, /merge/);
    assert.match(text, /3h/, 'la edad se pinta legible');
  });

  it('cola vacía → mensaje y exit 0', () => {
    const out = [];
    const code = runIntegrateListCli({}, { listFn: () => [], writeFn: (s) => out.push(s), formatterFn: plainFormatter });
    assert.equal(code, 0);
    assert.match(out.join(''), /vacía/);
  });

  it('never-throws: un store que revienta no convierte el listado en un exit distinto de 0', () => {
    const errs = [];
    const code = runIntegrateListCli(
      {},
      { listFn: () => { throw new Error('boom'); }, errFn: (s) => errs.push(s), formatterFn: plainFormatter },
    );
    assert.equal(code, 0);
    assert.match(errs.join(''), /no se pudo renderizar/);
  });
});

describe('formatAge', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');
  it('minutos, horas y días', () => {
    assert.equal(formatAge('2026-08-20T11:58:00.000Z', now), '2m');
    assert.equal(formatAge('2026-08-20T07:00:00.000Z', now), '5h');
    assert.equal(formatAge('2026-08-18T12:00:00.000Z', now), '2d');
  });
  it('fecha ilegible → ?', () => {
    assert.equal(formatAge('no-es-una-fecha', now), '?');
  });
  it('una fecha futura no produce negativos', () => {
    assert.equal(formatAge('2026-08-21T12:00:00.000Z', now), '0m');
  });
});
