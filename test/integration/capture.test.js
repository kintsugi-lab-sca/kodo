// @ts-check
//
// test/integration/capture.test.js — KODO-26: la captura al cerrar la sesión.
//
// Todo por DI: `gitFn` es un stub que responde por args, `enqueueFn` es un espía y el audit
// gate (KODO-74) entra por `readAuditGateFn`/`clearAuditGateFn`, así que estos casos NO tocan
// git de verdad NI el `~/.kodo/state.json` del operador. La cobertura del
// store real (que sí aísla HOME) vive en test/integration/queue.test.js; la del cableado en el
// hook, en test/hooks/session-end-integrate.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureIntegration } from '../../src/integration/capture.js';

/**
 * Stub de git dirigido por args. `respond` recibe el array de args ya normalizado a string y
 * devuelve el stdout; devolver `undefined` equivale a stdout vacío, y lanzar simula un exit
 * distinto de 0 (contrato de `execFileSync`, que es lo que el gitFn real hace).
 */
function makeGit(respond) {
  const calls = [];
  const gitFn = (cwd, args) => {
    calls.push({ cwd, args: args.join(' ') });
    const out = respond(args.join(' '), cwd);
    if (out instanceof Error) throw out;
    return out ?? '';
  };
  return { gitFn, calls };
}

/** Espía de encolado con la forma de retorno de `enqueueIntegration`. */
function makeEnqueue() {
  const calls = [];
  const enqueueFn = (input) => {
    calls.push(input);
    return { ok: true, value: { entry: { ...input, status: 'pending' }, deduped: false } };
  };
  return { enqueueFn, calls };
}

/**
 * Stubs del audit gate (KODO-74). Por defecto NO hay reto: es el caso mayoritario y el que
 * congela «sin el comando, el comportamiento previo queda intacto». Se pasan SIEMPRE, aunque el
 * caso no mire la auditoría, porque sin ellos la captura leería el state.json real del operador.
 */
function makeGate(gate = null) {
  const cleared = [];
  return {
    readAuditGateFn: () => gate,
    clearAuditGateFn: (target) => {
      cleared.push(target);
      return { ok: true, value: true };
    },
    cleared,
  };
}

const session = {
  task_ref: 'KODO-26',
  task_id: 'uuid-26',
  project_path: '/repo/kodo',
  session_id: 'sess-1',
};

/** Respuestas de un repo sano: rama con 3 commits propios, base al día, diff de docs. */
function healthyRepo(overrides = {}) {
  return (args) => {
    if (args.includes('branch --show-current')) return overrides.branch ?? 'worktree-abc';
    if (args.startsWith('symbolic-ref')) return overrides.originHead ?? 'origin/main';
    if (args.startsWith('rev-parse --verify')) return overrides.refExists ?? 'deadbeef';
    if (args.startsWith('rev-list --count worktree-abc --not')) return overrides.unmerged ?? '3';
    if (args.startsWith('rev-list --count worktree-abc..main')) return overrides.behind ?? '0';
    if (args.startsWith('diff --numstat')) return overrides.numstat ?? '3\t1\tREADME.md';
    return '';
  };
}

describe('captureIntegration — qué SÍ entra en la cola', () => {
  it('rama con commits propios → encola con conteo, base, diff y sugerencia', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn, ...makeGate() });

    assert.equal(r.captured, true);
    assert.equal(r.reason, 'queued');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      task_ref: 'KODO-26',
      task_id: 'uuid-26',
      project_path: '/repo/kodo',
      branch: 'worktree-abc',
      base_branch: 'main',
      commits_ahead: 3,
      base_ok: true,
      files_changed: 1,
      lines_changed: 4,
      suggested: 'ff',
      audit: null,
    });
  });

  it('la rama se lee del WORKTREE de la sesión (que el cleanup destruye después)', async () => {
    const { gitFn, calls } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn, ...makeGate() });
    const read = calls.find((c) => c.args.includes('branch --show-current'));
    assert.ok(read.args.startsWith('-C /wt/sess-1 '), `debe scopear al worktree: ${read.args}`);
  });

  it('sesión adoptada (sin worktree) → la rama se lee del propio repo', async () => {
    const { gitFn, calls } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    const read = calls.find((c) => c.args.includes('branch --show-current'));
    assert.equal(read.args, 'branch --show-current');
    assert.equal(read.cwd, '/repo/kodo');
  });

  it('el diff se mide con TRES puntos (base...branch), la vista de un PR', async () => {
    const { gitFn, calls } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.ok(calls.some((c) => c.args === 'diff --numstat main...worktree-abc'));
  });

  it('los binarios (`-\\t-\\tpath`) cuentan como fichero pero no suman líneas', async () => {
    const { gitFn } = makeGit(healthyRepo({ numstat: '-\t-\tlogo.png\n5\t2\tsrc/a.js' }));
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(calls[0].files_changed, 2);
    assert.equal(calls[0].lines_changed, 7);
  });
});

describe('captureIntegration — qué NO entra en la cola', () => {
  it('rama ya mergeada (conteo 0 de KODO-21) → NO se encola', async () => {
    const { gitFn } = makeGit(healthyRepo({ unmerged: '0' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn, ...makeGate() });
    assert.equal(r.captured, false);
    assert.equal(r.reason, 'merged');
    assert.deepEqual(calls, []);
  });

  it('HEAD desacoplado (sin rama) → no hay nada que encolar', async () => {
    const { gitFn } = makeGit(healthyRepo({ branch: '' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn, ...makeGate() });
    assert.equal(r.reason, 'detached');
    assert.deepEqual(calls, []);
  });

  it('la sesión cerró trabajando SOBRE la base → no se encola main contra main', async () => {
    const { gitFn } = makeGit(healthyRepo({ branch: 'main' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(r.reason, 'is-base');
    assert.deepEqual(calls, []);
  });

  it('sesión sin project_path → no-op', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session: {}, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(r.reason, 'no-project');
    assert.deepEqual(calls, []);
  });
});

describe('captureIntegration — base atrasada (criterio explícito del DoD)', () => {
  it('la base avanzó por debajo → base_ok:false y la sugerencia NUNCA es ff', async () => {
    // Diff de docs puro: sin la degradación esto sería 'ff'. `rev-list --count branch..main`
    // devuelve 4 ⇒ a la rama le faltan 4 commits de main ⇒ el ff no es aplicable.
    const { gitFn } = makeGit(healthyRepo({ behind: '4' }));
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(calls[0].base_ok, false);
    assert.notEqual(calls[0].suggested, 'ff');
    assert.equal(calls[0].suggested, 'merge');
  });

  it('base no resoluble (ni origin/HEAD ni main ni master) → base_ok null y review', async () => {
    const { gitFn } = makeGit((args) => {
      if (args.includes('branch --show-current')) return 'worktree-abc';
      if (args.startsWith('symbolic-ref')) return new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
      if (args.startsWith('rev-parse --verify')) return ''; // ni main ni master existen
      if (args.startsWith('rev-list --count')) return '3';
      return '';
    });
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(calls[0].base_branch, null);
    assert.equal(calls[0].base_ok, null);
    assert.equal(calls[0].files_changed, null, 'sin base no hay diff que medir');
    assert.equal(calls[0].suggested, 'review');
  });

  it('origin/HEAD apunta a una rama que no existe en local → cae a main', async () => {
    const { gitFn } = makeGit((args) => {
      if (args.includes('branch --show-current')) return 'worktree-abc';
      if (args.startsWith('symbolic-ref')) return 'origin/develop';
      if (args.includes('refs/heads/develop')) return ''; // no existe en local
      if (args.includes('refs/heads/main')) return 'cafe1234';
      if (args.startsWith('rev-list --count worktree-abc --not')) return '2';
      if (args.startsWith('rev-list --count worktree-abc..main')) return '0';
      if (args.startsWith('diff --numstat')) return '10\t0\tsrc/a.js';
      return '';
    });
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(calls[0].base_branch, 'main');
    assert.equal(calls[0].suggested, 'merge');
  });
});

describe('captureIntegration — fail-open (la sesión SIEMPRE cierra)', () => {
  it('el conteo de KODO-21 no verificable → se encola como review, no se descarta', async () => {
    // Ante la duda la rama se conserva (KODO-21); la simetría aquí es encolarla para que la mire
    // un humano, nunca asumir que estaba mergeada.
    const { gitFn } = makeGit(healthyRepo({ unmerged: 'no-soy-un-numero' }));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate() });
    assert.equal(r.captured, true);
    assert.equal(calls[0].commits_ahead, null);
  });

  it('git lanza en TODOS los comandos → no lanza, devuelve detached y no encola', async () => {
    const { gitFn } = makeGit(() => new Error('git: command not found'));
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({ session, worktree: '/wt/sess-1', gitFn, enqueueFn, ...makeGate() });
    assert.equal(r.captured, false);
    assert.deepEqual(calls, []);
  });

  it('un enqueue que falla (lock-timeout) NO propaga', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn: () => ({ ok: false, reason: 'lock-timeout' }),
      ...makeGate(),
    });
    assert.equal(r.captured, false);
    assert.equal(r.reason, 'enqueue-failed');
  });

  it('un enqueue que LANZA tampoco propaga (fail-open de cuerpo entero)', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn: () => { throw new Error('EROFS'); },
      ...makeGate(),
    });
    assert.equal(r.captured, false);
    assert.equal(r.reason, 'error');
  });
});

// ── KODO-30: el worktree ya no existe cuando corre la captura ────────────────
//
// La captura corre en SessionEnd, justo después de que Claude Code haya borrado el worktree
// de una sesión `--worktree` limpia. `git -C <wt> branch --show-current` LANZA sobre un
// directorio ausente, y el resultado era `detached`: una rama con trabajo que jamás entraba
// en la cola, con un skip indistinguible de un detached HEAD real.
//
// `session.branch` es la misma rama, sellada por el hook Stop mientras el worktree vivía.
describe('captureIntegration — worktree desaparecido, rama persistida (KODO-30)', () => {
  /** El `-C <wt>` falla; el resto del repo (leído desde `project`) responde normal. */
  function worktreeGone(branch, overrides = {}) {
    return (args, cwd) => {
      if (args.includes('branch --show-current')) {
        return new Error(`fatal: cannot change to '/repo/kodo/.claude/worktrees/sess-1': No such file or directory`);
      }
      if (args.startsWith('symbolic-ref')) return 'origin/main';
      if (args.startsWith('rev-parse --verify')) return 'deadbeef';
      if (args.startsWith(`rev-list --count ${branch} --not`)) return overrides.unmerged ?? '3';
      if (args.startsWith(`rev-list --count ${branch}..main`)) return '0';
      if (args.startsWith('diff --numstat')) return '3\t1\tREADME.md';
      return '';
    };
  }

  it('ENCOLA con la rama persistida cuando el directorio del worktree ya no responde', async () => {
    const branch = 'feat/itclip-82-cliente-activo';
    const { gitFn } = makeGit(worktreeGone(branch));
    const { enqueueFn, calls } = makeEnqueue();

    const r = await captureIntegration({
      session: { ...session, branch },
      worktree: '/repo/kodo/.claude/worktrees/sess-1',
      gitFn,
      enqueueFn,
      ...makeGate(),
    });

    assert.equal(r.captured, true);
    assert.equal(r.reason, 'queued');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].branch, branch);
    assert.equal(calls[0].commits_ahead, 3);
  });

  it('MERGED: con la rama persistida el gate KODO-21 resuelve, en vez de saltar como detached', async () => {
    const branch = 'feat/itclip-81-piezas-prototipo';
    const { gitFn } = makeGit(worktreeGone(branch, { unmerged: '0' }));
    const { enqueueFn, calls } = makeEnqueue();

    const r = await captureIntegration({
      session: { ...session, branch },
      worktree: '/repo/kodo/.claude/worktrees/sess-1',
      gitFn,
      enqueueFn,
      ...makeGate(),
    });

    // 'merged' y no 'detached': la pregunta SE RESPONDIÓ, y la respuesta es que no hay
    // nada que integrar. Ese es el criterio del DoD — encola, o dice merged.
    assert.equal(r.reason, 'merged');
    assert.equal(r.captured, false);
    assert.equal(calls.length, 0);
  });

  it('SIN rama persistida sigue siendo detached (no se inventa nada)', async () => {
    const { gitFn } = makeGit(worktreeGone('feat/x'));
    const { enqueueFn, calls } = makeEnqueue();

    const r = await captureIntegration({
      session,
      worktree: '/repo/kodo/.claude/worktrees/sess-1',
      gitFn,
      enqueueFn,
      ...makeGate(),
    });

    assert.equal(r.reason, 'detached');
    assert.equal(calls.length, 0);
  });

  it('CON worktree vivo manda git, NO la rama persistida (el agente pudo cambiar de rama)', async () => {
    const { gitFn } = makeGit(healthyRepo()); // git dice 'worktree-abc'
    const { enqueueFn, calls } = makeEnqueue();

    await captureIntegration({
      session: { ...session, branch: 'feat/rama-vieja' },
      worktree: '/repo/kodo/.claude/worktrees/sess-1',
      gitFn,
      enqueueFn,
      ...makeGate(),
    });

    assert.equal(calls[0].branch, 'worktree-abc', 'el dato de AHORA gana al persistido');
  });
});

describe('captureIntegration — el veredicto del audit gate (KODO-74)', () => {
  const auditado = {
    status: 'audited',
    count: 2,
    fingerprint: 'a'.repeat(64),
    evidence: 'artifact',
    findings: 0,
    commit: 'b'.repeat(40),
    challenge_commit: 'b'.repeat(40),
    base_commit: null,
    opened_at: '2026-09-03T08:00:00.000Z',
    audited_at: '2026-09-03T09:00:00.000Z',
  };

  it('SIN reto, la entrada se encola con `audit: null` — sin auditar, igual que antes', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate(null) });
    assert.equal(calls[0].audit, null);
  });

  it('el reto se LEE con la identidad de la rama (project_path, branch)', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    const reads = [];
    await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn,
      readAuditGateFn: (t) => { reads.push(t); return null; },
      clearAuditGateFn: () => ({ ok: true, value: false }),
    });
    assert.deepEqual(reads, [{ project_path: '/repo/kodo', branch: 'worktree-abc' }]);
  });

  it('con reto cerrado, el veredicto viaja ENTERO a la entrada de la cola', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate(auditado) });
    assert.deepEqual(calls[0].audit, auditado);
  });

  it('un reto ABIERTO también se encola: `pending` es un estado honesto, no un hueco', async () => {
    const abierto = { ...auditado, status: 'pending', evidence: null, findings: null, commit: null, audited_at: null };
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...makeGate(abierto) });
    assert.equal(calls[0].audit.status, 'pending');
  });

  it('el reto se RETIRA tras sellarlo: cada sesión audita lo suyo', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    const gate = makeGate(auditado);
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...gate });
    assert.deepEqual(gate.cleared, [{ project_path: '/repo/kodo', branch: 'worktree-abc' }]);
  });

  it('si el encolado FALLA, el reto NO se retira: se recupera en la siguiente captura', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const gate = makeGate(auditado);
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn: () => ({ ok: false, reason: 'lock-timeout' }),
      ...gate,
    });
    assert.equal(r.captured, false);
    assert.deepEqual(gate.cleared, []);
  });

  it('sin reto no se llama al clear: nada que retirar', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn } = makeEnqueue();
    const gate = makeGate(null);
    await captureIntegration({ session, worktree: null, gitFn, enqueueFn, ...gate });
    assert.deepEqual(gate.cleared, []);
  });

  it('un store que lanza al LEER no puede impedir que la rama se encole', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn,
      readAuditGateFn: () => { throw new Error('EACCES'); },
      clearAuditGateFn: () => ({ ok: true, value: false }),
    });
    // El audit gate es un AÑADIDO sobre una captura que ya funcionaba: la peor consecuencia de
    // que se rompa es perder la SEÑAL, jamás el trabajo.
    assert.equal(r.captured, true);
    assert.equal(calls[0].audit, null, 'sin auditar, que es la verdad');
  });

  it('un store que lanza al RETIRAR no convierte una captura hecha en un fallo', async () => {
    const { gitFn } = makeGit(healthyRepo());
    const { enqueueFn, calls } = makeEnqueue();
    const r = await captureIntegration({
      session,
      worktree: null,
      gitFn,
      enqueueFn,
      readAuditGateFn: () => auditado,
      clearAuditGateFn: () => { throw new Error('EACCES'); },
    });
    assert.equal(r.captured, true, 'la entrada YA estaba en la cola');
    assert.deepEqual(calls[0].audit, auditado);
  });
});
